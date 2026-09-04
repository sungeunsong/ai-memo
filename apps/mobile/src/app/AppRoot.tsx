import Constants, { ExecutionEnvironment } from 'expo-constants';
import { ShareIntentProvider } from 'expo-share-intent';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { HomeScreen } from '@/screens/HomeScreen';
import { useAppStore } from '@/store';
import { ThemeProvider, useTheme } from '@/theme/ThemeContext';

export function AppRoot() {
  const initialize = useAppStore((state) => state.initialize);
  const isShareIntentDisabled =
    Platform.OS === 'web' ||
    Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

  useEffect(() => {
    void initialize();
  }, [initialize]);

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
