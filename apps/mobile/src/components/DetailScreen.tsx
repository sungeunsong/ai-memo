import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { SavedItem } from '@/features/items/types';
import { StatusPills } from '@/components/StatusBadges';
import { useAppStore } from '@/store';
import { getHostname } from '@/features/items/fallback';
import {
  formatReadableDate,
  formatRelativeTime,
  getSourceTheme,
  getCategoryLabel,
  getItemCategory,
  getSyncStatusLabel,
  tryParseStructuredContent,
  truncateMiddle,
  shouldShowRawInputFirst,
  describeSavedItemShape,
} from '@/utils/formatters';
import { parseActionItems, ActionItem } from '@/utils/actionParser';
import * as WebBrowser from 'expo-web-browser';

import { ReaderModeModal } from '@/components/ReaderModeModal';
import { palette } from '@/theme/palette';
import { spacing } from '@/theme/spacing';

type Props = {
  item: SavedItem;
  checkedItems: Record<string, Record<string, boolean>>;
  onToggleCheck: (itemId: string, key: string) => void;
  onClose: () => void;
  onDelete?: (itemId: string) => void;
};

export function DetailScreen({ item, checkedItems, onToggleCheck, onClose, onDelete }: Props) {
  return (
    <View style={styles.backdrop}>
      <Pressable style={styles.backdropClickable} onPress={onClose} />
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.handle} />
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [
              styles.closeBtn,
              { transform: [{ scale: pressed ? 0.85 : 1 }] },
            ]}
          >
            <Text style={styles.closeBtnText}>✕</Text>
          </Pressable>
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
      </View>
    </View>
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
  const theme = getSourceTheme(selectedItem.sourceType);
  const itemCategory = getItemCategory(selectedItem);
  const [userNoteInput, setUserNoteInput] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isMetaExpanded, setIsMetaExpanded] = useState(false);
  const [isReaderVisible, setIsReaderVisible] = useState(false);
  const updateUserNote = useAppStore((state) => state.updateUserNote);
  const retryEnrichMetadata = useAppStore((state) => state.retryEnrichMetadata);
  const isSaving = useAppStore((state) => state.isSaving);
  const setItemCategory = useAppStore((state) => state.setItemCategory);
  const [isCategoryPickerVisible, setIsCategoryPickerVisible] = useState(false);

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

  // 본문은 contentText 컬럼으로 분리됐습니다.
  // structured.description은 분리 이전에 저장된 아이템을 위한 호환 경로입니다.
  const readerMarkdown: string = selectedItem.contentText || structured?.description || '';

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
  const actions = parseActionItems(selectedItem.rawInput, selectedItem.userNote ?? undefined, structured);

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
          <Text style={styles.detailTitle}>{selectedItem.title}</Text>
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
              {getCategoryLabel(itemCategory)}
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

      {shouldShowRawInputFirst(selectedItem) ? (
        <RawInputSection item={selectedItem} />
      ) : null}

      {/* 1.7. 📖 리더 모드 버튼 */}
      {readerMarkdown &&
      selectedItem.sourceType !== 'instagram_reel' &&
      selectedItem.sourceType !== 'instagram_post' &&
      selectedItem.sourceType !== 'instagram' ? (
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

      {/* 3. AI 요약 */}
      {selectedItem.sourceType !== 'instagram_reel' &&
      selectedItem.sourceType !== 'instagram_post' &&
      selectedItem.sourceType !== 'instagram' ? (
        <View style={styles.summaryCard}>
          <View style={styles.summaryHeader}>
            <Text style={styles.summaryTitle}>✨ AI 요약</Text>
            <Pressable
              disabled={isSaving || selectedItem.aiStatus === 'pending'}
              onPress={async () => {
                await retryEnrichMetadata(selectedItem.id);
                setToastMessage('AI 분석을 다시 요청했습니다.');
              }}
              style={({ pressed }) => [
                styles.reanalyzeBtn,
                (pressed || isSaving || selectedItem.aiStatus === 'pending') && { opacity: 0.5 },
              ]}
            >
              {isSaving || selectedItem.aiStatus === 'pending' ? (
                <ActivityIndicator size="small" color="#c084fc" />
              ) : (
                <Text style={styles.reanalyzeBtnText}>재분석 🧪</Text>
              )}
            </Pressable>
          </View>
          <Text style={styles.summaryValue}>
            {/* 정리본이 상세 화면의 본문입니다.
                structured.detailedAnalysis는 digest 컬럼 분리 이전에 저장된 아이템을 위한 호환 경로입니다. */}
            {selectedItem.digest ||
              structured?.detailedAnalysis ||
              selectedItem.summary ||
              'AI가 분석을 완료하지 못했거나 요약된 내용이 없습니다.'}
          </Text>

          {/* 실패했으면 이유를 그대로 보여줍니다.
              폰에서 도는 앱이라 콘솔을 열기 어렵고, 사용자 입장에서도
              "요약이 왜 없지"에 답이 있어야 재분석을 눌러볼 수 있습니다. */}
          {selectedItem.aiStatus === 'failed' && selectedItem.aiError ? (
            <View style={styles.aiErrorBox}>
              <Text style={styles.aiErrorLabel}>AI 요약 실패</Text>
              <Text style={styles.aiErrorText}>{selectedItem.aiError}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* 4. 도메인 특화 카드 */}
      {structured && (structured.category === 'recipe' || structured.ingredients?.length > 0) && (
        <RecipeCard
          selectedItem={selectedItem}
          structured={structured}
          checkedItems={checkedItems}
          onToggleCheck={onToggleCheck}
        />
      )}

      {structured &&
        (structured.category === 'workout' ||
          structured.targetMuscles?.length > 0 ||
          structured.routine?.length > 0) && (
        <WorkoutCard
          selectedItem={selectedItem}
          structured={structured}
          checkedItems={checkedItems}
          onToggleCheck={onToggleCheck}
        />
      )}

      {structured &&
        (structured.category === 'shopping' ||
          structured.purchaseType ||
          structured.seller ||
          structured.deadline) && <ShoppingCard structured={structured} />}

      {structured &&
        (structured.category === 'travel' ||
          structured.location ||
          structured.travelTheme ||
          structured.highlights?.length > 0) && (
        <TravelCard
          selectedItem={selectedItem}
          structured={structured}
          checkedItems={checkedItems}
          onToggleCheck={onToggleCheck}
        />
      )}

      {/* 5. 추출된 링크 */}
      {selectedItem.extractedUrls && selectedItem.extractedUrls.length > 0 ? (
        <View style={styles.detailSection}>
          <Text style={styles.detailLabel}>추출된 링크 ({selectedItem.extractedUrls.length}개)</Text>
          <View style={styles.extractedUrlsList}>
            {selectedItem.extractedUrls.map((url, idx) => (
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
      {(selectedItem.type === 'url' || selectedItem.type === 'image') && selectedItem.thumbnailUrl ? (
        <View style={styles.thumbnailPanel}>
          <Text style={styles.detailLabel}>썸네일</Text>
          <View style={styles.thumbnailPreview}>
            <Image
              source={{ uri: selectedItem.thumbnailUrl }}
              style={styles.thumbnailImage as any}
              resizeMode="cover"
            />
          </View>
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

      <CategoryPicker
        visible={isCategoryPickerVisible}
        current={itemCategory}
        isManual={Boolean(selectedItem.userCategory)}
        onClose={() => setIsCategoryPickerVisible(false)}
        onSelect={(category) => {
          setIsCategoryPickerVisible(false);
          void setItemCategory(selectedItem.id, category);
          setToastMessage(
            category ? `${getCategoryLabel(category)}(으)로 변경했습니다` : 'AI 분류를 따르도록 되돌렸습니다'
          );
        }}
      />

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
// 도메인 특화 서브컴포넌트
// ==========================================
function RecipeCard({
  selectedItem,
  structured,
  checkedItems,
  onToggleCheck,
}: {
  selectedItem: SavedItem;
  structured: any;
  checkedItems: Record<string, Record<string, boolean>>;
  onToggleCheck: (itemId: string, key: string) => void;
}) {
  const list = (structured.ingredients as string[]) || [];
  const total = list.length;
  const checked = list.filter((ing) => checkedItems[selectedItem.id]?.[ing]).length;
  const ratio = total > 0 ? (checked / total) * 100 : 0;

  return (
    <View style={styles.domainSpecCard}>
      <View style={[styles.domainSpecHeader, { borderLeftColor: '#ef4444' }]}>
        <Text style={styles.domainSpecHeaderEmoji}>🍳</Text>
        <View>
          <Text style={styles.domainSpecTitle}>장보기 재료 목록</Text>
          <Text style={styles.domainSpecSub}>
            난이도: {structured.difficulty || '-'} · 조리시간: {structured.cookTime || '-'}
          </Text>
        </View>
      </View>

      <ProgressBar label="재료 준비율" total={total} checked={checked} ratio={ratio} color="#8b5cf6" />

      <View style={styles.ingredientsGrid}>
        {list.map((ing) => {
          const isChecked = !!checkedItems[selectedItem.id]?.[ing];
          return (
            <Pressable
              key={ing}
              onPress={() => onToggleCheck(selectedItem.id, ing)}
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
                {ing}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function WorkoutCard({
  selectedItem,
  structured,
  checkedItems,
  onToggleCheck,
}: {
  selectedItem: SavedItem;
  structured: any;
  checkedItems: Record<string, Record<string, boolean>>;
  onToggleCheck: (itemId: string, key: string) => void;
}) {
  const list = (structured.routine as string[]) || [];
  const equipments = (structured.equipments as string[]) || [];
  const targetMuscles = (structured.targetMuscles as string[]) || [];
  const total = list.length;
  const checked = list.filter((r) => checkedItems[selectedItem.id]?.[r]).length;
  const ratio = total > 0 ? (checked / total) * 100 : 0;

  return (
    <View style={styles.domainSpecCard}>
      <View style={[styles.domainSpecHeader, { borderLeftColor: '#8b5cf6' }]}>
        <Text style={styles.domainSpecHeaderEmoji}>💪</Text>
        <View>
          <Text style={styles.domainSpecTitle}>운동 루틴 & 타겟 부위</Text>
          <Text style={styles.domainSpecSub}>
            필요도구: {equipments.length > 0 ? equipments.join(', ') : '정보 없음'}
          </Text>
        </View>
      </View>

      <View style={styles.muscleRow}>
        <Text style={styles.muscleLabel}>타겟 부위</Text>
        <View style={styles.muscleBadgeRow}>
          {targetMuscles.map((m) => (
            <Text key={m} style={styles.muscleBadge}>{m}</Text>
          ))}
        </View>
      </View>

      <ProgressBar label="루틴 완수도" total={total} checked={checked} ratio={ratio} color="#8b5cf6" />

      <View style={styles.routineList}>
        {list.map((r, idx) => {
          const isChecked = !!checkedItems[selectedItem.id]?.[r];
          return (
            <Pressable
              key={r}
              onPress={() => onToggleCheck(selectedItem.id, r)}
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
                {r}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function TravelCard({
  selectedItem,
  structured,
  checkedItems,
  onToggleCheck,
}: {
  selectedItem: SavedItem;
  structured: any;
  checkedItems: Record<string, Record<string, boolean>>;
  onToggleCheck: (itemId: string, key: string) => void;
}) {
  const checklistItems = (structured.checklist as string[]) || [];
  const highlights = (structured.highlights as string[]) || [];
  const total = checklistItems.length;
  const checked = checklistItems.filter((item) => checkedItems[selectedItem.id]?.[item]).length;
  const ratio = total > 0 ? (checked / total) * 100 : 0;

  return (
    <View style={styles.domainSpecCard}>
      <View style={[styles.domainSpecHeader, { borderLeftColor: '#3b82f6' }]}>
        <Text style={styles.domainSpecHeaderEmoji}>✈</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.domainSpecTitle}>여행 코스 & 숙소 정보</Text>
          <Text style={styles.domainSpecSub}>테마: {structured.travelTheme || '정보 없음'}</Text>
        </View>
        <View style={styles.travelThemeBadgeRow}>
          {structured.travelTheme?.includes('국내') && (
            <Text style={[styles.travelThemeBadge, { backgroundColor: 'rgba(59, 130, 246, 0.15)', color: '#93c5fd', borderColor: '#3b82f6' }]}>국내 🇰🇷</Text>
          )}
          {structured.travelTheme?.includes('해외') && (
            <Text style={[styles.travelThemeBadge, { backgroundColor: 'rgba(236, 72, 153, 0.15)', color: '#fbcfe8', borderColor: '#ec4899' }]}>해외 ✈</Text>
          )}
          {structured.travelTheme?.includes('호캉스') && (
            <Text style={[styles.travelThemeBadge, { backgroundColor: 'rgba(139, 92, 246, 0.15)', color: '#c084fc', borderColor: '#8b5cf6' }]}>호캉스 🏨</Text>
          )}
        </View>
      </View>

      <View style={styles.travelGrid}>
        <View style={styles.travelGridBlock}>
          <Text style={styles.travelBlockLabel}>📍 위치</Text>
          <Text style={styles.travelBlockVal}>{structured.location || '정보 없음'}</Text>
        </View>
        <View style={styles.travelGridBlock}>
          <Text style={styles.travelBlockLabel}>💵 예상 예산</Text>
          <Text style={styles.travelBlockVal}>{structured.budget || '정보 없음'}</Text>
        </View>
      </View>

      <View style={styles.travelHighlightRow}>
        <Text style={styles.travelHighlightLabel}>핵심 스팟</Text>
        <View style={styles.travelHighlightsContainer}>
          {highlights.map((h) => (
            <Text key={h} style={styles.travelHighlightText}>⭐ {h}</Text>
          ))}
        </View>
      </View>

      {total > 0 && (
        <View style={styles.travelChecklistSection}>
          <Text style={styles.travelHighlightLabel}>준비물 체크리스트</Text>
          <ProgressBar label="준비 완료도" total={total} checked={checked} ratio={ratio} color="#3b82f6" />
          <View style={styles.travelChecklistGrid}>
            {checklistItems.map((item) => {
              const isChecked = !!checkedItems[selectedItem.id]?.[item];
              return (
                <Pressable
                  key={item}
                  onPress={() => onToggleCheck(selectedItem.id, item)}
                  style={({ pressed }) => [
                    styles.travelChecklistItem,
                    isChecked && styles.travelChecklistItemChecked,
                    { transform: [{ scale: pressed ? 0.96 : 1 }] },
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
  );
}

// ==========================================
// 공통 서브 컴포넌트
// ==========================================
function ProgressBar({ label, total, checked, ratio, color }: { label: string; total: number; checked: number; ratio: number; color: string }) {
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

function MetaBlock({ label, value }: { label: string; value: string }) {
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
  onClose,
  onSelect,
}: {
  visible: boolean;
  current: string;
  isManual: boolean;
  onClose: () => void;
  onSelect: (category: string | null) => void;
}) {
  const options = ['recipe', 'workout', 'travel', 'parenting', 'shopping', 'other'];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.pickerBackdrop} onPress={onClose}>
        <Pressable style={styles.pickerSheet} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.pickerTitle}>카테고리 바꾸기</Text>

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
                  {getCategoryLabel(option)}
                </Text>
                {isCurrent ? <Text style={styles.pickerCheck}>✓</Text> : null}
              </Pressable>
            );
          })}

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

/**
 * 공동구매·꿀템용 카드.
 *
 * 공구는 마감이 지나면 저장해둔 의미가 없어집니다.
 * 그래서 남은 기간을 눈에 띄게 보여주고, 지난 건 분명히 표시합니다.
 */
function ShoppingCard({ structured }: { structured: any }) {
  const deadline = typeof structured.deadline === 'string' ? structured.deadline.trim() : '';
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
    <View style={styles.domainSpecCard}>
      <View style={[styles.domainSpecHeader, { borderLeftColor: '#f59e0b' }]}>
        <Text style={styles.domainSpecHeaderEmoji}>🛍️</Text>
        <View>
          <Text style={styles.domainSpecTitle}>구매 정보</Text>
          <Text style={styles.domainSpecSub}>
            {structured.purchaseType || '구매형태 미상'}
            {structured.productType ? ` · ${structured.productType}` : ''}
          </Text>
        </View>
      </View>

      <View style={styles.travelGrid}>
        <View style={styles.travelGridBlock}>
          <Text style={styles.travelBlockLabel}>🏪 구매처</Text>
          <Text style={styles.travelBlockVal}>{structured.seller || '정보 없음'}</Text>
        </View>
        <View style={styles.travelGridBlock}>
          <Text style={styles.travelBlockLabel}>💵 가격</Text>
          <Text style={styles.travelBlockVal}>{structured.price || '정보 없음'}</Text>
        </View>
      </View>

      {deadlineNote ? (
        <View style={[styles.deadlineBox, deadlineNote.expired && styles.deadlineBoxExpired]}>
          <Text style={[styles.deadlineLabel, deadlineNote.expired && styles.deadlineLabelExpired]}>
            {deadlineNote.expired ? '⛔ 마감됨' : '⏰ 마감'}
          </Text>
          <Text style={styles.deadlineText}>{deadlineNote.text}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  deadlineBox: {
    marginTop: spacing[3],
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.35)',
    padding: spacing[3],
    gap: 3,
  },
  deadlineBoxExpired: {
    backgroundColor: palette.dangerSoft,
    borderColor: 'rgba(239, 68, 68, 0.35)',
  },
  deadlineLabel: {
    color: '#fbbf24',
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
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    paddingHorizontal: spacing[6],
  },
  pickerSheet: {
    backgroundColor: palette.backgroundStrong,
    borderRadius: 20,
    padding: spacing[5],
    gap: spacing[1],
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
    color: '#c084fc',
  },
  pickerCheck: {
    color: '#c084fc',
    fontSize: 13,
    fontWeight: '900',
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
  // 오버레이
  backdrop: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    zIndex: 999,
  },
  backdropClickable: { flex: 1 },
  container: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    height: '92%',
    backgroundColor: palette.backgroundStrong,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: -10 },
    elevation: 24,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderColor: palette.border,
    position: 'relative',
  },
  handle: {
    width: 36, height: 4,
    backgroundColor: palette.textMuted,
    borderRadius: 99,
    opacity: 0.5,
  },
  closeBtn: {
    position: 'absolute',
    right: 20, top: 10,
    width: 30, height: 30,
    backgroundColor: palette.surface,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: palette.border,
  },
  closeBtnText: {
    color: palette.textSecondary,
    fontSize: 12, fontWeight: '800',
  },
  scrollContent: {
    padding: spacing[5],
    paddingBottom: spacing[10],
  },
  // 상세 카드
  detailCard: { gap: spacing[3] },
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
    fontSize: 18, lineHeight: 24,
    fontWeight: '900', letterSpacing: -0.3,
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
    color: '#93c5fd',
    fontSize: 12, fontWeight: '800',
  },
  detailSection: { gap: spacing[2] },
  detailLabel: {
    color: palette.textMuted,
    fontSize: 11, fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
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
    fontSize: 15, fontWeight: '900',
    letterSpacing: -0.3,
  },
  summaryValue: {
    color: palette.textPrimary,
    fontSize: 14, lineHeight: 22,
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
    color: '#a78bfa',
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
    color: '#a78bfa',
    fontSize: 12, fontWeight: '800',
  },
  urlClickableText: {
    flex: 1,
    color: '#c084fc',
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
  rawInputPrimaryText: {
    color: palette.textPrimary,
    fontSize: 14, lineHeight: 22,
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
    color: '#c084fc',
    fontSize: 14,
    fontWeight: '800',
  },
});
