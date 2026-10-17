export const MATCH_PHOTO_BUCKET = 'match-event-photos';
export const MATCH_PHOTO_MAX_BYTES = 2 * 1024 * 1024;
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const keyPattern = new RegExp(
  `^(${uuid})/(${uuid})/(${uuid})/(${uuid})\\.(jpg|jpeg|png|webp)$`,
  'i'
);
const extensions: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};

export function validateMatchPhotoKey(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.includes('%') ||
    value.includes('\\') ||
    !keyPattern.test(value)
  )
    throw new Error('INVALID_MATCH_PHOTO_KEY');
  return value;
}

export function validateMatchPhotoFile(file: Pick<File, 'size' | 'type'>): void {
  if (!(file.type in extensions) || file.size < 1 || file.size > MATCH_PHOTO_MAX_BYTES)
    throw new Error('INVALID_MATCH_PHOTO');
}

export function matchesMatchPhotoMagicBytes(type: string, bytes: Uint8Array): boolean {
  if (type === 'image/jpeg')
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/png')
    return (
      bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)
    );
  return (
    type === 'image/webp' &&
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  );
}

export function matchPhotoExtension(type: string): string {
  const extension = extensions[type];
  if (!extension) throw new Error('INVALID_MATCH_PHOTO');
  return extension;
}
