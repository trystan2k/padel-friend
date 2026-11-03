/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createI18n } from '../src/i18n/config';
import { PlayerStatistics } from '../src/features/statistics/PlayerStatistics';
import { makePlayerStatistics } from './helpers/player-statistics-fixtures';

// Coverage guard for PRD §§33–34: each listed metric is a field of the response contract and a
// visible label of the player surface, so none can be dropped silently.
type Row = readonly [bullet: string, path: string, label: string];

const SECTION_33: readonly Row[] = [
  ['matches played', 'matches.played', 'Matches played'],
  ['competitive matches', 'matches.competitive', 'Competitive matches'],
  ['friendly matches', 'matches.friendly', 'Friendly matches'],
  ['wins', 'matches.wins', 'Wins'],
  ['losses', 'matches.losses', 'Losses'],
  ['draws', 'matches.draws', 'Draws'],
  ['win percentage', 'matches.winRate', 'Win rate'],
  ['competitive win percentage', 'matches.competitiveWinRate', 'Competitive win rate'],
  ['friendly win percentage', 'matches.friendlyWinRate', 'Friendly win rate'],
  ['sets won', 'sets.won', 'Sets won'],
  ['sets lost', 'sets.lost', 'Sets lost'],
  ['set win percentage', 'sets.winRate', 'Set win rate'],
  ['set differential', 'sets.differential', 'Set differential'],
  ['games won', 'games.won', 'Games won'],
  ['games lost', 'games.lost', 'Games lost'],
  ['game win percentage', 'games.winRate', 'Game win rate'],
  ['game differential', 'games.differential', 'Game differential'],
  ['average games won per match', 'games.averageWonPerGroup', 'Games won per match'],
  ['average games conceded per match', 'games.averageConcededPerGroup', 'Games conceded per match'],
  ['current global level', 'rating.currentLevel', 'Current level'],
  ['reliability', 'rating.reliability', 'Reliability'],
  ['community skill rank', 'rating.communitySkillRank', 'Community skill rank'],
  ['active League position', 'rating.activeLeaguePosition', 'Active league position'],
  ['starting level', 'rating.startingLevel', 'Starting level'],
  ['highest level achieved', 'rating.highestLevel', 'Highest level'],
  [
    'lowest established level achieved',
    'rating.lowestEstablishedLevel',
    'Lowest established level'
  ],
  ['rating delta in selected period', 'rating.filteredDelta', 'Rating change in this period'],
  [
    'best community skill rank achieved',
    'rating.bestCommunitySkillRank',
    'Best community skill rank'
  ],
  ['best League position achieved', 'rating.bestLeaguePosition', 'Best league position'],
  ['last 5 match record', 'form.last5', 'Last 5 matches'],
  ['last 10 match record', 'form.last10', 'Last 10 matches'],
  ['current win/loss streak', 'form.current', 'Current streak'],
  ['longest win streak', 'form.longestWins', 'Longest win streak'],
  ['longest loss streak', 'form.longestLosses', 'Longest loss streak']
];

const SECTION_34: readonly Row[] = [
  ['straight-set wins', 'advanced.straightSetWins', 'Straight-set wins'],
  ['straight-set losses', 'advanced.straightSetLosses', 'Straight-set losses'],
  ['three-set matches', 'advanced.threeSetGroups', 'Three-set matches'],
  ['deciding-set wins', 'advanced.decidingSetWins', 'Deciding-set wins'],
  ['deciding-set losses', 'advanced.decidingSetLosses', 'Deciding-set losses'],
  ['deciding-set win percentage', 'advanced.decidingSetWinRate', 'Deciding-set win rate'],
  [
    'first-set win then match win percentage',
    'advanced.firstSetConversionRate',
    'Won first set, won match'
  ],
  [
    'first-set loss then comeback win percentage',
    'advanced.comebackWinRate',
    'Lost first set, won match'
  ],
  ['incomplete deciding sets', 'advanced.incompleteDeciders', 'Incomplete deciding sets'],
  ['cleanest win by game differential', 'advanced.cleanestWin', 'Cleanest win'],
  ['closest win', 'advanced.closestWin', 'Closest win'],
  ['biggest rating gain in one match', 'advanced.biggestGain', 'Biggest rating gain'],
  ['biggest rating loss in one match', 'advanced.biggestLoss', 'Biggest rating loss'],
  ['biggest upset win', 'advanced.strongestUpset', 'Biggest upset win'],
  ['toughest loss', 'advanced.toughestLoss', 'Toughest loss'],
  ['most active week', 'activity.mostActiveWeek', 'Most active week'],
  ['most active month', 'activity.mostActiveMonth', 'Most active month'],
  ['matches per month', 'activity.months', 'Matches played per month'],
  ['average matches per week', 'activity.weeklyAverage', 'Average matches per week'],
  ['unique partners', 'relationships.uniquePartners', 'Different partners'],
  ['unique opponents', 'relationships.uniqueOpponents', 'Different opponents'],
  ['most frequent partner', 'relationships.mostFrequentPartners', 'Most frequent partner'],
  ['most frequent opponent', 'relationships.mostFrequentOpponents', 'Most frequent opponent'],
  [
    'different player combinations',
    'relationships.uniqueQuartets',
    'Different player combinations'
  ],
  [
    'percentage of matches with the most frequent partner',
    'relationships.mostFrequentPartnerShare',
    'Matches with most frequent partner'
  ]
];

function resolve(source: unknown, path: string): unknown {
  let node = source;
  for (const key of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = Reflect.get(node, key);
  }
  return node;
}

const stats = makePlayerStatistics();
beforeAll(() => {
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <PlayerStatistics stats={stats} />
    </I18nextProvider>
  );
});
afterAll(cleanup);

describe.each([
  ['§33 player core statistics', SECTION_33],
  ['§34 advanced player statistics', SECTION_34]
])('%s', (_name, rows) => {
  it.each(rows)('%s is in the contract and on the surface', (_bullet, path, label) => {
    expect(resolve(stats, path)).not.toBeUndefined();
    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  });
});

describe('§34 optional court-side statistics', () => {
  it('are not fabricated while court side is not captured', () => {
    const serialized = JSON.stringify(stats).toLowerCase();
    expect(serialized).not.toMatch(/courtside|\bleft\b|\bright\b/);
  });
});
