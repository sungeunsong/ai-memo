import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';

import { SavedItem } from '@/features/items/types';
import { readContentV2 } from '@/features/items/contentV2';
import { DomainSection, FactRow, buildDomainSections, factValues, legacyText } from '@/features/items/factView';
import { OTHER_TAB_KEY } from '@/features/facets/tabs';
import { useKeyboardHeight } from '@/hooks/useKeyboardHeight';
import { TaxonomyRegistry, resolveDomainLabel } from '@/features/taxonomy/registry';
import { resolveImageUri } from '@/features/capture/imageCapture';
import { isEnrichStalled } from '@/features/items/staleEnrich';
import { StatusPills } from '@/components/StatusBadges';
import { useAppStore } from '@/store';
import { getHostname } from '@/features/items/fallback';
import {
  formatReadableDate,
  formatRelativeTime,
  getSourceTheme,
  getCategoryLabel,
  getItemCategory,
  SOURCE_KIND_LABELS,
  describeSourceBody,
  getItemTitle,
  getSyncStatusLabel,
  truncateMiddle,
  shouldShowRawInputFirst,
  describeSavedItemShape,
} from '@/utils/formatters';
import { parseActionItems, ActionItem } from '@/utils/actionParser';
import * as WebBrowser from 'expo-web-browser';
import DateTimePicker from '@react-native-community/datetimepicker';

import { ReaderModeModal } from '@/components/ReaderModeModal';
import { MarkdownViewer } from '@/components/MarkdownViewer';
import { StructuredText } from '@/components/StructuredText';
import { Palette } from '@/theme/palette';
import { useTheme, useThemedStyles } from '@/theme/ThemeContext';
import { spacing } from '@/theme/spacing';

type Props = {
  item: SavedItem;
  checkedItems: Record<string, Record<string, boolean>>;
  onToggleCheck: (itemId: string, key: string) => void;
  onClose: () => void;
  onDelete?: (itemId: string) => void;
};

/**
 * 상세는 화면을 꽉 채웁니다.
 *
 * 바텀시트로 92%만 덮으면 위쪽에 남은 목록이 계속 눈에 걸리고,
 * 정작 읽어야 할 본문은 좁아집니다. 저장해둔 걸 읽는 게 이 화면의 목적이라
 * 목록으로 돌아가는 길(뒤로가기 / ← 버튼)만 분명하면 전체 화면이 낫습니다.
 *
 * Modal의 onRequestClose가 안드로이드 하드웨어 뒤로가기를 받아
 * 앱 종료 대신 이 화면만 닫습니다.
 */
export function DetailScreen({ item, checkedItems, onToggleCheck, onClose, onDelete }: Props) {
  const styles = useThemedStyles(createStyles);
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.fullScreen} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable
            onPress={onClose}
            hitSlop={10}
            accessibilityLabel="목록으로 돌아가기"
            style={({ pressed }) => [
              styles.backBtn,
              { transform: [{ scale: pressed ? 0.9 : 1 }] },
            ]}
          >
            <Text style={styles.backBtnText}>←</Text>
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {getItemTitle(item)}
          </Text>
        </View>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <DetailContent
            selectedItem={item}
            checkedItems={checkedItems}
            onToggleCheck={onToggleCheck}
            onDelete={onDelete}
          />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ==========================================
// 상세 내용 (인라인 상세뷰에서도 재사용)
// ==========================================
export function DetailContent({
  selectedItem,
  checkedItems,
  onToggleCheck,
  onDelete,
}: {
  selectedItem: SavedItem;
  checkedItems: Record<string, Record<string, boolean>>;
  onToggleCheck: (itemId: string, key: string) => void;
  onDelete?: (itemId: string) => void;
}) {
  const { palette, mode } = useTheme();
  const styles = useThemedStyles(createStyles);
  const theme = getSourceTheme(selectedItem.sourceType, mode);
  const itemCategory = getItemCategory(selectedItem);
  const [userNoteInput, setUserNoteInput] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isMetaExpanded, setIsMetaExpanded] = useState(false);
  const [isReaderVisible, setIsReaderVisible] = useState(false);
  const taxonomy = useAppStore((state) => state.taxonomy);
  const updateUserNote = useAppStore((state) => state.updateUserNote);
  const retryEnrichMetadata = useAppStore((state) => state.retryEnrichMetadata);
  const isSaving = useAppStore((state) => state.isSaving);
  const setItemTitle = useAppStore((state) => state.setItemTitle);
  const attachSourceToItem = useAppStore((state) => state.attachSourceToItem);
  const attachScreenshotsToItem = useAppStore((state) => state.attachScreenshotsToItem);
  const detachSourceFromItem = useAppStore((state) => state.detachSourceFromItem);
  const resolveAwaitingInput = useAppStore((state) => state.resolveAwaitingInput);
  const setItemCategory = useAppStore((state) => state.setItemCategory);
  const [isCategoryPickerVisible, setIsCategoryPickerVisible] = useState(false);
  const [isDeadlineEditorVisible, setIsDeadlineEditorVisible] = useState(false);
  /*
   * 조각 목록을 펼쳤는지.
   *
   * 기본은 접힘입니다. 예전에는 조각이 하나면 숨기고 둘 이상이면 다 세웠는데,
   * 첫 조각은 헤더가 이미 그리고 있어서 나름의 이유는 있었지만 보는 사람에게는
   * 규칙이 보이지 않았습니다. 개수와 상관없이 늘 접어두고, 펼치면 전부 나옵니다.
   */
  const [isSourceListOpen, setIsSourceListOpen] = useState(false);
  const setItemDeadline = useAppStore((state) => state.setItemDeadline);

  useEffect(() => {
    setUserNoteInput(selectedItem.userNote ?? '');
  }, [selectedItem.id, selectedItem.userNote]);

  // 다른 글로 넘어가면 다시 접습니다. 펼친 채로 넘어가면 이 글도 조각이 많은
  // 줄 알고 봅니다.
  useEffect(() => {
    setIsSourceListOpen(false);
  }, [selectedItem.id]);

  async function handleSaveUserNote() {
    await updateUserNote(selectedItem.id, userNoteInput);
    setToastMessage('메모가 저장되었습니다.');
  }

  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(null), 1800);
    return () => clearTimeout(t);
  }, [toastMessage]);

  const content = readContentV2(selectedItem.content);

  // 원격 썸네일은 그대로, 우리가 보관한 이미지는 그릴 수 있는 주소로 바꿉니다.
  const thumbnailUri = resolveImageUri(selectedItem.thumbnailUrl);

  // 화면은 사전이 알려주는 대로 그립니다. 분야마다 카드를 따로 두면
  // 목록에 없는 분야는 아무것도 보이지 않습니다.
  const factSections = useMemo(() => {
    if (!content) return [];

    // 마감은 아래 카드가 따로 그립니다. 여기서도 한 줄 세우면 같은 날짜가 두 번
    // 나오고, 그중 하나는 눌러도 아무 일이 없어 사용자가 어느 쪽을 믿을지 헷갈립니다.
    return buildDomainSections(content, taxonomy)
      .map((section) => ({
        ...section,
        rows: section.rows.filter((row) => row.role !== 'deadline'),
      }))
      .filter((section) => section.rows.length > 0);
  }, [content, taxonomy]);

  // 마감은 따로 뺍니다. 사용자가 직접 고칠 수 있고 지났는지도 알려줘야 해서,
  // 값 하나를 그대로 보여주는 다른 항목과 다루는 방식이 다릅니다.
  const aiDeadline = factValues(content, 'shopping', 'deadline')[0] ?? '';

  // 본문은 contentText 컬럼으로 분리됐습니다.
  // legacy.description은 분리 이전에 저장된 아이템을 위한 호환 경로입니다.
  const readerMarkdown: string = selectedItem.contentText || legacyText(content, 'description');

  /**
   * 요약 자리에 무엇을 보여줄지.
   *
   * AI가 실패했는데 summary(대개 og:description 원문)를 조용히 채워 넣으면
   * 사용자는 그걸 AI 결과로 착각합니다. 실제로 정리본이 있는 것과
   * 원문이 그대로 들어간 것이 화면에서 구분되지 않았습니다.
   * 실패했으면 정리본 자리를 비우고, 아래 실패 사유 박스가 이유를 말하게 합니다.
   */
  const aiFailed = selectedItem.aiStatus === 'failed';

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [sourceDraft, setSourceDraft] = useState('');
  const [isAttaching, setIsAttaching] = useState(false);
  /**
   * 크게 볼 스크린샷.
   *
   * 글자는 AI가 읽어 요약에 넣지만, 그 읽기가 틀릴 수 있습니다. 가격이나
   * 전화번호처럼 숫자가 섞인 곳이 특히 그렇습니다. 원본을 확인할 수 없으면
   * 보관하는 의미가 없습니다.
   */
  const [expandedImageUri, setExpandedImageUri] = useState<string | null>(null);

  const isAwaitingInput = selectedItem.aiStatus === 'awaiting_input';
  /** 사용자가 정리를 안 돌리기로 하고 담아둔 것. 아직 한 번도 정리하지 않았습니다. */
  const isSkipped = selectedItem.aiStatus === 'skipped';

  /**
   * 조각을 뗄지 확인받습니다.
   *
   * 떼면 남은 것 기준으로 AI 정리가 곧바로 다시 돌아갑니다. 되돌릴 수 없고
   * AI 호출도 한 번 나가므로, 누르자마자 진행되면 놀랍니다.
   */
  function confirmDetachSource(sourceId: string) {
    Alert.alert(
      '출처 떼기',
      '이 내용을 떼면 남은 내용만으로 정리를 다시 만듭니다. 계속할까요?',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '떼고 다시 정리',
          style: 'destructive',
          onPress: () => {
            void detachSourceFromItem(sourceId);
            setToastMessage('출처를 떼고 다시 정리합니다');
          },
        },
      ]
    );
  }

  /**
   * 스크린샷을 골라 붙입니다.
   *
   * 인스타 DM은 길게 눌러도 복사·전달이 없습니다. 화면을 찍는 것이 유일한 통로라
   * 이 버튼이 사실상 DM을 담는 기본 경로입니다.
   */
  async function pickScreenshot() {
    if (isAttaching) return;

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setToastMessage('사진 접근 권한이 필요합니다.');
      return;
    }

    // 긴 DM은 한 화면에 안 들어와 여러 장으로 나눠 찍게 됩니다.
    // 한 장씩 고르게 하면 장마다 재정리가 돌아 기다려야 합니다.
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: 5,
      quality: 1,
    });
    if (picked.canceled || !picked.assets?.length) return;

    setIsAttaching(true);
    try {
      const uris = picked.assets.map((asset) => asset.uri);
      const result = await attachScreenshotsToItem(selectedItem.id, uris);

      if (result.added > 0) {
        setToastMessage(
          `스크린샷 ${result.added}장을 읽어 함께 정리합니다` +
            (result.skipped > 0 ? ` (${result.skipped}장은 이미 붙어 있음)` : '')
        );
      } else {
        setToastMessage(result.message ?? '이미 붙어 있는 스크린샷입니다');
      }
    } finally {
      setIsAttaching(false);
    }
  }

  async function commitSource() {
    const text = sourceDraft.trim();
    if (!text || isAttaching) return;

    setIsAttaching(true);
    try {
      const result = await attachSourceToItem(selectedItem.id, text);
      if (result.ok) {
        setSourceDraft('');
        setToastMessage('내용을 붙이고 다시 정리합니다');
      } else {
        setToastMessage(result.message ?? '붙이지 못했습니다');
      }
    } finally {
      setIsAttaching(false);
    }
  }

  function startEditingTitle() {
    setTitleDraft(getItemTitle(selectedItem));
    setIsEditingTitle(true);
  }

  async function commitTitle() {
    setIsEditingTitle(false);
    // 원래 제목 그대로면 굳이 사용자 값으로 고정하지 않습니다.
    // 그래야 나중에 재분석했을 때 나아진 AI 제목을 다시 받을 수 있습니다.
    const next = titleDraft.trim();
    if (next === getItemTitle(selectedItem)) return;
    await setItemTitle(selectedItem.id, next);
  }

  // 'pending'을 곧 '진행 중'으로 읽으면, 앱이 꺼져 끊긴 보강도 진행 중으로 보입니다.
  // 그 상태에서 재분석까지 막으면 되살릴 방법이 사라집니다.
  const isEnriching = selectedItem.aiStatus === 'pending' && !isEnrichStalled(selectedItem);
  const summaryBody: string = (
    selectedItem.digest ||
    legacyText(content, 'detailedAnalysis') ||
    (aiFailed ? '' : selectedItem.summary) ||
    ''
  ).trim();

  /**
   * 원본은 인앱 브라우저(Android Chrome Custom Tab)로 엽니다.
   * Linking.openURL은 브라우저 앱을 별도 태스크로 띄워서 돌아오려면 앱 전환을 해야 합니다.
   * 저장해둔 것을 훑어보는 흐름에서는 뒤로가기 한 번에 목록으로 복귀하는 편이 훨씬 낫습니다.
   * 실패하면 기존 방식으로 폴백합니다.
   */
  function openOriginal(url: string) {
    WebBrowser.openBrowserAsync(url).catch(() => {
      Linking.openURL(url).catch(() => {});
    });
  }
  /**
   * 눌러서 열 수 있는 링크 전부.
   *
   * 예전에는 저장할 때 원문에서 뽑아둔 것만 보여줬습니다. 나중에 조각으로 붙인
   * 링크는 어디에도 안 나와서, 요약이 부족할 때 원문으로 갈 방법이 없었습니다.
   * 릴스에 노션을 붙여놓고 노션을 못 여는 상태였습니다.
   */
  const openableUrls = useMemo(() => {
    const urls = [...(selectedItem.extractedUrls ?? [])];
    for (const source of selectedItem.sources) {
      if (source.sourceUrl && !urls.includes(source.sourceUrl)) {
        urls.push(source.sourceUrl);
      }
    }

    /*
     * 헤더가 이미 여는 대표 링크는 뺍니다.
     *
     * 이 카드는 '릴스에 노션을 붙였는데 노션을 열 방법이 없다'를 풀려고 만든
     * 자리입니다. 그런데 아이템의 대표 링크는 바로 위 헤더의 '원본 열기'가
     * 같은 일을 합니다. 그것까지 세우면 링크 하나만 저장한 글에서 같은 주소가
     * 두 번 보입니다. 붙인 조각의 링크는 남깁니다. 조각 목록은 접혀 있어서,
     * 펼치지 않고 여는 길이 여기여야 하기 때문입니다.
     */
    return urls.filter((url) => url !== selectedItem.sourceUrl);
  }, [selectedItem.extractedUrls, selectedItem.sources, selectedItem.sourceUrl]);

  /** 접힌 줄에 적는 조각 종류. 무엇으로 이뤄졌는지는 펼치지 않아도 보여야 합니다. */
  const sourceKindSummary = useMemo(
    () =>
      selectedItem.sources
        .map((source) => SOURCE_KIND_LABELS[source.kind] ?? source.kind)
        .join(' · '),
    [selectedItem.sources]
  );

  const actions = parseActionItems(
    selectedItem.rawInput,
    selectedItem.userNote ?? undefined,
    factValues(content, 'recipe', 'ingredient')
  );

  async function handleActionPress(action: ActionItem) {
    if (action.type === 'phone') {
      Linking.openURL(`tel:${action.value}`).catch(() => {
        setToastMessage('전화 걸기를 실행할 수 없습니다.');
      });
    } else if (action.type === 'bank' || action.type === 'ingredients') {
      await Clipboard.setStringAsync(action.value);
      setToastMessage(`${action.type === 'bank' ? '계좌번호가' : '재료 목록이'} 복사되었습니다.`);
    } else if (action.type === 'address') {
      const encodedAddr = encodeURIComponent(action.value);
      const url = `https://map.naver.com/v5/search/${encodedAddr}`;
      Linking.openURL(url).catch(() => {
        Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodedAddr}`).catch(() => {
          setToastMessage('지도 앱을 열 수 없습니다.');
        });
      });
    }
  }

  return (
    <View style={styles.detailCard}>
      {toastMessage ? (
        <View style={styles.toast}>
          <View style={styles.toastDot} />
          <Text style={styles.toastText}>{toastMessage}</Text>
        </View>
      ) : null}

      {/* 1. 헤더 히어로 */}
      <View style={[styles.detailHero, { borderColor: theme.border, backgroundColor: theme.bg }]}>
        <View style={styles.detailHeroText}>
          {/* AI 제목이 늘 마음에 들지는 않습니다. 특히 인스타처럼 원제목이
              쓸모없는 경우가 많아, 직접 고칠 수 있어야 합니다.
              고친 값은 userTitle에 따로 담기므로 재분석해도 덮이지 않습니다. */}
          {isEditingTitle ? (
            <View style={styles.titleEditRow}>
              <TextInput
                autoFocus
                value={titleDraft}
                onChangeText={setTitleDraft}
                onSubmitEditing={commitTitle}
                placeholder="제목을 입력하세요"
                placeholderTextColor={palette.textMuted}
                style={styles.titleInput}
                returnKeyType="done"
                multiline
              />
              <Pressable onPress={commitTitle} hitSlop={8} style={styles.titleEditBtn}>
                <Text style={styles.titleEditBtnText}>완료</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={startEditingTitle}
              style={({ pressed }) => [styles.titleRow, pressed && { opacity: 0.6 }]}
            >
              {/* 이미 저장된 아이템에는 캡션이 통째로 들어간 제목이 남아 있습니다.
                  재분석 전까지는 화면에서라도 막아둡니다. */}
              <Text style={[styles.detailTitle, styles.titleText]} numberOfLines={3}>
                {getItemTitle(selectedItem)}
              </Text>
              <Text style={styles.titleEditIcon}>✏️</Text>
            </Pressable>
          )}
          <Text style={[styles.detailSource, { color: theme.badgeText, fontWeight: '700' }]}>
            {theme.label} · {selectedItem.sourceUrl ? getHostname(selectedItem.sourceUrl) : '로컬'}
          </Text>
          {/* 어느 카테고리로 분류됐는지. 지금까지는 출처만 보여서
              사용자가 분류 결과를 확인할 방법이 없었습니다. */}
          <Pressable
            onPress={() => setIsCategoryPickerVisible(true)}
            style={({ pressed }) => [styles.categoryChip, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.categoryChipText}>
              {getCategoryLabel(itemCategory, resolveDomainLabel(taxonomy, itemCategory))}
              {selectedItem.userCategory ? ' · 직접 지정' : ''} ▾
            </Text>
          </Pressable>
        </View>
        <View style={styles.detailHeroActionsRow}>
          <StatusPills item={selectedItem} />
          {selectedItem.sourceUrl ? (
            <Pressable
              onPress={() => openOriginal(selectedItem.sourceUrl!)}
              style={({ pressed }) => [
                styles.openSourceBtn,
                { transform: [{ scale: pressed ? 0.95 : 1 }] },
              ]}
            >
              <Text style={styles.openSourceBtnText}>원본 열기 🔗</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* 1.5. 🚀 퀵 액션 */}
      {actions.length > 0 ? (
        <View style={styles.actionPanel}>
          <Text style={styles.actionPanelLabel}>🚀 퀵 액션</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.actionScrollContent}
          >
            {actions.map((act, idx) => (
              <Pressable
                key={`${act.type}_${idx}`}
                onPress={() => handleActionPress(act)}
                style={({ pressed }) => [
                  styles.actionChip,
                  { transform: [{ scale: pressed ? 0.95 : 1 }] },
                ]}
              >
                <Text style={styles.actionChipIcon}>{act.icon}</Text>
                <Text style={styles.actionChipText}>{act.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {/* 1.7. 📖 리더 모드 버튼
          인스타그램 제외 조건도 본문을 못 긁던 시절의 잔재입니다.
          지금은 캡션을 가져오므로, 본문이 있으면 보여줍니다. */}
      {readerMarkdown ? (
        <Pressable
          onPress={() => setIsReaderVisible(true)}
          style={({ pressed }) => [
            styles.readerModeBtn,
            { transform: [{ scale: pressed ? 0.96 : 1 }] },
          ]}
        >
          <Text style={styles.readerModeBtnIcon}>📖</Text>
          <Text style={styles.readerModeBtnText}>리더 모드로 본문 읽기</Text>
        </Pressable>
      ) : null}

      {/* 2. 퀵 메모 */}
      <View style={styles.detailSection}>
        <Text style={styles.detailLabel}>퀵 한 줄 메모</Text>
        <View style={styles.noteInputRow}>
          <TextInput
            style={styles.noteInput}
            placeholder="보낸 사람이나 저장 맥락 메모"
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
              { transform: [{ scale: pressed ? 0.94 : 1 }] },
            ]}
          >
            <Text style={styles.noteSaveButtonText}>저장</Text>
          </Pressable>
        </View>
      </View>

      {/* 2.5. 출처(조각) — 릴스에 나중에 받은 DM을 붙이는 자리 */}
      <View style={styles.sourceCard}>
        <View style={styles.summaryHeader}>
          {/*
            제목은 이 카드에서 할 수 있는 일이고, 오른쪽은 지금 몇 조각으로
            이뤄져 있는지입니다. 제목에 개수를 넣었더니 조각이 하나일 때는
            할 일이 안 보이고, 할 일만 적었더니 개수가 안 보였습니다. 둘 다
            필요한 정보라 자리를 나눕니다.
          */}
          <Text style={styles.summaryTitle}>➕ 내용 덧붙이기</Text>
          {/*
            바로 아래 'AI 요약' 카드의 재분석 버튼과 같은 모양을 씁니다. 같은
            자리에 같은 크기로 서는 것이라, 하나가 버튼이면 다른 하나도 버튼으로
            읽힙니다. 색은 중립으로 둡니다 — 이 카드의 주된 일은 덧붙이기고,
            이건 곁들이는 동작입니다.
          */}
          <Pressable
            onPress={() => setIsSourceListOpen((open) => !open)}
            hitSlop={10}
            style={({ pressed }) => [styles.sourceToggle, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.sourceToggleText}>
              🧩 출처 {selectedItem.sources.length || 1}개
            </Text>
            <Text style={styles.sourceToggleCaret}>{isSourceListOpen ? '▴' : '▾'}</Text>
          </Pressable>
        </View>

        {isAwaitingInput ? (
          <Text style={styles.awaitingHint}>
            덧붙일 내용을 기다리는 중입니다. 아래에 붙여넣으면 함께 정리합니다.
          </Text>
        ) : isSourceListOpen ? null : selectedItem.sources.length > 1 ? (
          // 접힌 채로도 무엇이 붙어 있는지는 알 수 있어야 합니다.
          <Text style={styles.sourceKinds}>{sourceKindSummary}</Text>
        ) : (
          // 아직 아무것도 안 붙인 상태. 조각 이름을 적어봐야 헤더에 이미 있는
          // 말이라, 그 자리는 붙일 수 있다는 걸 알리는 데 씁니다. 이 앱의 핵심
          // 동작인데 모르면 릴스 하나짜리 절반에서 끝납니다.
          <Text style={styles.awaitingHint}>
            인스타 DM 스크린샷이나 링크를 붙이면 이 글과 함께 다시 정리합니다.
          </Text>
        )}

        {(isSourceListOpen ? selectedItem.sources : []).map((source) => {
          const sourceImageUri = resolveImageUri(source.imageUri);

          return (
            <View key={source.id} style={styles.sourceRow}>
              {sourceImageUri ? (
                <Pressable
                  onPress={() => setExpandedImageUri(sourceImageUri)}
                  style={({ pressed }) => pressed && { opacity: 0.6 }}
                >
                  <Image source={{ uri: sourceImageUri }} style={styles.sourceThumb as any} />
                </Pressable>
              ) : null}
              <View style={styles.sourceRowText}>
                <Text style={styles.sourceKind}>
                  {SOURCE_KIND_LABELS[source.kind] ?? source.kind}
                </Text>
                <Text style={styles.sourceExcerpt} numberOfLines={2}>
                  {describeSourceBody(source)}
                </Text>
                {source.sourceUrl ? (
                  <Pressable onPress={() => openOriginal(source.sourceUrl!)} hitSlop={6}>
                    <Text style={styles.sourceOpenText}>원본 열기 🔗</Text>
                  </Pressable>
                ) : null}
              </View>
              {/* 조각이 하나뿐이면 뗄 수 없습니다. 그건 저장물 자체를 지우는 일입니다. */}
              {selectedItem.sources.length > 1 ? (
                <Pressable
                  onPress={() => confirmDetachSource(source.id)}
                  hitSlop={8}
                  style={({ pressed }) => [styles.sourceRemove, pressed && { opacity: 0.5 }]}
                >
                  <Text style={styles.sourceRemoveText}>떼기</Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}

        <TextInput
          value={sourceDraft}
          onChangeText={setSourceDraft}
          placeholder="링크나 메모를 붙여넣으세요 (인스타 DM은 스크린샷으로)"
          placeholderTextColor={palette.textMuted}
          style={styles.sourceInput}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
        />

        <View style={styles.sourceActions}>
          <Pressable
            disabled={isAttaching}
            onPress={pickScreenshot}
            style={({ pressed }) => [
              styles.sourceSkipBtn,
              (pressed || isAttaching) && { opacity: 0.6 },
            ]}
          >
            <Text style={styles.sourceSkipText}>스크린샷 📷</Text>
          </Pressable>
          {isAwaitingInput ? (
            <Pressable
              onPress={() => void resolveAwaitingInput(selectedItem.id)}
              style={({ pressed }) => [styles.sourceSkipBtn, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.sourceSkipText}>그냥 정리하기</Text>
            </Pressable>
          ) : null}
          <Pressable
            disabled={!sourceDraft.trim() || isAttaching}
            onPress={commitSource}
            style={({ pressed }) => [
              styles.sourceAddBtn,
              (pressed || !sourceDraft.trim() || isAttaching) && { opacity: 0.5 },
            ]}
          >
            {isAttaching ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.sourceAddText}>
              {isAwaitingInput ? '붙이고 정리' : '붙이고 다시 정리'}
            </Text>
            )}
          </Pressable>
        </View>
      </View>

      {/* 3. AI 요약
          예전에는 인스타그램 본문을 긁지 못해 이 카드를 통째로 숨겼습니다.
          지금은 Jina로 캡션을 가져오고 정리본도 만들어지므로 숨길 이유가 없습니다.
          숨겨두면 정리본이 있어도 볼 수 없고, 재분석 버튼도 사라져
          AI가 실패했을 때 되돌릴 방법이 없어집니다. */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryHeader}>
          <Text style={styles.summaryTitle}>✨ AI 요약</Text>
          <Pressable
            disabled={isSaving || isEnriching}
            onPress={async () => {
              await retryEnrichMetadata(selectedItem.id);
              setToastMessage('AI 분석을 다시 요청했습니다.');
            }}
            style={({ pressed }) => [
              styles.reanalyzeBtn,
              (pressed || isSaving || isEnriching) && { opacity: 0.5 },
            ]}
          >
            {isSaving || isEnriching ? (
              <ActivityIndicator size="small" color={palette.accentText} />
            ) : (
              // 아직 한 번도 정리하지 않았는데 '재분석'이라고 하면
              // 이미 정리가 끝난 줄로 읽힙니다.
              <Text style={styles.reanalyzeBtnText}>
                {isAwaitingInput || isSkipped ? '정리하기 ✨' : '재분석 🧪'}
              </Text>
            )}
          </Pressable>
        </View>
        {/* 정리본이 상세 화면의 본문입니다.
            legacy.detailedAnalysis는 digest 컬럼 분리 이전에 저장된 아이템을 위한 호환 경로입니다.
            소제목·불릿을 써서 오라고 프롬프트에 적어놓고 정작 <Text> 하나에 밀어넣고 있었습니다.
            마크다운으로 렌더링해야 그 구조가 화면에 나타납니다. */}
        {isAwaitingInput ? (
          <Text style={styles.summaryValue}>
            아직 정리하지 않았습니다. 위에 덧붙일 내용을 넣고 "붙이고 정리"를 누르거나,
            "그냥 정리하기"를 누르면 지금 있는 내용만으로 정리합니다.
          </Text>
        ) : isSkipped ? (
          /*
           * 정리를 안 하고 담아둔 것.
           *
           * 이 상태로 두면 제목 글자로만 찾힙니다. 재료·지역 같은 조합 검색에는
           * 안 걸린다는 걸 알려줘야, 나중에 안 나온다고 놀라지 않습니다.
           */
          <Text style={styles.summaryValue}>
            정리하지 않고 담아뒀습니다. 지금은 제목으로만 찾힙니다.
            "정리하기"를 누르면 내용을 읽어 검색 조건까지 만듭니다.
          </Text>
        ) : summaryBody ? (
          <MarkdownViewer markdown={summaryBody} />
        ) : (
          <Text style={styles.summaryValue}>
            {aiFailed
              ? '요약을 만들지 못했습니다. 위 재분석 버튼을 눌러 다시 시도할 수 있습니다.'
              : 'AI가 분석을 완료하지 못했거나 요약된 내용이 없습니다.'}
          </Text>
        )}

        {/* 실패했으면 이유를 그대로 보여줍니다.
            폰에서 도는 앱이라 콘솔을 열기 어렵고, 사용자 입장에서도
            "요약이 왜 없지"에 답이 있어야 재분석을 눌러볼 수 있습니다. */}
        {/* 정리는 앱이 떠 있는 동안만 진행됩니다.
            돌아오면 이어서 하지만, 그 사실을 모르면 나갔다 와서 왜 그대로인지 알 수 없습니다. */}
        {isEnriching ? (
          <Text style={styles.enrichHint}>
            앱을 벗어나면 정리가 멈춥니다. 돌아오면 이어서 진행합니다.
          </Text>
        ) : null}

        {selectedItem.aiStatus === 'failed' && selectedItem.aiError ? (
          <View style={styles.aiErrorBox}>
            <Text style={styles.aiErrorLabel}>AI 요약 실패</Text>
            <Text style={styles.aiErrorText}>{selectedItem.aiError}</Text>
          </View>
        ) : null}
      </View>

      {/* 3.5. 원문
          정리본을 먼저 보여주고 원문은 아래에 둡니다.
          이 앱은 정리해서 보여주는 앱이라, 캡션이 위에 있으면 정리한 의미가 없습니다.
          원문은 "AI가 놓친 게 있나" 확인할 때 보는 자리입니다. */}
      {shouldShowRawInputFirst(selectedItem) ? (
        <RawInputSection item={selectedItem} />
      ) : null}

      {/* 4. 사전이 알려주는 대로 그리는 카드 */}
      {factSections.map((section) => (
        <FactCard
          key={section.domainKey}
          section={section}
          selectedItem={selectedItem}
          checkedItems={checkedItems}
          onToggleCheck={onToggleCheck}
        />
      ))}

      {/* 공구는 마감이 지나면 저장해둔 의미가 없어집니다.
          남은 기간을 눈에 띄게 보여주고, 지난 건 분명히 표시합니다.
          AI가 못 뽑았어도 사용자가 직접 넣을 수 있어야 해서 쇼핑 글에는 늘 세웁니다. */}
      {aiDeadline || selectedItem.userDeadline || itemCategory === 'shopping' ? (
        <DeadlineCard
          aiDeadline={aiDeadline}
          userDeadline={selectedItem.userDeadline}
          onEditDeadline={() => setIsDeadlineEditorVisible(true)}
        />
      ) : null}

      {/* 5. 추출된 링크 */}
      {openableUrls.length > 0 ? (
        <View style={styles.detailSection}>
          <Text style={styles.detailLabel}>링크 ({openableUrls.length}개)</Text>
          <View style={styles.extractedUrlsList}>
            {openableUrls.map((url, idx) => (
              <Pressable
                key={url + idx}
                onPress={() => openOriginal(url)}
                style={({ pressed }) => [
                  styles.urlClickableRow,
                  { transform: [{ scale: pressed ? 0.96 : 1 }] },
                ]}
              >
                <Text style={styles.urlClickableNum}>#{idx + 1}</Text>
                <Text style={styles.urlClickableText} numberOfLines={1}>{url}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {/* 6. 썸네일 */}
      {(selectedItem.type === 'url' || selectedItem.type === 'image') && thumbnailUri ? (
        <View style={styles.thumbnailPanel}>
          <Text style={styles.detailLabel}>썸네일</Text>
          {/* 조각이 하나뿐이면 위의 조각 줄을 세우지 않으므로, 스크린샷을 크게 보는
              길이 여기밖에 없습니다. 눌러서 열 수 있어야 합니다. */}
          <Pressable
            onPress={() => setExpandedImageUri(thumbnailUri)}
            style={({ pressed }) => [styles.thumbnailPreview, pressed && { opacity: 0.7 }]}
          >
            <Image
              source={{ uri: thumbnailUri }}
              style={styles.thumbnailImage as any}
              resizeMode="cover"
            />
          </Pressable>
        </View>
      ) : null}

      {/* 7. 기술 상세 (접이식) */}
      <View style={styles.collapsibleArea}>
        <Pressable
          onPress={() => setIsMetaExpanded(!isMetaExpanded)}
          style={({ pressed }) => [
            styles.collapsibleHeader,
            { opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={styles.collapsibleHeaderText}>
            {isMetaExpanded ? '기술 메타 정보 접기 ▴' : '기술 메타 정보 보기 ▾'}
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

      {/* 8. 삭제 버튼 */}
      {onDelete ? (
        <Pressable
          onPress={() => onDelete(selectedItem.id)}
          style={({ pressed }) => [
            styles.deleteBtn,
            { transform: [{ scale: pressed ? 0.95 : 1 }] },
          ]}
        >
          <Text style={styles.deleteBtnText}>이 항목 삭제</Text>
        </Pressable>
      ) : null}

      <DeadlineEditor
        visible={isDeadlineEditorVisible}
        current={selectedItem.userDeadline || aiDeadline}
        isManual={Boolean(selectedItem.userDeadline)}
        onClose={() => setIsDeadlineEditorVisible(false)}
        onSubmit={(value) => {
          setIsDeadlineEditorVisible(false);
          void setItemDeadline(selectedItem.id, value);
          setToastMessage(value ? '마감일을 바꿨습니다' : 'AI가 읽은 값으로 되돌렸습니다');
        }}
      />

      <CategoryPicker
        visible={isCategoryPickerVisible}
        current={itemCategory}
        isManual={Boolean(selectedItem.userCategory)}
        taxonomy={taxonomy}
        onClose={() => setIsCategoryPickerVisible(false)}
        onSelect={(category, notice) => {
          setIsCategoryPickerVisible(false);
          void setItemCategory(selectedItem.id, category);
          setToastMessage(
            notice ??
              (category
                ? `${getCategoryLabel(category, resolveDomainLabel(taxonomy, category))}(으)로 변경했습니다`
                : 'AI 분류를 따르도록 되돌렸습니다')
          );
        }}
      />

      {/* 스크린샷 원본. AI가 읽은 글자가 맞는지 눈으로 확인하는 자리입니다. */}
      <Modal
        visible={expandedImageUri !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setExpandedImageUri(null)}
      >
        <Pressable style={styles.imageViewer} onPress={() => setExpandedImageUri(null)}>
          {expandedImageUri ? (
            <Image
              source={{ uri: expandedImageUri }}
              style={styles.imageViewerImage as any}
              resizeMode="contain"
            />
          ) : null}
          <Text style={styles.imageViewerHint}>아무 곳이나 눌러 닫기</Text>
        </Pressable>
      </Modal>

      <ReaderModeModal
        visible={isReaderVisible}
        onClose={() => setIsReaderVisible(false)}
        title={selectedItem.title}
        markdown={readerMarkdown}
      />
    </View>
  );
}

// ==========================================
// 사전이 알려주는 대로 그리는 카드
// ==========================================

/**
 * 분야 하나를 카드로 그립니다.
 *
 * 예전에는 레시피 카드, 여행 카드가 따로 있었고 각자 자기 필드를 직접 읽었습니다.
 * 그래서 낚시 글은 분야를 제대로 받아도 화면에 아무것도 나오지 않았습니다.
 * 카드를 만들어준 적이 없으니까요. 지금은 어떤 분야가 오든 같은 카드가 그립니다.
 */
function FactCard({
  section,
  selectedItem,
  checkedItems,
  onToggleCheck,
}: {
  section: DomainSection;
  selectedItem: SavedItem;
  checkedItems: Record<string, Record<string, boolean>>;
  onToggleCheck: (itemId: string, key: string) => void;
}) {
  const styles = useThemedStyles(createStyles);
  const accent = DOMAIN_ACCENTS[section.domainKey] ?? DEFAULT_ACCENT;

  const singles = section.rows.filter((row) => !row.isList);
  const lists = section.rows.filter((row) => row.isList);

  return (
    <View style={styles.domainSpecCard}>
      <View style={[styles.domainSpecHeader, { borderLeftColor: accent.color }]}>
        <Text style={styles.domainSpecHeaderEmoji}>{accent.emoji}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.domainSpecTitle}>{section.label}</Text>
          {/* 값이 없는 항목은 아예 담기지 않습니다. '정보 없음'을 줄줄이 세우면
              화면은 찼는데 알아낸 것은 없는 상태가 됩니다. */}
          <Text style={styles.domainSpecSub}>
            {section.rows.map((row) => row.label).join(' · ')}
          </Text>
        </View>
      </View>

      {singles.length > 0 ? (
        <View style={styles.travelGrid}>
          {singles.map((row) => (
            <View key={row.ref} style={styles.travelGridBlock}>
              <Text style={styles.travelBlockLabel}>{row.label}</Text>
              <Text style={styles.travelBlockVal}>{row.values.join(', ')}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {lists.map((row) => (
        <FactList
          key={row.ref}
          row={row}
          accentColor={accent.color}
          selectedItem={selectedItem}
          checkedItems={checkedItems}
          onToggleCheck={onToggleCheck}
        />
      ))}
    </View>
  );
}

/**
 * 목록 하나.
 *
 * 체크할 수 있는 것은 준비물과 절차뿐입니다. 모아야 하거나 해내야 하는 것이라
 * 어디까지 했는지가 그 자체로 쓸모입니다. 자극 부위나 테마는 이 글이 무엇에
 * 대한 것인지를 말해줄 뿐이라 체크한다는 말이 성립하지 않습니다.
 */
function FactList({
  row,
  accentColor,
  selectedItem,
  checkedItems,
  onToggleCheck,
}: {
  row: FactRow;
  accentColor: string;
  selectedItem: SavedItem;
  checkedItems: Record<string, Record<string, boolean>>;
  onToggleCheck: (itemId: string, key: string) => void;
}) {
  const styles = useThemedStyles(createStyles);
  const checked = row.values.filter((value) => checkedItems[selectedItem.id]?.[value]).length;
  const total = row.values.length;
  const ratio = total > 0 ? (checked / total) * 100 : 0;

  if (!row.checkable) {
    return (
      <View style={styles.muscleRow}>
        <Text style={styles.muscleLabel}>{row.label}</Text>
        <View style={styles.muscleBadgeRow}>
          {row.values.map((value) => (
            <Text key={value} style={styles.muscleBadge}>{value}</Text>
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.factListSection}>
      <ProgressBar label={row.label} total={total} checked={checked} ratio={ratio} color={accentColor} />

      {/* 문장은 배지로 눕히면 잘려 보입니다. 절차처럼 순서가 있는 경우도 많아
          번호를 붙여 한 줄씩 세웁니다. */}
      {row.isSentence ? (
        <View style={styles.routineList}>
          {row.values.map((value, idx) => {
            const isChecked = !!checkedItems[selectedItem.id]?.[value];
            return (
              <Pressable
                key={value}
                onPress={() => onToggleCheck(selectedItem.id, value)}
                style={({ pressed }) => [
                  styles.routineItem,
                  isChecked && styles.routineItemChecked,
                  { transform: [{ scale: pressed ? 0.97 : 1 }] },
                ]}
              >
                <Text style={[styles.routineIndex, isChecked && styles.routineIndexChecked]}>
                  {isChecked ? '✔' : idx + 1}
                </Text>
                <Text style={[styles.routineText, isChecked && styles.routineTextChecked]}>
                  {value}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <View style={styles.ingredientsGrid}>
          {row.values.map((value) => {
            const isChecked = !!checkedItems[selectedItem.id]?.[value];
            return (
              <Pressable
                key={value}
                onPress={() => onToggleCheck(selectedItem.id, value)}
                style={({ pressed }) => [
                  styles.ingredientBadge,
                  isChecked && styles.ingredientBadgeChecked,
                  { transform: [{ scale: pressed ? 0.95 : 1 }] },
                ]}
              >
                <Text style={[styles.ingredientBadgeDot, isChecked && styles.ingredientBadgeDotChecked]}>
                  {isChecked ? '✔' : '○'}
                </Text>
                <Text style={[styles.ingredientBadgeText, isChecked && styles.ingredientBadgeTextChecked]}>
                  {value}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

/**
 * 분야별 색과 그림.
 *
 * 사전에 없는 분야는 기본값으로 그립니다. 색이 없다고 화면이 비면 안 되고,
 * 색을 정하는 일은 사용자가 그 분야를 실제로 쓰기 시작한 뒤에 해도 늦지 않습니다.
 */
const DOMAIN_ACCENTS: Record<string, { emoji: string; color: string }> = {
  recipe: { emoji: '🍳', color: '#ef4444' },
  workout: { emoji: '💪', color: '#8b5cf6' },
  travel: { emoji: '✈', color: '#3b82f6' },
  parenting: { emoji: '🍼', color: '#ec4899' },
  shopping: { emoji: '🛍️', color: '#f59e0b' },
  interior: { emoji: '🛋️', color: '#10b981' },
};

const DEFAULT_ACCENT = { emoji: '🏷️', color: '#64748b' };

/**
 * 마감 카드.
 *
 * 공구는 마감이 지나면 저장해둔 의미가 없어집니다.
 * 그래서 남은 기간을 눈에 띄게 보여주고, 지난 건 분명히 표시합니다.
 */
function DeadlineCard({
  aiDeadline,
  userDeadline,
  onEditDeadline,
}: {
  aiDeadline: string;
  userDeadline: string | null;
  onEditDeadline: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  // 사용자가 고친 값이 있으면 그것이 우선입니다.
  const deadline = (userDeadline ?? aiDeadline).trim();
  let deadlineNote: { text: string; expired: boolean } | null = null;

  if (deadline) {
    const due = new Date(deadline);
    if (!Number.isNaN(due.getTime())) {
      // 날짜만 비교합니다. 마감 당일은 아직 지나지 않은 것으로 봅니다.
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      due.setHours(0, 0, 0, 0);
      const days = Math.round((due.getTime() - today.getTime()) / 86400000);

      deadlineNote =
        days < 0
          ? { text: `${deadline} · ${-days}일 지남`, expired: true }
          : { text: days === 0 ? `${deadline} · 오늘 마감` : `${deadline} · ${days}일 남음`, expired: false };
    } else {
      deadlineNote = { text: deadline, expired: false };
    }
  }

  return (
    <Pressable
      onPress={onEditDeadline}
      style={({ pressed }) => [
        styles.deadlineBox,
        deadlineNote?.expired && styles.deadlineBoxExpired,
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[styles.deadlineLabel, deadlineNote?.expired && styles.deadlineLabelExpired]}>
        {deadlineNote ? (deadlineNote.expired ? '⛔ 마감됨' : '⏰ 마감') : '⏰ 마감일'}
        {userDeadline ? ' · 직접 지정' : ''}
      </Text>
      <Text style={styles.deadlineText}>
        {deadlineNote ? deadlineNote.text : '눌러서 입력'}
      </Text>
    </Pressable>
  );
}

function ProgressBar({ label, total, checked, ratio, color }: { label: string; total: number; checked: number; ratio: number; color: string }) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.progressBarContainer}>
      <View style={styles.progressBarHeader}>
        <Text style={styles.progressBarLabel}>{label}</Text>
        <Text style={styles.progressBarValue}>{total}개 중 {checked}개 완료 ({Math.round(ratio)}%)</Text>
      </View>
      <View style={styles.progressBarBg}>
        <View style={[styles.progressBarFill, { width: `${ratio}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

/**
 * 공유 원문은 인스타 캡션처럼 소제목과 항목이 섞인 글이 대부분입니다.
 * 통짜 <Text>로 흘리면 줄바꿈만 남아 눈이 걸릴 데가 없어서,
 * 소제목·불릿·해시태그를 나눠 그립니다. 긴 글은 접어둡니다.
 */
function RawInputSection({ item }: { item: SavedItem }) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.rawInputPanel}>
      <View style={styles.rawInputHeader}>
        <Text style={styles.detailLabel}>{item.type === 'text' ? '저장된 원문' : '공유 원문'}</Text>
        <Text style={styles.rawInputMeta}>{describeSavedItemShape(item)}</Text>
      </View>
      <StructuredText text={item.rawInput} collapseAfter={14} />
    </View>
  );
}

function MetaBlock({ label, value }: { label: string; value: string }) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.metaBlock}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

// ==========================================
// 스타일
// ==========================================
function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * 마감일 선택.
 *
 * 마감일은 AI가 캡션에서 추론한 값이라 틀릴 수 있는데, 화면에서는 '마감됨'이라는
 * 강한 경고를 띄웁니다. 잘못된 경고로 멀쩡한 공구를 놓치지 않으려면
 * 사용자가 고칠 수 있어야 합니다.
 *
 * OS 기본 날짜 선택기를 씁니다. 사용자가 다른 앱에서 이미 익숙한 UI이고,
 * 달력을 직접 그리면 로케일과 접근성을 전부 다시 만들어야 합니다.
 */
function DeadlineEditor({
  visible,
  current,
  isManual,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  current: string;
  isManual: boolean;
  onClose: () => void;
  onSubmit: (value: string | null) => void;
}) {
  const styles = useThemedStyles(createStyles);
  const { palette, mode } = useTheme();

  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(current) ? new Date(current) : null;
  const initial = parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date();

  if (!visible) return null;

  /*
   * 브라우저에는 위의 선택기가 없습니다. @react-native-community/datetimepicker에
   * 웹 구현이 없어서 폴백이 잡히는데, 그 폴백은 경고 한 줄을 찍고 null을
   * 돌려줍니다. 그래서 마감일을 눌러도 아무 일도 일어나지 않았습니다.
   *
   * 대신 브라우저가 가진 날짜 입력을 씁니다. 사파리는 이걸 네이티브 휠 선택기로
   * 띄워주므로, 달력을 직접 그리지 않는다는 위의 판단은 웹에서도 그대로입니다.
   */
  if (Platform.OS === 'web') {
    return (
      <Modal transparent visible animationType="fade">
        <Pressable style={styles.deadlineResetBackdrop} onPress={onClose}>
          <Pressable style={styles.deadlineResetSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.webDatePickerRow}>
              <input
                type="date"
                defaultValue={toDateKey(initial)}
                onChange={(event) => {
                  const value = event.target.value;
                  // 입력을 지우면 빈 문자열이 옵니다. 그건 해제가 아니라 미완성이라
                  // 아래 버튼과 뜻이 다릅니다. 온전한 날짜만 받습니다.
                  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) onSubmit(value);
                }}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '12px 14px',
                  fontSize: 16,
                  fontWeight: 700,
                  borderRadius: 12,
                  border: `1px solid ${palette.borderStrong}`,
                  background: palette.surface,
                  color: palette.textPrimary,
                  // 브라우저가 그리는 달력 아이콘과 팝업까지 테마를 따라가게 합니다.
                  colorScheme: mode,
                }}
              />
            </View>

            <Pressable onPress={() => onSubmit(null)} style={styles.pickerReset}>
              <Text style={styles.pickerResetText}>
                {isManual ? 'AI가 읽은 값으로 되돌리기' : '마감일 지우기'}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    );
  }

  return (
    <>
      <DateTimePicker
        value={initial}
        mode="date"
        display="calendar"
        onChange={(event, date) => {
          // 안드로이드는 취소해도 콜백이 옵니다. type으로 구분해야 합니다.
          if (event.type === 'set' && date) {
            onSubmit(toDateKey(date));
          } else {
            onClose();
          }
        }}
      />

      {/* 선택기는 OS가 그리므로 해제 버튼만 따로 띄웁니다. */}
      <Modal transparent visible animationType="none">
        <Pressable style={styles.deadlineResetBackdrop} onPress={onClose}>
          <Pressable style={styles.deadlineResetSheet} onPress={(e) => e.stopPropagation()}>
            <Pressable onPress={() => onSubmit(null)} style={styles.pickerReset}>
              <Text style={styles.pickerResetText}>
                {isManual ? 'AI가 읽은 값으로 되돌리기' : '마감일 지우기'}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

/**
 * 카테고리 직접 지정 시트.
 *
 * AI 분류는 자주 틀립니다. 키워드 폴백은 본문에 '육아'가 한 번만 나와도
 * 넘어갈 만큼 거칠고요. 분류를 보여주기만 하고 고칠 수 없으면
 * 사용자는 틀린 걸 계속 보면서도 손쓸 방법이 없습니다.
 */
function CategoryPicker({
  visible,
  current,
  isManual,
  taxonomy,
  onClose,
  onSelect,
}: {
  visible: boolean;
  current: string;
  isManual: boolean;
  taxonomy: TaxonomyRegistry;
  onClose: () => void;
  onSelect: (category: string | null, notice?: string) => void;
}) {
  const styles = useThemedStyles(createStyles);
  const keyboardHeight = useKeyboardHeight();
  const createDomain = useAppStore((state) => state.createDomain);
  const [draft, setDraft] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // 시트를 닫았다 열면 쓰다 만 이름은 지웁니다. 남겨두면 다른 글을 옮기러 열었을 때
  // 엉뚱한 이름이 입력칸에 들어 있습니다.
  useEffect(() => {
    if (!visible) {
      setDraft('');
      setIsCreating(false);
    }
  }, [visible]);

  const options = useMemo(() => {
    const keys: string[] = [];
    for (const key of taxonomy.domains.keys()) {
      if (key === OTHER_TAB_KEY) continue;
      keys.push(key);
    }

    // 지금 지정된 분야가 사전에 없을 수 있습니다. 다른 기기에서 만든 분야를
    // 아이템만 따라온 경우입니다. 목록에서 빠지면 지금 어디에 있는지가 안 보입니다.
    if (current && current !== OTHER_TAB_KEY && !keys.includes(current)) keys.unshift(current);

    // 미분류는 늘 끝입니다. 분야를 못 정한 것들의 자리라 다른 분야와 나란히 서면
    // 고를 만한 것처럼 보입니다.
    keys.push(OTHER_TAB_KEY);
    return keys;
  }, [taxonomy, current]);

  async function commitDraft() {
    const label = draft.trim();
    if (!label) return;

    const result = await createDomain(label);
    if (!result) return;

    setDraft('');
    setIsCreating(false);
    onSelect(
      result.key,
      result.existed
        ? `이미 있는 '${result.label}'으로 옮겼습니다`
        : `'${result.label}'을 만들고 옮겼습니다`
    );
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* 가운데 뜨는 시트라 키보드가 올라오면 아래쪽 입력칸이 가려집니다.
          키보드 높이만큼 아래 여백을 줘서 시트 전체를 위로 밀어 올립니다. */}
      <Pressable
        style={[styles.pickerBackdrop, { paddingBottom: keyboardHeight }]}
        onPress={onClose}
      >
        <Pressable style={styles.pickerSheet} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.pickerTitle}>카테고리 바꾸기</Text>

          {/* 분야는 사용자가 저장하는 대로 늘어납니다. 예전처럼 여섯 개를 박아두면
              AI가 만든 분야도, 직접 만든 분야도 여기서는 고를 수 없습니다. */}
          <ScrollView style={styles.pickerList} keyboardShouldPersistTaps="handled">
            {options.map((option) => {
              const isCurrent = option === current;
              return (
                <Pressable
                  key={option}
                  onPress={() => onSelect(option)}
                  style={({ pressed }) => [
                    styles.pickerRow,
                    isCurrent && styles.pickerRowActive,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Text style={[styles.pickerRowText, isCurrent && styles.pickerRowTextActive]}>
                    {getCategoryLabel(option, resolveDomainLabel(taxonomy, option))}
                  </Text>
                  {isCurrent ? <Text style={styles.pickerCheck}>✓</Text> : null}
                </Pressable>
              );
            })}
          </ScrollView>

          {isCreating ? (
            <View style={styles.pickerCreateRow}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="새 분야 이름"
                placeholderTextColor={styles.pickerCreateHint.color}
                style={styles.pickerCreateInput}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={() => void commitDraft()}
              />
              <Pressable onPress={() => void commitDraft()} hitSlop={8}>
                <Text style={styles.pickerCreateSubmit}>만들기</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={() => setIsCreating(true)}
              style={({ pressed }) => [styles.pickerRow, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.pickerCreateText}>+ 새 분야 만들기</Text>
            </Pressable>
          )}

          {isManual ? (
            <Pressable onPress={() => onSelect(null)} style={styles.pickerReset}>
              <Text style={styles.pickerResetText}>AI 분류로 되돌리기</Text>
            </Pressable>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const createStyles = (palette: Palette) =>
  StyleSheet.create({
  factListSection: {
    marginTop: 12,
    gap: 8,
  },
  deadlineBox: {
    marginTop: spacing[3],
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.35)',
    padding: spacing[3],
    gap: 3,
  },
  deadlineResetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingBottom: spacing[9],
    paddingHorizontal: spacing[5],
  },
  deadlineResetSheet: {
    backgroundColor: palette.backgroundStrong,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.border,
  },
  deadlineBoxExpired: {
    backgroundColor: palette.dangerSoft,
    borderColor: 'rgba(239, 68, 68, 0.35)',
  },
  deadlineLabel: {
    color: palette.warnText,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  deadlineLabelExpired: {
    color: palette.dangerText,
  },
  deadlineText: {
    color: palette.textPrimary,
    fontSize: 12.5,
    fontWeight: '700',
  },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: palette.overlay,
    justifyContent: 'center',
    paddingHorizontal: spacing[6],
  },
  pickerSheet: {
    backgroundColor: palette.backgroundStrong,
    borderRadius: 20,
    padding: spacing[5],
    gap: spacing[1],
  },
  /**
   * 분야 목록은 늘어납니다. 높이를 안 묶어두면 시트가 화면 밖으로 자라
   * 아래쪽의 '새 분야 만들기'와 '되돌리기'가 손에 닿지 않습니다.
   */
  pickerList: {
    maxHeight: 320,
  },
  pickerCreateText: {
    color: palette.accent,
    fontSize: 14,
    fontWeight: '800',
  },
  pickerCreateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
  },
  pickerCreateInput: {
    flex: 1,
    color: palette.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    borderBottomWidth: 1,
    borderBottomColor: palette.accent,
    paddingVertical: 0,
  },
  pickerCreateSubmit: {
    color: palette.accent,
    fontSize: 13,
    fontWeight: '900',
  },
  pickerCreateHint: {
    color: palette.textMuted,
  },
  pickerTitle: {
    color: palette.textPrimary,
    fontSize: 15,
    fontWeight: '900',
    marginBottom: spacing[2],
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[3],
    borderRadius: 12,
  },
  pickerRowActive: {
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
  },
  pickerRowText: {
    color: palette.textSecondary,
    fontSize: 13.5,
    fontWeight: '800',
  },
  pickerRowTextActive: {
    color: palette.accentText,
  },
  pickerCheck: {
    color: palette.accentText,
    fontSize: 13,
    fontWeight: '900',
  },
  webDatePickerRow: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
  },
  pickerReset: {
    marginTop: spacing[2],
    paddingVertical: spacing[3],
    alignItems: 'center',
  },
  pickerResetText: {
    color: palette.textMuted,
    fontSize: 11.5,
    fontWeight: '800',
    textDecorationLine: 'underline',
  },
  categoryChip: {
    alignSelf: 'flex-start',
    marginTop: 6,
    backgroundColor: palette.surfaceRaised,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  categoryChipText: {
    color: palette.textSecondary,
    fontSize: 10.5,
    fontWeight: '900',
  },
  sourceCard: {
    backgroundColor: palette.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing[4],
    marginTop: spacing[3],
    gap: spacing[2],
  },
  awaitingHint: {
    color: palette.warnText,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 16,
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    backgroundColor: palette.surfaceRaised,
    borderRadius: 12,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  sourceRowText: { flex: 1, gap: 2 },
  sourceOpenText: {
    color: palette.accentText,
    fontSize: 11,
    fontWeight: '800',
    marginTop: 2,
  },
  imageViewer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[4],
  },
  imageViewerImage: {
    width: '92%',
    height: '80%',
  },
  imageViewerHint: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 12,
    fontWeight: '700',
  },
  sourceThumb: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: palette.surface,
  },
  sourceKind: { color: palette.textSecondary, fontSize: 11, fontWeight: '900' },
  sourceExcerpt: { color: palette.textMuted, fontSize: 11, fontWeight: '600', lineHeight: 15 },
  sourceRemove: { paddingHorizontal: spacing[2], paddingVertical: 2 },
  sourceRemoveText: { color: palette.dangerText, fontSize: 11, fontWeight: '800' },
  sourceInput: {
    backgroundColor: palette.surfaceRaised,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.textPrimary,
    fontSize: 12,
    minHeight: 60,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    textAlignVertical: 'top',
  },
  sourceActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing[2] },
  sourceSkipBtn: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  sourceSkipText: { color: palette.textSecondary, fontSize: 12, fontWeight: '800' },
  sourceAddBtn: {
    backgroundColor: palette.accent,
    borderRadius: 12,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    minWidth: 110,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceAddText: { color: '#ffffff', fontSize: 12, fontWeight: '900' },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
  },
  titleText: {
    flex: 1,
  },
  titleEditIcon: {
    fontSize: 13,
    marginTop: 3,
  },
  titleEditRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
  },
  titleInput: {
    flex: 1,
    color: palette.textPrimary,
    fontSize: 19,
    fontWeight: '900',
    lineHeight: 26,
    borderBottomWidth: 1,
    borderBottomColor: palette.accent,
    paddingVertical: 0,
  },
  titleEditBtn: {
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
  },
  titleEditBtnText: {
    color: palette.accentText,
    fontSize: 12,
    fontWeight: '800',
  },
  enrichHint: {
    color: palette.textMuted,
    fontSize: 11,
    fontWeight: '600',
    marginTop: spacing[2],
  },
  aiErrorBox: {
    marginTop: spacing[3],
    backgroundColor: palette.dangerSoft,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    padding: spacing[3],
    gap: 3,
  },
  aiErrorLabel: {
    color: palette.dangerText,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  aiErrorText: {
    color: palette.textSecondary,
    fontSize: 11.5,
    fontWeight: '600',
  },
  // 전체 화면 상세
  fullScreen: {
    flex: 1,
    backgroundColor: palette.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.backgroundStrong,
  },
  backBtn: {
    width: 34, height: 34,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  backBtnText: {
    color: palette.textPrimary,
    fontSize: 17,
    fontWeight: '800',
    lineHeight: 20,
  },
  headerTitle: {
    flex: 1,
    color: palette.textPrimary,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  scrollContent: {
    padding: spacing[5],
    paddingBottom: spacing[10],
  },
  // 상세 카드
  detailCard: { gap: spacing[4] },
  detailHero: {
    backgroundColor: palette.surfaceRaised,
    borderRadius: 18,
    padding: spacing[4],
    gap: spacing[2],
    borderWidth: 1,
    borderColor: palette.border,
  },
  detailHeroText: { gap: spacing[1] },
  detailTitle: {
    color: palette.textPrimary,
    fontSize: 20, lineHeight: 28,
    fontWeight: '900', letterSpacing: -0.4,
  },
  detailSource: {
    color: palette.textSecondary,
    fontSize: 12, lineHeight: 18,
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
  },
  openSourceBtnText: {
    color: palette.infoText,
    fontSize: 12, fontWeight: '800',
  },
  detailSection: { gap: spacing[2] },
  detailLabel: {
    // 한글 라벨에 자간을 넓게 주면 오히려 읽기 힘듭니다.
    color: palette.textSecondary,
    fontSize: 11.5, fontWeight: '900',
    letterSpacing: 0.2,
  },
  noteInputRow: {
    flexDirection: 'row',
    gap: spacing[2],
    alignItems: 'stretch',
  },
  noteInput: {
    flex: 1,
    backgroundColor: palette.surface,
    borderRadius: 14,
    paddingHorizontal: spacing[3],
    paddingVertical: 8,
    color: palette.textPrimary,
    fontSize: 13,
    minHeight: 38,
    borderWidth: 1,
    borderColor: palette.border,
  },
  noteSaveButton: {
    backgroundColor: palette.accent,
    borderRadius: 14,
    paddingHorizontal: spacing[4],
    justifyContent: 'center',
    alignItems: 'center',
  },
  noteSaveButtonText: {
    color: '#ffffff',
    fontSize: 13, fontWeight: '800',
  },
  summaryCard: {
    backgroundColor: palette.surfaceRaised,
    borderRadius: 20,
    padding: spacing[4],
    gap: spacing[3],
    borderWidth: 1,
    borderColor: palette.accentBorder,
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[2],
  },
  summaryTitle: {
    color: palette.accentText,
    fontSize: 15, fontWeight: '900',
    letterSpacing: -0.3,
  },
  sourceToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: palette.surfaceStrong,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.borderStrong,
  },
  sourceToggleText: {
    color: palette.textSecondary,
    fontSize: 11,
    fontWeight: '800',
  },
  sourceToggleCaret: {
    color: palette.textMuted,
    fontSize: 10,
    fontWeight: '900',
  },
  sourceKinds: {
    color: palette.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  summaryValue: {
    color: palette.textSecondary,
    fontSize: 14.5, lineHeight: 24,
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
    borderColor: palette.accentBorder,
  },
  reanalyzeBtnText: {
    color: palette.accentText,
    fontSize: 11, fontWeight: '800',
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    backgroundColor: palette.successSoft,
    borderRadius: 14,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
  },
  toastDot: {
    width: 8, height: 8,
    borderRadius: 999,
    backgroundColor: palette.success,
  },
  toastText: {
    flex: 1,
    color: palette.success,
    fontSize: 13, fontWeight: '700',
  },
  // 도메인 특화 카드
  domainSpecCard: {
    backgroundColor: palette.surfaceStrong,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    padding: spacing[4],
    gap: spacing[3],
  },
  domainSpecHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    borderLeftWidth: 4,
    paddingLeft: spacing[2],
  },
  domainSpecHeaderEmoji: { fontSize: 20 },
  domainSpecTitle: {
    color: palette.textPrimary,
    fontSize: 14, fontWeight: '900',
  },
  domainSpecSub: {
    color: palette.textSecondary,
    fontSize: 11, fontWeight: '700',
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
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: palette.border,
  },
  ingredientBadgeChecked: {
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    borderColor: 'rgba(16, 185, 129, 0.25)',
    opacity: 0.65,
  },
  ingredientBadgeDot: {
    color: palette.success,
    fontSize: 10, fontWeight: '900',
  },
  ingredientBadgeDotChecked: { color: palette.success },
  ingredientBadgeText: {
    color: palette.textPrimary,
    fontSize: 12, fontWeight: '800',
  },
  ingredientBadgeTextChecked: {
    color: palette.textMuted,
    textDecorationLine: 'line-through',
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
    fontSize: 11, fontWeight: '900',
  },
  muscleBadgeRow: {
    flexDirection: 'row',
    gap: 6,
  },
  muscleBadge: {
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    color: palette.accentLink,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 11, fontWeight: '800',
  },
  routineList: { gap: spacing[2] },
  routineItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    backgroundColor: palette.surface,
    borderRadius: 12,
    padding: spacing[3],
    borderWidth: 1,
    borderColor: palette.border,
  },
  routineItemChecked: {
    backgroundColor: 'rgba(16, 185, 129, 0.05)',
    borderColor: 'rgba(16, 185, 129, 0.2)',
    opacity: 0.6,
  },
  routineIndex: {
    width: 22, height: 22,
    borderRadius: 99,
    backgroundColor: palette.surfaceRaised,
    color: palette.accent,
    textAlign: 'center',
    lineHeight: 22,
    fontSize: 12, fontWeight: '900',
  },
  routineIndexChecked: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    color: palette.success,
  },
  routineText: {
    color: palette.textPrimary,
    fontSize: 13, fontWeight: '800',
  },
  routineTextChecked: {
    color: palette.textMuted,
    textDecorationLine: 'line-through',
  },
  // 프로그레스 바
  progressBarContainer: {
    backgroundColor: palette.surface,
    borderRadius: 14,
    padding: spacing[3],
    borderWidth: 1,
    borderColor: palette.border,
    gap: 6,
  },
  progressBarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressBarLabel: {
    color: palette.textMuted,
    fontSize: 10, fontWeight: '900',
    textTransform: 'uppercase',
  },
  progressBarValue: {
    color: palette.textPrimary,
    fontSize: 11, fontWeight: '800',
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
  // 여행 카드
  travelGrid: {
    flexDirection: 'row',
    gap: spacing[3],
  },
  travelGridBlock: {
    flex: 1,
    backgroundColor: palette.surface,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: palette.border,
    gap: 4,
  },
  travelBlockLabel: {
    color: palette.textMuted,
    fontSize: 10, fontWeight: '900',
  },
  travelBlockVal: {
    color: palette.textPrimary,
    fontSize: 13, fontWeight: '800',
  },
  travelHighlightRow: {
    gap: spacing[2],
    borderTopWidth: 1,
    borderColor: palette.border,
    paddingTop: spacing[2],
  },
  travelHighlightLabel: {
    color: palette.textMuted,
    fontSize: 11, fontWeight: '900',
  },
  travelHighlightsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  travelHighlightText: {
    color: palette.textPrimary,
    fontSize: 12, fontWeight: '800',
    backgroundColor: palette.surface,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: palette.border,
  },
  travelThemeBadgeRow: {
    flexDirection: 'row',
    gap: 4,
  },
  travelThemeBadge: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 10.5, fontWeight: '900',
    borderWidth: 1,
  },
  travelChecklistSection: {
    borderTopWidth: 1,
    borderColor: palette.border,
    paddingTop: spacing[3],
    gap: spacing[2],
  },
  travelChecklistGrid: { gap: 8, marginTop: 4 },
  travelChecklistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    backgroundColor: palette.surface,
    borderRadius: 12,
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
    fontSize: 14, fontWeight: '800',
  },
  travelChecklistIconChecked: { color: palette.success },
  travelChecklistText: {
    color: palette.textPrimary,
    fontSize: 13, fontWeight: '800',
  },
  travelChecklistTextChecked: {
    color: palette.textMuted,
    textDecorationLine: 'line-through',
  },
  // 링크 목록
  extractedUrlsList: { gap: spacing[2] },
  urlClickableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    backgroundColor: 'rgba(139, 92, 246, 0.08)',
    borderRadius: 12,
    paddingHorizontal: spacing[3],
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.15)',
  },
  urlClickableNum: {
    color: palette.accentLink,
    fontSize: 12, fontWeight: '800',
  },
  urlClickableText: {
    flex: 1,
    color: palette.accentText,
    fontSize: 12, fontWeight: '700',
  },
  // 썸네일
  thumbnailPanel: { gap: spacing[2] },
  thumbnailPreview: {
    backgroundColor: palette.surface,
    borderRadius: 16,
    padding: spacing[3],
    borderWidth: 1,
    borderColor: palette.border,
  },
  thumbnailImage: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 12,
    backgroundColor: palette.backgroundStrong,
  },
  // 접이식 메타
  collapsibleArea: {
    marginTop: spacing[2],
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 16,
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
    fontSize: 12, fontWeight: '800',
  },
  collapsibleContent: {
    backgroundColor: palette.surfaceRaised,
    padding: spacing[4],
    gap: spacing[4],
    borderTopWidth: 1,
    borderTopColor: palette.border,
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
  },
  metaBlock: {
    flexGrow: 1,
    minWidth: 130,
    backgroundColor: palette.surface,
    borderRadius: 14,
    padding: spacing[3],
    gap: spacing[1],
    borderWidth: 1,
    borderColor: palette.border,
  },
  metaLabel: {
    color: palette.textMuted,
    fontSize: 10, fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  metaValue: {
    color: palette.textPrimary,
    fontSize: 13, lineHeight: 18,
    fontWeight: '700',
  },
  rawInputScrollView: {
    maxHeight: 120,
    backgroundColor: palette.backgroundStrong,
    borderRadius: 14,
    padding: spacing[3],
    borderWidth: 1,
    borderColor: palette.border,
  },
  detailRawInputText: {
    color: palette.textSecondary,
    fontSize: 13, lineHeight: 20,
  },
  rawInputPanel: {
    backgroundColor: palette.backgroundStrong,
    borderRadius: 16,
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
    fontSize: 11, fontWeight: '900',
  },
  // 삭제 버튼
  deleteBtn: {
    marginTop: spacing[4],
    alignSelf: 'center',
    backgroundColor: palette.dangerSoft,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.25)',
    borderRadius: 14,
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[3],
  },
  deleteBtnText: {
    color: palette.dangerText,
    fontSize: 13,
    fontWeight: '800',
  },
  // 🚀 퀵 액션 스타일
  actionPanel: {
    marginTop: spacing[3],
    marginBottom: spacing[2],
    gap: spacing[2],
  },
  actionPanelLabel: {
    color: palette.textMuted,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  actionScrollContent: {
    gap: spacing[2],
    paddingVertical: spacing[1],
  },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1] + 2,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 12,
    paddingHorizontal: spacing[3],
    paddingVertical: 8,
  },
  actionChipIcon: {
    fontSize: 14,
  },
  actionChipText: {
    color: palette.textPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
  // 📖 리더 모드 버튼 스타일
  readerModeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.3)',
    borderRadius: 14,
    paddingVertical: spacing[3] + 2,
    marginVertical: spacing[2],
  },
  readerModeBtnIcon: {
    fontSize: 16,
  },
  readerModeBtnText: {
    color: palette.accentText,
    fontSize: 14,
    fontWeight: '800',
  },
});
