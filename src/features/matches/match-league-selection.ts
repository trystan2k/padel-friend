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
 * - A selected League that stops being eligible keeps Ranked intent with no League selected,
 *   whatever else remains: the player re-selects or explicitly opts out.
 */
export function resolveMatchCompetition(
  choice: MatchCompetitionChoice,
  leagueId: string,
  candidates: readonly MatchLeagueOption[]
): MatchCompetitionResolution {
  if (choice === 'unranked' || candidates.length === 0)
    return { competition: 'unranked', league: null, needsSelection: false };
  const picked = candidates.find((candidate) => candidate.id === leagueId) ?? null;
  // Only an absent selection defaults to the single candidate: an explicit pick that became
  // ineligible is never silently replaced by a League the player did not choose.
  const league =
    picked ?? (leagueId === '' && candidates.length === 1 ? (candidates[0] ?? null) : null);
  return { competition: 'ranked', league, needsSelection: league === null };
}

/**
 * Edit-dialog variant: the organizer's Ranked intent is never converted to Unranked by the
 * candidate list. With no candidate (empty answer, reload, failure) it stays Ranked with no
 * League selected, so the dialog asks for an explicit repair (new date) or an explicit Unranked.
 */
export function resolveMatchEditCompetition(
  choice: MatchCompetitionChoice,
  leagueId: string,
  candidates: readonly MatchLeagueOption[]
): MatchCompetitionResolution {
  if (choice === 'unranked')
    return { competition: 'unranked', league: null, needsSelection: false };
  if (candidates.length === 0) return { competition: 'ranked', league: null, needsSelection: true };
  return resolveMatchCompetition(choice, leagueId, candidates);
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
