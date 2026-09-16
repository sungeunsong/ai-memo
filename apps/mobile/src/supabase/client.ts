import { createClient, Session, SupabaseClient } from '@supabase/supabase-js';
import { AppState, AppStateStatus, Platform } from 'react-native';

// 안드로이드에는 localStorage가 없습니다. supabase-js는 세션을 그 위에 얹기 때문에,
// 폴리필이 없으면 앱을 껐다 켤 때마다 로그인이 풀리고 익명 계정이 매번 새로 생깁니다.
// 계정이 갈리면 그 계정에 묶인 사용량·공유가 통째로 남남이 됩니다.
// expo-sqlite가 SQLite로 구현한 localStorage를 들고 있어 새 의존성 없이 해결되고,
// SecureStore를 쓸 때 걸리는 2048바이트 제한(JWT가 그보다 깁니다)도 통째로 피합니다.
if (Platform.OS !== 'web') {
  require('expo-sqlite/localStorage/install');

  // 깔렸는지 한 번 확인합니다. 조용히 실패하면 세션이 메모리에만 남아 앱을 껐다 켤
  // 때마다 익명 계정이 새로 생기는데, 앱 화면에는 아무 이상이 없어 보입니다.
  if (typeof globalThis.localStorage?.getItem !== 'function') {
    console.error('[Supabase] localStorage 폴리필이 깔리지 않았습니다. 세션이 유지되지 않습니다.');
  }
}

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * 세션을 어디에 둘지 직접 알려줍니다.
 *
 * 폴리필을 깔아두면 supabase-js가 알아서 쓸 줄 알았는데 아니었습니다. 저장소를
 * 안 넘기면 '브라우저인가'를 먼저 보는데, 그 판단이 window와 document가 **둘 다**
 * 있는지로 이뤄집니다. 리액트 네이티브에는 document가 없습니다.
 *
 * 그래서 localStorage가 멀쩡히 있어도 쓰지 않고 메모리에 담았고, 앱을 껐다 켤 때마다
 * 세션이 사라져 익명 계정이 새로 생겼습니다. 실기기에서 껐다 켤 때마다 계정 수가
 * 늘어나는 것으로 드러났습니다. 웹에서는 진짜 브라우저라 문제가 없어 안 보였습니다.
 *
 * 넘겨주면 그 판단 자체를 건너뜁니다. 웹은 기본값(브라우저 localStorage)이 맞으므로
 * 그대로 둡니다.
 */
const sessionStorage =
  Platform.OS === 'web'
    ? undefined
    : {
        getItem: (key: string) => globalThis.localStorage.getItem(key),
        setItem: (key: string, value: string) => globalThis.localStorage.setItem(key, value),
        removeItem: (key: string) => globalThis.localStorage.removeItem(key),
      };

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
        storage: sessionStorage,
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

let signInPromise: Promise<Session | null> | null = null;

/**
 * 익명 세션을 확보합니다. 이미 있으면 그대로 씁니다.
 *
 * 사용자 눈에는 아무것도 보이지 않습니다. 로그인 화면을 세우려는 것이 아니라,
 * 서버가 "이 요청이 누구 것인가"를 알아야 하기 때문입니다. 그걸 모르면 사용량 상한을
 * 사람별로 못 매기고(한 명이 다 쓰면 나머지가 막힙니다), RLS도 판단 근거가 없습니다.
 *
 * 매번 getSession으로 지금 것을 읽습니다. 예전에는 한 번 받은 세션을 통째로 들고
 * 있었는데, access token은 한 시간짜리라 앱을 오래 켜두면 만료된 토큰을 계속
 * 내주게 됩니다. 갱신 타이머가 안쪽에서 새 토큰을 받아둬도 우리 손의 사본은 그대로라
 * 아무 소용이 없고, 서버는 401을 주는데 그건 재시도해도 안 풀리는 실패로 처리됩니다.
 * 들고 있을 이유가 없는 값이었습니다.
 *
 * 만들기만 진행 중인 요청을 공유합니다. signInAnonymously는 부를 때마다 계정을
 * 새로 만들기 때문에, 앱 시작과 첫 저장이 겹치면 한 사람 몫으로 계정이 둘 생깁니다.
 */
export async function ensureAnonymousSessionAsync(): Promise<Session | null> {
  const supabase = getSupabaseClient();

  if (!supabase) {
    return null;
  }

  // 만료가 가까우면 이 안에서 알아서 갱신해 새 토큰을 돌려줍니다.
  const { data: existing } = await supabase.auth.getSession();

  if (existing.session) {
    return existing.session;
  }

  if (!signInPromise) {
    signInPromise = (async () => {
      const { data, error } = await supabase.auth.signInAnonymously();

      if (error) {
        console.log(`[Supabase] 익명 로그인 실패: ${error.message}`);
        return null;
      }

      console.log(`[Supabase] 익명 계정을 새로 만들었습니다. user: ${data.session?.user.id}`);
      return data.session;
    })();
  }

  const session = await signInPromise;

  // 실패는 기억하지 않습니다. 비행기 모드였거나 서버가 잠깐 흔들린 것일 수 있고,
  // 붙잡아두면 앱을 다시 켤 때까지 영영 로그인하지 못합니다.
  //
  // 성공도 붙잡지 않습니다. 여기 남겨두면 다음 호출이 getSession을 건너뛰고 이
  // 약속이 들고 있는 옛 세션을 그대로 내줍니다. 계정을 두 번 만드는 것만 막으면
  // 되는 자리라, 만들기가 끝나면 비웁니다.
  signInPromise = null;

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
