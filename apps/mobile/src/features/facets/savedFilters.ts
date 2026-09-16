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
import { TaxonomyRegistry, axisOf, resolveFact } from '@/features/taxonomy/registry';

const SETTING_KEY = 'savedFilters';

/** 기본 제공 폴더의 식별자 앞머리. 저장 경로에서 이것으로 걸러냅니다. */
export const BUILT_IN_PREFIX = 'sys:';

export function isBuiltInFilter(filter: SavedFilter) {
  return filter.id.startsWith(BUILT_IN_PREFIX);
}

/**
 * 앱이 들고 있는 기본 폴더.
 *
 * **저장하지 않습니다.** 읽을 때 앞에 얹고 쓸 때 걸러냅니다. 한 번 저장해두면
 * 중복 생성, 사용자가 지운 뒤의 부활, 이름 변경, 백업에 실려 다른 기기에서 또
 * 생기는 문제를 전부 따로 막아야 합니다. 저장하지 않으면 그 문제들이 아예 생기지
 * 않습니다.
 *
 * 공구가 첫 손님인 이유: 공동구매는 '무엇에 대한 글인가'가 아니라 '어떻게 사는가'라
 * 분야 탭에 낄 수 없는데, 추천 조건 칩은 건수 순으로 밀려 안 보일 수 있습니다.
 * 늘 같은 자리에 있어야 하는 조건이라 기본으로 둡니다.
 *
 * **축을 코드에 박지 않고 사전에서 구합니다.** 축은 항목 정의에서 파생되는 값이라
 * (globalRole이 있으면 그것, 없으면 `분야.항목`) 기기의 사전이 어떤 상태냐에 따라
 * 달라집니다. 박아두면 어긋나는 순간 조건이 아무것도 못 찾고, 화면에서는 그냥
 * 사라진 것처럼 보여 원인을 짚을 수가 없습니다.
 */
const BUILT_IN_SOURCES = [
  {
    id: `${BUILT_IN_PREFIX}group-buy`,
    name: '🛒 공구 모아보기',
    /** 어느 항목을 가리키는지. 축은 여기서 사전을 보고 정합니다. */
    fact: { domainKey: 'shopping', key: 'purchase_type' },
    value: '공동구매',
  },
];

export function buildBuiltInFilters(registry: TaxonomyRegistry): SavedFilter[] {
  return BUILT_IN_SOURCES.map((source) => {
    const definition = resolveFact(registry, source.fact.domainKey, source.fact.key);

    return {
      id: source.id,
      name: source.name,
      category: '',
      facetKeys: [`${axisOf(definition)}:${source.value}`],
      searchQuery: '',
      createdAt: '',
    };
  });
}

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

/**
 * 예전 축 이름 -> 지금 축.
 *
 * 축 이름이 바뀌면 저장해둔 조건은 아무 데도 걸리지 않습니다. 화면에는 '내 냉장고'가
 * 그대로 있는데 누르면 0건이 나오고, 사용자는 저장한 것이 사라졌다고 느낍니다.
 * 조건은 사용자가 손으로 만든 것이라 다시 만들라고 할 수 없습니다.
 */
const LEGACY_AXES: Record<string, string> = {
  ingredient: 'recipe.ingredient',
  muscle: 'target',
  region: 'place',
  theme: 'travel.theme',
  product: 'shopping.product_type',
  seller: 'shopping.seller',
  /*
   * 구매 방식은 분야 안으로 들어갔다가 다시 나왔습니다.
   *
   * 공동구매는 '무엇에 대한 글인가'가 아니라 '어떻게 사는가'라, 제주 숙박 공구는
   * 여행이고 기저귀 공구는 육아입니다. 분야 안에 두면 '내 공구 모아보기'가 성립하지
   * 않아 다시 분야를 넘는 축으로 올렸습니다.
   *
   * 그래서 옮기는 방향도 반대가 됐습니다. 이 줄을 지우기만 하면 옛 조건(`purchase:…`)은
   * 살아나지만 그 사이에 저장된 것(`shopping.purchase_type:…`)이 없는 축을 가리킨 채
   * 남아, 눌러도 0건인 스마트 폴더가 됩니다.
   */
  'shopping.purchase_type': 'purchase',
  babyAge: 'parenting.baby_age',
  topic: 'parenting.parenting_topic',
  room: 'interior.room_type',
  style: 'interior.interior_style',
  // equipment와 amenity는 이름이 그대로라 옮길 것이 없습니다.
};

function migrateFacetKey(key: string): string {
  const boundary = key.indexOf(':');
  if (boundary <= 0) return key;

  const axis = key.slice(0, boundary);
  const next = LEGACY_AXES[axis];
  return next ? `${next}${key.slice(boundary)}` : key;
}

export async function loadSavedFilters(): Promise<SavedFilter[]> {
  try {
    const raw = await getSettingAsync(SETTING_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    // 읽을 때마다 옮깁니다. 저장된 값은 그대로 두어, 옮기는 규칙이 틀렸을 때
    // 원래 조건이 무엇이었는지 확인할 수 있게 합니다.
    // 예전에 기본 폴더를 저장했더라도 여기서 걸러집니다. 얹는 일은 화면이 하므로
    // 그대로 두면 같은 것이 둘로 보입니다.
    return parsed
      .filter((filter: SavedFilter) => !isBuiltInFilter(filter))
      .map((filter: SavedFilter) => ({
        ...filter,
        facetKeys: Array.isArray(filter.facetKeys) ? filter.facetKeys.map(migrateFacetKey) : [],
      }));
  } catch (error) {
    console.log('[SavedFilters] 불러오기 실패:', error);
    return [];
  }
}

async function persist(filters: SavedFilter[]) {
  // 기본 폴더는 코드가 들고 있습니다. 저장하면 백업에 실려 다른 기기에서 또 생깁니다.
  const stored = filters.filter((filter) => !isBuiltInFilter(filter));
  await setSettingAsync(SETTING_KEY, JSON.stringify(stored));
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

/**
 * 목록을 통째로 갈아끼웁니다.
 *
 * 분야를 합치거나 지울 때 여러 조건이 한꺼번에 바뀝니다. 하나씩 지웠다 넣으면
 * 중간에 앱이 죽었을 때 반만 고쳐진 목록이 남습니다.
 */
export async function replaceSavedFilters(filters: SavedFilter[]): Promise<SavedFilter[]> {
  await persist(filters);
  return filters;
}

export async function removeSavedFilter(
  filters: SavedFilter[],
  id: string
): Promise<SavedFilter[]> {
  // 기본 폴더는 지울 수 없습니다. 지운 것처럼 보이다가 다음에 열면 다시 있으면
  // 고장으로 읽힙니다. 아예 없는 동작으로 둡니다.
  if (id.startsWith(BUILT_IN_PREFIX)) {
    return filters;
  }

  const next = filters.filter((filter) => filter.id !== id);
  await persist(next);
  return next;
}

/** 지금 화면의 조건이 저장할 만한 상태인지. 아무 조건도 없으면 저장할 이유가 없습니다. */
export function isFilterSaveable(category: string, facetKeys: string[], searchQuery: string) {
  return Boolean(category) || facetKeys.length > 0 || Boolean(searchQuery.trim());
}

/**
 * 저장된 조건을 사람이 읽을 수 있는 한 줄로.
 *
 * 분야도 조건입니다. 빼놓으면 '레시피 탭에서 두부'로 저장한 것과 '전체에서 두부'로
 * 저장한 것이 화면에 똑같이 적히고, 둘 다 눌러본 뒤에야 다르다는 걸 알게 됩니다.
 * 분야만 걸어둔 조건은 적을 것이 하나도 없어 '전체'라고 적히기까지 했습니다.
 *
 * 분야는 키가 아니라 이름으로 적습니다. 사전을 읽을 수 있는 쪽에서 넘겨받습니다.
 */
export function describeSavedFilter(
  filter: SavedFilter,
  labelOf: (key: string) => string,
  categoryLabelOf: (key: string) => string
) {
  const parts: string[] = [];
  if (filter.category) parts.push(categoryLabelOf(filter.category));
  parts.push(...filter.facetKeys.map(labelOf));
  if (filter.searchQuery.trim()) parts.push(`"${filter.searchQuery.trim()}"`);
  return parts.join(' · ');
}
