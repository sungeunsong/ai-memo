import Constants, { ExecutionEnvironment } from 'expo-constants';
import { ShareIntentProvider } from 'expo-share-intent';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { HomeScreen } from '@/screens/HomeScreen';
import { useAppStore } from '@/store';
import { ensureAnonymousSessionAsync, startSupabaseAutoRefresh } from '@/supabase/client';
import { configureNotificationHandler } from '@/features/notifications/bootstrap';

// 앱이 떠 있을 때도 알림이 보이게 합니다. 기본은 안 보여주는데, 공구 알림은
// 지금 움직이라는 뜻이라 앱을 보고 있다고 조용히 넘기면 놓칩니다.
configureNotificationHandler();
import { ThemeProvider, useTheme } from '@/theme/ThemeContext';

export function AppRoot() {
  const initialize = useAppStore((state) => state.initialize);
  const isShareIntentDisabled =
    Platform.OS === 'web' ||
    Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useEffect(() => {
    // 기다리지 않습니다. 첫 화면은 기기에 있는 것만으로 다 그릴 수 있는데,
    // 여기서 await하면 신호가 약한 곳에서 빈 화면이 그만큼 길어집니다.
    // 세션이 실제로 필요한 쪽(AI 정리)에서 다시 부르면 그때 확보됩니다.
    void ensureAnonymousSessionAsync();

    return startSupabaseAutoRefresh();
  }, []);

  return (
    <ShareIntentProvider
      options={{
        disabled: isShareIntentDisabled,
        resetOnBackground: false,
      }}
    >
      <SafeAreaProvider>
        <ThemeProvider>
          <ThemedApp />
        </ThemeProvider>
      </SafeAreaProvider>
    </ShareIntentProvider>
  );
}

/** 상태바 색을 테마와 맞추려면 ThemeProvider 안쪽이어야 합니다. */
function ThemedApp() {
  const { mode, palette } = useTheme();

  return (
    <>
      <StatusBar
        style={mode === 'dark' ? 'light' : 'dark'}
        backgroundColor={palette.background}
      />
      <HomeScreen />
    </>
  );
}
