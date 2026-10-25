import { MATCH_RESULT_ERROR_COPY, type MatchResultErrorCode } from './match-result-error-copy';
import { validateMatchUuid } from './matches.validators';
import {
  classifyMatchResultSets,
  validateMatchResultSets,
  validateMatchResultTeams,
  validateResultPlayedLocal
} from './match-result.validators';

export type ResultClassification = 'team_a' | 'team_b' | 'draw' | 'incomplete';

export type ResultSetRow = {
  position: number;
  team_a_games: number;
  team_b_games: number;
  completed: boolean;
};

export type ResultTeams = {
  team_a: [string, string];
  team_b: [string, string];
};

export type ResultValidationDetail = {
  // One-based array index, not an untrusted submitted position; null for collection errors.
  set_index: number | null;
  side: 'team_a' | 'team_b' | null;
  reason_token: string;
};

export type MatchResultResponse<T> =
  | { status: 'ok'; value: T; replayed: boolean }
  | {
      status: 'conflict';
      code: 'active_proposal';
      active_version: number;
      review_deadline_at: string;
    }
  | { status: 'error'; code: MatchResultErrorCode; detail?: ResultValidationDetail };

export type ResultSubmission = {
  event_id: string;
  proposal_id: string;
  group_number: number;
  version: number;
  submitted_at: string;
  review_deadline_at: string;
  request_id: string;
};
export type ResultPlayer = { user_id: string; display_name: string | null };
export type ResultProposal = Omit<ResultSubmission, 'request_id'> & {
  status: 'pending';
  teams: { team_a: [ResultPlayer, ResultPlayer]; team_b: [ResultPlayer, ResultPlayer] };
  sets: ResultSetRow[];
  classification: ResultClassification;
  played_at_utc: string;
  played_at_local: string;
  played_at_offset_seconds: number;
  court_label: string | null;
  rating_effective: boolean;
  submitted_by_name?: string | null;
};
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
function timestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
function submission(value: Record<string, unknown>): ResultSubmission | null {
  try {
    if (
      !positive(value.group_number) ||
      !positive(value.version) ||
      !timestamp(value.submitted_at) ||
      !timestamp(value.review_deadline_at) ||
      Date.parse(value.review_deadline_at) - Date.parse(value.submitted_at) !== 48 * 3600000
    )
      return null;
    return {
      event_id: validateMatchUuid(value.event_id),
      proposal_id: validateMatchUuid(value.proposal_id),
      group_number: value.group_number,
      version: value.version,
      submitted_at: value.submitted_at,
      review_deadline_at: value.review_deadline_at,
      request_id: validateMatchUuid(value.request_id)
    };
  } catch {
    return null;
  }
}
export function parseResultSubmission(
  value: unknown
): MatchResultResponse<ResultSubmission> | null {
  if (!record(value) || typeof value.replayed !== 'boolean') return null;
  const parsed = submission(value);
  return parsed ? { status: 'ok', value: parsed, replayed: value.replayed } : null;
}
export function parseResultProposals(value: unknown): ResultProposal[] | null {
  if (!Array.isArray(value)) return null;
  const proposals: ResultProposal[] = [];
  const groups = new Set<number>();
  try {
    for (const row of value) {
      if (!record(row) || !record(row.teams)) return null;
      // Reuse the submission clock/identity decoder without exposing synthetic request IDs.
      const base = submission({ ...row, request_id: row.proposal_id });
      if (
        !base ||
        row.status !== 'pending' ||
        groups.has(base.group_number) ||
        typeof row.rating_effective !== 'boolean' ||
        !timestamp(row.played_at_utc)
      )
        return null;
      const parsePlayers = (players: unknown): [ResultPlayer, ResultPlayer] => {
        if (!Array.isArray(players) || players.length !== 2) throw new Error('INVALID_TEAMS');
        const player = (item: unknown): ResultPlayer => {
          if (
            !record(item) ||
            !(item.display_name === null || typeof item.display_name === 'string')
          )
            throw new Error('INVALID_TEAMS');
          return { user_id: validateMatchUuid(item.user_id), display_name: item.display_name };
        };
        return [player(players[0]), player(players[1])];
      };
      if (Object.keys(row.teams).length !== 2) return null;
      const teams = {
        team_a: parsePlayers(row.teams.team_a),
        team_b: parsePlayers(row.teams.team_b)
      };
      validateMatchResultTeams({
        team_a: teams.team_a.map((p) => p.user_id),
        team_b: teams.team_b.map((p) => p.user_id)
      });
      const sets = validateMatchResultSets(row.sets);
      const classification = classifyMatchResultSets(sets);
      if (
        row.classification !== classification ||
        (classification === 'incomplete' && row.rating_effective)
      )
        return null;
      const played = validateResultPlayedLocal({
        local: row.played_at_local,
        offset_seconds: row.played_at_offset_seconds
      });
      if (
        Date.parse(row.played_at_utc) !==
          Date.parse(`${played.local.replace(' ', 'T')}Z`) - played.offset_seconds * 1000 ||
        !(
          row.court_label === null ||
          (typeof row.court_label === 'string' &&
            row.court_label === row.court_label.trim() &&
            row.court_label.length > 0 &&
            row.court_label.length <= 100 &&
            !/\p{Cc}/u.test(row.court_label))
        )
      )
        return null;
      groups.add(base.group_number);
      proposals.push({
        event_id: base.event_id,
        proposal_id: base.proposal_id,
        group_number: base.group_number,
        version: base.version,
        submitted_at: base.submitted_at,
        review_deadline_at: base.review_deadline_at,
        status: 'pending',
        teams,
        sets,
        classification,
        played_at_utc: row.played_at_utc,
        played_at_local: played.local,
        played_at_offset_seconds: played.offset_seconds,
        court_label: row.court_label,
        rating_effective: row.rating_effective,
        ...(typeof row.submitted_by_name === 'string'
          ? { submitted_by_name: row.submitted_by_name }
          : {})
      });
    }
    return proposals;
  } catch {
    return null;
  }
}
export function matchResultActionError(error: {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}): MatchResultResponse<never> {
  let detail: unknown;
  try {
    detail = JSON.parse(error.details ?? 'null');
  } catch {
    detail = null;
  }
  const code = error.message?.startsWith('MATCH_RESULT_')
    ? error.message.slice(13).toLowerCase()
    : '';
  if (code === 'active_proposal') {
    return record(detail) && positive(detail.active_version) && timestamp(detail.review_deadline_at)
      ? {
          status: 'conflict',
          code,
          active_version: detail.active_version,
          review_deadline_at: detail.review_deadline_at
        }
      : { status: 'error', code: 'unavailable' };
  }
  const known = Object.keys(MATCH_RESULT_ERROR_COPY).find(
    (key): key is MatchResultErrorCode => key === code
  );
  if (known) {
    const safe: ResultValidationDetail | undefined =
      record(detail) &&
      (detail.set_index === null || (positive(detail.set_index) && detail.set_index <= 3)) &&
      (detail.side === null || detail.side === 'team_a' || detail.side === 'team_b') &&
      detail.reason_token === code.toUpperCase()
        ? { set_index: detail.set_index, side: detail.side, reason_token: detail.reason_token }
        : undefined;
    return { status: 'error', code: known, ...(safe ? { detail: safe } : {}) };
  }
  return {
    status: 'error',
    code:
      error.code === '28000'
        ? 'unauthenticated'
        : error.code === '42501'
          ? 'forbidden'
          : 'unavailable'
  };
}
