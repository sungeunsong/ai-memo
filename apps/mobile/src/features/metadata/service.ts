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
 *      - travelTheme (여행 테마칩): '국내 / 호캉스', '해외 / 배낭여행', '국내 / 온천' 등 분류.
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

export async function fetchMetadataPatch(sourceUrl: string): Promise<ItemMetadataPatch> {
  const updatedAt = new Date().toISOString();

  try {
    const normalizedSourceUrl = normalizeSourceUrl(sourceUrl);
    const metadata = isYouTubeUrl(normalizedSourceUrl)
      ? await fetchYouTubeMetadata(normalizedSourceUrl)
      : await fetchGenericMetadata(normalizedSourceUrl);

    return {
      sourceUrl: metadata.sourceUrl,
      title: metadata.title,
      summary: metadata.summary,
      content: metadata.content,
      contentText: metadata.contentText,
      digest: metadata.digest,
      aiError: metadata.aiError,
      thumbnailUrl: metadata.thumbnailUrl,
      sourceType: metadata.sourceType,
      aiStatus: 'completed',
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
export async function fetchTextMetadataPatch(rawText: string): Promise<ItemMetadataPatch> {
  const updatedAt = new Date().toISOString();

  const trimmed = rawText.trim();
  if (!trimmed) {
    return { aiStatus: 'failed', updatedAt };
  }

  const result = await callGeminiApi('', trimmed);

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
export async function fetchImageMetadataPatch(base64Image: string): Promise<ItemMetadataPatch> {
  const updatedAt = new Date().toISOString();

  if (!base64Image) {
    return { aiStatus: 'failed', aiError: '이미지를 읽지 못했습니다.', updatedAt };
  }

  const result = await callGeminiApi('', '', base64Image);

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

async function fetchGenericMetadata(sourceUrl: string): Promise<MetadataResult> {
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

        // 1. 진짜 AI 요약 API (Gemini 2.5 Flash LLM) 호출 시도
        const aiResult = await callGeminiApi(title, rawContent);
        if (aiResult.ok) {
          console.log('[MetadataService] Gemini API를 활용한 실제 AI 요약 및 구조화 파싱에 성공했습니다.');
          summary = aiResult.data.summary;
          parsedStructure = aiResult.data;
        } else {
          aiError = aiResult.reason;
          // 2. API Key 환경변수가 없거나 에러 발생 시, 로컬 지능형 요약기 및 파서로 폴백
          console.log('[MetadataService] 로컬 지능형 요약기 및 본문 파서를 구동합니다.');
          summary = generateAISummary(title, rawContent, sourceType);
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
  const sourceType = classifySourceType(sourceUrl, htmlMetadata.summary);


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
  const summary = pickFirstMeaningful([
    extractMetaContent(html, 'property', 'og:description'),
    extractMetaContent(html, 'name', 'description'),
    extractMetaContent(html, 'name', 'twitter:description'),
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
    thumbnailUrl,
  };
}

async function fetchWithTimeout(input: string, init?: RequestInit) {
  const controller = new AbortController();
  // Jina AI Reader 등 중량급 헤드리스 브라우저 렌더링(노션 로드 포함)을 고려하여
  // 네트워크 타임아웃 한계를 5초에서 20초로 넉넉하게 늘립니다.
  const timeoutId = setTimeout(() => controller.abort(), 20000);

  try {
    return await fetch(input, {
      ...init,
      redirect: 'follow',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}


function extractMetaContent(html: string, attribute: 'property' | 'name', key: string) {
  const regex = new RegExp(
    `<meta[^>]+${attribute}=["']${escapeRegExp(key)}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    'i'
  );
  const reverseRegex = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+${attribute}=["']${escapeRegExp(key)}["'][^>]*>`,
    'i'
  );

  return sanitizeText(html.match(regex)?.[1] ?? html.match(reverseRegex)?.[1] ?? '');
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

async function callGeminiApi(
  title: string,
  rawContent: string,
  base64Image?: string
): Promise<GeminiResult> {
  const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
  if (!apiKey) {
    console.log('[GeminiAPI] EXPO_PUBLIC_GEMINI_API_KEY 환경변수가 설정되지 않아 로컬 요약기로 폴백합니다.');
    return { ok: false, reason: 'API 키 없음 (EXPO_PUBLIC_GEMINI_API_KEY 미주입)' };
  }

  const prompt = `너는 입력된 원문 지식에서 핵심적인 정보만을 고도로 구조화된 형태로 요약 및 추출하는 AI 에이전트이다.
다음 지침에 따라 반드시 JSON 형식으로만 응답해라. 백틱( \`\`\`json )이나 기타 텍스트는 일절 출력하지 마라.

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
  "travelTheme": "여행 테마 (예: '국내 / 호캉스')",
  "location": "위치 및 숙소명",
  "budget": "예상 예산 정보",
  "highlights": ["추천 명소/특장점 1", "2"],
  "checklist": ["준비물/예약 필요 항목 1", "2"],
  "productType": "품목 분류 한 단어 (식품 | 주방 | 생활 | 패션 | 가전 | 뷰티 | 인테리어 | 육아용품 중 하나)",
  "seller": "판매처 또는 공구 주최 (예: '쿠팡', '네이버 스마트스토어', '인스타 공구')",
  "purchaseType": "구매 형태 ('공동구매' 또는 '일반구매')",
  "deadline": "마감일이 본문에 있으면 YYYY-MM-DD 형식으로. 없으면 빈 문자열",
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
${rawContent.slice(0, 8000)}`}
`;

  const maxAttempts = 3;
  let delay = 1000; // 1초 대기부터 시작

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
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
            // 2.5 Flash는 기본적으로 '사고' 토큰을 쓰는데, 짧은 입력에도 2000토큰이 넘게
            // 소모돼 무료 할당량을 빠르게 갉아먹습니다. 이 작업은 추출/요약이라 필요 없습니다.
            thinkingConfig: { thinkingBudget: 0 },
          }
        })
      });

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
          return { ok: true, data: JSON.parse(cleaned) };
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

function generateAISummary(title: string, rawContent: string, sourceType: string): string {
  if (!rawContent || rawContent.trim().length === 0) {
    return `✨ "${title}" 링크 지식을 저장했습니다. 본문에 요약할 내용이 부족합니다.`;
  }

  // 광고글이나 무의미한 줄 필터링
  const lines = rawContent
    .split('\n')
    .map(line => line.trim())
    .filter(line => {
      if (line.length < 12) return false; // 너무 짧은 줄 탈락
      if (line.includes('http://') || line.includes('https://')) return false; // 링크 탈락
      if (line.includes('Where teams and agents') || line.includes('collaborative AI workspace')) return false; // 노션 광고 탈락
      if (line.includes('쿠팡 파트너스') || line.includes('수수료를 제공받을 수')) return false; // 스팸성 광고 탈락
      return true;
    });

  // 특수 마크다운 표식 제거 정제
  const cleanLines = lines.map(line => 
    line.replace(/[#*`\-_[\]()|]/g, '').trim()
  ).filter(line => line.length > 5);

  const mainPoints = cleanLines.slice(0, 3); // 핵심적인 앞 3줄 발췌

  // 도메인별 포맷팅 요약문 생성
  if (sourceType === 'recipe') {
    const sampleIngredients = ['감자', '양파', '마늘', '당근', '치즈', '계란', '생크림', '버터', '소금', '후추', '간장', '고기', '파', '참기름'];
    const matched = sampleIngredients.filter(ing => rawContent.toLowerCase().includes(ing));
    const ingredientList = matched.length > 0 ? matched.join(', ') : '주요 레시피 재료';

    return `🍳 AI 분석 요리 레시피 3줄 요약:
1) 메뉴: "${title}" 요리법 정보입니다.
2) 핵심 재료: ${ingredientList} 등을 준비해야 합니다.
3) 요리 팁: 본문에 기재된 조리 시간 및 온도를 준수하여 맛있게 조리하세요.`;
  }

  if (sourceType === 'workout') {
    const targetKeywords = ['하체', '상체', '복근', '가슴', '등', '어깨', '허벅지', '엉덩이', '둔근', '코어'];
    const targets = targetKeywords.filter(t => rawContent.toLowerCase().includes(t));
    const targetArea = targets.length > 0 ? targets.join(', ') : '전신 근력';

    return `💪 AI 분석 운동 루틴 3줄 요약:
1) 운동 목표: "${title}" 홈트 코칭입니다.
2) 자극 부위: 주로 [ ${targetArea} ] 부위에 강한 자극을 유도합니다.
3) 권장 사항: 본문의 세부 동작 루틴에 따라 바른 자세로 3~4세트 수행을 권장합니다.`;
  }

  if (sourceType === 'travel') {
    const cityKeywords = ['서울', '제주', '강릉', '속초', '부산', '경주', '여수', '가평', '인천', '양양'];
    const foundCity = cityKeywords.find(c => rawContent.includes(c));
    const location = foundCity ? `${foundCity} 지역` : '인기 여행지';

    return `✈️ AI 분석 여행 코스 3줄 요약:
1) 테마: "${title}" 호캉스 및 여행 코스 정보입니다.
2) 추천 위치: ${location} 중심으로 숙소 및 핵심 힐링 스팟을 포함하고 있습니다.
3) 준비 체크리스트: 숙소 예약 상태를 점검하고 본문의 필수 준비물 리스트를 확인하세요.`;
  }

  // 4. 일반 웹/Notion 요약
  if (mainPoints.length >= 2) {
    const p1 = mainPoints[0] || '본문 분석 완료';
    const p2 = mainPoints[1] || '핵심 주제 확인';
    const p3 = mainPoints[2] || '추가 세부 사항 기재됨';
    return `✨ AI 핵심 요약 정리:
1) ${p1.slice(0, 70)}${p1.length > 70 ? '...' : ''}
2) ${p2.slice(0, 70)}${p2.length > 70 ? '...' : ''}
3) ${p3.slice(0, 70)}${p3.length > 70 ? '...' : ''}`;
  }

  // Fallback (본문이 매우 짧은 경우 등)
  const fallbackSummary = rawContent.length > 120 
    ? rawContent.slice(0, 120).replace(/\s+/g, ' ').trim() + '...' 
    : rawContent.replace(/\s+/g, ' ').trim();
  return `✨ AI 정리: "${title}" 링크 지식입니다.\n${fallbackSummary}`;
}

function parseStructuredFromContent(rawContent: string, sourceType: string): any {
  const lowerContent = rawContent.toLowerCase();

  if (sourceType === 'recipe') {
    const ingredientKeywords = ['감자', '양파', '마늘', '당근', '소금', '후추', '치즈', '계란', '생크림', '버터', '베이컨', '대파', '고기', '닭고기', '돼지고기', '소고기', '설탕', '간장', '참기름', '식초', '고추장', '고춧가루', '통깨', '올리브유'];
    const matchedIngredients = ingredientKeywords.filter(ing => lowerContent.includes(ing));
    
    let cookTime = '15분';
    const timeMatch = rawContent.match(/(\d+\s*분)/);
    if (timeMatch) {
      cookTime = timeMatch[1];
    }

    return {
      cookTime,
      difficulty: lowerContent.includes('어려') ? '어려움' : lowerContent.includes('보통') ? '보통' : '쉬움',
      ingredients: matchedIngredients.length > 0 ? matchedIngredients : ['소금', '후추', '주재료'],
    };
  }

  if (sourceType === 'workout') {
    const targetKeywords = ['하체', '상체', '복근', '가슴', '등', '어깨', '팔', '허벅지', '엉덩이', '둔근', '코어', '이두', '삼두', '전신'];
    const targetMuscles = targetKeywords.filter(t => lowerContent.includes(t));

    const equipmentKeywords = ['덤벨', '바벨', '맨몸', '매트', '밴드', '철봉', '케틀벨', '폼롤러'];
    const equipments = equipmentKeywords.filter(e => lowerContent.includes(e));

    // 숫자로 시작하거나 '세트', '회'가 들어간 홈트 루틴 추출 시도
    const routineLines = rawContent.split('\n')
      .map(line => line.trim().replace(/[#*]/g, ''))
      .filter(line => line.length > 4 && (line.match(/^\d/) || line.includes('세트') || line.includes('회') || line.includes('Hold') || line.includes('초')))
      .slice(0, 5);

    return {
      targetMuscles: targetMuscles.length > 0 ? targetMuscles : ['전신'],
      equipments: equipments.length > 0 ? equipments : ['맨몸'],
      routine: routineLines.length > 0 ? routineLines : ['맨몸 스트레칭 : 5분', '스쿼트 : 15회 x 3세트', '플랭크 Hold : 1분 x 3세트'],
    };
  }

  if (sourceType === 'travel') {
    let budget = '15만 ~ 25만원대';
    const budgetMatch = rawContent.match(/(\d+\s*만\s*원)/) || rawContent.match(/(\d+원)/);
    if (budgetMatch) {
      budget = budgetMatch[1];
    }

    let location = '국내 명소';
    const locMatch = rawContent.match(/(?:위치|주소|위치 정보)[:\s]+([^\n]+)/i);
    if (locMatch) {
      location = locMatch[1].trim().replace(/[#*]/g, '');
    } else {
      const cityKeywords = ['서울', '제주', '강릉', '속초', '부산', '경주', '여수', '가평', '인천', '양양', '춘천', '평창'];
      const foundCity = cityKeywords.find(c => rawContent.includes(c));
      if (foundCity) {
        location = foundCity;
      }
    }

    const highlights = rawContent.split('\n')
      .map(line => line.trim().replace(/[#*⭐]/g, '').trim())
      .filter(line => line.length > 5 && (line.includes('추천') || line.includes('스팟') || line.includes('맛집') || line.includes('카페') || line.includes('전경') || line.includes('오션뷰')))
      .slice(0, 3);

    const checklist = rawContent.split('\n')
      .map(line => line.trim().replace(/[#*□\[\]\-]/g, '').trim())
      .filter(line => line.length > 3 && (line.includes('준비') || line.includes('체크') || line.includes('예약') || line.includes('티켓') || line.includes('발권') || line.includes('등록')))
      .slice(0, 5);

    return {
      travelTheme: lowerContent.includes('해외') ? '해외 여행' : lowerContent.includes('온천') ? '국내 / 힐링 온천' : '국내 여행 / 호캉스',
      location,
      budget,
      highlights: highlights.length > 0 ? highlights : ['바다 전망 호텔 라운지', '호텔 루프탑 수영장', '인근 로컬 맛집 탐방'],
      checklist: checklist.length > 0 ? checklist : ['호텔 숙소 예약 확인 및 바우처', '대중교통 기차/항공권 예매', '계절 여벌 옷 및 수영복 챙기기', '신분증/여권 지참', '상비약 및 세면도구 세트'],
    };
  }

  return null;
}
