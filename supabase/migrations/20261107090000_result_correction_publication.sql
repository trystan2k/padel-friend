begin;

-- T15.4: correction-aware League standings, statistics replacement and the atomic publication
-- of a result repair.
--
-- Contract (docs/plan T15, "Data and authorization contracts" 7-8, algorithm 10-11):
--   * A repair job publishes its derived state inside the SAME transaction and under the locks
--     already held: League counters and (for a closed League) a superseding standings version,
--     the statistics replacement of the corrected group and of every rating-changed fact, the rank
--     refresh, a consistency check, the single committed-revision update, the completion audit and
--     notification and the job's succeeded status. A failure after any step rolls the whole
--     subtransaction back; a retry converges on the same state as a clean run.
--   * Classification is by the prior official base. Every repair job has a previously confirmed
--     base, so its League cause is result_amendment / result_void and it invalidates the replaced
--     sources. A never-confirmed source stays on the finalizer path (late_first_confirmation).
--   * Correction snapshots never mutate earlier ones: a new version links its prior version, the job
--     and the amendment, and carries the canonical fingerprint of the included evidence. They are
--     unique per League + job; a repeat of the same job, or a correction that leaves the included
--     evidence unchanged, appends nothing. The effective period [start_at, closed_at] is untouched:
--     eligibility is the existing predicate, evaluated on the corrected fact's PLAYED time.
--   * Lock order stays community -> source/FK -> League -> global rating -> statistics. The League
--     row is locked before the rating lock; nothing here takes an upstream lock afterwards.

-- 1. Vocabulary and provenance.
alter table public.league_events drop constraint league_events_system_reason_check;
alter table public.league_events add constraint league_events_system_reason_check
  check (system_reason in ('due_start', 'fixed_end_reached', 'expired_before_activation', 'activation_conflict',
    'late_first_confirmation', 'standings_repair', 'standings_reconstruction', 'result_amendment', 'result_void'));

alter table public.league_standings_snapshots
  add column repair_job_id uuid references public.result_repair_jobs(id) on delete restrict,
  add column amendment_id uuid references public.result_amendment_requests(id) on delete restrict,
  add column prior_standings_version integer check (prior_standings_version is null or prior_standings_version >= 1),
  add column source_fingerprint text check (source_fingerprint is null or char_length(source_fingerprint) = 32),
  drop constraint league_standings_snapshots_cause_check,
  add constraint league_standings_snapshots_cause_check
    check (cause in ('closed', 'late_first_confirmation', 'repair', 'reconstruction', 'result_amendment', 'result_void')),
  add constraint league_standings_snapshots_prior_fk foreign key (league_id, prior_standings_version)
    references public.league_standings_snapshots (league_id, standings_version) on delete restrict,
  add constraint league_standings_snapshots_correction_provenance check (
    (cause in ('result_amendment', 'result_void')) = (repair_job_id is not null)
    and (repair_job_id is not null) = (amendment_id is not null)
    and (repair_job_id is not null) = (prior_standings_version is not null)
    and (repair_job_id is not null) = (source_fingerprint is not null)
    and (prior_standings_version is null or prior_standings_version < standings_version));
create unique index league_standings_snapshots_repair_unique
  on public.league_standings_snapshots (league_id, repair_job_id) where repair_job_id is not null;

alter table public.result_repair_attempts add column publication jsonb
  check (publication is null or pg_catalog.jsonb_typeof(publication) = 'object');

-- 2. Canonical fingerprint of the evidence a standings version is built from: confirmation,
-- version, classification, teams, sets, played time (every included group is eligible). Derived
-- from the immutable confirmation/version rows, so it can be recomputed for any earlier snapshot.
create function public.league_snapshot_fingerprint(p_confirmation_ids uuid[]) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.md5(coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'confirmation_id', c.id,
      'proposal_version', c.proposal_version,
      'classification', v.classification::text,
      'teams', v.teams,
      'sets', v.sets,
      'played_at', public.league_utc_text(v.played_at_utc),
      'eligible', true) order by c.id), '[]'::jsonb)::text)
    from public.match_event_result_confirmations c
    join public.match_event_result_proposal_versions v
      on v.proposal_id = c.proposal_id and v.version = c.proposal_version
   where c.id = any (p_confirmation_ids);
$$;

-- Content-only counterpart: the same evidence by Game Group identity (event + group number), without
-- the confirmation identity. A correction that leaves the standings' inputs unchanged is a no-op.
create function public.league_snapshot_content_fingerprint(p_confirmation_ids uuid[]) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.md5(coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'match_event_id', c.match_event_id,
      'group_number', c.group_number,
      'classification', v.classification::text,
      'teams', v.teams,
      'sets', v.sets,
      'played_at', public.league_utc_text(v.played_at_utc)
    ) order by c.match_event_id, c.group_number), '[]'::jsonb)::text)
    from public.match_event_result_confirmations c
    join public.match_event_result_proposal_versions v
      on v.proposal_id = c.proposal_id and v.version = c.proposal_version
   where c.id = any (p_confirmation_ids);
$$;

-- 3. Superseding standings version for one correction job. Caller holds the community lock, the
-- League row lock and the job. Returns the version appended, the version this job already
-- appended (repeat), or null (open League, no final yet, or included evidence unchanged).
create function public.league_publish_correction(p_league_id uuid, p_job_id uuid) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.result_repair_jobs%rowtype;
  a public.result_amendment_requests%rowtype;
  v_league public.leagues%rowtype;
  v_latest public.league_standings_snapshots%rowtype;
  v_eligible uuid[];
  v_fingerprint text;
  v_cause text;
  v_version integer;
begin
  select * into j from public.result_repair_jobs x where x.id = p_job_id;
  select * into a from public.result_amendment_requests r where r.id = j.amendment_id;
  select * into v_league from public.leagues l where l.id = p_league_id;
  if not found or v_league.status <> 'closed' then return null; end if;

  select s.standings_version into v_version from public.league_standings_snapshots s
   where s.league_id = p_league_id and s.repair_job_id = j.id;
  if found then return v_version; end if;

  select * into v_latest from public.league_standings_snapshots s
   where s.league_id = p_league_id order by s.standings_version desc limit 1;
  if not found then return null; end if;

  select coalesce(pg_catalog.array_agg(g.confirmation_id order by g.confirmation_id), '{}'::uuid[])
    into v_eligible from public.league_confirmed_groups(p_league_id) g where g.eligible;
  if public.league_snapshot_content_fingerprint(v_eligible)
    = public.league_snapshot_content_fingerprint(v_latest.included_confirmation_ids) then
    return null;
  end if;
  v_fingerprint := public.league_snapshot_fingerprint(v_eligible);

  v_cause := case j.kind when 'void' then 'result_void' else 'result_amendment' end;
  v_version := v_latest.standings_version + 1;
  insert into public.league_standings_snapshots(
    league_id, community_id, standings_version, cause, basis, minimum_matches_for_final_award,
    period_start_at, effective_end_at, included_confirmation_ids, entries,
    repair_job_id, amendment_id, prior_standings_version, source_fingerprint)
  values (
    p_league_id, v_league.community_id, v_version, v_cause, 'published',
    v_league.minimum_matches_for_final_award, v_league.start_at, v_league.closed_at, v_eligible,
    (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'user_id', k.user_id,
        'display_name', profile.display_name,
        'is_provisional', coalesce(profile.is_provisional, false),
        'position', k.place,
        'matches', k.matches,
        'wins', k.wins,
        'losses', k.losses,
        'draws', k.draws,
        'sets_won', k.sets_won,
        'sets_lost', k.sets_lost,
        'set_differential', k.set_differential,
        'award_eligible', k.award_eligible,
        'matches_remaining', k.matches_remaining
      ) order by k.place, k.user_id), '[]'::jsonb)
       from public.league_rank_counters(
         (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(e)), '[]'::jsonb)
            from public.league_counter_rows_through(p_league_id, null) e),
         v_league.minimum_matches_for_final_award) k
       left join public.player_profiles profile on profile.user_id = k.user_id),
    j.id, a.id, v_latest.standings_version, v_fingerprint);

  insert into public.league_events(league_id, community_id, action, actor_id, system_reason, details)
    values (p_league_id, v_league.community_id, 'standings_revised', a.decision_actor_id,
      case when a.decision_actor_id is null then v_cause end,
      pg_catalog.jsonb_build_object(
        'old_standings_version', v_latest.standings_version,
        'standings_version', v_version,
        'source', a.decision_source,
        'provenance', 'result_correction',
        'effective_cutoff', public.league_utc_text(v_league.closed_at),
        'added_confirmations', (select coalesce(pg_catalog.jsonb_agg(x order by x), '[]'::jsonb)
          from pg_catalog.unnest(v_eligible) x where x <> all (v_latest.included_confirmation_ids)),
        'removed_confirmations', (select coalesce(pg_catalog.jsonb_agg(x order by x), '[]'::jsonb)
          from pg_catalog.unnest(v_latest.included_confirmation_ids) x where x <> all (v_eligible))));
  perform public.statistics_rank_mark_league(p_league_id);
  return v_version;
end $$;

-- 4. League row lock, taken before the rating lock (community -> League -> rating).
create function public.result_repair_lock_league(p_job_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_league_id uuid;
begin
  select e.league_id into v_league_id
    from public.result_repair_jobs j join public.match_events e on e.id = j.match_event_id
   where j.id = p_job_id;
  if v_league_id is not null then
    perform 1 from public.leagues l where l.id = v_league_id for no key update;
  end if;
end $$;

-- 5. The atomic publication seam. Runs under the community, League, rating and statistics locks
-- the repair already holds, after the replay and the committed-revision update, so every reader
-- below resolves the new official state and the new rating revision. Failure raises and rolls the
-- whole repair back.
create or replace function public.result_repair_publish_derived(p_job_id uuid, p_revision bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  j public.result_repair_jobs%rowtype;
  v_event public.match_events%rowtype;
  v_old_standings integer;
  v_new_standings integer;
  v_official_revision bigint;
  v_stats_before bigint;
  v_stats jsonb;
  v_ranks integer;
begin
  select * into j from public.result_repair_jobs x where x.id = p_job_id;
  select * into v_event from public.match_events e where e.id = j.match_event_id;
  select s.official_revision into v_official_revision from public.match_event_result_official_state s
   where s.proposal_id = j.proposal_id;

  -- League: counters follow the canonical source; a closed League gets a superseding final only
  -- when the included evidence changed, an open League simply rebuilds its counters.
  if v_event.league_id is not null then
    select pg_catalog.max(s.standings_version) into v_old_standings
      from public.league_standings_snapshots s where s.league_id = v_event.league_id;
    perform public.league_rebuild_counters_core(v_event.league_id);
    v_new_standings := public.league_publish_correction(v_event.league_id, j.id);
  end if;

  -- Statistics: replace the corrected group's facts (old and new dimensions), refresh every fact
  -- whose rating changed in the replay (any community), then ranks and consistency.
  perform public.statistics_lock();
  select k.revision into v_stats_before from public.statistics_projection_control k where k.singleton;
  perform public.statistics_project_source(array[j.proposal_id]);
  v_stats := public.statistics_publish();
  v_ranks := public.statistics_rank_refresh();
  perform public.statistics_assert_consistent(v_event.community_id);

  update public.result_repair_attempts a
     set publication = pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
       'league_id', v_event.league_id,
       'old_standings_version', v_old_standings,
       'new_standings_version', v_new_standings,
       'old_official_revision', v_official_revision - 1,
       'new_official_revision', v_official_revision,
       'rating_revision', p_revision,
       'old_statistics_revision', v_stats_before,
       'new_statistics_revision', (v_stats ->> 'revision')::bigint,
       'rank_rows_changed', v_ranks))
   where a.job_id = j.id and a.attempt_number = j.attempt_count and a.status = 'running';
end $$;

-- 6. Fenced execution with the real publication. Same contract as before: one exception
-- subtransaction for all sporting work, outer failed receipt on any error. The League row lock is
-- taken before the rating lock, and the single committed-revision update precedes the dependent
-- publishers (they read the new revision) inside the same subtransaction.
create or replace function public.execute_result_repair(p_job_id uuid, p_fence_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  j public.result_repair_jobs%rowtype;
  v_attempt public.result_repair_attempts%rowtype;
  v_started timestamptz := pg_catalog.clock_timestamp();
  v_stage text := 'base';
  v_base bigint; v_rev bigint; v_control public.player_rating_projection_control%rowtype;
  v_replay record; v_context jsonb; v_events integer; v_sources integer;
  v_message text; v_code text; v_failed boolean := false;
  v_publication jsonb; v_base_version bigint; v_key text;
  c_max_automatic constant integer := 5;
begin
  select * into j from public.result_repair_jobs x where x.id = p_job_id for update;
  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'not_found');
  end if;
  if j.status <> 'running' or j.lease_token is distinct from p_fence_token then
    return pg_catalog.jsonb_build_object('outcome', 'stale', 'job', public.result_repair_job_dto(j));
  end if;
  select * into v_attempt from public.result_repair_attempts a
   where a.job_id = j.id and a.attempt_number = j.attempt_count and a.fence_token = p_fence_token
     and a.status = 'running' for update;
  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'stale', 'job', public.result_repair_job_dto(j));
  end if;

  begin
    perform public.result_repair_prepare_locked(j.id);
    v_stage := 'lock';
    perform public.result_repair_lock_league(j.id);
    perform public.rating_projection_lock_covered();
    select * into v_control from public.player_rating_projection_control c for update;
    v_base := v_control.committed_revision;
    v_rev := v_base + 1;
    v_context := pg_catalog.jsonb_build_object('repair_job_id', j.id, 'amendment_id', j.amendment_id,
      'engine', j.frozen_rating_engine, 'engine_version', j.frozen_rating_engine_version,
      'config_version', j.frozen_rating_config_version);
    v_stage := 'fact';
    perform public.result_repair_apply_fact_locked(j.id, v_rev);
    v_stage := 'replay';
    select * into v_replay from public.rating_projection_replay(v_rev, v_context);
    v_stage := 'publish';
    update public.player_rating_projection_control c set committed_revision = v_rev,
        last_processed_played_at = coalesce(v_replay.o_last_played_at, c.last_processed_played_at),
        last_processed_game_group_id = coalesce(v_replay.o_last_group_id, c.last_processed_game_group_id)
      where c.singleton and c.committed_revision = v_base;
    if not found then
      raise exception using errcode = 'P0001', message = 'REPAIR_REVISION_CONFLICT';
    end if;
    perform public.result_repair_publish_derived(j.id, v_rev);
    v_stage := 'complete';
    select pg_catalog.count(*) into v_events from public.player_rating_events;
    select pg_catalog.count(*) into v_sources from public.player_rating_event_sources;
    update public.result_amendment_requests r set lifecycle = 'applied', closed_at = pg_catalog.clock_timestamp()
      where r.id = j.amendment_id and r.lifecycle = 'approved_pending_repair';
    update public.result_repair_jobs x set status = 'succeeded', lease_token = null, lease_expires_at = null,
        failure_code = null, failure_stage = null, next_attempt_at = null,
        finished_at = pg_catalog.clock_timestamp(), committed_revision = v_rev
      where x.id = j.id returning * into j;
    update public.result_repair_attempts a set status = 'succeeded', base_revision = v_base,
        result_revision = v_rev, stage = 'complete', groups_replayed = v_replay.o_groups,
        events_total = v_events, sources_total = v_sources, finished_at = pg_catalog.clock_timestamp(),
        duration_ms = (extract(epoch from (pg_catalog.clock_timestamp() - v_started)) * 1000)::integer
      where a.id = v_attempt.id returning a.publication into v_publication;
    perform public.record_result_amendment_event(
      (select r from public.result_amendment_requests r where r.id = j.amendment_id),
      'applied', 'approved_pending_repair', 'applied', null, j.candidate_version, null,
      pg_catalog.jsonb_build_object('repair_job_id', j.id, 'kind', j.kind, 'revision', v_rev)
        || coalesce(v_publication, '{}'::jsonb),
      null, pg_catalog.clock_timestamp());
    -- One notice per recipient and job: the new fact's players and creator through the lifecycle
    -- notifier, plus players only the replaced fact named (their link keeps the version they played).
    select r.base_version into v_base_version from public.result_amendment_requests r where r.id = j.amendment_id;
    v_key := 'result.repair_applied:' || j.id::text;
    perform public.notify_match_result_lifecycle(j.proposal_id, j.candidate_version, v_key, 'result_repair_applied');
    perform public.persist_match_result_notification(
        r.user_id, v_key, 'result_repair_applied', j.match_event_id, j.community_id, j.proposal_id, v_base_version)
      from (select distinct u.value::uuid as user_id
              from public.match_event_result_proposal_versions v
              cross join lateral pg_catalog.jsonb_array_elements_text((v.teams -> 'team_a') || (v.teams -> 'team_b')) u(value)
             where v.proposal_id = j.proposal_id and v.version = v_base_version) r
     where r.user_id <> all (
       select u.value::uuid
         from public.match_event_result_proposal_versions c
         cross join lateral pg_catalog.jsonb_array_elements_text((c.teams -> 'team_a') || (c.teams -> 'team_b')) u(value)
        where c.proposal_id = j.proposal_id and c.version = j.candidate_version);
  exception when others then
    get stacked diagnostics v_message = message_text;
    v_failed := true;
  end;

  if v_failed then
    v_code := public.result_repair_failure_code(v_stage, v_message);
    update public.result_repair_attempts a set status = 'failed', failure_code = v_code, stage = v_stage,
        finished_at = pg_catalog.clock_timestamp(),
        duration_ms = (extract(epoch from (pg_catalog.clock_timestamp() - v_started)) * 1000)::integer
      where a.id = v_attempt.id;
    update public.result_repair_jobs x set status = 'failed', lease_token = null, lease_expires_at = null,
        failure_code = v_code, failure_stage = v_stage, finished_at = pg_catalog.clock_timestamp(),
        next_attempt_at = case when public.result_repair_retryable(v_code) and x.attempt_count < c_max_automatic
          then pg_catalog.clock_timestamp() + public.result_repair_backoff(x.attempt_count) end
      where x.id = j.id returning * into j;
    perform public.record_result_repair_audit(j, 'result_repair_failed', null,
      pg_catalog.jsonb_build_object('failure_code', v_code, 'failure_stage', v_stage));
    return pg_catalog.jsonb_build_object('outcome', 'failed', 'failure_code', v_code,
      'failure_stage', v_stage, 'job', public.result_repair_job_dto(j));
  end if;
  return pg_catalog.jsonb_build_object('outcome', 'succeeded', 'revision', v_rev,
    'job', public.result_repair_job_dto(j));
end $$;

-- 7. The completion audit carries the old and new revisions the publication moved between.
do $patch$
declare
  v_original text;
  v_needle constant text := E'''repair_kind'', p_data ->> ''kind'')),';
begin
  v_original := pg_get_functiondef(
    'public.record_result_amendment_event(public.result_amendment_requests,text,text,text,uuid,bigint,text,jsonb,uuid,timestamp with time zone)'::regprocedure);
  if (length(v_original) - length(replace(v_original, v_needle, ''))) <> length(v_needle) then
    raise exception 'Unexpected record_result_amendment_event definition; refusing to patch';
  end if;
  execute replace(v_original, v_needle,
    E'''repair_kind'', p_data ->> ''kind'',\n'
    || E'      ''old_standings_version'', p_data -> ''old_standings_version'',\n'
    || E'      ''new_standings_version'', p_data -> ''new_standings_version'',\n'
    || E'      ''old_official_revision'', p_data -> ''old_official_revision'',\n'
    || E'      ''new_official_revision'', p_data -> ''new_official_revision'',\n'
    || E'      ''rating_revision'', p_data -> ''rating_revision'',\n'
    || E'      ''old_statistics_revision'', p_data -> ''old_statistics_revision'',\n'
    || E'      ''new_statistics_revision'', p_data -> ''new_statistics_revision'')),');
end $patch$;

-- 8. The completion notice resolves through the existing result context reader.
do $patch$
declare
  v_original text;
  v_needle constant text := E'''result_amendment_resolved'', ''result_repair_queued'')';
begin
  v_original := pg_get_functiondef('public.get_my_result_notification_contexts(uuid[])'::regprocedure);
  if (length(v_original) - length(replace(v_original, v_needle, ''))) <> length(v_needle) then
    raise exception 'Unexpected get_my_result_notification_contexts definition; refusing to patch';
  end if;
  execute replace(v_original, v_needle,
    E'''result_amendment_resolved'', ''result_repair_queued'', ''result_repair_applied'')');
end $patch$;

revoke all on function public.league_snapshot_fingerprint(uuid[]), public.league_snapshot_content_fingerprint(uuid[]),
  public.league_publish_correction(uuid, uuid),
  public.result_repair_lock_league(uuid), public.result_repair_publish_derived(uuid, bigint),
  public.execute_result_repair(uuid, uuid)
  from public, anon, authenticated, service_role;

commit;
