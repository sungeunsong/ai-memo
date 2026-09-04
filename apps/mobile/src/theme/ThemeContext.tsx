import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme } from 'react-native';

import { getSettingAsync, setSettingAsync } from '@/db';
import { useAppStore } from '@/store';
import { palettes, type Palette, type ThemeMode } from '@/theme/palette';

/** 'system'은 OS 설정을 따라갑니다. */
export type ThemePreference = ThemeMode | 'system';

const THEME_SETTING_KEY = 'ui.themePreference';

type ThemeContextValue = {
  palette: Palette;
  mode: ThemeMode;
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => void;
  /** 다크 → 라이트 → 시스템 순으로 돌립니다. */
  cyclePreference: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isPreference(value: unknown): value is ThemePreference {
  return value === 'dark' || value === 'light' || value === 'system';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('dark');
  /** 불러오기가 늦게 끝나 사용자가 방금 고른 값을 덮어쓰는 걸 막습니다. */
  const hasUserChosenRef = useRef(false);

  // 설정 테이블은 DB 초기화가 끝나야 존재합니다.
  // 자식 effect가 부모(AppRoot의 initialize)보다 먼저 도는 구조라 isReady를 기다립니다.
  const isDatabaseReady = useAppStore((state) => state.isReady);

  // 저장된 선택을 불러옵니다. 실패하면 기본값(다크)을 유지합니다.
  useEffect(() => {
    if (!isDatabaseReady) return;
    let cancelled = false;
    void (async () => {
      try {
        const saved = await getSettingAsync(THEME_SETTING_KEY);
        if (!cancelled && !hasUserChosenRef.current && isPreference(saved)) {
          setPreferenceState(saved);
        }
      } catch (error) {
        console.log('[Theme] 저장된 테마를 불러오지 못했습니다.', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isDatabaseReady]);

  const setPreference = useCallback((next: ThemePreference) => {
    // 저장은 백그라운드로 흘려보냅니다. 화면 전환을 기다리게 할 이유가 없습니다.
    hasUserChosenRef.current = true;
    setPreferenceState(next);
    void setSettingAsync(THEME_SETTING_KEY, next).catch((error) => {
      console.log('[Theme] 테마 저장에 실패했습니다.', error);
    });
  }, []);

  const mode: ThemeMode =
    preference === 'system' ? (systemScheme === 'light' ? 'light' : 'dark') : preference;

  const cyclePreference = useCallback(() => {
    setPreference(preference === 'dark' ? 'light' : preference === 'light' ? 'system' : 'dark');
  }, [preference, setPreference]);

  const value = useMemo<ThemeContextValue>(
    () => ({ palette: palettes[mode], mode, preference, setPreference, cyclePreference }),
    [mode, preference, setPreference, cyclePreference]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme는 ThemeProvider 안에서만 쓸 수 있습니다.');
  return value;
}

/**
 * 팔레트별로 StyleSheet를 한 번만 만들어 재사용합니다.
 * 팔레트는 테마당 하나뿐인 상수 객체라 캐시 크기가 자라지 않습니다.
 */
const styleCache = new WeakMap<object, WeakMap<object, unknown>>();

export function useThemedStyles<T>(factory: (palette: Palette) => T): T {
  const { palette } = useTheme();
  return useMemo(() => {
    let perFactory = styleCache.get(factory);
    if (!perFactory) {
      perFactory = new WeakMap();
      styleCache.set(factory, perFactory);
    }
    const cached = perFactory.get(palette);
    if (cached) return cached as T;
    const created = factory(palette);
    perFactory.set(palette, created as object);
    return created;
  }, [factory, palette]);
}
