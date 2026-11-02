import type { MatchCompetitionStatus } from './match-contracts';

/** Competition facts of an event at one instant, as stored in the major-edit audit evidence. */
export type MatchCompetitionImpact = {
  competition_status: MatchCompetitionStatus | null;
  league_id: string | null;
  league_name: string | null;
  league_start_at: string | null;
  league_end_at: string | null;
  league_timezone: string | null;
};
/** What a reconfirmation request is about: changed fields plus the before/after competition. */
export type MatchConsentChange = {
  generation: number;
  changed_fields: string[];
  from: MatchCompetitionImpact | null;
  to: MatchCompetitionImpact | null;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const nullableText = (value: unknown) => (typeof value === 'string' ? value : null);

export function parseCompetitionImpact(value: unknown): MatchCompetitionImpact | null {
  if (!record(value)) return null;
  const status = value.competition_status;
  return {
    competition_status: status === 'ranked' || status === 'unranked' ? status : null,
    league_id: nullableText(value.league_id),
    league_name: nullableText(value.league_name),
    league_start_at: nullableText(value.league_start_at),
    league_end_at: nullableText(value.league_end_at),
    league_timezone: nullableText(value.league_timezone)
  };
}

/** Absent/malformed evidence (e.g. a pre-League edit) simply shows no impact summary. */
export function parseMatchConsentChange(value: unknown): MatchConsentChange | null {
  if (
    !record(value) ||
    typeof value.generation !== 'number' ||
    !Number.isSafeInteger(value.generation) ||
    !Array.isArray(value.changed_fields) ||
    !value.changed_fields.every((field): field is string => typeof field === 'string')
  )
    return null;
  const from = parseCompetitionImpact(value.from);
  const to = parseCompetitionImpact(value.to);
  return from === null && to === null
    ? null
    : { generation: value.generation, changed_fields: value.changed_fields, from, to };
}

function localDay(instant: string, timezone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
      .formatToParts(new Date(instant))
      .map(({ type, value }) => [type, value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** League-local calendar days of the impact's window (end null = open Manual League). */
export function competitionImpactWindow(impact: MatchCompetitionImpact | null) {
  if (!impact?.league_start_at || !impact.league_timezone) return null;
  return {
    start_date: localDay(impact.league_start_at, impact.league_timezone),
    end_date: impact.league_end_at ? localDay(impact.league_end_at, impact.league_timezone) : null
  };
}

/** One side (before or after) of a competition change, ready to render. */
export type MatchCompetitionSide = {
  status: MatchCompetitionStatus | null;
  leagueId: string | null;
  leagueName: string | null;
  window: { start_date: string; end_date: string | null } | null;
};

export function competitionImpactSide(impact: MatchCompetitionImpact | null): MatchCompetitionSide {
  return {
    status: impact?.competition_status ?? null,
    leagueId: impact?.league_id ?? null,
    leagueName: impact?.league_name ?? null,
    window: competitionImpactWindow(impact)
  };
}

export type MatchCompetitionEffect =
  | 'unchanged'
  | 'rankedToUnranked'
  | 'unrankedToRanked'
  | 'leagueSwitch'
  | 'noLongerCompetitive'
  | 'nowCompetitive';

/** Plain-language consequence of the change; League impact never touches global skill. */
export function competitionEffect(
  from: MatchCompetitionSide,
  to: MatchCompetitionSide
): MatchCompetitionEffect {
  if (from.status === to.status && from.leagueId === to.leagueId) return 'unchanged';
  if (to.status === null) return 'noLongerCompetitive';
  if (from.status === null) return 'nowCompetitive';
  if (from.status === 'ranked' && to.status === 'unranked') return 'rankedToUnranked';
  if (from.status === 'unranked' && to.status === 'ranked') return 'unrankedToRanked';
  return 'leagueSwitch';
}
