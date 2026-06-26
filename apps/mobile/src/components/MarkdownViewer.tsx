import React, { useMemo } from 'react';
import { StyleSheet, Text, View, Image, Linking, Pressable } from 'react-native';
import { palette } from '@/theme/palette';
import { spacing } from '@/theme/spacing';

type Props = {
  markdown: string;
  fontSizeScale?: number; // 0.85 (작게), 1.0 (보통), 1.25 (크게)
};

export function MarkdownViewer({ markdown, fontSizeScale = 1.0 }: Props) {
  const scale = fontSizeScale;

  const styles = useMemo(() => {
    return StyleSheet.create({
      container: {
        gap: spacing[3],
        paddingBottom: spacing[6],
      },
      h1: {
        fontSize: 22 * scale,
        fontWeight: '800',
        color: palette.textPrimary,
        marginTop: spacing[4],
        marginBottom: spacing[2],
        lineHeight: 28 * scale,
      },
      h2: {
        fontSize: 18 * scale,
        fontWeight: '700',
        color: palette.textPrimary,
        marginTop: spacing[3],
        marginBottom: spacing[1] + 2,
        lineHeight: 24 * scale,
      },
      h3: {
        fontSize: 16 * scale,
        fontWeight: '700',
        color: palette.textSecondary,
        marginTop: spacing[3],
        marginBottom: spacing[1],
        lineHeight: 22 * scale,
      },
      paragraph: {
        fontSize: 14.5 * scale,
        lineHeight: 22 * scale,
        color: palette.textSecondary,
        marginBottom: spacing[2],
      },
      boldText: {
        fontWeight: '800',
        color: palette.textPrimary,
      },
      inlineCode: {
        fontFamily: 'monospace',
        fontSize: 13 * scale,
        color: '#c084fc',
        backgroundColor: 'rgba(192, 132, 252, 0.12)',
        paddingHorizontal: 4,
        borderRadius: 4,
      },
      codeBlock: {
        backgroundColor: palette.backgroundStrong,
        borderWidth: 1,
        borderColor: palette.border,
        borderRadius: 12,
        padding: spacing[3],
        marginVertical: spacing[2],
      },
      codeBlockText: {
        fontFamily: 'monospace',
        fontSize: 12.5 * scale,
        lineHeight: 18 * scale,
        color: palette.textPrimary,
      },
      bulletRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing[2],
        paddingLeft: spacing[2],
        marginVertical: 2,
      },
      bulletDot: {
        fontSize: 14.5 * scale,
        lineHeight: 22 * scale,
        color: '#8b5cf6',
      },
      bulletText: {
        flex: 1,
        fontSize: 14.5 * scale,
        lineHeight: 22 * scale,
        color: palette.textSecondary,
      },
      blockquote: {
        borderLeftWidth: 3,
        borderLeftColor: '#8b5cf6',
        backgroundColor: 'rgba(139, 92, 246, 0.05)',
        paddingHorizontal: spacing[3],
        paddingVertical: spacing[2],
        borderRadius: 4,
        marginVertical: spacing[1],
      },
      blockquoteText: {
        fontSize: 14 * scale,
        lineHeight: 20 * scale,
        color: palette.textMuted,
        fontStyle: 'italic',
      },
      imageContainer: {
        width: '100%',
        borderRadius: 12,
        overflow: 'hidden',
        marginVertical: spacing[3],
        borderWidth: 1,
        borderColor: palette.border,
      },
      image: {
        width: '100%',
        aspectRatio: 16 / 9,
        backgroundColor: palette.backgroundStrong,
      },
      hr: {
        height: 1,
        backgroundColor: palette.border,
        marginVertical: spacing[4],
      },
      linkText: {
        color: '#a78bfa',
        textDecorationLine: 'underline',
      },
    });
  }, [scale]);

  function parseInlineText(text: string): React.ReactNode[] {
    // 1. 복합 이미지 링크 패턴 `[![대체](img_url)](link_url)` 제거
    let cleanText = text.replace(/\[!\[.*?\]\(.*?\)\s?\]\(.*?\)/g, '');

    // 2. 인라인 단독 이미지 패턴이 텍스트 형태로 노출되는 오작동을 제거
    cleanText = cleanText.replace(/!\[.*?\]\(.*?\)/g, '');

    // 3. [링크](url) 및 **볼드**, `코드` 매칭 분할
    // 정규식: (\[.*?\]\(.*?\)) | (\*\*.*?\*\*) | (`.*?`)
    const parts = cleanText.split(/(\[.*?\]\(.*?\))|(\*\*.*?\*\*)|(`.*?`)/g);

    return parts.map((part, idx) => {
      if (!part) return null;

      // 마크다운 링크 매칭 [표시텍스트](주소)
      if (part.startsWith('[') && part.includes('](')) {
        const linkMatch = part.match(/\[(.*?)\]\((.*?)\)/);
        if (linkMatch) {
          const display = linkMatch[1];
          const url = linkMatch[2];
          return (
            <Text
              key={idx}
              onPress={() => Linking.openURL(url).catch(() => {})}
              style={styles.linkText}
            >
              {display}
            </Text>
          );
        }
      }

      // 볼드 매칭 **텍스트**
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <Text key={idx} style={styles.boldText}>
            {part.slice(2, -2)}
          </Text>
        );
      }

      // 인라인 코드 `코드`
      if (part.startsWith('`') && part.endsWith('`')) {
        return (
          <Text key={idx} style={styles.inlineCode}>
            {part.slice(1, -1)}
          </Text>
        );
      }

      // 일반 텍스트
      return <Text key={idx}>{part}</Text>;
    });
  }

  // 렌더링 트리 구성
  const nodes = useMemo(() => {
    const lines = markdown.split('\n');
    const result: React.ReactNode[] = [];
    let codeBlockBuffer: string[] = [];
    let isInsideCodeBlock = false;

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const line = rawLine.trim();

      // 1. 코드 블록 처리
      if (line.startsWith('```')) {
        if (isInsideCodeBlock) {
          // 코드블록 종료
          const codeString = codeBlockBuffer.join('\n');
          result.push(
            <View key={`code-${i}`} style={styles.codeBlock}>
              <Text style={styles.codeBlockText} selectable>
                {codeString}
              </Text>
            </View>
          );
          codeBlockBuffer = [];
          isInsideCodeBlock = false;
        } else {
          // 코드블록 시작
          isInsideCodeBlock = true;
        }
        continue;
      }

      if (isInsideCodeBlock) {
        codeBlockBuffer.push(rawLine);
        continue;
      }

      // 2. 빈 줄 처리
      if (!line) {
        result.push(<View key={`empty-${i}`} style={{ height: spacing[2] }} />);
        continue;
      }

      // 3. 구분선 (HR)
      if (line === '---' || line === '***' || line === '___') {
        result.push(<View key={`hr-${i}`} style={styles.hr} />);
        continue;
      }

      // 4. 제목 (H1 ~ H3)
      if (line.startsWith('# ')) {
        result.push(
          <Text key={`h1-${i}`} style={styles.h1}>
            {line.slice(2)}
          </Text>
        );
        continue;
      }
      if (line.startsWith('## ')) {
        result.push(
          <Text key={`h2-${i}`} style={styles.h2}>
            {line.slice(3)}
          </Text>
        );
        continue;
      }
      if (line.startsWith('### ')) {
        result.push(
          <Text key={`h3-${i}`} style={styles.h3}>
            {line.slice(4)}
          </Text>
        );
        continue;
      }

      // 5. 인용구 (Blockquote)
      if (line.startsWith('>')) {
        const text = line.replace(/^>\s?/, '');
        result.push(
          <View key={`quote-${i}`} style={styles.blockquote}>
            <Text style={styles.blockquoteText}>{parseInlineText(text)}</Text>
          </View>
        );
        continue;
      }

      // 6. 이미지 ![alt](url)
      if (line.startsWith('!') && line.includes('[') && line.includes('](')) {
        const imgMatch = line.match(/!\[.*?\]\((https?:\/\/.*?)\)/);
        if (imgMatch && imgMatch[1]) {
          result.push(
            <View key={`img-${i}`} style={styles.imageContainer}>
              <Image
                source={{ uri: imgMatch[1] }}
                style={styles.image as any}
                resizeMode="cover"
              />
            </View>
          );
          continue;
        }
      }

      // 7. 글머리 목록 (Bullet List)
      if (line.startsWith('- ') || line.startsWith('* ')) {
        const text = line.slice(2);
        result.push(
          <View key={`bullet-${i}`} style={styles.bulletRow}>
            <Text style={styles.bulletDot}>•</Text>
            <Text style={styles.bulletText}>{parseInlineText(text)}</Text>
          </View>
        );
        continue;
      }

      // 8. 일반 문단
      result.push(
        <Text key={`p-${i}`} style={styles.paragraph}>
          {parseInlineText(rawLine)}
        </Text>
      );
    }

    return result;
  }, [markdown, styles]);

  return <View style={styles.container}>{nodes}</View>;
}
