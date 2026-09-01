-- ============================================================================
-- Ledger — 0014 소유자, 그리고 소유자의 대신 확인
--
-- 두 가지를 더한다.
--
-- 1. **소유권 이전**
--    지금까지 소유자는 팀을 만든 사람으로 고정이었다. 그 사람이 학기 중에
--    빠지거나 계정을 잃으면 그 장부는 초대 링크도 못 만들고 이름도 못 바꾸는
--    상태로 굳는다. 넘길 수 있어야 한다.
--
--    넘기는 조건: 받는 사람이 **계정이 있고**, **그 팀의 활성 팀원**일 것.
--    초대 링크로만 들어온 사람에게는 넘길 수 없다 — 그 사람에게는 다시
--    로그인할 계정이 없어서, 넘기는 순간 소유자가 사라진다.
--
-- 2. **소유자의 대신 확인**
--    송금 완료는 받은 사람만 확인할 수 있었다. 그 규칙 자체는 옳다 —
--    "보냈는데요 / 안 들어왔는데요"를 구조적으로 없애는 유일한 방법이다.
--
--    그런데 학기가 끝나면 아무도 앱에 안 들어온다. 받는 사람이 안 눌러 주면
--    그 정산은 영원히 '확인 중'으로 남는다. 안 닫히는 장부도 틀린 장부다.
--
--    그래서 **소유자 한 사람에게만** 대신 확인할 길을 연다. 대신 눌러도
--    confirmed_by_member_id 에는 누른 사람이 남으므로, 나중에 이 확인이
--    받은 사람 본인의 것인지 소유자가 대신한 것인지 구분된다. 권한을 넓히되
--    누가 했는지는 지운 적이 없다.
--
-- Supabase SQL Editor 에서 한 번 실행한다.
-- ============================================================================

-- ── 1. 소유자는 그 팀의 계정 있는 활성 팀원이어야 한다 ──────────────────────
-- 팀을 만들 때는 teams 행이 members 보다 먼저 들어가므로 INSERT 는 보지 않는다.
-- 넘길 때(UPDATE)만 확인한다.
create or replace function public.guard_team_owner()
returns trigger language plpgsql as $$
begin
  if new.owner_id is distinct from old.owner_id then
    if new.owner_id is null then
      raise exception '장부에는 소유자가 있어야 합니다.' using errcode = 'check_violation';
    end if;
    if not exists (
      select 1 from public.members m
       where m.team_id = old.id
         and m.user_id = new.owner_id
         and m.active
    ) then
      raise exception '소유자는 계정으로 들어온 활성 팀원이어야 합니다.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists teams_owner_guard on public.teams;
create trigger teams_owner_guard
  before update on public.teams
  for each row execute function public.guard_team_owner();

-- ── 2. 확인은 받은 사람, 또는 소유자 ────────────────────────────────────────
create or replace function public.guard_transfer_confirmation()
returns trigger language plpgsql as $$
declare
  v_owner uuid;
  v_by_user uuid;
begin
  if new.confirmed_by_member_id is not null
     and new.confirmed_by_member_id <> new.to_member_id then

    -- 이 송금이 속한 장부의 소유자를 찾는다.
    select t.owner_id into v_owner
      from public.settlements s
      join public.ledgers l on l.id = s.ledger_id
      join public.teams   t on t.id = l.team_id
     where s.id = new.settlement_id;

    select m.user_id into v_by_user
      from public.members m where m.id = new.confirmed_by_member_id;

    if v_owner is null or v_by_user is null or v_by_user <> v_owner then
      raise exception '송금 완료는 돈을 받은 사람, 또는 장부 소유자만 확인할 수 있습니다.'
        using errcode = 'check_violation';
    end if;
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

-- ── 3. 아직 확인되지 않은 송금에 '누가 보냈다고 했는지'와 '언제'까지 실어 준다 ──
-- 기다린 시간을 화면에 적기 위해서다. 오래 기다린 송금은 닫히지 않을 뿐,
-- 얼마나 기다렸는지는 장부가 말해 줄 수 있다.
create or replace function public.open_transfers(p_ledger_id uuid)
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
