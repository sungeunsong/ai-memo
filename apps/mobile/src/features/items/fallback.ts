import { SaveUrlPayload } from '@/features/items/types';
import { extractUrlCandidate } from '@/features/capture/normalizeSharedInput';

const HOST_LABELS: Record<string, string> = {
  'youtube.com': '유튜브 링크',
  'youtu.be': '유튜브 링크',
  'instagram.com': '인스타그램 링크',
};

export function buildFallbackUrlItem(normalizedUrl: string, rawInput = normalizedUrl): SaveUrlPayload {
  const timestamp = new Date().toISOString();
  const hostname = getHostname(normalizedUrl);
  const title = buildFallbackTitle(hostname);

  return {
    id: createItemId(),
    type: 'url',
    sourceUrl: normalizedUrl,
    rawInput,
    title,
    summary: `${hostname} 링크를 먼저 저장했습니다.\nAI 요약과 파싱은 비동기로 이어집니다.`,
    content: normalizedUrl,
    thumbnailUrl: null,
    aiStatus: 'pending',
    syncStatus: 'local_only',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function normalizeUrl(input: string) {
  const extracted = extractUrlCandidate(input);
  const url = new URL(extracted);

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('http 또는 https 링크만 저장할 수 있습니다.');
  }

  if (!url.hostname.includes('.')) {
    throw new Error('올바른 링크 형식인지 확인해 주세요.');
  }

  return url.toString();
}

export function getHostname(url: string) {
  return new URL(url).hostname.replace(/^www\./, '');
}

function buildFallbackTitle(hostname: string) {
  return HOST_LABELS[hostname] ?? `${hostname} 저장 링크`;
}

function createItemId() {
  return `item_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
