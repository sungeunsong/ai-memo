import { ItemSource, SavedItem } from '@/features/items/types';
import { DomainDefinition, FactDefinition } from '@/features/taxonomy/types';

/**
 * 백업 파일의 형식 번호.
 *
 * items의 컬럼은 계속 늘고 있습니다(digest, ai_error, user_category, user_title...).
 * 번호가 없으면 나중에 만든 파일을 옛 앱에서 열었을 때 조용히 깨집니다.
 * 읽는 쪽은 모르는 항목을 무시하고 없는 항목은 기본값으로 채우되,
 * 번호가 더 높으면 사용자에게 알려 앱을 올리게 합니다.
 */
export const BACKUP_SCHEMA_VERSION = 1;

const APP_TAG = 'sireong';

/**
 * 백업에 담기는 아이템.
 *
 * syncStatus는 담지 않습니다. 어느 기기에서 전송을 마쳤는지는 그 기기의 사정이라,
 * 옮겨간 기기에서 물려받으면 보내지도 않은 것을 보냈다고 여기게 됩니다.
 */
export type BackupItem = Omit<SavedItem, 'syncStatus' | 'sources'> & {
  /** 이미지 원본. 파일 경로는 기기마다 달라서 내용을 직접 담습니다. */
  imageBase64?: string;
  sources: BackupSource[];
};

/**
 * 백업에 담기는 조각.
 *
 * 스크린샷은 경로가 아니라 내용을 담습니다. 인스타 DM은 복사도 전달도 안 되어
 * 화면을 찍은 것이 유일한 원본인데, 경로만 담으면 복원한 기기에서 열리지 않습니다.
 * 읽어낸 글자는 파생물이라 그것만 남으면 원본을 확인할 방법이 사라집니다.
 */
export type BackupSource = Omit<ItemSource, 'imageUri'> & {
  imageBase64?: string;
};

export type BackupFile = {
  app: typeof APP_TAG;
  schemaVersion: number;
  exportedAt: string;
  itemCount: number;
  items: BackupItem[];
  /** 냉장고 재료처럼 아이템에 속하지 않는 사용자 상태 */
  settings: Record<string, string>;
  /**
   * 분야·항목 사전.
   *
   * 아이템의 fact는 이름만 갖고 있어서, 사전이 없으면 타입도 정규화 규칙도
   * 검색 축도 알 수 없습니다. 데이터는 있는데 검색이 죽는 상태가 되고,
   * 그 증상만 봐서는 원인을 짚기 어렵습니다.
   */
  taxonomy?: { domains: DomainDefinition[]; facts: FactDefinition[] };
};

export type ParsedBackup =
  | { ok: true; file: BackupFile }
  | { ok: false; reason: string };

export function buildBackupFile(
  items: BackupItem[],
  settings: Record<string, string>,
  exportedAt: string,
  taxonomy?: { domains: DomainDefinition[]; facts: FactDefinition[] }
): BackupFile {
  return {
    app: APP_TAG,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt,
    itemCount: items.length,
    items,
    settings,
    ...(taxonomy ? { taxonomy } : null),
  };
}

export function buildBackupFileName(exportedAt: string): string {
  // 콜론은 파일 이름에 못 쓰는 환경이 있어 걷어냅니다.
  const stamp = exportedAt.slice(0, 19).replace(/[:T]/g, '-');
  return `sireong-backup-${stamp}`;
}

/**
 * 남이 준 파일이라 무엇이든 들어올 수 있습니다.
 * 통과시킨 뒤에 터지면 원인을 짚기 어려우니 여기서 형태를 확인합니다.
 */
export function parseBackupFile(raw: string): ParsedBackup {
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'JSON 형식이 아닙니다. 시렁에서 내보낸 파일이 맞는지 확인해 주세요.' };
  }

  if (!data || typeof data !== 'object') {
    return { ok: false, reason: '내용이 비어 있습니다.' };
  }

  if (data.app !== APP_TAG) {
    return { ok: false, reason: '시렁에서 내보낸 백업 파일이 아닙니다.' };
  }

  if (typeof data.schemaVersion !== 'number') {
    return { ok: false, reason: '형식 번호가 없어 읽을 수 없습니다.' };
  }

  if (data.schemaVersion > BACKUP_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: `더 새로운 형식(v${data.schemaVersion})입니다. 앱을 최신으로 올린 뒤 다시 시도해 주세요.`,
    };
  }

  if (!Array.isArray(data.items)) {
    return { ok: false, reason: '아이템 목록이 없습니다.' };
  }

  const settings =
    data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings)
      ? (data.settings as Record<string, string>)
      : {};

  return {
    ok: true,
    file: {
      app: APP_TAG,
      schemaVersion: data.schemaVersion,
      exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : '',
      itemCount: data.items.length,
      items: data.items,
      settings,
      taxonomy: data.taxonomy,
    },
  };
}
