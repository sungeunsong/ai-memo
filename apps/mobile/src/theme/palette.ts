/**
 * 테마 팔레트.
 *
 * 다크/라이트 두 벌을 같은 키 집합으로 유지합니다.
 * 컴포넌트는 팔레트를 직접 import 하지 않고 useThemedStyles로 받아 씁니다.
 * (StyleSheet.create는 모듈 로드 시점에 값을 굳히기 때문에,
 *  정적으로 import 하면 테마를 바꿔도 화면이 따라오지 않습니다.)
 */
export const darkPalette = {
  background: '#090d16',
  backgroundStrong: '#0f1524',
  surface: 'rgba(255, 255, 255, 0.05)',
  surfaceRaised: 'rgba(255, 255, 255, 0.08)',
  surfaceStrong: 'rgba(255, 255, 255, 0.12)',
  textPrimary: '#f8fafc',
  textSecondary: '#94a3b8',
  textMuted: '#64748b',
  accent: '#8b5cf6',
  accentStrong: '#3b82f6',
  border: 'rgba(255, 255, 255, 0.07)',
  borderStrong: 'rgba(255, 255, 255, 0.15)',
  pending: '#fbbf24',
  pendingText: '#fbbf24',
  success: '#10b981',
  successSoft: 'rgba(16, 185, 129, 0.1)',
  shadow: 'rgba(0, 0, 0, 0.3)',
  dangerSoft: 'rgba(239, 68, 68, 0.1)',
  dangerText: '#ef4444',

  // 아래는 컴포넌트에 흩어져 있던 하드코딩 색을 토큰으로 끌어올린 것들입니다.
  // 라이트 테마에서 연보라/연노랑 글자가 흰 배경에 묻히는 걸 막습니다.
  accentText: '#c084fc',
  accentLink: '#a78bfa',
  accentSoft: 'rgba(139, 92, 246, 0.12)',
  accentBorder: 'rgba(139, 92, 246, 0.25)',
  warnText: '#fbbf24',
  warnSoft: 'rgba(245, 158, 11, 0.12)',
  warnBorder: 'rgba(245, 158, 11, 0.35)',
  infoText: '#93c5fd',
  onAccent: '#ffffff',
  overlay: 'rgba(0, 0, 0, 0.7)',
} as const;

export type Palette = { [K in keyof typeof darkPalette]: string };

export const lightPalette: Palette = {
  background: '#f4f6fb',
  backgroundStrong: '#ffffff',
  surface: 'rgba(15, 23, 42, 0.035)',
  surfaceRaised: '#ffffff',
  surfaceStrong: 'rgba(15, 23, 42, 0.075)',
  textPrimary: '#0f172a',
  textSecondary: '#475569',
  textMuted: '#7c8899',
  accent: '#7c3aed',
  accentStrong: '#2563eb',
  border: 'rgba(15, 23, 42, 0.09)',
  borderStrong: 'rgba(15, 23, 42, 0.16)',
  pending: '#d97706',
  pendingText: '#b45309',
  success: '#047857',
  successSoft: 'rgba(5, 150, 105, 0.12)',
  shadow: 'rgba(15, 23, 42, 0.14)',
  dangerSoft: 'rgba(220, 38, 38, 0.09)',
  dangerText: '#dc2626',

  accentText: '#6d28d9',
  accentLink: '#5b21b6',
  accentSoft: 'rgba(124, 58, 237, 0.09)',
  accentBorder: 'rgba(124, 58, 237, 0.22)',
  warnText: '#b45309',
  warnSoft: 'rgba(245, 158, 11, 0.14)',
  warnBorder: 'rgba(217, 119, 6, 0.35)',
  infoText: '#1d4ed8',
  onAccent: '#ffffff',
  overlay: 'rgba(15, 23, 42, 0.4)',
};

export type ThemeMode = 'dark' | 'light';

export const palettes: Record<ThemeMode, Palette> = {
  dark: darkPalette,
  light: lightPalette,
};
