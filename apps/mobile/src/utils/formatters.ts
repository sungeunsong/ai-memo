import { SavedItem } from '@/features/items/types';
import { getHostname } from '@/features/items/fallback';
import { hangulMatch } from './search';

// ==========================================
// 날짜/시간 포맷 유틸리티
// ==========================================

export function formatRelativeTime(value: string) {
  const now = Date.now();
  const target = new Date(value).getTime();
  const diffMinutes = Math.max(0, Math.round((now - target) / 60000));

  if (diffMinutes < 1) {
    return '방금 전';
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}분 전`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}시간 전`;
  }

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}일 전`;
}

export function formatReadableDate(value: string) {
  const date = new Date(value);

  return `${date.getMonth() + 1}.${String(date.getDate()).padStart(2, '0')} ${String(
    date.getHours()
  ).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

// ==========================================
// URL/텍스트 유틸리티
// ==========================================

export function truncateMiddle(value: string) {
  if (value.length <= 38) {
    return value;
  }

  return `${value.slice(0, 20)}...${value.slice(-12)}`;
}

export function extractUrlCount(input: string) {
  const matches = input.match(
    /\b(?:(?:https?:\/\/|www\.)[^\s<>"']+|(?:youtube\.com|m\.youtube\.com|youtu\.be|instagram\.com|www\.instagram\.com|notion\.so|notion\.site)\/[^\s<>"']+)/gi
  ) ?? [];
  return new Set(matches.map((match) => match.replace(/[)\],.!?]+$/, ''))).size;
}

export function getInputHostname(input: string) {
  const match = input.match(
    /\b(?:(?:https?:\/\/|www\.)[^\s<>"']+|(?:youtube\.com|m\.youtube\.com|youtu\.be|instagram\.com|www\.instagram\.com|notion\.so|notion\.site)\/[^\s<>"']+)/i
  );
  if (!match) {
    return '링크';
  }

  try {
    const value = /^https?:\/\//i.test(match[0]) ? match[0] : `https://${match[0]}`;
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return '링크';
  }
}

// ==========================================
// 아이템 상태/라벨 유틸리티
// ==========================================

export function getSaveStatusLabel(_item: SavedItem) {
  return '저장됨';
}

export function getAiStatusLabel(item: SavedItem) {
  if (item.aiStatus === 'completed') {
    return '정리 완료';
  }

  if (item.aiStatus === 'failed') {
    return '정리 실패';
  }

  return '요약 정리 중';
}

export function getSyncStatusLabel(syncStatus: SavedItem['syncStatus']) {
  if (syncStatus === 'queued') {
    return '동기화 대기';
  }

  if (syncStatus === 'synced') {
    return '동기화 완료';
  }

  if (syncStatus === 'failed') {
    return '동기화 실패';
  }

  return '로컬만 저장';
}

export function getItemSourceLabel(item: SavedItem) {
  if (!item.sourceUrl) {
    return item.savedFrom === 'clipboard' ? '클립보드 텍스트' : '텍스트 메모';
  }

  try {
    return new URL(item.sourceUrl).hostname.replace(/^www\./, '');
  } catch {
    return 'web link';
  }
}

export function describeSavedItemShape(item: SavedItem) {
  if (item.extractedUrls.length > 1) {
    return `링크 ${item.extractedUrls.length}개 포함`;
  }

  if (item.type === 'text') {
    return `텍스트 ${item.rawInput.trim().length}자`;
  }

  return '링크 1개';
}

export function describeInputCandidate(input: string) {
  const urls = extractUrlCount(input);
  if (urls > 1) {
    return `링크 ${urls}개 포함`;
  }

  if (urls === 1) {
    return `${getInputHostname(input)} 링크`;
  }

  return `텍스트 ${input.trim().length}자`;
}

export function shouldShowRawInputFirst(item: SavedItem) {
  return item.type === 'text' || item.extractedUrls.length > 1 || item.rawInput.trim() !== item.content.trim();
}

// ==========================================
// 구조화 데이터 파서
// ==========================================

export function tryParseStructuredContent(content: string) {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// ==========================================
// 소스 테마 (시각적 분류용)
// ==========================================

export type SourceTheme = {
  border: string;
  bg: string;
  badgeBg: string;
  badgeText: string;
  label: string;
};

export function getSourceTheme(sourceType: string): SourceTheme {
  switch (sourceType) {
    case 'youtube':
      return {
        border: 'rgba(239, 68, 68, 0.2)',
        bg: 'rgba(239, 68, 68, 0.1)',
        badgeBg: 'rgba(239, 68, 68, 0.18)',
        badgeText: '#fca5a5',
        label: 'YouTube',
      };
    case 'parenting':
      return {
        border: 'rgba(251, 146, 60, 0.2)',
        bg: 'rgba(251, 146, 60, 0.1)',
        badgeBg: 'rgba(251, 146, 60, 0.18)',
        badgeText: '#fdbb2d',
        label: '육아 👶',
      };
    case 'instagram':
    case 'instagram_post':
    case 'instagram_reel':
    case 'workout':
      return {
        border: 'rgba(236, 72, 153, 0.2)',
        bg: 'rgba(236, 72, 153, 0.1)',
        badgeBg: 'rgba(236, 72, 153, 0.18)',
        badgeText: '#fbcfe8',
        label: sourceType === 'workout' ? '홈트/운동' : sourceType === 'instagram_reel' ? 'Instagram Reel' : sourceType === 'instagram_post' ? 'Instagram Post' : 'Instagram',
      };
    case 'notion':
    case 'recipe':
      return {
        border: 'rgba(239, 68, 68, 0.2)',
        bg: 'rgba(239, 68, 68, 0.1)',
        badgeBg: 'rgba(239, 68, 68, 0.18)',
        badgeText: '#fca5a5',
        label: sourceType === 'recipe' ? '레시피 요리' : 'Notion',
      };
    case 'google_docs':
    case 'google_sheets':
    case 'google_drive':
    case 'google_form':
    case 'travel':
      return {
        border: 'rgba(59, 130, 246, 0.2)',
        bg: 'rgba(59, 130, 246, 0.1)',
        badgeBg: 'rgba(59, 130, 246, 0.18)',
        badgeText: '#93c5fd',
        label: sourceType === 'travel' ? '여행 코스' : sourceType === 'google_docs' ? 'Google Docs' : sourceType === 'google_sheets' ? 'Google Sheets' : sourceType === 'google_form' ? 'Google Form' : 'Google Drive',
      };
    case 'manual_text':
      return {
        border: 'rgba(249, 115, 22, 0.2)',
        bg: 'rgba(249, 115, 22, 0.1)',
        badgeBg: 'rgba(249, 115, 22, 0.18)',
        badgeText: '#fcd34d',
        label: '직접 메모',
      };
    default:
      return {
        border: 'rgba(139, 92, 246, 0.2)',
        bg: 'rgba(139, 92, 246, 0.1)',
        badgeBg: 'rgba(139, 92, 246, 0.18)',
        badgeText: '#c084fc',
        label: 'Web Link',
      };
  }
}

// ==========================================
// 카테고리 분류 로직
// ==========================================

/** 카테고리 자동 분류 시 훑을 본문 길이 상한 */
const CATEGORY_SCAN_LIMIT = 2000;

export function getItemCategory(item: SavedItem): string {
  // 사용자가 직접 고친 분류가 있으면 그것이 최우선입니다.
  // AI 재분석이나 키워드 규칙이 사람의 결정을 덮어써서는 안 됩니다.
  if (item.userCategory) {
    return item.userCategory;
  }

  const structured = tryParseStructuredContent(item.content);
  const category = structured?.category || item.sourceType;

  if (category === 'parenting') return 'parenting';
  if (category === 'travel') return 'travel';
  if (category === 'recipe') return 'recipe';
  if (category === 'workout') return 'workout';
  if (category === 'shopping') return 'shopping';

  const title = item.title.toLowerCase();
  // 본문은 contentText로 분리됐습니다. item.content에는 구조화 데이터만 남아 있어
  // 여기서 본문 키워드를 찾으려면 두 곳을 모두 봐야 합니다.
  // (contentText가 없던 시절 아이템은 content 안에 본문이 들어 있습니다)
  // getItemCategory는 검색어를 칠 때마다 아이템 수만큼 호출됩니다.
  // 본문 전체를 매번 소문자로 복사하면 비용이 커지므로 앞부분만 봅니다.
  // 분류 근거가 되는 단어는 대개 글머리에 나옵니다.
  const content = `${(item.contentText ?? '').slice(0, CATEGORY_SCAN_LIMIT)} ${item.content.slice(0, CATEGORY_SCAN_LIMIT)}`.toLowerCase();
  const userNote = (item.userNote || '').toLowerCase();

  const fallback = classifyByKeyword(title, userNote, content);
  if (fallback) {
    return fallback;
  }

  return 'other';
}

/**
 * AI가 분류하지 못했을 때 쓰는 키워드 폴백.
 *
 * 신호의 세기를 구분합니다.
 * 제목이나 내 메모에 나온 단어는 그 아이템의 주제일 가능성이 높지만,
 * 본문에 한 번 스쳐 지나간 단어는 아닙니다.
 * ('강릉 오션뷰 후기' 본문의 "육아 시작하고 처음 간 여행"이 육아로 분류되던 문제)
 *
 * 그래서 제목·메모는 한 번으로 충분하고, 본문은 두 번 이상 나와야 인정합니다.
 * 제목 검사를 모든 카테고리에 대해 먼저 돌리므로, 본문에 걸린 다른 카테고리가
 * 순서 때문에 이기는 일도 없어집니다.
 */
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  parenting: ['기저귀', '분유', '육아', '아동', '출산', '다자녀'],
  travel: ['여행', '호캉스', '항공권'],
  recipe: ['레시피', '요리', '조리법'],
  workout: ['운동', '루틴', '홈트', '헬스'],
  shopping: ['공구', '공동구매', '꿀템', '할인', '특가', '최저가'],
};

function countOccurrences(text: string, keyword: string): number {
  if (!text || !keyword) return 0;
  let count = 0;
  let index = text.indexOf(keyword);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(keyword, index + keyword.length);
  }
  return count;
}

function classifyByKeyword(title: string, userNote: string, content: string): string | null {
  // 1차: 제목과 메모 (강한 신호)
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((keyword) => title.includes(keyword) || userNote.includes(keyword))) {
      return category;
    }
  }

  // 2차: 본문 (약한 신호라 반복 등장을 요구)
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((keyword) => countOccurrences(content, keyword) >= 2)) {
      return category;
    }
  }

  return null;
}

/** 카테고리를 화면에 보여줄 때 쓰는 라벨. */
export const CATEGORY_LABELS: Record<string, string> = {
  recipe: '레시피 🍳',
  workout: '운동 💪',
  travel: '여행 ✈️',
  parenting: '육아 🍼',
  shopping: '공구·꿀템 🛍️',
  other: '미분류 🏷️',
};

export function getCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? CATEGORY_LABELS.other;
}

// ==========================================
// 아이템 필터링 로직
// ==========================================

/**
 * DM 원문이나 렌더링된 본문처럼 길이를 예측할 수 없는 텍스트를 검색합니다.
 *
 * hangulMatch는 대상 전체를 자모 단위로 분해하므로, 수만 자 본문에 매 타이핑마다 적용하면
 * 입력이 눈에 띄게 밀립니다. 그래서 길이를 기준으로 전략을 나눕니다.
 * - 짧은 텍스트(대부분의 DM 원문): 초성/퍼지 매칭까지 적용
 * - 긴 텍스트(웹 본문 전체): 단순 포함 검사만 적용
 */
const FUZZY_MATCH_LENGTH_LIMIT = 300;

function matchBodyText(text: string | null | undefined, query: string): boolean {
  if (!text) return false;
  if (text.length <= FUZZY_MATCH_LENGTH_LIMIT) {
    // 자소 순서 매칭은 끕니다. 긴 글에서는 글자가 흩어져 있어도 순서만 맞으면 걸려
    // 관련 없는 아이템이 결과에 섞입니다. 본문 검색에는 포함 검사와 초성까지면 충분합니다.
    return hangulMatch(text, query, { fuzzy: false });
  }
  return text.toLowerCase().includes(query.toLowerCase());
}

/**
 * 텍스트 검색만 담당합니다.
 *
 * 카테고리 탭 판정은 facet 축까지 봐야 해서 features/facets로 옮겼습니다.
 * (여행으로 분류된 키즈펜션도 육아 탭에 보여야 하는 식)
 * 조합 조건 역시 features/facets가 이 결과 위에 AND로 얹습니다.
 */
export function filterItems(items: SavedItem[], searchQuery: string): SavedItem[] {
  return items.filter((item) => {
    // 검색어 필터
    if (!searchQuery.trim()) return true;
    const query = searchQuery.trim();

    // 제목, 메모 검색
    if (hangulMatch(item.title, query) || (item.userNote && hangulMatch(item.userNote, query))) {
      return true;
    }

    // 자연어 카테고리 매핑
    const structured = tryParseStructuredContent(item.content);
    const category = structured?.category || item.sourceType;
    if (category) {
      const lowerQuery = query.toLowerCase();
      if ((lowerQuery === '요리' || lowerQuery === '레시피') && category === 'recipe') return true;
      if ((lowerQuery === '운동' || lowerQuery === '헬스' || lowerQuery === '홈트') && category === 'workout') return true;
      if ((lowerQuery === '여행' || lowerQuery === '호캉스') && category === 'travel') return true;
    }

    // 구조화 데이터 내부 검색
    if (structured) {
      if (structured.category === 'recipe' && structured.ingredients) {
        if ((structured.ingredients as string[]).some((ing) => hangulMatch(ing, query))) return true;
      }
      if (structured.category === 'workout' && structured.targetMuscles) {
        if ((structured.targetMuscles as string[]).some((m) => hangulMatch(m, query))) return true;
      }
      if (structured.category === 'travel') {
        if (structured.location && hangulMatch(structured.location, query)) return true;
        if (structured.travelTheme && hangulMatch(structured.travelTheme, query)) return true;
        if (structured.highlights && (structured.highlights as string[]).some((h) => hangulMatch(h, query))) return true;
        if (structured.checklist && (structured.checklist as string[]).some((c) => hangulMatch(c, query))) return true;
      }
    }

    // 요약 검색
    if (item.summary && hangulMatch(item.summary, query)) return true;

    // 원문/정리본/본문/URL 폴백 검색
    // AI 분류나 구조화 추출이 실패한 아이템도 반드시 다시 찾을 수 있어야 하므로,
    // 저장 당시의 원문과 긁어온 본문 전체를 마지막 그물망으로 사용합니다.
    if (matchBodyText(item.rawInput, query)) return true;
    if (matchBodyText(item.digest, query)) return true;
    if (matchBodyText(item.contentText, query)) return true;
    // 본문/정리본을 별도 컬럼으로 분리하기 전에 저장된 아이템 호환
    if (structured && typeof structured.description === 'string' && matchBodyText(structured.description, query)) return true;
    if (structured && typeof structured.detailedAnalysis === 'string' && matchBodyText(structured.detailedAnalysis, query)) return true;
    if (matchBodyText(item.sourceUrl, query)) return true;

    return false;
  });
}

// ==========================================
// 캡처 노티스 빌더
// ==========================================

export type CaptureNotice = {
  itemId: string | null;
  source: 'share' | 'clipboard' | 'manual';
  title: string;
  description: string;
  preview: string;
  stateLabel: string;
};

export function buildCaptureNotice(
  item: SavedItem | null,
  rawInput: string,
  source: CaptureNotice['source']
): CaptureNotice {
  return {
    itemId: item?.id ?? null,
    source,
    title: item ? '수집함에 저장됨' : '저장 요청 완료',
    description: item ? describeSavedItemShape(item) : describeInputCandidate(rawInput),
    preview: rawInput.trim().replace(/\s+/g, ' '),
    stateLabel: item ? getAiStatusLabel(item) : '요약 정리 중',
  };
}
