# Release Readiness Checklist (iOS + Android)

## 0) 결론
- 출시 가능: Yes
- 단, 로그인/계정삭제/정책 선언/권한/결제 정책을 사전에 맞추지 않으면 심사 리젝 리스크가 큼

## 1) 공통
- [ ] 개인정보처리방침 URL 준비 및 앱 내 노출
- [ ] 스토어 설명의 데이터 처리 문구와 실제 동작 일치
- [ ] `AI 실패 != 저장 실패` 시나리오 QA 완료
- [ ] 네트워크 오프라인 상태에서 저장/조회 동작 검증
- [ ] 권한 최소화 (필요 시점에만 요청)

## 2) iOS (App Store)
- [ ] Google/Kakao 등 서드파티 로그인 사용 시 Sign in with Apple 동등 옵션 제공
- [ ] 계정 생성이 있으면 앱 내 계정 삭제 진입 경로 제공
- [ ] App Privacy(데이터 수집/추적) 정확히 작성
- [ ] 리뷰용 데모 계정/재현 절차 준비

## 3) Android (Google Play)
- [ ] targetSdk 최신 요구치 충족
- [ ] Data safety 폼 작성 및 앱 동작과 일치
- [ ] 계정 생성이 있으면 앱 내 삭제 경로 + 웹 삭제 요청 링크 제공
- [ ] 권한 선언(민감 권한/광고 ID) 정확성 검토

## 4) 결제(향후 Pro)
- [ ] 디지털 기능/구독 판매 시 스토어 결제 정책 적용 (IAP / Play Billing)
- [ ] 허용되지 않은 외부 결제 유도 문구/링크 제거

## 5) AI 구조와 제3자 전송 — 심사 제출물의 근거

이 자리에는 "On-device AI 배포 전략"이 적혀 있었습니다(모델 다운로드, 용량 상한,
"온디바이스 추론용 데이터 자산이라고 리뷰 노트에 명시"까지). **그 설계는 채택되지
않았습니다.** 앱에는 모델이 없고 AI는 전부 클라우드입니다. 그 문서를 근거로 스토어
문구를 쓰면 제3자 전송 고지를 통째로 빠뜨리게 되어, 이 절을 들어내고 다시 씁니다.

실제 구조 (자세한 것은 `AI_Functional_Spec.md` §6):

- 앱 → **Jina Reader**(`r.jina.ai`)로 URL을 보내 본문을 받습니다
- 앱 → **Supabase Edge Function** `/generate` → **Google Gemini**로 본문을 보냅니다
- 앱 안에는 모델도 API 키도 없습니다

여기서 나오는 심사 항목:

- [ ] **제3자 전송 두 곳을 개인정보처리방침에 명시** — 저장한 URL과 본문이 Jina로,
      본문이 Gemini로 갑니다. 빼놓을 수 없습니다
- [ ] **데이터 안전(Data safety) 양식에 같은 내용** — 방침과 양식은 별개 제출물입니다
- [ ] **스토어 설명이 "local-first"를 과장하지 않을 것** — 저장·검색은 맞지만
      AI 정리는 클라우드입니다. 설명과 동작이 어긋나면 걸립니다
- [ ] **생성형 AI 기능에 사용자 신고 수단** — Play 정책에 있습니다. 지금 앱에 없습니다
- [ ] 모델 용량·AI pack·번들 크기는 **해당 없음**. 앱에 모델이 없습니다

## 6) 익명 계정 — 확인이 필요한 자리

앱이 서버에 "이 요청이 누구 것인가"를 알리려고 **익명 계정을 자동으로 만듭니다.**
사용자가 만든 적 없는 계정이라, "계정 생성이 있으면 삭제 경로 필수" 조항에 걸리는지
애매합니다. 정책 문구는 계속 바뀌므로 **콘솔에서 현재 조건을 직접 확인해야 합니다.**

- [ ] 이 앱이 계정 삭제 요구사항 대상인지 확인
- [ ] 대상이면 앱 내 삭제 경로 + 웹 삭제 요청 링크
- [ ] 이미 쌓인 익명 계정 정리 (9/16 폴리필 버그로 생긴 것이 다수)

## 7) 저장과 AI의 분리 — 이미 그렇게 돼 있음

- [x] 저장은 AI 없이도 항상 완료됩니다
- [x] AI 실패는 `aiStatus: 'failed'`로 남고 저장 플로우는 성공 유지합니다
- [x] 실패 사유를 `aiError`에 남겨 화면에 띄웁니다 (2026-09-21)
- [ ] 프록시가 죽었을 때의 로컬 발췌 폴백은 **일부러 죽여놓고 확인한 적이 없습니다**

## References
- Apple App Review Guidelines:
  - https://developer.apple.com/app-store/review/guidelines/
- Apple account deletion guidance:
  - https://developer.apple.com/support/offering-account-deletion-in-your-app/
- Google Play target API requirements:
  - https://support.google.com/googleplay/android-developer/answer/11926878?hl=en
- Google Play account deletion requirements:
  - https://support.google.com/googleplay/android-developer/answer/13327111?hl=en
- Android app size guidance:
  - https://developer.android.com/topic/performance/reduce-apk-size
- Apple maximum build file sizes:
  - https://developer.apple.com/help/app-store-connect/reference/app-uploads/maximum-build-file-sizes
