import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { getSettingAsync, setSettingAsync } from '@/db';
import { Palette } from '@/theme/palette';
import { useThemedStyles } from '@/theme/ThemeContext';
import { spacing } from '@/theme/spacing';

const DISMISS_KEY = 'ui.installHintDismissed';

/**
 * 아이폰 사파리에서 홈 화면 추가를 안내합니다.
 *
 * 안드로이드 크롬은 조건이 맞으면 설치 배너를 스스로 띄우지만, iOS 사파리에는
 * 그런 창구가 없습니다. 사용자가 공유 버튼을 눌러 직접 추가해야 하는데, 그걸
 * 모르면 주소창이 있는 웹페이지로만 쓰게 됩니다.
 *
 * 홈 화면에 추가해두면 보기 좋아지는 것 말고도 실익이 있습니다. iOS는 설치된
 * 웹 앱의 저장소를 훨씬 오래 보존합니다. 그냥 사파리로만 쓰면 한동안 안 들어간
 * 사이에 모아둔 것이 지워질 수 있습니다.
 */
export function InstallHintBanner() {
  const styles = useThemedStyles(createStyles);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!shouldOfferInstall()) return;

    let cancelled = false;
    void (async () => {
      try {
        const dismissed = await getSettingAsync(DISMISS_KEY);
        if (!cancelled && dismissed !== 'true') setIsVisible(true);
      } catch {
        if (!cancelled) setIsVisible(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!isVisible) return null;

  function dismiss() {
    setIsVisible(false);
    void setSettingAsync(DISMISS_KEY, 'true').catch(() => {});
  }

  return (
    <View style={styles.banner}>
      <View style={styles.textColumn}>
        <Text style={styles.title}>홈 화면에 추가하면 앱처럼 쓸 수 있어요</Text>
        <Text style={styles.body}>
          아래 공유 버튼 <Text style={styles.emphasis}>⎙</Text> 를 누르고 “홈 화면에 추가”를
          고르세요. 주소창 없이 열리고, 저장한 것도 더 오래 남습니다.
        </Text>
      </View>
      <Pressable onPress={dismiss} hitSlop={10} style={styles.dismiss}>
        <Text style={styles.dismissText}>✕</Text>
      </Pressable>
    </View>
  );
}

/**
 * 아이폰 사파리이면서 아직 홈 화면에서 열린 게 아닐 때만 보여줍니다.
 * 이미 추가해 쓰는 사람에게 추가하라고 하면 성가시기만 합니다.
 */
function shouldOfferInstall(): boolean {
  if (Platform.OS !== 'web') return false;
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;

  const ua = navigator.userAgent ?? '';
  const isIos = /iPad|iPhone|iPod/.test(ua);
  if (!isIos) return false;

  // 크롬·파이어폭스 iOS판에는 홈 화면 추가가 없습니다. 안내해도 할 수가 없습니다.
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  if (!isSafari) return false;

  const standalone =
    (navigator as unknown as { standalone?: boolean }).standalone === true ||
    window.matchMedia?.('(display-mode: standalone)').matches === true;

  return !standalone;
}

const createStyles = (palette: Palette) =>
  StyleSheet.create({
    banner: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing[3],
      backgroundColor: palette.accentSoft,
      borderBottomWidth: 1,
      borderBottomColor: palette.border,
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[3],
    },
    textColumn: { flex: 1, gap: 2 },
    title: { color: palette.textPrimary, fontSize: 13, fontWeight: '900' },
    body: { color: palette.textSecondary, fontSize: 11, fontWeight: '600', lineHeight: 16 },
    emphasis: { color: palette.accentText, fontWeight: '900' },
    dismiss: { paddingHorizontal: spacing[1] },
    dismissText: { color: palette.textMuted, fontSize: 14, fontWeight: '800' },
  });
