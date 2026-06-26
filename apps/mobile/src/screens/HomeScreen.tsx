import * as Clipboard from 'expo-clipboard';
import { useShareIntentContext } from 'expo-share-intent';
import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  ActivityIndicator,
  AppState,
  AppStateStatus,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SavedItem } from '@/features/items/types';
import {
  buildShareIntentSignature,
  getSharedInputValue,
  hasUnsupportedSharedFiles,
} from '@/features/capture/shareIntent';
import { useAppStore } from '@/store';
import { palette } from '@/theme/palette';
import { spacing } from '@/theme/spacing';

import { ItemCard } from '@/components/ItemCard';
import { SearchFilterBar } from '@/components/SearchFilterBar';
import { CaptureModal, CaptureFloatingButton } from '@/components/CaptureModal';
import { DetailScreen, DetailContent } from '@/components/DetailScreen';
import {
  buildCaptureNotice,
  CaptureNotice,
  describeInputCandidate,
  filterItems,
  getSourceTheme,
  formatRelativeTime,
} from '@/utils/formatters';

export function HomeScreen() {
  const { width } = useWindowDimensions();
  const isWideLayout = width >= 940;

  // Store
  const isReady = useAppStore((s) => s.isReady);
  const isInitializing = useAppStore((s) => s.isInitializing);
  const isSaving = useAppStore((s) => s.isSaving);
  const items = useAppStore((s) => s.items);
  const selectedItemId = useAppStore((s) => s.selectedItemId);
  const errorMessage = useAppStore((s) => s.errorMessage);
  const syncQueuePendingCount = useAppStore((s) => s.syncQueuePendingCount);
  const syncWorkerMessage = useAppStore((s) => s.syncWorkerMessage);
  const isSyncWorkerRunning = useAppStore((s) => s.isSyncWorkerRunning);
  const saveUrl = useAppStore((s) => s.saveUrl);
  const selectItem = useAppStore((s) => s.selectItem);
  const clearError = useAppStore((s) => s.clearError);
  const deleteItem = useAppStore((s) => s.deleteItem);

  // Share intent
  const { hasShareIntent, shareIntent, resetShareIntent, error: shareIntentError } =
    useShareIntentContext();

  // Local state
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('');
  const [activeKeyword, setActiveKeyword] = useState('');
  const [isCaptureVisible, setIsCaptureVisible] = useState(false);

  const handleCategoryChange = useCallback((cat: string) => {
    setActiveCategory(cat);
    setActiveKeyword('');
  }, []);
  const [isDetailVisible, setIsDetailVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [captureNotice, setCaptureNotice] = useState<CaptureNotice | null>(null);
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);
  const [clipboardCandidate, setClipboardCandidate] = useState<string | null>(null);
  const [captureInitialValue, setCaptureInitialValue] = useState('');

  // 체크리스트 상태
  const [checkedItems, setCheckedItems] = useState<Record<string, Record<string, boolean>>>({});

  useEffect(() => {
    try {
      if (Platform.OS === 'web') {
        const saved = localStorage.getItem('ai_memo_checked_items');
        if (saved) setCheckedItems(JSON.parse(saved));
      }
    } catch (e) {
      console.log('Failed to load checked items', e);
    }
  }, []);

  const handleToggleCheck = useCallback((itemId: string, key: string) => {
    setCheckedItems((prev) => {
      const itemChecked = prev[itemId] || {};
      const next = { ...prev, [itemId]: { ...itemChecked, [key]: !itemChecked[key] } };
      try {
        if (Platform.OS === 'web') {
          localStorage.setItem('ai_memo_checked_items', JSON.stringify(next));
        }
      } catch (e) {
        console.log('Failed to save checked items', e);
      }
      return next;
    });
  }, []);

  // 공유 인텐트 refs
  const processedShareSignatureRef = useRef<string | null>(null);
  const ignoredClipboardRef = useRef<string | null>(null);

  const selectedItem = items.find((item) => item.id === selectedItemId) ?? items[0] ?? null;
  const runtimeErrorMessage = errorMessage ?? shareIntentError ?? null;

  // 필터링
  const filteredItems = useMemo(
    () => filterItems(items, searchQuery, activeCategory, activeKeyword),
    [items, searchQuery, activeCategory, activeKeyword]
  );

  // ==========================================
  // 클립보드 감지
  // ==========================================
  useEffect(() => {
    void checkClipboard();
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active') void checkClipboard();
    });
    return () => sub.remove();
  }, [items]);

  async function checkClipboard() {
    try {
      const text = await Clipboard.getStringAsync();
      const trimmed = text.trim();
      if (!trimmed) { setClipboardCandidate(null); return; }
      if (ignoredClipboardRef.current === trimmed) { setClipboardCandidate(null); return; }
      if (items.length > 0 && items[0].rawInput === trimmed) { setClipboardCandidate(null); return; }

      const urlRegex = /(https?:\/\/[^\s]+)/g;
      const isUrl = urlRegex.test(trimmed);
      const isLongText = trimmed.length >= 20;

      if (isUrl || isLongText) {
        setClipboardCandidate(trimmed);
      } else {
        setClipboardCandidate(null);
      }
    } catch {
      setClipboardCandidate(null);
    }
  }

  // ==========================================
  // 공유 인텐트 처리
  // ==========================================
  useEffect(() => {
    if (!hasShareIntent) {
      processedShareSignatureRef.current = null;
      return;
    }

    const sharedInput = getSharedInputValue(shareIntent);
    const currentSignature = buildShareIntentSignature(shareIntent);

    if (hasUnsupportedSharedFiles(shareIntent)) {
      if (processedShareSignatureRef.current === currentSignature) return;
      processedShareSignatureRef.current = currentSignature;
      setToastMessage('파일 공유는 지원되지 않으며 링크 공유만 가능합니다.');
      resetShareIntent();
      return;
    }

    if (!sharedInput) return;
    if (processedShareSignatureRef.current === currentSignature) return;

    processedShareSignatureRef.current = currentSignature;
    clearError();

    // 공유 인텐트가 오면 자동으로 저장
    void (async () => {
      const result = await saveUrl(sharedInput);
      if (result.ok) {
        const nextId = useAppStore.getState().selectedItemId;
        const savedItem = useAppStore.getState().items.find((i) => i.id === nextId) ?? null;
        setToastMessage('수집함에 저장됨');
        setCaptureNotice(buildCaptureNotice(savedItem, sharedInput, 'share'));
        if (nextId) setHighlightedItemId(nextId);
      }
      resetShareIntent();
    })();
  }, [clearError, hasShareIntent, resetShareIntent, saveUrl, shareIntent]);

  // ==========================================
  // 토스트/하이라이트 자동 해제
  // ==========================================
  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(null), 2400);
    return () => clearTimeout(t);
  }, [toastMessage]);

  useEffect(() => {
    if (!highlightedItemId) return;
    const t = setTimeout(() => setHighlightedItemId(null), 2600);
    return () => clearTimeout(t);
  }, [highlightedItemId]);

  // ==========================================
  // 핸들러
  // ==========================================
  function handleSelectItem(itemId: string) {
    selectItem(itemId);
    if (!isWideLayout) setIsDetailVisible(true);
  }

  async function handleSaveFromCapture(input: string) {
    const result = await saveUrl(input);
    if (result.ok) {
      const nextId = useAppStore.getState().selectedItemId;
      const savedItem = useAppStore.getState().items.find((i) => i.id === nextId) ?? null;
      setToastMessage('수집함에 저장됨');
      setCaptureNotice(buildCaptureNotice(savedItem, input, 'manual'));
      if (nextId) {
        setHighlightedItemId(nextId);
        if (!isWideLayout) setIsDetailVisible(true);
      }
    }
    return result;
  }

  async function handleSaveClipboard() {
    if (!clipboardCandidate) return;
    const result = await saveUrl(clipboardCandidate, 'clipboard');
    if (result.ok) {
      const nextId = useAppStore.getState().selectedItemId;
      const savedItem = useAppStore.getState().items.find((i) => i.id === nextId) ?? null;
      setToastMessage('수집함에 저장됨');
      setCaptureNotice(buildCaptureNotice(savedItem, clipboardCandidate, 'clipboard'));
      if (nextId) setHighlightedItemId(nextId);
      setClipboardCandidate(null);
    }
  }

  function handleIgnoreClipboard() {
    if (clipboardCandidate) ignoredClipboardRef.current = clipboardCandidate;
    setClipboardCandidate(null);
  }

  function handlePreviewClipboard() {
    if (!clipboardCandidate) return;
    setCaptureInitialValue(clipboardCandidate);
    setIsCaptureVisible(true);
    setClipboardCandidate(null);
  }

  function handleOpenCaptureNotice() {
    const itemId = captureNotice?.itemId;
    if (!itemId) return;
    selectItem(itemId);
    if (!isWideLayout) setIsDetailVisible(true);
  }

  function handleDeleteItem(itemId: string) {
    if (Platform.OS === 'web') {
      const confirmed = window.confirm('이 항목을 정말 삭제하시겠습니까?');
      if (confirmed) {
        void deleteItem(itemId);
        setIsDetailVisible(false);
      }
      return;
    }

    Alert.alert(
      '삭제 확인',
      '이 항목을 정말 삭제하시겠습니까?',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: () => {
            void deleteItem(itemId);
            setIsDetailVisible(false);
          },
        },
      ]
    );
  }

  // ==========================================
  // 리스트 렌더링
  // ==========================================
  const renderItem = useCallback(
    ({ item }: { item: SavedItem }) => {
      const theme = getSourceTheme(item.sourceType);
      return (
        <Pressable
          onPress={() => handleSelectItem(item.id)}
          style={({ pressed }) => [
            styles.card,
            item.id === selectedItem?.id && styles.cardSelected,
            item.id === highlightedItemId && styles.cardHighlighted,
            { transform: [{ scale: pressed ? 0.98 : 1 }] },
          ]}
        >
          <View
            style={[
              styles.cardAccent,
              {
                backgroundColor: theme.badgeText,
                opacity: item.id === selectedItem?.id ? 1 : 0.45,
              },
            ]}
          />
          <ItemCard item={item} />
        </Pressable>
      );
    },
    [selectedItem?.id, highlightedItemId]
  );

  const keyExtractor = useCallback((item: SavedItem) => item.id, []);

  // ==========================================
  // 렌더링
  // ==========================================
  return (
    <SafeAreaView style={styles.safeArea}>
      {/* 에러 배너 (상단 고정) */}
      {runtimeErrorMessage ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{runtimeErrorMessage}</Text>
          <Pressable onPress={clearError} style={styles.errorDismiss}>
            <Text style={styles.errorDismissText}>✕</Text>
          </Pressable>
        </View>
      ) : null}

      {/* 헤더 */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerLogo}>AI MEMO</Text>
        </View>
        <View style={styles.headerRight}>
          <View style={styles.syncIndicator}>
            <View
              style={[
                styles.syncDot,
                isSyncWorkerRunning && styles.syncDotActive,
                syncQueuePendingCount > 0 && styles.syncDotPending,
              ]}
            />
            <Text style={styles.syncText}>
              {isSyncWorkerRunning
                ? '동기화 중'
                : syncQueuePendingCount
                  ? `${syncQueuePendingCount}건 대기`
                  : '준비됨'}
            </Text>
          </View>
        </View>
      </View>

      {/* 토스트 */}
      {toastMessage ? (
        <View style={styles.toast}>
          <View style={styles.toastDot} />
          <Text style={styles.toastText}>{toastMessage}</Text>
        </View>
      ) : null}

      {/* 동기화 정보 배너 */}
      {syncWorkerMessage ? (
        <View style={styles.syncInfoBanner}>
          <Text style={styles.syncInfoText}>{syncWorkerMessage}</Text>
        </View>
      ) : null}

      {/* 클립보드 배너 */}
      {clipboardCandidate ? (
        <View style={styles.clipboardBanner}>
          <View style={styles.clipboardLeft}>
            <View style={styles.clipboardDot} />
            <View style={styles.clipboardTextCol}>
              <Text style={styles.clipboardTitle}>복사한 내용 저장할까요?</Text>
              <Text style={styles.clipboardMeta}>{describeInputCandidate(clipboardCandidate)}</Text>
            </View>
          </View>
          <View style={styles.clipboardActions}>
            <Pressable onPress={handleIgnoreClipboard} style={styles.clipboardBtn}>
              <Text style={styles.clipboardBtnText}>무시</Text>
            </Pressable>
            <Pressable onPress={handlePreviewClipboard} style={styles.clipboardBtnPreview}>
              <Text style={styles.clipboardBtnPreviewText}>미리보기</Text>
            </Pressable>
            <Pressable onPress={handleSaveClipboard} style={styles.clipboardBtnSave}>
              <Text style={styles.clipboardBtnSaveText}>저장</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* 캡처 확인 카드 */}
      {captureNotice ? (
        <View style={styles.captureNotice}>
          <View style={styles.captureNoticeRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.captureNoticeEyebrow}>
                {captureNotice.source === 'share' ? '공유 저장' : captureNotice.source === 'clipboard' ? '클립보드 저장' : '직접 저장'}
              </Text>
              <Text style={styles.captureNoticeTitle}>{captureNotice.title}</Text>
            </View>
            <Pressable onPress={() => setCaptureNotice(null)} style={styles.captureNoticeClose}>
              <Text style={styles.captureNoticeCloseText}>닫기</Text>
            </Pressable>
          </View>
          <Pressable
            disabled={!captureNotice.itemId}
            onPress={handleOpenCaptureNotice}
            style={({ pressed }) => [
              styles.captureNoticeOpenBtn,
              !captureNotice.itemId && { opacity: 0.4 },
              { transform: [{ scale: pressed ? 0.96 : 1 }] },
            ]}
          >
            <Text style={styles.captureNoticeOpenBtnText}>열기</Text>
          </Pressable>
        </View>
      ) : null}

      {/* 메인 콘텐츠 */}
      <View style={[styles.mainContent, isWideLayout && styles.mainContentWide]}>
        {/* 좌측: 리스트 */}
        <View style={[styles.listColumn, isWideLayout && styles.listColumnWide]}>
          {/* 통합 검색 + 필터 칩 바 */}
          <View style={styles.filterArea}>
            <SearchFilterBar
              items={items}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              activeCategory={activeCategory}
              onCategoryChange={handleCategoryChange}
              activeKeyword={activeKeyword}
              onKeywordChange={setActiveKeyword}
            />
          </View>

          <View style={styles.listHeader}>
            <Text style={styles.listTitle}>수집함</Text>
            <Text style={styles.listCount}>{filteredItems.length}건</Text>
          </View>

          {isInitializing ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator color={palette.accent} />
              <Text style={styles.loadingText}>로딩 중...</Text>
            </View>
          ) : filteredItems.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>
                {items.length === 0 ? '수집함이 비어 있습니다' : '검색 결과가 없습니다'}
              </Text>
              <Text style={styles.emptyDesc}>
                {items.length === 0
                  ? '오른쪽 하단 + 버튼을 눌러 링크나 텍스트를 저장해보세요.'
                  : '다른 키워드로 검색하거나 필터를 변경해보세요.'}
              </Text>
            </View>
          ) : (
            <FlatList
              data={filteredItems}
              renderItem={renderItem}
              keyExtractor={keyExtractor}
              contentContainerStyle={styles.cardList}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>

        {/* 우측: 태블릿/웹 인라인 상세 */}
        {isWideLayout && (
          <View style={styles.detailColumn}>
            <View style={styles.detailPanel}>
              <View style={styles.detailPanelHeader}>
                <Text style={styles.listTitle}>상세</Text>
                <Text style={styles.listCount}>
                  {selectedItem ? formatRelativeTime(selectedItem.createdAt) : '선택 없음'}
                </Text>
              </View>
              {selectedItem ? (
                <DetailContent
                  selectedItem={selectedItem}
                  checkedItems={checkedItems}
                  onToggleCheck={handleToggleCheck}
                  onDelete={handleDeleteItem}
                />
              ) : (
                <View style={styles.detailEmpty}>
                  <Text style={styles.detailEmptyTitle}>선택된 항목이 없습니다</Text>
                  <Text style={styles.detailEmptyText}>
                    좌측 리스트에서 항목을 선택하면 상세 정보를 확인할 수 있습니다.
                  </Text>
                </View>
              )}
            </View>
          </View>
        )}
      </View>

      {/* FAB */}
      <CaptureFloatingButton onPress={() => {
        setCaptureInitialValue('');
        setIsCaptureVisible(true);
      }} />

      {/* 캡처 모달 */}
      <CaptureModal
        visible={isCaptureVisible}
        onClose={() => setIsCaptureVisible(false)}
        onSave={handleSaveFromCapture}
        isSaving={isSaving}
        initialValue={captureInitialValue}
      />

      {/* 모바일 상세 오버레이 */}
      {!isWideLayout && isDetailVisible && selectedItem && (
        <DetailScreen
          item={selectedItem}
          checkedItems={checkedItems}
          onToggleCheck={handleToggleCheck}
          onClose={() => setIsDetailVisible(false)}
          onDelete={handleDeleteItem}
        />
      )}
    </SafeAreaView>
  );
}

// ==========================================
// 스타일
// ==========================================
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: palette.background,
  },
  // 에러 배너 (상단 고정)
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.dangerSoft,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
    gap: spacing[3],
  },
  errorText: {
    flex: 1,
    color: palette.dangerText,
    fontSize: 13,
    fontWeight: '700',
  },
  errorDismiss: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorDismissText: {
    color: palette.dangerText,
    fontSize: 10,
    fontWeight: '900',
  },
  // 헤더
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[5],
    paddingTop: spacing[3],
    paddingBottom: spacing[3],
    borderBottomWidth: 1,
    borderColor: palette.border,
  },
  headerLeft: {},
  headerLogo: {
    color: palette.textPrimary,
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  syncIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: palette.surface,
    paddingHorizontal: spacing[3],
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: palette.border,
  },
  syncDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: palette.success,
  },
  syncDotActive: { backgroundColor: '#8b5cf6' },
  syncDotPending: { backgroundColor: '#fbbf24' },
  syncText: {
    color: palette.textSecondary,
    fontSize: 10,
    fontWeight: '700',
  },
  // 토스트
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    backgroundColor: palette.successSoft,
    marginHorizontal: spacing[4],
    marginTop: spacing[2],
    borderRadius: 14,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
  },
  toastDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: palette.success,
  },
  toastText: {
    flex: 1,
    color: palette.success,
    fontSize: 13,
    fontWeight: '700',
  },
  syncInfoBanner: {
    backgroundColor: 'rgba(251, 191, 36, 0.08)',
    marginHorizontal: spacing[4],
    marginTop: spacing[2],
    borderRadius: 14,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.2)',
  },
  syncInfoText: {
    color: '#fbbf24',
    fontSize: 12,
    fontWeight: '700',
  },
  // 클립보드 배너
  clipboardBanner: {
    marginHorizontal: spacing[4],
    marginTop: spacing[2],
    backgroundColor: palette.surfaceRaised,
    borderRadius: 16,
    padding: spacing[3],
    borderWidth: 1,
    borderColor: palette.borderStrong,
    gap: spacing[2],
  },
  clipboardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
  },
  clipboardDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: palette.accentStrong,
  },
  clipboardTextCol: { flex: 1, gap: 1 },
  clipboardTitle: {
    color: palette.textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
  clipboardMeta: {
    color: palette.success,
    fontSize: 11,
    fontWeight: '800',
  },
  clipboardActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[2],
  },
  clipboardBtn: {
    borderRadius: 10,
    paddingHorizontal: spacing[3],
    paddingVertical: 6,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  clipboardBtnText: {
    color: palette.textSecondary,
    fontSize: 11,
    fontWeight: '800',
  },
  clipboardBtnPreview: {
    borderRadius: 10,
    paddingHorizontal: spacing[3],
    paddingVertical: 6,
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.28)',
  },
  clipboardBtnPreviewText: {
    color: '#93c5fd',
    fontSize: 11,
    fontWeight: '800',
  },
  clipboardBtnSave: {
    borderRadius: 10,
    paddingHorizontal: spacing[3],
    paddingVertical: 6,
    backgroundColor: palette.accent,
  },
  clipboardBtnSaveText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },
  // 캡처 확인 카드
  captureNotice: {
    marginHorizontal: spacing[4],
    marginTop: spacing[2],
    backgroundColor: palette.surfaceRaised,
    borderRadius: 14,
    padding: spacing[3],
    gap: spacing[2],
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.28)',
  },
  captureNoticeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  captureNoticeEyebrow: {
    color: palette.success,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  captureNoticeTitle: {
    color: palette.textPrimary,
    fontSize: 14,
    fontWeight: '900',
  },
  captureNoticeClose: {
    borderRadius: 10,
    paddingHorizontal: spacing[3],
    paddingVertical: 5,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  captureNoticeCloseText: {
    color: palette.textSecondary,
    fontSize: 11,
    fontWeight: '800',
  },
  captureNoticeOpenBtn: {
    alignSelf: 'flex-start',
    borderRadius: 10,
    paddingHorizontal: spacing[4],
    paddingVertical: 7,
    backgroundColor: palette.success,
  },
  captureNoticeOpenBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
  },
  // 메인
  mainContent: {
    flex: 1,
  },
  mainContentWide: {
    flexDirection: 'row',
  },
  // 리스트
  listColumn: {
    flex: 1,
  },
  listColumnWide: {
    flex: 0.45,
    borderRightWidth: 1,
    borderColor: palette.border,
  },
  filterArea: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: spacing[1],
  },
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
  },
  listTitle: {
    color: palette.textPrimary,
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  listCount: {
    color: palette.textMuted,
    fontSize: 12,
    fontWeight: '800',
  },
  cardList: {
    padding: spacing[4],
    paddingTop: 0,
    gap: 10,
    paddingBottom: 100,
  },
  card: {
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: palette.surfaceRaised,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
  },
  cardSelected: {
    backgroundColor: palette.surfaceStrong,
    borderColor: palette.accent,
  },
  cardHighlighted: {
    borderColor: palette.success,
  },
  cardAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    borderTopLeftRadius: 14,
    borderBottomLeftRadius: 14,
  },
  // 로딩/빈 상태
  loadingCard: {
    margin: spacing[4],
    backgroundColor: palette.surface,
    borderRadius: 20,
    padding: spacing[6],
    gap: spacing[3],
    alignItems: 'center',
    borderWidth: 1,
    borderColor: palette.border,
  },
  loadingText: {
    color: palette.textSecondary,
    fontSize: 13,
  },
  emptyState: {
    margin: spacing[4],
    backgroundColor: palette.surface,
    borderRadius: 20,
    padding: spacing[8],
    gap: spacing[2],
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: palette.borderStrong,
    alignItems: 'center',
  },
  emptyTitle: {
    color: palette.textPrimary,
    fontSize: 15,
    fontWeight: '900',
    textAlign: 'center',
  },
  emptyDesc: {
    color: palette.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    maxWidth: 260,
  },
  // 태블릿 상세 컬럼
  detailColumn: {
    flex: 0.55,
  },
  detailPanel: {
    flex: 1,
    padding: spacing[4],
    gap: spacing[3],
  },
  detailPanelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderColor: palette.border,
    paddingBottom: spacing[2],
  },
  detailEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
  },
  detailEmptyTitle: {
    color: palette.textPrimary,
    fontSize: 15,
    fontWeight: '900',
  },
  detailEmptyText: {
    color: palette.textSecondary,
    fontSize: 12,
    textAlign: 'center',
    maxWidth: 200,
  },
});
