import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  decimalEquals,
  decimalWithin,
  GOLDEN_FIXTURE_CASE_COUNT,
  loadGoldenFixtures,
  normalizeDecimalString,
  replayOrderOfGroups
} from './helpers/rating-golden-fixtures';

// DB-free: oracle shape, count and helper semantics only. Engine correctness is proved
// against the Postgres kernel in player.rating.engine.integration.test.ts.
const fixtures = loadGoldenFixtures();

describe('golden fixture oracle', () => {
  it('stays the approved, unchanged 31-case file', () => {
    const bytes = readFileSync(new URL('../docs/rating/golden-fixtures.json', import.meta.url));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      '395c4c1e1e3d397fcccf10b6f12f6c562814efab6f723cd6f41d058e903cf121'
    );
    expect(fixtures.cases).toHaveLength(GOLDEN_FIXTURE_CASE_COUNT);
    expect(new Set(fixtures.cases.map((fixture) => fixture.id)).size).toBe(
      GOLDEN_FIXTURE_CASE_COUNT
    );
    expect(fixtures.fixture_format_version).toBe('1');
  });

  it('carries the approved engine tuple', () => {
    expect(fixtures.model).toMatchObject({
      rating_engine: 'app-wide-level',
      rating_engine_version: '1.0.0',
      rating_config_version: '1'
    });
  });

  it('declares the five replay invariants', () => {
    expect(fixtures.invariants.map((invariant) => invariant.id)).toStrictEqual([
      'INV-margin',
      'INV-league',
      'INV-provisional',
      'INV-claim',
      'INV-exclusions'
    ]);
    const ids = new Set(fixtures.cases.map((fixture) => fixture.id));
    for (const invariant of fixtures.invariants) {
      for (const id of invariant.cases) expect(ids.has(id), `${invariant.id} ${id}`).toBe(true);
    }
  });

  it.each(fixtures.cases.map((fixture) => [fixture.id, fixture] as const))(
    '%s is internally consistent',
    (_id, fixture) => {
      for (const [userId, state] of Object.entries(fixture.initial_state)) {
        expect(userId).toMatch(/^[0-9a-f-]{36}$/);
        expect(state.reliability_percent).toBe(
          Math.min(100, 10 + 6 * state.confirmed_competitive_game_groups)
        );
        expect(state.mu).toBe(state.display_level);
        expect(state.mu).toMatch(/^\d\.\d{2}$/);
      }
      const ratedGroups = fixture.steps.filter(
        (step) => step.input.kind === 'game_group' && step.expected.rating_event
      );
      expect(
        ratedGroups.flatMap((step) =>
          step.input.kind === 'game_group' ? [step.input.game_group_id] : []
        )
      ).toStrictEqual(fixture.expected_rating_event_order);
      for (const step of ratedGroups) {
        expect(step.expected.player_results).toHaveLength(4);
      }
    }
  );

  it('replays GF-14 by (played_at, game_group_id) regardless of ingestion order', () => {
    const gf14 = fixtures.cases.find((fixture) => fixture.id === 'GF-14-identical-played-at');
    const ingestion = gf14?.ingestion_order ?? [];
    const expected = gf14?.expected_rating_event_order ?? [];
    expect(expected).toHaveLength(2);
    expect(ingestion).toStrictEqual([...expected].reverse());
    const groups = ingestion.map((gameGroupId) => ({
      gameGroupId,
      playedAt: '2026-11-03T19:30:00.000Z'
    }));
    expect(replayOrderOfGroups(groups)).toStrictEqual(expected);
  });
});

describe('exact decimal helpers', () => {
  it('normalizes scale and negative zero', () => {
    expect(normalizeDecimalString('-0.00', 2)).toBe('0.00');
    expect(normalizeDecimalString('0', 2)).toBe('0.00');
    expect(normalizeDecimalString('-0.110', 2)).toBe('-0.11');
    expect(normalizeDecimalString('4.1', 1)).toBe('4.1');
    expect(normalizeDecimalString('7', 2)).toBe('7.00');
    expect(() => normalizeDecimalString('0.105', 2)).toThrow('more than 2');
  });

  it('compares decimal strings exactly, ignoring trailing zeros', () => {
    expect(decimalEquals('0.264', '0.2640')).toBe(true);
    expect(decimalEquals('1', '1.0')).toBe(true);
    expect(decimalEquals('0.1', '0.10000000000000001')).toBe(false);
  });

  it('applies the 1e-12 absolute oracle tolerance', () => {
    expect(decimalWithin('0.41450132132819049671', '0.41450132132900000000')).toBe(true);
    expect(decimalWithin('0.4145013213', '0.4145013214')).toBe(false);
    expect(decimalWithin('0.5', '0.5000000000010')).toBe(true);
    expect(decimalWithin('-0.105', '-0.1050000000011')).toBe(false);
  });
});
