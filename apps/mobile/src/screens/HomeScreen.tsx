import * as Clipboard from 'expo-clipboard';
import { useShareIntentContext } from 'expo-share-intent';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  Linking,
  AppState,
  AppStateStatus,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SavedItem } from '@/features/items/types';
import {
  buildShareIntentSignature,
  getSharedInputValue,
  hasUnsupportedSharedFiles,
} from '@/features/capture/shareIntent';
import { useAppStore } from '@/store';
import { getHostname } from '@/features/items/fallback';
import { palette } from '@/theme/palette';
import { spacing } from '@/theme/spacing';

const quickLinks = [
  {
    label: '유튜브 예시',
    value: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  },
  {
    label: '인스타 예시',
    value: 'https://www.instagram.com/p/C4J0Example/',
  },
];

export function HomeScreen() {
  const [urlInput, setUrlInput] = useState('');
  const [isPasting, setIsPasting] = useState(false);
  const [isImportingShare, setIsImportingShare] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);
  const [userNoteInput, setUserNoteInput] = useState('');
  const processedShareSignatureRef = useRef<string | null>(null);
  const { width } = useWindowDimensions();
  const isReady = useAppStore((state) => state.isReady);
  const isInitializing = useAppStore((state) => state.isInitializing);
  const hasInitializationAttempted = useAppStore((state) => state.hasInitializationAttempted);
  const isSaving = useAppStore((state) => state.isSaving);
  const items = useAppStore((state) => state.items);
  const selectedItemId = useAppStore((state) => state.selectedItemId);
  const errorMessage = useAppStore((state) => state.errorMessage);
  const syncQueuePendingCount = useAppStore((state) => state.syncQueuePendingCount);
  const syncQueueFailedCount = useAppStore((state) => state.syncQueueFailedCount);
  const syncWorkerMessage = useAppStore((state) => state.syncWorkerMessage);
  const isSyncWorkerRunning = useAppStore((state) => state.isSyncWorkerRunning);
  const initialize = useAppStore((state) => state.initialize);
  const saveUrl = useAppStore((state) => state.saveUrl);
  const selectItem = useAppStore((state) => state.selectItem);
  const updateUserNote = useAppStore((state) => state.updateUserNote);
  const clearError = useAppStore((state) => state.clearError);
  const { hasShareIntent, shareIntent, resetShareIntent, error: shareIntentError } =
    useShareIntentContext();

  const selectedItem = items.find((item) => item.id === selectedItemId) ?? items[0] ?? null;
  const isWideLayout = width >= 940;
  const lastSavedAt = items[0]?.createdAt ? formatRelativeTime(items[0].createdAt) : '아직 없음';
  const runtimeErrorMessage = errorMessage ?? shareIntentError ?? null;

  useEffect(() => {
    setUserNoteInput(selectedItem?.userNote ?? '');
  }, [selectedItem?.id, selectedItem?.userNote]);

  async function handleSaveUserNote() {
    if (!selectedItem) {
      return;
    }
    await updateUserNote(selectedItem.id, userNoteInput);
    setToastMessage('퀵 메모를 안전하게 로컬 DB에 저장했습니다.');
  }

  const [clipboardCandidate, setClipboardCandidate] = useState<string | null>(null);

  useEffect(() => {
    void checkClipboard();

    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        void checkClipboard();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [items]);

  async function checkClipboard() {
    try {
      const text = await Clipboard.getStringAsync();
      const trimmed = text.trim();
      if (!trimmed) {
        setClipboardCandidate(null);
        return;
      }

      if (items.length > 0 && items[0].rawInput === trimmed) {
        setClipboardCandidate(null);
        return;
      }

      setClipboardCandidate(trimmed);
    } catch {
      setClipboardCandidate(null);
    }
  }

  async function handleSaveClipboard() {
    if (!clipboardCandidate) {
      return;
    }
    const result = await saveUrl(clipboardCandidate, 'clipboard');
    if (result.ok) {
      const nextSelectedItem = useAppStore.getState().selectedItemId;
      setToastMessage('클립보드 내용을 즉시 저장하고 분류를 마쳤습니다.');
      if (nextSelectedItem) {
        setHighlightedItemId(nextSelectedItem);
      }
      setClipboardCandidate(null);
    }
  }

  useEffect(() => {
    if (!toastMessage) {
      return;
    }

    const timeoutId = setTimeout(() => {
      setToastMessage(null);
    }, 2400);

    return () => clearTimeout(timeoutId);
  }, [toastMessage]);

  useEffect(() => {
    if (!highlightedItemId) {
      return;
    }

    const timeoutId = setTimeout(() => {
      setHighlightedItemId(null);
    }, 2600);

    return () => clearTimeout(timeoutId);
  }, [highlightedItemId]);

  useEffect(() => {
    if (!hasShareIntent) {
      processedShareSignatureRef.current = null;
      return;
    }

    const sharedInput = getSharedInputValue(shareIntent);
    const currentSignature = buildShareIntentSignature(shareIntent);

    if (hasUnsupportedSharedFiles(shareIntent)) {
      if (processedShareSignatureRef.current === currentSignature) {
        return;
      }

      processedShareSignatureRef.current = currentSignature;
      setToastMessage('이미지와 파일 공유는 아직 준비 중입니다. 지금은 링크 공유만 저장합니다.');
      resetShareIntent();
      return;
    }

    if (!hasShareIntent || !sharedInput) {
      return;
    }

    if (processedShareSignatureRef.current === currentSignature) {
      return;
    }

    processedShareSignatureRef.current = currentSignature;
    setIsImportingShare(true);
    clearError();
    setUrlInput(sharedInput);

    void (async () => {
      const result = await saveUrl(sharedInput);

      if (result.ok) {
        const nextSelectedItem = useAppStore.getState().selectedItemId;
        setUrlInput('');
        setToastMessage('공유된 링크를 로컬에 저장했습니다. 메타데이터를 이어서 보강합니다.');
        if (nextSelectedItem) {
          setHighlightedItemId(nextSelectedItem);
        }
      }

      resetShareIntent();
      setIsImportingShare(false);
    })();
  }, [clearError, hasShareIntent, resetShareIntent, saveUrl, shareIntent]);

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
      const nextSelectedItem = useAppStore.getState().selectedItemId;
      setUrlInput('');
      setToastMessage('링크를 로컬에 저장했습니다. 메타데이터를 이어서 보강합니다.');
      if (nextSelectedItem) {
        setHighlightedItemId(nextSelectedItem);
      }
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.heroGlowLarge} />
          <View style={styles.heroGlowSmall} />

          <View style={styles.heroHeader}>
            <Text style={styles.eyebrow}>AI Memo / Phase 0</Text>
            <Text style={styles.title}>저장은 즉시, 정리는 나중에.</Text>
            <Text style={styles.description}>
              유튜브와 인스타 링크를 빠르게 쌓아두고, 나중에 온디바이스 AI가 제목과
              요약을 정리하는 흐름을 먼저 만듭니다.
            </Text>
          </View>

          <View style={styles.metricsRow}>
            <MetricCard label="저장된 링크" value={`${items.length}`} helper="로컬 DB 기준" />
            <MetricCard label="최근 저장" value={lastSavedAt} helper="앱 재실행 후 복원" />
            <MetricCard
              label="동기화 큐"
              value={syncQueuePendingCount ? `${syncQueuePendingCount} 대기` : '비어 있음'}
              helper={
                isSyncWorkerRunning
                  ? '큐 처리 중'
                  : syncQueueFailedCount
                    ? `실패 ${syncQueueFailedCount}건`
                    : syncWorkerMessage ?? '저장 후 비동기 업로드 준비'
              }
            />
          </View>
        </View>

        {toastMessage ? (
          <View style={styles.toast}>
            <View style={styles.toastDot} />
            <Text style={styles.toastText}>{toastMessage}</Text>
          </View>
        ) : null}

        {syncWorkerMessage ? (
          <View style={styles.syncInfoBanner}>
            <Text style={styles.syncInfoText}>{syncWorkerMessage}</Text>
          </View>
        ) : null}

        {clipboardCandidate ? (
          <View style={styles.clipboardBanner}>
            <View style={styles.clipboardBannerLeft}>
              <View style={styles.clipboardBannerDot} />
              <View style={styles.clipboardBannerTextColumn}>
                <Text style={styles.clipboardBannerTitle}>클립보드에 복사된 내용이 있습니다</Text>
                <Text style={styles.clipboardBannerDesc} numberOfLines={1}>
                  "{clipboardCandidate.replace(/\s+/g, ' ')}"
                </Text>
              </View>
            </View>
            <View style={styles.clipboardBannerActions}>
              <Pressable onPress={() => setClipboardCandidate(null)} style={styles.clipboardBannerCloseBtn}>
                <Text style={styles.clipboardBannerCloseBtnText}>닫기</Text>
              </Pressable>
              <Pressable onPress={handleSaveClipboard} style={styles.clipboardBannerSaveBtn}>
                <Text style={styles.clipboardBannerSaveBtnText}>즉시 저장</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <View style={[styles.workspace, isWideLayout && styles.workspaceWide]}>
          <View style={[styles.leftColumn, isWideLayout && styles.leftColumnWide]}>
            <View style={styles.composerCard}>
              <View style={styles.panelHeader}>
                <Text style={styles.panelEyebrow}>Quick Capture</Text>
                <Text style={styles.panelTitle}>링크를 붙여넣거나 공유 버튼으로 저장</Text>
                <Text style={styles.panelDescription}>
                  저장은 로컬에서 먼저 끝내고, 목록에 즉시 반영합니다. 안드로이드 공유 시트
                  에서 `AI Memo`를 선택하면 자동 저장 흐름으로 들어옵니다.
                </Text>
              </View>

              <View style={styles.tipRow}>
                <Chip label="저장 우선" tone="accent" />
                <Chip label="AI 비동기" tone="neutral" />
                <Chip label="local-first" tone="neutral" />
                <Chip label="Android 공유" tone="neutral" />
              </View>

              <View style={styles.inputShell}>
                <Text style={styles.inputLabel}>저장할 URL 또는 공유된 텍스트</Text>
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
                {isImportingShare ? (
                  <View style={styles.shareImportBanner}>
                    <ActivityIndicator size="small" color={palette.accentStrong} />
                    <Text style={styles.shareImportText}>
                      공유 시트에서 전달된 링크를 저장하는 중입니다.
                    </Text>
                  </View>
                ) : null}
                <View style={styles.quickLinkRow}>
                  {quickLinks.map((link) => (
                    <Pressable
                      key={link.label}
                      onPress={() => setUrlInput(link.value)}
                      style={styles.quickLink}
                    >
                      <Text style={styles.quickLinkText}>{link.label}</Text>
                    </Pressable>
                  ))}
                </View>
                <View style={styles.actionRow}>
                  <Pressable
                    disabled={isPasting}
                    onPress={handlePaste}
                    style={[styles.button, styles.secondaryButton]}
                  >
                    <Text style={styles.secondaryButtonText}>
                      {isPasting ? '붙여넣는 중' : '클립보드 붙여넣기'}
                    </Text>
                  </Pressable>
                  <Pressable
                    disabled={isSaving || isInitializing}
                    onPress={handleSave}
                    style={[
                      styles.button,
                      styles.primaryButton,
                      (isSaving || isInitializing) && styles.disabledButton,
                    ]}
                  >
                    <Text style={styles.primaryButtonText}>
                      {isSaving ? '저장 중...' : '로컬에 저장'}
                    </Text>
                  </Pressable>
                </View>
                <View style={styles.shareHintCard}>
                  <Text style={styles.shareHintTitle}>공유 버튼 테스트</Text>
                  <Text style={styles.shareHintText}>
                    {Platform.OS === 'android'
                      ? '유튜브나 인스타에서 공유 버튼을 누른 뒤 AI Memo를 선택하면 링크가 자동 저장됩니다. 이 기능은 dev build에서 동작합니다.'
                      : '지금 화면에서는 붙여넣기로 흐름을 먼저 검증합니다. Android 공유 인입은 dev build에서 테스트합니다.'}
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.guidanceCard}>
              <Text style={styles.sectionTitle}>이번 단계에서 확인할 기준</Text>
              <View style={styles.checklist}>
                <ChecklistItem text="저장 버튼을 누르면 즉시 로컬 DB에 반영되는가" />
                <ChecklistItem text="앱을 다시 열어도 목록이 그대로 남아 있는가" />
                <ChecklistItem text="AI가 없어도 화면이 허전하지 않고 읽히는가" />
                <ChecklistItem text="저장 직후 sync queue가 1건 쌓이는가" />
              </View>
            </View>
          </View>

          <View style={[styles.rightColumn, isWideLayout && styles.rightColumnWide]}>
            <View style={styles.panel}>
              <View style={styles.panelTopRow}>
                <Text style={styles.sectionTitle}>저장 목록</Text>
                <Text style={styles.sectionMeta}>{items.length} items</Text>
              </View>

              {isInitializing ? (
                <View style={styles.loadingCard}>
                  <ActivityIndicator color={palette.accent} />
                  <Text style={styles.loadingText}>로컬 데이터를 불러오는 중입니다.</Text>
                </View>
              ) : !isReady && hasInitializationAttempted ? (
                <View style={styles.initErrorCard}>
                  <Text style={styles.initErrorTitle}>로컬 저장소 초기화에 실패했습니다</Text>
                  <Text style={styles.initErrorDescription}>
                    저장소 준비가 끝나지 않아 목록을 읽지 못했습니다. 다시 시도해 주세요.
                  </Text>
                  <Pressable
                    onPress={() => void initialize()}
                    style={[styles.button, styles.secondaryButton]}
                  >
                    <Text style={styles.secondaryButtonText}>다시 시도</Text>
                  </Pressable>
                </View>
              ) : items.length === 0 ? (
                <EmptyState />
              ) : (
                <View style={styles.cardList}>
                  {items.map((item) => {
                    const theme = getSourceTheme(item.sourceType);
                    return (
                      <Pressable
                        key={item.id}
                        onPress={() => selectItem(item.id)}
                        style={[
                          styles.card,
                          item.id === selectedItem?.id && styles.cardSelected,
                          item.id === highlightedItemId && styles.cardHighlighted,
                        ]}
                      >
                        <View
                          style={[
                            styles.cardAccent,
                            { backgroundColor: theme.badgeText },
                          ]}
                        />
                        <ItemCard item={item} />
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>

            <View style={styles.panel}>
              <View style={styles.panelTopRow}>
                <Text style={styles.sectionTitle}>선택한 항목</Text>
                <Text style={styles.sectionMeta}>
                  {selectedItem ? formatRelativeTime(selectedItem.createdAt) : '선택 없음'}
                </Text>
              </View>

              {selectedItem ? (
                (() => {
                  const theme = getSourceTheme(selectedItem.sourceType);
                  return (
                    <View style={styles.detailCard}>
                      <View style={[styles.detailHero, { borderColor: theme.border, backgroundColor: theme.bg }]}>
                        <View style={styles.detailHeroText}>
                          <Text style={styles.detailTitle}>{selectedItem.title}</Text>
                          <Text style={[styles.detailSource, { color: theme.badgeText, fontWeight: '700' }]}>
                            {theme.label} · {selectedItem.sourceUrl ? getHostname(selectedItem.sourceUrl) : '로컬'}
                          </Text>
                        </View>
                        <View style={[styles.pendingBadge, { backgroundColor: theme.badgeBg }]}>
                          <Text style={[styles.pendingBadgeText, { color: theme.badgeText }]}>
                            {getStatusLabel(selectedItem)}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.detailGrid}>
                        <MetaBlock label="원본 링크" value={selectedItem.sourceUrl ? truncateMiddle(selectedItem.sourceUrl) : '없음'} />
                        <MetaBlock label="동기화" value={getSyncStatusLabel(selectedItem.syncStatus)} />
                        <MetaBlock label="생성 시각" value={formatReadableDate(selectedItem.createdAt)} />
                        <MetaBlock label="유형" value={selectedItem.type === 'url' ? '링크 저장' : '텍스트 메모'} />
                      </View>

                      <View style={styles.detailSection}>
                        <Text style={styles.detailLabel}>원문 (SNS DM / 캡션 전체)</Text>
                        <ScrollView style={styles.rawInputScrollView} nestedScrollEnabled showsVerticalScrollIndicator={true}>
                          <Text style={styles.detailRawInputText}>{selectedItem.rawInput}</Text>
                        </ScrollView>
                      </View>

                      <View style={styles.detailSection}>
                        <Text style={styles.detailLabel}>퀵 한 줄 메모</Text>
                        <View style={styles.noteInputRow}>
                          <TextInput
                            style={styles.noteInput}
                            placeholder="보낸 사람이나 저장한 맥락을 잊지 않게 적어두세요."
                            placeholderTextColor={palette.textMuted}
                            value={userNoteInput}
                            onChangeText={setUserNoteInput}
                            multiline
                            blurOnSubmit={true}
                          />
                          <Pressable onPress={handleSaveUserNote} style={styles.noteSaveButton}>
                            <Text style={styles.noteSaveButtonText}>저장</Text>
                          </Pressable>
                        </View>
                      </View>

                      {selectedItem.extractedUrls && selectedItem.extractedUrls.length > 0 ? (
                        <View style={styles.detailSection}>
                          <Text style={styles.detailLabel}>추출된 링크 목록 ({selectedItem.extractedUrls.length}개)</Text>
                          <View style={styles.extractedUrlsList}>
                            {selectedItem.extractedUrls.map((url, idx) => (
                              <Pressable
                                key={idx}
                                onPress={() => Linking.openURL(url).catch(() => setToastMessage('링크를 열 수 없습니다.'))}
                                style={styles.urlClickableRow}
                              >
                                <Text style={styles.urlClickableNum}>#{idx + 1}</Text>
                                <Text style={styles.urlClickableText} numberOfLines={1}>
                                  {url}
                                </Text>
                              </Pressable>
                            ))}
                          </View>
                        </View>
                      ) : null}

                      {selectedItem.type === 'url' && (
                        <View style={styles.thumbnailPanel}>
                          <Text style={styles.detailLabel}>썸네일</Text>
                          <View style={styles.thumbnailPreview}>
                            {selectedItem.thumbnailUrl ? (
                              <>
                                <Image
                                  source={{ uri: selectedItem.thumbnailUrl }}
                                  style={styles.thumbnailImage}
                                  resizeMode="cover"
                                />
                                <Text style={styles.thumbnailTitle}>대표 이미지 후보를 찾았습니다</Text>
                                <Text style={styles.thumbnailUrl}>{truncateMiddle(selectedItem.thumbnailUrl)}</Text>
                              </>
                            ) : (
                              <Text style={styles.thumbnailEmptyText}>
                                아직 썸네일을 찾지 못했습니다. 도메인별 파서가 더 붙으면 정확도가 올라갑니다.
                              </Text>
                            )}
                          </View>
                        </View>
                      )}

                      <View style={styles.detailSection}>
                        <Text style={styles.detailLabel}>AI 정리 및 요약</Text>
                        <Text style={styles.detailValue}>{selectedItem.summary}</Text>
                      </View>
                    </View>
                  );
                })()
              ) : (
                <View style={styles.detailEmpty}>
                  <Text style={styles.detailEmptyTitle}>아직 선택된 항목이 없습니다</Text>
                  <Text style={styles.detailEmptyText}>
                    첫 링크를 저장하면 오른쪽 패널에서 상세 상태를 바로 확인할 수 있습니다.
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {runtimeErrorMessage ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{runtimeErrorMessage}</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function MetricCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricHelper}>{helper}</Text>
    </View>
  );
}

function ItemCard({ item }: { item: SavedItem }) {
  return (
    <View style={styles.cardContent}>
      <View style={styles.cardRow}>
        <View style={styles.cardTextColumn}>
          <View style={styles.cardMetaRow}>
            <Text style={styles.cardSource}>{getItemSourceLabel(item)}</Text>
            <StatusBadge label={getStatusLabel(item)} compact />
          </View>
          <Text style={styles.cardTitle}>{item.title}</Text>
          <Text style={styles.cardSummary}>{item.summary}</Text>
          <Text style={styles.cardTimestamp}>{formatReadableDate(item.createdAt)}</Text>
        </View>
        <ThumbnailThumb item={item} />
      </View>
    </View>
  );
}

function ThumbnailThumb({ item }: { item: SavedItem }) {
  if (item.thumbnailUrl) {
    return (
      <Image
        source={{ uri: item.thumbnailUrl }}
        style={styles.cardThumbnail}
        resizeMode="cover"
      />
    );
  }

  return (
    <View style={styles.cardThumbnailPlaceholder}>
      <Text style={styles.cardThumbnailPlaceholderText}>
        {getItemSourceLabel(item).slice(0, 2).toUpperCase()}
      </Text>
    </View>
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
        유튜브나 인스타 URL을 붙여넣으면 목록에 바로 쌓이고, 재실행 후에도 그대로 남아
        있어야 합니다.
      </Text>
    </View>
  );
}

function StatusBadge({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <View style={[styles.pendingBadge, compact && styles.pendingBadgeCompact]}>
      <Text style={styles.pendingBadgeText}>{label}</Text>
    </View>
  );
}

function Chip({ label, tone }: { label: string; tone: 'accent' | 'neutral' }) {
  return (
    <View style={[styles.chip, tone === 'accent' ? styles.chipAccent : styles.chipNeutral]}>
      <Text style={[styles.chipText, tone === 'accent' ? styles.chipAccentText : styles.chipNeutralText]}>
        {label}
      </Text>
    </View>
  );
}

function MetaBlock({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaBlock}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

function getStatusLabel(item: SavedItem) {
  const syncLabel = getSyncStatusLabel(item.syncStatus);

  if (item.aiStatus === 'completed') {
    return `${syncLabel} · 메타 완료`;
  }

  if (item.aiStatus === 'failed') {
    return `${syncLabel} · 기본 저장`;
  }

  return `${syncLabel} · 보강 중`;
}

function getSyncStatusLabel(syncStatus: SavedItem['syncStatus']) {
  if (syncStatus === 'queued') {
    return '동기화 대기';
  }

  if (syncStatus === 'synced') {
    return '동기화 완료';
  }

  if (syncStatus === 'failed') {
    return '동기화 실패';
  }

  return '로컬만 저장';
}

function getItemSourceLabel(item: SavedItem) {
  if (!item.sourceUrl) {
    return '직접 입력';
  }

  return new URL(item.sourceUrl).hostname.replace(/^www\./, '');
}

function formatRelativeTime(value: string) {
  const now = Date.now();
  const target = new Date(value).getTime();
  const diffMinutes = Math.max(0, Math.round((now - target) / 60000));

  if (diffMinutes < 1) {
    return '방금 전';
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}분 전`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}시간 전`;
  }

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}일 전`;
}

function formatReadableDate(value: string) {
  const date = new Date(value);

  return `${date.getMonth() + 1}.${String(date.getDate()).padStart(2, '0')} ${String(
    date.getHours()
  ).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function truncateMiddle(value: string) {
  if (value.length <= 38) {
    return value;
  }

  return `${value.slice(0, 20)}...${value.slice(-12)}`;
}

function getSourceTheme(sourceType: string) {
  switch (sourceType) {
    case 'youtube':
      return {
        border: 'rgba(239, 68, 68, 0.25)',
        bg: 'rgba(239, 68, 68, 0.06)',
        badgeBg: 'rgba(239, 68, 68, 0.16)',
        badgeText: '#ef4444',
        label: 'YouTube',
      };
    case 'instagram':
    case 'instagram_post':
    case 'instagram_reel':
      return {
        border: 'rgba(236, 72, 153, 0.25)',
        bg: 'rgba(236, 72, 153, 0.06)',
        badgeBg: 'rgba(236, 72, 153, 0.16)',
        badgeText: '#ec4899',
        label: sourceType === 'instagram_reel' ? 'Instagram Reel' : sourceType === 'instagram_post' ? 'Instagram Post' : 'Instagram',
      };
    case 'notion':
      return {
        border: 'rgba(241, 245, 249, 0.22)',
        bg: 'rgba(241, 245, 249, 0.05)',
        badgeBg: 'rgba(241, 245, 249, 0.14)',
        badgeText: '#f1f5f9',
        label: 'Notion',
      };
    case 'google_docs':
    case 'google_sheets':
    case 'google_drive':
    case 'google_form':
      return {
        border: 'rgba(59, 130, 246, 0.25)',
        bg: 'rgba(59, 130, 246, 0.06)',
        badgeBg: 'rgba(59, 130, 246, 0.16)',
        badgeText: '#3b82f6',
        label: sourceType === 'google_docs' ? 'Google Docs' : sourceType === 'google_sheets' ? 'Google Sheets' : sourceType === 'google_form' ? 'Google Form' : 'Google Drive',
      };
    case 'manual_text':
      return {
        border: 'rgba(249, 115, 22, 0.25)',
        bg: 'rgba(249, 115, 22, 0.06)',
        badgeBg: 'rgba(249, 115, 22, 0.16)',
        badgeText: '#f97316',
        label: '직접 메모',
      };
    default:
      return {
        border: 'rgba(139, 92, 246, 0.25)',
        bg: 'rgba(139, 92, 246, 0.06)',
        badgeBg: 'rgba(139, 92, 246, 0.16)',
        badgeText: '#a78bfa',
        label: 'Web Link',
      };
  }
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
  clipboardBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(59, 130, 246, 0.07)',
    borderRadius: 24,
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[4],
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.22)',
    gap: spacing[3],
    flexWrap: 'wrap',
    shadowColor: '#3b82f6',
    shadowOpacity: 0.15,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
  },
  clipboardBannerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minWidth: 260,
  },
  clipboardBannerDot: {
    width: 12,
    height: 12,
    borderRadius: 999,
    backgroundColor: '#3b82f6',
    shadowColor: '#3b82f6',
    shadowRadius: 6,
    shadowOpacity: 0.8,
  },
  clipboardBannerTextColumn: {
    flex: 1,
    gap: 2,
  },
  clipboardBannerTitle: {
    color: palette.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  clipboardBannerDesc: {
    color: palette.textSecondary,
    fontSize: 13,
  },
  clipboardBannerActions: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  clipboardBannerCloseBtn: {
    borderRadius: 14,
    paddingHorizontal: spacing[3],
    paddingVertical: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 1,
    borderColor: palette.border,
  },
  clipboardBannerCloseBtnText: {
    color: palette.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  clipboardBannerSaveBtn: {
    borderRadius: 14,
    paddingHorizontal: spacing[4],
    paddingVertical: 8,
    backgroundColor: '#3b82f6',
  },
  clipboardBannerSaveBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  rawInputScrollView: {
    maxHeight: 120,
    backgroundColor: 'rgba(0, 0, 0, 0.22)',
    borderRadius: 14,
    padding: spacing[3],
    borderWidth: 1,
    borderColor: palette.border,
  },
  detailRawInputText: {
    color: palette.textSecondary,
    fontSize: 13,
    lineHeight: 20,
  },
  noteInputRow: {
    flexDirection: 'row',
    gap: spacing[2],
    alignItems: 'stretch',
  },
  noteInput: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.22)',
    borderRadius: 14,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    color: palette.textPrimary,
    fontSize: 13,
    minHeight: 44,
    borderWidth: 1,
    borderColor: palette.border,
  },
  noteSaveButton: {
    backgroundColor: palette.accent,
    borderRadius: 14,
    paddingHorizontal: spacing[4],
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: palette.accent,
    shadowOpacity: 0.25,
    shadowRadius: 10,
  },
  noteSaveButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  extractedUrlsList: {
    gap: spacing[2],
  },
  urlClickableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    backgroundColor: 'rgba(59, 130, 246, 0.05)',
    borderRadius: 14,
    paddingHorizontal: spacing[3],
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.16)',
  },
  urlClickableNum: {
    color: palette.accentStrong,
    fontSize: 12,
    fontWeight: '800',
  },
  urlClickableText: {
    flex: 1,
    color: '#60a5fa',
    fontSize: 13,
    fontWeight: '700',
  },
  hero: {
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: '#0f111a',
    borderRadius: 32,
    padding: spacing[7],
    gap: spacing[6],
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  heroGlowLarge: {
    position: 'absolute',
    right: -50,
    top: -30,
    width: 250,
    height: 250,
    borderRadius: 999,
    backgroundColor: '#8b5cf6',
    opacity: 0.18,
    shadowColor: '#8b5cf6',
    shadowRadius: 100,
    shadowOpacity: 0.6,
  },
  heroGlowSmall: {
    position: 'absolute',
    left: -40,
    bottom: -40,
    width: 160,
    height: 160,
    borderRadius: 999,
    backgroundColor: '#ec4899',
    opacity: 0.18,
    shadowColor: '#ec4899',
    shadowRadius: 80,
    shadowOpacity: 0.6,
  },
  heroHeader: {
    gap: spacing[3],
  },
  eyebrow: {
    color: '#a78bfa',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  title: {
    color: palette.textPrimary,
    fontSize: 38,
    lineHeight: 44,
    fontWeight: '900',
    maxWidth: 540,
  },
  description: {
    color: palette.textSecondary,
    fontSize: 15,
    lineHeight: 24,
    maxWidth: 560,
  },
  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    borderRadius: 18,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.25)',
  },
  toastDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: palette.success,
  },
  toastText: {
    flex: 1,
    color: palette.success,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  syncInfoBanner: {
    backgroundColor: 'rgba(251, 191, 36, 0.08)',
    borderRadius: 18,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.25)',
  },
  syncInfoText: {
    color: '#fbbf24',
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
  },
  metricCard: {
    flexGrow: 1,
    minWidth: 160,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 22,
    padding: spacing[4],
    gap: spacing[1],
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  metricLabel: {
    color: palette.textMuted,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  metricValue: {
    color: palette.textPrimary,
    fontSize: 26,
    lineHeight: 30,
    fontWeight: '800',
  },
  metricHelper: {
    color: palette.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  workspace: {
    gap: spacing[6],
  },
  workspaceWide: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  leftColumn: {
    gap: spacing[6],
  },
  leftColumnWide: {
    flex: 0.92,
  },
  rightColumn: {
    gap: spacing[6],
  },
  rightColumnWide: {
    flex: 1.08,
  },
  composerCard: {
    backgroundColor: 'rgba(20, 23, 36, 0.65)',
    borderRadius: 28,
    padding: spacing[6],
    gap: spacing[5],
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
  },
  guidanceCard: {
    backgroundColor: 'rgba(20, 23, 36, 0.45)',
    borderRadius: 28,
    padding: spacing[6],
    gap: spacing[4],
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
  },
  panel: {
    backgroundColor: 'rgba(20, 23, 36, 0.65)',
    borderRadius: 28,
    padding: spacing[6],
    gap: spacing[5],
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
  },
  panelHeader: {
    gap: spacing[2],
  },
  panelEyebrow: {
    color: '#a78bfa',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  panelTitle: {
    color: palette.textPrimary,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '800',
  },
  panelDescription: {
    color: palette.textSecondary,
    fontSize: 14,
    lineHeight: 22,
  },
  panelTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing[3],
  },
  sectionTitle: {
    color: palette.textPrimary,
    fontSize: 22,
    fontWeight: '800',
  },
  sectionMeta: {
    color: palette.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  tipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: spacing[3],
    paddingVertical: 6,
  },
  chipAccent: {
    backgroundColor: palette.accent,
  },
  chipNeutral: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  chipText: {
    fontSize: 12,
    fontWeight: '800',
  },
  chipAccentText: {
    color: '#ffffff',
  },
  chipNeutralText: {
    color: palette.textSecondary,
  },
  inputShell: {
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    borderRadius: 24,
    padding: spacing[4],
    gap: spacing[3],
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
  },
  inputLabel: {
    color: palette.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  input: {
    minHeight: 56,
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderRadius: 18,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    color: palette.textPrimary,
    fontSize: 15,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  shareImportBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    backgroundColor: 'rgba(251, 191, 36, 0.08)',
    borderRadius: 16,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.25)',
  },
  shareImportText: {
    flex: 1,
    color: '#fbbf24',
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
  },
  quickLinkRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  quickLink: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 999,
    paddingHorizontal: spacing[3],
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  quickLinkText: {
    color: palette.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing[3],
  },
  shareHintCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderRadius: 18,
    padding: spacing[4],
    gap: spacing[2],
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
  },
  shareHintTitle: {
    color: palette.textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
  shareHintText: {
    color: palette.textSecondary,
    fontSize: 13,
    lineHeight: 20,
  },
  button: {
    borderRadius: 18,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    minWidth: 132,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    flex: 1,
    backgroundColor: palette.accent,
    shadowColor: palette.accent,
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  secondaryButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  disabledButton: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  secondaryButtonText: {
    color: palette.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  checklist: {
    gap: spacing[3],
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
    backgroundColor: '#a78bfa',
    shadowColor: '#a78bfa',
    shadowRadius: 4,
    shadowOpacity: 0.7,
  },
  checkText: {
    flex: 1,
    color: palette.textSecondary,
    fontSize: 14,
    lineHeight: 22,
  },
  cardList: {
    gap: spacing[3],
  },
  card: {
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
  },
  cardSelected: {
    borderColor: 'rgba(139, 92, 246, 0.4)',
    backgroundColor: 'rgba(139, 92, 246, 0.04)',
    shadowColor: '#8b5cf6',
    shadowOpacity: 0.15,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  cardHighlighted: {
    transform: [{ scale: 1.01 }],
    borderColor: palette.success,
  },
  cardAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 6,
    backgroundColor: '#8b5cf6',
  },
  cardAccentAlt: {
    backgroundColor: '#a78bfa',
  },
  cardContent: {
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[5],
    paddingLeft: spacing[6],
  },
  cardRow: {
    flexDirection: 'row',
    gap: spacing[4],
    alignItems: 'stretch',
  },
  cardTextColumn: {
    flex: 1,
    gap: spacing[2],
  },
  cardMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing[3],
  },
  cardSource: {
    flex: 1,
    color: palette.textMuted,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  cardTitle: {
    color: palette.textPrimary,
    fontSize: 19,
    lineHeight: 25,
    fontWeight: '800',
  },
  cardSummary: {
    color: palette.textSecondary,
    fontSize: 14,
    lineHeight: 21,
  },
  cardTimestamp: {
    color: palette.textMuted,
    fontSize: 12,
    fontWeight: '600',
    paddingTop: spacing[1],
  },
  cardThumbnail: {
    width: 88,
    height: 88,
    borderRadius: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  cardThumbnailPlaceholder: {
    width: 88,
    height: 88,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
  },
  cardThumbnailPlaceholderText: {
    color: palette.accentStrong,
    fontSize: 18,
    fontWeight: '900',
  },
  pendingBadge: {
    backgroundColor: 'rgba(251, 191, 36, 0.1)',
    borderRadius: 999,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
  },
  pendingBadgeCompact: {
    paddingHorizontal: spacing[2],
  },
  pendingBadgeText: {
    color: '#fbbf24',
    fontSize: 12,
    fontWeight: '800',
  },
  loadingCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderRadius: 24,
    padding: spacing[6],
    gap: spacing[3],
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
  },
  loadingText: {
    color: palette.textSecondary,
    fontSize: 14,
  },
  initErrorCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderRadius: 24,
    padding: spacing[6],
    gap: spacing[3],
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  initErrorTitle: {
    color: palette.textPrimary,
    fontSize: 18,
    fontWeight: '800',
  },
  initErrorDescription: {
    color: palette.textSecondary,
    fontSize: 14,
    lineHeight: 22,
  },
  emptyState: {
    backgroundColor: 'rgba(255, 255, 255, 0.01)',
    borderRadius: 24,
    padding: spacing[6],
    gap: spacing[3],
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  emptyTitle: {
    color: palette.textPrimary,
    fontSize: 18,
    fontWeight: '800',
  },
  emptyDescription: {
    color: palette.textSecondary,
    fontSize: 14,
    lineHeight: 22,
  },
  detailCard: {
    gap: spacing[4],
  },
  detailHero: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderRadius: 24,
    padding: spacing[5],
    gap: spacing[3],
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  detailHeroText: {
    gap: spacing[2],
  },
  detailTitle: {
    color: palette.textPrimary,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '900',
  },
  detailSource: {
    color: palette.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
  },
  thumbnailPanel: {
    gap: spacing[2],
  },
  thumbnailPreview: {
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    borderRadius: 20,
    padding: spacing[4],
    gap: spacing[2],
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  thumbnailImage: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 14,
    backgroundColor: '#000000',
  },
  thumbnailTitle: {
    color: palette.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  thumbnailUrl: {
    color: palette.textSecondary,
    fontSize: 13,
    lineHeight: 20,
  },
  thumbnailEmptyText: {
    color: palette.textSecondary,
    fontSize: 13,
    lineHeight: 20,
  },
  metaBlock: {
    flexGrow: 1,
    minWidth: 140,
    backgroundColor: palette.surface,
    borderRadius: 18,
    padding: spacing[4],
    gap: spacing[1],
    borderWidth: 1,
    borderColor: palette.border,
  },
  metaLabel: {
    color: palette.textMuted,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  metaValue: {
    color: palette.textPrimary,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  detailSection: {
    gap: spacing[2],
  },
  detailLabel: {
    color: palette.textMuted,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
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
    gap: spacing[3],
    borderWidth: 1,
    borderColor: palette.border,
  },
  detailEmptyTitle: {
    color: palette.textPrimary,
    fontSize: 18,
    fontWeight: '800',
  },
  detailEmptyText: {
    color: palette.textSecondary,
    fontSize: 14,
    lineHeight: 22,
  },
  errorBanner: {
    backgroundColor: palette.dangerSoft,
    borderRadius: 18,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderWidth: 1,
    borderColor: '#d9857a',
  },
  errorText: {
    color: palette.dangerText,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '700',
  },
});
