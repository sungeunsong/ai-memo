import { useCallback } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { FacetOption } from '@/features/facets/query';
import { KIND_LABELS, facetLabel } from '@/features/facets/labels';
import { palette } from '@/theme/palette';
import { spacing } from '@/theme/spacing';

type Props = {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  activeCategory: string;
  onCategoryChange: (category: string) => void;
  /** 선택된 facet 키. 서로 AND로 묶입니다. */
  selectedFacets: string[];
  onToggleFacet: (key: string) => void;
  onClearFacets: () => void;
  /**
   * 지금 고를 수 있는 facet과 각각을 눌렀을 때의 결과 건수.
   * 0건이 되는 것은 애초에 여기 담기지 않습니다.
   */
  facetOptions: FacetOption[];
};

const FOLDERS = [
  { label: '전체 🔍', value: '' },
  { label: '레시피 🍳', value: 'recipe' },
  { label: '운동 💪', value: 'workout' },
  { label: '여행 ✈️', value: 'travel' },
  { label: '육아 🍼', value: 'parenting' },
];

/** 추천 칩이 너무 많으면 고르는 것 자체가 일이 됩니다. */
const MAX_SUGGESTED_CHIPS = 12;

export function SearchFilterBar({
  searchQuery,
  onSearchChange,
  activeCategory,
  onCategoryChange,
  selectedFacets,
  onToggleFacet,
  onClearFacets,
  facetOptions,
}: Props) {
  const handleSearchInput = useCallback(
    (text: string) => {
      onSearchChange(text);
    },
    [onSearchChange]
  );

  const selected = facetOptions.filter((option) => option.selected);
  const suggestions = facetOptions
    .filter((option) => !option.selected)
    .slice(0, MAX_SUGGESTED_CHIPS);

  return (
    <View style={styles.container}>
      {/* 1. 검색 입력 */}
      <View style={styles.searchRow}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={handleSearchInput}
          placeholder="재료, 지역, 부위로 검색 (예: 강원도 수영장)"
          placeholderTextColor={palette.textMuted}
          style={styles.searchInput}
          value={searchQuery}
        />
        {searchQuery ? (
          <Pressable onPress={() => onSearchChange('')} style={styles.clearBtn}>
            <Text style={styles.clearBtnText}>✕</Text>
          </Pressable>
        ) : null}
      </View>

      {/* 2. 스마트 폴더 탭 */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabsRow}
      >
        {FOLDERS.map((folder) => {
          const isActive = activeCategory === folder.value;
          return (
            <Pressable
              key={folder.value}
              onPress={() => onCategoryChange(folder.value)}
              style={({ pressed }) => [
                styles.tab,
                isActive && styles.tabActive,
                { transform: [{ scale: pressed ? 0.96 : 1 }] },
              ]}
            >
              <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
                {folder.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* 3. 선택된 조건 — 조합의 현재 상태를 항상 눈에 보이게 둡니다. */}
      {selected.length > 0 ? (
        <View style={styles.selectedPanel}>
          <View style={styles.selectedHeader}>
            <Text style={styles.panelLabel}>조건 {selected.length}개</Text>
            <Pressable onPress={onClearFacets} hitSlop={8}>
              <Text style={styles.clearAllText}>모두 해제</Text>
            </Pressable>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsContainer}
          >
            {selected.map((option) => (
              <Pressable
                key={option.key}
                onPress={() => onToggleFacet(option.key)}
                style={({ pressed }) => [
                  styles.chip,
                  styles.chipActive,
                  { transform: [{ scale: pressed ? 0.94 : 1 }] },
                ]}
              >
                <Text style={[styles.chipText, styles.chipTextActive]}>
                  {facetLabel(option.kind, option.value)} ✕
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {/* 4. 추천 조건 — 건수를 함께 보여줘 "누르면 몇 건 남는지"를 미리 알 수 있게 합니다. */}
      {suggestions.length > 0 ? (
        <View style={styles.selectedPanel}>
          <Text style={styles.panelLabel}>
            {selected.length > 0 ? '조건 더하기' : '추천 조건'}
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsContainer}
          >
            {suggestions.map((option) => (
              <Pressable
                key={option.key}
                onPress={() => onToggleFacet(option.key)}
                style={({ pressed }) => [
                  styles.chip,
                  { transform: [{ scale: pressed ? 0.94 : 1 }] },
                ]}
              >
                <Text style={styles.chipText}>
                  {facetLabel(option.kind, option.value)}
                  <Text style={styles.chipCount}> {option.count}</Text>
                </Text>
                <Text style={styles.chipKind}>{KIND_LABELS[option.kind]}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing[3],
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.surfaceRaised,
    borderRadius: 16,
    paddingHorizontal: spacing[3],
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: palette.border,
    gap: spacing[2],
  },
  searchIcon: {
    fontSize: 13,
    opacity: 0.6,
  },
  searchInput: {
    flex: 1,
    color: palette.textPrimary,
    fontSize: 13.5,
    paddingVertical: 8,
  },
  clearBtn: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  clearBtnText: {
    color: palette.textMuted,
    fontSize: 12,
    fontWeight: '900',
  },
  tabsRow: {
    flexDirection: 'row',
    gap: spacing[2],
    paddingRight: spacing[2],
  },
  tab: {
    backgroundColor: palette.surface,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: spacing[3] + 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: palette.border,
  },
  tabActive: {
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    borderColor: palette.accent,
  },
  tabText: {
    color: palette.textSecondary,
    fontSize: 12,
    fontWeight: '800',
  },
  tabTextActive: {
    color: '#c084fc',
  },
  selectedPanel: {
    gap: spacing[1] + 2,
  },
  selectedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 2,
  },
  panelLabel: {
    color: palette.textMuted,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
    paddingLeft: 2,
  },
  clearAllText: {
    color: palette.textSecondary,
    fontSize: 10,
    fontWeight: '800',
  },
  chipsContainer: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 2,
    paddingRight: spacing[4],
  },
  chip: {
    backgroundColor: palette.surfaceRaised,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
  },
  chipActive: {
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    borderColor: palette.accent,
  },
  chipText: {
    color: palette.textSecondary,
    fontSize: 11,
    fontWeight: '800',
  },
  chipTextActive: {
    color: '#c084fc',
  },
  chipCount: {
    color: palette.textMuted,
    fontSize: 10,
    fontWeight: '900',
  },
  chipKind: {
    color: palette.textMuted,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.4,
    marginTop: 1,
  },
});
