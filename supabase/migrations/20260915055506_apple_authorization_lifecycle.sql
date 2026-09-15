-- Candidate only. Apply after permanent_account_access_revocation, never from the app.
-- Apple tokens are AES-256-GCM ciphertext; keys remain exclusively in server secrets.
create table public.apple_account_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  deleting boolean not null default false
);
create table public.apple_authorization_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null check (client_id = 'net.teamledger.app'),
  code_hash text not null check (code_hash ~ '^[a-f0-9]{64}$'),
  apple_subject text,
  state text not null default 'pending' check (state in ('pending', 'active', 'uncertain', 'revoked')),
  encrypted_token text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (user_id, client_id, code_hash),
  check ((state = 'active' and encrypted_token is not null and apple_subject is not null)
    or (state <> 'active' and encrypted_token is null))
);
create index apple_grants_user on public.apple_authorization_grants(user_id);
alter table public.apple_account_states enable row level security;
alter table public.apple_authorization_grants enable row level security;
revoke all on public.apple_account_states, public.apple_authorization_grants from public, anon, authenticated;
grant select, insert, update, delete on public.apple_account_states, public.apple_authorization_grants to service_role;

create function public.reserve_apple_authorization(p_user_id uuid, p_client_id text, p_code_hash text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare grant_row public.apple_authorization_grants; is_deleting boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('ledger.account.delete:' || p_user_id::text, 0));
  if exists(select 1 from public.account_deletions where user_id = p_user_id) then return jsonb_build_object('blocked', true); end if;
  insert into public.apple_account_states(user_id) values(p_user_id) on conflict do nothing;
  select deleting into is_deleting from public.apple_account_states where user_id = p_user_id for update;
  if is_deleting then return jsonb_build_object('blocked', true); end if;
  select * into grant_row from public.apple_authorization_grants where user_id = p_user_id and client_id = p_client_id and code_hash = p_code_hash;
  if found then return jsonb_build_object('created', false, 'grant', to_jsonb(grant_row)); end if;
  if (select count(*) from public.apple_authorization_grants where user_id = p_user_id and created_at > now() - interval '1 hour') >= 24 then
    raise exception 'apple authorization rate limit';
  end if;
  insert into public.apple_authorization_grants(user_id, client_id, code_hash) values(p_user_id, p_client_id, p_code_hash) returning * into grant_row;
  return jsonb_build_object('created', true, 'grant', to_jsonb(grant_row));
end $$;

create function public.complete_apple_authorization(p_user_id uuid, p_grant_id uuid, p_subject text, p_encrypted_token text)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('ledger.account.delete:' || p_user_id::text, 0));
  if exists(select 1 from public.account_deletions where user_id = p_user_id)
    or not exists(select 1 from public.apple_account_states where user_id = p_user_id and not deleting) then return false; end if;
  if length(p_subject) not between 1 and 255 or length(p_encrypted_token) not between 1 and 32768 or p_encrypted_token not like 'v1.%' then return false; end if;
  update public.apple_authorization_grants set state = 'active', apple_subject = p_subject, encrypted_token = p_encrypted_token
    where id = p_grant_id and user_id = p_user_id and state = 'pending';
  return found;
end $$;

create function public.freeze_apple_authorizations(p_user_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare grants jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('ledger.account.delete:' || p_user_id::text, 0));
  insert into public.apple_account_states(user_id) values(p_user_id) on conflict do nothing;
  perform 1 from public.apple_account_states where user_id = p_user_id for update;
  if exists(select 1 from public.apple_authorization_grants where user_id = p_user_id and state = 'pending' and created_at > now() - interval '2 minutes') then
    return jsonb_build_object('busy', true);
  end if;
  -- A lost exchange response cannot safely be called "revoked". The deletion result
  -- carries manual_required, so missing historical tokens do not erase deletion rights.
  update public.apple_authorization_grants set state = 'uncertain' where user_id = p_user_id and state = 'pending';
  update public.apple_account_states set deleting = true where user_id = p_user_id;
  select coalesce(jsonb_agg(to_jsonb(g) order by created_at, id), '[]'::jsonb) into grants from public.apple_authorization_grants g where user_id = p_user_id;
  return jsonb_build_object('grants', grants);
end $$;

create function public.apple_authorizations_ready()
returns boolean language sql security invoker set search_path = '' as $$
  select to_regclass('public.apple_account_states') is not null
    and to_regclass('public.apple_authorization_grants') is not null
    and to_regclass('public.account_deletions') is not null;
$$;
revoke all on function public.reserve_apple_authorization(uuid,text,text), public.complete_apple_authorization(uuid,uuid,text,text), public.freeze_apple_authorizations(uuid), public.apple_authorizations_ready() from public, anon, authenticated;
grant execute on function public.reserve_apple_authorization(uuid,text,text), public.complete_apple_authorization(uuid,uuid,text,text), public.freeze_apple_authorizations(uuid), public.apple_authorizations_ready() to service_role;
