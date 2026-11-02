/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { createI18n } from '../src/i18n/config';
import en from '../src/locales/en/translation.json';
import { PlayerStatistics } from '../src/features/statistics/PlayerStatistics';
import {
  insufficient,
  makePlayerStatistics,
  rank,
  rankHistory,
  ready
} from './helpers/player-statistics-fixtures';

afterEach(cleanup);
const wrap = (node: ReactNode, locale: 'en' | 'pt-BR' | 'es' = 'en') => (
  <I18nextProvider i18n={createI18n(locale)}>{node}</I18nextProvider>
);

/** The description paired with a term, so a label and its value are asserted together. */
function figure(label: string): HTMLElement {
  const term = screen.getByText(label, { selector: 'dt' });
  const value = term.nextElementSibling;
  if (!(value instanceof HTMLElement)) throw new Error('missing description for ' + label);
  return value;
}

function resolve(source: unknown, path: string): unknown {
  let node = source;
  for (const key of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = Reflect.get(node, key);
  }
  return node;
}

describe('player statistics core surface', () => {
  it('renders values with labeled denominators', () => {
    render(wrap(<PlayerStatistics stats={makePlayerStatistics()} />));
    expect(figure('Matches played').textContent).toContain('12');
    expect(figure('Win rate').textContent).toContain('60%');
    expect(figure('Win rate').textContent).toContain('6 of 10 matches');
    expect(figure('Set win rate').textContent).toContain('16 of 30 sets');
    expect(figure('Game win rate').textContent).toContain('90 of 170 games');
    expect(figure('Set differential').textContent).toContain('+2');
    expect(figure('Game differential').textContent).toContain('+10');
    expect(figure('Current level').textContent).toContain('3.50');
    expect(figure('Reliability').textContent).toContain('70%');
    expect(figure('Rating change in this period').textContent).toContain('+0.25');
    expect(figure('Rating change in this period').textContent).toContain('9 rated matches');
  });

  it('shows form with its sample size, outcomes and streaks', () => {
    render(wrap(<PlayerStatistics stats={makePlayerStatistics()} />));
    const last5 = figure('Last 5 matches');
    expect(last5.textContent).toContain('1W 1L 1D');
    expect(last5.textContent).toContain('Based on 3 of the last 5 matches');
    expect(within(last5).getByRole('list', { name: 'Results, oldest first' })).toBeTruthy();
    expect(figure('Current streak').textContent).toContain('2');
    expect(figure('Current streak').textContent).toContain('Wins in a row');
    expect(figure('Longest loss streak').textContent).toContain('2');
  });

  it('explains insufficient states instead of showing a fake zero', () => {
    const stats = makePlayerStatistics({
      matches: {
        ...makePlayerStatistics().matches,
        played: 0,
        winRate: insufficient('no_denominator')
      },
      form: {
        ...makePlayerStatistics().form,
        last5: insufficient('minimum_matches', 0, 1),
        current: { kind: null, length: 0 }
      }
    });
    render(wrap(<PlayerStatistics stats={stats} />));
    expect(figure('Win rate').textContent).toContain('Not available');
    expect(figure('Win rate').textContent).toContain('Not enough matches yet to calculate this.');
    expect(figure('Win rate').textContent).not.toContain('0%');
    expect(figure('Last 5 matches').textContent).toContain('Shown after 1 matches; 0 so far.');
    expect(figure('Current streak').textContent).toContain('None');
    expect(figure('Lowest established level').textContent).toContain(
      'Not established yet: the rating needs more evidence.'
    );
    expect(figure('Active league position').textContent).toContain(
      'Not in an active league for this selection.'
    );
    expect(figure('Lost first set, won match').textContent).toContain(
      'Shown after 3 opportunities; 1 so far.'
    );
  });

  it('renders rank provenance and the coverage boundary', () => {
    const stats = makePlayerStatistics({
      rating: {
        ...makePlayerStatistics().rating,
        communitySkillRank: ready(rank(4, 'reconstructed')),
        activeLeaguePosition: insufficient('rank_coverage_boundary'),
        bestCommunitySkillRank: rankHistory({
          coverageComplete: false,
          coverageFrom: '2030-02-01T00:00:00Z',
          coverageReason: 'missing_rating_evidence'
        }),
        bestLeaguePosition: rankHistory({
          best: ready({ ...rank(1, 'published'), leagueId: 'l', standingsVersion: 2 }),
          coverageComplete: false,
          coverageFrom: null,
          coverageReason: 'unpublished_league'
        })
      }
    });
    render(wrap(<PlayerStatistics stats={stats} />));
    expect(figure('Community skill rank').textContent).toContain('#4');
    expect(figure('Community skill rank').textContent).toContain(
      'Reconstructed from rating history'
    );
    expect(figure('Active league position').textContent).toContain(
      'Rank history only covers part of this period.'
    );
    const best = figure('Best community skill rank');
    expect(best.textContent).toContain('#2');
    expect(best.textContent).toContain('History is only complete from');
    expect(best.textContent).toContain('Some rating evidence is missing.');
    const league = figure('Best league position');
    expect(league.textContent).toContain('Published standing');
    expect(league.textContent).toContain('No complete history is available yet.');
    expect(league.textContent).toContain('Some league standings were never published.');
  });

  it('gives the activity series a numeric textual equivalent', () => {
    const { container } = render(wrap(<PlayerStatistics stats={makePlayerStatistics()} />));
    const table = screen.getByRole('table', { name: 'Matches played per month' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(within(rows[2]!).getByRole('cell').textContent).toContain('5');
    expect(within(rows[2]!).getByRole('rowheader').textContent).toContain('Feb 2030');
    const chart = container.querySelector('svg');
    expect(chart?.getAttribute('aria-hidden')).toBe('true');
    expect(chart?.querySelectorAll('rect')).toHaveLength(3);
  });

  it('explains an empty activity series', () => {
    const base = makePlayerStatistics();
    render(
      wrap(<PlayerStatistics stats={{ ...base, activity: { ...base.activity, months: [] } }} />)
    );
    expect(screen.getByText('No matches in this selection yet.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows the filter context and the rating-lag notice', () => {
    const base = makePlayerStatistics();
    render(
      wrap(
        <PlayerStatistics
          stats={{
            ...base,
            filters: {
              communityId: 'c',
              leagueId: null,
              type: 'competitive',
              from: '2030-01-01',
              through: '2030-03-31'
            },
            config: { ...base.config, rating_aligned: false }
          }}
        />
      )
    );
    const filters = screen.getByRole('list', { name: 'Active filters' });
    expect(within(filters).getByText('One community')).toBeTruthy();
    expect(within(filters).getByText('Competitive')).toBeTruthy();
    expect(within(filters).getByText(/1 Jan 2030 to 31 Mar 2030/)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Rating figures are catching up');
  });

  it('names every section and uses the page heading', () => {
    render(wrap(<PlayerStatistics stats={makePlayerStatistics()} />));
    expect(screen.getByRole('heading', { level: 1, name: 'Player statistics' })).toBeTruthy();
    for (const name of [
      'Matches',
      'Sets and games',
      'Rating and rank',
      'Form',
      'Matches per month',
      'Set patterns',
      'Records',
      'Activity peaks',
      'Partners and opponents'
    ])
      expect(screen.getByRole('region', { name })).toBeTruthy();
  });
});

describe('player statistics localization', () => {
  it.each([
    ['pt-BR', 'Partidas jogadas', 'Taxa de vitórias', '6 de 10 partidas'],
    ['es', 'Partidos jugados', 'Porcentaje de victorias', '6 de 10 partidos']
  ] as const)('renders %s copy', (locale, played, winRate, denominator) => {
    render(wrap(<PlayerStatistics stats={makePlayerStatistics()} />, locale));
    expect(figure(played).textContent).toContain('12');
    expect(figure(winRate).textContent).toContain(denominator);
    expect(screen.queryByText('Win rate')).toBeNull();
  });

  it('only uses translation keys that exist', () => {
    const keys = ['PlayerStatistics', 'PlayerStatisticsRecords', 'PlayerMetric']
      .flatMap((file) => {
        const source = readFileSync('src/features/statistics/' + file + '.tsx', 'utf8');
        return [...source.matchAll(/['`](statistics\.player\.[\w.]+)['`]/g)].map((m) => m[1]!);
      })
      .filter((key) => !key.endsWith('.'));
    expect(keys.length).toBeGreaterThan(60);
    expect(keys.filter((key) => typeof resolve(en, key) !== 'string')).toEqual([]);
  });
});
