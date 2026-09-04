import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { FacetOption } from '@/features/facets/query';
import { KIND_LABELS, facetLabel } from '@/features/facets/labels';
import { SavedFilter } from '@/features/facets/savedFilters';
import { Palette } from '@/theme/palette';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
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
  /** 저장해둔 조합 조건 (스마트 폴더) */
  savedFilters: SavedFilter[];
  onApplyFilter: (filter: SavedFilter) => void;
  onRemoveFilter: (id: string) => void;
  onSaveFilter: (name: string) => void;
  canSaveFilter: boolean;
  describeFacetKey: (key: string) => string;
};

const FOLDERS = [
  { label: '전체 🔍', value: '' },
  { label: '레시피 🍳', value: 'recipe' },
  { label: '운동 💪', value: 'workout' },
  { label: '여행 ✈️', value: 'travel' },
  { label: '육아 🍼', value: 'parenting' },
  { label: '공구·꿀템 🛍️', value: 'shopping' },
  { label: '인테리어 🛋️', value: 'interior' },
  { label: '미분류 🏷️', value: 'other' },
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
  savedFilters,
  onApplyFilter,
  onRemoveFilter,
  onSaveFilter,
  canSaveFilter,
  describeFacetKey,
}: Props) {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [isNamingFilter, setIsNamingFilter] = useState(false);
  const [filterName, setFilterName] = useState('');

  function commitFilterName() {
    const name = filterName.trim();
    if (!name) return;
    onSaveFilter(name);
    setFilterName('');
    setIsNamingFilter(false);
  }
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

      {/* 3.5. 스마트 폴더 — 자주 쓰는 조합에 이름을 붙여 저장해둡니다.
              폴더에 아이템을 옮겨 담는 대신 "질문"을 저장하는 방식이라,
              나중에 저장한 것도 조건에 맞으면 자동으로 들어옵니다. */}
      {savedFilters.length > 0 || canSaveFilter ? (
        <View style={styles.selectedPanel}>
          <View style={styles.selectedHeader}>
            <Text style={styles.panelLabel}>내 조건</Text>
            {canSaveFilter && !isNamingFilter ? (
              <Pressable onPress={() => setIsNamingFilter(true)} hitSlop={8}>
                <Text style={styles.clearAllText}>+ 지금 조건 저장</Text>
              </Pressable>
            ) : null}
          </View>

          {isNamingFilter ? (
            <View style={styles.filterNameRow}>
              <TextInput
                autoFocus
                value={filterName}
                onChangeText={setFilterName}
                onSubmitEditing={commitFilterName}
                placeholder="이름 (예: 내 냉장고, 주말 강원도)"
                placeholderTextColor={palette.textMuted}
                style={styles.filterNameInput}
                returnKeyType="done"
              />
              <Pressable onPress={commitFilterName} style={styles.filterNameBtn}>
                <Text style={styles.filterNameBtnText}>저장</Text>
              </Pressable>
              <Pressable onPress={() => setIsNamingFilter(false)} hitSlop={8}>
                <Text style={styles.clearAllText}>취소</Text>
              </Pressable>
            </View>
          ) : null}

          {savedFilters.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipsContainer}
            >
              {savedFilters.map((filter) => (
                <Pressable
                  key={filter.id}
                  onPress={() => onApplyFilter(filter)}
                  onLongPress={() => onRemoveFilter(filter.id)}
                  style={({ pressed }) => [
                    styles.savedFilterChip,
                    { transform: [{ scale: pressed ? 0.94 : 1 }] },
                  ]}
                >
                  <Text style={styles.savedFilterName}>⭐ {filter.name}</Text>
                  <Text style={styles.savedFilterDesc} numberOfLines={1}>
                    {filter.facetKeys.map(describeFacetKey).join(' · ') || '전체'}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
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

const createStyles = (palette: Palette) =>
  StyleSheet.create({
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
    color: palette.accentText,
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
  filterNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  filterNameInput: {
    flex: 1,
    backgroundColor: palette.surfaceRaised,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: 10,
    paddingVertical: 7,
    color: palette.textPrimary,
    fontSize: 12,
  },
  filterNameBtn: {
    backgroundColor: palette.accent,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  filterNameBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '900',
  },
  savedFilterChip: {
    backgroundColor: palette.surfaceRaised,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    paddingHorizontal: 12,
    paddingVertical: 7,
    maxWidth: 200,
  },
  savedFilterName: {
    color: palette.textPrimary,
    fontSize: 12,
    fontWeight: '900',
  },
  savedFilterDesc: {
    color: palette.textMuted,
    fontSize: 9.5,
    fontWeight: '700',
    marginTop: 1,
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
    color: palette.accentText,
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
