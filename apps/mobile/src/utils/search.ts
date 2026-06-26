const CHOSEONG = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'
];
const JUNGSEONG = [
  'ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'
];
const JONGSEONG = [
  '', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'
];

/**
 * 한글 한 글자를 자모 단위로 분리합니다.
 */
export function disassembleCharacter(char: string): string {
  const code = char.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    const offset = code - 0xac00;
    const cho = Math.floor(offset / 588);
    const jung = Math.floor((offset % 588) / 28);
    const jong = offset % 28;

    let result = CHOSEONG[cho] + JUNGSEONG[jung];
    if (JONGSEONG[jong]) {
      result += JONGSEONG[jong];
    }
    return result;
  }
  return char;
}

/**
 * 문자열 전체를 자모 단위로 분리합니다. (예: '감자' -> 'ㄱㅏㅁㅈㅏ')
 */
export function disassembleHangul(text: string): string {
  return text.split('').map(disassembleCharacter).join('');
}

/**
 * 문자열에서 한글 음절을 초성으로 변환합니다. 한글이 아닌 문자는 유지합니다. (예: '감자 맛집' -> 'ㄱㅈ ㅁㅈ')
 */
export function getChoseongString(text: string): string {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xac00 && code <= 0xd7a3) {
      const cho = Math.floor((code - 0xac00) / 588);
      result += CHOSEONG[cho];
    } else {
      result += text[i];
    }
  }
  return result;
}

/**
 * 입력된 쿼리가 한글 초성(ㄱ~ㅎ)과 공백으로만 구성되어 있는지 확인합니다.
 */
export function isChoseongOnly(query: string): boolean {
  const clean = query.replace(/\s/g, '');
  if (!clean) return false;
  return clean.split('').every(char => CHOSEONG.includes(char));
}

/**
 * 한글 초성 검색 및 자소 단위 퍼지 검색을 지원하는 매칭 함수입니다.
 * @param target 검색 대상 텍스트
 * @param query 검색어
 */
export function hangulMatch(target: string, query: string): boolean {
  const cleanTarget = target.toLowerCase().trim();
  const cleanQuery = query.toLowerCase().trim();

  if (!cleanQuery) return true;
  if (!cleanTarget) return false;

  // 1. 단순 포함 관계 확인
  if (cleanTarget.includes(cleanQuery)) return true;

  // 2. 초성 전용 검색 (예: 'ㄱㅈ' -> '감자')
  if (isChoseongOnly(cleanQuery)) {
    const choseongTarget = getChoseongString(cleanTarget);
    if (choseongTarget.includes(cleanQuery)) return true;
  }

  // 3. 자소 분리 부분 매칭 (예: '감ㅈ' -> '감자' / 'ㄱㅏㅁㅈ' -> 'ㄱㅏㅁㅈㅏ')
  const disassembledTarget = disassembleHangul(cleanTarget);
  const disassembledQuery = disassembleHangul(cleanQuery);
  if (disassembledTarget.includes(disassembledQuery)) return true;

  // 4. 자소 단위 순서 매칭 (퍼지 검색: 'ㄹ시피' -> '레시피' / 'ㄹㅅㅣㅍㅣ' -> 'ㄹㅔㅅㅣㅍㅣ')
  let queryIdx = 0;
  for (let i = 0; i < disassembledTarget.length; i++) {
    if (disassembledTarget[i] === disassembledQuery[queryIdx]) {
      queryIdx++;
    }
    if (queryIdx === disassembledQuery.length) {
      return true;
    }
  }

  return false;
}
