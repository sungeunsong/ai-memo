import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Palette } from '@/theme/palette';
import { useThemedStyles } from '@/theme/ThemeContext';
import { spacing } from '@/theme/spacing';

/**
 * SNS 캡션이나 공유 원문을 읽을 수 있는 덩어리로 나눠 보여줍니다.
 *
 * 원문을 <Text> 하나에 통째로 넣으면 줄바꿈만 살아남고 구조는 사라집니다.
 * 인스타 캡션처럼 "1️⃣ 소제목 → 👉 설명" 패턴이 반복되는 글은
 * 그 구조를 그대로 살려줘야 훑어보기가 됩니다.
 */

type Block =
  | { kind: 'heading'; marker: string | null; text: string }
  | { kind: 'bullet'; marker: string; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'tags'; tags: string[] }
  | { kind: 'divider' };

/** 1️⃣ ① 1. 1) [1] 처럼 순번이 붙은 줄 */
const ORDERED_MARKER = /^((?:[0-9]️?⃣)|[①-⑳]|\[[0-9]{1,2}\]|[0-9]{1,2}[.)])\s*/;
/** - • ✅ 👉 ※ 등 글머리 기호 */
const BULLET_MARKER = /^([-*•·▪◦‣]|✅|✔|☑|👉|➡️?|▶️?|※|💡|📌)\s*/;
/** --- === ㅡㅡㅡ 같은 구분선 */
const DIVIDER = /^([-=_~*·ㅡ—–\s]{3,})$/;

function isTagLine(line: string): boolean {
  const tokens = line.split(/\s+/).filter(Boolean);
  return tokens.length >= 2 && tokens.every((t) => t.startsWith('#'));
}

export function parseReadableBlocks(raw: string): Block[] {
  if (!raw) return [];

  const lines = raw
    .replace(/\r\n?/g, '\n')
    .replace(/[​﻿]/g, '')
    .split('\n')
    .map((line) => line.trim());

  const blocks: Block[] = [];
  let paragraph: string[] = [];

  function flush() {
    if (paragraph.length === 0) return;
    blocks.push({ kind: 'paragraph', text: paragraph.join('\n') });
    paragraph = [];
  }

  for (const line of lines) {
    if (!line) {
      // 빈 줄은 문단 경계입니다. 연속된 빈 줄은 하나로 봅니다.
      flush();
      continue;
    }

    if (DIVIDER.test(line)) {
      flush();
      if (blocks[blocks.length - 1]?.kind !== 'divider') blocks.push({ kind: 'divider' });
      continue;
    }

    if (isTagLine(line)) {
      flush();
      blocks.push({ kind: 'tags', tags: line.split(/\s+/).filter(Boolean) });
      continue;
    }

    const ordered = line.match(ORDERED_MARKER);
    if (ordered) {
      flush();
      blocks.push({
        kind: 'heading',
        marker: ordered[1].replace(/[.)\[\]]/g, ''),
        text: line.slice(ordered[0].length).trim(),
      });
      continue;
    }

    if (line.startsWith('#') && !line.startsWith('#​')) {
      const heading = line.replace(/^#{1,4}\s*/, '').trim();
      // '#해시태그' 한 개짜리 줄은 제목이 아니라 태그입니다.
      if (heading && line.match(/^#{1,4}\s/)) {
        flush();
        blocks.push({ kind: 'heading', marker: null, text: heading });
        continue;
      }
    }

    const bullet = line.match(BULLET_MARKER);
    if (bullet) {
      flush();
      // 글쓴이가 쓴 이모지(👉, ✅ 등)는 그대로 둡니다.
      // 전부 '•'로 갈아버리면 원문이 주던 뉘앙스가 사라집니다.
      const marker = /^[-*•·▪◦‣]$/.test(bullet[1]) ? '•' : bullet[1];
      blocks.push({ kind: 'bullet', marker, text: line.slice(bullet[0].length).trim() });
      continue;
    }

    // 짧으면서 콜론으로 끝나는 줄은 소제목으로 봅니다.
    if (line.length <= 28 && /[:：]$/.test(line)) {
      flush();
      blocks.push({ kind: 'heading', marker: null, text: line.replace(/[:：]$/, '').trim() });
      continue;
    }

    paragraph.push(line);
  }

  flush();
  return blocks;
}

type Props = {
  text: string;
  /** 이 개수를 넘으면 접어두고 '더 보기'를 답니다. 0이면 접지 않습니다. */
  collapseAfter?: number;
};

export function StructuredText({ text, collapseAfter = 0 }: Props) {
  const styles = useThemedStyles(createStyles);
  const blocks = useMemo(() => parseReadableBlocks(text), [text]);
  const [isExpanded, setIsExpanded] = useState(false);

  if (blocks.length === 0) return null;

  const isCollapsible = collapseAfter > 0 && blocks.length > collapseAfter + 2;
  const visible = isCollapsible && !isExpanded ? blocks.slice(0, collapseAfter) : blocks;

  return (
    <View style={styles.container}>
      {visible.map((block, idx) => {
        switch (block.kind) {
          case 'divider':
            return <View key={idx} style={styles.divider} />;
          case 'heading':
            return (
              <View key={idx} style={styles.headingRow}>
                {block.marker ? (
                  <Text style={styles.headingMarker}>{block.marker}</Text>
                ) : (
                  <View style={styles.headingBar} />
                )}
                <Text style={styles.headingText}>{block.text}</Text>
              </View>
            );
          case 'bullet':
            return (
              <View key={idx} style={styles.bulletRow}>
                <Text style={styles.bulletDot}>{block.marker}</Text>
                <Text style={styles.bulletText}>{block.text}</Text>
              </View>
            );
          case 'tags':
            return (
              <View key={idx} style={styles.tagRow}>
                {block.tags.map((tag, tagIdx) => (
                  <Text key={`${tag}_${tagIdx}`} style={styles.tag}>
                    {tag}
                  </Text>
                ))}
              </View>
            );
          default:
            return (
              <Text key={idx} style={styles.paragraph} selectable>
                {block.text}
              </Text>
            );
        }
      })}

      {isCollapsible ? (
        <Pressable
          onPress={() => setIsExpanded(!isExpanded)}
          style={({ pressed }) => [styles.moreBtn, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.moreBtnText}>
            {isExpanded ? '접기 ▴' : `더 보기 (${blocks.length - collapseAfter}줄) ▾`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const createStyles = (palette: Palette) =>
  StyleSheet.create({
    container: {
      gap: spacing[2],
    },
    paragraph: {
      color: palette.textSecondary,
      fontSize: 14.5,
      lineHeight: 24,
    },
    headingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      marginTop: spacing[2],
    },
    headingMarker: {
      minWidth: 22,
      height: 22,
      lineHeight: 22,
      textAlign: 'center',
      borderRadius: 7,
      overflow: 'hidden',
      backgroundColor: palette.accentSoft,
      color: palette.accentText,
      fontSize: 12,
      fontWeight: '900',
    },
    headingBar: {
      width: 3,
      height: 15,
      borderRadius: 2,
      backgroundColor: palette.accent,
    },
    headingText: {
      flex: 1,
      color: palette.textPrimary,
      fontSize: 15,
      lineHeight: 22,
      fontWeight: '800',
      letterSpacing: -0.2,
    },
    bulletRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing[2],
      paddingLeft: spacing[1],
    },
    bulletDot: {
      color: palette.accent,
      fontSize: 14.5,
      lineHeight: 24,
      fontWeight: '900',
    },
    bulletText: {
      flex: 1,
      color: palette.textSecondary,
      fontSize: 14.5,
      lineHeight: 24,
    },
    tagRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing[1],
      marginTop: spacing[1],
    },
    tag: {
      color: palette.textMuted,
      fontSize: 12,
      backgroundColor: palette.surface,
      borderRadius: 999,
      paddingHorizontal: spacing[2],
      paddingVertical: 3,
      overflow: 'hidden',
    },
    divider: {
      height: 1,
      backgroundColor: palette.border,
      marginVertical: spacing[2],
    },
    moreBtn: {
      alignSelf: 'flex-start',
      marginTop: spacing[1],
      paddingVertical: spacing[2],
      paddingHorizontal: spacing[3],
      borderRadius: 999,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
    },
    moreBtnText: {
      color: palette.textSecondary,
      fontSize: 12.5,
      fontWeight: '800',
    },
  });
