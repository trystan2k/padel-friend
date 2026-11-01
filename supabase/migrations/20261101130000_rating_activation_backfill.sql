begin;

-- PAF-10 / U3: activate rating projection and backfill already-confirmed in-app groups.
--
-- One transaction under the app-wide rating lock: snapshot the eligible confirmed
-- stream, replay it once in (played_at UTC, proposal UUID) order from the ledgered
-- effective starting levels, validate four events per group, then commit activation, the
-- chronological watermark and the revision together with the state rows. A failure
-- (unsupported data, cancelled-event anomaly, inconsistent evidence) aborts the whole
-- upgrade for diagnosis. Re-running is a no-op: nothing is appended and no revision is
-- consumed. Confirmations that arrive meanwhile wait for the lock, then re-read and
-- append or replay. No queue, no browser resubmission.

create function public.activate_global_rating_projection() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_control public.player_rating_projection_control%rowtype;
  v_anomalies bigint; v_revision bigint; v_replay record;
begin
  perform public.lock_global_rating_projection();
  select * into v_control from public.player_rating_projection_control c for update;
  if not found then
    raise exception 'Rating projection control is missing' using errcode = '23514';
  end if;

  -- Result submission is blocked once an event is cancelled and cancellation is blocked
  -- once results exist. A ratable confirmed group on a cancelled event is therefore an
  -- anomaly: fail for diagnosis instead of inventing a rating policy for it.
  select pg_catalog.count(*) into v_anomalies
    from public.rating_projection_eligible_groups() g
    join public.match_events e on e.id = g.match_event_id
   where e.status = 'cancelled';
  if v_anomalies > 0 then
    raise exception 'Rating activation aborted: % ratable confirmed group(s) belong to cancelled events', v_anomalies
      using errcode = '23514';
  end if;

  v_revision := v_control.committed_revision + 1;
  select * into v_replay from public.rating_projection_replay(v_revision);
  update public.player_rating_projection_control set
    activation_enabled = true,
    committed_revision = case when v_replay.o_changed then v_revision else committed_revision end,
    last_processed_played_at = coalesce(v_replay.o_last_played_at, last_processed_played_at),
    last_processed_game_group_id = coalesce(v_replay.o_last_group_id, last_processed_game_group_id)
   where singleton;
  return pg_catalog.jsonb_build_object(
    'groups', coalesce(v_replay.o_groups, 0),
    'changed', coalesce(v_replay.o_changed, false),
    'revision', case when v_replay.o_changed then v_revision else v_control.committed_revision end);
end $$;
revoke all on function public.activate_global_rating_projection()
  from public, anon, authenticated, service_role;

select public.activate_global_rating_projection();

commit;
