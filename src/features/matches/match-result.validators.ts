import { validateMatchUuid } from './matches.validators';
import { validateLocalDate, validateLocalTime } from './match-time';
import type {
  ResultClassification,
  ResultSetRow,
  ResultTeams,
  ResultValidationDetail
} from './match-result-model';

export class MatchResultValidationError extends Error {
  readonly detail: ResultValidationDetail;

  constructor(
    reason: string,
    setIndex: number | null = null,
    side: ResultValidationDetail['side'] = null
  ) {
    super(`MATCH_RESULT_${reason}`);
    this.name = 'MatchResultValidationError';
    this.detail = { set_index: setIndex, side, reason_token: reason };
  }
}

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

export function validateMatchResultSets(value: unknown): ResultSetRow[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3)
    throw new MatchResultValidationError('INVALID_SETS');
  const sets: ResultSetRow[] = [];
  for (let index = 0; index < value.length; index++) {
    const row: unknown = value[index];
    const position = index + 1;
    if (!exact(row, ['position', 'team_a_games', 'team_b_games', 'completed']))
      throw new MatchResultValidationError('INVALID_SET', position);
    if (row.position !== position)
      throw new MatchResultValidationError('INVALID_SET_POSITION', position);
    if (typeof row.completed !== 'boolean')
      throw new MatchResultValidationError('INVALID_SET', position);
    const a = row.team_a_games;
    const b = row.team_b_games;
    for (const [side, score] of [
      ['team_a', a],
      ['team_b', b]
    ] as const) {
      if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > 7)
        throw new MatchResultValidationError('INVALID_SET_SCORE', position, side);
    }
    // Both scores were checked above. Explicit narrowing keeps untrusted input out of the model.
    if (typeof a !== 'number' || typeof b !== 'number')
      throw new MatchResultValidationError('INVALID_SET', position);
    if (index > 0 && !sets[index - 1]?.completed)
      throw new MatchResultValidationError('NON_SEQUENTIAL_SETS', position);
    const high = Math.max(a, b);
    const low = Math.min(a, b);
    const terminal = (high === 6 && low <= 4) || (high === 7 && (low === 5 || low === 6));
    if (terminal && !row.completed)
      throw new MatchResultValidationError('TERMINAL_SCORE_UNFINISHED', position);
    if (
      index === 2 &&
      row.completed &&
      sets[0]!.team_a_games > sets[0]!.team_b_games ===
        sets[1]!.team_a_games > sets[1]!.team_b_games
    )
      throw new MatchResultValidationError('THIRD_SET_AFTER_DECIDED', position);
    if ((row.completed && !terminal) || (high === 7 && !terminal))
      throw new MatchResultValidationError(
        'INVALID_SET_SCORE',
        position,
        a >= b ? 'team_a' : 'team_b'
      );
    sets.push({ position, team_a_games: a, team_b_games: b, completed: row.completed });
  }
  return sets;
}

export function classifyMatchResultSets(value: unknown): ResultClassification {
  const sets = validateMatchResultSets(value);
  let a = 0;
  let b = 0;
  for (const set of sets) {
    if (!set.completed) continue;
    if (set.team_a_games > set.team_b_games) a++;
    else b++;
  }
  if (a + b < 2) return 'incomplete';
  if (a === b) return 'draw';
  return a > b ? 'team_a' : 'team_b';
}

export function validateMatchResultTeams(value: unknown): ResultTeams {
  if (!exact(value, ['team_a', 'team_b'])) throw new MatchResultValidationError('INVALID_TEAMS');
  const teams: ResultTeams = { team_a: ['', ''], team_b: ['', ''] };
  const seen = new Set<string>();
  for (const side of ['team_a', 'team_b'] as const) {
    const players = value[side];
    if (!Array.isArray(players) || players.length !== 2)
      throw new MatchResultValidationError('INVALID_TEAMS', null, side);
    for (let index = 0; index < 2; index++) {
      let player: string;
      try {
        player = validateMatchUuid(players[index]).toLowerCase();
      } catch {
        throw new MatchResultValidationError('INVALID_TEAMS', null, side);
      }
      if (seen.has(player)) throw new MatchResultValidationError('DUPLICATE_PLAYER', null, side);
      seen.add(player);
      teams[side][index] = player;
    }
  }
  return teams;
}

export function validateGetMatchEventResultProposals(value: unknown) {
  if (!exact(value, ['event_id'])) throw new MatchResultValidationError('INVALID_REQUEST');
  return { event_id: validateMatchUuid(value.event_id) };
}

export function validateResultPlayedLocal(value: unknown) {
  if (
    !exact(value, ['local', 'offset_seconds']) ||
    typeof value.local !== 'string' ||
    !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value.local) ||
    typeof value.offset_seconds !== 'number' ||
    !Number.isInteger(value.offset_seconds) ||
    Math.abs(value.offset_seconds) > 50400 ||
    value.offset_seconds % 60 !== 0
  )
    throw new MatchResultValidationError('INVALID_PLAYED_AT');
  try {
    validateLocalDate(value.local.slice(0, 10));
    validateLocalTime(value.local.slice(11));
  } catch {
    throw new MatchResultValidationError('INVALID_PLAYED_AT');
  }
  return { local: value.local, offset_seconds: value.offset_seconds };
}

export function validateSubmitMatchEventResult(value: unknown) {
  if (
    !exact(value, [
      'event_id',
      'group_number',
      'teams',
      'sets',
      'played_local',
      'court_label',
      'request_id'
    ]) ||
    typeof value.group_number !== 'number' ||
    !Number.isSafeInteger(value.group_number) ||
    value.group_number < 1
  )
    throw new MatchResultValidationError('INVALID_REQUEST');
  if (
    value.court_label !== null &&
    (typeof value.court_label !== 'string' ||
      value.court_label.trim().length < 1 ||
      value.court_label.trim().length > 100 ||
      /\p{Cc}/u.test(value.court_label))
  )
    throw new MatchResultValidationError('INVALID_COURT');
  return {
    event_id: validateMatchUuid(value.event_id),
    group_number: value.group_number,
    teams: validateMatchResultTeams(value.teams),
    sets: validateMatchResultSets(value.sets),
    played_local: validateResultPlayedLocal(value.played_local),
    court_label: typeof value.court_label === 'string' ? value.court_label.trim() : null,
    request_id: validateMatchUuid(value.request_id)
  };
}
