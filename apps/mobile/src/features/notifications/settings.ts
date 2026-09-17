import { getSettingAsync, setSettingAsync } from '@/db';

import { DEFAULT_NOTIFY_SETTING, ItemNotifySetting, NotifyTiming } from './rules';

/**
 * 저장물별 알림 설정.
 *
 * 컬럼을 늘리지 않고 설정 한 칸에 모아둡니다. 컬럼을 만들면 양쪽 스키마와 백업을
 * 다 손봐야 하는데, 이 값은 아직 모양이 굳지 않았습니다. 설정은 이미 백업에 실리고
 * 저장물 id도 복원 때 그대로라 옮겨가도 맞습니다.
 *
 * 켜지 않은 저장물은 여기에 없습니다. 대부분이 그렇습니다.
 */
const SETTING_KEY = 'notify.groupBuy';

export type NotifySettings = Record<string, ItemNotifySetting>;

function isTiming(value: unknown): value is NotifyTiming {
  return value === 'off' || value === 'before' || value === 'morning' || value === 'eve';
}

export async function loadNotifySettingsAsync(): Promise<NotifySettings> {
  try {
    const raw = await getSettingAsync(SETTING_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};

    const result: NotifySettings = {};
    for (const [itemId, value] of Object.entries(parsed as Record<string, unknown>)) {
      const entry = value as Partial<ItemNotifySetting> | null;
      if (!entry) continue;

      result[itemId] = {
        start: isTiming(entry.start) ? entry.start : DEFAULT_NOTIFY_SETTING.start,
        deadline: isTiming(entry.deadline) ? entry.deadline : DEFAULT_NOTIFY_SETTING.deadline,
      };
    }
    return result;
  } catch (error) {
    console.log('[Notify] 설정을 읽지 못했습니다:', error);
    return {};
  }
}

export async function saveNotifySettingsAsync(settings: NotifySettings) {
  await setSettingAsync(SETTING_KEY, JSON.stringify(settings));
}

/**
 * 없어진 저장물의 설정을 걷어냅니다.
 *
 * 저장물을 지워도 이 칸의 줄은 남습니다. 그대로 두면 쓰지 않는 줄이 계속 쌓이고,
 * 나중에 같은 id가 다시 생기면(백업 복원) 켠 적 없는 알림이 켜진 것으로 보입니다.
 */
export function pruneNotifySettings(settings: NotifySettings, aliveItemIds: Set<string>) {
  const next: NotifySettings = {};
  let dropped = 0;

  for (const [itemId, value] of Object.entries(settings)) {
    if (aliveItemIds.has(itemId)) next[itemId] = value;
    else dropped += 1;
  }

  return { next, dropped };
}
