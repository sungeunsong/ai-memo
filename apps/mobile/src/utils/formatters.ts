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

export function getItemCategory(item: SavedItem): string {
  const structured = tryParseStructuredContent(item.content);
  const category = structured?.category || item.sourceType;

  if (category === 'parenting') return 'parenting';
  if (category === 'travel') return 'travel';
  if (category === 'recipe') return 'recipe';
  if (category === 'workout') return 'workout';

  const title = item.title.toLowerCase();
  const content = item.content.toLowerCase();
  const userNote = (item.userNote || '').toLowerCase();

  if (
    title.includes('기저귀') || title.includes('분유') || title.includes('육아') || title.includes('아동') || title.includes('출산') || title.includes('다자녀') ||
    content.includes('기저귀') || content.includes('분유') || content.includes('육아') || content.includes('아동') || content.includes('출산') || content.includes('다자녀') ||
    userNote.includes('기저귀') || userNote.includes('분유') || userNote.includes('육아') || userNote.includes('아동') || userNote.includes('출산')
  ) {
    return 'parenting';
  }

  if (
    title.includes('여행') || title.includes('호캉스') || title.includes('항공권') ||
    content.includes('여행') || content.includes('호캉스') || content.includes('항공권') ||
    userNote.includes('여행') || userNote.includes('호캉스') || userNote.includes('항공권')
  ) {
    return 'travel';
  }

  if (
    title.includes('레시피') || title.includes('요리') || title.includes('조리법') ||
    content.includes('레시피') || content.includes('요리') || content.includes('조리법') ||
    userNote.includes('레시피') || userNote.includes('요리') || userNote.includes('조리법')
  ) {
    return 'recipe';
  }

  if (
    title.includes('운동') || title.includes('루틴') || title.includes('홈트') || title.includes('헬스') ||
    content.includes('운동') || content.includes('루틴') || content.includes('홈트') || content.includes('헬스') ||
    userNote.includes('운동') || userNote.includes('루틴') || userNote.includes('홈트') || userNote.includes('헬스')
  ) {
    return 'workout';
  }

  return 'other';
}

// ==========================================
// 다이나믹 필터 칩 추출
// ==========================================

const KEYWORD_EMOJIS: Record<string, string> = {
  '감자': '🥔', '양파': '🧅', '베이컨': '🥓', '모짜렐라 치즈': '🧀',
  '체다 치즈': '🧀', '생크림': '🥛', '버터': '🧈', '소금': '🧂',
  '후추': '🧂', '치즈': '🧀', '계란': '🥚', '마늘': '🧄',
  '하체': '🔥', '허벅지': '🦵', '둔근': '🍑', '둔근(엉덩이)': '🍑',
  '상체': '💪', '가슴': '🏋️‍♂️', '등': '💪', '복근': '🍫', '코어': '🧘',
  '국내': '🇰🇷', '해외': '✈️', '호캉스': '🏨', '힐링 온천': '♨️',
  '강원도': '🌊', '강릉': '🌊', '제주': '🌴', '오션뷰': '🌊', '온천': '♨️',
};

export type FilterChip = { label: string; value: string };

export function extractDynamicChips(items: SavedItem[], activeCategory: string): FilterChip[] {
  const counts: Record<string, number> = {};

  items.forEach((item) => {
    const category = getItemCategory(item);
    if (activeCategory && category !== activeCategory) {
      return;
    }

    const structured = tryParseStructuredContent(item.content);
    if (category === 'recipe') {
      if (structured && structured.ingredients) {
        (structured.ingredients as string[]).forEach((ing) => {
          counts[ing] = (counts[ing] || 0) + 1;
        });
      }
    } else if (category === 'workout') {
      if (structured && structured.targetMuscles) {
        (structured.targetMuscles as string[]).forEach((muscle) => {
          counts[muscle] = (counts[muscle] || 0) + 1;
        });
      }
    } else if (category === 'travel') {
      if (structured) {
        if (structured.travelTheme) {
          structured.travelTheme.split('/').map((t: string) => t.trim()).forEach((theme: string) => {
            counts[theme] = (counts[theme] || 0) + 1;
          });
        }
        if (structured.highlights) {
          (structured.highlights as string[]).forEach((h) => {
            counts[h] = (counts[h] || 0) + 1;
          });
        }
      }
    }
  });

  const chips: FilterChip[] = [];
  const sortedKeywords = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([key]) => key);

  sortedKeywords.forEach((keyword) => {
    if (keyword === '국내' || keyword === '해외' || keyword === '호캉스') {
      return;
    }
    const emoji = KEYWORD_EMOJIS[keyword] || '🏷';
    chips.push({ label: `#${keyword} ${emoji}`, value: keyword });
  });

  return chips;
}

// ==========================================
// 아이템 필터링 로직
// ==========================================

export function filterItems(
  items: SavedItem[],
  searchQuery: string,
  activeCategory: string,
  activeKeyword: string
): SavedItem[] {
  return items.filter((item) => {
    // 1. 카테고리 필터링 (스마트 폴더)
    if (activeCategory) {
      if (getItemCategory(item) !== activeCategory) {
        return false;
      }
    }

    // 2. 키워드 필터링 (재료, 부위 등)
    if (activeKeyword) {
      const structured = tryParseStructuredContent(item.content);
      if (!structured) return false;

      let found = false;
      const category = getItemCategory(item);
      if (category === 'recipe' && structured.ingredients) {
        found = (structured.ingredients as string[]).some((ing) =>
          ing.toLowerCase().includes(activeKeyword.toLowerCase())
        );
      }
      if (category === 'workout' && structured.targetMuscles) {
        found = found || (structured.targetMuscles as string[]).some((m) =>
          m.toLowerCase().includes(activeKeyword.toLowerCase())
        );
      }
      if (category === 'travel') {
        if (structured.highlights) {
          found = found || (structured.highlights as string[]).some((h) =>
            h.toLowerCase().includes(activeKeyword.toLowerCase())
          );
        }
        if (structured.travelTheme) {
          found = found || structured.travelTheme.toLowerCase().includes(activeKeyword.toLowerCase());
        }
      }
      if (!found) return false;
    }

    // 3. 검색어 필터
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
