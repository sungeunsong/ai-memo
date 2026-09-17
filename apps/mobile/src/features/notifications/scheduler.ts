import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { SavedItem } from '@/features/items/types';
import { getItemTitle } from '@/utils/formatters';
import {
  ItemNotifySetting,
  NotifyKind,
  PlannedNotification,
  planNotification,
} from './rules';

/**
 * 공구 알림 예약.
 *
 * 서버가 보내는 푸시가 아니라 **기기가 스스로 울리는 알림**입니다. 앱이 "이 시각에
 * 띄워달라"고 OS에 맡겨두면 앱이 꺼져 있어도 그때 울립니다. 마감일이 기기에 있으니
 * 알림도 기기에서 겁니다. 서버는 무엇을 저장했는지 알 필요가 없습니다.
 */

/**
 * 우리가 건 알림인지 가려내는 표시.
 *
 * 예약에 우리가 정한 이름표를 붙일 수 있는지는 확실하지 않아서, 확실히 있는
 * content.data에 표시를 남깁니다. 예약 목록을 읽으면 data가 그대로 딸려 오므로
 * 이것만으로 우리 것을 골라내고 대조할 수 있습니다.
 */
const TAG = 'sireong.groupBuy';

/**
 * 안드로이드 알림 채널.
 *
 * 안드로이드 8부터는 채널 없이 띄운 알림이 그냥 사라집니다. 오류도 안 나고 예약도
 * 정상으로 보이는데 그 시각에 아무 일도 안 일어납니다. 실제로 그래서 한 번 헛돌았습니다.
 *
 * 채널을 만들어두면 사용자가 설정에서 이 알림만 따로 끌 수도 있습니다.
 */
const CHANNEL_ID = 'group-buy';

let channelReady: Promise<void> | null = null;

function ensureChannelAsync() {
  if (Platform.OS !== 'android') return Promise.resolve();

  if (!channelReady) {
    channelReady = Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: '공구 알림',
      description: '공구가 열리거나 마감이 다가올 때 알려드립니다.',
      importance: Notifications.AndroidImportance.HIGH,
    })
      .then(() => undefined)
      .catch((error) => {
        console.log('[Notify] 채널을 만들지 못했습니다:', error);
        channelReady = null;
      });
  }

  return channelReady;
}

type ScheduledRef = { id: string; itemId: string; kind: NotifyKind; at: number };

/** 웹은 이 방식으로 알림을 걸 수 없습니다. 브라우저는 서버 구독이 따로 필요합니다. */
export const NOTIFICATIONS_SUPPORTED = Platform.OS !== 'web';

export async function getNotificationPermission() {
  if (!NOTIFICATIONS_SUPPORTED) return 'unsupported' as const;

  const { status } = await Notifications.getPermissionsAsync();
  return status === 'granted' ? ('granted' as const) : ('denied' as const);
}

export async function requestNotificationPermission() {
  if (!NOTIFICATIONS_SUPPORTED) return false;

  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

/** 지금 예약돼 있는 우리 알림들. */
async function listOursAsync(): Promise<ScheduledRef[]> {
  const all = await Notifications.getAllScheduledNotificationsAsync();
  const ours: ScheduledRef[] = [];

  for (const request of all) {
    const data = request.content?.data as Record<string, unknown> | undefined;
    if (data?.tag !== TAG) continue;

    // 예약 시각을 trigger에서 읽지 않습니다.
    //
    // 처음에는 trigger.date를 봤는데 안드로이드가 돌려주는 모양이 달라 늘 0이
    // 나왔습니다. 그러면 대조할 때마다 '시각이 다르다'고 판단해 목록이 바뀔 때마다
    // 취소하고 다시 걸었습니다. 로그에 같은 알림이 세 번 찍혀 드러났습니다.
    //
    // 우리가 넣은 값을 도로 읽으면 남의 모양에 기댈 일이 없습니다.
    ours.push({
      id: request.identifier,
      itemId: String(data.itemId ?? ''),
      kind: data.kind === 'start' ? 'start' : 'deadline',
      at: typeof data.at === 'number' ? data.at : 0,
    });
  }

  return ours;
}

/**
 * 이 저장물로 지금 폰에 걸려 있는 알림.
 *
 * 화면이 '켜짐'만 보여주면 사용자는 정말 걸린 것인지 알 수 없습니다. 우리 상태가
 * 아니라 OS에 물어본 결과를 보여줘야 '켰는데 안 울리면 어쩌지'가 없어집니다.
 */
export async function listScheduledForItemAsync(itemId: string) {
  if (!NOTIFICATIONS_SUPPORTED) return [];

  const ours = await listOursAsync();
  return ours
    .filter((ref) => ref.itemId === itemId)
    .map((ref) => ({ kind: ref.kind, at: new Date(ref.at) }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

function buildMessage(item: SavedItem, plan: PlannedNotification) {
  const title = getItemTitle(item);

  return plan.kind === 'start'
    ? { title: '🚀 공구가 곧 열립니다', body: title }
    : { title: '⏰ 공구 마감이 다가옵니다', body: title };
}

/**
 * 한 저장물에 걸릴 알림을 계산합니다. 화면도 같은 값을 써서 무엇이 언제 울릴지 보여줍니다.
 *
 * 이미 지난 때는 빼고 돌려줍니다. OS에 과거 시각을 주면 즉시 울리거나 무시되는데
 * 둘 다 원하는 동작이 아닙니다.
 */
export function planForItem(
  item: SavedItem,
  setting: ItemNotifySetting,
  startAt: string,
  deadline: string,
  now = new Date()
): PlannedNotification[] {
  const plans = [
    planNotification('start', startAt, setting.start),
    planNotification('deadline', deadline, setting.deadline),
  ];

  return plans.filter(
    (plan): plan is PlannedNotification => plan !== null && plan.at.getTime() > now.getTime()
  );
}

/**
 * 저장물 하나의 알림을 다시 만듭니다.
 *
 * 고치지 않고 **지운 뒤 다시 겁니다.** '마감일이 바뀌었으니 마감 알림만 고치자'처럼
 * 부분만 손대면 경우의 수가 금방 열댓 개가 됩니다. 통째로 다시 만들면 짧고, 몇 번을
 * 불러도 결과가 같습니다.
 */
export async function syncItemNotificationsAsync(item: SavedItem, plans: PlannedNotification[]) {
  if (!NOTIFICATIONS_SUPPORTED) return;

  const ours = await listOursAsync();

  for (const ref of ours) {
    if (ref.itemId === item.id) {
      await Notifications.cancelScheduledNotificationAsync(ref.id).catch(() => {});
    }
  }

  if (plans.length === 0) return;
  if ((await getNotificationPermission()) !== 'granted') return;

  for (const plan of plans) {
    await scheduleAsync(item, plan);
  }
}

async function scheduleAsync(item: SavedItem, plan: PlannedNotification) {
  await ensureChannelAsync();

  const message = buildMessage(item, plan);

  try {
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        ...message,
        data: { tag: TAG, itemId: item.id, kind: plan.kind, at: plan.at.getTime() },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: plan.at,
        channelId: CHANNEL_ID,
      },
    });

    // 예약이 됐는지 눈으로 확인할 길이 이것뿐입니다. 시각이 며칠 뒤면 기다려서
    // 확인할 수가 없고, 조용히 실패하면 알림이 없다는 것조차 모릅니다.
    console.log(`[Notify] 예약 ${plan.kind} · ${plan.at.toLocaleString()} · item ${item.id} (${id})`);
  } catch (error) {
    console.log('[Notify] 예약 실패:', error);
  }
}

/**
 * 앱을 켤 때 전부 맞춰봅니다.
 *
 * 저장물 하나씩 부르는 것으로는 못 잡는 경우가 있습니다. 백업을 복원하면 저장물이
 * 통째로 바뀌고, 앱이 며칠 꺼져 있었으면 그 사이 지나간 것들이 남아 있습니다.
 * 설치 직후에는 예약이 하나도 없습니다.
 *
 * 그래서 OS에 예약된 목록을 통째로 읽어 우리 계산과 대조합니다. 어긋난 것만
 * 고치므로 대개는 아무 일도 하지 않습니다.
 */
export async function reconcileNotificationsAsync(
  wanted: Array<{ item: SavedItem; plans: PlannedNotification[] }>
) {
  if (!NOTIFICATIONS_SUPPORTED) return;
  if ((await getNotificationPermission()) !== 'granted') {
    // 권한이 없으면 예약이 안 됩니다. 남아 있던 것만 거둬들입니다.
    for (const ref of await listOursAsync()) {
      await Notifications.cancelScheduledNotificationAsync(ref.id).catch(() => {});
    }
    return;
  }

  const ours = await listOursAsync();
  const seen = new Set<string>();

  for (const { item, plans } of wanted) {
    for (const plan of plans) {
      const key = `${item.id}:${plan.kind}`;
      seen.add(key);

      // 시각까지 같으면 그대로 둡니다. 다시 걸면 알림이 사라졌다 나타나는 셈이라
      // 대개는 아무 일도 안 하는 편이 낫습니다.
      const existing = ours.find((ref) => `${ref.itemId}:${ref.kind}` === key);
      if (existing && Math.abs(existing.at - plan.at.getTime()) < 60000) continue;

      if (existing) {
        await Notifications.cancelScheduledNotificationAsync(existing.id).catch(() => {});
      }
      await scheduleAsync(item, plan);
    }
  }

  // 우리 계산에 없는 것은 거둬들입니다. 저장물이 지워졌거나 때가 지난 것들입니다.
  for (const ref of ours) {
    if (seen.has(`${ref.itemId}:${ref.kind}`)) continue;
    await Notifications.cancelScheduledNotificationAsync(ref.id).catch(() => {});
  }
}
