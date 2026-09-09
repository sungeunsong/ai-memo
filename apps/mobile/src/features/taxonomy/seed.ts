import { FactDefinition, DomainDefinition } from './types';

/**
 * V1의 고정 분야와 25개 필드를 V2 사전의 출발점으로 옮깁니다.
 *
 * 빈 사전에서 시작하면 첫 글의 우연한 어휘가 기준이 됩니다. 실험에서 낚시 글
 * 세 개가 각각 다른 이름을 만들었고, 그중 무엇이 등록되느냐는 순전히 운이었습니다.
 * 이미 쓸모가 검증된 이름들이 있으니 그걸 심어두고 시작합니다.
 *
 * 여기 있는 것은 처음부터 confirmed입니다. AI가 새로 만든 것만 provisional입니다.
 */

type SeedFact = Omit<FactDefinition, 'createdAt' | 'updatedAt' | 'useCount' | 'status'>;

export const SEED_DOMAINS: Array<Pick<DomainDefinition, 'key' | 'label'>> = [
  { key: 'recipe', label: '레시피' },
  { key: 'workout', label: '운동' },
  { key: 'travel', label: '여행' },
  { key: 'parenting', label: '육아' },
  // 화면에 오래 쓰던 이름과 맞춥니다. 이제 이름은 사전 한 곳에만 있습니다.
  { key: 'shopping', label: '공구·꿀템' },
  { key: 'interior', label: '인테리어' },
  // V1에서 'web'이나 'text'로 찍혔던 것들이 갈 자리. 분야를 못 정한 상태입니다.
  { key: 'other', label: '미분류' },
];

/**
 * globalRole을 붙이는 기준은 "분야가 달라도 같은 질문인가"입니다.
 *
 * equipment는 붙였습니다. 레시피의 에어프라이어와 낚시의 뜰채는 둘 다
 * "무엇이 있어야 하나"라는 같은 질문에 답합니다.
 *
 * ingredient는 안 붙였습니다. 재료는 레시피 고유의 축이고, 냉장고 털기가
 * 그 축 하나만 보고 동작합니다. 다른 분야 값이 섞이면 오히려 방해가 됩니다.
 *
 * room_type도 안 붙였습니다. '거실'과 '제주'가 같은 장소 축에 들어가면
 * 조합 검색이 이상해집니다.
 *
 * 주제·테마·품목·스타일도 안 붙였습니다. 한 축으로 묶어놓고 보니 '호캉스'와
 * '이유식'과 '주방용품'이 같은 그룹에 서 있었습니다. 말은 다 '주제'지만
 * 분야마다 뜻이 달라서, 묶어도 같이 걸 일이 없고 고르기만 어려워집니다.
 * 축을 묶는 기준은 이름이 같은 것이 아니라 같은 질문에 답하는 것입니다.
 */
export const SEED_FACTS: SeedFact[] = [
  // 레시피
  { domainKey: 'recipe', key: 'ingredient', label: '재료', valueType: 'term', cardinality: 'many', normalizationPolicy: 'aliasable', globalRole: null },
  { domainKey: 'recipe', key: 'cook_time', label: '조리 시간', valueType: 'duration', cardinality: 'single', normalizationPolicy: 'duration', globalRole: 'duration' },
  { domainKey: 'recipe', key: 'difficulty', label: '난이도', valueType: 'term', cardinality: 'single', normalizationPolicy: 'aliasable', globalRole: null },
  { domainKey: 'recipe', key: 'equipment', label: '조리 도구', valueType: 'term', cardinality: 'many', normalizationPolicy: 'aliasable', globalRole: 'equipment' },

  // 운동
  { domainKey: 'workout', key: 'target_muscle', label: '자극 부위', valueType: 'term', cardinality: 'many', normalizationPolicy: 'aliasable', globalRole: 'target' },
  { domainKey: 'workout', key: 'equipment', label: '운동 도구', valueType: 'term', cardinality: 'many', normalizationPolicy: 'aliasable', globalRole: 'equipment' },
  { domainKey: 'workout', key: 'routine', label: '루틴', valueType: 'text', cardinality: 'many', normalizationPolicy: 'exact', globalRole: null },

  // 여행
  { domainKey: 'travel', key: 'place', label: '장소', valueType: 'term', cardinality: 'many', normalizationPolicy: 'aliasable', globalRole: 'place' },
  { domainKey: 'travel', key: 'theme', label: '테마', valueType: 'term', cardinality: 'many', normalizationPolicy: 'aliasable', globalRole: null },
  { domainKey: 'travel', key: 'budget', label: '예산', valueType: 'money', cardinality: 'single', normalizationPolicy: 'money', globalRole: 'price' },
  { domainKey: 'travel', key: 'highlight', label: '핵심 스팟', valueType: 'text', cardinality: 'many', normalizationPolicy: 'exact', globalRole: null },
  { domainKey: 'travel', key: 'checklist', label: '준비물', valueType: 'term', cardinality: 'many', normalizationPolicy: 'aliasable', globalRole: 'equipment' },

  // 육아
  // 월령은 target을 안 붙였습니다. 자극 부위와 한 축에 서면 '둔근'과 '7~12개월'이
  // 같은 그룹에 담기고, 운동 탭에 육아 글이 딸려 들어옵니다.
  { domainKey: 'parenting', key: 'baby_age', label: '대상 월령', valueType: 'range', cardinality: 'single', normalizationPolicy: 'measurement', globalRole: null },
  { domainKey: 'parenting', key: 'parenting_topic', label: '육아 주제', valueType: 'term', cardinality: 'single', normalizationPolicy: 'aliasable', globalRole: null },

  // 쇼핑
  { domainKey: 'shopping', key: 'product_type', label: '품목', valueType: 'term', cardinality: 'single', normalizationPolicy: 'aliasable', globalRole: null },
  { domainKey: 'shopping', key: 'seller', label: '판매처', valueType: 'term', cardinality: 'single', normalizationPolicy: 'aliasable', globalRole: null },
  { domainKey: 'shopping', key: 'purchase_type', label: '구매 형태', valueType: 'term', cardinality: 'single', normalizationPolicy: 'aliasable', globalRole: null },
  { domainKey: 'shopping', key: 'price', label: '가격', valueType: 'money', cardinality: 'single', normalizationPolicy: 'money', globalRole: 'price' },
  // 마감일은 '마감됨' 경고와 사용자 교정이 걸려 있어 날짜로 다뤄야 합니다.
  { domainKey: 'shopping', key: 'deadline', label: '마감일', valueType: 'date', cardinality: 'single', normalizationPolicy: 'date', globalRole: 'deadline' },

  // 인테리어
  { domainKey: 'interior', key: 'room_type', label: '공간', valueType: 'term', cardinality: 'single', normalizationPolicy: 'aliasable', globalRole: null },
  { domainKey: 'interior', key: 'interior_style', label: '스타일', valueType: 'term', cardinality: 'single', normalizationPolicy: 'aliasable', globalRole: null },
];
