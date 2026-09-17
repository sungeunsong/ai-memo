import * as Notifications from 'expo-notifications';

import { SavedItem } from '@/features/items/types';
import { readContentV2 } from '@/features/items/contentV2';
import { factValues } from '@/features/items/factView';

import { NOTIFICATIONS_SUPPORTED, planForItem, reconcileNotificationsAsync } from './scheduler';
import { loadNotifySettingsAsync, pruneNotifySettings, saveNotifySettingsAsync } from './settings';

/**
 * 앱이 떠 있을 때 알림이 오면 배너를 띄웁니다.
 *
 * 기본은 '앱이 떠 있으면 안 보여줌'입니다. 그런데 공구 알림은 지금 움직이라는
 * 뜻이라, 앱을 보고 있다고 조용히 넘기면 놓칩니다.
 */
export function configureNotificationHandler() {
  if (!NOTIFICATIONS_SUPPORTED) return;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

function scheduleInputOf(item: SavedItem) {
  const content = readContentV2(item.content);
  return {
    startAt: (item.userStartAt ?? factValues(content, 'shopping', 'start_at')[0] ?? '').trim(),
    deadline: (item.userDeadline ?? factValues(content, 'shopping', 'deadline')[0] ?? '').trim(),
  };
}

/**
 * 앱을 켤 때 예약을 전부 맞춰봅니다.
 *
 * 저장물 하나씩 고치는 것으로는 못 잡는 경우가 있습니다. 백업을 복원하면 저장물이
 * 통째로 바뀌고, 앱이 며칠 꺼져 있었으면 그 사이 지나간 것들이 남습니다.
 *
 * 없어진 저장물의 설정도 여기서 걷어냅니다. 안 지우면 쓰지 않는 줄이 쌓이고,
 * 백업 복원으로 같은 id가 되살아나면 켠 적 없는 알림이 켜진 것으로 보입니다.
 */
export async function reconcileOnLaunchAsync(items: SavedItem[]) {
  if (!NOTIFICATIONS_SUPPORTED) return;

  try {
    const settings = await loadNotifySettingsAsync();
    const alive = new Set(items.map((item) => item.id));
    const { next, dropped } = pruneNotifySettings(settings, alive);

    if (dropped > 0) {
      console.log(`[Notify] 없어진 저장물의 알림 설정 ${dropped}건을 걷어냈습니다.`);
      await saveNotifySettingsAsync(next);
    }

    const wanted = items
      .filter((item) => next[item.id])
      .map((item) => {
        const { startAt, deadline } = scheduleInputOf(item);
        return { item, plans: planForItem(item, next[item.id], startAt, deadline) };
      });

    await reconcileNotificationsAsync(wanted);
  } catch (error) {
    // 알림이 안 맞는다고 앱이 못 뜰 이유는 없습니다.
    console.log('[Notify] 예약을 맞추지 못했습니다:', error);
  }
}

/**
 * 알림을 눌러서 온 경우 그 저장물의 id.
 *
 * 앱이 떠 있을 때와 꺼져 있을 때가 다릅니다. 꺼져 있었다면 이벤트를 받을 손이
 * 아직 없어서, 켜진 뒤에 '무엇을 눌러서 켜졌는지'를 따로 물어봐야 합니다.
 * 이걸 빠뜨리면 알림을 눌러 앱이 켜졌는데 홈 화면만 뜹니다. 가장 흔한 경우가
 * 이쪽입니다.
 */
export async function getItemIdFromColdStartAsync(): Promise<string | null> {
  if (!NOTIFICATIONS_SUPPORTED) return null;

  const response = await Notifications.getLastNotificationResponseAsync();
  return readItemId(response?.notification);
}

export function subscribeNotificationTaps(onOpenItem: (itemId: string) => void) {
  if (!NOTIFICATIONS_SUPPORTED) return () => {};

  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const itemId = readItemId(response.notification);
    if (itemId) onOpenItem(itemId);
  });

  return () => subscription.remove();
}

function readItemId(notification: Notifications.Notification | undefined | null) {
  const data = notification?.request?.content?.data as Record<string, unknown> | undefined;
  const itemId = data?.itemId;
  return typeof itemId === 'string' && itemId ? itemId : null;
}
