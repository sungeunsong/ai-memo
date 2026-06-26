import { useMemo, useRef, useCallback } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { SavedItem } from '@/features/items/types';
import { extractDynamicChips } from '@/utils/formatters';
import { palette } from '@/theme/palette';
import { spacing } from '@/theme/spacing';

type Props = {
  items: SavedItem[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  activeCategory: string;
  onCategoryChange: (category: string) => void;
  activeKeyword: string;
  onKeywordChange: (keyword: string) => void;
};

const FOLDERS = [
  { label: '전체 🔍', value: '' },
  { label: '레시피 🍳', value: 'recipe' },
  { label: '운동 💪', value: 'workout' },
  { label: '여행 ✈️', value: 'travel' },
];

export function SearchFilterBar({
  items,
  searchQuery,
  onSearchChange,
  activeCategory,
  onCategoryChange,
  activeKeyword,
  onKeywordChange,
}: Props) {
  // 현재 카테고리에 맞는 동적 키워드 칩 추출
  const chips = useMemo(
    () => extractDynamicChips(items, activeCategory),
    [items, activeCategory]
  );

  const handleSearchInput = useCallback(
    (text: string) => {
      onSearchChange(text);
    },
    [onSearchChange]
  );

  return (
    <View style={styles.container}>
      {/* 1. 검색 입력 */}
      <View style={styles.searchRow}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={handleSearchInput}
          placeholder="재료, 운동부위, 제목 등 검색..."
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

      {/* 2. 스마트 폴더 탭 UI */}
      <View style={styles.tabsRow}>
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
      </View>

      {/* 3. 동적 키워드 칩 추천 */}
      {chips.length > 0 ? (
        <View style={styles.keywordPanel}>
          <Text style={styles.keywordPanelLabel}>추천 키워드</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsContainer}
          >
            {chips.map((chip) => {
              const isActive = activeKeyword === chip.value;
              return (
                <Pressable
                  key={chip.value}
                  onPress={() => onKeywordChange(isActive ? '' : chip.value)}
                  style={({ pressed }) => [
                    styles.chip,
                    isActive && styles.chipActive,
                    { transform: [{ scale: pressed ? 0.94 : 1 }] },
                  ]}
                >
                  <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                    {chip.label}
                  </Text>
                </Pressable>
              );
            })}
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
    width: 22,
    height: 22,
    backgroundColor: palette.surface,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearBtnText: {
    color: palette.textSecondary,
    fontSize: 9,
    fontWeight: '900',
  },
  // 스마트 폴더 탭 스타일
  tabsRow: {
    flexDirection: 'row',
    gap: spacing[2],
    justifyContent: 'space-between',
  },
  tab: {
    flex: 1,
    backgroundColor: palette.surface,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: palette.border,
  },
  tabActive: {
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    borderColor: '#8b5cf6',
  },
  tabText: {
    color: palette.textSecondary,
    fontSize: 12,
    fontWeight: '800',
  },
  tabTextActive: {
    color: '#c084fc',
  },
  // 키워드 추천 영역
  keywordPanel: {
    gap: spacing[1] + 2,
  },
  keywordPanelLabel: {
    color: palette.textMuted,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingLeft: 2,
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
  },
  chipActive: {
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    borderColor: '#8b5cf6',
  },
  chipText: {
    color: palette.textSecondary,
    fontSize: 11,
    fontWeight: '800',
  },
  chipTextActive: {
    color: '#c084fc',
  },
});
