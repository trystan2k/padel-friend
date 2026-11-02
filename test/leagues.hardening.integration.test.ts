import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
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

  /** Bulk Upcoming Leagues with distinct, immutable creation instants (n = 1 is the newest). */
  const bulkLeagues = (communityId: string, count: number) =>
    executeTrustedSql(`
      insert into public.leagues(community_id, owner_id, name, timezone, start_at, end_mode, status,
          create_request_id, create_input, created_at)
        select ${sqlText(communityId)}, ${sqlText(world.admin.id)}, 'Bulk ' || n, 'UTC',
            '2999-01-01T00:00:00Z'::timestamptz + n * interval '1 day', 'manual', 'upcoming',
            gen_random_uuid(), '{}'::jsonb, now() - n * interval '1 minute'
        from generate_series(1, ${count}) n;`);

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

  it('F4: the attempt budget bounds one run and rotation reaches later communities across runs', async () => {
    const owner = world.admin.id;
    const [locked, failingOne, failingTwo, ...healthy] = await Promise.all(
      Array.from({ length: 6 }, () => world.newCommunity(owner))
    );
    const failing = [failingOne!, failingTwo!];
    const all = [locked!, ...failing, ...healthy];
    const leagues: string[] = [];
    for (const [index, communityId] of all.entries()) {
      leagues.push(
        await insertLeague({
          communityId,
          ownerId: owner,
          status: 'upcoming',
          startAt: `1990-01-0${index + 1}T00:00:00Z`
        })
      );
    }
    const statusOf = async (communityId: string) =>
      (
        await sqlRows(
          `select status::text as status from public.leagues where community_id = ${sqlText(communityId)}`
        )
      )[0]?.['status'];
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
          for each row when (old.community_id in (${failing.map(sqlText).join(',')}))
          execute function public.paf11_fail_f4();`);
      const attempts = (result: Record<string, unknown>) =>
        Number(result['processed']) + Number(result['skipped']) + Number(result['failed']);

      // Run 1 spends its whole budget on the locked and the failing community: bounded, nothing else touched.
      const first = await processLeaguesAt(new Date().toISOString(), 2);
      expect(attempts(first)).toBe(2);
      expect(first).toMatchObject({ processed: 0, skipped: 1, failed: 1 });
      expect(await statusOf(healthy[0]!)).toBe('upcoming');

      // Run 2 moves on to the second failing community, then reaches the first healthy one.
      const second = await processLeaguesAt(new Date().toISOString(), 2);
      expect(attempts(second)).toBe(2);
      expect(second).toMatchObject({ processed: 1, failed: 1 });
      // Run 3: never-attempted communities go before the ones that were skipped or failed.
      const third = await processLeaguesAt(new Date().toISOString(), 2);
      expect(attempts(third)).toBeLessThanOrEqual(2);
      expect(third).toMatchObject({ processed: 2, failed: 0, skipped: 0 });
      for (const communityId of healthy) expect(await statusOf(communityId)).toBe('active');
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

  it('F5: the list reports total and truncation, and the keyset continuation reaches every row beyond 200', async () => {
    const communityId = await world.newCommunity(world.admin.id);
    await bulkLeagues(communityId, 201);
    const over = await world.admin.client.rpc('list_leagues', { p_community_id: communityId });
    expect(over.error).toBeNull();
    const decodedOver = decodeLeagueList(over.data);
    expect(decodedOver.leagues).toHaveLength(200);
    expect(decodedOver).toMatchObject({ total: 201, truncated: true });
    expect(decodedOver.next_cursor).not.toBeNull();

    const next = await world.admin.client.rpc('list_leagues', {
      p_community_id: communityId,
      p_after_created_at: decodedOver.next_cursor!.created_at,
      p_after_id: decodedOver.next_cursor!.id
    });
    expect(next.error).toBeNull();
    const decodedNext = decodeLeagueList(next.data);
    expect(decodedNext.leagues).toHaveLength(1);
    expect(decodedNext).toMatchObject({ total: 201, truncated: false, next_cursor: null });
    const ids = new Set(
      [...decodedOver.leagues, ...decodedNext.leagues].map((league) => league.id)
    );
    expect(ids.size).toBe(201);
    // A half-specified cursor is refused.
    expect(
      (
        await world.admin.client.rpc('list_leagues', {
          p_community_id: communityId,
          p_after_id: decodedOver.next_cursor!.id
        })
      ).error?.message
    ).toBe('LEAGUE_INVALID_INPUT');

    const small = await world.newCommunity(world.admin.id);
    await insertLeague({ communityId: small, ownerId: world.admin.id, startAt: day(30) });
    const under = decodeLeagueList(
      (await world.admin.client.rpc('list_leagues', { p_community_id: small })).data
    );
    expect(under).toMatchObject({ total: 1, truncated: false, next_cursor: null });
  });

  it('E2: a lifecycle change between page requests neither omits nor duplicates a League', async () => {
    const communityId = await world.newCommunity(world.admin.id);
    await bulkLeagues(communityId, 201);
    const first = decodeLeagueList(
      (await world.admin.client.rpc('list_leagues', { p_community_id: communityId })).data
    );
    const [oldest] = await sqlRows(
      `select id::text as id from public.leagues where community_id = ${sqlText(communityId)}
        order by created_at, id limit 1`
    );
    const oldestId = String(oldest?.['id']);
    expect(first.leagues.some((league) => league.id === oldestId)).toBe(false);
    // The oldest League (page 2) becomes the Active one: it now sorts first by status.
    await executeTrustedSql(`
      update public.leagues set status = 'active', start_at = now() - interval '1 day',
          activated_at = now() where id = ${sqlText(oldestId)}`);
    const second = decodeLeagueList(
      (
        await world.admin.client.rpc('list_leagues', {
          p_community_id: communityId,
          p_after_created_at: first.next_cursor!.created_at,
          p_after_id: first.next_cursor!.id
        })
      ).data
    );
    expect(second.leagues.map((league) => league.id)).toEqual([oldestId]);
    const all = [...first.leagues, ...second.leagues].map((league) => league.id);
    expect(new Set(all).size).toBe(201);
    expect(all).toHaveLength(201);
    // A fresh first page always carries the Active League, however old it is.
    const refreshed = decodeLeagueList(
      (await world.admin.client.rpc('list_leagues', { p_community_id: communityId })).data
    );
    expect(refreshed.leagues.some((league) => league.id === oldestId)).toBe(true);
  });

  it('E1: a malformed snapshot value cannot abort the audit backfill; valid references are recovered', async () => {
    const [first, second] = await Promise.all(
      [0, 1].map(() =>
        insertLeague({
          communityId: world.communityId,
          ownerId: world.owner.id,
          startAt: day(-5),
          endAt: day(60)
        })
      )
    );
    const { eventId, result } = await publishCompetitive(world.owner, world.communityId, {
      competition: 'ranked',
      league_id: first
    });
    expect(result.error).toBeNull();
    const [event] = await sqlRows(
      `select version::int as version from public.match_events where id = ${sqlText(eventId)}`
    );
    const edited = await world.owner.client.rpc('edit_match_event', {
      p_match_event_id: eventId,
      p_expected_version: Number(event?.['version']),
      p_patch: { league_id: second },
      p_request_id: crypto.randomUUID()
    });
    expect(edited.error).toBeNull();
    await executeTrustedSql(`
      insert into public.match_event_audit_log (match_event_id, community_id, actor_id, action,
          transition_revision, before_data, after_data)
        values (${sqlText(eventId)}, ${sqlText(world.communityId)}, ${sqlText(world.owner.id)}, 'minor_edit',
          900001, '{"league_id": ""}'::jsonb,
          '{"league_id": "not-a-uuid", "competition": {"league_id": "also not a uuid"}}'::jsonb);
      alter table public.league_event_references disable trigger league_event_references_immutable;
      delete from public.league_event_references where league_id = any (${sqlText(`{${first},${second}}`)}::uuid[]);
      alter table public.league_event_references enable trigger league_event_references_immutable;`);
    const [done] = await sqlRows(`select public.league_backfill_references_from_audit() as added`);
    expect(Number(done?.['added'])).toBeGreaterThanOrEqual(1);
    const [locked] = await sqlRows(
      `select public.league_has_published_events(${sqlText(first!)}) as locked`
    );
    expect(locked?.['locked']).toBe(true);
    // Idempotent.
    expect(
      Number(
        (await sqlRows(`select public.league_backfill_references_from_audit() as added`))[0]?.[
          'added'
        ]
      )
    ).toBe(0);
  });

  it('E3: stale rotation rows (resolved work, removed community) are pruned by the next run', async () => {
    const communityId = await world.newCommunity(world.admin.id);
    const leagueId = await insertLeague({
      communityId,
      ownerId: world.admin.id,
      status: 'upcoming',
      startAt: '1990-02-01T00:00:00Z'
    });
    const ghost = crypto.randomUUID();
    const holder = await openDedicatedSqlConnection();
    try {
      await holder.query('begin');
      await holder.query(
        `select 1 from public.communities where id = ${sqlText(communityId)} for update`
      );
      await processLeaguesAt(new Date().toISOString(), 100);
    } finally {
      await holder.query('rollback').catch(() => undefined);
      await holder.close();
    }
    const rotation = async (id: string) =>
      Number(
        (
          await sqlRows(
            `select count(*)::int as n from public.league_process_attempts where community_id = ${sqlText(id)}`
          )
        )[0]?.['n']
      );
    expect(await rotation(communityId)).toBe(1);
    await executeTrustedSql(`
      insert into public.league_process_attempts (community_id, attempted_at) values (${sqlText(ghost)}, now());
      update public.leagues set status = 'active', activated_at = now() where id = ${sqlText(leagueId)};`);
    await processLeaguesAt(new Date().toISOString(), 100);
    expect(await rotation(communityId)).toBe(0);
    expect(await rotation(ghost)).toBe(0);
  });

  it('E4: an overlapping invocation exits cleanly instead of blocking on a rotation row', async () => {
    const communityId = await world.newCommunity(world.admin.id);
    await insertLeague({
      communityId,
      ownerId: world.admin.id,
      status: 'upcoming',
      startAt: '1990-03-01T00:00:00Z'
    });
    const holder = await openDedicatedSqlConnection();
    let overlapping: Promise<unknown> | undefined;
    try {
      // The first invocation, mid-run: scheduler lock, a locked community, its rotation row.
      await holder.query('begin');
      await holder.query(
        `select pg_advisory_xact_lock(hashtextextended('padel-friend:process_due_leagues', 0))`
      );
      await holder.query(
        `select 1 from public.communities where id = ${sqlText(communityId)} for update`
      );
      await holder.query(
        `insert into public.league_process_attempts (community_id, attempted_at)
           values (${sqlText(communityId)}, clock_timestamp())
           on conflict (community_id) do update set attempted_at = excluded.attempted_at`
      );
      overlapping = processLeaguesAt(new Date().toISOString(), 100);
      const outcome = await Promise.race([
        overlapping.then((result) => result),
        new Promise<string>((resolveTimeout) => setTimeout(() => resolveTimeout('blocked'), 8000))
      ]);
      expect(outcome).toMatchObject({ busy: true, processed: 0 });
    } finally {
      await holder.query('rollback').catch(() => undefined);
      await holder.close();
      await overlapping?.catch(() => undefined);
      await executeTrustedSql(`
        update public.leagues set start_at = '2999-01-01T00:00:00Z'
          where community_id = ${sqlText(communityId)} and status = 'upcoming'`);
    }
  });

  it('F1 (upgrade): a League referenced only in edit-audit history is recovered and stays period-locked', async () => {
    const [first, second] = await Promise.all(
      [0, 1].map(() =>
        insertLeague({
          communityId: world.communityId,
          ownerId: world.owner.id,
          startAt: day(-5),
          endAt: day(60)
        })
      )
    );
    const publish = async (leagueId: string) => {
      const { eventId, result } = await publishCompetitive(world.owner, world.communityId, {
        competition: 'ranked',
        league_id: leagueId
      });
      expect(result.error).toBeNull();
      return eventId;
    };
    const switchTo = async (eventId: string, leagueId: string | null) => {
      const [event] = await sqlRows(
        `select version::int as version from public.match_events where id = ${sqlText(eventId)}`
      );
      const edited = await world.owner.client.rpc('edit_match_event', {
        p_match_event_id: eventId,
        p_expected_version: Number(event?.['version']),
        p_patch: { league_id: leagueId },
        p_request_id: crypto.randomUUID()
      });
      expect(edited.error).toBeNull();
    };
    // Event 1: first -> second. Event 2: first -> Unranked. Both end with no event on `first`.
    const toLeague = await publish(first!);
    await switchTo(toLeague, second!);
    const toUnranked = await publish(first!);
    await switchTo(toUnranked, null);
    // Simulate the pre-migration state: no reference history exists yet.
    const wipe = `
      alter table public.league_event_references disable trigger league_event_references_immutable;
      delete from public.league_event_references where league_id = any (${sqlText(`{${first},${second}}`)}::uuid[]);
      alter table public.league_event_references enable trigger league_event_references_immutable;
      insert into public.league_event_references (league_id, match_event_id)
        select e.league_id, e.id from public.match_events e where e.league_id = ${sqlText(second!)};`;
    await executeTrustedSql(wipe);
    const locked = async (leagueId: string) =>
      (
        await sqlRows(`select public.league_has_published_events(${sqlText(leagueId)}) as locked`)
      )[0]?.['locked'];
    // The round-1 backfill (current bindings only) cannot recover it.
    await executeTrustedSql(`
      insert into public.league_event_references (league_id, match_event_id, first_referenced_at)
        select e.league_id, e.id, e.published_at from public.match_events e where e.league_id is not null
        on conflict do nothing;`);
    expect(await locked(first!)).toBe(false);
    // The round-2 audit backfill does, idempotently.
    const migration = readFileSync(
      resolvePath(process.cwd(), 'supabase/migrations/20261101193000_league_review_round2.sql'),
      'utf8'
    );
    const backfill = migration.slice(
      migration.indexOf('insert into public.league_event_references'),
      migration.indexOf('-- 2. F4')
    );
    // The amended round-2 INSERT itself must tolerate malformed snapshots (fresh-DB replay path):
    // every uuid cast is guarded, and malformed rows sit next to the valid ones.
    expect(backfill.match(/pg_input_is_valid/g)).toHaveLength(4);
    expect(backfill.match(/::uuid/g)).toHaveLength(4);
    await executeTrustedSql(`
      insert into public.match_event_audit_log (match_event_id, community_id, actor_id, action,
          transition_revision, before_data, after_data)
        values (${sqlText(toLeague)}, ${sqlText(world.communityId)}, ${sqlText(world.owner.id)}, 'minor_edit',
          900002, '{"league_id": "", "competition": {"league_id": "nope"}}'::jsonb,
          '{"league_id": "not-a-uuid", "competition": {"league_id": 42}}'::jsonb)`);
    await executeTrustedSql(backfill);
    await executeTrustedSql(backfill);
    expect(await locked(first!)).toBe(true);
    const extend = await world.admin.client.rpc('update_league', {
      p_league_id: first!,
      p_expected_version: Number((await leagueRow(first!)).version),
      p_changes: { end_date: isoDay(90) }
    });
    expect(extend.error?.message).toBe('LEAGUE_PERIOD_LOCKED');
  });
});
