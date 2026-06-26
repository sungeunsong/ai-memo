export type ActionItem = {
  type: 'phone' | 'bank' | 'address' | 'ingredients';
  label: string;
  value: string;
  icon: string;
};

function uniqueBy<T>(arr: T[], keyGetter: (item: T) => any): T[] {
  const seen = new Set();
  return arr.filter((item) => {
    const k = keyGetter(item);
    return seen.has(k) ? false : seen.add(k);
  });
}

/**
 * 텍스트 데이터 및 구조화 데이터를 분석하여 수행 가능한 빠른 액션 리스트를 도출합니다.
 */
export function parseActionItems(
  rawInput: string,
  userNote?: string,
  structured?: any
): ActionItem[] {
  const actions: ActionItem[] = [];
  const combinedText = `${rawInput || ''}\n${userNote || ''}`;

  // 1. 레시피 재료 복사 액션
  if (
    structured &&
    structured.category === 'recipe' &&
    Array.isArray(structured.ingredients) &&
    structured.ingredients.length > 0
  ) {
    actions.push({
      type: 'ingredients',
      label: '재료 전체 복사',
      value: structured.ingredients.join(', '),
      icon: '🍳',
    });
  }

  // 2. 전화번호 감지 (010, 02 등 연락처 매칭)
  const phoneRegex = /(01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}|0[2-9]\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4})/g;
  let phoneMatch;
  while ((phoneMatch = phoneRegex.exec(combinedText)) !== null) {
    const num = phoneMatch[0].trim();
    // 번호 자체의 자릿수 확인 (너무 짧거나 긴 오탐 방지)
    const cleanNum = num.replace(/[-.\s]/g, '');
    if (cleanNum.length >= 9 && cleanNum.length <= 11) {
      actions.push({
        type: 'phone',
        label: `전화 걸기 (${num})`,
        value: cleanNum,
        icon: '📞',
      });
    }
  }

  // 3. 계좌번호 감지 (은행명 뒤에 오는 숫자-하이픈 조합)
  const bankNames = '국민|KB|신한|우리|하나|농협|NH|기업|IBK|수협|부산|대구|광주|전북|경남|제주|우체국|새마을|신협|저축|토스|Toss|카카오';
  const bankRegex = new RegExp(`(${bankNames})\\s?([0-9-]{8,20})`, 'gi');
  let bankMatch;
  while ((bankMatch = bankRegex.exec(combinedText)) !== null) {
    const bank = bankMatch[1];
    const accountNum = bankMatch[2].trim();
    // 하이픈 제거한 숫자가 최소 8자리 이상인 경우만 감지
    const cleanAccount = accountNum.replace(/-/g, '');
    if (cleanAccount.length >= 8 && /^\d+$/.test(cleanAccount)) {
      actions.push({
        type: 'bank',
        label: `${bank} 계좌 복사`,
        value: `${bank} ${accountNum}`,
        icon: '💳',
      });
    }
  }

  // 4. 행정구역 주소 감지
  const addressRegex = /(([가-힣]+(도|시)|서울|인천|대구|광주|부산|울산|대전|세종)\s([가-힣]+(구|군|시))\s([가-힣\d-]+(로|길|동|읍|면|리)))(\s?\d+)?(-\d+)?/g;
  let addressMatch;
  while ((addressMatch = addressRegex.exec(combinedText)) !== null) {
    const addr = addressMatch[0].trim();
    actions.push({
      type: 'address',
      label: `지도 검색 (${addr.split(' ').slice(1, 3).join(' ') || addr})`,
      value: addr,
      icon: '🗺️',
    });
  }

  // 중복된 고유값 제거
  return uniqueBy(actions, (item) => `${item.type}_${item.value}`);
}
