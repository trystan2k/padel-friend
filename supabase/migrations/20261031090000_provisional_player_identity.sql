begin;

-- PAF-126: provisional player identity foundation. A provisional player is an
-- ordinary auth.users identity whose permanent UUID anchors every profile,
-- rating, membership, registration and result row from creation. Claiming only
-- clears is_provisional; it never re-keys history. Database state is the
-- authority for provisional restrictions, never JWT or user metadata.

-- 1. Profile provenance. Existing players backfill as self-declared/non-provisional.
alter table public.player_profiles
  add column is_provisional boolean not null default false,
  add column rating_input_source text not null default 'self_declared'
    check (rating_input_source in ('self_declared', 'creator_estimated')),
  add column estimated_level numeric(3,1)
    check (estimated_level between 0.0 and 7.0 and estimated_level * 10 = pg_catalog.trunc(estimated_level * 10)),
  add column invited_by uuid references auth.users(id) on delete restrict,
  add column invited_at timestamptz,
  add column source_match_event_id uuid references public.match_events(id) on delete restrict,
  add constraint player_profile_provenance check (
    (rating_input_source = 'self_declared' and not is_provisional and estimated_level is null
      and invited_by is null and invited_at is null and source_match_event_id is null)
    or (rating_input_source = 'creator_estimated' and estimated_level is not null
      and invited_by is not null and invited_by <> user_id and invited_at is not null
      and source_match_event_id is not null));
create index player_profiles_provisional on public.player_profiles (user_id) where is_provisional;

-- Provenance is immutable and the marker only ever moves provisional -> claimed.
-- Column grants already keep these columns out of authenticated UPDATE.
create function public.guard_player_profile_provenance() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.is_provisional and not old.is_provisional)
    or (new.rating_input_source, new.estimated_level, new.invited_by, new.invited_at, new.source_match_event_id)
      is distinct from (old.rating_input_source, old.estimated_level, old.invited_by, old.invited_at, old.source_match_event_id) then
    raise exception 'Invalid provisional profile transition' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger player_profile_provenance_guard before update on public.player_profiles
  for each row execute function public.guard_player_profile_provenance();
revoke all on function public.guard_player_profile_provenance() from public, anon, authenticated;

-- 2. Membership provenance. Provisional state is derived from the profile; these
-- columns only attribute which add created the active interval. Claim keeps the
-- same rows, so the provenance survives as history.
alter table public.community_members
  add column added_by uuid references auth.users(id) on delete restrict,
  add column source_match_event_id uuid references public.match_events(id) on delete restrict,
  add constraint membership_add_provenance check ((added_by is null) = (source_match_event_id is null));

-- 3. Identity predicates. is_provisional_player is internal (no target-UUID oracle);
-- is_provisional_actor is self-scoped and safe for RLS policies.
create function public.is_provisional_player(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_user_id is not null and exists (
    select 1 from public.player_profiles p where p.user_id = p_user_id and p.is_provisional);
$$;
create function public.is_provisional_actor() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_provisional_player((select auth.uid()));
$$;
create function public.assert_actor_not_provisional() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.is_provisional_actor() then
    raise exception using errcode = '42501', message = 'PROVISIONAL_PLAYER_RESTRICTED';
  end if;
end $$;
revoke all on function public.is_provisional_player(uuid), public.is_provisional_actor(),
  public.assert_actor_not_provisional() from public, anon, authenticated;
grant execute on function public.is_provisional_actor() to authenticated;

-- Event participation evidence independent of current membership or openness:
-- any accepted attempt (kept after withdrawal, removal or cancellation), an
-- accepted registration, or a submitted result team containing the user.
create function public.is_match_event_participant(p_event_id uuid, p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_user_id is not null and (
    exists (select 1 from public.match_event_registration_attempts a
      where a.match_event_id = p_event_id and a.user_id = p_user_id and a.outcome = 'accepted')
    or exists (select 1 from public.match_event_registrations r
      where r.match_event_id = p_event_id and r.user_id = p_user_id and r.lifecycle = 'accepted')
    or exists (select 1 from public.match_event_result_proposals p
      join public.match_event_result_proposal_versions v on v.proposal_id = p.id
      where p.match_event_id = p_event_id
        and (v.teams -> 'team_a' ? p_user_id::text or v.teams -> 'team_b' ? p_user_id::text)));
$$;
revoke all on function public.is_match_event_participant(uuid, uuid) from public, anon, authenticated;

-- 4. Provisioning primitives. Internal only: the add command (and its Auth INSERT
-- bridge) composes them inside one transaction after taking the canonical
-- community -> event lock chain. Neither ever overwrites an existing profile.
create function public.initialize_global_player_rating_locked(p_user_id uuid, p_level numeric) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.global_player_ratings
    (user_id, initial_display_level, mu, sigma, display_level,
     reliability_percent, confirmed_competitive_game_groups, highest_display_level,
     rating_engine, rating_engine_version)
    values (p_user_id, p_level, p_level, 1.00, p_level, 10, 0, p_level, 'app-wide-level', '1.0.0');
end $$;

-- Returns true when a provisional profile/rating pair was created, false when the
-- identity already has a player profile (claimed, registered or provisional).
create function public.provision_provisional_player_locked(p_user_id uuid, p_display_name text,
  p_estimated_level numeric, p_invited_by uuid, p_source_match_event_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if p_user_id is null or p_invited_by is null or p_source_match_event_id is null or p_user_id = p_invited_by
    or p_display_name is null or char_length(pg_catalog.btrim(p_display_name, E' \t\n\r\f\v')) not between 1 and 80
    or p_display_name <> pg_catalog.btrim(p_display_name, E' \t\n\r\f\v')
    or p_estimated_level is null or p_estimated_level < 0 or p_estimated_level > 7
    or p_estimated_level * 10 <> pg_catalog.trunc(p_estimated_level * 10) then
    raise exception 'Invalid provisional player input' using errcode = '22023';
  end if;
  if not exists (select 1 from public.player_profiles where user_id = p_invited_by and not is_provisional) then
    raise exception using errcode = '42501', message = 'PROVISIONAL_PLAYER_RESTRICTED';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));
  if exists (select 1 from public.player_profiles where user_id = p_user_id)
    or exists (select 1 from public.global_player_ratings where user_id = p_user_id) then
    if exists (select 1 from public.player_profiles where user_id = p_user_id)
      and exists (select 1 from public.global_player_ratings where user_id = p_user_id) then
      return false;
    end if;
    raise exception 'Incomplete player state' using errcode = '23514';
  end if;
  insert into public.player_profiles (user_id, display_name, preferred_side, is_provisional,
    rating_input_source, estimated_level, invited_by, invited_at, source_match_event_id)
    values (p_user_id, p_display_name, 'EITHER', true, 'creator_estimated', p_estimated_level,
      p_invited_by, pg_catalog.clock_timestamp(), p_source_match_event_id);
  perform public.initialize_global_player_rating_locked(p_user_id, p_estimated_level);
  return true;
end $$;

-- Ensures an active member interval for a provisional player in the target
-- community and returns its id. An existing open active interval is reused; a
-- previously removed membership is never silently reactivated.
create function public.ensure_provisional_community_membership_locked(p_community_id uuid, p_user_id uuid,
  p_added_by uuid, p_source_match_event_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_member public.community_members%rowtype; v_id uuid;
begin
  if p_community_id is null or p_user_id is null or p_added_by is null or p_source_match_event_id is null then
    raise exception 'Invalid provisional membership input' using errcode = '22023';
  end if;
  if not public.is_provisional_player(p_user_id) then
    raise exception using errcode = 'P0001', message = 'PROVISIONAL_PLAYER_REQUIRED';
  end if;
  perform 1 from public.communities c where c.id = p_community_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'PROVISIONAL_MEMBERSHIP_CONFLICT'; end if;
  select * into v_member from public.community_members m
    where m.community_id = p_community_id and m.user_id = p_user_id and m.valid_until is null for update;
  if found then
    if v_member.status = 'active' then return v_member.id; end if;
    raise exception using errcode = 'P0001', message = 'PROVISIONAL_MEMBERSHIP_CONFLICT';
  end if;
  if exists (select 1 from public.community_members m where m.community_id = p_community_id
    and m.user_id = p_user_id and m.activated_at is not null) then
    raise exception using errcode = 'P0001', message = 'PROVISIONAL_MEMBERSHIP_CONFLICT';
  end if;
  insert into public.community_members (community_id, user_id, role, status, added_by, source_match_event_id)
    values (p_community_id, p_user_id, 'member', 'active', p_added_by, p_source_match_event_id)
    returning id into v_id;
  return v_id;
end $$;
revoke all on function public.initialize_global_player_rating_locked(uuid, numeric),
  public.provision_provisional_player_locked(uuid, text, numeric, uuid, uuid),
  public.ensure_provisional_community_membership_locked(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

-- Provisional players never hold management roles: no admin membership and no
-- event ownership transfer to a provisional target.
create function public.guard_provisional_member_role() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.role = 'admin' and public.is_provisional_player(new.user_id) then
    raise exception using errcode = '42501', message = 'PROVISIONAL_PLAYER_RESTRICTED';
  end if;
  return new;
end $$;
create trigger community_member_provisional_role before insert or update on public.community_members
  for each row execute function public.guard_provisional_member_role();
revoke all on function public.guard_provisional_member_role() from public, anon, authenticated;

-- 5. Actor restrictions. A provisional session cannot read or act anywhere until
-- claimed. Restrictive policies cover direct table access; every authenticated
-- SECURITY DEFINER RPC (which bypasses RLS) asserts the actor first.
do $migration$
declare v_table regclass;
begin
  for v_table in
    select c.oid::regclass from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
      and (pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
        or pg_catalog.has_any_column_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE'))
    order by 1
  loop
    execute pg_catalog.format('create policy "provisional actor restricted" on %s as restrictive for all to authenticated
      using (not (select public.is_provisional_actor())) with check (not (select public.is_provisional_actor()))', v_table);
  end loop;
end $migration$;
create policy "provisional actor restricted" on storage.objects as restrictive for all to authenticated
  using (not (select public.is_provisional_actor())) with check (not (select public.is_provisional_actor()));

-- Actor-scoped SQL predicates exclude provisional sessions, so every reader and
-- RLS policy gated on them denies a provisional actor. Target visibility of the
-- provisional player to other readers is unaffected.
create or replace function public.can_read_match_event(p_event_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and coalesce(auth.jwt()->>'is_anonymous','false')<>'true'
    and not public.is_provisional_actor()
    and exists(select 1 from public.match_events e join public.communities c on c.id=e.community_id
      where e.id=p_event_id and (
        e.created_by=auth.uid() or public.is_community_admin(e.community_id)
        or public.is_match_event_participant(e.id,auth.uid())
        or (e.status='cancelled' and (e.cancelled_by=auth.uid()
          or exists(select 1 from public.match_event_invites i where i.match_event_id=e.id and i.invitee_user_id=auth.uid())
          or exists(select 1 from public.match_event_registrations r where r.match_event_id=e.id and r.user_id=auth.uid())))
        or (e.status='open' and (
          (e.visibility='community_open' and (c.visibility='public' or public.is_community_member(e.community_id)))
          or (e.visibility='invite_only' and (
            exists(select 1 from public.match_event_invites i where i.match_event_id=e.id and i.invitee_user_id=auth.uid())
            or exists(select 1 from public.match_event_registrations r where r.match_event_id=e.id and r.user_id=auth.uid() and r.lifecycle='accepted')))))));
$$;

do $migration$
declare v_function regprocedure; v_definition text; v_patched text; v_begin integer;
begin
  foreach v_function in array array['public.is_community_member(uuid)'::regprocedure,
    'public.is_community_admin(uuid)'::regprocedure, 'public.can_read_community(uuid)'::regprocedure] loop
    v_definition := pg_catalog.pg_get_functiondef(v_function);
    v_patched := replace(v_definition, 'select (select auth.uid()) is not null',
      'select (select auth.uid()) is not null and not public.is_provisional_actor()');
    if v_patched = v_definition then raise exception 'Provisional predicate extension failed: %', v_function; end if;
    execute v_patched;
  end loop;

  foreach v_function in array array['public.withdraw_match_registration(uuid,uuid,uuid)'::regprocedure,
    'public.remove_match_registration(uuid,uuid,uuid,text,uuid)'::regprocedure] loop
    v_definition := pg_catalog.pg_get_functiondef(v_function);
    v_patched := replace(v_definition, E'$function$\n  select public.depart_match_registration_locked(',
      E'$function$\n  select public.assert_actor_not_provisional();\n  select public.depart_match_registration_locked(');
    if v_patched = v_definition then raise exception 'Provisional actor guard failed: %', v_function; end if;
    execute v_patched;
  end loop;

  -- Inject the actor assertion as the first statement of every authenticated
  -- PL/pgSQL SECURITY DEFINER entry point (immutable validators excluded).
  for v_function in
    select p.oid::regprocedure from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      join pg_catalog.pg_language l on l.oid = p.prolang
    where n.nspname = 'public' and l.lanname = 'plpgsql' and p.prosecdef and p.provolatile <> 'i'
      and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
      and pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
    order by 1
  loop
    v_definition := pg_catalog.pg_get_functiondef(v_function);
    v_begin := pg_catalog.regexp_instr(v_definition, '\mbegin\M', pg_catalog.strpos(v_definition, '$function$'), 1, 1, 'i');
    if v_begin = 0 then raise exception 'Provisional actor guard failed: %', v_function; end if;
    execute pg_catalog.left(v_definition, v_begin - 1) || ' perform public.assert_actor_not_provisional();'
      || pg_catalog.substr(v_definition, v_begin);
  end loop;

  -- A provisional player can never become event owner.
  v_definition := pg_catalog.pg_get_functiondef('public.transfer_match_event_ownership(uuid,uuid,bigint,uuid)'::regprocedure);
  v_patched := replace(v_definition, 'if p_target_user_id=a or not exists(',
    'if p_target_user_id=a or public.is_provisional_player(p_target_user_id) or not exists(');
  if v_patched = v_definition then raise exception 'Transfer provisional guard failed'; end if;
  execute v_patched;

  -- 6. Read projections carry the provisional badge flag (never email/inviter).
  foreach v_function in array array['public.list_match_event_registrations(uuid)'::regprocedure,
    'public.list_match_event_registration_requests(uuid)'::regprocedure] loop
    v_definition := pg_catalog.pg_get_functiondef(v_function);
    v_patched := replace(v_definition, '''display_name'', p.display_name,',
      '''display_name'', p.display_name, ''is_provisional'', coalesce(p.is_provisional, false),');
    if v_patched = v_definition then raise exception 'Provisional projection failed: %', v_function; end if;
    execute v_patched;
  end loop;
  v_definition := pg_catalog.pg_get_functiondef('public.list_match_event_management_participants(uuid)'::regprocedure);
  v_patched := replace(v_definition, '''display_name'',p.display_name,',
    '''display_name'',p.display_name,''is_provisional'',coalesce(p.is_provisional,false),');
  if v_patched = v_definition then raise exception 'Provisional projection failed: management participants'; end if;
  execute v_patched;
  v_definition := pg_catalog.pg_get_functiondef('public.get_match_event_result_proposals(uuid)'::regprocedure);
  v_patched := replace(v_definition, '''display_name'', profile.display_name)',
    '''display_name'', profile.display_name, ''is_provisional'', coalesce(profile.is_provisional, false))');
  if v_patched = v_definition then raise exception 'Provisional projection failed: result proposals'; end if;
  execute v_patched;
end $migration$;

commit;
