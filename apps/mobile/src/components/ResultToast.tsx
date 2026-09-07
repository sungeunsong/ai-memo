import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import { Palette } from '@/theme/palette';
import { useThemedStyles } from '@/theme/ThemeContext';
import { spacing } from '@/theme/spacing';

export type ResultToastTone = 'success' | 'error';

export type ResultToastData = {
  tone: ResultToastTone;
  icon: string;
  title: string;
  detail?: string;
};

type Props = {
  data: ResultToastData | null;
  onDismiss: () => void;
  /** 저절로 사라지기까지의 시간. 읽을 거리가 있으면 길게 잡습니다. */
  durationMs?: number;
};

/**
 * 화면 한가운데에 결과를 알리는 카드.
 *
 * 내보내기나 가져오기는 사용자가 결과를 확실히 알아야 하는 일입니다. 파일이
 * 제대로 나갔는지 모른 채 폰을 초기화하면 되돌릴 수 없기 때문입니다.
 * 시트 아래에 작은 글씨로 적어두면 그냥 지나칩니다.
 */
export function ResultToast({ data, onDismiss, durationMs = 2600 }: Props) {
  const styles = useThemedStyles(createStyles);
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.88)).current;

  useEffect(() => {
    if (!data) return;

    opacity.setValue(0);
    scale.setValue(0.88);

    // 들어올 때는 살짝 튀어오르게, 나갈 때는 조용히 사라지게 합니다.
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 160,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1,
        friction: 6,
        tension: 140,
        useNativeDriver: true,
      }),
    ]).start();

    const timer = setTimeout(hide, durationMs);
    return () => clearTimeout(timer);

    function hide() {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: 180,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 0.94,
          duration: 180,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) onDismiss();
      });
    }
  }, [data, durationMs, onDismiss, opacity, scale]);

  if (!data) return null;

  return (
    // 뒤를 덮되 누르면 바로 닫히게 합니다. 기다리게 만들 이유가 없습니다.
    <Pressable style={styles.overlay} onPress={onDismiss}>
      <Animated.View
        style={[
          styles.card,
          data.tone === 'error' && styles.cardError,
          { opacity, transform: [{ scale }] },
        ]}
      >
        <Text style={styles.icon}>{data.icon}</Text>
        <Text style={styles.title}>{data.title}</Text>
        {data.detail ? <Text style={styles.detail}>{data.detail}</Text> : null}
      </Animated.View>
    </Pressable>
  );
}

const createStyles = (palette: Palette) =>
  StyleSheet.create({
    overlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: palette.overlay,
      zIndex: 2000,
      paddingHorizontal: spacing[6],
    },
    card: {
      minWidth: 220,
      maxWidth: 340,
      alignItems: 'center',
      gap: spacing[2],
      backgroundColor: palette.backgroundStrong,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: palette.success,
      paddingVertical: spacing[6],
      paddingHorizontal: spacing[6],
      shadowColor: palette.shadow,
      shadowOpacity: 0.35,
      shadowRadius: 30,
      shadowOffset: { width: 0, height: 12 },
      elevation: 24,
    },
    cardError: {
      borderColor: palette.dangerText,
    },
    icon: {
      fontSize: 40,
    },
    title: {
      color: palette.textPrimary,
      fontSize: 15,
      fontWeight: '900',
      textAlign: 'center',
    },
    detail: {
      color: palette.textSecondary,
      fontSize: 12,
      fontWeight: '600',
      lineHeight: 18,
      textAlign: 'center',
    },
  });
