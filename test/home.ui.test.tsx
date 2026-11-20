/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
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
    expect(screen.getByRole('heading', { level: 1, name: 'Hello, Thiago' })).toBeTruthy();
    expect(document.querySelector('time')?.getAttribute('datetime')).toBe(home().asOf);
    expect(document.querySelector('time')?.textContent).toBe('Saturday, June 1, 2030 · UTC');
    for (const name of ['Hello, Thiago', 'Next match', 'Needs your attention'])
      expect(screen.getByRole('region', { name })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Ranking' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Recent activity' })).toBeNull();
    expect(screen.getByTestId('badge').textContent).toBe('3');
    const next = screen.getByRole('link', { name: 'Centre Court' });
    expect(next.getAttribute('href')).toBe(`/matches/${EVENT}`);
    // 01:30Z on 2 June is still the evening of 1 June in the match's own timezone.
    expect(screen.getAllByText(/Jun 1, 2030/).length).toBeGreaterThan(0);
    expect(screen.getByText('2 results awaiting review at Centre Court')).toBeTruthy();
  });

  it.each([
    ['2030-06-01T23:30:00.000Z', 'en' as const, 'Saturday, June 1, 2030 · UTC'],
    ['2030-06-02T00:30:00.000Z', 'en' as const, 'Sunday, June 2, 2030 · UTC'],
    ['2030-06-01T23:30:00.000Z', 'pt-BR' as const, 'sábado, 1 de junho de 2030 · UTC'],
    ['2030-06-02T00:30:00.000Z', 'es' as const, 'domingo, 2 de junio de 2030 · UTC']
  ])('labels the header date as the UTC day: %s in %s', (asOf, locale, expected) => {
    view(home({ asOf }), {}, locale);
    expect(document.querySelector('time')?.textContent).toBe(expected);
  });

  it('orders the sections: header, greeting with level summary, next match, attention', () => {
    view(home(), { level: { display_level: 3.82, reliability_percent: 76 } });
    const root = document.getElementById('home-top');
    const [header, ...sections] = Array.from(root?.children ?? []);
    expect(header?.contains(screen.getByRole('combobox', { name: /Switch community/ }))).toBe(true);
    expect(header?.querySelector('time')).toBeTruthy();
    expect(header?.contains(screen.getByTestId('badge'))).toBe(true);
    expect(sections.slice(0, 3)).toEqual([
      screen.getByRole('region', { name: 'Hello, Thiago' }),
      screen.getByRole('region', { name: 'Next match' }),
      screen.getByRole('region', { name: 'Needs your attention' })
    ]);
    expect(root?.querySelectorAll('h1')).toHaveLength(1);
  });

  it('keeps the full profile, management entries and inbox off Home', () => {
    view(home());
    expect(document.getElementById('home-profile')).toBeNull();
    expect(document.getElementById('home-community')).toBeNull();
    expect(screen.queryByRole('region', { name: /Ranking|Recent activity/ })).toBeNull();
  });

  it('renders the light level summary from real data and no invented trend or progress', () => {
    view(home(), { level: { display_level: 3.82, reliability_percent: 76 } });
    const hero = screen.getByRole('region', { name: 'Hello, Thiago' });
    expect(hero.textContent).toContain('Your level');
    expect(hero.textContent).toContain('3.82');
    expect(hero.textContent).toContain('Reliability: 76%');
    expect(hero.textContent).not.toContain('ranked players');
    expect(hero.textContent).not.toMatch(/↑|↓|to 100%|this season/);
    expect(within(hero).getByRole('link', { name: 'My statistics' }).getAttribute('href')).toBe(
      '/players/me'
    );
  });

  it('keeps an unknown unread count unknown', () => {
    view(home({ unread: null }));
    expect(screen.getByTestId('badge').textContent).toBe('unknown');
  });

  it('shows errors, unavailable and empty states instead of fake content', () => {
    view(
      home({
        matches: { status: 'error' },
        actions: { status: 'empty' }
      })
    );
    expect(screen.getByRole('alert').textContent).toBe('This section could not be loaded.');
    expect(screen.getByText('Nothing needs your attention.')).toBeTruthy();
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
    expect(screen.queryByRole('region', { name: 'Next match' })).toBeNull();
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
    expect(screen.queryByRole('region', { name: 'Next match' })).toBeNull();
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
    expect(document.activeElement).toBe(screen.getByRole('combobox'));
  });

  it.each([
    ['en' as const, 'Open Centre Court'],
    ['pt-BR' as const, 'Abrir Centre Court'],
    ['es' as const, 'Abrir Centre Court']
  ])('names each action link through a translated interpolated label in %s', (locale, name) => {
    view(home(), {}, locale);
    expect(screen.getByRole('link', { name }).getAttribute('href')).toBe(`/matches/${EVENT}`);
  });

  it('renders translated, locale-formatted copy', () => {
    view(home(), {}, 'pt-BR');
    expect(screen.getByRole('heading', { level: 1, name: 'Olá, Thiago' })).toBeTruthy();
    expect(screen.getByText('Olá, Thiago')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Próxima partida' })).toBeTruthy();
    expect(screen.getByText('2 resultados aguardando revisão em Centre Court')).toBeTruthy();
  });
});

describe('Home layout contract', () => {
  const styles = readFileSync('src/features/home/home.styles.ts', 'utf8');
  const block = (name: string) =>
    styles.slice(styles.indexOf(`  ${name}: {`)).split('\n  },')[0] ?? '';

  it('leaves the bottom navigation to the protected shell instead of mounting its own bar', () => {
    expect(styles).not.toContain('navigation:');
    expect(styles).not.toContain('navClearance');
    const route = readFileSync('src/routes/_protected.dashboard.tsx', 'utf8');
    expect(route).not.toContain('Navigation');
    expect(route).not.toContain('navClearance');
  });

  it('relocates profile, management, inbox and discovery to the community surface', () => {
    const route = readFileSync('src/routes/_protected.dashboard.tsx', 'utf8');
    expect(route).not.toContain('<PlayerProfile');
    expect(route).not.toContain('home-profile');
    expect(route).not.toContain('home-community');
    const entries = readFileSync('src/features/community/CommunitySurface.tsx', 'utf8');
    // D5 (U18): the platform-admin entry lives on Me; community-scoped entries stay here.
    expect(entries).not.toContain('PlatformAdminEntry');
    expect(entries).not.toContain('platformAdmin');
    expect(readFileSync('src/features/player/PlayerProfile.tsx', 'utf8')).toContain(
      '<PlatformAdminEntry'
    );
    for (const entry of [
      'CommunityAdminEntries',
      'LeagueEntries',
      'CommunityInbox',
      'InvitationDiscoverability'
    ])
      expect(entries).toContain(`<${entry}`);
  });

  it('guarantees a token-backed minimum width as well as height for text links', () => {
    const link = block('link');
    expect(link).toContain('minHeight: target');
    expect(link).toContain('minWidth: target');
  });
});
