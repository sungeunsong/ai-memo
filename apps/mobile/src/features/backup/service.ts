import {
  getAllSettingsAsync,
  getItemUpdatedAtMapAsync,
  getSavedItemsAsync,
  importItemsAsync,
  setSettingAsync,
} from '@/db';
import { readImageForBackup, restoreImageFromBackup } from '@/features/capture/imageCapture';
import { ItemSource, ItemSourceKind, SavedItem } from '@/features/items/types';

import {
  BackupItem,
  buildBackupFile,
  buildBackupFileName,
  parseBackupFile,
} from './format';
import {
  listBackupFilesInPickedFolderAsync,
  readTextFileAsync,
  writeToPickedFolderAsync,
} from './storage';

export type ExportResult =
  | { kind: 'saved'; fileName: string; itemCount: number; imageCount: number }
  | { kind: 'cancelled' };

export type ImportResult =
  | { kind: 'imported'; added: number; updated: number; skipped: number }
  | { kind: 'cancelled' };

/**
 * 지금까지 모은 것을 파일 하나로 내보냅니다.
 *
 * 기기에만 저장하는 앱이라 폰을 잃거나 바꾸면 그대로 사라집니다.
 * 계정을 만들지 않고도 옮길 수 있는 길이 하나는 있어야 합니다.
 *
 * @param includeImages 스크린샷 원본까지 담을지. 담으면 파일이 건당 수백 KB씩 커집니다.
 */
export async function exportBackupAsync(includeImages: boolean): Promise<ExportResult> {
  const [items, settings] = await Promise.all([getSavedItemsAsync(), getAllSettingsAsync()]);

  let imageCount = 0;
  const backupItems: BackupItem[] = [];

  for (const item of items) {
    // syncStatus는 담지 않습니다. 어느 기기에서 전송을 마쳤는지는 그 기기의 사정입니다.
    const { syncStatus, ...rest } = item;
    const entry: BackupItem = { ...rest };

    if (includeImages && item.imageUri) {
      const base64 = await readImageForBackup(item.imageUri);
      if (base64) {
        entry.imageBase64 = base64;
        imageCount += 1;
      }
    }

    backupItems.push(entry);
  }

  const exportedAt = new Date().toISOString();
  const fileName = buildBackupFileName(exportedAt);
  const file = buildBackupFile(backupItems, settings, exportedAt);

  const uri = await writeToPickedFolderAsync(fileName, JSON.stringify(file));
  if (!uri) {
    return { kind: 'cancelled' };
  }

  return { kind: 'saved', fileName, itemCount: backupItems.length, imageCount };
}

export async function listBackupCandidatesAsync() {
  return listBackupFilesInPickedFolderAsync();
}

/**
 * 백업 파일을 현재 데이터에 합칩니다.
 *
 * 덮어쓰기가 아니라 병합입니다. 같은 id가 있으면 나중에 고친 쪽을 남깁니다.
 * 복원이 곧 삭제가 되어버리면(기기 A의 옛 백업으로 기기 B를 덮어쓰는 식)
 * 되돌릴 방법이 없기 때문입니다.
 */
export async function importBackupAsync(fileUri: string): Promise<ImportResult> {
  const raw = await readTextFileAsync(fileUri);
  const parsed = parseBackupFile(raw);

  if (!parsed.ok) {
    throw new Error(parsed.reason);
  }

  const existing = await getItemUpdatedAtMapAsync();

  const toWrite: SavedItem[] = [];
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const raw of parsed.file.items) {
    const item = normalizeImportedItem(raw);
    if (!item) {
      skipped += 1;
      continue;
    }

    const current = existing.get(item.id);
    if (current === undefined) {
      added += 1;
    } else if (item.updatedAt > current) {
      updated += 1;
    } else {
      // 지금 기기 쪽이 더 최신입니다. 옛 백업이 새 작업을 지우면 안 됩니다.
      skipped += 1;
      continue;
    }

    if (raw.imageBase64) {
      const restored = await restoreImageFromBackup(raw.imageBase64, item.id);
      // 복원에 실패하면 남의 기기 경로를 가리키느니 비워두는 편이 낫습니다.
      item.imageUri = restored;
      item.thumbnailUrl = restored ?? item.thumbnailUrl;
    }

    toWrite.push(item);
  }

  if (toWrite.length > 0) {
    await importItemsAsync(toWrite);
  }

  // 냉장고 재료 같은 설정은 비어 있을 때만 채웁니다.
  // 지금 쓰고 있는 값을 옛 백업으로 되돌리면 사용자가 놀랍니다.
  const currentSettings = await getAllSettingsAsync();
  for (const [key, value] of Object.entries(parsed.file.settings)) {
    if (typeof value !== 'string') continue;
    if (Object.prototype.hasOwnProperty.call(currentSettings, key)) continue;
    await setSettingAsync(key, value);
  }

  return { kind: 'imported', added, updated, skipped };
}

/**
 * 남이 만든 파일이라 항목이 빠져 있거나 형이 다를 수 있습니다.
 * 없는 항목은 기본값으로 채우고, 모르는 항목은 버립니다.
 * id와 수정 시각만은 없으면 손댈 수 없으니 그 건은 건너뜁니다.
 */
const SOURCE_KINDS: ItemSourceKind[] = [
  'instagram_reel', 'instagram_dm', 'url', 'youtube', 'notion',
  'text', 'screenshot', 'memo', 'other',
];

/** 백업에 담긴 조각들. 형이 어긋난 것은 버립니다. */
function normalizeImportedSources(raw: any, itemId: string): ItemSource[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((entry) => entry && typeof entry === 'object' && typeof entry.id === 'string')
    .map((entry) => ({
      id: entry.id as string,
      itemId,
      kind: SOURCE_KINDS.includes(entry.kind) ? (entry.kind as ItemSourceKind) : 'other',
      sourceUrl: typeof entry.sourceUrl === 'string' ? entry.sourceUrl : null,
      rawText: typeof entry.rawText === 'string' ? entry.rawText : null,
      createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : new Date(0).toISOString(),
    }));
}

function normalizeImportedItem(raw: any): SavedItem | null {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.id !== 'string' || !raw.id) return null;
  if (typeof raw.updatedAt !== 'string' || !raw.updatedAt) return null;

  const text = (value: unknown, fallback = '') =>
    typeof value === 'string' ? value : fallback;
  const nullableText = (value: unknown) => (typeof value === 'string' ? value : null);

  return {
    id: raw.id,
    type: raw.type === 'text' || raw.type === 'image' ? raw.type : 'url',
    sourceUrl: nullableText(raw.sourceUrl),
    rawInput: text(raw.rawInput),
    title: text(raw.title, '제목 없음'),
    summary: text(raw.summary),
    content: text(raw.content, '{}'),
    contentText: nullableText(raw.contentText),
    digest: nullableText(raw.digest),
    thumbnailUrl: nullableText(raw.thumbnailUrl),
    aiStatus:
      raw.aiStatus === 'completed' || raw.aiStatus === 'failed' ? raw.aiStatus : 'pending',
    aiError: nullableText(raw.aiError),
    userTitle: nullableText(raw.userTitle),
    userCategory: nullableText(raw.userCategory),
    imageUri: nullableText(raw.imageUri),
    userDeadline: nullableText(raw.userDeadline),
    // 전송 상태는 물려받지 않습니다. 이 기기에서는 아직 아무것도 보내지 않았습니다.
    syncStatus: 'local_only',
    userNote: nullableText(raw.userNote),
    extractedUrls: Array.isArray(raw.extractedUrls)
      ? raw.extractedUrls.filter((url: unknown): url is string => typeof url === 'string')
      : [],
    sourceType: text(raw.sourceType, 'web'),
    savedFrom: text(raw.savedFrom, 'import'),
    createdAt: text(raw.createdAt, raw.updatedAt),
    updatedAt: raw.updatedAt,
    sources: normalizeImportedSources(raw.sources, raw.id),
  };
}
