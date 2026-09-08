/**
 * 분야와 항목의 정의를 담는 사전(Registry).
 *
 * AI는 글에서 정보를 발견하는 역할만 합니다. 그 정보를 무슨 이름으로 부를지,
 * 어떤 타입인지, 어떻게 정규화할지, 검색에서 어떤 축으로 쓸지는 여기가 정합니다.
 * AI에게 매번 물으면 같은 정보가 글마다 다른 이름과 타입으로 들어와 검색이 어긋납니다.
 */

/** 값의 성격. 정규화와 화면 표시가 여기서 갈립니다. */
export type FactValueType =
  /** 짧은 명사. 재료·부위·지역처럼 조합 검색에 쓰는 값 */
  | 'term'
  /** 자유 서술. 정규화하지 않습니다 */
  | 'text'
  | 'date'
  | 'money'
  | 'duration'
  | 'range'
  | 'measurement';

export type FactCardinality = 'single' | 'many';

/**
 * 값을 어떻게 다듬을지.
 *
 * 'exact'가 중요합니다. 부품번호나 쿠폰 코드는 손대면 안 됩니다.
 * 기존 canonicalize()는 숫자와 단위를 걷어내서 '5Q0 121 251'을 'Q0'으로 만듭니다.
 */
export type NormalizationPolicy =
  /** 수량·단위·수식어를 걷어내고 별칭을 수렴시킵니다 */
  | 'aliasable'
  /** 원문 그대로. 절대 다듬지 않습니다 */
  | 'exact'
  | 'date'
  | 'money'
  | 'duration'
  | 'measurement';

/**
 * 분야를 넘어 같은 관점으로 묶이는 검색 축.
 *
 * fishing:place와 travel:place는 서로 다른 정의입니다. 정규화나 화면 표시를
 * 따로 가져갈 수 있어야 하니까요. 다만 검색에서는 '장소'라는 한 축으로 묶여야
 * '대부도'와 '제주'가 같은 조건으로 걸립니다.
 */
export type GlobalRole =
  | 'place'
  | 'price'
  | 'deadline'
  | 'equipment'
  | 'target'
  | 'topic'
  | 'duration';

/**
 * 정의의 신뢰도.
 *
 * AI가 처음 만든 이름을 곧바로 헌법에 새기면, 첫 글의 우연한 어휘가 영원한
 * 기준이 됩니다. 실제로 낚시 글 하나가 'gear_spec'을, 다른 하나가
 * 'essential_gear'를 만든 적이 있습니다. 몇 번 쓰이는지 보고 올립니다.
 */
export type DefinitionStatus = 'confirmed' | 'provisional';

export type DomainDefinition = {
  key: string;
  label: string;
  status: DefinitionStatus;
  useCount: number;
  createdAt: string;
  updatedAt: string;
};

export type FactDefinition = {
  domainKey: string;
  key: string;
  label: string;
  valueType: FactValueType;
  cardinality: FactCardinality;
  normalizationPolicy: NormalizationPolicy;
  /** 없으면 이 분야 안에서만 쓰이는 축입니다 */
  globalRole: GlobalRole | null;
  status: DefinitionStatus;
  useCount: number;
  createdAt: string;
  updatedAt: string;
};

/** 서로 다른 아이템 몇 개에서 쓰이면 확정으로 올릴지. */
export const CONFIRM_THRESHOLD = 3;
