-- ============================================================================
-- Ledger — 0005 Currency
--
-- 통화는 장부를 만들 때 정하고, 지출이 한 건이라도 기입되면 잠긴다.
--
-- 이유: 금액은 그 통화의 최소 단위 정수로 저장된다. KRW는 1 = 1원,
-- USD는 1 = 1센트다. 이미 32,500(원)이 들어 있는 장부의 통화를 USD로 바꾸면
-- 같은 정수가 $325.00으로 읽힌다. 아무도 낸 적 없는 금액이 되고,
-- §13.1(머릿속으로 검산할 수 있어야 한다)과 §28.4(확정 정산 불변)가 동시에 깨진다.
--
-- 환율은 쓰지 않는다. 외화 지출은 원 통화·원 금액과 실제 청구된 장부 통화 금액을
-- 함께 기록하는 방향이며 §27의 미결 항목이다.
-- ============================================================================

alter table public.ledgers
  add column currency text not null default 'KRW'
  check (currency in ('KRW', 'JPY', 'USD', 'EUR', 'GBP'));

comment on column public.ledgers.currency is
  '이 장부의 통화. expenses.amount 는 이 통화의 최소 단위 정수다.';

-- ── 지출이 하나라도 있으면 통화는 못 바꾼다 ────────────────────────────────
create or replace function public.guard_ledger_currency()
returns trigger language plpgsql as $$
declare n integer;
begin
  if new.currency is not distinct from old.currency then
    return new;
  end if;

  select count(*) into n from public.expenses where ledger_id = old.id;
  if n > 0 then
    raise exception
      '이미 %건이 기입된 장부의 통화는 바꿀 수 없습니다. 저장된 금액이 다른 뜻이 됩니다. (ledger_id=%)',
      n, old.id
      using errcode = 'restrict_violation';
  end if;

  return new;
end $$;

create trigger ledgers_currency_locked
  before update on public.ledgers
  for each row execute function public.guard_ledger_currency();
