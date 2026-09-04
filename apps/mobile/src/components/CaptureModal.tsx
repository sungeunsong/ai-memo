import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Palette } from '@/theme/palette';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { spacing } from '@/theme/spacing';
import { useBackHandler } from '@/hooks/useBackHandler';

type Props = {
  visible: boolean;
  onClose: () => void;
  onSave: (input: string) => Promise<{ ok: boolean; message?: string }>;
  isSaving: boolean;
  initialValue?: string;
  onPickImage: () => void;
};

export function CaptureModal({
  visible,
  onClose,
  onSave,
  isSaving,
  initialValue = '',
  onPickImage,
}: Props) {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [input, setInput] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);

  useBackHandler(visible, onClose);

  if (!visible) return null;

  async function handleSave() {
    if (!input.trim()) return;
    setError(null);
    const result = await onSave(input);
    if (result.ok) {
      setInput('');
      onClose();
    } else {
      setError(result.message || '저장에 실패했습니다.');
    }
  }

  return (
    <View style={styles.backdrop}>
      <Pressable style={styles.backdropTap} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <View style={styles.handle} />
        </View>

        <View style={styles.sheetBody}>
          <Text style={styles.title}>새 지식 수집</Text>
          <Text style={styles.subtitle}>
            유튜브, 인스타, 노션 링크 또는 텍스트를 붙여넣으세요
          </Text>

          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            multiline
            onChangeText={setInput}
            placeholder="URL 또는 텍스트를 입력하세요..."
            placeholderTextColor={palette.textMuted}
            style={styles.input}
            value={input}
          />

          {/* 스크린샷은 찍는 순간 공유하는 게 가장 빠르지만,
              갤러리에 이미 쌓아둔 것을 나중에 넣는 경로도 필요합니다. */}
          <Pressable
            onPress={onPickImage}
            disabled={isSaving}
            style={({ pressed }) => [
              styles.imagePickBtn,
              isSaving && { opacity: 0.5 },
              { transform: [{ scale: pressed ? 0.97 : 1 }] },
            ]}
          >
            <Text style={styles.imagePickBtnText}>🖼️  이미지에서 가져오기</Text>
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
              disabled={isSaving || !input.trim()}
              onPress={handleSave}
              style={({ pressed }) => [
                styles.saveBtn,
                (isSaving || !input.trim()) && styles.saveBtnDisabled,
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
        </View>
      </View>
    </View>
  );
}

export function CaptureFloatingButton({ onPress }: { onPress: () => void }) {
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.fab,
        { transform: [{ scale: pressed ? 0.9 : 1 }] },
      ]}
    >
      <Text style={styles.fabIcon}>＋</Text>
    </Pressable>
  );
}

const createStyles = (palette: Palette) =>
  StyleSheet.create({
  imagePickBtn: {
    marginTop: spacing[3],
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
  sheetBody: {
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
    bottom: 28,
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
