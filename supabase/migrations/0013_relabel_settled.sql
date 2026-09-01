-- ============================================================================
-- Ledger — 0013 정산에 든 지출에도 '이름표'는 고칠 수 있게
--
-- 0002 의 가드는 정산에 들어간 지출의 UPDATE 를 통째로 막았다. 확정된 정산의
-- 숫자가 조용히 달라지는 일을 막으려는 것이었고, 그 목적은 지금도 옳다.
--
-- 그런데 그 그물이 너무 넓었다. **분류를 '식비'에서 '재료비'로 고치는 일까지
-- 함께 막혔다.** 분류는 정산에 한 푼도 들어가지 않는다. 판매처도, 메모도,
-- 항목 이름도, 구매 링크도 마찬가지다. 그것들은 계산이 아니라 **이름표**다.
--
-- 정산이 끝난 뒤에야 분류를 제대로 붙이고 싶어지는 것은 오히려 자연스럽다.
-- 한 학기가 끝나고 아카이브를 보면서 "이건 식비가 아니라 재료비였네" 하는
-- 순간이 온다. 그때 장부가 굳어 있으면 남는 것은 틀린 기록이다.
--
-- 그래서 가드를 **금액에 닿는 칸에만** 건다.
--
--   못 고치는 것 (숫자가 달라진다)
--     spent_on · amount · payer_member_id · allocation ·
--     team_member_ids · participant_member_ids · owner_member_id ·
--     adjustment_kind · adjustment_target_id · ledger_id
--
--   고칠 수 있는 것 (숫자와 무관하다)
--     title · vendor · category · note · product_link ·
--     adjustment_reason · receipt_path · representative_image_path
--
-- 삭제는 그대로 0012 의 delete_expense_deep 만 통과한다.
--
-- Supabase SQL Editor 에서 한 번 실행한다.
-- ============================================================================

create or replace function public.guard_settled_expense()
returns trigger language plpgsql as $$
declare
  v_settled boolean;
begin
  select exists (select 1 from public.settlement_expenses se
                  where se.expense_id = coalesce(old.id, new.id))
    into v_settled;

  if not v_settled then
    return coalesce(new, old);
  end if;

  -- 지우는 것은 여전히 막는다. 지우는 길은 delete_expense_deep 하나뿐이고,
  -- 그 함수는 정산을 먼저 걷어 내므로 여기 도달할 때는 이미 미정산이다.
  if tg_op = 'DELETE' then
    raise exception
      '이미 정산된 지출은 삭제할 수 없습니다. (expense_id=%)', old.id
      using errcode = 'restrict_violation';
  end if;

  -- 숫자에 닿는 칸이 하나라도 달라졌으면 막는다.
  if new.spent_on               is distinct from old.spent_on
  or new.amount                 is distinct from old.amount
  or new.payer_member_id        is distinct from old.payer_member_id
  or new.allocation             is distinct from old.allocation
  or new.team_member_ids        is distinct from old.team_member_ids
  or new.participant_member_ids is distinct from old.participant_member_ids
  or new.owner_member_id        is distinct from old.owner_member_id
  or new.adjustment_kind        is distinct from old.adjustment_kind
  or new.adjustment_target_id   is distinct from old.adjustment_target_id
  or new.ledger_id              is distinct from old.ledger_id then
    raise exception
      '이미 정산된 지출의 금액·날짜·결제자·부담 방식은 바꿀 수 없습니다. 보정 항목을 새로 기록하세요. (expense_id=%)',
      old.id
      using errcode = 'restrict_violation';
  end if;

  -- 여기까지 왔으면 이름표만 달라진 것이다. 통과시킨다.
  return new;
end $$;
