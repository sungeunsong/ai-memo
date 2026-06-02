export function extractUrlCandidate(input: string): string {
  const trimmed = input.trim();

  if (!trimmed) {
    throw new Error('URL을 입력해 주세요.');
  }

  const directCandidate = tryNormalizeAsUrl(trimmed);
  if (directCandidate) {
    return directCandidate;
  }

  const urlMatch = trimmed.match(
    /\b((https?:\/\/|www\.)[^\s<>"']+|(?:youtube\.com|m\.youtube\.com|youtu\.be|instagram\.com|www\.instagram\.com)\/[^\s<>"']+)/i
  );

  if (!urlMatch) {
    throw new Error('입력한 텍스트에서 링크를 찾지 못했습니다.');
  }

  const matchedValue = urlMatch[1].replace(/[)\],.!?]+$/, '');
  const normalizedCandidate = tryNormalizeAsUrl(matchedValue);

  if (!normalizedCandidate) {
    throw new Error('올바른 링크 형식인지 확인해 주세요.');
  }

  return normalizedCandidate;
}

export function extractAllUrls(input: string): string[] {
  const trimmed = input.trim();
  if (!trimmed) {
    return [];
  }

  // 텍스트 전체에서 URL 패턴 매칭
  const urlRegex = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
  const matches = trimmed.match(urlRegex) ?? [];
  const normalizedUrls: string[] = [];

  for (const match of matches) {
    const cleaned = match.replace(/[)\],.!?]+$/, '');
    const normalized = tryNormalizeAsUrl(cleaned);
    if (normalized && !normalizedUrls.includes(normalized)) {
      normalizedUrls.push(normalized);
    }
  }

  // 프로토콜이 없는 도메인 기반 패턴 추가 매칭 (ex: youtube.com/watch...)
  const domainPatternRegex = /\b(?:youtube\.com|m\.youtube\.com|youtu\.be|instagram\.com|www\.instagram\.com|notion\.so|notion\.site)\/[^\s<>"']+/gi;
  const domainMatches = trimmed.match(domainPatternRegex) ?? [];
  for (const match of domainMatches) {
    const cleaned = match.replace(/[)\],.!?]+$/, '');
    const normalized = tryNormalizeAsUrl(cleaned);
    if (normalized && !normalizedUrls.includes(normalized)) {
      normalizedUrls.push(normalized);
    }
  }

  return normalizedUrls;
}

export function classifySourceType(sourceUrl: string | null, rawText: string): string {
  if (!sourceUrl) {
    return 'manual_text';
  }

  try {
    const url = new URL(sourceUrl);
    const hostname = url.hostname.replace(/^www\./, '');

    if (hostname === 'youtube.com' || hostname === 'youtu.be' || hostname === 'm.youtube.com') {
      return 'youtube';
    }

    if (hostname === 'instagram.com' || hostname === 'm.instagram.com') {
      if (url.pathname.includes('/p/')) {
        return 'instagram_post';
      }
      if (url.pathname.includes('/reel/') || url.pathname.includes('/reels/')) {
        return 'instagram_reel';
      }
      return 'instagram';
    }

    if (hostname === 'notion.so' || hostname === 'notion.site' || hostname.includes('notion')) {
      const lowerText = rawText.toLowerCase();
      if (lowerText.includes('기저귀') || lowerText.includes('분유') || lowerText.includes('육아') || lowerText.includes('아동') || lowerText.includes('출산') || lowerText.includes('다자녀')) {
        return 'parenting';
      }
      return 'notion';
    }

    if (hostname === 'docs.google.com') {
      if (url.pathname.startsWith('/document/')) {
        return 'google_docs';
      }
      if (url.pathname.startsWith('/spreadsheets/')) {
        return 'google_sheets';
      }
      if (url.pathname.startsWith('/forms/')) {
        return 'google_form';
      }
      return 'google_drive';
    }

    if (hostname === 'drive.google.com') {
      return 'google_drive';
    }

    if (hostname === 'forms.gle') {
      return 'google_form';
    }

    const lowerText = rawText.toLowerCase();
    if (lowerText.includes('기저귀') || lowerText.includes('분유') || lowerText.includes('육아') || lowerText.includes('아동') || lowerText.includes('출산') || lowerText.includes('다자녀')) {
      return 'parenting';
    }

    return 'web';
  } catch {
    const lowerText = rawText.toLowerCase();
    if (lowerText.includes('기저귀') || lowerText.includes('분유') || lowerText.includes('육아') || lowerText.includes('아동') || lowerText.includes('출산') || lowerText.includes('다자녀')) {
      return 'parenting';
    }
    return 'web';
  }
}

export function tryNormalizeAsUrl(value: string): string | null {
  try {
    const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const url = new URL(withProtocol);

    if (!['http:', 'https:'].includes(url.protocol)) {
      return null;
    }

    if (!url.hostname.includes('.')) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}
