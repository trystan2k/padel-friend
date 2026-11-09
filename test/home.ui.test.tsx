/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from '../src/i18n/config';
import type { HomeData } from '../src/features/home/home-contracts';

vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  Link: ({ children, to, params, ...rest }: any) => (
    <a
      href={String(to)
        .replace('$eventId', params?.eventId ?? '')
        .replace('$communityId', params?.communityId ?? '')
        .replace('$leagueId', params?.leagueId ?? '')
        .replace('$playerId', params?.playerId ?? '')}
      {...rest}
    >
      {children}
    </a>
  )
}));
vi.mock('../src/features/notifications/NotificationBadge', () => ({
  NotificationBadge: ({ count }: { count: number | null }) => (
    <span data-testid="badge">{count === null ? 'unknown' : String(count)}</span>
  )
}));

import { HomeDashboard } from '../src/features/home/HomeDashboard';
import { HomeNavigation } from '../src/features/home/HomeNavigation';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const EVENT = '00000000-0000-4000-8000-0000000000e1';

function home(overrides: Partial<HomeData> = {}): HomeData {
  return {
    asOf: '2030-06-01T12:00:00.000Z',
    communities: {
      status: 'ok',
      value: [
        { id: A, name: 'Alpha Club' },
        { id: B, name: 'Beta Club' }
      ]
    },
    selection: { selectedId: A, requestedUnavailable: false },
    matches: {
      status: 'ok',
      value: {
        next: {
          event_id: EVENT,
          venue_name: 'Centre Court',
          starts_at: '2030-06-02T01:30:00.000Z',
          timezone: 'America/Sao_Paulo',
          community_name: 'Alpha Club',
          caller_badge: 'playing',
          playing_count: 5,
          more_needed: 3,
          competition_status: 'ranked'
        },
        available: []
      }
    },
    actions: {
      status: 'ok',
      value: {
        partial: false,
        items: [
          {
            kind: 'result_review',
            event_id: EVENT,
            venue_name: 'Centre Court',
            starts_at: '2030-05-30T18:00:00.000Z',
            timezone: 'UTC',
            count: 2
          }
        ]
      }
    },
    ranking: {
      status: 'ok',
      value: {
        skill: {
          status: 'ok',
          value: { status: 'ranked', position: 2, rankedMembers: 10, movement: { state: 'new' } }
        },
        league: {
          status: 'ok',
          value: {
            league_id: '00000000-0000-4000-8000-0000000000c1',
            name: 'Summer League',
            activeCount: 2,
            activeCountExact: true,
            top: [
              { user_id: 'u1', display_name: 'Ana', position: 1, wins: 3, losses: 0, isSelf: false }
            ],
            self: {
              user_id: 'me',
              display_name: 'Me',
              position: 4,
              wins: 1,
              losses: 2,
              isSelf: true
            },
            movement: { state: 'up', places: 2 }
          }
        }
      }
    },
    activity: {
      status: 'ok',
      value: [
        {
          kind: 'rating',
          at: '2030-05-20T00:00:00.000Z',
          scope: 'global',
          event_id: EVENT,
          delta: 0.25,
          level: 3.4,
          reliability: 50
        }
      ]
    },
    unread: 3,
    ...overrides
  };
}

function view(
  data: HomeData | null,
  props: Partial<Parameters<typeof HomeDashboard>[0]> = {},
  locale: 'en' | 'pt-BR' | 'es' = 'en'
) {
  const onSelect = vi.fn<(id: string) => void>();
  const onRetry = vi.fn<() => void>();
  const ui = (next: HomeData | null) => (
    <I18nextProvider i18n={createI18n(locale)}>
      <HomeDashboard
        home={next}
        playerId="me"
        displayName="Thiago"
        onSelect={onSelect}
        onRetry={onRetry}
        {...props}
      />
    </I18nextProvider>
  );
  const result = render(ui(data));
  return {
    ...result,
    onSelect,
    onRetry,
    rerenderWith: (next: HomeData | null) => result.rerender(ui(next))
  };
}

afterEach(cleanup);

describe('Home dashboard', () => {
  it('renders every section with labelled landmarks and account-wide unread state', () => {
    view(home());
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeTruthy();
    expect(screen.getByText('Hello, Thiago')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Thiago/ })).toBeNull();
    for (const name of ['Needs your attention', 'Next match', 'Ranking', 'Recent activity'])
      expect(screen.getByRole('region', { name })).toBeTruthy();
    expect(screen.getByTestId('badge').textContent).toBe('3');
    const next = screen.getByRole('link', { name: 'Centre Court' });
    expect(next.getAttribute('href')).toBe(`/matches/${EVENT}`);
    // 01:30Z on 2 June is still the evening of 1 June in the match's own timezone.
    expect(screen.getAllByText(/Jun 1, 2030/).length).toBeGreaterThan(0);
    expect(screen.getByText('2 results awaiting review at Centre Court')).toBeTruthy();
  });

  it('keeps an unknown unread count unknown', () => {
    view(home({ unread: null }));
    expect(screen.getByTestId('badge').textContent).toBe('unknown');
  });

  it('labels the skill rank, League context and movement explicitly', () => {
    view(home());
    const ranking = screen.getByRole('region', { name: 'Ranking' });
    expect(within(ranking).getByText(/#2 of 10 ranked players · New entry/)).toBeTruthy();
    expect(within(ranking).getByText('Community skill rank')).toBeTruthy();
    expect(within(ranking).getByRole('link', { name: 'League: Summer League' })).toBeTruthy();
    expect(within(ranking).getByText('First of 2 active Leagues')).toBeTruthy();
    expect(within(ranking).getByText('Up 2 places since the last published rank')).toBeTruthy();
    expect(within(ranking).getByText(/You/)).toBeTruthy();
    expect(within(ranking).getByRole('link', { name: 'Community statistics' })).toBeTruthy();
    const activity = screen.getByRole('region', { name: 'Recent activity' });
    expect(within(activity).getByText(/Global rating/)).toBeTruthy();
  });

  it('shows errors, unavailable and empty states instead of fake content', () => {
    view(
      home({
        matches: { status: 'error' },
        actions: { status: 'empty' },
        ranking: { status: 'unavailable' },
        activity: { status: 'empty' }
      })
    );
    expect(screen.getByRole('alert').textContent).toBe('This section could not be loaded.');
    expect(screen.getByText('Nothing needs your attention.')).toBeTruthy();
    expect(screen.getByText('This section is not available right now.')).toBeTruthy();
    expect(screen.getByText('No confirmed activity yet.')).toBeTruthy();
  });

  it('flags an incomplete action list', () => {
    view(home({ actions: { status: 'ok', value: { items: [], partial: true } } }));
    expect(screen.getByRole('status').textContent).toContain('may be incomplete');
  });

  it('offers discovery when the caller has no community and hides the switcher', () => {
    view(
      home({
        communities: { status: 'empty' },
        selection: { selectedId: null, requestedUnavailable: false },
        matches: { status: 'unavailable' },
        actions: { status: 'unavailable' },
        ranking: { status: 'unavailable' }
      })
    );
    expect(screen.getByRole('link', { name: 'Find a community' }).getAttribute('href')).toBe(
      '/onboarding/community'
    );
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('shows a generic notice for a revoked selection without any private name', () => {
    view(home({ selection: { selectedId: A, requestedUnavailable: true } }));
    expect(screen.getByRole('status').textContent).toBe(
      'That community is not available to you. Showing your default community instead.'
    );
  });

  it('shows an explicit Home error with retry, never empty sections', async () => {
    const { onRetry } = view(null);
    expect(screen.getByRole('alert').textContent).toContain('Home could not be loaded.');
    expect(screen.queryByRole('region', { name: 'Ranking' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('switches community from the keyboard and resets community sections until the reply lands', async () => {
    const user = userEvent.setup();
    const { onSelect, rerenderWith } = view(home());
    const trigger = screen.getByRole('combobox', { name: /Switch community/ });
    expect(trigger.textContent).toContain('Alpha Club');
    trigger.focus();
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('option', { name: 'Beta Club' }));
    expect(onSelect).toHaveBeenCalledWith(B);
    // Old community DTOs are gone synchronously while the new load is in flight.
    expect(screen.getByText('Loading community…')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Ranking' })).toBeNull();
    expect(screen.queryByText('Centre Court')).toBeNull();

    rerenderWith(
      home({
        asOf: '2030-06-01T12:00:05.000Z',
        selection: { selectedId: B, requestedUnavailable: false },
        matches: { status: 'empty' }
      })
    );
    expect(screen.queryByText('Loading community…')).toBeNull();
    expect(screen.getByText('No upcoming match in this community.')).toBeTruthy();
    expect(screen.getByRole('combobox').textContent).toContain('Beta Club');
  });

  it('renders translated, locale-formatted copy', () => {
    view(home(), {}, 'pt-BR');
    expect(screen.getByRole('heading', { level: 1, name: 'Início' })).toBeTruthy();
    expect(screen.getByText('Olá, Thiago')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Próxima partida' })).toBeTruthy();
    expect(screen.getByText('2 resultados aguardando revisão em Centre Court')).toBeTruthy();
    expect(screen.getByText(/2º de 10 jogadores no ranking/)).toBeTruthy();
  });
});

describe('Home navigation', () => {
  it('exposes working destinations for every item', () => {
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <div id="home-top" />
        <HomeNavigation />
      </I18nextProvider>
    );
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    const hrefs = within(nav)
      .getAllByRole('link')
      .map((link) => [link.textContent, link.getAttribute('href')]);
    expect(hrefs).toEqual([
      ['Home', '#home-top'],
      ['Matches', '/matches'],
      ['Community', '#home-community'],
      ['Ranking', '#home-ranking'],
      ['Profile', '#home-profile']
    ]);
    expect(within(nav).getByRole('link', { name: 'Home' }).getAttribute('aria-current')).toBe(
      'page'
    );
  });
});
