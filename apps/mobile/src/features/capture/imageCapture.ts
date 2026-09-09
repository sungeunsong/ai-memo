/**
 * 이미지 캡처 처리.
 *
 * 인스타 DM은 링크 없이 이미지로 오는 경우가 많고, 친구가 타이핑한 텍스트는
 * 공유가 막혀 복사만 됩니다. 스크린샷이 그걸 가져올 수 있는 유일한 경로라
 * 저장 수단 중 하나로 다룹니다.
 *
 * 원본은 리사이즈해서 보관합니다.
 * - 그대로 두면 스샷 한 장에 1~3MB씩 쌓입니다
 * - 버리면 AI가 놓친 내용을 영영 복구할 수 없습니다 (갤러리에서 지우면 끝)
 * 긴 변 1600px면 글자를 읽기에 충분하고 용량은 1/5~1/10로 줄어듭니다.
 */

import { Image, Platform } from 'react-native';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';

import {
  WEB_IMAGE_PREFIX,
  base64ToBlob,
  blobToBase64Async,
  deleteWebImageAsync,
  getWebImageBlobAsync,
  hydrateWebImagesAsync,
  putWebImageAsync,
  resolveWebImageUri,
} from '@/features/capture/webImageStore';

/** 보관용 최대 가로 길이. 이보다 넓을 때만 줄입니다. */
const MAX_WIDTH = 1600;

/**
 * Gemini에 보낼 때의 최대 가로.
 *
 * 너무 줄이면 글자를 못 읽습니다. DM 스크린샷에서 전화번호나 가격을 읽어내는 것이
 * 이 앱의 쓸모라, 알아볼 수 있는 선은 지켜야 합니다.
 */
const ANALYSIS_WIDTH = 1024;

/**
 * 보관 위치.
 *
 * 웹에는 앱 폴더가 없어(`documentDirectory`가 null) 파일 대신 IndexedDB에 담고,
 * 여기에는 그 키의 머리표를 둡니다. 자리를 맞춰두면 '우리가 보관한 것인지'를
 * 가리는 아래 검사들을 플랫폼마다 따로 쓰지 않아도 됩니다.
 */
const IMAGE_DIR =
  Platform.OS === 'web' ? WEB_IMAGE_PREFIX : `${FileSystem.documentDirectory}captured-images/`;

/**
 * 가로가 기준보다 넓을 때만 줄이는 리사이즈 지시를 만듭니다.
 *
 * resize에 width만 주면 '가로를 그 값으로 맞추라'는 뜻입니다. 예전에는 조건 없이
 * 그렇게 넘겨서, 세로로 긴 폰 스크린샷(1080×2640)이 1600×3911로 오히려 커졌습니다.
 * 없던 화소를 만들어 채우는 것이라 글자가 선명해지지도 않으면서 파일만 두 배였습니다.
 *
 * 그렇다고 긴 변을 기준으로 잡으면 반대로 지나칩니다. 2640을 1600에 맞추면
 * 가로가 655px로 뭉개져서 한글이 읽히지 않습니다. 세로로 긴 글자 화면에서
 * 중요한 것은 가로 해상도입니다. 인스타 DM 스크린샷이 정확히 그런 그림입니다.
 *
 * 그래서 기준은 가로 하나이고, 넘칠 때만 줄입니다. 이미 좁으면 그대로 둡니다.
 * 크기를 못 읽었을 때도 손대지 않습니다. 모르는 채로 건드리면 키울 위험이 있는데,
 * 압축만으로도 대부분 줄어듭니다.
 */
async function buildResizeActions(uri: string, maxWidth: number) {
  const size = await measureImage(uri);
  if (!size || size.width <= maxWidth) return [];

  return [{ resize: { width: maxWidth } }];
}

function measureImage(uri: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      () => resolve(null)
    );
  });
}

async function ensureDirectory() {
  const info = await FileSystem.getInfoAsync(IMAGE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(IMAGE_DIR, { intermediates: true });
  }
}

/**
 * 공유받거나 고른 이미지를 앱 폴더에 리사이즈해서 보관합니다.
 * 공유로 넘어온 URI는 임시 경로라 그대로 두면 나중에 접근할 수 없습니다.
 */
export async function persistImage(sourceUri: string, itemId: string): Promise<string> {
  const target = `${IMAGE_DIR}${itemId}.jpg`;

  // 웹은 옮길 폴더가 없어서 결과를 base64로 받아 IndexedDB에 담습니다.
  if (Platform.OS === 'web') {
    const prepared = await manipulateAsync(
      sourceUri,
      await buildResizeActions(sourceUri, MAX_WIDTH),
      { compress: 0.8, format: SaveFormat.JPEG, base64: true }
    );

    if (!prepared.base64) {
      throw new Error('이미지를 변환하지 못했습니다.');
    }

    return putWebImageAsync(target, base64ToBlob(prepared.base64));
  }

  await ensureDirectory();

  const resized = await manipulateAsync(
    sourceUri,
    await buildResizeActions(sourceUri, MAX_WIDTH),
    { compress: 0.8, format: SaveFormat.JPEG }
  );

  await FileSystem.moveAsync({ from: resized.uri, to: target });

  return target;
}

/**
 * 화면에 그릴 수 있는 주소로 바꿉니다.
 *
 * 웹에서 아이템에 적히는 값은 보관소의 키라 그대로는 그려지지 않습니다.
 * 원격 썸네일 주소와 안드로이드의 파일 경로는 손대지 않고 지나갑니다.
 */
export function resolveImageUri(uri: string | null | undefined): string | null {
  if (!uri) return null;
  if (Platform.OS !== 'web') return uri;
  return resolveWebImageUri(uri);
}

/**
 * 보관된 이미지를 그릴 준비를 합니다. 앱이 뜰 때 한 번 부릅니다.
 *
 * 웹에서만 할 일이 있습니다. 그리는 쪽이 동기라 목록을 올리기 전에 미리
 * 주소를 만들어 두지 않으면 첫 화면에서 그림이 비어 보입니다.
 */
export async function hydratePersistedImagesAsync(): Promise<void> {
  if (Platform.OS !== 'web') return;
  await hydrateWebImagesAsync();
}

/** 분석용 base64. 원본을 그대로 보내면 요청이 커지고 느려집니다. */
export async function readImageForAnalysis(uri: string): Promise<string | null> {
  try {
    // 웹에서 넘어오는 값은 보관소 키입니다. 캔버스가 읽을 수 있는 주소로 바꿉니다.
    const source = Platform.OS === 'web' ? resolveImageUri(uri) : uri;
    if (!source) {
      console.warn('[ImageCapture] 분석할 이미지를 찾지 못했습니다:', uri);
      return null;
    }

    const prepared = await manipulateAsync(
      source,
      await buildResizeActions(source, ANALYSIS_WIDTH),
      { compress: 0.7, format: SaveFormat.JPEG, base64: true }
    );
    return prepared.base64 ?? null;
  } catch (error) {
    console.warn('[ImageCapture] 분석용 이미지 변환 실패:', error);
    return null;
  }
}

/** 아이템을 지울 때 보관 이미지도 함께 정리합니다. */
/** 저장해둔 이미지를 그대로 base64로 읽습니다. 백업에 담을 때 씁니다. */
export async function readImageForBackup(uri: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web') {
      const blob = await getWebImageBlobAsync(uri);
      return blob ? await blobToBase64Async(blob) : null;
    }

    return await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } catch (error) {
    console.log('[Image] 백업용 이미지 읽기 실패:', error);
    return null;
  }
}

/**
 * 백업에서 꺼낸 이미지를 앱 폴더에 되살립니다.
 *
 * 이미지 경로는 기기마다 다릅니다. 백업에 적힌 경로를 그대로 쓰면 열리지 않으므로,
 * 내용을 새로 쓰고 그 경로를 돌려줍니다.
 */
export async function restoreImageFromBackup(
  base64: string,
  itemId: string
): Promise<string | null> {
  try {
    const target = `${IMAGE_DIR}${itemId}.jpg`;

    if (Platform.OS === 'web') {
      return await putWebImageAsync(target, base64ToBlob(base64));
    }

    await ensureDirectory();
    await FileSystem.writeAsStringAsync(target, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return target;
  } catch (error) {
    console.log('[Image] 백업 이미지 복원 실패:', error);
    return null;
  }
}

export async function deletePersistedImage(uri: string | null) {
  if (!uri || !uri.startsWith(IMAGE_DIR)) return;
  try {
    if (Platform.OS === 'web') {
      await deleteWebImageAsync(uri);
      return;
    }

    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch (error) {
    console.log('[ImageCapture] 이미지 삭제 실패(무시):', error);
  }
}

/** 공유 인텐트로 들어온 파일 중 이미지의 경로를 고릅니다. */
export function pickSharedImagePath(
  files: { path?: string; mimeType?: string; fileName?: string }[] | undefined
): string | null {
  if (!files || files.length === 0) return null;

  const image = files.find((file) => {
    if (file.mimeType?.startsWith('image/')) return true;
    const name = file.fileName ?? file.path ?? '';
    return /\.(jpe?g|png|webp|heic)$/i.test(name);
  });

  return image?.path ?? null;
}
