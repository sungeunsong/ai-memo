/**
 * 검색어를 필터 칩으로 자동 변환합니다.
 *
 * 조합 검색의 가장 큰 걸림돌은 "칩을 찾아 눌러야 한다"는 학습 비용입니다.
 * 사용자는 그냥 "강원도 수영장"이라고 칩니다. 그걸 그대로 조합 조건으로 바꿔주면
 * 아무것도 배우지 않고도 조합 검색을 쓰고 있는 상태가 됩니다.
 *
 * 변환은 "정확히 일치할 때만" 일어납니다. 애매한 추측으로 칩이 붙으면
 * 사용자가 입력한 것과 화면이 달라져 오히려 통제감을 잃습니다.
 * 또 입력 중인 마지막 낱말은 건드리지 않습니다. 타이핑 도중 글자를 빼앗기면
 * 한글 조합이 끊겨서 쓰기 어려워집니다.
 */

import { canonicalize } from './normalize';
import { FacetIndex } from './query';
import { parseFacetKey } from './extract';

export type ParsedQuery = {
  /** 칩으로 승격된 facet 키 */
  facetKeys: string[];
  /** facet으로 해석되지 않아 텍스트 검색에 남는 부분 */
  rest: string;
};

export function parseQueryToFacets(index: FacetIndex, query: string): ParsedQuery {
  const empty: ParsedQuery = { facetKeys: [], rest: query };
  if (!query.trim()) return empty;

  // 마지막 낱말이 아직 입력 중인지 판단합니다.
  const endsWithSpace = /\s$/.test(query);
  const tokens = query.trim().split(/\s+/);
  const convertible = endsWithSpace ? tokens : tokens.slice(0, -1);
  const trailing = endsWithSpace ? [] : tokens.slice(-1);

  if (convertible.length === 0) return empty;

  // facet 값 -> 키 목록. 같은 값이 여러 종류로 존재할 수 있습니다.
  const byValue = new Map<string, string[]>();
  for (const key of index.byKey.keys()) {
    const parsed = parseFacetKey(key);
    if (!parsed) continue;
    const bucket = byValue.get(parsed.value);
    if (bucket) {
      bucket.push(key);
    } else {
      byValue.set(parsed.value, [key]);
    }
  }

  const facetKeys: string[] = [];
  const rest: string[] = [];

  for (const token of convertible) {
    const canonical = canonicalize(token);
    if (!canonical) {
      rest.push(token);
      continue;
    }

    // 정확히 일치하면 바로 승격합니다.
    let matched = byValue.get(canonical);

    if (!matched) {
      // 앞부분만 쳐도 알아보게 합니다. '강원'이라 치면 '강원도'로 붙습니다.
      // 다만 후보가 둘 이상이면 사용자가 어느 쪽을 뜻했는지 알 수 없으므로
      // 건드리지 않고 텍스트로 남깁니다. 잘못 짚으면 통제감을 잃습니다.
      const prefixMatches = [...byValue.keys()].filter((value) => value.startsWith(canonical));
      if (prefixMatches.length === 1) {
        matched = byValue.get(prefixMatches[0]);
      }
    }

    if (matched && matched.length > 0) {
      for (const key of matched) {
        if (!facetKeys.includes(key)) facetKeys.push(key);
      }
    } else {
      rest.push(token);
    }
  }

  return {
    facetKeys,
    rest: [...rest, ...trailing].join(' '),
  };
}
