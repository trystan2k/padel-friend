import { describe, expect, it } from 'vitest';
import {
  MATCH_PHOTO_BUCKET,
  MATCH_PHOTO_MAX_BYTES,
  matchesMatchPhotoMagicBytes,
  matchPhotoExtension,
  validateMatchPhotoFile,
  validateMatchPhotoKey
} from '../src/features/matches/match-photo';

const uuid = '123e4567-e89b-42d3-a456-426614174000';

describe('match photo validation', () => {
  it('exposes private-bucket limits and accepts canonical object keys', () => {
    expect(MATCH_PHOTO_BUCKET).toBe('match-event-photos');
    expect(MATCH_PHOTO_MAX_BYTES).toBe(2097152);
    expect(validateMatchPhotoKey(`${uuid}/${uuid}/${uuid}/${uuid}.png`)).toContain('.png');
  });

  it.each(['%2e%2e/x', 'x\\y', `${uuid}/${uuid}/${uuid}/../${uuid}.jpg`, 'not-a-key'])(
    'rejects malformed key %s',
    (key) => {
      expect(() => validateMatchPhotoKey(key)).toThrow('INVALID_MATCH_PHOTO_KEY');
    }
  );

  it('requires supported type, nonempty bounded size, and matching bytes', () => {
    expect(() => validateMatchPhotoFile({ size: 0, type: 'image/png' })).toThrow(
      'INVALID_MATCH_PHOTO'
    );
    expect(() =>
      validateMatchPhotoFile({ size: MATCH_PHOTO_MAX_BYTES + 1, type: 'image/png' })
    ).toThrow('INVALID_MATCH_PHOTO');
    expect(() => validateMatchPhotoFile({ size: 4, type: 'image/svg+xml' })).toThrow(
      'INVALID_MATCH_PHOTO'
    );
    validateMatchPhotoFile({ size: 4, type: 'image/jpeg' });
    expect(matchPhotoExtension('image/jpeg')).toBe('jpg');
    expect(matchesMatchPhotoMagicBytes('image/jpeg', Uint8Array.from([255, 216, 255]))).toBe(true);
    expect(
      matchesMatchPhotoMagicBytes('image/png', Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ).toBe(true);
    expect(
      matchesMatchPhotoMagicBytes(
        'image/webp',
        Uint8Array.from([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80])
      )
    ).toBe(true);
    expect(matchesMatchPhotoMagicBytes('image/png', Uint8Array.from([255, 216, 255]))).toBe(false);
  });
});
