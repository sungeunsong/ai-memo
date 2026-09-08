/**
 * 탭 목록.
 *
 * 탭은 여섯 개로 고정이었습니다. 사전에 새 분야가 생겨도 탭은 늘지 않아서,
 * 낚시 글은 저장되고 검색도 되는데 목록에서 꺼낼 자리가 없었습니다.
 *
 * 그렇다고 분야가 생길 때마다 탭을 하나씩 늘리면 스무 개가 됩니다. 그건 탭이
 * 아니라 목록이고, 가로로 한참 밀어야 원하는 걸 찾게 됩니다.
 * 그래서 몇 개만 세우고 나머지는 '더보기'에 둡니다. 무엇을 세울지는 사용자가
 * 고정으로 정하고, 정하지 않으면 많이 모인 순으로 세웁니다.
 */

import { getSettingAsync, setSettingAsync } from '@/db';
import { TaxonomyRegistry } from '@/features/taxonomy/registry';
import { getCategoryLabel } from '@/utils/formatters';

import { FacetIndex } from './query';

export type TabOption = {
  key: string;
  label: string;
  count: number;
};

/** 분야를 안 정한 것들이 가는 자리. 늘 맨 끝입니다. */
export const OTHER_TAB_KEY = 'other';

/**
 * 한 번에 세우는 탭 수.
 *
 * 화면 폭에 맞춰 몇 개까지 손이 닿는지가 기준입니다. 이보다 많아지면
 * 가로로 밀어야 하는데, 밀어서 찾을 바에는 '더보기'로 한 번에 보는 편이 빠릅니다.
 */
export const DEFAULT_VISIBLE_TABS = 5;

/**
 * 아이템이 있는 분야만 탭이 됩니다.
 *
 * 사전에 있다고 다 세우면, 한 번도 안 쓴 분야가 자리를 차지합니다.
 * 고정해둔 분야는 지금 비어 있어도 남깁니다. 사용자가 거기 두기로 한 자리입니다.
 */
export function buildTabOptions(
  index: FacetIndex,
  registry: TaxonomyRegistry,
  pinned: string[] = []
): TabOption[] {
  const counts = new Map<string, number>();

  for (const domains of index.domainsByItem.values()) {
    for (const domainKey of domains) {
      counts.set(domainKey, (counts.get(domainKey) ?? 0) + 1);
    }
  }

  for (const key of pinned) {
    if (!counts.has(key)) counts.set(key, 0);
  }

  const options: TabOption[] = [];
  for (const [key, count] of counts) {
    if (key === OTHER_TAB_KEY) continue;
    options.push({ key, label: labelOf(index, registry, key), count });
  }

  options.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  // 미분류는 늘 끝입니다. 건수가 많다고 앞에 서면, 정리되지 않은 것이
  // 가장 먼저 보이는 화면이 됩니다.
  const otherCount = counts.get(OTHER_TAB_KEY) ?? 0;
  if (otherCount > 0) {
    options.push({ key: OTHER_TAB_KEY, label: getCategoryLabel(OTHER_TAB_KEY), count: otherCount });
  }

  return options;
}

/**
 * 탭에 적을 이름.
 *
 * 사전이 먼저입니다. 사전에 없으면 아이템이 들고 있던 이름을 씁니다.
 * AI가 방금 만든 분야는 아직 등록 전일 수 있는데, 그때 'fishing'이라고 적힌
 * 탭을 보여주면 무엇인지 알 수 없습니다.
 */
function labelOf(index: FacetIndex, registry: TaxonomyRegistry, key: string): string {
  const label = registry.domains.get(key)?.label ?? index.domainLabels.get(key);
  return getCategoryLabel(key, label);
}

/**
 * 지금 화면에 세울 탭.
 *
 * 고정한 것이 있으면 그것만 세웁니다. 고정하지 않았으면 많이 모인 순입니다.
 * 지금 보고 있는 탭은 고정하지 않았어도 세웁니다. 눌러서 들어간 탭이 화면에서
 * 사라지면 어디에 있는지 알 수 없게 됩니다.
 */
export function resolveVisibleTabs(
  options: TabOption[],
  pinned: string[],
  activeKey: string
): TabOption[] {
  const byKey = new Map(options.map((option) => [option.key, option]));

  const visible: TabOption[] =
    pinned.length > 0
      ? pinned.map((key) => byKey.get(key)).filter((option): option is TabOption => Boolean(option))
      : options.slice(0, DEFAULT_VISIBLE_TABS);

  if (activeKey && !visible.some((option) => option.key === activeKey)) {
    const active = byKey.get(activeKey);
    if (active) visible.push(active);
  }

  return visible;
}

const SETTING_KEY = 'pinnedTabs';

export async function loadPinnedTabs(): Promise<string[]> {
  try {
    const raw = await getSettingAsync(SETTING_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((key) => typeof key === 'string') : [];
  } catch (error) {
    console.log('[Tabs] 고정 탭을 불러오지 못했습니다:', error);
    return [];
  }
}

export async function savePinnedTabs(keys: string[]): Promise<string[]> {
  await setSettingAsync(SETTING_KEY, JSON.stringify(keys));
  return keys;
}

/** 고정을 켜고 끕니다. 누른 순서가 곧 탭 순서입니다. */
export function togglePinned(pinned: string[], key: string): string[] {
  return pinned.includes(key) ? pinned.filter((entry) => entry !== key) : [...pinned, key];
}
