begin;

-- PAF-12 / U1: rebuildable League counters materialized from confirmed Ranked facts.
--
-- Contract (docs/plan/Plan PAF-12 T12, "Shared DB and API contracts", U1):
--   * One canonical fact-to-counter source: league_confirmed_groups() joins the League's explicitly
--     bound Competitive events to their immutable official confirmations and exact proposal
--     versions, and flags each group with the shared all-four historical eligibility
--     (match_result_ranked_ineligibility). league_counter_rows() aggregates only eligible groups.
--     Both read committed immutable facts and membership intervals; neither reads any rating,
--     level, reliability or delta, so counters can be neither seeded from nor ordered by skill.
--   * league_player_counters stores EARNED rows only (open active members stay a zero overlay in
--     the readers); leaving never deletes earned rows. league_projection_confirmations are
--     immutable, unique-per-confirmation receipts of what a materialization run applied.
--   * project_league_confirmation() runs inside the shared result finalizer (first confirmation and
--     confirmed replay) BEFORE the unchanged global rating projector. It rebuilds the one affected
--     League under the community lock the finalizer already holds (community -> League). It never
--     takes the global rating lock, and the rating projector never calls back into Leagues.
--   * rebuild_league_counters() is the internal, same-input-idempotent repair path (also used by
--     the backfill below). Trusted retroactive membership changes need an explicit rebuild.
--   * get_league_counters keeps its payload and stays a read-only STABLE oracle over the canonical
--     source (it is deliberately not the materialized table).

create index if not exists match_event_result_confirmations_event
  on public.match_event_result_confirmations (match_event_id);

create table public.league_player_counters (
  league_id uuid not null,
  community_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  matches integer not null default 0 check (matches >= 0),
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  draws integer not null default 0 check (draws >= 0),
  sets_won integer not null default 0 check (sets_won >= 0),
  sets_lost integer not null default 0 check (sets_lost >= 0),
  set_differential integer generated always as (sets_won - sets_lost) stored,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (league_id, user_id),
  constraint league_player_counters_league_fk foreign key (league_id, community_id)
    references public.leagues (id, community_id) on delete cascade,
  constraint league_player_counters_matches_sum check (matches = wins + losses + draws)
);

create table public.league_projection_confirmations (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null,
  community_id uuid not null,
  confirmation_id uuid not null references public.match_event_result_confirmations(id) on delete restrict,
  proposal_id uuid not null,
  proposal_version bigint not null,
  match_event_id uuid not null,
  group_number bigint not null,
  source_confirmed_at timestamptz not null,
  projected_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint league_projection_confirmations_league_fk foreign key (league_id, community_id)
    references public.leagues (id, community_id) on delete restrict,
  constraint league_projection_confirmations_unique unique (league_id, confirmation_id)
);
create index league_projection_confirmations_event
  on public.league_projection_confirmations (match_event_id);

create function public.guard_league_projection_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '23514', message = 'LEAGUE_PROJECTION_IMMUTABLE';
end $$;
create trigger league_projection_confirmations_immutable
  before update or delete on public.league_projection_confirmations
  for each row execute function public.guard_league_projection_immutable();

alter table public.league_player_counters enable row level security;
alter table public.league_projection_confirmations enable row level security;
revoke all on public.league_player_counters, public.league_projection_confirmations
  from public, anon, authenticated, service_role;

-- Every official confirmation of a ratable Competitive group of an event bound to the League,
-- with the shared all-four historical eligibility verdict. Incomplete groups never qualify.
create function public.league_confirmed_groups(p_league_id uuid)
returns table (
  confirmation_id uuid,
  proposal_id uuid,
  proposal_version bigint,
  match_event_id uuid,
  group_number bigint,
  teams jsonb,
  sets jsonb,
  classification text,
  played_at_utc timestamptz,
  confirmed_at timestamptz,
  eligible boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.proposal_id, c.proposal_version, c.match_event_id, c.group_number,
      v.teams, v.sets, v.classification::text, v.played_at_utc, c.confirmed_at,
      public.match_result_ranked_ineligibility(
        c.match_event_id, public.match_result_fact_quartet(v.teams), v.played_at_utc) is null
    from public.match_events e
    join public.match_event_result_confirmations c
      on c.match_event_id = e.id and c.ratable_eligible
    join public.match_event_result_proposal_versions v
      on v.proposal_id = c.proposal_id and v.version = c.proposal_version
   where e.league_id = p_league_id and e.event_type = 'competitive'
     and v.classification <> 'incomplete';
$$;

-- Per-player counters over the eligible groups only: Win/Loss per side, a Draw adds only Match and
-- Draw, completed sets only.
create function public.league_counter_rows(p_league_id uuid)
returns table (
  user_id uuid,
  matches integer,
  wins integer,
  losses integer,
  draws integer,
  sets_won integer,
  sets_lost integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with lines as (
    select u.value::uuid as user_id, s.side, g.classification, g.sets
      from public.league_confirmed_groups(p_league_id) g
      cross join lateral (values ('team_a'), ('team_b')) s(side)
      cross join lateral pg_catalog.jsonb_array_elements_text(g.teams -> s.side) u(value)
     where g.eligible
  )
  select l.user_id,
      pg_catalog.count(*)::integer,
      (pg_catalog.count(*) filter (where l.classification = l.side))::integer,
      (pg_catalog.count(*) filter (where l.classification <> l.side and l.classification <> 'draw'))::integer,
      (pg_catalog.count(*) filter (where l.classification = 'draw'))::integer,
      coalesce(pg_catalog.sum(sc.won), 0)::integer,
      coalesce(pg_catalog.sum(sc.lost), 0)::integer
    from lines l
    cross join lateral (
      select
        pg_catalog.count(*) filter (where (x ->> 'completed')::boolean
          and (case when l.side = 'team_a' then (x ->> 'team_a_games')::integer > (x ->> 'team_b_games')::integer
                    else (x ->> 'team_b_games')::integer > (x ->> 'team_a_games')::integer end)) as won,
        pg_catalog.count(*) filter (where (x ->> 'completed')::boolean
          and (case when l.side = 'team_a' then (x ->> 'team_b_games')::integer > (x ->> 'team_a_games')::integer
                    else (x ->> 'team_a_games')::integer > (x ->> 'team_b_games')::integer end)) as lost
      from pg_catalog.jsonb_array_elements(l.sets) x
    ) sc
   group by l.user_id;
$$;

-- Rebuilds one League's earned counters and receipts from the canonical source. Idempotent for
-- identical input: unchanged rows are not rewritten and existing receipts are kept.
create function public.rebuild_league_counters(p_league_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_community uuid;
  v_removed integer;
  v_upserted integer;
  v_receipts integer;
begin
  select l.community_id into v_community from public.leagues l where l.id = p_league_id;
  if v_community is null then
    raise exception using errcode = 'P0002', message = 'LEAGUE_NOT_FOUND';
  end if;
  -- Community first (every League and result command serializes here), then the League row.
  perform 1 from public.communities c where c.id = v_community for update;
  perform 1 from public.leagues l where l.id = p_league_id for no key update;

  delete from public.league_player_counters c
   where c.league_id = p_league_id
     and not exists (select 1 from public.league_counter_rows(p_league_id) t where t.user_id = c.user_id);
  get diagnostics v_removed = row_count;

  insert into public.league_player_counters as c(
    league_id, community_id, user_id, matches, wins, losses, draws, sets_won, sets_lost)
    select p_league_id, v_community, t.user_id, t.matches, t.wins, t.losses, t.draws, t.sets_won, t.sets_lost
      from public.league_counter_rows(p_league_id) t
  on conflict (league_id, user_id) do update
     set matches = excluded.matches, wins = excluded.wins, losses = excluded.losses,
         draws = excluded.draws, sets_won = excluded.sets_won, sets_lost = excluded.sets_lost,
         updated_at = pg_catalog.clock_timestamp()
   where (c.matches, c.wins, c.losses, c.draws, c.sets_won, c.sets_lost)
     is distinct from (excluded.matches, excluded.wins, excluded.losses, excluded.draws, excluded.sets_won, excluded.sets_lost);
  get diagnostics v_upserted = row_count;

  insert into public.league_projection_confirmations(
    league_id, community_id, confirmation_id, proposal_id, proposal_version, match_event_id,
    group_number, source_confirmed_at)
    select p_league_id, v_community, g.confirmation_id, g.proposal_id, g.proposal_version,
        g.match_event_id, g.group_number, g.confirmed_at
      from public.league_confirmed_groups(p_league_id) g
     where g.eligible
  on conflict (league_id, confirmation_id) do nothing;
  get diagnostics v_receipts = row_count;

  return pg_catalog.jsonb_build_object(
    'league_id', p_league_id,
    'counters_removed', v_removed,
    'counters_changed', v_upserted,
    'receipts_added', v_receipts);
end $$;

-- Finalizer hook: applies one official confirmation to its bound League. Returns true when the
-- League was (re)materialized for it. A receipt means it was already applied (pure retry).
create function public.project_league_confirmation(p_confirmation_id uuid) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_confirmation public.match_event_result_confirmations%rowtype;
  v_league_id uuid;
  v_fact public.match_event_result_proposal_versions%rowtype;
begin
  select * into v_confirmation from public.match_event_result_confirmations c where c.id = p_confirmation_id;
  if not found or not v_confirmation.ratable_eligible or v_confirmation.event_type <> 'competitive' then
    return false;
  end if;
  select e.league_id into v_league_id from public.match_events e where e.id = v_confirmation.match_event_id;
  if v_league_id is null then return false; end if;
  if exists (
    select 1 from public.league_projection_confirmations r
     where r.league_id = v_league_id and r.confirmation_id = p_confirmation_id
  ) then return false; end if;

  select * into v_fact from public.match_event_result_proposal_versions v
   where v.proposal_id = v_confirmation.proposal_id and v.version = v_confirmation.proposal_version;
  if not found or v_fact.classification = 'incomplete'
    or public.match_result_ranked_ineligibility(
      v_confirmation.match_event_id, public.match_result_fact_quartet(v_fact.teams), v_fact.played_at_utc) is not null
  then return false; end if;

  perform public.rebuild_league_counters(v_league_id);
  return true;
end $$;

revoke all on function public.guard_league_projection_immutable(),
  public.league_confirmed_groups(uuid), public.league_counter_rows(uuid),
  public.rebuild_league_counters(uuid), public.project_league_confirmation(uuid)
  from public, anon, authenticated, service_role;

-- Reader keeps its T11 payload; aggregation now comes from the shared canonical source.
create or replace function public.get_league_counters(p_league_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_league public.leagues;
  v_participants jsonb;
  v_excluded integer;
begin
  if (select auth.uid()) is null or coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'true' then
    raise exception using errcode = '28000', message = 'UNAUTHENTICATED';
  end if;
  perform public.assert_actor_not_provisional();
  select * into v_league from public.leagues l where l.id = p_league_id;
  -- Unknown and unreadable Leagues fail identically.
  if not found or not public.is_community_member(v_league.community_id) then
    raise exception using errcode = 'P0002', message = 'LEAGUE_NOT_FOUND';
  end if;

  with earned as (
    select * from public.league_counter_rows(p_league_id)
  ), roster as (
    select e.user_id from earned e
    union
    select m.user_id from public.community_members m
     where v_league.status <> 'closed'
       and m.community_id = v_league.community_id and m.status = 'active'
       and m.valid_until is null and m.activated_at is not null
  )
  select
    coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'user_id', r.user_id,
      'display_name', profile.display_name,
      'is_provisional', coalesce(profile.is_provisional, false),
      'matches', coalesce(e.matches, 0),
      'wins', coalesce(e.wins, 0),
      'losses', coalesce(e.losses, 0),
      'draws', coalesce(e.draws, 0),
      'sets_won', coalesce(e.sets_won, 0),
      'sets_lost', coalesce(e.sets_lost, 0),
      'set_differential', coalesce(e.sets_won, 0) - coalesce(e.sets_lost, 0)
    ) order by lower(profile.display_name), r.user_id), '[]'::jsonb),
    (select pg_catalog.count(*)::integer from public.league_confirmed_groups(p_league_id) g where not g.eligible)
  into v_participants, v_excluded
  from roster r
  left join earned e on e.user_id = r.user_id
  left join public.player_profiles profile on profile.user_id = r.user_id;

  return pg_catalog.jsonb_build_object(
    'league_id', v_league.id,
    'participants', v_participants,
    'excluded_group_count', v_excluded
  );
end $$;

CREATE OR REPLACE FUNCTION public.finalize_match_event_result_locked(p_proposal_id uuid, p_expected_version bigint, p_source text, p_actor_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_event_id uuid;
  v_event public.match_events%rowtype;
  v_proposal public.match_event_result_proposals%rowtype;
  v_fact public.match_event_result_proposal_versions%rowtype;
  v_existing public.match_event_result_confirmations%rowtype;
  v_now timestamptz;
  v_transition_revision bigint;
  v_confirmation_id uuid;
  v_gate jsonb;
begin
  if p_proposal_id is null or p_expected_version is null or p_expected_version < 1
    or p_source not in ('MANUAL', 'AUTO_48H')
    or (p_source = 'MANUAL' and p_actor_id is null)
    or (p_source = 'AUTO_48H' and p_actor_id is not null) then
    raise exception 'Invalid result finalization request' using errcode = '22023';
  end if;

  select p.match_event_id into v_event_id from public.match_event_result_proposals p
   where p.id = p_proposal_id;
  if not found then return null; end if;
  v_event := public.lock_match_event_registration(v_event_id);
  select * into v_proposal from public.match_event_result_proposals p
   where p.id = p_proposal_id for update;
  if not found then return null; end if;
  if v_proposal.active_version <> p_expected_version then return null; end if;

  if v_proposal.status = 'confirmed' then
    select * into v_existing from public.match_event_result_confirmations c
     where c.proposal_id = p_proposal_id and c.proposal_version = p_expected_version;
    if found then
      perform public.project_league_confirmation(v_existing.id);
      perform public.project_confirmed_rating_group(p_proposal_id);
      return v_existing.id;
    end if;
    raise exception 'Confirmed proposal is missing its confirmation evidence' using errcode = '23514';
  end if;
  if v_proposal.status <> 'pending' then return null; end if;

  select * into v_fact from public.match_event_result_proposal_versions v
   where v.proposal_id = p_proposal_id and v.version = p_expected_version;
  if not found then
    raise exception 'Active result version is missing immutable facts' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.match_event_result_reviews r
     where r.proposal_id = p_proposal_id
       and r.proposal_version = p_expected_version
       and r.decision = 'reject'
  ) then return null; end if;

  v_now := clock_timestamp();
  if p_source = 'AUTO_48H' then
    if v_now < v_proposal.review_deadline_at then return null; end if;
  else
    if v_now >= v_proposal.review_deadline_at
      or not public.has_match_event_result_approval_coverage(
        p_proposal_id, p_expected_version, p_actor_id
      ) then return null; end if;
  end if;

  select s.transition_revision into v_transition_revision
    from public.match_event_registration_state s
   where s.match_event_id = v_event.id;
  if v_transition_revision is null then
    raise exception 'Result confirmation requires frozen registration state' using errcode = '23514';
  end if;

  -- First official confirmation only (confirmed replays returned above): repeat the historical
  -- Ranked check against the stored facts. Membership is judged at the played instant, never by
  -- today's status; the League window is judged by its current effective boundary. A failure
  -- aborts before any confirmation, audit or rating side effect.
  if v_event.league_id is not null and v_event.event_type = 'competitive' then
    v_gate := public.match_result_ranked_ineligibility(
      v_event.id, public.match_result_fact_quartet(v_fact.teams), v_fact.played_at_utc);
    if v_gate is not null then
      raise exception using errcode = 'P0001',
        message = 'MATCH_RESULT_RANKED_' || upper(v_gate ->> 'reason'),
        detail = jsonb_build_object('set_index',null,'side',null,
          'reason_token','RANKED_' || upper(v_gate ->> 'reason'))::text;
    end if;
  end if;

  v_confirmation_id := gen_random_uuid();
  insert into public.match_event_result_confirmations(
    id, proposal_id, proposal_version, match_event_id, group_number, source,
    confirmed_at, effective_at, actor_id, event_type, ratable_eligible
  ) values (
    v_confirmation_id, v_proposal.id, v_proposal.active_version,
    v_proposal.match_event_id, v_proposal.group_number, p_source,
    v_now,
    case when p_source = 'AUTO_48H' then v_proposal.review_deadline_at else v_now end,
    p_actor_id, v_event.event_type,
    v_event.event_type = 'competitive' and v_fact.classification <> 'incomplete'
  );

  update public.match_event_result_proposals p set status = 'confirmed'
   where p.id = v_proposal.id and p.active_version = p_expected_version and p.status = 'pending';
  if not found then
    raise exception 'Result proposal changed during finalization' using errcode = '23514';
  end if;

  insert into public.match_event_audit_log(
    match_event_id, community_id, actor_id, action, request_id, occurred_at,
    event_version, transition_revision, before_data, after_data, changed_fields,
    confirmation_id
  ) values (
    v_event.id, v_event.community_id, p_actor_id, 'result_confirmed', null, v_now,
    p_expected_version, v_transition_revision,
    jsonb_build_object('proposal_id', v_proposal.id, 'group_number', v_proposal.group_number,
      'version', p_expected_version, 'status', 'pending'),
    jsonb_build_object('proposal_id', v_proposal.id, 'group_number', v_proposal.group_number,
      'version', p_expected_version, 'status', 'confirmed', 'source', p_source,
      'confirmation_id', v_confirmation_id),
    array['status', 'confirmation_id'], v_confirmation_id
  );
  -- League counters first; the global rating projector keeps the last lock.
  perform public.project_league_confirmation(v_confirmation_id);
  perform public.project_confirmed_rating_group(v_proposal.id);
  return v_confirmation_id;
end $function$;


-- Backfill: materialize every League that already has confirmed bound facts, one League at a time
-- (community -> League locks). Rerunnable: receipts are unique and unchanged counters are not rewritten.
do $$
declare v_league uuid;
begin
  for v_league in
    select distinct e.league_id from public.match_events e
      join public.match_event_result_confirmations c on c.match_event_id = e.id
     where e.league_id is not null
     order by e.league_id
  loop
    perform public.rebuild_league_counters(v_league);
  end loop;
end $$;

commit;
