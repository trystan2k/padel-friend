import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import {
  approvedPlan,
  asStrings,
  confirmGroup,
  countWithdrawn,
  eraseAccount,
  erasurePlan,
  executeErasure,
  scalar,
  survivorSnapshot,
  tablesMentioning
} from './helpers/account-erasure-fixtures';
import { asRecord, fixtureSql, sqlRows } from './helpers/match-registration-sql';
import { sqlText } from './helpers/provisional-player-fixtures';
import { createRankedResultFixtures, type RankedResultKit } from './helpers/ranked-result-fixtures';

const environment = localSupabaseEnv();
const L = sqlText;

/**
 * PAF-231: the private erasure seam on a populated world. Players 0-3 play group 1 and 4-7 group 2
 * of a League-bound event; player 0 is the Admin, community creator and League owner.
 */
describe.skipIf(!environment.env)('Account erasure seam', { timeout: 600_000 }, () => {
  let kit: RankedResultKit;
  let leagueId: string;
  let eventId: string;
  const id = (index: number) => kit.players[index]!.id;

  const readerData = async (name: string, args: Record<string, unknown>) => {
    const result = await kit.rpc(kit.players[0]!, name, args);
    expect(result.error).toBeNull();
    return result.data;
  };
  const rows = (value: unknown) => (Array.isArray(value) ? value : []);
  /** Retained-history reader output restricted to what only live players touch (group 2, players 4-7). */
  async function liveSlices() {
    const group2 = new Set([4, 5, 6, 7].map(id));
    const proposals = rows(
      await readerData('get_match_event_result_proposals', { p_match_event_id: eventId })
    );
    const official = rows(
      await readerData('get_match_event_official_results', { p_match_event_id: eventId })
    );
    const changes = asRecord(
      await readerData('get_match_event_rating_changes', { p_match_event_id: eventId })
    );
    const standings = asRecord(
      await readerData('get_league_standings', { p_league_id: leagueId, p_standings_version: null })
    );
    const counters = asRecord(await readerData('get_league_counters', { p_league_id: leagueId }));
    const live = (entry: unknown) => group2.has(String(asRecord(entry)['user_id']));
    return {
      proposals: proposals.filter((row) => asRecord(row)['group_number'] === 2),
      official: official.filter((row) => asRecord(row)['group_number'] === 2),
      changes: rows(changes['groups']).filter(
        (group) => asRecord(group)['game_group_number'] === 2
      ),
      standings: rows(standings['entries']).filter(live),
      counters: rows(counters['participants']).filter(live)
    };
  }

  beforeAll(async () => {
    kit = await createRankedResultFixtures(environment.env!);
    leagueId = await kit.league();
    eventId = await kit.event(leagueId);
    await confirmGroup(kit, eventId, 1);
    await confirmGroup(kit, eventId, 2);
    await fixtureSql(
      "update public.player_profiles set avatar_url = user_id::text || '/' || gen_random_uuid()::text || '.png' where user_id = " +
        L(id(3)) +
        ';'
    );
  });
  afterAll(async () => {
    await fixtureSql('select 1');
  });

  it('is private: no client role can execute the seam', async () => {
    const privileges = await sqlRows(
      "select r.rolname::text as role, has_function_privilege(r.rolname, p.oid, 'EXECUTE') as can_execute, p.proname::text as fn " +
        "from pg_roles r cross join pg_proc p where r.rolname in ('anon', 'authenticated', 'service_role') " +
        "and p.pronamespace = 'privacy_internal'::regnamespace and p.proname in ('account_erasure_plan', 'account_erasure_execute')"
    );
    expect(privileges).toHaveLength(6);
    expect(privileges.filter((row) => row['can_execute'] === true)).toEqual([]);
  });

  it("re-keys a departed player, keeps other players' facts and leaves nothing behind", async () => {
    const subject = id(3);
    const survivors = [0, 1, 2, 4, 5, 6, 7].map(id);
    const before = await survivorSnapshot(survivors, kit.communityId, [eventId]);
    const withdrawnBefore = await countWithdrawn();
    expect(await tablesMentioning(subject)).not.toEqual([]);

    const liveBefore = await liveSlices();
    expect(liveBefore.proposals).toHaveLength(1);
    expect(liveBefore.standings.length).toBeGreaterThan(0);
    const result = await eraseAccount(subject);
    expect(result['tombstone_created']).toBe(true);
    // Live participants keep byte-identical reader payloads.
    expect(await liveSlices()).toEqual(liveBefore);
    expect(await countWithdrawn()).toBe(withdrawnBefore + 1);

    expect(await tablesMentioning(subject)).toEqual([]);
    expect(
      await scalar(
        'select count(*)::int from public.participant_identities where id = ' + L(subject)
      )
    ).toBe(0);
    expect(
      await scalar('select count(*)::int from public.player_profiles where user_id = ' + L(subject))
    ).toBe(0);
    expect(await survivorSnapshot(survivors, kit.communityId, [eventId])).toEqual(before);
    expect(await scalar('select count(*)::int from privacy_internal.erasure_windows')).toBe(0);

    // Retained rating history keeps the slot: the group still lists four players, one with no profile.
    const changes = await kit.rpc(kit.players[0]!, 'get_match_event_rating_changes', {
      p_match_event_id: eventId
    });
    expect(changes.error).toBeNull();
    const groups = asRecord(changes.data)['groups'];
    const slotsWithoutName = Array.isArray(groups)
      ? groups.filter((group) => {
          const players = asRecord(group)['players'];
          return (
            Array.isArray(players) &&
            players.length === 4 &&
            players.some((player) => asRecord(player)['display_name'] === null)
          );
        })
      : [];
    expect(slotsWithoutName).toHaveLength(1);

    // The team slot survives as a withdrawn identity that no join can turn into a profile.
    const [slot] = await sqlRows(
      "select v.teams -> 'team_b' ->> 1 as slot from public.match_event_result_proposal_versions v " +
        'join public.match_event_result_proposals p on p.id = v.proposal_id ' +
        'where p.match_event_id = ' +
        L(eventId) +
        ' and p.group_number = 1'
    );
    const tombstone = String(asRecord(slot)['slot']);
    expect(tombstone).not.toBe(subject);
    expect(
      await scalar(
        'select count(*)::int from public.participant_identities where id = ' +
          L(tombstone) +
          " and state = 'withdrawn'"
      )
    ).toBe(1);
    expect(
      await scalar(
        'select count(*)::int from public.player_profiles where user_id = ' + L(tombstone)
      )
    ).toBe(0);
    expect(
      await scalar(
        'select count(*)::int from public.statistics_group_facts where ' +
          L(tombstone) +
          ' = any(team_b_players)'
      )
    ).toBeGreaterThan(0);
    expect(
      await scalar(
        'select count(*)::int from public.player_rating_event_calculations where inputs::text like ' +
          L('%' + tombstone + '%')
      )
    ).toBeGreaterThan(0);

    // A repeat can never produce a second tombstone.
    await expect(
      executeErasure(subject, { revision: 1, fingerprint: 'x', impact: {}, successors: {} })
    ).rejects.toThrow(/ACCOUNT_ERASURE_SUBJECT_NOT_FOUND/);
    expect(await countWithdrawn()).toBe(withdrawnBefore + 1);
  });

  it('a second departed player in the same match gets a distinct tombstone', async () => {
    const first = id(2);
    const second = id(1);
    const before = await sqlRows(
      'select v.teams as teams from public.match_event_result_proposal_versions v join public.match_event_result_proposals p on p.id = v.proposal_id where p.match_event_id = ' +
        L(eventId) +
        ' and p.group_number = 1'
    );
    expect(before).toHaveLength(1);
    await eraseAccount(first);
    await eraseAccount(second);
    const [row] = await sqlRows(
      'select v.teams as teams from public.match_event_result_proposal_versions v join public.match_event_result_proposals p on p.id = v.proposal_id where p.match_event_id = ' +
        L(eventId) +
        ' and p.group_number = 1'
    );
    const teams = asRecord(asRecord(row)['teams']);
    const slots = [...asStrings(teams['team_a']), ...asStrings(teams['team_b'])];
    expect(new Set(slots).size).toBe(4);
    expect(slots).not.toContain(first);
    expect(slots).not.toContain(second);
    expect(slots).toContain(id(0));
    expect(await tablesMentioning(first)).toEqual([]);
    expect(await tablesMentioning(second)).toEqual([]);
  });

  it('never publishes a tombstone id: departed players get distinct scope-local keys', async () => {
    const proposalId = await kit.proposalId(eventId, 1);
    const tombstones = (
      await sqlRows(
        "select id::text as id from public.participant_identities where state = 'withdrawn'"
      )
    ).map((row) => String(row['id']));
    expect(tombstones.length).toBeGreaterThanOrEqual(3);
    const payloads = {
      proposals: await readerData('get_match_event_result_proposals', {
        p_match_event_id: eventId
      }),
      official: await readerData('get_match_event_official_results', { p_match_event_id: eventId }),
      changes: await readerData('get_match_event_rating_changes', { p_match_event_id: eventId }),
      explanation: await readerData('get_rating_group_explanation', {
        p_game_group_id: proposalId,
        p_revision: null
      }),
      standings: await readerData('get_league_standings', {
        p_league_id: leagueId,
        p_standings_version: null
      }),
      counters: await readerData('get_league_counters', { p_league_id: leagueId }),
      league: await readerData('get_league', { p_league_id: leagueId }),
      detail: await readerData('get_statistics_group_detail', {
        p_event_id: eventId,
        p_game_group_id: proposalId
      }),
      audit: await readerData('list_match_event_audit', {
        p_match_event_id: eventId,
        p_before_at: null,
        p_before_id: null,
        p_limit: 50
      }),
      management: await readerData('get_match_event_management', { p_match_event_id: eventId }),
      participants: await readerData('list_match_event_management_participants', {
        p_match_event_id: eventId
      })
    };
    for (const [name, payload] of Object.entries(payloads)) {
      const text = JSON.stringify(payload);
      for (const tombstone of tombstones)
        expect({ name, leaked: text.includes(tombstone) }).toEqual({ name, leaked: false });
    }
    // Group 1: three departed slots with distinct keys, one live slot with the real id.
    const group = asRecord(
      rows(payloads.proposals).find((row) => asRecord(row)['group_number'] === 1)
    );
    const teams = asRecord(group['teams']);
    const slots = [...rows(teams['team_a']), ...rows(teams['team_b'])].map((slot) =>
      String(asRecord(slot)['user_id'])
    );
    const former = slots.filter((slot) => /^former-[0-9a-f]{16}$/.test(slot));
    expect(former).toHaveLength(3);
    expect(new Set(former).size).toBe(3);
    expect(slots).toContain(id(0));
    // The same departed player gets the same key inside one scope and another key in another scope.
    const official = asRecord(
      rows(payloads.official).find((row) => asRecord(row)['group_number'] === 1)
    );
    const officialTeams = asRecord(official['teams']);
    expect(
      [...asStrings(officialTeams['team_a']), ...asStrings(officialTeams['team_b'])].sort()
    ).toEqual([...slots].sort());
    expect(
      await scalar(
        'select privacy_internal.participant_ref(t.id, ' +
          L(proposalId) +
          ') <> privacy_internal.participant_ref(t.id, ' +
          L(eventId) +
          ') from (select id from public.participant_identities where state = ' +
          "'withdrawn' limit 1) t"
      )
    ).toBe(true);
    // Rating readers keep four slots, the departed ones with no name and a scope-local key.
    const changes = asRecord(payloads.changes);
    const ratingSlots = rows(
      asRecord(rows(changes['groups']).find((g) => asRecord(g)['game_group_number'] === 1))[
        'players'
      ]
    ).map((p) => String(asRecord(p)['user_id']));
    expect(new Set(ratingSlots).size).toBe(4);
    expect(ratingSlots.filter((slot) => slot.startsWith('former-'))).toHaveLength(3);
  });

  it('keeps immutable ledgers immutable to normal callers', async () => {
    await expect(
      fixtureSql(
        'update public.player_rating_events set user_id = user_id where user_id = ' + L(id(0))
      )
    ).rejects.toThrow(/RATING_EVIDENCE_IMMUTABLE/);
    await expect(
      fixtureSql(
        "insert into public.participant_identities(id, state) values (gen_random_uuid(), 'withdrawn')"
      )
    ).rejects.toThrow(/PARTICIPANT_WITHDRAWN_ONLY_BY_ERASURE/);
  });

  it('rejects a drifted or inflated plan without changing anything', async () => {
    const subject = id(7);
    const plan = await erasurePlan(subject);
    const tampered = approvedPlan(plan);
    tampered.impact['anchor_rekey'] = Number(tampered.impact['anchor_rekey']) + 1;
    await expect(executeErasure(subject, tampered)).rejects.toThrow(
      /ACCOUNT_ERASURE_PLAN_MISMATCH/
    );
    expect(
      await scalar(
        'select count(*)::int from public.participant_identities where id = ' +
          L(subject) +
          " and state = 'live'"
      )
    ).toBe(1);
    expect(
      await scalar('select count(*)::int from public.player_profiles where user_id = ' + L(subject))
    ).toBe(1);
  });
});
