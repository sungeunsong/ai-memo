import Constants, { ExecutionEnvironment } from 'expo-constants';
import { ShareIntentProvider } from 'expo-share-intent';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { HomeScreen } from '@/screens/HomeScreen';
import { useAppStore } from '@/store';
import { palette } from '@/theme/palette';

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
        <StatusBar style="dark" backgroundColor={palette.background} />
        <HomeScreen />
      </SafeAreaProvider>
    </ShareIntentProvider>
  );
}
