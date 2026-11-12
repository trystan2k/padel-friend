import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, fixtureSql, sqlRows } from './helpers/match-registration-sql';
import {
  processDueMatchEventResults,
  setResultReviewDeadlineOffset
} from './helpers/match-result-processing-fixtures';
import { openDedicatedSqlConnection } from './helpers/sql-transport';
import { sqlText } from './helpers/provisional-player-fixtures';
import {
  createRankedResultFixtures,
  playedAt,
  setMembershipHistory,
  shiftInstant,
  type RankedResultKit
} from './helpers/ranked-result-fixtures';

const environment = localSupabaseEnv();
const dayAgo = () => new Date(Date.now() - 86_400_000).toISOString();

const teamAWins = [
  { position: 1, team_a_games: 6, team_b_games: 4, completed: true },
  { position: 2, team_a_games: 6, team_b_games: 3, completed: true }
];
// Draw whose third set was never completed: it contributes no set to either side.
const drawnUnfinishedThird = [
  { position: 1, team_a_games: 6, team_b_games: 4, completed: true },
  { position: 2, team_a_games: 3, team_b_games: 6, completed: true },
  { position: 3, team_a_games: 2, team_b_games: 1, completed: false }
];
const incomplete = [{ position: 1, team_a_games: 6, team_b_games: 4, completed: true }];

/**
 * PAF-12 U1: materialized League counters rebuilt from confirmed Ranked facts, with immutable
 * projection receipts, independent of the app-wide rating.
 */
describe.skipIf(!environment.env)('League counter projection', { timeout: 300_000 }, () => {
  let kit: RankedResultKit;

  beforeAll(async () => {
    // Opposite app-wide strengths for the two sides: counters must ignore both.
    kit = await createRankedResultFixtures(environment.env!, { levels: [7, 7, 0, 0, 4, 4, 4, 4] });
  });
  afterAll(async () => {
    if (kit) await kit.cleanup();
  });
  afterEach(async () => {
    for (const player of kit.players)
      await setMembershipHistory(kit.communityId, player.id, [{ activatedAt: dayAgo() }]);
  });

  const L = (id: string) => sqlText(id);
  const materialized = async (leagueId: string) =>
    sqlRows(
      `select user_id::text, matches, wins, losses, draws, sets_won, sets_lost, set_differential
         from public.league_player_counters where league_id = ${L(leagueId)} order by user_id`
    );
  const canonical = async (leagueId: string) =>
    sqlRows(
      `select user_id::text, matches, wins, losses, draws, sets_won, sets_lost, sets_won - sets_lost as set_differential
         from public.league_counter_rows(${L(leagueId)}) order by user_id`
    );
  const receipts = async (leagueId: string) =>
    sqlRows(
      `select confirmation_id::text, proposal_id::text, proposal_version::int, match_event_id::text,
              group_number::int, source_confirmed_at
         from public.league_projection_confirmations where league_id = ${L(leagueId)} order by confirmation_id`
    );
  const rebuild = async (leagueId: string) => {
    const [row] = await sqlRows(`select public.rebuild_league_counters(${L(leagueId)}) as result`);
    return asRecord(row?.['result']);
  };
  const ratingEvents = async (eventId: string) => (await kit.sideEffects(eventId))['rating_events'];
  const rowOf = (rows: Awaited<ReturnType<typeof materialized>>, index: number) =>
    rows.find((row) => row['user_id'] === kit.players[index]!.id);

  async function confirm(eventId: string, sets: unknown = teamAWins, secondsAgo = 120) {
    const submitted = await kit.submit(eventId, playedAt(secondsAgo).played, { sets });
    expect(submitted.error).toBeNull();
    const proposalId = String(asRecord(submitted.data)['proposal_id']);
    const confirmed = await kit.approve(proposalId);
    expect(confirmed.error).toBeNull();
    return proposalId;
  }
  /** Replays the shared finalizer for an already confirmed proposal (retry / repair entry). */
  const replayFinalize = (proposalId: string) =>
    fixtureSql(
      `select public.finalize_match_event_result_locked(${L(proposalId)}::uuid, 1, 'MANUAL', ${L(kit.players[2]!.id)}::uuid);`
    );
  /** Deletes receipts and counters like a pre-feature database (immutability trigger bypassed). */
  const wipeProjection = (leagueId: string) =>
    fixtureSql(`do $$ begin
      alter table public.league_projection_confirmations disable trigger league_projection_confirmations_immutable;
      delete from public.league_projection_confirmations where league_id = ${L(leagueId)};
      alter table public.league_projection_confirmations enable trigger league_projection_confirmations_immutable;
      delete from public.league_player_counters where league_id = ${L(leagueId)};
    end $$;`);

  it('materializes exact Win counters per side with one receipt, equal to the canonical source', async () => {
    const leagueId = await kit.league();
    const eventId = await kit.event(leagueId);
    const proposalId = await confirm(eventId);

    const rows = await materialized(leagueId);
    expect(rows).toHaveLength(4);
    for (const index of [0, 1])
      expect(rowOf(rows, index)).toMatchObject({
        matches: 1,
        wins: 1,
        losses: 0,
        draws: 0,
        sets_won: 2,
        sets_lost: 0,
        set_differential: 2
      });
    for (const index of [2, 3])
      expect(rowOf(rows, index)).toMatchObject({
        matches: 1,
        wins: 0,
        losses: 1,
        draws: 0,
        sets_won: 0,
        sets_lost: 2,
        set_differential: -2
      });
    // Players outside the confirmed group (zero overlay) have no earned row.
    for (const index of [4, 5, 6, 7]) expect(rowOf(rows, index)).toBeUndefined();
    expect(rows).toEqual(await canonical(leagueId));

    const listed = await receipts(leagueId);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      proposal_id: proposalId,
      proposal_version: 1,
      match_event_id: eventId,
      group_number: 1
    });
    // Global rating projection still ran exactly once for the same group.
    expect(await ratingEvents(eventId)).toBe(4);
  });

  it('counts a Draw as Match+Draw only and ignores an unfinished third set', async () => {
    const leagueId = await kit.league();
    await confirm(await kit.event(leagueId), drawnUnfinishedThird);
    const rows = await materialized(leagueId);
    for (const index of [0, 1, 2, 3])
      expect(rowOf(rows, index)).toMatchObject({
        matches: 1,
        wins: 0,
        losses: 0,
        draws: 1,
        sets_won: 1,
        sets_lost: 1,
        set_differential: 0
      });
    expect(rows).toEqual(await canonical(leagueId));
  });

  it('excludes Unranked, Friendly, other-League, Incomplete and pending groups', async () => {
    const leagueId = await kit.league();
    const otherId = await kit.league();
    await confirm(await kit.event(null));
    // Friendly events cannot be League-bound at all (DB check); they are never Ranked.
    await confirm(await kit.event(null, 'friendly', false), incomplete);
    await confirm(await kit.event(otherId));
    // Incomplete (unrated) group submitted but never counts; a pending one is not confirmed.
    const incompleteEvent = await kit.event(leagueId);
    expect(
      (await kit.submit(incompleteEvent, playedAt(120).played, { sets: incomplete })).error
    ).toBeNull();
    const pendingEvent = await kit.event(leagueId);
    expect((await kit.submit(pendingEvent, playedAt(120).played)).error).toBeNull();

    expect(await materialized(leagueId)).toEqual([]);
    expect(await receipts(leagueId)).toEqual([]);
    // The other League got only its own group.
    expect(await receipts(otherId)).toHaveLength(1);
  });

  it('rejects pre-start and post-close play at the gate, so nothing is projected', async () => {
    const future = await kit.league({
      startAt: new Date(Date.now() + 86_400_000).toISOString(),
      endAt: new Date(Date.now() + 2 * 86_400_000).toISOString()
    });
    const closed = await kit.league({
      endMode: 'manual',
      endAt: null,
      status: 'closed',
      closedAt: new Date(Date.now() - 3_600_000).toISOString(),
      closedBy: kit.creator.id
    });
    for (const leagueId of [future, closed]) {
      const eventId = await kit.event(leagueId);
      const submitted = await kit.submit(eventId, playedAt(120).played);
      expect(submitted.error?.message).toBe('MATCH_RESULT_RANKED_OUT_OF_PERIOD');
      expect(await materialized(leagueId)).toEqual([]);
      expect(await receipts(leagueId)).toEqual([]);
    }
  });

  it('keeps late joiners and inactive-gap players out, and leaving keeps earned counters', async () => {
    const leagueId = await kit.league();
    const eventId = await kit.event(leagueId);
    const played = playedAt(120);
    // Player 4 joins after the match: the whole quartet check is irrelevant to them (not a player),
    // and their zero overlay is not materialized.
    await setMembershipHistory(kit.communityId, kit.players[4]!.id, [
      { activatedAt: new Date(Date.parse(played.iso) + 60_000).toISOString() }
    ]);
    const proposalId = await confirm(eventId);
    expect(rowOf(await materialized(leagueId), 4)).toBeUndefined();

    // Player 3 leaves after the match: earned row survives rebuild.
    await setMembershipHistory(kit.communityId, kit.players[3]!.id, [
      { activatedAt: dayAgo(), validUntil: new Date(Date.now() - 1_000).toISOString() }
    ]);
    expect((await rebuild(leagueId))['counters_changed']).toBe(0);
    expect(rowOf(await materialized(leagueId), 3)).toMatchObject({ matches: 1, losses: 1 });
    expect(proposalId).toBeTruthy();

    // Inactive gap covering the played instant (trusted retroactive change): group dropped as a
    // whole on explicit rebuild, never partially credited.
    await setMembershipHistory(kit.communityId, kit.players[3]!.id, [
      { activatedAt: dayAgo(), validUntil: new Date(Date.parse(played.iso) - 60_000).toISOString() }
    ]);
    expect((await rebuild(leagueId))['counters_removed']).toBe(4);
    expect(await materialized(leagueId)).toEqual([]);
  });

  it('is retry-safe: finalizer replay neither duplicates receipts nor changes counters or ratings', async () => {
    const leagueId = await kit.league();
    const eventId = await kit.event(leagueId);
    const proposalId = await confirm(eventId);
    const before = { rows: await materialized(leagueId), receipts: await receipts(leagueId) };
    await replayFinalize(proposalId);
    await replayFinalize(proposalId);
    expect(await materialized(leagueId)).toEqual(before.rows);
    expect(await receipts(leagueId)).toEqual(before.receipts);
    expect(await ratingEvents(eventId)).toBe(4);
  });

  it('repairs a missing projection on confirmed replay and on same-input rebuild without drift', async () => {
    const leagueId = await kit.league();
    const eventId = await kit.event(leagueId);
    const proposalId = await confirm(eventId);
    await confirm(await kit.event(leagueId), drawnUnfinishedThird);
    const expected = { rows: await materialized(leagueId), receipts: await receipts(leagueId) };
    expect(expected.receipts).toHaveLength(2);

    await wipeProjection(leagueId);
    expect(await materialized(leagueId)).toEqual([]);
    await replayFinalize(proposalId);
    // Replay repaired the League (all eligible receipts) and kept the source timestamps.
    expect(await materialized(leagueId)).toEqual(expected.rows);
    expect(await receipts(leagueId)).toEqual(
      expected.receipts.map((receipt) => ({
        ...receipt,
        source_confirmed_at: receipt['source_confirmed_at']
      }))
    );

    // Same-input rebuild is a no-op.
    expect(await rebuild(leagueId)).toMatchObject({
      counters_changed: 0,
      counters_removed: 0,
      receipts_added: 0
    });
    expect(await materialized(leagueId)).toEqual(expected.rows);

    // Backfill path (migration loop) on a wiped League gives identical counters, rerunnable.
    await wipeProjection(leagueId);
    await rebuild(leagueId);
    await rebuild(leagueId);
    expect(await materialized(leagueId)).toEqual(expected.rows);
    expect(await receipts(leagueId)).toHaveLength(2);
    expect(await ratingEvents(eventId)).toBe(4);
  });

  it('projects AUTO_48H confirmations the same as manual ones', async () => {
    const leagueId = await kit.league();
    const eventId = await kit.event(leagueId);
    const submitted = await kit.submit(eventId, playedAt(120).played);
    const proposalId = String(asRecord(submitted.data)['proposal_id']);
    await setResultReviewDeadlineOffset(proposalId, 1, -60);
    expect(await processDueMatchEventResults()).toMatchObject({ confirmed: 1 });
    const rows = await materialized(leagueId);
    expect(rowOf(rows, 0)).toMatchObject({ matches: 1, wins: 1, sets_won: 2 });
    expect(rows).toEqual(await canonical(leagueId));
    expect(await receipts(leagueId)).toHaveLength(1);
    expect(await ratingEvents(eventId)).toBe(4);
  });

  it('applies inclusive played_at boundaries to ±1µs on rebuild', async () => {
    const leagueId = await kit.league();
    const eventId = await kit.event(leagueId);
    const played = playedAt(120);
    const proposalId = await confirm(eventId, teamAWins, 120);
    expect(proposalId).toBeTruthy();
    const at = played.iso;
    const set = (start: string, end: string) =>
      fixtureSql(
        `update public.leagues set start_at=${sqlText(start)}::timestamptz, end_at=${sqlText(end)}::timestamptz where id=${L(leagueId)};`
      );
    const farBefore = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const farAfter = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const [exactStart, afterStart, exactEnd, beforeEnd] = [
      at,
      await shiftInstant(at, 1),
      at,
      await shiftInstant(at, -1)
    ];
    // The confirmed instant has whole-second precision, so ±1µs around it are exact probes.
    const matches = async () => (await materialized(leagueId)).length;
    await set(exactStart, farAfter);
    await rebuild(leagueId);
    expect(await matches()).toBe(4);
    await set(afterStart, farAfter);
    await rebuild(leagueId);
    expect(await matches()).toBe(0);
    await set(farBefore, exactEnd);
    await rebuild(leagueId);
    expect(await matches()).toBe(4);
    await set(farBefore, beforeEnd);
    await rebuild(leagueId);
    expect(await matches()).toBe(0);
    await set(farBefore, farAfter);
    await rebuild(leagueId);
    expect(await matches()).toBe(4);
  });

  it('never reads or reacts to app-wide skill: real rating changes leave counters byte-identical', async () => {
    const leagueId = await kit.league();
    await confirm(await kit.event(leagueId));
    const ids = kit.players.map((player) => L(player.id)).join(',');
    const ratings = () =>
      sqlRows(
        `select user_id::text, mu::float8 as mu, display_level::float8 as display_level, reliability_percent
           from public.global_player_ratings where user_id in (${ids}) order by user_id`
      );
    const snapshot = async () => ({
      counters: JSON.stringify(await materialized(leagueId)),
      receipts: JSON.stringify(await receipts(leagueId)),
      oracle: JSON.stringify(await canonical(leagueId))
    });
    const before = await snapshot();
    const ratingsBefore = await ratings();

    // Real global rating changes through the unchanged projector: Unranked Competitive groups
    // with the opposite result for the same four players, outside any League.
    await confirm(await kit.event(null), [
      { position: 1, team_a_games: 2, team_b_games: 6, completed: true },
      { position: 2, team_a_games: 3, team_b_games: 6, completed: true }
    ]);
    await confirm(await kit.event(null));
    const ratingsAfter = await ratings();
    expect(ratingsAfter).not.toEqual(ratingsBefore);
    expect(JSON.stringify(await snapshot())).toBe(JSON.stringify(before));

    // Re-running projection and rebuild after the rating change keeps every byte identical.
    expect(await rebuild(leagueId)).toMatchObject({
      counters_changed: 0,
      counters_removed: 0,
      receipts_added: 0
    });
    expect(JSON.stringify(await snapshot())).toBe(JSON.stringify(before));
    // The rebuild itself does not touch the rating state.
    expect(await ratings()).toEqual(ratingsAfter);

    const [source] = await sqlRows(
      `select bool_or(pg_get_functiondef(p.oid) ~* 'global_player_ratings|player_rating_events|player_rating_initializations|project_confirmed_rating_group') as reads_rating
         from pg_proc p where p.proname in ('league_confirmed_groups','league_counter_rows','rebuild_league_counters','project_league_confirmation')
          and p.pronamespace = 'public'::regnamespace`
    );
    expect(source?.['reads_rating']).toBe(false);
  });

  describe.each([
    ['League receipt insert', 'league_projection_confirmations'],
    ['global rating event insert', 'player_rating_events']
  ])('finalizer atomicity when the %s fails', (_label, table) => {
    it('rolls back confirmation, audit, counters, receipt and rating together, then succeeds on retry', async () => {
      const leagueId = await kit.league();
      const eventId = await kit.event(leagueId);
      const submitted = await kit.submit(eventId, playedAt(120).played);
      expect(submitted.error).toBeNull();
      const proposalId = String(asRecord(submitted.data)['proposal_id']);
      await setResultReviewDeadlineOffset(proposalId, 1, -60);

      const connection = await openDedicatedSqlConnection();
      const inside: Record<string, unknown>[] = [];
      try {
        await connection.query('begin');
        // DDL is transactional: the failing trigger exists only inside this rolled-back transaction.
        await connection.query(`create function public.paf_u1_forced_failure() returns trigger
          language plpgsql as $f$ begin raise exception 'PAF_U1_FORCED_FAILURE'; end $f$`);
        await connection.query(`create trigger paf_u1_forced_failure before insert on public.${table}
          for each row execute function public.paf_u1_forced_failure()`);
        // The sub-block rolls back everything the finalizer did before it failed; the surrounding
        // transaction stays usable so the remaining state can be inspected before it is discarded.
        await connection.query(`do $b$ declare m text; begin
          begin
            perform public.finalize_match_event_result_locked(${L(proposalId)}::uuid, 1, 'AUTO_48H', null);
          exception when others then m := sqlerrm; end;
          if m is distinct from 'PAF_U1_FORCED_FAILURE' then
            raise exception 'finalizer did not fail as forced: %', coalesce(m, 'no error');
          end if;
        end $b$`);
        inside.push(
          ...(
            await connection.query(
              `select
                 (select count(*)::int from public.match_event_result_confirmations where match_event_id = ${L(eventId)}) as confirmations,
                 (select count(*)::int from public.league_projection_confirmations where league_id = ${L(leagueId)}) as receipts,
                 (select count(*)::int from public.league_player_counters where league_id = ${L(leagueId)}) as counters,
                 (select count(*)::int from public.player_rating_events where match_event_id = ${L(eventId)}) as rating_events,
                 (select count(*)::int from public.match_event_audit_log where match_event_id = ${L(eventId)} and action = 'result_confirmed') as confirm_audits,
                 (select status from public.match_event_result_proposals where id = ${L(proposalId)}) as status`
            )
          ).rows
        );
      } finally {
        await connection.query('rollback');
        await connection.close();
      }
      // Inside the transaction, after the failed finalizer: nothing it did survived.
      expect(inside).toEqual([
        {
          confirmations: 0,
          receipts: 0,
          counters: 0,
          rating_events: 0,
          confirm_audits: 0,
          status: 'pending'
        }
      ]);

      // Nothing from the failed attempt persisted: no confirmation, audit, rating, counters, receipt.
      expect(await kit.sideEffects(eventId)).toMatchObject({
        confirmations: 0,
        rating_events: 0
      });
      expect(await materialized(leagueId)).toEqual([]);
      expect(await receipts(leagueId)).toEqual([]);
      const [proposal] = await sqlRows(
        `select status from public.match_event_result_proposals where id = ${L(proposalId)}`
      );
      expect(proposal?.['status']).toBe('pending');
      const [leftover] = await sqlRows(
        "select to_regprocedure('public.paf_u1_forced_failure()') is not null as exists"
      );
      expect(leftover?.['exists']).toBe(false);

      // The same proposal then confirms once with all side effects together.
      expect(await processDueMatchEventResults()).toMatchObject({ confirmed: 1 });
      expect(await kit.sideEffects(eventId)).toMatchObject({ confirmations: 1, rating_events: 4 });
      expect(await receipts(leagueId)).toHaveLength(1);
      expect(rowOf(await materialized(leagueId), 0)).toMatchObject({ matches: 1, wins: 1 });
    });
  });

  it('runs the League projector before the global rating projector in the finalizer', async () => {
    const [row] = await sqlRows(
      `select position('project_league_confirmation(v_existing.id)' in d) < position('project_confirmed_rating_group(p_proposal_id)' in d) as replay_first,
              position('project_league_confirmation(v_confirmation_id)' in d) < position('project_confirmed_rating_group(v_proposal.id)' in d) as first_first
         from (select pg_get_functiondef('public.finalize_match_event_result_locked(uuid,bigint,text,uuid)'::regprocedure) d) f`
    );
    expect(row).toEqual({ replay_first: true, first_first: true });
  });

  it('denies runtime access to tables and internal functions and keeps receipts immutable', async () => {
    const leagueId = await kit.league();
    await confirm(await kit.event(leagueId));
    const [privileges] = await sqlRows(
      `select
         has_table_privilege('authenticated','public.league_player_counters','SELECT') as counters_select,
         has_table_privilege('authenticated','public.league_projection_confirmations','SELECT') as receipts_select,
         has_table_privilege('service_role','public.league_player_counters','INSERT') as counters_write,
         has_function_privilege('authenticated','public.rebuild_league_counters(uuid)','EXECUTE') as rebuild_auth,
         has_function_privilege('anon','public.project_league_confirmation(uuid)','EXECUTE') as project_anon,
         has_function_privilege('authenticated','public.league_counter_rows(uuid)','EXECUTE') as rows_auth,
         has_function_privilege('authenticated','public.league_confirmed_groups(uuid)','EXECUTE') as groups_auth,
         (select relrowsecurity from pg_class where oid = 'public.league_player_counters'::regclass) as counters_rls,
         (select relrowsecurity from pg_class where oid = 'public.league_projection_confirmations'::regclass) as receipts_rls`
    );
    expect(privileges).toEqual({
      counters_select: false,
      receipts_select: false,
      counters_write: false,
      rebuild_auth: false,
      project_anon: false,
      rows_auth: false,
      groups_auth: false,
      counters_rls: true,
      receipts_rls: true
    });
    const rpc = await kit.rpc(kit.creator, 'rebuild_league_counters', { p_league_id: leagueId });
    expect(rpc.error).not.toBeNull();
    await expect(
      fixtureSql(
        `update public.league_projection_confirmations set group_number = group_number where league_id = ${L(leagueId)};`
      )
    ).rejects.toThrow(/LEAGUE_PROJECTION_IMMUTABLE/);
    await expect(
      fixtureSql(
        `delete from public.league_projection_confirmations where league_id = ${L(leagueId)};`
      )
    ).rejects.toThrow(/LEAGUE_PROJECTION_IMMUTABLE/);
    await expect(
      fixtureSql(
        `update public.league_player_counters set wins = 5 where league_id = ${L(leagueId)};`
      )
    ).rejects.toThrow(/check/i);
  });

  it('rebuilds an unknown League as LEAGUE_NOT_FOUND', async () => {
    await expect(rebuild(crypto.randomUUID())).rejects.toThrow(/LEAGUE_NOT_FOUND/);
  });
});
