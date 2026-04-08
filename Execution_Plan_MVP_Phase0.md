# 실행 계획 – MVP Phase 0

## 1. 목적

이 문서는 지금부터 바로 구현을 시작할 때의 실행 순서를 정의한다.

현재 목표는 다음 3가지를 가장 먼저 완성하는 것이다.
- URL 저장 UX
- 로컬 저장
- 목록 UI

이 3가지를 먼저 만드는 이유:
- 제품의 핵심 가치가 가장 빨리 검증된다
- 공유 기능 없이도 사용자 흐름을 거의 동일하게 검증할 수 있다
- AI와 동기화 없이도 제품 감을 빠르게 확인할 수 있다

---

## 2. 이번 단계의 범위

이번 단계에서 포함:
- 앱 기본 프로젝트 세팅
- 디자인 토큰 초안
- URL 입력 화면
- 저장 직후 보이는 목록 화면
- 로컬 DB 저장
- 상세 화면의 최소 버전
- fallback 기반 메타데이터 표시

이번 단계에서 제외:
- 온디바이스 AI 모델
- Supabase 동기화
- 공유 폴더
- 결제
- Android Share Intent 실제 연동
- iOS Share Extension 실제 연동

---

## 3. 구현 원칙

- 저장은 항상 먼저 끝나야 한다
- 저장 직후 UI에 바로 보여야 한다
- AI 없이도 앱이 자연스럽게 보이고 쓸 수 있어야 한다
- UI는 초기부터 정돈된 카드형 경험으로 만든다
- 기능보다 먼저 핵심 사용자 흐름이 막히지 않는지 본다

---

## 4. 사용자 흐름

### 핵심 흐름 A: URL 직접 저장
1. 사용자가 URL 입력 화면에 들어온다
2. URL을 붙여넣는다
3. 저장 버튼을 누른다
4. 앱은 URL을 검증하고 로컬 DB에 즉시 저장한다
5. 목록 화면에 새 항목이 즉시 나타난다
6. 상세 화면에서 제목, URL, 본문 placeholder, 썸네일 placeholder를 본다

### 핵심 흐름 B: 저장 후 확인
1. 사용자가 목록에서 방금 저장한 항목을 누른다
2. 상세 화면에서 저장된 데이터와 상태를 확인한다
3. 아직 AI 처리 전이어도 화면이 비어 보이지 않아야 한다

### 핵심 흐름 C: 앱 재실행
1. 앱을 종료한다
2. 다시 실행한다
3. 저장한 항목이 그대로 남아 있어야 한다

---

## 5. 화면 우선순위

### Screen 1: 홈/목록
목표:
- 저장된 항목이 쌓이는 기본 화면

필수 요소:
- 상단 타이틀
- 검색 진입점 placeholder
- 최근 저장 목록
- 빈 상태 화면
- 새 항목 추가 CTA

### Screen 2: URL 저장 화면
목표:
- 가장 빠르게 저장하는 화면

필수 요소:
- URL 입력 필드
- 붙여넣기 버튼
- 저장 버튼
- 로딩 아닌 즉시 저장 피드백
- 잘못된 URL 에러 문구

### Screen 3: 상세 화면
목표:
- 저장 결과를 확인하는 화면

필수 요소:
- 제목
- 원본 URL
- 썸네일 영역
- 요약 placeholder
- 본문 placeholder
- 상태값 표시 placeholder

---

## 6. 기술 구현 순서

### Step 1: 프로젝트 세팅
- Expo Prebuild + TypeScript 초기화
- 라우팅 방식 결정
- 기본 폴더 구조 생성
- 개발 빌드 기준 정리

### Step 2: 디자인 시스템 초안
- 컬러 토큰
- spacing scale
- 타이포 스케일
- 카드, 버튼, 입력 필드 기본 컴포넌트

### Step 3: 로컬 데이터 구조
- SQLite 연결
- `items` 테이블 생성
- `folders` 최소 테이블 생성
- 향후용 `ai_status`, `sync_status` 필드 포함

### Step 4: 저장 플로우 구현
- URL 유효성 검사
- 저장 use case 작성
- 저장 직후 목록 반영
- 앱 재실행 시 복원 확인

### Step 5: 목록/상세 UI 구현
- 목록 카드
- 빈 상태
- 상세 화면
- 상태 배지 placeholder

### Step 6: fallback 파싱 연결
- URL 원문 저장
- 기본 title fallback
- 기본 summary placeholder
- 기본 thumbnail fallback

---

## 7. 데이터 모델 초안

### items
- id
- type
- source_url
- raw_input
- title
- summary
- content
- thumbnail_url
- ai_status
- sync_status
- created_at
- updated_at

### folders
- id
- name
- type
- created_at
- updated_at

---

## 8. 완료 기준

이번 단계 완료로 볼 조건:
- URL 입력 후 저장이 3초 안에 끝난다
- 저장된 항목이 목록에 즉시 보인다
- 앱 재실행 후에도 데이터가 남아 있다
- 상세 화면이 비어 보이지 않는다
- 이후 AI/동기화를 붙일 구조가 이미 준비돼 있다

---

## 9. 다음 단계 연결

이 단계가 끝나면 다음 순서로 진행한다.

1. fallback 파싱 품질 보강
2. Android Share Intent 연결
3. iOS Share Extension 연결
4. sync queue 추가
5. Supabase 동기화 연결
6. 소형 온디바이스 AI 검토
