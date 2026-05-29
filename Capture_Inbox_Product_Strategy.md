# Capture Inbox Product Strategy

## 1. 제품 목적

이 앱의 1차 목적은 단순 북마크가 아니라, 인스타그램과 메신저에서 흘러오는 정보를 잃어버리지 않게 저장하는 개인 정보 수집함을 만드는 것이다.

실제 문제:
- 인스타그램 게시물, 릴스, 프로필, DM으로 받은 정보가 금방 사라진다
- 정보 제공자가 Notion, Google Docs, Google Drive, Form 링크를 보내는 경우가 많다
- 링크만 저장하면 나중에 왜 저장했는지 기억하기 어렵다
- 저장 위치가 인스타 저장함, DM, 브라우저 북마크, 메모앱으로 흩어진다

제품의 핵심 약속:
- 뭐든 빠르게 저장된다
- 어디서 온 정보인지 남는다
- 나중에 검색해서 다시 찾을 수 있다
- AI는 저장을 돕는 후처리이지 저장의 전제 조건이 아니다

---

## 2. 제품 포지셔닝

기존 표현:
- 온디바이스 AI 지식 저장 앱

더 정확한 v1 표현:
- 인스타그램, DM, 문서 링크를 위한 local-first capture inbox

핵심 사용자 행동:
1. 인스타그램에서 게시물/릴스/프로필을 발견한다
2. DM이나 캡션에서 Notion/Google Docs/Drive 링크를 받는다
3. 앱으로 공유하거나 텍스트를 붙여넣는다
4. 앱은 원문, 링크, 출처, 메모를 함께 저장한다
5. 나중에 검색/태그/상태로 다시 찾는다

---

## 3. 우선 지원할 입력

편의성 원칙:
- 가능한 경우 외부 앱의 공유 시트에 우리 앱이 바로 떠야 한다
- 공유 시트가 뜨지 않는 앱/화면에서는 복사 후 앱을 열면 바로 저장할 수 있어야 한다
- DM처럼 공유 액션이 제한적인 곳은 길게 누르기, 링크 복사, 메시지 복사, 클립보드 붙여넣기를 모두 지원해야 한다
- 사용자가 앱 안에서 URL 입력란을 찾아 헤매지 않게, 최근 클립보드 후보를 첫 화면에서 바로 제안해야 한다

### Phase 1 필수
- URL 직접 입력
- 클립보드 붙여넣기
- Android Share Intent `text/*`
- 앱 실행 시 클립보드 링크/텍스트 감지 후 저장 제안
- URL 없는 텍스트 저장
- 여러 URL이 섞인 텍스트 저장
- DM/캡션처럼 원문 텍스트와 링크가 섞인 입력 저장

### Phase 1 후속
- iOS Share Extension
- 이미지/스크린샷 첨부
- 공유된 파일/문서 첨부

---

## 4. 우선 지원할 출처

출처는 자동 분류하되 사용자가 나중에 수정할 수 있어야 한다.

DM은 외부 앱이 항상 공유 payload를 제공하지 않는다. 따라서 `instagram_dm_text`는 실제 공유 인텐트뿐 아니라 사용자가 복사해서 붙여넣은 텍스트에서도 선택/추정 가능해야 한다.

### source_type 후보
- `instagram_post`
- `instagram_reel`
- `instagram_profile`
- `instagram_dm_text`
- `notion`
- `google_docs`
- `google_sheets`
- `google_drive`
- `google_form`
- `youtube`
- `web`
- `manual_text`

### 도메인 기반 초기 규칙
- `instagram.com/p/*` -> Instagram post
- `instagram.com/reel/*`, `instagram.com/reels/*` -> Instagram reel
- `instagram.com/{username}` -> Instagram profile 후보
- `notion.so`, `notion.site` -> Notion
- `docs.google.com/document/*` -> Google Docs
- `docs.google.com/spreadsheets/*` -> Google Sheets
- `docs.google.com/forms/*`, `forms.gle/*` -> Google Form
- `drive.google.com/*` -> Google Drive
- `youtube.com`, `youtu.be` -> YouTube

---

## 5. 저장 데이터에서 중요한 것

기존 URL 저장만으로는 부족하다. 나중에 찾기 위해 아래 정보가 필요하다.

### Item에 추가가 필요한 필드
- `source_type`: 출처/콘텐츠 유형
- `raw_text`: 사용자가 붙여넣거나 공유한 원문
- `extracted_urls`: 원문에서 추출된 URL 목록
- `user_note`: 사용자가 저장 시 남긴 짧은 메모
- `tags`: 수동/자동 태그
- `status`: `inbox`, `to_read`, `done`, `archived`
- `saved_from`: `manual`, `clipboard`, `android_share`, `ios_share`

### 왜 필요한가
- `raw_text`: DM/캡션 맥락 보존
- `extracted_urls`: 여러 문서 링크가 섞인 입력 대응
- `source_type`: 인스타/문서/영상/웹 필터링
- `user_note`: "누가 보냈는지", "왜 저장했는지"를 남김
- `tags/status`: 나중에 다시 볼 항목을 관리

---

## 6. 검색과 재발견

이 제품의 가치는 저장 자체보다 다시 찾는 데 있다.

### Phase 1 검색 대상
- 제목
- 요약
- URL
- 원문 텍스트
- 사용자 메모
- 도메인
- source type
- 태그

### 기본 필터
- 전체
- Inbox
- Instagram
- 문서 링크
- YouTube
- 읽을 것
- 완료/보관

---

## 7. AI의 역할

AI는 v1에서 필수 저장 기능이 아니다. 저장 이후 비동기로 품질을 올리는 역할이다.

AI가 할 일:
- 긴 DM/캡션 요약
- 자동 제목 생성
- 자동 태그 추천
- Notion/Google Docs/Drive 링크 유형 분류
- 중복 저장 감지
- 관련 항목 묶기

AI 없이도 반드시 동작해야 할 일:
- URL/텍스트 저장
- 원문 보존
- 출처 분류
- 검색
- 태그/상태 관리

---

## 8. 다음 구현 우선순위

1. URL 없는 텍스트 저장 허용
2. 공유/붙여넣기 텍스트에서 여러 URL 추출
3. source type 자동 분류
4. raw text와 extracted URLs 저장
5. 앱 실행 시 클립보드 후보 저장 제안
6. 공유 시트 인입 후 자동 저장/확인 UX 결정
7. 검색 기능 추가
8. 상세 화면에 원문/메모/열기 버튼 추가
9. 태그 또는 상태 추가
10. Notion/Google Docs/Drive 전용 분류와 카드 UI 추가
11. iOS Share Extension 설계
12. AI 자동 요약/태그 추천은 이후 단계로 유지

---

## 9. v1 성공 기준

- 인스타그램 공유 링크가 앱에 저장된다
- DM에서 링크를 길게 눌러 공유/복사한 경우 저장할 수 있다
- DM에서 메시지 전체를 복사한 경우 링크 없이도 원문 텍스트로 저장할 수 있다
- 앱을 열었을 때 클립보드에 저장 가능한 후보가 있으면 바로 저장 제안을 보여준다
- Notion/Google Docs/Drive 링크가 일반 웹 링크와 구분된다
- 저장된 항목을 검색으로 다시 찾을 수 있다
- 저장 당시의 원문과 사용자의 짧은 메모가 보존된다
- 오프라인에서도 저장/조회가 가능하다
