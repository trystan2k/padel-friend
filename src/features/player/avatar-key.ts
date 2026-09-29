const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID_V4_WITH_VARIANT_PATTERN =
  '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const AVATAR_EXTENSION_PATTERN = '(?:jpg|jpeg|png|webp)';

export const AVATAR_FILENAME_PATTERN = new RegExp(
  `^${UUID_V4_WITH_VARIANT_PATTERN}\\.${AVATAR_EXTENSION_PATTERN}$`,
  'i'
);
export const AVATAR_OBJECT_KEY_PATTERN = new RegExp(
  `^${UUID_PATTERN}/${UUID_V4_WITH_VARIANT_PATTERN}\\.${AVATAR_EXTENSION_PATTERN}$`,
  'i'
);

export function isAvatarObjectKey(value: string): boolean {
  return AVATAR_OBJECT_KEY_PATTERN.test(value);
}
