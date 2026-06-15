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

const KEYWORD_EMOJIS: Record<string, string> = {
  // 요리 재료
  '감자': '🥔',
  '양파': '🧅',
  '베이컨': '🥓',
  '모짜렐라 치즈': '🧀',
  '체다 치즈': '🧀',
  '생크림': '🥛',
  '버터': '🧈',
  '소금': '🧂',
  '후추': '🧂',
  '치즈': '🧀',
  '계란': '🥚',
  '마늘': '🧄',
  
  // 운동 부위
  '하체': '🔥',
  '허벅지': '🦵',
  '둔근': '🍑',
  '둔근(엉덩이)': '🍑',
  '상체': '💪',
  '가슴': '🏋️‍♂️',
  '등': '💪',
  '복근': '🍫',
  '코어': '🧘',
  
  // 여행 테마 및 스팟
  '국내': '🇰🇷',
  '해외': '✈️',
  '호캉스': '🏨',
  '힐링 온천': '♨️',
  '강원도': '🌊',
  '강릉': '🌊',
  '제주': '🌴',
  '오션뷰': '🌊',
  '온천': '♨️',
};

const CATEGORY_TABS = [
  { label: '전체 🔍', value: 'all' },
  { label: '육아 👶', value: 'parenting' },
  { label: '여행 ✈️', value: 'travel' },
  { label: '요리 🍳', value: 'recipe' },
  { label: '운동 💪', value: 'workout' },
  { label: '기타 🏷️', value: 'other' },
];

type CaptureNotice = {
  itemId: string | null;
  source: 'share' | 'clipboard' | 'manual';
  title: string;
  description: string;
  preview: string;
  stateLabel: string;
};

function extractDynamicChips(items: SavedItem[]): Array<{ label: string; value: string }> {
  const counts: Record<string, number> = {};
  let hasRecipe = false;
  let hasWorkout = false;
  let hasTravel = false;

  items.forEach((item) => {
    const structured = tryParseStructuredContent(item.content);
    const category = structured?.category || item.sourceType;

    if (category === 'recipe') {
      hasRecipe = true;
      if (structured && structured.ingredients) {
        (structured.ingredients as string[]).forEach((ing) => {
          counts[ing] = (counts[ing] || 0) + 1;
        });
      }
    } else if (category === 'workout') {
      hasWorkout = true;
      if (structured && structured.targetMuscles) {
        (structured.targetMuscles as string[]).forEach((muscle) => {
          counts[muscle] = (counts[muscle] || 0) + 1;
        });
      }
    } else if (category === 'travel') {
      hasTravel = true;
      if (structured) {
        if (structured.travelTheme) {
          structured.travelTheme.split('/').map((t: string) => t.trim()).forEach((theme: string) => {
            counts[theme] = (counts[theme] || 0) + 1;
          });
        }
        if (structured.highlights) {
          (structured.highlights as string[]).forEach((h) => {
            counts[h] = (counts[h] || 0) + 1;
          });
        }
      }
    }
  });

  // 1. 기본 전체 및 고정 카테고리 조립
  const chips = [{ label: '전체 🔍', value: '' }];
  if (hasRecipe) chips.push({ label: '레시피 🍳', value: '레시피' });
  if (hasWorkout) chips.push({ label: '운동루틴 💪', value: '운동' });
  if (hasTravel) chips.push({ label: '여행정보 ✈', value: '여행' });

  // 2. 누적 빈도가 높은 순으로 상위 8개 키워드를 추출하여 해시태그 칩으로 이식
  const sortedKeywords = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([key]) => key);

  sortedKeywords.forEach((keyword) => {
    // 테마 명칭에 '국내', '해외', '호캉스'가 중복 노출되는 걸 가볍게 방지
    if (keyword === '국내' || keyword === '해외' || keyword === '호캉스') {
      return;
    }
    const emoji = KEYWORD_EMOJIS[keyword] || '🏷';
    chips.push({ label: `#${keyword} ${emoji}`, value: keyword });
  });

  return chips;
}

export function HomeScreen() {
  const scrollViewRef = useRef<ScrollView>(null);
  const [urlInput, setUrlInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [isPasting, setIsPasting] = useState(false);
  const [isImportingShare, setIsImportingShare] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [captureNotice, setCaptureNotice] = useState<CaptureNotice | null>(null);
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);
  
  // 모바일 좁은 화면 전용 바텀 시트 상세 모달 제어용 상태
  const [isDetailVisible, setIsDetailVisible] = useState(false);

  // 도메인 특화 체크리스트 상태 및 로컬스토리지 영속화
  const [checkedItems, setCheckedItems] = useState<Record<string, Record<string, boolean>>>({});

  useEffect(() => {
    try {
      if (Platform.OS === 'web') {
        const saved = localStorage.getItem('ai_memo_checked_items');
        if (saved) {
          setCheckedItems(JSON.parse(saved));
        }
      }
    } catch (e) {
      console.log('Failed to load checked items', e);
    }
  }, []);

  const handleToggleCheck = (itemId: string, key: string) => {
    setCheckedItems((prev) => {
      const itemChecked = prev[itemId] || {};
      const next = {
        ...prev,
        [itemId]: {
          ...itemChecked,
          [key]: !itemChecked[key],
        },
      };
      try {
        if (Platform.OS === 'web') {
          localStorage.setItem('ai_memo_checked_items', JSON.stringify(next));
        }
      } catch (e) {
        console.log('Failed to save checked items', e);
      }
      return next;
    });
  };

  const processedShareSignatureRef = useRef<string | null>(null);
  const ignoredClipboardRef = useRef<string | null>(null);
  const { width } = useWindowDimensions();
  const isReady = useAppStore((state) => state.isReady);
  const isInitializing = useAppStore((state) => state.isInitializing);
  const isSaving = useAppStore((state) => state.isSaving);
  const items = useAppStore((state) => state.items);
  const selectedItemId = useAppStore((state) => state.selectedItemId);
  const errorMessage = useAppStore((state) => state.errorMessage);
  const syncQueuePendingCount = useAppStore((state) => state.syncQueuePendingCount);
  const syncWorkerMessage = useAppStore((state) => state.syncWorkerMessage);
  const isSyncWorkerRunning = useAppStore((state) => state.isSyncWorkerRunning);
  const saveUrl = useAppStore((state) => state.saveUrl);
  const selectItem = useAppStore((state) => state.selectItem);
  const clearError = useAppStore((state) => state.clearError);
  const { hasShareIntent, shareIntent, resetShareIntent, error: shareIntentError } =
    useShareIntentContext();

  const selectedItem = items.find((item) => item.id === selectedItemId) ?? items[0] ?? null;
  const isWideLayout = width >= 940;
  const runtimeErrorMessage = errorMessage ?? shareIntentError ?? null;

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

      if (ignoredClipboardRef.current === trimmed) {
        setClipboardCandidate(null);
        return;
      }

      if (items.length > 0 && items[0].rawInput === trimmed) {
        setClipboardCandidate(null);
        return;
      }

      // 클립보드 피로도 감소를 위한 스마트 필터:
      // 1. 유효한 URL 형태이거나
      // 2. 일반 텍스트의 경우 글자 수가 20자 이상인 경우에만 수집 제안을 띄웁니다.
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

  async function handleSaveClipboard() {
    if (!clipboardCandidate) {
      return;
    }
    const result = await saveUrl(clipboardCandidate, 'clipboard');
    if (result.ok) {
      const nextSelectedItem = useAppStore.getState().selectedItemId;
      const savedItem = useAppStore.getState().items.find((item) => item.id === nextSelectedItem) ?? null;
      setToastMessage('수집함에 저장됨');
      setCaptureNotice(buildCaptureNotice(savedItem, clipboardCandidate, 'clipboard'));
      if (nextSelectedItem) {
        setHighlightedItemId(nextSelectedItem);
      }
      setClipboardCandidate(null);
    }
  }

  function handleIgnoreClipboard() {
    if (clipboardCandidate) {
      ignoredClipboardRef.current = clipboardCandidate;
    }
    setClipboardCandidate(null);
  }

  function handlePreviewClipboard() {
    if (!clipboardCandidate) {
      return;
    }
    setUrlInput(clipboardCandidate);
    setClipboardCandidate(null);
    scrollViewRef.current?.scrollTo({ y: 0, animated: true });
  }

  function handleOpenCaptureNotice() {
    const itemId = captureNotice?.itemId;
    if (!itemId) {
      return;
    }
    selectItem(itemId);
    if (!isWideLayout) {
      setIsDetailVisible(true);
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
      setToastMessage('파일 공유는 지원되지 않으며 링크 공유만 보존 가능합니다.');
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
        const savedItem = useAppStore.getState().items.find((item) => item.id === nextSelectedItem) ?? null;
        setUrlInput('');
        setToastMessage('수집함에 저장됨');
        setCaptureNotice(buildCaptureNotice(savedItem, sharedInput, 'share'));
        if (nextSelectedItem) {
          setHighlightedItemId(nextSelectedItem);
        }
      }

      resetShareIntent();
      setIsImportingShare(false);
    })();
  }, [clearError, hasShareIntent, resetShareIntent, saveUrl, shareIntent]);

  async function handleSave() {
    if (!urlInput.trim()) {
      return;
    }
    const result = await saveUrl(urlInput);

    if (result.ok) {
      const nextSelectedItem = useAppStore.getState().selectedItemId;
      const savedItem = useAppStore.getState().items.find((item) => item.id === nextSelectedItem) ?? null;
      setUrlInput('');
      setToastMessage('수집함에 저장됨');
      setCaptureNotice(buildCaptureNotice(savedItem, urlInput, 'manual'));
      if (nextSelectedItem) {
        setHighlightedItemId(nextSelectedItem);
        if (!isWideLayout) {
          setIsDetailVisible(true);
        }
      }
    }
  }

  function handleSelectItem(itemId: string) {
    selectItem(itemId);
    if (!isWideLayout) {
      setIsDetailVisible(true);
    }
  }

  // ==========================================
  // 도메인 구조화 정보 검색 필터링 로직 구현
  // ==========================================
  const filteredItems = items.filter((item) => {
    // 1. 카테고리 고정 탭 필터링 연동
    if (selectedCategory !== 'all') {
      const itemCat = getItemCategory(item);
      if (itemCat !== selectedCategory) {
        return false;
      }
    }

    // 2. 검색어 필터링 연동
    if (!searchQuery.trim()) {
      return true;
    }
    const query = searchQuery.toLowerCase().trim();

    // 1. 기본 제목 및 메모 본문 검색
    if (item.title.toLowerCase().includes(query) || (item.userNote && item.userNote.toLowerCase().includes(query))) {
      return true;
    }

    // 2. 구조화 정보 내부 검색 (요리 재료, 운동 부위, 여행지)
    const structured = tryParseStructuredContent(item.content);
    
    // 3. 지능형 자연어 도메인 매핑 검색
    const category = structured?.category || item.sourceType;
    if (category) {
      if ((query === '요리' || query === '레시피') && category === 'recipe') return true;
      if ((query === '운동' || query === '헬스' || query === '홈트') && category === 'workout') return true;
      if ((query === '여행' || query === '호캉스') && category === 'travel') return true;
    }

    if (structured) {
      // 요리 레시피 재료 스캔 (ex: '감자' 검색 시 감자 그라탕 레시피 필터 노출)
      if (structured.category === 'recipe' && structured.ingredients) {
        return (structured.ingredients as string[]).some((ing) => ing.toLowerCase().includes(query));
      }
      // 운동 타겟 부위 스캔 (ex: '하체' 검색 시 홈트 루틴 필터 노출)
      if (structured.category === 'workout' && structured.targetMuscles) {
        return (structured.targetMuscles as string[]).some((muscle) => muscle.toLowerCase().includes(query));
      }
      // 여행지 테마 및 세부 장소 스캔
      if (structured.category === 'travel') {
        if (structured.location && structured.location.toLowerCase().includes(query)) return true;
        if (structured.travelTheme && structured.travelTheme.toLowerCase().includes(query)) return true;
        if (structured.highlights) {
          return (structured.highlights as string[]).some((h) => h.toLowerCase().includes(query));
        }
        if (structured.checklist) {
          return (structured.checklist as string[]).some((c) => c.toLowerCase().includes(query));
        }
      }
    }

    return false;
  });

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* 초미니멀 럭셔리 헤더 */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerEyebrow}>KNOWLEDGE INBOX</Text>
          <Text style={styles.headerLogo}>AI MEMO</Text>
        </View>
        <View style={styles.headerRight}>
          <View style={styles.syncIndicator}>
            <View style={[
              styles.syncPulseDot,
              isSyncWorkerRunning && styles.syncPulseDotActive,
              syncQueuePendingCount > 0 && styles.syncPulseDotPending
            ]} />
            <Text style={styles.syncIndicatorText}>
              {isSyncWorkerRunning 
                ? '동기화 중...' 
                : syncQueuePendingCount 
                  ? `${syncQueuePendingCount}건 대기` 
                  : '저장 준비됨'}
            </Text>
          </View>
        </View>
      </View>

      <ScrollView 
        ref={scrollViewRef}
        contentContainerStyle={styles.content} 
        showsVerticalScrollIndicator={false}
      >
        {/* 네온 백그라운드 오라 글로우 데코레이션 */}
        <View style={styles.heroGlowLarge} />
        <View style={styles.heroGlowSmall} />

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
                <Text style={styles.clipboardBannerTitle}>복사한 내용 저장할까요?</Text>
                <Text style={styles.clipboardBannerMeta}>{describeInputCandidate(clipboardCandidate)}</Text>
                <Text style={styles.clipboardBannerDesc} numberOfLines={1}>
                  "{clipboardCandidate.replace(/\s+/g, ' ')}"
                </Text>
              </View>
            </View>
            <View style={styles.clipboardBannerActions}>
              <Pressable
                onPress={handleIgnoreClipboard}
                style={({ pressed }) => [
                  styles.clipboardBannerCloseBtn,
                  { transform: [{ scale: pressed ? 0.95 : 1 }] }
                ]}
              >
                <Text style={styles.clipboardBannerCloseBtnText}>무시</Text>
              </Pressable>
              <Pressable
                onPress={handlePreviewClipboard}
                style={({ pressed }) => [
                  styles.clipboardBannerPreviewBtn,
                  { transform: [{ scale: pressed ? 0.95 : 1 }] }
                ]}
              >
                <Text style={styles.clipboardBannerPreviewBtnText}>미리보기</Text>
              </Pressable>
              <Pressable
                onPress={handleSaveClipboard}
                style={({ pressed }) => [
                  styles.clipboardBannerSaveBtn,
                  { transform: [{ scale: pressed ? 0.95 : 1 }] }
                ]}
              >
                <Text style={styles.clipboardBannerSaveBtnText}>저장</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {captureNotice ? (
          <View style={styles.captureNotice}>
            <View style={styles.captureNoticeHeader}>
              <View style={styles.captureNoticeTitleColumn}>
                <Text style={styles.captureNoticeEyebrow}>
                  {captureNotice.source === 'share'
                    ? '공유로 저장'
                    : captureNotice.source === 'clipboard'
                      ? '클립보드 저장'
                      : '직접 저장'}
                </Text>
                <Text style={styles.captureNoticeTitle}>{captureNotice.title}</Text>
              </View>
              <Pressable
                onPress={() => setCaptureNotice(null)}
                style={({ pressed }) => [
                  styles.captureNoticeCloseBtn,
                  { transform: [{ scale: pressed ? 0.92 : 1 }] }
                ]}
              >
                <Text style={styles.captureNoticeCloseBtnText}>닫기</Text>
              </Pressable>
            </View>
            <Text style={styles.captureNoticeDescription}>{captureNotice.description}</Text>
            <Text style={styles.captureNoticePreview} numberOfLines={2}>
              {captureNotice.preview}
            </Text>
            <View style={styles.captureNoticeActions}>
              <Pressable
                disabled={!captureNotice.itemId}
                onPress={handleOpenCaptureNotice}
                style={({ pressed }) => [
                  styles.captureNoticePrimaryBtn,
                  !captureNotice.itemId && styles.captureNoticePrimaryBtnDisabled,
                  { transform: [{ scale: pressed ? 0.96 : 1 }] }
                ]}
              >
                <Text style={styles.captureNoticePrimaryBtnText}>열기</Text>
              </Pressable>
              <Text style={styles.captureNoticeState}>{captureNotice.stateLabel}</Text>
            </View>
          </View>
        ) : null}

        {/* 럭셔리 Floating-style 캡처 입력 바 */}
        <View style={styles.floatingComposer}>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            onChangeText={setUrlInput}
            placeholder="수집할 유튜브, 인스타, 노션 링크를 붙여넣으세요"
            placeholderTextColor={palette.textMuted}
            style={styles.floatingInput}
            value={urlInput}
          />
          {isImportingShare ? (
            <ActivityIndicator size="small" color={palette.accent} style={styles.floatingLoader} />
          ) : null}
          <Pressable 
            disabled={isSaving || isInitializing || !urlInput.trim()}
            onPress={handleSave} 
            style={({ pressed }) => [
              styles.floatingSaveBtn,
              (isSaving || isInitializing || !urlInput.trim()) && styles.floatingSaveBtnDisabled,
              { transform: [{ scale: pressed ? 0.96 : 1 }] }
            ]}
          >
            <Text style={styles.floatingSaveBtnText}>
              {isSaving ? '저장 중' : '저장'}
            </Text>
          </Pressable>
        </View>

        {/* 프리미엄 통합 스마트 재료/부위 검색 바 */}
        <View style={styles.floatingSearchShell}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setSearchQuery}
            placeholder="수집한 지식 제목, 요리 재료(예: 감자), 운동 부위 검색..."
            placeholderTextColor={palette.textMuted}
            style={styles.floatingSearchInput}
            value={searchQuery}
          />
          {searchQuery ? (
            <Pressable onPress={() => setSearchQuery('')} style={styles.searchClearBtn}>
              <Text style={styles.searchClearBtnText}>✕</Text>
            </Pressable>
          ) : null}
        </View>

        {/* 고정 카테고리 탭 (Fixed Category Tabs) */}
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false} 
          contentContainerStyle={styles.quickChipsContainer}
        >
          {CATEGORY_TABS.map((tab) => {
            const isActive = selectedCategory === tab.value;
            return (
              <Pressable
                key={tab.value}
                onPress={() => setSelectedCategory(tab.value)}
                style={({ pressed }) => [
                  styles.quickChip,
                  isActive && styles.quickChipActive,
                  { transform: [{ scale: pressed ? 0.94 : 1 }] }
                ]}
              >
                <Text style={[styles.quickChipText, isActive && styles.quickChipTextActive]}>
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={[styles.workspace, isWideLayout && styles.workspaceWide]}>
          <View style={[styles.leftColumn, isWideLayout && styles.leftColumnWide]}>
            <View style={styles.panel}>
              <View style={styles.panelTopRow}>
                <Text style={styles.sectionTitle}>수집된 Inbox 지식</Text>
                <Text style={styles.sectionMeta}>{filteredItems.length} items</Text>
              </View>

              {isInitializing ? (
                <View style={styles.loadingCard}>
                  <ActivityIndicator color={palette.accent} />
                  <Text style={styles.loadingText}>로컬 데이터를 불러오는 중입니다.</Text>
                </View>
              ) : filteredItems.length === 0 ? (
                <EmptyState />
              ) : (
                <View style={styles.cardList}>
                  {filteredItems.map((item) => {
                    const theme = getSourceTheme(item.sourceType);
                    return (
                      <Pressable
                        key={item.id}
                        onPress={() => handleSelectItem(item.id)}
                        style={({ pressed }) => [
                          styles.card,
                          item.id === selectedItem?.id && styles.cardSelected,
                          item.id === highlightedItemId && styles.cardHighlighted,
                          { transform: [{ scale: pressed ? 0.97 : 1 }] }
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
                  })}
                </View>
              )}
            </View>
          </View>

          {/* 태블릿/웹 전용 우측 분할 화면 상세뷰 */}
          {isWideLayout && (
            <View style={[styles.rightColumn, isWideLayout && styles.rightColumnWide]}>
              <View style={styles.panel}>
                <View style={styles.panelTopRow}>
                  <Text style={styles.sectionTitle}>선택한 지식 상세</Text>
                  <Text style={styles.sectionMeta}>
                    {selectedItem ? formatRelativeTime(selectedItem.createdAt) : '선택 없음'}
                  </Text>
                </View>

                {selectedItem ? (
                  <DetailContent 
                    selectedItem={selectedItem} 
                    checkedItems={checkedItems} 
                    onToggleCheck={handleToggleCheck} 
                  />
                ) : (
                  <DetailEmpty />
                )}
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      {/* 모바일 화면용 프리미엄 스윙 바텀 시트 */}
      {!isWideLayout && isDetailVisible && selectedItem && (
        <View style={styles.bottomSheetBackdrop}>
          <Pressable style={styles.backdropClickable} onPress={() => setIsDetailVisible(false)} />
          <View style={styles.bottomSheetContainer}>
            <View style={styles.bottomSheetHeader}>
              <View style={styles.bottomSheetHandle} />
              <Pressable 
                onPress={() => setIsDetailVisible(false)} 
                style={({ pressed }) => [
                  styles.bottomSheetCloseBtn,
                  { transform: [{ scale: pressed ? 0.85 : 1 }] }
                ]}
              >
                <Text style={styles.bottomSheetCloseBtnText}>✕</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.bottomSheetContent} showsVerticalScrollIndicator={false}>
              <DetailContent 
                selectedItem={selectedItem} 
                checkedItems={checkedItems} 
                onToggleCheck={handleToggleCheck} 
              />
            </ScrollView>
          </View>
        </View>
      )}

      {runtimeErrorMessage ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{runtimeErrorMessage}</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

// ==========================================
// 럭셔리 세부 정보 렌더링 서브 컴포넌트 (도메인 특화 템플릿 장착)
// ==========================================
function DetailContent({ 
  selectedItem,
  checkedItems,
  onToggleCheck,
}: { 
  selectedItem: SavedItem;
  checkedItems: Record<string, Record<string, boolean>>;
  onToggleCheck: (itemId: string, key: string) => void;
}) {
  const theme = getSourceTheme(selectedItem.sourceType);
  const [userNoteInput, setUserNoteInput] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isMetaExpanded, setIsMetaExpanded] = useState(false);
  const updateUserNote = useAppStore((state) => state.updateUserNote);
  const retryEnrichMetadata = useAppStore((state) => state.retryEnrichMetadata);
  const isSaving = useAppStore((state) => state.isSaving);

  useEffect(() => {
    setUserNoteInput(selectedItem.userNote ?? '');
  }, [selectedItem.id, selectedItem.userNote]);

  async function handleSaveUserNote() {
    await updateUserNote(selectedItem.id, userNoteInput);
    setToastMessage('메모가 저장되었습니다.');
  }

  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(null), 1800);
    return () => clearTimeout(t);
  }, [toastMessage]);

  const structured = tryParseStructuredContent(selectedItem.content);

  return (
    <View style={styles.detailCard}>
      {toastMessage ? (
        <View style={styles.toast}>
          <View style={styles.toastDot} />
          <Text style={styles.toastText}>{toastMessage}</Text>
        </View>
      ) : null}

      {/* 1. 헤더 히어로 영역 */}
      <View style={[styles.detailHero, { borderColor: theme.border, backgroundColor: theme.bg }]}>
        <View style={styles.detailHeroText}>
          <Text style={styles.detailTitle}>{selectedItem.title}</Text>
          <Text style={[styles.detailSource, { color: theme.badgeText, fontWeight: '700' }]}>
            {theme.label} · {selectedItem.sourceUrl ? getHostname(selectedItem.sourceUrl) : '로컬'}
          </Text>
        </View>
        <View style={styles.detailHeroActionsRow}>
          <StatusPills item={selectedItem} />
          {selectedItem.sourceUrl ? (
            <Pressable
              onPress={() => Linking.openURL(selectedItem.sourceUrl!).catch(() => {})}
              style={({ pressed }) => [
                styles.openSourceBtn,
                { transform: [{ scale: pressed ? 0.95 : 1 }] }
              ]}
            >
              <Text style={styles.openSourceBtnText}>원본 링크 열기 🔗</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {shouldShowRawInputFirst(selectedItem) ? (
        <RawInputSection item={selectedItem} />
      ) : null}

      {/* 2. 퀵 한 줄 메모 (최상단 배치로 개선) */}
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
          <Pressable
            onPress={handleSaveUserNote}
            style={({ pressed }) => [
              styles.noteSaveButton,
              { transform: [{ scale: pressed ? 0.94 : 1 }] }
            ]}
          >
            <Text style={styles.noteSaveButtonText}>저장</Text>
          </Pressable>
        </View>
      </View>

      {/* 3. AI 정리 및 요약 카드 */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryHeader}>
          <Text style={styles.summaryTitle}>✨ AI 정리 요약 상세</Text>
          <Pressable
            disabled={isSaving || selectedItem.aiStatus === 'pending'}
            onPress={async () => {
              await retryEnrichMetadata(selectedItem.id);
              setToastMessage('AI 분석을 다시 요청했습니다.');
            }}
            style={({ pressed }) => [
              styles.reanalyzeBtn,
              (pressed || isSaving || selectedItem.aiStatus === 'pending') && { opacity: 0.5 }
            ]}
          >
            {isSaving || selectedItem.aiStatus === 'pending' ? (
              <ActivityIndicator size="small" color="#c084fc" />
            ) : (
              <Text style={styles.reanalyzeBtnText}>AI 재분석 🧪</Text>
            )}
          </Pressable>
        </View>
        <Text style={styles.summaryValue}>
          {structured?.detailedAnalysis || selectedItem.summary || 'AI가 분석을 완료하지 못했거나 요약된 내용이 없습니다.'}
        </Text>
      </View>

      {/* 3. 도메인 특화 구조화 데이터 */}
      {structured && structured.category === 'recipe' && (
        <View style={styles.domainSpecCard}>
          <View style={[styles.domainSpecHeader, { borderLeftColor: '#ef4444' }]}>
            <Text style={styles.domainSpecHeaderEmoji}>🍳</Text>
            <View>
              <Text style={styles.domainSpecTitle}>AI 장보기 요리 재료 목록</Text>
              <Text style={styles.domainSpecSub}>난이도: {structured.difficulty} · 조리시간: {structured.cookTime}</Text>
            </View>
          </View>

          {/* 실시간 재료 준비율 프로그레스 바 */}
          {(() => {
            const list = (structured.ingredients as string[]) || [];
            const total = list.length;
            const checked = list.filter((ing) => checkedItems[selectedItem.id]?.[ing]).length;
            const ratio = total > 0 ? (checked / total) * 100 : 0;
            return (
              <View style={styles.progressBarContainer}>
                <View style={styles.progressBarHeader}>
                  <Text style={styles.progressBarLabel}>재료 준비율</Text>
                  <Text style={styles.progressBarValue}>{total}개 중 {checked}개 준비 완료 ({Math.round(ratio)}%)</Text>
                </View>
                <View style={styles.progressBarBg}>
                  <View style={[styles.progressBarFill, { width: `${ratio}%`, backgroundColor: '#8b5cf6' }]} />
                </View>
              </View>
            );
          })()}

          <View style={styles.ingredientsGrid}>
            {(structured.ingredients as string[]).map((ing) => {
              const isChecked = !!checkedItems[selectedItem.id]?.[ing];
              return (
                <Pressable
                  key={ing}
                  onPress={() => onToggleCheck(selectedItem.id, ing)}
                  style={({ pressed }) => [
                    styles.ingredientBadge,
                    isChecked && styles.ingredientBadgeChecked,
                    { transform: [{ scale: pressed ? 0.95 : 1 }] }
                  ]}
                >
                  <Text style={[styles.ingredientBadgeDot, isChecked && styles.ingredientBadgeDotChecked]}>
                    {isChecked ? '✔' : '○'}
                  </Text>
                  <Text style={[styles.ingredientBadgeText, isChecked && styles.ingredientBadgeTextChecked]}>
                    {ing}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      {structured && structured.category === 'workout' && (
        <View style={styles.domainSpecCard}>
          <View style={[styles.domainSpecHeader, { borderLeftColor: '#8b5cf6' }]}>
            <Text style={styles.domainSpecHeaderEmoji}>💪</Text>
            <View>
              <Text style={styles.domainSpecTitle}>AI 스마트 운동 루틴 & 타겟 부위</Text>
              <Text style={styles.domainSpecSub}>필요도구: {(structured.equipments as string[]).join(', ')}</Text>
            </View>
          </View>
          
          <View style={styles.muscleRow}>
            <Text style={styles.muscleLabel}>타겟 부위</Text>
            <View style={styles.muscleBadgeRow}>
              {(structured.targetMuscles as string[]).map((m) => (
                <Text key={m} style={styles.muscleBadge}>{m}</Text>
              ))}
            </View>
          </View>

          {/* 스마트 홈트 수행 완료 프로그레스 바 */}
          {(() => {
            const list = (structured.routine as string[]) || [];
            const total = list.length;
            const checked = list.filter((r) => checkedItems[selectedItem.id]?.[r]).length;
            const ratio = total > 0 ? (checked / total) * 100 : 0;
            return (
              <View style={styles.progressBarContainer}>
                <View style={styles.progressBarHeader}>
                  <Text style={styles.progressBarLabel}>루틴 완수도</Text>
                  <Text style={styles.progressBarValue}>{total}개 중 {checked}개 완료 ({Math.round(ratio)}%)</Text>
                </View>
                <View style={styles.progressBarBg}>
                  <View style={[styles.progressBarFill, { width: `${ratio}%`, backgroundColor: '#8b5cf6' }]} />
                </View>
              </View>
            );
          })()}

          <View style={styles.routineList}>
            {(structured.routine as string[]).map((r, idx) => {
              const isChecked = !!checkedItems[selectedItem.id]?.[r];
              return (
                <Pressable
                  key={r}
                  onPress={() => onToggleCheck(selectedItem.id, r)}
                  style={({ pressed }) => [
                    styles.routineItem,
                    isChecked && styles.routineItemChecked,
                    { transform: [{ scale: pressed ? 0.97 : 1 }] }
                  ]}
                >
                  <Text style={[styles.routineIndex, isChecked && styles.routineIndexChecked]}>
                    {isChecked ? '✔' : idx + 1}
                  </Text>
                  <Text style={[styles.routineText, isChecked && styles.routineTextChecked]}>
                    {r}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      {structured && structured.category === 'travel' && (
        <View style={styles.domainSpecCard}>
          <View style={[styles.domainSpecHeader, { borderLeftColor: '#3b82f6' }]}>
            <Text style={styles.domainSpecHeaderEmoji}>✈</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.domainSpecTitle}>AI 호캉스 코스 및 숙소 예산 정보</Text>
              <Text style={styles.domainSpecSub}>테마: {structured.travelTheme}</Text>
            </View>
            {/* 국내/해외/호캉스 테마 선명 배지 */}
            <View style={styles.travelThemeBadgeRow}>
              {structured.travelTheme && structured.travelTheme.includes('국내') && (
                <Text style={[styles.travelThemeBadge, { backgroundColor: 'rgba(59, 130, 246, 0.15)', color: '#93c5fd', borderColor: '#3b82f6' }]}>국내 🇰🇷</Text>
              )}
              {structured.travelTheme && structured.travelTheme.includes('해외') && (
                <Text style={[styles.travelThemeBadge, { backgroundColor: 'rgba(236, 72, 153, 0.15)', color: '#fbcfe8', borderColor: '#ec4899' }]}>해외 ✈</Text>
              )}
              {structured.travelTheme && structured.travelTheme.includes('호캉스') && (
                <Text style={[styles.travelThemeBadge, { backgroundColor: 'rgba(139, 92, 246, 0.15)', color: '#c084fc', borderColor: '#8b5cf6' }]}>호캉스 🏨</Text>
              )}
            </View>
          </View>

          <View style={styles.travelGrid}>
            <View style={styles.travelGridBlock}>
              <Text style={styles.travelBlockLabel}>📍 호텔 위치</Text>
              <Text style={styles.travelBlockVal}>{structured.location}</Text>
            </View>
            <View style={styles.travelGridBlock}>
              <Text style={styles.travelBlockLabel}>💵 1박 예상 예산</Text>
              <Text style={styles.travelBlockVal}>{structured.budget}</Text>
            </View>
          </View>

          <View style={styles.travelHighlightRow}>
            <Text style={styles.travelHighlightLabel}>핵심 요약 스팟</Text>
            <View style={styles.travelHighlightsContainer}>
              {(structured.highlights as string[]).map((h) => (
                <Text key={h} style={styles.travelHighlightText}>⭐ {h}</Text>
              ))}
            </View>
          </View>

          {/* 여행 준비물/체크리스트 프로그레스 바 & 리스트 */}
          {structured.checklist && (structured.checklist as string[]).length > 0 && (
            <View style={styles.travelChecklistSection}>
              <Text style={styles.travelHighlightLabel}>여행 준비물 및 예약 체크리스트</Text>
              
              {(() => {
                const list = (structured.checklist as string[]) || [];
                const total = list.length;
                const checked = list.filter((item) => checkedItems[selectedItem.id]?.[item]).length;
                const ratio = total > 0 ? (checked / total) * 100 : 0;
                return (
                  <View style={styles.progressBarContainer}>
                    <View style={styles.progressBarHeader}>
                      <Text style={styles.progressBarLabel}>준비 완료도</Text>
                      <Text style={styles.progressBarValue}>{total}개 중 {checked}개 완료 ({Math.round(ratio)}%)</Text>
                    </View>
                    <View style={styles.progressBarBg}>
                      <View style={[styles.progressBarFill, { width: `${ratio}%`, backgroundColor: '#3b82f6' }]} />
                    </View>
                  </View>
                );
              })()}

              <View style={styles.travelChecklistGrid}>
                {(structured.checklist as string[]).map((item) => {
                  const isChecked = !!checkedItems[selectedItem.id]?.[item];
                  return (
                    <Pressable
                      key={item}
                      onPress={() => onToggleCheck(selectedItem.id, item)}
                      style={({ pressed }) => [
                        styles.travelChecklistItem,
                        isChecked && styles.travelChecklistItemChecked,
                        { transform: [{ scale: pressed ? 0.96 : 1 }] }
                      ]}
                    >
                      <Text style={[styles.travelChecklistIcon, isChecked && styles.travelChecklistIconChecked]}>
                        {isChecked ? '✔' : '□'}
                      </Text>
                      <Text style={[styles.travelChecklistText, isChecked && styles.travelChecklistTextChecked]}>
                        {item}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}
        </View>
      )}

      {/* 4. 추출된 링크 목록 */}
      {selectedItem.extractedUrls && selectedItem.extractedUrls.length > 0 ? (
        <View style={styles.detailSection}>
          <Text style={styles.detailLabel}>추출된 링크 목록 ({selectedItem.extractedUrls.length}개)</Text>
          <View style={styles.extractedUrlsList}>
            {selectedItem.extractedUrls.map((url, idx) => (
              <Pressable
                key={url + idx}
                onPress={() => Linking.openURL(url).catch(() => {})}
                style={({ pressed }) => [
                  styles.urlClickableRow,
                  { transform: [{ scale: pressed ? 0.96 : 1 }] }
                ]}
              >
                <Text style={urlClickableNumStyle(selectedItem.sourceType)}>#{idx + 1}</Text>
                <Text style={urlClickableTextStyle(selectedItem.sourceType)} numberOfLines={1}>
                  {url}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {/* 6. 썸네일 */}
      {selectedItem.type === 'url' && selectedItem.thumbnailUrl ? (
        <View style={styles.thumbnailPanel}>
          <Text style={styles.detailLabel}>썸네일</Text>
          <View style={styles.thumbnailPreview}>
            <Image
              source={{ uri: selectedItem.thumbnailUrl }}
              style={styles.thumbnailImage as any}
              resizeMode="cover"
            />
            <Text style={styles.thumbnailTitle}>대표 이미지 후보를 찾았습니다</Text>
            <Text style={styles.thumbnailUrl}>{truncateMiddle(selectedItem.thumbnailUrl)}</Text>
          </View>
        </View>
      ) : null}

      {/* 7. 기술 상세 메타 정보 (접이식) */}
      <View style={styles.collapsibleArea}>
        <Pressable
          onPress={() => setIsMetaExpanded(!isMetaExpanded)}
          style={({ pressed }) => [
            styles.collapsibleHeader,
            { opacity: pressed ? 0.7 : 1 }
          ]}
        >
          <Text style={styles.collapsibleHeaderText}>
            {isMetaExpanded ? '기술 상세 메타 정보 접기 ▴' : '기술 상세 메타 정보 보기 ▾'}
          </Text>
        </Pressable>
        {isMetaExpanded ? (
          <View style={styles.collapsibleContent}>
            <View style={styles.detailGrid}>
              <MetaBlock label="원본 링크" value={selectedItem.sourceUrl ? truncateMiddle(selectedItem.sourceUrl) : '없음'} />
              <MetaBlock label="동기화" value={getSyncStatusLabel(selectedItem.syncStatus)} />
              <MetaBlock label="생성 시각" value={formatReadableDate(selectedItem.createdAt)} />
              <MetaBlock label="유형" value={selectedItem.type === 'url' ? '링크 저장' : '텍스트 메모'} />
            </View>

            <View style={styles.detailSection}>
              <Text style={styles.detailLabel}>원문 전체</Text>
              <ScrollView style={styles.rawInputScrollView} nestedScrollEnabled showsVerticalScrollIndicator={true}>
                <Text style={styles.detailRawInputText}>{selectedItem.rawInput}</Text>
              </ScrollView>
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function DetailEmpty() {
  return (
    <View style={styles.detailEmpty}>
      <Text style={styles.detailEmptyTitle}>아직 선택된 항목이 없습니다</Text>
      <Text style={styles.detailEmptyText}>
        첫 지식을 수집하면 오른쪽 패널에서 상세 상태를 바로 확인할 수 있습니다.
      </Text>
    </View>
  );
}

// ==========================================
// 보조 렌더링 헬퍼 함수들
// ==========================================
function tryParseStructuredContent(content: string) {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function getItemCategory(item: SavedItem): string {
  const structured = tryParseStructuredContent(item.content);
  const category = structured?.category || item.sourceType;

  if (category === 'parenting') {
    return 'parenting';
  }
  if (category === 'travel') {
    return 'travel';
  }
  if (category === 'recipe') {
    return 'recipe';
  }
  if (category === 'workout') {
    return 'workout';
  }

  const title = item.title.toLowerCase();
  const content = item.content.toLowerCase();

  // 육아 키워드 감지
  if (
    title.includes('기저귀') || title.includes('분유') || title.includes('육아') || title.includes('아동') || title.includes('출산') || title.includes('다자녀') ||
    content.includes('기저귀') || content.includes('분유') || content.includes('육아') || content.includes('아동') || content.includes('출산') || content.includes('다자녀')
  ) {
    return 'parenting';
  }

  // 여행 키워드 감지
  if (
    title.includes('여행') || title.includes('호캉스') || title.includes('항공권') ||
    content.includes('여행') || content.includes('호캉스') || content.includes('항공권')
  ) {
    return 'travel';
  }

  // 요리 키워드 감지
  if (
    title.includes('레시피') || title.includes('요리') || title.includes('조리법') ||
    content.includes('레시피') || content.includes('요리') || content.includes('조리법')
  ) {
    return 'recipe';
  }

  // 운동 키워드 감지
  if (
    title.includes('운동') || title.includes('루틴') || title.includes('홈트') || title.includes('헬스') ||
    content.includes('운동') || content.includes('루틴') || content.includes('홈트') || content.includes('헬스')
  ) {
    return 'workout';
  }

  return 'other';
}

function urlClickableNumStyle(sourceType: string) {
  const theme = getSourceTheme(sourceType);
  return [styles.urlClickableNum, { color: theme.badgeText }];
}

function urlClickableTextStyle(sourceType: string) {
  const theme = getSourceTheme(sourceType);
  return [styles.urlClickableText, { color: theme.badgeText }];
}

function RawInputSection({ item }: { item: SavedItem }) {
  return (
    <View style={styles.rawInputPanel}>
      <View style={styles.rawInputHeader}>
        <Text style={styles.detailLabel}>{item.type === 'text' ? '저장된 원문' : '공유 원문'}</Text>
        <Text style={styles.rawInputMeta}>{describeSavedItemShape(item)}</Text>
      </View>
      <Text style={styles.rawInputPrimaryText}>{item.rawInput}</Text>
    </View>
  );
}

function ItemCard({ item }: { item: SavedItem }) {
  return (
    <View style={styles.cardContent}>
      <View style={styles.cardRow}>
        <View style={styles.cardTextColumn}>
          <View style={styles.cardMetaRow}>
            <Text style={styles.cardSource} numberOfLines={1}>{getItemSourceLabel(item)}</Text>
            <StatusPills item={item} compact />
          </View>
          <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
          <View style={styles.cardContextRow}>
            <Text style={styles.cardTypePill}>{describeSavedItemShape(item)}</Text>
          </View>
          <Text style={styles.cardSummary} numberOfLines={3}>{item.summary || '요약된 내용이 없습니다.'}</Text>
          <Text style={styles.cardTimestamp}>{formatReadableDate(item.createdAt)}</Text>
        </View>
        <ThumbnailThumb item={item} />
      </View>
    </View>
  );
}

function ThumbnailThumb({ item }: { item: SavedItem }) {
  if (item.type === 'text') {
    return null;
  }

  if (item.thumbnailUrl) {
    return (
      <Image
        source={{ uri: item.thumbnailUrl }}
        style={styles.cardThumbnail as any}
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

function EmptyState() {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>수집함이 비어 있습니다</Text>
      <Text style={styles.emptyDescription}>
        유튜브, 인스타그램, 노션 링크를 복사하여 붙여넣으면 즉시 분류되어 이곳에 차곡차곡 안전하게 쌓입니다.
      </Text>
    </View>
  );
}

function StatusBadge({ label, tone = 'pending', compact = false }: { label: string; tone?: 'saved' | 'pending' | 'failed'; compact?: boolean }) {
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

function StatusPills({ item, compact = false }: { item: SavedItem; compact?: boolean }) {
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

function MetaBlock({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaBlock}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

function getSourceTheme(sourceType: string) {
  switch (sourceType) {
    case 'youtube':
      return {
        border: 'rgba(239, 68, 68, 0.2)',
        bg: 'rgba(239, 68, 68, 0.1)',
        badgeBg: 'rgba(239, 68, 68, 0.18)',
        badgeText: '#fca5a5',
        label: 'YouTube',
      };
    case 'parenting':
      return {
        border: 'rgba(251, 146, 60, 0.2)',
        bg: 'rgba(251, 146, 60, 0.1)',
        badgeBg: 'rgba(251, 146, 60, 0.18)',
        badgeText: '#fdbb2d',
        label: '육아 👶',
      };
    case 'instagram':
    case 'instagram_post':
    case 'instagram_reel':
    case 'workout':
      return {
        border: 'rgba(236, 72, 153, 0.2)',
        bg: 'rgba(236, 72, 153, 0.1)',
        badgeBg: 'rgba(236, 72, 153, 0.18)',
        badgeText: '#fbcfe8',
        label: sourceType === 'workout' ? '홈트/운동' : sourceType === 'instagram_reel' ? 'Instagram Reel' : sourceType === 'instagram_post' ? 'Instagram Post' : 'Instagram',
      };
    case 'notion':
    case 'recipe':
      return {
        border: 'rgba(239, 68, 68, 0.2)',
        bg: 'rgba(239, 68, 68, 0.1)',
        badgeBg: 'rgba(239, 68, 68, 0.18)',
        badgeText: '#fca5a5',
        label: sourceType === 'recipe' ? '레시피 요리' : 'Notion',
      };
    case 'google_docs':
    case 'google_sheets':
    case 'google_drive':
    case 'google_form':
    case 'travel':
      return {
        border: 'rgba(59, 130, 246, 0.2)',
        bg: 'rgba(59, 130, 246, 0.1)',
        badgeBg: 'rgba(59, 130, 246, 0.18)',
        badgeText: '#93c5fd',
        label: sourceType === 'travel' ? '여행 코스' : sourceType === 'google_docs' ? 'Google Docs' : sourceType === 'google_sheets' ? 'Google Sheets' : sourceType === 'google_form' ? 'Google Form' : 'Google Drive',
      };
    case 'manual_text':
      return {
        border: 'rgba(249, 115, 22, 0.2)',
        bg: 'rgba(249, 115, 22, 0.1)',
        badgeBg: 'rgba(249, 115, 22, 0.18)',
        badgeText: '#fcd34d',
        label: '직접 메모',
      };
    default:
      return {
        border: 'rgba(139, 92, 246, 0.2)',
        bg: 'rgba(139, 92, 246, 0.1)',
        badgeBg: 'rgba(139, 92, 246, 0.18)',
        badgeText: '#c084fc',
        label: 'Web Link',
      };
  }
}

function getStatusLabel(item: SavedItem) {
  return `${getSaveStatusLabel(item)} · ${getAiStatusLabel(item)}`;
}

function getSaveStatusLabel(_item: SavedItem) {
  return '저장됨';
}

function getAiStatusLabel(item: SavedItem) {
  if (item.aiStatus === 'completed') {
    return '정리 완료';
  }

  if (item.aiStatus === 'failed') {
    return '정리 실패';
  }

  return '요약 정리 중';
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
    return item.savedFrom === 'clipboard' ? '클립보드 텍스트' : '텍스트 메모';
  }

  try {
    return new URL(item.sourceUrl).hostname.replace(/^www\./, '');
  } catch {
    return 'web link';
  }
}

function shouldShowRawInputFirst(item: SavedItem) {
  return item.type === 'text' || item.extractedUrls.length > 1 || item.rawInput.trim() !== item.content.trim();
}

function describeSavedItemShape(item: SavedItem) {
  if (item.extractedUrls.length > 1) {
    return `링크 ${item.extractedUrls.length}개 포함`;
  }

  if (item.type === 'text') {
    return `텍스트 ${item.rawInput.trim().length}자`;
  }

  return '링크 1개';
}

function describeInputCandidate(input: string) {
  const urls = extractUrlCount(input);
  if (urls > 1) {
    return `링크 ${urls}개 포함`;
  }

  if (urls === 1) {
    return `${getInputHostname(input)} 링크`;
  }

  return `텍스트 ${input.trim().length}자`;
}

function buildCaptureNotice(
  item: SavedItem | null,
  rawInput: string,
  source: CaptureNotice['source']
): CaptureNotice {
  return {
    itemId: item?.id ?? null,
    source,
    title: item ? '수집함에 저장됨' : '저장 요청 완료',
    description: item ? describeSavedItemShape(item) : describeInputCandidate(rawInput),
    preview: rawInput.trim().replace(/\s+/g, ' '),
    stateLabel: item ? getAiStatusLabel(item) : '요약 정리 중',
  };
}

function extractUrlCount(input: string) {
  const matches = input.match(
    /\b(?:(?:https?:\/\/|www\.)[^\s<>"']+|(?:youtube\.com|m\.youtube\.com|youtu\.be|instagram\.com|www\.instagram\.com|notion\.so|notion\.site)\/[^\s<>"']+)/gi
  ) ?? [];
  return new Set(matches.map((match) => match.replace(/[)\],.!?]+$/, ''))).size;
}

function getInputHostname(input: string) {
  const match = input.match(
    /\b(?:(?:https?:\/\/|www\.)[^\s<>"']+|(?:youtube\.com|m\.youtube\.com|youtu\.be|instagram\.com|www\.instagram\.com|notion\.so|notion\.site)\/[^\s<>"']+)/i
  );
  if (!match) {
    return '링크';
  }

  try {
    const value = /^https?:\/\//i.test(match[0]) ? match[0] : `https://${match[0]}`;
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return '링크';
  }
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

// ==========================================
// 프리미엄 다크 스타일 정의 (도메인 특화 템플릿 포함)
// ==========================================
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: palette.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[6],
    paddingTop: spacing[5],
    paddingBottom: spacing[3],
    borderBottomWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.background,
    zIndex: 10,
  },
  headerLeft: {
    gap: 2,
  },
  headerEyebrow: {
    color: '#8b5cf6',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.8,
  },
  headerLogo: {
    color: palette.textPrimary,
    fontSize: 20,
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
    gap: spacing[2],
    backgroundColor: palette.surface,
    paddingHorizontal: spacing[3],
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: palette.border,
  },
  syncPulseDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: palette.success,
  },
  syncPulseDotActive: {
    backgroundColor: '#8b5cf6',
  },
  syncPulseDotPending: {
    backgroundColor: '#fbbf24',
  },
  syncIndicatorText: {
    color: palette.textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },
  content: {
    padding: spacing[6],
    gap: spacing[6],
  },
  heroGlowLarge: {
    position: 'absolute',
    right: -40,
    top: 20,
    width: 260,
    height: 260,
    borderRadius: 999,
    backgroundColor: '#8b5cf6',
    opacity: 0.04,
    zIndex: -1,
  },
  heroGlowSmall: {
    position: 'absolute',
    left: -30,
    top: 200,
    width: 160,
    height: 160,
    borderRadius: 999,
    backgroundColor: '#ec4899',
    opacity: 0.03,
    zIndex: -1,
  },
  clipboardBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: palette.surfaceRaised,
    borderRadius: 24,
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[4],
    borderWidth: 1,
    borderColor: palette.borderStrong,
    gap: spacing[3],
    flexWrap: 'wrap',
    shadowColor: '#000000',
    shadowOpacity: 0.2,
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
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: palette.accentStrong,
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
  clipboardBannerMeta: {
    color: palette.success,
    fontSize: 12,
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
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  clipboardBannerCloseBtnText: {
    color: palette.textSecondary,
    fontSize: 12,
    fontWeight: '800',
  },
  clipboardBannerPreviewBtn: {
    borderRadius: 14,
    paddingHorizontal: spacing[3],
    paddingVertical: 8,
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.28)',
  },
  clipboardBannerPreviewBtnText: {
    color: '#93c5fd',
    fontSize: 12,
    fontWeight: '800',
  },
  clipboardBannerSaveBtn: {
    borderRadius: 14,
    paddingHorizontal: spacing[4],
    paddingVertical: 8,
    backgroundColor: palette.accent,
  },
  clipboardBannerSaveBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  captureNotice: {
    backgroundColor: palette.surfaceRaised,
    borderRadius: 18,
    padding: spacing[4],
    gap: spacing[3],
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.28)',
  },
  captureNoticeHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing[3],
  },
  captureNoticeTitleColumn: {
    flex: 1,
    gap: 2,
  },
  captureNoticeEyebrow: {
    color: palette.success,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  captureNoticeTitle: {
    color: palette.textPrimary,
    fontSize: 16,
    fontWeight: '900',
  },
  captureNoticeCloseBtn: {
    borderRadius: 12,
    paddingHorizontal: spacing[3],
    paddingVertical: 7,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  captureNoticeCloseBtnText: {
    color: palette.textSecondary,
    fontSize: 12,
    fontWeight: '800',
  },
  captureNoticeDescription: {
    color: palette.success,
    fontSize: 13,
    fontWeight: '800',
  },
  captureNoticePreview: {
    color: palette.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  captureNoticeActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[3],
  },
  captureNoticePrimaryBtn: {
    borderRadius: 14,
    paddingHorizontal: spacing[4],
    paddingVertical: 9,
    backgroundColor: palette.success,
  },
  captureNoticePrimaryBtnDisabled: {
    opacity: 0.45,
  },
  captureNoticePrimaryBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
  captureNoticeState: {
    flex: 1,
    color: palette.textMuted,
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'right',
  },
  rawInputScrollView: {
    maxHeight: 120,
    backgroundColor: palette.backgroundStrong,
    borderRadius: 16,
    padding: spacing[3],
    borderWidth: 1,
    borderColor: palette.border,
  },
  detailRawInputText: {
    color: palette.textSecondary,
    fontSize: 13,
    lineHeight: 20,
  },
  rawInputPanel: {
    backgroundColor: palette.backgroundStrong,
    borderRadius: 18,
    padding: spacing[4],
    gap: spacing[3],
    borderWidth: 1,
    borderColor: palette.borderStrong,
  },
  rawInputHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing[3],
  },
  rawInputMeta: {
    color: palette.success,
    fontSize: 11,
    fontWeight: '900',
  },
  rawInputPrimaryText: {
    color: palette.textPrimary,
    fontSize: 14,
    lineHeight: 22,
  },
  noteInputRow: {
    flexDirection: 'row',
    gap: spacing[2],
    alignItems: 'stretch',
  },
  noteInput: {
    flex: 1,
    backgroundColor: palette.surface,
    borderRadius: 16,
    paddingHorizontal: spacing[3],
    paddingVertical: 6,
    color: palette.textPrimary,
    fontSize: 13,
    minHeight: 38,
    borderWidth: 1,
    borderColor: palette.border,
  },
  noteSaveButton: {
    backgroundColor: palette.accent,
    borderRadius: 16,
    paddingHorizontal: spacing[4],
    justifyContent: 'center',
    alignItems: 'center',
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
    backgroundColor: 'rgba(139, 92, 246, 0.08)',
    borderRadius: 16,
    paddingHorizontal: spacing[3],
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.15)',
  },
  urlClickableNum: {
    color: '#a78bfa',
    fontSize: 12,
    fontWeight: '800',
  },
  urlClickableText: {
    flex: 1,
    color: '#c084fc',
    fontSize: 13,
    fontWeight: '700',
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    backgroundColor: palette.successSoft,
    borderRadius: 18,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
  },
  toastDot: {
    width: 8,
    height: 8,
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
    borderColor: 'rgba(251, 191, 36, 0.2)',
  },
  syncInfoText: {
    color: '#fbbf24',
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
  },
  workspace: {
    gap: spacing[6],
    width: '100%',
  },
  workspaceWide: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  leftColumn: {
    gap: spacing[6],
    width: '100%',
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
  floatingComposer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.surface,
    borderRadius: 24,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderWidth: 1,
    borderColor: palette.borderStrong,
    shadowColor: '#000000',
    shadowOpacity: 0.2,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
    gap: spacing[2],
  },
  floatingInput: {
    flex: 1,
    color: palette.textPrimary,
    fontSize: 15,
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  floatingLoader: {
    marginRight: 4,
  },
  floatingSaveBtn: {
    backgroundColor: palette.accent,
    borderRadius: 16,
    paddingHorizontal: spacing[5],
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingSaveBtnDisabled: {
    opacity: 0.4,
  },
  floatingSaveBtnPressed: {
    transform: [{ scale: 0.96 }],
    opacity: 0.9,
  },
  floatingSaveBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '900',
  },
  panel: {
    backgroundColor: palette.surface,
    borderRadius: 26,
    padding: spacing[6],
    gap: spacing[5],
    shadowColor: '#000000',
    shadowOpacity: 0.15,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
    borderWidth: 1,
    borderColor: palette.border,
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
    fontSize: 24,
    lineHeight: 30,
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
    borderBottomWidth: 1,
    borderColor: palette.border,
    paddingBottom: spacing[3],
  },
  sectionTitle: {
    color: palette.textPrimary,
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  sectionMeta: {
    color: palette.textMuted,
    fontSize: 13,
    fontWeight: '800',
  },
  button: {
    borderRadius: 16,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    minWidth: 132,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButton: {
    backgroundColor: palette.surfaceRaised,
    borderWidth: 1,
    borderColor: palette.borderStrong,
  },
  secondaryButtonText: {
    color: palette.textSecondary,
    fontSize: 14,
    fontWeight: '800',
  },
  cardList: {
    gap: 14,
  },
  card: {
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: palette.surfaceRaised,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    minHeight: 115,
  },
  cardSelected: {
    backgroundColor: palette.surfaceStrong,
    shadowColor: '#000000',
    shadowOpacity: 0.25,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
    borderWidth: 1,
    borderColor: palette.accent,
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
    width: 5,
  },
  cardContent: {
    paddingVertical: 10,
    paddingHorizontal: spacing[4],
    paddingLeft: spacing[5],
  },
  cardRow: {
    flexDirection: 'row',
    gap: spacing[3],
    alignItems: 'center',
  },
  cardTextColumn: {
    flex: 1,
    gap: 4,
  },
  cardMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing[2],
  },
  cardSource: {
    flex: 1,
    color: palette.textMuted,
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  cardTitle: {
    color: palette.textPrimary,
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  cardContextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  cardTypePill: {
    alignSelf: 'flex-start',
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
    backgroundColor: palette.surface,
    color: palette.textSecondary,
    fontSize: 10,
    fontWeight: '800',
  },
  cardSummary: {
    color: palette.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  cardTimestamp: {
    color: palette.textMuted,
    fontSize: 10,
    fontWeight: '600',
    paddingTop: 2,
  },
  cardThumbnail: {
    width: 60,
    height: 60,
    borderRadius: 10,
    backgroundColor: palette.backgroundStrong,
  },
  cardThumbnailPlaceholder: {
    width: 60,
    height: 60,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  cardThumbnailPlaceholderText: {
    color: palette.textMuted,
    fontSize: 11,
    fontWeight: '900',
  },
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
    color: '#fbbf24',
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
  loadingCard: {
    backgroundColor: palette.surface,
    borderRadius: 26,
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
    borderRadius: 26,
    padding: spacing[8],
    gap: spacing[3],
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: palette.borderStrong,
    alignItems: 'center',
  },
  emptyTitle: {
    color: palette.textPrimary,
    fontSize: 16,
    fontWeight: '900',
    textAlign: 'center',
  },
  emptyDescription: {
    color: palette.textSecondary,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: 280,
  },
  detailCard: {
    gap: spacing[3],
  },
  detailHero: {
    backgroundColor: palette.surfaceRaised,
    borderRadius: 20,
    padding: spacing[4],
    gap: spacing[2],
    borderWidth: 1,
    borderColor: palette.border,
  },
  detailHeroText: {
    gap: spacing[1],
  },
  detailTitle: {
    color: palette.textPrimary,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  detailSource: {
    color: palette.textSecondary,
    fontSize: 12,
    lineHeight: 18,
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
    backgroundColor: palette.surface,
    borderRadius: 20,
    padding: spacing[4],
    gap: spacing[2],
    borderWidth: 1,
    borderColor: palette.border,
  },
  thumbnailImage: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 16,
    backgroundColor: palette.backgroundStrong,
  },
  thumbnailTitle: {
    color: palette.textPrimary,
    fontSize: 13,
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
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
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
  detailHeroActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[2],
    marginTop: spacing[1],
  },
  openSourceBtn: {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.35)',
    borderRadius: 10,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    alignItems: 'center',
    justifyContent: 'center',
  },
  openSourceBtnText: {
    color: '#93c5fd',
    fontSize: 12,
    fontWeight: '800',
  },
  summaryCard: {
    backgroundColor: palette.surfaceRaised,
    borderRadius: 24,
    padding: spacing[5],
    gap: spacing[3],
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.25)',
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[2],
  },
  summaryTitle: {
    color: '#c084fc',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  summaryValue: {
    color: palette.textPrimary,
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '500',
  },
  reanalyzeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.25)',
  },
  reanalyzeBtnText: {
    color: '#c084fc',
    fontSize: 11,
    fontWeight: '800',
  },
  collapsibleArea: {
    marginTop: spacing[2],
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 18,
    overflow: 'hidden',
  },
  collapsibleHeader: {
    backgroundColor: palette.surface,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  collapsibleHeaderText: {
    color: palette.textSecondary,
    fontSize: 12,
    fontWeight: '800',
  },
  collapsibleContent: {
    backgroundColor: palette.surfaceRaised,
    padding: spacing[4],
    gap: spacing[4],
    borderTopWidth: 1,
    borderTopColor: palette.border,
  },
  detailLabel: {
    color: palette.textMuted,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  detailValue: {
    color: palette.textSecondary,
    fontSize: 14,
    lineHeight: 22,
  },
  detailEmpty: {
    backgroundColor: palette.surface,
    borderRadius: 24,
    padding: spacing[8],
    gap: spacing[3],
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
  },
  detailEmptyTitle: {
    color: palette.textPrimary,
    fontSize: 16,
    fontWeight: '900',
  },
  detailEmptyText: {
    color: palette.textSecondary,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: 240,
  },
  errorBanner: {
    backgroundColor: palette.dangerSoft,
    borderRadius: 18,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  errorText: {
    color: palette.dangerText,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '700',
  },

  // ----------------------------------------
  // 바텀 시트 스타일 정의 (Modal overlay)
  // ----------------------------------------
  bottomSheetBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    zIndex: 999,
  },
  backdropClickable: {
    flex: 1,
  },
  bottomSheetContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '95%',
    backgroundColor: palette.backgroundStrong,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: -10 },
    elevation: 24,
  },
  bottomSheetHeader: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderColor: palette.border,
    position: 'relative',
  },
  bottomSheetHandle: {
    width: 36,
    height: 4,
    backgroundColor: palette.textMuted,
    borderRadius: 99,
    opacity: 0.5,
  },
  bottomSheetCloseBtn: {
    position: 'absolute',
    right: 20,
    top: 8,
    width: 28,
    height: 28,
    backgroundColor: palette.surface,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: palette.border,
  },
  bottomSheetCloseBtnText: {
    color: palette.textSecondary,
    fontSize: 11,
    fontWeight: '800',
  },
  bottomSheetContent: {
    padding: spacing[6],
    paddingBottom: spacing[10],
  },

  // ----------------------------------------
  // 도메인 특화 구조화 정보 박스 스타일
  // ----------------------------------------
  domainSpecCard: {
    backgroundColor: palette.surfaceStrong,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    padding: spacing[5],
    gap: spacing[4],
  },
  domainSpecHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    borderLeftWidth: 4,
    paddingLeft: spacing[2],
  },
  domainSpecHeaderEmoji: {
    fontSize: 22,
  },
  domainSpecTitle: {
    color: palette.textPrimary,
    fontSize: 14,
    fontWeight: '900',
  },
  domainSpecSub: {
    color: palette.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 1,
  },
  ingredientsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  ingredientBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: palette.surface,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: palette.border,
  },
  ingredientBadgeDot: {
    color: palette.success,
    fontSize: 10,
    fontWeight: '900',
  },
  ingredientBadgeText: {
    color: palette.textPrimary,
    fontSize: 12,
    fontWeight: '800',
  },
  muscleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    borderBottomWidth: 1,
    borderColor: palette.border,
    paddingBottom: spacing[2],
  },
  muscleLabel: {
    color: palette.textMuted,
    fontSize: 11,
    fontWeight: '900',
  },
  muscleBadgeRow: {
    flexDirection: 'row',
    gap: 6,
  },
  muscleBadge: {
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    color: '#a78bfa',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 11,
    fontWeight: '800',
  },
  routineList: {
    gap: spacing[2],
  },
  routineItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    backgroundColor: palette.surface,
    borderRadius: 14,
    padding: spacing[3],
    borderWidth: 1,
    borderColor: palette.border,
  },
  routineIndex: {
    width: 22,
    height: 22,
    borderRadius: 99,
    backgroundColor: palette.surfaceRaised,
    color: palette.accent,
    textAlign: 'center',
    lineHeight: 22,
    fontSize: 12,
    fontWeight: '900',
  },
  routineText: {
    color: palette.textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
  travelGrid: {
    flexDirection: 'row',
    gap: spacing[3],
  },
  travelGridBlock: {
    flex: 1,
    backgroundColor: palette.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: palette.border,
    gap: 4,
  },
  travelBlockLabel: {
    color: palette.textMuted,
    fontSize: 10,
    fontWeight: '900',
  },
  travelBlockVal: {
    color: palette.textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
  travelHighlightRow: {
    gap: spacing[2],
    borderTopWidth: 1,
    borderColor: palette.border,
    paddingTop: spacing[2],
  },
  travelHighlightLabel: {
    color: palette.textMuted,
    fontSize: 11,
    fontWeight: '900',
  },
  travelHighlightsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  travelHighlightText: {
    color: palette.textPrimary,
    fontSize: 12,
    fontWeight: '800',
    backgroundColor: palette.surface,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: palette.border,
  },
  
  // ----------------------------------------
  // 지능형 검색 바 스타일
  // ----------------------------------------
  floatingSearchShell: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.surfaceRaised,
    borderRadius: 20,
    paddingHorizontal: spacing[4],
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: palette.border,
    gap: spacing[2],
  },
  searchIcon: {
    fontSize: 14,
    opacity: 0.6,
  },
  floatingSearchInput: {
    flex: 1,
    color: palette.textPrimary,
    fontSize: 13.5,
    paddingVertical: 6,
  },
  searchClearBtn: {
    width: 20,
    height: 20,
    backgroundColor: palette.surface,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchClearBtnText: {
    color: palette.textSecondary,
    fontSize: 9,
    fontWeight: '900',
  },
  quickChipsContainer: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 4,
  },
  quickChip: {
    backgroundColor: palette.surface,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: palette.border,
  },
  quickChipActive: {
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    borderColor: '#8b5cf6',
  },
  quickChipText: {
    color: palette.textSecondary,
    fontSize: 12,
    fontWeight: '800',
  },
  quickChipTextActive: {
    color: '#c084fc',
    fontWeight: '900',
  },

  // ----------------------------------------
  // 실시간 공통 프로그레스 바 스타일
  // ----------------------------------------
  progressBarContainer: {
    backgroundColor: palette.surface,
    borderRadius: 16,
    padding: spacing[3],
    borderWidth: 1,
    borderColor: palette.border,
    marginVertical: 4,
    gap: 6,
  },
  progressBarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressBarLabel: {
    color: palette.textMuted,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  progressBarValue: {
    color: palette.textPrimary,
    fontSize: 11,
    fontWeight: '800',
  },
  progressBarBg: {
    height: 6,
    backgroundColor: palette.backgroundStrong,
    borderRadius: 99,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 99,
  },

  // ----------------------------------------
  // 체크 완료 시의 특화 스타일 변형들
  // ----------------------------------------
  ingredientBadgeChecked: {
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    borderColor: 'rgba(16, 185, 129, 0.25)',
    opacity: 0.65,
  },
  ingredientBadgeDotChecked: {
    color: palette.success,
  },
  ingredientBadgeTextChecked: {
    color: palette.textMuted,
    textDecorationLine: 'line-through',
  },
  routineItemChecked: {
    backgroundColor: 'rgba(16, 185, 129, 0.05)',
    borderColor: 'rgba(16, 185, 129, 0.2)',
    opacity: 0.6,
  },
  routineIndexChecked: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    color: palette.success,
  },
  routineTextChecked: {
    color: palette.textMuted,
    textDecorationLine: 'line-through',
  },

  // ----------------------------------------
  // 여행 정보 전용 네온 배지 및 준비물 스타일
  // ----------------------------------------
  travelThemeBadgeRow: {
    flexDirection: 'row',
    gap: 4,
  },
  travelThemeBadge: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 10.5,
    fontWeight: '900',
    borderWidth: 1,
  },
  travelChecklistSection: {
    borderTopWidth: 1,
    borderColor: palette.border,
    paddingTop: spacing[3],
    gap: spacing[2],
  },
  travelChecklistGrid: {
    gap: 8,
    marginTop: 4,
  },
  travelChecklistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    backgroundColor: palette.surface,
    borderRadius: 14,
    padding: spacing[3],
    borderWidth: 1,
    borderColor: palette.border,
  },
  travelChecklistItemChecked: {
    backgroundColor: 'rgba(16, 185, 129, 0.05)',
    borderColor: 'rgba(16, 185, 129, 0.2)',
    opacity: 0.6,
  },
  travelChecklistIcon: {
    color: palette.textMuted,
    fontSize: 14,
    fontWeight: '800',
  },
  travelChecklistIconChecked: {
    color: palette.success,
  },
  travelChecklistText: {
    color: palette.textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
  travelChecklistTextChecked: {
    color: palette.textMuted,
    textDecorationLine: 'line-through',
  },
});
