# Android Share Intent 설계

## 1. 목적

유튜브, 인스타그램 등 외부 앱의 공유 시트에서 우리 앱이 공유 대상에 나타나고,
공유된 URL 또는 텍스트를 받아서 즉시 로컬에 저장하는 구조를 정의한다.

핵심 원칙:
- 공유 진입도 일반 저장과 동일하게 `저장 우선`
- 공유 데이터는 먼저 로컬 저장
- AI/메타데이터 보강은 저장 이후 비동기 처리

---

## 2. 지원 우선순위

1. 유튜브 링크 공유
2. 인스타그램 링크 공유
3. 일반 웹 URL 공유
4. 텍스트 안에 포함된 URL 공유

초기 범위에서는 `text/*` 공유를 우선 처리한다.

이유:
- 유튜브/인스타 공유는 실제로 URL 또는 URL이 포함된 텍스트 형태가 많다
- 이미지/동영상 직접 공유보다 링크 저장이 제품 핵심과 더 가깝다

---

## 3. Android 동작 방식

Android 공식 방식은 `ACTION_SEND` 또는 `ACTION_SEND_MULTIPLE` intent를
manifest의 `intent-filter`로 수신하는 것이다.

우리 앱에서 필요한 최소 범위:
- `ACTION_SEND`
- MIME type: `text/*`
- 필요 시 후속 단계에서 `image/*`, `video/*` 추가 검토

공식 참고:
- Android Developers: Receive simple data from other apps

---

## 4. Expo 기준 구현 전략

### 추천 접근
- Expo SDK 54 기준 `expo-share-intent` 사용 검토

이유:
- Expo managed / prebuild 흐름에서 Android share intent를 다루기 가장 현실적임
- text/url 중심 시작에 적합
- 이후 iOS share extension까지 같은 개념으로 확장 가능

주의:
- Expo Go로는 테스트 불가
- Custom Dev Client 또는 실제 빌드 필요
- 실제 도입 시 `expo-linking`, plugin 설정, dev build 절차가 필요

현재 단계 결론:
- 지금은 설계 완료
- 실제 패키지 도입은 Android 실기기 또는 SDK 환경 준비 후 진행

---

## 5. 앱 내부 데이터 흐름

공유 진입 시 흐름:

1. 외부 앱이 `text/plain` 공유
2. Android share intent가 앱을 실행
3. 공유 payload에서 URL 후보 추출
4. URL 정규화
5. 로컬 DB 저장
6. 목록 즉시 반영
7. 메타데이터 보강
8. 이후 AI/동기화 진행

최종 구조:

`Share Intent -> Shared Text Normalizer -> Local Save -> Metadata Enrichment -> AI -> Sync`

---

## 6. 현재 코드 기준 준비된 부분

이미 준비된 것:
- URL 정규화 저장 흐름
- 로컬 DB 저장
- 저장 후 목록 즉시 반영
- 저장 후 메타데이터 비동기 보강

이번에 추가된 준비:
- 공유 텍스트 안에서 URL을 추출하는 로직
- 즉, `"이거 봐봐 https://youtube.com/..."` 형태도 저장 가능

관련 코드:
- `apps/mobile/src/features/capture/normalizeSharedInput.ts`

---

## 7. 유튜브/인스타 대응 원칙

### 유튜브
- `youtube.com/watch`
- `youtu.be/...`
- `youtube.com/shorts/...`

처리:
- URL 정규화
- 가능하면 `watch?v=` 형태로 통일
- oEmbed + HTML meta로 제목/요약/썸네일 확보

### 인스타그램
- `instagram.com/p/...`
- `instagram.com/reel/...`
- `instagram.com/reels/...`

처리:
- URL 정규화
- 추적 파라미터 제거
- 공개 페이지 HTML의 `og:*` 메타 우선 사용

---

## 8. 실제 구현 단계

### Step 1
- Android용 share intent 패키지 도입
- app config plugin 연결
- `text/*` intent filter만 먼저 활성화

### Step 2
- 앱 시작 시 공유 payload 읽기
- payload의 `text`, `webUrl`을 현재 저장 로직에 연결

### Step 3
- 공유로 들어왔을 때 전용 진입 UX 추가
- "공유된 링크를 저장합니다" 확인 화면 또는 자동 저장 UX 결정

### Step 4
- 유튜브/인스타 실제 기기 테스트
- 예외 케이스 정리

---

## 9. 테스트 케이스

1. 유튜브 앱에서 영상 공유 -> 우리 앱 선택 -> 링크 저장
2. 인스타 앱에서 릴스 공유 -> 우리 앱 선택 -> 링크 저장
3. 브라우저에서 URL 공유 -> 우리 앱 선택 -> 링크 저장
4. 텍스트 + URL 형태 공유 -> URL만 추출해 저장
5. URL 없는 텍스트 공유 -> 에러 처리

---

## 10. 다음 액션

다음 구현 작업:

1. Android share intent 패키지 도입
2. app config plugin 연결
3. 공유 payload를 현재 `saveUrl` 흐름에 연결
