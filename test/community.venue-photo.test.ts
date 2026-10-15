import { describe, expect, it } from 'vitest';
import {
  matchesVenuePhotoMagicBytes,
  validateVenuePhotoFile,
  validateVenuePhotoKey
} from '../src/features/community/venue-photo';

const community = '11111111-1111-4111-8111-111111111111';
const venue = '22222222-2222-4222-8222-222222222222';
const user = '33333333-3333-4333-8333-333333333333';

describe('community venue photo validation', () => {
  it('accepts exact UUID path and permitted extensions', () => {
    expect(
      validateVenuePhotoKey(
        `${community}/${venue}/${user}/44444444-4444-4444-8444-444444444444.webp`
      )
    ).toContain('.webp');
    expect(() => validateVenuePhotoKey(`${community}/../${user}/x.jpg`)).toThrow(
      'INVALID_VENUE_PHOTO_KEY'
    );
    expect(() => validateVenuePhotoKey(`${community}/${venue}/${user}/%2e%2e.jpg`)).toThrow(
      'INVALID_VENUE_PHOTO_KEY'
    );
  });
  it('accepts only bounded JPEG/PNG/WebP file metadata', () => {
    expect(() =>
      validateVenuePhotoFile({ type: 'image/jpeg', size: 2 * 1024 * 1024 })
    ).not.toThrow();
    expect(() => validateVenuePhotoFile({ type: 'image/svg+xml', size: 20 })).toThrow(
      'INVALID_VENUE_PHOTO'
    );
    expect(() => validateVenuePhotoFile({ type: 'image/png', size: 2 * 1024 * 1024 + 1 })).toThrow(
      'INVALID_VENUE_PHOTO'
    );
  });
  it('checks image signatures rather than trusting metadata', () => {
    expect(matchesVenuePhotoMagicBytes('image/jpeg', new Uint8Array([0xff, 0xd8, 0xff]))).toBe(
      true
    );
    expect(
      matchesVenuePhotoMagicBytes(
        'image/png',
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      )
    ).toBe(true);
    expect(
      matchesVenuePhotoMagicBytes('image/webp', new TextEncoder().encode('RIFF0000WEBP'))
    ).toBe(true);
    expect(matchesVenuePhotoMagicBytes('image/png', new TextEncoder().encode('<svg/>'))).toBe(
      false
    );
  });
});
