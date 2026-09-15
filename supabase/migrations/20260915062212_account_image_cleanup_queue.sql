-- Candidate only. Storage remains an external service; unresolved writes must
-- not be timed out into a false assertion that every personal file was removed.
create table public.account_image_cleanup (
  ledger_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index account_image_cleanup_user on public.account_image_cleanup(user_id);
create table public.image_upload_operations (
  id uuid primary key default gen_random_uuid(),
  ledger_id uuid not null,
  member_id uuid not null,
  user_id uuid,
  object_path text not null unique,
  created_at timestamptz not null default now()
);
create index image_upload_operations_ledger on public.image_upload_operations(ledger_id);
create index image_upload_operations_user on public.image_upload_operations(user_id);
create index image_upload_operations_member on public.image_upload_operations(member_id);
alter table public.account_image_cleanup enable row level security;
alter table public.account_image_cleanup force row level security;
alter table public.image_upload_operations enable row level security;
alter table public.image_upload_operations force row level security;
revoke all on public.account_image_cleanup,public.image_upload_operations from public,anon,authenticated,service_role;
grant select,update on public.account_image_cleanup to service_role;
grant select on public.image_upload_operations to service_role;

-- A guest may claim an account while a Storage request is in flight. The member
-- row lock serializes claim with reservation; deletion must then wait for that
-- user's formerly anonymous operations too.
create function public.claim_image_upload_operations()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if old.user_id is null and new.user_id is not null then
    update public.image_upload_operations set user_id=new.user_id where member_id=new.id and user_id is null;
  end if;
  return new;
end $$;
revoke all on function public.claim_image_upload_operations() from public,anon,authenticated;
create trigger members_claim_image_uploads after update of user_id on public.members
  for each row execute function public.claim_image_upload_operations();

create function public.queue_deleted_account_images()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_owner uuid;
begin
  select t.owner_id into v_owner from public.teams t join public.account_deletions d on d.user_id=t.owner_id
    where t.id=old.team_id;
  if v_owner is not null then
    insert into public.account_image_cleanup(ledger_id,user_id) values(old.id,v_owner) on conflict(ledger_id) do nothing;
  end if;
  return old;
end $$;
revoke all on function public.queue_deleted_account_images() from public,anon,authenticated;
create trigger ledgers_queue_deleted_account_images before delete on public.ledgers
  for each row execute function public.queue_deleted_account_images();

create function public.assert_image_actor(p_ledger_id uuid,p_member_id uuid,p_user_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_team uuid; v_member public.members%rowtype; v_owner uuid;
begin
  if p_user_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('ledger.account.delete:' || p_user_id::text,0));
    if exists(select 1 from public.account_deletions where user_id=p_user_id) then
      raise exception '삭제 중인 계정입니다.' using errcode='check_violation';
    end if;
  end if;
  select team_id into v_team from public.ledgers where id=p_ledger_id;
  if not found then raise exception '장부를 확인하지 못했습니다.' using errcode='check_violation'; end if;
  -- Same row order as account deletion: membership before ledger. The lock is
  -- held until this short DB operation commits, never across a Storage request.
  select * into v_member from public.members where id=p_member_id and team_id=v_team for share;
  select owner_id into v_owner from public.teams where id=v_team;
  if v_member.id is null or v_member.account_deleted_at is not null
    or v_member.user_id is distinct from p_user_id
    or (not v_member.active and (p_user_id is null or v_owner is distinct from p_user_id)) then
    raise exception '이 장부의 사진을 변경할 수 없습니다.' using errcode='check_violation';
  end if;
  perform 1 from public.ledgers where id=p_ledger_id and team_id=v_team for key share;
  if not found or exists(select 1 from public.account_image_cleanup where ledger_id=p_ledger_id) then
    raise exception '삭제 중이거나 존재하지 않는 장부입니다.' using errcode='check_violation';
  end if;
end $$;
revoke all on function public.assert_image_actor(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.assert_image_actor(uuid,uuid,uuid) to service_role;

create function public.begin_image_upload(p_ledger_id uuid,p_expense_id uuid,p_path text,p_member_id uuid,p_user_id uuid)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_operation uuid;
begin
  -- The DELETE takes a conflicting row lock. Either the upload is durably
  -- registered first, or it sees the deletion and cannot start a Storage write.
  perform public.assert_image_actor(p_ledger_id,p_member_id,p_user_id);
  perform 1 from public.expenses where id=p_expense_id and ledger_id=p_ledger_id for key share;
  if not found or p_path is null or p_path !~ ('^' || p_ledger_id::text || '/' || p_expense_id::text || '/(receipt|item)-[a-z0-9-]+\.(jpg|png|webp)$') then
    raise exception '사진 경로를 확인하지 못했습니다.' using errcode='check_violation';
  end if;
  insert into public.image_upload_operations(ledger_id,member_id,user_id,object_path) values(p_ledger_id,p_member_id,p_user_id,p_path) returning id into v_operation;
  return v_operation;
end $$;
revoke all on function public.begin_image_upload(uuid,uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_image_upload(uuid,uuid,text,uuid,uuid) to service_role;

create function public.set_expense_image(p_ledger_id uuid,p_expense_id uuid,p_member_id uuid,p_user_id uuid,p_kind text,p_path text,p_expected_path text)
returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  perform public.assert_image_actor(p_ledger_id,p_member_id,p_user_id);
  if p_kind is null or p_kind not in ('receipt','item') or (p_path is not null and
    p_path !~ ('^' || p_ledger_id::text || '/' || p_expense_id::text || '/' || p_kind || '-[a-z0-9-]+\.(jpg|png|webp)$')) then
    raise exception '사진 경로를 확인하지 못했습니다.' using errcode='check_violation';
  end if;
  if p_kind='receipt' then
    update public.expenses set receipt_path=p_path where id=p_expense_id and ledger_id=p_ledger_id and receipt_path is not distinct from p_expected_path;
  else
    update public.expenses set representative_image_path=p_path where id=p_expense_id and ledger_id=p_ledger_id and representative_image_path is not distinct from p_expected_path;
  end if;
  return found;
end $$;
revoke all on function public.set_expense_image(uuid,uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.set_expense_image(uuid,uuid,uuid,uuid,text,text,text) to service_role;

create function public.finish_image_upload(p_operation_id uuid,p_path text)
returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  -- The server calls this only after metadata + old file cleanup, or acknowledged
  -- compensating deletion. Unknown outcomes need operator reconciliation, never expiry.
  delete from public.image_upload_operations where id=p_operation_id and object_path=p_path;
  return found;
end $$;
revoke all on function public.finish_image_upload(uuid,text) from public,anon,authenticated;
grant execute on function public.finish_image_upload(uuid,text) to service_role;

create function public.account_image_cleanup_ready()
returns boolean language sql security invoker set search_path = pg_catalog, public as $$
  select to_regclass('public.account_image_cleanup') is not null
    and to_regclass('public.image_upload_operations') is not null
    and exists(select 1 from pg_trigger where tgrelid='public.ledgers'::regclass
      and tgname='ledgers_queue_deleted_account_images' and tgenabled <> 'D')
    and exists(select 1 from pg_trigger where tgrelid='public.members'::regclass
      and tgname='members_claim_image_uploads' and tgenabled <> 'D');
$$;
revoke all on function public.account_image_cleanup_ready() from public,anon,authenticated;
grant execute on function public.account_image_cleanup_ready() to service_role;
