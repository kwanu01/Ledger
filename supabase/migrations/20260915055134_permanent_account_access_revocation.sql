-- Candidate only. Apply before the account-deletion server changes.
-- Retain financial member ids, but permanently revoke the identity behind them.
alter table public.members add column account_deleted_at timestamptz;
comment on column public.members.account_deleted_at is
  'Permanent revoked identity. Cannot be reactivated or claimed; financial references remain.';

-- Only needed while external Auth deletion is pending. Auth success removes the
-- marker through this FK; the removed auth UUID then cannot recreate a profile.
create table public.account_deletions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now()
);
alter table public.account_deletions enable row level security;
alter table public.account_deletions force row level security;
revoke all on public.account_deletions from public, anon, authenticated, service_role;
grant select, insert on public.account_deletions to service_role;

create function public.assert_account_not_deleting(p_user_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if p_user_id is null then return; end if;
  perform pg_advisory_xact_lock(hashtextextended('ledger.account.delete:' || p_user_id::text, 0));
  if exists (select 1 from public.account_deletions where user_id = p_user_id) then
    raise exception '계정 삭제가 진행 중입니다. 삭제를 완료한 뒤 새 계정으로 가입해 주세요.'
      using errcode = 'check_violation';
  end if;
end $$;
revoke all on function public.assert_account_not_deleting(uuid) from public, anon, authenticated;
grant execute on function public.assert_account_not_deleting(uuid) to service_role;

create function public.guard_account_reuse()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if tg_table_name = 'profiles' then
    perform public.assert_account_not_deleting(new.id);
  elsif tg_table_name = 'teams' then
    perform public.assert_account_not_deleting(new.owner_id);
  else
    perform public.assert_account_not_deleting(new.user_id);
  end if;
  return new;
end $$;
revoke all on function public.guard_account_reuse() from public, anon, authenticated;
create trigger profiles_account_reuse before insert or update on public.profiles
  for each row execute function public.guard_account_reuse();
create trigger teams_account_reuse before insert or update of owner_id on public.teams
  for each row execute function public.guard_account_reuse();
create trigger members_account_reuse before insert or update of user_id on public.members
  for each row execute function public.guard_account_reuse();

create function public.guard_deleted_member()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE' then
    if old.account_deleted_at is not null and exists (select 1 from public.teams where id = old.team_id) then
      raise exception '탈퇴한 팀원의 기록 식별자는 삭제할 수 없습니다.' using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.account_deleted_at is not null and
     (new.account_deleted_at is distinct from old.account_deleted_at or new.id <> old.id or new.team_id <> old.team_id) then
    raise exception '탈퇴한 팀원의 접근 권한은 복원할 수 없습니다.' using errcode = 'check_violation';
  end if;
  if new.account_deleted_at is not null and
     (new.active or new.user_id is not null or new.display_name <> '탈퇴한 팀원' or new.bank is not null or new.account_no is not null) then
    raise exception '탈퇴한 팀원을 다시 연결하거나 개인정보를 추가할 수 없습니다.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function public.guard_deleted_member() from public, anon, authenticated;
create trigger members_deleted_identity before insert or update or delete on public.members
  for each row execute function public.guard_deleted_member();

-- Covers profile deletion via Auth cascade as well as the application RPC.
create function public.revoke_profile_members()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  update public.members set account_deleted_at = coalesce(account_deleted_at, now()),
    active = false, user_id = null, display_name = '탈퇴한 팀원', bank = null, account_no = null
    where user_id = old.id;
  return old;
end $$;
revoke all on function public.revoke_profile_members() from public, anon, authenticated;
create trigger profiles_revoke_members before delete on public.profiles
  for each row execute function public.revoke_profile_members();

-- No external call belongs in this transaction. The server verifies identity,
-- revokes Apple authorization first, and removes Auth only after this commits.
create function public.wipe_account_data(p_user_id uuid)
returns integer language plpgsql security invoker set search_path = pg_catalog, public as $$
declare v_team uuid; v_removed integer := 0;
begin
  if p_user_id is null then raise exception '계정이 필요합니다.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ledger.account.delete:' || p_user_id::text, 0));
  perform 1 from public.profiles where id = p_user_id for update;
  -- Stable order; lock parent rows before checking membership. Team inserts and
  -- incoming ownership updates also take the same account advisory lock above.
  perform 1 from public.teams where owner_id = p_user_id order by id for update;
  perform 1 from public.members where team_id in
    (select id from public.teams where owner_id = p_user_id) order by id for update;
  if exists (select 1 from public.members m join public.teams t on t.id = m.team_id
      where t.owner_id = p_user_id and m.active and m.account_deleted_at is null
        and m.user_id is not null and m.user_id <> p_user_id) then
    raise exception '함께 쓰는 장부의 소유자를 먼저 넘겨 주세요.' using errcode = 'check_violation';
  end if;
  insert into public.account_deletions(user_id) values (p_user_id) on conflict do nothing;
  for v_team in select id from public.teams where owner_id = p_user_id order by id loop
    delete from public.transfers t using public.settlements s, public.ledgers l
      where t.settlement_id = s.id and s.ledger_id = l.id and l.team_id = v_team;
    delete from public.settlements s using public.ledgers l where s.ledger_id = l.id and l.team_id = v_team;
    delete from public.expenses e using public.ledgers l where e.ledger_id = l.id and l.team_id = v_team;
    -- Delete ledger parents before members. The income cascade then sees no
    -- closed ledger, while ordinary deletion of a closed income remains guarded.
    delete from public.ledgers where team_id = v_team;
    delete from public.teams where id = v_team;
    v_removed := v_removed + 1;
  end loop;
  delete from public.invites where created_by = p_user_id;
  -- Explicit update also handles retry after a prior external Auth failure.
  update public.members set account_deleted_at = coalesce(account_deleted_at, now()),
    active = false, user_id = null, display_name = '탈퇴한 팀원', bank = null, account_no = null
    where user_id = p_user_id;
  delete from public.profiles where id = p_user_id;
  return v_removed;
end $$;
revoke all on function public.wipe_account_data(uuid) from public, anon, authenticated;
grant execute on function public.wipe_account_data(uuid) to service_role;
