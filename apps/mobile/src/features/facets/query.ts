/**
 * facet 역색인과 조합 질의.
 *
 * SQLite 테이블 대신 메모리 역색인을 씁니다. store가 이미 전체 아이템을 들고 있어
 * 별도 마이그레이션이나 sync 스키마 변경 없이 같은 결과를 얻을 수 있고,
 * 수천 건 규모에서는 교집합 연산이 체감되지 않습니다.
 * 컬렉션이 더 커지면 이 모듈의 함수 시그니처를 유지한 채 내부만 SQL로 내리면 됩니다.
 */

import { SavedItem } from '@/features/items/types';
import {
  SEED_REGISTRY,
  TaxonomyRegistry,
  axisLabelOf,
} from '@/features/taxonomy/registry';

import { getItemCategory } from '@/utils/formatters';

import {
  DERIVED_AXIS_LABELS,
  Facet,
  extractItemFacets,
  facetKey,
  parseFacetKey,
} from './extract';

export type FacetIndex = {
  /** 전체 아이템 id (선택된 facet이 없을 때의 기준 집합) */
  allIds: Set<string>;
  /** facetKey -> 해당 facet을 가진 아이템 id 집합 */
  byKey: Map<string, Set<string>>;
  /** itemId -> 그 아이템이 가진 facet 목록 */
  byItem: Map<string, Facet[]>;
  /** itemId -> 그 아이템이 걸쳐 있는 분야들 */
  domainsByItem: Map<string, Set<string>>;
  /** 축 -> 화면에 쓸 이름. 사전이 바뀌면 이름도 따라 바뀝니다 */
  axisLabels: Map<string, string>;
  /** 분야 -> 아이템이 들고 있던 이름. 사전에 아직 없는 분야를 위한 것입니다 */
  domainLabels: Map<string, string>;
};

export function buildFacetIndex(
  items: SavedItem[],
  registry: TaxonomyRegistry = SEED_REGISTRY
): FacetIndex {
  const allIds = new Set<string>();
  const byKey = new Map<string, Set<string>>();
  const byItem = new Map<string, Facet[]>();
  const domainsByItem = new Map<string, Set<string>>();
  const axisLabels = new Map<string, string>();
  const domainLabels = new Map<string, string>();

  for (const item of items) {
    allIds.add(item.id);

    const { facets, domainKeys, domainLabel } = extractItemFacets(item, registry);
    byItem.set(item.id, facets);

    if (domainLabel && !domainLabels.has(domainLabel.key)) {
      domainLabels.set(domainLabel.key, domainLabel.label);
    }

    // 사용자가 직접 고친 분류는 그것만 남깁니다.
    //
    // 예전에는 AI가 정한 분야에 더하기만 했습니다. 그러면 여행 글을 캠핑으로 옮겨도
    // 여행 탭에 그대로 남아서, 옮긴 사람 눈에는 아무 일도 안 일어난 것으로 보입니다.
    // 사람이 손으로 정한 것은 AI의 추측을 밀어냅니다.
    //
    // 검색과 조합 조건은 그대로입니다. 칩은 탭이 아니라 아이템이 들고 있는 facet에서
    // 나오므로, 옮긴 글의 재료나 장소는 새 탭에서도 그대로 걸립니다.
    const chosen = item.userCategory?.trim();
    if (chosen) {
      domainKeys.clear();
      domainKeys.add(chosen);
    } else {
      domainKeys.add(getItemCategory(item));
    }

    // 분야가 하나라도 잡혔으면 미분류에서는 뺍니다. 양쪽에 다 보이면
    // 미분류가 '아직 정리 안 된 것'이라는 뜻을 잃습니다.
    if (domainKeys.size > 1) domainKeys.delete('other');
    domainsByItem.set(item.id, domainKeys);

    for (const facet of facets) {
      if (!axisLabels.has(facet.axis)) {
        axisLabels.set(
          facet.axis,
          DERIVED_AXIS_LABELS[facet.axis] ?? axisLabelOf(registry, facet.axis)
        );
      }

      const key = facetKey(facet.axis, facet.value);
      let bucket = byKey.get(key);
      if (!bucket) {
        bucket = new Set<string>();
        byKey.set(key, bucket);
      }
      bucket.add(item.id);
    }
  }

  return { allIds, byKey, byItem, domainsByItem, axisLabels, domainLabels };
}

/** 축의 이름. 색인에 없는 축이면 키를 그대로 돌려줍니다. */
export function axisLabel(index: FacetIndex, axis: string): string {
  return index.axisLabels.get(axis) ?? axis;
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
  axis: string;
  /** 축의 이름. 칩을 묶어 보여줄 때 씁니다 */
  axisLabel: string;
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
  axes?: string[]
): FacetOption[] {
  const selected = new Set(selectedKeys);
  const current = selectByFacets(index, selectedKeys, baseIds);
  const options: FacetOption[] = [];

  for (const [key, bucket] of index.byKey) {
    const parsed = parseFacetKey(key);
    if (!parsed) continue;
    if (axes && !axes.includes(parsed.axis)) continue;

    const base = {
      key,
      axis: parsed.axis,
      axisLabel: axisLabel(index, parsed.axis),
      value: parsed.value,
    };

    if (selected.has(key)) {
      options.push({ ...base, count: current.size, selected: true });
      continue;
    }

    const count = intersect(current, bucket).size;
    if (count === 0) continue;

    options.push({ ...base, count, selected: false });
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
  dropAxis: string;
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

    const parsed = parseFacetKey(key);
    suggestions.push({
      dropKey: key,
      dropAxis: parsed?.axis ?? '',
      dropValue: parsed?.value ?? key,
      count,
    });
  }

  return suggestions.sort((a, b) => b.count - a.count);
}

/**
 * 아이템이 해당 탭에 보여야 하는지 판단합니다.
 *
 * 대표 분야 하나로만 판정하면 놓치는 게 생깁니다.
 * '돌아기랑 갈 만한 강릉 키즈펜션'은 분야가 하나뿐이라 여행으로 찍히고,
 * 월령과 주제를 다 갖고도 육아 탭에서는 보이지 않았습니다.
 *
 * 그래서 "대표 분야가 맞거나, 그 분야의 항목을 하나라도 가진 것"으로 판정합니다.
 * 대표 분야는 상세의 표시로 남기고, 탭은 관련된 것을 모두 보여주는 역할을 맡습니다.
 *
 * 축이 아니라 분야로 판정하는 이유가 있습니다. 축은 분야를 넘어 묶입니다.
 * 도구 축으로 판정하면 여행 준비물을 가진 숙소 글이 운동 탭에 딸려 들어옵니다.
 *
 * 분야는 이미 만들어둔 색인에서 꺼내 씁니다. 검색어를 칠 때마다 아이템 수만큼
 * 다시 추출하면 비용이 커집니다.
 */
export function matchesCategoryTab(
  index: FacetIndex,
  item: SavedItem,
  tab: string
): boolean {
  if (!tab) return true;

  const domains = index.domainsByItem.get(item.id);
  if (!domains) return false;

  // 'other'는 분야를 못 정한 것들의 자리입니다. 분류에서 빠진 것이
  // '전체' 말고는 갈 곳이 없어 묻히는 일을 막습니다.
  if (tab === 'other') {
    return domains.has('other') || domains.size === 0;
  }

  return domains.has(tab);
}
