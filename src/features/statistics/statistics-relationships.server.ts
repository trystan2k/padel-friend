import type { PlayerClient } from '../player/player.server';
import { decodeStatisticsConfig } from './statistics-decoders';
import { type MetricState } from './statistics-contracts';
import { statisticsErrorCode, type StatisticsResponse } from './statistics-history-contracts';
import {
  array,
  count,
  decodeScore,
  finite,
  invalid,
  metric,
  metricOf,
  numberOrNull,
  object,
  outcome,
  text,
  textOrNull
} from './statistics-player.server';
import type {
  OpponentRecords,
  OpponentStatistics,
  PairStatistics,
  PartnerRecords,
  RelationshipExtremum,
  RelationshipLeader,
  RelationshipListItem,
  RelationshipMatch,
  RelationshipMostFrequent,
  RelationshipName,
  RelationshipRecord
} from './statistics-relationship-contracts';
import {
  validateStatisticsFilters,
  validateStatisticsRelationshipInput,
  validateStatisticsRelationshipListInput,
  type StatisticsRelationshipInput,
  type StatisticsRelationshipListInput
} from './statistics.validators';

function decodeName(value: unknown): RelationshipName {
  const data = object(value);
  return { userId: text(data.userId), displayName: textOrNull(data.displayName) };
}
function decodeExtremum(value: unknown): RelationshipExtremum {
  const data = object(value);
  return {
    k: finite(data.k),
    v: finite(data.v),
    at: text(data.at),
    g: text(data.g),
    eventId: textOrNull(data.eventId)
  };
}
const extremum = (value: unknown): MetricState<RelationshipExtremum> =>
  metricOf(value, decodeExtremum);

function decodeRecord(value: unknown): RelationshipRecord {
  const data = object(value);
  const matches = object(data.matches);
  const streaks = object(data.streaks);
  const current = object(streaks.current);
  const kind =
    current.kind === 'W' || current.kind === 'L' || current.kind === null
      ? current.kind
      : invalid();
  const length = count(current.length);
  if ((kind === null) !== (length === 0)) return invalid();
  const result: RelationshipRecord = {
    matches: {
      played: count(matches.played),
      competitive: count(matches.competitive),
      friendly: count(matches.friendly),
      wins: count(matches.wins),
      losses: count(matches.losses),
      draws: count(matches.draws),
      incomplete: count(matches.incomplete),
      winRate: metric(matches.winRate)
    },
    sets: decodeScore(data.sets),
    games: decodeScore(data.games),
    streaks: {
      current: { kind, length },
      longestWins: count(streaks.longestWins),
      longestLosses: count(streaks.longestLosses)
    },
    averageOpponentLevel: metric(data.averageOpponentLevel),
    upsetWins: count(data.upsetWins),
    biggestUpset: extremum(data.biggestUpset),
    toughestLoss: extremum(data.toughestLoss),
    biggestGain: extremum(data.biggestGain),
    biggestLoss: extremum(data.biggestLoss),
    leaderEligibility: metric(data.leaderEligibility),
    leagues: array(data.leagues).map((item) => {
      const league = object(item);
      return {
        leagueId: text(league.leagueId),
        name: textOrNull(league.name),
        groups: count(league.groups)
      };
    })
  };
  const { played, competitive, friendly, wins, losses, draws, incomplete } = result.matches;
  if (wins + losses + draws + incomplete !== played || competitive + friendly !== played)
    return invalid();
  return result;
}

function decodeMatch(value: unknown): RelationshipMatch {
  const data = object(value);
  const matchType =
    data.matchType === 'competitive' || data.matchType === 'friendly' ? data.matchType : invalid();
  const result = data.outcome === 'I' ? 'I' : outcome(data.outcome);
  return {
    groupId: text(data.groupId),
    eventId: text(data.eventId),
    playedAt: text(data.playedAt),
    matchType,
    outcome: result,
    setsFor: count(data.setsFor),
    setsAgainst: count(data.setsAgainst),
    gamesFor: count(data.gamesFor),
    gamesAgainst: count(data.gamesAgainst),
    expectedScore: numberOrNull(data.expectedScore ?? null),
    ratingDelta: numberOrNull(data.ratingDelta ?? null)
  };
}

function decodeConfig(value: unknown) {
  const config = decodeStatisticsConfig(value);
  if (!config.rating_aligned) return invalid();
  return config;
}

/** Only documented fields leave the decoder; raw RPC objects are never returned. */
export function decodePairStatistics(value: unknown): PairStatistics {
  const row = object(value);
  const input = validateStatisticsRelationshipInput({
    playerId: row.focalId,
    otherId: row.otherId,
    ...validateStatisticsFilters(row.filters)
  });
  const players = array(row.players).map(decodeName);
  if (
    players.length !== 2 ||
    ![input.playerId, input.otherId].every((id) => players.some((entry) => entry.userId === id))
  )
    return invalid();
  return {
    focalId: input.playerId,
    otherId: input.otherId,
    pairId: text(row.pairId),
    filters: input.filters,
    config: decodeConfig(row.config),
    players,
    record: decodeRecord(row.record),
    recent: array(row.recent).map(decodeMatch)
  };
}

export function decodeOpponentStatistics(value: unknown): OpponentStatistics {
  const row = object(value);
  const input = validateStatisticsRelationshipInput({
    playerId: row.focalId,
    otherId: row.otherId,
    ...validateStatisticsFilters(row.filters)
  });
  return {
    focalId: input.playerId,
    otherId: input.otherId,
    filters: input.filters,
    config: decodeConfig(row.config),
    focal: decodeName(row.focal),
    other: decodeName(row.other),
    record: decodeRecord(row.record),
    recent: array(row.recent).map(decodeMatch)
  };
}

function decodeItem(value: unknown): RelationshipListItem {
  const data = object(value);
  return {
    playerId: text(data.playerId),
    displayName: textOrNull(data.displayName),
    played: count(data.played),
    wins: count(data.wins),
    losses: count(data.losses),
    draws: count(data.draws),
    incomplete: count(data.incomplete),
    winRate: metric(data.winRate)
  };
}
function decodeMostFrequent(value: unknown): RelationshipMostFrequent {
  const data = object(value);
  return { groups: count(data.groups), players: array(data.players).map(decodeName) };
}
function decodeLeader(value: unknown): RelationshipLeader {
  const data = object(value);
  return {
    players: array(data.players).map(decodeName),
    resolved: count(data.resolved),
    winRate: numberOrNull(data.winRate),
    imbalance: numberOrNull(data.imbalance)
  };
}
const leader = (value: unknown) => metricOf(value, decodeLeader);

function decodeRecordsBase(value: unknown) {
  const row = object(value);
  const input = validateStatisticsRelationshipListInput({
    playerId: row.playerId,
    ...validateStatisticsFilters(row.filters),
    limit: row.limit,
    offset: row.offset
  });
  const items = array(row.items).map(decodeItem);
  if (items.length > input.limit) return invalid();
  return {
    playerId: input.playerId,
    filters: input.filters,
    config: decodeConfig(row.config),
    limit: input.limit,
    offset: input.offset,
    total: count(row.total),
    items,
    mostFrequent: metricOf(row.mostFrequent, decodeMostFrequent),
    best: leader(row.best)
  };
}
export function decodePartnerRecords(value: unknown): PartnerRecords {
  return decodeRecordsBase(value);
}
export function decodeOpponentRecords(value: unknown): OpponentRecords {
  const row = object(value);
  return {
    ...decodeRecordsBase(value),
    toughest: leader(row.toughest),
    closestRivalry: leader(row.closestRivalry)
  };
}

const filterArgs = (filters: StatisticsRelationshipListInput['filters']) => ({
  p_type: filters.type,
  ...(filters.communityId ? { p_community_id: filters.communityId } : {}),
  ...(filters.leagueId ? { p_league_id: filters.leagueId } : {}),
  ...(filters.from ? { p_from: filters.from } : {}),
  ...(filters.through ? { p_through: filters.through } : {})
});

async function decoded<T>(
  call: PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>,
  decode: (value: unknown) => T
): Promise<StatisticsResponse<T>> {
  const { data, error } = await call;
  if (error) return { status: 'error', code: statisticsErrorCode(error) };
  try {
    return { status: 'ok', value: decode(data) };
  } catch {
    return { status: 'error', code: 'INVALID_STATISTICS_RESPONSE' };
  }
}

export function readPairStatistics(client: PlayerClient, input: StatisticsRelationshipInput) {
  return decoded(
    client.rpc('get_pair_statistics', {
      p_player_id: input.playerId,
      p_partner_id: input.otherId,
      ...filterArgs(input.filters)
    }),
    decodePairStatistics
  );
}
export function readOpponentStatistics(client: PlayerClient, input: StatisticsRelationshipInput) {
  return decoded(
    client.rpc('get_opponent_statistics', {
      p_player_id: input.playerId,
      p_opponent_id: input.otherId,
      ...filterArgs(input.filters)
    }),
    decodeOpponentStatistics
  );
}
export function readPartnerRecords(client: PlayerClient, input: StatisticsRelationshipListInput) {
  return decoded(
    client.rpc('get_player_partner_records', {
      p_player_id: input.playerId,
      p_limit: input.limit,
      p_offset: input.offset,
      ...filterArgs(input.filters)
    }),
    decodePartnerRecords
  );
}
export function readOpponentRecords(client: PlayerClient, input: StatisticsRelationshipListInput) {
  return decoded(
    client.rpc('get_player_opponent_records', {
      p_player_id: input.playerId,
      p_limit: input.limit,
      p_offset: input.offset,
      ...filterArgs(input.filters)
    }),
    decodeOpponentRecords
  );
}
