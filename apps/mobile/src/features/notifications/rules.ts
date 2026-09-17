import { parseScheduleAt } from '@/features/items/schedule';

/**
 * 공구 알림을 언제 울릴지.
 *
 * 시작과 마감에 각각 하나씩만 고릅니다. 처음에는 체크박스 여섯 개를 늘어놓을까
 * 했는데, 담을 수 있는 경우는 같으면서 읽기만 어려워집니다.
 */
export type NotifyTiming =
  | 'off'
  /** 그 시각 직전. 시각을 알 때만 뜻이 있습니다 */
  | 'before'
  /** 그날 아침 9시 */
  | 'morning'
  /** 전날 저녁 9시 */
  | 'eve';

export type ItemNotifySetting = {
  start: NotifyTiming;
  deadline: NotifyTiming;
};

/**
 * 켤 때의 기본값.
 *
 * 시작은 직전, 마감은 당일 아침입니다. 공구는 '10시 오픈'처럼 여는 순간에 몰리니
 * 시작은 코앞에 알려야 하고, 마감은 대개 날짜만 아니까 아침에 알리는 편이 맞습니다.
 */
export const DEFAULT_NOTIFY_SETTING: ItemNotifySetting = {
  start: 'before',
  deadline: 'morning',
};

export const NOTIFY_OFF: ItemNotifySetting = { start: 'off', deadline: 'off' };

/** 시작은 30분 전, 마감은 2시간 전. 마감은 조금 더 일찍 알아야 움직일 수 있습니다. */
const BEFORE_MINUTES = { start: 30, deadline: 120 } as const;

const MORNING_HOUR = 9;
const EVE_HOUR = 21;

export type NotifyKind = 'start' | 'deadline';

export type PlannedNotification = {
  kind: NotifyKind;
  at: Date;
  /** 시각을 몰라 'before'에서 물러난 경우. 화면이 그 사실을 적어줍니다. */
  fellBackToMorning: boolean;
};

/**
 * 언제 울릴지 계산합니다. 울릴 것이 없으면 null입니다.
 *
 * 'before'는 시각을 알아야 뜻이 있습니다. `9월 26일까지`처럼 날짜만 아는 공구에
 * 2시간 전을 계산할 수는 없습니다. 그때는 당일 아침으로 물러나되, 물러났다는 사실을
 * 돌려줍니다. 조용히 다른 때에 울리면 사용자는 설정이 무시됐다고 느낍니다.
 */
export function planNotification(
  kind: NotifyKind,
  rawValue: string,
  timing: NotifyTiming
): PlannedNotification | null {
  if (timing === 'off') return null;

  const parsed = parseScheduleAt(rawValue);
  if (!parsed) return null;

  const base = parsed.at;

  if (timing === 'before') {
    if (!parsed.hasTime) {
      return { kind, at: morningOf(base), fellBackToMorning: true };
    }
    return {
      kind,
      at: new Date(base.getTime() - BEFORE_MINUTES[kind] * 60000),
      fellBackToMorning: false,
    };
  }

  if (timing === 'morning') {
    return { kind, at: morningOf(base), fellBackToMorning: false };
  }

  const eve = new Date(base.getFullYear(), base.getMonth(), base.getDate() - 1, EVE_HOUR, 0, 0, 0);
  return { kind, at: eve, fellBackToMorning: false };
}

function morningOf(at: Date) {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate(), MORNING_HOUR, 0, 0, 0);
}

/** 화면에 적을 말. 무엇을 고른 것인지 그대로 읽히게 합니다. */
export function describeTiming(kind: NotifyKind, timing: NotifyTiming): string {
  if (timing === 'off') return '안 받음';
  if (timing === 'morning') return '당일 아침';
  if (timing === 'eve') return '전날 저녁';
  return kind === 'start' ? '30분 전' : '2시간 전';
}
