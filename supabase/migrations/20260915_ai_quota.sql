-- (대체됨) 이 파일의 begin_ai_request는 20260915_ai_request_gate.sql이 다시 씁니다.
-- ai_usage 표 정의는 그대로 유효합니다.

-- 사용량 계수기와 하드캡.
--
-- 상한을 '읽고 - 검사하고 - 쓰기'로 나누면 동시에 들어온 요청들이 같은 값을 읽고
-- 나란히 통과합니다. 한 문장 안에서 조건과 증가를 같이 해야 뚫리지 않습니다.

create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  operation text not null check (operation in ('read', 'generate')),

  -- 하루 단위. 한국 시간 기준입니다. UTC로 세면 한국 사용자에게는 오전 9시에
  -- 사용량이 초기화되어, 아침에 한 번 더 쓸 수 있는 이상한 창이 생깁니다.
  period_start date not null,

  used integer not null default 0,
  primary key (user_id, operation, period_start)
);

comment on table public.ai_usage is '사람별 일일 사용량. read와 generate는 비용원이 달라 따로 센다.';

-- 이 요청을 진행해도 되는지 판단하고, 진행해도 되면 그 자리에서 1건을 예약합니다.
--
-- 예약을 바깥 호출보다 먼저 하는 이유는, 호출한 뒤에 세면 그 사이에 들어온 요청들이
-- 아직 안 세어진 몫을 보고 전부 통과하기 때문입니다. 돈은 이미 나간 뒤입니다.
--
-- 같은 request_id로 다시 들어온 요청은 세지 않습니다. 앱이 죽어 회수가 이어서 하는
-- 경우인데, 여기서 또 깎으면 중복 과금을 막으려고 붙인 이름표가 정작 사용자 몫을
-- 두 번 빼앗습니다. 세는 것은 '처음 보는 요청'일 때뿐입니다.
--
-- 돌려주는 decision:
--   cached    이미 끝난 요청입니다. 결과가 함께 옵니다. 바깥을 부르지 마세요
--   proceed   진행하세요
--   over_cap  상한에 걸렸습니다. 부르지 마세요
create or replace function public.begin_ai_request(
  p_user_id uuid,
  p_request_id text,
  p_operation text,
  p_cap integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_new boolean;
  v_existing public.ai_requests%rowtype;
  v_period date := (now() at time zone 'Asia/Seoul')::date;
  v_used integer;
begin
  -- 자리를 먼저 잡습니다. 같은 요청이 동시에 둘 들어와도 여기서 하나로 좁혀집니다.
  -- 나중에 검사하면 둘 다 '처음 보는 요청'으로 읽고 나란히 통과합니다.
  insert into public.ai_requests (user_id, request_id, operation, status)
  values (p_user_id, p_request_id, p_operation, 'running')
  on conflict do nothing
  returning true into v_is_new;

  if v_is_new is null then
    select * into v_existing
    from public.ai_requests
    where user_id = p_user_id
      and request_id = p_request_id
      and operation = p_operation;

    -- 결과가 아직 남아 있으면 그것을 씁니다. 바깥을 부를 이유가 없습니다.
    if v_existing.status = 'succeeded' and v_existing.result_json is not null then
      return jsonb_build_object('decision', 'cached', 'result', v_existing.result_json);
    end if;

    -- 실패했거나 보관 기간이 지나 결과를 비운 경우입니다. 다시 하되 세지는 않습니다.
    -- 이미 한 번 낸 몫이고, 못 받은 것은 사용자 잘못이 아닙니다.
    update public.ai_requests
    set status = 'running', error = null, completed_at = null
    where user_id = p_user_id
      and request_id = p_request_id
      and operation = p_operation;

    return jsonb_build_object('decision', 'proceed');
  end if;

  -- 처음 보는 요청입니다. 세는 것은 여기뿐입니다.
  --
  -- 조건이 붙은 쪽은 do update입니다. 그날 첫 요청이면 조건 없이 1로 들어가는데,
  -- 상한이 1 이상인 한 첫 건은 언제나 통과해야 하므로 그게 맞습니다.
  insert into public.ai_usage (user_id, operation, period_start, used)
  values (p_user_id, p_operation, v_period, 1)
  on conflict (user_id, operation, period_start)
  do update set used = ai_usage.used + 1
  where ai_usage.used < p_cap
  returning used into v_used;

  if v_used is null then
    -- 상한에 걸렸으니 방금 잡아둔 자리를 물립니다. 남겨두면 이 request_id는
    -- 영영 '처음 보는 요청'이 아니게 되어, 내일 다시 시도해도 세지 않고 통과합니다.
    delete from public.ai_requests
    where user_id = p_user_id
      and request_id = p_request_id
      and operation = p_operation;

    return jsonb_build_object('decision', 'over_cap');
  end if;

  return jsonb_build_object('decision', 'proceed');
end;
$$;

-- 앱이 직접 부를 수 있으면 상한이 의미를 잃습니다. Edge Function만 씁니다.
revoke all on function public.begin_ai_request(uuid, text, text, integer) from anon, authenticated;

alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;
