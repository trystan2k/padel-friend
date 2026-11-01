import type {
  MatchCompetitionChoice,
  MatchDraft,
  MatchLeagueOption,
  MatchPublishInput
} from './match-contracts';

export type MatchLeagueOptionsStatus = 'idle' | 'loading' | 'ready' | 'error';
export type MatchCompetitionState = {
  status: MatchLeagueOptionsStatus;
  candidates: readonly MatchLeagueOption[];
  resolution: MatchCompetitionResolution;
  retry: () => void;
};
export type MatchCompetitionResolution =
  | { competition: 'unranked'; league: null; needsSelection: false }
  | { competition: 'ranked'; league: MatchLeagueOption | null; needsSelection: boolean };

/**
 * Effective competition for a Competitive draft.
 * - A deliberate `unranked` choice always wins and is never reset by option reloads.
 * - No eligible League means Unranked; exactly one defaults to Ranked with that League shown.
 * - Several Leagues keep Ranked intent with no selected League until the player picks one
 *   (or opts out), so publication is blocked rather than guessing.
 */
export function resolveMatchCompetition(
  choice: MatchCompetitionChoice,
  leagueId: string,
  candidates: readonly MatchLeagueOption[]
): MatchCompetitionResolution {
  if (choice === 'unranked' || candidates.length === 0)
    return { competition: 'unranked', league: null, needsSelection: false };
  const picked = candidates.find((candidate) => candidate.id === leagueId) ?? null;
  const league = picked ?? (candidates.length === 1 ? (candidates[0] ?? null) : null);
  return { competition: 'ranked', league, needsSelection: league === null };
}

/** Publish keys for the resolved competition; Friendly events send neither key. */
export function matchCompetitionInput(
  type: MatchDraft['type'],
  resolution: MatchCompetitionResolution
): Pick<MatchPublishInput, 'competition' | 'league_id'> {
  if (type !== 'competitive') return {};
  return resolution.competition === 'ranked'
    ? { competition: 'ranked', league_id: resolution.league?.id ?? null }
    : { competition: 'unranked', league_id: null };
}

/** Locale-safe `start – end` (or `start –` for Manual Leagues) from the League's own calendar days. */
export function formatMatchLeaguePeriod(
  league: Pick<MatchLeagueOption, 'start_date' | 'end_date'>,
  language: string
): string {
  const format = (day: string) =>
    new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date(`${day}T00:00:00Z`)
    );
  return `${format(league.start_date)} – ${league.end_date ? format(league.end_date) : ''}`.trim();
}
