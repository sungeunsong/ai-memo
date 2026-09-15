-- begin_ai_request만 다시 씁니다. 표와 칸은 이미 만들어져 있어 건드리지 않습니다.
-- 인자가 같아 create or replace로 바뀌므로 drop이 필요 없습니다.
--
-- 앞의 것에 구멍이 둘 있었습니다.
--   · 갇힌 요청을 회수하는 경로에 잠금이 없었습니다. 자리를 잡는 insert는 동시에
--     들어온 둘을 하나로 좁히는데, 이미 있는 행을 회수하는 쪽은 둘 다 통과시켰습니다.
--     '동시에 둘이 들어와도 하나로 좁힌다'가 절반만 참이었습니다.
--   · 상한이 0 이하여도 그날 첫 요청은 통과했습니다. 첫 건은 on conflict에 안 걸려
--     조건 검사 없이 들어가기 때문입니다. 0으로 막으려 해도 하루 1건은 나갑니다.

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
set search_path = ''
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
  -- 설정값부터 봅니다.
  --
  -- 상한 검사는 on conflict do update에 붙어 있어서, 그날 첫 요청처럼 갱신이 아닌
  -- 삽입으로 들어가는 건은 검사를 지나칩니다. 0으로 막아둔 줄 알았는데 하루 한 건씩
  -- 새는 상태가 됩니다. 이런 것은 조용히 새는 것보다 크게 터지는 편이 낫습니다.
  --
  -- 아래 블록 바깥에서 던집니다. 안에서 던지면 상한 초과와 같은 갈래로 잡혀,
  -- 설정 실수가 '상한에 걸렸다'는 정상 응답으로 둔갑합니다.
  --
  -- null을 따로 봅니다. SQL에서 `null < 1`은 거짓이 아니라 UNKNOWN이라 if에 안 걸립니다.
  -- 환경변수 이름을 틀리면 Edge Function이 null을 넘기게 되는데, 그때 상한 검사가
  -- 통째로 UNKNOWN이 되어 어느 쪽으로 고장 나는지 알 수 없는 상태가 됩니다.
  if p_user_quota_cap is null
     or p_user_call_cap is null
     or p_global_call_cap is null
     or p_user_quota_cap < 1
     or p_user_call_cap < 1
     or p_global_call_cap < 1 then
    raise exception using
      errcode = '22023',
      message = format(
        '상한은 1 이상이어야 합니다. user_quota=%s, user_call=%s, global_call=%s',
        p_user_quota_cap, p_user_call_cap, p_global_call_cap
      );
  end if;

  -- 0 이하면 모든 요청이 회수 대상이 되어 중복 호출 방지가 통째로 무력해집니다.
  --
  -- null은 더 나쁩니다. 상한이 null이면 조건이 UNKNOWN이 되어 요청이 거부되는 쪽으로,
  -- 즉 닫히는 쪽으로 고장 납니다. 그런데 이쪽이 null이면 '지금 돌고 있는가' 판정이
  -- UNKNOWN이 되어 전부 회수 대상으로 떨어집니다. 열리는 쪽으로 고장 나서 중복 호출이
  -- 그대로 나갑니다. 기본값이 있어도 막아둡니다.
  if p_stale_after is null or p_stale_after <= interval '0' then
    raise exception using
      errcode = '22023',
      message = format('돌고 있다고 봐줄 시간은 0보다 커야 합니다. stale_after=%s', p_stale_after);
  end if;

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
      -- 행을 잠그고 읽습니다.
      --
      -- 잠그지 않으면 갇힌 요청을 회수하는 경로가 뚫립니다. 동시에 들어온 둘이 같은
      -- last_started_at을 보고 둘 다 '5분 지났으니 회수하자'로 판단해, 한 작업에
      -- 바깥 호출이 두 번 나갑니다. 자리를 잡는 insert는 새 요청만 좁혀주지 이미
      -- 있는 행에는 아무 일도 하지 않습니다.
      --
      -- 잠그면 뒤엣것은 앞엣것이 끝날 때까지 기다렸다가 갱신된 값을 다시 읽습니다.
      -- 그 시점에는 last_started_at이 방금으로 바뀌어 있어 in_progress로 떨어집니다.
      select * into v_existing
      from public.ai_requests
      where user_id = p_user_id
        and request_id = p_request_id
        and operation = p_operation
      for update;

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

-- create or replace는 권한을 그대로 물려받지만, 이 함수의 권한은 실수하면 바로
-- 뚫리는 자리라 매번 명시합니다. 나중에 이 파일만 보고도 상태를 알 수 있어야 합니다.
revoke all on function public.begin_ai_request(uuid, text, text, integer, integer, integer, interval) from public;
revoke all on function public.begin_ai_request(uuid, text, text, integer, integer, integer, interval) from anon, authenticated;
grant execute on function public.begin_ai_request(uuid, text, text, integer, integer, integer, interval) to service_role;
