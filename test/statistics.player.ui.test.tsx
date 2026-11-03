/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('gives the activity series a numeric textual equivalent', async () => {
    const { container } = render(wrap(<PlayerStatistics stats={makePlayerStatistics()} />));
    await userEvent.click(screen.getByRole('button', { name: 'Show data table' }));
    const table = screen.getByRole('table', { name: 'Matches played per month' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(within(rows[2]!).getByRole('cell').textContent).toContain('5');
    expect(within(rows[2]!).getByRole('rowheader').textContent).toContain('Feb 2030');
    const chart = container.querySelector('svg');
    expect(chart?.getAttribute('aria-hidden')).toBe('true');
    expect(chart?.querySelectorAll('rect')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Hide data table' })).toBeTruthy();
  });

  it('labels sampled charts and retains every month including zero', async () => {
    const base = makePlayerStatistics();
    const months = Array.from({ length: 14 }, (_, index) => ({
      period: index < 12 ? '2030-' + String(index + 1).padStart(2, '0') : '2031-0' + (index - 11),
      groups: index
    }));
    const { container } = render(
      wrap(<PlayerStatistics stats={{ ...base, activity: { ...base.activity, months } }} />)
    );
    expect(
      screen.getByText(
        'The chart shows the latest 12 of 14 periods; the data table contains all of them.'
      )
    ).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Show data table' }));
    const rows = within(
      screen.getByRole('table', { name: 'Matches played per month' })
    ).getAllByRole('row');
    expect(rows).toHaveLength(15);
    expect(container.querySelectorAll('svg rect')).toHaveLength(12);
    expect(rows.slice(1).map((row) => Number(within(row).getByRole('cell').textContent))).toEqual(
      months.map((month) => month.groups)
    );
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

describe('player statistics composition (Pencil RN0yw / RRuhH)', () => {
  const COMMUNITY = '33333333-3333-4333-8333-333333333333';
  const LEAGUE = '44444444-4444-4444-8444-444444444444';
  const scoped = makePlayerStatistics({
    filters: { communityId: COMMUNITY, leagueId: null, type: 'all', from: null, through: null }
  });
  const controls = (onApply: (next: unknown) => void) => ({
    options: {
      leagues: [{ id: LEAGUE, name: 'Spring', status: 'active' as const }],
      activeLeagueId: LEAGUE
    },
    onApply
  });
  const follows = (first: HTMLElement, second: HTMLElement) =>
    (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

  it('orders filters, highlights, form, then the detailed sections like the frames', () => {
    render(
      wrap(<PlayerStatistics stats={scoped} filterControls={controls(vi.fn<() => void>())} />)
    );
    const region = (name: string) => screen.getByRole('region', { name });
    const order = [
      'Statistics filters',
      'Highlights',
      'Form',
      'Matches',
      'Sets and games',
      'Rating and rank',
      'Matches per month'
    ].map(region);
    for (let index = 1; index < order.length; index += 1)
      expect(follows(order[index - 1]!, order[index]!)).toBe(true);
  });

  it('leads with the three highlight tiles and the W-L-D record', () => {
    render(wrap(<PlayerStatistics stats={makePlayerStatistics()} />));
    const highlights = screen.getByRole('region', { name: 'Highlights' });
    expect(
      within(highlights)
        .getAllByRole('term')
        .map((term) => term.textContent)
    ).toEqual(['Win rate', 'Set differential', 'Game differential']);
    expect(highlights.textContent).toContain('60%');
    expect(highlights.textContent).toContain('W–L–D record');
    expect(highlights.textContent).toContain('6 – 3 – 1');
    // Moved, never duplicated: each figure still has exactly one term on the page.
    expect(screen.getAllByText('Win rate', { selector: 'dt' })).toHaveLength(1);
  });

  it('shows the filter bar only when the page can apply filters', () => {
    const { rerender } = render(wrap(<PlayerStatistics stats={scoped} />));
    expect(screen.queryByRole('form', { name: 'Statistics filters' })).toBeNull();
    rerender(
      wrap(<PlayerStatistics stats={scoped} filterControls={controls(vi.fn<() => void>())} />)
    );
    expect(screen.getByRole('form', { name: 'Statistics filters' })).toBeTruthy();
    expect(screen.getByLabelText('League')).toBeTruthy();
    expect(screen.getByLabelText('From (UTC date)')).toBeTruthy();
  });

  it('applies the chosen League, type and dates through the page callback', async () => {
    const onApply = vi.fn<(next: unknown) => void>();
    render(wrap(<PlayerStatistics stats={scoped} filterControls={controls(onApply)} />));
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('League'), LEAGUE);
    await user.click(screen.getByRole('radio', { name: 'Competitive' }));
    await user.type(screen.getByLabelText('From (UTC date)'), '2030-01-01');
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));
    expect(onApply).toHaveBeenCalledWith({
      communityId: COMMUNITY,
      leagueId: LEAGUE,
      type: 'competitive',
      from: '2030-01-01',
      through: null
    });
  });

  it('hides the League field without a selected community and keeps the community on reset', async () => {
    const onApply = vi.fn<(next: unknown) => void>();
    const { rerender } = render(
      wrap(<PlayerStatistics stats={makePlayerStatistics()} filterControls={controls(onApply)} />)
    );
    expect(screen.queryByLabelText('League')).toBeNull();
    rerender(wrap(<PlayerStatistics stats={scoped} filterControls={controls(onApply)} />));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(onApply).toHaveBeenCalledWith({
      communityId: COMMUNITY,
      leagueId: null,
      type: 'all',
      from: null,
      through: null
    });
  });

  it('keeps title and subtitle together in their own block ahead of the filter badges', () => {
    render(wrap(<PlayerStatistics stats={makePlayerStatistics()} />));
    const title = screen.getByRole('heading', { level: 1 });
    const lead = title.parentElement!;
    expect(lead.tagName).toBe('DIV');
    expect(within(lead).getByText(en.statistics.player.subtitle)).toBeTruthy();
    expect(lead.contains(screen.getByRole('list', { name: 'Active filters' }))).toBe(false);
  });
});

describe('player statistics header and highlights geometry (390px / 320px)', () => {
  // The global language/theme chips float over the top-right corner: two 44px targets, the gap
  // between them and the page inset. The header lead must reserve that width at every viewport.
  const source = readFileSync('src/features/statistics/statistics-player.styles.ts', 'utf8');
  const TOUCH = 44;
  const GAP = 8;
  const INSET = 18;
  const reserved = TOUCH * 2 + GAP + GAP;

  it('reserves the floating controls width on the title and subtitle block', () => {
    expect(source).toMatch(
      /lead: \{[^}]*paddingInlineEnd: `calc\(\$\{TOUCH\} \* 2 \+ var\(--space-8\) \+ var\(--space-8\)\)`/s
    );
    expect(source).toContain("const TOUCH = 'calc(var(--space-40) + var(--space-4))'");
    expect(source).toContain("gap: 'var(--space-4)',\n    minWidth: 0,");
  });

  it.each([390, 320])('leaves a readable title column at %ipx', (viewport) => {
    const available = viewport - INSET * 2 - reserved;
    expect(available).toBeGreaterThanOrEqual(150);
  });

  it.each([
    [390, 3],
    [320, 2]
  ])('fits %ipx highlight tiles in %i columns without overflow', (viewport, columns) => {
    const minimum = Number(
      source.match(/hero: \{[^}]*minmax\(min\(100%, (\d+)px\), 1fr\)/s)?.[1] ?? Number.NaN
    );
    const content = viewport - INSET * 2;
    const fitted = Math.min(3, Math.floor((content + GAP) / (minimum + GAP)));
    expect(fitted).toBe(columns);
  });
});
