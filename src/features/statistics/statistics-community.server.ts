import type { PlayerClient } from '../player/player.server';
import { decodeStatisticsConfig } from './statistics-decoders';
import type { StatisticsConfig } from './statistics-contracts';
import type {
  CommunityFrequent,
  CommunityLeader,
  CommunityPairing,
  CommunityRivalry,
  CommunityStatistics
} from './statistics-community-contracts';
import { statisticsErrorCode, type StatisticsResponse } from './statistics-history-contracts';
import {
  array,
  count,
  finite,
  invalid,
  metric,
  metricOf,
  object,
  text,
  textOrNull
} from './statistics-player.server';
import type { RelationshipName } from './statistics-relationship-contracts';
import { validateStatisticsFilters } from './statistics.validators';
import type { StatisticsFilters } from './statistics-contracts';

function decodeName(value: unknown): RelationshipName {
  const data = object(value);
  return { userId: text(data.userId), displayName: textOrNull(data.displayName) };
}
function decodeLeader(value: unknown): CommunityLeader {
  const data = object(value);
  const players = array(data.players).map(decodeName);
  const total = count(data.total);
  if (players.length === 0 || players.length > total) return invalid();
  return { value: finite(data.value), total, players };
}
function decodePairing(value: unknown): CommunityPairing {
  const data = object(value);
  return {
    id: text(data.id),
    teams: array(data.teams).map((team) => array(team).map(decodeName))
  };
}
function decodeFrequent(value: unknown): CommunityFrequent {
  const data = object(value);
  const items = array(data.items).map(decodePairing);
  const total = count(data.total);
  if (items.length === 0 || items.length > total) return invalid();
  return { groups: count(data.groups), total, items };
}
function decodeRivalry(value: unknown): CommunityRivalry {
  const data = object(value);
  return {
    imbalance: count(data.imbalance),
    resolved: count(data.resolved),
    total: count(data.total),
    relationships: array(data.relationships).map((item) => {
      const row = object(item);
      return {
        first: decodeName(row.first),
        second: decodeName(row.second),
        wins: count(row.wins),
        losses: count(row.losses),
        draws: count(row.draws)
      };
    })
  };
}
const leader = (value: unknown) => metricOf(value, decodeLeader);
const status = (value: unknown, allowed: readonly string[]) =>
  typeof value === 'string' && allowed.includes(value) ? value : invalid();

/** Whitelist decoder: unknown shapes and inconsistent partitions are rejected, never rendered. */
export function decodeCommunityStatistics(value: unknown): CommunityStatistics {
  const row = object(value);
  const matches = object(row.matches);
  const totals = object(row.totals);
  const window = object(row.window);
  const league = row.league === null ? null : object(row.league);
  const config: StatisticsConfig = decodeStatisticsConfig(row.config);
  const played = count(matches.played);
  const decided = count(matches.decided);
  const draws = count(matches.draws);
  const incomplete = count(matches.incomplete);
  const competitive = count(matches.competitive);
  const friendly = count(matches.friendly);
  if (decided + draws + incomplete !== played || competitive + friendly !== played)
    return invalid();
  const notice =
    row.notice === null ? null : row.notice === 'friendly_league' ? row.notice : invalid();
  return {
    config,
    filters: validateStatisticsFilters(row.filters),
    notice,
    communities: array(row.communities).map((item) => {
      const data = object(item);
      return { id: text(data.id), name: text(data.name) };
    }),
    leagues: array(row.leagues).map((item) => {
      const data = object(item);
      const state = status(data.status, ['active', 'closed']);
      return {
        id: text(data.id),
        name: text(data.name),
        status: state === 'active' ? 'active' : 'closed'
      };
    }),
    activeLeagueId: textOrNull(row.activeLeagueId),
    league:
      league === null
        ? null
        : {
            id: text(league.id),
            name: text(league.name),
            status: (() => {
              const state = status(league.status, ['upcoming', 'active', 'closed']);
              return state === 'upcoming' ? 'upcoming' : state === 'active' ? 'active' : 'closed';
            })()
          },
    matches: { played, competitive, friendly, decided, draws, incomplete },
    totals: { sets: count(totals.sets), games: count(totals.games) },
    rankingMatches: metricOf(row.rankingMatches, (item) => {
      const data = object(item);
      return { groups: count(data.groups), leagues: count(data.leagues) };
    }),
    activePlayers: count(row.activePlayers),
    mostActivePlayer: leader(row.mostActivePlayer),
    mostWins: leader(row.mostWins),
    highestWinRate: leader(row.highestWinRate),
    bestSetDifferential: leader(row.bestSetDifferential),
    bestGameDifferential: leader(row.bestGameDifferential),
    mostImproved: leader(row.mostImproved),
    mostFrequentPair: metricOf(row.mostFrequentPair, decodeFrequent),
    mostCommonMatchup: metricOf(row.mostCommonMatchup, decodeFrequent),
    closestRivalry: metricOf(row.closestRivalry, decodeRivalry),
    window: {
      from: textOrNull(window.from),
      through: textOrNull(window.through),
      elapsedDays: count(window.elapsedDays)
    },
    averageMatchesPerWeek: metric(row.averageMatchesPerWeek),
    weeks: array(row.weeks).map((item) => {
      const data = object(item);
      return { start: text(data.start), groups: count(data.groups) };
    }),
    months: array(row.months).map((item) => {
      const data = object(item);
      return { month: text(data.month), groups: count(data.groups) };
    })
  };
}

export async function readCommunityStatistics(
  client: PlayerClient,
  input: { filters: StatisticsFilters }
): Promise<StatisticsResponse<CommunityStatistics>> {
  const { filters } = input;
  const { data, error } = await client.rpc('get_community_statistics', {
    p_type: filters.type,
    ...(filters.communityId ? { p_community_id: filters.communityId } : {}),
    ...(filters.leagueId ? { p_league_id: filters.leagueId } : {}),
    ...(filters.from ? { p_from: filters.from } : {}),
    ...(filters.through ? { p_through: filters.through } : {})
  });
  if (error) return { status: 'error', code: statisticsErrorCode(error) };
  try {
    return { status: 'ok', value: decodeCommunityStatistics(data) };
  } catch {
    return { status: 'error', code: 'INVALID_STATISTICS_RESPONSE' };
  }
}
