/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
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
};
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params = {}, search = {} }: LinkProps) => {
    const path = to.replace(/\$(\w+)/g, (_match, key: string) => params[key] ?? '');
    const query = new URLSearchParams(search).toString();
    return <a href={query ? path + '?' + query : path}>{children}</a>;
  }
}));
import { CommunityStatistics } from '../src/features/statistics/CommunityStatistics';
import { insufficient, ready } from './helpers/player-statistics-fixtures';
import {
  ANA,
  BEA,
  COMMUNITY,
  LEAGUE,
  emptyCommunityStatistics,
  makeCommunityStatistics,
  name
} from './helpers/community-statistics-fixtures';

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

describe('CommunityStatistics', () => {
  it('shows every PRD 38 insight with its evidence', () => {
    render(
      wrap(
        <CommunityStatistics
          stats={makeCommunityStatistics()}
          onApply={vi.fn<
            (
              filters: import('../src/features/statistics/statistics-contracts').StatisticsFilters
            ) => void
          >()}
        />
      )
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Padel Club statistics');
    expect(figure('Matches played').textContent).toContain('10');
    expect(figure('Competitive').textContent).toContain('7');
    expect(figure('Friendly').textContent).toContain('3');
    expect(figure('With a winner').textContent).toContain('6');
    expect(figure('Draws').textContent).toContain('3');
    expect(figure('Incomplete').textContent).toContain('1');
    expect(figure('Matches in the active ranking').textContent).toContain('4');
    expect(figure('Active players').textContent).toContain('4');
    expect(figure('Active players').textContent).toContain('not the member count');
    expect(figure('Most active player').textContent).toContain('Ana');
    expect(figure('Most active player').textContent).toContain('10 matches');
    expect(figure('Most wins').textContent).toContain('Bea');
    expect(figure('Highest win rate').textContent).toContain('75%');
    expect(figure('Highest win rate').textContent).toContain('Ana');
    expect(figure('Highest win rate').textContent).toContain('Tied: 2 players');
    expect(figure('Best set difference').textContent).toContain('+4');
    expect(figure('Best game difference').textContent).toContain('+18');
    expect(figure('Most improved rating').textContent).toContain('+0.42');
    expect(figure('Most frequent pair').textContent).toContain('Ana and Bea');
    expect(figure('Most frequent pair').textContent).toContain('6 matches');
    expect(figure('Most common matchup').textContent).toContain('Ana and Bea versus Cal and');
    expect(figure('Most common matchup').textContent).toContain('Unknown player');
    expect(figure('Closest rivalry').textContent).toContain('Ana and Cal: 3-3-0');
    expect(figure('Closest rivalry').textContent).toContain('Gap of 0 across 6 decided meetings');
    expect(figure('Average matches per week').textContent).toContain('1.67');
  });

  it('shows frequency as real tables with zero buckets and scoped headers', () => {
    render(
      wrap(
        <CommunityStatistics
          stats={makeCommunityStatistics()}
          onApply={vi.fn<
            (
              filters: import('../src/features/statistics/statistics-contracts').StatisticsFilters
            ) => void
          >()}
        />
      )
    );
    const weeks = screen.getByRole('table', { name: /Matches per week/ });
    const rows = within(weeks).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(within(rows[2]!).getByRole('rowheader').textContent).toContain('2030');
    expect(within(rows[2]!).getByRole('cell').textContent).toBe('0');
    expect(screen.getByRole('table', { name: /Matches per month/ })).toBeTruthy();
  });

  it('links leaders to the same scope only when one community is selected', () => {
    const { rerender } = render(
      wrap(
        <CommunityStatistics
          stats={makeCommunityStatistics()}
          onApply={vi.fn<
            (
              filters: import('../src/features/statistics/statistics-contracts').StatisticsFilters
            ) => void
          >()}
        />
      )
    );
    const link = screen.getAllByRole('link', { name: 'Ana' })[0]!;
    expect(link.getAttribute('href')).toBe('/players/' + ANA + '?communityId=' + COMMUNITY);
    rerender(
      wrap(
        <CommunityStatistics
          stats={makeCommunityStatistics({
            filters: { communityId: null, leagueId: null, type: 'all', from: null, through: null }
          })}
          onApply={vi.fn<
            (
              filters: import('../src/features/statistics/statistics-contracts').StatisticsFilters
            ) => void
          >()}
        />
      )
    );
    expect(screen.queryAllByRole('link', { name: 'Ana' })).toHaveLength(0);
  });

  it('explains empty selections and typed insufficient leaders, never a fake zero', () => {
    render(
      wrap(
        <CommunityStatistics
          stats={emptyCommunityStatistics()}
          onApply={vi.fn<
            (
              filters: import('../src/features/statistics/statistics-contracts').StatisticsFilters
            ) => void
          >()}
        />
      )
    );
    expect(screen.getByText('No confirmed matches in this selection yet.')).toBeTruthy();
    expect(figure('Most wins').textContent).toContain('No matching result in this selection.');
    expect(figure('Highest win rate').textContent).not.toContain('0%');
    expect(figure('Matches in the active ranking').textContent).toContain(
      'Not in an active league for this selection.'
    );
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('explains Friendly + League as an empty selection, without type coercion', () => {
    render(
      wrap(
        <CommunityStatistics
          stats={emptyCommunityStatistics({
            notice: 'friendly_league',
            filters: {
              communityId: COMMUNITY,
              leagueId: LEAGUE,
              type: 'friendly',
              from: null,
              through: null
            },
            league: { id: LEAGUE, name: 'Spring League', status: 'active' }
          })}
          onApply={vi.fn<
            (
              filters: import('../src/features/statistics/statistics-contracts').StatisticsFilters
            ) => void
          >()}
        />
      )
    );
    expect(screen.getByRole('status').textContent).toContain(
      'Friendly matches never count towards a League'
    );
    expect(screen.queryByText('No confirmed matches in this selection yet.')).toBeNull();
    expect(screen.getByText(/Showing the active League Spring League/)).toBeTruthy();
  });

  it('lists a tie partially when more players are tied than shown', () => {
    render(
      wrap(
        <CommunityStatistics
          stats={makeCommunityStatistics({
            mostWins: ready({ value: 2, total: 14, players: [name(ANA, 'Ana'), name(BEA, 'Bea')] })
          })}
          onApply={vi.fn<
            (
              filters: import('../src/features/statistics/statistics-contracts').StatisticsFilters
            ) => void
          >()}
        />
      )
    );
    expect(figure('Most wins').textContent).toContain('Tied: 14 in total, 2 shown');
  });

  it('is fully translated: no raw keys in pt-BR and es', () => {
    for (const locale of ['pt-BR', 'es'] as const) {
      render(
        wrap(
          <CommunityStatistics
            stats={makeCommunityStatistics({
              notice: 'friendly_league',
              mostWins: insufficient('minimum_matches', 2, 5)
            })}
            onApply={vi.fn<
              (
                filters: import('../src/features/statistics/statistics-contracts').StatisticsFilters
              ) => void
            >()}
          />,
          locale
        )
      );
      expect(document.body.textContent).not.toMatch(/statistics\.(community|filters|player)\./);
      cleanup();
    }
  });
});

describe('StatisticsFilters in the community page', () => {
  it('applies a draft through the shared validator and keeps it labelled and keyboard operable', async () => {
    const user = userEvent.setup();
    const onApply =
      vi.fn<
        (
          filters: import('../src/features/statistics/statistics-contracts').StatisticsFilters
        ) => void
      >();
    render(wrap(<CommunityStatistics stats={makeCommunityStatistics()} onApply={onApply} />));
    const filters = screen.getByRole('form', { name: 'Statistics filters' });
    await user.selectOptions(within(filters).getByLabelText('League'), LEAGUE);
    await user.click(within(filters).getByRole('radio', { name: 'Competitive' }));
    await user.type(within(filters).getByLabelText('From (UTC date)'), '2030-01-01');
    await user.type(within(filters).getByLabelText('Through (UTC date)'), '2030-01-31');
    await user.click(within(filters).getByRole('button', { name: 'Apply filters' }));
    expect(onApply).toHaveBeenCalledWith({
      communityId: COMMUNITY,
      leagueId: LEAGUE,
      type: 'competitive',
      from: '2030-01-01',
      through: '2030-01-31'
    });
  });

  it('keeps community implicit in the route', () => {
    render(
      wrap(
        <CommunityStatistics
          stats={makeCommunityStatistics()}
          onApply={vi.fn<
            (
              filters: import('../src/features/statistics/statistics-contracts').StatisticsFilters
            ) => void
          >()}
        />
      )
    );
    expect(screen.queryByLabelText('Community')).toBeNull();
    expect(screen.queryByText('All my communities')).toBeNull();
  });

  it('rejects a reversed range with a visible error and does not apply', async () => {
    const user = userEvent.setup();
    const onApply =
      vi.fn<
        (
          filters: import('../src/features/statistics/statistics-contracts').StatisticsFilters
        ) => void
      >();
    render(wrap(<CommunityStatistics stats={makeCommunityStatistics()} onApply={onApply} />));
    const filters = screen.getByRole('form', { name: 'Statistics filters' });
    const from = within(filters).getByLabelText('From (UTC date)');
    const through = within(filters).getByLabelText('Through (UTC date)');
    await user.type(from, '2030-02-10');
    await user.type(through, '2030-02-01');
    await user.click(within(filters).getByRole('button', { name: 'Apply filters' }));
    expect(onApply).not.toHaveBeenCalled();
    expect(through.getAttribute('aria-invalid')).toBe('true');
    expect(
      within(filters).getByText('The end date must not be before the start date.')
    ).toBeTruthy();
  });

  it('resets League, type and dates but keeps the community', async () => {
    const user = userEvent.setup();
    const onApply =
      vi.fn<
        (
          filters: import('../src/features/statistics/statistics-contracts').StatisticsFilters
        ) => void
      >();
    render(
      wrap(
        <CommunityStatistics
          stats={makeCommunityStatistics({
            filters: {
              communityId: COMMUNITY,
              leagueId: LEAGUE,
              type: 'friendly',
              from: '2030-01-01',
              through: null
            }
          })}
          onApply={onApply}
        />
      )
    );
    await user.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(onApply).toHaveBeenCalledWith({
      communityId: COMMUNITY,
      leagueId: null,
      type: 'all',
      from: null,
      through: null
    });
  });

  it('keeps locale key parity for the new community and filter copy', () => {
    const keys = (value: unknown, prefix = ''): string[] =>
      typeof value === 'object' && value !== null
        ? Object.entries(value).flatMap(([key, child]) => keys(child, prefix + key + '.'))
        : [prefix];
    const pick = (locale: typeof en) => [
      ...keys(locale.statistics.community),
      ...keys(locale.statistics.filters)
    ];
    expect(pick(ptBR)).toEqual(pick(en));
    expect(pick(es)).toEqual(pick(en));
  });
});
