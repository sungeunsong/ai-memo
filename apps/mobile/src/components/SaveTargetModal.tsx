import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SavedItem } from '@/features/items/types';
import { formatReadableDate, getItemTitle } from '@/utils/formatters';
import { Palette } from '@/theme/palette';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { spacing } from '@/theme/spacing';
import { useBackHandler } from '@/hooks/useBackHandler';

type Props = {
  visible: boolean;
  /** 방금 저장한 항목. 여기에 붙이는 게 아니라 '기존에 합칠' 후보에서 빼야 합니다. */
  savedItemId: string | null;
  items: SavedItem[];
  /** 인스타처럼 나중에 DM이 따라오는 출처인지. 대기 선택지를 보여줄지 정합니다. */
  expectsFollowUp: boolean;
  onKeepAsNew: () => void;
  onWaitForMore: () => void;
  onMergeInto: (targetItemId: string) => void;
  /** 아무것도 고르지 않고 닫았을 때. 방금 저장한 것을 없던 일로 합니다. */
  onCancel: () => void;
};

const RECENT_LIMIT = 8;

/**
 * 공유가 들어온 직후 어떻게 담을지 고르는 시트.
 *
 * 저장 자체는 이미 끝난 뒤에 뜹니다. 여기서 뒤로 가거나 앱이 죽어도
 * 최소한 새 항목으로는 남아 있어야 하기 때문입니다.
 */
export function SaveTargetModal({
  visible,
  savedItemId,
  items,
  expectsFollowUp,
  onKeepAsNew,
  onWaitForMore,
  onMergeInto,
  onCancel,
}: Props) {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();
  const [isPickingTarget, setIsPickingTarget] = useState(false);
  const [query, setQuery] = useState('');

  /**
   * 닫기의 뜻은 보고 있는 화면에 따라 다릅니다.
   *
   * 목록에서는 '한 단계 뒤로'입니다. 합칠 대상을 고르다 그만두는 것과
   * 저장 자체를 그만두는 것은 다른 결정입니다.
   *
   * 선택지 화면에서는 '취소'입니다. 여기에 "새 정보로 저장"이 버튼으로 있는데
   * 닫기가 그것과 같은 결과를 내면, 누르든 안 누르든 같으니 버튼이 거짓말을 합니다.
   * 공유해놓고 마음이 바뀌었을 때 물러설 자리도 있어야 합니다.
   */
  function handleDismiss() {
    if (isPickingTarget) {
      setIsPickingTarget(false);
      setQuery('');
      return;
    }
    onCancel();
  }

  useBackHandler(visible, handleDismiss);

  // 이 컴포넌트는 계속 화면에 붙어 있고 visible만 바뀝니다. 그래서 지난번에
  // '기존에 합치기'까지 들어갔다 닫으면, 다음 공유 때 선택지 대신 목록이 먼저
  // 떴습니다. 열릴 때마다 처음 화면으로 되돌립니다.
  useEffect(() => {
    if (!visible) return;
    setIsPickingTarget(false);
    setQuery('');
  }, [visible]);

  const candidates = useMemo(() => {
    const others = items.filter((item) => item.id !== savedItemId);
    const keyword = query.trim();
    if (!keyword) return others.slice(0, RECENT_LIMIT);

    return others
      .filter((item) => getItemTitle(item).toLowerCase().includes(keyword.toLowerCase()))
      .slice(0, RECENT_LIMIT);
  }, [items, savedItemId, query]);

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleDismiss}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: spacing[6] + insets.bottom }]}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>
              {isPickingTarget ? '어디에 합칠까요?' : '어떻게 저장할까요?'}
            </Text>
            <Pressable onPress={handleDismiss} hitSlop={10}>
              <Text style={styles.closeText}>{isPickingTarget ? '← 뒤로' : '✕'}</Text>
            </Pressable>
          </View>

          {isPickingTarget ? (
            <>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="제목으로 찾기"
                placeholderTextColor={palette.textMuted}
                style={styles.search}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
                {candidates.length === 0 ? (
                  <Text style={styles.empty}>합칠 만한 저장물이 없습니다.</Text>
                ) : (
                  candidates.map((item) => (
                    <Pressable
                      key={item.id}
                      onPress={() => onMergeInto(item.id)}
                      style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
                    >
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {getItemTitle(item)}
                      </Text>
                      <Text style={styles.rowMeta}>{formatReadableDate(item.createdAt)}</Text>
                    </Pressable>
                  ))
                )}
              </ScrollView>
            </>
          ) : (
            <>
              <Pressable
                onPress={onKeepAsNew}
                style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.primaryBtnText}>새 정보로 저장</Text>
                <Text style={styles.btnHint}>바로 AI 정리를 시작합니다</Text>
              </Pressable>

              {/* 릴스는 "댓글 남기면 DM 드려요"가 붙는 일이 잦습니다.
                  그 순간 사용자는 DM이 올지 가장 잘 압니다. 그때 물어야 합니다. */}
              {expectsFollowUp ? (
                <Pressable
                  onPress={onWaitForMore}
                  style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.7 }]}
                >
                  <Text style={styles.secondaryBtnText}>나중에 DM 등을 붙일게요</Text>
                  <Text style={styles.btnHint}>내용을 붙일 때까지 AI 정리를 미룹니다</Text>
                </Pressable>
              ) : null}

              <Pressable
                onPress={() => setIsPickingTarget(true)}
                style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.secondaryBtnText}>기존 저장물에 합치기</Text>
                <Text style={styles.btnHint}>하나의 정보로 묶어 다시 정리합니다</Text>
              </Pressable>

              <Text style={styles.dismissHint}>닫으면 저장하지 않습니다</Text>
            </>
          )}
        </View>
      </View>
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
    primaryBtn: {
      backgroundColor: palette.accent,
      borderRadius: 14,
      paddingVertical: spacing[3],
      paddingHorizontal: spacing[4],
      gap: 2,
    },
    primaryBtnText: { color: '#ffffff', fontSize: 14, fontWeight: '900' },
    secondaryBtn: {
      backgroundColor: palette.surfaceRaised,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: palette.border,
      paddingVertical: spacing[3],
      paddingHorizontal: spacing[4],
      gap: 2,
    },
    secondaryBtnText: { color: palette.textPrimary, fontSize: 14, fontWeight: '800' },
    btnHint: { color: palette.textMuted, fontSize: 11, fontWeight: '600' },
    search: {
      backgroundColor: palette.surfaceRaised,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: palette.border,
      color: palette.textPrimary,
      fontSize: 13,
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[3],
    },
    list: { maxHeight: 320 },
    row: {
      backgroundColor: palette.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: palette.border,
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[3],
      marginBottom: spacing[2],
      gap: 2,
    },
    rowTitle: { color: palette.textPrimary, fontSize: 13, fontWeight: '800' },
    rowMeta: { color: palette.textMuted, fontSize: 11, fontWeight: '600' },
    empty: { color: palette.textMuted, fontSize: 12, fontWeight: '600', paddingVertical: spacing[4] },
    dismissHint: {
      color: palette.textMuted,
      fontSize: 11,
      fontWeight: '600',
      textAlign: 'center',
      marginTop: spacing[1],
    },
  });
