-- ============================================================================
-- Ledger — 0021 검사가 딛고 설 두 칸
--
-- 적기만 하면 기록이고, 검사하면 회계다 (§13). 검사 자체는 순수 함수라
-- (lib/domain/watch.ts) DB 가 할 일이 없다. 다만 두 가지는 **적어 두지 않으면
-- 나중에 알 수 없는 사실**이라, 칸이 필요하다.
--
--   read_amount  사진에서 AI 가 읽은 금액. 사람이 폼에서 고쳐도 안 바뀐다.
--                이 값을 버리면 "사진에는 38,400인데 칸에는 34,800"을 영영
--                잡을 수 없다. 읽은 값을 남겨 두는 것만이 그걸 잡는 방법이다.
--
--   checked_at   사람이 물음에 "괜찮다"고 답한 시각.
--                끄지 못하는 경고는 두 번째부터 배경이 되고, 배경이 된 경고는
--                진짜 하나를 같이 묻어 버린다. 그래서 모든 물음은 한 번
--                답하면 사라져야 하고, 그 답은 사람이 아니라 **줄에** 붙는다.
--                다른 팀원이 같은 장부를 열어도 조용해야 하기 때문이다.
--
-- 둘 다 nullable 이다. 지금까지 적힌 줄은 전부 NULL 이고, NULL 은 각각
-- "읽은 적 없음"과 "아직 안 물음"이라는 뜻으로 정확히 맞는다.
--
-- ── 두 칸은 '숫자에 닿는 칸'이 아니다
--
-- 0013 이 정산된 지출에 대해 잠가 둔 목록에 이 둘을 넣지 않는다. 넣으면
-- **정산이 끝난 줄에는 "괜찮다"고 답할 수 없게 된다.** 그런데 검사가 제일
-- 쓸모 있는 순간이 바로 정산 직전이고, 그때 답한 것이 확정 뒤에 되살아나면
-- 아카이브가 물음표로 뒤덮인다.
--
-- 안전한 이유는 분명하다. read_amount 는 아무 계산에도 안 들어가고,
-- checked_at 은 화면이 물을지 말지만 정한다. 정산 금액은 어느 쪽으로도
-- 1원도 움직이지 않는다. 이름표(0013 이 열어 둔 칸들)와 같은 성격이다.
--
-- 여러 번 실행해도 안전하다.
-- Supabase SQL Editor 에서 한 번 실행한다.
-- ============================================================================

alter table public.expenses
  add column if not exists read_amount bigint,
  add column if not exists checked_at timestamptz;

comment on column public.expenses.read_amount is
  'AI 가 사진에서 읽은 금액. 사람이 고쳐도 안 바뀐다. 적힌 값과 견주는 데만 쓴다 (§13.2)';
comment on column public.expenses.checked_at is
  '검사의 물음에 사람이 "괜찮다"고 답한 시각. 답한 줄은 다시 묻지 않는다 (§13)';

-- ── 읽은 값은 한 번 적히면 안 바뀐다 ────────────────────────────────────
--
-- 이 칸의 쓸모는 **사람 손을 안 탄 값**이라는 데서 온다. 나중에 화면이
-- 실수로든 아니든 이 값을 적힌 금액에 맞춰 버리면, 견줄 것이 사라지고
-- 검사는 언제나 조용해진다. 조용한 검사는 없는 검사보다 나쁘다 —
-- 검사했다고 믿게 만들기 때문이다.
--
-- 그래서 NULL 에서 값으로 한 번 가는 것만 허용하고, 그 뒤로는 잠근다.
-- 지우는 것도 막는다.
create or replace function public.guard_read_amount()
returns trigger language plpgsql as $$
begin
  if old.read_amount is not null
     and new.read_amount is distinct from old.read_amount then
    raise exception
      '사진에서 읽은 금액은 고칠 수 없습니다. 장부에 적히는 금액만 고쳐 주세요. (expense_id=%)',
      old.id
      using errcode = 'restrict_violation';
  end if;
  return new;
end $$;

drop trigger if exists expenses_read_amount_sticks on public.expenses;
create trigger expenses_read_amount_sticks
  before update on public.expenses
  for each row execute function public.guard_read_amount();

-- ── 되돌리기 ────────────────────────────────────────────────────────────
--
--   drop trigger if exists expenses_read_amount_sticks on public.expenses;
--   drop function if exists public.guard_read_amount();
--   alter table public.expenses drop column if exists read_amount;
--   alter table public.expenses drop column if exists checked_at;
--
-- 두 칸 다 아무 계산에도 안 들어가므로, 지워도 정산 결과는 그대로다.
