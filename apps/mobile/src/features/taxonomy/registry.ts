/**
 * 사전을 조회하기 좋은 형태로 담아둔 것.
 *
 * fact는 자기 정의를 (domainKey, key)로 가리키기만 합니다. 그 값을 어떻게 다듬을지,
 * 검색에서 어떤 축으로 쓸지, 화면에 뭐라고 쓸지는 전부 여기를 거쳐 결정됩니다.
 * 추출기가 분야 이름을 직접 아는 순간 새 분야를 넣을 때마다 추출기를 고쳐야 하므로,
 * 추출기는 사전만 보게 합니다.
 */

import { SEED_DOMAINS, SEED_FACTS } from './seed';
import { DomainDefinition, FactDefinition, GlobalRole } from './types';

export type TaxonomyRegistry = {
  domains: Map<string, DomainDefinition>;
  /** `${domainKey}.${key}` -> 정의 */
  facts: Map<string, FactDefinition>;
};

/**
 * 사전에서 fact 정의를 찾는 키.
 *
 * 점을 쓰는 이유는 facet 키가 `축:값` 형태이기 때문입니다. 축 안에 콜론이 들어가면
 * 키를 되돌려 읽을 때 축과 값의 경계가 무너집니다.
 */
export function factRef(domainKey: string, key: string): string {
  return `${domainKey}.${key}`;
}

export function buildRegistry(
  domains: DomainDefinition[],
  facts: FactDefinition[]
): TaxonomyRegistry {
  return {
    domains: new Map(domains.map((domain) => [domain.key, domain])),
    facts: new Map(facts.map((fact) => [factRef(fact.domainKey, fact.key), fact])),
  };
}

const NOW = '1970-01-01T00:00:00.000Z';

/**
 * 앱에 심어둔 기본 사전.
 *
 * DB를 아직 못 읽었거나(첫 렌더) 읽을 수 없는 환경(웹)에서도 검색이 동작해야 합니다.
 * seed는 앱이 들고 있는 값이라 DB 없이도 같은 결과를 냅니다.
 */
export const SEED_REGISTRY: TaxonomyRegistry = buildRegistry(
  SEED_DOMAINS.map((domain) => ({
    ...domain,
    status: 'confirmed' as const,
    useCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
  })),
  SEED_FACTS.map((fact) => ({
    ...fact,
    status: 'confirmed' as const,
    useCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
  }))
);

/**
 * 정의를 모르는 fact를 만났을 때 쓰는 값.
 *
 * 값을 건드리지 않는 쪽(exact)으로 둡니다. 잘못 다듬은 값은 원래 무엇이었는지
 * 알 수 없게 되지만, 안 다듬은 값은 정의가 생긴 뒤에 다시 다듬을 수 있습니다.
 * 사전이 비어 있는 상태에서 부품번호 '5Q0 121 251'이 'Q0'이 되는 일을 막습니다.
 */
export function resolveFact(
  registry: TaxonomyRegistry,
  domainKey: string,
  key: string
): FactDefinition {
  const found = registry.facts.get(factRef(domainKey, key));
  if (found) return found;

  return {
    domainKey,
    key,
    label: key,
    valueType: 'term',
    cardinality: 'many',
    normalizationPolicy: 'exact',
    globalRole: null,
    status: 'provisional',
    useCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

export function resolveDomainLabel(registry: TaxonomyRegistry, domainKey: string): string {
  return registry.domains.get(domainKey)?.label ?? domainKey;
}

/**
 * 검색 축.
 *
 * globalRole이 있으면 분야가 달라도 한 축으로 묶입니다. 낚시의 장소와 여행의 장소를
 * 따로 두면 사용자는 '제주'를 두 번 눌러야 하고, 둘을 AND로 걸면 결과가 0이 됩니다.
 * role이 없으면 그 분야 안에서만 쓰는 축입니다.
 */
export function axisOf(definition: FactDefinition): string {
  return definition.globalRole ?? factRef(definition.domainKey, definition.key);
}

/** 분야를 넘는 축의 이름. 여러 분야의 항목이 한 그룹으로 보이므로 중립적인 말이어야 합니다. */
export const ROLE_LABELS: Record<GlobalRole, string> = {
  place: '장소',
  price: '가격',
  deadline: '마감',
  equipment: '도구',
  target: '부위',
  topic: '주제',
  duration: '시간',
};

/** 축의 이름. role 축은 공통 이름을, 분야 전용 축은 그 항목의 이름을 씁니다. */
export function axisLabelOf(registry: TaxonomyRegistry, axis: string): string {
  const roleLabel = ROLE_LABELS[axis as GlobalRole];
  if (roleLabel) return roleLabel;

  const definition = registry.facts.get(axis);
  if (definition) return definition.label;

  // 사전에 없는 축. 키라도 보여주는 편이 빈칸보다 낫습니다.
  return axis.includes('.') ? axis.slice(axis.indexOf('.') + 1) : axis;
}
