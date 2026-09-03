import { SaveUrlPayload } from '@/features/items/types';
import { extractAllUrls, classifySourceType } from '@/features/capture/normalizeSharedInput';

const HOST_LABELS: Record<string, string> = {
  'youtube.com': '유튜브 링크',
  'youtu.be': '유튜브 링크',
  'instagram.com': '인스타그램 링크',
};

export function buildFallbackItem(rawInput: string, savedFrom = 'manual'): SaveUrlPayload {
  const timestamp = new Date().toISOString();
  const extractedUrls = extractAllUrls(rawInput);
  const primaryUrl = extractedUrls[0] ?? null;
  
  const type = primaryUrl ? 'url' : 'text';
  const sourceType = classifySourceType(primaryUrl, rawInput);
  
  let title = '';
  let summary = '';
  let content = rawInput;

  if (type === 'url' && primaryUrl) {
    const hostname = getHostname(primaryUrl);
    
    // 노션이나 구글 등의 문서인 경우 조금 더 친절한 Fallback 제목 제공
    if (sourceType === 'notion') {
      title = `Notion 문서 (${formatDate(timestamp)})`;
    } else if (sourceType.startsWith('google_')) {
      const typeLabel = sourceType === 'google_docs' ? '문서' : sourceType === 'google_sheets' ? '스프레드시트' : sourceType === 'google_form' ? '설문지' : '드라이브';
      title = `Google ${typeLabel} (${formatDate(timestamp)})`;
    } else {
      title = buildFallbackTitle(hostname);
    }

    summary = `${hostname} 링크를 저장했습니다. AI 요약과 파싱이 비동기로 진행됩니다.`;
    content = primaryUrl;
  } else {
    // 텍스트 메모인 경우
    const preview = rawInput.trim().replace(/\s+/g, ' ').slice(0, 20);
    title = preview ? `메모: ${preview}${rawInput.trim().length > 20 ? '...' : ''}` : `새 텍스트 메모 (${formatDate(timestamp)})`;
    summary = `원문 텍스트 메모를 저장했습니다.`;
  }

  return {
    id: createItemId(),
    type,
    sourceUrl: primaryUrl,
    rawInput,
    title,
    summary,
    content,
    // 저장 시점에는 아직 본문을 긁지 않았고 정리본도 없습니다.
    // 원문(rawInput)만 확보해두면 나머지는 나중에 언제든 다시 만들 수 있습니다.
    contentText: null,
    digest: null,
    thumbnailUrl: null,
    aiStatus: 'pending',
    syncStatus: 'local_only',
    userNote: null,
    extractedUrls,
    sourceType,
    savedFrom,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

// 하위 호환성 유지용 래퍼
export function buildFallbackUrlItem(normalizedUrl: string, rawInput = normalizedUrl): SaveUrlPayload {
  return buildFallbackItem(rawInput, 'manual');
}

export function normalizeUrl(input: string) {
  try {
    const extracted = extractAllUrls(input)[0];
    if (!extracted) {
      return input.trim();
    }
    const url = new URL(extracted);
    return url.toString();
  } catch {
    return input.trim();
  }
}

export function getHostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'web';
  }
}

function buildFallbackTitle(hostname: string) {
  return HOST_LABELS[hostname] ?? `${hostname} 저장 링크`;
}

function formatDate(isoString: string) {
  const date = new Date(isoString);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function createItemId() {
  return `item_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
