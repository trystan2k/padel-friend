-- PAF-25 Unit 2: optional player availability (playing days + time-of-day buckets).
-- Additive and owner-only: no policy changes. Existing owner SELECT/UPDATE policies keep
-- governing the new columns; only the column-level UPDATE grant is extended.
begin;

alter table public.player_profiles
  add column preferred_playing_days text[],
  add column preferred_playing_times text[];

-- NULL or empty array = not provided. Otherwise a one-dimensional subset of the allowed
-- values without NULL elements. Every operand below is non-NULL for a non-NULL array and
-- the whole expression is wrapped in coalesce so SQL three-valued logic can never let an
-- invalid shape pass the CHECK.
alter table public.player_profiles
  add constraint player_profiles_preferred_playing_days_valid check (
    preferred_playing_days is null
    or coalesce(
      pg_catalog.cardinality(preferred_playing_days) <= 7
      and (pg_catalog.cardinality(preferred_playing_days) = 0
        or pg_catalog.array_ndims(preferred_playing_days) = 1)
      and pg_catalog.array_position(preferred_playing_days, null::text) is null
      and preferred_playing_days <@ array['MON','TUE','WED','THU','FRI','SAT','SUN']::text[],
      false)
  ),
  add constraint player_profiles_preferred_playing_times_valid check (
    preferred_playing_times is null
    or coalesce(
      pg_catalog.cardinality(preferred_playing_times) <= 3
      and (pg_catalog.cardinality(preferred_playing_times) = 0
        or pg_catalog.array_ndims(preferred_playing_times) = 1)
      and pg_catalog.array_position(preferred_playing_times, null::text) is null
      and preferred_playing_times <@ array['MORNING','AFTERNOON','EVENING']::text[],
      false)
  );

grant update (preferred_playing_days, preferred_playing_times)
  on public.player_profiles to authenticated;

-- Atomic create/claim + availability. Thin SECURITY INVOKER wrappers: the original
-- authoritative RPCs run unchanged (rating locks, claim lock ordering, password
-- continuity, audit); availability is written afterwards in the same transaction, so a
-- constraint failure rolls the whole create/claim back.
create function public.onboard_player_with_availability(
  p_display_name text, p_preferred_side text, p_initial_level numeric,
  p_dominant_hand text default null, p_bio text default null,
  p_preferred_playing_days text[] default null, p_preferred_playing_times text[] default null)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_existed boolean;
  v_rows integer;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  -- Same per-user transaction lock as the original RPC, so the exists-check below and
  -- the original's own check observe one consistent state.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text, 0));
  v_existed := exists (select 1 from public.player_profiles p where p.user_id = v_uid);
  perform public.onboard_player(p_display_name, p_preferred_side, p_initial_level,
    p_dominant_hand, p_bio);
  -- Replay of an already-onboarded player never overwrites saved availability.
  if not v_existed and (p_preferred_playing_days is not null or p_preferred_playing_times is not null) then
    update public.player_profiles p
      set preferred_playing_days = nullif(p_preferred_playing_days, '{}'::text[]),
        preferred_playing_times = nullif(p_preferred_playing_times, '{}'::text[])
      where p.user_id = v_uid;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'Incomplete player state' using errcode = '23514';
    end if;
  end if;
end;
$$;
revoke all on function public.onboard_player_with_availability(text, text, numeric, text, text, text[], text[])
  from public, anon, authenticated, service_role;
grant execute on function public.onboard_player_with_availability(text, text, numeric, text, text, text[], text[])
  to authenticated;

create function public.claim_provisional_player_with_availability(
  p_display_name text, p_preferred_side text, p_initial_level numeric,
  p_dominant_hand text default null, p_bio text default null,
  p_preferred_playing_days text[] default null, p_preferred_playing_times text[] default null)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_rows integer;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  perform public.claim_provisional_player(p_display_name, p_preferred_side, p_initial_level,
    p_dominant_hand, p_bio);
  if p_preferred_playing_days is not null or p_preferred_playing_times is not null then
    update public.player_profiles p
      set preferred_playing_days = nullif(p_preferred_playing_days, '{}'::text[]),
        preferred_playing_times = nullif(p_preferred_playing_times, '{}'::text[])
      where p.user_id = v_uid and not p.is_provisional;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'Incomplete player state' using errcode = '23514';
    end if;
  end if;
end;
$$;
revoke all on function public.claim_provisional_player_with_availability(text, text, numeric, text, text, text[], text[])
  from public, anon, authenticated, service_role;
grant execute on function public.claim_provisional_player_with_availability(text, text, numeric, text, text, text[], text[])
  to authenticated;

commit;
