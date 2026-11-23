/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from '../src/i18n/config';
import type { HomeData, HomeMatchCard } from '../src/features/home/home-contracts';

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
const NEXT_MATCH: HomeMatchCard = {
  event_id: EVENT,
  venue_name: 'Centre Court',
  starts_at: '2030-06-02T01:30:00.000Z',
  timezone: 'America/Sao_Paulo',
  community_name: 'Alpha Club',
  caller_badge: 'playing',
  playing_count: 5,
  more_needed: 3,
  competition_status: 'ranked'
};

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
        next: NEXT_MATCH,
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
    view(home(), { level: { display_level: 3.82, reliability_percent: 76 } });
    expect(screen.getByRole('heading', { level: 1, name: 'Hello, Thiago' })).toBeTruthy();
    expect(document.querySelector('time')?.getAttribute('datetime')).toBe(home().asOf);
    expect(document.querySelector('time')?.textContent).toBe('Saturday, June 1, 2030 · UTC');
    for (const name of ['Your level', 'Next match', 'Needs your attention'])
      expect(screen.getByRole('region', { name })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Ranking' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Recent activity' })).toBeNull();
    expect(screen.getByTestId('badge').textContent).toBe('3');
    const next = screen.getByRole('article', { name: 'Centre Court' });
    expect(within(next).getByRole('link', { name: 'Open match' }).getAttribute('href')).toBe(
      `/matches/${EVENT}`
    );
    // 01:30Z on 2 June is still the evening of 1 June in the match's own timezone.
    expect(within(next).getByText('Sat, Jun 1, 10:30 PM GMT-3')).toBeTruthy();
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

  it('orders the surface: pill and bell, date then greeting, level card, next match, attention', () => {
    view(home(), { level: { display_level: 3.82, reliability_percent: 76 } });
    const root = document.getElementById('home-top');
    const [header, greeting, ...sections] = Array.from(root?.children ?? []);
    expect(header?.contains(screen.getByRole('combobox', { name: /Switch community/ }))).toBe(true);
    expect(header?.contains(screen.getByTestId('badge'))).toBe(true);
    expect(header?.querySelector('time')).toBeNull();
    expect(Array.from(greeting?.children ?? []).map((child) => child.tagName)).toEqual([
      'TIME',
      'H1'
    ]);
    expect(sections.slice(0, 3)).toEqual([
      screen.getByRole('region', { name: 'Your level' }),
      screen.getByRole('region', { name: 'Next match' }),
      screen.getByRole('region', { name: 'Needs your attention' })
    ]);
    expect(root?.querySelectorAll('h1')).toHaveLength(1);
  });

  it('renders the community pill with an initial avatar and the selected name', () => {
    view(home());
    const pill = screen.getByRole('combobox', { name: /Switch community/ });
    expect(pill.textContent).toContain('Alpha Club');
    expect(pill.querySelector('[aria-hidden="true"]')?.textContent).toBe('A');
    expect(pill.textContent).toContain('▾');
  });

  it('keeps the full profile, management entries and inbox off Home', () => {
    view(home());
    expect(document.getElementById('home-profile')).toBeNull();
    expect(document.getElementById('home-community')).toBeNull();
    expect(screen.queryByRole('region', { name: /Ranking|Recent activity/ })).toBeNull();
  });

  it('renders the light level card from real data with rank, meter and no invented trend', () => {
    view(home(), { level: { display_level: 3.82, reliability_percent: 76 } });
    const card = screen.getByRole('region', { name: 'Your level' });
    expect(card.textContent).toContain('Your level');
    expect(card.textContent).toContain('3.82');
    expect(card.textContent).toContain('Reliability 76%');
    expect(card.textContent).toContain('#2');
    expect(card.textContent).toContain('of 10');
    expect(card.textContent).not.toMatch(/↑|↓|to 100%|this season/);
    expect(within(card).getByText('#2 of 10 ranked players')).toBeTruthy();
    const meter = within(card).getByRole('meter', { name: 'Reliability' });
    expect(meter.getAttribute('value')).toBe('76');
    expect(meter.getAttribute('aria-valuetext')).toBe('76%');
    expect(meter.getAttribute('min')).toBe('0');
    expect(meter.getAttribute('max')).toBe('100');
    expect(within(card).getByRole('link', { name: 'My statistics' }).getAttribute('href')).toBe(
      '/players/me'
    );
  });

  it('clamps the reliability meter to its range', () => {
    view(home(), { level: { display_level: 3.82, reliability_percent: 140 } });
    const meter = screen.getByRole('meter', { name: 'Reliability' });
    expect(meter.getAttribute('value')).toBe('100');
  });

  const ranking = (skill: HomeData['ranking']): Partial<HomeData> => ({ ranking: skill });
  const skillOk = (value: {
    status: 'ranked' | 'unrated' | 'not_member';
    position: number | null;
    rankedMembers: number | null;
  }): HomeData['ranking'] => ({
    status: 'ok',
    value: {
      skill: { status: 'ok', value: { ...value, movement: null } },
      league: { status: 'empty' }
    }
  });
  const level = { display_level: 3.82, reliability_percent: 76 };

  it('omits the rank denominator when the read does not provide it and never derives it', () => {
    view(home(ranking(skillOk({ status: 'ranked', position: 4, rankedMembers: null }))), { level });
    const card = screen.getByRole('region', { name: 'Your level' });
    expect(within(card).getByText('#4 in this community')).toBeTruthy();
    expect(card.textContent).toContain('#4');
    expect(card.textContent).not.toMatch(/\bof\b/);
    // Two communities exist in the switcher; that count must never appear as a rank total.
    expect(card.textContent).not.toContain('of 2');
  });

  it('omits an inconsistent denominator smaller than the position', () => {
    view(home(ranking(skillOk({ status: 'ranked', position: 4, rankedMembers: 3 }))), { level });
    expect(screen.getByText('#4 in this community')).toBeTruthy();
  });

  it.each([
    ['unrated', skillOk({ status: 'unrated', position: null, rankedMembers: 12 })],
    ['not a member', skillOk({ status: 'not_member', position: null, rankedMembers: 12 })],
    ['ranked without position', skillOk({ status: 'ranked', position: null, rankedMembers: 12 })],
    ['unavailable', { status: 'unavailable' }],
    ['failed', { status: 'error' }],
    [
      'skill read failed',
      { status: 'ok', value: { skill: { status: 'error' }, league: { status: 'empty' } } }
    ]
  ] satisfies [string, HomeData['ranking']][])(
    'shows no rank for %s ranking but keeps the level and meter',
    (_name, ranked) => {
      view(home(ranking(ranked)), { level });
      const card = screen.getByRole('region', { name: 'Your level' });
      expect(within(card).queryByText(/ranked players|in this community/)).toBeNull();
      expect(card.textContent).not.toContain('#');
      expect(card.textContent).toContain('3.82');
      expect(within(card).getByRole('meter', { name: 'Reliability' })).toBeTruthy();
    }
  );

  it('hides the community rank while a community switch is pending', async () => {
    const user = userEvent.setup();
    view(home(), { level });
    expect(screen.getByText('#2 of 10 ranked players')).toBeTruthy();
    screen.getByRole('combobox', { name: /Switch community/ }).focus();
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('option', { name: 'Beta Club' }));
    expect(screen.queryByText(/ranked players/)).toBeNull();
    expect(screen.getByRole('region', { name: 'Your level' }).textContent).toContain('3.82');
  });

  it('shows the Ranked chip only for a Ranked next match', () => {
    const withStatus = (status: 'ranked' | 'unranked' | null) =>
      home({
        matches: {
          status: 'ok',
          value: { available: [], next: { ...NEXT_MATCH, competition_status: status } }
        }
      });
    view(withStatus('ranked'));
    expect(within(screen.getByRole('article')).getByText('Ranked')).toBeTruthy();
    cleanup();
    for (const status of ['unranked', null] as const) {
      view(withStatus(status));
      expect(within(screen.getByRole('article')).queryByText('Ranked')).toBeNull();
      cleanup();
    }
  });

  it('keeps open matches reachable through the Matches link instead of repeating the list', () => {
    view(
      home({
        matches: {
          status: 'ok',
          value: { next: NEXT_MATCH, available: [{ ...NEXT_MATCH, event_id: B }] }
        }
      })
    );
    expect(screen.queryByText('Open matches')).toBeNull();
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'All matches' }).getAttribute('href')).toBe('/matches');
  });

  it('keeps the Matches link when there is no next match', () => {
    view(home({ matches: { status: 'empty' } }));
    expect(screen.getByText('No upcoming match in this community.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'All matches' })).toBeNull();
    cleanup();
    view(home({ matches: { status: 'ok', value: { next: null, available: [] } } }));
    expect(screen.getByText('No upcoming match in this community.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'All matches' }).getAttribute('href')).toBe('/matches');
  });

  it('renders each attention item as one real link with a glyph tile and chevron', () => {
    view(
      home({
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
                count: 1
              },
              {
                kind: 'reserve_standby',
                event_id: B,
                venue_name: 'Side Court',
                starts_at: '2030-05-31T18:00:00.000Z',
                timezone: 'UTC',
                count: null
              }
            ]
          }
        }
      })
    );
    const items = within(screen.getByRole('region', { name: 'Needs your attention' })).getAllByRole(
      'listitem'
    );
    expect(items).toHaveLength(2);
    const first = within(items[0]!).getByRole('link', {
      name: /1 result awaiting review at Centre Court/
    });
    expect(first.getAttribute('href')).toBe(`/matches/${EVENT}`);
    expect(first.textContent).toContain('›');
    expect(first.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
    expect(
      within(items[1]!)
        .getByRole('link', { name: /You are on the Reserve list at Side Court/ })
        .getAttribute('href')
    ).toBe(`/matches/${B}`);
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
    ['en' as const, /^2 results awaiting review at Centre Court/, 'Open match', 'of 10'],
    [
      'pt-BR' as const,
      /^2 resultados aguardando revisão em Centre Court/,
      'Abrir partida',
      'de 10'
    ],
    [
      'es' as const,
      /^2 resultados pendientes de revisión en Centre Court/,
      'Abrir partido',
      'de 10'
    ]
  ])(
    'names the attention and next-match links and the rank from translated copy in %s',
    (locale, attention, open, of) => {
      view(home(), { level: { display_level: 3.82, reliability_percent: 76 } }, locale);
      expect(screen.getByRole('link', { name: attention }).getAttribute('href')).toBe(
        `/matches/${EVENT}`
      );
      expect(screen.getByRole('link', { name: open }).getAttribute('href')).toBe(
        `/matches/${EVENT}`
      );
      expect(
        screen.getByRole('region', { name: /^(Your level|Seu nível|Tu nivel)$/ }).textContent
      ).toContain(of);
    }
  );

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

  it('keeps the pill, bell, attention rows and open button at 44px or larger and token-driven', () => {
    expect(block('pill')).toContain('minHeight: target');
    expect(block('openButton')).toContain('minHeight: bell');
    expect(block('attentionLink')).toContain('minHeight:');
    const bellStyles = readFileSync('src/features/notifications/notifications.styles.ts', 'utf8');
    expect(bellStyles).toMatch(
      /badgeLink: \{[^}]*width: 'calc\(var\(--space-40\) \+ var\(--space-8\)\)'/s
    );
    expect(styles).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
