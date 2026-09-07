import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  PickedFile,
  exportBackupAsync,
  importBackupAsync,
  listBackupCandidatesAsync,
} from '@/features/backup';
import { ResultToast, ResultToastData } from '@/components/ResultToast';
import { Palette } from '@/theme/palette';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { spacing } from '@/theme/spacing';
import { useBackHandler } from '@/hooks/useBackHandler';

type Props = {
  visible: boolean;
  itemCount: number;
  onClose: () => void;
  /** 가져오기가 끝나면 목록을 다시 읽어야 합니다. */
  onImported: () => void;
};

/**
 * 백업 화면.
 *
 * 계정이 없는 앱이라 폰을 바꾸면 모은 것이 그대로 사라집니다.
 * 로그인을 만들지 않고도 옮길 수 있는 길을 여기서 냅니다.
 */
export function BackupModal({ visible, itemCount, onClose, onImported }: Props) {
  const { palette } = useTheme();
  const styles = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();

  const [includeImages, setIncludeImages] = useState(false);
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);
  const [toast, setToast] = useState<ResultToastData | null>(null);
  /** 결과가 아닌 안내(파일이 없다 등). 이건 가운데를 가릴 만한 일이 아닙니다. */
  const [hint, setHint] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<PickedFile[] | null>(null);

  useBackHandler(visible, onClose);

  if (!visible) return null;

  async function handleExport() {
    setBusy('export');
    setHint(null);
    try {
      const result = await exportBackupAsync(includeImages);

      // 취소는 사용자가 스스로 한 일입니다. 굳이 가운데를 가려 알릴 것이 아닙니다.
      if (result.kind === 'cancelled') return;

      setToast({
        tone: 'success',
        icon: '📦',
        title: `${result.itemCount}건을 내보냈습니다`,
        detail:
          `${result.fileName}.json` +
          (result.imageCount > 0 ? `\n이미지 ${result.imageCount}장 포함` : ''),
      });
    } catch (error) {
      setToast({
        tone: 'error',
        icon: '⚠️',
        title: '내보내지 못했습니다',
        detail: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  }

  async function handlePickFolder() {
    setBusy('import');
    setHint(null);
    try {
      const files = await listBackupCandidatesAsync();
      if (files === null) return;

      setCandidates(files);
      if (files.length === 0) {
        setHint('그 폴더에 백업 파일(.json)이 없습니다.');
      }
    } catch (error) {
      setToast({
        tone: 'error',
        icon: '⚠️',
        title: '폴더를 읽지 못했습니다',
        detail: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleImport(file: PickedFile) {
    setBusy('import');
    setHint(null);
    try {
      const result = await importBackupAsync(file.uri);
      if (result.kind !== 'imported') return;

      setCandidates(null);
      onImported();

      const changed = result.added + result.updated;
      setToast({
        tone: 'success',
        icon: changed > 0 ? '📥' : '👌',
        title: changed > 0 ? `${changed}건을 가져왔습니다` : '이미 모두 최신입니다',
        detail:
          changed > 0
            ? `새로 ${result.added}건 · 갱신 ${result.updated}건` +
              (result.skipped > 0 ? `\n${result.skipped}건은 지금 것이 최신이라 두었습니다` : '')
            : `${result.skipped}건 모두 지금 것이 더 최신입니다`,
      });
    } catch (error) {
      setToast({
        tone: 'error',
        icon: '⚠️',
        title: '가져오지 못했습니다',
        detail: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: spacing[6] + insets.bottom }]}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>📦 백업</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>

          <Text style={styles.desc}>
            모은 지식은 이 기기에만 있습니다. 폰을 바꾸기 전에 파일로 빼두세요.
          </Text>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            {/* 내보내기 */}
            <Text style={styles.sectionTitle}>내보내기</Text>
            <View style={styles.optionRow}>
              <View style={styles.optionText}>
                <Text style={styles.optionLabel}>스크린샷 원본 포함</Text>
                <Text style={styles.optionHint}>
                  이미지 한 장에 수백 KB씩 커집니다. 링크 위주면 꺼두세요.
                </Text>
              </View>
              <Switch value={includeImages} onValueChange={setIncludeImages} />
            </View>
            <Pressable
              disabled={busy !== null}
              onPress={handleExport}
              style={({ pressed }) => [
                styles.primaryBtn,
                (pressed || busy !== null) && { opacity: 0.6 },
              ]}
            >
              {busy === 'export' ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={styles.primaryBtnText}>{itemCount}건 내보내기</Text>
              )}
            </Pressable>

            {/* 가져오기 */}
            <Text style={[styles.sectionTitle, styles.sectionSpacing]}>가져오기</Text>
            <Text style={styles.optionHint}>
              지금 있는 것을 지우지 않고 합칩니다. 같은 항목은 나중에 고친 쪽을 남깁니다.
            </Text>
            <Pressable
              disabled={busy !== null}
              onPress={handlePickFolder}
              style={({ pressed }) => [
                styles.secondaryBtn,
                (pressed || busy !== null) && { opacity: 0.6 },
              ]}
            >
              {busy === 'import' ? (
                <ActivityIndicator size="small" color={palette.accentText} />
              ) : (
                <Text style={styles.secondaryBtnText}>백업 파일이 있는 폴더 고르기</Text>
              )}
            </Pressable>

            {candidates && candidates.length > 0 ? (
              <View style={styles.fileList}>
                {candidates.map((file) => (
                  <Pressable
                    key={file.uri}
                    disabled={busy !== null}
                    onPress={() => handleImport(file)}
                    style={({ pressed }) => [styles.fileRow, pressed && { opacity: 0.6 }]}
                  >
                    <Text style={styles.fileName} numberOfLines={1}>
                      {file.name}
                    </Text>
                    <Text style={styles.fileArrow}>가져오기 ›</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {hint ? <Text style={styles.message}>{hint}</Text> : null}
          </ScrollView>
        </View>

        <ResultToast data={toast} onDismiss={() => setToast(null)} />
      </View>
    </Modal>
  );
}

const createStyles = (palette: Palette) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: palette.overlay,
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: palette.backgroundStrong,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingHorizontal: spacing[5],
      paddingTop: spacing[5],
      maxHeight: '86%',
      gap: spacing[3],
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    headerTitle: { color: palette.textPrimary, fontSize: 17, fontWeight: '900' },
    closeText: { color: palette.textMuted, fontSize: 16, fontWeight: '800' },
    desc: { color: palette.textMuted, fontSize: 12, fontWeight: '600', marginTop: -spacing[2] },
    body: { marginTop: spacing[2] },
    sectionTitle: {
      color: palette.textSecondary,
      fontSize: 12,
      fontWeight: '900',
      marginBottom: spacing[2],
    },
    sectionSpacing: { marginTop: spacing[6] },
    optionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[3],
      marginBottom: spacing[3],
    },
    optionText: { flex: 1, gap: 2 },
    optionLabel: { color: palette.textPrimary, fontSize: 13, fontWeight: '800' },
    optionHint: { color: palette.textMuted, fontSize: 11, fontWeight: '600', lineHeight: 16 },
    primaryBtn: {
      backgroundColor: palette.accent,
      borderRadius: 14,
      paddingVertical: spacing[3],
      alignItems: 'center',
    },
    primaryBtnText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
    secondaryBtn: {
      backgroundColor: palette.surfaceRaised,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: palette.border,
      paddingVertical: spacing[3],
      alignItems: 'center',
      marginTop: spacing[3],
    },
    secondaryBtnText: { color: palette.textSecondary, fontSize: 13, fontWeight: '800' },
    fileList: { marginTop: spacing[3], gap: spacing[2] },
    fileRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing[3],
      backgroundColor: palette.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: palette.border,
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[3],
    },
    fileName: { flex: 1, color: palette.textPrimary, fontSize: 12, fontWeight: '700' },
    fileArrow: { color: palette.accentText, fontSize: 12, fontWeight: '800' },
    message: {
      color: palette.textSecondary,
      fontSize: 12,
      fontWeight: '700',
      lineHeight: 18,
      marginTop: spacing[4],
    },
  });
