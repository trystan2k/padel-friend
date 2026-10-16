import { describe, expect, it } from 'vitest';
import { getMatchBadge, getMatchParticipation } from '../src/features/matches/match-model';

describe('match participation model', () => {
  it('counts quartets, reserves, and next capacity', () => {
    expect(getMatchParticipation(1)).toEqual({ playing: 0, reserve: 1, groups: 0, moreNeeded: 3 });
    expect(getMatchParticipation(4)).toEqual({ playing: 4, reserve: 0, groups: 1, moreNeeded: 4 });
    expect(getMatchParticipation(6)).toEqual({ playing: 4, reserve: 2, groups: 1, moreNeeded: 2 });
  });
  it('gives accepted status precedence over invitations', () => {
    expect(getMatchBadge({ creator: false, accepted: true, invited: true })).toBe('accepted');
    expect(getMatchBadge({ creator: false, accepted: false, invited: true })).toBe('invited');
  });
});
