# CLAUDE.md

## 시렁(Sireong)

인스타 릴스·DM, 노션/구글 문서 링크, 스크린샷처럼 흘러가버리는 정보를 빠르게 담고
나중에 조건을 조합해 꺼내는 local-first 개인 수집함. 안드로이드 + 웹(PWA).

**앱 루트는 `apps/mobile`입니다.** 저장소 루트에는 설계 문서와 TODO만 있습니다.

## 명령

```bash
cd apps/mobile          # 거의 모든 명령이 여기서 돕니다
npm run typecheck       # tsc --noEmit. 루트에서 돌리면 package.json을 못 찾습니다
npm run dev             # Expo dev client (안드로이드 실기기가 터널로 붙어 있음)
npm run web             # 브라우저
npm run deploy:web      # 빌드 + PWA 태그 주입 + EAS Hosting 배포
```

Node 22.22.2 (`.nvmrc`). 테스트 러너는 없습니다 — `typecheck`가 유일한 자동 검증이라
로직을 고쳤으면 웹에서 직접 돌려보고 확인합니다.

## 구조

```
src/
  features/
    capture/     공유 인입, 클립보드, 이미지 저장(플랫폼별)
    metadata/    Jina Reader + Gemini 호출. 프롬프트가 여기 있습니다
    taxonomy/    분야·항목 사전(Registry). AI가 만든 정의의 승격·병합
    items/       SavedItem 타입, contentV2, 폴백, 회수(staleEnrich)
    facets/      조합 검색. 정규화·추출·역색인·질의·냉장고 털기·스마트 폴더
    backup/      JSON 내보내기/가져오기
  db/            SQLite(안드로이드) / localStorage(웹) 양쪽을 같은 API로 감쌈
  store/         zustand. 저장·정리·동기화의 오케스트레이션
  theme/         palette + ThemeContext
  components/    화면 조각. DetailScreen과 HomeScreen이 가장 큼
```

## 반드시 지킬 것

**테마.** 컴포넌트에서 `palette`를 직접 import해 `StyleSheet.create`에 쓰면 안 됩니다.
모듈 로드 시점에 색이 굳어 테마 전환이 안 먹습니다. 파일 하단에
`const createStyles = (palette: Palette) => StyleSheet.create({...})`를 두고
컴포넌트 안에서 `useThemedStyles(createStyles)`로 받습니다.

**플랫폼별 저장소.** 안드로이드는 SQLite, 웹은 localStorage(아이템·설정·사전) +
IndexedDB(이미지). 완전히 별개입니다. **스키마를 바꾸면 양쪽을 다 고쳐야 합니다.**

**주석 문체.** 이 저장소는 우리말 주석으로 **"왜 이렇게 했는지"**를 남깁니다. 대개
과거에 실제로 겪은 문제가 근거로 적혀 있습니다. 무엇을 하는지만 적은 주석은 이 코드와
어울리지 않습니다. 기존 주석을 몇 개 읽고 그 결을 따라가세요.

**실패는 기존 데이터를 건드리지 않습니다.** 메타데이터 수집이 실패했을 때 빈 값으로
patch를 만들어 반환하면 사용자가 갖고 있던 본문과 요약을 지웁니다. 실패하면 상태만
기록하고 기존 값은 그대로 둡니다 (`metadata/service.ts`의 catch 블록 참고).

**사용자가 고친 값이 AI보다 우선합니다.** `userTitle` / `userCategory` / `userDeadline`이
AI 결과와 별도 필드인 이유이고, 재분석이 이들을 덮어쓰면 안 됩니다.

## 알아둘 개념

- **조각(`ItemSource`)** — 한 저장물이 여러 정보 조각을 가집니다. 릴스 1 + DM 스크린샷 2 =
  조각 3개, 저장물 1개. AI는 조각들을 묶어 한 번에 읽습니다.
- **사전(Taxonomy Registry)** — AI는 정보를 발견만 하고, 이름·타입·정규화·검색축은 사전이
  정합니다. AI가 새로 만든 정의는 `provisional`로 들어가 아이템 3개에서 쓰이면 확정됩니다.
- **facet** — 조합 검색. SQLite 테이블이 아니라 store의 아이템에서 만드는 인메모리 역색인.
  성패는 값 정규화에 달려 있습니다(`강릉` → `강원도` → `국내`를 저장 시 미리 붙임).
- **동기화** — 큐와 워커는 있지만 Supabase는 미연결입니다. 설정이 없으면 mock으로 성공 처리.

## 작업 흐름

- **새 기능은 웹에서 먼저 시험합니다.** 안드로이드에는 실사용 데이터가 있습니다.
- **웹 배포는 요청받았을 때만** 합니다. 안드로이드는 dev 서버라 저장 즉시 반영됩니다.
- 커밋 메시지는 우리말로, **무엇을 고쳤는지보다 왜 그게 문제였는지**를 적습니다.
- `origin`은 SSH입니다. HTTPS로는 이 환경에서 푸시가 안 됩니다.

## 먼저 읽을 것

- `TODO.md` — 할 일과 **그렇게 정한 이유**. 설계 논의 결과가 본문에 들어 있습니다.
- 메모리(`MEMORY.md`에서 링크) — 제품 원칙, 공유 설계, 원가, 배포·테스트 방식.
- 루트의 설계 문서들(`PRD_*`, `Engineering_Spec_*`, `AI_Functional_Spec_*`)은
  **코드와 어긋나 있습니다.** 특히 "온디바이스 AI only"는 사실이 아닙니다(Gemini 클라우드).
  기준은 코드이고, 문서 정합성 작업은 TODO에 있습니다.
