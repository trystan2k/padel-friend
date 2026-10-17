import { describe, expect, it } from 'vitest';
import { validateMatchPhotoKey } from '../src/features/matches/match-photo';

describe('match photo server input contract', () => {
  it('rejects forged path components before storage access', () => {
    expect(() => validateMatchPhotoKey('community/event/other/object.jpg')).toThrow(
      'INVALID_MATCH_PHOTO_KEY'
    );
  });
  it('rejects percent-encoded owner or traversal segments', () => {
    expect(() =>
      validateMatchPhotoKey(
        '123e4567-e89b-42d3-a456-426614174000/123e4567-e89b-42d3-a456-426614174000/123e4567-e89b-42d3-a456-426614174000/%2e%2e.jpg'
      )
    ).toThrow('INVALID_MATCH_PHOTO_KEY');
  });
});
