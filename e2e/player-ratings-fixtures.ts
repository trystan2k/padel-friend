import { randomUUID } from 'node:crypto';
import { matchPhotoFixture } from '../test/helpers/match-photo-fixtures';
import { runMatchFixtureCleanup } from './match-fixture-cleanup';
import { sql, sqlWithFixtureTriggersDisabled, type Actor } from './matches-results-fixtures';

// Rating fixtures drive the PRODUCTION confirmation seam (finalize_match_event_result_locked)
// with real proposal rows; no rating value is ever written by the tests themselves.

export type Quartet = readonly [string, string, string, string];
export type Classification = 'team_a' | 'team_b' | 'draw' | 'incomplete';

const SETS: Record<Classification, string> = {
  team_a: '[{"position":1,"team_a_games":6,"team_b_games":4,"completed":true}]',
  team_b: '[{"position":1,"team_a_games":4,"team_b_games":6,"completed":true}]',
  draw: '[{"position":1,"team_a_games":6,"team_b_games":6,"completed":true}]',
  incomplete: '[{"position":1,"team_a_games":3,"team_b_games":2,"completed":false}]'
};

export type GroupSpec = {
  eventId: string;
  players: Quartet;
  playedAt: string;
  submittedBy: string;
  groupNumber?: number;
  classification?: Classification;
};

/** Pending proposal v1; 49h-aged windows are AUTO_48H eligible, 1h-aged stay open. */
export async function submitGroup(spec: GroupSpec, ageHours: 49 | 1 = 49): Promise<string> {
  const proposalId = randomUUID();
  const classification = spec.classification ?? 'team_a';
  const [a1, a2, b1, b2] = spec.players;
  await sql(`do $proposal$
    declare
      v_submitted_at timestamptz := clock_timestamp() - interval '${ageHours} hours';
      v_deadline timestamptz := v_submitted_at + interval '48 hours';
    begin
      insert into public.match_event_result_proposals(
        id, match_event_id, group_number, status, active_version, review_deadline_at, submitted_by, submitted_at
      ) values ('${proposalId}', '${spec.eventId}', ${spec.groupNumber ?? 1}, 'pending', 1, v_deadline,
        '${spec.submittedBy}', v_submitted_at);
      insert into public.match_event_result_proposal_versions(
        proposal_id, version, submitted_by, submitted_at, review_deadline_at, teams, sets, classification,
        played_at_utc, played_at_local, played_at_offset_seconds, court_label
      ) values ('${proposalId}', 1, '${spec.submittedBy}', v_submitted_at, v_deadline,
        jsonb_build_object('team_a', jsonb_build_array('${a1}', '${a2}'), 'team_b', jsonb_build_array('${b1}', '${b2}')),
        '${SETS[classification]}'::jsonb, '${classification}', '${spec.playedAt}'::timestamptz,
        ('${spec.playedAt}'::timestamptz at time zone 'UTC'), 0, 'Court 1');
    end $proposal$;`);
  return proposalId;
}

export async function finalize(
  proposalId: string,
  source: 'MANUAL' | 'AUTO_48H',
  actorId?: string
): Promise<string | null> {
  const actor = source === 'MANUAL' ? `'${actorId}'::uuid` : 'null';
  const [row] = await sql(
    `select public.finalize_match_event_result_locked('${proposalId}', 1, '${source}', ${actor})::text as id`
  );
  return typeof row?.['id'] === 'string' ? row['id'] : null;
}

export async function review(
  proposalId: string,
  reviewer: string,
  decision: 'approve' | 'reject'
): Promise<void> {
  const reason = decision === 'reject' ? "'WRONG_SCORE'" : 'null';
  await sql(`insert into public.match_event_result_reviews(
    proposal_id, proposal_version, reviewer_user_id, decision, reason_code, request_id
  ) values ('${proposalId}', 1, '${reviewer}', '${decision}', ${reason}, '${randomUUID()}')`);
}

/** Pending group confirmed through the chosen production path. Returns proposal + confirmation. */
export async function confirmGroup(spec: GroupSpec, source: 'MANUAL' | 'AUTO_48H' = 'AUTO_48H') {
  const proposalId = await submitGroup(spec, source === 'AUTO_48H' ? 49 : 1);
  if (source === 'MANUAL') {
    const [a1, , b1] = spec.players;
    await review(proposalId, a1, 'approve');
    await review(proposalId, b1, 'approve');
  }
  const confirmationId = await finalize(proposalId, source, spec.players[0]);
  if (!confirmationId) throw new Error('Group did not confirm');
  return { proposalId, confirmationId };
}

/** Cheap past event (no registration flow). Type defaults to competitive. */
export async function pastEvent(
  f: { event: (count: number) => Promise<string> },
  type: 'competitive' | 'friendly' = 'competitive'
): Promise<string> {
  const id = await f.event(1);
  await sqlWithFixtureTriggersDisabled(
    ['matchEventImmutable'],
    [
      `update public.match_events
          set starts_at='2026-10-01T22:00:00Z', registration_cutoff_at='2026-10-01T20:00:00Z',
              event_type='${type}'
        where id='${id}'`
    ]
  );
  return id;
}

export async function reserveRegistration(eventId: string, userId: string): Promise<void> {
  await sql(`do $$ begin
    insert into public.match_event_registrations(match_event_id,user_id,accepted_at,accepted_order,participation_status,registration_source)
      select '${eventId}','${userId}',clock_timestamp(),coalesce(max(accepted_order),0)+1,'reserve','member'
      from public.match_event_registrations where match_event_id='${eventId}';
    insert into public.match_event_registration_attempts(registration_id,match_event_id,user_id,requested_at,decided_at,outcome,actor_id,accepted_at,accepted_order,registration_source)
      select id,match_event_id,user_id,accepted_at,accepted_at,'accepted',user_id,accepted_at,accepted_order,registration_source
      from public.match_event_registrations where match_event_id='${eventId}' and user_id='${userId}';
    update public.match_event_registrations r set current_attempt_id=a.id
      from public.match_event_registration_attempts a
      where a.registration_id=r.id and r.match_event_id='${eventId}' and r.user_id='${userId}';
  end $$;`);
}

export type LedgerRow = {
  group_id: string;
  match_event_id: string;
  group_number: number;
  revision: number;
  calculations: number;
  before: number;
  after: number;
  before_reliability: number;
  after_reliability: number;
  delta: number;
  explanation: Record<string, unknown>;
  fingerprint: string;
};

/** Latest stored calculation per logical event, played order. */
export async function ledger(userId: string): Promise<LedgerRow[]> {
  const rows =
    await sql(`select e.game_group_id::text as group_id, e.match_event_id::text as match_event_id,
      e.game_group_number::int as group_number, c.projection_revision::int as revision,
      (select count(*)::int from public.player_rating_event_calculations x where x.rating_event_id=e.id) as calculations,
      c.before_display_level::float8 as before, c.after_display_level::float8 as after,
      c.before_reliability_percent::float8 as before_reliability, c.after_reliability_percent::float8 as after_reliability,
      (c.explanation->>'applied_delta')::float8 as delta, c.explanation,
      md5(row_to_json(c)::text) as fingerprint
    from public.player_rating_events e
    join lateral (select * from public.player_rating_event_calculations k
      where k.rating_event_id=e.id order by k.projection_revision desc limit 1) c on true
    where e.user_id='${userId}' order by e.played_at, e.game_group_id`);
  return rows.map((row) => ({
    group_id: String(row['group_id']),
    match_event_id: String(row['match_event_id']),
    group_number: Number(row['group_number']),
    revision: Number(row['revision']),
    calculations: Number(row['calculations']),
    before: Number(row['before']),
    after: Number(row['after']),
    before_reliability: Number(row['before_reliability']),
    after_reliability: Number(row['after_reliability']),
    delta: Number(row['delta']),
    explanation: Object.fromEntries(Object.entries(Object(row['explanation']))),
    fingerprint: String(row['fingerprint'])
  }));
}

/** Current materialized state without bookkeeping stamps (revision / updated_at). */
export async function states(ids: readonly string[]) {
  return sql(`select user_id::text as user_id, display_level::text as display_level, mu::text as mu,
      sigma::text as sigma, reliability_percent::text as reliability_percent,
      confirmed_competitive_game_groups::int as groups, highest_display_level::text as highest,
      initial_display_level::text as initial, last_rating_at::text as last_rating_at
    from public.global_player_ratings
    where user_id in (${ids.map((id) => `'${id}'`).join(',')}) order by user_id`);
}

export async function eventCount(ids: readonly string[]): Promise<number> {
  const [row] = await sql(
    `select count(*)::int as n from public.player_rating_events where user_id in (${ids.map((id) => `'${id}'`).join(',')})`
  );
  return Number(row?.['n']);
}

/** Second (private) community administered by `admin`, with one past competitive event. */
export async function secondCommunity(admin: Actor) {
  const created = await admin.client.rpc('create_community', {
    p_name: `Rating Cross ${randomUUID().slice(0, 8)}`,
    p_visibility: 'private',
    p_join_policy: 'admin_approval'
  });
  if (created.error || typeof created.data !== 'string')
    throw created.error ?? new Error('No second community');
  const communityId = created.data;
  const eventId = randomUUID();
  const photo = matchPhotoFixture(communityId, eventId, admin.id);
  await sql(`do $$ begin
    ${photo.sql}
    alter table public.match_events disable trigger match_event_creator_registration;
    insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,registration_cutoff_at)
      values ('${eventId}','${communityId}','${admin.id}','2026-10-02T22:00:00Z','UTC','competitive','community_open','POST_MATCH_TEAMS','Cross court','https://maps.google.com/maps/place/cross','${photo.path}','2026-10-02T20:00:00Z');
    alter table public.match_events enable trigger match_event_creator_registration;
  end $$;`);
  return {
    communityId,
    eventId,
    async cleanup() {
      await sql(`do $$ begin
        alter table public.player_rating_event_calculations disable trigger player_rating_calculations_immutable;
        alter table public.player_rating_events disable trigger player_rating_events_immutable;
        alter table public.player_rating_event_sources disable trigger player_rating_event_sources_immutable;
        delete from public.player_rating_event_calculations where rating_event_id in (select id from public.player_rating_events where match_event_id='${eventId}');
        delete from public.player_rating_event_sources where rating_event_id in (select id from public.player_rating_events where match_event_id='${eventId}');
        delete from public.player_rating_events where match_event_id='${eventId}';
        alter table public.player_rating_event_sources enable trigger player_rating_event_sources_immutable;
        alter table public.player_rating_events enable trigger player_rating_events_immutable;
        alter table public.player_rating_event_calculations enable trigger player_rating_calculations_immutable;
      end $$;`);
      await runMatchFixtureCleanup({ eventIds: [eventId], actorIds: [admin.id] });
      // Storage rows are removed through the Storage API while the admin is still a member.
      const removed = await admin.client.storage.from('match-event-photos').remove([photo.path]);
      if (removed.error) throw removed.error;
      await sql(`do $$ begin
        alter table public.community_members disable trigger community_member_guard;
        delete from public.community_members where community_id='${communityId}';
        delete from public.community_audit_log where community_id='${communityId}';
        delete from public.communities where id='${communityId}';
        alter table public.community_members enable trigger community_member_guard;
      end $$;`);
    }
  };
}

/** Ledger + profile removal for provisional fixtures (immutable evidence, trusted test cleanup). */
export async function removeProvisionalEvidence(emails: readonly string[]): Promise<void> {
  for (const email of emails)
    await sql(`do $$ declare v_id uuid := (select id from auth.users where email='${email}'); begin
      alter table public.player_rating_event_calculations disable trigger player_rating_calculations_immutable;
      alter table public.player_rating_events disable trigger player_rating_events_immutable;
      alter table public.player_rating_initializations disable trigger player_rating_initializations_immutable;
      alter table public.player_rating_event_sources disable trigger player_rating_event_sources_immutable;
      delete from public.player_rating_event_calculations where rating_event_id in (select id from public.player_rating_events where user_id=v_id);
      delete from public.player_rating_event_sources where rating_event_id in (select id from public.player_rating_events where user_id=v_id);
      delete from public.player_rating_events where user_id=v_id;
      delete from public.player_rating_initializations where user_id=v_id;
      alter table public.player_rating_event_sources enable trigger player_rating_event_sources_immutable;
      alter table public.player_rating_initializations enable trigger player_rating_initializations_immutable;
      alter table public.player_rating_events enable trigger player_rating_events_immutable;
      alter table public.player_rating_event_calculations enable trigger player_rating_calculations_immutable;
    end $$;`);
}
