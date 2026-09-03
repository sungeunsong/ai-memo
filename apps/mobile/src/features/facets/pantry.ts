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
import { getItemCategory } from '@/utils/formatters';

import { canonicalize, expand, normalizeToValues } from './normalize';

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

/** 사용자가 입력한 보유 재료를 상위 개념까지 펼쳐 하나의 집합으로 만듭니다. */
export function buildPantrySet(ownedRaw: string[]): Set<string> {
  const owned = new Set<string>();
  for (const raw of ownedRaw) {
    for (const value of normalizeToValues(raw)) {
      owned.add(value);
    }
  }
  return owned;
}

/**
 * 보유 재료 기준으로 레시피를 매칭해 순위를 매깁니다.
 *
 * @param maxMissing 부족 재료가 이 개수를 넘으면 제외합니다.
 *                   전부 보여주면 관련 없는 레시피까지 밀려 들어와 목록이 무의미해집니다.
 */
export function matchPantry(
  items: SavedItem[],
  ownedRaw: string[],
  maxMissing = 2
): PantryMatch[] {
  const owned = buildPantrySet(ownedRaw);
  if (owned.size === 0) return [];

  const matches: PantryMatch[] = [];

  for (const item of items) {
    if (getItemCategory(item) !== 'recipe') continue;

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
      // 상위 개념까지 확인합니다. '치즈'를 가지고 있으면 '모짜렐라 치즈'도 있는 것으로 봅니다.
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
