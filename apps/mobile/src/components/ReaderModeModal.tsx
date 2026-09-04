import React, { useState, useMemo } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  Pressable,
  View,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MarkdownViewer } from './MarkdownViewer';
import { Palette } from '@/theme/palette';
import { useThemedStyles } from '@/theme/ThemeContext';
import { spacing } from '@/theme/spacing';

type Props = {
  visible: boolean;
  onClose: () => void;
  title: string;
  markdown: string;
};

type FontScaleOption = {
  label: string;
  value: number;
};

const SCALE_OPTIONS: FontScaleOption[] = [
  { label: '작게', value: 0.85 },
  { label: '보통', value: 1.0 },
  { label: '크게', value: 1.25 },
];

/**
 * 줄바꿈 없이 길게 이어지는 문단을 문장 단위로 끊습니다.
 *
 * 인스타그램 캡션은 한 줄에 수백 자가 이어져 벽처럼 보입니다.
 * 마크다운 문서는 이미 구조가 있으므로 건드리지 않고,
 * 지나치게 긴 줄에만 적용합니다.
 *
 * 문장 끝 부호와 그 뒤에 붙는 이모지까지 한 덩어리로 보고 끊습니다.
 * 캡션은 '느껴보실 분?🔥' 처럼 부호 다음에 이모지가 오는 경우가 많습니다.
 */
const LONG_LINE_THRESHOLD = 140;
const EMOJI_RUN = '[\\u2190-\\u21FF\\u2300-\\u27BF\\u2B00-\\u2BFF\\uFE0F\\u200D\\uD83C-\\uDBFF\\uDC00-\\uDFFF]';

function breakLongRuns(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      if (line.length < LONG_LINE_THRESHOLD) return line;
      // 인용·목록·표·제목 같은 마크다운 구조 줄은 그대로 둡니다.
      if (/^\s*([#>|]|[-*+]\s|\d+\.\s)/.test(line)) return line;

      const pieces = line
        .replace(new RegExp(`([.!?…]+\\s*(?:${EMOJI_RUN}+\\s*)?)`, 'g'), '$1\n')
        .split('\n');

      // '진심..'처럼 짧은 조각이 혼자 한 줄을 차지하면 오히려 읽기 나빠집니다.
      // 앞 줄에 도로 붙입니다.
      const merged: string[] = [];
      for (const piece of pieces) {
        const trimmed = piece.trim();
        if (!trimmed) continue;
        if (merged.length > 0 && trimmed.length < 12) {
          merged[merged.length - 1] += ` ${trimmed}`;
        } else {
          merged.push(trimmed);
        }
      }

      return merged.join('\n');
    })
    .join('\n');
}

function sanitizeMarkdown(text: string): string {
  if (!text) return '';

  text = breakLongRuns(text);

  const lines = text.split('\n');
  let shouldStop = false;

  const cleanedLines = lines.filter((line) => {
    const trimmed = line.trim();

    // 본문 이후에 따라오는 광고성/쇼핑몰 추천 상품 영역 원천 차단
    if (
      trimmed.includes('관련 상품') ||
      trimmed.includes('추천 상품') ||
      trimmed.includes('쇼핑몰') ||
      trimmed.includes('이 블로그의 다른 글') ||
      trimmed.includes('카테고리 다른 글') ||
      trimmed.includes('인기 레시피') ||
      trimmed.includes('비슷한 레시피') ||
      trimmed.includes('다른 레시피')
    ) {
      shouldStop = true;
    }

    if (shouldStop) {
      return false;
    }

    // 헤더 로고 이미지 링크 및 도메인 잔해 차단
    if (
      trimmed.includes('![Image 2: 로고]') ||
      trimmed.includes('ezmember.co.kr') ||
      trimmed.includes('index.html') ||
      trimmed.includes('logo4.png')
    ) {
      return false;
    }

    // 1. 만개의 레시피 등에서 자주 긁혀 들어오는 불필요한 네비게이션/로딩 문구 필터링
    if (
      trimmed === '더보기' ||
      trimmed === '이벤트' ||
      trimmed === '브랜드' ||
      trimmed === '쉐프' ||
      trimmed === '만개 인플루언서' ||
      trimmed === '로그인' ||
      trimmed === '회원가입' ||
      trimmed.startsWith('회원가입') ||
      trimmed === ';;)'
    ) {
      return false;
    }
    if (
      trimmed.includes('Loading...') ||
      trimmed.includes('AI가 내용을 분석하고 있어요') ||
      trimmed.includes('잠시만 기다려주세요')
    ) {
      return false;
    }
    if (
      trimmed.startsWith('레시피 등록') ||
      trimmed.includes('레시피를 가져올 방식을 선택') ||
      trimmed.includes('블로그 글 URL은 네이버')
    ) {
      return false;
    }
    if (
      trimmed.includes('직접등록블로그 레시피 가져오기') ||
      trimmed.includes('https://blog.naver.com')
    ) {
      return false;
    }

    // 2. 불필요한 껍데기 메뉴 불릿 제거 (예: * 이벤트, * 브랜드 및 추천 검색어들)
    const menuRegex = /^[-*]\s?(이벤트|브랜드|쉐프|만개|로그인|회원가입|레시피 등록|더보기|레시피 가져오기|탄수화물 식단|오이 무침|냉동 닭가슴살 요리|감자|감자 조림|두부 찌개|두부 조림|닭볶음탕|김치 찌개|제육 볶음)/;
    if (menuRegex.test(trimmed)) {
      return false;
    }

    // 3. 빈 마크다운 링크로만 구성된 불필요한 줄 제거
    const emptyLinkRegex = /^[-*]?\s?\[(더보기|이벤트|브랜드|쉐프|로그인|회원가입|만개 인플루언서|로고)\]\(.*?\)$/i;
    if (emptyLinkRegex.test(trimmed)) {
      return false;
    }

    return true;
  });

  // 연속된 빈 라인이 너무 많으면 제거 (가독성 향상)
  const resultLines: string[] = [];
  let prevIsEmpty = false;
  for (const line of cleanedLines) {
    const isEmpty = line.trim() === '';
    if (isEmpty && prevIsEmpty) {
      continue;
    }
    resultLines.push(line);
    prevIsEmpty = isEmpty;
  }

  return resultLines.join('\n');
}

export function ReaderModeModal({ visible, onClose, title, markdown }: Props) {
  const styles = useThemedStyles(createStyles);
  const [scaleIndex, setScaleIndex] = useState(1); // 기본값 '보통' (1.0)
  const currentScale = SCALE_OPTIONS[scaleIndex];

  const sanitizedMarkdown = useMemo(() => sanitizeMarkdown(markdown), [markdown]);

  function handleToggleFontSize() {
    setScaleIndex((prev) => (prev + 1) % SCALE_OPTIONS.length);
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.safeArea}>
        {/* 상단바 헤더 */}
        <View style={styles.header}>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [
              styles.closeButton,
              { opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Text style={styles.closeButtonText}>✕ 닫기</Text>
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {title || '원문 본문'}
          </Text>
          <Pressable
            onPress={handleToggleFontSize}
            style={({ pressed }) => [
              styles.fontScaleButton,
              { transform: [{ scale: pressed ? 0.95 : 1 }] },
            ]}
          >
            <Text style={styles.fontScaleIcon}>가A</Text>
            <Text style={styles.fontScaleLabel}>{currentScale.label}</Text>
          </Pressable>
        </View>

        {/* 본문 스크롤 영역 */}
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={true}
        >
          <MarkdownViewer markdown={sanitizedMarkdown} fontSizeScale={currentScale.value} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const createStyles = (palette: Palette) =>
  StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: palette.background,
  },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
    backgroundColor: palette.surface,
  },
  closeButton: {
    paddingVertical: spacing[1],
    paddingHorizontal: spacing[2],
  },
  closeButtonText: {
    color: palette.textSecondary,
    fontSize: 14,
    fontWeight: '700',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    marginHorizontal: spacing[3],
    fontSize: 14,
    fontWeight: '800',
    color: palette.textPrimary,
  },
  fontScaleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.2)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  fontScaleIcon: {
    color: palette.accentText,
    fontSize: 12,
    fontWeight: '900',
  },
  fontScaleLabel: {
    color: palette.accentLink,
    fontSize: 11,
    fontWeight: '800',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing[4],
  },
});
