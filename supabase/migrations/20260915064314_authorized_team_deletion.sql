-- Candidate only. The authenticated server passes its verified user ID; clients
-- cannot execute either RPC. Lock, authorize and delete in the same transaction.
create function public.delete_team_as_owner(p_team_id uuid, p_expected_owner_id uuid)
returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_owner uuid;
begin
  if p_team_id is null or p_expected_owner_id is null then
    raise exception '삭제할 장부와 계정을 확인해 주세요.' using errcode='check_violation';
  end if;
  perform public.assert_account_not_deleting(p_expected_owner_id);
  select owner_id into v_owner from public.teams where id=p_team_id for update;
  if not found or v_owner is distinct from p_expected_owner_id then
    raise exception '장부 소유자가 바뀌었거나 장부를 찾을 수 없습니다. 다시 확인해 주세요.' using errcode='check_violation';
  end if;
  perform public.delete_team(p_team_id);
  return true;
end $$;
revoke all on function public.delete_team_as_owner(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.delete_team_as_owner(uuid,uuid) to service_role;

-- Only the checked SECURITY DEFINER wrapper may reach the older internal helper.
-- A stale server cannot use the old RPC to skip the locked ownership check.
alter function public.delete_team(uuid) set search_path = pg_catalog, public;
revoke all on function public.delete_team(uuid) from public,anon,authenticated,service_role;
