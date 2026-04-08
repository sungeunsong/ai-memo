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

## 5) On-device AI 배포 전략
- [ ] v1 권장: 규칙기반 fallback 또는 작은 기본 모델만 사용하고, AI는 항상 비동기 실행
- [ ] 저장 경로와 AI 경로 분리 (저장 우선, AI 후처리)
- [ ] 모델 다운로드를 사용하더라도 실행코드처럼 보이지 않게 데이터 자산으로 다루고, 앱 기능 설명과 실제 동작을 일치시킴
- [ ] 리뷰 노트에 모델이 온디바이스 추론용 데이터 자산이며 앱이 외부 실행코드를 내려받지 않는다는 점을 명시

## 6) 용량 가이드 (정책/실무)
- Android
  - Google Play는 App Bundle 배포 시 압축 다운로드 크기 제한 200MB 적용
  - 더 큰 자산은 Play Feature Delivery / Play Asset Delivery 사용 가능
  - Play for On-device AI(beta) 사용 시 개별 AI pack은 압축 다운로드 기준 최대 1.5GB
- iOS
  - 대형 모델을 무조건 앱 번들에 포함할 필요는 없음
  - 다만 런타임에 받는 파일이 실행코드처럼 해석되지 않도록 설계와 심사 설명 필요

## 7) 권장 v1 아키텍처 결정
- [ ] 저장은 AI 없이도 항상 완료되도록 구현
- [ ] v1은 fallback-only 또는 소형 모델로 시작하고, 대형 모델은 후속 버전에서 선택 다운로드형으로 확장
- [ ] 모든 AI 실패는 `ai_status=failed`로 저장하고 사용자 저장 플로우는 성공 유지

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
- Play for On-device AI (AI packs):
  - https://developer.android.com/google/play/on-device-ai
- Apple maximum build file sizes:
  - https://developer.apple.com/help/app-store-connect/reference/app-uploads/maximum-build-file-sizes
