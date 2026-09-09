/**
 * 브라우저용 이미지 보관소.
 *
 * 웹 빌드에는 앱 폴더가 없습니다. `FileSystem.documentDirectory`가 null이고
 * `getInfoAsync`는 아예 호출되지 않으므로, 파일로 다루는 경로는 웹에서 통째로
 * 무너집니다.
 *
 * 그렇다고 이미지를 localStorage에 넣을 수는 없습니다. 아이템 목록이 이미
 * 그곳을 쓰고 있고 한도가 5MB 남짓이라, 스크린샷 두어 장이면 이미지뿐 아니라
 * 목록 저장까지 같이 막힙니다.
 *
 * 그래서 이미지만 IndexedDB에 따로 둡니다. 용량 제한이 사실상 없고 Blob을
 * 그대로 담을 수 있어 base64로 1.33배 부풀릴 필요도 없습니다.
 *
 * 아이템에 적어두는 값은 blob URL이 아니라 키입니다. blob URL은 탭을 닫으면
 * 무효가 되어, 다음에 열었을 때 저장해둔 그림이 전부 깨집니다. 키는 그대로
 * 남으므로, 앱이 뜰 때 한 번 훑어서 키마다 새 blob URL을 만들어 둡니다.
 */

const DB_NAME = 'sireong-images';
const DB_VERSION = 1;
const STORE_NAME = 'images';

/**
 * 아이템에 저장되는 이미지 키의 머리표.
 *
 * 안드로이드의 `IMAGE_DIR`이 놓이는 자리와 같습니다. 그래야 이미지 키를
 * 다루는 나머지 코드(예: 우리가 보관한 것인지 가리는 `startsWith` 검사)를
 * 플랫폼마다 따로 쓰지 않아도 됩니다.
 */
export const WEB_IMAGE_PREFIX = 'webimage:';

/**
 * 키 → 이번 세션에서 만든 blob URL.
 *
 * 그리는 쪽(`<Image source>`)은 동기라 비동기로 꺼내 올 수 없습니다.
 * 목록을 올리기 전에 이 표를 채워둬야 첫 화면부터 그림이 보입니다.
 */
const objectUrls = new Map<string, string>();

let databasePromise: Promise<IDBDatabase> | null = null;

export function isWebImageKey(uri: string): boolean {
  return uri.startsWith(WEB_IMAGE_PREFIX);
}

function isAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDatabaseAsync(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('이미지 보관소를 열지 못했습니다.'));
    // 다른 탭이 옛 버전을 붙잡고 있으면 열리지 않습니다. 기다려도 풀리지 않으므로
    // 실패로 두고, 부르는 쪽이 폴백하게 합니다.
    request.onblocked = () => reject(new Error('다른 탭이 이미지 보관소를 쓰고 있습니다.'));
  });

  // 한 번 실패한 약속을 계속 물고 있으면 다음 시도까지 같이 실패합니다.
  databasePromise.catch(() => {
    databasePromise = null;
  });

  return databasePromise;
}

function requestAsync<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('이미지 보관소 요청이 실패했습니다.'));
  });
}

function transactionDoneAsync(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('이미지 보관소 쓰기가 실패했습니다.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('이미지 보관소 쓰기가 중단되었습니다.'));
  });
}

/** 키에 물려 있던 blob URL을 새것으로 바꿉니다. 옛것은 두면 세션 내내 새지 않도록 거둡니다. */
function registerObjectUrl(key: string, blob: Blob) {
  const previous = objectUrls.get(key);
  if (previous) URL.revokeObjectURL(previous);
  objectUrls.set(key, URL.createObjectURL(blob));
}

/**
 * 보관된 이미지를 모두 읽어 blob URL을 만들어 둡니다. 앱이 뜰 때 한 번 부릅니다.
 *
 * 실패해도 앱은 떠야 합니다. 그림이 빠질 뿐 목록과 검색은 그대로 동작합니다.
 */
export async function hydrateWebImagesAsync(): Promise<number> {
  if (!isAvailable()) return 0;

  try {
    const database = await openDatabaseAsync();
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);

    // 두 요청을 먼저 걸어두고 함께 기다립니다. 하나를 기다린 뒤에 다음을 걸면
    // 그 사이에 트랜잭션이 닫혀 있을 수 있습니다.
    const keysRequest = store.getAllKeys();
    const blobsRequest = store.getAll();
    const [keys, blobs] = await Promise.all([
      requestAsync(keysRequest),
      requestAsync(blobsRequest),
    ]);

    keys.forEach((key, index) => {
      const blob = blobs[index];
      if (blob instanceof Blob) registerObjectUrl(String(key), blob);
    });

    return objectUrls.size;
  } catch (error) {
    console.log('[WebImage] 보관된 이미지를 불러오지 못했습니다:', error);
    return 0;
  }
}

export async function putWebImageAsync(key: string, blob: Blob): Promise<string> {
  if (!isAvailable()) {
    throw new Error('이 브라우저에서는 이미지를 저장할 수 없습니다.');
  }

  const database = await openDatabaseAsync();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  transaction.objectStore(STORE_NAME).put(blob, key);
  await transactionDoneAsync(transaction);

  registerObjectUrl(key, blob);
  return key;
}

export async function getWebImageBlobAsync(key: string): Promise<Blob | null> {
  if (!isAvailable()) return null;

  try {
    const database = await openDatabaseAsync();
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const result = await requestAsync(transaction.objectStore(STORE_NAME).get(key));
    return result instanceof Blob ? result : null;
  } catch (error) {
    console.log('[WebImage] 이미지를 읽지 못했습니다:', error);
    return null;
  }
}

export async function deleteWebImageAsync(key: string): Promise<void> {
  const url = objectUrls.get(key);
  if (url) {
    URL.revokeObjectURL(url);
    objectUrls.delete(key);
  }

  if (!isAvailable()) return;

  const database = await openDatabaseAsync();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  transaction.objectStore(STORE_NAME).delete(key);
  await transactionDoneAsync(transaction);
}

/**
 * 화면에 그릴 수 있는 주소로 바꿉니다.
 *
 * 원격 주소(썸네일 등)는 손대지 않고 그대로 돌려줍니다. 우리가 보관한 키인데
 * 표에 없으면 아직 안 만들어졌거나 지워진 것이라 null입니다. 키를 그대로
 * 넘기면 브라우저가 깨진 그림 아이콘을 그리므로, 아예 그리지 않게 합니다.
 */
export function resolveWebImageUri(uri: string): string | null {
  if (!isWebImageKey(uri)) return uri;
  return objectUrls.get(uri) ?? null;
}

export function base64ToBlob(base64: string, mimeType = 'image/jpeg'): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

/** base64만 돌려줍니다. Gemini는 `data:image/jpeg;base64,` 머리표를 받지 않습니다. */
export function blobToBase64Async(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('이미지를 읽지 못했습니다.'));
    reader.readAsDataURL(blob);
  });
}
