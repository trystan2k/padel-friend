export const COMMUNITY_VENUE_PHOTO_BUCKET = 'community-venue-photos';
export const COMMUNITY_VENUE_PHOTO_MAX_BYTES = 2 * 1024 * 1024;
const uuidPattern = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const keyPattern = new RegExp(
  `^(${uuidPattern})/(${uuidPattern})/(${uuidPattern})/(${uuidPattern})\\.(jpg|jpeg|png|webp)$`,
  'i'
);
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function validateVenuePhotoKey(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.includes('%') ||
    value.includes('\\') ||
    !keyPattern.test(value)
  ) {
    throw new Error('INVALID_VENUE_PHOTO_KEY');
  }
  return value;
}

export function validateVenuePhotoFile(file: Pick<File, 'size' | 'type'>): void {
  if (
    !allowedTypes.has(file.type) ||
    file.size < 1 ||
    file.size > COMMUNITY_VENUE_PHOTO_MAX_BYTES
  ) {
    throw new Error('INVALID_VENUE_PHOTO');
  }
}

export { matchesImageMagicBytes as matchesVenuePhotoMagicBytes } from '../../lib/image-verification';
