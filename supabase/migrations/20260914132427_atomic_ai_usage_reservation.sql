-- Apply before deploying the server actions that call reserve_ai_usage.
-- Prepared locally only. No production database was used to generate this file.
-- A reservation is one ai_extractions row. Completing it updates that same row.
-- Failed/uncertain calls remain counted: the upstream service may have charged.

create or replace function public.reserve_ai_usage(
  p_ledger_id uuid,
  p_model text,
  p_limit integer
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_used bigint;
  v_id uuid;
  v_now timestamptz;
  v_month timestamptz;
  v_next_month timestamptz;
begin
  if p_ledger_id is null or p_limit is null or p_limit <= 0
     or p_model is null or pg_catalog.btrim(p_model) = '' or pg_catalog.length(p_model) > 200 then
    raise exception 'Invalid AI reservation arguments' using errcode = '22023';
  end if;

  -- Serialize every reservation for this ledger across all server instances.
  -- Hash collisions only serialize unrelated ledgers; they cannot enlarge a cap.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ledger.ai.month:' || p_ledger_id::text, 0)
  );
  v_now := pg_catalog.clock_timestamp();
  v_month := pg_catalog.date_trunc('month', v_now at time zone 'UTC') at time zone 'UTC';
  v_next_month := (pg_catalog.date_trunc('month', v_now at time zone 'UTC') + interval '1 month') at time zone 'UTC';

  select pg_catalog.count(*) into v_used
    from public.ai_extractions
   where ledger_id = p_ledger_id
     and created_at >= v_month
     and created_at < v_next_month;
  if v_used >= p_limit then
    return null;
  end if;

  insert into public.ai_extractions (
    ledger_id, model, input_tokens, output_tokens, cost_micro_usd, succeeded, created_at
  ) values (p_ledger_id, p_model, 0, 0, 0, false, v_now)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.reserve_ai_usage(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.reserve_ai_usage(uuid, text, integer) to service_role;

-- Usage displays use the same conservative count as the reservation gate.
create or replace function public.ai_usage_this_month(p_ledger_id uuid)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.count(*)::integer from public.ai_extractions
   where ledger_id = p_ledger_id
     and created_at >= (pg_catalog.date_trunc('month', now() at time zone 'UTC') at time zone 'UTC')
     and created_at < ((pg_catalog.date_trunc('month', now() at time zone 'UTC') + interval '1 month') at time zone 'UTC')
$$;

revoke all on function public.ai_usage_this_month(uuid) from public, anon, authenticated;
grant execute on function public.ai_usage_this_month(uuid) to service_role;

-- Read-only readiness check for the authenticated mobile bootstrap response.
create or replace function public.ai_usage_reservation_version()
returns integer
language sql
immutable
security invoker
set search_path = ''
as $$ select 1 $$;

revoke all on function public.ai_usage_reservation_version() from public, anon, authenticated;
grant execute on function public.ai_usage_reservation_version() to service_role;
