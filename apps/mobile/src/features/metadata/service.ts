import { ItemMetadataPatch } from '@/features/items/types';
import { getHostname } from '@/features/items/fallback';

type MetadataResult = {
  sourceUrl: string;
  title: string;
  summary: string;
  content: string;
  thumbnailUrl: string | null;
};

type YouTubeOEmbedResponse = {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
};

export async function fetchMetadataPatch(sourceUrl: string): Promise<ItemMetadataPatch> {
  const normalizedSourceUrl = normalizeSourceUrl(sourceUrl);
  const updatedAt = new Date().toISOString();

  try {
    const metadata = isYouTubeUrl(normalizedSourceUrl)
      ? await fetchYouTubeMetadata(normalizedSourceUrl)
      : await fetchGenericMetadata(normalizedSourceUrl);

    return {
      sourceUrl: metadata.sourceUrl,
      title: metadata.title,
      summary: metadata.summary,
      content: metadata.content,
      thumbnailUrl: metadata.thumbnailUrl,
      aiStatus: 'completed',
      updatedAt,
    };
  } catch {
    return {
      aiStatus: 'failed',
      updatedAt,
    };
  }
}

function normalizeSourceUrl(input: string) {
  const url = new URL(input);

  if (isYouTubeHost(url.hostname)) {
    return normalizeYouTubeUrl(url).toString();
  }

  if (isInstagramHost(url.hostname)) {
    url.hostname = 'www.instagram.com';
    stripTrackingParams(url);
    return url.toString();
  }

  stripTrackingParams(url);
  return url.toString();
}

async function fetchYouTubeMetadata(sourceUrl: string): Promise<MetadataResult> {
  const oEmbedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(sourceUrl)}&format=json`;
  const oEmbedResponse = await fetchWithTimeout(oEmbedUrl, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!oEmbedResponse.ok) {
    throw new Error('youtube oembed failed');
  }

  const oEmbed = (await oEmbedResponse.json()) as YouTubeOEmbedResponse;
  const htmlMetadata = await tryFetchHtmlMetadata(sourceUrl);
  const sanitizedAuthorName = sanitizeText(oEmbed.author_name ?? '');
  const title = pickFirstMeaningful([
    sanitizeText(oEmbed.title ?? ''),
    htmlMetadata?.title ?? '',
    '유튜브 링크',
  ]);
  const summary = pickFirstMeaningful([
    htmlMetadata?.summary ?? '',
    sanitizedAuthorName
      ? `${sanitizedAuthorName} 유튜브 링크를 저장했습니다.`
      : '',
    '유튜브 링크를 저장했습니다.',
  ]);
  const thumbnailUrl = pickFirstMeaningfulUrl([
    htmlMetadata?.thumbnailUrl ?? null,
    oEmbed.thumbnail_url ?? null,
    buildYouTubeThumbnailUrl(sourceUrl),
  ]);

  return {
    sourceUrl,
    title,
    summary,
    content: summary,
    thumbnailUrl,
  };
}

async function fetchGenericMetadata(sourceUrl: string): Promise<MetadataResult> {
  const htmlMetadata = await fetchHtmlMetadata(sourceUrl);

  return {
    sourceUrl: htmlMetadata.sourceUrl ?? sourceUrl,
    title: htmlMetadata.title,
    summary: htmlMetadata.summary,
    content: htmlMetadata.summary,
    thumbnailUrl: htmlMetadata.thumbnailUrl,
  };
}

async function tryFetchHtmlMetadata(sourceUrl: string) {
  try {
    return await fetchHtmlMetadata(sourceUrl);
  } catch {
    return null;
  }
}

async function fetchHtmlMetadata(sourceUrl: string) {
  const response = await fetchWithTimeout(sourceUrl, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8',
    },
  });

  if (!response.ok) {
    throw new Error('html metadata fetch failed');
  }

  const html = await response.text();
  const canonicalUrl = extractLinkHref(html, 'canonical') ?? sourceUrl;
  const title = pickFirstMeaningful([
    extractMetaContent(html, 'property', 'og:title'),
    extractMetaContent(html, 'name', 'twitter:title'),
    extractTitleTag(html),
    `${getHostname(sourceUrl)} 저장 링크`,
  ]);
  const summary = pickFirstMeaningful([
    extractMetaContent(html, 'property', 'og:description'),
    extractMetaContent(html, 'name', 'description'),
    extractMetaContent(html, 'name', 'twitter:description'),
    `${getHostname(sourceUrl)} 링크를 저장했습니다.`,
  ]);
  const thumbnailUrl = pickFirstMeaningUrl([
    extractMetaContent(html, 'property', 'og:image'),
    extractMetaContent(html, 'name', 'twitter:image'),
  ]);

  return {
    sourceUrl: canonicalUrl,
    title,
    summary,
    thumbnailUrl,
  };
}

async function fetchWithTimeout(input: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    return await fetch(input, {
      ...init,
      redirect: 'follow',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractMetaContent(html: string, attribute: 'property' | 'name', key: string) {
  const regex = new RegExp(
    `<meta[^>]+${attribute}=["']${escapeRegExp(key)}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    'i'
  );
  const reverseRegex = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+${attribute}=["']${escapeRegExp(key)}["'][^>]*>`,
    'i'
  );

  return sanitizeText(html.match(regex)?.[1] ?? html.match(reverseRegex)?.[1] ?? '');
}

function extractLinkHref(html: string, rel: string) {
  const regex = new RegExp(
    `<link[^>]+rel=["']${escapeRegExp(rel)}["'][^>]+href=["']([^"']+)["'][^>]*>`,
    'i'
  );
  const reverseRegex = new RegExp(
    `<link[^>]+href=["']([^"']+)["'][^>]+rel=["']${escapeRegExp(rel)}["'][^>]*>`,
    'i'
  );

  return sanitizeText(html.match(regex)?.[1] ?? html.match(reverseRegex)?.[1] ?? '');
}

function extractTitleTag(html: string) {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return sanitizeText(match?.[1] ?? '');
}

function sanitizeText(value: string) {
  return decodeHtmlEntities(value)
    .replace(/\s+/g, ' ')
    .replace(/\| Instagram$/i, '')
    .replace(/\| YouTube$/i, '')
    .trim();
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function pickFirstMeaningful(values: string[]) {
  return values.find((value) => value.trim().length > 0) ?? '';
}

function pickFirstMeaningfulUrl(values: Array<string | null>) {
  return values.find((value) => Boolean(value && value.trim().length > 0)) ?? null;
}

function pickFirstMeaningUrl(values: string[]) {
  return values.find((value) => value.startsWith('http')) ?? null;
}

function buildYouTubeThumbnailUrl(url: string) {
  const videoId = getYouTubeVideoId(url);
  if (!videoId) {
    return null;
  }

  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function getYouTubeVideoId(urlString: string) {
  const url = new URL(urlString);
  const hostname = url.hostname.replace(/^www\./, '');

  if (hostname === 'youtu.be') {
    return url.pathname.split('/').filter(Boolean)[0] ?? null;
  }

  if (url.pathname.startsWith('/watch')) {
    return url.searchParams.get('v');
  }

  if (url.pathname.startsWith('/shorts/')) {
    return url.pathname.split('/').filter(Boolean)[1] ?? null;
  }

  return null;
}

function normalizeYouTubeUrl(url: URL) {
  stripTrackingParams(url);

  const videoId = getYouTubeVideoId(url.toString());
  if (!videoId) {
    return url;
  }

  return new URL(`https://www.youtube.com/watch?v=${videoId}`);
}

function stripTrackingParams(url: URL) {
  const removable = ['si', 'feature', 'igsh', 'utm_source', 'utm_medium', 'utm_campaign'];
  removable.forEach((key) => url.searchParams.delete(key));
}

function isYouTubeUrl(url: string) {
  return isYouTubeHost(new URL(url).hostname);
}

function isYouTubeHost(hostname: string) {
  const normalized = hostname.replace(/^www\./, '');
  return normalized === 'youtube.com' || normalized === 'youtu.be' || normalized === 'm.youtube.com';
}

function isInstagramHost(hostname: string) {
  const normalized = hostname.replace(/^www\./, '');
  return normalized === 'instagram.com' || normalized === 'm.instagram.com';
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
