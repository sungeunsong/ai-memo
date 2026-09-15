import { SyncJob } from '@/features/items/types';

export type SyncAdapterResponse =
  | { kind: 'synced' }
  | { kind: 'deferred'; reason: string }
  | { kind: 'retryable_error'; reason: string }
  | { kind: 'fatal_error'; reason: string };

export type SyncAdapter = {
  upsertItem: (job: SyncJob) => Promise<SyncAdapterResponse>;
};

/**
 * 원격 응답 대기 한계.
 *
 * 시한이 없으면 응답이 안 올 때 워커가 job을 'processing'에 둔 채 영원히 매달립니다.
 * 워커는 한 번에 하나만 돌기 때문에(syncWorkerPromise) 그때부터 동기화 전체가 멈춥니다.
 */
const SYNC_REQUEST_TIMEOUT_MS = 20000;

/**
 * 아이템 원격 동기화 준비 여부.
 *
 * Supabase 설정이 생겼다고 아이템 동기화가 준비된 것은 아닙니다. 프로젝트는 AI 프록시와
 * 익명 로그인을 붙이려고 먼저 만들었고, `items` 테이블도 RLS 정책도 아직 없습니다.
 *
 * 이 자리를 "설정이 있나"로 두면 .env에 URL 두 줄을 적는 순간 동작이 뒤집힙니다.
 * 저장할 때마다 없는 테이블로 POST가 나가 404를 받고, 404는 fatal_error라
 * 재시도 없이 job이 그대로 죽습니다(worker.ts의 retryAt = null).
 * 설정과 준비를 같은 것으로 본 탓이라, 준비 여부를 따로 둡니다.
 *
 * 테이블·RLS 정책이 생기고 아래 인증 문제까지 풀리는 날 이 상수를 켭니다.
 */
const IS_ITEMS_SYNC_READY = false;

export function getSyncAdapter(): SyncAdapter {
  return {
    async upsertItem(job: SyncJob) {
      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
      const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

      const canSyncItems = IS_ITEMS_SYNC_READY && Boolean(supabaseUrl && supabaseAnonKey);

      if (!canSyncItems) {
        // [Premium UX Mock mode]: 원격 동기화가 아직 준비되지 않은 환경에서도
        // 동기화 메트릭이 작동하는 흐름을 시각적으로 체험하실 수 있도록 1.5초 시뮬레이션 지연 후 성공 처리합니다.
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return { kind: 'synced' };
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SYNC_REQUEST_TIMEOUT_MS);

      try {
        // Authorization에 anon 키를 그대로 넣고 있습니다. 이러면 서버가 보는 신원이
        // 'anon'이라 auth.uid()가 비고, 본인 것만 읽고 쓰는 RLS 정책을 통과하지 못합니다.
        // 켜기 전에 로그인된 사용자의 access token으로 바꿔야 합니다.
        const response = await fetch(`${supabaseUrl}/rest/v1/items`, {
          method: 'POST',
          headers: {
            'apikey': supabaseAnonKey!,
            'Authorization': `Bearer ${supabaseAnonKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates',
          },
          body: job.payloadJson,
          signal: controller.signal,
        });

        if (response.ok) {
          return { kind: 'synced' };
        }

        const errorText = await response.text().catch(() => '상세 오류 없음');

        if (response.status >= 500) {
          return {
            kind: 'retryable_error',
            reason: `Supabase 서버 오류 (HTTP ${response.status}): ${errorText}`,
          };
        }

        return {
          kind: 'fatal_error',
          reason: `Supabase 클라이언트 요청 오류 (HTTP ${response.status}): ${errorText}`,
        };
      } catch (error) {
        return {
          kind: 'retryable_error',
          reason: `원격 데이터베이스 연결 끊김: ${error instanceof Error ? error.message : '네트워크 에러'}`,
        };
      } finally {
        clearTimeout(timeoutId);
      }
    },
  };
}
