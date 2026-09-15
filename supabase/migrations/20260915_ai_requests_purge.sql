-- result_json 보관 기간 청소.
--
-- 행은 영구 보관합니다. 월 사용량을 나중에 들여다볼 근거이고, 그 자체는 몇 바이트입니다.
-- 비우는 것은 result_json뿐입니다.
--
-- 기간을 operation별로 다르게 두는 이유는 성격이 달라서입니다.
--   read     링크 본문이라 건당 수십 KB로 큽니다. 다시 긁으면 되고 돈도 거의 안 듭니다.
--   generate 돈이 나가는 쪽입니다. 앱이 며칠 뒤에 돌아와도 받아둔 것을 쓸 수 있어야
--            합니다. 앱을 한참 안 열어본 사용자가 가장 이득을 보는 자리입니다.

-- pg_cron. 콘솔의 Database → Extensions에서 켜도 같습니다.
-- 여기서 오류가 나면 이 줄만 지우고 대시보드에서 켠 뒤 다시 실행하세요.
create extension if not exists pg_cron;

-- 기준을 완료 시각으로 옮깁니다.
--
-- 처음에는 created_at으로 뒀는데, 실패한 요청을 재시도해도 행은 그대로라 그 값은
-- 처음 만든 날에 머뭅니다. 9월 1일에 만들어 9일에야 성공한 건이면 결과를 저장하는
-- 순간 이미 7일이 지난 상태가 되어, 받아둔 것을 한 시간도 못 쓰고 버립니다.
--
-- 보관 기간의 뜻은 '결과를 만들어두고 얼마 동안 들고 있을 것인가'입니다.
-- 그 시계는 결과가 생긴 때부터 돌아야 합니다.
drop index if exists public.idx_ai_requests_purge;

create index if not exists idx_ai_requests_purge
  on public.ai_requests (completed_at)
  where result_json is not null;

-- 여는 쪽(/generate)이 지켜야 할 약속이 하나 있습니다.
-- result_json과 completed_at은 **항상 같이** 씁니다. 결과만 쓰고 완료 시각을 빠뜨리면
-- 그 행은 어느 청소에도 안 걸려 영원히 남습니다.
create or replace function public.purge_ai_request_results()
returns integer
language sql
security definer
-- 빈 search_path.
--
-- security definer는 함수를 만든 사람의 권한으로 돕니다. 이름을 어느 스키마에서
-- 찾을지가 부르는 쪽 설정에 달려 있으면, 같은 이름의 다른 표를 주인 권한으로
-- 건드리게 만들 수 있습니다. 비워두고 아래처럼 전부 스키마까지 적습니다.
set search_path = ''
as $$
  with purged as (
    update public.ai_requests
    set result_json = null,
        purged_at = now()
    where result_json is not null
      and completed_at is not null
      and (
        (operation = 'read' and completed_at < now() - interval '24 hours')
        or (operation = 'generate' and completed_at < now() - interval '7 days')
      )
    returning 1
  )
  select count(*)::integer from purged;
$$;

comment on function public.purge_ai_request_results() is
  'result_json만 비운다. 행은 남는다. 완료 시각 기준 read 24시간 / generate 7일.';

revoke all on function public.purge_ai_request_results() from public;
revoke all on function public.purge_ai_request_results() from anon, authenticated;
grant execute on function public.purge_ai_request_results() to service_role;

-- 게이트 함수도 같은 이유로 비웁니다. 다시 정의할 필요는 없고 설정만 바꿉니다.
-- 본문이 이미 public.ai_requests처럼 전부 적고 있어 그대로 돕니다.
alter function public.begin_ai_request(uuid, text, text, integer, integer, integer, interval)
  set search_path = '';

-- 한 시간에 한 번 돕니다.
--
-- 보관 기간이 24시간·7일이라 분 단위로 정확할 이유가 없습니다. 자정에 몰아서 하면
-- 그 시각에 큰 UPDATE가 한 번 걸리므로, 조금씩 자주 치우는 편이 낫습니다.
-- 정각을 피한 것은 다른 정기 작업과 겹치지 않게 하려는 것뿐입니다.
--
-- 같은 이름으로 다시 걸면 기존 job을 덮어씁니다. 여러 번 실행해도 늘지 않습니다.
select cron.schedule(
  'purge-ai-request-results',
  '17 * * * *',
  $$select public.purge_ai_request_results()$$
);
