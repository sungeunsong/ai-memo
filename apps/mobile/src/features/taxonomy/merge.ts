/**
 * 분야 합치기의 순수 계산부.
 *
 * AI가 같은 대상을 매번 같은 이름으로 부르지는 않습니다. '자동차 커뮤니티'로
 * 한 번 굳으면 다음 자동차 글은 'car'나 'automotive'로 새 분야를 만들고,
 * 그러면 탭이 둘로 갈립니다. 이름만 고쳐서는 이미 갈라진 것이 합쳐지지 않습니다.
 *
 * 저장을 건드리는 쪽(DB)과 무엇으로 바꿀지 정하는 쪽을 갈라둡니다. 여기는
 * 값만 다루므로 웹의 localStorage와 안드로이드의 SQLite가 같은 규칙을 씁니다.
 */

import { ItemContentV2, ItemFactV2, isContentV2 } from '@/features/items/contentV2';
import { DomainDefinition, FactDefinition } from '@/features/taxonomy/types';

/**
 * 아이템의 구조화 데이터에서 사라질 분야를 남을 분야로 바꿉니다.
 *
 * 바뀐 것이 없으면 null입니다. 부르는 쪽이 그걸로 '이 아이템은 건너뛴다'를
 * 정합니다. 안 바뀐 아이템까지 다시 쓰면 updatedAt이 통째로 밀려서, 목록
 * 순서가 흔들리고 동기화가 전부를 다시 올립니다.
 */
export function rewriteContentForMerge(
  content: ItemContentV2,
  fromKey: string,
  into: { key: string; label: string }
): ItemContentV2 | null {
  const domainMoved = content.domain.key === fromKey;
  const factsMoved = content.facts.some((fact) => fact.domainKey === fromKey);

  if (!domainMoved && !factsMoved) return null;

  return {
    ...content,
    domain: domainMoved ? { key: into.key, label: into.label } : content.domain,
    facts: mergeFactList(
      content.facts.map((fact) =>
        fact.domainKey === fromKey ? { ...fact, domainKey: into.key } : fact
      )
    ),
  };
}

/**
 * 같은 (분야, 항목)으로 겹친 fact를 하나로 모읍니다.
 *
 * 합치기 전에는 서로 다른 분야였던 두 항목이 같은 이름을 갖고 있을 수 있습니다.
 * 그대로 두면 화면에 같은 항목이 두 줄로 서고, 색인도 같은 축을 두 번 셉니다.
 * 값은 양쪽을 이어 붙이되 중복은 버립니다. 순서는 먼저 있던 쪽을 앞에 둡니다.
 */
export function mergeFactList(facts: ItemFactV2[]): ItemFactV2[] {
  const merged = new Map<string, ItemFactV2>();

  for (const fact of facts) {
    const ref = `${fact.domainKey}.${fact.key}`;
    const found = merged.get(ref);

    if (!found) {
      merged.set(ref, { ...fact, values: [...fact.values] });
      continue;
    }

    for (const value of fact.values) {
      if (!found.values.includes(value)) found.values.push(value);
    }
  }

  return [...merged.values()];
}

/** 저장된 문자열을 읽어 합친 결과를 돌려줍니다. V2가 아니거나 안 바뀌면 null입니다. */
export function rewriteSerializedContentForMerge(
  raw: string | null,
  fromKey: string,
  into: { key: string; label: string }
): string | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isContentV2(parsed)) return null;

  const rewritten = rewriteContentForMerge(parsed, fromKey, into);
  return rewritten ? JSON.stringify(rewritten) : null;
}

/**
 * 사라질 분야의 항목 정의 중 남길 것을 고릅니다.
 *
 * 남을 분야에 같은 이름이 이미 있으면 그쪽을 둡니다. 정규화 정책이나 검색 축이
 * 서로 다를 수 있는데, 이미 값이 쌓여 있는 쪽의 규칙을 바꾸면 그 분야 전체의
 * 색인이 흔들립니다. 사라지는 쪽에만 있던 항목은 그대로 옮겨옵니다.
 */
export function planFactMove(
  movingFacts: FactDefinition[],
  survivingFacts: FactDefinition[],
  intoKey: string
): { move: FactDefinition[]; drop: FactDefinition[] } {
  const taken = new Set(
    survivingFacts.filter((fact) => fact.domainKey === intoKey).map((fact) => fact.key)
  );

  const move: FactDefinition[] = [];
  const drop: FactDefinition[] = [];

  for (const fact of movingFacts) {
    if (taken.has(fact.key)) {
      drop.push(fact);
      continue;
    }
    taken.add(fact.key);
    move.push({ ...fact, domainKey: intoKey });
  }

  return { move, drop };
}

/**
 * 남는 분야의 정의를 갱신합니다.
 *
 * 쓰인 횟수는 더합니다. 갈라져 있었을 뿐 같은 분야를 쓴 횟수라, 합쳐놓고
 * 한쪽만 세면 방금 합친 분야가 목록에서 아래로 내려갑니다. 만든 시각은 이른
 * 쪽을 둡니다. 그게 이 분야를 처음 쓴 때입니다.
 */
export function mergeDomainDefinition(
  surviving: DomainDefinition,
  absorbed: DomainDefinition,
  confirmThreshold: number,
  stamp: string
): DomainDefinition {
  const useCount = surviving.useCount + absorbed.useCount;

  return {
    ...surviving,
    useCount,
    status: useCount >= confirmThreshold ? 'confirmed' : surviving.status,
    createdAt:
      absorbed.createdAt < surviving.createdAt ? absorbed.createdAt : surviving.createdAt,
    updatedAt: stamp,
  };
}

/**
 * 저장해둔 조건에서 사라진 분야를 손봅니다.
 *
 * 합치면 남는 쪽으로 바꾸고, 지우면 그 조건에서 분야를 뺍니다(intoKey가 null).
 * 안 고치면 스마트 폴더가 없는 분야를 가리킨 채 남아, 눌러도 늘 0건이 나옵니다.
 * 조건은 사용자가 손으로 만든 것이라 통째로 지우지는 않습니다. 분야만 손봅니다.
 *
 * 조합 조건도 같이 봅니다. 축은 `분야.항목` 모양이라 분야가 옮겨가면 축 이름도
 * 따라 바뀌는데, 한쪽만 고치면 폴더는 살아 있는데 조건 하나가 영영 안 걸립니다.
 */
export function rewriteSavedFilters<T extends { category: string; facetKeys: string[] }>(
  filters: T[],
  fromKey: string,
  intoKey: string | null
): T[] {
  const rewriteAxis = (key: string): string | null => {
    const boundary = key.indexOf(':');
    if (boundary <= 0) return key;

    const axis = key.slice(0, boundary);
    if (axis !== fromKey && !axis.startsWith(`${fromKey}.`)) return key;
    if (!intoKey) return null;

    return `${intoKey}${axis.slice(fromKey.length)}${key.slice(boundary)}`;
  };

  return filters.map((filter) => {
    const category = filter.category === fromKey ? (intoKey ?? '') : filter.category;

    const facetKeys: string[] = [];
    for (const key of filter.facetKeys) {
      const next = rewriteAxis(key);
      if (next && !facetKeys.includes(next)) facetKeys.push(next);
    }

    return { ...filter, category, facetKeys };
  });
}

/** 고정해둔 탭에서 사라진 분야를 남는 분야로 바꿉니다. 이미 있으면 중복을 버립니다. */
export function rewritePinnedTabs(pinned: string[], fromKey: string, intoKey: string): string[] {
  const next: string[] = [];

  for (const key of pinned) {
    const mapped = key === fromKey ? intoKey : key;
    if (!next.includes(mapped)) next.push(mapped);
  }

  return next;
}
