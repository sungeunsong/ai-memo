import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Relaxation } from '@/features/facets/query';
import { parseFacetKey } from '@/features/facets/extract';
import { facetLabel } from '@/features/facets/labels';
import { Palette } from '@/theme/palette';
import { useThemedStyles } from '@/theme/ThemeContext';
import { spacing } from '@/theme/spacing';

type Props = {
  /** 수집함 자체가 비어 있는지 */
  isCollectionEmpty: boolean;
  hasConditions: boolean;
  relaxations: Relaxation[];
  /** 입력된 검색어. 결과를 죽인 원인이 조건이 아니라 검색어일 수 있습니다. */
  searchQuery: string;
  /** 검색어만 지웠을 때 남는 건수 */
  withoutSearchCount: number;
  onDropFacet: (key: string) => void;
  onClearSearch: () => void;
  onClearAll: () => void;
};

/**
 * 결과가 0건일 때의 화면.
 *
 * 조합 검색은 여기서 승부가 납니다. "검색 결과가 없습니다"만 띄우면
 * 사용자는 어떤 조건이 결과를 죽였는지 모른 채 처음부터 다시 조합하다 포기합니다.
 * 그래서 조건을 하나씩 빼봤을 때의 건수를 미리 계산해 바로 누를 수 있게 제시합니다.
 */
export function EmptyResultGuide({
  isCollectionEmpty,
  hasConditions,
  relaxations,
  searchQuery,
  withoutSearchCount,
  onDropFacet,
  onClearSearch,
  onClearAll,
}: Props) {
  const styles = useThemedStyles(createStyles);
  const canDropSearch = searchQuery.trim().length > 0 && withoutSearchCount > 0;
  if (isCollectionEmpty) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>수집함이 비어 있습니다</Text>
        <Text style={styles.desc}>
          오른쪽 하단 + 버튼을 눌러 링크나 텍스트를 저장해보세요.
        </Text>
      </View>
    );
  }

  if (relaxations.length > 0 || canDropSearch) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>조건이 조금 빡빡해요</Text>
        <Text style={styles.desc}>하나만 빼면 결과가 있습니다.</Text>

        <View style={styles.suggestions}>
          {canDropSearch ? (
            <Pressable
              onPress={onClearSearch}
              style={({ pressed }) => [
                styles.suggestion,
                { transform: [{ scale: pressed ? 0.97 : 1 }] },
              ]}
            >
              <Text style={styles.suggestionText}>
                검색어 &quot;{searchQuery.trim()}&quot; 빼기
              </Text>
              <Text style={styles.suggestionCount}>{withoutSearchCount}건</Text>
            </Pressable>
          ) : null}

          {relaxations.map((relaxation) => {
            const parsed = parseFacetKey(relaxation.dropKey);
            const label = parsed
              ? facetLabel(parsed.kind, parsed.value)
              : relaxation.dropValue;

            return (
              <Pressable
                key={relaxation.dropKey}
                onPress={() => onDropFacet(relaxation.dropKey)}
                style={({ pressed }) => [
                  styles.suggestion,
                  { transform: [{ scale: pressed ? 0.97 : 1 }] },
                ]}
              >
                <Text style={styles.suggestionText}>{label} 빼기</Text>
                <Text style={styles.suggestionCount}>{relaxation.count}건</Text>
              </Pressable>
            );
          })}
        </View>

        {hasConditions ? (
          <Pressable onPress={onClearAll} hitSlop={8}>
            <Text style={styles.clearAll}>조건 모두 해제</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>검색 결과가 없습니다</Text>
      <Text style={styles.desc}>
        {hasConditions
          ? '조건을 해제하거나 다른 키워드로 찾아보세요.'
          : '다른 키워드로 검색해보세요.'}
      </Text>
      {hasConditions ? (
        <Pressable onPress={onClearAll} hitSlop={8}>
          <Text style={styles.clearAll}>조건 모두 해제</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const createStyles = (palette: Palette) =>
  StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[9],
    paddingHorizontal: spacing[5],
    gap: spacing[2],
  },
  title: {
    color: palette.textPrimary,
    fontSize: 15,
    fontWeight: '900',
  },
  desc: {
    color: palette.textMuted,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 18,
  },
  suggestions: {
    width: '100%',
    gap: spacing[2],
    marginTop: spacing[2],
  },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: palette.surfaceRaised,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  suggestionText: {
    color: palette.textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
  suggestionCount: {
    color: palette.accent,
    fontSize: 12,
    fontWeight: '900',
  },
  clearAll: {
    color: palette.textSecondary,
    fontSize: 11,
    fontWeight: '800',
    marginTop: spacing[2],
    textDecorationLine: 'underline',
  },
});
