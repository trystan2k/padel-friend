import { describe, expect, it, vi } from 'vitest';
import {
  validateMatchDetail,
  validateMatchInviteSearch,
  validateMatchList,
  validateMatchOptions,
  validatePublishMatch
} from '../src/features/matches/matches.validators';

const id = '123e4567-e89b-12d3-a456-426614174000';
describe('match validators', () => {
  it('validates nullable creation community and UUID detail', () => {
    expect(validateMatchOptions({ community_id: null })).toEqual({ community_id: null });
    expect(validateMatchDetail({ event_id: id })).toEqual({ event_id: id });
  });
  it('rejects unknown keys, malformed UUIDs, and invalid paging limits', () => {
    expect(() => validateMatchOptions({ community_id: null, extra: 1 })).toThrow(
      'INVALID_MATCH_INPUT'
    );
    expect(() => validateMatchDetail({ event_id: 'https://evil.example' })).toThrow(
      'INVALID_MATCH_INPUT'
    );
    expect(() => validateMatchList({ entry: 'available', limit: 51 })).toThrow(
      'INVALID_MATCH_INPUT'
    );
  });
  it('bounds invite search and list entries', () => {
    expect(validateMatchInviteSearch({ community_id: id, query: 'ana' }).limit).toBe(20);
    expect(() => validateMatchInviteSearch({ community_id: id, query: 'a', limit: 21 })).toThrow(
      'INVALID_MATCH_INPUT'
    );
    expect(() => validateMatchList({ entry: 'confirmed' })).toThrow('INVALID_MATCH_INPUT');
  });
  it('keeps an omitted list as_of null instead of stamping the clock', () => {
    // Freeze the clock: the old validator injected new Date().toISOString()
    // here, so an omitted as_of must still stay null under a fixed clock.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T10:30:00.000Z'));
    try {
      expect(validateMatchList({ entry: 'available' })).toEqual({
        entry: 'available',
        community_id: null,
        cursor: '',
        limit: 20,
        as_of: null
      });
    } finally {
      vi.useRealTimers();
    }
  });
  it('passes an explicit valid as_of through unchanged and rejects invalid ones', () => {
    const snapshot = '2026-01-01T00:00:00.000Z';
    expect(validateMatchList({ entry: 'my', as_of: snapshot }).as_of).toBe(snapshot);
    expect(validateMatchList({ entry: 'past', as_of: null }).as_of).toBeNull();
    for (const bad of ['yesterday', '2026-13-45T99:99:99Z', 42]) {
      expect(() => validateMatchList({ entry: 'my', as_of: bad })).toThrow('INVALID_MATCH_INPUT');
    }
  });
  it('parses publish fields and preserves SQL defaults by leaving optional keys omitted', () => {
    const input = {
      community_id: id,
      date: '2030-06-15',
      start_time: '20:00',
      event_type: 'friendly',
      visibility: 'community_open',
      team_assignment_mode: 'POST_MATCH_TEAMS',
      venue_name: 'Court',
      maps_url: 'https://maps.google.com/?q=court',
      photo_path: 'photo.png'
    };
    expect(validatePublishMatch({ event_id: id, input, invitee_ids: [] }).input).toEqual(input);
  });
  it('rejects unknown publish keys and malformed field primitives', () => {
    const input = {
      community_id: id,
      date: '2030-06-15',
      start_time: '20:00',
      event_type: 'friendly',
      visibility: 'community_open',
      team_assignment_mode: 'POST_MATCH_TEAMS',
      venue_name: 'Court',
      maps_url: 'https://maps.google.com/?q=court',
      photo_path: 'photo.png'
    };
    expect(() =>
      validatePublishMatch({ event_id: id, input: { ...input, extra: true }, invitee_ids: [] })
    ).toThrow('INVALID_MATCH_INPUT');
    expect(() =>
      validatePublishMatch({
        event_id: id,
        input: { ...input, court_booked: 'yes' },
        invitee_ids: []
      })
    ).toThrow('INVALID_MATCH_INPUT');
  });
});
