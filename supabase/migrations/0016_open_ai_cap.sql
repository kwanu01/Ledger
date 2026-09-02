-- ============================================================================
-- Ledger — 0016 장부 밖에서 묻는 말의 하루 상한
--
-- 수증이에게 묻는 창을 첫 화면과 로그인 화면에서도 연다. 그 자리에는 장부가
-- 없으므로 장부 단위 월 상한(ai_extractions)이 걸리지 않는다. 그리고 그
-- 화면은 **로그인하지 않은 사람에게도 열려 있다.**
--
-- 그 말은, 아무나 부를 수 있는 자리에 모델 호출이 하나 생긴다는 뜻이다.
-- 그 값은 키 주인이 낸다. 상한이 없으면 하루 만에 한 달치가 나갈 수 있다.
--
-- 그래서 **전체 하루 상한**을 하나 둔다. 누가 부르든 하루에 이만큼까지다.
-- 브라우저 쿠키로 사람마다 세는 방법도 있지만, 쿠키는 지우면 그만이라
-- 실제 한도가 되지 못한다. 여기서 세는 것은 '누가'가 아니라 '얼마나'다 —
-- 막고 싶은 것이 사람이 아니라 비용이기 때문이다.
--
-- 상한에 닿으면 그 뒤로는 정중히 거절한다. 서비스가 죽는 것보다 낫다.
--
-- Supabase SQL Editor 에서 한 번 실행한다.
-- ============================================================================

create table if not exists public.ai_open_usage (
  day   date primary key,
  count integer not null default 0
);

alter table public.ai_open_usage enable row level security;
alter table public.ai_open_usage force row level security;

/*
 * 한 자리 가져가기.
 *
 * 세는 일과 판단하는 일을 한 문장 안에서 한다. 읽고 나서 쓰면 그 사이에
 * 다른 요청이 끼어들어 상한을 넘길 수 있다. 늘린 뒤의 값을 보고 판정하면
 * 동시에 열 개가 들어와도 정확히 상한까지만 통과한다.
 *
 * 돌려주는 값은 '가져갔는가'다. false 면 오늘 몫이 끝난 것이다.
 */
create or replace function public.take_open_ai_slot(p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now integer;
begin
  insert into public.ai_open_usage (day, count)
       values (current_date, 1)
  on conflict (day) do update set count = public.ai_open_usage.count + 1
    returning count into v_now;

  return v_now <= p_limit;
end;
$$;

revoke all on function public.take_open_ai_slot(integer) from public, anon, authenticated;
