/**
 * 구조화 내용을 화면에 세울 수 있는 형태로 정리합니다.
 *
 * 상세 화면은 분야마다 카드를 따로 갖고 있었습니다. 레시피 카드는 ingredients를,
 * 여행 카드는 location을 직접 읽었습니다. 그래서 낚시 글은 분야를 제대로 받아도
 * 화면에 아무것도 나오지 않았습니다. 카드를 만들어준 적이 없으니까요.
 *
 * 이제 화면은 사전이 알려주는 대로 그립니다. 무엇을 어떤 이름으로 보여줄지,
 * 목록인지 한 줄인지, 체크해서 쓰는 것인지가 전부 정의에서 나옵니다.
 */

import { TaxonomyRegistry, factRef, resolveFact } from '@/features/taxonomy/registry';
import { FactDefinition, GlobalRole } from '@/features/taxonomy/types';

import { ItemContentV2 } from './contentV2';

export type FactRow = {
  ref: string;
  label: string;
  values: string[];
  /** 여러 개가 담기는 항목. 한 줄이 아니라 목록으로 그립니다 */
  isList: boolean;
  /** 체크해서 쓰는 목록인가 */
  checkable: boolean;
  /** 문장인가. 문장은 배지로 눕히면 잘려 보입니다 */
  isSentence: boolean;
  role: GlobalRole | null;
};

export type DomainSection = {
  domainKey: string;
  label: string;
  rows: FactRow[];
};

/**
 * 장보기 체크는 이 앱이 원래 하던 일이라 남깁니다.
 *
 * 재료에는 globalRole이 없어서 다른 규칙으로는 잡히지 않습니다.
 * 사전에 '체크해서 쓰는 목록인가'를 넣으면 이 예외는 없어집니다.
 */
const CHECKABLE_EXCEPTIONS = new Set([factRef('recipe', 'ingredient')]);

/**
 * 체크박스를 달지 정합니다.
 *
 * 준비물과 절차에는 답니다. 모아야 하거나 해내야 하는 것이라, 어디까지 했는지가
 * 그 자체로 쓸모입니다. 자극 부위나 테마에는 안 답니다. 그건 이 글이 무엇에
 * 대한 것인지를 말해줄 뿐이라, 체크한다는 말이 성립하지 않습니다.
 */
function isCheckable(definition: FactDefinition, ref: string): boolean {
  if (definition.cardinality !== 'many') return false;
  return (
    definition.valueType === 'text' ||
    definition.globalRole === 'equipment' ||
    CHECKABLE_EXCEPTIONS.has(ref)
  );
}

export function buildDomainSections(
  content: ItemContentV2,
  registry: TaxonomyRegistry
): DomainSection[] {
  const sections = new Map<string, DomainSection>();

  for (const fact of content.facts) {
    if (!fact || typeof fact.key !== 'string') continue;

    const values = (Array.isArray(fact.values) ? fact.values : []).filter(
      (value): value is string => typeof value === 'string' && value.trim().length > 0
    );
    if (values.length === 0) continue;

    const definition = resolveFact(registry, fact.domainKey, fact.key);
    const ref = factRef(fact.domainKey, fact.key);

    let section = sections.get(fact.domainKey);
    if (!section) {
      section = {
        domainKey: fact.domainKey,
        // 사전이 먼저입니다. 사전에 없는 분야면 아이템이 들고 있는 이름을 씁니다.
        // AI가 방금 만든 분야는 아직 사전에 등록되기 전일 수 있는데,
        // 그때 'fishing'이라고 적힌 카드를 보여주면 무엇인지 알 수 없습니다.
        label:
          registry.domains.get(fact.domainKey)?.label ??
          (fact.domainKey === content.domain.key ? content.domain.label : fact.domainKey),
        rows: [],
      };
      sections.set(fact.domainKey, section);
    }

    section.rows.push({
      ref,
      label: definition.label,
      values,
      isList: definition.cardinality === 'many' && values.length > 0,
      checkable: isCheckable(definition, ref),
      isSentence: definition.valueType === 'text',
      role: definition.globalRole,
    });
  }

  for (const section of sections.values()) {
    // 한 줄짜리를 위에 둡니다. 목록은 길어서, 아래에 둬야 위쪽이 한눈에 들어옵니다.
    section.rows.sort((a, b) => Number(a.isList) - Number(b.isList));
  }

  // 이 글의 분야를 맨 앞에 둡니다. 여행 글에 딸려온 재료는 그 아래입니다.
  return [...sections.values()].sort((a, b) => {
    if (a.domainKey === content.domain.key) return -1;
    if (b.domainKey === content.domain.key) return 1;
    return 0;
  });
}

/** 특정 항목의 값들. 없으면 빈 배열입니다. */
export function factValues(
  content: ItemContentV2 | null,
  domainKey: string,
  key: string
): string[] {
  if (!content) return [];

  const values: string[] = [];
  for (const fact of content.facts) {
    if (fact?.domainKey !== domainKey || fact.key !== key) continue;
    for (const value of Array.isArray(fact.values) ? fact.values : []) {
      if (typeof value === 'string' && value.trim()) values.push(value);
    }
  }
  return values;
}

/**
 * V1 시절 필드를 읽습니다.
 *
 * 본문과 정리본은 나중에 별도 컬럼으로 분리됐는데, 그 이전에 저장된 아이템은
 * 아직 구조화 데이터 안에 들고 있습니다. V2로 옮기면서 원본을 legacy에 남겨둔
 * 덕분에 그 아이템들도 계속 읽힙니다.
 */
export function legacyText(content: ItemContentV2 | null, field: string): string {
  const value = content?.legacy?.[field];
  return typeof value === 'string' ? value : '';
}

/** 검색이 훑을 수 있도록 모든 항목의 값을 한 줄씩 내놓습니다. */
export function allFactValues(content: ItemContentV2 | null): string[] {
  if (!content) return [];

  const values: string[] = [];
  for (const fact of content.facts) {
    for (const value of Array.isArray(fact?.values) ? fact.values : []) {
      if (typeof value === 'string' && value.trim()) values.push(value);
    }
  }
  return values;
}
