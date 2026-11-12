export const PLAYING_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
export const PLAYING_TIMES = ['MORNING', 'AFTERNOON', 'EVENING'] as const;
export type PlayingDay = (typeof PLAYING_DAYS)[number];
export type PlayingTime = (typeof PLAYING_TIMES)[number];

/**
 * Validates an untrusted availability payload and returns it deduplicated in canonical
 * order. `null` and the empty array both mean "not provided" and normalize to `null`.
 * Anything that is not a flat array of known strings, or that has more raw entries than
 * there are allowed values, is rejected before normalization (mirrors the SQL CHECKs).
 */
function normalizeChoices<T extends string>(value: unknown, allowed: readonly T[]): T[] | null {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length > allowed.length)
    throw new Error('INVALID_PLAYER_INPUT');
  const chosen = new Set<unknown>();
  for (const entry of value) {
    if (typeof entry !== 'string' || !allowed.some((known) => known === entry))
      throw new Error('INVALID_PLAYER_INPUT');
    chosen.add(entry);
  }
  const canonical = allowed.filter((known) => chosen.has(known));
  return canonical.length ? canonical : null;
}

export function normalizePlayingDays(value: unknown): PlayingDay[] | null {
  return normalizeChoices(value, PLAYING_DAYS);
}

export function normalizePlayingTimes(value: unknown): PlayingTime[] | null {
  return normalizeChoices(value, PLAYING_TIMES);
}

/** Typed projection of stored values (already constrained by SQL): canonical order, or null. */
function projectChoices<T extends string>(
  value: readonly string[] | null,
  allowed: readonly T[]
): T[] | null {
  const canonical = allowed.filter((known) => value?.includes(known));
  return canonical.length ? canonical : null;
}

export function projectPlayingDays(value: readonly string[] | null): PlayingDay[] | null {
  return projectChoices(value, PLAYING_DAYS);
}

export function projectPlayingTimes(value: readonly string[] | null): PlayingTime[] | null {
  return projectChoices(value, PLAYING_TIMES);
}

/** Toggles one choice in a draft, keeping canonical order; an emptied draft becomes null. */
export function toggleChoice<T extends string>(
  current: readonly T[] | null,
  allowed: readonly T[],
  value: T,
  checked: boolean
): T[] | null {
  const next = allowed.filter((known) => (known === value ? checked : current?.includes(known)));
  return next.length ? next : null;
}
