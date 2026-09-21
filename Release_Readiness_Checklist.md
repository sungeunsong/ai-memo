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
- [ ] 계정 삭제 진입 경로 — **익명 자동 계정도 대상입니다.** §6 참고
- [ ] App Privacy(데이터 수집/추적) 정확히 작성
- [ ] 리뷰용 데모 계정/재현 절차 준비

## 3) Android (Google Play)
- [ ] targetSdk 최신 요구치 충족
- [ ] Data safety 폼 작성 및 앱 동작과 일치
- [ ] 앱 내 삭제 경로 + 웹 삭제 요청 링크 — 대상 여부는 콘솔 확인. §6 참고
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
- [~] **생성형 AI 신고 수단** — 한때 "필수"로 적었다가 내립니다. Play의 생성형 AI 정책은
      **비AI 콘텐츠를 요약·추출하기만 하는 앱을 적용 대상에서 제외**합니다. 시렁의 AI가
      저장한 글을 요약하고 항목을 뽑는 데 그치는 동안은 필수로 단정할 수 없습니다.
      **기능이 '만들어내는' 쪽으로 넓어지면 그때 다시 봅니다.**
      지금은 심사 항목이 아니라 **제품 피드백 기능**으로 다룹니다 — 아래 §7
- [ ] 모델 용량·AI pack·번들 크기는 **해당 없음**. 앱에 모델이 없습니다

## 6) 익명 계정 삭제 — iOS는 확정, Android는 확인

앱이 서버에 "이 요청이 누구 것인가"를 알리려고 **익명 계정을 자동으로 만듭니다.**

처음에는 "사용자가 만든 적 없는 계정이니 해당하는지 애매하다"고 적었는데, **틀렸습니다.**
Apple은 자동 생성된 익명·guest 계정도 앱 안에서 지울 수 있어야 한다고 봅니다.
"사용자가 직접 만들지 않았다"는 예외가 없습니다. 정책 문구는 바뀌므로 제출 직전에
현행 문서를 다시 확인하되, **기본 전제는 '필요하다'로 둡니다.**

- [ ] **iOS: 앱 내 계정 삭제 — 필수로 봅니다** (3단계지만 설계는 지금 같이 합니다)
- [ ] **Android: 콘솔에서 확인** — Play는 "사용자에게 제공되는 계정 기능"인지로 봅니다.
      익명 자동 계정이 거기 해당하는지가 쟁점입니다
- [ ] 이미 쌓인 익명 계정 정리 (31개. 다수가 9/16 폴리필 버그로 생긴 것)

### 기기 데이터 삭제와 계정 삭제는 다른 기능입니다

한 버튼으로 묶으면 안 됩니다. 시렁은 local-first라 **기기 것을 다 지워도 서버 기록은
그대로 남고**, 반대로 계정을 지워도 기기의 저장물은 남습니다. 설정 화면에서도 둘을
갈라 놓아야 사용자가 무엇을 지우는지 압니다.

서버 쪽은 이미 정리돼 있습니다. `ai_requests`와 `ai_usage` 모두
`references auth.users (id) on delete cascade`라, auth user를 지우면 그 사람 기록이
같이 사라집니다. **문제는 지우는 주체입니다** — 앱은 anon 권한이라 auth user를 못
지웁니다. **서버에 삭제 endpoint가 필요합니다.**

- [ ] `/delete-account` Edge Function (service_role로 auth user 삭제)
- [ ] 앱: 설정 → 계정 삭제 → 확인 → endpoint 호출 → 로컬 세션 정리
- [ ] 웹 삭제 요청 경로 (Play가 요구하는 앱 밖 링크)

### 지운 직후 다시 생기지 않게

`AppRoot`가 **앱 시작마다** `ensureAnonymousSessionAsync()`를 부릅니다. 이대로면
계정을 지우고 앱을 다시 켜는 순간 새 익명 계정이 생겨, 사용자 눈에는 삭제가 안 된
것으로 보입니다.

그 자리의 주석이 이미 답을 적어두고 있습니다 — "세션이 실제로 필요한 쪽(AI 정리)에서
다시 부르면 그때 확보됩니다." 즉 **시작 시점의 호출은 없어도 됩니다.**

- [ ] 시작 시에는 **기존 세션이 있을 때만** refresh를 걸고, 없으면 만들지 않기
- [ ] 익명 계정은 **AI를 실제로 처음 쓸 때** 만들기
- [ ] 삭제 뒤 AI를 다시 쓰면 새 식별자가 생긴다는 것을 삭제 확인 화면에서 미리 알리기

## 7) AI 결과 피드백 — 심사 항목이 아니라 제품 기능으로

§5에서 내린 항목입니다. 만든다면 **설정 화면의 일반 버튼이 아니라 저장물 상세 화면의
AI 결과 옆**이어야 합니다. 어느 결과를 신고하는지 특정되지 않으면 받아도 쓸 데가 없습니다.

- [ ] 상세 화면에 "이 정리가 이상해요" — `enrich_request_id`와 함께
- [ ] **무엇을 서버로 보낼지 먼저 정할 것.** 신고 사유만 보낼지, 원문까지 보낼지에 따라
      **개인정보처리방침에 새 데이터 흐름이 하나 더 생깁니다**
- [ ] 단순 메일 링크는 앱을 나가게 됩니다. 나중에 정책 적용 대상이 되면
      "in-app reporting" 요건을 못 채울 수 있습니다

## 8) 저장과 AI의 분리 — 이미 그렇게 돼 있음

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
