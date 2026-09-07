export type ItemType = 'url' | 'text' | 'image';

/**
 * 'awaiting_input'은 사용자가 덧붙일 내용을 기다리는 중이라는 뜻입니다.
 *
 * 'pending'과 반드시 구분해야 합니다. 앱은 'pending인데 아무도 안 돌리고 있으면
 * 앱이 죽어서 끊긴 것'으로 보고 실패 처리한 뒤 재개하는데(store의 회수 로직),
 * 입력을 기다리는 항목도 겉모습이 똑같아서 그대로 두면 멋대로 AI가 돌아갑니다.
 */
export type AIStatus = 'pending' | 'awaiting_input' | 'completed' | 'failed';

/**
 * Source의 종류.
 *
 * 아이템의 sourceType(대표 출처)과는 다릅니다. 이쪽은 붙인 조각 하나하나의 출처입니다.
 * 릴스 하나에 DM 두 개가 붙으면 아이템은 instagram_reel이고
 * Source는 instagram_reel + instagram_dm + instagram_dm 입니다.
 */
export type ItemSourceKind =
  | 'instagram_reel'
  | 'instagram_dm'
  | 'url'
  | 'youtube'
  | 'notion'
  | 'text'
  | 'screenshot'
  | 'memo'
  | 'other';

/**
 * 저장물을 이루는 정보 조각.
 *
 * 릴스에는 정보가 일부만 있고 나머지는 나중에 DM으로 옵니다. 따로 저장하면
 * 하나의 정보가 둘로 쪼개져 검색이 무너지므로, 한 저장물에 여러 조각을 답니다.
 * AI 결과는 이 조각들을 종합해 다시 만들지만, 조각 자체는 그대로 보존합니다.
 */
export type ItemSource = {
  id: string;
  itemId: string;
  kind: ItemSourceKind;
  sourceUrl: string | null;
  /**
   * 조각의 글.
   *
   * 스크린샷 조각은 이미지에서 읽어낸 글자가 여기 들어갑니다.
   * 인스타 DM은 복사도 전달도 안 되어서 스크린샷이 유일한 통로인데,
   * 글자를 남겨두지 않으면 그 안의 제품명이나 전화번호로 검색할 수 없습니다.
   */
  rawText: string | null;
  /** 스크린샷 원본 경로. 나중에 원본을 다시 볼 수 있어야 합니다. */
  imageUri: string | null;
  createdAt: string;
};

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
   * 사용자가 직접 고친 제목. AI 제목보다 우선합니다.
   * 재분석이 덮어쓰지 않도록 AI 결과와 별도 필드에 둡니다.
   */
  userTitle: string | null;
  /**
   * 사용자가 직접 지정한 카테고리. AI 분류보다 우선합니다.
   * 재분석을 돌려도 덮어쓰지 않도록 AI 결과와 별도 필드에 둡니다.
   */
  userCategory: string | null;
  /** 앱 폴더에 보관한 이미지 경로. 스크린샷으로 저장한 아이템의 원본입니다. */
  imageUri: string | null;
  /**
   * 사용자가 직접 고친 마감일 (YYYY-MM-DD).
   * AI가 추론한 날짜는 틀릴 수 있는데 '마감됨' 경고를 띄우는 자리라 교정이 필요합니다.
   * 재분석이 덮어쓰지 않도록 AI 결과와 별도 필드에 둡니다.
   */
  userDeadline: string | null;
  syncStatus: SyncStatus;
  userNote: string | null;
  extractedUrls: string[];
  sourceType: string;
  savedFrom: string;
  createdAt: string;
  updatedAt: string;
  /**
   * 이 저장물을 이루는 조각들. 목록을 읽을 때 함께 채워집니다.
   * patch로 고치는 값이 아니라 별도 테이블이라 ITEM_PATCH_COLUMNS에는 없습니다.
   */
  sources: ItemSource[];
};

/**
 * 새 아이템을 만들 때 넘기는 값.
 *
 * SavedItem과 필드가 같아서 예전에는 통째로 베껴 적어두었는데, 컬럼을 늘릴
 * 때마다 두 곳을 손으로 맞춰야 했고 실제로 자주 어긋났습니다.
 * Source는 별도 테이블이라 만들 때 함께 넘기지 않습니다.
 */
export type SaveUrlPayload = Omit<SavedItem, 'sources'>;

export type ItemMetadataPatch = {
  sourceUrl?: string | null;
  title?: string;
  summary?: string;
  content?: string;
  contentText?: string | null;
  digest?: string | null;
  aiError?: string | null;
  userTitle?: string | null;
  userCategory?: string | null;
  imageUri?: string | null;
  userDeadline?: string | null;
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
