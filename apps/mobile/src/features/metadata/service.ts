/**
 * ============================================================================
 * [STRUCTURED AI PROMPT DESIGN GUIDE FOR ENTITY EXTRACTION]
 * ============================================================================
 * 지식 요약 시, 단순 텍스트 요약 수준을 넘어 도메인(요리, 운동, 여행)별로 엔티티를 정밀하게
 * 추출하기 위한 Apple Intelligence / Gemini Nano 온디바이스 및 클라우드 AI 연동 시스템 프롬프트 가이드라인입니다.
 * 
 * 1. 시스템 역할 정의 (System Persona)
 *    "너는 입력된 원문 링크 및 텍스트 지식에서 핵심적인 정보만을 고도로 구조화된 형태로
 *     파싱 및 축약하는 럭셔리 지식 정리 에이전트이다."
 * 
 * 2. 카테고리별 엔티티 추출 지침 (Entity Extraction Guidelines)
 *    - [요리 레시피 (recipe)]
 *      - ingredients (재료 목록): 사용자가 검색하기 좋게 ['감자', '양파', '베이컨']과 같은 정제된 명사 단일어로 된 1차원 string 배열 형태로만 반드시 반환할 것. ('약간', '한 꼬집' 등 불필요 수식어 제거)
 *      - cookTime (조리시간): 텍스트에서 명시된 시간을 발췌할 것. (예: '20분')
 *      - difficulty (난이도): 조리 난이도를 '쉬움', '보통', '어려움' 중 하나로 분류할 것.
 * 
 *    - [홈 트레이닝/운동 (workout)]
 *      - targetMuscles (타겟 부위): ['하체', '허벅지', '둔근'] 등 명사 배열 형태로 추출.
 *      - equipments (필요 도구): ['맨몸', '덤벨', '밴드'] 등으로 정밀 발췌.
 *      - routine (세부 루틴): 루틴별 종목과 권장 세트수를 쪼개어 배열 형태로 구조화할 것.
 * 
 *    - [여행/호캉스 (travel)]
 *      - travelTheme (여행 테마칩): '국내' 또는 '해외' + ' / ' + 테마 한 단어. 예: '국내 / 호캉스', '해외 / 배낭여행'.
 *      - location (정확한 위치): 도, 시, 군, 구 또는 숙소명 등을 발췌.
 *      - budget (숙박 예산): 1박 기준 혹은 총 예상 예산 정보를 명확하게 발췌.
 *      - highlights (핵심 명소/스팟): ['오션뷰 인피니티풀', '강문해변 솔밭 숲길'] 등 발췌.
 *      - checklist (준비물/예약 리스트): ['여권', '스파 이용권', '선크림', '기차표'] 등 준비가 필요한 리스트 발췌.
 * 
 * 3. 출력 포맷 규격 (Output Schema Verification)
 *    - 반드시 JSON Schema 형식을 준수하여 raw string 형태로 JSON만 반환하도록 유도합니다.
 *    - 에러 핸들러 및 JSON Parse 검증을 통과해야 하므로 불필요한 마크다운 백틱 (```json) 수식어 출력을 제한할 것.
 * ============================================================================
 */

import { ItemMetadataPatch } from '@/features/items/types';
import { getHostname } from '@/features/items/fallback';
import { classifySourceType } from '@/features/capture/normalizeSharedInput';


type MetadataResult = {
  sourceUrl: string;
  title: string;
  summary: string;
  /** 구조화 데이터(JSON). facet 추출의 원천 */
  content: string;
  /** 긁어온 본문 원문. 화면에는 안 쓰고 검색·재추출용으로 보관 */
  contentText: string | null;
  /** 읽기 좋게 재구성한 정리본. 상세 화면의 본문 */
  digest: string | null;
  /** AI 보강 실패 사유 */
  aiError: string | null;
  thumbnailUrl: string | null;
  sourceType: string;
};

type YouTubeOEmbedResponse = {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
};

/**
 * 제목 길이 상한.
 *
 * 인스타그램 og:title은 '<계정> on Instagram: "<캡션 전체>"' 형태라 700자가 넘습니다.
 * 목록에서 훑어보라고 있는 자리에 본문을 통째로 넣을 수는 없습니다.
 */
const MAX_TITLE_LENGTH = 60;

/**
 * 화면에 올릴 제목을 정합니다.
 *
 * AI가 지어준 제목이 가장 좋지만, 실패했다고 해서 캡션 전체를 제목이라고
 * 내놓을 수는 없습니다. 그럴 때는 본문 첫 줄에서 뽑고, 그마저 없으면
 * 원래 제목을 잘라서라도 길이는 지킵니다.
 */
function resolveTitle(title: string, content: string | null, sourceUrl: string): string {
  if (!isUninformativeTitle(title, sourceUrl)) {
    return clampTitle(title);
  }

  const derived = deriveTitleFromContent(content);
  return clampTitle(derived || title);
}

function clampTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length <= MAX_TITLE_LENGTH) {
    return trimmed;
  }

  return `${trimmed.slice(0, MAX_TITLE_LENGTH).trimEnd()}…`;
}

/** 본문 첫 줄을 제목으로 씁니다. 대개 무엇에 관한 글인지는 첫 줄이 말해줍니다. */
function deriveTitleFromContent(content: string | null): string | null {
  if (!content) {
    return null;
  }

  const firstMeaningfulLine = content
    .split('\n')
    .map((line) => line.replace(/[#*`>]/g, '').trim())
    .find((line) => line.replace(/[^가-힣a-zA-Z0-9]/g, '').length >= 3);

  return firstMeaningfulLine ?? null;
}

export async function fetchMetadataPatch(
  sourceUrl: string,
  referenceDate?: string
): Promise<ItemMetadataPatch> {
  const updatedAt = new Date().toISOString();

  try {
    const normalizedSourceUrl = normalizeSourceUrl(sourceUrl);
    const metadata = isYouTubeUrl(normalizedSourceUrl)
      ? await fetchYouTubeMetadata(normalizedSourceUrl)
      : await fetchGenericMetadata(normalizedSourceUrl, referenceDate);

    return {
      sourceUrl: metadata.sourceUrl,
      // 경로가 여럿(YouTube·Jina·og 태그)이라 각자 자르게 두면 반드시 빠뜨립니다.
      // patch를 만드는 이 한 곳에서 정리합니다.
      title: resolveTitle(metadata.title, metadata.contentText ?? metadata.summary, metadata.sourceUrl),
      summary: metadata.summary,
      content: metadata.content,
      contentText: metadata.contentText,
      digest: metadata.digest,
      aiError: metadata.aiError,
      thumbnailUrl: metadata.thumbnailUrl,
      sourceType: metadata.sourceType,
      // 페이지는 긁었지만 AI 요약이 실패했으면 '완료'가 아닙니다.
      // 텍스트 경로는 이미 failed로 남기는데 여기만 항상 completed였습니다.
      // 그 탓에 화면에는 '정리 완료'가 뜨고 실패 사유 박스는 가려져,
      // 요약이 왜 원문 그대로인지 알 방법이 없었습니다.
      aiStatus: metadata.aiError ? 'failed' : 'completed',
      updatedAt,
    };
  } catch (error) {
    // 메타데이터 수집 실패는 에러가 아닙니다. (AI Functional Spec §7)
    //
    // 중요: 여기서 title/summary/content를 채워 반환하면 안 됩니다.
    // 이 patch는 기존 아이템에 그대로 덮어써지므로, 재시도가 네트워크 문제로 실패했을 때
    // 사용자가 이미 갖고 있던 본문과 요약을 지워버리게 됩니다.
    // 실패했을 때 할 일은 "상태만 기록하고 기존 데이터는 그대로 두는 것"뿐입니다.
    console.warn('[MetadataService] 메타데이터 수집 실패. 기존 데이터를 유지합니다.', error);

    return {
      aiStatus: 'failed',
      updatedAt,
    };
  }
}


/**
 * 링크 없이 저장된 텍스트(주로 인스타 DM 원문)를 보강합니다.
 *
 * 지금까지 텍스트 아이템은 AI를 전혀 거치지 않아 제목이 '메모: 앞 20자...'로 남고
 * 재료나 지역도 추출되지 않았습니다. DM이 주 유입 경로인데 정작 DM 내용이
 * 냉장고 털기나 조합 검색에 잡히지 않았다는 뜻입니다.
 *
 * 링크와 달리 원문이 곧 본문이므로 contentText는 채우지 않습니다.
 * 원문은 이미 rawInput에 온전히 남아 있습니다.
 */
/**
 * 조각 여러 개를 AI에 넘길 하나의 본문으로 엮습니다.
 *
 * 경계를 표시해야 모델이 '같은 대상에 대한 서로 다른 출처'로 읽습니다.
 * 그냥 이어 붙이면 한 글로 보고 앞뒤가 안 맞는 부분을 억지로 꿰맞춥니다.
 *
 * 짧은 조각이 긴 조각에 밀려 잘리지 않도록, 조각마다 같은 몫을 주되
 * 그보다 짧으면 통째로 넣고 남은 몫은 다른 조각이 씁니다. 릴스 본문은 길고
 * DM은 짧은데, DM에 제품명과 가격이 들어 있는 것이 이 기능의 요점입니다.
 */
export function composeSourcesForAI(
  sources: Array<{ kind: string; sourceUrl: string | null; rawText: string | null }>
): string {
  const usable = sources.filter((source) => (source.rawText ?? '').trim().length > 0);
  if (usable.length === 0) return '';
  if (usable.length === 1) {
    return (usable[0].rawText ?? '').slice(0, MAX_CONTENT_CHARS);
  }

  // 짧은 조각부터 채워야 남는 몫이 긴 조각으로 흘러갑니다.
  const ordered = [...usable].sort(
    (a, b) => (a.rawText ?? '').length - (b.rawText ?? '').length
  );

  const texts = new Map<typeof usable[number], string>();
  let remaining = MAX_CONTENT_CHARS;
  let left = ordered.length;

  for (const source of ordered) {
    const share = Math.floor(remaining / left);
    const text = (source.rawText ?? '').trim();
    const taken = text.length <= share ? text : `${text.slice(0, share)}...`;
    texts.set(source, taken);
    remaining -= taken.length;
    left -= 1;
  }

  // 출력은 원래 순서대로. 시간 순서가 곧 정보가 쌓인 순서입니다.
  return usable
    .map((source, index) => {
      const header = [`[SOURCE ${index + 1}] type: ${source.kind}`];
      if (source.sourceUrl) header.push(`url: ${source.sourceUrl}`);
      return `${header.join('\n')}\n${texts.get(source) ?? ''}`;
    })
    .join('\n\n');
}

export async function fetchTextMetadataPatch(
  rawText: string,
  referenceDate?: string
): Promise<ItemMetadataPatch> {
  const updatedAt = new Date().toISOString();

  const trimmed = rawText.trim();
  if (!trimmed) {
    return { aiStatus: 'failed', updatedAt };
  }

  const result = await callGeminiApi('', trimmed, undefined, referenceDate);

  if (!result.ok) {
    // API 키가 없거나 호출에 실패한 경우. 원문에서 발췌한 정리본만이라도 붙입니다.
    //
    // 발췌가 성공해도 상태는 'failed'입니다. AI 요약은 실제로 실패했고,
    // 이걸 'completed'로 적으면 화면에 '정리 완료'가 떠서 사용자가 원인을 알 수 없습니다.
    // 상태를 정직하게 남겨야 재분석을 눌러볼 수 있습니다. (AI Functional Spec §7)
    const digest = buildExcerptDigest(trimmed);
    return {
      ...(digest ? { digest } : null),
      aiStatus: 'failed',
      aiError: result.reason,
      updatedAt,
    };
  }

  const aiResponse = result.data;
  const {
    title: aiTitle,
    summary: aiSummary,
    detailedAnalysis,
    ...structuredFields
  } = aiResponse;

  const structuredContent = JSON.stringify({
    category: aiResponse.category || 'text',
    ...structuredFields,
  });

  return {
    ...(typeof aiTitle === 'string' && aiTitle.trim() ? { title: aiTitle.trim() } : null),
    ...(typeof aiSummary === 'string' && aiSummary.trim() ? { summary: aiSummary.trim() } : null),
    content: structuredContent,
    digest:
      typeof detailedAnalysis === 'string' && detailedAnalysis.trim()
        ? detailedAnalysis
        : buildExcerptDigest(trimmed),
    aiStatus: 'completed',
    aiError: null,
    updatedAt,
  };
}

/**
 * 스크린샷 등 이미지에서 정보를 추출합니다.
 *
 * OCR로 글자만 뽑아 다시 파싱하는 2단계 대신, 이미지를 그대로 넘겨
 * 구조화 결과까지 한 번에 받습니다. 화면 배치까지 모델이 보기 때문에
 * 텍스트만 넘길 때보다 결과가 낫습니다.
 *
 * 이미지 토큰은 크기와 무관하게 258로 고정이라, 링크 한 건을 처리할 때와
 * 비용이 다르지 않습니다.
 */
export async function fetchImageMetadataPatch(
  base64Image: string,
  referenceDate?: string
): Promise<ItemMetadataPatch> {
  const updatedAt = new Date().toISOString();

  if (!base64Image) {
    return { aiStatus: 'failed', aiError: '이미지를 읽지 못했습니다.', updatedAt };
  }

  const result = await callGeminiApi('', '', base64Image, referenceDate);

  if (!result.ok) {
    return { aiStatus: 'failed', aiError: result.reason, updatedAt };
  }

  const aiResponse = result.data;
  const {
    title: aiTitle,
    summary: aiSummary,
    detailedAnalysis,
    ...structuredFields
  } = aiResponse;

  const structuredContent = JSON.stringify({
    category: aiResponse.category || 'web',
    ...structuredFields,
  });

  return {
    ...(typeof aiTitle === 'string' && aiTitle.trim() ? { title: aiTitle.trim() } : null),
    ...(typeof aiSummary === 'string' && aiSummary.trim() ? { summary: aiSummary.trim() } : null),
    content: structuredContent,
    // 이미지에서 읽어낸 글자를 본문으로 보관합니다. 검색과 재추출의 근거가 됩니다.
    contentText: typeof aiResponse.extractedText === 'string' ? aiResponse.extractedText : null,
    digest: typeof detailedAnalysis === 'string' && detailedAnalysis.trim() ? detailedAnalysis : null,
    aiStatus: 'completed',
    aiError: null,
    updatedAt,
  };
}

/**
 * 제목이 내용을 말해주지 않는 경우를 가려냅니다.
 *
 * 인스타그램은 og:title이 항상 계정 이름입니다.
 *   'Instagram의 이진 | 미소맘❥지니 🧞‍♂️여행★티켓'
 * 이건 무엇에 관한 글인지 전혀 알려주지 않아서, 목록에서 훑을 때 쓸모가 없습니다.
 */
function isUninformativeTitle(title: string, sourceUrl: string): boolean {
  const trimmed = title.trim();
  if (!trimmed) return true;

  // 인스타그램: 'Instagram의 OOO', 'OOO on Instagram', '... | Instagram'
  if (/(^instagram|on instagram|\|\s*instagram)/i.test(trimmed)) return true;

  // 노션 기본 문구
  if (/where teams and agents work together/i.test(trimmed)) return true;
  if (trimmed.toLowerCase() === 'notion') return true;

  // 호스트명만 있는 경우
  try {
    const host = getHostname(sourceUrl);
    if (host && trimmed.toLowerCase().replace(/\s/g, '') === host.toLowerCase()) return true;
  } catch {}

  // 한글·영문·숫자가 거의 없이 장식 문자와 이모지로만 이뤄진 제목
  const meaningful = trimmed.replace(/[^가-힣a-zA-Z0-9]/g, '');
  if (meaningful.length < 3) return true;

  return false;
}

function normalizeSourceUrl(input: string) {
  const url = new URL(input);

  if (isYouTubeHost(url.hostname)) {
    return normalizeYouTubeUrl(url).toString();
  }

  if (isInstagramHost(url.hostname)) {
    url.hostname = 'www.instagram.com';
    stripTrackingParams(url);
    return url.toString();
  }

  stripTrackingParams(url);
  return url.toString();
}

async function fetchYouTubeMetadata(sourceUrl: string): Promise<MetadataResult> {
  const oEmbedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(sourceUrl)}&format=json`;
  const oEmbedResponse = await fetchWithTimeout(oEmbedUrl, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!oEmbedResponse.ok) {
    throw new Error('youtube oembed failed');
  }

  const oEmbed = (await oEmbedResponse.json()) as YouTubeOEmbedResponse;
  const htmlMetadata = await tryFetchHtmlMetadata(sourceUrl);
  const sanitizedAuthorName = sanitizeText(oEmbed.author_name ?? '');
  const title = pickFirstMeaningful([
    sanitizeText(oEmbed.title ?? ''),
    htmlMetadata?.title ?? '',
    '유튜브 링크',
  ]);
  const summary = pickFirstMeaningful([
    htmlMetadata?.summary ?? '',
    sanitizedAuthorName
      ? `${sanitizedAuthorName} 유튜브 링크를 저장했습니다.`
      : '',
    '유튜브 링크를 저장했습니다.',
  ]);
  const thumbnailUrl = pickFirstMeaningfulUrl([
    htmlMetadata?.thumbnailUrl ?? null,
    oEmbed.thumbnail_url ?? null,
    buildYouTubeThumbnailUrl(sourceUrl),
  ]);

  // 임시 기본 JSON 구조화 처리
  const structuredContent = JSON.stringify({
    category: 'web',
    description: summary,
  });

  return {
    sourceUrl,
    title,
    summary,
    content: structuredContent,
    // 유튜브는 oEmbed 메타데이터만 얻으므로 별도로 보관할 본문이 없습니다.
    contentText: null,
    digest: null,
    aiError: null,
    thumbnailUrl,
    sourceType: 'youtube',
  };
}

/**
 * 조각 본문을 긁을 때의 시한과 시도 횟수.
 *
 * 노션처럼 무거운 페이지는 Jina가 렌더링하는 데 시간이 걸립니다. 실측으로 첫
 * 요청이 8초쯤 걸렸고, 폰에서는 20초에 끊겨 본문을 통째로 놓쳤습니다.
 * 넉넉히 잡고, 첫 연결이 물리는 경우를 위해 한 번 더 겁니다.
 */
const SOURCE_FETCH_TIMEOUT_MS = 30000;
const SOURCE_FETCH_ATTEMPTS = 2;

/**
 * 링크에서 본문만 긁어옵니다. AI는 부르지 않습니다.
 *
 * 조각으로 붙인 링크는 주소만 있고 본문이 없습니다. 그대로 두면 AI에게
 * "https://..." 한 줄만 건네게 되어, 모델이 "분석할 내용이 없다"고 답합니다.
 * 실제로 릴스에 노션 링크를 붙였더니 제목이 '정보 없음'이 됐습니다.
 *
 * 종합할 때 쓸 재료라 요약도 분류도 필요 없습니다. 글만 있으면 됩니다.
 */
export async function fetchSourceBodyText(sourceUrl: string): Promise<string | null> {
  let normalized = sourceUrl;
  try {
    normalized = normalizeSourceUrl(sourceUrl);
  } catch {
    return null;
  }

  // 폰에서는 첫 연결이 통째로 물리는 일이 잦습니다. 한 번 끊고 다시 걸면
  // 대개 곧바로 붙습니다. 재시도가 없으면 그 한 번으로 본문을 포기하게 되는데,
  // 조각의 본문이 없으면 종합할 재료 자체가 사라집니다.
  for (let attempt = 1; attempt <= SOURCE_FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchWithTimeout(
        `https://r.jina.ai/${normalized}`,
        { headers: { Accept: 'application/json' } },
        SOURCE_FETCH_TIMEOUT_MS
      );
      if (response.ok) {
        const json = await response.json();
        const body = decodeHtmlEntities(json?.data?.content || '').trim();
        if (body) return body;
      }
      break;
    } catch (error) {
      if (attempt < SOURCE_FETCH_ATTEMPTS) {
        console.log(`[MetadataService] 조각 본문 수집 재시도 (${attempt}/${SOURCE_FETCH_ATTEMPTS}):`, error);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      console.log('[MetadataService] 조각 본문 수집 실패, og 태그로 폴백합니다.', error);
    }
  }

  // Jina가 막히면 og 태그라도 씁니다. 인스타는 캡션이 description에 들어 있습니다.
  try {
    const html = await fetchHtmlMetadata(normalized);
    const caption = isInstagramHost(new URL(normalized).hostname)
      ? extractInstagramCaption(html.rawDescription)
      : null;
    const fallback = (caption || html.summary || '').trim();
    return fallback || null;
  } catch {
    return null;
  }
}

async function fetchGenericMetadata(
  sourceUrl: string,
  referenceDate?: string
): Promise<MetadataResult> {
  const jinaUrl = `https://r.jina.ai/${sourceUrl}`;
  try {
    console.log(`[MetadataService] Jina Reader API를 통해 콘텐츠를 렌더링 및 파싱합니다. URL: ${jinaUrl}`);
    // Jina AI Reader API를 통해 렌더링된 온전한 마크다운 및 메타데이터를 JSON 형태로 받아옵니다.
    const response = await fetchWithTimeout(jinaUrl, {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (response.ok) {
      const json = await response.json();
      if (json && json.data) {
        // Jina가 돌려주는 값에도 엔티티가 섞여 옵니다. 저장 전에 풀어둡니다.
        let title = sanitizeText(json.data.title || '') || `${getHostname(sourceUrl)} 저장 링크`;
        // 본문은 sanitizeText를 쓰지 않습니다. 공백을 뭉개면 마크다운 구조가 사라집니다.
        const rawContent = decodeHtmlEntities(json.data.content || '');
        
        // Notion 등 기본 타이틀이 무의미한 고정 문구일 경우 본문 첫 줄 또는 핵심 요소를 추출해 제목으로 승격시킵니다.
        const isGenericNotionTitle = title.includes('Where teams and agents work together') || title.toLowerCase() === 'notion';
        if (isGenericNotionTitle && rawContent) {
          const lines = rawContent.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0);
          if (lines.length > 0) {
            const firstLine = lines[0].replace(/[#*`]/g, ''); // 마크다운 표식 제거
            if (firstLine.length >= 2) {
              title = firstLine.slice(0, 32);
            }
          }
        }


        // 대표 썸네일로 활용할 이미지 추출 (마크다운 이미지 태그 ![desc](url) 정규식으로 첫 번째 이미지 파싱)
        let thumbnailUrl: string | null = null;
        const imgRegex = /!\[.*?\]\((https?:\/\/.*?)\)/;
        const imgMatch = rawContent.match(imgRegex);
        if (imgMatch && imgMatch[1]) {
          thumbnailUrl = imgMatch[1];
        }

        // Notion의 기본 메타 이미지(default.png 등 무의미한 로고) 방어막 작동
        const isGenericNotionImage = thumbnailUrl && (thumbnailUrl.includes('notion.so/images') || thumbnailUrl.includes('meta/default.png') || thumbnailUrl.includes('logo-ios.png'));
        if (!thumbnailUrl || isGenericNotionImage) {
          const lowerContent = rawContent.toLowerCase();
          if (lowerContent.includes('기저귀') || lowerContent.includes('분유') || lowerContent.includes('육아') || lowerContent.includes('아동')) {
            thumbnailUrl = "https://images.unsplash.com/photo-1555252333-9f8e92e65df9?w=800"; // 포근한 육아 이미지
          } else if (lowerContent.includes('지원금') || lowerContent.includes('바우처') || lowerContent.includes('예산') || lowerContent.includes('소득')) {
            thumbnailUrl = "https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=800"; // 금융/성장/돈 이미지
          } else {
            thumbnailUrl = "https://images.unsplash.com/photo-1488590528505-98d2b5aba04b?w=800"; // 기본 쾌적한 뷰
          }
        }

        const sourceType = classifySourceType(sourceUrl, rawContent);

        let summary = '';
        let parsedStructure: any = null;
        let aiError: string | null = null;

        // 1. 진짜 AI 요약 API 호출 시도
        const aiResult = await callGeminiApi(title, rawContent, undefined, referenceDate);
        if (aiResult.ok) {
          console.log('[MetadataService] Gemini API를 활용한 실제 AI 요약 및 구조화 파싱에 성공했습니다.');
          summary = aiResult.data.summary;
          parsedStructure = aiResult.data;

          // 페이지 제목이 내용을 말해주지 않을 때만 AI 제목으로 바꿉니다.
          // 잘 쓰인 기사 제목은 AI가 새로 지은 것보다 대개 낫기 때문에 무조건 덮지 않습니다.
          const aiTitle =
            typeof aiResult.data.title === 'string' ? aiResult.data.title.trim() : '';
          if (aiTitle && isUninformativeTitle(title, sourceUrl)) {
            title = aiTitle;
          }
        } else {
          aiError = aiResult.reason;
          // 2. API Key 환경변수가 없거나 에러 발생 시, 로컬 지능형 요약기 및 파서로 폴백
          console.log('[MetadataService] 로컬 지능형 요약기 및 본문 파서를 구동합니다.');
          summary = buildExcerptSummary(title, rawContent);
          parsedStructure = {
            ...parseStructuredFromContent(rawContent, sourceType),
            detailedAnalysis: buildExcerptDigest(rawContent),
          };
        }

        // content에는 구조화 데이터만 담습니다.
        // 본문은 contentText로, 정리본은 digest로 각각 분리해 보관합니다.
        // 원본과 파생물을 같은 칸에 섞어두면 AI를 다시 돌릴 때 본문까지 덮어쓰게 됩니다.
        // summary와 detailedAnalysis는 각자 전용 컬럼이 있으므로 구조화 데이터에서 제외합니다.
        const { detailedAnalysis, summary: _summary, ...structuredFields } = parsedStructure ?? {};
        const structuredContent = JSON.stringify({
          category: parsedStructure?.category || sourceType,
          ...structuredFields,
        });

        console.log(`[MetadataService] Jina 파싱 성공. 제목: "${title}", 썸네일 획득 여부: ${Boolean(thumbnailUrl)}`);

        return {
          sourceUrl: sourceUrl,
          title,
          summary,
          content: structuredContent,
          aiError,
          contentText: rawContent || null,
          digest: typeof detailedAnalysis === 'string' && detailedAnalysis.trim()
            ? detailedAnalysis
            : null,
          thumbnailUrl,
          sourceType,
        };
      }
    }
  } catch (jinaError) {
    console.warn('[MetadataService] Jina Reader API 파싱 실패. 일반 스크랩으로 폴백합니다.', jinaError);
  }

  // Jina 호출 실패 시 기존의 단순 HTML og tag 크롤러로 폴백
  console.log('[MetadataService] 로컬 기본 HTML 메타데이터 크롤러 작동 시작');
  const htmlMetadata = await fetchHtmlMetadata(sourceUrl);
  const instagramCaption = isInstagramHost(new URL(sourceUrl).hostname)
    ? extractInstagramCaption(htmlMetadata.rawDescription)
    : null;
  const sourceText = instagramCaption || htmlMetadata.summary;
  const sourceType = classifySourceType(sourceUrl, sourceText);

  // Jina가 Instagram 접근을 일시적으로 막더라도 Instagram 페이지 자체의
  // description 메타태그에는 캡션이 (개행까지 포함해) 들어 있습니다.
  // 예전에는 sanitizeText()로 그 개행을 모두 뭉갠 뒤 summary에만 넣어서,
  // 원문도 사라지고 그 통짜 문자열이 AI 요약처럼 보였습니다.
  if (instagramCaption) {
    const aiResult = await callGeminiApi(htmlMetadata.title, instagramCaption, undefined, referenceDate);
    let title = htmlMetadata.title;
    let summary = buildExcerptSummary(title, instagramCaption);
    let parsedStructure: any = {
      ...parseStructuredFromContent(instagramCaption, sourceType),
      detailedAnalysis: buildExcerptDigest(instagramCaption),
    };
    let aiError: string | null = null;

    if (aiResult.ok) {
      summary = aiResult.data.summary;
      parsedStructure = aiResult.data;

      const aiTitle =
        typeof aiResult.data.title === 'string' ? aiResult.data.title.trim() : '';
      if (aiTitle && isUninformativeTitle(title, sourceUrl)) {
        title = aiTitle;
      }
    } else {
      aiError = aiResult.reason;
    }

    const { detailedAnalysis, summary: _summary, ...structuredFields } = parsedStructure ?? {};

    return {
      sourceUrl: htmlMetadata.sourceUrl ?? sourceUrl,
      title,
      summary,
      content: JSON.stringify({
        category: parsedStructure?.category || sourceType,
        ...structuredFields,
      }),
      contentText: instagramCaption,
      digest:
        typeof detailedAnalysis === 'string' && detailedAnalysis.trim()
          ? detailedAnalysis
          : null,
      aiError,
      thumbnailUrl: htmlMetadata.thumbnailUrl,
      sourceType,
    };
  }


  const structuredContent = JSON.stringify({
    category: sourceType,
  });

  return {
    sourceUrl: htmlMetadata.sourceUrl ?? sourceUrl,
    title: htmlMetadata.title,
    summary: htmlMetadata.summary,
    content: structuredContent,
    // og 태그만 읽은 경우라 본문이랄 게 없습니다. 요약 이상은 보관하지 않습니다.
    contentText: null,
    digest: null,
    aiError: null,
    thumbnailUrl: htmlMetadata.thumbnailUrl,
    sourceType,
  };
}



async function tryFetchHtmlMetadata(sourceUrl: string) {
  try {
    return await fetchHtmlMetadata(sourceUrl);
  } catch {
    return null;
  }
}

async function fetchHtmlMetadata(sourceUrl: string) {
  const response = await fetchWithTimeout(sourceUrl, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8',
    },
  });

  if (!response.ok) {
    throw new Error('html metadata fetch failed');
  }

  const html = await response.text();
  const canonicalUrl = extractLinkHref(html, 'canonical') ?? sourceUrl;
  const title = pickFirstMeaningful([
    extractMetaContent(html, 'property', 'og:title'),
    extractMetaContent(html, 'name', 'twitter:title'),
    extractTitleTag(html),
    `${getHostname(sourceUrl)} 저장 링크`,
  ]);
  const rawDescription = pickFirstMeaningful([
    extractMetaContentPreservingWhitespace(html, 'property', 'og:description'),
    extractMetaContentPreservingWhitespace(html, 'name', 'description'),
    extractMetaContentPreservingWhitespace(html, 'name', 'twitter:description'),
  ]);
  const summary = pickFirstMeaningful([
    sanitizeText(rawDescription),
    `${getHostname(sourceUrl)} 링크를 저장했습니다.`,
  ]);
  const thumbnailUrl = pickFirstMeaningUrl([
    extractMetaContent(html, 'property', 'og:image'),
    extractMetaContent(html, 'name', 'twitter:image'),
  ]);

  return {
    sourceUrl: canonicalUrl,
    title,
    summary,
    rawDescription,
    thumbnailUrl,
  };
}

async function fetchWithTimeout(
  input: string,
  init?: RequestInit,
  /**
   * Jina AI Reader 등 중량급 헤드리스 브라우저 렌더링(노션 로드 포함)을 고려하여
   * 네트워크 타임아웃 한계를 5초에서 20초로 넉넉하게 잡았습니다.
   */
  timeoutMs = 20000
) {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const startedAt = Date.now();

  try {
    return await fetch(input, {
      ...init,
      redirect: 'follow',
      signal: controller.signal,
    });
  } catch (error) {
    // 중단된 요청은 이유와 상관없이 'Aborted' 한 마디만 남깁니다.
    // 그 문구가 그대로 화면의 실패 사유가 되면 시한이 모자란 건지, 연결이
    // 끊긴 건지, 무엇 하나 알 수 없습니다. 어느 쪽인지와 얼마나 걸렸는지를 남깁니다.
    const elapsed = Date.now() - startedAt;

    if (timedOut) {
      throw new Error(`응답이 없어 ${Math.round(timeoutMs / 1000)}초 만에 끊었습니다.`);
    }

    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${reason} (${elapsed}ms 만에 실패)`);
  } finally {
    clearTimeout(timeoutId);
  }
}


function extractMetaContent(html: string, attribute: 'property' | 'name', key: string) {
  return sanitizeText(extractMetaContentPreservingWhitespace(html, attribute, key));
}

/**
 * 메타태그의 원문 공백과 개행을 보존해 읽습니다.
 *
 * Instagram 캡션은 content 속성 안에 실제 LF를 포함합니다. 제목이나 일반 요약에는
 * 공백 정리가 유용하지만 캡션에 sanitizeText()를 적용하면 문단과 목록이 모두 한 줄로
 * 합쳐지므로, 원문이 필요한 경로는 이 함수를 사용해야 합니다.
 */
function extractMetaContentPreservingWhitespace(
  html: string,
  attribute: 'property' | 'name',
  key: string
) {
  const regex = new RegExp(
    `<meta[^>]+${attribute}=["']${escapeRegExp(key)}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    'i'
  );
  const reverseRegex = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+${attribute}=["']${escapeRegExp(key)}["'][^>]*>`,
    'i'
  );

  return decodeHtmlEntities(html.match(regex)?.[1] ?? html.match(reverseRegex)?.[1] ?? '')
    .replace(/\r\n?/g, '\n')
    .trim();
}

/**
 * Instagram description의 통계/계정/날짜 껍데기에서 실제 캡션만 꺼냅니다.
 *
 * 입력 예:
 *   1,423 likes, 14K comments - kkimmmin - August 11, 2026: "첫 줄\n둘째 줄"
 * 언어나 숫자 표기가 달라도 첫 `: "`와 마지막 따옴표를 경계로 삼습니다.
 */
function extractInstagramCaption(description: string): string | null {
  if (!description) return null;

  const openingQuote = description.search(/:\s*["“]/);
  if (openingQuote === -1) return null;

  const quoted = description.slice(openingQuote).replace(/^:\s*["“]/, '');
  const caption = quoted.replace(/["”]\s*\.?\s*$/, '');
  const normalized = caption
    .replace(/\r\n?/g, '\n')
    // Instagram에서 빈 줄 대신 쓰는 점자 공백은 실제 빈 줄로 취급합니다.
    .replace(/^[\u2800\s]+$/gm, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return normalized || null;
}

function extractLinkHref(html: string, rel: string) {
  const regex = new RegExp(
    `<link[^>]+rel=["']${escapeRegExp(rel)}["'][^>]+href=["']([^"']+)["'][^>]*>`,
    'i'
  );
  const reverseRegex = new RegExp(
    `<link[^>]+href=["']([^"']+)["'][^>]+rel=["']${escapeRegExp(rel)}["'][^>]*>`,
    'i'
  );

  return sanitizeText(html.match(regex)?.[1] ?? html.match(reverseRegex)?.[1] ?? '');
}

function extractTitleTag(html: string) {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return sanitizeText(match?.[1] ?? '');
}

function sanitizeText(value: string) {
  return decodeHtmlEntities(value)
    .replace(/\s+/g, ' ')
    .replace(/\| Instagram$/i, '')
    .replace(/\| YouTube$/i, '')
    .trim();
}

/**
 * HTML 엔티티를 실제 문자로 되돌립니다.
 *
 * 이름 있는 엔티티만 처리하면 한글이 통째로 깨집니다.
 * 인스타그램 릴스 제목은 한글이 &#xc758; 같은 16진수 문자 참조로 넘어오는데,
 * 그걸 그대로 저장하면 화면에도 검색 색인에도 기호가 그대로 남습니다.
 * 숫자 참조(10진수/16진수)를 함께 처리해야 하는 이유입니다.
 */
function decodeHtmlEntities(value: string) {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => safeFromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeFromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    // &amp;는 마지막에 풀어야 &amp;lt; 같은 이중 인코딩이 잘못 해석되지 않습니다.
    .replace(/&amp;/g, '&');
}

/** 잘못된 코드포인트가 들어와도 원문을 잃지 않도록 실패 시 빈 문자열 대신 그대로 둡니다. */
function safeFromCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

function pickFirstMeaningful(values: string[]) {
  return values.find((value) => value.trim().length > 0) ?? '';
}

function pickFirstMeaningfulUrl(values: Array<string | null>) {
  return values.find((value) => Boolean(value && value.trim().length > 0)) ?? null;
}

function pickFirstMeaningUrl(values: string[]) {
  return values.find((value) => value.startsWith('http')) ?? null;
}

function buildYouTubeThumbnailUrl(url: string) {
  const videoId = getYouTubeVideoId(url);
  if (!videoId) {
    return null;
  }

  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function getYouTubeVideoId(urlString: string) {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname.replace(/^www\./, '');

    if (hostname === 'youtu.be') {
      return url.pathname.split('/').filter(Boolean)[0] ?? null;
    }

    if (url.pathname.startsWith('/watch')) {
      return url.searchParams.get('v');
    }

    if (url.pathname.startsWith('/shorts/')) {
      return url.pathname.split('/').filter(Boolean)[1] ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeYouTubeUrl(url: URL) {
  stripTrackingParams(url);

  const videoId = getYouTubeVideoId(url.toString());
  if (!videoId) {
    return url;
  }

  return new URL(`https://www.youtube.com/watch?v=${videoId}`);
}

function stripTrackingParams(url: URL) {
  const removable = ['si', 'feature', 'igsh', 'utm_source', 'utm_medium', 'utm_campaign'];
  removable.forEach((key) => url.searchParams.delete(key));
}

function isYouTubeUrl(url: string) {
  try {
    return isYouTubeHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

function isYouTubeHost(hostname: string) {
  const normalized = hostname.replace(/^www\./, '');
  return normalized === 'youtube.com' || normalized === 'youtu.be' || normalized === 'm.youtube.com';
}

function isInstagramHost(hostname: string) {
  const normalized = hostname.replace(/^www\./, '');
  return normalized === 'instagram.com' || normalized === 'm.instagram.com';
}

// 헬퍼 정규식 이스케이프
function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * API 키가 없거나 Gemini 호출이 실패했을 때 쓰는 정리본 폴백.
 *
 * 원칙: 원문에 없는 내용은 한 글자도 만들어내지 않습니다.
 * 이전 구현은 카테고리별 템플릿으로 "양념 소스 배합(간장, 마늘, 설탕 등 비율)" 같은
 * 조리 단계를 지어냈는데, 원문과 무관한 문장이라 요약이 아니라 창작이었습니다.
 * 레시피에서 지어낸 한 줄은 실제로 요리를 망칠 수 있으므로, 발췌만 합니다.
 */
function buildExcerptDigest(rawContent: string): string | null {
  if (!rawContent || rawContent.trim().length === 0) {
    return null;
  }

  const lines = rawContent.split('\n').map((line) => line.trim());

  // 마크다운 제목은 원문이 스스로 밝힌 구조라 목차로 쓰기 좋습니다.
  const headings = lines
    .filter((line) => /^#{1,4}\s+/.test(line))
    .map((line) => line.replace(/^#+\s+/, '').trim())
    .filter((heading) => heading.length > 1)
    .slice(0, 8);

  // 링크·표·인용 기호가 섞인 줄은 발췌해도 읽기 어려워 제외합니다.
  const paragraphs = lines
    .filter(
      (line) =>
        line.length >= 30 &&
        !/^#{1,4}\s+/.test(line) &&
        !line.includes('http') &&
        !/^[-*|>[\]]/.test(line)
    )
    .slice(0, 4);

  if (headings.length === 0 && paragraphs.length === 0) {
    return null;
  }

  const parts: string[] = ['📌 원문 발췌'];
  parts.push('_AI 정리 없이 원문에서 그대로 추린 내용입니다._');

  if (headings.length > 0) {
    parts.push('\n**원문 구성**');
    parts.push(headings.map((heading) => `- ${heading}`).join('\n'));
  }

  if (paragraphs.length > 0) {
    parts.push('\n**주요 내용**');
    parts.push(
      paragraphs
        .map((paragraph) => `- ${paragraph.slice(0, 200)}${paragraph.length > 200 ? '…' : ''}`)
        .join('\n')
    );
  }

  return parts.join('\n');
}

/**
 * AI 호출 결과. 실패했을 때 "왜"를 함께 돌려줍니다.
 *
 * 이전에는 실패를 전부 null로 뭉개서, 화면에는 요약이 비어 있는데
 * 원인이 키 누락인지 네트워크인지 응답 형식인지 알 방법이 없었습니다.
 * 폰에서 돌아가는 앱이라 콘솔을 열기도 어려워 더 그렇습니다.
 */
export type GeminiResult =
  | { ok: true; data: any }
  | { ok: false; reason: string };

/**
 * 마감일의 연도를 바로잡습니다.
 *
 * 프롬프트로 날짜를 알려줘도 모델이 연도를 잘못 넣는 경우가 있습니다.
 * 원문 어디에도 네 자리 연도가 없는데 결과가 과거 연도라면, 그건 모델이
 * 지어낸 것이므로 기준 날짜의 연도로 맞춥니다.
 *
 * 기준은 '오늘'이 아니라 '저장 시점'입니다. 2026년에 저장한 공구를 2027년에
 * 재분석하면 오늘 기준으로는 2027년으로 밀려버립니다.
 * 원문에 연도가 실제로 적혀 있으면 그건 사실이므로 건드리지 않습니다.
 */
function normalizeDeadlineYear(data: any, sourceText: string, referenceDate: string): any {
  const deadline = typeof data?.deadline === 'string' ? data.deadline.trim() : '';
  const match = deadline.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return data;

  const parsedYear = Number(match[1]);
  const baseYear = new Date(referenceDate).getFullYear();
  if (!Number.isFinite(baseYear)) return data;
  if (parsedYear >= baseYear) return data;

  // 원문에 그 연도가 명시돼 있으면 모델이 읽은 것이므로 존중합니다.
  if (sourceText && new RegExp(`${parsedYear}`).test(sourceText)) return data;

  return { ...data, deadline: `${baseYear}-${match[2]}-${match[3]}` };
}

/**
 * 응답 텍스트에서 "첫 번째 완전한 JSON 객체"만 잘라냅니다.
 *
 * 이전 구현은 첫 '{'부터 마지막 '}'까지를 통째로 잘랐는데, 모델이 객체를 두 개
 * 뱉거나 뒤에 설명을 덧붙이면 두 덩어리가 함께 잡혀 파싱이 깨졌습니다.
 * ("Unexpected non-whitespace character after JSON")
 * 중괄호 깊이를 세되 문자열 리터럴과 이스케이프는 건너뜁니다.
 */
function extractFirstJsonObject(text: string): string | null {
  const cleaned = text.replace(/```json/gi, '').replace(/```/gi, '');
  const start = cleaned.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < cleaned.length; i++) {
    const char = cleaned[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) {
        return cleaned.slice(start, i + 1);
      }
    }
  }

  return null;
}

/**
 * 구조화 출력 스키마. 모델이 형식을 지키도록 API 차원에서 강제해
 * 파싱 실패 자체가 생기지 않게 합니다.
 */
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    detailedAnalysis: { type: 'string' },
    category: {
      type: 'string',
      enum: ['recipe', 'workout', 'travel', 'parenting', 'shopping', 'interior', 'web'],
    },
    cookTime: { type: 'string' },
    difficulty: { type: 'string' },
    ingredients: { type: 'array', items: { type: 'string' } },
    targetMuscles: { type: 'array', items: { type: 'string' } },
    equipments: { type: 'array', items: { type: 'string' } },
    routine: { type: 'array', items: { type: 'string' } },
    travelTheme: { type: 'string' },
    location: { type: 'string' },
    budget: { type: 'string' },
    highlights: { type: 'array', items: { type: 'string' } },
    checklist: { type: 'array', items: { type: 'string' } },
    productType: { type: 'string' },
    seller: { type: 'string' },
    purchaseType: { type: 'string' },
    deadline: { type: 'string' },
    price: { type: 'string' },
    babyAgeMonths: { type: 'string' },
    parentingTopic: { type: 'string' },
    extractedText: { type: 'string' },
    roomType: { type: 'string' },
    interiorStyle: { type: 'string' },
  },
  required: ['title', 'summary', 'detailedAnalysis', 'category'],
};

/**
 * AI에 넘길 본문 길이 상한.
 *
 * 모델 입력 한계는 1,048,576 토큰입니다. 이 값은 한계가 아니라 비용을 묶어두려고
 * 우리가 정한 값입니다. 8,000자가 약 6,166토큰(한계의 0.6%)이라 한참 여유가 있습니다.
 *
 * 조각을 여러 개 붙이면 하나를 넘길 때보다 본문이 길어지는데, 8,000자에 묶어두면
 * 긴 릴스 본문이 앞을 다 먹고 정작 중요한 DM(제품명·가격·링크)이 통째로 잘립니다.
 * 무료 등급 한도는 토큰이 아니라 요청 건수로 세므로 길게 넣어도 한도 소모는
 * 똑같이 1건이고, 늘어나는 건 토큰 비용뿐입니다(8,000자 2.7원 → 24,000자 약 7원).
 */
const MAX_CONTENT_CHARS = 24000;

/**
 * 사용할 모델.
 *
 * 무료 등급의 하루 한도는 모델별로 따로 셉니다(quotaId가 PerProjectPerModel).
 * 이전에 쓰던 gemini-2.5-flash는 하루 20건이라 몇 번 시험하면 동났습니다.
 *
 * 이 모델은 같은 요청 형식을 그대로 받고, 실측 응답이 4.8초에서 2.0초로
 * 빨라졌습니다. 빨라지면 시한 초과로 인한 재시도도 줄어드는데, 실패한 요청도
 * 할당량은 똑같이 먹기 때문에 그 차이가 작지 않습니다.
 */
const GEMINI_MODEL = 'gemini-3.1-flash-lite';

/**
 * Gemini 응답 대기 한계.
 *
 * 성공하는 호출은 실측 5초 안팎입니다. 문제는 폰에서 구글 API로 가는 첫 연결이
 * 종종 통째로 물린다는 것인데, 재시도하면 대개 곧바로 붙습니다.
 * 한계를 길게 잡으면 물릴 때마다 그만큼을 버리고 나서야 재시도합니다.
 * 짧게 끊고 다시 거는 편이 훨씬 빨리 성공합니다.
 */
const GEMINI_TIMEOUT_MS = 12000;

/**
 * 값만 들어와야 하는 분류·발췌 필드들.
 * 검색 facet과 화면의 칩이 이 값들을 그대로 씁니다.
 */
const SHORT_VALUE_FIELDS = [
  'cookTime',
  'difficulty',
  'travelTheme',
  'location',
  'budget',
  'productType',
  'seller',
  'purchaseType',
  'deadline',
  'price',
  'babyAgeMonths',
  'parentingTopic',
  'roomType',
  'interiorStyle',
] as const;

/** 이 길이를 넘는 분류 값은 값이 아니라 모델의 군말입니다. */
const MAX_SHORT_VALUE_LENGTH = 40;

/**
 * 짧아도 값이 아닌 것들.
 *
 * 길이만으로는 못 거릅니다. 레시피 글에 travelTheme으로
 * '국내 / 맛집 탐방에 준함(레시피 관련 없음)'이 들어온 적이 있는데 25자입니다.
 * 값을 적는 대신 왜 그렇게 적었는지, 혹은 해당 없다는 말을 적은 것이라
 * 그대로 두면 레시피 항목에 여행 카드가 뜹니다.
 */
const NON_VALUE_MARKERS = [
  '해당 없',
  '관련 없',
  '정보 없',
  '알 수 없',
  '없음',
  '준함',
  '추정',
  '판단',
  '것으로 보',
  '듯',
];

function looksLikeExplanation(value: string): boolean {
  // 괄호로 덧붙인 설명은 값이 아닙니다. '국내 / 호캉스'에는 괄호가 없습니다.
  if (/[(（]/.test(value)) return true;
  return NON_VALUE_MARKERS.some((marker) => value.includes(marker));
}

/**
 * 분류 필드에 섞여 들어온 모델의 혼잣말을 걷어냅니다.
 *
 * 사고 토큰을 꺼두면 모델은 판단이 필요할 때 답변 필드 안에서 고민합니다.
 * 실제로 travelTheme에 "2개만 넣겠습니다... 지침이 필요합니다" 같은 문단이
 * 통째로 들어온 적이 있습니다. 화면이 지저분해지는 것으로 끝나지 않고,
 * travelTheme과 location은 쪼개져 검색 facet의 축이 되기 때문에
 * 그대로 두면 조합 검색이 오염됩니다.
 *
 * 프롬프트로 줄일 수는 있어도 없앨 수는 없으므로 저장 전에 한 번 더 거릅니다.
 * 배열 필드는 건드리지 않습니다. 긴 항목이 정상인 경우(highlights 등)가 있어
 * 같은 잣대를 대면 멀쩡한 값을 지웁니다.
 */
function dropRamblingValues(data: any): any {
  if (!data || typeof data !== 'object') {
    return data;
  }

  for (const field of SHORT_VALUE_FIELDS) {
    const value = data[field];
    if (typeof value !== 'string') continue;

    const trimmed = value.trim();
    if (!trimmed) continue;

    if (trimmed.length > MAX_SHORT_VALUE_LENGTH) {
      console.log(`[GeminiAPI] ${field}에 값 대신 설명이 들어와 버립니다 (${trimmed.length}자)`);
      data[field] = '';
      continue;
    }

    if (looksLikeExplanation(trimmed)) {
      console.log(`[GeminiAPI] ${field}가 값이 아니라 설명이라 버립니다: ${trimmed}`);
      data[field] = '';
    }
  }

  return data;
}

async function callGeminiApi(
  title: string,
  rawContent: string,
  base64Image?: string,
  /** 날짜 해석의 기준. 아이템을 저장한 시점이며 없으면 지금입니다. */
  referenceDate: string = new Date().toISOString()
): Promise<GeminiResult> {
  const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
  if (!apiKey) {
    console.log('[GeminiAPI] EXPO_PUBLIC_GEMINI_API_KEY 환경변수가 설정되지 않아 로컬 요약기로 폴백합니다.');
    return { ok: false, reason: 'API 키 없음 (EXPO_PUBLIC_GEMINI_API_KEY 미주입)' };
  }

  // 모델은 오늘이 며칠인지 모릅니다. 알려주지 않으면 '8/31까지' 같은 표기의 연도를
  // 학습 시점 근처로 찍어버려, 방금 저장한 공구가 몇백 일 지난 것으로 표시됩니다.
  const today = referenceDate.slice(0, 10);

  const prompt = `오늘 날짜는 ${today}이다. 연도가 적혀 있지 않은 날짜는 오늘이 속한 연도로 해석하라.

너는 입력된 원문 지식에서 핵심적인 정보만을 고도로 구조화된 형태로 요약 및 추출하는 AI 에이전트이다.
다음 지침에 따라 반드시 JSON 형식으로만 응답해라. 백틱( \`\`\`json )이나 기타 텍스트는 일절 출력하지 마라.

각 필드에는 값만 넣어라. 설명, 판단 근거, 질문, 대안 제시를 필드 안에 쓰지 마라.
분류가 애매하면 가장 가까운 것 하나를 고르고, 해당 사항이 아예 없으면 빈 문자열로 두어라.

원문에 [SOURCE n] 표시가 여러 개 있으면, 그것들은 모두 같은 하나의 대상에 대한
서로 다른 출처다. 전체를 종합해서 각 항목을 채워라. 서로 어긋나는 정보가 있으면
어느 한쪽을 임의로 사실로 확정하지 말고, 더 구체적이고 나중에 온 출처를 따르되
확신이 없으면 그 항목을 비워라.

긴 대화를 여러 장으로 나눠 찍은 화면처럼, 출처끼리 같은 내용이 겹쳐 들어올 수 있다.
겹치는 부분은 한 번만 반영하고, 목록 항목이나 문장을 되풀이해 적지 마라.

출력할 JSON 스키마:
{
  "title": "12~32자 내외의 핵심 요약형 제목 (과장/클릭베이트 금지)",
  "summary": "홈용 3줄 요약 (가독성 좋게 1), 2), 3) 번호 매김)",
  "detailedAnalysis": "상세 뷰용 전체 요약 정리본 (원문 본문의 중요한 핵심 논지, 세부 정보들을 소제목과 글머리 기호(불릿)를 활용해 일목요연하고 깊이 있게 정리한 상세 설명 텍스트, 한국어로 정성스럽게 작성할 것)",
  "category": "recipe | workout | travel | parenting | shopping | interior | web 중 하나로 분류 (공동구매/꿀템/제품추천은 shopping, 방꾸미기/가구/조명은 interior)",
  "cookTime": "조리 시간 (예: '20분')",
  "difficulty": "조리 난이도 ('쉬움', '보통', '어려움' 중 하나)",
  "ingredients": ["재료1", "재료2", "재료3"],
  "targetMuscles": ["부위1", "부위2"],
  "equipments": ["도구1", "도구2"],
  "routine": ["루틴동작 1", "루틴동작 2"],
  "travelTheme": "'국내' 또는 '해외' 뒤에 ' / '와 테마 한 단어. 예: '국내 / 호캉스', '해외 / 배낭여행'. 정확히 이 형태로만 쓰고 다른 말을 덧붙이지 마라",
  "location": "위치 및 숙소명",
  "budget": "예상 예산 정보",
  "highlights": ["추천 명소/특장점 1", "2"],
  "checklist": ["준비물/예약 필요 항목 1", "2"],
  "productType": "품목 분류 한 단어 (식품 | 주방 | 생활 | 패션 | 가전 | 뷰티 | 인테리어 | 육아용품 중 하나)",
  "seller": "판매처 또는 공구 주최 (예: '쿠팡', '네이버 스마트스토어', '인스타 공구')",
  "purchaseType": "구매 형태 ('공동구매' 또는 '일반구매')",
  "deadline": "마감일이 본문에 있으면 YYYY-MM-DD 형식으로. 연도가 없으면 오늘 날짜의 연도를 쓸 것. 없으면 빈 문자열",
  "price": "가격 정보 (예: '19,900원')",
  "babyAgeMonths": "대상 아기 월령을 숫자 개월로. 범위면 '6-12', 단일이면 '6'. 없으면 빈 문자열 (돌=12, 3세=36)",
  "parentingTopic": "육아 주제 (이유식 | 수면 | 발달 | 놀이 | 마사지 | 건강 | 교육 | 외출 | 용품 중 하나)",
  "roomType": "공간 (거실 | 침실 | 주방 | 욕실 | 현관 | 서재 | 아이방 | 베란다 중 하나)",
  "interiorStyle": "인테리어 스타일 (북유럽 | 미니멀 | 모던 | 빈티지 | 내추럴 | 인더스트리얼 | 러블리 중 하나)"
}

${base64Image
  ? `분석 대상: 첨부된 이미지 (스크린샷일 수 있음)
이미지에 보이는 글자를 빠짐없이 읽고, 그 내용을 기준으로 위 항목들을 채워라.
읽어낸 글자 원문은 "extractedText" 필드에 그대로 담아라.`
  : `분석할 원문 지식:
제목: ${title}
본문:
${rawContent.slice(0, MAX_CONTENT_CHARS)}`}
`;

  const maxAttempts = 3;
  let delay = 1000; // 1초 대기부터 시작

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
      // 타임아웃 없이 부르면 응답이 안 올 때 보강이 영원히 매달립니다.
      // 그러면 아이템은 '요약 정리 중'에 갇히고, 재분석 버튼도 눌리지 않습니다.
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: base64Image
              ? [
                  { text: prompt },
                  { inline_data: { mime_type: 'image/jpeg', data: base64Image } },
                ]
              : [{ text: prompt }],
          }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
            // 모델은 기본적으로 '사고' 토큰을 쓰는데, 짧은 입력에도 2000토큰이 넘게
            // 소모돼 무료 할당량을 빠르게 갉아먹습니다. 이 작업은 추출/요약이라 필요 없습니다.
            // 주의: 3.5 이후 모델은 thinkingBudget 0을 거부합니다(HTTP 400).
            // 모델을 올릴 때는 이 항목이 받아들여지는지 먼저 확인해야 합니다.
            thinkingConfig: { thinkingBudget: 0 },
          }
        }),
      }, GEMINI_TIMEOUT_MS);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');

        // 할당량 소진은 기다린다고 풀리지 않습니다. 재시도하면 시간만 쓰고
        // 남은 호출까지 갉아먹으므로 즉시 중단하고 사용자에게 그대로 알립니다.
        const isQuotaExhausted =
          response.status === 429 && /quota|billing/i.test(errorBody);
        if (isQuotaExhausted) {
          return {
            ok: false,
            reason:
              'Gemini 무료 할당량을 모두 사용했습니다. 한도가 초기화된 뒤 다시 시도하거나 결제 설정을 확인하세요.',
          };
        }

        // 503(과부하)이나 순간적인 rate limit은 잠시 후 풀릴 수 있어 재시도합니다.
        if (response.status === 503 || response.status === 429) {
          if (attempt < maxAttempts) {
            console.log(`[GeminiAPI] 일시적 HTTP ${response.status} 에러 감지. ${delay}ms 후 재시도합니다. (시도 ${attempt}/${maxAttempts})`);
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2; // 지수 백오프
            continue;
          }
        }

        throw new Error(`HTTP ${response.status} ${errorBody.slice(0, 120)}`);
      }

      const resJson = await response.json();
      const responseText = resJson?.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (responseText) {
        const cleaned = extractFirstJsonObject(responseText);
        if (!cleaned) {
          return { ok: false, reason: '응답에서 JSON 객체를 찾지 못했습니다.' };
        }

        try {
          const data = JSON.parse(cleaned);
          return {
            ok: true,
            data: dropRamblingValues(normalizeDeadlineYear(data, rawContent, referenceDate)),
          };
        } catch (parseErr) {
          const message = parseErr instanceof Error ? parseErr.message : String(parseErr);
          console.log(`[GeminiAPI] JSON 파싱 실패 (시도 ${attempt}/${maxAttempts}):`, message);
          return { ok: false, reason: `JSON 파싱 실패: ${message}` };
        }
      }

      // 응답은 왔는데 본문 텍스트가 없는 경우 (안전 필터, MAX_TOKENS 절단 등)
      const finishReason = resJson?.candidates?.[0]?.finishReason ?? '알 수 없음';
      return { ok: false, reason: `응답에 텍스트 없음 (finishReason: ${finishReason})` };
    } catch (err) {
      if (attempt < maxAttempts) {
        console.log(`[GeminiAPI] API 호출 중 에러 발생. ${delay}ms 후 재시도합니다. (시도 ${attempt}/${maxAttempts}):`, err instanceof Error ? err.message : err);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
        continue;
      }
      // 3회 모두 최종 실패 시에만 디버깅용 console.warn 출력 (로컬 폴백 처리 유도)
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[GeminiAPI] 최종 실패 (로컬 엔진 폴백):', message);
      return { ok: false, reason: message };
    }
  }
  return { ok: false, reason: '재시도 횟수를 모두 소진했습니다.' };
}

/**
 * AI가 실패했을 때 본문에서 추린 요약.
 *
 * 예전에는 이름과 문구가 모두 'AI'를 내세웠습니다. AI를 한 번도 안 부르고
 * 만든 글에 "🍳 AI 분석 요리 레시피 3줄 요약"이라고 적었으니, 사용자는
 * 정리가 끝난 줄 알았습니다. 게다가 "바른 자세로 3~4세트 수행을 권장합니다"처럼
 * 본문에 없는 조언까지 지어 붙였습니다.
 *
 * 지금은 본문에 실제로 있는 줄만 추려서 그렇다고 밝히고 보여줍니다.
 */
function buildExcerptSummary(title: string, rawContent: string): string {
  if (!rawContent || rawContent.trim().length === 0) {
    return `"${title}" 링크를 저장했습니다. 본문에서 추릴 내용이 없습니다.`;
  }

  const lines = rawContent
    .split('\n')
    .map((line) => line.replace(/[#*`\-_[\]()|]/g, '').trim())
    .filter((line) => {
      if (line.length < 12) return false;
      if (line.includes('http://') || line.includes('https://')) return false;
      if (line.includes('Where teams and agents') || line.includes('collaborative AI workspace')) return false;
      if (line.includes('쿠팡 파트너스') || line.includes('수수료를 제공받을 수')) return false;
      return true;
    })
    .slice(0, 3);

  if (lines.length === 0) {
    const flat = rawContent.replace(/\s+/g, ' ').trim();
    return `본문 발췌: ${flat.length > 120 ? `${flat.slice(0, 120)}...` : flat}`;
  }

  const numbered = lines
    .map((line, index) => `${index + 1}) ${line.length > 70 ? `${line.slice(0, 70)}...` : line}`)
    .join('\n');

  return `본문 발췌 (AI 정리 전):\n${numbered}`;
}


function parseStructuredFromContent(rawContent: string, sourceType: string): any {
  const lowerContent = rawContent.toLowerCase();
  const found: Record<string, unknown> = {};

  const pickLines = (test: (line: string) => boolean, limit: number) =>
    rawContent
      .split('\n')
      .map((line) => line.trim().replace(/[#*⭐□\[\]-]/g, '').trim())
      .filter((line) => line.length > 5 && test(line))
      .slice(0, limit);

  if (sourceType === 'recipe') {
    const ingredientKeywords = ['감자', '양파', '마늘', '당근', '소금', '후추', '치즈', '계란', '생크림', '버터', '베이컨', '대파', '고기', '닭고기', '돼지고기', '소고기', '설탕', '간장', '참기름', '식초', '고추장', '고춧가루', '통깨', '올리브유'];
    const matched = ingredientKeywords.filter((ing) => lowerContent.includes(ing));
    if (matched.length > 0) found.ingredients = matched;

    const timeMatch = rawContent.match(/(\d+\s*분)/);
    if (timeMatch) found.cookTime = timeMatch[1];

    // 본문이 난이도를 말한 경우에만 적습니다. 안 적혀 있으면 모르는 것입니다.
    if (lowerContent.includes('어려')) found.difficulty = '어려움';
    else if (lowerContent.includes('보통')) found.difficulty = '보통';
    else if (lowerContent.includes('쉬운') || lowerContent.includes('쉬움')) found.difficulty = '쉬움';
  }

  if (sourceType === 'workout') {
    const targetKeywords = ['하체', '상체', '복근', '가슴', '등', '어깨', '팔', '허벅지', '엉덩이', '둔근', '코어', '이두', '삼두', '전신'];
    const targets = targetKeywords.filter((t) => lowerContent.includes(t));
    if (targets.length > 0) found.targetMuscles = targets;

    const equipmentKeywords = ['덤벨', '바벨', '맨몸', '매트', '밴드', '철봉', '케틀벨', '폼롤러'];
    const equipments = equipmentKeywords.filter((e) => lowerContent.includes(e));
    if (equipments.length > 0) found.equipments = equipments;

    const routine = pickLines(
      (line) => /\d+\s*(회|세트|분|초)/.test(line),
      5
    );
    if (routine.length > 0) found.routine = routine;
  }

  if (sourceType === 'travel') {
    const budgetMatch = rawContent.match(/(\d+\s*만\s*원)/) || rawContent.match(/(\d[\d,]*원)/);
    if (budgetMatch) found.budget = budgetMatch[1];

    const locMatch = rawContent.match(/(?:위치|주소)[:\s]+([^\n]+)/i);
    if (locMatch) {
      found.location = locMatch[1].trim().replace(/[#*]/g, '');
    } else {
      const cityKeywords = ['서울', '제주', '강릉', '속초', '부산', '경주', '여수', '가평', '인천', '양양', '춘천', '평창'];
      const foundCity = cityKeywords.find((c) => rawContent.includes(c));
      if (foundCity) found.location = foundCity;
    }

    // 테마까지는 짐작하지 않습니다. 국내인지 해외인지만 근거가 있을 때 적습니다.
    if (lowerContent.includes('해외')) found.travelTheme = '해외';
    else if (found.location) found.travelTheme = '국내';

    const highlights = pickLines(
      (line) => ['추천', '스팟', '맛집', '카페', '전경', '오션뷰'].some((k) => line.includes(k)),
      3
    );
    if (highlights.length > 0) found.highlights = highlights;

    const checklist = pickLines(
      (line) => ['준비', '체크', '예약', '티켓', '발권', '등록'].some((k) => line.includes(k)),
      5
    );
    if (checklist.length > 0) found.checklist = checklist;
  }

  return Object.keys(found).length > 0 ? found : null;
}
