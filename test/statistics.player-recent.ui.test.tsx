/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, expect, it, vi } from 'vitest';
import { PlayerRecentMatches } from '../src/features/statistics/PlayerRecentMatches';
import type { HistoryItem } from '../src/features/statistics/statistics-history-contracts';
import { createI18n } from '../src/i18n/config';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>
}));
afterEach(cleanup);

it('shows three subject matches with badges, opponents, dates and history links', () => {
  const base: HistoryItem = {
    key: 'g:1',
    kind: 'group',
    event_id: 'event',
    group_number: 1,
    game_group_id: 'group',
    status: 'played',
    match_type: 'friendly',
    community_id: 'community',
    community_name: 'Club',
    league_id: null,
    league_name: null,
    venue_name: 'Court',
    timezone: 'UTC',
    sort_at: '2030-01-01T00:00:00Z',
    played_at: '2030-01-01T00:00:00Z',
    viewer_side: 'team_a',
    opponents: ['Ana', 'Bea'],
    outcome: 'win',
    classification: 'team_a',
    sets: [],
    sets_a: 2,
    sets_b: 0,
    games_a: 12,
    games_b: 6,
    rating_delta: null
  };
  const items = [
    base,
    { ...base, key: 'g:2', status: 'incomplete' as const },
    { ...base, key: 'g:3', status: 'pending' as const }
  ];
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <PlayerRecentMatches
        response={{
          status: 'ok',
          value: { items, limit: 3, next_cursor: null, statistics_revision: 1 }
        }}
      />
    </I18nextProvider>
  );
  const section = screen.getByRole('region', { name: 'Recent matches' });
  expect(within(section).getAllByRole('listitem')).toHaveLength(3);
  expect(within(section).getByText('Played')).toBeTruthy();
  expect(within(section).getByText('Pending approval')).toBeTruthy();
  expect(within(section).getAllByText('vs Ana and Bea')).toHaveLength(3);
  expect(within(section).getAllByRole('link', { name: 'Result details' })).toHaveLength(2);
  expect(within(section).getByRole('link', { name: 'See all' }).getAttribute('href')).toBe(
    '/matches/past'
  );
});
