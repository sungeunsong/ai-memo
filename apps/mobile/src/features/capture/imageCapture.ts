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

import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';

/** 보관용 최대 길이. 이보다 크면 줄입니다. */
const MAX_EDGE = 1600;

/** Gemini에 보낼 때 쓰는 크기. 이미지 토큰은 크기와 무관하게 고정이라 작게 보내도 손해가 없습니다. */
const ANALYSIS_EDGE = 1024;

const IMAGE_DIR = `${FileSystem.documentDirectory}captured-images/`;

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
  await ensureDirectory();

  const resized = await manipulateAsync(
    sourceUri,
    [{ resize: { width: MAX_EDGE } }],
    { compress: 0.8, format: SaveFormat.JPEG }
  );

  const target = `${IMAGE_DIR}${itemId}.jpg`;
  await FileSystem.moveAsync({ from: resized.uri, to: target });

  return target;
}

/** 분석용 base64. 원본을 그대로 보내면 요청이 커지고 느려집니다. */
export async function readImageForAnalysis(uri: string): Promise<string | null> {
  try {
    const prepared = await manipulateAsync(
      uri,
      [{ resize: { width: ANALYSIS_EDGE } }],
      { compress: 0.7, format: SaveFormat.JPEG, base64: true }
    );
    return prepared.base64 ?? null;
  } catch (error) {
    console.warn('[ImageCapture] 분석용 이미지 변환 실패:', error);
    return null;
  }
}

/** 아이템을 지울 때 보관 이미지도 함께 정리합니다. */
export async function deletePersistedImage(uri: string | null) {
  if (!uri || !uri.startsWith(IMAGE_DIR)) return;
  try {
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
