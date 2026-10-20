import { describe, expect, it } from 'vitest';
import {
  getMatchBadge,
  getMatchParticipation,
  matchCallerBadge,
  matchEventCounts,
  type MatchEventCountInput
} from '../src/features/matches/match-model';

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

describe('match caller badge', () => {
  it('accepts every enumerated badge including the cutoff reserve_not_playing value', () => {
    for (const badge of ['creator', 'playing', 'reserve', 'reserve_not_playing', 'invited'])
      expect(matchCallerBadge(badge)).toBe(badge);
  });
  it('degrades malformed caller badges to null instead of a bogus translation key', () => {
    const malformed: unknown[] = [
      null,
      undefined,
      '',
      'garbage',
      'RESERVE',
      'reserve_not_playing ',
      'accepted',
      5,
      true,
      {},
      ['reserve']
    ];
    for (const value of malformed) {
      expect(() => matchCallerBadge(value)).not.toThrow();
      expect(matchCallerBadge(value)).toBeNull();
    }
  });
});

describe('match event counts', () => {
  const base: MatchEventCountInput = {};
  it('keeps reserve_not_playing out of the ordinary reserve figure when explicit counts are present', () => {
    // N=6 past the cutoff with one flipped reserve: a pre-cutoff quartet
    // derivation would report 2 reserves; the explicit counts must win.
    const counts = matchEventCounts({
      ...base,
      accepted_count: 6,
      playing_count: 4,
      reserve_count: 1,
      reserve_not_playing_count: 1,
      group_count: 1,
      more_needed: 2
    });
    expect(counts).toEqual({
      accepted: 6,
      playing: 4,
      reserve: 1,
      reserveNotPlaying: 1,
      groups: 1,
      moreNeeded: 2
    });
  });
  it('treats a missing reserve_not_playing_count as zero so pre-cutoff payloads stay valid', () => {
    const counts = matchEventCounts({
      ...base,
      accepted_count: 5,
      playing_count: 4,
      reserve_count: 1,
      group_count: 1,
      more_needed: 3
    });
    expect(counts).toMatchObject({ reserve: 1, reserveNotPlaying: 0 });
  });
  it('degrades a malformed reserve_not_playing_count safely to zero while keeping the explicit counts', () => {
    const withRawCount = (raw: number): MatchEventCountInput => ({
      ...base,
      accepted_count: 6,
      playing_count: 4,
      reserve_count: 1,
      reserve_not_playing_count: raw,
      group_count: 1,
      more_needed: 2
    });
    // Malformed numeric values (non-integer, negative, unsafe) degrade to 0
    // while every explicit count is preserved; non-numeric garbage is refused
    // at the parser boundary covered in matches.registration.functions.
    for (const malformed of [1.5, -3, Number.NaN]) {
      const counts = matchEventCounts(withRawCount(malformed));
      expect(counts.reserveNotPlaying, `malformed ${String(malformed)} degrades to 0`).toBe(0);
      expect(counts).toMatchObject({
        accepted: 6,
        playing: 4,
        reserve: 1,
        groups: 1,
        moreNeeded: 2
      });
    }
  });
  it('falls back to quartet derivation when the explicit counts are absent or malformed', () => {
    const derived = matchEventCounts({ ...base, accepted_count: 7 });
    expect(derived).toEqual({
      accepted: 7,
      playing: 4,
      reserve: 3,
      reserveNotPlaying: 0,
      groups: 1,
      moreNeeded: 1
    });
    const partial = matchEventCounts({
      ...base,
      accepted_count: 7,
      playing_count: 'four',
      reserve_not_playing_count: 2
    });
    expect(partial).toEqual({
      accepted: 7,
      playing: 4,
      reserve: 3,
      reserveNotPlaying: 2,
      groups: 1,
      moreNeeded: 1
    });
  });
});
