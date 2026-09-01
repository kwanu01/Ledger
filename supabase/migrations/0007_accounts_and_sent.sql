-- ════════════════════════════════════════════════════════════════════════════
-- 0007 · 계좌 정보와 "보냈어요" 상태
--
-- 두 가지를 더한다.
--
-- 1. 팀원의 계좌
--    정산이 끝나도 "그래서 어디로 보내지?"가 남는다. 매번 단톡방을 뒤져
--    계좌번호를 찾는 일을 없앤다. 은행 이름과 계좌번호만 둔다. 예금주는
--    팀원 이름이 이미 있으므로 따로 두지 않는다.
--
-- 2. 송금의 "보냈다" 상태
--    지금은 받은 사람만 확인할 수 있다. 그런데 송금하는 순간을 아는 것은
--    보낸 사람이고, 받은 사람은 통장을 봐야 안다. 보낸 사람이 먼저 표시하면
--    받은 사람은 맞는지만 보면 된다.
--
--    확인(confirmed_at)의 뜻은 그대로다. 돈이 실제로 오갔다고 판정하는 것은
--    여전히 받은 사람뿐이다. sent_at 은 그보다 앞선 신호일 뿐이며,
--    이것만으로 정산이 닫히지 않는다.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.members
  add column if not exists bank       text,
  add column if not exists account_no text;

alter table public.transfers
  add column if not exists sent_at timestamptz,
  add column if not exists sent_by_member_id uuid references public.members (id) on delete restrict;

-- 보냈다는 표시는 보낸 사람만 할 수 있다.
create or replace function public.guard_transfer_sender()
returns trigger language plpgsql as $$
begin
  if new.sent_at is not null and new.sent_by_member_id is distinct from new.from_member_id then
    raise exception '송금은 보낸 사람만 표시할 수 있습니다';
  end if;

  -- 확인된 송금은 되돌리지 않는다. 받았다고 한 것을 다시 안 보냈다고 할 수 없다.
  if old.confirmed_at is not null and new.sent_at is null then
    raise exception '이미 확인된 송금입니다';
  end if;

  return new;
end $$;

drop trigger if exists transfer_sender_guard on public.transfers;
create trigger transfer_sender_guard
  before update on public.transfers
  for each row execute function public.guard_transfer_sender();

-- 아직 오가지 않은 송금 목록에 보냈는지 여부를 함께 돌려준다.
--
-- PostgreSQL은 returns table 함수의 열이 바뀌면 create or replace 를 거절한다
-- (cannot change return type of existing function). 먼저 지우고 다시 만든다.
drop function if exists public.open_transfers(uuid);

create function public.open_transfers(p_ledger_id uuid)
returns table (
  transfer_id uuid, settlement_id uuid, seq integer,
  from_member_id uuid, to_member_id uuid, amount bigint,
  sent_at timestamptz
) language sql stable security definer set search_path = public as $$
  select t.id, s.id, s.seq, t.from_member_id, t.to_member_id, t.amount, t.sent_at
    from public.transfers t
    join public.settlements s on s.id = t.settlement_id
   where s.ledger_id = p_ledger_id and t.confirmed_at is null
   order by s.seq, t.amount desc
$$;

revoke all on function public.open_transfers(uuid) from public, anon, authenticated;
