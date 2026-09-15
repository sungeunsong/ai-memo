-- AI 요청 기록. 멱등성과 계측을 겸합니다.
--
-- 정리 한 건은 바깥 호출을 여러 번 합니다(링크 본문 읽기 + AI 호출). 그 사이에 앱이
-- 죽으면 다시 켰을 때 회수가 처음부터 다시 돌리는데, 이 표가 없으면 서버가 그것을
-- 새 요청과 구별하지 못해 같은 요약을 두 번 삽니다.
--
-- 앱이 들고 있는 items.enrich_request_id가 여기의 request_id입니다.

create table if not exists public.ai_requests (
  user_id uuid not null references auth.users (id) on delete cascade,
  request_id text not null,
  operation text not null check (operation in ('read', 'generate')),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),

  -- 재시도와 멱등성을 위한 임시 운영 캐시입니다. 개인 시렁의 영구 클라우드
  -- 저장소가 아닙니다. 아래 보관 기간이 지나면 이 칸만 비웁니다.
  result_json jsonb,
  error text,

  created_at timestamptz not null default now(),
  completed_at timestamptz,
  -- result_json을 비운 시각. 행 자체는 남으므로 '언제 비웠는지'를 따로 적습니다.
  purged_at timestamptz,

  -- 같은 요청이 두 번 들어와도 한 줄입니다. 이것이 멱등성의 근거입니다.
  -- read와 generate는 비용원이 달라 같은 request_id라도 별개로 셉니다.
  primary key (user_id, request_id, operation)
);

comment on table public.ai_requests is
  '한 번의 정리 작업에 붙는 바깥 호출 기록. 중복 과금을 막고 사용량을 센다.';
comment on column public.ai_requests.result_json is
  '재시도용 임시 캐시. 보관 기간이 지나면 비운다. 영구 저장소가 아니다.';

-- 보관 기간 청소가 created_at으로 훑습니다. 아직 안 비운 것만 대상이라 부분 인덱스면 됩니다.
create index if not exists idx_ai_requests_purge
  on public.ai_requests (created_at)
  where result_json is not null;

-- 잠급니다. 정책은 붙이지 않습니다.
--
-- 이 표는 앱이 직접 읽지 않습니다. Edge Function만 쓰고, 그쪽은 서버 권한이라
-- RLS를 우회하므로 동작에 지장이 없습니다. 나중에 사용량 화면을 만들더라도
-- 보여줄 것은 집계(이번 달 몇 건, 남은 건수)이지 원본 행이 아닙니다.
-- result_json이 들어 있는 표를 통째로 열어둘 이유가 없습니다.
alter table public.ai_requests enable row level security;

-- 프로젝트를 'Automatically expose new tables' 없이 만들었지만, 이 표만큼은
-- 나중에 그 설정이 바뀌어도 새지 않도록 여기서 한 번 더 끊어둡니다.
revoke all on public.ai_requests from anon, authenticated;
