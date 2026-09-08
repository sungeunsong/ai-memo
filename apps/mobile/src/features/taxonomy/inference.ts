/**
 * AI가 처음 보는 이름을 들고 왔을 때 그 정의를 정합니다.
 *
 * AI는 글에서 정보를 발견하는 역할만 합니다. 그 값을 어떻게 다듬을지, 검색에서
 * 어떤 축으로 쓸지는 사전이 정합니다. 그런데 사전에 없는 이름이 처음 들어오면
 * 누군가는 첫 정의를 만들어야 합니다. 그 판단을 여기서 합니다.
 *
 * 모델에게 "이건 term이고 aliasable이다"까지 물어보지 않습니다. 같은 정보를
 * 글마다 다르게 답하면 사전이 흔들리고, 흔들린 사전은 검색을 어긋나게 만듭니다.
 */

import {
  DomainDefinition,
  FactCardinality,
  FactDefinition,
  FactValueType,
  NormalizationPolicy,
} from './types';
import { TaxonomyRegistry, factRef } from './registry';

export type IncomingFact = {
  domainKey: string;
  key: string;
  label: string;
  values: string[];
};

/**
 * 이름을 사전 키 모양으로 다듬습니다.
 *
 * 같은 뜻인데 'cookTime'과 'cook_time'과 'Cook Time'이 각각 등록되면 사전이
 * 셋으로 갈라집니다. 모델은 표기를 매번 다르게 쓰므로 받는 쪽에서 맞춥니다.
 */
export function normalizeDefinitionKey(raw: string): string {
  return raw
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

/** 값이 문장인지. 문장은 짧은 명사와 다루는 방법이 다릅니다. */
function looksLikeSentence(values: string[]): boolean {
  return values.some((value) => value.length > 25 || /[.!?]\s|다\.$|요\.$/.test(value));
}

/**
 * 같은 이름을 이미 쓰고 있는 정의.
 *
 * 낚시의 장소와 여행의 장소는 서로 다른 정의지만, 값을 다루는 방법은 같아야
 * 합니다. 한쪽만 '강원도 강릉시'를 갈라내면 같은 축에 있으면서도 한쪽 값만
 * 조합에 안 걸립니다. 확정된 정의를 먼저 봅니다. 그게 더 오래 검증된 쪽입니다.
 */
function findSibling(registry: TaxonomyRegistry, key: string): FactDefinition | null {
  let best: FactDefinition | null = null;

  for (const definition of registry.facts.values()) {
    if (definition.key !== key) continue;
    if (!best) {
      best = definition;
      continue;
    }
    if (best.status !== 'confirmed' && definition.status === 'confirmed') {
      best = definition;
      continue;
    }
    if (best.status === definition.status && definition.useCount > best.useCount) {
      best = definition;
    }
  }

  return best;
}

/**
 * 처음 보는 항목의 정의를 만듭니다.
 *
 * 값을 다듬는 정책은 'exact'로 시작합니다. 무엇인지 모르는 값을 다듬으면
 * 부품번호가 두 글자가 되고, 그렇게 잘린 값은 원래 무엇이었는지 알 수 없습니다.
 * 안 다듬은 값은 정책을 바꾼 뒤에 다시 다듬을 수 있습니다.
 * 다만 같은 이름을 이미 쓰는 정의가 있으면 그쪽을 따릅니다. 검증된 판단입니다.
 */
export function deriveFactDefinition(
  registry: TaxonomyRegistry,
  incoming: IncomingFact,
  stamp: string
): FactDefinition {
  const sibling = findSibling(registry, incoming.key);

  const valueType: FactValueType = sibling
    ? sibling.valueType
    : looksLikeSentence(incoming.values)
      ? 'text'
      : 'term';

  const cardinality: FactCardinality = sibling ? sibling.cardinality : 'many';
  const normalizationPolicy: NormalizationPolicy = sibling ? sibling.normalizationPolicy : 'exact';

  return {
    domainKey: incoming.domainKey,
    key: incoming.key,
    label: incoming.label || sibling?.label || incoming.key,
    valueType,
    cardinality,
    normalizationPolicy,
    globalRole: sibling?.globalRole ?? null,
    status: 'provisional',
    useCount: 0,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

/**
 * 이번 응답에서 사전에 새로 넣어야 할 것들.
 *
 * 이미 있는 것은 건드리지 않습니다. 어제 확정한 규칙이 오늘 글 하나 때문에
 * 바뀌면, 같은 검색이 어제와 오늘 다른 결과를 냅니다.
 */
export function collectNewDefinitions(
  registry: TaxonomyRegistry,
  domain: { key: string; label: string },
  facts: IncomingFact[],
  stamp: string
): { domain: DomainDefinition | null; facts: FactDefinition[] } {
  const newDomain: DomainDefinition | null = registry.domains.has(domain.key)
    ? null
    : {
        key: domain.key,
        label: domain.label || domain.key,
        status: 'provisional',
        useCount: 0,
        createdAt: stamp,
        updatedAt: stamp,
      };

  const newFacts: FactDefinition[] = [];
  const seen = new Set<string>();

  for (const fact of facts) {
    const ref = factRef(fact.domainKey, fact.key);
    if (registry.facts.has(ref) || seen.has(ref)) continue;
    seen.add(ref);
    newFacts.push(deriveFactDefinition(registry, fact, stamp));
  }

  return { domain: newDomain, facts: newFacts };
}
