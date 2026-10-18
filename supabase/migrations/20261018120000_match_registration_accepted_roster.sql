begin;

-- PAF-5.1 gap: a browser-callable accepted-roster read.
--
-- The accepted roster was previously only reachable through the internal
-- public.match_registration_roster helper (EXECUTE revoked from browser roles)
-- and the caller-scoped public.get_my_match_registration (own row only), so the
-- registration surface could not render the other accepted players. This
-- additive read projects the same single-source ordered roster into one flat,
-- safe jsonb row per accepted player, gated by the event's own readability
-- rule (public.can_read_match_event) so visibility mirrors the event exactly.
--
-- Safety:
--   * only lifecycle = 'accepted' rows (the roster is defined on accepted rows
--     alone); pending / rejected / expired rows are never reachable here;
--   * no resolution metadata (resolved_at / resolved_by) and no user ids: the
--     client matches its own row by the immutable accepted_order;
--   * only the display name / display level are projected from the player
--     profile; global player-profile RLS is not widened.
--
-- Single source of truth: group numbers and reserve positions are derived from
-- public.match_registration_roster (ordered by accepted_order, deterministic id
-- tiebreak) plus public.match_registration_counts, so the cutoff-aware
-- effective status (a due-but-unprocessed event already reads
-- 'reserve_not_playing') and every count stay consistent with the rest of the
-- registration surface. The internal helpers remain revoked.

create or replace function public.list_match_event_registrations(p_match_event_id uuid)
returns setof jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null
    or coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'true' then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;
  -- Event readability gate: an unreadable or hidden event yields no rows
  -- instead of leaking its roster. This mirrors can_read_match_event exactly.
  if not public.can_read_match_event(p_match_event_id) then
    return;
  end if;
  return query
  select jsonb_build_object(
    'display_name', p.display_name,
    'display_level', g.display_level,
    'participation', q.participation_status,
    'group_number', case when q.participation_status = 'playing'
      then ((q.roster_position - 1) / 4) + 1 end,
    'reserve_position', case when q.participation_status <> 'playing'
      then q.roster_position - c.playing_count end,
    'registration_source', r.registration_source,
    'accepted_order', q.accepted_order)
  from public.match_registration_roster(p_match_event_id) q
  join public.match_event_registrations r on r.id = q.registration_id
  cross join lateral public.match_registration_counts(p_match_event_id) c
  left join public.player_profiles p on p.user_id = r.user_id
  left join public.global_player_ratings g on g.user_id = r.user_id
  order by q.accepted_order, q.registration_id;
end $$;

-- ACL: browser-executable for authenticated callers only. The revoke-then-grant
-- pattern strips the default PUBLIC grant so anon can never execute it, while
-- the internal roster / counts helpers stay revoked. Every existing RPC is
-- untouched.
revoke all on function public.list_match_event_registrations(uuid) from public, anon, authenticated;
grant execute on function public.list_match_event_registrations(uuid) to authenticated;

commit;
