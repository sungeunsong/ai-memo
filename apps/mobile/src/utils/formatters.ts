import { readContentV2 } from '@/features/items/contentV2';
import { allFactValues, legacyText } from '@/features/items/factView';
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

  // 이건 진행 중이 아니라 사용자를 기다리는 상태입니다.
  // '요약 정리 중'이라고 적으면 가만 놔둬도 알아서 끝나는 줄 압니다.
  if (item.aiStatus === 'awaiting_input') {
    return '추가 입력 대기';
  }

  // 정리를 안 돌리기로 하고 담아둔 것. 기다리는 중이 아니므로 그렇게 보이면 안 됩니다.
  if (item.aiStatus === 'skipped') {
    return '직접 저장';
  }

  return '요약 정리 중';
}

/** 조각이 여럿이면 몇 개인지 알려줍니다. 하나뿐이면 굳이 말할 것이 없습니다. */
export function getSourceCountLabel(item: SavedItem): string | null {
  return item.sources.length > 1 ? `출처 ${item.sources.length}개` : null;
}

/**
 * 조각 목록에 보여줄 한 줄 미리보기.
 *
 * 긁어온 본문은 마크다운이라 첫 줄이 프로필 사진 태그인 경우가 흔합니다.
 * 그대로 보여주면 '![Image 1: ...](https://scontent...' 같은 글자만 보여서
 * 무슨 조각인지 알 수 없습니다. 사람이 읽을 부분만 남깁니다.
 */
export function describeSourceBody(source: {
  rawText: string | null;
  sourceUrl: string | null;
}): string {
  const cleaned = (source.rawText ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*`>]/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || source.sourceUrl || '내용 없음';
}

export const SOURCE_KIND_LABELS: Record<string, string> = {
  instagram_reel: 'Instagram 릴스',
  instagram_dm: 'Instagram DM',
  url: '링크',
  youtube: 'YouTube',
  notion: 'Notion',
  text: '텍스트',
  screenshot: '스크린샷',
  memo: '메모',
  other: '기타',
};

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

/**
 * 원문 카드를 세울지.
 *
 * 예전 기준은 `rawInput !== content`였습니다. 그때는 content에 긁어온 본문이
 * 들어 있어서 "원문과 본문이 다르면 원문도 보여준다"는 뜻이었는데, 지금 content에는
 * 구조화 JSON이 들어갑니다. 그래서 이 비교가 정리를 마친 모든 아이템에서 참이 됐고,
 * 링크만 붙여넣은 글에도 URL 한 줄짜리 '공유 원문' 카드가 늘 따라붙었습니다.
 * 바로 위 출처와 아래 링크에 같은 주소가 이미 있어서 같은 것이 세 번 보였습니다.
 *
 * 기준을 다시 세웁니다. 링크를 걷어내고 **남는 글이 있을 때만** 원문입니다.
 * 링크 그 자체는 원문이 아니라 주소입니다.
 */
export function shouldShowRawInputFirst(item: SavedItem) {
  return textWithoutUrls(item.rawInput).length > 0;
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

/**
 * 소스별 색은 색상 하나(rgb)에서 파생시킵니다.
 * 배지 글자색만 테마별로 따로 잡는데, 다크에서 쓰던 연한 톤(#fca5a5 등)은
 * 흰 배경에서 거의 읽히지 않기 때문입니다.
 */
type SourceHue = { rgb: string; darkText: string; lightText: string };

const HUES = {
  red: { rgb: '239, 68, 68', darkText: '#fca5a5', lightText: '#b91c1c' },
  orange: { rgb: '251, 146, 60', darkText: '#fdbb2d', lightText: '#b45309' },
  pink: { rgb: '236, 72, 153', darkText: '#fbcfe8', lightText: '#be185d' },
  blue: { rgb: '59, 130, 246', darkText: '#93c5fd', lightText: '#1d4ed8' },
  amber: { rgb: '249, 115, 22', darkText: '#fcd34d', lightText: '#c2410c' },
  violet: { rgb: '139, 92, 246', darkText: '#c084fc', lightText: '#6d28d9' },
} as const satisfies Record<string, SourceHue>;

function buildTheme(hue: SourceHue, label: string, mode: 'dark' | 'light'): SourceTheme {
  const isDark = mode === 'dark';
  return {
    border: `rgba(${hue.rgb}, ${isDark ? 0.2 : 0.28})`,
    bg: `rgba(${hue.rgb}, ${isDark ? 0.1 : 0.08})`,
    badgeBg: `rgba(${hue.rgb}, ${isDark ? 0.18 : 0.14})`,
    badgeText: isDark ? hue.darkText : hue.lightText,
    label,
  };
}

export function getSourceTheme(sourceType: string, mode: 'dark' | 'light' = 'dark'): SourceTheme {
  switch (sourceType) {
    case 'youtube':
      return buildTheme(HUES.red, 'YouTube', mode);
    case 'parenting':
      return buildTheme(HUES.orange, '육아 👶', mode);
    case 'instagram':
    case 'instagram_post':
    case 'instagram_reel':
    case 'workout':
      return buildTheme(
        HUES.pink,
        sourceType === 'workout'
          ? '홈트/운동'
          : sourceType === 'instagram_reel'
            ? 'Instagram Reel'
            : sourceType === 'instagram_post'
              ? 'Instagram Post'
              : 'Instagram',
        mode
      );
    case 'notion':
    case 'recipe':
      return buildTheme(HUES.red, sourceType === 'recipe' ? '레시피 요리' : 'Notion', mode);
    case 'google_docs':
    case 'google_sheets':
    case 'google_drive':
    case 'google_form':
    case 'travel':
      return buildTheme(
        HUES.blue,
        sourceType === 'travel'
          ? '여행 코스'
          : sourceType === 'google_docs'
            ? 'Google Docs'
            : sourceType === 'google_sheets'
              ? 'Google Sheets'
              : sourceType === 'google_form'
                ? 'Google Form'
                : 'Google Drive',
        mode
      );
    case 'manual_text':
      return buildTheme(HUES.amber, '직접 메모', mode);
    default:
      return buildTheme(HUES.violet, 'Web Link', mode);
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

  // V2는 분야를 값으로 다룹니다. 목록에 없는 분야가 들어와도 그대로 인정해야
  // 새 분야가 '미분류'로 떨어지지 않습니다. 예전처럼 여섯 개를 나열해두면
  // 낚시 글은 분야를 제대로 받고도 화면에서는 미분류로 보입니다.
  const content = readContentV2(item.content);
  const domainKey = content && content.domain.key !== 'other' ? content.domain.key : '';
  if (domainKey) return domainKey;

  const title = item.title.toLowerCase();
  // 본문은 contentText로 분리됐습니다. item.content에는 구조화 데이터만 남아 있어
  // 여기서 본문 키워드를 찾으려면 두 곳을 모두 봐야 합니다.
  // (contentText가 없던 시절 아이템은 content 안에 본문이 들어 있습니다)
  // getItemCategory는 검색어를 칠 때마다 아이템 수만큼 호출됩니다.
  // 본문 전체를 매번 소문자로 복사하면 비용이 커지므로 앞부분만 봅니다.
  // 분류 근거가 되는 단어는 대개 글머리에 나옵니다.
  const scanned = `${(item.contentText ?? '').slice(0, CATEGORY_SCAN_LIMIT)} ${item.content.slice(0, CATEGORY_SCAN_LIMIT)}`.toLowerCase();
  const userNote = (item.userNote || '').toLowerCase();

  const fallback = classifyByKeyword(title, userNote, scanned);
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
  interior: ['인테리어', '방꾸미기', '집꾸미기', '가구배치', '홈스타일링'],
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

/**
 * 기본 분야의 아이콘.
 *
 * 이름과 갈라두었습니다. 이름은 사용자가 고칠 수 있는 값이 됐지만 아이콘은
 * 아닙니다. 하나로 묶어두면 이름을 고치는 순간 아이콘까지 같이 사라집니다.
 */
const CATEGORY_ICONS: Record<string, string> = {
  recipe: '🍳',
  workout: '💪',
  travel: '✈️',
  parenting: '🍼',
  shopping: '🛍️',
  interior: '🛋️',
  other: '🏷️',
};

/** 사전을 읽지 못했을 때 쓰는 기본 분야의 이름. */
export const CATEGORY_LABELS: Record<string, string> = {
  recipe: '레시피',
  workout: '운동',
  travel: '여행',
  parenting: '육아',
  shopping: '공구·꿀템',
  interior: '인테리어',
  other: '미분류',
};

/**
 * 분야 이름.
 *
 * 사전이 먼저입니다. 예전에는 위 목록이 먼저였는데, 그러면 기본 분야는 사용자가
 * 이름을 바꿔도 화면이 그대로였습니다. 사전에 없는 분야만 사전 이름을 쓰는
 * 셈이라, 정작 고칠 수 있는 것과 화면에 보이는 것이 어긋났습니다.
 *
 * 위 목록은 사전을 못 읽었을 때의 대비로 남깁니다. 아이콘만 붙이는 자리를
 * 겸하는데, 아이콘은 분야의 성격이라 이름을 바꿔도 그대로 따라갑니다.
 */
export function getCategoryLabel(category: string, fallbackLabel?: string): string {
  const name =
    fallbackLabel && fallbackLabel !== category
      ? fallbackLabel
      : CATEGORY_LABELS[category];

  if (!name) return `${CATEGORY_LABELS.other} ${CATEGORY_ICONS.other}`;

  return `${name} ${CATEGORY_ICONS[category] ?? '🏷️'}`;
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
/**
 * 화면에 보일 제목.
 *
 * 사용자가 고친 제목이 있으면 그쪽이 우선입니다. AI 제목은 그대로 두기 때문에
 * 재분석을 돌려도 사용자가 고친 것이 덮이지 않습니다.
 */
/**
 * 사용자가 제목으로 쓰라고 적은 글.
 *
 * AI를 끄고 저장할 때 씁니다. 링크와 설명을 같이 적는 일이 흔해서
 * (`https://... 아이방 인테리어`), 링크로 보이는 조각을 걷어낸 나머지를 제목으로
 * 봅니다. 링크만 적었으면 제목이 없는 것이라 null이고, 그때는 링크에서 만든
 * 기본 제목이 그대로 남습니다.
 */
export function extractManualTitle(rawInput: string): string | null {
  const rest = textWithoutUrls(rawInput);

  if (!rest) return null;

  // 긴 글을 통째로 붙여넣고 정리를 끈 경우가 있습니다. 그걸 그대로 제목에 넣으면
  // 목록이 한 줄로 뭉갭니다. 원문은 rawInput에 남으니 제목만 줄입니다.
  return rest.length > MANUAL_TITLE_LIMIT ? `${rest.slice(0, MANUAL_TITLE_LIMIT)}…` : rest;
}

const MANUAL_TITLE_LIMIT = 80;

/** 링크로 보이는 조각을 걷어낸 나머지 글. 없으면 빈 문자열입니다. */
export function textWithoutUrls(raw: string): string {
  return raw
    .split(/\s+/)
    .filter((token) => token && !URL_LIKE.test(token))
    .join(' ')
    .trim();
}

const URL_LIKE =
  /^(?:https?:\/\/|www\.)|^(?:m\.)?(?:youtube\.com|youtu\.be|instagram\.com|notion\.so|notion\.site|app\.notion\.com)\//i;

export function getItemTitle(item: SavedItem): string {
  return item.userTitle?.trim() || item.title;
}

export function filterItems(items: SavedItem[], searchQuery: string): SavedItem[] {
  return items.filter((item) => {
    // 검색어 필터
    if (!searchQuery.trim()) return true;
    const query = searchQuery.trim();

    // 제목, 메모 검색
    // 고친 제목으로도 찾을 수 있어야 합니다. 사용자가 기억하는 건 그쪽입니다.
    if (
      hangulMatch(getItemTitle(item), query) ||
      (item.userNote && hangulMatch(item.userNote, query))
    ) {
      return true;
    }

    // 자연어 카테고리 매핑
    const structured = readContentV2(item.content);
    const category = structured && structured.domain.key !== 'other' ? structured.domain.key : item.sourceType;
    if (category) {
      const lowerQuery = query.toLowerCase();
      if ((lowerQuery === '요리' || lowerQuery === '레시피') && category === 'recipe') return true;
      if ((lowerQuery === '운동' || lowerQuery === '헬스' || lowerQuery === '홈트') && category === 'workout') return true;
      if ((lowerQuery === '여행' || lowerQuery === '호캉스') && category === 'travel') return true;
    }

    // 구조화 데이터 내부 검색
    //
    // 분야를 가리지 않고 모든 항목의 값을 훑습니다. 예전에는 레시피면 재료만,
    // 여행이면 장소만 봤습니다. 그래서 여행 글에 딸려온 재료는 검색되지 않았고,
    // 목록에 없는 분야는 아예 훑을 대상이 없었습니다.
    if (allFactValues(structured).some((value) => hangulMatch(value, query))) return true;

    // 요약도 본문과 같은 규칙으로 봅니다.
    // 세 줄 요약은 짧지 않아서, 자소 순서 매칭을 켜두면 '감자'나 '고기' 같은
    // 흔한 낱말이 관련 없는 요약에 전부 걸립니다. 검색이 아무것도 걸러주지
    // 못하는 것처럼 보이던 원인이었습니다.
    if (matchBodyText(item.summary, query)) return true;

    // 원문/정리본/본문/URL 폴백 검색
    // AI 분류나 구조화 추출이 실패한 아이템도 반드시 다시 찾을 수 있어야 하므로,
    // 저장 당시의 원문과 긁어온 본문 전체를 마지막 그물망으로 사용합니다.
    if (matchBodyText(item.rawInput, query)) return true;
    if (matchBodyText(item.digest, query)) return true;
    if (matchBodyText(item.contentText, query)) return true;
    // 본문/정리본을 별도 컬럼으로 분리하기 전에 저장된 아이템 호환
    if (matchBodyText(legacyText(structured, 'description'), query)) return true;
    if (matchBodyText(legacyText(structured, 'detailedAnalysis'), query)) return true;
    if (matchBodyText(item.sourceUrl, query)) return true;

    // 나중에 붙인 조각(주로 인스타 DM)도 원문 검색에 들어가야 합니다.
    //
    // 원문 검색은 AI가 놓친 것을 건지는 마지막 그물망입니다. DM에만 있는
    // 제품명이 요약에 안 들어갔을 때, 여기가 없으면 그 단어로는 영영 못 찾습니다.
    for (const source of item.sources) {
      if (matchBodyText(source.rawText, query)) return true;
      if (matchBodyText(source.sourceUrl, query)) return true;
    }

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
  const shape = item ? describeSavedItemShape(item) : describeInputCandidate(rawInput);
  const isEnriching = !item || item.aiStatus === 'pending';

  return {
    itemId: item?.id ?? null,
    source,
    title: item ? '수집함에 저장됨' : '저장 요청 완료',
    // 정리는 앱이 떠 있는 동안만 진행됩니다. 공유하고 원래 앱으로 바로 넘어가는
    // 것이 보통이라, 말해주지 않으면 다 된 줄 알고 나갑니다.
    description: isEnriching ? `${shape} · 앱을 벗어나면 정리가 멈춥니다` : shape,
    preview: rawInput.trim().replace(/\s+/g, ' '),
    stateLabel: item ? getAiStatusLabel(item) : '요약 정리 중',
  };
}
