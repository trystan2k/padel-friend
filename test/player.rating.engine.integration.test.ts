import { afterAll, describe, expect, it } from 'vitest';
import {
  assertCaseTrace,
  expectAt,
  assertInvariant,
  decimalEquals,
  GOLDEN_FIXTURE_CASE_COUNT,
  loadGoldenFixtures,
  replayCase,
  type CaseTrace,
  type KernelRow,
  type RatingKernelPort
} from './helpers/rating-golden-fixtures';
import { queryTrustedSql, sqlErrorMessage, type SqlRow } from './helpers/sql-transport';

// Postgres is the only rating runtime, so the 31 oracle cases run here (integration
// runner); `test:unit` stays DB-free and only checks fixture shape.
const fixtures = loadGoldenFixtures();
const casesById = Object.fromEntries(fixtures.cases.map((fixture) => [fixture.id, fixture]));

const KERNEL_SQL = `select ordinal::int as ordinal, user_id::text, team, own_team_strength::text, opponent_team_strength::text,
    expected_score::text, outcome_value::text, reliability_factor::text, raw_delta::text, rounded_delta::text,
    applied_delta::text, clamped, before_mu::text, before_sigma::text, before_display_level::text,
    before_reliability_percent::int as before_reliability_percent, before_confirmed_groups,
    before_highest_display_level::text, after_mu::text, after_sigma::text, after_display_level::text,
    after_reliability_percent::int as after_reliability_percent, after_confirmed_groups,
    after_highest_display_level::text,
    to_char(last_rating_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as last_rating_at,
    rating_engine, rating_engine_version, rating_config_version
  from public.rating_v1_calculate_group('app-wide-level', '1.0.0', 1, $1::jsonb) order by ordinal`;

function toKernelRow(row: SqlRow): KernelRow {
  const text = (key: string) => String(row[key]);
  const whole = (key: string) => Number(row[key]);
  return {
    ordinal: whole('ordinal'),
    user_id: text('user_id'),
    team: row['team'] === 'team_b' ? 'team_b' : 'team_a',
    own_team_strength: text('own_team_strength'),
    opponent_team_strength: text('opponent_team_strength'),
    expected_score: text('expected_score'),
    outcome_value: text('outcome_value'),
    reliability_factor: text('reliability_factor'),
    raw_delta: text('raw_delta'),
    rounded_delta: text('rounded_delta'),
    applied_delta: text('applied_delta'),
    clamped: row['clamped'] === true,
    before_mu: text('before_mu'),
    before_sigma: text('before_sigma'),
    before_display_level: text('before_display_level'),
    before_reliability_percent: whole('before_reliability_percent'),
    before_confirmed_groups: whole('before_confirmed_groups'),
    before_highest_display_level: text('before_highest_display_level'),
    after_mu: text('after_mu'),
    after_sigma: text('after_sigma'),
    after_display_level: text('after_display_level'),
    after_reliability_percent: whole('after_reliability_percent'),
    after_confirmed_groups: whole('after_confirmed_groups'),
    after_highest_display_level: text('after_highest_display_level'),
    last_rating_at: text('last_rating_at'),
    rating_engine: text('rating_engine'),
    rating_engine_version: text('rating_engine_version'),
    rating_config_version: whole('rating_config_version')
  };
}

async function calculate(inputsJson: string): Promise<KernelRow[]> {
  const result = await queryTrustedSql(KERNEL_SQL, { values: [inputsJson] });
  return result.rows.map(toKernelRow);
}

const port: RatingKernelPort = {
  async isRatable(matchType, classification, resultStatus) {
    const result = await queryTrustedSql(
      'select public.rating_v1_is_ratable($1, $2, $3) as ratable',
      { values: [matchType, classification, resultStatus] }
    );
    return result.rows[0]?.['ratable'] === true;
  },
  calculate
};

const traces = new Map<string, Promise<CaseTrace>>();
function traceOf(id: string): Promise<CaseTrace> {
  const existing = traces.get(id);
  if (existing) return existing;
  const fixture = casesById[id];
  if (!fixture) throw new Error(`Unknown fixture ${id}`);
  const created = replayCase(fixture, port);
  traces.set(id, created);
  return created;
}

const A1 = '00000000-0000-4000-8000-000000000001';
const A2 = '00000000-0000-4000-8000-000000000002';
const B1 = '00000000-0000-4000-8000-000000000003';
const B2 = '00000000-0000-4000-8000-000000000004';

type StateInput = { mu: string; groups: number };
function inputs(
  classification: string,
  states: [StateInput, StateInput, StateInput, StateInput],
  extra: { teams?: string; stateOverrides?: Record<string, string>; playedAt?: string } = {}
): string {
  const ids = [A1, A2, B1, B2];
  const body = states
    .map((state, index) => {
      const reliability = Math.min(100, 10 + 6 * state.groups);
      return `"${ids[index]}":{"mu":${state.mu},"sigma":1.00,"display_level":${state.mu},"reliability_percent":${reliability},"confirmed_competitive_game_groups":${state.groups},"highest_display_level":${state.mu}${extra.stateOverrides?.[ids[index] ?? ''] ?? ''}}`;
    })
    .join(',');
  const teams = extra.teams ?? `{"team_a":["${A1}","${A2}"],"team_b":["${B1}","${B2}"]}`;
  return `{"classification":"${classification}","played_at":"${extra.playedAt ?? '2026-11-02T18:00:00.000Z'}","teams":${teams},"states":{${body}}}`;
}
const even = (mu: string, groups: number): StateInput => ({ mu, groups });
function quartet(states: StateInput[]): [StateInput, StateInput, StateInput, StateInput] {
  const [a, b, c, d] = states;
  if (!a || !b || !c || !d) throw new Error('Expected four player states');
  return [a, b, c, d];
}

async function failure(
  inputsJson: string,
  engine: [string, string, number] = ['app-wide-level', '1.0.0', 1]
) {
  try {
    await queryTrustedSql('select * from public.rating_v1_calculate_group($1, $2, $3, $4::jsonb)', {
      values: [...engine, inputsJson]
    });
  } catch (error) {
    return sqlErrorMessage(error);
  }
  throw new Error('Expected kernel to reject input');
}

afterAll(() => {
  traces.clear();
});

describe('V1 rating kernel against the approved golden oracle', () => {
  it('runs exactly the 31 approved cases', () => {
    expect(fixtures.cases).toHaveLength(GOLDEN_FIXTURE_CASE_COUNT);
  });

  it.each(fixtures.cases.map((fixture) => [fixture.id] as const))('%s', async (id) => {
    const fixture = casesById[id];
    if (!fixture) throw new Error(`Unknown fixture ${id}`);
    const trace = await traceOf(id);
    assertCaseTrace(fixture, trace);
    expect(trace.steps).toHaveLength(fixture.steps.length);
  });

  it.each(fixtures.invariants.map((invariant) => [invariant.id, invariant] as const))(
    'invariant %s holds on kernel output',
    async (_id, invariant) => {
      const needed = Object.fromEntries(
        await Promise.all(invariant.cases.map(async (id) => [id, await traceOf(id)] as const))
      );
      assertInvariant(invariant, casesById, needed);
      expect(Object.keys(needed)).toStrictEqual(invariant.cases);
    }
  );

  it('rates GF-21 midpoints symmetrically at +0.11 / -0.11', async () => {
    const trace = await traceOf('GF-21-rounding-midpoint');
    for (const step of trace.steps) {
      for (const row of step.rows) {
        expect(row.raw_delta.replace(/0+$/, '')).toMatch(/^-?0\.105\.?$/);
        expect(row.applied_delta).toBe(row.team === 'team_a' ? '0.11' : '-0.11');
      }
    }
  });

  it('keeps the GF-14 tie-break order and uses the post-016 state for 017', async () => {
    const trace = await traceOf('GF-14-identical-played-at');
    expect(trace.eventOrder).toStrictEqual(
      casesById['GF-14-identical-played-at']?.expected_rating_event_order
    );
    expect(trace.steps[1]?.rows.map((row) => row.before_mu)).toStrictEqual(
      trace.steps[1]?.rows.map(
        (row) => trace.steps[0]?.stateAfter[row.user_id]?.mu ?? row.before_mu
      )
    );
  });

  it('gives partners different deltas from reliability alone (GF-05, GF-18)', async () => {
    for (const id of ['GF-05-mixed-reliability', 'GF-18-low-vs-high-reliability']) {
      const [first, second] = (await traceOf(id)).steps[0]?.rows ?? [];
      expect(first?.expected_score).toBe(second?.expected_score);
      expect(first?.outcome_value).toBe(second?.outcome_value);
      expect(first?.reliability_factor).not.toBe(second?.reliability_factor);
      expect(first?.applied_delta).not.toBe(second?.applied_delta);
    }
  });

  it('counts clamped results toward reliability and groups', async () => {
    const trace = await traceOf('GF-07-boundary-zero');
    const clamped = trace.steps[0]?.rows.filter((row) => row.clamped) ?? [];
    expect(clamped.length).toBeGreaterThan(0);
    for (const row of clamped) {
      expect(row.after_confirmed_groups).toBe(row.before_confirmed_groups + 1);
      expect(row.after_reliability_percent).toBe(
        Math.min(100, 10 + 6 * row.after_confirmed_groups)
      );
    }
  });

  it('leaves every rating field untouched for each excluded case', async () => {
    for (const id of ['GF-09-friendly', 'GF-10-incomplete', 'GF-11-pending', 'GF-12-disputed']) {
      const trace = await traceOf(id);
      expect(trace.eventOrder).toStrictEqual([]);
      expect(trace.finalState).toStrictEqual(casesById[id]?.initial_state);
    }
  });
});

describe('V1 rating kernel edge cases', () => {
  it('rounds a negative half-cent delta away from zero (not mu)', async () => {
    // Equal strength, r = 40: K = 0.21, raw = +/-0.105 exactly. 4.10 - 0.105 = 3.995 must not round to 4.00.
    const rows = await calculate(
      inputs('team_a', [even('4.10', 5), even('4.10', 5), even('4.10', 5), even('4.10', 5)])
    );
    expect(rows.map((row) => row.rounded_delta)).toStrictEqual(['0.11', '0.11', '-0.11', '-0.11']);
    expect(rows.map((row) => row.after_mu)).toStrictEqual(['4.21', '4.21', '3.99', '3.99']);
    expect(rows[2]?.raw_delta).toMatch(/^-0\.105/);
  });

  it('normalizes zero deltas to 0.00 and still counts the group', async () => {
    const rows = await calculate(
      inputs('draw', [even('4.00', 4), even('4.00', 4), even('4.00', 4), even('4.00', 4)])
    );
    for (const row of rows) {
      expect(row.raw_delta).toMatch(/^-?0(\.0+)?$/);
      expect(row.rounded_delta).toBe('0.00');
      expect(row.applied_delta).toBe('0.00');
      expect(row.after_mu).toBe('4.00');
      expect(row.clamped).toBe(false);
      expect(row.after_confirmed_groups).toBe(5);
      expect(row.after_reliability_percent).toBe(40);
    }
  });

  it('never exceeds the 0.00-7.00 range and reports the clamp', async () => {
    const top = await calculate(
      inputs('team_a', [even('7.00', 0), even('6.98', 0), even('5.00', 0), even('5.00', 0)])
    );
    expect(top.map((row) => row.after_mu).slice(0, 2)).toStrictEqual(['7.00', '7.00']);
    expect(top.map((row) => row.clamped).slice(0, 2)).toStrictEqual([true, true]);
    expect(top.map((row) => row.applied_delta).slice(0, 2)).toStrictEqual(['0.00', '0.02']);
    expect(top.map((row) => row.after_confirmed_groups)).toStrictEqual([1, 1, 1, 1]);
    const bottom = await calculate(
      inputs('team_b', [even('0.00', 0), even('0.05', 0), even('0.45', 0), even('0.45', 0)])
    );
    expect(bottom.map((row) => row.after_mu).slice(0, 2)).toStrictEqual(['0.00', '0.00']);
    expect(bottom.map((row) => row.clamped).slice(0, 2)).toStrictEqual([true, true]);
    expect(bottom.map((row) => row.applied_delta).slice(0, 2)).toStrictEqual(['0.00', '-0.05']);
  });

  it('caps reliability at 100 from the 15th group and keeps counting beyond 15', async () => {
    let states: StateInput[] = [even('4.00', 0), even('4.00', 0), even('4.00', 0), even('4.00', 0)];
    const reliability: number[] = [];
    for (let group = 1; group <= 18; group += 1) {
      const rows = await calculate(inputs('draw', quartet(states)));
      states = rows.map((row) => ({ mu: row.after_mu, groups: row.after_confirmed_groups }));
      reliability.push(rows[0]?.after_reliability_percent ?? -1);
      expect(rows[0]?.after_confirmed_groups).toBe(group);
    }
    expect(reliability.slice(0, 5)).toStrictEqual([16, 22, 28, 34, 40]);
    expect(reliability[13]).toBe(94);
    expect(reliability.slice(14)).toStrictEqual([100, 100, 100, 100]);
  });

  it('uses reliability BEFORE the group for K', async () => {
    const rows = await calculate(
      inputs('team_a', [even('4.00', 14), even('4.00', 15), even('4.00', 0), even('4.00', 100)])
    );
    expect(
      rows.map((row, index) =>
        decimalEquals(row.reliability_factor, ['0.0885', '0.075', '0.2775', '0.075'][index] ?? 'x')
      )
    ).toStrictEqual([true, true, true, true]);
  });

  it('takes no wall clock: last_rating_at is the supplied played_at', async () => {
    const rows = await calculate(
      inputs('team_a', [even('3.00', 0), even('3.00', 0), even('3.00', 0), even('3.00', 0)], {
        playedAt: '2001-02-03T04:05:06.000Z'
      })
    );
    expect(new Set(rows.map((row) => row.last_rating_at))).toStrictEqual(
      new Set(['2001-02-03T04:05:06.000Z'])
    );
  });

  it('does not rate cancelled, friendly or unconfirmed groups', async () => {
    for (const [matchType, classification, status] of [
      ['competitive', 'team_a', 'cancelled'],
      ['competitive', 'cancelled', 'confirmed'],
      ['friendly', 'team_a', 'confirmed'],
      ['competitive', 'team_a', 'pending'],
      ['competitive', 'team_a', 'disputed'],
      ['competitive', 'incomplete', 'confirmed'],
      ['competitive', null, 'confirmed']
    ] as const) {
      expect(await port.isRatable(matchType, classification, status)).toBe(false);
    }
    expect(await port.isRatable('competitive', 'draw', 'confirmed')).toBe(true);
  });

  it('rejects a reserve (fifth player) because only the four played team ids are inputs', async () => {
    const base = inputs('team_a', [
      even('4.00', 0),
      even('4.00', 0),
      even('4.00', 0),
      even('4.00', 0)
    ]);
    const reserve = base.replace(
      /"states":\{/,
      `"states":{"00000000-0000-4000-8000-000000000009":{"mu":4.00,"sigma":1.00,"display_level":4.00,"reliability_percent":10,"confirmed_competitive_game_groups":0,"highest_display_level":4.00},`
    );
    expect(await failure(reserve)).toContain('RATING_INPUT_INVALID');
  });

  it('rejects malformed teams and states', async () => {
    const valid: [StateInput, StateInput, StateInput, StateInput] = [
      even('4.00', 0),
      even('4.00', 0),
      even('4.00', 0),
      even('4.00', 0)
    ];
    const malformed = [
      inputs('team_a', valid, { teams: `{"team_a":["${A1}","${A1}"],"team_b":["${B1}","${B2}"]}` }),
      inputs('team_a', valid, { teams: `{"team_a":["${A1}","${A2}"],"team_b":["${A2}","${B2}"]}` }),
      inputs('team_a', valid, { teams: `{"team_a":["${A1}"],"team_b":["${B1}","${B2}"]}` }),
      inputs('team_a', valid, { teams: `{"team_a":["${A1}","${A2}","${B2}"],"team_b":["${B1}"]}` }),
      inputs('team_a', valid, { teams: `{"team_a":["${A1}","${A2}"]}` }),
      inputs('team_a', valid, {
        teams: `{"team_a":["${A1}","${A2}"],"team_b":["${B1}","not-a-uuid"]}`
      }),
      inputs('team_a', valid, {
        teams: `{"team_a":["${A1}","${A2}"],"team_b":["${B1}","00000000-0000-4000-8000-0000000000aa"]}`
      }),
      inputs('team_a', valid).replace('"team_a","played_at"', '"x","played_at"'),
      inputs('winner', valid),
      inputs('team_a', valid).replace('4.00', '7.01'),
      inputs('team_a', valid).replace('"mu":4.00', '"mu":4.005'),
      inputs('team_a', valid).replace('"reliability_percent":10', '"reliability_percent":16'),
      inputs('team_a', valid).replace('"sigma":1.00', '"sigma":0.90'),
      inputs('team_a', valid).replace(
        '"confirmed_competitive_game_groups":0',
        '"confirmed_competitive_game_groups":-1'
      ),
      inputs('team_a', valid).replace(
        '"confirmed_competitive_game_groups":0',
        '"confirmed_competitive_game_groups":0.5'
      ),
      inputs('team_a', valid).replace('"display_level":4.00', '"display_level":3.99'),
      inputs('team_a', valid).replace(
        '"highest_display_level":4.00',
        '"highest_display_level":3.90'
      ),
      inputs('team_a', valid, { playedAt: 'not a timestamp' }),
      '{}'
    ];
    expect(malformed.length).toBeGreaterThan(15);
    for (const payload of malformed) {
      expectAt(payload, (await failure(payload)).includes('RATING_INPUT_INVALID'), true);
    }
  });

  it('fails closed on unsupported engine, version or configuration', async () => {
    const valid = inputs('team_a', [
      even('4.00', 0),
      even('4.00', 0),
      even('4.00', 0),
      even('4.00', 0)
    ]);
    for (const tuple of [
      ['app-wide-level', '1.0.1', 1],
      ['app-wide-level', '2.0.0', 1],
      ['app-wide-level', '1.0.0', 2],
      ['trueskill', '1.0.0', 1]
    ] as [string, string, number][]) {
      expect(await failure(valid, tuple)).toContain('RATING_ENGINE_UNSUPPORTED');
    }
  });

  it('is immutable, write-free and not callable by runtime roles', async () => {
    const catalog = await queryTrustedSql(`select p.proname, p.provolatile, p.prosecdef,
        has_function_privilege('anon', p.oid, 'execute') as anon_exec,
        has_function_privilege('authenticated', p.oid, 'execute') as authenticated_exec,
        has_function_privilege('service_role', p.oid, 'execute') as service_exec
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('rating_v1_calculate_group', 'rating_v1_is_ratable', 'rating_v1_supports')
      order by p.proname`);
    expect(catalog.rows).toHaveLength(3);
    for (const row of catalog.rows) {
      expectAt(String(row['proname']), row['provolatile'], 'i');
      expect(row['prosecdef']).toBe(false);
      expect([row['anon_exec'], row['authenticated_exec'], row['service_exec']]).toStrictEqual([
        false,
        false,
        false
      ]);
    }
  });
});
