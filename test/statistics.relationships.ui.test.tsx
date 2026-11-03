/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { createI18n } from '../src/i18n/config';
import en from '../src/locales/en/translation.json';
import es from '../src/locales/es/translation.json';
import ptBR from '../src/locales/pt-BR/translation.json';

type LinkProps = {
  children: ReactNode;
  to: string;
  params?: Record<string, string>;
  search?: Record<string, string>;
  'aria-label'?: string;
};
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params = {}, search = {}, 'aria-label': label }: LinkProps) => {
    const path = to.replace(/\$(\w+)/g, (_match, key: string) => params[key] ?? '');
    const query = new URLSearchParams(search).toString();
    return (
      <a href={query ? path + '?' + query : path} aria-label={label}>
        {children}
      </a>
    );
  }
}));
import { OpponentRecords } from '../src/features/statistics/OpponentRecords';
import { OpponentStatistics } from '../src/features/statistics/OpponentStatistics';
import { PairStatistics } from '../src/features/statistics/PairStatistics';
import { PartnerRecords } from '../src/features/statistics/PartnerRecords';
import { insufficient, ready } from './helpers/player-statistics-fixtures';
import {
  EVENT,
  FOCAL,
  GROUP,
  OTHER,
  makeOpponent,
  makeOpponentRecords,
  makePair,
  makePartnerRecords,
  makeRelationshipRecord
} from './helpers/relationship-statistics-fixtures';

afterEach(cleanup);
const wrap = (node: ReactNode, locale: 'en' | 'pt-BR' | 'es' = 'en') => (
  <I18nextProvider i18n={createI18n(locale)}>{node}</I18nextProvider>
);
function figure(label: string): HTMLElement {
  const term = screen.getByText(label, { selector: 'dt' });
  const value = term.nextElementSibling;
  if (!(value instanceof HTMLElement)) throw new Error('missing description for ' + label);
  return value;
}

describe('PairStatistics', () => {
  it('shows the record, scores, streaks, opponent level sample and Leagues', () => {
    render(wrap(<PairStatistics pair={makePair()} />));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Ana & Bea');
    expect(figure('Matches together').textContent).toContain('7');
    expect(figure('Win rate').textContent).toContain('50%');
    expect(figure('Win rate').textContent).toContain('3 of 6 matches');
    expect(figure('Incomplete results').textContent).toContain('1');
    expect(figure('Set differential').textContent).toContain('+3');
    expect(figure('Game differential').textContent).toContain('+12');
    expect(figure('Current streak').textContent).toContain('2');
    expect(figure('Longest win streak').textContent).toContain('3');
    expect(figure('Average opponent level').textContent).toContain('3.80');
    expect(figure('Average opponent level').textContent).toContain('Based on 5 rated matches');
    expect(figure('Competitive matches').textContent).toContain('5');
    expect(figure('Friendly matches').textContent).toContain('2');
    expect(screen.getByText('Spring League: 2 matches')).toBeTruthy();
  });

  it('links the biggest upset to its confirmed match and keeps focal context on the way back', () => {
    render(
      wrap(
        <PairStatistics
          pair={makePair({
            filters: {
              communityId: OTHER,
              leagueId: null,
              type: 'competitive',
              from: null,
              through: null
            }
          })}
        />
      )
    );
    const upset = figure('Biggest upset win');
    expect(upset.textContent).toContain('30% expected');
    expect(within(upset).getByRole('link', { name: 'View match' }).getAttribute('href')).toBe(
      '/matches/' + EVENT + '/groups/' + GROUP
    );
    const back = screen.getByRole('link', { name: 'Back to player statistics' });
    expect(back.getAttribute('href')).toBe(
      '/players/' + FOCAL + '?communityId=' + OTHER + '&type=competitive'
    );
    const crumbs = within(screen.getByRole('navigation', { name: 'Statistics navigation' }));
    expect(crumbs.getByRole('link', { name: 'Player statistics' }).getAttribute('href')).toBe(
      back.getAttribute('href')
    );
    expect(crumbs.getByText('Partnership').getAttribute('aria-current')).toBe('page');
  });

  it('explains a one-match pair as visible but not yet eligible for a best claim', () => {
    const record = makeRelationshipRecord({
      matches: {
        played: 1,
        competitive: 1,
        friendly: 0,
        wins: 1,
        losses: 0,
        draws: 0,
        incomplete: 0,
        winRate: ready(1, 1, 1)
      },
      leaderEligibility: insufficient('minimum_matches', 1, 5)
    });
    render(wrap(<PairStatistics pair={makePair({ record })} />));
    expect(figure('Win rate').textContent).toContain('100%');
    expect(
      screen.getByText('Not yet in the best-partner ranking: 1 of 5 decided matches together.')
    ).toBeTruthy();
  });

  it('shows missing opponent-level evidence as a reason, never a fake level', () => {
    const record = makeRelationshipRecord({
      averageOpponentLevel: insufficient('missing_evidence'),
      biggestUpset: insufficient('no_applicable_result'),
      leagues: []
    });
    render(wrap(<PairStatistics pair={makePair({ record, recent: [] })} />));
    const level = figure('Average opponent level');
    expect(level.textContent).toContain('Not available');
    expect(level.textContent).toContain('The rating evidence needed for this is not available.');
    expect(figure('Biggest upset win').textContent).toContain(
      'No matching result in this selection.'
    );
    expect(screen.getByText('No league matches together in this selection.')).toBeTruthy();
    expect(screen.getByText('No matches in this selection.')).toBeTruthy();
  });

  it('lists recent matches with result text, scores and a labelled link', () => {
    render(wrap(<PairStatistics pair={makePair()} />));
    const table = screen.getByRole('table', { name: 'Most recent matches, newest first' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('Win')).toBeTruthy();
    expect(within(rows[1]!).getByText('Incomplete')).toBeTruthy();
    expect(within(rows[0]!).getByText('2–1')).toBeTruthy();
    expect(within(rows[0]!).getByText('14–11')).toBeTruthy();
    expect(within(table).queryByRole('columnheader', { name: 'Rating change' })).toBeNull();
  });
});

describe('OpponentStatistics', () => {
  it('shows the head-to-head from the focal point of view with rating effects', () => {
    render(wrap(<OpponentStatistics opponent={makeOpponent()} />));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Ana vs Cleo');
    expect(figure('Meetings').textContent).toContain('7');
    expect(figure('Toughest loss').textContent).toContain('80% expected');
    expect(figure('Biggest rating gain').textContent).toContain('+0.4');
    expect(figure('Biggest rating loss').textContent).toContain('-0.3');
    const table = screen.getByRole('table');
    const cells = within(table).getAllByRole('row').slice(1);
    expect(within(cells[0]!).getByText('-0.2')).toBeTruthy();
    expect(within(cells[1]!).getByText('+0.3')).toBeTruthy();
    expect(within(cells[2]!).getByText('No rating')).toBeTruthy();
    expect(screen.queryByText('Average opponent level')).toBeNull();
  });

  it('explains an opponent record that is not yet eligible for a leader claim', () => {
    const record = makeRelationshipRecord({
      leaderEligibility: insufficient('minimum_matches', 2, 5)
    });
    render(wrap(<OpponentStatistics opponent={makeOpponent({ record })} />));
    expect(
      screen.getByText('Not yet in the opponent rankings: 2 of 5 decided meetings.')
    ).toBeTruthy();
  });

  it('renders the meetings of a never-faced pair as a true empty state', () => {
    render(wrap(<OpponentStatistics opponent={makeOpponent({ recent: [] })} />));
    expect(screen.getByText('No matches in this selection.')).toBeTruthy();
  });
});

describe('PartnerRecords', () => {
  it('lists every partner with a link that keeps the focal player and filters', () => {
    const records = makePartnerRecords({
      filters: {
        communityId: OTHER,
        leagueId: null,
        type: 'all',
        from: '2030-01-01',
        through: null
      }
    });
    render(wrap(<PartnerRecords response={{ status: 'ok', value: records }} />));
    const table = screen.getByRole('table', { name: 'Partners, most matches together first' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByRole('rowheader').textContent).toBe('Bea');
    expect(within(rows[1]!).getByRole('rowheader').textContent).toBe('Unknown player');
    expect(
      within(rows[0]!).getByRole('link', { name: 'View partnership with Bea' }).getAttribute('href')
    ).toBe(
      '/players/' + FOCAL + '/partners/' + OTHER + '?communityId=' + OTHER + '&from=2030-01-01'
    );
    expect(figure('Most frequent partner').textContent).toContain('Bea');
    expect(figure('Best partner').textContent).toContain('66.7% win rate in 6 decided matches');
  });

  it('keeps the record visible but makes no best claim below the threshold', () => {
    const records = makePartnerRecords({ best: insufficient('minimum_matches', 1, 5) });
    render(wrap(<PartnerRecords response={{ status: 'ok', value: records }} />));
    const best = figure('Best partner');
    expect(best.textContent).toContain('Not available');
    expect(best.textContent).toContain('Shown after 5 matches; 1 so far.');
    expect(screen.getAllByRole('row')).toHaveLength(3);
  });

  it('names every tied leader and says how many are tied', () => {
    const records = makePartnerRecords({
      mostFrequent: ready({
        groups: 4,
        players: [
          { userId: OTHER, displayName: 'Bea' },
          { userId: GROUP, displayName: 'Eli' }
        ]
      })
    });
    render(wrap(<PartnerRecords response={{ status: 'ok', value: records }} />));
    const top = figure('Most frequent partner');
    expect(top.textContent).toContain('Bea and Eli');
    expect(top.textContent).toContain('Tied with 2 players');
  });

  it('shows the empty and the truncated states, and a typed error instead of an empty list', () => {
    const { rerender } = render(
      wrap(
        <PartnerRecords
          response={{
            status: 'ok',
            value: makePartnerRecords({
              total: 0,
              items: [],
              mostFrequent: insufficient('no_applicable_result'),
              best: insufficient('minimum_matches', 0, 5)
            })
          }}
        />
      )
    );
    expect(screen.getByText('No partners in this selection.')).toBeTruthy();
    rerender(
      wrap(<PartnerRecords response={{ status: 'ok', value: makePartnerRecords({ total: 31 }) }} />)
    );
    expect(screen.getByText('Showing 2 of 31')).toBeTruthy();
    rerender(
      wrap(<PartnerRecords response={{ status: 'error', code: 'STATISTICS_UNAVAILABLE' }} />)
    );
    expect(screen.getByRole('alert').textContent).toBe(en.statistics.errors.STATISTICS_UNAVAILABLE);
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('OpponentRecords', () => {
  it('shows leaders with their definitions and head-to-head links', () => {
    render(wrap(<OpponentRecords response={{ status: 'ok', value: makeOpponentRecords() }} />));
    expect(figure('Best record against').textContent).toContain('Cleo');
    expect(figure('Closest rivalry').textContent).toContain('Gap of 1 in 5 decided meetings');
    expect(figure('Closest rivalry').textContent).toContain(
      'Smallest gap between wins and losses among opponents with at least 5 decided meetings; more meetings break ties.'
    );
    expect(figure('Toughest opponent').textContent).toContain('Shown after 5 matches; 2 so far.');
    const row = screen.getAllByRole('row')[1]!;
    expect(
      within(row).getByRole('link', { name: 'View head to head against Cleo' }).getAttribute('href')
    ).toBe('/players/' + FOCAL + '/opponents/' + OTHER);
  });

  it('renders a typed error', () => {
    render(wrap(<OpponentRecords response={{ status: 'error', code: 'STATISTICS_NOT_FOUND' }} />));
    expect(screen.getByRole('alert').textContent).toBe(en.statistics.errors.STATISTICS_NOT_FOUND);
  });
});

describe('PairStatistics composition (Pencil GrkSH)', () => {
  const controls = (onApply: (next: unknown) => void) => ({
    options: { leagues: [], activeLeagueId: null },
    onApply
  });

  it('leads with the compact headline record, streak and last meeting', () => {
    render(wrap(<PairStatistics pair={makePair()} />));
    const summary = screen.getAllByRole('region', { name: 'Record' })[0]!;
    expect(summary.textContent).toContain('7 together · W 3 · L 2 · D 1');
    expect(summary.textContent).toContain('Current streak: 2 · Wins in a row');
    expect(summary.textContent).toContain('Last played together 10 Feb 2030');
  });

  it('states a pair without meetings or streak instead of an empty headline', () => {
    render(
      wrap(
        <PairStatistics
          pair={makePair({
            recent: [],
            record: makeRelationshipRecord({
              streaks: { current: { kind: null, length: 0 }, longestWins: 0, longestLosses: 0 }
            })
          })}
        />
      )
    );
    const summary = screen.getAllByRole('region', { name: 'Record' })[0]!;
    expect(summary.textContent).toContain('Current streak: none');
    expect(summary.textContent).toContain('No matches together yet');
  });

  it('orders summary, record, scores, streaks, rating, Leagues, then recent meetings', () => {
    render(
      wrap(<PairStatistics pair={makePair()} filterControls={controls(vi.fn<() => void>())} />)
    );
    const names = [
      'Statistics filters',
      'Record',
      'Sets and games',
      'Streaks',
      'Rating evidence',
      'Leagues played together',
      'Recent matches'
    ];
    const regions = names.map((name) => screen.getAllByRole('region', { name })[0]!);
    for (let index = 1; index < regions.length; index += 1)
      expect(
        regions[index - 1]!.compareDocumentPosition(regions[index]!) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    expect(screen.getByText('Spring League: 2 matches')).toBeTruthy();
  });

  it.each(['pair', 'opponent'] as const)(
    'applies the %s filters through the page callback',
    async (kind) => {
      const onApply = vi.fn<(next: unknown) => void>();
      const filterControls = controls(onApply);
      const node =
        kind === 'pair' ? (
          <PairStatistics pair={makePair()} filterControls={filterControls} />
        ) : (
          <OpponentStatistics opponent={makeOpponent()} filterControls={filterControls} />
        );
      render(wrap(node));
      const user = userEvent.setup();
      await user.click(screen.getByRole('radio', { name: 'Friendly' }));
      await user.click(screen.getByRole('button', { name: 'Apply filters' }));
      expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ type: 'friendly' }));
    }
  );

  it('renders the headline in Portuguese and Spanish', () => {
    const { unmount } = render(wrap(<PairStatistics pair={makePair()} />, 'pt-BR'));
    expect(screen.getByText('7 juntos · V 3 · D 2 · E 1')).toBeTruthy();
    unmount();
    render(wrap(<PairStatistics pair={makePair()} />, 'es'));
    expect(screen.getByText('7 juntos · G 3 · P 2 · E 1')).toBeTruthy();
  });
});

describe('relationship copy', () => {
  function leaves(node: unknown, path = ''): Map<string, string> {
    const found = new Map<string, string>();
    if (typeof node === 'string') return found.set(path, node);
    if (typeof node === 'object' && node !== null)
      for (const [key, value] of Object.entries(node))
        for (const [p, v] of leaves(value, path ? path + '.' + key : key)) found.set(p, v);
    return found;
  }
  it('has the same keys and interpolation variables in every locale', () => {
    const source = leaves(en.statistics.relationships);
    const variables = (text: string) =>
      [...text.matchAll(/{{(\w+)}}/g)].map((m) => String(m[1])).sort((x, y) => x.localeCompare(y));
    for (const locale of [ptBR, es]) {
      const other = leaves(locale.statistics.relationships);
      expect([...other.keys()].sort()).toEqual([...source.keys()].sort());
      for (const [key, text] of source)
        expect(variables(other.get(key) ?? '')).toEqual(variables(text));
    }
  });
  it('renders the pair in Portuguese and Spanish', () => {
    const { unmount } = render(wrap(<PairStatistics pair={makePair()} />, 'pt-BR'));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Ana e Bea');
    expect(screen.getByText('Partidas juntos', { selector: 'dt' })).toBeTruthy();
    unmount();
    render(wrap(<OpponentStatistics opponent={makeOpponent()} />, 'es'));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Ana contra Cleo');
    expect(screen.getByText('Enfrentamientos', { selector: 'dt' })).toBeTruthy();
  });
});
