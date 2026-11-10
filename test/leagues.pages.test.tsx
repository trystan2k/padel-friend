/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LeagueDto, LeagueListResult } from '../src/features/leagues/league-contracts';
import { createI18n } from '../src/i18n/config';

const mocks = vi.hoisted(() => ({
  updateLeague: vi.fn<(request: { data: Record<string, unknown> }) => Promise<LeagueDto>>(),
  activateLeague: vi.fn<(request: { data: Record<string, unknown> }) => Promise<LeagueDto>>(),
  closeLeague: vi.fn<(request: { data: Record<string, unknown> }) => Promise<LeagueDto>>(),
  listMore: vi.fn<(request: { data: Record<string, unknown> }) => Promise<LeagueListResult>>(),
  invalidate: vi.fn<() => Promise<void>>(),
  navigate: vi.fn<(options: Record<string, unknown>) => Promise<void>>(),
  listVersions: vi.fn<(request: { data: Record<string, unknown> }) => Promise<unknown>>()
}));
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  Link: ({ children, to, params, ...rest }: any) => (
    <a
      href={String(to)
        .replace('$communityId', params?.communityId ?? '')
        .replace('$leagueId', params?.leagueId ?? '')}
      {...rest}
    >
      {children}
    </a>
  ),
  useRouter: () => ({ invalidate: mocks.invalidate, navigate: mocks.navigate })
}));
vi.mock('../src/features/leagues/league.functions', () => ({
  updateLeague: mocks.updateLeague,
  activateLeague: mocks.activateLeague,
  closeLeague: mocks.closeLeague,
  listMoreLeagues: mocks.listMore,
  listLeagueStandingsVersions: mocks.listVersions
}));

import { LeagueDetailPage } from '../src/features/leagues/LeagueDetailPage';
import { LeagueEntries } from '../src/features/leagues/LeagueEntries';
import { LeagueListPage } from '../src/features/leagues/LeagueListPage';
import {
  LEAGUE_COMMUNITY_ID,
  makeFormerParticipantDetail,
  makeLeagueDetail,
  makeLeagueDto,
  makeFinalStandings,
  makeLeagueList,
  makeLiveStandings,
  makeManualLeagueDto,
  makeStandingEntry
} from './helpers/league-dto-fixtures';

/** The detail page with an empty, matching standings read unless a test passes its own. */
function Detail({
  standings,
  standingsError = null,
  versions = null,
  audit = null,
  auditFailed = false,
  viewerId = null,
  ...props
}: Partial<ComponentProps<typeof LeagueDetailPage>> &
  Pick<ComponentProps<typeof LeagueDetailPage>, 'data'>) {
  const { status } = props.data.league;
  return (
    <LeagueDetailPage
      {...props}
      standings={
        standings === undefined
          ? status === 'closed'
            ? makeFinalStandings([])
            : makeLiveStandings([], { status })
          : standings
      }
      standingsError={standingsError}
      versions={versions}
      audit={audit}
      auditFailed={auditFailed}
      viewerId={viewerId}
    />
  );
}
const pageCursor = { created_at: '2030-01-02T03:04:05.123456Z', id: LEAGUE_COMMUNITY_ID };
const wrap = (node: React.ReactNode, locale: 'en' | 'pt-BR' | 'es' = 'en') => (
  <I18nextProvider i18n={createI18n(locale)}>{node}</I18nextProvider>
);

describe('League list and entries', () => {
  afterEach(cleanup);

  it('guides toward an Active League when only other Leagues exist', () => {
    render(
      wrap(
        <LeagueListPage
          data={makeLeagueList([makeLeagueDto({ status: 'closed', name: 'Old Cup' })])}
        />
      )
    );
    expect(screen.getByText('No Active League')).toBeTruthy();
    cleanup();
    render(
      wrap(<LeagueListPage data={makeLeagueList([makeManualLeagueDto({ status: 'active' })])} />)
    );
    expect(screen.queryByText('No Active League')).toBeNull();
  });

  it('groups Leagues by status and shows why a due Upcoming League is waiting', () => {
    render(
      wrap(
        <LeagueListPage
          data={makeLeagueList([
            makeManualLeagueDto({
              id: 'a1111111-1111-4111-8111-111111111111',
              name: 'Summer Ladder',
              status: 'active'
            }),
            makeLeagueDto({
              id: 'b1111111-1111-4111-8111-111111111111',
              name: 'Autumn League',
              blocked_reason: 'active_league_exists'
            }),
            makeLeagueDto({
              id: 'c1111111-1111-4111-8111-111111111111',
              name: 'Old Cup',
              status: 'closed',
              closed_at: '2030-02-01T00:00:00.000000Z',
              closed_reason: 'fixed_end_reached'
            })
          ])}
        />
      )
    );
    const headings = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent);
    expect(headings).toEqual(['Active', 'Upcoming', 'Closed']);
    const upcoming = screen.getByRole('link', { name: /Autumn League/ });
    expect(upcoming.getAttribute('href')).toBe(
      `/community/${LEAGUE_COMMUNITY_ID}/leagues/b1111111-1111-4111-8111-111111111111`
    );
    expect(
      within(upcoming).getByText('Waiting: this community already has an Active League.')
    ).toBeTruthy();
    expect(within(upcoming).getByText('Oct 01, 2030 → Dec 20, 2030')).toBeTruthy();
    expect(
      within(screen.getByRole('link', { name: /Summer Ladder/ })).getByText(
        'From Oct 01, 2030 · no end date'
      )
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Create League' }).getAttribute('href')).toBe(
      `/community/${LEAGUE_COMMUNITY_ID}/leagues/create`
    );
  });

  it('offers creation only when allowed and explains an empty community', () => {
    render(
      wrap(
        <LeagueListPage data={makeLeagueList([], { can_create: false, creation_enabled: false })} />
      )
    );
    expect(screen.queryByRole('link', { name: 'Create League' })).toBeNull();
    expect(screen.getByText(/League creation is turned off for members/)).toBeTruthy();
    expect(screen.getByText('No Leagues yet.')).toBeTruthy();
  });

  it('orders Upcoming by start and Closed by most recent close, whatever order the server sends', () => {
    const upcoming = (id: string, name: string, start: string) =>
      makeLeagueDto({ id, name, start_at: start });
    const closed = (id: string, name: string, at: string) =>
      makeLeagueDto({
        id,
        name,
        status: 'closed',
        closed_at: at,
        closed_reason: 'fixed_end_reached'
      });
    render(
      wrap(
        <LeagueListPage
          data={makeLeagueList([
            closed(
              'c1111111-1111-4111-8111-111111111111',
              'Old Cup',
              '2030-02-01T00:00:00.000000Z'
            ),
            upcoming(
              'a2222222-1111-4111-8111-111111111111',
              'Late Cup',
              '2031-06-01T00:00:00.000000Z'
            ),
            closed(
              'c2222222-1111-4111-8111-111111111111',
              'New Cup',
              '2030-05-01T00:00:00.000000Z'
            ),
            upcoming(
              'a1111111-1111-4111-8111-111111111111',
              'Soon Cup',
              '2031-01-01T00:00:00.000000Z'
            )
          ])}
        />
      )
    );
    const names = screen
      .getAllByRole('link')
      .map((link) => link.textContent ?? '')
      .filter((text) => text.includes('Cup'))
      .map((text) => text.slice(0, text.indexOf('Cup') + 3));
    expect(names).toEqual(['Soon Cup', 'Late Cup', 'New Cup', 'Old Cup']);
  });

  it('tells the reader the list is partial, translated, and shows nothing when complete', () => {
    const leagues = [makeLeagueDto()];
    const cut = makeLeagueList(
      leagues,
      {},
      { total: 201, truncated: true, next_cursor: pageCursor }
    );
    render(wrap(<LeagueListPage data={cut} />));
    expect(screen.getByRole('status').textContent).toBe('Showing 1 of 201 Leagues.');
    expect(screen.getByRole('button', { name: 'Show more Leagues' })).toBeTruthy();
    cleanup();
    render(wrap(<LeagueListPage data={makeLeagueList(leagues)} />));
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button', { name: /Show more/ })).toBeNull();
    cleanup();
    render(wrap(<LeagueListPage data={cut} />, 'pt-BR'));
    expect(screen.getByRole('status').textContent).toBe('Mostrando 1 de 201 Ligas.');
    expect(screen.getByRole('button', { name: 'Mostrar mais Ligas' })).toBeTruthy();
    cleanup();
    render(wrap(<LeagueListPage data={cut} />, 'es'));
    expect(screen.getByRole('button', { name: 'Mostrar más Ligas' })).toBeTruthy();
  });

  it('Show more fetches the next page, appends it, and offers retry on failure', async () => {
    const first = makeLeagueDto({ id: 'a1111111-1111-4111-8111-111111111111', name: 'First Cup' });
    const second = makeLeagueDto({
      id: 'b1111111-1111-4111-8111-111111111111',
      name: 'Second Cup'
    });
    render(
      wrap(
        <LeagueListPage
          data={makeLeagueList([first], {}, { total: 2, truncated: true, next_cursor: pageCursor })}
        />
      )
    );
    mocks.listMore.mockRejectedValueOnce(new Error('offline'));
    await userEvent.click(screen.getByRole('button', { name: 'Show more Leagues' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'More Leagues could not be loaded. Try again.'
    );
    mocks.listMore.mockResolvedValueOnce(
      makeLeagueList([second], {}, { total: 2, truncated: false, next_cursor: null })
    );
    await userEvent.click(screen.getByRole('button', { name: 'Show more Leagues' }));
    expect(await screen.findByRole('link', { name: /Second Cup/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /First Cup/ })).toBeTruthy();
    expect(mocks.listMore).toHaveBeenLastCalledWith({
      data: { community_id: LEAGUE_COMMUNITY_ID, cursor: pageCursor }
    });
    expect(screen.queryByRole('button', { name: 'Show more Leagues' })).toBeNull();
    // The live status survives the final page and announces completion.
    expect(screen.getByRole('status').textContent).toBe(
      'All 2 Leagues are shown. Reload to check for newer ones.'
    );
  });

  it('keeps keyboard focus through Show more and moves it to the first new League', async () => {
    const first = makeLeagueDto({ id: 'a1111111-1111-4111-8111-111111111111', name: 'First Cup' });
    const second = makeLeagueDto({
      id: 'b1111111-1111-4111-8111-111111111111',
      name: 'Second Cup'
    });
    render(
      wrap(
        <LeagueListPage
          data={makeLeagueList([first], {}, { total: 2, truncated: true, next_cursor: pageCursor })}
        />
      )
    );
    let finish: (page: LeagueListResult) => void = () => undefined;
    mocks.listMore.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    await userEvent.tab();
    await userEvent.tab();
    const button = screen.getByRole('button', { name: 'Show more Leagues' });
    button.focus();
    await userEvent.keyboard('{Enter}');
    // Loading: still focused (not removed from the tab order), announced, and not re-fireable.
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('Loading more Leagues…');
    await userEvent.keyboard('{Enter}');
    expect(mocks.listMore).toHaveBeenCalledTimes(1);
    finish(makeLeagueList([second], {}, { total: 2, truncated: false, next_cursor: null }));
    const link = await screen.findByRole('link', { name: /Second Cup/ });
    await waitFor(() => expect(document.activeElement).toBe(link));
    expect(screen.getByRole('status').textContent).toBe(
      'All 2 Leagues are shown. Reload to check for newer ones.'
    );
  });

  it('lands focus on the completion status when the final page only repeats shown Leagues', async () => {
    const active = makeLeagueDto({
      id: 'a1111111-1111-4111-8111-111111111111',
      name: 'Old Active',
      status: 'active'
    });
    render(
      wrap(
        <LeagueListPage
          data={makeLeagueList(
            [active],
            {},
            { total: 1, truncated: true, next_cursor: pageCursor }
          )}
        />
      )
    );
    mocks.listMore.mockResolvedValueOnce(
      makeLeagueList([active], {}, { total: 1, truncated: false, next_cursor: null })
    );
    const button = screen.getByRole('button', { name: 'Show more Leagues' });
    button.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Show more Leagues' })).toBeNull()
    );
    const status = screen.getByRole('status');
    await waitFor(() => expect(document.activeElement).toBe(status));
    expect(status.getAttribute('tabindex')).toBe('-1');
  });

  it('focuses the first new League in rendered order, not server order', async () => {
    const dto = (id: string, name: string, extra: Partial<LeagueDto>) =>
      makeLeagueDto({ id, name, ...extra });
    const shown = dto('a1111111-1111-4111-8111-111111111111', 'Shown Active', { status: 'active' });
    const closed = dto('c1111111-1111-4111-8111-111111111111', 'Fresh Closed', {
      status: 'closed',
      closed_at: '2030-05-01T00:00:00.000000Z',
      closed_reason: 'fixed_end_reached'
    });
    const late = dto('b2222222-1111-4111-8111-111111111111', 'Fresh Late', {
      start_at: '2031-06-01T00:00:00.000000Z'
    });
    const soon = dto('b1111111-1111-4111-8111-111111111111', 'Fresh Soon', {
      start_at: '2031-01-01T00:00:00.000000Z'
    });
    render(
      wrap(
        <LeagueListPage
          data={makeLeagueList([shown], {}, { total: 4, truncated: true, next_cursor: pageCursor })}
        />
      )
    );
    // Server order is newest-created first (closed, late, soon); rendering shows soon first.
    mocks.listMore.mockResolvedValueOnce(
      makeLeagueList([closed, late, soon], {}, { total: 4, truncated: false, next_cursor: null })
    );
    await userEvent.click(screen.getByRole('button', { name: 'Show more Leagues' }));
    const link = await screen.findByRole('link', { name: /Fresh Soon/ });
    await waitFor(() => expect(document.activeElement).toBe(link));
  });

  it('does not claim completeness for Leagues created after the list started', async () => {
    const first = makeLeagueDto({ id: 'a1111111-1111-4111-8111-111111111111', name: 'First Cup' });
    const second = makeLeagueDto({
      id: 'b1111111-1111-4111-8111-111111111111',
      name: 'Second Cup'
    });
    render(
      wrap(
        <LeagueListPage
          data={makeLeagueList([first], {}, { total: 2, truncated: true, next_cursor: pageCursor })}
        />
      )
    );
    // A third League was created meanwhile: the server's current total is 3 but it sorts ahead
    // of the cursor and can never load here, so the claim must stay at the list's own 2.
    mocks.listMore.mockResolvedValueOnce(
      makeLeagueList([second], {}, { total: 3, truncated: false, next_cursor: null })
    );
    await userEvent.click(screen.getByRole('button', { name: 'Show more Leagues' }));
    await screen.findByRole('link', { name: /Second Cup/ });
    const text = screen.getByRole('status').textContent ?? '';
    expect(text).toContain('All 2 Leagues are shown');
    expect(text).not.toContain('3');
    expect(text).toContain('Reload');
  });

  it.each([
    ['a new League', true],
    ['only already-shown Leagues', false]
  ] as const)(
    'does not steal focus when the user moved away while the response was pending (%s)',
    async (_label, hasNew) => {
      const shown = makeLeagueDto({
        id: 'a1111111-1111-4111-8111-111111111111',
        name: 'Shown Cup'
      });
      const fresh = makeLeagueDto({
        id: 'b1111111-1111-4111-8111-111111111111',
        name: 'Fresh Cup'
      });
      render(
        wrap(
          <LeagueListPage
            data={makeLeagueList(
              [shown],
              {},
              { total: 2, truncated: true, next_cursor: pageCursor }
            )}
          />
        )
      );
      let finish: (page: LeagueListResult) => void = () => undefined;
      mocks.listMore.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
      const button = screen.getByRole('button', { name: 'Show more Leagues' });
      button.focus();
      await userEvent.keyboard('{Enter}');
      const elsewhere = screen.getByRole('link', { name: 'Create League' });
      elsewhere.focus();
      expect(document.activeElement).toBe(elsewhere);
      finish(
        makeLeagueList(
          hasNew ? [fresh] : [shown],
          {},
          { total: 2, truncated: false, next_cursor: null }
        )
      );
      await waitFor(() =>
        expect(screen.getByRole('status').textContent).toContain(
          hasNew ? 'All 2 Leagues are shown' : 'All 2 Leagues are shown'
        )
      );
      if (hasNew) await screen.findByRole('link', { name: /Fresh Cup/ });
      expect(document.activeElement).toBe(elsewhere);
    }
  );

  it('keeps focus on the button when loading more fails', async () => {
    render(
      wrap(
        <LeagueListPage
          data={makeLeagueList(
            [makeLeagueDto()],
            {},
            { total: 2, truncated: true, next_cursor: pageCursor }
          )}
        />
      )
    );
    mocks.listMore.mockRejectedValueOnce(new Error('offline'));
    const button = screen.getByRole('button', { name: 'Show more Leagues' });
    button.focus();
    await userEvent.keyboard('{Enter}');
    await screen.findByRole('alert');
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-disabled')).not.toBe('true');
  });

  it('shows a League that moved between pages once, in presentation order', async () => {
    const early = makeLeagueDto({
      id: 'a1111111-1111-4111-8111-111111111111',
      name: 'Early Cup',
      start_at: '2030-01-01T00:00:00.000000Z'
    });
    const late = makeLeagueDto({
      id: 'b1111111-1111-4111-8111-111111111111',
      name: 'Late Cup',
      start_at: '2031-01-01T00:00:00.000000Z'
    });
    render(
      wrap(
        <LeagueListPage
          data={makeLeagueList([late], {}, { total: 2, truncated: true, next_cursor: pageCursor })}
        />
      )
    );
    // The next page repeats `late` (it moved across the boundary) and adds `early`.
    mocks.listMore.mockResolvedValueOnce(
      makeLeagueList([late, early], {}, { total: 2, truncated: false, next_cursor: null })
    );
    await userEvent.click(screen.getByRole('button', { name: 'Show more Leagues' }));
    await screen.findByRole('link', { name: /Early Cup/ });
    const names = screen.getAllByRole('link').map((link) => link.textContent ?? '');
    expect(names.filter((text) => text.includes('Late Cup'))).toHaveLength(1);
    expect(names.findIndex((text) => text.includes('Early Cup'))).toBeLessThan(
      names.findIndex((text) => text.includes('Late Cup'))
    );
  });

  it('links every active community from the dashboard entry, for members as well as Admins', () => {
    render(
      wrap(
        <LeagueEntries
          communities={[
            { id: LEAGUE_COMMUNITY_ID, name: 'Pádel & Amigos' },
            { id: '22222222-2222-4222-8222-222222222222', name: 'Club B' }
          ]}
        />
      )
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Leagues' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Leagues in Club B' }).getAttribute('href')).toBe(
      '/community/22222222-2222-4222-8222-222222222222/leagues'
    );
    expect(screen.getByRole('link', { name: 'Club B statistics' }).getAttribute('href')).toBe(
      '/community/22222222-2222-4222-8222-222222222222/statistics'
    );
    cleanup();
    const { container } = render(wrap(<LeagueEntries communities={[]} />));
    expect(container.textContent).toBe('');
  });
});

describe('League detail management', () => {
  beforeEach(() => {
    mocks.updateLeague.mockReset();
    mocks.activateLeague.mockReset();
    mocks.closeLeague.mockReset();
    mocks.invalidate.mockReset().mockResolvedValue();
  });
  afterEach(cleanup);

  it('hides every control from someone who cannot manage the League', () => {
    render(
      wrap(
        <Detail
          data={makeLeagueDetail({
            can_manage: false,
            blocked_reason: 'explicit_activation_required',
            activation_due: true
          })}
        />
      )
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Autumn League' })).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Ready to start: an owner or Admin must activate it.')).toBeTruthy();
  });

  it('activates a blocked or due Upcoming League with the expected version', async () => {
    const user = userEvent.setup();
    mocks.activateLeague.mockResolvedValue(makeLeagueDto({ status: 'active', version: 4 }));
    render(
      wrap(
        <Detail
          data={makeLeagueDetail({ version: 3, blocked_reason: 'explicit_activation_required' })}
        />
      )
    );
    await user.click(screen.getByRole('button', { name: 'Activate League' }));
    expect(mocks.activateLeague).toHaveBeenCalledWith({
      data: { league_id: makeLeagueDto().id, expected_version: 3 }
    });
    expect(await screen.findByText('League activated.')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Activate League' })).toBeNull();
    expect(mocks.invalidate).toHaveBeenCalled();
  });

  it('offers activation for a due League and none for one that is not due', () => {
    render(wrap(<Detail data={makeLeagueDetail({ activation_due: true })} />));
    expect(screen.getByRole('button', { name: 'Activate League' })).toBeTruthy();
    cleanup();
    render(wrap(<Detail data={makeLeagueDetail({ activation_due: false })} />));
    expect(screen.queryByRole('button', { name: 'Activate League' })).toBeNull();
  });

  it('explains an activation refused because another League is Active', async () => {
    const user = userEvent.setup();
    mocks.activateLeague.mockRejectedValue(new Error('LEAGUE_ACTIVE_EXISTS'));
    render(wrap(<Detail data={makeLeagueDetail({ blocked_reason: 'active_league_exists' })} />));
    expect(screen.getByText(/Another League is Active/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Activate League' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'This community already has one Active League. Close it or wait until it ends.'
    );
  });

  it('closes an open-ended League only after an explicit confirmation', async () => {
    const user = userEvent.setup();
    mocks.closeLeague.mockResolvedValue(
      makeManualLeagueDto({
        status: 'closed',
        version: 3,
        closed_at: '2030-05-01T10:00:00.000000Z',
        closed_reason: 'manual'
      })
    );
    render(
      wrap(
        <Detail
          data={makeLeagueDetail({ ...makeManualLeagueDto({ status: 'active', version: 2 }) })}
        />
      )
    );
    await user.click(screen.getByRole('button', { name: 'Close League' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Close Autumn League?')).toBeTruthy();
    expect(mocks.closeLeague).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Keep open' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(mocks.closeLeague).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Close League' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Close League' })
    );
    expect(mocks.closeLeague).toHaveBeenCalledWith({
      data: { league_id: makeLeagueDto().id, expected_version: 2 }
    });
    expect(await screen.findByText('League closed.')).toBeTruthy();
    expect(screen.getByText(/closed manually/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close League' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit League' })).toBeNull();
  });

  it('never offers a manual close for a Fixed League', () => {
    render(wrap(<Detail data={makeLeagueDetail({ status: 'active' })} />));
    expect(screen.queryByRole('button', { name: 'Close League' })).toBeNull();
  });

  it('sends no lifecycle command while offline and says nothing was sent', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    try {
      render(
        wrap(
          <Detail
            data={makeLeagueDetail({ version: 3, blocked_reason: 'explicit_activation_required' })}
          />
        )
      );
      await user.click(screen.getByRole('button', { name: 'Activate League' }));
      expect((await screen.findByRole('alert')).textContent).toContain('You are offline');
      expect(mocks.activateLeague).not.toHaveBeenCalled();
      expect(screen.queryByText('League activated.')).toBeNull();
    } finally {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    }
  });

  it('reports a lost connection as outcome-unknown, reloads and never claims success', async () => {
    const user = userEvent.setup();
    mocks.activateLeague.mockRejectedValue(new TypeError('Failed to fetch'));
    render(
      wrap(
        <Detail
          data={makeLeagueDetail({ version: 3, blocked_reason: 'explicit_activation_required' })}
        />
      )
    );
    await user.click(screen.getByRole('button', { name: 'Activate League' }));
    expect((await screen.findByRole('alert')).textContent).toContain("couldn't confirm");
    expect(screen.queryByText('League activated.')).toBeNull();
    expect(mocks.activateLeague).toHaveBeenCalledTimes(1);
    expect(mocks.invalidate).toHaveBeenCalled();
  });

  it('reloads and explains a version conflict', async () => {
    const user = userEvent.setup();
    mocks.updateLeague.mockRejectedValue(new Error('LEAGUE_VERSION_CONFLICT'));
    render(wrap(<Detail data={makeLeagueDetail()} />));
    await user.click(screen.getByRole('button', { name: 'Edit League' }));
    const name = screen.getByLabelText('League name');
    await user.clear(name);
    await user.type(name, 'Renamed');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'This League changed in the meantime'
    );
    expect(mocks.invalidate).toHaveBeenCalled();
  });

  it('edits only what changed and keeps the period untouched on a rename', async () => {
    const user = userEvent.setup();
    mocks.updateLeague.mockResolvedValue(makeLeagueDto({ name: 'Renamed', version: 2 }));
    render(wrap(<Detail data={makeLeagueDetail()} />));
    await user.click(screen.getByRole('button', { name: 'Edit League' }));
    const name = screen.getByLabelText('League name');
    await user.clear(name);
    await user.type(name, 'Renamed');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(mocks.updateLeague).toHaveBeenCalledWith({
      data: { league_id: makeLeagueDto().id, expected_version: 1, changes: { name: 'Renamed' } }
    });
    expect(await screen.findByText('Changes saved.')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Renamed' })).toBeTruthy();
    expect(screen.queryByLabelText('League name')).toBeNull();
  });

  it('sends the whole period change when switching to an open-ended League', async () => {
    const user = userEvent.setup();
    mocks.updateLeague.mockResolvedValue(makeManualLeagueDto({ version: 2 }));
    render(wrap(<Detail data={makeLeagueDetail()} />));
    await user.click(screen.getByRole('button', { name: 'Edit League' }));
    await user.click(screen.getByRole('radio', { name: /Open-ended · manual/ }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(mocks.updateLeague).toHaveBeenCalledWith({
      data: {
        league_id: makeLeagueDto().id,
        expected_version: 1,
        changes: { end_mode: 'manual', end_date: null }
      }
    });
  });

  it('locks the period fields once events use the League but keeps naming editable', async () => {
    const user = userEvent.setup();
    render(wrap(<Detail data={makeLeagueDetail({ period_locked: true })} />));
    await user.click(screen.getByRole('button', { name: 'Edit League' }));
    expect(screen.getByLabelText('Start date').hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText(/End date/).hasAttribute('disabled')).toBe(true);
    expect(
      screen.getByRole('radio', { name: /Fixed end date/ }).hasAttribute('disabled') ||
        screen.getByRole('radio', { name: /Fixed end date/ }).getAttribute('aria-disabled') ===
          'true'
    ).toBe(true);
    expect(screen.getByLabelText('League name').hasAttribute('disabled')).toBe(false);
    expect(screen.getByText(/Dates can no longer change/)).toBeTruthy();
  });

  it('shows who closed it and why for a closed League, translated', () => {
    render(
      wrap(
        <Detail
          data={makeLeagueDetail({
            status: 'closed',
            closed_at: '2030-12-20T22:59:59.999999Z',
            closed_reason: 'fixed_end_reached',
            can_manage: true
          })}
        />,
        'es'
      )
    );
    expect(screen.getByText('Cerrada', { selector: 'dt' })).toBeTruthy();
    expect(screen.getByText(/fecha de fin alcanzada/)).toBeTruthy();
    // No management action on a closed League: only the history reader's retry remains.
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Reintentar'
    ]);
  });
});

describe('League detail for a former participant', () => {
  afterEach(cleanup);

  it('shows the read-only notice and returns to the match history', () => {
    render(wrap(<Detail data={makeFormerParticipantDetail({ status: 'active' })} />));
    expect(screen.getByRole('heading', { name: 'You played in this League' })).toBeTruthy();
    expect(screen.getByText(/read-only for you/)).toBeTruthy();
    const back = screen.getByRole('link', { name: 'Back to match history' });
    expect(back.getAttribute('href')).toBe('/matches/past');
    expect(screen.queryByRole('link', { name: 'Back to Leagues' })).toBeNull();
  });

  it('offers no community links, management actions or audit, even for a closed League', () => {
    render(
      wrap(
        <Detail
          data={makeFormerParticipantDetail({
            status: 'closed',
            closed_at: '2030-12-20T22:59:59.999999Z',
            closed_reason: 'manual'
          })}
        />
      )
    );
    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual(['/matches/past']);
    for (const name of [/Activate League/, /Close League/, /Edit League/])
      expect(screen.queryByRole('button', { name })).toBeNull();
  });

  it('keeps the member experience unchanged for an ordinary non-manager member', () => {
    render(wrap(<Detail data={makeLeagueDetail({ status: 'active', can_manage: false })} />));
    expect(screen.queryByRole('heading', { name: 'You played in this League' })).toBeNull();
    const back = screen.getByRole('link', { name: 'Back to Leagues' });
    expect(back.getAttribute('href')).toBe(`/community/${LEAGUE_COMMUNITY_ID}/leagues`);
    expect(screen.getByRole('link', { name: 'Community statistics' })).toBeTruthy();
  });

  it('shows live standings in the read-only view', () => {
    render(
      wrap(
        <Detail
          data={makeFormerParticipantDetail({ status: 'active' })}
          standings={makeLiveStandings([makeStandingEntry()], { status: 'active' })}
        />
      )
    );
    expect(screen.getAllByText('Ana').length).toBeGreaterThan(0);
  });

  it.each([
    ['pt-BR', 'Você jogou nesta Liga', 'Voltar ao histórico de partidas'],
    ['es', 'Jugaste en esta Liga', 'Volver al historial de partidos']
  ] as const)('translates the notice and back link in %s', (locale, title, back) => {
    render(wrap(<Detail data={makeFormerParticipantDetail({ status: 'active' })} />, locale));
    expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    expect(screen.getByRole('link', { name: back }).getAttribute('href')).toBe('/matches/past');
  });
});
