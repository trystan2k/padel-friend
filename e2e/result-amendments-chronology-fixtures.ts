import { expect, type Browser } from '@playwright/test';
import { parseResultProposals } from '../src/features/matches/match-result-model';
import { parseResultAmendments } from '../src/features/matches/result-amendment-model';
import { day, leagueFixtures, sql, type Actor } from './leagues-fixtures';
import {
  approveRequest,
  cleanupLevelReviews,
  grantPlatformAdmin,
  markUnderReview,
  playedAfterCheckpoint,
  submitRequest
} from './level-reviews-fixtures';
import { runMatchFixtureCleanup } from './match-fixture-cleanup';

export { copies, fill, sql } from './leagues-fixtures';

export const octoberPlayedAt = '2026-10-05T18:30:00Z';
export const secondPlayedAt = '2026-10-12T18:30:00Z';
const winningSets = [
  { position: 1, team_a_games: 6, team_b_games: 2, completed: true },
  { position: 2, team_a_games: 6, team_b_games: 4, completed: true }
];
export const correctedSets = [
  { position: 1, team_a_games: 2, team_b_games: 6, completed: true },
  { position: 2, team_a_games: 4, team_b_games: 6, completed: true }
];
const sqlList = (ids: readonly string[]) => ids.map((id) => `'${id}'`).join(',');

type Teams = { team_a: [string, string]; team_b: [string, string] };
export type ChronologyGroup = {
  eventId: string;
  proposalId: string;
  confirmationId: string;
  teams: Teams;
  playedAt: string;
};

/**
 * One fixed UTC chronology on a Manual Ranked League: an October original result, later groups that
 * transitively depend on its players' ratings, a mid-sequence Platform Admin level adjustment and a
 * League close. Proposals, reviews, level reviews and the close all use the real authenticated
 * commands; trusted SQL only anchors League/membership/event times and grants the admin role.
 */
export async function chronologyFixtures(browser: Browser) {
  const f = await leagueFixtures(browser, { memberCount: 8, communityName: 'Correction Club' });
  const everyone: Actor[] = [f.creator, ...f.members, f.guest];
  const actorFor = (id: string) => {
    const actor = everyone.find((item) => item.id === id);
    if (!actor) throw new Error('Unknown fixture actor');
    return actor;
  };
  const member = (index: number) => {
    const actor = f.members[index];
    if (!actor) throw new Error('Missing fixture member');
    return actor;
  };
  const [m0, m1, m2, m3, m4, m5, m6, admin] = [
    member(0),
    member(1),
    member(2),
    member(3),
    member(4),
    member(5),
    member(6),
    member(7)
  ] as const;

  const leagueId = await f.createLeague(f.creator, {
    name: 'Autumn League',
    endMode: 'manual',
    start: day(0),
    minimum: 1
  });
  await sql(`do $$ begin
    update public.leagues set start_at='2026-10-01T00:00:00Z' where id='${leagueId}';
    alter table public.community_members disable trigger community_member_guard;
    update public.community_members set valid_from='2026-09-30T00:00:00Z', activated_at='2026-09-30T00:00:00Z'
      where community_id='${f.community}';
    alter table public.community_members enable trigger community_member_guard;
  end $$;`);
  const [league] = await sql(
    `select version, status::text from public.leagues where id='${leagueId}'`
  );
  if (league?.['status'] !== 'active')
    await f.rpc(f.creator, 'activate_league', {
      p_league_id: leagueId,
      p_expected_version: league?.['version']
    });

  /** A ranked League event moved to its played instant, then a confirmed group via real commands. */
  async function group(teams: Teams, playedAt: string): Promise<ChronologyGroup> {
    const players = [...teams.team_a, ...teams.team_b];
    const eventId = await f.publish(f.creator, {
      competition: 'ranked',
      leagueId,
      date: day(1),
      venue: `Chronology ${playedAt.slice(0, 10)}`
    });
    for (const id of players.filter((player) => player !== f.creator.id))
      await f.rpc(actorFor(id), 'submit_match_registration', { p_match_event_id: eventId });
    await f.cutoff(eventId);
    await sql(`do $$ begin
      alter table public.match_events disable trigger match_event_immutable;
      alter table public.match_events disable trigger match_event_league_binding;
      update public.match_events set starts_at='${playedAt}'::timestamptz - interval '3 hours',
        registration_cutoff_at='${playedAt}'::timestamptz - interval '4 hours' where id='${eventId}';
      alter table public.match_events enable trigger match_event_league_binding;
      alter table public.match_events enable trigger match_event_immutable;
    end $$;`);
    await f.rpc(f.creator, 'submit_match_event_result', {
      p_match_event_id: eventId,
      p_group_number: 1,
      p_teams: teams,
      p_sets: winningSets,
      p_played_local: {
        local: playedAt.slice(0, 19).replace('T', ' '),
        offset_seconds: 0,
        instant: playedAt
      },
      p_court_label: 'Court 1',
      p_request_id: crypto.randomUUID()
    });
    const pending = (await proposals(eventId))[0]!;
    await f.rpc(actorFor(teams.team_b[0]), 'review_match_event_result', {
      p_proposal_id: pending.proposal_id,
      p_expected_version: pending.version,
      p_decision: 'approve',
      p_request_id: crypto.randomUUID()
    });
    const confirmed = (await proposals(eventId))[0]!;
    expect(confirmed.status).toBe('confirmed');
    return {
      eventId,
      proposalId: confirmed.proposal_id,
      confirmationId: confirmed.confirmation!.confirmation_id,
      teams,
      playedAt
    };
  }
  async function proposals(eventId: string) {
    const rows = parseResultProposals(
      await f.rpc(f.creator, 'get_match_event_result_proposals', { p_match_event_id: eventId })
    );
    if (!rows?.[0]) throw new Error('Missing proposal');
    return rows;
  }
  async function amendments(eventId: string) {
    const rows = parseResultAmendments(
      await f.rpc(f.creator, 'get_result_amendments', { p_match_event_id: eventId }),
      eventId
    );
    if (!rows) throw new Error('Invalid amendment response');
    return rows;
  }

  const october = await group(
    { team_a: [f.creator.id, m0.id], team_b: [m1.id, m2.id] },
    octoberPlayedAt
  );
  const second = await group(
    { team_a: [f.creator.id, m3.id], team_b: [m4.id, m5.id] },
    secondPlayedAt
  );

  // Mid-sequence Platform Admin adjustment of a player of the second group, via the real review flow.
  await grantPlatformAdmin(admin.id);
  const request = await submitRequest(m4, { min: 4, max: 4.2 });
  await markUnderReview(admin, request);
  await approveRequest(admin, request, 4.1, 'Evidence supports the adjustment.');

  // Played strictly after the adjustment boundary, at a whole second the database clock has passed.
  const boundary = new Date(
    (await playedAfterCheckpoint()).replace(' ', 'T').replace(/\+00$/, 'Z')
  );
  const thirdPlayedAt = new Date(Math.ceil(boundary.getTime() / 1000) * 1000 + 1000)
    .toISOString()
    .replace('.000Z', 'Z');
  await expect
    .poll(async () => {
      const [row] = await sql(
        `select clock_timestamp() > '${thirdPlayedAt}'::timestamptz as passed`
      );
      return row?.['passed'];
    })
    .toBe(true);
  const third = await group(
    { team_a: [f.creator.id, m1.id], team_b: [m3.id, m6.id] },
    thirdPlayedAt
  );

  async function snapshot() {
    const adjustments = await sql(
      `select to_jsonb(a)::text as row from public.player_rating_admin_adjustments a where user_id='${m4.id}' order by decided_at`
    );
    const ratings = await sql(
      `select user_id::text, mu::text, confirmed_competitive_game_groups from public.global_player_ratings where user_id in (${sqlList([f.creator.id, m0.id, m1.id, m2.id, m3.id, m4.id, m5.id, m6.id])}) order by user_id`
    );
    const snapshots = await sql(
      `select standings_version::int as version, cause, repair_job_id::text as job, amendment_id::text as amendment, prior_standings_version::int as prior, md5(s::text) as row_hash from public.league_standings_snapshots s where league_id='${leagueId}' order by standings_version`
    );
    return { adjustments, ratings, snapshots };
  }

  async function closeLeague() {
    const [row] = await sql(`select version from public.leagues where id='${leagueId}'`);
    await f.rpc(f.creator, 'close_league', {
      p_league_id: leagueId,
      p_expected_version: row?.['version']
    });
  }

  async function cleanup() {
    const ids = everyone.map((actor) => actor.id);
    await sql(`do $$ begin
      alter table public.league_standings_snapshots disable trigger league_standings_snapshots_immutable;
      delete from public.league_standings_snapshots where league_id='${leagueId}';
      alter table public.league_standings_snapshots enable trigger league_standings_snapshots_immutable;
    end $$;`);
    await runMatchFixtureCleanup({ actorIds: ids });
    await cleanupLevelReviews(ids);
    await f.cleanup();
  }

  return {
    ...f,
    leagueId,
    october,
    second,
    third,
    players: { creator: f.creator, m0, m1, m2, m3, m4, m5, m6, admin },
    adjustmentRequestId: request,
    amendments,
    proposals,
    snapshot,
    closeLeague,
    actorFor,
    cleanup
  };
}
