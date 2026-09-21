# AI Functional Spec v1

> **이 문서는 코드가 인용합니다.** `metadata/service.ts`가 §7을 두 곳에서 근거로 댑니다.
> 그래서 버리지 않고 실제 구현에 맞춰 고쳤습니다(2026-09-21). §1~§3의 기능 정의와
> §7의 실패 처리 원칙은 지금도 그대로 유효합니다.

## Goal
AI features:
- Title generation
- 3-line summary
- Thumbnail selection

AI must NEVER block saving.

**실행 위치: 클라우드입니다.** 처음에는 온디바이스를 전제로 썼지만 구현은 Gemini
클라우드입니다. 호출은 앱이 직접 하지 않고 Supabase Edge Function(`/generate`)을
거칩니다 — 키가 앱에 있으면 앱을 주는 것이 곧 키를 주는 것이라서입니다.
소형 온디바이스 AI 검토는 접었습니다.

---

## 1. Title Generation

### Input
- Cleaned text (max 1000~2000 chars)
- Language: auto-detect

### Output
- 1 title
- Length: 12~32 chars (Korean 기준)
- Style:
  - 핵심 요약형
  - 클릭베이트 금지
  - 과장 금지

### Rules
- 중복 단어 제거
- 핵심 키워드 포함
- 의미 명확해야 함

### Example
Input:
"아기 이유식 만들 때 단백질과 철분을 같이 섭취하는 방법..."

Output:
"아기 이유식 단백질·철분 조합 방법"

---

### Fallback
- HTML title
- 첫 문장

---

## 2. Summary (3-line)

### Input
- Cleaned text (chunked if long)

### Output
- 3 sentences
- Each: 15~40 chars
- No duplication
- 핵심 정보만

---

### Rules
- 광고/불필요 문장 제거
- 핵심만 압축
- 리스트 느낌 OK

---

### Example
- 단백질과 철분은 함께 섭취 가능
- 흡수율 고려해 식재료 조합 필요
- 아기 연령별 식단 조절 중요

---

### Fallback
- 첫 3문장 요약
- 문장 truncate

---

## 3. Thumbnail Selection

### Input
- og:image
- inline images

### Output
- best image 1개

---

### Rules
- 해상도 높은 것 우선
- 텍스트-only 이미지 제외
- 얼굴/음식/핵심 객체 우선

---

### Fallback
- og:image
- 없음

---

## 4. AI Execution Rules

- Async only
- 실패해도 저장 유지
- 결과는 overwrite 가능. 단 **사용자가 고친 값(`userTitle`·`userCategory`·
  `userDeadline`)은 덮지 않습니다**
- 한 번의 정리에 이름표(`enrich_request_id`)가 붙습니다. 앱이 죽었다 살아나도
  같은 이름표로 물어 중복 과금이 없습니다

---

## 5. Performance Target

- 시한은 **30초**입니다. 홉이 둘(본문 읽기 → 프록시)이라 예전의 3~5초 목표는
  성립하지 않습니다
- 원가 계측(사용량·지연·payload)은 아직 안 붙였습니다. TODO 참고

---

## 6. 실행 구조

앞서 "On-device only, 4bit 양자화 모델, 600MB 미만"으로 적혀 있던 자리입니다.
그 설계는 채택되지 않았습니다.

- **본문 읽기**: 앱 → Jina Reader(`r.jina.ai`) 직접. 서버로 안 옮깁니다 —
  키가 없고, 돈이 안 들고, 옮기면 우리 IP로 속도 제한이 몰리며 사용자 URL을
  우리가 다 보게 됩니다
- **AI 정리**: 앱 → Supabase Edge Function `/generate` → Gemini
- 키·모델·출력 스키마는 **서버가** 소유합니다. 프롬프트와 사전(Registry)은 앱이 소유합니다
- 상한 셋(사용자 몫 / 사용자 호출 수 / 전체 합산)을 외부 호출 **전에** 예약합니다

**제3자 전송이 두 곳이라는 뜻입니다.** URL과 본문이 Jina로, 본문이 Gemini로 나갑니다.
개인정보처리방침과 스토어 데이터 안전 양식에 둘 다 적어야 합니다.

---

## 7. Error Handling

AI failure is NOT an error.

- status = "failed"
- fallback 적용
- 사용자 영향 없음