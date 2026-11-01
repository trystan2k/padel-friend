import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { compareReplayKey } from '../../src/features/player/rating-model';

/**
 * Typed adapter over the approved, unchanged oracle docs/rating/golden-fixtures.json.
 * It owns no rating arithmetic: game groups go through a RatingKernelPort (the Postgres
 * kernel in integration tests); the adapter only threads state between steps, applies the
 * non-arithmetic claim / proposal rules and compares every expected output.
 */

export type GoldenState = {
  label: string;
  initial_display_level: string;
  initialization_source: string;
  is_provisional: boolean;
  mu: string;
  display_level: string;
  sigma: string;
  reliability_percent: number;
  confirmed_competitive_game_groups: number;
  highest_display_level: string;
  last_rating_at: string | null;
  rating_engine: string;
  rating_engine_version: string;
  rating_config_version: string;
};

export type GoldenPlayerResult = {
  user_id: string;
  label: string;
  team: 'team_a' | 'team_b';
  own_team_strength: string;
  opponent_team_strength: string;
  expected_score: string;
  outcome_value: string;
  reliability_factor: string;
  raw_delta: string;
  rounded_delta: string;
  applied_delta: string;
  clamped: boolean;
  rating_before: string;
  rating_after: string;
  display_level_before: string;
  display_level_after: string;
  reliability_before: number;
  reliability_after: number;
  confirmed_competitive_game_groups_before: number;
  confirmed_competitive_game_groups_after: number;
  sigma_before: string;
  sigma_after: string;
  highest_display_level_before: string;
  highest_display_level_after: string;
  timestamp: string;
  rating_engine: string;
  rating_engine_version: string;
  rating_config_version: string;
};

export type GoldenGameGroupInput = {
  kind: 'game_group';
  game_group_id: string;
  played_at: string;
  match_type: string;
  classification: string | null;
  result_status: string;
  team_a: [string, string];
  team_b: [string, string];
};
export type GoldenClaimInput = {
  kind: 'account_claim';
  user_id: string;
  requested_level: string | null;
};
export type GoldenProposalInput = {
  kind: 'provisional_level_proposal';
  user_id: string;
  proposed_level: string;
};

export type GoldenStep = {
  input: GoldenGameGroupInput | GoldenClaimInput | GoldenProposalInput;
  expected: {
    rating_event?: boolean;
    team_a_strength?: string | null;
    team_b_strength?: string | null;
    expected_score_team_a?: string | null;
    expected_score_team_b?: string | null;
    player_results?: GoldenPlayerResult[];
    claim_accepted?: boolean;
    level_change_applied?: boolean | null;
    user_id_unchanged?: boolean;
    proposal_accepted?: boolean;
    state_after: Record<string, GoldenState>;
  };
};

export type GoldenCase = {
  id: string;
  initial_state: Record<string, GoldenState>;
  steps: GoldenStep[];
  expected_rating_event_order: string[];
  expected_final_state: Record<string, GoldenState>;
  ingestion_order?: string[];
};

export type GoldenInvariant = {
  id: string;
  assertion: 'identical_rating_outputs' | 'state_unchanged_no_event';
  cases: string[];
};

export type GoldenFixtures = {
  fixture_format_version: string;
  approval: Record<string, unknown>;
  model: {
    rating_engine: string;
    rating_engine_version: string;
    rating_config_version: string;
  };
  cases: GoldenCase[];
  invariants: GoldenInvariant[];
};

export const GOLDEN_FIXTURE_CASE_COUNT = 31;
export const GOLDEN_ORACLE_TOLERANCE = '0.000000000001';

export function loadGoldenFixtures(): GoldenFixtures {
  const parsed: GoldenFixtures = JSON.parse(
    readFileSync(new URL('../../docs/rating/golden-fixtures.json', import.meta.url), 'utf8')
  );
  return parsed;
}

/** expect with failure context; the lint config forbids expect() message arguments. */
export function expectAt(where: string, actual: unknown, expected: unknown): void {
  try {
    expect(actual).toStrictEqual(expected);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${where}: ${reason}`, { cause: error });
  }
}

// ---- Exact decimal strings (BigInt, no binary floats) --------------------------------

type Decimal = { units: bigint; scale: number };

function parseDecimal(value: string): Decimal {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) throw new Error(`Not a plain decimal string: ${value}`);
  const fraction = match[3] ?? '';
  const units = BigInt(`${match[2]}${fraction}`);
  return { units: match[1] === '-' ? -units : units, scale: fraction.length };
}

function alignDecimals(a: string, b: string): [bigint, bigint] {
  const left = parseDecimal(a);
  const right = parseDecimal(b);
  const scale = Math.max(left.scale, right.scale);
  return [
    left.units * 10n ** BigInt(scale - left.scale),
    right.units * 10n ** BigInt(scale - right.scale)
  ];
}

export function decimalEquals(a: string, b: string): boolean {
  const [left, right] = alignDecimals(a, b);
  return left === right;
}

export function decimalWithin(a: string, b: string, tolerance = GOLDEN_ORACLE_TOLERANCE): boolean {
  const scale = Math.max(
    parseDecimal(a).scale,
    parseDecimal(b).scale,
    parseDecimal(tolerance).scale
  );
  const at = (value: string) => {
    const parsed = parseDecimal(value);
    return parsed.units * 10n ** BigInt(scale - parsed.scale);
  };
  const difference = at(a) - at(b);
  return (difference < 0n ? -difference : difference) <= at(tolerance);
}

function formatUnits(units: bigint, scale: number): string {
  const digits = units.toString().padStart(scale + 1, '0');
  return scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

/** Fixed-scale decimal string; negative zero ("-0.00") normalizes to "0.00". */
export function normalizeDecimalString(value: string, scale: number): string {
  const parsed = parseDecimal(value);
  if (parsed.scale > scale && parsed.units % 10n ** BigInt(parsed.scale - scale) !== 0n) {
    throw new Error(`${value} has more than ${scale} significant decimals`);
  }
  const units =
    parsed.scale <= scale
      ? parsed.units * 10n ** BigInt(scale - parsed.scale)
      : parsed.units / 10n ** BigInt(parsed.scale - scale);
  const negative = units < 0n;
  const text = formatUnits(negative ? -units : units, scale);
  return negative ? `-${text}` : text;
}

// ---- Kernel port and replay ----------------------------------------------------------

export type KernelRow = {
  ordinal: number;
  user_id: string;
  team: 'team_a' | 'team_b';
  own_team_strength: string;
  opponent_team_strength: string;
  expected_score: string;
  outcome_value: string;
  reliability_factor: string;
  raw_delta: string;
  rounded_delta: string;
  applied_delta: string;
  clamped: boolean;
  before_mu: string;
  before_sigma: string;
  before_display_level: string;
  before_reliability_percent: number;
  before_confirmed_groups: number;
  before_highest_display_level: string;
  after_mu: string;
  after_sigma: string;
  after_display_level: string;
  after_reliability_percent: number;
  after_confirmed_groups: number;
  after_highest_display_level: string;
  last_rating_at: string;
  rating_engine: string;
  rating_engine_version: string;
  rating_config_version: number;
};

export type RatingKernelPort = {
  isRatable(
    matchType: string,
    classification: string | null,
    resultStatus: string
  ): Promise<boolean>;
  calculate(inputsJson: string): Promise<KernelRow[]>;
};

type NonArithmeticOutcome = {
  claim_accepted?: boolean;
  level_change_applied?: boolean | null;
  user_id_unchanged?: boolean;
  proposal_accepted?: boolean;
};

export type StepTrace = {
  kind: GoldenStep['input']['kind'];
  rows: KernelRow[];
  outcome: NonArithmeticOutcome;
  stateAfter: Record<string, GoldenState>;
};

export type CaseTrace = {
  eventOrder: string[];
  steps: StepTrace[];
  finalState: Record<string, GoldenState>;
};

/** Frozen-input JSON in the ledger shape; decimals stay literal tokens (never floats). */
export function kernelInputsJson(
  input: GoldenGameGroupInput,
  state: Record<string, GoldenState>
): string {
  const members = [...input.team_a, ...input.team_b];
  const states = members.map((id) => {
    const s = state[id];
    if (!s) throw new Error(`Fixture has no state for ${id}`);
    return `"${id}":{"mu":${s.mu},"sigma":${s.sigma},"display_level":${s.display_level},"reliability_percent":${s.reliability_percent},"confirmed_competitive_game_groups":${s.confirmed_competitive_game_groups},"highest_display_level":${s.highest_display_level}}`;
  });
  return `{"classification":"${input.classification}","played_at":"${input.played_at}","teams":{"team_a":${JSON.stringify(input.team_a)},"team_b":${JSON.stringify(input.team_b)}},"states":{${states.join(',')}}}`;
}

function cloneState(state: Record<string, GoldenState>): Record<string, GoldenState> {
  return structuredClone(state);
}

export async function replayCase(fixture: GoldenCase, port: RatingKernelPort): Promise<CaseTrace> {
  let state = cloneState(fixture.initial_state);
  const eventOrder: string[] = [];
  const steps: StepTrace[] = [];

  for (const step of fixture.steps) {
    const input = step.input;
    let rows: KernelRow[] = [];
    const outcome: NonArithmeticOutcome = {};
    state = cloneState(state);

    if (input.kind === 'game_group') {
      const ratable = await port.isRatable(
        input.match_type,
        input.classification,
        input.result_status
      );
      if (ratable) {
        rows = await port.calculate(kernelInputsJson(input, state));
        eventOrder.push(input.game_group_id);
        for (const row of rows) {
          const current = state[row.user_id];
          if (!current) throw new Error(`Kernel returned unknown player ${row.user_id}`);
          state[row.user_id] = {
            ...current,
            mu: row.after_mu,
            display_level: row.after_display_level,
            sigma: row.after_sigma,
            reliability_percent: row.after_reliability_percent,
            confirmed_competitive_game_groups: row.after_confirmed_groups,
            highest_display_level: row.after_highest_display_level,
            last_rating_at: row.last_rating_at
          };
        }
      }
    } else if (input.kind === 'account_claim') {
      // Claim keeps the permanent id and every rating field; only a player with no rated
      // history may re-initialize at a new level, and it is never a rating event.
      const current = state[input.user_id];
      if (!current) throw new Error(`Fixture has no state for ${input.user_id}`);
      const requested = input.requested_level;
      const levelChange =
        requested !== null &&
        current.confirmed_competitive_game_groups === 0 &&
        !decimalEquals(requested, current.initial_display_level);
      state[input.user_id] = {
        ...current,
        is_provisional: false,
        ...(levelChange
          ? {
              initial_display_level: normalizeDecimalString(requested, 1),
              mu: normalizeDecimalString(requested, 2),
              display_level: normalizeDecimalString(requested, 2),
              highest_display_level: normalizeDecimalString(requested, 2)
            }
          : {})
      };
      outcome.claim_accepted = true;
      outcome.level_change_applied = requested === null ? null : levelChange;
      outcome.user_id_unchanged = state[input.user_id] !== undefined;
    } else {
      // Creator-level proposals are refused in V1: no state change, no event.
      outcome.proposal_accepted = false;
    }

    steps.push({ kind: input.kind, rows, outcome, stateAfter: cloneState(state) });
  }

  return { eventOrder, steps, finalState: state };
}

const RATING_STATE_KEYS = [
  'mu',
  'display_level',
  'sigma',
  'reliability_percent',
  'confirmed_competitive_game_groups',
  'highest_display_level',
  'rating_engine',
  'rating_engine_version',
  'rating_config_version',
  'is_provisional',
  'initial_display_level'
] as const satisfies readonly (keyof GoldenState)[];

function expectState(actual: GoldenState | undefined, expected: GoldenState, where: string): void {
  expectAt(where, actual !== undefined, true);
  if (!actual) return;
  for (const key of RATING_STATE_KEYS) {
    expectAt(`${where} ${key}`, actual[key], expected[key]);
  }
  expectAt(
    `${where} last_rating_at`,
    actual.last_rating_at === null ? null : Date.parse(actual.last_rating_at),
    expected.last_rating_at === null ? null : Date.parse(expected.last_rating_at)
  );
}

function expectStates(
  actual: Record<string, GoldenState>,
  expected: Record<string, GoldenState>,
  where: string
): void {
  expectAt(`${where} players`, Object.keys(actual).sort(), Object.keys(expected).sort());
  for (const [userId, state] of Object.entries(expected)) {
    expectState(actual[userId], state, `${where} ${state.label}`);
  }
}

function expectRow(row: KernelRow, expected: GoldenPlayerResult, where: string): void {
  expectAt(`${where} user`, row.user_id, expected.user_id);
  expectAt(`${where} team`, row.team, expected.team);
  // Exact: two-decimal states and deltas, three-decimal strengths, versions, counts, clamp.
  expectAt(`${where} own strength`, row.own_team_strength, expected.own_team_strength);
  expectAt(
    `${where} opponent strength`,
    row.opponent_team_strength,
    expected.opponent_team_strength
  );
  expectAt(
    `${where} rounded`,
    normalizeDecimalString(row.rounded_delta, 2),
    expected.rounded_delta
  );
  expectAt(
    `${where} applied`,
    normalizeDecimalString(row.applied_delta, 2),
    expected.applied_delta
  );
  expectAt(`${where} mu before`, row.before_mu, expected.rating_before);
  expectAt(`${where} mu after`, row.after_mu, expected.rating_after);
  expectAt(`${where} display before`, row.before_display_level, expected.display_level_before);
  expectAt(`${where} display after`, row.after_display_level, expected.display_level_after);
  expectAt(`${where} sigma before`, row.before_sigma, expected.sigma_before);
  expectAt(`${where} sigma after`, row.after_sigma, expected.sigma_after);
  expectAt(
    `${where} highest before`,
    row.before_highest_display_level,
    expected.highest_display_level_before
  );
  expectAt(
    `${where} highest after`,
    row.after_highest_display_level,
    expected.highest_display_level_after
  );
  expectAt(
    `${where} reliability before`,
    row.before_reliability_percent,
    expected.reliability_before
  );
  expectAt(`${where} reliability after`, row.after_reliability_percent, expected.reliability_after);
  expectAt(
    `${where} groups before`,
    row.before_confirmed_groups,
    expected.confirmed_competitive_game_groups_before
  );
  expectAt(
    `${where} groups after`,
    row.after_confirmed_groups,
    expected.confirmed_competitive_game_groups_after
  );
  expectAt(`${where} clamped`, row.clamped, expected.clamped);
  expectAt(
    `${where} last_rating_at`,
    Date.parse(row.last_rating_at),
    Date.parse(expected.timestamp)
  );
  expectAt(
    `${where} versions`,
    [row.rating_engine, row.rating_engine_version, String(row.rating_config_version)],
    [expected.rating_engine, expected.rating_engine_version, expected.rating_config_version]
  );
  // Exact rationals.
  expectAt(`${where} outcome`, decimalEquals(row.outcome_value, expected.outcome_value), true);
  expectAt(`${where} K`, decimalEquals(row.reliability_factor, expected.reliability_factor), true);
  // Oracle tolerance 1e-12.
  expectAt(
    `${where} expected ${row.expected_score}`,
    decimalWithin(row.expected_score, expected.expected_score),
    true
  );
  expectAt(`${where} raw ${row.raw_delta}`, decimalWithin(row.raw_delta, expected.raw_delta), true);
}

/** Compare a replay with every expected step output, state, event order and final state. */
export function assertCaseTrace(fixture: GoldenCase, trace: CaseTrace): void {
  expect(trace.steps).toHaveLength(fixture.steps.length);
  fixture.steps.forEach((step, index) => {
    const actual = trace.steps[index];
    const where = `${fixture.id} step ${index + 1}`;
    expectAt(where, actual !== undefined, true);
    if (!actual) return;
    expectAt(where, actual.kind, step.input.kind);
    const expected = step.expected;
    if (step.input.kind === 'game_group') {
      expectAt(`${where} rating_event`, actual.rows.length > 0, expected.rating_event);
      const results = expected.player_results ?? [];
      expectAt(`${where} player count`, actual.rows.length, results.length);
      results.forEach((result, position) => {
        const row = actual.rows[position];
        expectAt(`${where} row ${position}`, row !== undefined, true);
        if (row) expectRow(row, result, `${where} ${result.label}`);
      });
      if (expected.rating_event) {
        const first = actual.rows[0];
        const second = actual.rows[2];
        expectAt(`${where} team A strength`, first?.own_team_strength, expected.team_a_strength);
        expectAt(`${where} team B strength`, second?.own_team_strength, expected.team_b_strength);
        expectAt(
          `${where} E_A`,
          decimalWithin(first?.expected_score ?? '9', expected.expected_score_team_a ?? '0'),
          true
        );
        expectAt(
          `${where} E_B`,
          decimalWithin(second?.expected_score ?? '9', expected.expected_score_team_b ?? '0'),
          true
        );
      } else {
        expectAt(where, expected.team_a_strength, null);
        expectAt(where, expected.expected_score_team_a, null);
      }
    } else if (step.input.kind === 'account_claim') {
      expectAt(where, actual.outcome.claim_accepted, expected.claim_accepted);
      expectAt(where, actual.outcome.level_change_applied, expected.level_change_applied);
      expectAt(where, actual.outcome.user_id_unchanged, expected.user_id_unchanged);
      expectAt(where, expected.rating_event, false);
      expectAt(where, actual.rows.length, 0);
    } else {
      expectAt(where, actual.outcome.proposal_accepted, expected.proposal_accepted);
      expectAt(where, expected.rating_event, false);
      expectAt(where, actual.rows.length, 0);
    }
    expectStates(actual.stateAfter, expected.state_after, where);
  });
  expectAt(`${fixture.id} event order`, trace.eventOrder, fixture.expected_rating_event_order);
  expectStates(trace.finalState, fixture.expected_final_state, `${fixture.id} final`);
}

/** Fixture group ids in replay order, derived only from (played_at, game_group_id). */
export function replayOrderOfGroups(
  groups: readonly { gameGroupId: string; playedAt: string }[]
): string[] {
  return [...groups].sort(compareReplayKey).map((group) => group.gameGroupId);
}

// ---- Invariants ----------------------------------------------------------------------

type RatingOutput = {
  team: string;
  own_team_strength: string;
  opponent_team_strength: string;
  expected_score: string;
  raw_delta: string;
  rounded_delta: string;
  applied_delta: string;
  clamped: boolean;
  after_mu: string;
  after_reliability_percent: number;
  after_confirmed_groups: number;
  after_highest_display_level: string;
};

function ratingOutputs(trace: CaseTrace): RatingOutput[][] {
  return trace.steps
    .filter((step) => step.kind === 'game_group')
    .map((step) =>
      step.rows.map((row) => ({
        team: row.team,
        own_team_strength: row.own_team_strength,
        opponent_team_strength: row.opponent_team_strength,
        expected_score: row.expected_score,
        raw_delta: row.raw_delta,
        rounded_delta: row.rounded_delta,
        applied_delta: row.applied_delta,
        clamped: row.clamped,
        after_mu: row.after_mu,
        after_reliability_percent: row.after_reliability_percent,
        after_confirmed_groups: row.after_confirmed_groups,
        after_highest_display_level: row.after_highest_display_level
      }))
    );
}

const RATING_ONLY_KEYS = [
  'mu',
  'display_level',
  'sigma',
  'reliability_percent',
  'confirmed_competitive_game_groups',
  'highest_display_level',
  'last_rating_at'
] as const satisfies readonly (keyof GoldenState)[];

function ratingOnly(state: GoldenState) {
  return Object.fromEntries(RATING_ONLY_KEYS.map((key) => [key, state[key]]));
}

/** Check one fixture invariant against traces produced by the production kernel. */
export function assertInvariant(
  invariant: GoldenInvariant,
  fixtures: Record<string, GoldenCase>,
  traces: Record<string, CaseTrace>
): void {
  if (invariant.assertion === 'state_unchanged_no_event') {
    for (const id of invariant.cases) {
      const trace = traces[id];
      const fixture = fixtures[id];
      expectAt(`${invariant.id} ${id} events`, trace?.eventOrder, []);
      expectAt(
        `${invariant.id} ${id}`,
        trace?.steps.every((step) => step.rows.length === 0),
        true
      );
      if (!trace || !fixture) continue;
      expectStates(trace.finalState, fixture.initial_state, `${invariant.id} ${id}`);
    }
    return;
  }

  const [first, ...rest] = invariant.cases;
  const reference = first ? traces[first] : undefined;
  expectAt(`${invariant.id} reference trace`, reference !== undefined, true);
  if (!reference) return;
  for (const id of rest) {
    const other = traces[id];
    expectAt(`${invariant.id} ${id} trace`, other !== undefined, true);
    if (!other) continue;
    expectAt(
      `${invariant.id} ${first} vs ${id} outputs`,
      ratingOutputs(other),
      ratingOutputs(reference)
    );
    expectAt(
      `${invariant.id} ${id} event count`,
      other.eventOrder.length,
      reference.eventOrder.length
    );
    expectAt(
      `${invariant.id} ${first} vs ${id} final rating state`,
      Object.values(other.finalState).map(ratingOnly),
      Object.values(reference.finalState).map(ratingOnly)
    );
  }
  if (invariant.id === 'INV-claim') assertClaimTouchesOnlyProvisional(fixtures, traces, invariant);
}

function assertClaimTouchesOnlyProvisional(
  fixtures: Record<string, GoldenCase>,
  traces: Record<string, CaseTrace>,
  invariant: GoldenInvariant
): void {
  for (const id of invariant.cases) {
    const trace = traces[id];
    const fixture = fixtures[id];
    if (!trace || !fixture) continue;
    trace.steps.forEach((step, index) => {
      if (step.kind !== 'account_claim') return;
      const claim = fixture.steps[index]?.input;
      const before = index === 0 ? fixture.initial_state : trace.steps[index - 1]?.stateAfter;
      if (claim?.kind !== 'account_claim' || !before) return;
      expectAt(`${id} claim emits no event`, step.rows.length, 0);
      for (const [userId, state] of Object.entries(step.stateAfter)) {
        const prior = before[userId];
        if (!prior) continue;
        expectAt(
          `${id} claim keeps rating state of ${state.label}`,
          ratingOnly(state),
          ratingOnly(prior)
        );
        if (userId === claim.user_id) {
          expectAt(`${id} claim precondition`, prior.is_provisional, true);
          expectAt(`${id} claim clears provisional`, state.is_provisional, false);
        }
      }
    });
  }
}
