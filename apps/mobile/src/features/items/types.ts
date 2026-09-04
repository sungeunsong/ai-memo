export type ItemType = 'url' | 'text';

export type AIStatus = 'pending' | 'completed' | 'failed';

export type SyncStatus = 'local_only' | 'queued' | 'synced' | 'failed';

export type SyncJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type SyncJobOperation = 'upsert_item';

export type SavedItem = {
  id: string;
  type: ItemType;
  sourceUrl: string | null;
  rawInput: string;
  title: string;
  summary: string;
  /** 구조화 데이터(JSON 문자열). 카테고리·재료·지역 등 facet의 원천 */
  content: string;
  /**
   * 링크에서 긁어온 본문 원문.
   * 화면에는 보이지 않고 검색과 재추출을 위해 보관하는 캐시입니다.
   * 링크가 죽어도 검색과 키워드 재생성이 가능하도록 남겨둡니다.
   */
  contentText: string | null;
  /** AI가 읽기 좋게 재구성한 정리본. 상세 화면의 본문 역할 */
  digest: string | null;
  thumbnailUrl: string | null;
  aiStatus: AIStatus;
  /** AI 보강이 실패한 이유. 화면에 그대로 보여줘 원인을 알 수 있게 합니다. */
  aiError: string | null;
  /**
   * 사용자가 직접 지정한 카테고리. AI 분류보다 우선합니다.
   * 재분석을 돌려도 덮어쓰지 않도록 AI 결과와 별도 필드에 둡니다.
   */
  userCategory: string | null;
  syncStatus: SyncStatus;
  userNote: string | null;
  extractedUrls: string[];
  sourceType: string;
  savedFrom: string;
  createdAt: string;
  updatedAt: string;
};

export type SaveUrlPayload = {
  id: string;
  type: ItemType;
  sourceUrl: string | null;
  rawInput: string;
  title: string;
  summary: string;
  /** 구조화 데이터(JSON 문자열). 카테고리·재료·지역 등 facet의 원천 */
  content: string;
  /**
   * 링크에서 긁어온 본문 원문.
   * 화면에는 보이지 않고 검색과 재추출을 위해 보관하는 캐시입니다.
   * 링크가 죽어도 검색과 키워드 재생성이 가능하도록 남겨둡니다.
   */
  contentText: string | null;
  /** AI가 읽기 좋게 재구성한 정리본. 상세 화면의 본문 역할 */
  digest: string | null;
  thumbnailUrl: string | null;
  aiStatus: AIStatus;
  /** AI 보강이 실패한 이유. 화면에 그대로 보여줘 원인을 알 수 있게 합니다. */
  aiError: string | null;
  /**
   * 사용자가 직접 지정한 카테고리. AI 분류보다 우선합니다.
   * 재분석을 돌려도 덮어쓰지 않도록 AI 결과와 별도 필드에 둡니다.
   */
  userCategory: string | null;
  syncStatus: SyncStatus;
  userNote: string | null;
  extractedUrls: string[];
  sourceType: string;
  savedFrom: string;
  createdAt: string;
  updatedAt: string;
};

export type ItemMetadataPatch = {
  sourceUrl?: string | null;
  title?: string;
  summary?: string;
  content?: string;
  contentText?: string | null;
  digest?: string | null;
  aiError?: string | null;
  userCategory?: string | null;
  thumbnailUrl?: string | null;
  aiStatus?: AIStatus;
  userNote?: string | null;
  extractedUrls?: string[];
  sourceType?: string;
  savedFrom?: string;
  updatedAt: string;
};

export type CreateSyncJobPayload = {
  id: string;
  itemId: string;
  operation: SyncJobOperation;
  payloadJson: string;
  status: SyncJobStatus;
  attemptCount: number;
  lastError: string | null;
  nextRetryAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SyncQueueSummary = {
  pendingCount: number;
  failedCount: number;
};

export type SyncJob = CreateSyncJobPayload;

export type SyncWorkerResult =
  | {
      kind: 'idle';
      processedCount: number;
    }
  | {
      kind: 'deferred';
      processedCount: number;
      reason: string;
    }
  | {
      kind: 'completed';
      processedCount: number;
    };
