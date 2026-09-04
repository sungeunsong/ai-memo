/**
 * facet 역색인과 조합 질의.
 *
 * SQLite 테이블 대신 메모리 역색인을 씁니다. store가 이미 전체 아이템을 들고 있어
 * 별도 마이그레이션이나 sync 스키마 변경 없이 같은 결과를 얻을 수 있고,
 * 수천 건 규모에서는 교집합 연산이 체감되지 않습니다.
 * 컬렉션이 더 커지면 이 모듈의 함수 시그니처를 유지한 채 내부만 SQL로 내리면 됩니다.
 */

import { SavedItem } from '@/features/items/types';

import { getItemCategory } from '@/utils/formatters';

import { Facet, FacetKind, extractFacets, facetKey, parseFacetKey } from './extract';

export type FacetIndex = {
  /** 전체 아이템 id (선택된 facet이 없을 때의 기준 집합) */
  allIds: Set<string>;
  /** facetKey -> 해당 facet을 가진 아이템 id 집합 */
  byKey: Map<string, Set<string>>;
  /** itemId -> 그 아이템이 가진 facet 목록 */
  byItem: Map<string, Facet[]>;
};

export function buildFacetIndex(items: SavedItem[]): FacetIndex {
  const allIds = new Set<string>();
  const byKey = new Map<string, Set<string>>();
  const byItem = new Map<string, Facet[]>();

  for (const item of items) {
    allIds.add(item.id);

    const facets = extractFacets(item);
    byItem.set(item.id, facets);

    for (const facet of facets) {
      const key = facetKey(facet.kind, facet.value);
      let bucket = byKey.get(key);
      if (!bucket) {
        bucket = new Set<string>();
        byKey.set(key, bucket);
      }
      bucket.add(item.id);
    }
  }

  return { allIds, byKey, byItem };
}

function intersect(a: Set<string>, b: Set<string>): Set<string> {
  // 작은 쪽을 순회해야 비용이 작습니다.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  const result = new Set<string>();
  for (const id of small) {
    if (large.has(id)) result.add(id);
  }
  return result;
}

/**
 * 선택된 facet을 모두 만족하는(AND) 아이템 id를 반환합니다.
 * baseIds는 카테고리 탭이나 텍스트 검색으로 이미 좁혀진 집합입니다.
 */
export function selectByFacets(
  index: FacetIndex,
  keys: string[],
  baseIds?: Set<string>
): Set<string> {
  let current = baseIds ?? index.allIds;

  for (const key of keys) {
    const bucket = index.byKey.get(key);
    if (!bucket) return new Set<string>();
    current = intersect(current, bucket);
    if (current.size === 0) break;
  }

  return new Set(current);
}

export type FacetOption = {
  key: string;
  kind: FacetKind;
  value: string;
  /** 이 facet을 추가로 선택했을 때 남는 건수 */
  count: number;
  selected: boolean;
};

/**
 * 지금 상태에서 고를 수 있는 facet과 각각을 눌렀을 때의 결과 건수를 계산합니다.
 *
 * 결과가 0건이 되는 facet은 아예 반환하지 않습니다. 눌러도 빈 화면만 나오는 칩을
 * 띄워두면 사용자는 조합을 시도하다 실패하고 기능 자체를 안 쓰게 됩니다.
 * "보이는 건 반드시 결과가 있다"가 조합 검색 UI의 기본 조건입니다.
 */
export function availableFacets(
  index: FacetIndex,
  selectedKeys: string[],
  baseIds?: Set<string>,
  kinds?: FacetKind[]
): FacetOption[] {
  const selected = new Set(selectedKeys);
  const current = selectByFacets(index, selectedKeys, baseIds);
  const options: FacetOption[] = [];

  for (const [key, bucket] of index.byKey) {
    const parsed = parseFacetKey(key);
    if (!parsed) continue;
    if (kinds && !kinds.includes(parsed.kind)) continue;

    if (selected.has(key)) {
      options.push({
        key,
        kind: parsed.kind,
        value: parsed.value,
        count: current.size,
        selected: true,
      });
      continue;
    }

    const count = intersect(current, bucket).size;
    if (count === 0) continue;

    options.push({
      key,
      kind: parsed.kind,
      value: parsed.value,
      count,
      selected: false,
    });
  }

  // 선택된 것 우선, 그다음 결과가 많은 순
  return options.sort((a, b) => {
    if (a.selected !== b.selected) return a.selected ? -1 : 1;
    if (b.count !== a.count) return b.count - a.count;
    return a.value.localeCompare(b.value);
  });
}

export type Relaxation = {
  /** 이 키를 빼면 */
  dropKey: string;
  dropValue: string;
  /** 이만큼 나옵니다 */
  count: number;
};

/**
 * 결과가 0건일 때, 조건을 하나씩 빼보며 "무엇이 결과를 죽였는지" 알려줍니다.
 * 조합 검색은 여기서 막히면 사용자가 처음부터 다시 조합하다 포기합니다.
 */
export function suggestRelaxations(
  index: FacetIndex,
  selectedKeys: string[],
  baseIds?: Set<string>
): Relaxation[] {
  if (selectedKeys.length === 0) return [];

  const suggestions: Relaxation[] = [];

  for (const key of selectedKeys) {
    const remaining = selectedKeys.filter((candidate) => candidate !== key);
    const count = selectByFacets(index, remaining, baseIds).size;
    if (count === 0) continue;

    suggestions.push({
      dropKey: key,
      dropValue: parseFacetKey(key)?.value ?? key,
      count,
    });
  }

  return suggestions.sort((a, b) => b.count - a.count);
}

/**
 * 카테고리 탭이 포함하는 facet 축.
 *
 * 탭 판정을 카테고리 값 하나로만 하면 놓치는 게 생깁니다.
 * '돌아기랑 갈 만한 강릉 키즈펜션'은 AI가 카테고리를 하나만 고르므로 여행으로
 * 찍히고, 월령·주제 축을 다 갖고도 육아 탭에서는 보이지 않았습니다.
 *
 * 그래서 탭은 "대표 분류가 맞거나, 그 탭의 축을 가진 것"으로 판정합니다.
 * 카테고리는 상세의 대표 표시로 남기고, 탭은 관련된 것을 모두 보여주는 역할을 맡습니다.
 */
const CATEGORY_FACET_KINDS: Record<string, FacetKind[]> = {
  recipe: ['ingredient'],
  workout: ['muscle', 'equipment'],
  travel: ['region', 'amenity', 'theme'],
  parenting: ['babyAge', 'topic'],
  shopping: ['product', 'seller', 'purchase'],
};

export const TAB_CATEGORIES = Object.keys(CATEGORY_FACET_KINDS);

function matchesOneCategory(item: SavedItem, category: string, facets: Facet[]): boolean {
  if (getItemCategory(item) === category) return true;
  const kinds = CATEGORY_FACET_KINDS[category] ?? [];
  return facets.some((facet) => kinds.includes(facet.kind));
}

/**
 * 아이템이 해당 탭에 보여야 하는지 판단합니다.
 *
 * 'other'는 별도로 다룹니다. 어느 탭에도 걸리지 않는 아이템만 모으는 자리라,
 * 분류에서 빠진 것이 '전체' 말고는 갈 곳이 없어 묻히는 일을 막습니다.
 *
 * facet은 이미 만들어둔 색인에서 꺼내 씁니다. 검색어를 칠 때마다 아이템 수만큼
 * 다시 추출하면 비용이 커집니다.
 */
export function matchesCategoryTab(
  index: FacetIndex,
  item: SavedItem,
  tab: string
): boolean {
  if (!tab) return true;

  const facets = index.byItem.get(item.id) ?? [];

  if (tab === 'other') {
    return !TAB_CATEGORIES.some((category) => matchesOneCategory(item, category, facets));
  }

  return matchesOneCategory(item, tab, facets);
}
