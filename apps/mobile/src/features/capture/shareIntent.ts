import { ShareIntent } from 'expo-share-intent';

export function getSharedInputValue(shareIntent: ShareIntent) {
  const candidate = shareIntent.text?.trim() || shareIntent.webUrl?.trim();

  if (!candidate) {
    return null;
  }

  return candidate;
}

export function buildShareIntentSignature(shareIntent: ShareIntent) {
  const fileSignature =
    shareIntent.files?.map((file) => `${file.fileName}:${file.path}`).join('|') ?? '';

  return [
    shareIntent.type ?? 'none',
    shareIntent.text ?? '',
    shareIntent.webUrl ?? '',
    fileSignature,
  ].join('::');
}

export function hasUnsupportedSharedFiles(shareIntent: ShareIntent) {
  return Boolean(shareIntent.files?.length) && !getSharedInputValue(shareIntent);
}
