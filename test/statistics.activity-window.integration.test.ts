import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, fixtureSql } from './helpers/match-registration-sql';
import {
  insertFixtureCommunity,
  insertFixtureEvent,
  provisionProvisionalPlayer,
  signUpFixtureActor,
  sqlText
} from './helpers/provisional-player-fixtures';
import {
  createRankedResultFixtures,
  setMembershipHistory,
  type RankedResultKit
} from './helpers/ranked-result-fixtures';
import { openDedicatedSqlConnection, sqlErrorMessage } from './helpers/sql-transport';
import { decodePlayerStatistics } from '../src/features/statistics/statistics-player.server';

const environment = localSupabaseEnv();

const MS_PER_DAY = 86_400_000;
const NIL = '00000000-0000-0000-0000-000000000000';
const MAX_DAYS = 366;

type Bucket = { day: string; groups: number };
type Claims = Record<string, unknown>;
type CallArgs = { community?: string | null; from?: string | null; through?: string | null };

const list = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new Error('Expected an array');
  return value;
};
const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / MS_PER_DAY;
const dayText = (value: number) => new Date(value * MS_PER_DAY).toISOString().slice(0, 10);
// 1970-01-01 (day 0) is a Thursday, so (day + 3) % 7 days have passed since the ISO Monday.
const weekStart = (value: number) => value - ((((value + 3) % 7) + 7) % 7);
const monthStart = (value: number) => `${dayText(value).slice(0, 7)}-01`;

/**
 * Independent reference of the activity contract. It deliberately walks the FULL gap-filled scope
 * in JavaScript (the original semantics) and derives the bounded window from it, so every
 * expectation below is compared against the former complete-series behavior.
 */
function activityModel(buckets: Bucket[], from: string | null, through: string | null) {
  const inScope = buckets.filter(
    (bucket) => (from === null || bucket.day >= from) && (through === null || bucket.day <= through)
  );
  if (inScope.length === 0) return null;
  const groupsOn = new Map(inScope.map((bucket) => [bucket.day, bucket.groups]));
  const first = from ?? [...groupsOn.keys()].sort()[0]!;
  const last = through ?? [...groupsOn.keys()].sort().at(-1)!;
  const all: Bucket[] = [];
  for (let day = dayNumber(first); day <= dayNumber(last); day += 1)
    all.push({ day: dayText(day), groups: groupsOn.get(dayText(day)) ?? 0 });
  const sum = (items: Bucket[], key: (day: number) => string) => {
    const periods = new Map<string, number>();
    for (const item of items) {
      const period = key(dayNumber(item.day));
      periods.set(period, (periods.get(period) ?? 0) + item.groups);
    }
    return [...periods.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([period, groups]) => ({ period, groups }));
  };
  const best = (items: { period: string; groups: number }[]) =>
    items.reduce((winner, item) => (item.groups > winner.groups ? item : winner));
  const week = (value: number) => dayText(weekStart(value));
  const windowStart = Math.max(dayNumber(first), dayNumber(last) - (MAX_DAYS - 1));
  const windowDays = all.filter((item) => dayNumber(item.day) >= windowStart);
  const played = inScope.reduce((total, bucket) => total + bucket.groups, 0);
  return {
    fromDay: first,
    throughDay: last,
    window: {
      fromDay: dayText(windowStart),
      throughDay: last,
      maxDays: MAX_DAYS,
      truncated: dayText(windowStart) > first
    },
    days: windowDays.map((item) => ({ period: item.day, groups: item.groups })),
    weeks: sum(windowDays, week),
    months: sum(windowDays, monthStart).map((item) => ({
      period: item.period.slice(0, 7),
      groups: item.groups
    })),
    mostActiveWeek: best(sum(all, week)),
    mostActiveMonth: (() => {
      const winner = best(sum(all, monthStart));
      return { period: winner.period.slice(0, 7), groups: winner.groups };
    })(),
    weeklyAverage: played / Math.max(1, (dayNumber(last) - dayNumber(first) + 1) / 7)
  };
}

describe.skipIf(!environment.env)(
  'player statistics bounded activity window',
  { timeout: 300_000 },
  () => {
    let kit: RankedResultKit;
    let owner: string;
    let member: string;
    let communityId: string;
    let emptyPlayer: string;

    beforeAll(async () => {
      kit = await createRankedResultFixtures(environment.env!);
      owner = kit.players[0]!.id;
      member = kit.players[1]!.id;
      emptyPlayer = kit.players[2]!.id;
      communityId = kit.communityId;
      // Earlier suites in the shared database may leave a statistics/rating revision lag.
      await fixtureSql('select public.statistics_publish();');
    });
    afterAll(async () => {
      if (kit) await kit.cleanup();
    });

    function seedSql(
      playerId: string,
      buckets: Bucket[],
      scope: { kind: 'all' | 'community'; id: string } = { kind: 'all', id: NIL }
    ) {
      const total = buckets.reduce((sum, bucket) => sum + bucket.groups, 0);
      const player = sqlText(playerId);
      const columns = `subject_kind, subject_a, subject_players, scope_kind, scope_id, match_type`;
      const shared = `'player', ${player}, array[${player}]::uuid[], '${scope.kind}', ${sqlText(scope.id)}, 'all'`;
      const counts = (groups: number) => `${groups}, ${groups}, ${groups}`;
      return [
        `insert into public.statistics_scope_summaries (${columns}, confirmed_groups, wins, competitive_groups)
          values (${shared}, ${counts(total)})`,
        ...buckets.map(
          (bucket) =>
            `insert into public.statistics_daily_buckets (${columns}, played_day, confirmed_groups, wins, competitive_groups)
              values (${shared}, ${sqlText(bucket.day)}::date, ${counts(bucket.groups)})`
        )
      ];
    }

    /**
     * SIMULATED claims on a dedicated transaction that is discarded on close: trusted seeding as
     * the connection owner, then the authenticated role with transaction-local request.jwt.claims.
     */
    async function read(
      actor: { sub?: string; claims?: Claims; role?: 'authenticated' | 'anon' },
      playerId: string,
      args: CallArgs,
      seeds: string[] = []
    ): Promise<{ data: Record<string, unknown> | null; error: string | null }> {
      const connection = await openDedicatedSqlConnection();
      try {
        await connection.query('begin');
        for (const statement of seeds) await connection.query(statement);
        await connection.query(`set local role ${actor.role ?? 'authenticated'}`);
        const claims = {
          role: 'authenticated',
          ...(actor.sub ? { sub: actor.sub } : {}),
          ...actor.claims
        };
        await connection.query("select set_config('request.jwt.claims', $1, true)", {
          values: [JSON.stringify(claims)]
        });
        try {
          const result = await connection.query(
            `select public.get_player_statistics($1::uuid, $2::uuid, null, 'all', $3::date, $4::date) as result`,
            { values: [playerId, args.community ?? null, args.from ?? null, args.through ?? null] }
          );
          return { data: asRecord(result.rows[0]?.['result']), error: null };
        } catch (error) {
          return { data: null, error: sqlErrorMessage(error).split('\n')[0]! };
        }
      } finally {
        await connection.close();
      }
    }
    const own = (args: CallArgs, buckets: Bucket[] = [], playerId = owner) =>
      read({ sub: playerId }, playerId, args, seedSql(playerId, buckets));
    const activityOf = (data: Record<string, unknown> | null) => asRecord(data?.['activity']);

    function expectModel(
      activity: Record<string, unknown>,
      model: NonNullable<ReturnType<typeof activityModel>>
    ) {
      expect(activity['fromDay']).toBe(model.fromDay);
      expect(activity['throughDay']).toBe(model.throughDay);
      expect(activity['window']).toEqual(model.window);
      expect(activity['days']).toEqual(model.days);
      expect(activity['weeks']).toEqual(model.weeks);
      expect(activity['months']).toEqual(model.months);
      expect(activity['mostActiveWeek']).toMatchObject({
        state: 'ready',
        value: model.mostActiveWeek
      });
      expect(activity['mostActiveMonth']).toMatchObject({
        state: 'ready',
        value: model.mostActiveMonth
      });
      expect(Number(asRecord(activity['weeklyAverage'])['value'])).toBeCloseTo(
        model.weeklyAverage,
        8
      );
    }

    const CASES: {
      name: string;
      buckets: Bucket[];
      from: string | null;
      through: string | null;
    }[] = [
      {
        name: '1-day range',
        buckets: [{ day: '2026-03-10', groups: 3 }],
        from: '2026-03-10',
        through: '2026-03-10'
      },
      {
        name: '5-day range with gaps',
        buckets: [
          { day: '2026-03-10', groups: 2 },
          { day: '2026-03-12', groups: 1 }
        ],
        from: '2026-03-08',
        through: '2026-03-12'
      },
      {
        name: '21-day range',
        buckets: [
          { day: '2026-03-03', groups: 1 },
          { day: '2026-03-15', groups: 4 },
          { day: '2026-03-21', groups: 2 }
        ],
        from: '2026-03-01',
        through: '2026-03-21'
      },
      {
        name: 'exactly 366 inclusive days',
        buckets: [
          { day: '2024-06-30', groups: 1 },
          { day: '2024-12-10', groups: 2 },
          { day: '2025-06-30', groups: 1 }
        ],
        from: '2024-06-30',
        through: '2025-06-30'
      },
      {
        name: '367-day oversized range with the best week and month outside the window',
        buckets: [
          { day: '2024-06-29', groups: 5 },
          { day: '2024-12-10', groups: 2 },
          { day: '2025-06-30', groups: 1 }
        ],
        from: '2024-06-29',
        through: '2025-06-30'
      },
      {
        name: 'sparse multi-year explicit range',
        buckets: [
          { day: '2021-05-18', groups: 7 },
          { day: '2021-05-20', groups: 2 },
          { day: '2026-06-01', groups: 1 },
          { day: '2026-06-30', groups: 1 }
        ],
        from: '2020-01-01',
        through: '2026-06-30'
      },
      {
        name: 'earliest period wins weekly and monthly ties outside the window',
        buckets: [
          { day: '2021-03-02', groups: 2 },
          { day: '2021-03-16', groups: 2 },
          { day: '2021-04-12', groups: 4 },
          { day: '2026-06-30', groups: 1 }
        ],
        from: '2021-01-01',
        through: '2026-06-30'
      },
      {
        name: 'zero-valued first period candidate when every stored bucket is empty',
        buckets: [
          { day: '2025-03-20', groups: 0 },
          { day: '2026-01-10', groups: 0 }
        ],
        from: '2025-02-05',
        through: '2026-06-30'
      },
      {
        name: 'lifetime (both ends null)',
        buckets: [
          { day: '2023-01-05', groups: 2 },
          { day: '2026-06-30', groups: 1 }
        ],
        from: null,
        through: null
      },
      {
        name: 'from-only range',
        buckets: [
          { day: '2023-01-05', groups: 3 },
          { day: '2025-02-10', groups: 1 },
          { day: '2026-06-30', groups: 1 }
        ],
        from: '2024-01-01',
        through: null
      },
      {
        name: 'through-only range',
        buckets: [
          { day: '2023-01-05', groups: 3 },
          { day: '2025-02-10', groups: 1 },
          { day: '2026-06-30', groups: 1 }
        ],
        from: null,
        through: '2025-12-31'
      }
    ];

    it.each(CASES)('matches the complete-series reference: $name', async (scenario) => {
      const result = await own(
        { from: scenario.from, through: scenario.through },
        scenario.buckets
      );
      expect(result.error).toBeNull();
      const model = activityModel(scenario.buckets, scenario.from, scenario.through)!;
      const activity = activityOf(result.data);
      expectModel(activity, model);
      const bounds = {
        days: list(activity['days']).length,
        weeks: list(activity['weeks']).length,
        months: list(activity['months']).length
      };
      expect(bounds.days).toBeLessThanOrEqual(366);
      expect(bounds.weeks).toBeLessThanOrEqual(54);
      expect(bounds.months).toBeLessThanOrEqual(13);
      // The contiguous window has no gaps and ends exactly at the effective scope end.
      expect(activity['days']).toHaveLength(
        dayNumber(model.window.throughDay) - dayNumber(model.window.fromDay) + 1
      );
    });

    it('keeps short ranges untruncated with additive window metadata only', async () => {
      const result = await own({ from: '2026-03-08', through: '2026-03-12' }, [
        { day: '2026-03-10', groups: 2 }
      ]);
      expect(activityOf(result.data)['window']).toEqual({
        fromDay: '2026-03-08',
        throughDay: '2026-03-12',
        maxDays: 366,
        truncated: false
      });
      expect(activityOf(result.data)['days']).toHaveLength(5);
    });

    it('accepts exactly 366 days untruncated and truncates a 367-day range with exact dates', async () => {
      const exact = activityOf(
        (
          await own({ from: '2024-06-30', through: '2025-06-30' }, [
            { day: '2025-06-30', groups: 1 }
          ])
        ).data
      );
      expect(exact['window']).toEqual({
        fromDay: '2024-06-30',
        throughDay: '2025-06-30',
        maxDays: 366,
        truncated: false
      });
      expect(exact['days']).toHaveLength(366);

      const oversized = await own({ from: '2024-06-29', through: '2025-06-30' }, [
        { day: '2024-06-29', groups: 5 },
        { day: '2025-06-30', groups: 1 }
      ]);
      expect(oversized.error).toBeNull();
      const activity = activityOf(oversized.data);
      expect(activity).toMatchObject({ fromDay: '2024-06-29', throughDay: '2025-06-30' });
      expect(activity['window']).toEqual({
        fromDay: '2024-06-30',
        throughDay: '2025-06-30',
        maxDays: 366,
        truncated: true
      });
      const days = list(activity['days']);
      expect(days).toHaveLength(366);
      expect(asRecord(days[0])['period']).toBe('2024-06-30');
      expect(asRecord(days.at(-1))['period']).toBe('2025-06-30');
      expect(list(activity['weeks']).length).toBeLessThanOrEqual(54);
      expect(list(activity['months']).length).toBeLessThanOrEqual(13);
    });

    it('keeps totals, filter echo, denominator and records on the complete selected scope', async () => {
      const buckets = [
        { day: '2024-06-29', groups: 5 },
        { day: '2024-12-10', groups: 2 },
        { day: '2025-06-30', groups: 1 }
      ];
      const oversized = await own({ from: '2024-06-29', through: '2025-06-30' }, buckets);
      expect(oversized.data?.['matches']).toMatchObject({ played: 8 });
      expect(oversized.data?.['filters']).toMatchObject({
        from: '2024-06-29',
        through: '2025-06-30'
      });
      const activity = activityOf(oversized.data);
      // 8 groups over 367 days; the denominator is the full scope, not the 366-day window.
      expect(Number(asRecord(activity['weeklyAverage'])['value'])).toBeCloseTo(8 / (367 / 7), 8);
      expect(activity['mostActiveWeek']).toMatchObject({
        value: { period: '2024-06-24', groups: 5 }
      });
      expect(activity['mostActiveMonth']).toMatchObject({
        value: { period: '2024-06', groups: 5 }
      });
      // The clipped edge week/month hold only window portions (the 5 groups fall outside the window);
      // the best-week and best-month records stay complete.
      expect(list(activity['weeks'])[0]).toEqual({ period: '2024-06-24', groups: 0 });
      expect(list(activity['months'])[0]).toEqual({ period: '2024-06', groups: 0 });
    });

    it('decodes oversized SQL output with the client contract', async () => {
      const result = await own({ from: '2020-01-01', through: '2026-06-30' }, [
        { day: '2021-05-18', groups: 7 },
        { day: '2026-06-30', groups: 1 }
      ]);
      const decoded = decodePlayerStatistics(result.data);
      expect(decoded.activity.window).toEqual({
        fromDay: '2025-06-30',
        throughDay: '2026-06-30',
        maxDays: 366,
        truncated: true
      });
      expect(decoded.matches.played).toBe(8);
    });

    it('reports a null window for zero activity, small and oversized', async () => {
      for (const args of [
        { from: '2026-01-01', through: '2026-01-05' },
        { from: '2000-01-01', through: '2026-06-30' },
        { from: null, through: null }
      ]) {
        const result = await own(args, [], emptyPlayer);
        expect(result.error).toBeNull();
        const activity = activityOf(result.data);
        expect(activity).toMatchObject({
          fromDay: null,
          throughDay: null,
          window: { fromDay: null, throughDay: null, maxDays: 366, truncated: false },
          days: [],
          weeks: [],
          months: [],
          mostActiveWeek: { state: 'insufficient', reason: 'no_applicable_result' },
          mostActiveMonth: { state: 'insufficient', reason: 'no_applicable_result' }
        });
      }
    });

    it('keeps the calendar extremes bounded without generating the full range', async () => {
      const result = await own({ from: '0001-01-01', through: '9999-12-31' }, [
        { day: '2026-06-30', groups: 2 }
      ]);
      expect(result.error).toBeNull();
      const activity = activityOf(result.data);
      expect(activity).toMatchObject({ fromDay: '0001-01-01', throughDay: '9999-12-31' });
      expect(activity['window']).toMatchObject({
        fromDay: '9998-12-31',
        throughDay: '9999-12-31',
        truncated: true
      });
      expect(list(activity['days']).length).toBe(366);
      expect(activity['mostActiveWeek']).toMatchObject({ value: { groups: 2 } });
    });

    it('rejects a reversed range even with no activity', async () => {
      for (const buckets of [[], [{ day: '2026-01-15', groups: 1 }]]) {
        const result = await own({ from: '2026-02-01', through: '2026-01-01' }, buckets);
        expect(result.error).toBe('22023: STATISTICS_INVALID_INPUT');
      }
    });

    it.each([
      ['infinity from', { from: 'infinity', through: null }],
      ['-infinity from', { from: '-infinity', through: '2026-01-01' }],
      ['infinity through', { from: null, through: 'infinity' }],
      ['-infinity through', { from: null, through: '-infinity' }],
      ['year beyond 9999', { from: '2026-01-01', through: '10000-01-01' }],
      ['BC date', { from: '0001-01-01 BC', through: '2026-01-01' }]
    ])('rejects nonfinite or unsupported endpoint: %s', async (_name, args) => {
      const result = await own(args, [{ day: '2026-01-15', groups: 1 }]);
      expect(result.error).toBe('22023: STATISTICS_INVALID_INPUT');
    });

    describe('authorization matrix', () => {
      const sharedSeed = (buckets: Bucket[]) =>
        seedSql(owner, buckets, { kind: 'community', id: communityId });
      const range = { from: '2026-03-01', through: '2026-03-31' };
      const buckets = [{ day: '2026-03-10', groups: 2 }];

      it('serves the own-player read', async () => {
        const result = await own({ ...range }, buckets);
        expect(result.error).toBeNull();
        expect(result.data?.['matches']).toMatchObject({ played: 2 });
      });

      it('serves an authorized shared-community read of another player', async () => {
        const result = await read(
          { sub: member },
          owner,
          { ...range, community: communityId },
          sharedSeed(buckets)
        );
        expect(result.error).toBeNull();
        expect(result.data?.['matches']).toMatchObject({ played: 2 });
        expect(activityOf(result.data)['window']).toMatchObject({ truncated: false });
      });

      it('serves real authenticated own and shared-community reads without seeded data', async () => {
        const args = { p_player_id: owner, p_community_id: communityId };
        for (const actor of [kit.players[0]!, kit.players[1]!]) {
          const result = await kit.rpc(actor, 'get_player_statistics', args);
          expect(result.error).toBeNull();
          expect(activityOf(asRecord(result.data))['window']).toEqual({
            fromDay: null,
            throughDay: null,
            maxDays: 366,
            truncated: false
          });
        }
      });

      it('denies another player without a shared community', async () => {
        const result = await read({ sub: member }, owner, { ...range }, seedSql(owner, buckets));
        expect(result.error).toBe('P0002: STATISTICS_NOT_FOUND');
      });

      it('denies a non-member', async () => {
        const outsider = await kit.actor();
        const result = await read(
          { sub: outsider.id },
          owner,
          { ...range, community: communityId },
          sharedSeed(buckets)
        );
        expect(result.error).toBe('P0002: STATISTICS_NOT_FOUND');
      });

      it('denies a member whose membership was revoked', async () => {
        const now = Date.now();
        await setMembershipHistory(communityId, member, [
          {
            activatedAt: new Date(now - 3 * MS_PER_DAY).toISOString(),
            validUntil: new Date(now - MS_PER_DAY).toISOString()
          }
        ]);
        try {
          const result = await read(
            { sub: member },
            owner,
            { ...range, community: communityId },
            sharedSeed(buckets)
          );
          expect(result.error).toBe('P0002: STATISTICS_NOT_FOUND');
        } finally {
          await kit.resetMemberships();
        }
      });

      it('denies a request without a user in the claims', async () => {
        const result = await read({}, owner, { ...range }, seedSql(owner, buckets));
        expect(result.error).toBe('28000: STATISTICS_UNAUTHENTICATED');
      });

      it('denies the anon database role', async () => {
        const result = await read({ role: 'anon' }, owner, { ...range }, seedSql(owner, buckets));
        expect(result.error).toMatch(/^42501: /);
      });

      it.each([
        ['JSON boolean', { is_anonymous: true }],
        ['text representation', { is_anonymous: 'true' }]
      ])('denies authenticated-role anonymous claims (%s, simulated)', async (_form, claims) => {
        const result = await read(
          { sub: owner, claims },
          owner,
          { ...range },
          seedSql(owner, buckets)
        );
        expect(result.error).toBe('28000: STATISTICS_UNAUTHENTICATED');
      });

      it('denies a provisional actor', async () => {
        const env = environment.env!;
        const [organizer, provisional] = await Promise.all([
          signUpFixtureActor(env, 'stats-window-org', {
            displayName: 'Window Organizer',
            level: 4
          }),
          signUpFixtureActor(env, 'stats-window-prov')
        ]);
        const provisionalCommunity = crypto.randomUUID();
        const eventId = crypto.randomUUID();
        await insertFixtureCommunity({
          id: provisionalCommunity,
          visibility: 'private',
          adminId: organizer.id,
          memberIds: []
        });
        await insertFixtureEvent({
          id: eventId,
          communityId: provisionalCommunity,
          creatorId: organizer.id,
          visibility: 'community_open'
        });
        await provisionProvisionalPlayer({
          userId: provisional.id,
          displayName: 'Restricted Rae',
          estimatedLevel: 3.5,
          invitedBy: organizer.id,
          sourceEventId: eventId
        });
        const result = await read({ sub: provisional.id }, provisional.id, { ...range });
        expect(result.error).toBe('42501: PROVISIONAL_PLAYER_RESTRICTED');
      });
    });
  }
);
