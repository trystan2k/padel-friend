import type { MatchCallerBadge, MatchEventCard } from './match-contracts';
export type { MatchCallerBadge, MatchEventCard } from './match-contracts';
export type MatchEventListItem = MatchEventCard;
export type { MatchEventListResult } from './match-contracts';

// The flat DTO caller_badge is an enumerated participation value, not a free
// string. Reserve Not Playing is a first-class member so a past-cutoff reader is
// never labelled ordinary Reserve, and an unknown token degrades to null
// instead of rendering a bogus `matches.badges.<garbage>` key.
const MATCH_CALLER_BADGES: readonly MatchCallerBadge[] = [
  'creator',
  'playing',
  'reserve',
  'reserve_not_playing',
  'invited'
];

export function matchCallerBadge(value: unknown): MatchCallerBadge | null {
  if (typeof value !== 'string') return null;
  return MATCH_CALLER_BADGES.find((badge) => badge === value) ?? null;
}

function explicitCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function getMatchParticipation(accepted: number) {
  if (!Number.isSafeInteger(accepted) || accepted < 0) throw new Error('INVALID_MATCH_COUNT');
  const playing = Math.floor(accepted / 4) * 4;
  const reserve = accepted % 4;
  return { playing, reserve, groups: Math.floor(accepted / 4), moreNeeded: 4 - reserve };
}

export type MatchEventCounts = {
  accepted: number;
  playing: number;
  reserve: number;
  reserveNotPlaying: number;
  groups: number;
  moreNeeded: number;
};

/** Narrow pre-contract compatibility input for legacy count fallback parsing. */
export type MatchEventCountInput = {
  accepted_count?: unknown;
  playing_count?: unknown;
  reserve_count?: unknown;
  reserve_not_playing_count?: unknown;
  group_count?: unknown;
  more_needed?: unknown;
};

// Explicit flat counts are authoritative: reserve_count already excludes Reserve
// Not Playing, so a past-cutoff event is never displayed as if its not-playing
// players were ordinary Reserve. A payload without the explicit keys falls back
// to the pre-cutoff quartet derivation.
export function matchEventCounts(event: MatchEventCountInput): MatchEventCounts {
  const accepted = explicitCount(event.accepted_count);
  const playing = explicitCount(event.playing_count);
  const reserve = explicitCount(event.reserve_count);
  const groups = explicitCount(event.group_count);
  const moreNeeded = explicitCount(event.more_needed);
  const reserveNotPlaying = explicitCount(event.reserve_not_playing_count) ?? 0;
  if (
    accepted !== null &&
    playing !== null &&
    reserve !== null &&
    groups !== null &&
    moreNeeded !== null
  )
    return { accepted, playing, reserve, reserveNotPlaying, groups, moreNeeded };
  const derived = getMatchParticipation(accepted ?? 0);
  return {
    accepted: accepted ?? 0,
    playing: derived.playing,
    reserve: derived.reserve,
    reserveNotPlaying,
    groups: derived.groups,
    moreNeeded: derived.moreNeeded
  };
}

export function getMatchBadge(input: { creator: boolean; accepted: boolean; invited: boolean }) {
  if (input.accepted) return 'accepted' as const;
  if (input.invited) return 'invited' as const;
  if (input.creator) return 'accepted' as const;
  return null;
}
