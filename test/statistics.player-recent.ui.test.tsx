/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { I18nextProvider } from 'react-i18next';
import { afterEach, expect, it, vi } from 'vitest';
import { PlayerRecentMatches } from '../src/features/statistics/PlayerRecentMatches';
import type {
  HistoryItem,
  HistoryView,
  StatisticsResponse
} from '../src/features/statistics/statistics-history-contracts';
import { createI18n } from '../src/i18n/config';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>
}));
afterEach(cleanup);

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
const page = (list: HistoryItem[]): StatisticsResponse<HistoryView> => ({
  status: 'ok',
  value: { items: list, limit: 3, next_cursor: null, statistics_revision: 1 }
});
const renderCard = (
  response: StatisticsResponse<HistoryView> | null,
  isOwn = true,
  onRetry?: () => void
) =>
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <PlayerRecentMatches response={response} isOwn={isOwn} onRetry={onRetry} />
    </I18nextProvider>
  );

it('shows three subject matches with badges, opponents, dates and history links', () => {
  renderCard(page(items));
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

it('hides See all on another subject and shows it for the viewer', () => {
  renderCard(page(items), false);
  expect(screen.queryByRole('link', { name: 'See all' })).toBeNull();
  expect(screen.getAllByRole('listitem')).toHaveLength(3);
  cleanup();
  renderCard(page(items), true);
  expect(screen.getByRole('link', { name: 'See all' })).toBeTruthy();
});

it('shows a neutral state, not an error or retry, when the scope is not readable', () => {
  renderCard(null, false);
  expect(screen.getByText("Select a community to see this player's recent matches.")).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'See all' })).toBeNull();
});

it('keeps the error card with retry for a transient failure', () => {
  const onRetry = vi.fn<() => void>();
  renderCard({ status: 'error', code: 'STATISTICS_UNAVAILABLE' }, true, onRetry);
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
});

it('has no loading branch and shows the empty state for an empty page', () => {
  renderCard(page([]));
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByText('No match history yet.', { exact: false })).toBeTruthy();
});

it('stacks rows in a column grid with the meta row first and no flex-wrap list', () => {
  const css = readFileSync('src/features/statistics/statistics-player.styles.ts', 'utf8');
  expect(css).toMatch(/recentList: \{[^}]*display: 'grid'/s);
  expect(css).toMatch(/recentRow: \{[^}]*display: 'grid'[^}]*gap: 'var\(--space-/s);
  expect(css).not.toMatch(/recentList: \{[^}]*flexWrap/s);
  renderCard(page(items.slice(0, 1)));
  const row = screen.getAllByRole('listitem')[0]!;
  const [meta] = Array.from(row.children);
  expect(meta?.querySelector('time')).not.toBeNull();
  expect(meta?.textContent).toContain('Played');
  expect(row.lastElementChild?.tagName).toBe('A');
});
