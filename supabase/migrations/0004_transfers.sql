-- ============================================================================
-- Ledger — 0004 Transfers
--
-- 정산 snapshot에도 송금 목록이 들어 있지만, 그것은 "확정 시점의 계산 기록"이다.
-- 이 테이블은 "그래서 실제로 돈이 오갔는가"라는 다른 질문을 다룬다. 둘을 섞지 않는다.
--
-- 결정
--   · 송금 완료는 **받은 사람만** 확인할 수 있다.
--     팀플에서 제일 흔한 분쟁인 "보냈는데요 / 안 들어왔는데요"가 구조적으로 안 생긴다.
--   · 정산 취소는 **아무도 확인하지 않았을 때만** 가능하다.
--     한 건이라도 확인되면 그 정산은 잠긴다.
-- ============================================================================

create table public.transfers (
  id            uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.settlements (id) on delete cascade,
  from_member_id uuid not null references public.members (id) on delete restrict,
  to_member_id   uuid not null references public.members (id) on delete restrict,
  amount        bigint not null check (amount > 0),

  -- NULL이면 아직 안 받은 것. 받은 사람이 확인하면 채워진다.
  confirmed_at  timestamptz,
  confirmed_by_member_id uuid references public.members (id) on delete restrict,

  created_at    timestamptz not null default now(),

  constraint no_self_transfer check (from_member_id <> to_member_id),
  constraint confirmation_is_complete check (
    (confirmed_at is null and confirmed_by_member_id is null)
    or (confirmed_at is not null and confirmed_by_member_id is not null)
  )
);
create index transfers_settlement_idx on public.transfers (settlement_id);
create index transfers_to_member_idx on public.transfers (to_member_id) where confirmed_at is null;

alter table public.transfers enable row level security;
alter table public.transfers force row level security;

-- ── 확인은 받은 사람만 ──────────────────────────────────────────────────────
create or replace function public.guard_transfer_confirmation()
returns trigger language plpgsql as $$
begin
  if new.confirmed_by_member_id is not null
     and new.confirmed_by_member_id <> new.to_member_id then
    raise exception '송금 완료는 돈을 받은 사람만 확인할 수 있습니다.'
      using errcode = 'check_violation';
  end if;

  -- 한 번 확인한 것을 되돌리려면 정산 자체를 다시 봐야 한다.
  if tg_op = 'UPDATE' and old.confirmed_at is not null and new.confirmed_at is null then
    raise exception '이미 확인된 송금은 되돌릴 수 없습니다.' using errcode = 'restrict_violation';
  end if;

  if tg_op = 'UPDATE' and (new.amount <> old.amount
                           or new.from_member_id <> old.from_member_id
                           or new.to_member_id <> old.to_member_id) then
    raise exception '확정된 송금의 금액과 대상은 변경할 수 없습니다.' using errcode = 'restrict_violation';
  end if;

  return new;
end $$;

create trigger transfers_confirmation_guard
  before insert or update on public.transfers
  for each row execute function public.guard_transfer_confirmation();

-- ── 확인된 송금이 하나라도 있으면 정산은 잠긴다 ────────────────────────────
create or replace function public.guard_settlement_cancel()
returns trigger language plpgsql as $$
declare confirmed integer;
begin
  select count(*) into confirmed
    from public.transfers where settlement_id = old.id and confirmed_at is not null;

  if confirmed > 0 then
    raise exception
      '이미 %건의 송금이 확인된 정산은 취소할 수 없습니다. 보정 항목으로 바로잡으세요. (settlement_id=%)',
      confirmed, old.id
      using errcode = 'restrict_violation';
  end if;
  return old;
end $$;

create trigger settlements_cancel_guard
  before delete on public.settlements
  for each row execute function public.guard_settlement_cancel();

-- ── 정산 취소 ───────────────────────────────────────────────────────────────
-- 정산 행을 지우면 settlement_expenses가 cascade로 지워지고,
-- 그 지출들은 자동으로 다시 '미정산'이 되어 수정도 가능해진다.
-- 지출 원본은 어느 단계에서도 건드리지 않는다.
create or replace function public.cancel_settlement(p_settlement_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.settlements where id = p_settlement_id;
end $$;

revoke all on function public.cancel_settlement(uuid) from public, anon, authenticated;

-- 아직 확인되지 않은 송금 (홈 화면의 "내가 보낼 돈 / 받을 돈")
create or replace function public.open_transfers(p_ledger_id uuid)
returns table (
  transfer_id uuid, settlement_id uuid, seq integer,
  from_member_id uuid, to_member_id uuid, amount bigint
) language sql stable security definer set search_path = public as $$
  select t.id, s.id, s.seq, t.from_member_id, t.to_member_id, t.amount
    from public.transfers t
    join public.settlements s on s.id = t.settlement_id
   where s.ledger_id = p_ledger_id and t.confirmed_at is null
   order by s.seq, t.amount desc
$$;

revoke all on function public.open_transfers(uuid) from public, anon, authenticated;
