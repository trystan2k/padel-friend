create or replace function public.audit_community_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_details jsonb := '{}'::jsonb; v_community_id uuid;
begin
  if tg_table_name = 'communities' then
    v_community_id := new.id;
  else
    v_community_id := new.community_id;
  end if;
  if tg_table_name = 'community_members' then
    v_details := pg_catalog.jsonb_build_object('role', new.role, 'status', new.status);
  elsif tg_table_name = 'communities' then
    v_details := pg_catalog.jsonb_build_object('visibility', new.visibility);
  elsif tg_table_name = 'community_invitations' then
    v_details := pg_catalog.jsonb_build_object('revoked', new.revoked_at is not null);
  elsif tg_table_name = 'community_venues' then
    v_details := pg_catalog.jsonb_build_object('archived', new.archived_at is not null);
  end if;
  insert into public.community_audit_log (community_id, actor_user_id, entity, entity_id, action, details)
    values (v_community_id, (select auth.uid()), tg_table_name, new.id, tg_op, v_details);
  return new;
end;
$$;
revoke all on function public.audit_community_change() from public, anon, authenticated;
