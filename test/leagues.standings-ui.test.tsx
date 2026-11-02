/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from '../src/i18n/config';

const mocks = vi.hoisted(() => ({
  invalidate: vi.fn<() => Promise<void>>(),
  navigate:
    vi.fn<
      (options: {
        search: (previous: Record<string, unknown>) => Record<string, unknown>;
      }) => Promise<void>
    >(),
  closeLeague: vi.fn<(request: { data: Record<string, unknown> }) => Promise<unknown>>(),
  listVersions: vi.fn<(request: { data: Record<string, unknown> }) => Promise<unknown>>(),
  getAudit: vi.fn<(request: { data: Record<string, unknown> }) => Promise<unknown>>()
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
  updateLeague: vi.fn<() => void>(),
  activateLeague: vi.fn<() => void>(),
  closeLeague: mocks.closeLeague,
  listLeagueStandingsVersions: mocks.listVersions,
  getLeagueStandingsAudit: mocks.getAudit
}));

import { LeagueDetailPage } from '../src/features/leagues/LeagueDetailPage';
import { LeagueStandingsHistory } from '../src/features/leagues/LeagueStandingsHistory';
import {
  LEAGUE_STANDINGS_REFRESH_INTERVAL_MS,
  useRefreshWhenVisible
} from '../src/features/leagues/league-standings-refresh';
import {
  makeFinalStandings,
  makeLeagueDetail,
  makeLeagueDto,
  makeLiveStandings,
  makeManualLeagueDto,
  makeStandingEntry,
  makeVersionSummary,
  STANDING_USER_A,
  STANDING_USER_B,
  STANDING_USER_C
} from './helpers/league-dto-fixtures';

type Locale = 'en' | 'pt-BR' | 'es';
const wrap = (node: React.ReactNode, locale: Locale = 'en') => (
  <I18nextProvider i18n={createI18n(locale)}>{node}</I18nextProvider>
);
function Detail({
  standings = null,
  standingsError = null,
  versions = null,
  audit = null,
  auditFailed = false,
  viewerId = null,
  ...props
}: Partial<ComponentProps<typeof LeagueDetailPage>> &
  Pick<ComponentProps<typeof LeagueDetailPage>, 'data'>) {
  return (
    <LeagueDetailPage
      {...props}
      standings={standings}
      standingsError={standingsError}
      versions={versions}
      audit={audit}
      auditFailed={auditFailed}
      viewerId={viewerId}
    />
  );
}

const active = (overrides = {}) => makeLeagueDetail({ status: 'active', version: 3, ...overrides });
const closed = (overrides = {}) =>
  makeLeagueDetail({
    status: 'closed',
    closed_at: '2030-12-20T22:59:59.999999Z',
    closed_reason: 'fixed_end_reached',
    version: 4,
    ...overrides
  });

const ana = makeStandingEntry();
const bia = makeStandingEntry({
  user_id: STANDING_USER_B,
  display_name: 'Bia',
  position: 2,
  wins: 1,
  losses: 2,
  sets_won: 3,
  sets_lost: 5,
  set_differential: -2,
  award_eligible: true
});
const tiedLow = (id: string, name: string) =>
  makeStandingEntry({
    user_id: id,
    display_name: name,
    position: 3,
    matches: 1,
    wins: 0,
    losses: 1,
    sets_won: 0,
    sets_lost: 2,
    set_differential: -2,
    award_eligible: false,
    matches_remaining: 1
  });

beforeEach(() => {
  mocks.invalidate.mockReset().mockResolvedValue();
  mocks.navigate.mockReset().mockResolvedValue();
  mocks.closeLeague.mockReset();
  mocks.listVersions.mockReset();
  mocks.getAudit.mockReset();
});
afterEach(cleanup);

describe('live standings', () => {
  it('shows exact counters, shared places, own summary and award states', () => {
    const standings = makeLiveStandings([ana, bia, tiedLow(STANDING_USER_C, 'Caro')]);
    render(wrap(<Detail data={active()} standings={standings} viewerId={STANDING_USER_B} />));

    // Primary view: place, player, W–L–D, set difference and award — no scroll region needed.
    const primary = screen.getByRole('table', { name: 'Standings' });
    expect(
      within(primary)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent)
    ).toEqual(['Place', 'Player', 'W–L–D', 'Set difference', 'Final award']);
    const primaryRows = within(primary).getAllByRole('row').slice(1);
    expect(
      within(primaryRows[0]!)
        .getAllByRole('cell')
        .map((cell) => cell.textContent)
    ).toEqual(['1', '2–1–02 wins, 1 losses, 0 draws', '+2', 'Eligible']);
    expect(within(primaryRows[0]!).getByRole('rowheader').textContent).toBe('Ana');
    expect(primaryRows[1]!.getAttribute('aria-current')).toBe('true');
    const region = screen.getByRole('region', { name: /Standings table/ });
    expect(region.getAttribute('tabindex')).toBe('0');
    const table = within(region).getByRole('table');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent);
    expect(headers).toEqual([
      'Place',
      'Player',
      'Matches',
      'Wins',
      'Draws',
      'Losses',
      'Sets won',
      'Sets lost',
      'Set difference',
      'Final award'
    ]);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => within(row).getByRole('rowheader').textContent)).toEqual([
      'Ana',
      'BiaYou',
      'Caro'
    ]);
    expect(
      within(rows[0]!)
        .getAllByRole('cell')
        .map((cell) => cell.textContent)
    ).toEqual(['1', '3', '2', '0', '1', '5', '3', '+2', 'Eligible']);
    expect(within(rows[2]!).getByText('1 more match')).toBeTruthy();
    expect(rows[1]!.getAttribute('aria-current')).toBe('true');

    // Personal summary and the award callout come from the viewer's own row.
    const summary = screen.getByText('Your place').closest('dl')!;
    expect(summary.textContent).toContain('2');
    expect(summary.textContent).toContain('-2');
    expect(screen.getByText('You have reached the minimum for the final award.')).toBeTruthy();
    expect(screen.getByText(/Skill level is never used/)).toBeTruthy();
    expect(screen.getByText(/needs at least 2 matches/)).toBeTruthy();
    expect(screen.getByText('Live')).toBeTruthy();
    expect(screen.queryByText('Final')).toBeNull();
  });

  it('marks tied rows with a shared-place label for assistive tech', () => {
    const a = tiedLow(STANDING_USER_A, 'Ana');
    const b = tiedLow(STANDING_USER_B, 'Bia');
    render(wrap(<Detail data={active()} standings={makeLiveStandings([a, b])} />));
    // Announced once per row in the primary table and again in the full-statistics table.
    const primary = screen.getByRole('table', { name: 'Standings' });
    expect(within(primary).getAllByText('Shared place 3')).toHaveLength(2);
    expect(screen.getAllByText('Shared place 3')).toHaveLength(4);
  });

  it('shows the remaining-matches callout for a player below the threshold', () => {
    const standings = makeLiveStandings([ana, tiedLow(STANDING_USER_C, 'Caro')]);
    render(wrap(<Detail data={active()} standings={standings} viewerId={STANDING_USER_C} />));
    expect(screen.getByText('One more match for award eligibility.')).toBeTruthy();
  });

  it('keeps all-zero players visible and says why', () => {
    const zero = makeStandingEntry({
      matches: 0,
      wins: 0,
      losses: 0,
      sets_won: 0,
      sets_lost: 0,
      set_differential: 0,
      award_eligible: false,
      matches_remaining: 2
    });
    render(
      wrap(<Detail data={active()} standings={makeLiveStandings([zero])} viewerId={zero.user_id} />)
    );
    expect(screen.getByText(/No eligible Ranked results yet/)).toBeTruthy();
    expect(screen.getAllByRole('rowheader', { name: /Ana/ })).toHaveLength(2);
    expect(screen.getAllByText('2 more matches')).toHaveLength(2);
  });

  it('distinguishes an empty live roster, a non-participant viewer and an unavailable reader', async () => {
    const { unmount } = render(wrap(<Detail data={active()} standings={makeLiveStandings([])} />));
    expect(screen.getByText(/No eligible Ranked results yet/)).toBeTruthy();
    unmount();

    render(
      wrap(
        <Detail data={active()} standings={makeLiveStandings([ana])} viewerId={STANDING_USER_C} />
      )
    );
    expect(screen.getByText('You have no row in this table.')).toBeTruthy();
    cleanup();

    render(wrap(<Detail data={active()} standingsError="LEAGUE_UNAVAILABLE" />));
    expect(screen.getByRole('alert').textContent).toContain('Something went wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.invalidate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
  });

  it('shows an Upcoming League as an unlabelled zero table and translates in every locale', () => {
    const upcoming = makeLiveStandings([ana], { status: 'upcoming' });
    const { unmount } = render(wrap(<Detail data={makeLeagueDetail()} standings={upcoming} />));
    expect(screen.getByRole('heading', { name: 'Standings' })).toBeTruthy();
    expect(screen.queryByText('Live')).toBeNull();
    unmount();
    const standings = makeLiveStandings([ana, bia]);
    for (const [locale, title, award] of [
      ['pt-BR', 'Classificação', 'Elegível'],
      ['es', 'Clasificación', 'Elegible']
    ] as const) {
      const view = render(
        wrap(<Detail data={active()} standings={standings} viewerId={ana.user_id} />, locale)
      );
      expect(screen.getByRole('heading', { name: title })).toBeTruthy();
      expect(screen.getAllByText(award).length).toBeGreaterThan(0);
      expect(screen.queryByText(/leagues\./)).toBeNull();
      view.unmount();
    }
  });

  it('refreshes when the page becomes visible, without overlapping calls', async () => {
    let release: () => void = () => undefined;
    mocks.invalidate.mockReset().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    render(wrap(<Detail data={active()} standings={makeLiveStandings([ana])} />));
    const visible = () => document.dispatchEvent(new Event('visibilitychange'));
    visible();
    visible();
    expect(mocks.invalidate).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => {
      visible();
      expect(mocks.invalidate.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    cleanup();
    mocks.invalidate.mockClear();
    render(wrap(<Detail data={closed()} standings={makeFinalStandings([ana])} />));
    visible();
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });
});

describe('league page refresh scheduling', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  it('reloads an open Fixed League at its cutoff without touching the selected version', async () => {
    // The fixture cutoff is 22:59:59.999999: 30 s away, well before the first interval tick.
    vi.setSystemTime(new Date('2030-12-20T22:59:30.000Z'));
    render(wrap(<Detail data={active()} standings={makeLiveStandings([ana])} />));
    await vi.advanceTimersByTimeAsync(29_998);
    expect(mocks.invalidate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(mocks.invalidate).toHaveBeenCalledTimes(1);
    // A reload only revalidates the loader: the `version` search param is never rewritten.
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('never polls a closed League', async () => {
    render(wrap(<Detail data={closed()} standings={makeFinalStandings([ana])} />));
    await vi.advanceTimersByTimeAsync(LEAGUE_STANDINGS_REFRESH_INTERVAL_MS * 3);
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });
});

describe('refresh hook', () => {
  function Probe({
    enabled,
    refresh,
    cutoffAt = null
  }: {
    enabled: boolean;
    refresh: () => Promise<unknown>;
    cutoffAt?: string | null;
  }) {
    useRefreshWhenVisible(refresh, enabled, cutoffAt);
    return null;
  }
  describe('while the page stays visible', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('reloads on a bounded interval without overlapping, and stops when unmounted', async () => {
      let release: () => void = () => undefined;
      const refresh = vi.fn<() => Promise<void>>().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          })
      );
      const view = render(<Probe enabled refresh={refresh} />);
      await vi.advanceTimersByTimeAsync(LEAGUE_STANDINGS_REFRESH_INTERVAL_MS - 1);
      expect(refresh).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(refresh).toHaveBeenCalledTimes(1);
      // Slow reload: further ticks and refocus events are dropped, not queued.
      await vi.advanceTimersByTimeAsync(LEAGUE_STANDINGS_REFRESH_INTERVAL_MS * 3);
      document.dispatchEvent(new Event('visibilitychange'));
      expect(refresh).toHaveBeenCalledTimes(1);
      release();
      await vi.advanceTimersByTimeAsync(LEAGUE_STANDINGS_REFRESH_INTERVAL_MS);
      expect(refresh).toHaveBeenCalledTimes(2);
      view.unmount();
      release();
      await vi.advanceTimersByTimeAsync(LEAGUE_STANDINGS_REFRESH_INTERVAL_MS * 5);
      expect(refresh).toHaveBeenCalledTimes(2);
    });

    it('skips ticks while the page is hidden', async () => {
      const refresh = vi.fn<() => Promise<void>>().mockResolvedValue();
      const state = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      render(<Probe enabled refresh={refresh} />);
      await vi.advanceTimersByTimeAsync(LEAGUE_STANDINGS_REFRESH_INTERVAL_MS * 2);
      expect(refresh).not.toHaveBeenCalled();
      state.mockRestore();
    });

    it('reloads once at the Fixed cutoff, ahead of the next interval tick', async () => {
      vi.setSystemTime(new Date('2030-12-20T22:59:00.000Z'));
      const refresh = vi.fn<() => Promise<void>>().mockResolvedValue();
      render(<Probe enabled refresh={refresh} cutoffAt="2030-12-20T22:59:20.000Z" />);
      await vi.advanceTimersByTimeAsync(19_999);
      expect(refresh).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('does not schedule a cutoff reload that already passed, nor when disabled', async () => {
      vi.setSystemTime(new Date('2030-12-21T00:00:00.000Z'));
      const refresh = vi.fn<() => Promise<void>>().mockResolvedValue();
      const view = render(<Probe enabled refresh={refresh} cutoffAt="2030-12-20T22:59:20.000Z" />);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(refresh).not.toHaveBeenCalled();
      view.rerender(
        <Probe enabled={false} refresh={refresh} cutoffAt="2030-12-21T00:00:10.000Z" />
      );
      await vi.advanceTimersByTimeAsync(LEAGUE_STANDINGS_REFRESH_INTERVAL_MS * 2);
      expect(refresh).not.toHaveBeenCalled();
    });
  });

  it('stops listening once disabled or unmounted', () => {
    const refresh = vi.fn<() => Promise<void>>().mockResolvedValue();
    const view = render(<Probe enabled refresh={refresh} />);
    view.rerender(<Probe enabled={false} refresh={refresh} />);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(refresh).not.toHaveBeenCalled();
    view.rerender(<Probe enabled refresh={refresh} />);
    view.unmount();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('closing and final standings', () => {
  const confirmClose = async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Close League' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Matches played after this moment never count/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close League' }));
  };

  it('never labels the stale live table final after a close: it waits for the final', async () => {
    const detail = active({ end_mode: 'manual', end_at: null, end_date: null });
    mocks.closeLeague.mockResolvedValue(
      makeManualLeagueDto({
        status: 'closed',
        version: 4,
        closed_at: '2030-11-01T10:00:00.000000Z',
        closed_reason: 'manual'
      })
    );
    // The reload is still running: the stale table must not show, nor claim to be final.
    mocks.invalidate.mockReset().mockImplementation(() => new Promise<void>(() => undefined));
    render(wrap(<Detail data={detail} standings={makeLiveStandings([ana])} />));
    await confirmClose();
    await waitFor(() => expect(screen.getByText('League closed.')).toBeTruthy());
    expect(screen.getByText('Updating standings…')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText('Final')).toBeNull();
    expect(mocks.invalidate).toHaveBeenCalled();
  });

  it('offers a retry when the post-close reload settles without final standings, then recovers', async () => {
    const detail = active({ end_mode: 'manual', end_at: null, end_date: null });
    const closedDto = makeManualLeagueDto({
      status: 'closed',
      version: 4,
      closed_at: '2030-11-01T10:00:00.000000Z',
      closed_reason: 'manual'
    });
    mocks.closeLeague.mockResolvedValue(closedDto);
    const stale = makeLiveStandings([ana]);
    const view = render(wrap(<Detail data={detail} standings={stale} />));
    await confirmClose();
    // The reload finished (or failed) but the standings still describe the old state.
    expect((await screen.findByRole('alert')).textContent).toContain('Something went wrong');
    expect(screen.queryByText('Updating standings…')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();

    mocks.invalidate.mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.invalidate).toHaveBeenCalledTimes(1);
    view.rerender(
      wrap(<Detail data={{ ...detail, league: closedDto }} standings={makeFinalStandings([ana])} />)
    );
    expect((await screen.findAllByRole('table')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Something went wrong/)).toBeNull();
  });

  it('offers a retry when the post-close reload itself fails', async () => {
    const detail = active({ end_mode: 'manual', end_at: null, end_date: null });
    mocks.closeLeague.mockResolvedValue(
      makeManualLeagueDto({ status: 'closed', version: 4, closed_reason: 'manual' })
    );
    mocks.invalidate.mockReset().mockRejectedValue(new Error('offline'));
    render(wrap(<Detail data={detail} standings={makeLiveStandings([ana])} />));
    await confirmClose();
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('offers no close action for a Fixed League and denies it to non-managers', () => {
    render(wrap(<Detail data={active()} standings={makeLiveStandings([ana])} />));
    expect(screen.queryByRole('button', { name: 'Close League' })).toBeNull();
    cleanup();
    render(
      wrap(
        <Detail
          data={makeLeagueDetail({
            ...makeManualLeagueDto({ status: 'active', can_manage: false })
          })}
          standings={makeLiveStandings([ana])}
        />
      )
    );
    expect(screen.queryByRole('button', { name: 'Close League' })).toBeNull();
  });

  it('shows the final table, closed-empty and mismatched states distinctly', () => {
    render(
      wrap(<Detail data={closed()} standings={makeFinalStandings([ana])} viewerId={ana.user_id} />)
    );
    expect(screen.getByText('Final')).toBeTruthy();
    expect(screen.getByText('You reached the minimum for the final award.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Previous Leagues' })).toBeTruthy();
    cleanup();

    render(wrap(<Detail data={closed()} standings={makeFinalStandings([])} />));
    expect(screen.getByText('No results in this League')).toBeTruthy();
    cleanup();

    // The League says closed but the standings are still live: never show it as final.
    render(wrap(<Detail data={closed()} standings={makeLiveStandings([ana])} />));
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('turns an unknown version into a safe translated error with a way back to latest', async () => {
    render(wrap(<Detail data={closed()} standingsError="LEAGUE_STANDINGS_VERSION_NOT_FOUND" />));
    expect(screen.getByRole('alert').textContent).toBe("That standings version doesn't exist.");
    await userEvent.click(screen.getByRole('button', { name: 'View latest version' }));
    const search = mocks.navigate.mock.calls[0]?.[0].search;
    expect(search?.({ version: 9 })).toEqual({ version: undefined });
  });
});

describe('final version history', () => {
  const league = makeLeagueDto({ status: 'closed', can_manage: true });
  const versions = {
    league_id: league.id,
    status: 'closed' as const,
    versions: [
      makeVersionSummary({
        standings_version: 2,
        cause: 'late_first_confirmation',
        generated_at: '2030-12-25T10:00:00.000000Z',
        confirmation: {
          source: 'AUTO_48H',
          played_at: '2030-12-19T18:00:00.000000Z',
          confirmed_at: '2030-12-25T09:59:00.000000Z'
        }
      }),
      makeVersionSummary()
    ],
    next_before_version: null
  };
  const view = (
    standings: ReturnType<typeof makeFinalStandings>,
    props: Partial<ComponentProps<typeof LeagueStandingsHistory>> = {}
  ) =>
    render(
      wrap(
        <LeagueStandingsHistory
          league={league}
          standings={standings}
          versions={versions}
          audit={null}
          auditFailed={false}
          onSelect={vi.fn<(version: number | null) => void>()}
          {...props}
        />
      )
    );

  it('explains a late first confirmation truthfully, never as a score correction', () => {
    view(
      makeFinalStandings([ana], {
        standings_version: 2,
        latest_standings_version: 2,
        cause: 'late_first_confirmation'
      })
    );
    expect(screen.getByText('First result confirmed after close')).toBeTruthy();
    const detail = screen.getByText(/was confirmed for the first time/);
    expect(detail.textContent).toContain('Earlier versions stay available');
    expect(screen.queryByText(/correct/i)).toBeNull();
    expect(screen.getByText(/Only matches played up to/)).toBeTruthy();
    expect(screen.queryByText('View latest version')).toBeNull();
  });

  it('lists versions, keeps an older selection and announces the newer one', async () => {
    const onSelect = vi.fn<(version: number | null) => void>();
    view(makeFinalStandings([ana], { standings_version: 1, latest_standings_version: 2 }), {
      onSelect
    });
    const select = screen.getByRole('combobox', { name: 'Final version' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent)
    ).toEqual([
      expect.stringMatching(/^Version 2 · latest · /),
      expect.stringMatching(/^Version 1 · /)
    ]);
    expect(select).toHaveProperty('value', '1');
    expect(screen.getByText(/older final version/)).toBeTruthy();
    expect(screen.getByText(/newer final version is available/)).toBeTruthy();
    await userEvent.selectOptions(select, '2');
    expect(onSelect).toHaveBeenLastCalledWith(null);
    await userEvent.click(screen.getByRole('button', { name: 'View latest version' }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('selects an older version by number', async () => {
    const onSelect = vi.fn<(version: number | null) => void>();
    view(makeFinalStandings([ana], { standings_version: 2, latest_standings_version: 2 }), {
      onSelect
    });
    await userEvent.selectOptions(screen.getByRole('combobox'), '1');
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('loads earlier versions page by page and survives a failed page', async () => {
    const first = { ...versions, versions: [versions.versions[0]!], next_before_version: 2 };
    mocks.listVersions.mockRejectedValueOnce(new Error('LEAGUE_UNAVAILABLE'));
    mocks.listVersions.mockResolvedValueOnce({
      ...versions,
      versions: [versions.versions[1]!],
      next_before_version: null
    });
    view(makeFinalStandings([ana], { standings_version: 2, latest_standings_version: 2 }), {
      versions: first
    });
    await userEvent.click(screen.getByRole('button', { name: 'Show earlier versions' }));
    expect((await screen.findByRole('alert')).textContent).toContain('could not be loaded');
    await userEvent.click(screen.getByRole('button', { name: 'Show earlier versions' }));
    await waitFor(() =>
      expect(screen.getByRole('combobox').querySelectorAll('option')).toHaveLength(2)
    );
    expect(mocks.listVersions).toHaveBeenLastCalledWith({
      data: { league_id: league.id, before_version: 2 }
    });
    expect(screen.queryByRole('button', { name: 'Show earlier versions' })).toBeNull();
  });

  it('degrades when the history is unavailable and marks reconstructed finals', () => {
    view(makeFinalStandings([ana]), { versions: null });
    expect(screen.getByRole('alert').textContent).toContain('Version history could not be loaded');
    expect(screen.getByRole('combobox').querySelectorAll('option')).toHaveLength(1);
    cleanup();
    view(makeFinalStandings([ana], { cause: 'reconstruction' }), {
      versions: {
        ...versions,
        versions: [makeVersionSummary({ cause: 'reconstruction', basis: 'reconstructed' })]
      }
    });
    expect(screen.getByText(/not published at the time/)).toBeTruthy();
  });

  it('shows the audit trail with translated reasons to owner/Admin', () => {
    view(makeFinalStandings([ana]), {
      audit: {
        league_id: league.id,
        events: [
          {
            action: 'standings_revised',
            actor_id: null,
            system_reason: 'late_first_confirmation',
            occurred_at: '2030-12-25T10:00:00.000000Z',
            details: { standings_version: 2 }
          },
          {
            action: 'closed',
            actor_id: STANDING_USER_A,
            system_reason: null,
            occurred_at: '2030-12-21T10:00:00.000000Z',
            details: { standings_version: 1 }
          }
        ]
      }
    });
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items[0]!.textContent).toContain('Standings revised');
    expect(items[0]!.textContent).toContain('first result confirmed after close (automatic)');
    expect(items[0]!.textContent).toContain('version 2');
    expect(items[1]!.textContent).toContain('by an owner or Admin');
  });
  it('does not attribute a participant confirmation to an owner or Admin', () => {
    view(makeFinalStandings([ana]), {
      audit: {
        league_id: league.id,
        events: [
          {
            action: 'standings_revised',
            actor_id: STANDING_USER_B,
            system_reason: null,
            occurred_at: '2030-12-25T10:00:00.000000Z',
            details: { standings_version: 2 }
          }
        ]
      }
    });
    const [item] = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(item!.textContent).toContain('after a result confirmed by a member');
    expect(item!.textContent).not.toContain('owner or Admin');
  });

  it('moves focus to the completion status when the last page removes the load button', async () => {
    const first = { ...versions, versions: [versions.versions[0]!], next_before_version: 2 };
    mocks.listVersions.mockResolvedValueOnce({
      ...versions,
      versions: [versions.versions[1]!],
      next_before_version: null
    });
    view(makeFinalStandings([ana], { standings_version: 2, latest_standings_version: 2 }), {
      versions: first
    });
    const button = screen.getByRole('button', { name: 'Show earlier versions' });
    button.focus();
    await userEvent.click(button);
    const status = await screen.findByRole('status');
    expect(status.textContent).toBe('All earlier versions are loaded.');
    expect(document.activeElement).toBe(status);
    expect(screen.queryByRole('button', { name: 'Show earlier versions' })).toBeNull();
  });

  it('retries an unavailable history without discarding the displayed snapshot', async () => {
    mocks.listVersions.mockResolvedValueOnce(versions);
    view(makeFinalStandings([ana], { standings_version: 2, latest_standings_version: 2 }), {
      versions: null
    });
    expect(screen.getByRole('alert').textContent).toContain('Version history could not be loaded');
    expect(screen.getByText(/Published Dec/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(screen.getByRole('combobox').querySelectorAll('option')).toHaveLength(2)
    );
    expect(mocks.listVersions).toHaveBeenCalledWith({
      data: { league_id: league.id, before_version: null }
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(/Published Dec/)).toBeTruthy();
  });

  it('keeps the unavailable history retryable when the retry fails too', async () => {
    mocks.listVersions.mockRejectedValueOnce(new Error('LEAGUE_UNAVAILABLE'));
    view(makeFinalStandings([ana]), { versions: null });
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(mocks.listVersions).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('alert').textContent).toContain('Version history could not be loaded');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('shows a retryable audit error to a manager and recovers on retry', async () => {
    mocks.getAudit.mockResolvedValueOnce({
      league_id: league.id,
      events: [
        {
          action: 'closed',
          actor_id: STANDING_USER_A,
          system_reason: null,
          occurred_at: '2030-12-21T10:00:00.000000Z',
          details: { standings_version: 1 }
        }
      ]
    });
    view(makeFinalStandings([ana]), { auditFailed: true });
    expect(screen.getByRole('alert').textContent).toContain('audit trail could not be loaded');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    const items = await screen.findAllByRole('listitem');
    expect(items[0]!.textContent).toContain('by an owner or Admin');
    expect(screen.queryByText(/audit trail could not be loaded/)).toBeNull();
    expect(mocks.getAudit).toHaveBeenCalledWith({ data: { league_id: league.id } });
  });

  it('shows no audit section to a viewer who may not see it', () => {
    view(makeFinalStandings([ana]), { audit: null, auditFailed: false });
    expect(screen.queryByText('Audit trail')).toBeNull();
  });
});
