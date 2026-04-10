import { SyncJob } from '@/features/items/types';

export type SyncAdapterResponse =
  | { kind: 'synced' }
  | { kind: 'deferred'; reason: string }
  | { kind: 'retryable_error'; reason: string }
  | { kind: 'fatal_error'; reason: string };

export type SyncAdapter = {
  upsertItem: (job: SyncJob) => Promise<SyncAdapterResponse>;
};

export function getSyncAdapter(): SyncAdapter {
  return {
    async upsertItem() {
      const hasRemoteConfig = Boolean(process.env.EXPO_PUBLIC_SUPABASE_URL);

      if (!hasRemoteConfig) {
        return {
          kind: 'deferred',
          reason: '원격 동기화 설정이 아직 없습니다.',
        };
      }

      return {
        kind: 'deferred',
        reason: 'Supabase 어댑터 연결 전입니다.',
      };
    },
  };
}
