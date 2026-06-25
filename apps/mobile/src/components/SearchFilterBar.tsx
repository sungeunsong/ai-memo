import { useMemo, useRef, useState, useCallback } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { SavedItem } from '@/features/items/types';
import { extractDynamicChips, FilterChip } from '@/utils/formatters';
import { palette } from '@/theme/palette';
import { spacing } from '@/theme/spacing';

type Props = {
  items: SavedItem[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  activeChipValue: string;
  onChipChange: (value: string) => void;
};

export function SearchFilterBar({
  items,
  searchQuery,
  onSearchChange,
  activeChipValue,
  onChipChange,
}: Props) {
  const chips = useMemo(() => extractDynamicChips(items), [items]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchInput = useCallback(
    (text: string) => {
      // 즉시 표시용 업데이트
      onSearchChange(text);
    },
    [onSearchChange]
  );

  return (
    <View style={styles.container}>
      {/* 검색 입력 */}
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

      {/* 다이나믹 필터 칩 */}
      {chips.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsContainer}
        >
          {chips.map((chip) => {
            const isActive = activeChipValue === chip.value;
            return (
              <Pressable
                key={chip.value}
                onPress={() => onChipChange(chip.value)}
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
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing[2],
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
  chipsContainer: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 2,
    paddingRight: spacing[4],
  },
  chip: {
    backgroundColor: palette.surface,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
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
    fontWeight: '900',
  },
});
