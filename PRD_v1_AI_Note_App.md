# PRD v1 – Capture Inbox / 온디바이스 AI 지식 저장 앱

## 1. 제품 개요
### 제품 정의
인스타그램, DM, Notion, Google Docs 등에서 흘러오는 링크와 텍스트를 빠르게 저장하고, 나중에 검색/정리/재사용할 수 있게 만드는 local-first 모바일 앱.

온디바이스 AI는 저장 이후 제목, 요약, 태그, 썸네일을 보강하는 후처리 역할을 한다.

### 핵심 가치
- 빠른 저장
- 원문과 출처 보존
- 나중에 다시 찾기
- 즉시 이해
- 쉬운 재사용
- 공유 가능

---

## 2. 목표
### 사용자 문제
- 인스타그램 게시물, 릴스, DM 정보가 금방 사라짐
- Notion, Google Docs, Google Drive 링크가 여러 대화와 앱에 흩어짐
- 링크만 저장하면 왜 저장했는지 기억하기 어려움
- 저장해도 다시 찾기 어려움
- 정리가 귀찮음

### 해결 방식
- 공유/붙여넣기로 저장
- 링크가 없어도 텍스트 원문 저장
- 출처와 도메인 자동 분류
- 검색/태그/상태 기반 재발견
- AI 요약 생성
- 폴더 또는 태그 기반 정리
- 공유 기능 제공

---

## 3. 타겟 사용자
- 인스타그램에서 정보성 콘텐츠를 자주 저장하는 사용자
- DM으로 자료, 링크, 추천 리스트를 자주 받는 사용자
- Notion/Google Docs/Drive 링크를 나중에 다시 찾아야 하는 사용자
- 육아, 레시피, 쇼핑, 여행, 운동, 학습 자료를 수집하는 사용자

---

## 4. 핵심 기능
### 저장
- URL 입력
- 텍스트 입력
- 공유 기능
- DM/캡션처럼 URL과 텍스트가 섞인 입력 저장
- 여러 URL 추출
- 원문 텍스트 보존

### 출처 분류
- Instagram post/reel/profile/DM
- Notion
- Google Docs/Sheets/Drive/Form
- YouTube
- 일반 웹
- 직접 메모

### AI 처리
- 제목 생성
- 3줄 요약
- 대표 이미지 선택
- 태그 추천

### 정리
- 태그
- 상태: inbox, to_read, done, archived
- 개인/공유 폴더
- 편집 권한

### 검색
- 제목/요약/본문/원문/URL/메모/태그/출처 기반 검색

### 오프라인
- 저장/조회/AI 처리 가능
- 온라인 시 동기화

---

## 5. UX 흐름
입력 또는 공유 → 원문/URL 추출 → 로컬 저장 → 출처 분류 → 검색 가능 상태 → AI 보강 → 태그/폴더 정리

---

## 6. 데이터 모델 (요약)
### Item
- id
- type
- title
- summary
- content
- url
- thumbnail
- source_type
- raw_text
- extracted_urls
- user_note
- tags
- status
- saved_from
- folder_id

### Folder
- id
- name
- type
- owner_id

---

## 7. 기술 스택
- React Native + Expo
- SQLite (로컬 DB)
- Zustand (상태관리)
- Supabase (백엔드)
- 온디바이스 AI (네이티브 모듈)

---

## 8. 아키텍처
Capture → Parse → Local DB → UI Update → AI/Metadata Jobs → Sync

---

## 9. 동기화
- local-first
- sync queue 기반

---

## 10. 수익 모델
### 무료
- 폴더 제한
- 기본 기능

### Pro
- 무제한 폴더
- 공유 확장
- 고급 기능

---

## 11. 향후 확장
- 레시피/육아/운동/쇼핑 특화 폴더
- AI 추천 기능
