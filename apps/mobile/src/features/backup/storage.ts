import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

const { StorageAccessFramework } = FileSystem;

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
    throw new Error('이 기기에서는 파일 가져오기를 지원하지 않습니다.');
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
