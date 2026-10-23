import { describe, expect, it } from 'vitest';
import {
  classifyMatchResultSets,
  MatchResultValidationError,
  validateMatchResultSets,
  validateMatchResultTeams
} from '../src/features/matches/match-result.validators';
import { scoringCases } from './helpers/match-result-scoring-cases';

describe('match result scoring decision table', () => {
  it.each(scoringCases.filter((testCase) => testCase.error))('$name', ({ sets, error }) => {
    for (const engine of [validateMatchResultSets, classifyMatchResultSets]) {
      let caughtError: unknown;
      try {
        engine(sets);
      } catch (caught) {
        caughtError = caught;
      }
      expect(caughtError).toBeInstanceOf(MatchResultValidationError);
      expect(caughtError).toMatchObject({
        message: `MATCH_RESULT_${error?.reason_token}`,
        detail: error
      });
    }
  });
  it.each(scoringCases.filter((testCase) => !testCase.error))(
    '$name',
    ({ sets, classification }) => {
      const normalized = validateMatchResultSets(sets);
      expect(normalized).toEqual(sets);
      expect(normalized).not.toBe(sets);
      expect(classifyMatchResultSets(sets)).toBe(classification);
    }
  );
});

describe('result team normalization', () => {
  const players = [
    'aaaaaaaa-0000-4000-8000-000000000001',
    'aaaaaaaa-0000-4000-8000-000000000002',
    'aaaaaaaa-0000-4000-8000-000000000003',
    'aaaaaaaa-0000-4000-8000-000000000004'
  ] as const;
  const teams = { team_a: [players[0], players[1]], team_b: [players[2], players[3]] };

  it('normalizes UUID case without changing assignments or input', () => {
    const input = { team_a: teams.team_a.map((id) => id.toUpperCase()), team_b: teams.team_b };
    expect(validateMatchResultTeams(input)).toEqual(teams);
    expect(input.team_a[0]).toContain('AAAAAAAA');
  });

  it.each([
    null,
    [],
    {},
    { ...teams, extra: true },
    { team_a: teams.team_a },
    { ...teams, team_a: [] },
    { ...teams, team_b: [...teams.team_b, players[0]] },
    { ...teams, team_b: ['invalid', players[3]] }
  ])('rejects invalid exact-key teams: %j', (input) => {
    expect(() => validateMatchResultTeams(input)).toThrow('MATCH_RESULT_INVALID_TEAMS');
  });

  it.each([
    { ...teams, team_a: [players[0], players[0]] },
    { ...teams, team_b: [players[0].toUpperCase(), players[3]] }
  ])('rejects duplicate UUIDs within or across teams', (input) => {
    expect(() => validateMatchResultTeams(input)).toThrow('MATCH_RESULT_DUPLICATE_PLAYER');
  });
});
