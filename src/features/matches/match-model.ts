export type MatchEventListItem = Record<string, string | number | boolean | null> & {
  event_id: string;
  photo_url: string | null;
  is_past: boolean;
  registration_open: boolean;
  caller_eligibility: 'creator' | 'member' | 'out_of_range' | 'nonmember' | 'invited' | null;
  caller_requires_approval: boolean;
};
export type MatchEventListResult = { items: MatchEventListItem[]; next_cursor: string | null };

export function getMatchParticipation(accepted: number) {
  if (!Number.isSafeInteger(accepted) || accepted < 0) throw new Error('INVALID_MATCH_COUNT');
  const playing = Math.floor(accepted / 4) * 4;
  const reserve = accepted % 4;
  return { playing, reserve, groups: Math.floor(accepted / 4), moreNeeded: 4 - reserve };
}

export function getMatchBadge(input: { creator: boolean; accepted: boolean; invited: boolean }) {
  if (input.accepted) return 'accepted' as const;
  if (input.invited) return 'invited' as const;
  if (input.creator) return 'accepted' as const;
  return null;
}
