import { createClient, Session, SupabaseClient } from '@supabase/supabase-js';
import { AppState, AppStateStatus, Platform } from 'react-native';

// 안드로이드에는 localStorage가 없습니다. supabase-js는 세션을 그 위에 얹기 때문에,
// 폴리필이 없으면 앱을 껐다 켤 때마다 로그인이 풀리고 익명 계정이 매번 새로 생깁니다.
// 계정이 갈리면 그 계정에 묶인 사용량·공유가 통째로 남남이 됩니다.
// expo-sqlite가 SQLite로 구현한 localStorage를 들고 있어 새 의존성 없이 해결되고,
// SecureStore를 쓸 때 걸리는 2048바이트 제한(JWT가 그보다 깁니다)도 통째로 피합니다.
if (Platform.OS !== 'web') {
  require('expo-sqlite/localStorage/install');
}

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

let client: SupabaseClient | null = null;

/**
 * 설정이 없으면 null입니다.
 *
 * 설정이 없다고 앱이 죽으면 안 됩니다. 시렁은 local-first라 서버 없이도 저장과 검색이
 * 전부 돌아가고, 서버가 필요한 것은 AI 정리와 공유뿐입니다. 부르는 쪽에서 null을 보면
 * 그 기능만 접고 나머지는 그대로 갑니다.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  if (!client) {
    client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // 주소창에서 로그인 결과를 주워오는 동작입니다. 네이티브에는 주소창이 없고,
        // 소셜 로그인을 붙이기 전까지는 웹에서도 주워올 것이 없습니다.
        detectSessionInUrl: Platform.OS === 'web',
      },
    });
  }

  return client;
}

let sessionPromise: Promise<Session | null> | null = null;

/**
 * 익명 세션을 확보합니다. 이미 있으면 그대로 씁니다.
 *
 * 사용자 눈에는 아무것도 보이지 않습니다. 로그인 화면을 세우려는 것이 아니라,
 * 서버가 "이 요청이 누구 것인가"를 알아야 하기 때문입니다. 그걸 모르면 사용량 상한을
 * 사람별로 못 매기고(한 명이 다 쓰면 나머지가 막힙니다), RLS도 판단 근거가 없습니다.
 *
 * 진행 중인 요청을 공유하는 이유는 signInAnonymously가 부를 때마다 계정을 새로 만들기
 * 때문입니다. 앱 시작과 첫 저장이 겹치면 한 사람 몫으로 계정이 둘 생깁니다.
 */
export async function ensureAnonymousSessionAsync(): Promise<Session | null> {
  const supabase = getSupabaseClient();

  if (!supabase) {
    return null;
  }

  if (sessionPromise) {
    return sessionPromise;
  }

  sessionPromise = (async () => {
    const { data: existing } = await supabase.auth.getSession();

    if (existing.session) {
      return existing.session;
    }

    const { data, error } = await supabase.auth.signInAnonymously();

    if (error) {
      console.log(`[Supabase] 익명 로그인 실패: ${error.message}`);
      return null;
    }

    return data.session;
  })();

  const session = await sessionPromise;

  // 실패는 기억하지 않습니다. 비행기 모드였거나 서버가 잠깐 흔들린 것일 수 있고,
  // 붙잡아두면 앱을 다시 켤 때까지 영영 로그인하지 못합니다.
  if (!session) {
    sessionPromise = null;
  }

  return session;
}

/**
 * 화면이 떠 있는 동안에만 토큰 갱신 타이머를 돌립니다. 정리 함수를 돌려줍니다.
 *
 * access token은 한 시간짜리입니다. 백그라운드에서는 타이머가 제대로 돌지 않아서,
 * 그냥 두면 한참 뒤 앱으로 돌아왔을 때 만료된 토큰으로 요청이 나가 401을 받습니다.
 * 사용자 입장에서는 "가끔 AI 정리가 안 되는" 증상으로 보입니다.
 *
 * 웹은 브라우저가 타이머를 계속 돌려주므로 supabase-js에 맡깁니다.
 */
export function startSupabaseAutoRefresh(): () => void {
  const supabase = getSupabaseClient();

  if (!supabase || Platform.OS === 'web') {
    return () => {};
  }

  const syncAutoRefresh = (state: AppStateStatus) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  };

  syncAutoRefresh(AppState.currentState);
  const subscription = AppState.addEventListener('change', syncAutoRefresh);

  return () => {
    subscription.remove();
    supabase.auth.stopAutoRefresh();
  };
}
