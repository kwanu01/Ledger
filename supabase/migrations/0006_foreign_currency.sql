-- ============================================================================
-- Ledger — 0006 Foreign currency
--
-- 해외 결제를 기록하기 위한 두 칸. 환율 API는 쓰지 않는다.
--
--   amount             장부 통화의 최소 단위 정수. 실제로 청구된 금액이고 정산은 이것으로 한다.
--   original_currency  영수증에 적힌 통화
--   original_amount    영수증에 적힌 금액 (그 통화의 최소 단위 정수)
--
-- 카드로 결제하면 카드사가 이미 환산해서 청구한다. 그 청구액을 amount에 넣으면
-- 그 지출에 실제로 적용된 환율만 쓰게 되고, 나중에 환율이 변해도 장부는 흔들리지 않는다.
-- ============================================================================

alter table public.expenses
  add column original_currency text
    check (original_currency in ('KRW', 'JPY', 'USD', 'EUR', 'GBP')),
  add column original_amount bigint;

alter table public.expenses
  add constraint original_pair_is_complete check (
    (original_currency is null and original_amount is null)
    or (original_currency is not null and original_amount is not null and original_amount <> 0)
  );

comment on column public.expenses.original_amount is
  '영수증에 적힌 금액. original_currency의 최소 단위 정수. 정산에는 쓰지 않는다.';

-- ── 원 통화가 장부 통화와 같으면 따로 적을 이유가 없다 ─────────────────────
create or replace function public.guard_original_currency()
returns trigger language plpgsql as $$
declare cur text;
begin
  if new.original_currency is null then return new; end if;

  select currency into cur from public.ledgers where id = new.ledger_id;
  if new.original_currency = cur then
    raise exception '원 통화가 장부 통화와 같으면 따로 적지 않습니다. 금액만 넣으세요.'
      using errcode = 'check_violation';
  end if;

  -- 부호는 장부 금액과 같아야 한다. 환불이면 둘 다 음수다.
  if sign(new.original_amount) <> sign(new.amount) then
    raise exception '원 금액과 장부 금액의 부호가 다릅니다.' using errcode = 'check_violation';
  end if;

  return new;
end $$;

create trigger expenses_original_currency
  before insert or update on public.expenses
  for each row execute function public.guard_original_currency();
