/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StatisticsFilterSection } from '../src/features/statistics/StatisticsFilterSection';
import { filterSearch } from '../src/features/statistics/statistics-search';
import { createI18n } from '../src/i18n/config';
import { readFilterOptions } from '../src/features/statistics/statistics-filter-options';

const getCommunityStatistics = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
vi.mock('../src/features/leagues/league.functions', () => ({
  listMyLeagueCommunities: async () => [{ id: 'first', name: 'First' }]
}));
vi.mock('../src/features/statistics/statistics-community.functions', () => ({
  getCommunityStatistics
}));

afterEach(cleanup);

describe('community scope selector', () => {
  it('shows retryable errors without clearing the selected league', async () => {
    const filters = {
      communityId: 'first',
      leagueId: 'league',
      type: 'all' as const,
      from: null,
      through: null
    };
    getCommunityStatistics.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({
      status: 'ok',
      value: { leagues: [{ id: 'league', name: 'League' }], activeLeagueId: 'league' }
    });
    const onApply =
      vi.fn<
        (
          filters: import('../src/features/statistics/statistics-contracts').StatisticsFilters
        ) => void
      >();
    const user = userEvent.setup();
    const i18n = createI18n('en');
    const initial = await readFilterOptions(filters);
    const view = (options: typeof initial) => (
      <I18nextProvider i18n={i18n}>
        <StatisticsFilterSection
          id="filters"
          filters={filters}
          controls={{
            options,
            onApply,
            onRetry: () => {
              void readFilterOptions(filters).then((next) => rerender(view(next)));
            }
          }}
        />
      </I18nextProvider>
    );
    const { rerender } = render(view(initial));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('combobox', { name: 'League' })).toHaveProperty(
      'value',
      'league'
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });
  it('renders provided communities and navigates with the League reset', async () => {
    const user = userEvent.setup();
    const onApply =
      vi.fn<
        (
          filters: import('../src/features/statistics/statistics-contracts').StatisticsFilters
        ) => void
      >();
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <StatisticsFilterSection
          id="filters"
          filters={{
            communityId: 'first',
            leagueId: 'league',
            type: 'friendly',
            from: null,
            through: null
          }}
          controls={{
            options: {
              communities: [
                { id: 'first', name: 'First' },
                { id: 'second', name: 'Second' }
              ],
              leagues: [],
              activeLeagueId: null
            },
            onApply
          }}
        />
      </I18nextProvider>
    );
    const select = screen.getByRole('combobox', { name: 'Community' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent)
    ).toEqual(['All communities', 'First', 'Second']);
    expect(within(select).queryByText('Private')).toBeNull();
    await user.selectOptions(select, 'second');
    expect(filterSearch(onApply.mock.calls[0]![0])).toEqual({
      communityId: 'second',
      type: 'friendly'
    });
    await user.selectOptions(select, '');
    expect(filterSearch(onApply.mock.calls[1]![0])).toEqual({ type: 'friendly' });
  });
});
