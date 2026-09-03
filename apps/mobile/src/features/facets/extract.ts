/**
 * 저장된 아이템에서 조합 검색에 쓸 facet을 뽑아냅니다.
 *
 * AI가 채워준 구조화 필드(ingredients, targetMuscles, location ...)가 1차 재료이고,
 * 여행처럼 값이 서술형으로 들어오는 경우에는 자유 텍스트에서 알려진 용어를 골라냅니다.
 * '오션뷰 인피니티풀'이라는 문장에서 '수영장'을 건져내야
 * 사용자가 기대하는 "국내 + 수영장 + 강원도" 조합이 성립합니다.
 */

import { SavedItem } from '@/features/items/types';
import { getItemCategory } from '@/utils/formatters';

import { AMENITY_TERMS, REGION_TERMS, canonicalize, normalizeToValues } from './normalize';

export type FacetKind = 'ingredient' | 'muscle' | 'equipment' | 'region' | 'amenity' | 'theme';

export type Facet = {
  kind: FacetKind;
  value: string;
};

/** 인덱스와 선택 상태에서 facet 하나를 가리키는 문자열 키입니다. */
export function facetKey(kind: FacetKind, value: string): string {
  return `${kind}:${value}`;
}

export function parseFacetKey(key: string): Facet | null {
  const index = key.indexOf(':');
  if (index <= 0) return null;
  return {
    kind: key.slice(0, index) as FacetKind,
    value: key.slice(index + 1),
  };
}

function safeParse(content: string): any {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function pushValues(target: Facet[], kind: FacetKind, raw: unknown) {
  if (typeof raw !== 'string') return;
  for (const value of normalizeToValues(raw)) {
    target.push({ kind, value });
  }
}

function pushArray(target: Facet[], kind: FacetKind, raw: unknown) {
  if (!Array.isArray(raw)) return;
  for (const entry of raw) {
    pushValues(target, kind, entry);
  }
}

/**
 * 자유 텍스트에서 사전에 등록된 용어를 골라냅니다.
 * 단순 포함 검사라 오탐 여지가 있지만, 여행 정보는 표현이 워낙 자유로워
 * 정확한 파싱보다 이 방식의 회수율이 실제로 더 높습니다.
 */
function scanTerms(text: string, terms: string[]): string[] {
  if (!text) return [];
  const found: string[] = [];
  for (const term of terms) {
    if (text.includes(term)) {
      found.push(term);
    }
  }
  return found;
}

export function extractFacets(item: SavedItem): Facet[] {
  const structured = safeParse(item.content);
  const category = getItemCategory(item);
  const facets: Facet[] = [];

  if (category === 'recipe') {
    pushArray(facets, 'ingredient', structured?.ingredients);
  }

  if (category === 'workout') {
    pushArray(facets, 'muscle', structured?.targetMuscles);
    pushArray(facets, 'equipment', structured?.equipments);
  }

  if (category === 'travel') {
    // location은 '강원도 강릉시'처럼 통짜 문자열로 오므로 그대로 쓰지 않습니다.
    // 아래 scanTerms가 그 안에서 '강릉'과 '강원도'를 분리해 뽑아냅니다.

    // travelTheme은 '국내 / 호캉스'처럼 지역과 테마가 한 문자열에 섞여 옵니다.
    if (typeof structured?.travelTheme === 'string') {
      for (const token of structured.travelTheme.split('/')) {
        const canonical = canonicalize(token);
        if (!canonical) continue;

        // 같은 값이 종류만 다르게 두 번 잡히면 칩이 중복으로 보입니다.
        // ('온천'이 테마로도 시설로도 걸리는 경우)
        // 지역과 시설은 아래 scanTerms가 따로 훑으므로 여기서는 그 외의 것만 테마로 둡니다.
        if (REGION_TERMS.includes(canonical) || AMENITY_TERMS.includes(canonical)) continue;

        pushValues(facets, 'theme', canonical);
      }
    }

    // 지역·편의시설은 서술형 문장 안에 묻혀 있는 경우가 많아 별도로 훑습니다.
    const freeText = [
      structured?.location,
      structured?.travelTheme,
      ...(Array.isArray(structured?.highlights) ? structured.highlights : []),
      item.title,
      item.summary,
    ]
      .filter((part): part is string => typeof part === 'string')
      .join(' ');

    for (const region of scanTerms(freeText, REGION_TERMS)) {
      pushValues(facets, 'region', region);
    }
    for (const amenity of scanTerms(freeText, AMENITY_TERMS)) {
      pushValues(facets, 'amenity', amenity);
    }
  }

  return dedupe(facets);
}

function dedupe(facets: Facet[]): Facet[] {
  const seen = new Set<string>();
  const result: Facet[] = [];
  for (const facet of facets) {
    const key = facetKey(facet.kind, facet.value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(facet);
  }
  return result;
}
