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

export function matchesVenuePhotoMagicBytes(type: string, bytes: Uint8Array): boolean {
  if (type === 'image/jpeg')
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/png')
    return (
      bytes.length >= 8 &&
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)
    );
  if (type === 'image/webp')
    return (
      bytes.length >= 12 &&
      String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
      String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
    );
  return false;
}
