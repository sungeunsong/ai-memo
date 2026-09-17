import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { SavedItem } from '@/features/items/types';
import {
  DEFAULT_NOTIFY_SETTING,
  ItemNotifySetting,
  NOTIFY_OFF,
  NotifyKind,
  NotifyTiming,
  describeTiming,
} from '@/features/notifications/rules';
import {
  NOTIFICATIONS_SUPPORTED,
  getNotificationPermission,
  listScheduledForItemAsync,
  planForItem,
  requestNotificationPermission,
} from '@/features/notifications/scheduler';
import { Palette } from '@/theme/palette';
import { useThemedStyles } from '@/theme/ThemeContext';
import { spacing } from '@/theme/spacing';

const TIMINGS: NotifyTiming[] = ['off', 'before', 'morning', 'eve'];

/**
 * 공구 알림 설정.
 *
 * 켜는 것은 저장물마다입니다. 공구를 담는 사람은 마감을 놓치기 싫어서 담는 것이라
 * 상세를 열면 보이는 자리에 있으면 충분히 찾습니다. 전부 켜두면 원하지 않는 알림이
 * 옵니다.
 *
 * **켰는데 안 울리는 경우가 셋 있어서 그것을 말해줍니다.** 권한이 없거나, 날짜가
 * 없거나, 고른 때가 이미 지났거나입니다. 셋 다 화면이 아무 말도 안 하면 사용자는
 * 고장으로 읽습니다.
 */
export function GroupBuyNotifyCard({
  item,
  startAt,
  deadline,
  setting,
  syncToken,
  onChange,
}: {
  item: SavedItem;
  startAt: string;
  deadline: string;
  setting: ItemNotifySetting | null;
  /**
   * 폰에 다시 물어봐야 할 때마다 바뀌는 값.
   *
   * 마감일을 고치면 예약도 따라 바뀌는데, 카드가 처음 열릴 때만 물어보면 낡은 수를
   * 들고 있게 됩니다. 실제로 '등록된 것이 1건뿐입니다. 다시 켜보세요'가 떴는데
   * 예약은 멀쩡했던 일이 있었습니다.
   */
  syncToken: number;
  /** 저장과 예약까지 끝나면 끝나는 약속. 끝난 뒤에 폰에 확인해야 헛걸음이 없습니다. */
  onChange: (next: ItemNotifySetting | null) => Promise<void>;
}) {
  const styles = useThemedStyles(createStyles);
  const [permission, setPermission] = useState<'granted' | 'denied' | 'unsupported' | null>(null);
  /**
   * 폰에 실제로 걸려 있는 것.
   *
   * 우리가 계산한 값과 따로 둡니다. 둘이 같아야 '정말 켜졌다'고 말할 수 있습니다.
   * 화면 상태만 바꾸면 사용자는 아래 영역이 보였다 사라지는 것으로만 느낍니다.
   */
  const [confirmed, setConfirmed] = useState<Array<{ kind: NotifyKind; at: Date }> | null>(null);

  useEffect(() => {
    void getNotificationPermission().then(setPermission);
  }, []);

  useEffect(() => {
    let alive = true;
    void listScheduledForItemAsync(item.id).then((list) => {
      if (alive) setConfirmed(list);
    });
    return () => {
      alive = false;
    };
  }, [item.id, syncToken]);

  /**
   * 바꾼 뒤에 폰에 확인합니다.
   *
   * 설정이 바뀌는 순간에 확인하면 아직 예약이 안 끝난 상태를 읽습니다. 그러면 방금
   * 켠 사용자에게 '등록된 것이 0건입니다'라고 말하게 됩니다.
   */
  async function applyAsync(next: ItemNotifySetting | null) {
    setConfirmed(null);
    await onChange(next);
    setConfirmed(await listScheduledForItemAsync(item.id));
  }

  // 웹은 이 방식으로 알림을 걸 수 없습니다. 토글만 있고 아무것도 안 울리면
  // 고장으로 보이므로 아예 세우지 않습니다.
  if (!NOTIFICATIONS_SUPPORTED) return null;

  const isOn = setting !== null;
  const plans = isOn ? planForItem(item, setting, startAt, deadline) : [];
  const fellBack = plans.some((plan) => plan.fellBackToMorning);

  async function toggle() {
    if (isOn) {
      await applyAsync(null);
      return;
    }

    if (permission !== 'granted') {
      const granted = await requestNotificationPermission();
      setPermission(granted ? 'granted' : 'denied');
      if (!granted) return;
    }

    await applyAsync(DEFAULT_NOTIFY_SETTING);
  }

  return (
    <View style={[styles.card, isOn && styles.cardOn]}>
      <Pressable onPress={() => void toggle()} style={styles.headerRow}>
        <Text style={styles.title}>🔔 공구 알림</Text>
        <View style={[styles.toggle, isOn && styles.toggleOn]}>
          <Text style={[styles.toggleText, isOn && styles.toggleTextOn]}>{isOn ? '켬' : '끔'}</Text>
        </View>
      </Pressable>

      {isOn ? (
        <>
          <Row
            label="시작 알림"
            kind="start"
            value={setting.start}
            onSelect={(timing) => void applyAsync({ ...setting, start: timing })}
          />
          <Row
            label="마감 알림"
            kind="deadline"
            value={setting.deadline}
            onSelect={(timing) => void applyAsync({ ...setting, deadline: timing })}
          />

          {permission === 'denied' ? (
            <Pressable onPress={() => void Linking.openSettings()}>
              <Text style={styles.warn}>
                알림 권한이 꺼져 있어 울리지 않습니다 · 눌러서 설정 열기
              </Text>
            </Pressable>
          ) : !startAt && !deadline ? (
            <Text style={styles.warn}>시작일도 마감일도 없어 알릴 것이 없습니다</Text>
          ) : plans.length === 0 ? (
            <Text style={styles.warn}>고른 때가 이미 지나 알리지 않습니다</Text>
          ) : (
            <>
              {/* 우리 계산이 아니라 폰에 물어본 결과입니다. */}
              {confirmed === null ? (
                <Text style={styles.hint}>확인하는 중…</Text>
              ) : confirmed.length === plans.length ? (
                <Text style={styles.ok}>✅ 폰에 {confirmed.length}건 등록됐습니다</Text>
              ) : (
                <Text style={styles.warn}>
                  등록된 것이 {confirmed.length}건뿐입니다. 다시 켜보세요
                </Text>
              )}

              {plans.map((plan) => (
                <Text key={plan.kind} style={styles.planText}>
                  {plan.kind === 'start' ? '🚀' : '⏰'} {formatWhen(plan.at)}에 알려드립니다
                </Text>
              ))}
              {fellBack ? (
                <Text style={styles.hint}>시각을 몰라 당일 아침으로 맞췄습니다</Text>
              ) : null}
            </>
          )}
        </>
      ) : null}
    </View>
  );
}

function Row({
  label,
  kind,
  value,
  onSelect,
}: {
  label: string;
  kind: NotifyKind;
  value: NotifyTiming;
  onSelect: (timing: NotifyTiming) => void;
}) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.choices}>
        {TIMINGS.map((timing) => (
          <Pressable
            key={timing}
            onPress={() => onSelect(timing)}
            style={({ pressed }) => [
              styles.choice,
              value === timing && styles.choiceOn,
              pressed && { opacity: 0.6 },
            ]}
          >
            <Text style={[styles.choiceText, value === timing && styles.choiceTextOn]}>
              {describeTiming(kind, timing)}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function formatWhen(at: Date) {
  const month = at.getMonth() + 1;
  const day = at.getDate();
  const hour = String(at.getHours()).padStart(2, '0');
  const minute = String(at.getMinutes()).padStart(2, '0');
  return `${month}월 ${day}일 ${hour}:${minute}`;
}

const createStyles = (palette: Palette) =>
  StyleSheet.create({
    card: {
      marginTop: 12,
      backgroundColor: palette.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: palette.border,
      padding: 12,
      gap: spacing[2],
    },
    // 켜져 있으면 카드 자체가 달라 보여야 합니다. 아래 영역만 나타났다 사라지면
    // 설정을 펼친 것인지 알림이 켜진 것인지 구별되지 않습니다.
    cardOn: {
      borderColor: palette.accent,
      backgroundColor: palette.accentSoft,
    },
    ok: {
      color: palette.success,
      fontSize: 12.5,
      fontWeight: '800',
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    title: {
      color: palette.textPrimary,
      fontSize: 14,
      fontWeight: '800',
    },
    toggle: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: palette.border,
      paddingHorizontal: spacing[3],
      paddingVertical: 3,
    },
    toggleOn: {
      backgroundColor: palette.accent,
      borderColor: palette.accent,
    },
    toggleText: {
      color: palette.textMuted,
      fontSize: 12,
      fontWeight: '800',
    },
    toggleTextOn: {
      color: '#ffffff',
    },
    row: {
      gap: 6,
      marginTop: spacing[2],
    },
    rowLabel: {
      color: palette.textMuted,
      fontSize: 11.5,
      fontWeight: '800',
    },
    choices: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    choice: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: palette.border,
      paddingHorizontal: spacing[3],
      paddingVertical: 5,
    },
    choiceOn: {
      backgroundColor: palette.accentSoft,
      borderColor: palette.accent,
    },
    choiceText: {
      color: palette.textSecondary,
      fontSize: 12,
      fontWeight: '700',
    },
    choiceTextOn: {
      color: palette.accent,
      fontWeight: '800',
    },
    planText: {
      color: palette.textSecondary,
      fontSize: 12.5,
      fontWeight: '600',
    },
    hint: {
      color: palette.textMuted,
      fontSize: 11.5,
    },
    warn: {
      color: palette.warnText,
      fontSize: 12,
      fontWeight: '700',
    },
  });
