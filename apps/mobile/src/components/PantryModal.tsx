import { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { SavedItem } from '@/features/items/types';
import { matchPantry, summarizeShoppingWins } from '@/features/facets/pantry';
import { facetEmoji } from '@/features/facets/labels';
import { palette } from '@/theme/palette';
import { spacing } from '@/theme/spacing';

type Props = {
  visible: boolean;
  items: SavedItem[];
  owned: string[];
  onChangeOwned: (owned: string[]) => void;
  onClose: () => void;
  onSelectItem: (itemId: string) => void;
};

/**
 * "집에 이 재료 있는데 뭐 해먹지?" 화면.
 *
 * 완성 가능한 것만 보여주면 실제로는 거의 안 걸립니다.
 * 부족한 재료가 1개인 레시피를 함께 묶어 보여주는 쪽이 훨씬 자주 쓰이고,
 * 그래서 상단에 "이거 하나 사면 N개가 열린다"를 먼저 얹었습니다.
 */
export function PantryModal({
  visible,
  items,
  owned,
  onChangeOwned,
  onClose,
  onSelectItem,
}: Props) {
  const [draft, setDraft] = useState('');

  const matches = useMemo(() => matchPantry(items, owned), [items, owned]);
  const wins = useMemo(() => summarizeShoppingWins(matches), [matches]);

  // 완성도로 구간을 나눕니다. 목록에서 빼는 대신 순서로 알려줍니다.
  const ready = matches.filter((match) => match.missing.length === 0);
  const almost = matches.filter(
    (match) => match.missing.length > 0 && match.missing.length <= 2
  );
  const needMore = matches.filter((match) => match.missing.length > 2);

  function addFromDraft() {
    // 쉼표든 공백이든 편한 대로 입력할 수 있게 둘 다 구분자로 받습니다.
    const parts = draft
      .split(/[,\s]+/)
      .map((part) => part.trim())
      .filter(Boolean);

    if (parts.length === 0) return;

    const next = [...owned];
    for (const part of parts) {
      if (!next.includes(part)) next.push(part);
    }
    onChangeOwned(next);
    setDraft('');
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>🧺 냉장고 털기</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>

          <Text style={styles.headerDesc}>
            가진 재료를 넣으면 만들 수 있는 것부터 보여줍니다.
          </Text>

          {/* 재료 입력 */}
          <View style={styles.inputRow}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={addFromDraft}
              placeholder="감자, 양파, 베이컨"
              placeholderTextColor={palette.textMuted}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
            />
            <Pressable onPress={addFromDraft} style={styles.addBtn}>
              <Text style={styles.addBtnText}>추가</Text>
            </Pressable>
          </View>

          {owned.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.ownedRow}
            >
              {owned.map((ingredient) => (
                <Pressable
                  key={ingredient}
                  onPress={() => onChangeOwned(owned.filter((entry) => entry !== ingredient))}
                  style={styles.ownedChip}
                >
                  <Text style={styles.ownedChipText}>
                    {facetEmoji('ingredient', ingredient)} {ingredient} ✕
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          <ScrollView style={styles.results} showsVerticalScrollIndicator={false}>
            {owned.length === 0 ? (
              <Text style={styles.hint}>재료를 하나만 넣어도 바로 찾아줍니다.</Text>
            ) : null}

            {/* 장보기 한 방 — 하나만 더 사면 열리는 것들 */}
            {wins.length > 0 ? (
              <View style={styles.winBox}>
                <Text style={styles.winLabel}>🛒 하나만 더 사면</Text>
                {wins.map((win) => (
                  <Text key={win.ingredient} style={styles.winText}>
                    {win.ingredient} → {win.unlocks}개 더 가능
                  </Text>
                ))}
              </View>
            ) : null}

            {ready.length > 0 ? (
              <>
                <Text style={styles.sectionLabel}>지금 바로 가능 ({ready.length})</Text>
                {ready.map((match) => (
                  <Pressable
                    key={match.item.id}
                    onPress={() => onSelectItem(match.item.id)}
                    style={styles.resultCard}
                  >
                    <Text style={styles.resultTitle}>{match.item.title}</Text>
                    <Text style={styles.resultMetaReady}>
                      재료 {match.required.length}개 모두 있음
                    </Text>
                  </Pressable>
                ))}
              </>
            ) : null}

            {almost.length > 0 ? (
              <>
                <Text style={styles.sectionLabel}>조금만 더 ({almost.length})</Text>
                {almost.map((match) => (
                  <Pressable
                    key={match.item.id}
                    onPress={() => onSelectItem(match.item.id)}
                    style={styles.resultCard}
                  >
                    <Text style={styles.resultTitle}>{match.item.title}</Text>
                    <Text style={styles.resultMeta}>
                      {match.owned.length}/{match.required.length} 보유 · 부족:{' '}
                      {match.missing.join(', ')}
                    </Text>
                  </Pressable>
                ))}
              </>
            ) : null}

            {needMore.length > 0 ? (
              <>
                <Text style={styles.sectionLabel}>재료를 더 사야 해요 ({needMore.length})</Text>
                {needMore.map((match) => (
                  <Pressable
                    key={match.item.id}
                    onPress={() => onSelectItem(match.item.id)}
                    style={styles.resultCard}
                  >
                    <Text style={styles.resultTitle}>{match.item.title}</Text>
                    <Text style={styles.resultMeta}>
                      {match.owned.length}/{match.required.length} 보유 · 부족:{' '}
                      {match.missing.join(', ')}
                    </Text>
                  </Pressable>
                ))}
              </>
            ) : null}

            {owned.length > 0 && matches.length === 0 ? (
              <Text style={styles.hint}>
                이 재료로 만들 수 있는 레시피가 아직 없습니다.
              </Text>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: palette.backgroundStrong,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: spacing[5],
    paddingTop: spacing[5],
    paddingBottom: spacing[8],
    maxHeight: '86%',
    gap: spacing[3],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    color: palette.textPrimary,
    fontSize: 17,
    fontWeight: '900',
  },
  headerDesc: {
    color: palette.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginTop: -spacing[2],
  },
  closeText: {
    color: palette.textSecondary,
    fontSize: 15,
    fontWeight: '900',
  },
  inputRow: {
    flexDirection: 'row',
    gap: spacing[2],
    alignItems: 'center',
  },
  input: {
    flex: 1,
    backgroundColor: palette.surfaceRaised,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: spacing[3],
    paddingVertical: 10,
    color: palette.textPrimary,
    fontSize: 13.5,
  },
  addBtn: {
    backgroundColor: palette.accent,
    borderRadius: 14,
    paddingHorizontal: spacing[4],
    paddingVertical: 11,
  },
  addBtnText: {
    color: '#ffffff',
    fontSize: 12.5,
    fontWeight: '900',
  },
  ownedRow: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 2,
  },
  ownedChip: {
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.accent,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  ownedChipText: {
    color: '#c084fc',
    fontSize: 11,
    fontWeight: '800',
  },
  results: {
    marginTop: spacing[1],
  },
  sectionLabel: {
    color: palette.textMuted,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
    marginTop: spacing[4],
    marginBottom: spacing[2],
  },
  resultCard: {
    backgroundColor: palette.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    marginBottom: spacing[2],
    gap: 3,
  },
  resultTitle: {
    color: palette.textPrimary,
    fontSize: 13.5,
    fontWeight: '800',
  },
  resultMeta: {
    color: palette.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  resultMetaReady: {
    color: palette.success,
    fontSize: 11,
    fontWeight: '800',
  },
  winBox: {
    backgroundColor: palette.successSoft,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    padding: spacing[4],
    gap: 4,
    marginTop: spacing[2],
  },
  winLabel: {
    color: palette.success,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  winText: {
    color: palette.textPrimary,
    fontSize: 12.5,
    fontWeight: '700',
  },
  hint: {
    color: palette.textMuted,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: spacing[6],
  },
});
