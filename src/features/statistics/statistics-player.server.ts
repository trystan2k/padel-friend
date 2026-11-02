import type { PlayerClient } from '../player/player.server';
import { decodeStatisticsConfig } from './statistics-decoders';
import {
  STATISTICS_REASONS,
  type ExtremumCandidate,
  type MetricState,
  type RecentOutcome,
  type StatisticsReason
} from './statistics-contracts';
import { statisticsErrorCode, type StatisticsResponse } from './statistics-history-contracts';
import type {
  PlayerActivity,
  PlayerActivityBucket,
  PlayerAdvancedStatistics,
  PlayerFormSample,
  PlayerLeaguePosition,
  PlayerMatchTotals,
  PlayerRank,
  PlayerRankHistory,
  PlayerRankHistoryPage,
  PlayerRankTransition,
  PlayerRatingStatistics,
  PlayerRelationshipLeader,
  PlayerRelationships,
  PlayerScoreTotals,
  PlayerStatistics,
  PlayerTypeRates
} from './statistics-player-contracts';
import {
  validateStatisticsFilters,
  validateStatisticsPlayerInput,
  type StatisticsPlayerInput,
  type StatisticsRankHistoryInput
} from './statistics.validators';

type ObjectValue = Record<string, unknown>;
function invalid(): never {
  throw new Error('INVALID_STATISTICS_RESPONSE');
}
function object(value: unknown): ObjectValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid();
  return Object.fromEntries(Object.entries(value));
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) return invalid();
  return Array.from(value);
}
function numberOrNull(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) return invalid();
  return value;
}
function finite(value: unknown): number {
  const result = numberOrNull(value);
  return result === null ? invalid() : result;
}
function count(value: unknown): number {
  const result = finite(value);
  return Number.isInteger(result) && result >= 0 ? result : invalid();
}
function text(value: unknown): string {
  return typeof value === 'string' && value.length > 0 ? value : invalid();
}
function textOrNull(value: unknown): string | null {
  return value === null ? null : text(value);
}
function reason(value: unknown): StatisticsReason {
  const item = STATISTICS_REASONS.find((entry) => entry === value);
  return item ?? invalid();
}
function metricOf<T>(value: unknown, decodeValue: (item: unknown) => T): MetricState<T> {
  const data = object(value);
  if (data.state === 'ready') {
    return {
      state: 'ready',
      value: decodeValue(data.value),
      numerator: numberOrNull(data.numerator),
      denominator: numberOrNull(data.denominator)
    };
  }
  if (data.value !== null) return invalid();
  if (data.state === 'unavailable')
    return { state: 'unavailable', value: null, reason: reason(data.reason) };
  if (data.state === 'insufficient')
    return {
      state: 'insufficient',
      value: null,
      numerator: numberOrNull(data.numerator),
      denominator: numberOrNull(data.denominator),
      observed: numberOrNull(data.observed),
      required: numberOrNull(data.required),
      reason: reason(data.reason)
    };
  return invalid();
}
function metric(value: unknown): MetricState {
  return metricOf(value, finite);
}
function provenance(value: unknown): PlayerRank['provenance'] {
  return value === 'published' || value === 'reconstructed' ? value : invalid();
}
function decodeRank(value: unknown): PlayerRank {
  const data = object(value);
  const standingsVersion = numberOrNull(data.standingsVersion);
  const ratingRevision = numberOrNull(data.ratingRevision);
  return {
    position: count(data.position),
    provenance: provenance(data.provenance),
    at: text(data.at),
    communityId: text(data.communityId),
    leagueId: textOrNull(data.leagueId),
    standingsVersion,
    ratingRevision
  };
}
const RANK_COVERAGE_REASONS = [
  'missing_rating_evidence',
  'unpublished_league',
  'no_history'
] as const;
function coverageReason(value: unknown): PlayerRankHistory['coverageReason'] {
  if (value === null) return null;
  return RANK_COVERAGE_REASONS.find((entry) => entry === value) ?? invalid();
}
function decodeRankHistory(value: unknown): PlayerRankHistory {
  const data = object(value);
  if (typeof data.coverageComplete !== 'boolean') return invalid();
  return {
    best: metricOf(data.best, decodeRank),
    coverageFrom: textOrNull(data.coverageFrom),
    coverageUntil: textOrNull(data.coverageUntil),
    coverageComplete: data.coverageComplete,
    coverageReason: coverageReason(data.coverageReason)
  };
}
function decodeRating(value: unknown): PlayerRatingStatistics {
  const rating = object(value);
  return {
    currentLevel: metric(rating.currentLevel),
    reliability: metric(rating.reliability),
    startingLevel: metric(rating.startingLevel),
    highestLevel: metric(rating.highestLevel),
    lowestEstablishedLevel: metric(rating.lowestEstablishedLevel),
    filteredDelta: metric(rating.filteredDelta),
    communitySkillRank: metricOf(rating.communitySkillRank, decodeRank),
    activeLeaguePosition: metricOf(rating.activeLeaguePosition, decodeRank),
    bestCommunitySkillRank: decodeRankHistory(rating.bestCommunitySkillRank),
    bestLeaguePosition: decodeRankHistory(rating.bestLeaguePosition)
  };
}
function decodeMatches(value: unknown): PlayerMatchTotals {
  const data = object(value);
  const result: PlayerMatchTotals = {
    played: count(data.played),
    competitive: count(data.competitive),
    friendly: count(data.friendly),
    wins: count(data.wins),
    losses: count(data.losses),
    draws: count(data.draws),
    incomplete: count(data.incomplete),
    winRate: metric(data.winRate),
    competitiveWinRate: metric(data.competitiveWinRate),
    friendlyWinRate: metric(data.friendlyWinRate)
  };
  const resolved = result.wins + result.losses + result.draws + result.incomplete;
  if (resolved !== result.played || result.competitive + result.friendly !== result.played)
    return invalid();
  return result;
}
function decodeTypeRates(value: unknown): PlayerTypeRates {
  const data = object(value);
  const kind = (item: unknown) => {
    const rates = object(item);
    return {
      winRate: metric(rates.winRate),
      setRate: metric(rates.setRate),
      gameRate: metric(rates.gameRate)
    };
  };
  return { competitive: kind(data.competitive), friendly: kind(data.friendly) };
}
function decodeScore(value: unknown): PlayerScoreTotals {
  const data = object(value);
  const won = count(data.won);
  const lost = count(data.lost);
  if (finite(data.differential) !== won - lost) return invalid();
  return { won, lost, differential: won - lost, winRate: metric(data.winRate) };
}
function decodeGames(value: unknown): PlayerStatistics['games'] {
  const data = object(value);
  return {
    ...decodeScore(data),
    averageWonPerGroup: metric(data.averageWonPerGroup),
    averageConcededPerGroup: metric(data.averageConcededPerGroup)
  };
}
function outcome(value: unknown): RecentOutcome['o'] {
  return value === 'W' || value === 'L' || value === 'D' ? value : invalid();
}
function decodeFormSample(value: unknown): PlayerFormSample {
  const data = object(value);
  const outcomes = array(data.outcomes).map((item) => {
    const entry = object(item);
    return { g: text(entry.g), o: outcome(entry.o), at: text(entry.at) };
  });
  const capacity = data.capacity === 5 ? 5 : data.capacity === 10 ? 10 : invalid();
  const result: PlayerFormSample = {
    outcomes,
    wins: count(data.wins),
    losses: count(data.losses),
    draws: count(data.draws),
    sampleSize: count(data.sampleSize),
    capacity
  };
  if (
    result.sampleSize !== outcomes.length ||
    result.wins + result.losses + result.draws !== result.sampleSize ||
    result.sampleSize > capacity
  )
    return invalid();
  return result;
}
function decodeForm(value: unknown): PlayerStatistics['form'] {
  const data = object(value);
  const current = object(data.current);
  const kind =
    current.kind === 'W' || current.kind === 'L' || current.kind === null
      ? current.kind
      : invalid();
  const length = count(current.length);
  if ((kind === null) !== (length === 0)) return invalid();
  return {
    last5: metricOf(data.last5, decodeFormSample),
    last10: metricOf(data.last10, decodeFormSample),
    current: { kind, length },
    longestWins: count(data.longestWins),
    longestLosses: count(data.longestLosses)
  };
}
function decodeCandidate(value: unknown): ExtremumCandidate {
  const data = object(value);
  return { k: finite(data.k), v: finite(data.v), at: text(data.at), g: text(data.g) };
}
function decodeAdvanced(value: unknown): PlayerAdvancedStatistics {
  const data = object(value);
  const extremum = (item: unknown) => metricOf(item, decodeCandidate);
  return {
    straightSetWins: count(data.straightSetWins),
    straightSetLosses: count(data.straightSetLosses),
    threeSetGroups: count(data.threeSetGroups),
    incompleteDeciders: count(data.incompleteDeciders),
    decidingSetWins: count(data.decidingSetWins),
    decidingSetLosses: count(data.decidingSetLosses),
    decidingSetWinRate: metric(data.decidingSetWinRate),
    firstSetConversionRate: metric(data.firstSetConversionRate),
    comebackWinRate: metric(data.comebackWinRate),
    cleanestWin: extremum(data.cleanestWin),
    closestWin: extremum(data.closestWin),
    biggestGain: extremum(data.biggestGain),
    biggestLoss: extremum(data.biggestLoss),
    strongestUpset: extremum(data.strongestUpset),
    toughestLoss: extremum(data.toughestLoss)
  };
}
function decodeBucket(value: unknown): PlayerActivityBucket {
  const data = object(value);
  return { period: text(data.period), groups: count(data.groups) };
}
function decodeActivity(value: unknown): PlayerActivity {
  const data = object(value);
  return {
    fromDay: textOrNull(data.fromDay),
    throughDay: textOrNull(data.throughDay),
    weeklyAverage: metric(data.weeklyAverage),
    mostActiveWeek: metricOf(data.mostActiveWeek, decodeBucket),
    mostActiveMonth: metricOf(data.mostActiveMonth, decodeBucket),
    days: array(data.days).map(decodeBucket),
    weeks: array(data.weeks).map(decodeBucket),
    months: array(data.months).map(decodeBucket)
  };
}
function decodeLeader(value: unknown): PlayerRelationshipLeader {
  const data = object(value);
  return { playerId: text(data.playerId), groups: count(data.groups) };
}
function decodeRelationships(value: unknown): PlayerRelationships {
  const data = object(value);
  return {
    uniquePartners: count(data.uniquePartners),
    uniqueOpponents: count(data.uniqueOpponents),
    uniqueQuartets: count(data.uniqueQuartets),
    mostFrequentPartners: array(data.mostFrequentPartners).map(decodeLeader),
    mostFrequentOpponents: array(data.mostFrequentOpponents).map(decodeLeader),
    mostFrequentPartnerShare: metric(data.mostFrequentPartnerShare)
  };
}
/** Only documented fields leave the decoder; raw RPC objects are never returned. */
export function decodePlayerStatistics(value: unknown): PlayerStatistics {
  const row = object(value);
  const filters = validateStatisticsFilters(row.filters);
  const input = validateStatisticsPlayerInput({ playerId: row.player_id, ...filters });
  const config = decodeStatisticsConfig(row.config);
  if (!config.rating_aligned) return invalid();
  return {
    playerId: input.playerId,
    filters: input.filters,
    config,
    matches: decodeMatches(row.matches),
    typeRates: decodeTypeRates(row.typeRates),
    sets: decodeScore(row.sets),
    games: decodeGames(row.games),
    rating: decodeRating(row.rating),
    form: decodeForm(row.form),
    advanced: decodeAdvanced(row.advanced),
    activity: decodeActivity(row.activity),
    relationships: decodeRelationships(row.relationships)
  };
}
export async function readPlayerStatistics(
  client: PlayerClient,
  input: StatisticsPlayerInput
): Promise<StatisticsResponse<PlayerStatistics>> {
  const { data, error } = await client.rpc('get_player_statistics', {
    p_player_id: input.playerId,
    p_type: input.filters.type,
    ...(input.filters.communityId ? { p_community_id: input.filters.communityId } : {}),
    ...(input.filters.leagueId ? { p_league_id: input.filters.leagueId } : {}),
    ...(input.filters.from ? { p_from: input.filters.from } : {}),
    ...(input.filters.through ? { p_through: input.filters.through } : {})
  });
  if (error) return { status: 'error', code: statisticsErrorCode(error) };
  try {
    return { status: 'ok', value: decodePlayerStatistics(data) };
  } catch {
    return { status: 'error', code: 'INVALID_STATISTICS_RESPONSE' };
  }
}

const TRANSITION_STATUSES = ['ranked', 'unrated', 'not_member'] as const;
function boolOrNull(value: unknown): boolean | null {
  if (value === null) return null;
  return typeof value === 'boolean' ? value : invalid();
}
function decodeTransition(value: unknown): PlayerRankTransition {
  const data = object(value);
  const status = TRANSITION_STATUSES.find((entry) => entry === data.status) ?? invalid();
  const source =
    data.source === null
      ? null
      : data.source === 'ledger' || data.source === 'initialization'
        ? data.source
        : invalid();
  if (typeof data.complete !== 'boolean') return invalid();
  return {
    communityId: text(data.communityId),
    effectiveFrom: text(data.effectiveFrom),
    status,
    position: numberOrNull(data.position),
    level: numberOrNull(data.level),
    reliability: numberOrNull(data.reliability),
    established: boolOrNull(data.established),
    rankedMembers: numberOrNull(data.rankedMembers),
    complete: data.complete,
    ratingRevision: numberOrNull(data.ratingRevision),
    source
  };
}
function decodeLeaguePosition(value: unknown): PlayerLeaguePosition {
  const data = object(value);
  return {
    communityId: text(data.communityId),
    leagueId: text(data.leagueId),
    standingsVersion: count(data.standingsVersion),
    position: count(data.position),
    provenance: provenance(data.provenance),
    publishedAt: text(data.publishedAt)
  };
}
/** Only documented fields leave the decoder; raw RPC objects are never returned. */
export function decodePlayerRankHistory(value: unknown): PlayerRankHistoryPage {
  const row = object(value);
  if (typeof row.truncated !== 'boolean') return invalid();
  return {
    playerId: text(row.player_id),
    communityId: textOrNull(row.communityId),
    transitions: array(row.transitions).map(decodeTransition),
    truncated: row.truncated,
    leaguePositions: array(row.leaguePositions).map(decodeLeaguePosition)
  };
}
export async function readPlayerRankHistory(
  client: PlayerClient,
  input: StatisticsRankHistoryInput
): Promise<StatisticsResponse<PlayerRankHistoryPage>> {
  const { data, error } = await client.rpc('get_player_statistics_rank_history', {
    p_player_id: input.playerId,
    p_limit: input.limit,
    ...(input.communityId ? { p_community_id: input.communityId } : {})
  });
  if (error) return { status: 'error', code: statisticsErrorCode(error) };
  try {
    return { status: 'ok', value: decodePlayerRankHistory(data) };
  } catch {
    return { status: 'error', code: 'INVALID_STATISTICS_RESPONSE' };
  }
}
