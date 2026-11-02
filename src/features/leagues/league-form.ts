import {
  LEAGUE_DEFAULT_MINIMUM_MATCHES,
  LEAGUE_DESCRIPTION_MAX,
  LEAGUE_MINIMUM_MATCHES_MAX,
  LEAGUE_MINIMUM_MATCHES_MIN,
  LEAGUE_NAME_MAX,
  type LeagueDto,
  type LeagueEndMode,
  type LeagueErrorCode
} from './league-contracts';
import { stripEdgeWhitespace } from '../../lib/edge-whitespace';
import type { CommunityTimezone } from '../community/community-settings';

export type LeagueFormValues = {
  name: string;
  description: string;
  endMode: LeagueEndMode;
  startDate: string;
  endDate: string;
  minimumMatches: string;
};

export type LeagueFormField = keyof Omit<LeagueFormValues, 'endMode'>;
/** Keys under `leagues.form.errors.*`. */
export type LeagueFormErrorKey =
  | 'nameRequired'
  | 'nameTooLong'
  | 'descriptionTooLong'
  | 'startRequired'
  | 'startInPast'
  | 'endRequired'
  | 'endInPast'
  | 'endNotAfterStart'
  | 'minimumInvalid';
export type LeagueFormErrors = Partial<Record<LeagueFormField, LeagueFormErrorKey>>;

/** Order the fields appear in the form; the first invalid one receives focus. */
export const LEAGUE_FORM_FIELD_ORDER: readonly LeagueFormField[] = [
  'name',
  'description',
  'startDate',
  'endDate',
  'minimumMatches'
];

export type LeagueFormInput = {
  name: string;
  description: string | null;
  end_mode: LeagueEndMode;
  start_date: string;
  end_date: string | null;
  minimum_matches: number;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isCalendarDate = (value: string) => {
  const instant = DATE.test(value) ? Date.parse(`${value}T00:00:00Z`) : Number.NaN;
  return Number.isFinite(instant) && new Date(instant).toISOString().startsWith(value);
};

/** The community-local calendar day (`YYYY-MM-DD`) for an instant. */
export function todayInZone(timezone: CommunityTimezone, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}

export function defaultLeagueFormValues(today: string): LeagueFormValues {
  return {
    name: '',
    description: '',
    endMode: 'fixed_date',
    startDate: today,
    endDate: '',
    minimumMatches: String(LEAGUE_DEFAULT_MINIMUM_MATCHES)
  };
}

export function leagueFormValuesFromLeague(league: LeagueDto): LeagueFormValues {
  return {
    name: league.name,
    description: league.description ?? '',
    endMode: league.end_mode,
    startDate: league.start_date,
    endDate: league.end_date ?? '',
    minimumMatches: String(league.minimum_matches_for_final_award)
  };
}

/**
 * Validates the form against the same rules the database enforces. `originalStartDate` exempts
 * an unchanged start (an edited League that already started keeps its past start date).
 */
export function validateLeagueForm(
  values: LeagueFormValues,
  today: string,
  originalStartDate?: string
): { errors: LeagueFormErrors; input: LeagueFormInput | null } {
  const errors: LeagueFormErrors = {};
  const name = stripEdgeWhitespace(values.name);
  const description = stripEdgeWhitespace(values.description);
  if (!name) errors.name = 'nameRequired';
  else if (Array.from(name).length > LEAGUE_NAME_MAX) errors.name = 'nameTooLong';
  if (Array.from(description).length > LEAGUE_DESCRIPTION_MAX)
    errors.description = 'descriptionTooLong';
  if (!isCalendarDate(values.startDate)) errors.startDate = 'startRequired';
  else if (values.startDate < today && values.startDate !== originalStartDate)
    errors.startDate = 'startInPast';
  if (values.endMode === 'fixed_date') {
    if (!isCalendarDate(values.endDate)) errors.endDate = 'endRequired';
    else if (!errors.startDate && values.endDate <= values.startDate)
      errors.endDate = 'endNotAfterStart';
  }
  const minimum = Number(values.minimumMatches);
  if (
    !/^\d+$/.test(values.minimumMatches) ||
    !Number.isSafeInteger(minimum) ||
    minimum < LEAGUE_MINIMUM_MATCHES_MIN ||
    minimum > LEAGUE_MINIMUM_MATCHES_MAX
  )
    errors.minimumMatches = 'minimumInvalid';
  if (Object.keys(errors).length > 0) return { errors, input: null };
  return {
    errors,
    input: {
      name,
      description: description || null,
      end_mode: values.endMode,
      start_date: values.startDate,
      end_date: values.endMode === 'fixed_date' ? values.endDate : null,
      minimum_matches: minimum
    }
  };
}

/** Field a server rejection belongs to, when the user can fix it by editing that field. */
export function leagueFormFieldForError(
  code: LeagueErrorCode
): { field: LeagueFormField; key: LeagueFormErrorKey } | null {
  switch (code) {
    case 'LEAGUE_NAME_INVALID':
      return { field: 'name', key: 'nameRequired' };
    case 'LEAGUE_DESCRIPTION_INVALID':
      return { field: 'description', key: 'descriptionTooLong' };
    case 'LEAGUE_MINIMUM_INVALID':
      return { field: 'minimumMatches', key: 'minimumInvalid' };
    case 'LEAGUE_START_DATE_INVALID':
      return { field: 'startDate', key: 'startRequired' };
    case 'LEAGUE_START_IN_PAST':
      return { field: 'startDate', key: 'startInPast' };
    case 'LEAGUE_END_DATE_REQUIRED':
      return { field: 'endDate', key: 'endRequired' };
    case 'LEAGUE_END_IN_PAST':
      return { field: 'endDate', key: 'endInPast' };
    case 'LEAGUE_END_NOT_AFTER_START':
      return { field: 'endDate', key: 'endNotAfterStart' };
    default:
      return null;
  }
}

/** Formats a `YYYY-MM-DD` League day without shifting it through the viewer's timezone. */
export function formatLeagueDay(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    timeZone: 'UTC'
  }).format(new Date(`${date}T00:00:00Z`));
}

export function formatLeagueInstant(
  iso: string,
  locale: string,
  timeZone: CommunityTimezone
): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
    timeZoneName: 'short'
  }).format(new Date(iso));
}
