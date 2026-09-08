import { SEED_DOMAINS } from '@/features/taxonomy/seed';

/**
 * 아이템의 구조화 데이터 형식.
 *
 * V1은 분야마다 고정된 필드를 스물다섯 개 나열했습니다(ingredients, targetMuscles,
 * travelTheme...). 새 분야를 넣으려면 스키마·프롬프트·색인·화면을 다 고쳐야 했고,
 * 낚시나 캠핑처럼 목록에 없는 분야는 아예 담기지 못했습니다.
 *
 * V2는 분야를 값으로 다룹니다. 어떤 분야가 오든 fact 목록으로 담기고,
 * 그 이름과 규칙은 사전(Registry)이 정합니다.
 */
export const ITEM_CONTENT_VERSION = 2;

export type ItemFactV2 = {
  /**
   * 이 fact가 어느 분야의 정의를 쓰는지.
   *
   * 보통 아이템의 domain과 같지만 다를 수 있습니다. DM 하나에 여행 추천과
   * 레시피가 같이 오는 일이 흔한데, 아이템의 분야는 하나뿐이라 분야로 가르면
   * 나머지 절반이 버려집니다. fact가 자기 정의를 직접 가리키게 두면 둘 다 남습니다.
   */
  domainKey: string;
  key: string;
  /** 원문에 적힌 그대로. 정규화는 사전의 정책에 따라 읽는 쪽에서 합니다. */
  values: string[];
};

export type ItemContentV2 = {
  contentVersion: typeof ITEM_CONTENT_VERSION;
  domain: { key: string; label: string };
  facts: ItemFactV2[];
  /**
   * V1 구조화 데이터 원본.
   *
   * 지금은 'equipment'에 '로드 3.6m'가 통째로 들어가지만, 나중에 로드 길이를
   * 따로 찾고 싶어지면 여기서 다시 뽑아낼 수 있습니다. 크게 담았다가 쪼개는 것은
   * 가능하지만, 버린 것은 되돌릴 수 없습니다.
   */
  legacy?: Record<string, unknown>;
};

/** V1 필드 이름 -> (분야, 항목). 사전의 seed와 짝을 이룹니다. */
const V1_FIELD_MAP: Record<string, { domainKey: string; key: string }> = {
  ingredients: { domainKey: 'recipe', key: 'ingredient' },
  cookTime: { domainKey: 'recipe', key: 'cook_time' },
  difficulty: { domainKey: 'recipe', key: 'difficulty' },
  targetMuscles: { domainKey: 'workout', key: 'target_muscle' },
  equipments: { domainKey: 'workout', key: 'equipment' },
  routine: { domainKey: 'workout', key: 'routine' },
  location: { domainKey: 'travel', key: 'place' },
  travelTheme: { domainKey: 'travel', key: 'theme' },
  budget: { domainKey: 'travel', key: 'budget' },
  highlights: { domainKey: 'travel', key: 'highlight' },
  checklist: { domainKey: 'travel', key: 'checklist' },
  babyAgeMonths: { domainKey: 'parenting', key: 'baby_age' },
  parentingTopic: { domainKey: 'parenting', key: 'parenting_topic' },
  productType: { domainKey: 'shopping', key: 'product_type' },
  seller: { domainKey: 'shopping', key: 'seller' },
  purchaseType: { domainKey: 'shopping', key: 'purchase_type' },
  price: { domainKey: 'shopping', key: 'price' },
  deadline: { domainKey: 'shopping', key: 'deadline' },
  roomType: { domainKey: 'interior', key: 'room_type' },
  interiorStyle: { domainKey: 'interior', key: 'interior_style' },
};

const DOMAIN_LABELS = new Map(SEED_DOMAINS.map((d) => [d.key, d.label]));

/** V1의 category 값 중 분야로 볼 수 없는 것들. 미분류로 보냅니다. */
const NON_DOMAIN_CATEGORIES = new Set(['web', 'text', 'other', '']);

export function isContentV2(parsed: unknown): parsed is ItemContentV2 {
  return (
    typeof parsed === 'object' &&
    parsed !== null &&
    (parsed as { contentVersion?: unknown }).contentVersion === ITEM_CONTENT_VERSION
  );
}

/**
 * 아이템의 구조화 내용을 V2로 읽습니다.
 *
 * 아직 V1인 아이템은 메모리에서만 변환해 씁니다. DB 마이그레이션이 끝나기 전이거나
 * 마이그레이션이 없는 환경(웹)에서도 검색과 화면이 같은 결과를 내야 하기 때문입니다.
 * 저장은 하지 않습니다. 읽기 경로가 데이터를 고치기 시작하면 무엇이 언제 바뀌는지
 * 알 수 없게 됩니다.
 */
export function readContentV2(rawContent: string): ItemContentV2 | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent || '{}');
  } catch {
    parsed = null;
  }
  if (isContentV2(parsed)) return parsed;
  return migrateContentToV2(rawContent);
}

/**
 * V1 구조화 데이터를 V2로 옮깁니다. AI를 다시 부르지 않습니다.
 *
 * 이미 V2면 그대로 돌려줍니다. 같은 데이터에 몇 번을 돌려도 결과가 같아야
 * 마이그레이션을 안심하고 다시 실행할 수 있습니다.
 */
export function migrateContentToV2(rawContent: string): ItemContentV2 | null {
  let parsed: any;
  try {
    parsed = JSON.parse(rawContent || '{}');
  } catch {
    parsed = {};
  }

  if (isContentV2(parsed)) return parsed;
  if (typeof parsed !== 'object' || parsed === null) parsed = {};

  const category = typeof parsed.category === 'string' ? parsed.category : '';
  const domainKey = NON_DOMAIN_CATEGORIES.has(category) || !DOMAIN_LABELS.has(category)
    ? 'other'
    : category;

  const facts: ItemFactV2[] = [];
  for (const [field, target] of Object.entries(V1_FIELD_MAP)) {
    const values = toValues(parsed[field]);
    if (values.length > 0) {
      facts.push({ domainKey: target.domainKey, key: target.key, values });
    }
  }

  return {
    contentVersion: ITEM_CONTENT_VERSION,
    domain: { key: domainKey, label: DOMAIN_LABELS.get(domainKey) ?? '미분류' },
    facts,
    // 원본을 남깁니다. 나중에 더 잘게 쪼갤 때의 근거이고, 옮기다 무언가
    // 놓쳤을 때 되찾을 수 있는 유일한 자리입니다.
    ...(Object.keys(parsed).length > 0 ? { legacy: parsed } : null),
  };
}

/** V1 값은 문자열이거나 문자열 배열입니다. 빈 값과 잡음은 버립니다. */
function toValues(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed ? [trimmed] : [];
  }

  return [];
}
