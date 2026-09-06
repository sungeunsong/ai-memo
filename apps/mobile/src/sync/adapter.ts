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

export function getSyncAdapter(): SyncAdapter {
  return {
    async upsertItem(job: SyncJob) {
      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
      const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

      const hasRemoteConfig = Boolean(supabaseUrl && supabaseAnonKey);

      if (!hasRemoteConfig) {
        // [Premium UX Mock mode]: 실제 Supabase 설정이 없는 일반 로컬 웹 개발/테스트 환경에서도
        // 동기화 메트릭이 작동하는 흐름을 시각적으로 체험하실 수 있도록 1.5초 시뮬레이션 지연 후 성공 처리합니다.
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return { kind: 'synced' };
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SYNC_REQUEST_TIMEOUT_MS);

      try {
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
