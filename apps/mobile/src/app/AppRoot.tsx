import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { HomeScreen } from '@/screens/HomeScreen';
import { useAppStore } from '@/store';
import { palette } from '@/theme/palette';

export function AppRoot() {
  const initialize = useAppStore((state) => state.initialize);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" backgroundColor={palette.background} />
      <HomeScreen />
    </SafeAreaProvider>
  );
}
