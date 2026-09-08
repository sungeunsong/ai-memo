import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TabOption } from '@/features/facets/tabs';
import { Palette } from '@/theme/palette';
import { useThemedStyles } from '@/theme/ThemeContext';
import { spacing } from '@/theme/spacing';
import { useBackHandler } from '@/hooks/useBackHandler';

type Props = {
  visible: boolean;
  options: TabOption[];
  activeKey: string;
  pinned: string[];
  onSelect: (key: string) => void;
  onTogglePin: (key: string) => void;
  onClose: () => void;
};

/**
 * 분야 전체를 보는 시트.
 *
 * 탭은 화면에 몇 개밖에 못 세웁니다. 분야는 사용자가 저장하는 대로 늘어나므로,
 * 못 세운 것들이 갈 자리가 필요합니다. 여기서는 건수까지 함께 보여줍니다.
 * 어떤 분야에 얼마나 모였는지가 곧 "무엇을 탭에 세울까"의 답입니다.
 */
export function TabPickerModal({
  visible,
  options,
  activeKey,
  pinned,
  onSelect,
  onTogglePin,
  onClose,
}: Props) {
  const styles = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();

  useBackHandler(visible, onClose);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { paddingBottom: insets.bottom + spacing[4] }]}
          onPress={(event) => event.stopPropagation()}
        >
          <View style={styles.header}>
            <Text style={styles.headerTitle}>분야</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.closeText}>닫기</Text>
            </Pressable>
          </View>

          <Text style={styles.hint}>
            📌을 누르면 위 탭에 고정됩니다. 고정한 것이 없으면 많이 모인 순으로 세웁니다.
          </Text>

          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            <Pressable
              onPress={() => {
                onSelect('');
                onClose();
              }}
              style={({ pressed }) => [
                styles.row,
                !activeKey && styles.rowActive,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={[styles.rowLabel, !activeKey && styles.rowLabelActive]}>전체 🔍</Text>
            </Pressable>

            {options.map((option) => {
              const isActive = option.key === activeKey;
              const isPinned = pinned.includes(option.key);

              return (
                <View key={option.key} style={[styles.row, isActive && styles.rowActive]}>
                  <Pressable
                    style={styles.rowMain}
                    onPress={() => {
                      onSelect(option.key);
                      onClose();
                    }}
                  >
                    <Text style={[styles.rowLabel, isActive && styles.rowLabelActive]}>
                      {option.label}
                    </Text>
                    <Text style={styles.rowCount}>{option.count}건</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => onTogglePin(option.key)}
                    hitSlop={10}
                    style={({ pressed }) => [styles.pinBtn, pressed && { opacity: 0.6 }]}
                  >
                    {/* 고정 여부는 진하기로 구분합니다. 아이콘을 바꾸면
                        두 상태 중 어느 쪽이 켜진 것인지 매번 헷갈립니다. */}
                    <Text style={[styles.pinText, isPinned && styles.pinTextOn]}>📌</Text>
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const createStyles = (palette: Palette) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: palette.overlay, justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: palette.backgroundStrong,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingHorizontal: spacing[5],
      paddingTop: spacing[5],
      maxHeight: '80%',
      gap: spacing[3],
    },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    headerTitle: { color: palette.textPrimary, fontSize: 17, fontWeight: '900' },
    closeText: { color: palette.textMuted, fontSize: 16, fontWeight: '800' },
    hint: { color: palette.textMuted, fontSize: 12, fontWeight: '600', lineHeight: 17 },
    list: { marginTop: spacing[1] },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: palette.surfaceRaised,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: palette.border,
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[3],
      marginBottom: spacing[2],
    },
    rowActive: { borderColor: palette.accent },
    rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
    rowLabel: { color: palette.textPrimary, fontSize: 14, fontWeight: '800' },
    rowLabelActive: { color: palette.accentText },
    rowCount: { color: palette.textMuted, fontSize: 12, fontWeight: '700' },
    pinBtn: { paddingLeft: spacing[3] },
    pinText: { fontSize: 16, opacity: 0.35 },
    pinTextOn: { opacity: 1 },
  });
