import { describe, expect, it } from 'vitest';
import {
  validateMatchDetail,
  validateMatchInviteSearch,
  validateMatchList,
  validateMatchOptions
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
});
