import { beforeAll, describe, expect, it } from 'vitest';
import { decodeLeagueDto, decodeLeagueList } from '../src/features/leagues/league-decoders';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import {
  createLeagueArgs,
  insertLeague,
  leagueRow,
  leagueWorld,
  processLeaguesAt,
  sqlRows,
  type LeagueWorld
} from './helpers/league-fixtures';
import { isoDay, publishCompetitive, sqlMessage } from './helpers/ranked-fixtures';
import { sqlText } from './helpers/provisional-player-fixtures';
import { executeTrustedSql, openDedicatedSqlConnection } from './helpers/sql-transport';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
const day = (offset: number) => `${isoDay(offset)}T00:00:00Z`;

/** PAF-11 review round 1: F1 (reference history), F2 (lock-time anchor), F4 (batch fairness), F5 (list cap). */
describe.skipIf(!environment.env)('League review hardening', { timeout: 300_000 }, () => {
  let world: LeagueWorld;

  beforeAll(async () => {
    world = await leagueWorld(environment.env!, 'hardening');
    await world.setTimezone('UTC');
  });

  it('F1: period stays locked after the last referencing event switches to Unranked or another League', async () => {
    const first = await insertLeague({
      communityId: world.communityId,
      ownerId: world.owner.id,
      startAt: day(-5),
      endAt: day(60)
    });
    const second = await insertLeague({
      communityId: world.communityId,
      ownerId: world.owner.id,
      startAt: day(-5),
      endAt: day(60)
    });
    const { eventId, result } = await publishCompetitive(world.owner, world.communityId, {
      competition: 'ranked',
      league_id: first
    });
    expect(result.error).toBeNull();
    const switchTo = async (leagueId: string | null) => {
      const [event] = await sqlRows(
        `select version::int as version from public.match_events where id = ${sqlText(eventId)}`
      );
      return world.owner.client.rpc('edit_match_event', {
        p_match_event_id: eventId,
        p_expected_version: Number(event?.['version']),
        p_patch: { league_id: leagueId },
        p_request_id: crypto.randomUUID()
      });
    };
    const extendEnd = async (leagueId: string) =>
      world.admin.client.rpc('update_league', {
        p_league_id: leagueId,
        p_expected_version: Number((await leagueRow(leagueId)).version),
        p_changes: { end_date: isoDay(90) }
      });

    expect((await extendEnd(first)).error?.message).toBe('LEAGUE_PERIOD_LOCKED');
    expect((await switchTo(second)).error).toBeNull();
    // `first` has no current event, yet it was referenced once: still locked. `second` is locked now.
    expect((await extendEnd(first)).error?.message).toBe('LEAGUE_PERIOD_LOCKED');
    expect((await extendEnd(second)).error?.message).toBe('LEAGUE_PERIOD_LOCKED');
    expect((await switchTo(null)).error).toBeNull();
    expect((await extendEnd(first)).error?.message).toBe('LEAGUE_PERIOD_LOCKED');
    expect((await extendEnd(second)).error?.message).toBe('LEAGUE_PERIOD_LOCKED');
    const detail = await world.admin.client.rpc('get_league', { p_league_id: first });
    expect(detail.data).toMatchObject({ league: { period_locked: true } });
    // The history is append-only.
    expect(
      await sqlMessage(
        `delete from public.league_event_references where league_id = ${sqlText(first)}`
      )
    ).toMatch(/LEAGUE_EVENT_REFERENCES_IMMUTABLE/);
    // A League nobody ever referenced stays editable.
    const untouched = await insertLeague({
      communityId: world.communityId,
      ownerId: world.owner.id,
      startAt: day(-5),
      endAt: day(60)
    });
    expect((await extendEnd(untouched)).error).toBeNull();
  });

  it('F2: a League created while waiting on the community lock is stamped after the lock holder', async () => {
    const communityId = await world.newCommunity(world.admin.id);
    const holder = await openDedicatedSqlConnection();
    try {
      await holder.query('begin');
      await holder.query(
        `select 1 from public.communities where id = ${sqlText(communityId)} for update`
      );
      // supabase-js builders are lazy: `.then` is what actually sends the request.
      const creating = world.admin.client
        .rpc(
          'create_league',
          createLeagueArgs(communityId, { p_end_mode: 'manual', p_end_date: undefined })
        )
        .then((response) => response);
      // Wait until the RPC's transaction is demonstrably blocked on the community lock.
      let blocked = false;
      for (let attempt = 0; attempt < 100 && !blocked; attempt += 1) {
        const [waiting] = await sqlRows(
          `select count(*)::int as n from pg_stat_activity
            where wait_event_type = 'Lock' and state = 'active' and query ilike '%create_league%'`
        );
        blocked = Number(waiting?.['n']) > 0;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(blocked).toBe(true);
      // Let the blocked transaction's start time fall clearly before the lock holder's instant.
      await new Promise((resolve) => setTimeout(resolve, 50));
      // The event publishes (published_at = clock_timestamp()) while the League call still waits.
      const [published] = (await holder.query(`select clock_timestamp()::text as t`)).rows;
      await holder.query('commit');
      const created = await creating;
      expect(created.error).toBeNull();
      const leagueId = decodeLeagueDto(created.data).id;
      const [row] = await sqlRows(
        `select created_at > ${sqlText(String(published?.['t']))}::timestamptz as after_publication
           from public.leagues where id = ${sqlText(leagueId)}`
      );
      expect(row?.['after_publication']).toBe(true);
      // So the publication-time existence check refuses the retroactive binding.
      expect(
        await sqlMessage(
          `select public.assert_match_league_binding(${sqlText(communityId)}, ${sqlText(leagueId)},
              now() + interval '1 day', 'competitive', ${sqlText(String(published?.['t']))}::timestamptz)`
        )
      ).toMatch(/MATCH_LEAGUE_NOT_FOUND/);
    } finally {
      await holder.query('rollback').catch(() => undefined);
      await holder.close();
    }
  });

  it('F4: locked and failing communities do not starve later ones', async () => {
    const owner = world.admin.id;
    const [locked, failing, ...healthy] = await Promise.all(
      Array.from({ length: 5 }, () => world.newCommunity(owner))
    );
    const leagues: string[] = [];
    for (const [index, communityId] of [locked!, failing!, ...healthy].entries()) {
      leagues.push(
        await insertLeague({
          communityId,
          ownerId: owner,
          status: 'upcoming',
          startAt: `1990-01-0${index + 1}T00:00:00Z`
        })
      );
    }
    const holder = await openDedicatedSqlConnection();
    try {
      await holder.query('begin');
      await holder.query(
        `select 1 from public.communities where id = ${sqlText(locked!)} for update`
      );
      await executeTrustedSql(`
        create function public.paf11_fail_f4() returns trigger language plpgsql as $$
        begin raise exception 'paf11 forced failure'; end $$;
        create trigger paf11_fail_f4 before update on public.leagues
          for each row when (old.community_id = ${sqlText(failing!)}) execute function public.paf11_fail_f4();`);
      const result = await processLeaguesAt(new Date().toISOString(), 2);
      expect(result).toMatchObject({ processed: 2, skipped: 1, failed: 1 });
      const states = await sqlRows(
        `select community_id::text as community, status::text as status from public.leagues
          where id = any (${sqlText(`{${leagues.join(',')}}`)}::uuid[])`
      );
      const statusOf = (communityId: string) =>
        states.find((row) => row['community'] === communityId)?.['status'];
      expect(statusOf(healthy[0]!)).toBe('active');
      expect(statusOf(healthy[1]!)).toBe('active');
      expect(statusOf(healthy[2]!)).toBe('upcoming');
    } finally {
      await holder.query('rollback').catch(() => undefined);
      await holder.close();
      await executeTrustedSql(`
        drop trigger if exists paf11_fail_f4 on public.leagues;
        drop function if exists public.paf11_fail_f4();
        update public.leagues set start_at = '2999-01-01T00:00:00Z'
          where id = any (${sqlText(`{${leagues.join(',')}}`)}::uuid[]) and status = 'upcoming';`);
    }
  });

  it('F5: the list reports total and truncation beyond 200 Leagues', async () => {
    const communityId = await world.newCommunity(world.admin.id);
    await executeTrustedSql(`
      insert into public.leagues(community_id, owner_id, name, timezone, start_at, end_mode, status,
          create_request_id, create_input)
        select ${sqlText(communityId)}, ${sqlText(world.admin.id)}, 'Bulk ' || n, 'UTC',
            '2999-01-01T00:00:00Z'::timestamptz + n * interval '1 day', 'manual', 'upcoming',
            gen_random_uuid(), '{}'::jsonb
        from generate_series(1, 201) n;`);
    const over = await world.admin.client.rpc('list_leagues', { p_community_id: communityId });
    expect(over.error).toBeNull();
    const decodedOver = decodeLeagueList(over.data);
    expect(decodedOver.leagues).toHaveLength(200);
    expect(decodedOver).toMatchObject({ total: 201, truncated: true });

    const small = await world.newCommunity(world.admin.id);
    await insertLeague({ communityId: small, ownerId: world.admin.id, startAt: day(30) });
    const under = decodeLeagueList(
      (await world.admin.client.rpc('list_leagues', { p_community_id: small })).data
    );
    expect(under).toMatchObject({ total: 1, truncated: false });
  });
});
