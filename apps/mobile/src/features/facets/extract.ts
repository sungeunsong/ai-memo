/**
 * 저장된 아이템에서 조합 검색에 쓸 facet을 뽑아냅니다.
 *
 * 예전에는 이 파일이 분야를 알고 있었습니다. ingredients는 재료 축, location은 지역 축
 * 하는 식으로요. 그래서 낚시 글이 들어오면 여기를 고쳐야 검색에 잡혔습니다.
 * 지금은 사전(Registry)만 봅니다. 어떤 항목이 어떤 축으로 가는지, 값을 다듬어도 되는지는
 * 전부 정의가 정하고, 이 파일은 그 지시를 따르기만 합니다.
 *
 * 값이 서술형으로 들어오는 경우가 남아 있어 자유 텍스트 훑기는 유지합니다.
 * '오션뷰 인피니티풀'이라는 문장에서 '수영장'을 건져내야
 * 사용자가 기대하는 "국내 + 수영장 + 강원도" 조합이 성립합니다.
 */

import { readContentV2 } from '@/features/items/contentV2';
import { SavedItem } from '@/features/items/types';
import {
  SEED_REGISTRY,
  TaxonomyRegistry,
  axisOf,
  factRef,
  resolveFact,
} from '@/features/taxonomy/registry';
import { FactDefinition } from '@/features/taxonomy/types';

import { AMENITY_TERMS, REGION_TERMS, canonicalize, expand, normalizeByPolicy } from './normalize';

export type Facet = {
  /** 검색 축. globalRole이 있으면 분야를 넘어 하나로 묶입니다 */
  axis: string;
  value: string;
  /** 이 값이 어느 분야의 항목에서 나왔는지. 탭 판정에 씁니다 */
  domainKey: string;
};

/**
 * 사전의 항목이 아니라 자유 텍스트에서 건져낸 축.
 *
 * 숙소 설명에 '인피니티풀'이라고만 적혀 있고 AI가 항목으로 뽑아주지 않는 일이 흔합니다.
 * 그렇다고 시설을 fact로 요구하면 AI가 없는 값을 지어내게 되므로, 글에 실제로 있는
 * 낱말만 골라 별도 축에 둡니다.
 */
export const AMENITY_AXIS = 'amenity';

export const DERIVED_AXIS_LABELS: Record<string, string> = {
  [AMENITY_AXIS]: '시설',
};

/**
 * 칩으로 세울 수 있는 값의 성격.
 *
 * 날짜와 금액과 기간은 뺐습니다. '3만원'과 '3만 2천원'은 서로 다른 칩이 되는데,
 * 사용자가 원하는 것은 그 값으로 거르는 게 아니라 비교하는 것입니다.
 * 서술형(text)도 뺐습니다. 문장은 칩이 되지 않습니다. 대신 아래 훑기의 재료가 됩니다.
 */
const CHIP_VALUE_TYPES = new Set<FactDefinition['valueType']>(['term']);

/** 인덱스와 선택 상태에서 facet 하나를 가리키는 문자열 키입니다. */
export function facetKey(axis: string, value: string): string {
  return `${axis}:${value}`;
}

export function parseFacetKey(key: string): { axis: string; value: string } | null {
  const index = key.indexOf(':');
  if (index <= 0) return null;
  return {
    axis: key.slice(0, index),
    value: key.slice(index + 1),
  };
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

/**
 * 장소 축을 가진 분야인지. 훑기를 켜는 기준입니다.
 *
 * 모든 아이템의 제목과 요약을 지역 사전으로 훑으면 '파주'나 '고성' 같은 낱말이
 * 레시피 글에서도 걸립니다. 장소를 다루는 분야에서만 켜야 오탐이 줄어듭니다.
 */
const PLACE_DOMAINS_CACHE = new WeakMap<TaxonomyRegistry, Set<string>>();

function placeDomains(registry: TaxonomyRegistry): Set<string> {
  const cached = PLACE_DOMAINS_CACHE.get(registry);
  if (cached) return cached;

  const domains = new Set<string>();
  for (const definition of registry.facts.values()) {
    if (definition.globalRole === 'place') domains.add(definition.domainKey);
  }
  PLACE_DOMAINS_CACHE.set(registry, domains);
  return domains;
}

/**
 * 값 하나에 여러 개가 들어 있는 경우를 가릅니다.
 *
 * AI는 '국내 / 호캉스'나 '수영복, 신분증'처럼 한 칸에 여러 개를 적어 보낼 때가 있고,
 * V1에서 옮겨온 값에도 그런 표기가 남아 있습니다. 그대로 두면 그 아이템에서만
 * 쓰이는 칩이 하나 생기고 끝나서, 조합에 아무 쓸모가 없습니다.
 *
 * 다듬지 않기로 한 값(exact)은 가르지 않습니다. 쿠폰 코드나 부품번호에 들어간
 * 슬래시는 값의 일부입니다.
 */
function splitValue(raw: string, policy: FactDefinition['normalizationPolicy']): string[] {
  if (policy !== 'aliasable') return [raw];
  return raw
    .split(/[/,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * 이 값이 훑기가 담당하는 축(장소·시설)의 낱말인지.
 *
 * '온천'은 테마이기도 하고 시설이기도 합니다. 양쪽에 모두 담으면 사용자는
 * 같은 낱말이 적힌 칩을 두 개 보고 어느 쪽을 눌러야 하는지 고민하게 됩니다.
 */
function belongsToScannedAxis(value: string, axis: string): boolean {
  if (axis !== 'place' && REGION_TERMS.includes(value)) return true;
  if (axis !== AMENITY_AXIS && AMENITY_TERMS.includes(value)) return true;
  return false;
}

/**
 * 지명 자리에 섞여 오는 일반 낱말.
 *
 * '양촌리 골짜기'에서 '골짜기'는 그 곳의 이름이 아닙니다. 칩으로 세워두면
 * 서로 아무 상관 없는 계곡 글들이 한 조건으로 묶입니다.
 */
const NOT_PLACE_NAMES = [
  '골짜기', '근처', '인근', '부근', '근방', '일대', '방면', '시내', '외곽',
  '주변', '앞', '뒤', '위치', '숙소', '펜션', '호텔', '리조트',
];

/** 한 값에서 건져낼 구체 지명 수. 이보다 많으면 지명이 아니라 문장입니다. */
const MAX_LEFTOVER_PLACES = 3;

/** 지명 하나의 길이 상한. */
const MAX_PLACE_NAME_LENGTH = 12;

/**
 * 지역 사전이 못 알아본 지명을 건져냅니다.
 *
 * 사전에는 시군구까지만 들어 있습니다. 그 아래(항구, 섬, 리 단위)는 앞으로도
 * 다 넣을 수 없고, 넣는다고 될 일도 아닙니다. 그래서 훑기가 알아본 부분을
 * 걷어내고 남는 낱말을 그대로 남깁니다.
 *
 * '강릉시'처럼 이미 알아본 것과 겹치는 낱말은 뺍니다. 두면 '강릉'과 '강릉시'가
 * 다른 칩으로 서서, 같은 곳을 두 번 골라야 합니다.
 */
function leftoverPlaceNames(values: string[], found: string[]): string[] {
  const names: string[] = [];

  for (const value of values) {
    for (const token of value.split(/[\s,·/]+/)) {
      const name = token.trim();
      if (name.length < 2 || name.length > MAX_PLACE_NAME_LENGTH) continue;

      // 이미 알아본 지역과 겹치면 뺍니다. ('강릉' ↔ '강릉시')
      if (found.some((region) => name.includes(region) || region.includes(name))) continue;

      // 시설 낱말은 시설 축이 맡습니다.
      if (AMENITY_TERMS.includes(name)) continue;
      if (NOT_PLACE_NAMES.includes(name)) continue;

      if (!names.includes(name)) names.push(name);
      if (names.length >= MAX_LEFTOVER_PLACES) return names;
    }
  }

  return names;
}

export type ItemFacets = {
  facets: Facet[];
  /** 이 아이템이 걸쳐 있는 분야들. 탭 판정에 씁니다 */
  domainKeys: Set<string>;
  /**
   * 이 아이템이 들고 있는 분야 이름.
   *
   * AI가 방금 만든 분야는 사전에 등록되기 전일 수 있습니다. 그때 탭에 'fishing'이라고
   * 적혀 있으면 무엇인지 알 수 없습니다. 아이템에 적힌 이름이라도 쓰는 편이 낫습니다.
   */
  domainLabel: { key: string; label: string } | null;
};

function push(collector: ItemFacets, axis: string, value: string, domainKey: string) {
  if (!value) return;
  collector.facets.push({ axis, value, domainKey });
}

/**
 * 아이템이 가진 facet과, 그 값들이 나온 분야를 함께 반환합니다.
 *
 * 분야를 따로 모으는 이유는 탭 때문입니다. 서술형 항목만 가진 아이템은 칩이 하나도
 * 안 생기는데, 그렇다고 그 분야 탭에서 사라지면 사용자는 저장한 것을 잃어버립니다.
 */
export function extractItemFacets(
  item: SavedItem,
  registry: TaxonomyRegistry = SEED_REGISTRY
): ItemFacets {
  const collector: ItemFacets = { facets: [], domainKeys: new Set(), domainLabel: null };

  const content = readContentV2(item.content);
  if (!content) return collector;

  collector.domainKeys.add(content.domain.key);
  collector.domainLabel = { key: content.domain.key, label: content.domain.label };

  // 분야로 가르지 않고 "있는 항목은 전부" 뽑습니다.
  //
  // DM 하나에 여행 추천과 레시피가 같이 오는 일이 흔한데, 아이템의 분야는 하나뿐이라
  // 분야로 가르면 나머지 절반이 통째로 버려집니다.
  // fact가 자기 정의를 직접 가리키므로 분야가 섞여 있어도 각자 제 축으로 갑니다.
  const placeTexts: string[] = [];
  const freeTexts: string[] = [item.title, item.summary];
  let placeDomainKey: string | null = null;

  // 훑기를 켤지 먼저 정합니다. 아래에서 값 하나하나를 다룰 때 이 판단이 필요합니다.
  const scanEnabled =
    placeDomains(registry).has(content.domain.key) ||
    content.facts.some(
      (fact) => fact && resolveFact(registry, fact.domainKey, fact.key).globalRole === 'place'
    );

  for (const fact of content.facts) {
    if (!fact || typeof fact.key !== 'string') continue;

    const definition = resolveFact(registry, fact.domainKey, fact.key);
    const axis = axisOf(definition);
    const isPlace = definition.globalRole === 'place';
    if (isPlace) placeDomainKey = fact.domainKey;

    collector.domainKeys.add(fact.domainKey);

    const bucketize = SPECIAL_VALUE_BUCKETS[factRef(fact.domainKey, fact.key)];
    const values = Array.isArray(fact.values) ? fact.values : [];

    for (const raw of values) {
      if (typeof raw !== 'string' || !raw.trim()) continue;

      if (bucketize) {
        for (const bucket of bucketize(raw)) {
          push(collector, axis, bucket, fact.domainKey);
        }
        continue;
      }

      if (definition.valueType === 'text') {
        freeTexts.push(raw);
        continue;
      }

      if (!CHIP_VALUE_TYPES.has(definition.valueType)) continue;

      if (isPlace) {
        // 장소는 '강원도 강릉시'처럼 통짜로 들어옵니다. 그대로 두면 그 칩이
        // 그 아이템 하나에서만 쓰이고 끝나서 조합에 아무 쓸모가 없습니다.
        // 아래 훑기가 '강릉'과 '강원도'를 갈라냅니다.
        placeTexts.push(raw);
        continue;
      }

      for (const part of splitValue(raw, definition.normalizationPolicy)) {
        // 지역과 시설 낱말은 아래 훑기가 제 축으로 보냅니다. 여기서도 담으면
        // '국내'가 테마 칩으로도 서서, 같은 조건이 두 군데에 생깁니다.
        if (scanEnabled && belongsToScannedAxis(part, axis)) continue;

        for (const value of normalizeByPolicy(part, definition.normalizationPolicy)) {
          push(collector, axis, value, fact.domainKey);
        }
      }
    }
  }

  // 장소와 시설은 서술형 문장 안에 묻혀 있는 경우가 많아 따로 훑습니다.
  const scanDomain = placeDomainKey ?? content.domain.key;
  if (scanEnabled) {
    const haystack = [...placeTexts, ...freeTexts]
      .filter((part): part is string => typeof part === 'string')
      .join(' ');

    const regions = scanTerms(haystack, REGION_TERMS);
    for (const region of regions) {
      // 상위 지역까지 함께 붙여야 '강원도'로 걸었을 때 강릉 숙소가 나옵니다.
      for (const value of expand(region)) {
        push(collector, 'place', value, scanDomain);
      }
    }

    // 사전에 없는 구체 지명도 남깁니다.
    //
    // '경기도 화성시 궁평항'에서 사전이 아는 것은 '경기도'뿐입니다. 그것만 남기면
    // 궁평항은 사라지고, 그 낚시터를 다시 찾을 방법이 지역 단위밖에 안 남습니다.
    // 사용자가 기억하는 이름은 대개 큰 지역이 아니라 그 구체적인 곳입니다.
    for (const name of leftoverPlaceNames(placeTexts, regions)) {
      push(collector, 'place', name, scanDomain);
    }
    for (const amenity of scanTerms(haystack, AMENITY_TERMS)) {
      // 시설 낱말은 표기가 여러 가지입니다. '인피니티풀'과 '야외수영장'을
      // 그대로 두면 같은 조건을 두 번 눌러야 합니다.
      const canonical = canonicalize(amenity);
      if (canonical) push(collector, AMENITY_AXIS, canonical, scanDomain);
    }
  }

  // 훑기가 아무것도 못 건진 장소 값은 원문이라도 남깁니다.
  // 사전에 없는 동네를 통째로 버리면 그 아이템은 장소가 없는 것이 됩니다.
  if (placeTexts.length > 0 && !collector.facets.some((facet) => facet.axis === 'place')) {
    for (const raw of placeTexts) {
      push(collector, 'place', raw.trim(), scanDomain);
    }
  }

  collector.facets = dedupe(collector.facets);
  return collector;
}

export function extractFacets(
  item: SavedItem,
  registry: TaxonomyRegistry = SEED_REGISTRY
): Facet[] {
  return extractItemFacets(item, registry).facets;
}

/**
 * 월령 구간. 아이는 계속 크기 때문에 "지금 우리 애한테 맞는 것"으로 꺼내는 축이 됩니다.
 * 개월 수를 그대로 두면 6개월과 7개월이 다른 값이 되어 조합이 흩어지므로 구간으로 묶습니다.
 */
const AGE_BUCKETS: { label: string; from: number; to: number }[] = [
  { label: '신생아', from: 0, to: 3 },
  { label: '4~6개월', from: 4, to: 6 },
  { label: '7~12개월', from: 7, to: 12 },
  { label: '돌~24개월', from: 13, to: 24 },
  { label: '2~4세', from: 25, to: 48 },
  { label: '5세 이상', from: 49, to: 200 },
];

/**
 * '6' 또는 '6-12' 같은 개월 표기를 겹치는 구간 전부로 바꿉니다.
 * 범위가 두 구간에 걸치면 양쪽 모두에서 검색되어야 합니다.
 */
function toAgeBuckets(raw: string): string[] {
  const numbers = raw.match(/\d+/g);
  if (!numbers || numbers.length === 0) return [];

  const from = Number(numbers[0]);
  const to = numbers.length > 1 ? Number(numbers[1]) : from;
  if (Number.isNaN(from) || Number.isNaN(to)) return [];

  const lo = Math.min(from, to);
  const hi = Math.max(from, to);

  return AGE_BUCKETS.filter((bucket) => bucket.from <= hi && bucket.to >= lo).map((b) => b.label);
}

/**
 * 값 자체로는 축이 되지 않아 구간으로 바꿔야 하는 항목.
 *
 * 6개월과 7개월을 다른 값으로 두면 조합이 흩어져서 아무것도 안 걸립니다.
 * 구간 이름은 육아에서만 뜻이 통하므로 일반 규칙으로 만들지 않고 여기 적어둡니다.
 */
const SPECIAL_VALUE_BUCKETS: Record<string, (raw: string) => string[]> = {
  [factRef('parenting', 'baby_age')]: toAgeBuckets,
};

function dedupe(facets: Facet[]): Facet[] {
  const seen = new Set<string>();
  const result: Facet[] = [];
  for (const facet of facets) {
    // 같은 값이 두 분야에서 나오면 둘 다 남깁니다. 칩은 축과 값으로만 묶이므로
    // 화면에는 하나로 보이고, 탭 판정에는 두 분야가 모두 필요합니다.
    const key = `${facet.axis} ${facet.value} ${facet.domainKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(facet);
  }
  return result;
}
