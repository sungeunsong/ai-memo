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
import { pickSharedImagePath } from '@/features/capture/imageCapture';
import * as ImagePicker from 'expo-image-picker';
import { useAppStore } from '@/store';
import { getSettingAsync, setSettingAsync } from '@/db';
import { Palette } from '@/theme/palette';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { spacing } from '@/theme/spacing';

import { ItemCard } from '@/components/ItemCard';
import { SearchFilterBar } from '@/components/SearchFilterBar';
import { EmptyResultGuide } from '@/components/EmptyResultGuide';
import { BackupModal } from '@/components/BackupModal';
import { InstallHintBanner } from '@/components/InstallHintBanner';
import { SaveTargetModal } from '@/components/SaveTargetModal';
import { PantryModal } from '@/components/PantryModal';
import {
  availableFacets,
  buildFacetIndex,
  selectByFacets,
  suggestRelaxations,
  matchesCategoryTab,
} from '@/features/facets/query';
import { parseQueryToFacets } from '@/features/facets/parseQuery';
import {
  SavedFilter,
  addSavedFilter,
  isFilterSaveable,
  loadSavedFilters,
  removeSavedFilter,
  replaceSavedFilters,
} from '@/features/facets/savedFilters';
import { parseFacetKey } from '@/features/facets/extract';
import { facetLabel } from '@/features/facets/labels';
import {
  OTHER_TAB_KEY,
  TabOption,
  buildTabOptions,
  loadPinnedTabs,
  resolveVisibleTabs,
  savePinnedTabs,
  togglePinned,
} from '@/features/facets/tabs';
import { rewritePinnedTabs, rewriteSavedFilters } from '@/features/taxonomy/merge';
import { resolveDomainLabel } from '@/features/taxonomy/registry';
import { TabPickerModal } from '@/components/TabPickerModal';
import { CaptureModal, CaptureFloatingButton } from '@/components/CaptureModal';
import { DetailScreen, DetailContent } from '@/components/DetailScreen';
import {
  buildCaptureNotice,
  CaptureNotice,
  describeInputCandidate,
  filterItems,
  getCategoryLabel,
  getSourceTheme,
  formatRelativeTime,
} from '@/utils/formatters';

const PANTRY_SETTING_KEY = 'pantry.owned';
/**
 * 무시한 클립보드 내용.
 *
 * ref에만 담아두면 앱을 완전히 종료했다 켤 때 초기화돼서,
 * 같은 내용에 대해 배너가 계속 다시 뜹니다.
 * 사용자가 한 번 거절한 것은 클립보드가 바뀌기 전까지 다시 묻지 않아야 합니다.
 */
const IGNORED_CLIPBOARD_KEY = 'clipboard.ignored';

/** 헤더 버튼은 한 번 누를 때마다 다크 → 라이트 → 시스템으로 돕니다. */
const THEME_ICONS: Record<string, string> = { dark: '🌙', light: '☀️', system: '🌗' };
const THEME_LABELS: Record<string, string> = { dark: '다크', light: '라이트', system: '시스템' };
/**
 * 아이콘만으로는 무엇이 바뀌었는지 알 수 없습니다. 특히 🌗(시스템)은
 * 처음 보면 무슨 모드인지 짐작이 안 갑니다. 이름 대신 하는 일을 적습니다.
 */
const THEME_TOASTS: Record<string, string> = {
  dark: '🌙 항상 어둡게',
  light: '☀️ 항상 밝게',
  system: '🌗 기기 설정을 따릅니다',
};

export function HomeScreen() {
  const { palette, mode, preference, cyclePreference } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { width } = useWindowDimensions();
  const isWideLayout = width >= 940;

  // Store
  const isReady = useAppStore((s) => s.isReady);
  const isInitializing = useAppStore((s) => s.isInitializing);
  const isSaving = useAppStore((s) => s.isSaving);
  const items = useAppStore((s) => s.items);
  const taxonomy = useAppStore((s) => s.taxonomy);
  const selectedItemId = useAppStore((s) => s.selectedItemId);
  const errorMessage = useAppStore((s) => s.errorMessage);
  const syncQueuePendingCount = useAppStore((s) => s.syncQueuePendingCount);
  const syncWorkerMessage = useAppStore((s) => s.syncWorkerMessage);
  const isSyncWorkerRunning = useAppStore((s) => s.isSyncWorkerRunning);
  const saveUrl = useAppStore((s) => s.saveUrl);
  const saveImage = useAppStore((s) => s.saveImage);
  const selectItem = useAppStore((s) => s.selectItem);
  const clearError = useAppStore((s) => s.clearError);
  const deleteItem = useAppStore((s) => s.deleteItem);
  const resumeSync = useAppStore((s) => s.resumeSync);
  const resumeEnrich = useAppStore((s) => s.resumeEnrich);
  const reloadItems = useAppStore((s) => s.reloadItems);
  const attachSourceToItem = useAppStore((s) => s.attachSourceToItem);
  const attachScreenshotsToItem = useAppStore((s) => s.attachScreenshotsToItem);
  const resolveAwaitingInput = useAppStore((s) => s.resolveAwaitingInput);
  const renameDomain = useAppStore((s) => s.renameDomain);
  const mergeDomains = useAppStore((s) => s.mergeDomains);
  const deleteDomain = useAppStore((s) => s.deleteDomain);
  const createDomain = useAppStore((s) => s.createDomain);

  // Share intent
  const { hasShareIntent, shareIntent, resetShareIntent, error: shareIntentError } =
    useShareIntentContext();

  // Local state
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('');
  /** 서로 AND로 묶이는 조합 조건. 예) ['region:강원도', 'amenity:수영장'] */
  const [selectedFacets, setSelectedFacets] = useState<string[]>([]);
  const [isCaptureVisible, setIsCaptureVisible] = useState(false);
  const [isPantryVisible, setIsPantryVisible] = useState(false);
  const [isBackupVisible, setIsBackupVisible] = useState(false);
  /** 공유가 들어와 저장을 마친 뒤, 어떻게 담을지 고르는 중인 항목 */
  const [saveTargetItemId, setSaveTargetItemId] = useState<string | null>(null);
  const [pantryOwned, setPantryOwned] = useState<string[]>([]);

  // 냉장고 재료는 매번 다시 입력하게 하면 기능 자체를 안 쓰게 되므로 저장해둡니다.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const saved = await getSettingAsync(PANTRY_SETTING_KEY);
        if (!saved || cancelled) return;
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setPantryOwned(parsed.filter((entry): entry is string => typeof entry === 'string'));
        }
      } catch (error) {
        console.log('[Pantry] 저장된 재료를 불러오지 못했습니다.', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleChangePantry = useCallback((next: string[]) => {
    setPantryOwned(next);
    void setSettingAsync(PANTRY_SETTING_KEY, JSON.stringify(next)).catch((error) => {
      console.log('[Pantry] 재료 저장에 실패했습니다.', error);
    });
  }, []);

  const handleCategoryChange = useCallback((cat: string) => {
    setActiveCategory(cat);
    // 카테고리가 바뀌면 이전 조건은 대부분 의미가 없어집니다.
    setSelectedFacets([]);
  }, []);

  /**
   * 갤러리에서 사진을 고릅니다. 저장은 하지 않고 경로만 돌려줍니다.
   *
   * 예전에는 고르는 순간 저장하고 시트를 닫았습니다. 이미지가 곧 저장할 내용
   * 전부이던 시절의 흐름인데, 제목칸과 AI 토글이 생기면서 사진이 마지막 단계가
   * 아니게 됐습니다. 한 시트 안에서 텍스트는 저장 버튼이, 사진은 고르는 행위가
   * 확정하는 셈이라 규칙이 둘이었습니다. 확정은 저장 버튼 하나로 모읍니다.
   */
  const handlePickImages = useCallback(async (): Promise<string[]> => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setToastMessage('사진 접근 권한이 필요합니다.');
        return [];
      }

      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
        // 긴 DM은 한 화면에 안 들어와 두세 장으로 나눠 찍게 됩니다.
        allowsMultipleSelection: true,
      });
      if (picked.canceled) return [];

      return (picked.assets ?? []).map((asset) => asset.uri).filter(Boolean);
    } catch (error) {
      console.warn('[Home] 이미지 선택 실패:', error);
      setToastMessage('이미지를 불러오지 못했습니다.');
      return [];
    }
  }, []);

  // ==========================================
  // 분야 탭
  // 분야는 저장하는 대로 늘어납니다. 전부 세우면 가로로 한참 밀어야 하므로
  // 몇 개만 세우고, 무엇을 세울지는 사용자가 고정으로 정합니다.
  // ==========================================
  const [pinnedTabs, setPinnedTabs] = useState<string[]>([]);
  const [isTabPickerVisible, setIsTabPickerVisible] = useState(false);
  /** 시트를 열면서 곧바로 관리 화면을 볼 분야. 상단 탭을 길게 누르면 채워집니다. */
  const [manageDomainKey, setManageDomainKey] = useState<string | null>(null);

  const handleManageTab = useCallback((key: string) => {
    setManageDomainKey(key);
    setIsTabPickerVisible(true);
  }, []);

  const handleCloseTabPicker = useCallback(() => {
    setIsTabPickerVisible(false);
    setManageDomainKey(null);
  }, []);

  useEffect(() => {
    void (async () => setPinnedTabs(await loadPinnedTabs()))();
  }, []);

  const handleTogglePinnedTab = useCallback(
    async (key: string) => {
      const next = togglePinned(pinnedTabs, key);
      setPinnedTabs(next);
      await savePinnedTabs(next);
    },
    [pinnedTabs]
  );

  const handleRenameDomain = useCallback(
    async (key: string, label: string) => {
      await renameDomain(key, label);
      setToastMessage(`분야 이름을 '${label}'로 바꿨습니다.`);
    },
    [renameDomain]
  );

  /*
   * 저장해둔 조건은 아래 '스마트 폴더'에서 쓰지만 상태는 여기 있습니다.
   * 분야를 합치거나 지우면 그 조건들도 같이 고쳐야 해서, 분야를 다루는 자리보다
   * 먼저 만들어져 있어야 합니다.
   */
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);

  useEffect(() => {
    void (async () => setSavedFilters(await loadSavedFilters()))();
  }, []);

  /**
   * 분야가 사라진 뒤의 뒷정리.
   *
   * 사라진 분야를 가리키는 것이 두 군데 남습니다. 고정해둔 탭과 저장해둔 조건입니다.
   * 둘 다 화면이 들고 있어 DB 쪽 작업만으로는 안 고쳐집니다. 안 고치면 탭에는 건수 0인
   * 유령이 남고, 스마트 폴더는 눌러도 늘 0건인 채로 이유를 알려주지 않습니다.
   *
   * intoKey가 null이면 지운 것입니다. 그때는 조건에서 분야를 빼기만 합니다.
   */
  const followDomainChange = useCallback(
    async (fromKey: string, intoKey: string | null) => {
      const nextPinned = intoKey
        ? rewritePinnedTabs(pinnedTabs, fromKey, intoKey)
        : pinnedTabs.filter((key) => key !== fromKey);

      if (nextPinned.join('\u0000') !== pinnedTabs.join('\u0000')) {
        setPinnedTabs(nextPinned);
        await savePinnedTabs(nextPinned);
      }

      const nextFilters = rewriteSavedFilters(savedFilters, fromKey, intoKey);
      const changed = nextFilters.some((filter, index) => {
        const before = savedFilters[index];
        return (
          filter.category !== before.category ||
          filter.facetKeys.join('\u0000') !== before.facetKeys.join('\u0000')
        );
      });

      if (changed) setSavedFilters(await replaceSavedFilters(nextFilters));
    },
    [pinnedTabs, savedFilters]
  );

  /**
   * 분야 합치기.
   *
   * 되돌릴 수 없어서 먼저 확인을 받습니다. 백업은 있지만 그건 통째로 되돌리는
   * 것이라, 합치기 하나 무르자고 쓸 만한 수단이 아닙니다.
   *
   * 고정해둔 탭은 화면이 들고 있어 여기서 같이 고칩니다. 안 고치면 사라진 분야가
   * 탭에 남아 건수 0으로 서 있게 됩니다.
   */
  const handleMergeDomains = useCallback(
    (from: TabOption, into: TabOption) => {
      const message = `'${from.label}'을 '${into.label}'에 합칩니다. 글 ${from.count}건이 옮겨가고 '${from.label}'은 사라집니다. 되돌릴 수 없습니다.`;

      const run = async () => {
        const moved = await mergeDomains(from.key, { key: into.key, label: into.label });

        await followDomainChange(from.key, into.key);

        // 보고 있던 탭이 사라졌으면 남는 쪽으로 따라갑니다. 그대로 두면
        // 아무것도 없는 목록에 갇힙니다.
        setActiveCategory((current) => (current === from.key ? into.key : current));
        setToastMessage(`'${into.label}'로 ${moved}건을 옮겼습니다.`);
      };

      if (Platform.OS === 'web') {
        if (window.confirm(message)) void run();
        return;
      }

      Alert.alert('분야 합치기', message, [
        { text: '취소', style: 'cancel' },
        { text: '합치기', style: 'destructive', onPress: () => void run() },
      ]);
    },
    [mergeDomains, followDomainChange]
  );

  /**
   * 분야 미리 만들어두기.
   *
   * 글에 붙이지 않고 이름만 정해둡니다. 글이 없으니 탭에는 안 서지만, 사전에는
   * 들어가서 다음 정리 요청부터 AI에게 후보로 실려 나갑니다. 이게 이 기능의 값어치라
   * 상세 화면에서 글에 붙이며 만드는 길과 별개로 있어야 합니다.
   */
  const handleCreateDomain = useCallback(
    async (label: string) => {
      const result = await createDomain(label);
      if (!result) {
        setToastMessage('쓸 수 없는 이름입니다.');
        return;
      }

      setToastMessage(
        result.existed
          ? `'${result.label}'은 이미 있습니다.`
          : `'${result.label}' 분야를 만들었습니다. 다음에 저장하는 글부터 AI가 여기로 보냅니다.`
      );
    },
    [createDomain]
  );

  /**
   * 빈 분야 지우기.
   *
   * 글이 있는 분야는 여기로 오지 않습니다(버튼이 서지 않습니다). 그래도 한 번 더
   * 확인하는 이유는, 시트를 여는 사이에 다른 곳에서 정리가 끝나 글이 붙었을 수
   * 있기 때문입니다. 건수는 화면이 세고 있는 값을 그대로 씁니다.
   */
  const handleDeleteDomain = useCallback(
    (target: TabOption) => {
      if (target.count > 0) {
        setToastMessage(`'${target.label}'에 글 ${target.count}건이 있어 지울 수 없습니다.`);
        return;
      }

      const message = `'${target.label}' 분야를 지웁니다. 글이 없는 분야라 사라지는 것은 이름뿐입니다.`;

      const run = async () => {
        const removed = await deleteDomain(target.key);
        if (!removed) return;

        await followDomainChange(target.key, null);
        setActiveCategory((current) => (current === target.key ? '' : current));
        setToastMessage(`'${target.label}' 분야를 지웠습니다.`);
      };

      if (Platform.OS === 'web') {
        if (window.confirm(message)) void run();
        return;
      }

      Alert.alert('분야 지우기', message, [
        { text: '취소', style: 'cancel' },
        { text: '지우기', style: 'destructive', onPress: () => void run() },
      ]);
    },
    [deleteDomain, followDomainChange]
  );

  // ==========================================
  // 스마트 폴더 (조합 조건 저장)
  // ==========================================
  const handleSaveFilter = useCallback(
    async (name: string) => {
      const next = await addSavedFilter(savedFilters, {
        name,
        category: activeCategory,
        facetKeys: selectedFacets,
        searchQuery,
      });
      setSavedFilters(next);
      setToastMessage(`'${name}' 조건을 저장했습니다`);
    },
    [savedFilters, activeCategory, selectedFacets, searchQuery]
  );

  const handleApplyFilter = useCallback((filter: SavedFilter) => {
    setActiveCategory(filter.category);
    setSelectedFacets(filter.facetKeys);
    setSearchQuery(filter.searchQuery);
  }, []);

  const handleRemoveFilter = useCallback(
    async (id: string) => {
      setSavedFilters(await removeSavedFilter(savedFilters, id));
    },
    [savedFilters]
  );

  const handleToggleFacet = useCallback((key: string) => {
    setSelectedFacets((prev) =>
      prev.includes(key) ? prev.filter((entry) => entry !== key) : [...prev, key]
    );
  }, []);

  const handleClearFacets = useCallback(() => setSelectedFacets([]), []);
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
  /** 저장소에서 무시 목록을 읽어오기 전에는 배너를 띄우지 않습니다. */
  const ignoredClipboardLoadedRef = useRef(false);

  const selectedItem = items.find((item) => item.id === selectedItemId) ?? items[0] ?? null;

  const saveTargetItem = items.find((item) => item.id === saveTargetItemId) ?? null;
  // 인스타는 "댓글 남기면 DM 드려요"가 붙는 일이 잦아, 뒤따라올 내용이 있을 확률이 높습니다.
  const expectsFollowUp = Boolean(saveTargetItem?.sourceType.startsWith('instagram'));
  const runtimeErrorMessage = errorMessage ?? shareIntentError ?? null;

  // ==========================================
  // 필터링 파이프라인
  // 텍스트/카테고리로 먼저 좁히고, 그 결과 위에 조합 조건을 AND로 얹습니다.
  // facet 건수와 완화 제안도 같은 기준 집합에서 계산해야 화면과 숫자가 어긋나지 않습니다.
  // ==========================================
  const facetIndex = useMemo(() => buildFacetIndex(items, taxonomy), [items, taxonomy]);

  const tabOptions = useMemo(
    () => buildTabOptions(facetIndex, taxonomy, pinnedTabs),
    [facetIndex, taxonomy, pinnedTabs]
  );

  /**
   * 시트에 세울 분야. 글이 없는 것까지 담습니다.
   *
   * 탭은 글이 있는 분야만 세웁니다. 한 번도 안 쓴 분야가 자리를 차지하면 안 되니까요.
   * 그런데 그 규칙을 시트에까지 적용하면, 마지막 한 건을 다른 데로 옮긴 분야가 화면
   * 어디에도 안 남습니다. 이름을 고칠 수도, 지울 수도, 글을 도로 넣을 수도 없어집니다.
   *
   * 그래서 탭에 세우는 목록과 시트에 담는 목록을 나눕니다.
   */
  const sheetOptions = useMemo(() => {
    const seen = new Set(tabOptions.map((option) => option.key));
    const empties: TabOption[] = [];

    for (const domain of taxonomy.domains.values()) {
      if (seen.has(domain.key) || domain.key === OTHER_TAB_KEY) continue;
      empties.push({ key: domain.key, label: getCategoryLabel(domain.key, domain.label), count: 0 });
    }

    empties.sort((a, b) => a.label.localeCompare(b.label));

    // 미분류는 늘 끝자리를 지킵니다. 빈 분야가 그 뒤로 가면 안 됩니다.
    const otherIndex = tabOptions.findIndex((option) => option.key === OTHER_TAB_KEY);
    if (otherIndex < 0) return [...tabOptions, ...empties];
    return [...tabOptions.slice(0, otherIndex), ...empties, tabOptions[otherIndex]];
  }, [tabOptions, taxonomy]);

  const visibleTabs = useMemo(
    () => resolveVisibleTabs(tabOptions, pinnedTabs, activeCategory),
    [tabOptions, pinnedTabs, activeCategory]
  );

  // 보고 있던 분야가 비면 전체로 돌아옵니다. 마지막 항목을 지우거나 분류를 옮기면
  // 그 탭은 사라지는데, 그 상태로 두면 아무것도 없는 화면에 갇힙니다.
  useEffect(() => {
    if (!activeCategory) return;
    if (tabOptions.some((option) => option.key === activeCategory)) return;
    setActiveCategory('');
  }, [activeCategory, tabOptions]);

  const baseItems = useMemo(
    () =>
      filterItems(items, searchQuery).filter((item) =>
        matchesCategoryTab(facetIndex, item, activeCategory)
      ),
    [items, searchQuery, activeCategory, facetIndex]
  );

  const baseIds = useMemo(
    () => new Set(baseItems.map((item) => item.id)),
    [baseItems]
  );

  const filteredItems = useMemo(() => {
    if (selectedFacets.length === 0) return baseItems;
    const allowed = selectByFacets(facetIndex, selectedFacets, baseIds);
    return baseItems.filter((item) => allowed.has(item.id));
  }, [baseItems, baseIds, facetIndex, selectedFacets]);

  const facetOptions = useMemo(
    () => availableFacets(facetIndex, selectedFacets, baseIds),
    [facetIndex, selectedFacets, baseIds]
  );

  const relaxations = useMemo(
    () => suggestRelaxations(facetIndex, selectedFacets, baseIds),
    [facetIndex, selectedFacets, baseIds]
  );

  /**
   * 결과를 죽인 원인이 조건이 아니라 검색어일 수도 있습니다.
   * 검색어만 뺐을 때의 건수를 미리 계산해 0건 화면에서 함께 제안합니다.
   */
  const withoutSearchCount = useMemo(() => {
    if (!searchQuery.trim()) return 0;
    const withoutSearch = filterItems(items, '').filter((item) =>
      matchesCategoryTab(facetIndex, item, activeCategory)
    );
    const ids = new Set(withoutSearch.map((item) => item.id));
    return selectByFacets(facetIndex, selectedFacets, ids).size;
  }, [items, activeCategory, searchQuery, facetIndex, selectedFacets]);

  /**
   * 결과를 죽인 것이 분야일 수도 있습니다.
   *
   * 없어진 분야를 가리키는 저장된 조건을 누르면 0건이 나오는데, 분야는 뺄 수 있는
   * 조건으로 제안되지 않아 화면에서 빠져나올 길이 없었습니다. 검색어와 같은 방식으로
   * 분야만 풀었을 때의 건수를 미리 셉니다.
   */
  const withoutCategoryCount = useMemo(() => {
    if (!activeCategory) return 0;
    const ids = new Set(filterItems(items, searchQuery).map((item) => item.id));
    return selectByFacets(facetIndex, selectedFacets, ids).size;
  }, [items, activeCategory, searchQuery, facetIndex, selectedFacets]);

  /**
   * 입력한 낱말이 알려진 조건과 정확히 일치하면 칩으로 승격시킵니다.
   * 사용자는 "강원도 수영장"이라고 치기만 하면 조합 검색을 쓰게 됩니다.
   */
  const handleSearchChange = useCallback(
    (text: string) => {
      const parsed = parseQueryToFacets(facetIndex, text);
      if (parsed.facetKeys.length > 0) {
        setSelectedFacets((prev) => {
          const next = [...prev];
          for (const key of parsed.facetKeys) {
            if (!next.includes(key)) next.push(key);
          }
          return next;
        });
        setSearchQuery(parsed.rest);
        return;
      }
      setSearchQuery(text);
    },
    [facetIndex]
  );

  // ==========================================
  // 클립보드 감지
  // ==========================================
  useEffect(() => {
    void (async () => {
      try {
        ignoredClipboardRef.current = await getSettingAsync(IGNORED_CLIPBOARD_KEY);
      } catch (error) {
        console.log('[Clipboard] 무시 기록을 불러오지 못했습니다.', error);
      } finally {
        ignoredClipboardLoadedRef.current = true;
        void checkClipboard();
      }
    })();
  }, []);

  useEffect(() => {
    void checkClipboard();
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active') void checkClipboard();
    });
    return () => sub.remove();
  }, [items]);

  // 백그라운드에 있는 동안에는 재시도 타이머가 미뤄지거나 죽고, AI 보강은
  // 아예 프로세스와 함께 사라집니다. 돌아왔을 때 양쪽 다 이어가야 합니다.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState !== 'active') return;
      void resumeSync();
      void resumeEnrich();
    });
    return () => sub.remove();
  }, [resumeEnrich, resumeSync]);

  async function checkClipboard() {
    /*
     * 브라우저에서는 클립보드를 몰래 들여다볼 수 없습니다.
     *
     * `getStringAsync`는 웹에서 `navigator.clipboard.readText()`가 되는데,
     * 사파리는 그때마다 '붙여넣기' 확인 버튼을 띄웁니다. 이 검사는 화면이
     * 돌아올 때와 `items`가 바뀔 때마다 돌아서, 저장을 누를 때마다 목록이
     * 갱신되고 그 확인 버튼이 같이 떴습니다.
     *
     * 클립보드를 미리 알려주는 건 편의일 뿐인데 그 대가로 저장할 때마다
     * 손이 하나 더 갑니다. 웹에서는 접습니다. 붙여넣기는 수집 창에서
     * 직접 하면 되고, 그건 사용자의 동작이라 확인 버튼도 뜨지 않습니다.
     */
    if (Platform.OS === 'web') return;

    // 무시 기록을 읽기 전에 검사하면 이미 거절한 내용이 잠깐 다시 뜹니다.
    if (!ignoredClipboardLoadedRef.current) return;

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

    // 이미지 공유 (스크린샷 등)
    const sharedImagePath = pickSharedImagePath(shareIntent.files as any);
    if (!sharedInput && sharedImagePath) {
      if (processedShareSignatureRef.current === currentSignature) return;
      processedShareSignatureRef.current = currentSignature;
      clearError();

      void (async () => {
        // 스크린샷도 링크와 같은 길로 보냅니다. 인스타 DM은 복사도 전달도 안 되어
        // 화면을 찍는 것이 유일한 통로인데, 여기서 곧바로 새 항목을 만들어버리면
        // 릴스와 DM이 또 둘로 쪼개집니다.
        const result = await saveImage(sharedImagePath, 'share', { deferEnrich: true });
        if (result.ok) {
          const nextId = useAppStore.getState().selectedItemId;
          if (nextId) setSaveTargetItemId(nextId);
        }
        resetShareIntent();
      })();
      return;
    }

    if (hasUnsupportedSharedFiles(shareIntent)) {
      if (processedShareSignatureRef.current === currentSignature) return;
      processedShareSignatureRef.current = currentSignature;
      setToastMessage('이 형식은 아직 지원하지 않습니다. 링크·텍스트·이미지를 공유해 주세요.');
      resetShareIntent();
      return;
    }

    if (!sharedInput) return;
    if (processedShareSignatureRef.current === currentSignature) return;

    processedShareSignatureRef.current = currentSignature;
    clearError();

    // 공유 인텐트가 오면 자동으로 저장
    void (async () => {
      // 저장을 먼저 끝냅니다. 이어지는 선택 화면에서 뒤로 가거나 앱이 죽어도
      // 공유한 내용이 사라지면 안 됩니다.
      const result = await saveUrl(sharedInput, 'share', { deferEnrich: true });
      if (result.ok) {
        // 여기서 '저장됨'을 알리지 않습니다. 아직 확정 전이고, 닫으면 취소됩니다.
        // 선택이 끝난 뒤에 그 결과를 알립니다.
        const nextId = useAppStore.getState().selectedItemId;
        if (nextId) setSaveTargetItemId(nextId);
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

  /**
   * 수집 창의 저장.
   *
   * 사진이 있으면 첫 장으로 아이템을 만들고 나머지는 조각으로 붙입니다.
   * 정리를 켜뒀으면 첫 장에서는 미루고(deferEnrich) 붙이기가 끝난 뒤 한 번만
   * 종합합니다. 장마다 돌리면 AI 호출이 장 수만큼 늘어납니다.
   */
  async function handleSaveFromCapture(
    input: string,
    options: { skipAi: boolean; imageUris: string[] }
  ) {
    const [firstImage, ...restImages] = options.imageUris;

    if (firstImage) {
      const result = await saveImage(firstImage, 'gallery', {
        skipAi: options.skipAi,
        title: input,
        deferEnrich: !options.skipAi && restImages.length > 0,
      });
      if (!result.ok) return result;

      const itemId = useAppStore.getState().selectedItemId;
      if (itemId && restImages.length > 0) {
        await attachScreenshotsToItem(itemId, restImages, { skipAi: options.skipAi });
      }

      setToastMessage(
        options.skipAi ? '수집함에 담았습니다' : '수집함에 저장됨 · 내용을 읽는 중입니다'
      );
      if (itemId) {
        setHighlightedItemId(itemId);
        if (!isWideLayout) setIsDetailVisible(true);
      }
      return result;
    }

    const result = await saveUrl(input, 'manual', { skipAi: options.skipAi });
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
    if (clipboardCandidate) {
      ignoredClipboardRef.current = clipboardCandidate;
      void setSettingAsync(IGNORED_CLIPBOARD_KEY, clipboardCandidate).catch((error) => {
        console.log('[Clipboard] 무시 기록 저장에 실패했습니다.', error);
      });
    }
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
      const theme = getSourceTheme(item.sourceType, mode);
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
    [selectedItem?.id, highlightedItemId, mode, styles]
  );

  const keyExtractor = useCallback((item: SavedItem) => item.id, []);

  // ==========================================
  // 렌더링
  // ==========================================
  // 아래쪽 안전영역은 여기서 주지 않습니다. 여기서 밀어두면 화면 바닥에 붙는
  // 것들(FAB, 바텀시트)이 이미 밀려난 자리를 기준으로 또 밀려나, 얼마나 띄워야
  // 하는지 각자 계산할 수 없게 됩니다. 필요한 쪽이 직접 안전영역을 씁니다.
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      {/* 아이폰 사파리는 설치 안내를 스스로 띄우지 않습니다. 직접 알려줍니다. */}
      <InstallHintBanner />

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
          <Text style={styles.headerLogo}>시렁</Text>
        </View>
        <View style={styles.headerRight}>
          {/* 계정이 없어서 이 기기가 유일한 보관처입니다. 백업 창구를 눈에 띄는 곳에 둡니다. */}
          <Pressable
            onPress={() => setIsBackupVisible(true)}
            accessibilityLabel="백업"
            style={({ pressed }) => [
              styles.themeToggle,
              { transform: [{ scale: pressed ? 0.9 : 1 }] },
            ]}
          >
            <Text style={styles.themeToggleIcon}>📦</Text>
          </Pressable>
          <Pressable
            onPress={() => setToastMessage(THEME_TOASTS[cyclePreference()])}
            accessibilityLabel={`테마 전환 (현재 ${THEME_LABELS[preference]})`}
            style={({ pressed }) => [
              styles.themeToggle,
              { transform: [{ scale: pressed ? 0.9 : 1 }] },
            ]}
          >
            <Text style={styles.themeToggleIcon}>{THEME_ICONS[preference]}</Text>
          </Pressable>
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
              searchQuery={searchQuery}
              onSearchChange={handleSearchChange}
              activeCategory={activeCategory}
              onCategoryChange={handleCategoryChange}
              selectedFacets={selectedFacets}
              onToggleFacet={handleToggleFacet}
              onClearFacets={handleClearFacets}
              facetOptions={facetOptions}
              savedFilters={savedFilters}
              onApplyFilter={handleApplyFilter}
              onRemoveFilter={handleRemoveFilter}
              onSaveFilter={handleSaveFilter}
              tabs={visibleTabs}
              hasHiddenTabs={tabOptions.length > visibleTabs.length}
              onOpenTabPicker={() => {
                setManageDomainKey(null);
                setIsTabPickerVisible(true);
              }}
              onManageTab={handleManageTab}
              canSaveFilter={isFilterSaveable(activeCategory, selectedFacets, searchQuery)}
              describeFacetKey={(key) => {
                const parsed = parseFacetKey(key);
                return parsed ? facetLabel(parsed.axis, parsed.value) : key;
              }}
              describeCategoryKey={(key) =>
                getCategoryLabel(key, resolveDomainLabel(taxonomy, key))
              }
            />
          </View>

          <View style={styles.listHeader}>
            <Text style={styles.listTitle}>수집함</Text>
            <View style={styles.listHeaderRight}>
              <Pressable
                onPress={() => setIsPantryVisible(true)}
                style={({ pressed }) => [
                  styles.pantryBtn,
                  { transform: [{ scale: pressed ? 0.95 : 1 }] },
                ]}
              >
                <Text style={styles.pantryBtnText}>🧺 냉장고 털기</Text>
              </Pressable>
              <Text style={styles.listCount}>{filteredItems.length}건</Text>
            </View>
          </View>

          {isInitializing ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator color={palette.accent} />
              <Text style={styles.loadingText}>로딩 중...</Text>
            </View>
          ) : filteredItems.length === 0 ? (
            <EmptyResultGuide
              isCollectionEmpty={items.length === 0}
              hasConditions={selectedFacets.length > 0 || Boolean(activeCategory)}
              relaxations={relaxations}
              searchQuery={searchQuery}
              withoutSearchCount={withoutSearchCount}
              categoryLabel={
                activeCategory
                  ? getCategoryLabel(activeCategory, resolveDomainLabel(taxonomy, activeCategory))
                  : ''
              }
              withoutCategoryCount={withoutCategoryCount}
              onDropFacet={handleToggleFacet}
              onClearSearch={() => setSearchQuery('')}
              onClearCategory={() => setActiveCategory('')}
              onClearAll={() => {
                handleClearFacets();
                setSearchQuery('');
                setActiveCategory('');
              }}
            />
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
        onPickImages={handlePickImages}
        visible={isCaptureVisible}
        onClose={() => setIsCaptureVisible(false)}
        onSave={handleSaveFromCapture}
        isSaving={isSaving}
        initialValue={captureInitialValue}
      />

      {/* 공유 직후: 새로 저장할지, 기존에 합칠지, 덧붙일 내용을 기다릴지 */}
      <SaveTargetModal
        visible={saveTargetItem !== null}
        savedItemId={saveTargetItem?.id ?? null}
        items={items}
        expectsFollowUp={expectsFollowUp}
        onKeepAsNew={() => {
          const target = saveTargetItem;
          setSaveTargetItemId(null);
          if (!target) return;
          setHighlightedItemId(target.id);
          setToastMessage('수집함에 저장됨');
          void resolveAwaitingInput(target.id);
        }}
        onCancel={() => {
          const target = saveTargetItem;
          setSaveTargetItemId(null);
          if (!target) return;
          // 시트가 뜨기 전에 이미 저장해뒀습니다. 그래야 보는 도중 앱이 죽어도
          // 공유한 내용이 사라지지 않습니다. 취소는 그걸 되돌리는 일입니다.
          void deleteItem(target.id);
          setToastMessage('저장하지 않았습니다');
        }}
        onWaitForMore={() => {
          // 저장은 이미 awaiting_input 상태입니다. 그대로 두면 됩니다.
          const target = saveTargetItem;
          setSaveTargetItemId(null);
          if (target) setHighlightedItemId(target.id);
          setToastMessage('내용을 붙일 때까지 정리를 미룹니다');
        }}
        onMergeInto={(targetItemId) => {
          const source = saveTargetItem;
          setSaveTargetItemId(null);
          if (!source) return;
          void (async () => {
            const merged = source.imageUri
              ? await attachScreenshotsToItem(targetItemId, [source.imageUri])
              : await attachSourceToItem(targetItemId, source.rawInput);
            if (merged.ok) {
              // 합쳤으니 방금 만든 임시 항목은 남길 이유가 없습니다.
              await deleteItem(source.id);
              setToastMessage('기존 저장물에 합쳤습니다');
              setHighlightedItemId(targetItemId);
            } else {
              setToastMessage(merged.message ?? '합치지 못했습니다');
              void resolveAwaitingInput(source.id);
            }
          })();
        }}
      />

      {/* 백업 (내보내기 / 가져오기) */}
      <BackupModal
        visible={isBackupVisible}
        itemCount={items.length}
        onClose={() => setIsBackupVisible(false)}
        onImported={() => void reloadItems()}
      />

      {/* 분야 전체 보기. 탭에 못 세운 것들이 갈 자리입니다. */}
      <TabPickerModal
        visible={isTabPickerVisible}
        options={sheetOptions}
        activeKey={activeCategory}
        pinned={pinnedTabs}
        manageKey={manageDomainKey}
        onSelect={setActiveCategory}
        onTogglePin={(key) => void handleTogglePinnedTab(key)}
        onRename={(key, label) => void handleRenameDomain(key, label)}
        onMerge={(from, into) => handleMergeDomains(from, into)}
        onDelete={handleDeleteDomain}
        onCreate={(label) => void handleCreateDomain(label)}
        onClose={handleCloseTabPicker}
      />

      {/* 냉장고 털기 (보유 재료 -> 만들 수 있는 것) */}
      <PantryModal
        visible={isPantryVisible}
        items={items}
        owned={pantryOwned}
        onChangeOwned={handleChangePantry}
        onClose={() => setIsPantryVisible(false)}
        onSelectItem={(itemId) => {
          setIsPantryVisible(false);
          handleSelectItem(itemId);
        }}
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
const createStyles = (palette: Palette) =>
  StyleSheet.create({
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
    gap: spacing[2],
  },
  themeToggle: {
    width: 32,
    height: 32,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  themeToggleIcon: {
    fontSize: 14,
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
  syncDotPending: { backgroundColor: palette.pending },
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
    color: palette.warnText,
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
    color: palette.infoText,
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
  listHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  pantryBtn: {
    backgroundColor: palette.surfaceRaised,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  pantryBtnText: {
    color: palette.textSecondary,
    fontSize: 10.5,
    fontWeight: '900',
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
