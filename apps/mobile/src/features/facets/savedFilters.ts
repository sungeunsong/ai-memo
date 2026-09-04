/**
 * 조합 조건 저장 (스마트 폴더).
 *
 * 폴더를 손으로 만들어 아이템을 옮겨 담는 대신, "질문"을 저장합니다.
 * '내 냉장고', '주말 강원도'처럼 자주 쓰는 조건에 이름을 붙여두면
 * 정리 없이도 정리된 것처럼 꺼낼 수 있습니다.
 *
 * 아이템에 폴더를 지정하는 방식이 아니라 조건만 저장하므로,
 * 나중에 저장한 아이템도 조건에 맞으면 자동으로 들어옵니다.
 */

import { getSettingAsync, setSettingAsync } from '@/db';

const SETTING_KEY = 'savedFilters';

export type SavedFilter = {
  id: string;
  name: string;
  /** 카테고리 탭. 빈 문자열이면 전체 */
  category: string;
  /** 선택된 facet 키들 (AND) */
  facetKeys: string[];
  /** 함께 저장된 검색어 */
  searchQuery: string;
  createdAt: string;
};

export async function loadSavedFilters(): Promise<SavedFilter[]> {
  try {
    const raw = await getSettingAsync(SETTING_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.log('[SavedFilters] 불러오기 실패:', error);
    return [];
  }
}

async function persist(filters: SavedFilter[]) {
  await setSettingAsync(SETTING_KEY, JSON.stringify(filters));
}

export async function addSavedFilter(
  filters: SavedFilter[],
  input: Omit<SavedFilter, 'id' | 'createdAt'>
): Promise<SavedFilter[]> {
  const next: SavedFilter[] = [
    ...filters,
    {
      ...input,
      // 랜덤 대신 시각 기반으로 둡니다. 목록이 짧아 충돌 걱정이 없고 정렬도 자연스럽습니다.
      id: `f${Date.now()}`,
      createdAt: new Date().toISOString(),
    },
  ];
  await persist(next);
  return next;
}

export async function removeSavedFilter(
  filters: SavedFilter[],
  id: string
): Promise<SavedFilter[]> {
  const next = filters.filter((filter) => filter.id !== id);
  await persist(next);
  return next;
}

/** 지금 화면의 조건이 저장할 만한 상태인지. 아무 조건도 없으면 저장할 이유가 없습니다. */
export function isFilterSaveable(category: string, facetKeys: string[], searchQuery: string) {
  return Boolean(category) || facetKeys.length > 0 || Boolean(searchQuery.trim());
}

/** 저장된 조건을 사람이 읽을 수 있는 한 줄로. */
export function describeSavedFilter(filter: SavedFilter, labelOf: (key: string) => string) {
  const parts: string[] = [];
  if (filter.category) parts.push(filter.category);
  parts.push(...filter.facetKeys.map(labelOf));
  if (filter.searchQuery.trim()) parts.push(`"${filter.searchQuery.trim()}"`);
  return parts.join(' · ');
}
