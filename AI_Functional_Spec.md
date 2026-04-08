# AI Functional Spec v1

## Goal
Provide on-device AI features:
- Title generation
- 3-line summary
- Thumbnail selection

AI must NEVER block saving.

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
- Timeout: 3~5s
- 실패해도 저장 유지
- 결과는 overwrite 가능

---

## 5. Performance Target

- Title: < 1.5s
- Summary: < 3s
- Memory: < 1GB
- Model size: < 600MB (Lite 기준)

---

## 6. Model Requirements

- On-device only
- Replaceable engine
- Quantized model (4bit or similar)
- Support chunking

---

## 7. Error Handling

AI failure is NOT an error.

- status = "failed"
- fallback 적용
- 사용자 영향 없음