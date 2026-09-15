-- 요청 판단을 다시 씁니다. 20260915_ai_quota.sql의 begin_ai_request를 대체합니다.
--
-- 앞의 것에 구멍이 넷 있었습니다.
--   · 같은 요청이 동시에 둘 들어오면 둘 다 proceed를 받아 바깥을 두 번 불렀습니다.
--     중복 과금을 막으려고 만든 함수가 중복 호출을 허용하고 있었습니다.
--   · 보관 기간이 지나 결과를 비운 건이 proceed로 떨어졌습니다. 사용자 몫은 안 깎고
--     호출은 나가니, 오래된 ID를 계속 들이밀면 무한 공짜였습니다.
--   · 재시도가 어느 계수기에도 안 잡혔습니다. 실제로 돈이 나가는 것은 호출인데
--     세는 것은 고유 요청 수뿐이라, 재시도 폭주를 막을 근거가 없었습니다.
--   · security definer 함수는 PUBLIC에 실행 권한이 기본으로 붙습니다. anon만
--     막아둔 것은 막은 것이 아니었습니다.

-- 1. 같은 요청이 지금 돌고 있는지 판단할 근거.
--
-- created_at은 처음 만든 때라 재시도에는 쓸 수 없습니다. 돌기 시작한 때가 따로
-- 필요하고, 그래야 '서버가 결과를 쓰기 전에 죽어 갇힌 것'을 회수할 수 있습니다.
alter table public.ai_requests
  add column if not exists last_started_at timestamptz not null default now();

-- 2. 사용자 몫과 실제 호출 수를 나눠 셉니다.
--
-- used  는 고유 request_id 수입니다. 재시도로 사용자 몫이 깎이면, 앱이 죽은 것이
--       사용자 잘못이 아닌데 그 대가를 사용자가 치릅니다.
-- calls 는 실제로 바깥을 부른 횟수입니다. 돈이 나가는 쪽은 이쪽이라, 재시도가
--       폭주할 때 멈출 근거는 여기에 있어야 합니다.
alter table public.ai_usage
  add column if not exists calls integer not null default 0;

comment on column public.ai_usage.used is '고유 request_id 수. 사용자에게 매기는 몫.';
comment on column public.ai_usage.calls is '실제 외부 호출 수. 재시도를 포함한다.';

-- 3. 전체 합산 계수기.
--
-- 1인당 상한은 계정 수만큼 곱해집니다. 익명 로그인이라 계정은 얼마든지 만들 수
-- 있으니, 1인당 상한만으로는 최악의 청구서를 막지 못합니다. 그 곱셈을 끊는 자리가
-- 여기입니다. 사용자별 표에 user_id가 빈 행을 섞으면 그 표의 모든 질의가 '이 행은
-- 사람이 아니다'를 매번 신경 써야 해서, 별개 표로 둡니다.
create table if not exists public.ai_global_usage (
  operation text not null check (operation in ('read', 'generate')),
  period_start date not null,
  calls integer not null default 0,
  primary key (operation, period_start)
);

comment on table public.ai_global_usage is '전 사용자 합산 외부 호출 수. 최악의 청구서를 막는 마지막 선.';

alter table public.ai_global_usage enable row level security;
revoke all on public.ai_global_usage from anon, authenticated;

drop function if exists public.begin_ai_request(uuid, text, text, integer);

-- 이 요청을 진행해도 되는지 판단하고, 진행해도 되면 그 자리에서 몫을 예약합니다.
--
-- 예약을 바깥 호출보다 먼저 하는 이유는, 호출한 뒤에 세면 그 사이에 들어온 요청들이
-- 아직 안 세어진 몫을 보고 전부 통과하기 때문입니다. 돈은 이미 나간 뒤입니다.
--
-- decision:
--   proceed            진행하세요
--   cached             이미 끝난 요청입니다. result가 함께 옵니다
--   in_progress        같은 요청이 지금 돌고 있습니다. 부르지 말고 기다리세요
--   expired            결과 보관 기간이 지났습니다. 새 request_id로 다시 거세요
--   over_user_quota    그 사람의 하루 몫을 다 썼습니다
--   over_user_calls    그 사람의 호출이 비정상적으로 많습니다 (재시도 폭주)
--   over_global_calls  전체 하루 상한에 닿았습니다
create or replace function public.begin_ai_request(
  p_user_id uuid,
  p_request_id text,
  p_operation text,
  p_user_quota_cap integer,
  p_user_call_cap integer,
  p_global_call_cap integer,
  -- 돌고 있다고 봐줄 시간. 앱의 STALLED_ENRICH_THRESHOLD_MS와 같은 5분입니다.
  -- 서버가 결과를 쓰기 전에 죽으면 그 request_id가 running에 갇히는데, 시한이
  -- 없으면 영영 막힙니다. 회수와 중복 호출 방지 사이의 선입니다.
  p_stale_after interval default interval '5 minutes'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period date := (now() at time zone 'Asia/Seoul')::date;
  v_is_new boolean;
  v_existing public.ai_requests%rowtype;
  v_used integer;
  v_calls integer;
  v_global integer;
  v_decision text;
  v_result jsonb;
  v_reject text;
begin
  -- 판단과 예약을 한 덩어리로 감쌉니다.
  --
  -- 상한은 셋이고, 뒤엣것이 걸리면 앞서 올린 계수기와 잡아둔 자리를 전부 되돌려야
  -- 합니다. 손으로 되돌리면 갈래가 늘 때마다 빠뜨립니다. 예외를 던지면 이 블록
  -- 안에서 한 일이 통째로 없던 일이 되므로, 되돌리는 코드를 따로 두지 않습니다.
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

      if v_existing.status = 'succeeded' then
        if v_existing.result_json is not null then
          -- 받아둔 것이 있습니다. 바깥을 부를 이유가 없습니다.
          v_decision := 'cached';
          v_result := v_existing.result_json;
        else
          -- 끝나긴 했는데 보관 기간이 지나 결과를 비운 건입니다.
          --
          -- 여기서 다시 돌리면 사용자 몫은 안 깎으면서 호출만 나갑니다. 오래된 ID를
          -- 계속 들이밀면 공짜가 되므로, 새 이름표를 받아 오게 돌려보냅니다.
          v_decision := 'expired';
        end if;

      elsif v_existing.status = 'running'
        and v_existing.last_started_at > now() - p_stale_after then
        -- 같은 요청이 지금 돌고 있습니다. 여기서 또 부르면 한 작업에 두 번 냅니다.
        v_decision := 'in_progress';
      end if;
    end if;

    -- 위에서 답이 난 갈래(cached / expired / in_progress)는 계수기를 건드리지 않습니다.
    -- 남은 것은 셋입니다. 처음 보는 요청, failed 재시도, 갇혔다가 회수된 것.
    if v_decision is null then
      -- 사용자 몫은 처음 보는 요청에만 매깁니다.
      --
      -- 조건이 붙은 쪽은 do update입니다. 그날 첫 요청이면 조건 없이 1로 들어가는데,
      -- 상한이 1 이상인 한 첫 건은 언제나 통과해야 하므로 그게 맞습니다.
      if v_is_new then
        insert into public.ai_usage (user_id, operation, period_start, used)
        values (p_user_id, p_operation, v_period, 1)
        on conflict (user_id, operation, period_start)
        do update set used = ai_usage.used + 1
        where ai_usage.used < p_user_quota_cap
        returning used into v_used;

        if v_used is null then
          raise exception using errcode = 'P0001', message = 'over_user_quota';
        end if;
      end if;

      -- 호출 수는 진행할 때마다 셉니다. 재시도도 돈이 나가는 것은 같습니다.
      insert into public.ai_usage (user_id, operation, period_start, calls)
      values (p_user_id, p_operation, v_period, 1)
      on conflict (user_id, operation, period_start)
      do update set calls = ai_usage.calls + 1
      where ai_usage.calls < p_user_call_cap
      returning calls into v_calls;

      if v_calls is null then
        raise exception using errcode = 'P0001', message = 'over_user_calls';
      end if;

      insert into public.ai_global_usage (operation, period_start, calls)
      values (p_operation, v_period, 1)
      on conflict (operation, period_start)
      do update set calls = ai_global_usage.calls + 1
      where ai_global_usage.calls < p_global_call_cap
      returning calls into v_global;

      if v_global is null then
        raise exception using errcode = 'P0001', message = 'over_global_calls';
      end if;

      -- 돌기 시작한 때를 새로 적습니다. 이 값이 있어야 다음에 들어온 같은 요청을
      -- '지금 돌고 있음'으로 볼 수 있고, 갇힌 것도 시한으로 가려낼 수 있습니다.
      update public.ai_requests
      set status = 'running',
          error = null,
          completed_at = null,
          last_started_at = now()
      where user_id = p_user_id
        and request_id = p_request_id
        and operation = p_operation;

      v_decision := 'proceed';
    end if;

  exception when sqlstate 'P0001' then
    -- 상한에 걸렸습니다. 올린 계수기도, 잡아둔 자리도 이 블록과 함께 물러났습니다.
    get stacked diagnostics v_reject = message_text;
  end;

  if v_reject is not null then
    return jsonb_build_object('decision', v_reject);
  end if;

  if v_result is not null then
    return jsonb_build_object('decision', v_decision, 'result', v_result);
  end if;

  return jsonb_build_object('decision', v_decision);
end;
$$;

-- security definer 함수는 PUBLIC에 실행 권한이 기본으로 붙습니다. anon과
-- authenticated만 끊는 것은 막은 것이 아닙니다. PUBLIC에서 끊고 서버만 엽니다.
revoke all on function public.begin_ai_request(uuid, text, text, integer, integer, integer, interval) from public;
revoke all on function public.begin_ai_request(uuid, text, text, integer, integer, integer, interval) from anon, authenticated;
grant execute on function public.begin_ai_request(uuid, text, text, integer, integer, integer, interval) to service_role;
