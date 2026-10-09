import { hasEdgeWhitespace, stripEdgeWhitespace } from '../../lib/edge-whitespace';
import { isAvatarObjectKey } from './avatar-key';
import { MAX_LEVEL, MIN_LEVEL } from './rating-config';

export type PreferredSide = 'LEFT' | 'RIGHT' | 'EITHER';
export type DominantHand = 'LEFT' | 'RIGHT' | null;
export type OnboardPlayerInput = {
  display_name: string;
  preferred_side: PreferredSide;
  initial_level: number;
  dominant_hand?: DominantHand;
  bio?: string | null;
};
export type UpdatePlayerProfileInput = Partial<{
  display_name: string;
  preferred_side: PreferredSide;
  dominant_hand: DominantHand;
  bio: string | null;
  avatar_url: string | null;
}>;
export type AvatarUploadInput = { objectKey: string };

export const AVATAR_MAX_BYTES = 2097152;
export const AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

function objectWithKeys(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error('INVALID_PLAYER_INPUT');
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Bio has no edge-whitespace constraint: trim, then enforce char_length <= 280.
// Display names reject edge ASCII whitespace [ \t\n\r\f\v] per SQL btrim(display_name, E' \t\n\r\f\v').
function trimmedText(value: unknown, max: number): string {
  if (typeof value !== 'string') throw new Error('INVALID_PLAYER_INPUT');
  const trimmed = value.trim();
  // PostgreSQL char_length counts Unicode code points, not UTF-16 code units.
  const length = Array.from(trimmed).length;
  if (length > max) throw new Error('INVALID_PLAYER_INPUT');
  return trimmed;
}

function displayNameText(value: unknown): string {
  if (typeof value !== 'string') throw new Error('INVALID_PLAYER_INPUT');
  // V1 rejects edge ASCII whitespace only; Unicode whitespace (e.g. NBSP) is accepted and not normalized.
  if (hasEdgeWhitespace(value)) throw new Error('INVALID_PLAYER_INPUT');
  const normalized = stripEdgeWhitespace(value);
  // PostgreSQL char_length counts Unicode code points, not UTF-16 code units.
  const length = Array.from(normalized).length;
  if (length > 80 || length === 0) throw new Error('INVALID_PLAYER_INPUT');
  return normalized;
}

function preferredSide(value: unknown): PreferredSide {
  if (value !== 'LEFT' && value !== 'RIGHT' && value !== 'EITHER')
    throw new Error('INVALID_PLAYER_INPUT');
  return value;
}

export function validateInitialLevel(value: unknown): number {
  // Decimal strings are normalized to tenths before converting to a JS number.
  if (typeof value !== 'number' && typeof value !== 'string')
    throw new Error('INVALID_PLAYER_INPUT');
  const decimal = String(value);
  const parts = /^([0-7])(?:\.([0-9]+))?$/.exec(decimal);
  if (!parts || (parts[2] && /[1-9]/.test(parts[2].slice(1))))
    throw new Error('INVALID_PLAYER_INPUT');
  const tenths = Number(parts[1]) * 10 + Number(parts[2]?.[0] ?? 0);
  const level = tenths / 10;
  if (!Number.isFinite(level) || level < MIN_LEVEL || level > MAX_LEVEL)
    throw new Error('INVALID_PLAYER_INPUT');
  return level;
}

export function validateOnboardPlayer(value: unknown): OnboardPlayerInput {
  const input = objectWithKeys(value, [
    'display_name',
    'preferred_side',
    'initial_level',
    'dominant_hand',
    'bio'
  ]);
  const hand = input.dominant_hand ?? null;
  if (hand !== null && hand !== 'LEFT' && hand !== 'RIGHT') throw new Error('INVALID_PLAYER_INPUT');
  return {
    display_name: displayNameText(input.display_name),
    preferred_side: preferredSide(input.preferred_side),
    initial_level: validateInitialLevel(input.initial_level),
    ...('dominant_hand' in input ? { dominant_hand: hand } : {}),
    ...('bio' in input ? { bio: input.bio === null ? null : trimmedText(input.bio, 280) } : {})
  };
}

export function validateUpdatePlayerProfile(value: unknown): UpdatePlayerProfileInput {
  const input = objectWithKeys(value, [
    'display_name',
    'preferred_side',
    'dominant_hand',
    'bio',
    'avatar_url'
  ]);
  if (!Object.keys(input).length) throw new Error('INVALID_PLAYER_INPUT');
  const result: UpdatePlayerProfileInput = {};
  if ('display_name' in input) result.display_name = displayNameText(input.display_name);
  if ('preferred_side' in input) result.preferred_side = preferredSide(input.preferred_side);
  if ('dominant_hand' in input) {
    if (
      input.dominant_hand !== null &&
      input.dominant_hand !== 'LEFT' &&
      input.dominant_hand !== 'RIGHT'
    )
      throw new Error('INVALID_PLAYER_INPUT');
    result.dominant_hand = input.dominant_hand;
  }
  if ('bio' in input) result.bio = input.bio === null ? null : trimmedText(input.bio, 280);
  if ('avatar_url' in input) {
    if (input.avatar_url === null) {
      result.avatar_url = null;
    } else if (
      typeof input.avatar_url !== 'string' ||
      !isAvatarObjectKey(input.avatar_url.trim())
    ) {
      throw new Error('INVALID_PLAYER_INPUT');
    } else {
      result.avatar_url = input.avatar_url.trim();
    }
  }
  return result;
}

export function validateAvatarUpload(value: unknown): AvatarUploadInput {
  const input = objectWithKeys(value, ['objectKey']);
  if (typeof input.objectKey !== 'string') throw new Error('INVALID_PLAYER_INPUT');
  return { objectKey: input.objectKey };
}

export function validateAvatarFile(value: unknown): {
  type: (typeof AVATAR_MIME_TYPES)[number];
  size: number;
} {
  const input = objectWithKeys(value, ['type', 'size']);
  if (
    !isAvatarMime(input.type) ||
    typeof input.size !== 'number' ||
    !Number.isInteger(input.size) ||
    input.size < 0 ||
    input.size > AVATAR_MAX_BYTES
  )
    throw new Error('INVALID_AVATAR');
  return { type: input.type, size: input.size };
}

function isAvatarMime(value: unknown): value is (typeof AVATAR_MIME_TYPES)[number] {
  return value === 'image/jpeg' || value === 'image/png' || value === 'image/webp';
}
