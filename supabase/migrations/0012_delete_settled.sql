-- ============================================================================
-- Ledger — 0012 정산에 든 지출도 지울 수 있게
--
-- 지금까지 정산에 한 번 들어간 지출은 손댈 방법이 없었다. 0002의 가드가
-- UPDATE와 DELETE를 다 막았고, 화면에는 정산을 푸는 길조차 없었다. 잘못 적은
-- 줄 하나 때문에 장부가 굳어 버리는 셈이다.
--
-- 그래서 지우는 길을 연다. 다만 **정산의 스냅샷은 끝까지 고치지 않는다.**
-- 확정된 정산의 숫자가 조용히 달라지면, 그 숫자를 보고 돈을 보낸 사람이
-- 무엇을 보고 보냈는지 알 수 없게 된다. 대신 이렇게 한다.
--
--   지출이 정산에 들어 있으면 → **그 정산을 통째로 걷어 내고** 지출을 지운다.
--
-- 정산이 반쯤 맞는 상태로 남는 일이 없다. 정산은 온전하거나, 없거나 둘 중
-- 하나다. 걷어 낸 정산에 있던 나머지 지출들은 미정산으로 돌아가므로 다시
-- 정산하면 된다.
--
-- 한 군데만 막아 둔다. **이미 받았다고 확인된 송금이 있는 정산**은 못 지운다.
-- 돈이 실제로 오갔다는 뜻이고, 그것은 되돌릴 수 없다. 그때는 보정 항목이
-- 제 자리다.
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
  v_confirmed  integer;
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
    select count(*) into v_confirmed
      from public.transfers
     where settlement_id = v_settlement and confirmed_at is not null;

    if v_confirmed > 0 then
      raise exception
        '이미 송금이 오간 정산에 든 지출입니다. 지우는 대신 보정 항목으로 바로잡아 주세요.';
    end if;

    -- settlement_expenses 와 transfers 는 정산에 딸려 함께 사라진다(on delete cascade).
    -- 이 줄이 더 이상 '정산된 지출'이 아니게 되므로 아래 삭제가 가드를 통과한다.
    delete from public.settlements where id = v_settlement;
  end if;

  delete from public.expenses where id = p_expense_id;
end;
$$;

revoke all on function public.delete_expense_deep(uuid, uuid) from public, anon, authenticated;
