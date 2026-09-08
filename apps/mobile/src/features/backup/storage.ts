import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

const { StorageAccessFramework } = FileSystem;

/**
 * 폴더를 고르는 방식이 되는 곳인지.
 *
 * 안드로이드는 폴더 권한을 받아 그 안을 훑습니다. 브라우저에는 그런 창구가 없어서
 * 내려받기와 파일 선택으로 대신합니다.
 */
export const supportsFolderPicker = Platform.OS === 'android';

export type PickedFile = {
  uri: string;
  /** 화면에 보여줄 이름. SAF는 URI만 주므로 거기서 뽑아냅니다. */
  name: string;
};

/**
 * 사용자가 고른 폴더에 파일을 씁니다.
 *
 * 안드로이드가 앱 밖의 저장소를 직접 열어주지 않기 때문에, 사용자가 폴더를
 * 지정하면 그 폴더에 대한 권한을 받아 쓰는 방식(Storage Access Framework)을 씁니다.
 * expo-file-system에 들어 있어서 새 의존성이 필요 없습니다.
 *
 * 권한 요청을 취소하면 null입니다. 실패가 아니라 사용자의 선택입니다.
 */
export async function writeToPickedFolderAsync(
  fileName: string,
  contents: string
): Promise<string | null> {
  if (Platform.OS === 'web') {
    return downloadOnWeb(`${fileName}.json`, contents);
  }

  if (Platform.OS !== 'android') {
    throw new Error('이 기기에서는 파일 내보내기를 지원하지 않습니다.');
  }

  const permission = await StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) {
    return null;
  }

  const uri = await StorageAccessFramework.createFileAsync(
    permission.directoryUri,
    fileName,
    'application/json'
  );

  await FileSystem.writeAsStringAsync(uri, contents, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  return uri;
}

/**
 * 사용자가 고른 폴더에서 백업 파일 목록을 읽어옵니다.
 *
 * SAF에는 파일 하나만 고르게 하는 창구가 없어서, 폴더를 받아 그 안의 json을
 * 추려 보여주고 사용자가 고르게 합니다.
 */
export async function listBackupFilesInPickedFolderAsync(): Promise<PickedFile[] | null> {
  if (Platform.OS !== 'android') {
    throw new Error('이 기기에서는 폴더 열기를 지원하지 않습니다.');
  }

  const permission = await StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) {
    return null;
  }

  const uris = await StorageAccessFramework.readDirectoryAsync(permission.directoryUri);

  return uris
    .map((uri) => ({ uri, name: describeSafUri(uri) }))
    .filter((entry) => entry.name.toLowerCase().endsWith('.json'))
    // 최근에 만든 것이 위로 오도록. 파일 이름에 시각이 들어 있습니다.
    .sort((a, b) => b.name.localeCompare(a.name));
}

export async function readTextFileAsync(uri: string): Promise<string> {
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 });
}

/**
 * 브라우저에서 백업 파일 하나를 고르고 내용을 읽습니다.
 *
 * 취소하면 null입니다. 파일 선택창은 취소를 알려주는 표준 신호가 없어서,
 * 창이 닫히고 아무 일도 없으면 취소로 봅니다.
 */
export async function pickBackupTextOnWebAsync(): Promise<{ name: string; text: string } | null> {
  if (Platform.OS !== 'web') {
    throw new Error('브라우저에서만 쓰는 기능입니다.');
  }

  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';

    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }

      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, text: String(reader.result ?? '') });
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    };

    // 취소는 이벤트로 오지 않는 브라우저가 있어, 창을 벗어나면 취소로 봅니다.
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** 브라우저에는 폴더에 쓰는 창구가 없어서 내려받기로 대신합니다. */
function downloadOnWeb(fileName: string, contents: string): string {
  const blob = new Blob([contents], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();

  // 바로 지우면 내려받기가 시작되기 전에 끊기는 브라우저가 있습니다.
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  return fileName;
}

/**
 * SAF URI에서 파일 이름을 뽑아냅니다.
 *
 * SAF는 이름 대신 content:// URI를 주는데, 그 끝에 문서 id가 URL 인코딩되어 붙습니다.
 * 사용자에게 URI를 그대로 보여줄 수는 없어서 마지막 조각만 풀어 씁니다.
 */
function describeSafUri(uri: string): string {
  try {
    const decoded = decodeURIComponent(uri);
    const lastSlash = decoded.lastIndexOf('/');
    return lastSlash >= 0 ? decoded.slice(lastSlash + 1) : decoded;
  } catch {
    return uri;
  }
}
