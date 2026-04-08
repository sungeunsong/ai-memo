import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SavedItem } from '@/features/items/types';
import { useAppStore } from '@/store';
import { palette } from '@/theme/palette';
import { spacing } from '@/theme/spacing';

export function HomeScreen() {
  const [urlInput, setUrlInput] = useState('');
  const [isPasting, setIsPasting] = useState(false);
  const isReady = useAppStore((state) => state.isReady);
  const isInitializing = useAppStore((state) => state.isInitializing);
  const isSaving = useAppStore((state) => state.isSaving);
  const items = useAppStore((state) => state.items);
  const selectedItemId = useAppStore((state) => state.selectedItemId);
  const errorMessage = useAppStore((state) => state.errorMessage);
  const saveUrl = useAppStore((state) => state.saveUrl);
  const selectItem = useAppStore((state) => state.selectItem);
  const clearError = useAppStore((state) => state.clearError);

  const selectedItem = items.find((item) => item.id === selectedItemId) ?? items[0] ?? null;

  async function handlePaste() {
    setIsPasting(true);
    clearError();

    try {
      const clipboardText = await Clipboard.getStringAsync();
      setUrlInput(clipboardText);
    } finally {
      setIsPasting(false);
    }
  }

  async function handleSave() {
    const result = await saveUrl(urlInput);

    if (result.ok) {
      setUrlInput('');
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>AI Memo</Text>
          <Text style={styles.title}>URL을 빠르게 저장하고, 나중에 AI가 정리합니다.</Text>
          <Text style={styles.description}>
            유튜브나 인스타 링크를 우선 저장하고, 제목과 요약은 이후 단계에서 보강합니다.
          </Text>

          <View style={styles.inputShell}>
            <Text style={styles.inputLabel}>저장할 URL</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              onChangeText={setUrlInput}
              placeholder="youtube.com 또는 instagram.com 링크를 붙여넣으세요"
              placeholderTextColor={palette.textMuted}
              style={styles.input}
              value={urlInput}
            />
            <View style={styles.heroActions}>
              <Pressable
                disabled={isPasting}
                onPress={handlePaste}
                style={[styles.button, styles.secondaryButton]}
              >
                <Text style={styles.secondaryButtonText}>
                  {isPasting ? '붙여넣는 중' : '붙여넣기'}
                </Text>
              </Pressable>
              <Pressable
                disabled={isSaving || !isReady}
                onPress={handleSave}
                style={[
                  styles.button,
                  styles.primaryButton,
                  (isSaving || !isReady) && styles.disabledButton,
                ]}
              >
                <Text style={styles.primaryButtonText}>
                  {isSaving ? '저장 중...' : '로컬에 저장'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>이번 단계에서 먼저 확인할 것</Text>
          <View style={styles.checklist}>
            <ChecklistItem text="저장 버튼을 누르면 즉시 로컬 DB에 반영되는가" />
            <ChecklistItem text="앱을 다시 열어도 목록이 그대로 남아 있는가" />
            <ChecklistItem text="AI가 없어도 UI가 허전하지 않게 보이는가" />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>저장 목록</Text>
          {!isReady || isInitializing ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator color={palette.accent} />
              <Text style={styles.loadingText}>로컬 데이터를 불러오는 중입니다.</Text>
            </View>
          ) : items.length === 0 ? (
            <EmptyState />
          ) : (
            <View style={styles.cardList}>
              {items.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => selectItem(item.id)}
                  style={[
                    styles.card,
                    item.id === selectedItem?.id && styles.cardSelected,
                  ]}
                >
                  <ItemCard item={item} />
                </Pressable>
              ))}
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>상세 미리보기</Text>
          {selectedItem ? (
            <View style={styles.detailCard}>
              <View style={styles.detailHeader}>
                <Text style={styles.detailTitle}>{selectedItem.title}</Text>
                <StatusBadge label={selectedItem.aiStatus === 'pending' ? 'AI 대기' : '저장됨'} />
              </View>
              <Text style={styles.detailLabel}>원본 URL</Text>
              <Text style={styles.detailValue}>{selectedItem.sourceUrl ?? '-'}</Text>
              <Text style={styles.detailLabel}>요약</Text>
              <Text style={styles.detailValue}>{selectedItem.summary}</Text>
              <Text style={styles.detailLabel}>본문 placeholder</Text>
              <Text style={styles.detailValue}>
                상세 본문 파싱과 썸네일 선택은 다음 단계에서 보강합니다.
              </Text>
            </View>
          ) : (
            <View style={styles.detailEmpty}>
              <Text style={styles.detailEmptyText}>
                아직 저장된 항목이 없습니다. 먼저 링크를 저장해 보세요.
              </Text>
            </View>
          )}
        </View>

        {errorMessage ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function ItemCard({ item }: { item: SavedItem }) {
  return (
    <>
      <View style={styles.cardMetaRow}>
        <Text style={styles.cardSource}>{getItemSourceLabel(item)}</Text>
        <StatusBadge label={item.aiStatus === 'pending' ? 'AI 대기' : '저장됨'} />
      </View>
      <Text style={styles.cardTitle}>{item.title}</Text>
      <Text style={styles.cardSummary}>{item.summary}</Text>
    </>
  );
}

function ChecklistItem({ text }: { text: string }) {
  return (
    <View style={styles.checklistItem}>
      <View style={styles.checkDot} />
      <Text style={styles.checkText}>{text}</Text>
    </View>
  );
}

function EmptyState() {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>아직 저장된 링크가 없습니다</Text>
      <Text style={styles.emptyDescription}>
        유튜브나 인스타 URL을 붙여넣으면 로컬 DB에 바로 저장되고 목록에 즉시 나타납니다.
      </Text>
    </View>
  );
}

function StatusBadge({ label }: { label: string }) {
  return (
    <View style={styles.pendingBadge}>
      <Text style={styles.pendingBadgeText}>{label}</Text>
    </View>
  );
}

function getItemSourceLabel(item: SavedItem) {
  if (!item.sourceUrl) {
    return '직접 입력';
  }

  return new URL(item.sourceUrl).hostname.replace(/^www\./, '');
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: palette.background,
  },
  content: {
    padding: spacing[6],
    gap: spacing[6],
  },
  hero: {
    backgroundColor: palette.surfaceStrong,
    borderRadius: 28,
    padding: spacing[6],
    gap: spacing[4],
  },
  eyebrow: {
    color: palette.accent,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  title: {
    color: palette.textPrimary,
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '800',
  },
  description: {
    color: palette.textSecondary,
    fontSize: 15,
    lineHeight: 23,
  },
  inputShell: {
    backgroundColor: palette.surface,
    borderRadius: 20,
    padding: spacing[4],
    gap: spacing[3],
    borderWidth: 1,
    borderColor: palette.border,
  },
  inputLabel: {
    color: palette.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  input: {
    minHeight: 54,
    backgroundColor: palette.background,
    borderRadius: 16,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    color: palette.textPrimary,
    fontSize: 15,
    borderWidth: 1,
    borderColor: palette.border,
  },
  heroActions: {
    flexDirection: 'row',
    gap: spacing[3],
  },
  button: {
    borderRadius: 16,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    minWidth: 120,
    alignItems: 'center',
  },
  primaryButton: {
    backgroundColor: palette.textPrimary,
    flex: 1,
  },
  secondaryButton: {
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  disabledButton: {
    opacity: 0.55,
  },
  primaryButtonText: {
    color: palette.surfaceStrong,
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryButtonText: {
    color: palette.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  section: {
    gap: spacing[3],
  },
  sectionTitle: {
    color: palette.textPrimary,
    fontSize: 20,
    fontWeight: '700',
  },
  checklist: {
    backgroundColor: palette.surface,
    borderRadius: 24,
    padding: spacing[5],
    gap: spacing[3],
    borderWidth: 1,
    borderColor: palette.border,
  },
  checklistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
  },
  checkDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: palette.accent,
  },
  checkText: {
    flex: 1,
    color: palette.textSecondary,
    fontSize: 14,
    lineHeight: 21,
  },
  cardList: {
    gap: spacing[3],
  },
  card: {
    backgroundColor: palette.surface,
    borderRadius: 24,
    padding: spacing[5],
    gap: spacing[3],
    borderWidth: 1,
    borderColor: palette.border,
  },
  cardSelected: {
    borderColor: palette.accent,
    shadowColor: '#3d2a17',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  cardMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing[3],
  },
  cardSource: {
    color: palette.textMuted,
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  pendingBadge: {
    backgroundColor: palette.pending,
    borderRadius: 999,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
  },
  pendingBadgeText: {
    color: palette.pendingText,
    fontSize: 12,
    fontWeight: '700',
  },
  cardTitle: {
    color: palette.textPrimary,
    fontSize: 19,
    lineHeight: 25,
    fontWeight: '700',
  },
  cardSummary: {
    color: palette.textSecondary,
    fontSize: 14,
    lineHeight: 21,
  },
  loadingCard: {
    backgroundColor: palette.surface,
    borderRadius: 24,
    padding: spacing[6],
    gap: spacing[3],
    alignItems: 'center',
    borderWidth: 1,
    borderColor: palette.border,
  },
  loadingText: {
    color: palette.textSecondary,
    fontSize: 14,
  },
  emptyState: {
    backgroundColor: palette.surface,
    borderRadius: 24,
    padding: spacing[6],
    gap: spacing[3],
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: palette.border,
  },
  emptyTitle: {
    color: palette.textPrimary,
    fontSize: 18,
    fontWeight: '700',
  },
  emptyDescription: {
    color: palette.textSecondary,
    fontSize: 14,
    lineHeight: 21,
  },
  detailCard: {
    backgroundColor: palette.surface,
    borderRadius: 24,
    padding: spacing[5],
    gap: spacing[3],
    borderWidth: 1,
    borderColor: palette.border,
  },
  detailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing[3],
  },
  detailTitle: {
    flex: 1,
    color: palette.textPrimary,
    fontSize: 22,
    lineHeight: 29,
    fontWeight: '800',
  },
  detailLabel: {
    color: palette.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  detailValue: {
    color: palette.textSecondary,
    fontSize: 14,
    lineHeight: 22,
  },
  detailEmpty: {
    backgroundColor: palette.surface,
    borderRadius: 24,
    padding: spacing[6],
    borderWidth: 1,
    borderColor: palette.border,
  },
  detailEmptyText: {
    color: palette.textSecondary,
    fontSize: 14,
    lineHeight: 22,
  },
  errorBanner: {
    backgroundColor: '#f9d6d1',
    borderRadius: 18,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderWidth: 1,
    borderColor: '#d9857a',
  },
  errorText: {
    color: '#7d2318',
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '600',
  },
});
