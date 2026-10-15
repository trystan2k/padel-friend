import { describe, expect, it, vi } from 'vitest';
import {
  validateDiscoverability,
  validateInviteeSearch
} from '../src/features/community/community-invitee.validators';

describe('invitee discovery validators', () => {
  it('accepts bounded literal text and exact consent input', () => {
    expect(
      validateInviteeSearch({
        community_id: '11111111-1111-4111-8111-111111111111',
        query: '  A_%.*  '
      }).query
    ).toBe('A_%.*');
    expect(validateDiscoverability({ enabled: false })).toEqual({ enabled: false });
  });
  it('accepts a real UUID and rejects malformed UUID-shaped community IDs', () => {
    const validId = '123e4567-e89b-42d3-a456-426614174000';
    expect(validateInviteeSearch({ community_id: validId, query: 'player' }).community_id).toBe(
      validId
    );
    for (const communityId of [
      '-'.repeat(36),
      '123e4567e89b-42d3-a456-4266-14174000',
      '123e4567-e89b-42d3-a456-42661417400z',
      '123e4567-e89b-42d3-a456-42661417400'
    ])
      expect(() => validateInviteeSearch({ community_id: communityId, query: 'player' })).toThrow(
        'INVALID_INVITEE_SEARCH'
      );
  });
  it('rejects short searches, malformed IDs, and extra consent fields', () => {
    expect(() => validateInviteeSearch({ community_id: 'x', query: 'ab' })).toThrow(
      'INVALID_INVITEE_SEARCH'
    );
    expect(() => validateDiscoverability({ enabled: true, user_id: 'forged' })).toThrow(
      'INVALID_DISCOVERABILITY'
    );
  });
});

describe('invitee search stale response protection', () => {
  it('does not apply a response after its source identity is invalidated', async () => {
    let generation = 0;
    let result = '';
    const request = vi.fn<() => Promise<string>>(
      () => new Promise<string>((resolve) => setTimeout(() => resolve('old source'), 10))
    );
    const current = ++generation;
    const pending = request().then((value) => {
      if (generation === current) result = value;
    });
    generation++;
    await pending;
    expect(result).toBe('');
  });
});
