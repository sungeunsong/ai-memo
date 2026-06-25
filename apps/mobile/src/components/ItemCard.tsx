import { Image, StyleSheet, Text, View } from 'react-native';

import { SavedItem } from '@/features/items/types';
import { StatusPills } from '@/components/StatusBadges';
import {
  getItemSourceLabel,
  getSourceTheme,
  describeSavedItemShape,
  formatReadableDate,
} from '@/utils/formatters';
import { palette } from '@/theme/palette';
import { spacing } from '@/theme/spacing';

export function ItemCard({ item }: { item: SavedItem }) {
  const theme = getSourceTheme(item.sourceType);

  return (
    <View style={styles.cardContent}>
      <View style={styles.cardRow}>
        <View style={styles.cardTextColumn}>
          <View style={styles.cardMetaRow}>
            <View style={styles.cardSourceRow}>
              <View style={[styles.categoryDot, { backgroundColor: theme.badgeText }]} />
              <Text style={[styles.cardSource, { color: theme.badgeText }]} numberOfLines={1}>
                {theme.label}
              </Text>
            </View>
            <StatusPills item={item} compact />
          </View>
          <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
          <Text style={styles.cardSummary} numberOfLines={2}>
            {item.summary || '요약된 내용이 없습니다.'}
          </Text>
          <Text style={styles.cardTimestamp}>{formatReadableDate(item.createdAt)}</Text>
        </View>
        <ThumbnailThumb item={item} />
      </View>
    </View>
  );
}

function ThumbnailThumb({ item }: { item: SavedItem }) {
  if (item.type === 'text') {
    return null;
  }

  if (item.thumbnailUrl) {
    return (
      <Image
        source={{ uri: item.thumbnailUrl }}
        style={styles.cardThumbnail as any}
        resizeMode="cover"
      />
    );
  }

  const theme = getSourceTheme(item.sourceType);
  return (
    <View style={[styles.cardThumbnailPlaceholder, { borderColor: theme.border }]}>
      <Text style={[styles.cardThumbnailPlaceholderText, { color: theme.badgeText }]}>
        {theme.label.slice(0, 2).toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cardContent: {
    paddingVertical: 12,
    paddingHorizontal: spacing[4],
    paddingLeft: spacing[4],
  },
  cardRow: {
    flexDirection: 'row',
    gap: spacing[3],
    alignItems: 'center',
  },
  cardTextColumn: {
    flex: 1,
    gap: 5,
  },
  cardMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing[2],
  },
  cardSourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  categoryDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
  },
  cardSource: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  cardTitle: {
    color: palette.textPrimary,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  cardSummary: {
    color: palette.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  cardTimestamp: {
    color: palette.textMuted,
    fontSize: 10,
    fontWeight: '600',
    paddingTop: 2,
  },
  cardThumbnail: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: palette.backgroundStrong,
  },
  cardThumbnailPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  cardThumbnailPlaceholderText: {
    color: palette.textMuted,
    fontSize: 11,
    fontWeight: '900',
  },
});
