-- ============================================================================
-- Ledger — 0015 송금이 오간 정산에 든 지출도 지울 수 있게
--
-- 0012 에서 정산에 든 지출을 지우는 길을 열되, 한 군데만 막아 두었다.
--
--   이미 '받았다'고 확인된 송금이 있는 정산은 못 지운다.
--
-- 돈이 실제로 오갔다는 뜻이고 그건 되돌릴 수 없으니, 기록도 남겨 두는 것이
-- 맞다고 보았다. 그 판단을 거둔다.
--
-- 거두는 이유는 이렇다. **장부에 잘못 적힌 줄이 남는 쪽이 더 나쁘다.**
-- 실수는 정산을 마치고 송금까지 끝난 뒤에 발견되는 일이 잦다 — 오히려 그때
-- 다시 들여다보기 때문이다. 그때 장부가 굳어 있으면 남는 선택지는 '틀린 채로
-- 두기' 하나뿐이고, 그 장부는 더 이상 사실이 아니다.
--
-- 그래서 **지우면 없던 기록이 된다.** 무엇이 함께 사라지는지는 이렇다.
--
--   · 그 지출 한 줄
--   · 그 지출이 들어 있던 정산 회차 통째로
--   · 그 회차에 딸린 송금 기록 — **'받았어요'까지 눌린 것도 함께**
--   · 같은 회차의 다른 지출들은 미정산으로 돌아간다
--
-- 실제로 오간 돈은 우리가 되돌리지 못한다. 그건 사람들이 알아서 할 일이고,
-- 장부는 그 사실을 안 적을 뿐이다. 그래서 화면에서 아주 세게 경고한다 —
-- 막는 대신 알린다. 막을 수 없는 일을 막는 척하는 것보다 낫다.
--
-- 여전히 막는 것이 하나 남는다. **딸린 보정·환불 항목이 있는 지출**은 못
-- 지운다. 그것들이 가리킬 대상을 잃기 때문이고, 이건 그것부터 지우면 풀린다.
--
-- Supabase SQL Editor 에서 한 번 실행한다.
-- ============================================================================

create or replace function public.delete_expense_deep(
  p_expense_id uuid,
  p_ledger_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settlement uuid;
  v_kids       integer;
begin
  -- 이 장부의 지출이 맞는지. id 하나만 보고 지우면 남의 장부 줄이 지워진다.
  perform 1 from public.expenses
   where id = p_expense_id and ledger_id = p_ledger_id;
  if not found then
    raise exception '이 장부의 지출이 아닙니다.';
  end if;

  -- 이 줄을 대상으로 삼은 보정·환불이 있으면 그것들이 갈 곳을 잃는다.
  select count(*) into v_kids
    from public.expenses where adjustment_target_id = p_expense_id;
  if v_kids > 0 then
    raise exception '이 지출에 딸린 보정·환불 항목이 있습니다. 그것부터 지워 주세요.';
  end if;

  select settlement_id into v_settlement
    from public.settlement_expenses where expense_id = p_expense_id;

  if v_settlement is not null then
    -- 확인된 송금이 있어도 걷어 낸다. 오간 돈을 되돌리지는 못하지만,
    -- 틀린 줄을 장부에 남겨 두지도 않는다. 화면에서 그렇게 경고한 뒤에 온다.
    -- settlement_expenses 와 transfers 는 정산에 딸려 함께 사라진다(cascade).
    delete from public.settlements where id = v_settlement;
  end if;

  delete from public.expenses where id = p_expense_id;
end;
$$;

revoke all on function public.delete_expense_deep(uuid, uuid) from public, anon, authenticated;

-- 정산 취소 가드도 같이 푼다. 0004 에서 "확인된 송금이 하나라도 있으면 정산을
-- 취소할 수 없다"고 막아 두었는데, 위의 함수가 바로 그 일을 해야 한다.
drop trigger if exists settlements_cancel_guard on public.settlements;
