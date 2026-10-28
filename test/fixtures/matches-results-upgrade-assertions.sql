do $paf_result_assertions$
declare
  v_status text;
  v_active_version bigint;
  v_pointer_submitter uuid;
  v_pointer_submitted_at timestamptz;
  v_pointer_deadline timestamptz;
  v_version_submitter uuid;
  v_version_submitted_at timestamptz;
  v_version_deadline timestamptz;
  v_teams jsonb;
  v_sets jsonb;
  v_classification text;
  v_played_at_utc timestamptz;
  v_played_at_local timestamp;
  v_played_at_offset integer;
  v_court_label text;
  v_proposal_id uuid := '60000000-0000-4000-8000-000000000011';
begin
  execute $ddl$
    create or replace function public.paf_result_upgrade_snapshot()
    returns jsonb language sql stable set search_path = '' as $snapshot$
      select jsonb_build_object(
        'proposal', (
          select to_jsonb(p) from public.match_event_result_proposals p
           where p.id = '60000000-0000-4000-8000-000000000011'
        ),
        'version', (
          select to_jsonb(v) from public.match_event_result_proposal_versions v
           where v.proposal_id = '60000000-0000-4000-8000-000000000011' and v.version = 1
        )
      );
    $snapshot$;
  $ddl$;
  execute $ddl$
    create table if not exists public.paf_result_upgrade_snapshot_before (
      singleton boolean primary key default true check (singleton),
      snapshot jsonb not null
    );
  $ddl$;
  execute 'insert into public.paf_result_upgrade_snapshot_before (singleton, snapshot)
    values (true, public.paf_result_upgrade_snapshot()) on conflict (singleton) do nothing';
  execute $ddl$
    create or replace function public.paf_result_upgrade_assert_snapshot()
    returns void language plpgsql set search_path = '' as $assert$
    declare
      v_before jsonb;
      v_after jsonb;
    begin
      select snapshot into strict v_before
        from public.paf_result_upgrade_snapshot_before where singleton;
      v_after := public.paf_result_upgrade_snapshot();
      if v_before is distinct from v_after then
        raise exception 'Repeated result-contract migration up changed the populated v1 proposal';
      end if;
    end;
    $assert$;
  $ddl$;

  select p.status, p.active_version, p.submitted_by, p.submitted_at, p.review_deadline_at,
         v.submitted_by, v.submitted_at, v.review_deadline_at, v.teams, v.sets,
         v.classification, v.played_at_utc, v.played_at_local,
         v.played_at_offset_seconds, v.court_label
    into v_status, v_active_version, v_pointer_submitter, v_pointer_submitted_at,
         v_pointer_deadline, v_version_submitter, v_version_submitted_at,
         v_version_deadline, v_teams, v_sets, v_classification,
         v_played_at_utc, v_played_at_local, v_played_at_offset, v_court_label
    from public.match_event_result_proposals p
    join public.match_event_result_proposal_versions v
      on v.proposal_id = p.id and v.version = p.active_version
   where p.id = v_proposal_id;

  if not found
    or v_status <> 'pending'
    or v_active_version <> 1
    or v_pointer_submitter <> '10000000-0000-4000-8000-000000000011'
    or v_pointer_submitted_at <> '2026-10-27 09:15:00+00'::timestamptz
    or v_pointer_deadline <> '2026-10-29 09:15:00+00'::timestamptz
    or v_version_submitter is distinct from v_pointer_submitter
    or v_version_submitted_at is distinct from v_pointer_submitted_at
    or v_version_deadline is distinct from v_pointer_deadline
    or v_version_deadline <> v_version_submitted_at + interval '48 hours'
    or v_teams is distinct from '{"team_a":["10000000-0000-4000-8000-000000000011","10000000-0000-4000-8000-000000000012"],"team_b":["10000000-0000-4000-8000-000000000013","10000000-0000-4000-8000-000000000014"]}'::jsonb
    or v_sets is distinct from '[{"position":1,"team_a_games":6,"team_b_games":4,"completed":true}]'::jsonb
    or v_classification <> 'team_a'
    or v_played_at_utc <> '2026-10-20 18:30:00+00'::timestamptz
    or v_played_at_local <> '2026-10-20 18:30:00'::timestamp
    or v_played_at_offset <> 0
    or v_court_label <> 'Result Court 2' then
    raise exception 'Populated PAF-7 v1 facts or provenance backfill changed';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger t
     where t.tgrelid = 'public.match_event_result_proposal_versions'::regclass
       and t.tgname = 'match_result_proposal_version_immutable'
       and not t.tgisinternal and t.tgenabled <> 'D'
  ) then
    raise exception 'Immutable v1 version guard was not restored after provenance backfill';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint c
     where c.conrelid = 'public.match_event_result_proposals'::regclass
       and c.conname = 'match_result_proposal_active_version_fk'
       and c.condeferrable and c.condeferred
  ) then
    raise exception 'Deferred active-version pointer constraint missing';
  end if;
  if position(
    'proposal.submitted_by,proposal.submitted_at,proposal.review_deadline_at'
    in pg_get_functiondef(
      'public.submit_match_event_result(uuid,bigint,jsonb,jsonb,jsonb,text,uuid)'::regprocedure
    )
  ) = 0 then
    raise exception 'Submission RPC does not populate immutable v1 provenance';
  end if;

  begin
    update public.match_event_result_proposal_versions
       set classification = 'draw'
     where proposal_id = v_proposal_id and version = 1;
    raise exception 'Immutable v1 fact guard accepted an update';
  exception when check_violation then
    null;
  end;

  perform public.paf_result_upgrade_assert_snapshot();
  raise notice 'PASS: populated PAF-7 v1 provenance and immutable facts survive T08.1 migration';
end;
$paf_result_assertions$;
