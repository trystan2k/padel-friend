import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  decodeLeagueStandings,
  decodeLeagueStandingsAudit,
  decodeLeagueStandingsVersions
} from '../src/features/leagues/league-standings-decoders';
import {
  insertLeague,
  leagueEventActions,
  leagueWorld,
  leagueRow,
  type LeagueActor,
  type LeagueWorld
} from './helpers/league-fixtures';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, fixtureSql, sqlRows } from './helpers/match-registration-sql';
import { setResultReviewDeadlineOffset } from './helpers/match-result-processing-fixtures';
import { sqlText } from './helpers/provisional-player-fixtures';
import {
  createRankedResultFixtures,
  playedAt,
  setMembershipHistory,
  shiftInstant,
  type RankedResultKit
} from './helpers/ranked-result-fixtures';
import {
  openDedicatedSqlConnection,
  queryTrustedSql,
  type DedicatedSqlConnection
} from './helpers/sql-transport';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
const dayAgo = () => new Date(Date.now() - 86_400_000).toISOString();
const L = (id: string) => sqlText(id);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * PAF-12 U3: versioned immutable final standings across close and late first confirmations,
 * Manual-close idempotency, audit authorization and the close/confirm lock interleavings.
 */
describe.skipIf(!environment.env)('League final standings versions', { timeout: 300_000 }, () => {
  let kit: RankedResultKit;

  beforeAll(async () => {
    // Opposite app-wide strengths: finals must follow League records only.
    kit = await createRankedResultFixtures(environment.env!, { levels: [7, 7, 0, 0, 4, 4, 4, 4] });
  });
  afterAll(async () => {
    if (kit) await kit.cleanup();
  });
  // A failed test must not leave the single Active slot taken for the next one.
  afterEach(async () => {
    await fixtureSql(`update public.leagues set status = 'closed', closed_at = now(), closed_by = ${L(id(0))},
      closed_reason = 'manual', activation_blocked_at = null
      where community_id = ${L(kit.communityId)} and status = 'active';`);
  });

  const id = (index: number) => kit.players[index]!.id;
  const indexOf = (userId: string) => kit.players.findIndex((player) => player.id === userId);

  /** Manual League that is Active right now (one at a time per community: close before the next). */
  const activeLeague = (overrides: Parameters<RankedResultKit['league']>[0] = {}) =>
    kit.league({ status: 'active', endMode: 'manual', endAt: null, ...overrides });

  async function submitGroup(eventId: string, groupNumber: number, secondsAgo = 120) {
    const submitted = await kit.submit(eventId, playedAt(secondsAgo).played, { groupNumber });
    expect(submitted.error).toBeNull();
    return String(asRecord(submitted.data)['proposal_id']);
  }
  /**
   * Group 1's submitter plays in it, so one opposing approval confirms. Later groups are submitted
   * by an outsider to the quartet and need an approval from each side; the last one confirms.
   */
  async function approveGroup(proposalId: string, groupNumber: number) {
    const first = (groupNumber - 1) * 4;
    if (groupNumber === 1) return kit.approve(proposalId, 1, kit.players[first + 2]);
    expect((await kit.approve(proposalId, 1, kit.players[first])).error).toBeNull();
    return kit.approve(proposalId, 1, kit.players[first + 2]);
  }
  async function confirmGroup(eventId: string, groupNumber: number, secondsAgo = 120) {
    const proposalId = await submitGroup(eventId, groupNumber, secondsAgo);
    expect((await approveGroup(proposalId, groupNumber)).error).toBeNull();
    return proposalId;
  }
  const close = (leagueId: string, version?: number) =>
    kit.rpc(kit.creator, 'close_league', {
      p_league_id: leagueId,
      p_expected_version: version ?? 1
    });
  const standings = async (leagueId: string, version?: number) => {
    const response = await kit.rpc(kit.creator, 'get_league_standings', {
      p_league_id: leagueId,
      p_standings_version: version
    });
    expect(response.error).toBeNull();
    return decodeLeagueStandings(response.data);
  };
  /** Full-row fingerprints: a version never changes, including its generation time. */
  const snapshots = (leagueId: string) =>
    sqlRows(
      `select standings_version, cause, basis, triggering_confirmation_id::text as trigger,
              cardinality(included_confirmation_ids) as included, md5(s::text) as fingerprint,
              jsonb_array_length(entries) as entry_count
         from public.league_standings_snapshots s where league_id = ${L(leagueId)} order by standings_version`
    );
  const events = (leagueId: string) =>
    sqlRows(
      `select action, actor_id::text as actor, system_reason, details
         from public.league_events where league_id = ${L(leagueId)}
          and action in ('closed','standings_revised') order by occurred_at, id`
    );
  const stateOf = async (leagueId: string) => ({
    versions: (await snapshots(leagueId)).length,
    events: (await events(leagueId)).length
  });
  const finalizeAuto = async (proposalId: string) => {
    await setResultReviewDeadlineOffset(proposalId, 1, -60);
    return `select public.finalize_match_event_result_locked(${L(proposalId)}::uuid, 1, 'AUTO_48H', null)`;
  };
  const ratingEvents = async (eventId: string) => (await kit.sideEffects(eventId))['rating_events'];
  const playerRecord = (
    entries: { user_id: string; matches: number; wins: number; losses: number }[]
  ) =>
    entries
      .map((entry) => [indexOf(entry.user_id), entry.matches, entry.wins, entry.losses])
      .sort((a, b) => Number(a[0]) - Number(b[0]));

  it('closes Manual atomically with version 1, a single audit entry and a replay-safe command', async () => {
    const leagueId = await activeLeague();
    await confirmGroup(await kit.event(leagueId), 1);

    const closed = await close(leagueId);
    expect(closed.error).toBeNull();
    const row = await leagueRow(leagueId);
    expect(row).toMatchObject({ status: 'closed', closed_reason: 'manual', version: 2 });

    const v1 = await standings(leagueId);
    expect(v1).toMatchObject({
      source: 'final',
      standings_version: 1,
      latest_standings_version: 1,
      cause: 'closed',
      status: 'closed'
    });
    expect(playerRecord(v1.entries)).toEqual([
      [0, 1, 1, 0],
      [1, 1, 1, 0],
      [2, 1, 0, 1],
      [3, 1, 0, 1]
    ]);
    expect(await leagueEventActions(leagueId)).toEqual(['closed']);
    expect((await events(leagueId))[0]!['details']).toMatchObject({ standings_version: 1 });

    // Lost response replay (version the request produced) and re-sent request (version it saw).
    const before = { snapshots: await snapshots(leagueId), state: await stateOf(leagueId) };
    for (const version of [1, 2]) {
      const replay = await close(leagueId, version);
      expect(replay.error).toBeNull();
      expect(replay.data).toEqual(closed.data);
    }
    expect(await snapshots(leagueId)).toEqual(before.snapshots);
    expect(await stateOf(leagueId)).toEqual(before.state);
    // An unrelated stale version is still a conflict.
    expect((await close(leagueId, 7)).error?.message).toBe('LEAGUE_VERSION_CONFLICT');
  });

  it('publishes an empty valid final for a League nobody played in', async () => {
    const leagueId = await activeLeague();
    expect((await close(leagueId)).error).toBeNull();
    const v1 = await standings(leagueId);
    expect(v1).toMatchObject({ standings_version: 1, entries: [] });
    expect(await snapshots(leagueId)).toHaveLength(1);
  });

  it('closes a Fixed League only after the inclusive end with the exact cutoff via the due processor', async () => {
    const endAt = new Date(Date.now() + 120_000).toISOString();
    const leagueId = await kit.league({ status: 'active', endAt });
    await confirmGroup(await kit.event(leagueId), 1);
    const [exact] = await sqlRows(
      `select end_at::text as end_at from public.leagues where id = ${L(leagueId)}`
    );
    const end = String(exact?.['end_at']);

    // Fixed Leagues cannot be closed early by hand.
    expect((await close(leagueId)).error?.message).toBe('LEAGUE_CLOSE_NOT_MANUAL');
    const processAt = (asOf: string) =>
      sqlRows(`select public.process_due_leagues(100, ${sqlText(asOf)}::timestamptz) as result`);
    await processAt(end);
    expect((await leagueRow(leagueId))['status']).toBe('active');
    expect(await snapshots(leagueId)).toHaveLength(0);

    await processAt(await shiftInstant(end, 1));
    const row = await leagueRow(leagueId);
    expect(row).toMatchObject({ status: 'closed', closed_reason: 'fixed_end_reached' });
    expect(String(row['closed_at'])).toBe(String((await leagueRow(leagueId))['end_at']));
    const [version] = await snapshots(leagueId);
    expect(version).toMatchObject({ standings_version: 1, cause: 'closed', included: 1 });
    expect((await events(leagueId))[0]).toMatchObject({
      action: 'closed',
      actor: null,
      system_reason: 'fixed_end_reached'
    });

    // The processor is idempotent: a second run changes nothing.
    const stable = await stateOf(leagueId);
    await processAt(await shiftInstant(end, 5_000_000));
    expect(await stateOf(leagueId)).toEqual(stable);
    expect(await snapshots(leagueId)).toHaveLength(1);
  });

  it('closes an expired Upcoming League unused with a valid empty final', async () => {
    const startAt = new Date(Date.now() + 3_600_000).toISOString();
    const endAt = new Date(Date.now() + 7_200_000).toISOString();
    const leagueId = await kit.league({ status: 'upcoming', startAt, endAt });
    await sqlRows(
      `select public.process_due_leagues(100, ${sqlText(await shiftInstant(endAt, 1))}::timestamptz) as result`
    );
    expect(await leagueRow(leagueId)).toMatchObject({
      status: 'closed',
      closed_reason: 'expired_before_activation'
    });
    expect(await standings(leagueId)).toMatchObject({ standings_version: 1, entries: [] });
  });

  it('appends version 2 for the first in-period confirmation after close, leaving version 1 untouched', async () => {
    const leagueId = await activeLeague();
    const eventId = await kit.event(leagueId);
    await confirmGroup(eventId, 1);
    // Group 2 is submitted while the League is open but nobody reviewed it yet.
    const pending = await submitGroup(eventId, 2);
    expect((await close(leagueId)).error).toBeNull();
    const [v1Before] = await snapshots(leagueId);
    const v1Entries = await standings(leagueId, 1);
    expect(v1Entries.entries).toHaveLength(4);
    // Labels are frozen: a later profile edit does not rewrite version 1.
    await fixtureSql(
      `update public.player_profiles set display_name = 'Renamed Winner' where user_id = ${L(id(0))};`
    );

    const eventsBefore = await events(leagueId);
    expect((await approveGroup(pending, 2)).error).toBeNull();
    const versions = await snapshots(leagueId);
    expect(versions).toHaveLength(2);
    expect(versions[0]).toEqual(v1Before);
    expect(versions[1]).toMatchObject({
      standings_version: 2,
      cause: 'late_first_confirmation',
      basis: 'published',
      included: 2
    });
    expect(versions[1]!['trigger']).toBeTruthy();

    const latest = await standings(leagueId);
    expect(latest).toMatchObject({ standings_version: 2, latest_standings_version: 2 });
    expect(latest.entries).toHaveLength(8);
    expect(await standings(leagueId, 1)).toEqual({ ...v1Entries, latest_standings_version: 2 });
    expect(latest.entries.find((entry) => entry.user_id === id(0))?.display_name).toBe(
      'Renamed Winner'
    );
    expect(v1Entries.entries.find((entry) => entry.user_id === id(0))?.display_name).not.toBe(
      'Renamed Winner'
    );

    // Audit: human actor (manual review), old/new version, source confirmation and cutoff.
    const revised = (await events(leagueId)).slice(eventsBefore.length);
    expect(revised).toHaveLength(1);
    expect(revised[0]).toMatchObject({
      action: 'standings_revised',
      actor: id(6),
      system_reason: null,
      details: {
        old_standings_version: 1,
        standings_version: 2,
        group_number: 2,
        source: 'MANUAL',
        proposal_id: pending
      }
    });

    // The owner/Admin reader publishes allowlisted facts only: no confirmation, proposal,
    // match-event or group identifiers, even though the stored event keeps them.
    const auditResponse = await kit.rpc(kit.creator, 'get_league_standings_audit', {
      p_league_id: leagueId
    });
    expect(auditResponse.error).toBeNull();
    const audit = decodeLeagueStandingsAudit(auditResponse.data);
    const lateEvent = audit.events.find((event) => event.action === 'standings_revised');
    expect(lateEvent?.actor_id).toBe(id(6));
    expect(Object.keys(lateEvent!.details).sort()).toEqual([
      'confirmed_at',
      'effective_cutoff',
      'old_standings_version',
      'played_at',
      'source',
      'standings_version'
    ]);
    expect(JSON.stringify(auditResponse.data)).not.toContain(pending);

    // The finalizer replay, even after losing its receipt, creates neither a version nor an audit.
    const settled = { versions: await snapshots(leagueId), state: await stateOf(leagueId) };
    for (const wipe of [false, true]) {
      if (wipe)
        await fixtureSql(`do $$ begin
          alter table public.league_projection_confirmations disable trigger league_projection_confirmations_immutable;
          delete from public.league_projection_confirmations where league_id = ${L(leagueId)};
          alter table public.league_projection_confirmations enable trigger league_projection_confirmations_immutable;
        end $$;`);
      await fixtureSql(
        `select public.finalize_match_event_result_locked(${L(pending)}::uuid, 1, 'MANUAL', ${L(id(6))}::uuid);`
      );
      expect(await snapshots(leagueId)).toEqual(settled.versions);
      expect(await stateOf(leagueId)).toEqual(settled.state);
    }
    expect(await ratingEvents(eventId)).toBe(8);
  });

  it('records a system reason for an automatic late confirmation and numbers each new group', async () => {
    const leagueId = await activeLeague();
    const eventId = await kit.event(leagueId);
    const second = await kit.event(leagueId);
    await confirmGroup(eventId, 1);
    const pendingA = await submitGroup(eventId, 2);
    const pendingB = await submitGroup(second, 1);
    expect((await close(leagueId)).error).toBeNull();

    const autoA = await finalizeAuto(pendingA);
    await fixtureSql(`${autoA};`);
    const autoB = await finalizeAuto(pendingB);
    await fixtureSql(`${autoB};`);

    expect(
      (await snapshots(leagueId)).map((row) => [row['standings_version'], row['cause']])
    ).toEqual([
      [1, 'closed'],
      [2, 'late_first_confirmation'],
      [3, 'late_first_confirmation']
    ]);
    const revised = (await events(leagueId)).filter((row) => row['action'] === 'standings_revised');
    expect(revised).toHaveLength(2);
    for (const row of revised)
      expect(row).toMatchObject({
        actor: null,
        system_reason: 'late_first_confirmation',
        details: { source: 'AUTO_48H' }
      });
    expect(revised.map((row) => asRecord(row['details'])['standings_version'])).toEqual([2, 3]);
    // Group 1 of the second event adds a second match to players 0-3.
    expect(playerRecord((await standings(leagueId)).entries).slice(0, 4)).toEqual([
      [0, 2, 2, 0],
      [1, 2, 2, 0],
      [2, 2, 0, 2],
      [3, 2, 0, 2]
    ]);
  });

  it('never creates a version for play outside the period or for results that are not League play', async () => {
    const leagueId = await activeLeague();
    await confirmGroup(await kit.event(leagueId), 1);
    expect((await close(leagueId)).error).toBeNull();
    const settled = { versions: await snapshots(leagueId), state: await stateOf(leagueId) };

    // Play after the cutoff is refused outright for a League event (cutoff second has passed).
    const lateEvent = await kit.event(leagueId);
    await sleep(2_100);
    const refused = await kit.submit(lateEvent, playedAt(0).played);
    expect(refused.error?.message).toMatch(/RANKED_OUT_OF_PERIOD/);

    // An Unranked Competitive result confirmed afterwards rates globally but never touches finals.
    const unranked = await kit.event(null);
    await confirmGroup(unranked, 1);
    expect(await ratingEvents(unranked)).toBe(4);
    expect(await snapshots(leagueId)).toEqual(settled.versions);
    expect(await stateOf(leagueId)).toEqual(settled.state);
  });

  it('repairs a final whose eligible evidence changed, once, and is a no-op for identical input', async () => {
    const leagueId = await activeLeague();
    await confirmGroup(await kit.event(leagueId), 1);
    expect((await close(leagueId)).error).toBeNull();
    const [v1] = await snapshots(leagueId);

    const repair = async () =>
      (
        await sqlRows(`select public.league_repair_closed_standings(${L(leagueId)}) as version`)
      )[0]!['version'];
    expect(await repair()).toBeNull();
    expect(await snapshots(leagueId)).toHaveLength(1);

    // Trusted retroactive membership change makes the stored group ineligible.
    await setMembershipHistory(kit.communityId, id(3), [{ activatedAt: new Date().toISOString() }]);
    try {
      expect(await repair()).toBe(2);
      expect(await repair()).toBeNull();
      const versions = await snapshots(leagueId);
      expect(
        versions.map((row) => [row['standings_version'], row['cause'], row['included']])
      ).toEqual([
        [1, 'closed', 1],
        [2, 'repair', 0]
      ]);
      expect(versions[0]).toEqual(v1);
      expect(await standings(leagueId)).toMatchObject({ standings_version: 2, entries: [] });
      const [audit] = (await events(leagueId)).slice(-1);
      expect(audit).toMatchObject({
        action: 'standings_revised',
        actor: null,
        system_reason: 'standings_repair',
        details: { old_standings_version: 1, standings_version: 2 }
      });
    } finally {
      await setMembershipHistory(kit.communityId, id(3), [{ activatedAt: dayAgo() }]);
    }
  });

  it('repairs the final when a closed League is rebuilt, and the finalizer replay stays idempotent', async () => {
    const leagueId = await activeLeague();
    const eventId = await kit.event(leagueId);
    const proposalId = await confirmGroup(eventId, 1);
    expect((await close(leagueId)).error).toBeNull();
    const rebuild = async () =>
      asRecord(
        (await sqlRows(`select public.rebuild_league_counters(${L(leagueId)}) as result`))[0]![
          'result'
        ]
      );
    const counters = () =>
      sqlRows(
        `select user_id::text, matches from public.league_player_counters
          where league_id = ${L(leagueId)} order by user_id`
      );
    const replay = () =>
      fixtureSql(
        `select public.finalize_match_event_result_locked(${L(proposalId)}::uuid, 1, 'MANUAL', ${L(id(2))}::uuid);`
      );

    // Identical input: a rebuild of a closed League publishes nothing.
    expect(await rebuild()).toMatchObject({ repaired_standings_version: null });
    expect(await snapshots(leagueId)).toHaveLength(1);

    // Trusted retroactive change: the rebuild itself repairs the final, once.
    await setMembershipHistory(kit.communityId, id(3), [{ activatedAt: new Date().toISOString() }]);
    try {
      expect(await rebuild()).toMatchObject({ repaired_standings_version: 2 });
      expect(await counters()).toEqual([]);
      expect(await rebuild()).toMatchObject({ repaired_standings_version: null });
      expect(await standings(leagueId)).toMatchObject({
        standings_version: 2,
        cause: 'repair',
        entries: []
      });
    } finally {
      await setMembershipHistory(kit.communityId, id(3), [{ activatedAt: dayAgo() }]);
    }

    // Evidence is eligible again: rebuild revises the final back; the receipt-guarded replay adds nothing.
    expect(await rebuild()).toMatchObject({ repaired_standings_version: 3 });
    expect(await counters()).toHaveLength(4);
    const settled = { versions: await snapshots(leagueId), state: await stateOf(leagueId) };
    expect(
      settled.versions.map((row) => [row['standings_version'], row['cause'], row['included']])
    ).toEqual([
      [1, 'closed', 1],
      [2, 'repair', 0],
      [3, 'repair', 1]
    ]);
    await replay();
    expect(await snapshots(leagueId)).toEqual(settled.versions);
    expect(await stateOf(leagueId)).toEqual(settled.state);
    expect(playerRecord((await standings(leagueId)).entries)).toEqual([
      [0, 1, 1, 0],
      [1, 1, 1, 0],
      [2, 1, 0, 1],
      [3, 1, 0, 1]
    ]);
  });

  it('leaves an open League rebuild without any version', async () => {
    const leagueId = await activeLeague();
    await confirmGroup(await kit.event(leagueId), 1);
    const [row] = await sqlRows(`select public.rebuild_league_counters(${L(leagueId)}) as result`);
    expect(asRecord(row?.['result'])).toMatchObject({ repaired_standings_version: null });
    expect(await snapshots(leagueId)).toHaveLength(0);
  });

  it('reconstructs pre-existing closed Leagues from retained facts with honest provenance', async () => {
    const leagueId = await activeLeague();
    const eventId = await kit.event(leagueId);
    await confirmGroup(eventId, 1);
    const pending = await submitGroup(eventId, 2);
    expect((await close(leagueId)).error).toBeNull();
    expect((await approveGroup(pending, 2)).error).toBeNull();
    const live = await snapshots(leagueId);
    expect(live).toHaveLength(2);

    const wipe = (withCloseEvent: boolean) =>
      fixtureSql(`do $$ begin
        alter table public.league_standings_snapshots disable trigger league_standings_snapshots_immutable;
        delete from public.league_standings_snapshots where league_id = ${L(leagueId)};
        alter table public.league_standings_snapshots enable trigger league_standings_snapshots_immutable;
        alter table public.league_events disable trigger league_events_immutable;
        delete from public.league_events where league_id = ${L(leagueId)}
          and (action = 'standings_revised' ${withCloseEvent ? '' : "or action = 'closed'"});
        alter table public.league_events enable trigger league_events_immutable;
      end $$;`);
    const reconstruct = async () =>
      (await sqlRows(`select public.league_reconstruct_standings(${L(leagueId)}) as created`))[0]![
        'created'
      ];

    // With the original close event the cutoff splits version 1 from the late inclusion.
    await wipe(true);
    expect(await reconstruct()).toBe(2);
    const rebuilt = await snapshots(leagueId);
    expect(
      rebuilt.map((row) => [row['standings_version'], row['cause'], row['basis'], row['included']])
    ).toEqual([
      [1, 'reconstruction', 'reconstructed', 1],
      [2, 'late_first_confirmation', 'reconstructed', 2]
    ]);
    expect(rebuilt[1]!['trigger']).toBe(live[1]!['trigger']);
    expect(
      (await standings(leagueId)).entries.map((entry) => [entry.user_id, entry.matches])
    ).toEqual(
      (await standings(leagueId, 2)).entries.map((entry) => [entry.user_id, entry.matches])
    );
    for (const row of (await events(leagueId)).filter((r) => r['action'] === 'standings_revised'))
      expect(row).toMatchObject({ actor: null, system_reason: 'standings_reconstruction' });
    // Rerunnable: nothing more to create.
    expect(await reconstruct()).toBe(0);

    // Without a close event there is no recoverable publication moment: one honest baseline.
    await wipe(false);
    expect(await reconstruct()).toBe(1);
    expect(
      (await snapshots(leagueId)).map((row) => [
        row['standings_version'],
        row['cause'],
        row['included']
      ])
    ).toEqual([[1, 'reconstruction', 2]]);
    const baseline = (await events(leagueId)).find((row) => row['action'] === 'standings_revised');
    expect(baseline).toMatchObject({ details: { provenance: 'close_event_unavailable' } });
  });

  it('lets members read versions newest-first with safe publication facts and no write access', async () => {
    const leagueId = await activeLeague();
    const eventId = await kit.event(leagueId);
    await confirmGroup(eventId, 1);
    const pending = await submitGroup(eventId, 2);
    expect((await close(leagueId)).error).toBeNull();
    expect((await approveGroup(pending, 2)).error).toBeNull();

    const listed = await kit.rpc(kit.players[5]!, 'list_league_standings_versions', {
      p_league_id: leagueId
    });
    expect(listed.error).toBeNull();
    const history = decodeLeagueStandingsVersions(listed.data);
    expect(history.versions.map((version) => version.standings_version)).toEqual([2, 1]);
    expect(history.versions[0]).toMatchObject({
      cause: 'late_first_confirmation',
      basis: 'published',
      entry_count: 8,
      confirmation: { source: 'MANUAL' }
    });
    expect(history.next_before_version).toBeNull();
    // No actor, account or evidence identifier travels in the member payload.
    expect(JSON.stringify(listed.data)).not.toMatch(/actor|confirmation_id|proposal|user_id/);

    const older = decodeLeagueStandingsVersions(
      (
        await kit.rpc(kit.players[5]!, 'list_league_standings_versions', {
          p_league_id: leagueId,
          p_before_version: 2
        })
      ).data
    );
    expect(older.versions.map((version) => version.standings_version)).toEqual([1]);

    // Typed version errors; a live table is never addressed by version.
    const bad = await kit.rpc(kit.creator, 'get_league_standings', {
      p_league_id: leagueId,
      p_standings_version: 0
    });
    expect(bad.error?.message).toBe('LEAGUE_STANDINGS_VERSION_INVALID');
    const missing = await kit.rpc(kit.creator, 'get_league_standings', {
      p_league_id: leagueId,
      p_standings_version: 99
    });
    expect(missing.error?.message).toBe('LEAGUE_STANDINGS_VERSION_NOT_FOUND');
    const openLeague = await activeLeague();
    const live = await kit.rpc(kit.creator, 'get_league_standings', {
      p_league_id: openLeague,
      p_standings_version: 1
    });
    expect(live.error?.message).toBe('LEAGUE_STANDINGS_VERSION_INVALID');
    expect((await close(openLeague)).error).toBeNull();

    // Snapshots are immutable and unreachable for runtime roles.
    for (const statement of [
      `update public.league_standings_snapshots set cause = 'repair' where league_id = ${L(leagueId)}`,
      `delete from public.league_standings_snapshots where league_id = ${L(leagueId)}`
    ])
      await expect(fixtureSql(`${statement};`)).rejects.toThrow(
        /LEAGUE_STANDINGS_SNAPSHOT_IMMUTABLE/
      );
    const [grants] = await sqlRows(
      `select has_table_privilege('authenticated','public.league_standings_snapshots','SELECT') as sel,
              has_table_privilege('authenticated','public.league_standings_snapshots','INSERT') as ins,
              has_table_privilege('anon','public.league_standings_snapshots','SELECT') as anon_sel,
              has_table_privilege('service_role','public.league_standings_snapshots','SELECT') as service_sel,
              (select relrowsecurity from pg_class where oid = 'public.league_standings_snapshots'::regclass) as rls`
    );
    expect(grants).toEqual({
      sel: false,
      ins: false,
      anon_sel: false,
      service_sel: false,
      rls: true
    });
    const direct = await kit.creator.client.from('league_standings_snapshots').select('*');
    expect(direct.error).not.toBeNull();
  });

  it('rolls the whole close back when the final cannot be published', async () => {
    const leagueId = await activeLeague();
    await confirmGroup(await kit.event(leagueId), 1);
    const connection = await openDedicatedSqlConnection();
    let inside: Record<string, unknown>[] = [];
    try {
      await connection.query('begin');
      await connection.query(`create function public.paf_u3_forced_failure() returns trigger
        language plpgsql as $f$ begin raise exception 'PAF_U3_FORCED_FAILURE'; end $f$`);
      await connection.query(`create trigger paf_u3_forced_failure before insert on public.league_standings_snapshots
        for each row execute function public.paf_u3_forced_failure()`);
      await connection.query(`select set_config('request.jwt.claim.sub', '${id(0)}', false),
        set_config('request.jwt.claims', '{"sub":"${id(0)}","role":"authenticated"}', false)`);
      await connection.query(`do $b$ declare m text; begin
        begin
          perform public.close_league(${L(leagueId)}::uuid, 1);
        exception when others then m := sqlerrm; end;
        if m is distinct from 'PAF_U3_FORCED_FAILURE' then
          raise exception 'close did not fail as forced: %', coalesce(m, 'no error');
        end if;
      end $b$`);
      inside = (
        await connection.query(
          `select (select status::text from public.leagues where id = ${L(leagueId)}) as status,
                  (select version from public.leagues where id = ${L(leagueId)}) as version,
                  (select count(*)::int from public.league_events where league_id = ${L(leagueId)} and action = 'closed') as closes,
                  (select count(*)::int from public.league_standings_snapshots where league_id = ${L(leagueId)}) as snapshots`
        )
      ).rows;
    } finally {
      await connection.query('rollback');
      await connection.close();
    }
    expect(inside).toEqual([{ status: 'active', version: 1, closes: 0, snapshots: 0 }]);
    // The same request succeeds once publication works again.
    expect((await close(leagueId)).error).toBeNull();
    expect(await snapshots(leagueId)).toHaveLength(1);
  });

  it('has the League lifecycle runner provisioned, enabled and calling the processor', async () => {
    const jobs = await queryTrustedSql(
      `select schedule, active, command from cron.job where jobname = 'padel-friend-league-lifecycle'`
    );
    expect(jobs.rows).toHaveLength(1);
    expect(jobs.rows[0]).toMatchObject({ schedule: '* * * * *', active: true });
    expect(String(jobs.rows[0]!['command'])).toContain('process_due_leagues');
  });

  describe('lock interleavings', () => {
    const claims = (connection: DedicatedSqlConnection, userId: string) =>
      connection.query(`select set_config('request.jwt.claim.sub', '${userId}', false),
        set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', false)`);

    async function waitBlocked(blocked: DedicatedSqlConnection, holder: DedicatedSqlConnection) {
      const deadline = Date.now() + 10_000;
      for (;;) {
        const { rows } = await queryTrustedSql(
          `select 1 from pg_catalog.pg_stat_activity
            where pid = ${blocked.backendPid} and wait_event_type = 'Lock'
              and ${holder.backendPid} = any(pg_catalog.pg_blocking_pids(pid))`
        );
        if (rows.length === 1) return;
        if (Date.now() > deadline) throw new Error('contender never blocked behind the holder');
        await sleep(25);
      }
    }

    /**
     * `holderSql` runs first in an open transaction (holding the community lock); `contenderSql`
     * is issued from another backend, observed blocked behind it, then the holder commits.
     */
    async function interleave(
      holderSql: string,
      contenderSql: string,
      actors: { holder?: string; contender?: string } = {}
    ) {
      const holder = await openDedicatedSqlConnection();
      const contender = await openDedicatedSqlConnection();
      try {
        if (actors.holder) await claims(holder, actors.holder);
        if (actors.contender) await claims(contender, actors.contender);
        await holder.query('begin');
        await holder.query(holderSql);
        const outcome = contender.query(contenderSql).then(
          (result) => ({ rows: result.rows, error: null as Error | null }),
          (error: Error) => ({ rows: [], error })
        );
        await waitBlocked(contender, holder);
        await holder.query('commit');
        return await outcome;
      } finally {
        await holder.query('rollback').catch(() => undefined);
        await Promise.all([holder.close(), contender.close()]);
      }
    }

    const closeSql = (leagueId: string, version = 1) =>
      `select public.close_league(${L(leagueId)}::uuid, ${version})`;

    it('close waiting behind a confirmation includes it in version 1; the reverse order revises as version 2', async () => {
      // Confirmation wins the lock race.
      const firstLeague = await activeLeague();
      const firstEvent = await kit.event(firstLeague);
      await confirmGroup(firstEvent, 1);
      const firstPending = await submitGroup(firstEvent, 2);
      const confirmFirst = await interleave(
        await finalizeAuto(firstPending),
        closeSql(firstLeague),
        { contender: id(0) }
      );
      expect(confirmFirst.error).toBeNull();
      expect(
        (await snapshots(firstLeague)).map((row) => [row['standings_version'], row['included']])
      ).toEqual([[1, 2]]);
      expect(await ratingEvents(firstEvent)).toBe(8);

      // Close wins the lock race: the same confirmation becomes the late version 2.
      const secondLeague = await activeLeague();
      const secondEvent = await kit.event(secondLeague);
      await confirmGroup(secondEvent, 1);
      const secondPending = await submitGroup(secondEvent, 2);
      const confirmSecond = await interleave(
        closeSql(secondLeague),
        await finalizeAuto(secondPending),
        { holder: id(0) }
      );
      expect(confirmSecond.error).toBeNull();
      expect(
        (await snapshots(secondLeague)).map((row) => [
          row['standings_version'],
          row['cause'],
          row['included']
        ])
      ).toEqual([
        [1, 'closed', 1],
        [2, 'late_first_confirmation', 2]
      ]);
      expect(await ratingEvents(secondEvent)).toBe(8);

      // Both orders converge on the same final standings.
      expect(playerRecord((await standings(secondLeague)).entries)).toEqual(
        playerRecord((await standings(firstLeague)).entries)
      );
      // Exactly one confirmation, one receipt and one close per League in either order.
      for (const [leagueId, eventId] of [
        [firstLeague, firstEvent],
        [secondLeague, secondEvent]
      ] as const) {
        expect((await kit.sideEffects(eventId))['confirmations']).toBe(2);
        const [counts] = await sqlRows(
          `select (select count(*)::int from public.league_projection_confirmations where league_id = ${L(leagueId)}) as receipts,
                  (select count(*)::int from public.league_events where league_id = ${L(leagueId)} and action = 'closed') as closes`
        );
        expect(counts).toEqual({ receipts: 2, closes: 1 });
      }
    });

    it('simultaneous closes converge on one close, one version and one audit entry', async () => {
      const leagueId = await activeLeague();
      await confirmGroup(await kit.event(leagueId), 1);
      const racer = await interleave(closeSql(leagueId), closeSql(leagueId), {
        holder: id(0),
        contender: id(0)
      });
      expect(racer.error).toBeNull();
      expect(await snapshots(leagueId)).toHaveLength(1);
      expect((await events(leagueId)).filter((row) => row['action'] === 'closed')).toHaveLength(1);
      expect(await leagueRow(leagueId)).toMatchObject({ status: 'closed', version: 2 });
    });

    it('close racing a member leaving keeps the earned row in the final in either order', async () => {
      const membershipOf = async () =>
        String(
          (
            await sqlRows(
              `select id::text as id from public.community_members
                where community_id = ${L(kit.communityId)} and user_id = ${L(id(3))} and valid_until is null`
            )
          )[0]!['id']
        );
      const leaveSql = async () =>
        `select public.govern_community_member(${L(kit.communityId)}::uuid, ${L(await membershipOf())}::uuid, 'remove')`;

      const leagueId = await activeLeague();
      await confirmGroup(await kit.event(leagueId), 1);
      const leaveFirst = await interleave(await leaveSql(), closeSql(leagueId), {
        holder: id(0),
        contender: id(0)
      });
      expect(leaveFirst.error).toBeNull();
      const v1 = await standings(leagueId);
      expect(v1.entries.map((entry) => indexOf(entry.user_id)).sort((a, b) => a - b)).toEqual([
        0, 1, 2, 3
      ]);
      await setMembershipHistory(kit.communityId, id(3), [{ activatedAt: dayAgo() }]);

      // Leaving after the close never revises the final.
      const stable = await snapshots(leagueId);
      const other = await activeLeague();
      await confirmGroup(await kit.event(other), 1);
      const closeFirst = await interleave(closeSql(other), await leaveSql(), {
        holder: id(0),
        contender: id(0)
      });
      expect(closeFirst.error).toBeNull();
      expect(await snapshots(other)).toHaveLength(1);
      expect(playerRecord((await standings(other)).entries)).toEqual(playerRecord(v1.entries));
      expect(await snapshots(leagueId)).toEqual(stable);
      await setMembershipHistory(kit.communityId, id(3), [{ activatedAt: dayAgo() }]);
    });

    it('competing activations of two due Upcoming Leagues leave exactly one Active, and the old League stays readable', async () => {
      const archived = await activeLeague();
      await confirmGroup(await kit.event(archived), 1);
      expect((await close(archived)).error).toBeNull();

      const past = new Date(Date.now() - 3_600_000).toISOString();
      const [a, b] = await Promise.all([
        kit.league({ status: 'upcoming', endMode: 'manual', endAt: null, startAt: past }),
        kit.league({ status: 'upcoming', endMode: 'manual', endAt: null, startAt: past })
      ]);
      const activate = (leagueId: string) =>
        `select public.activate_league(${L(leagueId)}::uuid, 1)`;
      const raced = await interleave(activate(a), activate(b), {
        holder: id(0),
        contender: id(0)
      });
      expect(raced.error?.message).toMatch(/LEAGUE_VERSION_CONFLICT|LEAGUE_ACTIVE_EXISTS/);
      const [activeRow] = await sqlRows(
        `select count(*)::int as active from public.leagues
          where community_id = ${L(kit.communityId)} and status = 'active'`
      );
      expect(activeRow).toEqual({ active: 1 });

      // The retained archive is still viewable while a successor is Active.
      expect(await standings(archived)).toMatchObject({ source: 'final', standings_version: 1 });
      // Free the slot for the next test.
      const [current] = await sqlRows(
        `select id::text, version from public.leagues
          where community_id = ${L(kit.communityId)} and status = 'active'`
      );
      expect((await close(String(current?.['id']), Number(current?.['version']))).error).toBeNull();
    });
  });
});

describe.skipIf(!environment.env)(
  'League final standings authorization',
  { timeout: 300_000 },
  () => {
    let world: LeagueWorld;

    beforeAll(async () => {
      world = await leagueWorld(environment.env!, 'lg-final');
    });

    const manualLeague = (ownerId = world.owner.id) =>
      insertLeague({
        communityId: world.communityId,
        ownerId,
        startAt: '2020-01-01T00:00:00Z',
        endAt: null,
        status: 'active'
      });
    const close = (actor: LeagueActor, leagueId: string) =>
      actor.client.rpc('close_league', { p_league_id: leagueId, p_expected_version: 1 });

    it('lets only the owner or an Admin close; everyone else is refused with no side effects', async () => {
      const leagueId = await manualLeague();
      expect((await close(world.member, leagueId)).error?.message).toBe('LEAGUE_FORBIDDEN');
      expect((await close(world.outsider, leagueId)).error?.message).toBe('LEAGUE_NOT_FOUND');
      expect((await close(world.former, leagueId)).error?.message).toBe('LEAGUE_NOT_FOUND');
      expect((await close(world.provisional, leagueId)).error).not.toBeNull();
      expect(await leagueRow(leagueId)).toMatchObject({ status: 'active', version: 1 });
      expect(
        await sqlRows(
          `select 1 from public.league_standings_snapshots where league_id = ${L(leagueId)}`
        )
      ).toHaveLength(0);

      expect((await close(world.owner, leagueId)).error).toBeNull();
      // The replay is authorized too: a member cannot learn the outcome by retrying.
      expect((await close(world.member, leagueId)).error?.message).toBe('LEAGUE_FORBIDDEN');
      expect((await close(world.owner, leagueId)).error).toBeNull();
      expect((await close(world.admin, leagueId)).error).toBeNull();

      const adminLeague = await manualLeague();
      expect((await close(world.admin, adminLeague)).error).toBeNull();
    });

    it('exposes the audit to owner/Admin only and the versions to every active member', async () => {
      const leagueId = await manualLeague();
      expect((await close(world.owner, leagueId)).error).toBeNull();
      const rpc = (
        actor: LeagueActor,
        name:
          | 'get_league_standings_audit'
          | 'list_league_standings_versions'
          | 'get_league_standings'
      ) => actor.client.rpc(name, { p_league_id: leagueId });

      for (const actor of [world.owner, world.admin]) {
        const audit = await rpc(actor, 'get_league_standings_audit');
        expect(audit.error).toBeNull();
        const decoded = decodeLeagueStandingsAudit(audit.data);
        expect(decoded.events).toHaveLength(1);
        expect(decoded.events[0]).toMatchObject({
          action: 'closed',
          actor_id: world.owner.id,
          details: { standings_version: 1 }
        });
      }
      expect((await rpc(world.member, 'get_league_standings_audit')).error?.message).toBe(
        'LEAGUE_FORBIDDEN'
      );
      for (const actor of [world.outsider, world.former])
        for (const name of [
          'get_league_standings_audit',
          'list_league_standings_versions',
          'get_league_standings'
        ] as const)
          expect((await rpc(actor, name)).error?.message).toBe('LEAGUE_NOT_FOUND');
      for (const name of [
        'get_league_standings_audit',
        'list_league_standings_versions',
        'get_league_standings'
      ] as const)
        expect((await rpc(world.provisional, name)).error).not.toBeNull();
      for (const name of ['list_league_standings_versions', 'get_league_standings'] as const)
        expect((await rpc(world.member, name)).error).toBeNull();

      // Unknown League and unknown community-scope are indistinguishable from an unreadable one.
      const unknown = await world.outsider.client.rpc('get_league_standings_audit', {
        p_league_id: crypto.randomUUID()
      });
      expect(unknown.error?.message).toBe('LEAGUE_NOT_FOUND');
    });

    it('denies a removed owner who is no longer a member', async () => {
      const owner = world.member;
      const leagueId = await manualLeague(owner.id);
      await world.removeMember(owner);
      expect((await close(owner, leagueId)).error?.message).toBe('LEAGUE_NOT_FOUND');
      expect(await leagueRow(leagueId)).toMatchObject({ status: 'active' });
      // An Admin can still close it.
      expect((await close(world.admin, leagueId)).error).toBeNull();
    });
  }
);
