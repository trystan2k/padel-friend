import { describe, expect, it } from 'vitest';
import { canRequestResultCorrection } from '../src/features/matches/result-correction-entitlements';

const player = (user_id: string) => ({ user_id, display_name: null, is_provisional: false });
const proposal = {
  teams: { team_a: [player('a'), player('b')], team_b: [player('c'), player('d')] }
} as const;
const facts = {
  teams: {
    team_a: [...proposal.teams.team_a] as [ReturnType<typeof player>, ReturnType<typeof player>],
    team_b: [...proposal.teams.team_b] as [ReturnType<typeof player>, ReturnType<typeof player>]
  }
};

describe('correction request display entitlement', () => {
  it.each(['a', 'b', 'c', 'd'])('permits original participant %s', (caller) => {
    expect(canRequestResultCorrection(facts, 'creator', caller, false)).toBe(true);
  });
  it('permits creator and current community admin', () => {
    expect(canRequestResultCorrection(facts, 'creator', 'creator', false)).toBe(true);
    expect(canRequestResultCorrection(facts, 'creator', 'admin', true)).toBe(true);
  });
  it('hides entry from unrelated readers and fails closed without identity', () => {
    expect(canRequestResultCorrection(facts, 'creator', 'reader', false)).toBe(false);
    expect(canRequestResultCorrection(facts, 'creator', null, true)).toBe(false);
  });
});
