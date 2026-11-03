import { describe, expect, it } from 'vitest';
import { decodeCommunityStatistics } from '../src/features/statistics/statistics-community.server';
import { makeCommunityStatistics } from './helpers/community-statistics-fixtures';

/** PRD §38 inventory; each insight must survive the transport decoder. */
describe('community statistics metric inventory', () => {
  const stats = decodeCommunityStatistics(makeCommunityStatistics());
  it.each([
    ['total matches', stats.matches.played],
    ['competitive matches', stats.matches.competitive],
    ['friendly matches', stats.matches.friendly],
    ['matches in active ranking', stats.rankingMatches],
    ['most active player', stats.mostActivePlayer],
    ['most wins', stats.mostWins],
    ['highest win percentage', stats.highestWinRate],
    ['minimum matches', stats.config.thresholds.community_leader_min_matches],
    ['best set differential', stats.bestSetDifferential],
    ['best game differential', stats.bestGameDifferential],
    ['most improved rating', stats.mostImproved],
    ['most frequent pair', stats.mostFrequentPair],
    ['most common matchup', stats.mostCommonMatchup],
    ['closest rivalry', stats.closestRivalry],
    ['active players', stats.activePlayers],
    ['weekly frequency', stats.weeks],
    ['monthly frequency', stats.months]
  ])('exposes %s', (_label, value) => {
    expect(value).toBeDefined();
  });
});
