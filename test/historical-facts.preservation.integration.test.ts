import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  decodeGroupDetail,
  decodeHistoryPage
} from '../src/features/statistics/statistics-decoders';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, fixtureSql, sqlRows } from './helpers/match-registration-sql';
import { sqlText } from './helpers/provisional-player-fixtures';
import {
  createRankedResultFixtures,
  playedAt,
  type RankedResultKit
} from './helpers/ranked-result-fixtures';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
const L = (id: string) => sqlText(id);
const idList = (values: string[]) => values.map(L).join(',');
const deniedLeague = { code: 'P0002', message: 'LEAGUE_NOT_FOUND' };
const READERS = [
  'get_league',
  'get_league_standings',
  'get_league_counters',
  'list_league_standings_versions'
] as const;
const REQUIRED_NONEMPTY = [
  'match_events',
  'match_event_result_proposals',
  'match_event_result_proposal_versions',
  'match_event_result_confirmations',
  'match_event_result_official_state',
  'leagues',
  'league_events',
  'league_event_references',
  'league_player_counters',
  'league_projection_confirmations',
  'league_standings_snapshots',
  'statistics_group_facts',
  'statistics_participant_facts'
];

type Scope = { events: string[]; proposals: string[]; leagues: string[] };
type Capture = Record<string, string[]>;
type Actor = RankedResultKit['creator'];

/** Full-row, canonically ordered evidence per sporting table, scoped to the fixture identities. */
async function captureSportingRows(scope: Scope): Promise<Capture> {
  const events = idList(scope.events);
  const proposals = idList(scope.proposals);
  const leagues = idList(scope.leagues);
  const tables: Record<string, string> = {
    match_events: 'id in (' + events + ')',
    match_event_result_proposals: 'match_event_id in (' + events + ')',
    match_event_result_proposal_versions: 'proposal_id in (' + proposals + ')',
    match_event_result_reviews: 'proposal_id in (' + proposals + ')',
    match_event_result_confirmations: 'match_event_id in (' + events + ')',
    match_event_result_official_state: 'match_event_id in (' + events + ')',
    leagues: 'id in (' + leagues + ')',
    league_events: 'league_id in (' + leagues + ')',
    league_event_references: 'league_id in (' + leagues + ')',
    league_player_counters: 'league_id in (' + leagues + ')',
    league_projection_confirmations: 'league_id in (' + leagues + ')',
    league_standings_snapshots: 'league_id in (' + leagues + ')',
    statistics_group_facts: 'match_event_id in (' + events + ')',
    statistics_participant_facts: 'game_group_id in (' + proposals + ')',
    statistics_pair_facts: 'game_group_id in (' + proposals + ')',
    statistics_opponent_facts: 'game_group_id in (' + proposals + ')',
    statistics_league_positions: 'league_id in (' + leagues + ')'
  };
  const capture: Capture = {};
  for (const [table, predicate] of Object.entries(tables)) {
    const rows = await sqlRows(
      'select to_jsonb(t)::text as row from public.' +
        table +
        ' t where ' +
        predicate +
        ' order by to_jsonb(t)::text'
    );
    capture[table] = rows.map((row) => String(row['row']));
  }
  return capture;
}

/** The single comparison the certification uses: every table, row count, ID and full value. */
function assertCaptureUnchanged(actual: Capture, baseline: Capture) {
  expect(Object.keys(actual).sort((a, b) => a.localeCompare(b))).toEqual(
    Object.keys(baseline).sort((a, b) => a.localeCompare(b))
  );
  for (const table of Object.keys(baseline)) expect(actual[table]).toEqual(baseline[table]);
}

const userRows = (value: unknown, userIds: Set<string>): unknown[] => {
  if (Array.isArray(value))
    return value.flatMap((item) => {
      const record = asRecord(item);
      return typeof record['user_id'] === 'string' && userIds.has(record['user_id'])
        ? [item]
        : userRows(item, userIds);
    });
  return typeof value === 'object' && value !== null
    ? Object.values(value).flatMap((item) => userRows(item, userIds))
    : [];
};
const withoutViewerFields = (detail: unknown) => {
  const record = asRecord(detail);
  return {
    ...record,
    access_mode: null,
    league: { ...asRecord(record['league']), can_manage: null }
  };
};

/**
 * PAF-47: membership end (leave or Admin removal) never deletes or mutates a match or League
 * fact, and the production readers keep serving identical facts to the former participant.
 * Group 1 = players 0-3 (player 0 is the retained Admin; player 1 sits on the Admin's side and is
 * the former participant). Group 2 = players 4-7 (confirmed late in the closed League only).
 */
describe.skipIf(!environment.env).each(['leave', 'admin removal'] as const)(
  'Historical fact preservation after membership end by %s',
  { timeout: 900_000 },
  (path) => {
    let kit: RankedResultKit;
    let nonPlaying: Actor;
    let neverMember: Actor;
    let closedLeague: string;
    let openLeague: string;
    let unrelatedLeague: string;
    let scope: Scope;
    let groupByEvent: Record<string, string>;
    let before: Capture;
    let afterTransition: Capture;
    let afterReads: Capture;
    let earnedIds: Set<string>;
    let formerBefore: Reading;
    let adminBefore: Reading;
    let formerAfter: Reading;
    let adminAfter: Reading;

    const P = (index: number) => kit.players[index]!;
    const ADMIN = 0;
    const FORMER = 1;
    type Reading = Awaited<ReturnType<typeof readAs>>;

    async function confirmGroup(eventId: string, groupNumber: number, approve = true) {
      const submitted = await kit.submit(eventId, playedAt(120).played, { groupNumber });
      expect(submitted.error).toBeNull();
      const proposalId = String(asRecord(submitted.data)['proposal_id']);
      if (!approve) return proposalId;
      const first = (groupNumber - 1) * 4;
      const approvers = groupNumber === 1 ? [first + 2] : [first, first + 2];
      for (const index of approvers)
        expect((await kit.approve(proposalId, 1, kit.players[index])).error).toBeNull();
      return proposalId;
    }

    /** One caller's production history/detail and League readers over the fixture scope. */
    async function readAs(actor: Actor) {
      const page = await actor.client.rpc('list_statistics_history', {});
      expect(page.error).toBeNull();
      const items = decodeHistoryPage(page.data).items.filter(
        (item) => item.game_group_id && scope.proposals.includes(item.game_group_id)
      );
      const details = [];
      for (const eventId of scope.events) {
        const detail = await actor.client.rpc('get_statistics_group_detail', {
          p_event_id: eventId,
          p_game_group_id: groupByEvent[eventId]!
        });
        expect(detail.error).toBeNull();
        details.push(decodeGroupDetail(detail.data));
      }
      const leagues: Record<string, Record<string, unknown>> = {};
      for (const leagueId of scope.leagues) {
        const calls = {
          get_league: { p_league_id: leagueId },
          get_league_standings: { p_league_id: leagueId, p_standings_version: null },
          get_league_counters: { p_league_id: leagueId },
          list_league_standings_versions: { p_league_id: leagueId, p_before_version: null }
        };
        const read: Record<string, unknown> = {};
        for (const name of READERS) {
          const response = await actor.client.rpc(name, calls[name]);
          expect(response.error).toBeNull();
          read[name] = response.data;
        }
        if (leagueId === closedLeague)
          for (const version of [1, 2]) {
            const published = await actor.client.rpc('get_league_standings', {
              p_league_id: leagueId,
              p_standings_version: version
            });
            expect(published.error).toBeNull();
            read['version_' + version] = published.data;
          }
        leagues[leagueId] = read;
      }
      return { items, details, leagues };
    }

    async function endMembership(actor: Actor) {
      if (path === 'leave') {
        const left = await kit.rpc(actor, 'leave_community', { p_community_id: kit.communityId });
        expect(left.error).toBeNull();
        return;
      }
      const [row] = await sqlRows(
        'select id::text as id from public.community_members where community_id = ' +
          L(kit.communityId) +
          ' and user_id = ' +
          L(actor.id) +
          ' and valid_until is null'
      );
      const removed = await kit.rpc(P(ADMIN), 'govern_community_member', {
        p_community_id: kit.communityId,
        p_membership_id: String(row?.['id']),
        p_action: 'remove'
      });
      expect(removed.error).toBeNull();
    }

    beforeAll(async () => {
      kit = await createRankedResultFixtures(environment.env!, {
        levels: [4, 4, 4, 4, 4, 4, 4, 4]
      });
      await fixtureSql(
        "update public.communities set visibility = 'private' where id = " +
          L(kit.communityId) +
          ';'
      );
      nonPlaying = await kit.member();
      neverMember = await kit.actor();

      // The closed League (published versions 1 and 2) is closed BEFORE the baseline capture.
      closedLeague = await kit.league({ status: 'active', endMode: 'manual', endAt: null });
      const closedEvent = await kit.event(closedLeague);
      const closedGroup1 = await confirmGroup(closedEvent, 1);
      const closedGroup2 = await confirmGroup(closedEvent, 2, false);
      for (const step of [
        await kit.rpc(P(ADMIN), 'close_league', {
          p_league_id: closedLeague,
          p_expected_version: 1
        }),
        await kit.approve(closedGroup2, 1, P(4)),
        await kit.approve(closedGroup2, 1, P(6))
      ])
        if (step.error) throw new Error('Fixture step failed: ' + step.error.message);

      openLeague = await kit.league({ status: 'active', endMode: 'manual', endAt: null });
      const openEvent = await kit.event(openLeague);
      const openGroup1 = await confirmGroup(openEvent, 1);
      unrelatedLeague = await kit.league({ status: 'upcoming' });

      scope = {
        events: [closedEvent, openEvent],
        proposals: [closedGroup1, closedGroup2, openGroup1],
        leagues: [closedLeague, openLeague]
      };
      groupByEvent = { [closedEvent]: closedGroup1, [openEvent]: openGroup1 };

      before = await captureSportingRows(scope);
      earnedIds = new Set(
        (
          await sqlRows(
            'select distinct user_id::text as id from public.league_player_counters where matches > 0 and league_id in (' +
              idList(scope.leagues) +
              ')'
          )
        ).map((row) => String(row['id']))
      );
      formerBefore = await readAs(P(FORMER));
      adminBefore = await readAs(P(ADMIN));

      await endMembership(P(FORMER));
      await endMembership(nonPlaying);
      afterTransition = await captureSportingRows(scope);
      formerAfter = await readAs(P(FORMER));
      adminAfter = await readAs(P(ADMIN));
      afterReads = await captureSportingRows(scope);
    });
    afterAll(async () => {
      if (kit) await kit.cleanup();
    });

    it('seeds a nonempty baseline of confirmed match and League facts with known values', async () => {
      for (const table of REQUIRED_NONEMPTY) expect(before[table]!.length).toBeGreaterThan(0);
      expect(before['match_events']).toHaveLength(2);
      expect(before['match_event_result_proposals']).toHaveLength(3);
      expect(before['match_event_result_confirmations']).toHaveLength(3);
      expect(before['statistics_group_facts']).toHaveLength(3);
      expect(before['statistics_participant_facts']).toHaveLength(12);
      expect(before['league_standings_snapshots']).toHaveLength(2); // closed League versions 1, 2
      expect(earnedIds.has(P(FORMER).id)).toBe(true);
      // Independently known score: rankedSets, team A (players 0-1) wins the first group.
      const detail = formerBefore.details[0]!;
      expect(detail.game_group_id).toBe(scope.proposals[0]);
      expect(detail.result.classification).toBe('team_a');
      expect(
        formerBefore.items
          .map((item) => item.game_group_id)
          .sort((a, b) => String(a).localeCompare(String(b)))
      ).toEqual([scope.proposals[0]!, scope.proposals[2]!].sort((a, b) => a.localeCompare(b)));
      expect(formerBefore.items.every((item) => item.status === 'played')).toBe(true);
    });

    it('ends both memberships through the real command and keeps the Admin active', async () => {
      const [former] = await sqlRows(
        'select count(*) filter (where valid_until is null and status = ' +
          "'active'" +
          ')::int as active, count(*)::int as total from public.community_members where community_id = ' +
          L(kit.communityId) +
          ' and user_id = ' +
          L(P(FORMER).id)
      );
      expect(former).toEqual({ active: 0, total: 1 });
      const [left] = await sqlRows(
        'select count(*)::int as n from public.community_members where community_id = ' +
          L(kit.communityId) +
          ' and user_id = ' +
          L(nonPlaying.id) +
          " and valid_until is null and status = 'active'"
      );
      expect(left).toEqual({ n: 0 });
      const [admin] = await sqlRows(
        'select role, status from public.community_members where community_id = ' +
          L(kit.communityId) +
          ' and user_id = ' +
          L(P(ADMIN).id) +
          ' and valid_until is null'
      );
      expect(admin).toEqual({ role: 'admin', status: 'active' });
    });

    it('deletes and mutates no match, result, confirmation, counter, standings or snapshot row', async () => {
      assertCaptureUnchanged(afterTransition, before);
      assertCaptureUnchanged(afterReads, before);
      expect(Object.keys(afterReads)).toEqual(Object.keys(before));
    });

    it('serves identical own history and detail to the former participant before and after', async () => {
      expect(formerAfter.items).toEqual(formerBefore.items);
      expect(formerAfter.details).toEqual(formerBefore.details);
      expect(formerAfter.items).toHaveLength(2);
      expect(formerAfter.details).toHaveLength(2);
    });

    it('serves identical history and detail to the former participant and the retained Admin', async () => {
      expect(adminAfter.items).toEqual(adminBefore.items);
      expect(adminAfter.details).toEqual(adminBefore.details);
      // Same side of the same groups: every field, including viewer-specific ones, is equal.
      expect(formerAfter.items).toEqual(adminAfter.items);
      expect(formerAfter.details).toEqual(adminAfter.details);
      expect(formerAfter.items.map((item) => item.game_group_id)).toEqual(
        adminAfter.items.map((item) => item.game_group_id)
      );
    });

    it('serves identical League facts to the former participant before and after, closed in full', async () => {
      for (const reading of [
        { before: formerBefore, after: formerAfter },
        { before: adminBefore, after: adminAfter }
      ]) {
        const closed = reading.after.leagues[closedLeague]!;
        const closedBefore = reading.before.leagues[closedLeague]!;
        expect(withoutViewerFields(closed['get_league'])).toEqual(
          withoutViewerFields(closedBefore['get_league'])
        );
        for (const key of [
          'get_league_standings',
          'get_league_counters',
          'list_league_standings_versions',
          'version_1',
          'version_2'
        ])
          expect(closed[key]).toEqual(closedBefore[key]);
      }
      expect(asRecord(formerAfter.leagues[closedLeague]!['version_1'])).toMatchObject({
        source: 'final',
        standings_version: 1,
        latest_standings_version: 2
      });
    });

    it('serves identical League facts to the former participant and the retained Admin', async () => {
      for (const leagueId of scope.leagues) {
        const former = formerAfter.leagues[leagueId]!;
        const admin = adminAfter.leagues[leagueId]!;
        expect(asRecord(former['get_league'])['access_mode']).toBe('former_participant');
        expect(asRecord(admin['get_league'])['access_mode']).toBe('member');
        expect(withoutViewerFields(former['get_league'])).toEqual(
          withoutViewerFields(admin['get_league'])
        );
        expect(asRecord(asRecord(former['get_league'])['league'])['can_manage']).toBe(false);
        expect(former['get_league_standings']).toEqual(admin['get_league_standings']);
        expect(former['get_league_counters']).toEqual(admin['get_league_counters']);
        expect(former['list_league_standings_versions']).toEqual(
          admin['list_league_standings_versions']
        );
      }
      for (const key of ['version_1', 'version_2'])
        expect(formerAfter.leagues[closedLeague]![key]).toEqual(
          adminAfter.leagues[closedLeague]![key]
        );
    });

    it('keeps earned rows of the former participant in open and closed counters and standings', async () => {
      for (const leagueId of scope.leagues) {
        const counters = formerAfter.leagues[leagueId]!['get_league_counters'];
        const counterRows = userRows(counters, new Set([P(FORMER).id]));
        expect(counterRows).toHaveLength(1);
        expect(asRecord(counterRows[0])['matches']).toBeGreaterThan(0);
        expect(
          userRows(formerAfter.leagues[leagueId]!['get_league_standings'], new Set([P(FORMER).id]))
        ).not.toHaveLength(0);
        // Earned rows (all players with matches) are identical to the pre-membership-end reads;
        // only a non-earned zero-match overlay of the open roster may legitimately differ.
        // The live open table ranks ties across the roster, so removing the non-playing member's
        // zero-match overlay can move the tied tail's derived `position`; every stored earned value
        // (counters, wins, sets, matches_remaining) stays identical. The closed table is compared
        // in full above, including positions.
        const comparable = (reading: Reading, key: string) =>
          userRows(reading.leagues[leagueId]![key], earnedIds).map((row) => {
            const { position, ...rest } = asRecord(row);
            return leagueId === openLeague && key === 'get_league_standings'
              ? rest
              : { ...rest, position };
          });
        for (const key of ['get_league_counters', 'get_league_standings']) {
          expect(comparable(formerAfter, key)).toEqual(comparable(formerBefore, key));
          expect(comparable(adminAfter, key)).toEqual(comparable(adminBefore, key));
        }
      }
      const stored = await sqlRows(
        'select league_id::text as league_id, matches from public.league_player_counters where user_id = ' +
          L(P(FORMER).id) +
          ' and league_id in (' +
          idList(scope.leagues) +
          ') order by league_id'
      );
      expect(
        stored.map((row) => String(row['league_id'])).sort((a, b) => a.localeCompare(b))
      ).toEqual([...scope.leagues].sort((a, b) => a.localeCompare(b)));
      expect(stored.every((row) => Number(row['matches']) > 0)).toBe(true);
    });

    it('keeps a non-playing former member and a never-member out of every League reader', async () => {
      for (const actor of [nonPlaying, neverMember])
        for (const leagueId of [...scope.leagues, unrelatedLeague]) {
          const calls = {
            get_league: { p_league_id: leagueId },
            get_league_standings: { p_league_id: leagueId, p_standings_version: null },
            get_league_counters: { p_league_id: leagueId },
            list_league_standings_versions: { p_league_id: leagueId, p_before_version: null }
          };
          for (const name of READERS) {
            const response = await actor.client.rpc(name, calls[name]);
            expect(response.data).toBeNull();
            expect(response.error).toMatchObject(deniedLeague);
          }
        }
    });

    it('denies the former participant an unrelated League of the same community', async () => {
      for (const name of READERS) {
        const response = await P(FORMER).client.rpc(name, {
          p_league_id: unrelatedLeague,
          ...(name === 'get_league_standings' ? { p_standings_version: null } : {}),
          ...(name === 'list_league_standings_versions' ? { p_before_version: null } : {})
        });
        expect(response.error).toMatchObject(deniedLeague);
      }
    });

    it('denies non-participants the statistics group detail and gives them no foreign history', async () => {
      for (const actor of [nonPlaying, neverMember]) {
        const page = await actor.client.rpc('list_statistics_history', {});
        expect(page.error).toBeNull();
        expect(
          decodeHistoryPage(page.data).items.filter(
            (item) => item.game_group_id && scope.proposals.includes(item.game_group_id)
          )
        ).toEqual([]);
        for (const eventId of scope.events) {
          const denied = await actor.client.rpc('get_statistics_group_detail', {
            p_event_id: eventId,
            p_game_group_id: groupByEvent[eventId]!
          });
          expect(denied.data).toBeNull();
          expect(denied.error?.message).toContain('STATISTICS_NOT_FOUND');
        }
      }
    });
  }
);

/**
 * Regression proof (in-memory, no database): the comparison the certification relies on fails
 * when a captured row is missing, added or changed, and passes for an untouched copy. The
 * red-first evidence for the PAF-173 access tests is historical (Unit 1 report), not new here.
 */
describe('Preservation comparison detects perturbed evidence', () => {
  const row = (id: string, matches: number) => JSON.stringify({ id, matches, score: '6-4' });
  const baseline = (): Capture => ({
    match_events: [row('e1', 0), row('e2', 0)],
    league_player_counters: [row('u1', 2), row('u2', 1)],
    league_standings_snapshots: [row('s1', 1), row('s2', 1)]
  });

  it('accepts an identical copy of the captured rows', () => {
    expect(() => assertCaptureUnchanged(baseline(), baseline())).not.toThrow();
  });

  it('fails when a captured row is missing', () => {
    const perturbed = baseline();
    perturbed['league_player_counters'] = perturbed['league_player_counters']!.slice(1);
    expect(() => assertCaptureUnchanged(perturbed, baseline())).toThrow('expected');
  });

  it('fails when an extra row appears', () => {
    const perturbed = baseline();
    perturbed['match_events']!.push(row('e3', 0));
    expect(() => assertCaptureUnchanged(perturbed, baseline())).toThrow('expected');
  });

  it('fails when a single value inside a row changes', () => {
    const perturbed = baseline();
    perturbed['league_standings_snapshots']![0] = row('s1', 2);
    expect(() => assertCaptureUnchanged(perturbed, baseline())).toThrow('expected');
  });

  it('fails when a whole table is dropped from the capture', () => {
    const perturbed = baseline();
    delete perturbed['league_standings_snapshots'];
    expect(() => assertCaptureUnchanged(perturbed, baseline())).toThrow('expected');
  });
});
