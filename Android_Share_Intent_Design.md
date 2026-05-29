# Android Share Intent 설계

## 1. 목적

유튜브, 인스타그램 등 외부 앱의 공유 시트에서 우리 앱이 공유 대상에 나타나고,
공유된 URL 또는 텍스트를 받아서 즉시 로컬에 저장하는 구조를 정의한다.

특히 인스타그램 게시물/릴스, DM에서 복사한 텍스트, Notion/Google Docs 링크처럼
흩어지기 쉬운 정보를 capture inbox에 모으는 것이 우선 목적이다.

핵심 원칙:
- 공유 진입도 일반 저장과 동일하게 `저장 우선`
- 공유 데이터는 먼저 로컬 저장
- AI/메타데이터 보강은 저장 이후 비동기 처리

---

## 2. 지원 우선순위

1. 유튜브 링크 공유
2. 인스타그램 링크 공유
3. Notion / Google Docs / Google Drive 링크 공유
4. 일반 웹 URL 공유
5. 텍스트 안에 포함된 URL 공유
6. URL 없는 텍스트 공유

초기 범위에서는 `text/*` 공유를 우선 처리한다.

이유:
- 유튜브/인스타 공유는 실제로 URL 또는 URL이 포함된 텍스트 형태가 많다
- DM/캡션 복사본은 URL 없이 텍스트만 들어올 수도 있다
- 이미지/동영상 직접 공유보다 링크 저장이 제품 핵심과 더 가깝다

편의성 관점에서 공유 시트만 유일한 진입점으로 보면 안 된다. Instagram DM이나 일부 앱 화면에서는 메시지 전체 공유가 제한될 수 있으므로, 사용자가 링크를 길게 눌러 공유하거나 복사한 뒤 앱을 열어 저장하는 흐름도 같은 1차 경로로 취급한다.

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
- Expo SDK 54 기준 `expo-share-intent` 사용

이유:
- Expo managed / prebuild 흐름에서 Android share intent를 다루기 가장 현실적임
- text/url 중심 시작에 적합
- 이후 iOS share extension까지 같은 개념으로 확장 가능

주의:
- Expo Go로는 테스트 불가
- Custom Dev Client 또는 실제 빌드 필요
- 실제 도입 시 `expo-linking`, plugin 설정, dev build 절차가 필요

현재 단계 결론:
- `expo-share-intent` 패키지와 app config plugin은 도입됨
- Android `text/*` intent filter가 설정됨
- 실제 유튜브/인스타 앱 공유 테스트는 dev build와 실기기에서 추가 검증 필요

---

## 5. 앱 내부 데이터 흐름

공유 진입 시 흐름:

1. 외부 앱이 `text/plain` 공유
2. Android share intent가 앱을 실행
3. 공유 payload에서 URL 후보 추출
4. URL이 있으면 정규화하고 여러 URL 후보를 보존
5. URL이 없어도 원문 텍스트를 저장
6. source type 자동 분류
7. 로컬 DB 저장
8. 목록 즉시 반영
9. 메타데이터 보강
10. 이후 AI/동기화 진행

최종 구조:

`Share Intent -> Shared Text Normalizer -> Source Classifier -> Local Save -> Metadata Enrichment -> AI -> Sync`

복사 후 앱 실행 흐름:

1. 사용자가 DM/캡션/문서 링크를 복사
2. 앱을 실행
3. 앱이 클립보드에서 URL 또는 저장 가능한 텍스트 후보를 감지
4. 첫 화면 상단에 "복사한 내용 저장" 제안 표시
5. 사용자가 확인하면 공유 인입과 같은 저장 파이프라인 사용

`Clipboard Candidate -> User Confirm -> Shared Text Normalizer -> Source Classifier -> Local Save`

---

## 6. 현재 코드 기준 준비된 부분

이미 준비된 것:
- URL 정규화 저장 흐름
- 로컬 DB 저장
- 저장 후 목록 즉시 반영
- 저장 후 메타데이터 비동기 보강
- Android `text/*` share intent 패키지 설정
- 공유 payload를 현재 저장 흐름에 연결

이번에 추가된 준비:
- 공유 텍스트 안에서 URL을 추출하는 로직
- 즉, `"이거 봐봐 https://youtube.com/..."` 형태도 저장 가능

관련 코드:
- `apps/mobile/src/features/capture/normalizeSharedInput.ts`
- `apps/mobile/src/features/capture/shareIntent.ts`

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

### Notion / Google Docs / Google Drive
- `notion.so`, `notion.site`
- `docs.google.com/document`
- `docs.google.com/spreadsheets`
- `docs.google.com/forms`
- `forms.gle`
- `drive.google.com`

처리:
- source type을 일반 웹과 구분
- 문서 링크로 표시
- 공개 메타데이터가 부족해도 원문 텍스트와 URL은 보존

---

## 8. 실제 구현 단계

### Step 1 완료
- Android용 share intent 패키지 도입
- app config plugin 연결
- `text/*` intent filter 활성화

### Step 2 완료
- 앱 시작 시 공유 payload 읽기
- payload의 `text`, `webUrl`을 현재 저장 로직에 연결

### Step 3
- 공유로 들어왔을 때 전용 진입 UX 추가
- "공유된 링크를 저장합니다" 확인 화면 또는 자동 저장 UX 결정

### Step 4
- 유튜브/인스타 실제 기기 테스트
- 예외 케이스 정리

### Step 5
- URL 없는 텍스트 저장 지원
- 여러 URL 추출 결과 저장
- source type 자동 분류 추가

---

## 9. 테스트 케이스

1. 유튜브 앱에서 영상 공유 -> 우리 앱 선택 -> 링크 저장
2. 인스타 앱에서 릴스 공유 -> 우리 앱 선택 -> 링크 저장
3. 브라우저에서 URL 공유 -> 우리 앱 선택 -> 링크 저장
4. 텍스트 + URL 형태 공유 -> URL만 추출해 저장
5. URL 없는 텍스트 공유 -> 원문 텍스트 항목으로 저장
6. DM 복사 텍스트 + Notion 링크 -> 원문과 링크 모두 저장
7. Google Docs 링크 공유 -> 문서 링크로 분류
8. Instagram DM의 링크 길게 누르기 -> 공유 시트에 우리 앱 표시 여부 확인
9. Instagram DM의 링크 복사 -> 앱 실행 -> 클립보드 저장 제안 표시
10. Instagram DM 메시지 전체 복사 -> 앱 실행 -> 원문 텍스트 저장 제안 표시

---

## 10. 다음 액션

다음 구현 작업:

1. URL 없는 텍스트 저장 지원
2. 여러 URL 추출과 원문 보존
3. source type 자동 분류
4. 공유 진입 전용 UX 개선
5. 클립보드 후보 감지와 저장 제안 UX 추가
6. Instagram DM 길게 누르기/공유/복사 실기기 테스트
