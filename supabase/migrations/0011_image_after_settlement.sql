-- ============================================================================
-- Ledger — 0011 정산이 끝난 지출의 사진
--
-- 0002의 가드는 정산에 들어간 지출의 UPDATE를 전부 막는다. 금액과 부담 구조를
-- 지키기 위한 규칙이고, 그 부분은 그대로 둔다.
--
-- 다만 사진 두 칸은 예외로 연다.
--
--   receipt_path              영수증 사진
--   representative_image_path 품목 대표 사진
--
-- 사진은 금액이 아니라 금액의 근거다. 정산을 확정한 뒤에 영수증을 찾았다면
-- 그때 붙일 수 있어야 하고, 잘못 올린 사진은 뗄 수 있어야 한다. 사진을 바꾼다고
-- 계산이 한 푼도 움직이지 않으므로 스냅샷의 불변성과도 어긋나지 않는다.
--
-- (이 규칙이 없는 동안 앱은 파일을 저장소에 먼저 올리고 나서 이 가드에 막혔다.
--  막힌 자리에 파일만 남아 아무도 가리키지 않는 사진이 쌓였다.)
--
-- 판정은 "사진 칸을 옛 값으로 되돌려 놓고 비교했을 때 나머지가 같은가"로 한다.
-- 칸 이름을 하나씩 나열하면 나중에 열이 늘 때 조용히 빠진다.
-- ============================================================================

create or replace function public.guard_settled_expense()
returns trigger language plpgsql as $$
declare
  probe public.expenses%rowtype;
begin
  if not exists (
    select 1 from public.settlement_expenses se
     where se.expense_id = coalesce(old.id, new.id)
  ) then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' then
    probe := new;
    probe.receipt_path := old.receipt_path;
    probe.representative_image_path := old.representative_image_path;
    -- 사진 칸 말고는 달라진 것이 없으면 통과시킨다.
    if probe is not distinct from old then
      return new;
    end if;
  end if;

  raise exception
    '이미 정산된 지출은 수정하거나 삭제할 수 없습니다. 보정 항목을 새로 기록하세요. (expense_id=%)',
    coalesce(old.id, new.id)
    using errcode = 'restrict_violation';
end $$;
