/**
 * "집에 이거 있는데 뭐 해먹지?" 를 위한 역방향 조회.
 *
 * 기존 필터가 [레시피 -> 재료 하나로 거르기] 였다면 여기는 방향이 반대입니다.
 * [가진 재료 목록 -> 만들 수 있는 것 순위]. 그래서 결과는 필터가 아니라 랭킹입니다.
 *
 * 완전히 다 갖춘 레시피만 보여주면 실제로는 거의 안 걸립니다.
 * 부족한 재료가 1~2개인 것까지 함께 보여주는 쪽이 훨씬 자주 쓰입니다.
 * 냉장고 앞이 아니라 마트에서 쓰는 기능이 되기 때문입니다.
 */

import { SavedItem } from '@/features/items/types';

import { canonicalize, expand } from './normalize';

export type PantryMatch = {
  item: SavedItem;
  /** 레시피가 요구하는 재료 (정규화된 단위) */
  required: string[];
  owned: string[];
  missing: string[];
  /** 보유 비율 0~1 */
  ratio: number;
};

function safeParse(content: string): any {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * 보유 재료를 대표값으로만 정리합니다. 상위 개념으로 펼치지 않습니다.
 *
 * 펼치면 형제 재료끼리 오판이 납니다.
 * '생크림'과 '모짜렐라 치즈'는 둘 다 '유제품'으로 올라가므로,
 * 보유 재료를 펼쳐두면 생크림만 있어도 치즈가 있다고 판정합니다.
 * 재료가 다 있다고 해놓고 요리하다 막히는 것이 이 기능의 최악의 실패입니다.
 *
 * 계층은 반대 방향으로만 씁니다. 필요한 재료 쪽을 펼쳐서
 * 보유한 상위 개념('치즈')이 하위 요구('모짜렐라 치즈')를 덮게 합니다.
 */
export function buildPantrySet(ownedRaw: string[]): Set<string> {
  const owned = new Set<string>();
  for (const raw of ownedRaw) {
    const canonical = canonicalize(raw);
    if (canonical) owned.add(canonical);
  }
  return owned;
}

/**
 * 보유 재료 기준으로 레시피를 매칭해 순위를 매깁니다.
 *
 * 재료를 하나만 넣어도 그 재료가 들어가는 레시피는 전부 보여줍니다.
 * "감자 있는데 뭐 해먹지"가 이 기능의 출발점인데, 부족 개수로 잘라내면
 * 재료를 몇 개 안 넣은 사람에게는 늘 빈 화면만 나옵니다.
 * 노이즈는 숨겨서가 아니라 완성도 순 정렬과 화면의 구간 나눔으로 다룹니다.
 *
 * @param maxMissing 부족 재료 상한. 기본은 제한 없음.
 */
export function matchPantry(
  items: SavedItem[],
  ownedRaw: string[],
  maxMissing = Number.POSITIVE_INFINITY
): PantryMatch[] {
  const owned = buildPantrySet(ownedRaw);
  if (owned.size === 0) return [];

  const matches: PantryMatch[] = [];

  for (const item of items) {
    // 카테고리로 거르지 않습니다.
    // AI는 아이템당 카테고리를 하나만 정하므로, 여행과 레시피가 한 메모에 섞이면
    // 카테고리가 'travel'로 찍히고 재료가 멀쩡히 있는데도 냉장고 털기에서 빠집니다.
    // 재료가 있으면 레시피로 취급하는 것으로 충분합니다.
    const structured = safeParse(item.content);
    if (!Array.isArray(structured?.ingredients)) continue;

    // 정규화 후 중복을 제거해야 '감자 2개'와 '감자'가 두 번 세어지지 않습니다.
    const required: string[] = [];
    for (const raw of structured.ingredients) {
      if (typeof raw !== 'string') continue;
      const unit = canonicalize(raw);
      if (unit && !required.includes(unit)) {
        required.push(unit);
      }
    }
    if (required.length === 0) continue;

    const ownedUnits: string[] = [];
    const missingUnits: string[] = [];
    for (const unit of required) {
      // 필요한 재료를 상위 개념까지 펼쳐 확인합니다.
      // '치즈'를 가지고 있으면 '모짜렐라 치즈' 요구를 덮지만, 그 반대나
      // '생크림'으로 '모짜렐라 치즈'를 덮는 일은 생기지 않습니다.
      const satisfied = expand(unit).some((value) => owned.has(value));
      if (satisfied) {
        ownedUnits.push(unit);
      } else {
        missingUnits.push(unit);
      }
    }

    if (ownedUnits.length === 0) continue;
    if (missingUnits.length > maxMissing) continue;

    matches.push({
      item,
      required,
      owned: ownedUnits,
      missing: missingUnits,
      ratio: ownedUnits.length / required.length,
    });
  }

  return matches.sort((a, b) => {
    // 부족한 게 적은 순이 우선입니다. 바로 해먹을 수 있는 것이 위로 와야 합니다.
    if (a.missing.length !== b.missing.length) return a.missing.length - b.missing.length;
    if (b.ratio !== a.ratio) return b.ratio - a.ratio;
    return b.owned.length - a.owned.length;
  });
}

/**
 * "하나만 더 사면 되는" 재료를 빈도순으로 모읍니다.
 * 장보기 목록에서 우선순위를 정할 때 쓰는 값입니다.
 */
export function summarizeShoppingWins(matches: PantryMatch[]): { ingredient: string; unlocks: number }[] {
  const counts = new Map<string, number>();

  for (const match of matches) {
    if (match.missing.length !== 1) continue;
    const ingredient = match.missing[0];
    counts.set(ingredient, (counts.get(ingredient) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([ingredient, unlocks]) => ({ ingredient, unlocks }))
    .sort((a, b) => b.unlocks - a.unlocks || a.ingredient.localeCompare(b.ingredient));
}
