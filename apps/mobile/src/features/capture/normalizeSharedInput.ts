export function extractUrlCandidate(input: string) {
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

function tryNormalizeAsUrl(value: string) {
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
