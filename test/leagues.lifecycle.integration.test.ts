import { beforeAll, describe, expect, it } from 'vitest';
import { decodeLeagueDetail, decodeLeagueDto } from '../src/features/leagues/league-decoders';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import {
  createLeagueArgs,
  insertLeague,
  leagueEventActions,
  leagueRow,
  leagueWorld,
  localDate,
  processLeaguesAt,
  sqlRows,
  recordOf,
  type LeagueTimezone,
  type LeagueWorld
} from './helpers/league-fixtures';
import { sqlText } from './helpers/provisional-player-fixtures';
import { executeTrustedSql, openDedicatedSqlConnection } from './helpers/sql-transport';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

const iso = (value: unknown) => new Date(String(value)).toISOString();
/** ISO instant moved by whole microseconds, computed by PostgreSQL (JS Dates stop at milliseconds). */
async function shift(instant: string, microseconds: number): Promise<string> {
  const [row] = await sqlRows(
    `select to_char((${sqlText(instant)}::timestamptz + (${microseconds} * interval '1 microsecond')) at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as instant`
  );
  return String(row?.['instant']);
}
const microsecondBefore = (instant: string) => shift(instant, -1);
const microsecondAfter = (instant: string) => shift(instant, 1);

/** Narrows the processor's `{closed, activated, blocked}` answer without trusting its shape. */
function transitionCounts(value: unknown): { closed: number; activated: number; blocked: number } {
  const row = recordOf(value);
  return {
    closed: Number(row['closed']),
    activated: Number(row['activated']),
    blocked: Number(row['blocked'])
  };
}

describe('League lifecycle', { timeout: 300_000 }, () => {
  let world: LeagueWorld;

  const community = () => world.newCommunity(world.admin.id);
  const processAt = async (communityId: string, asOf: string) => {
    const [row] = await sqlRows(
      `select public.league_process_community_locked(${sqlText(communityId)}, ${sqlText(asOf)}::timestamptz) as result`
    );
    return transitionCounts(row?.['result']);
  };
  const rpc = {
    activate: async (id: string) => {
      const { version } = await leagueRow(id);
      return world.admin.client.rpc('activate_league', {
        p_league_id: id,
        p_expected_version: Number(version)
      });
    },
    close: async (id: string) => {
      const { version } = await leagueRow(id);
      return world.admin.client.rpc('close_league', {
        p_league_id: id,
        p_expected_version: Number(version)
      });
    }
  };
  const setZone = async (communityId: string, timezone: LeagueTimezone) => {
    const result = await world.admin.client.rpc('update_community_admin_defaults', {
      p_community_id: communityId,
      p_defaults: { timezone, currency: 'EUR', member_created_leagues_enabled: true }
    });
    expect(result.error).toBeNull();
  };

  beforeAll(async () => {
    if (!environment.env) return;
    world = await leagueWorld(environment.env, 'lifecycle');
  });

  describe('due activation', () => {
    it.skipIf(!environment.env)(
      'activates a due Upcoming League exactly at its inclusive start',
      async () => {
        const communityId = await community();
        const start = '2031-03-01T10:00:00.000000Z';
        const id = await insertLeague({
          communityId,
          ownerId: world.admin.id,
          startAt: start,
          endAt: null
        });
        expect(await processAt(communityId, await microsecondBefore(start))).toEqual({
          closed: 0,
          activated: 0,
          blocked: 0
        });
        expect((await leagueRow(id))['status']).toBe('upcoming');
        expect(await processAt(communityId, start)).toEqual({
          closed: 0,
          activated: 1,
          blocked: 0
        });
        expect(await leagueRow(id)).toMatchObject({ status: 'active', version: 2 });
        expect(iso((await leagueRow(id))['activated_at'])).toBe(iso(start));
        expect(await leagueEventActions(id)).toEqual(['activated:due_start']);
      }
    );

    it.skipIf(!environment.env)('is idempotent: a second run changes nothing', async () => {
      const communityId = await community();
      const id = await insertLeague({
        communityId,
        ownerId: world.admin.id,
        startAt: '2031-03-01T00:00:00Z',
        endAt: null
      });
      await processAt(communityId, '2031-03-02T00:00:00Z');
      const first = await leagueRow(id);
      expect(await processAt(communityId, '2031-03-03T00:00:00Z')).toEqual({
        closed: 0,
        activated: 0,
        blocked: 0
      });
      expect(await leagueRow(id)).toEqual(first);
      expect(await leagueEventActions(id)).toEqual(['activated:due_start']);
    });

    it.skipIf(!environment.env)(
      'leaves Leagues that are not due yet Upcoming and allows several',
      async () => {
        const communityId = await community();
        const a = await insertLeague({
          communityId,
          ownerId: world.admin.id,
          startAt: '2032-01-01T00:00:00Z',
          endAt: null
        });
        const b = await insertLeague({
          communityId,
          ownerId: world.admin.id,
          startAt: '2032-02-01T00:00:00Z',
          endAt: null
        });
        expect(await processAt(communityId, '2031-12-31T23:59:59.999999Z')).toEqual({
          closed: 0,
          activated: 0,
          blocked: 0
        });
        expect([(await leagueRow(a))['status'], (await leagueRow(b))['status']]).toEqual([
          'upcoming',
          'upcoming'
        ]);
      }
    );
  });

  describe('conflicting due Leagues', () => {
    it.skipIf(!environment.env)(
      'keeps a due Upcoming League blocked while an Active League exists and resolves by explicit activation',
      async () => {
        const communityId = await community();
        const active = await insertLeague({
          communityId,
          ownerId: world.admin.id,
          startAt: '2024-01-01T00:00:00Z',
          endAt: null,
          status: 'active'
        });
        const waiting = await insertLeague({
          communityId,
          ownerId: world.admin.id,
          startAt: '2024-02-01T00:00:00Z',
          endAt: null
        });

        expect(await processAt(communityId, '2024-02-01T00:00:00Z')).toEqual({
          closed: 0,
          activated: 0,
          blocked: 1
        });
        const blocked = await leagueRow(waiting);
        expect(blocked['status']).toBe('upcoming');
        expect(blocked['activation_blocked_at']).not.toBeNull();
        expect(await leagueEventActions(waiting)).toEqual([
          'activation_blocked:activation_conflict'
        ]);
        // Re-running does not re-block or duplicate the audit evidence.
        expect(await processAt(communityId, '2024-02-02T00:00:00Z')).toEqual({
          closed: 0,
          activated: 0,
          blocked: 0
        });
        expect(await leagueEventActions(waiting)).toHaveLength(1);

        const visible = await world.admin.client.rpc('get_league', { p_league_id: waiting });
        expect(decodeLeagueDetail(visible.data).league).toMatchObject({
          status: 'upcoming',
          blocked_reason: 'active_league_exists'
        });
        // Activation is refused while the slot is taken.
        expect((await rpc.activate(waiting)).error?.message).toBe('LEAGUE_ACTIVE_EXISTS');

        // The slot frees through the audited manual close; the blocked League does NOT jump in by itself.
        expect((await rpc.close(active)).error).toBeNull();
        expect(await processAt(communityId, '2024-03-01T00:00:00Z')).toEqual({
          closed: 0,
          activated: 0,
          blocked: 0
        });
        expect((await leagueRow(waiting))['status']).toBe('upcoming');
        const afterClose = await world.admin.client.rpc('get_league', { p_league_id: waiting });
        expect(decodeLeagueDetail(afterClose.data).league.blocked_reason).toBe(
          'explicit_activation_required'
        );

        const activated = await rpc.activate(waiting);
        expect(activated.error).toBeNull();
        expect(decodeLeagueDto(activated.data)).toMatchObject({
          status: 'active',
          blocked_reason: null
        });
        expect(await leagueRow(waiting)).toMatchObject({
          status: 'active',
          activation_blocked_at: null
        });
        expect((await leagueEventActions(waiting)).at(-1)).toBe('activated');
      }
    );

    it.skipIf(!environment.env)(
      'never picks an arbitrary winner among several due Upcoming Leagues',
      async () => {
        const communityId = await community();
        const first = await insertLeague({
          communityId,
          ownerId: world.admin.id,
          startAt: '2024-01-01T00:00:00Z',
          endAt: null
        });
        const second = await insertLeague({
          communityId,
          ownerId: world.admin.id,
          startAt: '2024-01-02T00:00:00Z',
          endAt: null
        });
        expect(await processAt(communityId, '2024-01-05T00:00:00Z')).toEqual({
          closed: 0,
          activated: 0,
          blocked: 2
        });
        expect(
          (
            await sqlRows(
              `select count(*)::int as n from public.leagues where community_id = ${sqlText(communityId)} and status = 'active'`
            )
          )[0]
        ).toEqual({ n: 0 });
        const view = await world.admin.client.rpc('get_league', { p_league_id: first });
        expect(decodeLeagueDetail(view.data).league.blocked_reason).toBe(
          'explicit_activation_required'
        );

        expect((await rpc.activate(second)).error).toBeNull();
        expect((await leagueRow(first))['status']).toBe('upcoming');
        const afterwards = await world.admin.client.rpc('get_league', { p_league_id: first });
        expect(decodeLeagueDetail(afterwards.data).league.blocked_reason).toBe(
          'active_league_exists'
        );
        expect((await rpc.activate(first)).error?.message).toBe('LEAGUE_ACTIVE_EXISTS');
      }
    );

    it.skipIf(!environment.env)(
      'rejects explicit activation before the start instant',
      async () => {
        const communityId = await community();
        const future = await insertLeague({
          communityId,
          ownerId: world.admin.id,
          startAt: '2040-01-01T00:00:00Z',
          endAt: null
        });
        expect((await rpc.activate(future)).error?.message).toBe('LEAGUE_NOT_DUE');
        const view = await world.admin.client.rpc('get_league', { p_league_id: future });
        expect(decodeLeagueDetail(view.data).league).toMatchObject({
          status: 'upcoming',
          activation_due: false
        });
      }
    );

    it.skipIf(!environment.env)(
      'reports a due Upcoming League the scheduler has not processed yet as activation-due',
      async () => {
        const communityId = await community();
        const due = await insertLeague({
          communityId,
          ownerId: world.admin.id,
          startAt: '2024-01-01T00:00:00Z',
          endAt: null
        });
        const view = await world.admin.client.rpc('get_league', { p_league_id: due });
        expect(decodeLeagueDetail(view.data).league).toMatchObject({
          status: 'upcoming',
          activation_due: true,
          blocked_reason: null
        });
        // Readers never mutate: the League is still Upcoming and unmarked afterwards.
        expect(await leagueRow(due)).toMatchObject({
          status: 'upcoming',
          activation_blocked_at: null
        });
        // Any command reconciles the community first: the due League starts inside the explicit
        // activation, which therefore answers idempotently instead of failing on its own side effect.
        const activated = await rpc.activate(due);
        expect(activated.error).toBeNull();
        expect(decodeLeagueDto(activated.data)).toMatchObject({ status: 'active', version: 2 });
        expect(await leagueEventActions(due)).toEqual(['activated:due_start']);
      }
    );
  });

  describe('Fixed end expiry', () => {
    it.skipIf(!environment.env)(
      'keeps a Fixed League Active through its inclusive end and closes it one microsecond later',
      async () => {
        const communityId = await community();
        const end = '2031-04-30T21:59:59.999999Z';
        const id = await insertLeague({
          communityId,
          ownerId: world.admin.id,
          startAt: '2031-04-01T00:00:00Z',
          endAt: end,
          status: 'active'
        });
        expect(await processAt(communityId, end)).toEqual({ closed: 0, activated: 0, blocked: 0 });
        expect((await leagueRow(id))['status']).toBe('active');
        expect(await processAt(communityId, await microsecondAfter(end))).toEqual({
          closed: 1,
          activated: 0,
          blocked: 0
        });
        const row = await leagueRow(id);
        expect(row).toMatchObject({
          status: 'closed',
          closed_reason: 'fixed_end_reached',
          closed_by: null
        });
        // The effective close instant is the inclusive end, not when the scheduler noticed.
        expect(iso(row['closed_at'])).toBe(iso(end));
        expect(await leagueEventActions(id)).toEqual(['closed:fixed_end_reached']);
      }
    );

    it.skipIf(!environment.env)(
      'reconciles the expired League before allocating the Active slot (catch-up after downtime)',
      async () => {
        const communityId = await community();
        const old = await insertLeague({
          communityId,
          ownerId: world.admin.id,
          startAt: '2031-05-01T00:00:00Z',
          endAt: '2031-05-31T23:59:59.999999Z',
          status: 'active'
        });
        const next = await insertLeague({
          communityId,
          ownerId: world.admin.id,
          startAt: '2031-06-01T00:00:00Z',
          endAt: null
        });
        // Scheduler was down for weeks: one pass closes the old League and promotes the next.
        expect(await processAt(communityId, '2031-07-15T00:00:00Z')).toEqual({
          closed: 1,
          activated: 1,
          blocked: 0
        });
        expect((await leagueRow(old))['status']).toBe('closed');
        expect((await leagueRow(next))['status']).toBe('active');
      }
    );

    it.skipIf(!environment.env)(
      'blocks a successor that started before the previous League ended',
      async () => {
        const communityId = await community();
        const old = await insertLeague({
          communityId,
          ownerId: world.admin.id,
          startAt: '2031-05-01T00:00:00Z',
          endAt: '2031-05-31T23:59:59.999999Z',
          status: 'active'
        });
        const overlapping = await insertLeague({
          communityId,
          ownerId: world.admin.id,
          startAt: '2031-05-15T00:00:00Z',
          endAt: null
        });
        expect(await processAt(communityId, '2031-07-15T00:00:00Z')).toEqual({
          closed: 1,
          activated: 0,
          blocked: 1
        });
        expect((await leagueRow(old))['status']).toBe('closed');
        expect(await leagueRow(overlapping)).toMatchObject({ status: 'upcoming' });
        expect((await leagueRow(overlapping))['activation_blocked_at']).not.toBeNull();
      }
    );

    it.skipIf(!environment.env)(
      'closes an Upcoming Fixed League whose whole window passed unused',
      async () => {
        const communityId = await community();
        const id = await insertLeague({
          communityId,
          ownerId: world.admin.id,
          startAt: '2031-01-01T00:00:00Z',
          endAt: '2031-01-10T00:00:00Z'
        });
        expect(await processAt(communityId, '2031-02-01T00:00:00Z')).toEqual({
          closed: 1,
          activated: 0,
          blocked: 0
        });
        expect(await leagueRow(id)).toMatchObject({
          status: 'closed',
          closed_reason: 'expired_before_activation'
        });
        expect(await leagueEventActions(id)).toEqual(['closed:expired_before_activation']);
      }
    );
  });

  describe('Manual end', () => {
    it.skipIf(!environment.env)(
      'stays Active indefinitely until an authorized, audited close',
      async () => {
        const communityId = await community();
        const id = await insertLeague({
          communityId,
          ownerId: world.admin.id,
          startAt: '2020-01-01T00:00:00Z',
          endAt: null,
          status: 'active'
        });
        expect(await processAt(communityId, '2090-01-01T00:00:00Z')).toEqual({
          closed: 0,
          activated: 0,
          blocked: 0
        });
        expect((await leagueRow(id))['status']).toBe('active');

        const before = Date.now();
        const closed = await rpc.close(id);
        expect(closed.error).toBeNull();
        expect(decodeLeagueDto(closed.data)).toMatchObject({
          status: 'closed',
          closed_reason: 'manual'
        });
        const row = await leagueRow(id);
        expect(row).toMatchObject({
          status: 'closed',
          closed_reason: 'manual',
          closed_by: world.admin.id
        });
        expect(Date.parse(iso(row['closed_at']))).toBeGreaterThanOrEqual(before - 1000);
        expect(await leagueEventActions(id)).toEqual(['closed']);
        const [audit] = await sqlRows(
          `select actor_id::text as actor from public.league_events where league_id = ${sqlText(id)} and action = 'closed'`
        );
        expect(audit).toEqual({ actor: world.admin.id });
        // Closed is terminal: it cannot be activated again, and a repeated close is a no-op replay
        // (same outcome, no second audit entry).
        const replay = await rpc.close(id);
        expect(replay.error).toBeNull();
        expect(replay.data).toEqual(closed.data);
        expect(await leagueEventActions(id)).toEqual(['closed']);
        expect((await rpc.activate(id)).error?.message).toBe('LEAGUE_INVALID_STATE');
      }
    );

    it.skipIf(!environment.env)(
      'refuses to close a Fixed League early (no covert date edits)',
      async () => {
        const communityId = await community();
        const id = await insertLeague({
          communityId,
          ownerId: world.admin.id,
          startAt: '2020-01-01T00:00:00Z',
          endAt: '2090-01-01T00:00:00Z',
          status: 'active'
        });
        expect((await rpc.close(id)).error?.message).toBe('LEAGUE_CLOSE_NOT_MANUAL');
        expect((await leagueRow(id))['status']).toBe('active');
      }
    );
  });

  describe('timezone snapshot and DST-safe instants', () => {
    it.skipIf(!environment.env)(
      'stores UTC instants for both supported zones across the DST changes',
      async () => {
        const madrid = await community();
        const utc = await community();
        await setZone(utc, 'UTC');
        const create = (communityId: string, start: string, end: string) =>
          world.admin.client.rpc('create_league', {
            ...createLeagueArgs(communityId, { p_start_date: start, p_end_date: end })
          });

        // Madrid: midnight CET (+1) in winter, CEST (+2) in summer; the whole spring-forward and
        // fall-back days sit inside the window and the last day runs to its last microsecond.
        const springForward = await create(madrid, '2030-03-31', '2030-10-27');
        expect(springForward.error).toBeNull();
        expect(springForward.data).toMatchObject({
          timezone: 'Europe/Madrid',
          start_at: '2030-03-30T23:00:00.000000Z',
          end_at: '2030-10-27T22:59:59.999999Z',
          start_date: '2030-03-31',
          end_date: '2030-10-27'
        });
        const summer = await create(madrid, '2030-07-01', '2030-07-31');
        expect(summer.data).toMatchObject({
          start_at: '2030-06-30T22:00:00.000000Z',
          end_at: '2030-07-31T21:59:59.999999Z'
        });
        const winter = await create(madrid, '2030-12-01', '2030-12-31');
        expect(winter.data).toMatchObject({
          start_at: '2030-11-30T23:00:00.000000Z',
          end_at: '2030-12-31T22:59:59.999999Z'
        });

        const utcLeague = await create(utc, '2030-03-31', '2030-10-27');
        expect(utcLeague.data).toMatchObject({
          timezone: 'UTC',
          start_at: '2030-03-31T00:00:00.000000Z',
          end_at: '2030-10-27T23:59:59.999999Z'
        });
      }
    );

    it.skipIf(!environment.env)(
      'keeps the creation-time timezone when the community zone changes later',
      async () => {
        const communityId = await community();
        const created = await world.admin.client.rpc('create_league', {
          ...createLeagueArgs(communityId, { p_start_date: '2030-09-01', p_end_date: '2030-09-30' })
        });
        const dto = decodeLeagueDto(created.data);
        expect(dto.timezone).toBe('Europe/Madrid');
        await setZone(communityId, 'UTC');
        const reread = await world.admin.client.rpc('get_league', { p_league_id: dto.id });
        expect(decodeLeagueDetail(reread.data).league).toMatchObject({
          timezone: 'Europe/Madrid',
          start_at: dto.start_at,
          end_at: dto.end_at,
          start_date: '2030-09-01',
          end_date: '2030-09-30'
        });
      }
    );

    it.skipIf(!environment.env)(
      'a start day that begins at the local-midnight instant activates at the UTC equivalent, not the UTC day start',
      async () => {
        const communityId = await community();
        const created = await world.admin.client.rpc('create_league', {
          ...createLeagueArgs(communityId, {
            p_start_date: localDate(20),
            p_end_date: localDate(40),
            p_end_mode: 'fixed_date'
          })
        });
        const dto = decodeLeagueDto(created.data);
        expect(dto.status).toBe('upcoming');
        const startInstant = iso(dto.start_at);
        expect(await processAt(communityId, await microsecondBefore(startInstant))).toEqual({
          closed: 0,
          activated: 0,
          blocked: 0
        });
        expect(await processAt(communityId, startInstant)).toEqual({
          closed: 0,
          activated: 1,
          blocked: 0
        });
      }
    );
  });

  describe('scheduler processor', () => {
    it.skipIf(!environment.env)(
      'processes communities with due work and skips communities locked by a command',
      async () => {
        const free = await community();
        const locked = await community();
        const freeLeague = await insertLeague({
          communityId: free,
          ownerId: world.admin.id,
          startAt: '2033-01-01T00:00:00Z',
          endAt: null
        });
        const lockedLeague = await insertLeague({
          communityId: locked,
          ownerId: world.admin.id,
          startAt: '2033-01-01T00:00:00Z',
          endAt: null
        });

        const holder = await openDedicatedSqlConnection();
        try {
          await holder.query('begin');
          await holder.query(
            `select 1 from public.communities where id = ${sqlText(locked)} for update`
          );
          const result = await processLeaguesAt('2033-01-02T00:00:00Z', 100);
          expect(result).toMatchObject({ failed: 0 });
          expect(Number(result['skipped'])).toBeGreaterThanOrEqual(1);
          expect((await leagueRow(freeLeague))['status']).toBe('active');
          expect((await leagueRow(lockedLeague))['status']).toBe('upcoming');
        } finally {
          await holder.query('rollback');
          await holder.close();
        }
        // Next run catches up the community that was busy.
        expect(await processLeaguesAt('2033-01-03T00:00:00Z', 100)).toMatchObject({ failed: 0 });
        expect((await leagueRow(lockedLeague))['status']).toBe('active');
      }
    );

    it.skipIf(!environment.env)(
      'isolates a failing community and reports it while other communities still advance',
      async () => {
        const broken = await community();
        const healthy = await community();
        const brokenLeague = await insertLeague({
          communityId: broken,
          ownerId: world.admin.id,
          startAt: '2034-01-01T00:00:00Z',
          endAt: null,
          name: 'BOOM league'
        });
        const healthyLeague = await insertLeague({
          communityId: healthy,
          ownerId: world.admin.id,
          startAt: '2034-01-01T00:00:00Z',
          endAt: null
        });
        await executeTrustedSql(`
        create function public.league_test_boom() returns trigger language plpgsql as $$
        begin raise exception 'boom for test'; end $$;
        create trigger league_test_boom before update on public.leagues
          for each row when (old.name = 'BOOM league') execute function public.league_test_boom();`);
        try {
          const result = await processLeaguesAt('2034-01-02T00:00:00Z', 100);
          expect(Number(result['failed'])).toBe(1);
          expect(JSON.stringify(result['errors'])).toContain(broken);
          expect((await leagueRow(healthyLeague))['status']).toBe('active');
          expect((await leagueRow(brokenLeague))['status']).toBe('upcoming');
        } finally {
          await executeTrustedSql(`
          drop trigger league_test_boom on public.leagues;
          drop function public.league_test_boom();`);
        }
        // Once the fault clears the next run catches the community up.
        expect(await processLeaguesAt('2034-01-03T00:00:00Z', 100)).toMatchObject({ failed: 0 });
        expect((await leagueRow(brokenLeague))['status']).toBe('active');
      }
    );

    it.skipIf(!environment.env)(
      'registers the singleton pg_cron job, or reports that the scheduler is unavailable',
      async (context) => {
        const [extension] = await sqlRows(
          `select count(*)::int as n from pg_extension where extname = 'pg_cron'`
        );
        if (Number(extension?.['n']) === 0) {
          console.warn(
            'pg_cron is not installed here: the League lifecycle job is NOT provisioned (processor stays manual).'
          );
          context.skip();
          return;
        }
        const jobs = await sqlRows(
          `select schedule, command from cron.job where jobname = 'padel-friend-league-lifecycle'`
        );
        expect(jobs).toEqual([
          { schedule: '* * * * *', command: 'select public.process_due_leagues(25)' }
        ]);
      }
    );
  });
});
