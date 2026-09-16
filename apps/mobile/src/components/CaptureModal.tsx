import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Palette } from '@/theme/palette';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { spacing } from '@/theme/spacing';
import { useBackHandler } from '@/hooks/useBackHandler';
import { useKeyboardHeight } from '@/hooks/useKeyboardHeight';

type Props = {
  visible: boolean;
  onClose: () => void;
  /**
   * 넣은 글·링크 전부와 사진 전부를 넘깁니다.
   *
   * 첫 조각이 저장물이 되고 나머지는 거기에 붙습니다. 한 건에 대한 여러 조각이지
   * 여러 건이 아닙니다. 사진이 이미 그렇게 동작합니다.
   */
  onSave: (
    inputs: string[],
    options: { skipAi: boolean; imageUris: string[] }
  ) => Promise<{ ok: boolean; message?: string }>;
  isSaving: boolean;
  initialValue?: string;
  /** 고른 사진의 경로를 돌려줍니다. 취소하면 빈 배열입니다. */
  onPickImages: () => Promise<string[]>;
};

export function CaptureModal({
  visible,
  onClose,
  onSave,
  isSaving,
  initialValue = '',
  onPickImages,
}: Props) {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const [input, setInput] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  /*
   * AI 정리를 돌릴지.
   *
   * 기본은 켜짐이고, 끈 것은 이번 저장 한 번에만 적용됩니다. 기억해두면 어느
   * 날부터 아무것도 정리되지 않는데 사용자는 이유를 알 수 없습니다.
   */
  const [useAi, setUseAi] = useState(true);
  /*
   * 붙여둔 사진.
   *
   * 예전에는 사진을 고르는 순간 저장되고 시트가 닫혔습니다. 이미지가 곧 저장할
   * 내용 전부이던 시절의 흐름인데, 제목과 토글이 생기면서 사진이 마지막 단계가
   * 아니게 됐습니다. 고른 뒤에 제목을 쓰려면 확정은 저장 버튼 하나여야 합니다.
   */
  const [images, setImages] = useState<string[]>([]);
  const [isPicking, setIsPicking] = useState(false);
  /*
   * 넣어둔 글 조각.
   *
   * 릴스 링크 하나로 끝나지 않는 경우가 많습니다. 링크와 함께 받은 DM 글, 따로 온
   * 노션 주소를 한 번에 넣고 한 건으로 담고 싶은데, 입력창이 하나뿐이라 따로 저장한
   * 뒤 합치는 수밖에 없었습니다. 사진은 이미 여러 장이 됩니다.
   *
   * 지금 입력창에 있는 것과 합쳐 순서대로 저장합니다. 맨 앞이 저장물이 됩니다.
   */
  const [entries, setEntries] = useState<string[]>([]);

  // 닫으면 비웁니다. 다음에 열었을 때 지난번 사진이 남아 있으면 그건 새 수집이
  // 아니라 남의 것입니다.
  useEffect(() => {
    if (!visible) {
      setImages([]);
      setEntries([]);
    }
  }, [visible]);

  useBackHandler(visible, onClose);

  if (!visible) return null;

  const canSave = Boolean(input.trim()) || entries.length > 0 || images.length > 0;
  const canStack = Boolean(input.trim());

  /** 지금 입력창에 있는 것을 조각으로 쌓고 창을 비웁니다. */
  function stackCurrentInput() {
    const trimmed = input.trim();
    if (!trimmed) return;
    setEntries((current) => [...current, trimmed]);
    setInput('');
  }

  async function handleSave() {
    if (!canSave) return;
    setError(null);
    // 입력창에 남아 있는 것도 마지막 조각입니다. 저장을 누르기 전에 '더 넣기'를
    // 한 번 더 눌러야 한다면, 눌러야 하는 이유를 화면이 설명할 수 없습니다.
    const inputs = [...entries, input].map((entry) => entry.trim()).filter(Boolean);
    const result = await onSave(inputs, { skipAi: !useAi, imageUris: images });
    if (result.ok) {
      setInput('');
      setEntries([]);
      setImages([]);
      setUseAi(true);
      onClose();
    } else {
      setError(result.message || '저장에 실패했습니다.');
    }
  }

  async function handlePick() {
    setIsPicking(true);
    try {
      const picked = await onPickImages();
      // 같은 사진을 두 번 고르면 한 번만 남깁니다.
      if (picked.length > 0) {
        setImages((current) => [...current, ...picked.filter((uri) => !current.includes(uri))]);
      }
    } finally {
      setIsPicking(false);
    }
  }

  return (
    // 키보드가 올라오면 그 높이만큼 시트를 띄웁니다.
    <View style={[styles.backdrop, { paddingBottom: keyboardHeight }]}>
      <Pressable style={styles.backdropTap} onPress={onClose} />
      <View
        style={[
          styles.sheet,
          // 키보드가 올라와 있으면 시트 아래는 키보드라 내비게이션 바 몫이 필요 없습니다.
          { paddingBottom: keyboardHeight > 0 ? 0 : insets.bottom },
        ]}
      >
        <View style={styles.sheetHeader}>
          <View style={styles.handle} />
        </View>

        {/*
          키보드가 올라오면 시트가 그만큼 좁아집니다. AI 토글이 생기면서 내용이
          한 뼘 길어졌고, 그 바람에 '이미지에서 가져오기'와 저장 버튼이 키보드
          아래로 밀려 손이 닿지 않았습니다. 접근할 수 없는 버튼은 없는 버튼입니다.
          내용이 넘치면 밀어서 볼 수 있게 둡니다.
        */}
        <ScrollView
          style={styles.sheetBody}
          contentContainerStyle={styles.sheetBodyContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>새 지식 수집</Text>
          <Text style={styles.subtitle}>
            {useAi
              ? '유튜브, 인스타, 노션 링크 또는 텍스트를 붙여넣으세요'
              : '적어둔 글이 그대로 제목이 됩니다. 나중에 상세 화면에서 정리할 수 있습니다'}
          </Text>

          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            multiline
            onChangeText={setInput}
            placeholder={useAi ? 'URL 또는 텍스트를 입력하세요...' : '제목을 적으세요...'}
            placeholderTextColor={palette.textMuted}
            style={styles.input}
            value={input}
          />

          {/*
            AI 정리를 끄는 자리.
            사진 한 장에 제목만 붙이면 될 일에도 정리를 기다리게 하면, 내가 아는
            것을 기계가 알아내기를 기다리는 셈입니다. 대신 이렇게 담은 것은
            검색의 재료(fact)가 없어서 제목으로만 찾힙니다. 그래서 나중에
            정리할 수 있다는 것을 여기서 미리 알려둡니다.
          */}
          <Pressable
            onPress={() => setUseAi((current) => !current)}
            style={({ pressed }) => [styles.aiToggle, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.aiToggleTitle}>{useAi ? '✨ AI 정리 켬' : '🗂️ 그냥 저장'}</Text>
            <View style={[styles.aiSwitch, useAi && styles.aiSwitchOn]}>
              <View style={[styles.aiKnob, useAi && styles.aiKnobOn]} />
            </View>
          </Pressable>

          {entries.length > 0 ? (
            <View style={styles.entryList}>
              {entries.map((entry, index) => (
                <View key={`${entry}-${index}`} style={styles.entryRow}>
                  <Text style={styles.entryIndex}>{index + 1}</Text>
                  <Text style={styles.entryText} numberOfLines={2}>
                    {entry}
                  </Text>
                  <Pressable
                    onPress={() => setEntries((current) => current.filter((_, i) => i !== index))}
                    hitSlop={8}
                    style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                  >
                    <Text style={styles.entryRemove}>✕</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}

          <Pressable
            onPress={stackCurrentInput}
            disabled={!canStack || isSaving}
            style={({ pressed }) => [
              styles.stackBtn,
              (!canStack || isSaving) && { opacity: 0.4 },
              { transform: [{ scale: pressed ? 0.97 : 1 }] },
            ]}
          >
            <Text style={styles.stackBtnText}>➕  내용 더 넣기</Text>
          </Pressable>

          {/* 붙여둔 사진. 저장하기 전까지는 여기서 떼고 다시 고를 수 있습니다.
              첫 장이 대표가 되고 나머지는 조각으로 붙습니다. */}
          {images.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.imageStrip}
            >
              {images.map((uri, index) => (
                <View key={uri} style={styles.imageThumbWrap}>
                  <Image source={{ uri }} style={styles.imageThumb as any} resizeMode="cover" />
                  {index === 0 && images.length > 1 ? (
                    <Text style={styles.imageThumbBadge}>대표</Text>
                  ) : null}
                  <Pressable
                    onPress={() => setImages((current) => current.filter((entry) => entry !== uri))}
                    hitSlop={8}
                    style={({ pressed }) => [styles.imageThumbRemove, pressed && { opacity: 0.6 }]}
                  >
                    <Text style={styles.imageThumbRemoveText}>✕</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          ) : null}

          {/* 스크린샷은 찍는 순간 공유하는 게 가장 빠르지만,
              갤러리에 이미 쌓아둔 것을 나중에 넣는 경로도 필요합니다. */}
          <Pressable
            onPress={() => void handlePick()}
            disabled={isSaving || isPicking}
            style={({ pressed }) => [
              styles.imagePickBtn,
              (isSaving || isPicking) && { opacity: 0.5 },
              { transform: [{ scale: pressed ? 0.97 : 1 }] },
            ]}
          >
            <Text style={styles.imagePickBtnText}>
              {images.length > 0 ? '🖼️  사진 더 고르기' : '🖼️  이미지에서 가져오기'}
            </Text>
          </Pressable>

          {error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : null}

          <View style={styles.actions}>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [
                styles.cancelBtn,
                { transform: [{ scale: pressed ? 0.95 : 1 }] },
              ]}
            >
              <Text style={styles.cancelBtnText}>취소</Text>
            </Pressable>
            <Pressable
              disabled={isSaving || !canSave}
              onPress={handleSave}
              style={({ pressed }) => [
                styles.saveBtn,
                (isSaving || !canSave) && styles.saveBtnDisabled,
                { transform: [{ scale: pressed ? 0.95 : 1 }] },
              ]}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={styles.saveBtnText}>저장</Text>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

export function CaptureFloatingButton({ onPress }: { onPress: () => void }) {
  const styles = useThemedStyles(createStyles);
  // 안드로이드 내비게이션 바(뒤로·홈)가 화면 위에 겹쳐 그려집니다.
  // 그 높이만큼 올리지 않으면 버튼이 뒤로가기와 붙어 누르기 어렵습니다.
  const insets = useSafeAreaInsets();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.fab,
        { bottom: insets.bottom + spacing[5] },
        { transform: [{ scale: pressed ? 0.9 : 1 }] },
      ]}
    >
      <Text style={styles.fabIcon}>＋</Text>
    </Pressable>
  );
}

const createStyles = (palette: Palette) =>
  StyleSheet.create({
    entryList: {
      gap: spacing[2],
      marginBottom: spacing[3],
    },
    entryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 10,
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2],
    },
    entryIndex: {
      color: palette.textMuted,
      fontSize: 11,
      fontWeight: '700',
      minWidth: 12,
    },
    entryText: {
      flex: 1,
      color: palette.textPrimary,
      fontSize: 13,
    },
    entryRemove: {
      color: palette.textMuted,
      fontSize: 13,
    },
    stackBtn: {
      alignSelf: 'flex-start',
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 999,
      paddingHorizontal: spacing[3],
      paddingVertical: 6,
      marginBottom: spacing[3],
    },
    stackBtnText: {
      color: palette.textSecondary,
      fontSize: 12,
      fontWeight: '600',
    },
  aiToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[3],
    backgroundColor: palette.surfaceRaised,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
  },
  aiToggleTitle: { color: palette.textPrimary, fontSize: 13, fontWeight: '800' },
  aiSwitch: {
    width: 44,
    height: 26,
    borderRadius: 999,
    backgroundColor: palette.surfaceStrong,
    padding: 3,
    justifyContent: 'center',
  },
  aiSwitchOn: { backgroundColor: palette.accent },
  aiKnob: {
    width: 20,
    height: 20,
    borderRadius: 999,
    backgroundColor: palette.textMuted,
  },
  aiKnobOn: { backgroundColor: palette.onAccent, alignSelf: 'flex-end' },
  imageStrip: { gap: spacing[2], paddingVertical: 2 },
  imageThumbWrap: {
    width: 72,
    height: 72,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: palette.borderStrong,
    backgroundColor: palette.surface,
  },
  imageThumb: { width: '100%', height: '100%' },
  imageThumbBadge: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    paddingHorizontal: 5,
    paddingVertical: 1,
    backgroundColor: palette.accent,
    color: palette.onAccent,
    fontSize: 9,
    fontWeight: '900',
    borderTopRightRadius: 8,
    overflow: 'hidden',
  },
  imageThumbRemove: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 20,
    height: 20,
    borderRadius: 999,
    backgroundColor: palette.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageThumbRemoveText: { color: '#ffffff', fontSize: 11, fontWeight: '900' },
  imagePickBtn: {
    backgroundColor: palette.surfaceRaised,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    paddingVertical: spacing[3],
    alignItems: 'center',
  },
  imagePickBtnText: {
    color: palette.textSecondary,
    fontSize: 13,
    fontWeight: '800',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: palette.overlay,
    zIndex: 1000,
    justifyContent: 'flex-end',
  },
  backdropTap: {
    flex: 1,
  },
  sheet: {
    backgroundColor: palette.backgroundStrong,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    shadowColor: palette.shadow,
    shadowOpacity: 0.35,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: -10 },
    elevation: 24,
    // 남은 공간보다 커지지 않게 합니다. 키보드가 올라오면 쓸 수 있는 높이가
    // 60%보다 작아지는데, 줄어들지 못하면 위쪽이 화면 밖으로 잘려나갑니다.
    flexShrink: 1,
    maxHeight: '60%',
  },
  sheetHeader: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: palette.textMuted,
    borderRadius: 99,
    opacity: 0.5,
  },
  sheetBody: {},
  sheetBodyContent: {
    paddingHorizontal: spacing[6],
    paddingBottom: spacing[8],
    gap: spacing[3],
  },
  title: {
    color: palette.textPrimary,
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  subtitle: {
    color: palette.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  input: {
    backgroundColor: palette.surface,
    borderRadius: 16,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    color: palette.textPrimary,
    fontSize: 14,
    minHeight: 80,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    textAlignVertical: 'top',
  },
  errorText: {
    color: palette.dangerText,
    fontSize: 12,
    fontWeight: '700',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[2],
    marginTop: spacing[1],
  },
  cancelBtn: {
    borderRadius: 14,
    paddingHorizontal: spacing[4],
    paddingVertical: 10,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  cancelBtnText: {
    color: palette.textSecondary,
    fontSize: 13,
    fontWeight: '800',
  },
  saveBtn: {
    borderRadius: 14,
    paddingHorizontal: spacing[5],
    paddingVertical: 10,
    backgroundColor: palette.accent,
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: {
    opacity: 0.4,
  },
  saveBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '900',
  },
  fab: {
    position: 'absolute',
    right: 20,
    // bottom은 안전영역을 더해 컴포넌트에서 지정합니다.
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#8b5cf6',
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
    zIndex: 100,
  },
  fabIcon: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '300',
    marginTop: -2,
  },
});
