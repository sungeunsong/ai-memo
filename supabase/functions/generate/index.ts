import { createClient, SupabaseClient } from 'jsr:@supabase/supabase-js@2';

/**
 * AI 정리 프록시.
 *
 * 이 함수가 있는 이유는 하나입니다. EXPO_PUBLIC_* 키는 빌드 시 번들에 인라인돼
 * 웹 번들과 APK 양쪽에서 추출됩니다. 남에게 앱을 주는 것이 곧 Gemini 키를 주는
 * 것이라, 키를 앱 밖으로 빼지 않으면 공개 배포가 불가능합니다.
 *
 * 다만 키만 옮기면 절반입니다. 남이 얼마든지 부를 수 있는 창구가 새로 생기는
 * 만큼, 무엇을 부를지(모델·출력 상한·스키마)와 얼마나 부를지(상한)를 서버가
 * 쥐고 있어야 합니다. 앱이 보낸 것을 그대로 흘려보내면 번들을 뜯은 사람이 더 비싼
 * 모델로 바꿔 부를 수 있고, 그러면 키를 숨긴 의미가 사라집니다.
 *
 * 프롬프트와 사전(Registry)은 앱이 계속 소유합니다. V2 프롬프트 동작을 건드리지
 * 않는 것이 1차 목표라, 이번에는 옮기지 않습니다.
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const GEMINI_API_KEY = textFromEnv('GEMINI_API_KEY');
const GEMINI_MODEL = textFromEnv('GEMINI_MODEL');
const GEMINI_THINKING_BUDGET = numberFromEnv('GEMINI_THINKING_BUDGET', 0);

const USER_QUOTA_CAP = numberFromEnv('USER_QUOTA_CAP');
const USER_CALL_CAP = numberFromEnv('USER_CALL_CAP');
const GLOBAL_CALL_CAP = numberFromEnv('GLOBAL_CALL_CAP');

/**
 * 프롬프트 전체 길이 상한.
 *
 * 앱은 본문을 24,000자로 자르지만(MAX_CONTENT_CHARS), 여기로 오는 것은 지시문과
 * 사전까지 합쳐진 프롬프트 전체라 그 숫자를 그대로 쓸 수 없습니다. 본문만 떼어내
 * 재려면 프롬프트 형식을 서버가 알아야 하는데, 그건 프롬프트를 서버로 옮기는 일이라
 * 이번 범위가 아닙니다.
 *
 * 그래서 넉넉한 전체 상한으로 막습니다. 앱을 뜯어 절단을 지워도 여기서 걸립니다.
 * 정확한 절단은 앱이 하고, 서버는 '터무니없이 긴 것'만 잘라냅니다.
 */
const MAX_PROMPT_CHARS = numberFromEnv('MAX_PROMPT_CHARS', 60000);

/** 이미지 base64 길이 상한. 대략 3MB어치입니다. */
const MAX_IMAGE_BASE64_CHARS = numberFromEnv('MAX_IMAGE_BASE64_CHARS', 4_000_000);

/**
 * Gemini 응답 대기 한계.
 *
 * 앱에서 직접 부를 때는 12초였습니다. 폰에서 구글 API로 가는 첫 연결이 종종 통째로
 * 물려서, 짧게 끊고 다시 거는 편이 빨랐기 때문입니다. 서버에서 나가는 길은 그보다
 * 안정적이고 홉도 하나 늘었으니 조금 길게 잡습니다. 실측 후 조정할 값입니다.
 */
const GEMINI_TIMEOUT_MS = numberFromEnv('GEMINI_TIMEOUT_MS', 20000);

const OPERATION = 'generate';

/**
 * 브라우저에서 부를 수 있게 하는 응답 머리.
 *
 * 웹에서 이 함수를 부르면 브라우저가 진짜 요청 앞에 OPTIONS 예비 요청을 먼저 보냅니다.
 * Authorization처럼 기본이 아닌 헤더를 붙이기 때문인데, 여기에 허용을 돌려주지 않으면
 * 실제 요청은 나가지도 못합니다. curl로는 이 단계가 없어 시험에서 걸리지 않습니다.
 *
 * Origin을 열어두는 것이 위험하지 않은 이유는, 여기서 문을 지키는 것이 출처가 아니라
 * 사용자 토큰이기 때문입니다. 쿠키를 쓰지 않으므로 남의 브라우저 세션이 실려올 일도
 * 없습니다. 앱이 웹과 안드로이드 양쪽에서 도는 마당에 출처를 특정하기도 어렵습니다.
 */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

/**
 * 스키마는 이름으로만 받습니다.
 *
 * 앱이 스키마를 통째로 보내게 두면 출력 형태를 클라이언트가 정하게 됩니다.
 * 거대한 스키마를 밀어 넣어 토큰을 태우는 길도 같이 열립니다.
 */
const RESPONSE_SCHEMAS: Record<string, unknown> = {
  'content-v2': {
    type: 'object',
    properties: {
      title: { type: 'string' },
      summary: { type: 'string' },
      detailedAnalysis: { type: 'string' },
      domain: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          label: { type: 'string' },
        },
        required: ['key', 'label'],
      },
      facts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            label: { type: 'string' },
            domain: { type: 'string' },
            values: { type: 'array', items: { type: 'string' } },
          },
          required: ['key', 'label', 'values'],
        },
      },
      extractedText: { type: 'string' },
    },
    required: ['title', 'summary', 'detailedAnalysis', 'domain', 'facts'],
  },
};

/**
 * 모델이 응답은 했는데 쓸 본문을 안 준 경우.
 *
 * 네트워크 실패와 갈라둡니다. 이쪽은 **다시 걸어도 같은 답이 옵니다.** 같은 입력을
 * 다시 넣는 것이니까요. 그런데 502로 돌려주면 앱이 '다시 걸어볼 만한 실패'로 읽고
 * 세 번 더 부릅니다. 실제로 저장물 두 건에 호출이 여섯 번 나갔습니다 — 결과는 같고
 * 돈만 세 배입니다.
 */
class GeminiCallError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'GeminiCallError';
    this.retryable = retryable;
  }
}

/**
 * HTTP 상태로 '다시 걸면 될 것'을 가릅니다.
 *
 * 설정이 틀려서 나는 400(모델과 안 맞는 생성 옵션), 키 문제 401·403, 모델명 오타
 * 404는 몇 번을 걸어도 같습니다. 그걸 재시도 대상에 넣으면 고장 하나가 호출 세 번이
 * 됩니다. 429는 시간이 지나면 풀리고, 5xx와 408은 구글 쪽이 흔들린 것일 수 있습니다.
 */
function isRetryableHttpStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

/** 본문이 없는 이유를 사람이 읽을 말로. 원본 코드는 로그에만 남깁니다. */
function describeMissingText(finishReason: string, blockReason?: string): string {
  // 정책에 막힌 것은 '실패'와 다릅니다.
  //
  // "모델이 거부했습니다"로만 적었더니 사용자는 앱이 고장 난 줄 알고 재분석을 계속
  // 누릅니다. 누를 때마다 입력 토큰만 나가고 답은 같습니다. 우리가 고칠 수 있는
  // 문제가 아니라는 것, 다시 눌러도 소용없다는 것까지 말해야 그만 누릅니다.
  //
  // 기계가 주는 코드(PROHIBITED_CONTENT 등)는 로그에만 남깁니다. 화면에는 무슨
  // 뜻인지가 필요하지 코드 이름이 필요한 게 아닙니다.
  if (blockReason) {
    const what =
      blockReason === 'PROHIBITED_CONTENT'
        ? '구글 AI 정책에 걸려'
        : '안전 정책에 걸려';

    return `${what} 이 글은 AI가 정리할 수 없습니다. 다시 눌러도 같습니다. 저장물과 원문은 그대로 있습니다.`;
  }

  switch (finishReason) {
    case 'MAX_TOKENS':
      return '글이 길어 정리가 끝나기 전에 잘렸습니다.';
    case 'SAFETY':
      return '안전 정책에 걸려 정리가 중단됐습니다. 다시 눌러도 같습니다.';
    case 'RECITATION':
      return '원문을 그대로 옮기는 것으로 판단해 모델이 답을 멈췄습니다.';
    default:
      return '모델이 정리 결과를 돌려주지 않았습니다.';
  }
}

/**
 * 응답을 보낸 뒤에도 작업을 이어가게 합니다.
 *
 * 런타임이 주는 전역이라 이름 그대로 부르면 없는 환경에서 ReferenceError로 터집니다.
 * 그러면 호출이 통째로 실패하는데, 이것은 있으면 좋은 안전장치이지 없다고 정리를
 * 못 할 일은 아닙니다. 없으면 없는 대로 갑니다.
 */
function keepAlive(work: Promise<unknown>) {
  const runtime = (globalThis as Record<string, unknown>).EdgeRuntime as
    | { waitUntil?: (promise: Promise<unknown>) => void }
    | undefined;

  if (typeof runtime?.waitUntil === 'function') {
    runtime.waitUntil(work);
    return;
  }

  console.warn('[generate] EdgeRuntime.waitUntil이 없습니다. 연결이 끊기면 결과를 못 적을 수 있습니다.');
}

Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch (error) {
    // 여기까지 오면 우리가 예상 못 한 예외입니다. 그냥 두면 런타임이 평문
    // 'Internal Server Error'를 뱉어서, 무엇이 터졌는지 응답만 보고는 알 수 없습니다.
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error('[generate] 처리되지 않은 예외:', reason, error instanceof Error ? error.stack : '');
    return json(500, { status: 'internal_error', reason });
  }
});

async function handle(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return json(405, { status: 'method_not_allowed' });
  }

  // 1. 진짜 로그인한 사람인지 봅니다.
  //
  // 'Supabase 키가 있는가'로는 부족합니다. anon 키도 이 프로젝트가 서명한 멀쩡한
  // JWT라서, 그것만 검사하면 번들에서 키를 뽑은 누구나 통과합니다. 사용자 토큰으로
  // 실제 사용자를 읽어봐야 '누구의 몫을 셀 것인가'가 정해집니다.
  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: userData } = await userClient.auth.getUser();
  const user = userData?.user;

  if (!user) {
    return json(401, { status: 'unauthorized' });
  }

  // 2. 들어온 것을 봅니다.
  const body = await req.json().catch(() => null);

  if (!body || typeof body !== 'object') {
    return json(400, { status: 'bad_request', reason: '본문이 JSON이 아닙니다.' });
  }

  const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
  const prompt = typeof body.prompt === 'string' ? body.prompt : '';
  const schemaId = typeof body.schemaId === 'string' ? body.schemaId : '';
  const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64 : undefined;

  if (!requestId || requestId.length > 128) {
    return json(400, { status: 'bad_request', reason: 'requestId가 없거나 너무 깁니다.' });
  }

  if (!prompt) {
    return json(400, { status: 'bad_request', reason: 'prompt가 비었습니다.' });
  }

  const schema = RESPONSE_SCHEMAS[schemaId];
  if (!schema) {
    return json(400, { status: 'bad_request', reason: `모르는 schemaId입니다: ${schemaId}` });
  }

  if (imageBase64 && imageBase64.length > MAX_IMAGE_BASE64_CHARS) {
    return json(413, { status: 'too_large', reason: '이미지가 너무 큽니다.' });
  }

  // 자르고 진행합니다. 거절하면 사용자는 왜 안 되는지 알 수 없는 채로 저장물 하나를
  // 통째로 잃습니다. 앞부분만으로도 제목과 분야는 대개 제대로 나옵니다.
  const safePrompt = prompt.length > MAX_PROMPT_CHARS
    ? prompt.slice(0, MAX_PROMPT_CHARS)
    : prompt;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // 3. 진행해도 되는지 묻습니다. 바깥을 부르기 전입니다.
  const { data: gate, error: gateError } = await admin.rpc('begin_ai_request', {
    p_user_id: user.id,
    p_request_id: requestId,
    p_operation: OPERATION,
    p_user_quota_cap: USER_QUOTA_CAP,
    p_user_call_cap: USER_CALL_CAP,
    p_global_call_cap: GLOBAL_CALL_CAP,
  });

  if (gateError) {
    console.error('[generate] 게이트 호출 실패:', gateError.message);
    return json(500, { status: 'gate_error' });
  }

  const decision = gate?.decision as string | undefined;

  switch (decision) {
    case 'cached':
      return json(200, { status: 'ok', cached: true, data: gate.result });

    case 'in_progress':
    case 'expired':
      return json(200, { status: decision });

    case 'over_user_quota':
    case 'over_user_calls':
    case 'over_global_calls':
      // 어느 상한에 걸렸는지와 그때 이 인스턴스가 들고 있던 값을 같이 돌려줍니다.
      //
      // 상한을 시험하려고 낮춰둔 값이 되돌려지지 않은 채로 남아 실사용이 막힌 적이
      // 있습니다. 그때 응답에는 '상한에 걸렸다'만 있어서, 설정이 잘못된 것인지 정말
      // 많이 쓴 것인지 구별할 수 없었습니다. 우리 상한이라 감출 것도 아닙니다.
      console.log(`[generate] ${decision} user=${user.id} caps=${USER_QUOTA_CAP}/${USER_CALL_CAP}/${GLOBAL_CALL_CAP}`);
      return json(429, {
        status: decision,
        caps: {
          userQuota: USER_QUOTA_CAP,
          userCall: USER_CALL_CAP,
          globalCall: GLOBAL_CALL_CAP,
        },
      });

    case 'proceed':
      break;

    default:
      console.error('[generate] 모르는 판단:', decision);
      return json(500, { status: 'gate_error' });
  }

  // 4. 호출하고 결과를 남깁니다.
  //
  // waitUntil로 붙잡아 둡니다. 앱이 연결을 끊었다고 여기서 멈추면, 돈은 이미 나갔는데
  // 결과를 어디에도 못 적어 다음 회수가 같은 요약을 또 삽니다. 응답을 받는 사람이
  // 없어도 이 작업은 끝까지 가야 합니다.
  const work = runGeneration(admin, user.id, requestId, safePrompt, imageBase64, schema);
  keepAlive(work);

  const outcome = await work;

  if (!outcome.ok) {
    // 앱은 5xx를 '다시 걸어볼 만한 실패'로 읽고 세 번 더 부릅니다. 모델이 본문을
    // 안 준 것은 다시 걸어도 같은 답이라, 그걸 502로 돌려주면 한 건에 호출이 세 번
    // 나가고 결과는 똑같습니다. 실제로 저장물 두 건에 여섯 번이 나갔습니다.
    // 다시 해서 될 것만 5xx로 돌려줍니다.
    return outcome.retryable
      ? json(502, { status: 'upstream_failed', reason: outcome.reason })
      : json(422, { status: 'upstream_rejected', reason: outcome.reason });
  }

  return json(200, { status: 'ok', cached: false, data: outcome.data });
}

async function runGeneration(
  admin: SupabaseClient,
  userId: string,
  requestId: string,
  prompt: string,
  imageBase64: string | undefined,
  schema: unknown
): Promise<{ ok: true; data: unknown } | { ok: false; reason: string; retryable: boolean }> {
  try {
    const data = await callGemini(prompt, imageBase64, schema);

    await admin.rpc('complete_ai_request', {
      p_user_id: userId,
      p_request_id: requestId,
      p_operation: OPERATION,
      p_result: data,
    });

    return { ok: true, data };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error('[generate] 호출 실패:', reason);

    // 실패를 적어둬야 게이트가 다음에 '다시 해도 되는 건'으로 봅니다.
    // 안 적으면 running에 남아, 5분이 지나기 전까지 재시도가 in_progress로 막힙니다.
    // rpc가 돌려주는 것은 진짜 Promise가 아니라 then만 있는 객체입니다.
    // .catch를 붙이면 그 자체가 TypeError로 터져, 원래 실패 사유가 묻힙니다.
    try {
      await admin.rpc('fail_ai_request', {
        p_user_id: userId,
        p_request_id: requestId,
        p_operation: OPERATION,
        p_error: reason.slice(0, 500),
      });
    } catch (writeError) {
      console.error('[generate] 실패 기록도 실패했습니다:', writeError);
    }

    // 모델이 답을 줬는데 쓸 본문이 없던 경우는 다시 걸어도 같습니다. 같은 입력을
    // 그대로 다시 넣는 것이니까요. 네트워크가 흔들린 것과 갈라서 알려줍니다.
    // 우리가 분류한 것만 믿습니다. 여기까지 온 그 밖의 예외(네트워크·timeout)는
    // 다시 걸어볼 만한 것으로 봅니다.
    return { ok: false, reason, retryable: error instanceof GeminiCallError ? error.retryable : true };
  }
}

/**
 * 최종 요청 본문은 서버가 만듭니다.
 *
 * 앱에서 받는 것은 재료(프롬프트·이미지)뿐입니다. 모델과 생성 설정을 앱이 정하게
 * 두면 번들을 뜯어 더 비싼 모델로 바꿔 부를 수 있고, 그러면 상한도 원가 계산도
 * 무의미해집니다. 키를 숨기는 것만으로는 막히지 않는 구멍입니다.
 */
async function callGemini(prompt: string, imageBase64: string | undefined, schema: unknown) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const parts = imageBase64
    ? [{ text: prompt }, { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } }]
    : [{ text: prompt }];

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: schema,
        // 모델은 기본적으로 '사고' 토큰을 쓰는데, 짧은 입력에도 2000토큰이 넘게
        // 소모돼 할당량을 빠르게 갉아먹습니다. 이 작업은 추출/요약이라 필요 없습니다.
        // 주의: 일부 모델은 0을 거부합니다(HTTP 400). 모델을 올릴 때 같이 확인해야 합니다.
        thinkingConfig: { thinkingBudget: GEMINI_THINKING_BUDGET },
      },
    }),
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    console.error('[generate] Gemini HTTP 실패', {
      status: response.status,
      model: GEMINI_MODEL,
      body: errorBody.slice(0, 500),
    });
    throw new GeminiCallError(
      `Gemini HTTP ${response.status}: ${errorBody.slice(0, 300)}`,
      isRetryableHttpStatus(response.status)
    );
  }

  const payload = await response.json();
  const candidate = payload?.candidates?.[0];

  // parts를 전부 훑습니다.
  //
  // 첫 조각만 읽고 있었습니다. 응답은 조각이 여럿일 수 있고, 그중에는 모델이 생각한
  // 흔적(thought)도 섞입니다. 최종 답이 두 번째 조각에 있으면 멀쩡한 응답을
  // '본문 없음'으로 오판하게 됩니다. 지금은 thinkingBudget이 0이라 잘 안 생기겠지만,
  // 원인을 가리려고 넣는 진단이 그 오판 위에 서 있으면 답이 어긋납니다.
  const responseParts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
  const text = responseParts
    .filter((part: { thought?: boolean; text?: unknown }) => !part?.thought && typeof part?.text === 'string')
    .map((part: { text: string }) => part.text)
    .join('')
    .trim();

  if (!text) {
    // 왜 본문이 없는지는 응답에 적혀 있습니다. 전에는 그걸 버리고 "본문이 없습니다"
    // 한 마디만 남겨서, 로그를 봐도 서버·앱 어디에서도 원인을 알 수 없었습니다.
    // 상한에 걸린 것인지, 모델이 거부한 것인지, 원문 복제로 판단한 것인지가
    // 전부 다른 문제인데 한 문장으로 뭉개고 있었습니다.
    const finishReason = candidate?.finishReason ?? 'UNKNOWN';
    const blockReason = payload?.promptFeedback?.blockReason;

    // 모델명과 생성 설정도 같이 남깁니다. secret 값은 콘솔에서 다시 못 읽는데,
    // "어떤 모델이 어떤 설정으로 이렇게 답했나"를 모르면 원인을 좁힐 수 없습니다.
    console.error('[generate] Gemini가 본문을 주지 않았습니다.', {
      build: BUILD,
      model: GEMINI_MODEL,
      thinkingBudget: GEMINI_THINKING_BUDGET,
      promptChars: prompt.length,
      finishReason,
      blockReason,
      usage: payload?.usageMetadata,
      // 입력이 차단되면 candidate 자체가 없습니다. 그래서 candidate.safetyRatings는
      // **정작 필요한 그 순간에만** 비어 있습니다. 실제로 첫 진단에서 undefined가
      // 찍혔습니다. 차단 사유가 담기는 자리는 promptFeedback 쪽입니다.
      promptSafety: payload?.promptFeedback?.safetyRatings,
      candidateSafety: candidate?.safetyRatings,
      partKinds: responseParts.map((part: { thought?: boolean; text?: unknown }) => ({
        thought: Boolean(part?.thought),
        hasText: typeof part?.text === 'string',
      })),
    });

    // 모델이 답은 했는데 쓸 것을 안 줬습니다. 같은 입력을 다시 넣어봐야 같습니다.
    throw new GeminiCallError(describeMissingText(finishReason, blockReason), false);
  }

  // 여기서 파싱해 둡니다. 저장되는 것도, 다음에 캐시로 돌려주는 것도 같은 모양이어야
  // 앱이 '새로 받은 것'과 '받아둔 것'을 구별하지 않고 쓸 수 있습니다.
  try {
    return JSON.parse(text);
  } catch {
    // 스키마를 줬는데도 JSON이 아니면 다시 걸어도 같은 모양이 옵니다.
    throw new GeminiCallError('Gemini 응답이 JSON이 아닙니다.', false);
  }
}

/**
 * 없으면 시작할 때 터뜨립니다.
 *
 * `Deno.env.get(...)!`는 타입 검사만 속이고 실행 중에는 undefined가 그대로 흘러갑니다.
 * 실제로 GEMINI_MODEL을 빠뜨린 채 배포했더니 models/undefined로 요청이 나가,
 * 구글이 '그런 모델 없다'고 404를 줬습니다. 설정이 빠진 것이 호출 실패로 보여서,
 * 응답만 보고는 어디가 문제인지 알 수 없었습니다.
 */
function textFromEnv(name: string) {
  const raw = Deno.env.get(name);

  if (!raw) {
    throw new Error(`환경변수 ${name}이 없습니다.`);
  }

  return raw;
}

function numberFromEnv(name: string, fallback?: number) {
  const raw = Deno.env.get(name);

  if (raw === undefined || raw === '') {
    if (fallback !== undefined) return fallback;
    // 여기서 터뜨립니다. 값이 없으면 NaN이 그대로 게이트로 흘러가 '상한에 걸렸다'는
    // 정상 응답으로 둔갑합니다. 설정이 빠진 것과 상한에 닿은 것은 완전히 다른 일입니다.
    throw new Error(`환경변수 ${name}이 없습니다.`);
  }

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`환경변수 ${name}이 숫자가 아닙니다: ${raw}`);
  }

  return value;
}

/**
 * 어느 판이 응답했는지 표시합니다.
 *
 * 배포한 뒤에도 옛 인스턴스가 살아남아 옛 환경변수를 들고 응답하는 일이 있었습니다.
 * 설정을 고쳤는데 왜 그대로인지 응답만 봐서는 알 수 없어 한참 헤맸습니다.
 */
const BUILD = '2026-09-21-2';

function json(status: number, body: unknown) {
  return new Response(JSON.stringify({ ...(body as object), build: BUILD }), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
