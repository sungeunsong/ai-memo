# TODO

> 2026-09-11 전면 재작성. 완료된 항목은 전부 걷어내고 앞으로 할 일만 남겼습니다.
> 지금까지 만든 것은 커밋 이력과 `Handoff_*.md`를 보면 됩니다.

## 지금 바로

- [ ] `git push origin main` (로컬이 origin보다 4커밋 앞. **아직 백업이 없는 상태**)
- [ ] `.gitignore`에 추가한 `dev-server.log` 커밋
- [ ] 푸시 확인 후 `fix/web-native-gaps` 브랜치 삭제
- [ ] 원격의 낡은 `origin/feat/facet-search-and-content-split` 삭제

## 출시 관문 — AI 프록시

**이게 없으면 공개 배포가 불가능합니다.** `EXPO_PUBLIC_GEMINI_API_KEY`가 번들에 평문으로
박혀서 APK에서 추출됩니다. 남에게 앱을 주는 것이 곧 키를 주는 것입니다.

- [ ] Supabase 프로젝트 생성
- [ ] Edge Function으로 Gemini 호출 프록시
- [ ] 앱에서 키 제거, 프록시 경유로 전환
- [ ] Jina Reader도 같은 경로로 (지금 키 없이 쓰고 있어 규모에서 막힘)
- [ ] 사용량 카운트 → 무료/Pro 경계의 첫 실측

## 공유 (설계 확정, 구현 전)

설계 근거와 결정 이유는 메모리 `ai-memo-sharing-architecture` 참고.
원칙: **개인 시렁은 local-first 유지, 명시적으로 공유한 순간의 스냅샷만 서버로.**

- [ ] Supabase Anonymous Auth 도입 (`@supabase/supabase-js` 추가, raw fetch 대체)
- [ ] RLS 정책 — 테이블 만들 때 같이. 빼먹으면 남의 데이터가 열립니다
- [ ] 공유 스냅샷 테이블 + Storage 버킷
- [ ] 읽기 전용 공유 URL (원본 DM 스크린샷은 **기본 제외** — 제3자 얼굴·이름이 찍혀 있음)
- [ ] 공유 링크 취소(revoke) + "공유 중인 목록" 화면
- [ ] 공유 페이지에서 `[내 시렁에 담기]` → 내 사전으로 매핑
- [ ] 중복 감지 (같은 것을 둘이 담으면 두 개가 됨)
- [ ] Collection — 서버는 entity, 화면은 facet 칩 (`collection:abc123` + 라벨)
  - [ ] 멤버·초대 링크·나가기·삭제 관리 모달
  - [ ] 스냅샷 수동 갱신 (write-then-swap: 업로드 성공 후 포인터 교체)
  - [ ] Storage 삭제 규칙 (기준은 '사람이 나감'이 아니라 'snapshot 제거')
  - [ ] 기본 목록엔 안 섞고, **검색 결과에는 별도 구획으로** 표시
- [ ] 익명 사용자 정리 정책 (생성일 기준 단순 삭제 금지. 초기엔 남용 방지만)

## iOS

- [ ] Apple Developer 등록 (App Group entitlement의 전제)
- [ ] Share Extension 켜기 — `disableIOS: false` + `iosAppGroupIdentifier` + prebuild
- [ ] EAS credentials에서 extension 타겟 설정
- [ ] 실기기 확인

> 참고: 지금 아이폰 웹(PWA)은 **공유 시트에 뜰 수 없습니다.** 사파리가 Web Share Target을
> 지원하지 않아서, 네이티브 앱이 나오기 전까지 복사→붙여넣기가 유일한 경로입니다.

## 실기기 확인 (미완)

- [ ] 안드로이드 공유 인입 실기기 테스트
- [ ] 인스타 DM 링크 길게 누르기 / 공유 / 복사 흐름 실기기 확인
- [ ] `SearchFilterBar` 칩 2단 구성이 세로로 너무 커지지 않는지

## 판단 필요 — 할지 말지 정하기

- [ ] `status`(inbox / to_read / done / archived) — PRD에만 있고 코드에 흔적 없음. 만들지 버릴지
- [ ] `tags` — 없음. facet이 사실상 대신하고 있어 **버리는 쪽**이 맞아 보임
- [ ] source type 필터 — 탭이 분야 기준이라 출처 축은 없음. 필요한지

## 알려진 거칠음

- [ ] `search.ts` 자소 부분 매칭이 느슨함 (초성 `ㄱㅈ`가 '허벅지'에도 걸림)
- [ ] 자유 텍스트 지역·시설 스캔이 단순 포함 검사라 오탐 여지

## 기반

- [ ] ESLint / Prettier 설정
- [ ] 저장 실패 케이스 처리

## 문서 정합성 (코드와 어긋나 있음)

- [ ] `Engineering_Spec_AI_Note_App.md` — "온디바이스 AI only, 클라우드 AI 금지"로 적혀 있으나
      실제는 Gemini 클라우드. **소형 온디바이스 AI 검토는 접은 것으로 확정**
- [ ] `AI_Functional_Spec.md` — 같은 문제 + 모델 크기/성능 목표가 현재와 무관
- [ ] `PRD_v1_AI_Note_App.md` — 데이터 모델이 실제 스키마(조각/사전/V2 content)와 다름
