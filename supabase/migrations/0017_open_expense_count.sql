-- ============================================================================
-- Ledger — 0017 '미정산 n건'을 제대로 센다
--
-- 계정의 장부 목록에 '미정산 1건'이 떠 있는데 장부를 열어 보면 미정산이
-- 하나도 없었다. 세는 방법이 이랬다.
--
--   미정산 = 전체 지출 수 − 정산에 들어간 지출 수
--
-- 이 뺄셈에는 **'정산 불필요'가 빠져 있다.** 자기가 사서 자기가 가져간 줄은
-- 정산에 들어가지 않지만, 그건 아직 정산을 안 한 것이 아니라 애초에 정산할
-- 것이 없는 것이다. 장부 화면은 그 구분을 한다(lib/domain/settlement.ts 의
-- needsSettling). 목록의 뺄셈만 그걸 몰랐다.
--
-- 같은 사실을 두 화면이 다르게 말하면 둘 다 못 믿는다. 그래서 세는 일을
-- 뺄셈에서 거둬 여기로 옮긴다 — 판정 조건이 한 곳에만 적혀 있게.
--
-- Supabase SQL Editor 에서 한 번 실행한다.
-- ============================================================================

create or replace function public.open_expense_count(p_ledger_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
    from public.expenses e
   where e.ledger_id = p_ledger_id
     -- 아직 어느 정산에도 들어가지 않았고,
     and not exists (
       select 1 from public.settlement_expenses se where se.expense_id = e.id
     )
     -- 정산할 것이 있는 줄일 것. 자기가 사서 자기가 가져간 줄은 아니다.
     and not (e.allocation = 'personal' and e.owner_member_id = e.payer_member_id)
$$;

revoke all on function public.open_expense_count(uuid) from public, anon, authenticated;
