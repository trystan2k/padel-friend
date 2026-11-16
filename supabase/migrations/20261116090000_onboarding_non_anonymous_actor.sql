-- PAF-197: reject authenticated-role anonymous JWT claims at the database boundary.
-- Forward-only body replacement of the latest effective public.onboard_player
-- (20261101100000_global_rating_ledger.sql). Only the actor guard changes: the existing
-- no-UID rejection also rejects anonymous claims, reusing the 28000 / 'Authentication
-- required' contract, ahead of validation, the advisory lock, writes and replay handling.
-- public.onboard_player_with_availability delegates to this function and inherits the guard.
-- CREATE OR REPLACE preserves the existing grants and SECURITY DEFINER / empty search_path.
begin;

create or replace function public.onboard_player(p_display_name text, p_preferred_side text, p_initial_level numeric,
  p_dominant_hand text default null, p_bio text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid := (select auth.uid());
begin perform public.assert_actor_not_provisional();
  if v_user_id is null or coalesce(auth.jwt() ->> 'is_anonymous', 'false') = 'true' then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_display_name is null or char_length(pg_catalog.btrim(p_display_name, E' \t\n\r\f\v')) not between 1 and 80
    or p_display_name <> pg_catalog.btrim(p_display_name, E' \t\n\r\f\v')
    or p_preferred_side is null or p_preferred_side not in ('LEFT','RIGHT','EITHER')
    or (p_dominant_hand is not null and p_dominant_hand not in ('LEFT','RIGHT'))
    or (p_bio is not null and char_length(p_bio) > 280)
    or p_initial_level is null or p_initial_level < 0 or p_initial_level > 7
    or p_initial_level * 10 <> pg_catalog.trunc(p_initial_level * 10) then
    raise exception 'Invalid onboarding input' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 0));
  if exists (select 1 from public.player_profiles where user_id = v_user_id)
    or exists (select 1 from public.global_player_ratings where user_id = v_user_id) then
    if exists (select 1 from public.player_profiles where user_id = v_user_id)
      and exists (select 1 from public.global_player_ratings where user_id = v_user_id) then
      return;
    end if;
    raise exception 'Incomplete player state' using errcode = '23514';
  end if;
  insert into public.player_profiles (user_id, display_name, preferred_side, dominant_hand, bio)
    values (v_user_id, p_display_name, p_preferred_side, p_dominant_hand, p_bio);
  perform public.initialize_global_player_rating_locked(v_user_id, p_initial_level, 'onboarding');
end;
$$;

commit;
