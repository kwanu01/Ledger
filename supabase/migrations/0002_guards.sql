-- ============================================================================
-- Ledger — 0002 Guards
--
-- 앱 코드가 실수해도 장부가 깨지지 않도록, 회계 규칙을 DB에서 강제한다.
-- 여기 있는 규칙은 전부 시뮬레이션에서 검증한 불변식과 같은 것들이다.
-- ============================================================================

-- ── 1. 확정된 정산에 들어간 지출은 고칠 수도 지울 수도 없다 ────────────────
-- 결정 1(원본 보존 + 보정 항목)을 DB 레벨에서 보장한다.
create or replace function public.guard_settled_expense()
returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.settlement_expenses se
             where se.expense_id = coalesce(old.id, new.id)) then
    raise exception
      '이미 정산된 지출은 수정하거나 삭제할 수 없습니다. 보정 항목을 새로 기록하세요. (expense_id=%)',
      coalesce(old.id, new.id)
      using errcode = 'restrict_violation';
  end if;
  return coalesce(new, old);
end $$;

create trigger expenses_no_update_after_settlement
  before update on public.expenses
  for each row execute function public.guard_settled_expense();

create trigger expenses_no_delete_after_settlement
  before delete on public.expenses
  for each row execute function public.guard_settled_expense();

-- ── 2. 확정된 정산의 snapshot은 불변이다 ───────────────────────────────────
create or replace function public.guard_settlement_immutable()
returns trigger language plpgsql as $$
begin
  if new.snapshot is distinct from old.snapshot
     or new.ledger_id is distinct from old.ledger_id
     or new.seq is distinct from old.seq then
    raise exception '확정된 정산의 계산 결과는 변경할 수 없습니다. (settlement_id=%)', old.id
      using errcode = 'restrict_violation';
  end if;
  return new;
end $$;

create trigger settlements_snapshot_immutable
  before update on public.settlements
  for each row execute function public.guard_settlement_immutable();

-- ── 3. 부담자는 반드시 그 지출의 명단 안에 있어야 한다 ─────────────────────
-- 일부 인원 부담에 명단 밖 사람이 섞이면 지분 합이 금액과 어긋난다.
create or replace function public.guard_expense_bearers()
returns trigger language plpgsql as $$
begin
  if new.allocation = 'partial'
     and not (new.participant_member_ids <@ new.team_member_ids) then
    raise exception '부담 인원은 그 지출의 기록 시점 팀원 명단 안에 있어야 합니다.'
      using errcode = 'check_violation';
  end if;

  if new.allocation = 'personal'
     and not (new.owner_member_id = any (new.team_member_ids)) then
    raise exception '개인 귀속 대상은 그 지출의 기록 시점 팀원 명단 안에 있어야 합니다.'
      using errcode = 'check_violation';
  end if;

  if not (new.payer_member_id = any (new.team_member_ids)) then
    raise exception '결제자는 그 지출의 기록 시점 팀원 명단 안에 있어야 합니다.'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

create trigger expenses_bearers_within_roster
  before insert or update on public.expenses
  for each row execute function public.guard_expense_bearers();

-- ── 4. 보정·환불은 원본의 부담 구조를 그대로 따라야 한다 ───────────────────
-- 4인이 나눠 낸 지출을 5인에게 환급하면 잔액이 남는다.
create or replace function public.guard_adjustment_matches_target()
returns trigger language plpgsql as $$
declare t record;
begin
  if new.adjustment_target_id is null then return new; end if;

  select * into t from public.expenses where id = new.adjustment_target_id;
  if not found then
    raise exception '보정 대상 지출을 찾을 수 없습니다.' using errcode = 'foreign_key_violation';
  end if;

  if t.adjustment_target_id is not null then
    raise exception '보정 항목을 다시 보정할 수 없습니다. 원본 지출을 대상으로 기록하세요.'
      using errcode = 'check_violation';
  end if;

  if t.ledger_id <> new.ledger_id then
    raise exception '보정 항목은 원본과 같은 장부에 있어야 합니다.' using errcode = 'check_violation';
  end if;

  if new.allocation <> t.allocation
     or new.team_member_ids is distinct from t.team_member_ids
     or new.participant_member_ids is distinct from t.participant_member_ids
     or new.owner_member_id is distinct from t.owner_member_id then
    raise exception '보정·환불 항목의 부담 구조는 원본과 같아야 합니다. (target=%)', t.id
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

create trigger expenses_adjustment_matches_target
  before insert or update on public.expenses
  for each row execute function public.guard_adjustment_matches_target();

-- ── 5. 정산에는 같은 장부의 지출만 담긴다 ──────────────────────────────────
create or replace function public.guard_settlement_expense_ledger()
returns trigger language plpgsql as $$
begin
  if (select ledger_id from public.expenses where id = new.expense_id)
     is distinct from (select ledger_id from public.settlements where id = new.settlement_id) then
    raise exception '다른 장부의 지출은 이 정산에 넣을 수 없습니다.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger settlement_expenses_same_ledger
  before insert on public.settlement_expenses
  for each row execute function public.guard_settlement_expense_ledger();

-- ── 6. 정산 번호는 장부 안에서 1부터 순서대로 ──────────────────────────────
create or replace function public.assign_settlement_seq()
returns trigger language plpgsql as $$
begin
  if new.seq is null then
    select coalesce(max(seq), 0) + 1 into new.seq
      from public.settlements where ledger_id = new.ledger_id;
  end if;
  return new;
end $$;

create trigger settlements_assign_seq
  before insert on public.settlements
  for each row execute function public.assign_settlement_seq();
