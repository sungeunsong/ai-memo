import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SavedItem } from '@/features/items/types';
import { getSaveStatusLabel, getAiStatusLabel } from '@/utils/formatters';
import { Palette } from '@/theme/palette';
import { useThemedStyles } from '@/theme/ThemeContext';
import { spacing } from '@/theme/spacing';

export function StatusBadge({
  label,
  tone = 'pending',
  compact = false,
}: {
  label: string;
  tone?: 'saved' | 'pending' | 'failed';
  compact?: boolean;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <View
      style={[
        styles.pendingBadge,
        tone === 'saved' && styles.savedBadge,
        tone === 'failed' && styles.failedBadge,
        compact && styles.pendingBadgeCompact,
      ]}
    >
      <Text
        style={[
          styles.pendingBadgeText,
          tone === 'saved' && styles.savedBadgeText,
          tone === 'failed' && styles.failedBadgeText,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

export function StatusPills({
  item,
  compact = false,
}: {
  item: SavedItem;
  compact?: boolean;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={[styles.statusPillRow, compact && styles.statusPillRowCompact]}>
      <StatusBadge label={getSaveStatusLabel(item)} tone="saved" compact={compact} />
      <StatusBadge
        label={getAiStatusLabel(item)}
        tone={item.aiStatus === 'failed' ? 'failed' : item.aiStatus === 'completed' ? 'saved' : 'pending'}
        compact={compact}
      />
    </View>
  );
}

const createStyles = (palette: Palette) =>
  StyleSheet.create({
  pendingBadge: {
    backgroundColor: 'rgba(251, 191, 36, 0.1)',
    borderRadius: 999,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.16)',
  },
  savedBadge: {
    backgroundColor: palette.successSoft,
    borderColor: 'rgba(16, 185, 129, 0.22)',
  },
  failedBadge: {
    backgroundColor: palette.dangerSoft,
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  pendingBadgeCompact: {
    paddingHorizontal: spacing[2],
  },
  pendingBadgeText: {
    color: palette.warnText,
    fontSize: 10,
    fontWeight: '800',
  },
  savedBadgeText: {
    color: palette.success,
  },
  failedBadgeText: {
    color: palette.dangerText,
  },
  statusPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing[2],
  },
  statusPillRowCompact: {
    justifyContent: 'flex-end',
    flexShrink: 1,
    maxWidth: 180,
  },
});
