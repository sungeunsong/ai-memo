-- 요청을 끝맺는 두 함수.
--
-- 표를 Data API에 노출하지 않기로 했으므로 Edge Function도 표를 직접 쓰지 못합니다.
-- 그리고 표를 직접 쓰게 두면 'result_json과 completed_at은 항상 같이 쓴다'가 지켜지는지
-- 부르는 쪽에 달립니다. 하나라도 빠뜨리면 그 행은 어느 청소에도 안 걸려 영원히 남는데,
-- 그런 약속은 주석이 아니라 함수가 지켜야 합니다.

create or replace function public.complete_ai_request(
  p_user_id uuid,
  p_request_id text,
  p_operation text,
  p_result jsonb
) returns void
language sql
security definer
set search_path = ''
as $$
  update public.ai_requests
  set status = 'succeeded',
      result_json = p_result,
      -- 청소의 기준점입니다. 결과와 한 문장 안에서 같이 적습니다.
      completed_at = now(),
      error = null
  where user_id = p_user_id
    and request_id = p_request_id
    and operation = p_operation;
$$;

create or replace function public.fail_ai_request(
  p_user_id uuid,
  p_request_id text,
  p_operation text,
  p_error text
) returns void
language sql
security definer
set search_path = ''
as $$
  update public.ai_requests
  set status = 'failed',
      error = p_error,
      -- completed_at은 적지 않습니다. 결과가 없는데 완료 시각만 남으면 청소가
      -- '비울 결과가 있다'고 착각할 일은 없지만, 무엇보다 이 행은 회수 대상입니다.
      -- 게이트가 failed를 보고 다시 진행시키는데, 그때 completed_at이 남아 있으면
      -- 언제 끝난 요청인지 읽는 쪽이 헷갈립니다.
      completed_at = null
  where user_id = p_user_id
    and request_id = p_request_id
    and operation = p_operation;
$$;

comment on function public.complete_ai_request(uuid, text, text, jsonb) is
  '결과와 완료 시각을 함께 적는다. 둘을 따로 쓸 수 있는 길을 두지 않는다.';

revoke all on function public.complete_ai_request(uuid, text, text, jsonb) from public;
revoke all on function public.complete_ai_request(uuid, text, text, jsonb) from anon, authenticated;
grant execute on function public.complete_ai_request(uuid, text, text, jsonb) to service_role;

revoke all on function public.fail_ai_request(uuid, text, text, text) from public;
revoke all on function public.fail_ai_request(uuid, text, text, text) from anon, authenticated;
grant execute on function public.fail_ai_request(uuid, text, text, text) to service_role;
