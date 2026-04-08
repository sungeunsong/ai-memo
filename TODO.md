# TODO

## 현재 우선순위

- [ ] MVP Phase 0 범위 확정
- [x] Expo Prebuild + TypeScript 프로젝트 생성
- [x] 기본 폴더 구조 결정
- [ ] 디자인 시스템 초안 정의
- [ ] 홈/목록 화면 와이어프레임 정리
- [ ] URL 저장 화면 와이어프레임 정리
- [ ] 상세 화면 와이어프레임 정리

## 프로젝트 세팅

- [x] Expo 앱 초기화
- [x] Development Build 기준 세팅
- [x] TypeScript 설정 확인
- [ ] ESLint/Prettier 기본 설정
- [ ] 기본 라우팅 구조 설정
- [x] 공용 UI 컴포넌트 폴더 생성

## 데이터 레이어

- [x] SQLite 라이브러리 선택 및 연결
- [x] DB 초기화 로직 작성
- [x] `items` 테이블 스키마 작성
- [x] `folders` 테이블 스키마 작성
- [x] 기본 repository/service 구조 작성

## 핵심 UX

- [x] URL 입력 화면 구현
- [x] 붙여넣기 버튼 구현
- [x] URL 유효성 검사 구현
- [x] 저장 버튼 동작 구현
- [x] 저장 성공 피드백 UI 구현
- [x] 잘못된 URL 에러 상태 구현

## 목록/상세

- [x] 저장 목록 화면 구현
- [x] 빈 상태 화면 구현
- [x] 목록 카드 컴포넌트 구현
- [x] 상세 화면 최소 버전 구현
- [x] 상세 화면 상태 배지 placeholder 구현

## 저장 플로우

- [x] `Capture -> Parse -> Local Save -> UI Update` 흐름 구현
- [x] 저장 직후 목록 즉시 반영
- [x] 앱 재실행 데이터 복원 확인
- [ ] 저장 실패 케이스 처리

## fallback 처리

- [x] 제목 fallback 규칙 작성
- [x] 요약 placeholder 규칙 작성
- [ ] 썸네일 fallback 규칙 작성
- [x] `ai_status` 기본값 처리

## 이후 단계

- [ ] Android Share Intent 설계
- [ ] iOS Share Extension 설계
- [ ] sync queue 설계
- [ ] Supabase 인증/동기화 설계
- [ ] 소형 온디바이스 AI 검토
