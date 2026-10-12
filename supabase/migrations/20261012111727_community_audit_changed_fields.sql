create or replace function public.audit_community_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_details jsonb := '{}'::jsonb;
  v_changed_fields jsonb := '[]'::jsonb;
  v_transitions jsonb := '{}'::jsonb;
  v_community_id uuid;
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

  if tg_op = 'UPDATE' then
    if tg_table_name = 'communities' then
      if old.name is distinct from new.name then v_changed_fields := v_changed_fields || pg_catalog.jsonb_build_array('name'); end if;
      if old.description is distinct from new.description then v_changed_fields := v_changed_fields || pg_catalog.jsonb_build_array('description'); end if;
      if old.logo_path is distinct from new.logo_path then v_changed_fields := v_changed_fields || pg_catalog.jsonb_build_array('logo_path'); end if;
      if old.city_label is distinct from new.city_label then v_changed_fields := v_changed_fields || pg_catalog.jsonb_build_array('city_label'); end if;
      if old.visibility is distinct from new.visibility then
        v_changed_fields := v_changed_fields || pg_catalog.jsonb_build_array('visibility');
        v_transitions := v_transitions || pg_catalog.jsonb_build_object('visibility', pg_catalog.jsonb_build_object('before', old.visibility, 'after', new.visibility));
      end if;
      if old.join_policy is distinct from new.join_policy then
        v_changed_fields := v_changed_fields || pg_catalog.jsonb_build_array('join_policy');
        v_transitions := v_transitions || pg_catalog.jsonb_build_object('join_policy', pg_catalog.jsonb_build_object('before', old.join_policy, 'after', new.join_policy));
      end if;
      if old.settings is distinct from new.settings then v_changed_fields := v_changed_fields || pg_catalog.jsonb_build_array('settings'); end if;
    elsif tg_table_name = 'community_venues' then
      if old.name is distinct from new.name then v_changed_fields := v_changed_fields || pg_catalog.jsonb_build_array('name'); end if;
      if old.address is distinct from new.address then v_changed_fields := v_changed_fields || pg_catalog.jsonb_build_array('address'); end if;
      if old.maps_url is distinct from new.maps_url then v_changed_fields := v_changed_fields || pg_catalog.jsonb_build_array('maps_url'); end if;
      if old.photo_path is distinct from new.photo_path then v_changed_fields := v_changed_fields || pg_catalog.jsonb_build_array('photo_path'); end if;
      if old.archived_at is distinct from new.archived_at then
        v_changed_fields := v_changed_fields || pg_catalog.jsonb_build_array('archived_at');
        v_transitions := v_transitions || pg_catalog.jsonb_build_object('archived', pg_catalog.jsonb_build_object('before', old.archived_at is not null, 'after', new.archived_at is not null));
      end if;
    end if;
    if tg_table_name in ('communities', 'community_venues') then
      v_details := v_details || pg_catalog.jsonb_build_object('changed_fields', v_changed_fields, 'transitions', v_transitions);
    end if;
  end if;

  insert into public.community_audit_log (community_id, actor_user_id, entity, entity_id, action, details)
    values (v_community_id, (select auth.uid()), tg_table_name, new.id, tg_op, v_details);
  return new;
end;
$$;
revoke all on function public.audit_community_change() from public, anon, authenticated;
