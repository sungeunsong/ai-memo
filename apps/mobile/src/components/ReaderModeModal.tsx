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
import { palette } from '@/theme/palette';
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

function sanitizeMarkdown(text: string): string {
  if (!text) return '';

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

const styles = StyleSheet.create({
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
    color: '#c084fc',
    fontSize: 12,
    fontWeight: '900',
  },
  fontScaleLabel: {
    color: '#a78bfa',
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
