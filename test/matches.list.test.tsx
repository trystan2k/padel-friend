/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from '../src/i18n/config';
import en from '../src/locales/en/translation.json';

const mocks = vi.hoisted(() => ({
  list: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  invalidate: vi.fn<() => Promise<void>>()
}));
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  useRouter: () => ({ invalidate: mocks.invalidate }),
  Link: ({
    children,
    to,
    ...props
  }: {
    children: import('react').ReactNode;
    to: string;
    [key: string]: unknown;
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  )
}));
vi.mock('../src/features/matches/matches.functions', () => ({ listMatchEvents: mocks.list }));
import { MatchesPage } from '../src/features/matches/MatchesPage';
import type { MatchEventListItem } from '../src/features/matches/match-model';
import { makeMatchCard, matchCountScenario } from './helpers/match-fixtures';

const event = (
  id: number,
  count: number,
  badge: MatchEventListItem['caller_badge'] = null
): MatchEventListItem =>
  makeMatchCard({
    event_id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    community_id: '11111111-1111-4111-8111-111111111111',
    community_name: 'Club Norte',
    creator_id: '22222222-2222-4222-8222-222222222222',
    creator_name: 'Ana Silva',
    creator_level: 3.5,
    starts_at: '2026-10-20T18:30:00.000Z',
    timezone: 'Europe/Madrid',
    event_type: 'competitive',
    visibility: 'community_open',
    team_assignment_mode: 'PREDEFINED_TEAMS',
    venue_name: 'Court Central',
    maps_url: 'https://www.google.com/maps/place/Court+Central',
    photo_url: 'https://example.test/photo.jpg',
    price_minor: 1250,
    currency: 'EUR',
    registration_cutoff_at: '2026-10-20T17:30:00Z',
    ...matchCountScenario({ accepted: count }),
    caller_badge: badge,
    is_past: false,
    registration_open: true,
    caller_eligibility: 'member',
    caller_requires_approval: false
  });
const copy = en.matches;
function mount(props: Partial<ComponentProps<typeof MatchesPage>> = {}, locale = 'en') {
  return render(
    <I18nextProvider i18n={createI18n(locale)}>
      <MatchesPage entry="available" {...props} />
    </I18nextProvider>
  );
}
afterEach(() => {
  cleanup();
  mocks.list.mockReset();
  mocks.invalidate.mockReset();
});

describe('match list surfaces', () => {
  it('renders realistic event details, localized Maps label and informational price', () => {
    mount({ initialItems: [event(1, 1)] });
    const card = screen.getByRole('article');
    expect(card.textContent).toContain('Court Central');
    expect(card.textContent).toContain('Oct 20, 2026');
    expect(card.textContent).toContain('Competitive');
    expect(card.textContent).toContain('Ana Silva');
    expect(card.textContent).toContain('3.5');
    expect(card.textContent).toContain('€12.50');
    const maps = within(card).getByRole('link', {
      name: copy.card.openMaps.replace('{{venue}}', 'Court Central')
    });
    expect(maps.getAttribute('rel')).toBe('noopener noreferrer');
  });
  it.each([
    ['en', 0, '0 playing', '4 more needed'],
    ['pt-BR', 3, '3 reservas', '1 falta'],
    ['pt-BR', 4, '4 jogando', '4 faltam'],
    ['es', 3, '3 reservas', '1 falta'],
    ['es', 4, '4 jugando', '4 faltan']
  ])('formats count plurals in %s', (locale, count, expected, needed) => {
    mount({ initialItems: [event(2, count)] }, locale);
    expect(screen.getByRole('article').textContent).toContain(expected);
    expect(screen.getByRole('article').textContent).toContain(needed);
  });
  it.each([
    ['creator', 'Playing', false],
    ['playing', 'Playing', true],
    ['reserve', 'Reserve', true],
    ['reserve_not_playing', 'Not playing', true],
    ['invited', 'Invited', true]
  ] as const)('renders badge %s correctly', (badge, visible, shown) => {
    mount({ entry: 'my', initialItems: [event(3, 4, badge)] });
    expect(Boolean(screen.queryByText(visible))).toBe(shown);
    expect(screen.queryByText(copy.badges.resultActionRequired)).toBeNull();
  });
  it('labels the reserve_not_playing badge from the localized catalog and keeps the counts split', () => {
    // Post-cutoff event: one residual reserve flipped to not-playing. The
    // card must render "1 reserve" (not 2) and the dedicated badge label.
    mount({
      entry: 'my',
      initialItems: [
        {
          ...event(30, 6, 'reserve_not_playing'),
          playing_count: 4,
          reserve_count: 1,
          reserve_not_playing_count: 1,
          registration_open: false
        }
      ]
    });
    const card = screen.getByRole('article');
    expect(card.textContent).toContain(copy.badges.reserve_not_playing);
    expect(card.textContent).toContain('4 playing');
    expect(card.textContent).toContain('1 reserve');
    expect(card.textContent).not.toContain('2 reserve');
    expect(screen.queryByText(copy.badges.reserve)).toBeNull();
  });
  it('sets current tab, has no unsupported controls, and only shows load more for a cursor', () => {
    mount({ initialItems: [event(4, 4)], initialCursor: 'next' });
    expect(
      screen.getByRole('link', { name: copy.tabs.available }).getAttribute('aria-current')
    ).toBe('page');
    expect(
      screen.getByRole('link', { name: copy.tabs.my }).getAttribute('aria-current')
    ).toBeNull();
    expect(screen.getByRole('button', { name: copy.loadMore })).toBeTruthy();
    expect(screen.queryByText(/Ranked|League|filter|pay|book/i)).toBeNull();
    cleanup();
    mount();
    expect(screen.queryByRole('button', { name: copy.loadMore })).toBeNull();
  });
  it.each([
    ['available', '/matches', copy.tabs.available],
    ['my', '/matches/my', copy.tabs.my],
    ['past', '/matches/past', copy.tabs.past]
  ] as const)('uses exact active matching for %s tab', (entry, path, label) => {
    mount({ entry });
    const links = screen.getAllByRole('link');
    expect(
      links.find((link) => link.getAttribute('href') === path)?.getAttribute('aria-current')
    ).toBe('page');
    expect(links.filter((link) => link.getAttribute('aria-current') === 'page')).toHaveLength(1);
    expect(links.find((link) => link.textContent === label)?.getAttribute('aria-current')).toBe(
      'page'
    );
  });
  it('shows informational eligibility and truthful past scheduled state on cards', () => {
    mount({
      entry: 'past',
      initialItems: [
        { ...event(10, 0), is_past: true },
        {
          ...event(11, 0),
          caller_eligibility: 'out_of_range',
          caller_requires_approval: true
        }
      ]
    });
    expect(screen.getAllByText(copy.detail.pastScheduled)).toHaveLength(1);
    expect(screen.getAllByText(copy.detail.outcomeUnavailable)).toHaveLength(1);
    expect(screen.getByText(copy.detail.outOfRangeApprovalRequired)).toBeTruthy();
    expect(screen.queryByText(/score|result|confirmed|disputed/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /join|register/i })).toBeNull();
  });
  it('shows invitation but suppresses approval wording only for accepted invitees', () => {
    mount({
      entry: 'my',
      initialItems: [
        {
          ...event(31, 4, 'playing'),
          caller_eligibility: 'out_of_range',
          caller_requires_approval: true,
          caller_is_invited: true
        },
        {
          ...event(32, 0),
          caller_eligibility: 'out_of_range',
          caller_requires_approval: true,
          caller_is_invited: true,
          is_accepted: false
        }
      ]
    });
    const [acceptedCard, nonAcceptedCard] = screen.getAllByRole('article');
    expect(within(acceptedCard).getByText(copy.detail.invitationInfo)).toBeTruthy();
    expect(within(acceptedCard).getByText(copy.badges.playing)).toBeTruthy();
    expect(within(acceptedCard).queryByText(copy.detail.outOfRangeApprovalRequired)).toBeNull();
    expect(within(nonAcceptedCard).getByText(copy.detail.invitationInfo)).toBeTruthy();
    expect(within(nonAcceptedCard).getByText(copy.detail.outOfRangeApprovalRequired)).toBeTruthy();
  });
  it('shows distinct empty, error and offline states', async () => {
    mount();
    expect(screen.getByText(copy.empty.available)).toBeTruthy();
    cleanup();
    mount({ initialError: true });
    expect(screen.getByRole('alert').textContent).toContain(copy.error);
    cleanup();
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
    mocks.list.mockRejectedValue(new Error('offline'));
    mount({ initialItems: [event(5, 0)], initialCursor: 'cursor' });
    await userEvent.setup().click(screen.getByRole('button', { name: copy.loadMore }));
    expect(await screen.findByText(copy.offline)).toBeTruthy();
  });
  it('replaces failed loader state when a retry returns events', () => {
    const view = mount({ initialError: true });
    view.rerender(
      <I18nextProvider i18n={createI18n('en')}>
        <MatchesPage entry="available" initialItems={[event(25, 1)]} initialError={false} />
      </I18nextProvider>
    );
    expect(screen.getByRole('article').textContent).toContain('Court Central');
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('recovers pagination when the browser reports reconnection', async () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
    mocks.list.mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    mount({ initialItems: [event(26, 0)], initialCursor: 'cursor' });
    await user.click(screen.getByRole('button', { name: copy.loadMore }));
    expect(await screen.findByText(copy.offline)).toBeTruthy();
    mocks.list.mockResolvedValueOnce({ items: [event(27, 1)], next_cursor: null });
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
    window.dispatchEvent(new Event('online'));
    await user.click(await screen.findByRole('button', { name: copy.loadMore }));
    expect(screen.getAllByRole('article')).toHaveLength(2);
  });
  it('sends the identical page snapshot on loadMore and retry across the start and cutoff', async () => {
    // The fixture event starts 2026-10-20T18:30Z with a 17:30Z cutoff; the
    // frozen clock starts before both and jumps past both mid-test. The pages
    // must keep the database-issued snapshot, never a freshly computed one.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T10:00:00.000Z'));
    const snapshot = '2026-01-01T00:00:00.000Z';
    try {
      mocks.list.mockRejectedValueOnce(new Error('load failed'));
      mount({ initialItems: [event(1, 4)], initialCursor: 'page-2', initialAsOf: snapshot });
      fireEvent.click(screen.getByRole('button', { name: copy.loadMore }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(mocks.list).toHaveBeenCalledExactlyOnceWith({
        data: { entry: 'available', cursor: 'page-2', limit: 20, as_of: snapshot }
      });
      expect(screen.getByRole('alert').textContent).toContain(copy.error);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2 * 86_400_000);
      });
      mocks.list.mockResolvedValueOnce({
        items: [event(41, 0)],
        next_cursor: null,
        as_of: snapshot
      });
      fireEvent.click(screen.getByRole('button', { name: copy.retry }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(mocks.list).toHaveBeenLastCalledWith({
        data: { entry: 'available', cursor: 'page-2', limit: 20, as_of: snapshot }
      });
      expect(screen.getAllByRole('article')).toHaveLength(2);
      expect(screen.queryByRole('button', { name: copy.retry })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
  it('installs a new snapshot on refresh and drops a stale in-flight page entirely', async () => {
    let resolveStale: (result: unknown) => void = () => {};
    mocks.list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStale = resolve;
        })
    );
    const staleSnapshot = '2026-01-01T00:00:00.000Z';
    const freshSnapshot = '2026-02-02T00:00:00.000Z';
    const view = mount({
      initialItems: [event(1, 4)],
      initialCursor: 'stale-page',
      initialAsOf: staleSnapshot
    });
    fireEvent.click(screen.getByRole('button', { name: copy.loadMore }));
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith({
      data: { entry: 'available', cursor: 'stale-page', limit: 20, as_of: staleSnapshot }
    });

    // Refresh with new loader data: items, cursor AND snapshot install together.
    view.rerender(
      <I18nextProvider i18n={createI18n('en')}>
        <MatchesPage
          entry="available"
          initialItems={[event(50, 8)]}
          initialCursor="fresh-page"
          initialAsOf={freshSnapshot}
        />
      </I18nextProvider>
    );
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('article').textContent).toContain('8 playing');

    // The in-flight response belongs to the discarded generation: it may not
    // append its card nor overwrite the fresh cursor or snapshot.
    await act(async () => {
      resolveStale({ items: [event(60, 0)], next_cursor: 'stale-cursor', as_of: staleSnapshot });
    });
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('article').textContent).toContain('8 playing');
    expect(screen.queryByText('0 playing')).toBeNull();

    // A loadMore under the refreshed generation proves the snapshot and cursor
    // really are the new ones and that appends still work.
    mocks.list.mockResolvedValueOnce({
      items: [event(61, 0)],
      next_cursor: null,
      as_of: freshSnapshot
    });
    fireEvent.click(screen.getByRole('button', { name: copy.loadMore }));
    await act(async () => {});
    expect(mocks.list).toHaveBeenNthCalledWith(2, {
      data: { entry: 'available', cursor: 'fresh-page', limit: 20, as_of: freshSnapshot }
    });
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: copy.loadMore })).toBeNull();
  });
});
