import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { SavedItem } from '@/features/items/types';
import { isEnrichStalled } from '@/features/items/staleEnrich';
import { resolveImageUri } from '@/features/capture/imageCapture';
import { StatusPills } from '@/components/StatusBadges';
import {
  getItemTitle,
  getItemSourceLabel,
  getSourceTheme,
  describeSavedItemShape,
  formatReadableDate,
} from '@/utils/formatters';
import { Palette } from '@/theme/palette';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { spacing } from '@/theme/spacing';

export function ItemCard({ item, onRetry }: { item: SavedItem; onRetry?: () => void }) {
  const styles = useThemedStyles(createStyles);
  const { mode } = useTheme();
  const theme = getSourceTheme(item.sourceType, mode);

  const isInstagram =
    item.sourceType === 'instagram_reel' ||
    item.sourceType === 'instagram_post' ||
    item.sourceType === 'instagram';

  // 인스타 계열이면서 제목이 단순 플랫폼명이고 사용자의 메모가 있다면, 메모를 제목으로 승격시킵니다.
  const title = getItemTitle(item);
  const displayTitle =
    isInstagram && item.userNote && title === 'Instagram' ? item.userNote : title;

  // 퀵 한 줄 메모가 존재하면 요약보다 우선적으로 노출하며, 제목으로 승격된 경우에는 분류 정보를 표시합니다.
  const displaySummary =
    isInstagram && item.userNote && title === 'Instagram'
      ? `${theme.label} 링크`
      : item.userNote
      ? `✍️ ${item.userNote}`
      : item.summary || '요약된 내용이 없습니다.';

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
          <Text style={styles.cardTitle} numberOfLines={2}>{displayTitle}</Text>
          <Text style={styles.cardSummary} numberOfLines={2}>
            {displaySummary}
          </Text>
          <Text style={styles.cardTimestamp}>{formatReadableDate(item.createdAt)}</Text>
        </View>
        <ThumbnailThumb item={item} />
      </View>

      {onRetry && needsRetry(item) ? (
        /*
         * 다시 정리를 목록에서 바로 누를 수 있게 둡니다.
         *
         * 정리 실패는 드문 일이 아닙니다(할당량, 네트워크, 링크가 막힌 경우). 그런데
         * 다시 거는 버튼이 상세 화면 안에만 있어서, 자주 하는 동작이 두 단계 뒤에
         * 숨어 있었습니다.
         *
         * 처음에는 날짜 옆에 작게 뒀는데, 썸네일과 날짜 사이에 끼어 그냥 딸린 정보로
         * 보였습니다. 실패한 카드에만 한 줄을 더 쓰더라도 무엇을 해야 하는지가
         * 보이는 편이 낫습니다. 실패는 눈에 띄어야 하는 상태입니다.
         *
         * 카드 전체가 눌리는 자리 위에 겹쳐 있지만 안쪽이 먼저 잡습니다.
         */
        <Pressable
          onPress={onRetry}
          style={({ pressed }) => [styles.retryRow, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.retryRowText}>↻  다시 정리하기</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * 다시 걸어볼 만한 상태인지.
 *
 * 실패한 것과, 'pending'인 채로 오래 멈춰 있는 것입니다. 뒤엣것은 앱이 죽어 끊긴
 * 경우인데 회수는 앱으로 돌아올 때 도니, 그 사이 화면에는 끝나지 않는 저장물로
 * 남아 있습니다. 그때 버튼까지 없으면 사용자가 손쓸 방법이 없습니다.
 */
function needsRetry(item: SavedItem) {
  return item.aiStatus === 'failed' || isEnrichStalled(item);
}

function ThumbnailThumb({ item }: { item: SavedItem }) {
  const styles = useThemedStyles(createStyles);
  const { mode } = useTheme();
  if (item.type === 'text') {
    return null;
  }

  const thumbnailUri = resolveImageUri(item.thumbnailUrl);

  if (thumbnailUri) {
    return (
      <Image
        source={{ uri: thumbnailUri }}
        style={styles.cardThumbnail as any}
        resizeMode="cover"
      />
    );
  }

  const theme = getSourceTheme(item.sourceType, mode);
  return (
    <View style={[styles.cardThumbnailPlaceholder, { borderColor: theme.border }]}>
      <Text style={[styles.cardThumbnailPlaceholderText, { color: theme.badgeText }]}>
        {theme.label.slice(0, 2).toUpperCase()}
      </Text>
    </View>
  );
}

const createStyles = (palette: Palette) =>
  StyleSheet.create({
  retryRow: {
    marginTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingTop: spacing[3],
    alignItems: 'center',
  },
  retryRowText: {
    color: palette.accent,
    fontSize: 13,
    fontWeight: '700',
  },
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
