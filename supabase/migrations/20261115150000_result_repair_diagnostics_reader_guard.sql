begin;

-- Provisional and revoked pre-claim sessions must be rejected before either admin branch, so a
-- Platform Admin identity's stale JWT cannot read the role boolean through a direct RPC call.
-- is_provisional_actor also covers revoked pre-claim sessions.
create or replace function public.result_repair_diagnostics_reader(p_community_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
    and not public.is_provisional_actor()
    and (
      public.is_platform_admin()
      or (p_community_id is not null and public.is_community_admin(p_community_id))
    );
$$;

revoke execute on function public.result_repair_diagnostics_reader(uuid)
  from public, anon, authenticated;
grant execute on function public.result_repair_diagnostics_reader(uuid) to authenticated;

commit;
