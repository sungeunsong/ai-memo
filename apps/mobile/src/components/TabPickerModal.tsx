import { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OTHER_TAB_KEY, TabOption } from '@/features/facets/tabs';
import { Palette } from '@/theme/palette';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { spacing } from '@/theme/spacing';
import { useBackHandler } from '@/hooks/useBackHandler';
import { useKeyboardHeight } from '@/hooks/useKeyboardHeight';

type Props = {
  visible: boolean;
  options: TabOption[];
  activeKey: string;
  pinned: string[];
  onSelect: (key: string) => void;
  onTogglePin: (key: string) => void;
  /** 열자마자 이 분야의 관리 화면부터 보여줍니다. 상단 탭을 길게 눌러 들어온 경우입니다. */
  manageKey?: string | null;
  onRename: (key: string, label: string) => void;
  onMerge: (from: TabOption, into: TabOption) => void;
  /** 글이 하나도 없는 분야를 지웁니다. 글이 있으면 이 자리에 버튼이 서지 않습니다. */
  onDelete: (target: TabOption) => void;
  /**
   * 분야를 새로 만듭니다.
   *
   * 상세 화면에도 만드는 자리가 있지만 그쪽은 글에 붙이면서 만드는 길입니다.
   * 글보다 분야를 먼저 정해두고 싶은 경우가 있어서 — 그래야 다음에 저장하는 글부터
   * AI가 그 분야로 보냅니다 — 고치고 합치는 이 자리에도 둡니다.
   */
  onCreate: (label: string) => void;
  onClose: () => void;
};

/** 시트가 지금 무엇을 하고 있는지. 한 번에 하나입니다. */
type SheetMode =
  | { kind: 'list' }
  | { kind: 'manage'; target: TabOption }
  | { kind: 'rename'; target: TabOption }
  | { kind: 'merge'; target: TabOption }
  | { kind: 'create' };

/**
 * 분야 전체를 보는 시트.
 *
 * 탭은 화면에 몇 개밖에 못 세웁니다. 분야는 사용자가 저장하는 대로 늘어나므로,
 * 못 세운 것들이 갈 자리가 필요합니다. 여기서는 건수까지 함께 보여줍니다.
 * 어떤 분야에 얼마나 모였는지가 곧 "무엇을 탭에 세울까"의 답입니다.
 *
 * 분야를 고치는 자리이기도 합니다. AI가 정한 이름은 자주 좁습니다. 자동차 글
 * 하나로 '자동차 커뮤니티'가 만들어지면, 다음 자동차 글은 거기 붙지 못하고
 * 새 분야를 만듭니다. 이름을 넓게 고치는 것과 이미 갈라진 둘을 합치는 것이
 * 둘 다 있어야 그 상태에서 빠져나올 수 있습니다.
 */
export function TabPickerModal({
  visible,
  options,
  activeKey,
  pinned,
  manageKey,
  onSelect,
  onTogglePin,
  onRename,
  onMerge,
  onDelete,
  onCreate,
  onClose,
}: Props) {
  const styles = useThemedStyles(createStyles);
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();

  const [mode, setMode] = useState<SheetMode>({ kind: 'list' });
  const [draftLabel, setDraftLabel] = useState('');

  /*
   * 열 때마다 처음 상태를 정합니다.
   *
   * 고치던 중간 상태로 다시 열리면 무엇을 하려던 참이었는지 알 수 없어서,
   * 기본은 목록입니다. 다만 상단 탭을 길게 눌러 들어온 경우에는 그 분야를
   * 고치려는 뜻이 분명하므로 관리 화면부터 엽니다.
   *
   * options는 그릴 때마다 새로 만들어지는 배열이라 의존성에 넣지 않습니다.
   * 넣으면 시트가 떠 있는 동안 계속 처음 상태로 되돌아갑니다.
   */
  useEffect(() => {
    if (!visible) {
      setMode({ kind: 'list' });
      return;
    }

    const target = manageKey ? options.find((option) => option.key === manageKey) : null;
    setMode(target && target.key !== OTHER_TAB_KEY ? { kind: 'manage', target } : { kind: 'list' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, manageKey]);

  // 뒤로 가기는 시트를 닫기 전에 한 단계씩 물러납니다.
  useBackHandler(visible, () => {
    if (mode.kind === 'list') {
      onClose();
      return;
    }
    if (mode.kind === 'manage' || mode.kind === 'create') {
      setMode({ kind: 'list' });
      return;
    }
    setMode({ kind: 'manage', target: mode.target });
  });

  /** 미분류는 분야가 아니라 '분야를 못 정한 것'이 모인 자리라 고칠 수 없습니다. */
  function isEditable(option: TabOption) {
    return option.key !== OTHER_TAB_KEY;
  }

  function openManage(option: TabOption) {
    if (!isEditable(option)) return;
    setMode({ kind: 'manage', target: option });
  }

  function submitCreate() {
    const trimmed = draftLabel.trim();
    if (trimmed) onCreate(trimmed);
    setDraftLabel('');
    setMode({ kind: 'list' });
  }

  function submitRename(target: TabOption) {
    const trimmed = draftLabel.trim();
    if (trimmed && trimmed !== target.label) onRename(target.key, trimmed);
    setMode({ kind: 'list' });
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, { paddingBottom: keyboardHeight }]} onPress={onClose}>
        <Pressable
          style={[
            styles.sheet,
            // 키보드가 올라와 있으면 시트 아래는 키보드라 내비게이션 바 몫이 필요 없습니다.
            { paddingBottom: keyboardHeight > 0 ? spacing[4] : insets.bottom + spacing[4] },
          ]}
          onPress={(event) => event.stopPropagation()}
        >
          <View style={styles.header}>
            <Text style={styles.headerTitle}>
              {mode.kind === 'merge'
                ? `'${mode.target.label}'을 어디에 합칠까요`
                : mode.kind === 'rename'
                  ? '이름 바꾸기'
                  : mode.kind === 'manage'
                    ? mode.target.label
                    : mode.kind === 'create'
                      ? '새 분야 만들기'
                      : '분야'}
            </Text>
            <Pressable
              onPress={() => (mode.kind === 'list' ? onClose() : setMode({ kind: 'list' }))}
              hitSlop={10}
            >
              <Text style={styles.closeText}>{mode.kind === 'list' ? '닫기' : '뒤로'}</Text>
            </Pressable>
          </View>

          {mode.kind === 'list' ? (
            <>
              <Text style={styles.hint}>
                📌을 누르면 위 탭에 고정됩니다. 고정한 것이 없으면 많이 모인 순으로 세웁니다.
                이름을 길게 누르면 고치거나 합칠 수 있습니다.
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
                        onLongPress={() => openManage(option)}
                        delayLongPress={350}
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

                {/* 글보다 분야를 먼저 정해두는 길. 만들어두면 다음에 저장하는 글부터
                    AI가 이 분야를 후보로 씁니다. */}
                <Pressable
                  onPress={() => {
                    setDraftLabel('');
                    setMode({ kind: 'create' });
                  }}
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
                >
                  <Text style={styles.createText}>+ 새 분야 만들기</Text>
                </Pressable>
              </ScrollView>
            </>
          ) : null}

          {mode.kind === 'create' ? (
            <View style={styles.menu}>
              <TextInput
                value={draftLabel}
                onChangeText={setDraftLabel}
                placeholder="분야 이름 (예: 캠핑)"
                placeholderTextColor={palette.textMuted}
                style={styles.input}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={submitCreate}
              />
              <Text style={styles.hint}>
                만들어두면 다음에 저장하는 글부터 AI가 이 분야로 보냅니다. 글이 없는
                동안에는 탭에 서지 않고 이 목록에만 있습니다.
              </Text>

              <Pressable
                style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.8 }]}
                onPress={submitCreate}
              >
                <Text style={styles.primaryBtnText}>만들기</Text>
              </Pressable>
            </View>
          ) : null}

          {mode.kind === 'manage' ? (
            <View style={styles.menu}>
              <Text style={styles.hint}>{mode.target.count}건이 이 분야에 있습니다.</Text>

              <Pressable
                style={({ pressed }) => [styles.menuBtn, pressed && { opacity: 0.7 }]}
                onPress={() => {
                  setDraftLabel(mode.target.label);
                  setMode({ kind: 'rename', target: mode.target });
                }}
              >
                <Text style={styles.menuBtnText}>이름 바꾸기</Text>
                <Text style={styles.menuBtnHint}>
                  표시만 바뀌는 게 아니라, 다음 정리부터 AI가 이 이름으로 모읍니다.
                </Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.menuBtn, pressed && { opacity: 0.7 }]}
                onPress={() => setMode({ kind: 'merge', target: mode.target })}
              >
                <Text style={styles.menuBtnText}>다른 분야에 합치기</Text>
                <Text style={styles.menuBtnHint}>
                  이 분야는 사라지고 글은 고른 분야로 옮겨갑니다. 되돌릴 수 없습니다.
                </Text>
              </Pressable>

              {/* 빈 분야에만 섭니다. 글이 있는 분야를 없애는 일은 합치기가 맡습니다.
                  잘못 만든 이름을 남겨두면 다음 정리 때 AI에게 계속 실려 나갑니다. */}
              {mode.target.count === 0 ? (
                <Pressable
                  style={({ pressed }) => [styles.menuBtn, pressed && { opacity: 0.7 }]}
                  onPress={() => onDelete(mode.target)}
                >
                  <Text style={styles.menuBtnText}>이 분야 지우기</Text>
                  <Text style={styles.menuBtnHint}>
                    글이 없는 분야입니다. 지우면 AI에게 더 이상 알려주지 않습니다.
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {mode.kind === 'rename' ? (
            <View style={styles.menu}>
              <TextInput
                value={draftLabel}
                onChangeText={setDraftLabel}
                placeholder="분야 이름"
                placeholderTextColor={palette.textMuted}
                style={styles.input}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={() => submitRename(mode.target)}
              />
              <Text style={styles.hint}>
                저장된 글은 그대로입니다. 이름과 식별자가 따로라, 검색도 탭 소속도
                바뀌지 않습니다.
              </Text>

              <Pressable
                style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.8 }]}
                onPress={() => submitRename(mode.target)}
              >
                <Text style={styles.primaryBtnText}>바꾸기</Text>
              </Pressable>
            </View>
          ) : null}

          {mode.kind === 'merge' ? (
            <>
              <Text style={styles.hint}>
                고른 분야만 남고 '{mode.target.label}'은 사라집니다. 글 {mode.target.count}건과
                직접 지정한 분류가 함께 옮겨갑니다.
              </Text>

              <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
                {options
                  .filter((option) => option.key !== mode.target.key && isEditable(option))
                  .map((option) => (
                    <Pressable
                      key={option.key}
                      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
                      onPress={() => {
                        onMerge(mode.target, option);
                        setMode({ kind: 'list' });
                      }}
                    >
                      <View style={styles.rowMain}>
                        <Text style={styles.rowLabel}>{option.label}</Text>
                        <Text style={styles.rowCount}>{option.count}건</Text>
                      </View>
                      <Text style={styles.rowArrow}>← 합치기</Text>
                    </Pressable>
                  ))}
              </ScrollView>
            </>
          ) : null}
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
    headerTitle: { color: palette.textPrimary, fontSize: 17, fontWeight: '900', flex: 1 },
    closeText: { color: palette.textMuted, fontSize: 16, fontWeight: '800', paddingLeft: spacing[3] },
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
    rowArrow: { color: palette.accentText, fontSize: 12, fontWeight: '800' },
    pinBtn: { paddingLeft: spacing[3] },
    createText: {
    color: palette.accent,
    fontSize: 14,
    fontWeight: '800',
  },
  pinText: { fontSize: 16, opacity: 0.35 },
    pinTextOn: { opacity: 1 },
    menu: { gap: spacing[3], paddingBottom: spacing[2] },
    menuBtn: {
      backgroundColor: palette.surfaceRaised,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: palette.border,
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[3],
      gap: 4,
    },
    menuBtnText: { color: palette.textPrimary, fontSize: 14, fontWeight: '800' },
    menuBtnHint: { color: palette.textMuted, fontSize: 11.5, fontWeight: '600', lineHeight: 16 },
    input: {
      backgroundColor: palette.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: palette.borderStrong,
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[3],
      color: palette.textPrimary,
      fontSize: 15,
      fontWeight: '700',
    },
    primaryBtn: {
      backgroundColor: palette.accent,
      borderRadius: 12,
      paddingVertical: spacing[3],
      alignItems: 'center',
    },
    primaryBtnText: { color: palette.onAccent, fontSize: 14, fontWeight: '900' },
  });
