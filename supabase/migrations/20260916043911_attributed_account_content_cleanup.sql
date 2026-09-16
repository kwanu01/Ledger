-- Candidate only. No attribution is inferred for pre-migration content.
alter table public.expenses add column content_actor jsonb;
alter table public.incomes add column content_actor jsonb;
create table public.content_ownership (
  resource_type text not null check(resource_type in ('expenses','incomes')),
  resource_id uuid not null, field_name text not null,
  member_id uuid not null, value_hash bytea not null,
  primary key(resource_type,resource_id,field_name)
);
create index content_ownership_member on public.content_ownership(member_id);
create table public.snapshot_content_ownership (
  settlement_id uuid not null references public.settlements(id) on delete cascade,
  field_path text[] not null, member_id uuid not null,
  primary key(settlement_id,field_path)
);
create index snapshot_content_ownership_member on public.snapshot_content_ownership(member_id);
create table public.account_content_cleanup (
  object_path text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  completed_at timestamptz
);
create index account_content_cleanup_user on public.account_content_cleanup(user_id);
alter table public.content_ownership enable row level security;
alter table public.content_ownership force row level security;
alter table public.snapshot_content_ownership enable row level security;
alter table public.snapshot_content_ownership force row level security;
alter table public.account_content_cleanup enable row level security;
alter table public.account_content_cleanup force row level security;
revoke all on public.content_ownership,public.snapshot_content_ownership,public.account_content_cleanup from public,anon,authenticated,service_role;
grant select on public.content_ownership,public.snapshot_content_ownership to service_role;
grant select,update on public.account_content_cleanup to service_role;

create function public.track_content_ownership()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare fields text[]; f text; previous jsonb; value jsonb; actor jsonb; actor_id uuid; prior_owner uuid;
begin
  if tg_op='DELETE' then
    delete from public.content_ownership where resource_type=tg_table_name and resource_id=old.id;
    return old;
  end if;
  actor:=new.content_actor;
  if actor is not null then
    actor_id:=(actor->>'member_id')::uuid;
    if actor_id is null or jsonb_typeof(actor->'fields') is distinct from 'array' then raise exception 'Invalid content actor'; end if;
    -- UPDATE already owns the content row. Never wait for a deleting account
    -- or membership while holding it: deletion locks those parents first.
    if actor->>'user_id' is not null and not pg_try_advisory_xact_lock(hashtextextended('ledger.account.delete:'||(actor->>'user_id')::uuid::text,0)) then
      raise exception '계정 상태를 변경 중입니다. 잠시 후 다시 시도해 주세요.' using errcode='lock_not_available';
    end if;
    perform 1 from public.members where id=actor_id for share nowait;
    perform public.assert_image_actor(new.ledger_id,actor_id,(actor->>'user_id')::uuid);
  end if;
  fields:=case when tg_table_name='expenses' then array['title','note','vendor','category','group_name','product_link','adjustment_reason','receipt_path','representative_image_path'] else array['title','note'] end;
  foreach f in array fields loop
    previous:=case when tg_op='INSERT' then 'null'::jsonb else to_jsonb(old)->f end;
    value:=to_jsonb(new)->f;
    if tg_op='INSERT' or previous is distinct from value then
      select member_id into prior_owner from public.content_ownership where resource_type=tg_table_name and resource_id=new.id and field_name=f;
      delete from public.content_ownership where resource_type=tg_table_name and resource_id=new.id and field_name=f;
      if actor_id is not null and actor->'fields' ? f and value is not null and value <> 'null'::jsonb then
        if f in ('receipt_path','representative_image_path') then
          -- A copied path is not proof of upload ownership. Require the exact
          -- fresh reservation, bound to the same verified member and expense.
          if not exists(select 1 from public.image_upload_operations where member_id=actor_id and ledger_id=new.ledger_id and object_path=value#>>'{}') then continue; end if;
        elsif tg_op <> 'INSERT' and previous not in ('null'::jsonb,'""'::jsonb) and prior_owner is distinct from actor_id then
          -- Another member editing existing prose may preserve their words.
          -- Treat mixed/unknown authorship as unknown, not as a transfer.
          continue;
        end if;
        insert into public.content_ownership values(tg_table_name,new.id,f,actor_id,sha256(convert_to(value::text,'UTF8')));
      end if;
    end if;
  end loop;
  new.content_actor:=null;
  return new;
end $$;
revoke all on function public.track_content_ownership() from public,anon,authenticated;
create trigger expenses_content_ownership before insert or update or delete on public.expenses for each row execute function public.track_content_ownership();
create trigger incomes_content_ownership before insert or update or delete on public.incomes for each row execute function public.track_content_ownership();

create function public.snapshot_content_path(p_field text,p_index integer)
returns text[] language sql immutable set search_path=pg_catalog,public as $$
  select array['breakdowns',p_index::text,'expense'] || case p_field
    when 'adjustment_reason' then array['adjustment','reason']
    when 'group_name' then array['group'] when 'product_link' then array['productLink']
    when 'receipt_path' then array['receiptImage'] when 'representative_image_path' then array['representativeImage']
    else array[p_field] end;
$$;
revoke all on function public.snapshot_content_path(text,integer) from public,anon,authenticated;

create function public.track_snapshot_content()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare item record; proof record; field_path text[]; current_row jsonb; f text;
begin
  -- Lock every referenced expense through commit. A snapshot prepared before
  -- deletion must not reintroduce redacted content after deletion commits.
  perform 1 from public.expenses e where e.ledger_id=new.ledger_id and e.id::text in
    (select value#>>'{expense,id}' from jsonb_array_elements(coalesce(new.snapshot->'breakdowns','[]'::jsonb))) order by e.id for share;
  for item in select value,ordinality from jsonb_array_elements(coalesce(new.snapshot->'breakdowns','[]'::jsonb)) with ordinality loop
    select to_jsonb(e) into current_row from public.expenses e where e.ledger_id=new.ledger_id and e.id::text=item.value#>>'{expense,id}';
    if current_row is null then raise exception '정산할 지출이 변경되었습니다. 다시 시도해 주세요.'; end if;
    foreach f in array array['title','note','vendor','category','group_name','product_link','adjustment_reason','receipt_path','representative_image_path'] loop
      field_path:=public.snapshot_content_path(f,item.ordinality::integer-1);
      if coalesce(current_row->f,'null'::jsonb) is distinct from coalesce(new.snapshot#>field_path,'null'::jsonb) then
        raise exception '정산할 지출의 내용이 변경되었습니다. 다시 시도해 주세요.';
      end if;
    end loop;
    for proof in select o.* from public.content_ownership o join public.expenses e on e.id=o.resource_id
      where o.resource_type='expenses' and e.ledger_id=new.ledger_id and e.id::text=item.value#>>'{expense,id}' loop
      field_path:=public.snapshot_content_path(proof.field_name,item.ordinality::integer-1);
      if proof.value_hash=sha256(convert_to((new.snapshot#>field_path)::text,'UTF8')) then
        insert into public.snapshot_content_ownership values(new.id,field_path,proof.member_id);
      end if;
    end loop;
  end loop;
  return new;
end $$;
revoke all on function public.track_snapshot_content() from public,anon,authenticated;
create trigger settlements_content_ownership after insert on public.settlements for each row execute function public.track_snapshot_content();

-- Only redactions backed by an actual pending account deletion may pass the
-- immutable-snapshot guard. Amounts, allocation, shares and transfers are exact.
create function public.account_redacted_snapshot(p_id uuid,p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare proof record; result jsonb:=p_snapshot;
begin
  for proof in select o.field_path from public.snapshot_content_ownership o join public.members m on m.id=o.member_id
    join public.account_deletions d on d.user_id=m.user_id where o.settlement_id=p_id loop
    result:=jsonb_set(result,proof.field_path,case when proof.field_path[array_length(proof.field_path,1)]='title' then to_jsonb('삭제된 내용'::text) else 'null'::jsonb end,false);
  end loop;
  return result;
end $$;
revoke all on function public.account_redacted_snapshot(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.account_redacted_snapshot(uuid,jsonb) to service_role;
create or replace function public.guard_settlement_immutable()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  if new.ledger_id is distinct from old.ledger_id or new.seq is distinct from old.seq
    or (new.snapshot is distinct from old.snapshot and new.snapshot is distinct from public.account_redacted_snapshot(old.id,old.snapshot)) then
    raise exception '확정된 정산의 계산 결과는 변경할 수 없습니다.' using errcode='restrict_violation';
  end if;
  return new;
end $$;

create function public.remove_attributed_account_content()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare proof record; current_value jsonb; changed jsonb;
begin
  -- Called on marker insertion, inside wipe_account_data's transaction and
  -- before membership anonymization. A rollback rolls back every redaction.
  perform 1 from public.members where user_id=new.user_id order by id for update;
  for proof in select o.* from public.content_ownership o join public.members m on m.id=o.member_id
    where m.user_id=new.user_id order by o.resource_type,o.resource_id,o.field_name loop
    execute format('select to_jsonb(r)->%L from public.%I r where id=$1 for update',proof.field_name,proof.resource_type) into current_value using proof.resource_id;
    if current_value is null or proof.value_hash is distinct from sha256(convert_to(current_value::text,'UTF8')) then continue; end if;
    if proof.field_name in ('receipt_path','representative_image_path') then
      insert into public.account_content_cleanup(object_path,user_id) values(current_value#>>'{}',new.user_id) on conflict do nothing;
    end if;
    execute format('update public.%I set %I=$1 where id=$2',proof.resource_type,proof.field_name)
      using case when proof.field_name='title' then '삭제된 내용'::text else null::text end,proof.resource_id;
  end loop;
  for proof in select distinct s.id,s.snapshot from public.settlements s join public.snapshot_content_ownership o on o.settlement_id=s.id
    join public.members m on m.id=o.member_id where m.user_id=new.user_id order by s.id loop
    -- Snapshot-only attachments still need external deletion after SQL commits.
    insert into public.account_content_cleanup(object_path,user_id)
      select proof.snapshot#>>o.field_path,new.user_id from public.snapshot_content_ownership o join public.members m on m.id=o.member_id
      where o.settlement_id=proof.id and m.user_id=new.user_id and o.field_path[array_length(o.field_path,1)] in ('receiptImage','representativeImage')
        and proof.snapshot#>>o.field_path is not null on conflict do nothing;
    changed:=public.account_redacted_snapshot(proof.id,proof.snapshot);
    update public.settlements set snapshot=changed where id=proof.id;
  end loop;
  delete from public.snapshot_content_ownership where member_id in(select id from public.members where user_id=new.user_id);
  return new;
end $$;
revoke all on function public.remove_attributed_account_content() from public,anon,authenticated;
create trigger account_deletions_remove_content after insert on public.account_deletions for each row execute function public.remove_attributed_account_content();

-- Permit only proven privacy redaction in a closed income. All numeric/date/
-- identity columns remain byte-for-byte equal; normal edits stay locked.
create or replace function public.guard_closed_income()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare is_redaction boolean:=false;
begin
  if tg_op='UPDATE' then
    is_redaction:=(to_jsonb(new)-array['title','note'])=(to_jsonb(old)-array['title','note'])
      and (new.title is not distinct from old.title or (new.title='삭제된 내용' and exists(select 1 from public.content_ownership o join public.members m on m.id=o.member_id join public.account_deletions d on d.user_id=m.user_id where o.resource_type='incomes' and o.resource_id=old.id and o.field_name='title')))
      and (new.note is not distinct from old.note or (new.note is null and exists(select 1 from public.content_ownership o join public.members m on m.id=o.member_id join public.account_deletions d on d.user_id=m.user_id where o.resource_type='incomes' and o.resource_id=old.id and o.field_name='note')));
  end if;
  if exists(select 1 from public.ledgers where id=coalesce(new.ledger_id,old.ledger_id) and closed_at is not null) and not is_redaction then
    raise exception '이미 닫힌 회기의 수입은 바꿀 수 없습니다.' using errcode='restrict_violation';
  end if;
  return coalesce(new,old);
end $$;
-- Trigger ordering: validate the closed-row redaction before its proof is cleared.
alter trigger incomes_content_ownership on public.incomes rename to incomes_z_content_ownership;

create or replace function public.set_expense_image(p_ledger_id uuid,p_expense_id uuid,p_member_id uuid,p_user_id uuid,p_kind text,p_path text,p_expected_path text)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor jsonb;
begin
  perform public.assert_image_actor(p_ledger_id,p_member_id,p_user_id);
  if p_kind is null or p_kind not in ('receipt','item') or (p_path is not null and p_path !~ ('^'||p_ledger_id::text||'/'||p_expense_id::text||'/'||p_kind||'-[a-z0-9-]+\.(jpg|png|webp)$')) then raise exception '사진 경로를 확인하지 못했습니다.'; end if;
  actor:=jsonb_build_object('member_id',p_member_id,'user_id',p_user_id,'fields',jsonb_build_array(case p_kind when 'receipt' then 'receipt_path' else 'representative_image_path' end));
  if p_kind='receipt' then
    update public.expenses set receipt_path=p_path,content_actor=actor where id=p_expense_id and ledger_id=p_ledger_id and receipt_path is not distinct from p_expected_path;
  else
    update public.expenses set representative_image_path=p_path,content_actor=actor where id=p_expense_id and ledger_id=p_ledger_id and representative_image_path is not distinct from p_expected_path;
  end if;
  return found;
end $$;

create function public.account_content_cleanup_ready()
returns boolean language sql security invoker set search_path=pg_catalog,public as $$
  select to_regclass('public.account_content_cleanup') is not null
    and exists(select 1 from pg_trigger where tgrelid='public.account_deletions'::regclass and tgname='account_deletions_remove_content' and tgenabled<>'D');
$$;
create or replace function public.account_image_cleanup_ready()
returns boolean language sql security invoker set search_path=pg_catalog,public as $$
  select to_regclass('public.account_image_cleanup') is not null
    and to_regclass('public.image_upload_operations') is not null
    and public.account_content_cleanup_ready()
    and exists(select 1 from pg_trigger where tgrelid='public.ledgers'::regclass and tgname='ledgers_queue_deleted_account_images' and tgenabled<>'D')
    and exists(select 1 from pg_trigger where tgrelid='public.members'::regclass and tgname='members_claim_image_uploads' and tgenabled<>'D');
$$;
create function public.account_content_file_unreferenced(p_path text)
returns boolean language sql security invoker set search_path=pg_catalog,public as $$
  select not exists(select 1 from public.expenses where receipt_path=p_path or representative_image_path=p_path)
    and not exists(select 1 from public.settlements s cross join lateral jsonb_array_elements(coalesce(s.snapshot->'breakdowns','[]'::jsonb)) b
      where b#>>'{expense,receiptImage}'=p_path or b#>>'{expense,representativeImage}'=p_path);
$$;
revoke all on function public.account_content_cleanup_ready(),public.account_content_file_unreferenced(text) from public,anon,authenticated;
grant execute on function public.account_content_cleanup_ready(),public.account_content_file_unreferenced(text) to service_role;
