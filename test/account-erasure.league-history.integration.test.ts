import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  confirmGroup,
  eraseAccount,
  scalar,
  tablesMentioning
} from './helpers/account-erasure-fixtures';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, fixtureSql, sqlRows } from './helpers/match-registration-sql';
import { sqlText } from './helpers/provisional-player-fixtures';
import { createRankedResultFixtures, type RankedResultKit } from './helpers/ranked-result-fixtures';
import { trustedClient } from './helpers/trusted-client';

const environment = localSupabaseEnv();
const L = sqlText;

/**
 * Retained league history after an erasure: published standings keep no copied name (F54), the counter rebuild
 * keeps working for a withdrawn identity without creating participation (F56), and the history tables no longer
 * expose the stable tombstone id through the Data API (F57).
 */
describe.skipIf(!environment.env)('Erasure: retained league history', { timeout: 600_000 }, () => {
  let kit: RankedResultKit;
  let closedLeague: string;
  let openLeague: string;
  let openEvent: string;
  let tombstone: string;
  const SUBJECT = 3;
  const id = (index: number) => kit.players[index]!.id;
  const nameOf = (index: number) => 'Ranked Player ' + String(index + 1);
  const entries = async (leagueId: string): Promise<Array<Record<string, unknown>>> => {
    const row = asRecord(
      (
        await sqlRows(
          'select entries from public.league_standings_snapshots where league_id = ' +
            L(leagueId) +
            ' order by standings_version desc limit 1'
        )
      )[0]
    );
    const value = row['entries'];
    if (!Array.isArray(value)) throw new Error('Standings entries missing');
    return value.map((entry) => asRecord(entry));
  };

  beforeAll(async () => {
    kit = await createRankedResultFixtures(environment.env!);
    closedLeague = await kit.league({ status: 'active', endMode: 'manual', endAt: null });
    const closedEvent = await kit.event(closedLeague);
    await confirmGroup(kit, closedEvent, 1);
    await confirmGroup(kit, closedEvent, 2);
    const closed = await kit.rpc(kit.players[0]!, 'close_league', {
      p_league_id: closedLeague,
      p_expected_version: 1
    });
    if (closed.error) throw new Error('Fixture close failed: ' + closed.error.message);
    openLeague = await kit.league({ status: 'active', endMode: 'manual', endAt: null });
    openEvent = await kit.event(openLeague);
    await confirmGroup(kit, openEvent, 1);
  });
  afterAll(async () => {
    if (kit) await kit.cleanup();
  });

  it('F54: erasing a ranked player removes the copied name from the published standings and nothing else', async () => {
    const before = await entries(closedLeague);
    expect(JSON.stringify(before)).toContain(nameOf(SUBJECT));
    const survivorsBefore = before.filter((entry) => entry['user_id'] !== id(SUBJECT));
    expect(survivorsBefore.length).toBeGreaterThan(0);

    await eraseAccount(id(SUBJECT));
    expect(await tablesMentioning(id(SUBJECT))).toEqual([]);

    const after = await entries(closedLeague);
    expect(JSON.stringify(after)).not.toContain(nameOf(SUBJECT));
    // The subject's entry stays (the position is history) with its name removed: the key remains null for the decoder.
    const former = after.filter(
      (entry) => !survivorsBefore.some((survivor) => survivor['user_id'] === entry['user_id'])
    );
    expect(former).toHaveLength(1);
    expect(former[0]).toHaveProperty('display_name', null);
    tombstone = String(former[0]!['user_id']);
    // Every other participant's entry is byte-identical.
    expect(after.filter((entry) => entry['user_id'] !== tombstone)).toEqual(survivorsBefore);

    // The reader contract: the entry keeps a scope-local ref, no name; the decoder renders the placeholder.
    const read = await kit.rpc(kit.players[0]!, 'get_league_standings', {
      p_league_id: closedLeague,
      p_standings_version: null
    });
    expect(read.error).toBeNull();
    const body = JSON.stringify(read.data);
    expect(body).not.toContain(nameOf(SUBJECT));
    expect(body).not.toContain(tombstone);
    expect(body).toContain(nameOf(0));
  });

  it('F56: a counter rebuild succeeds for a withdrawn identity, creates no participation and later results confirm', async () => {
    const counters = async (leagueId: string, user: string) =>
      Number(
        await scalar(
          'select count(*)::int from public.league_player_counters where league_id = ' +
            L(leagueId) +
            ' and user_id = ' +
            L(user)
        )
      );
    const snapshot = async (leagueId: string) =>
      sqlRows(
        'select user_id::text as u, matches, wins, losses, draws, sets_won, sets_lost from public.league_player_counters where league_id = ' +
          L(leagueId) +
          ' order by user_id'
      );
    // The open league keeps the withdrawn identity's earned row (counters are re-keyed, never deleted).
    expect(await counters(openLeague, tombstone)).toBe(1);
    const before = await snapshot(openLeague);
    const rebuild = (leagueId: string) =>
      fixtureSql('select public.league_rebuild_counters_core(' + L(leagueId) + ')');

    // Existing row: the upsert path is allowed and changes nothing.
    await rebuild(openLeague);
    expect(await snapshot(openLeague)).toEqual(before);

    // A later confirmed result of the league (the rebuild/projection path) still goes through.
    await confirmGroup(kit, openEvent, 2);
    expect(await counters(openLeague, tombstone)).toBe(1);
    expect((await snapshot(openLeague)).filter((row) => row['u'] === tombstone)).toEqual(
      before.filter((row) => row['u'] === tombstone)
    );
    expect(await counters(openLeague, id(4))).toBe(1);

    // A row that does not exist is never resurrected for a withdrawn identity, and the rebuild still succeeds.
    await fixtureSql(
      'delete from public.league_player_counters where league_id = ' +
        L(openLeague) +
        ' and user_id = ' +
        L(tombstone)
    );
    const others = (await snapshot(openLeague)).filter((row) => row['u'] !== tombstone);
    await rebuild(openLeague);
    expect(await counters(openLeague, tombstone)).toBe(0);
    expect((await snapshot(openLeague)).filter((row) => row['u'] !== tombstone)).toEqual(others);

    // New live participation of a withdrawn identity stays rejected.
    await expect(
      fixtureSql(
        'insert into public.league_player_counters(league_id, community_id, user_id) values (' +
          [L(openLeague), L(kit.communityId), L(tombstone)].join(', ') +
          ')'
      )
    ).rejects.toThrow(/PARTICIPANT_WITHDRAWN/);
  });

  it('F57: the history tables expose no tombstone id to the Data API; the RPC readers keep working', async () => {
    const asPlayer = kit.players[0]!.client;
    const closed = [
      ['match_event_result_reviews', 'reviewer_user_id'],
      ['match_event_result_confirmations', 'actor_id'],
      ['match_event_audit_log', 'actor_id'],
      ['result_amendment_events', 'actor_id'],
      ['result_amendment_requests', 'requester_id'],
      ['result_amendment_requests', 'decision_actor_id'],
      ['result_dispute_resolutions', 'actor_id'],
      ['result_repair_jobs', 'requested_by']
    ] as const;
    for (const [table, column] of closed) {
      const denied = await asPlayer.from(table).select(column).limit(1);
      expect([table, denied.error?.code]).toEqual([table, '42501']);
      // The service role keeps whatever it had (this revoke touches only anon/authenticated).
      const had = await scalar(
        "select has_table_privilege('service_role', 'public." + table + "', 'SELECT')"
      );
      const served = await trustedClient().from(table).select(column).limit(1);
      expect([table, served.error === null || had === false]).toEqual([table, true]);
    }
    // The sanitizing readers still answer: the results reader hides the stable id behind a scope-local ref.
    const results = await kit.rpc(kit.players[0]!, 'get_match_event_official_results', {
      p_match_event_id: openEvent
    });
    expect(results.error).toBeNull();
    expect(JSON.stringify(results.data)).not.toContain(tombstone);
  });
});
