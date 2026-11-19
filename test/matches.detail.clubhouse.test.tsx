/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from '@testing-library/react';
import { readdirSync } from 'node:fs';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from '../src/i18n/config';
import type { Locale } from '../src/i18n/config';
import type { MyMatchRegistration } from '../src/features/matches/match-registration-model';
import en from '../src/locales/en/translation.json';
import pt from '../src/locales/pt-BR/translation.json';
import es from '../src/locales/es/translation.json';

vi.mock('../src/features/matches/match-registration.functions', () => ({
  submitMatchRegistration: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  decideMatchRegistration: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  getMyMatchRegistration: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  listMatchEventRegistrationRequests: vi.fn<(...args: unknown[]) => Promise<unknown>>()
}));
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  useRouter: () => ({ invalidate: vi.fn<() => Promise<void>>() }),
  Link: ({ children, to, ...props }: import('react').ComponentProps<'a'> & { to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  )
}));

import { MatchDetailPage } from '../src/features/matches/MatchDetailPage';
import type { MatchEventDetail } from '../src/features/matches/match-contracts';
import { MatchStatusBanner } from '../src/features/matches/MatchStatusBanner';
import { makeMatchDetail } from './helpers/match-fixtures';
import { makeMatchManagement } from './helpers/match-management-capabilities';

const EVENT_ID = '00000000-0000-4000-8000-000000000001';

// The wall clock keeps the cutoff in the future so no fixture ages into the closed state.
function detail(extra: Partial<MatchEventDetail> = {}): MatchEventDetail {
  const startsAtMs = Date.now() + 9 * 60 * 60 * 1000;
  return makeMatchDetail({
    event_id: EVENT_ID,
    venue_name: 'Court Central',
    maps_url: 'https://www.google.com/maps/place/Court+Central',
    photo_url: null,
    timezone: 'UTC',
    starts_at: new Date(startsAtMs).toISOString(),
    registration_cutoff_at: new Date(startsAtMs - 60 * 60 * 1000).toISOString(),
    event_type: 'friendly',
    visibility: 'community_open',
    competition_status: null,
    league_name: null,
    price_minor: 850,
    currency: 'EUR',
    accepted_count: 6,
    playing_count: 4,
    reserve_count: 2,
    reserve_not_playing_count: 0,
    group_count: 1,
    more_needed: 2,
    maximum_registrations: 8,
    registration_open: true,
    caller_eligibility: 'member',
    caller_requires_approval: false,
    caller_is_invited: false,
    caller_badge: null,
    restriction_enabled: true,
    min_level: 2.5,
    max_level: 5,
    is_past: false,
    ...extra
  });
}

const none: MyMatchRegistration = { state: 'none' };
const pending: MyMatchRegistration = {
  state: 'pending',
  event_id: EVENT_ID,
  registration_source: 'member',
  requested_at: '2026-10-18T09:30:00.000Z'
};
const accepted = (
  extra: Partial<Extract<MyMatchRegistration, { state: 'accepted' }>> = {}
): MyMatchRegistration => ({
  state: 'accepted',
  event_id: EVENT_ID,
  participation: 'playing',
  accepted_order: 3,
  position: 3,
  registration_source: 'member',
  requested_at: '2026-10-18T09:00:00.000Z',
  approved_at: null,
  accepted_at: '2026-10-18T09:41:00.000Z',
  ...extra
});

function mount(
  event: MatchEventDetail,
  registration: MyMatchRegistration | null = none,
  locale: Locale = 'en'
) {
  return render(
    <I18nextProvider i18n={createI18n(locale)}>
      <MatchDetailPage
        event={event}
        registration={registration}
        callerLevel={3.2}
        management={makeMatchManagement()}
      />
    </I18nextProvider>
  );
}

afterEach(cleanup);

describe('clubhouse match detail hero', () => {
  it('orders header, hero, participation, registration action and eligibility', () => {
    mount(detail());
    const heading = (name: string, level = 2) => screen.getByRole('heading', { level, name });
    const ordered = [
      heading(en.matches.detail.title, 1),
      heading('Court Central'),
      heading(en.matches.detail.participation),
      heading(en.matchRegistration.place.title),
      heading(en.matches.detail.eligibilityVisibility)
    ];
    for (let index = 1; index < ordered.length; index += 1)
      expect(
        ordered[index - 1]!.compareDocumentPosition(ordered[index]!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        `heading ${index} must follow heading ${index - 1}`
      ).toBeTruthy();
  });

  it('renders hero metrics, reserve row and chips from real event data only', () => {
    mount(detail({ event_type: 'competitive', competition_status: 'ranked', league_name: null }));
    const overview = screen.getByRole('heading', { name: 'Court Central' }).closest('section')!;
    expect(within(overview).getByText(en.matches.type.competitive)).toBeTruthy();
    expect(within(overview).getByText(en.matches.competition.ranked)).toBeTruthy();
    const participation = screen
      .getByRole('heading', { name: en.matches.detail.participation })
      .closest('section')!;
    expect(within(participation).getByText('4/8')).toBeTruthy();
    expect(within(participation).getByText('2.5–5')).toBeTruthy();
    expect(within(participation).getByText('€8.50')).toBeTruthy();
    expect(within(participation).getByText(en.matches.detail.hero.reserveQueue)).toBeTruthy();
    expect(within(participation).getByText(en.matches.detail.hero.reserveQueueNote)).toBeTruthy();
    expect(within(participation).getByText('2', { selector: 'span' })).toBeTruthy();
  });

  it('shows truthful unavailable metrics instead of inventing them', () => {
    mount(
      detail({
        price_minor: null,
        currency: null,
        restriction_enabled: false,
        min_level: null,
        max_level: null,
        maximum_registrations: null,
        reserve_count: 0
      })
    );
    const participation = screen
      .getByRole('heading', { name: en.matches.detail.participation })
      .closest('section')!;
    expect(within(participation).queryByText(en.matches.detail.hero.perPlayer)).toBeNull();
    expect(within(participation).getByText(en.matches.detail.hero.anyLevel)).toBeTruthy();
    expect(within(participation).getByText('4')).toBeTruthy();
    expect(within(participation).getByText('0', { selector: 'span' })).toBeTruthy();
  });

  it('keeps share in the header and the map link as an external fallback', () => {
    mount(detail());
    const header = screen.getByRole('heading', { level: 1 }).closest('header')!;
    const share = within(header).getByRole('button', { name: en.matches.detail.share });
    expect(share.textContent).toBe(en.matches.detail.hero.shareHeader);
    const map = screen.getByRole('link', {
      name: en.matches.detail.viewCourtLocationFor.replace('{{venue}}', 'Court Central')
    });
    expect(map.getAttribute('href')).toBe('https://www.google.com/maps/place/Court+Central');
    expect(map.getAttribute('rel')).toContain('noopener');
  });
});

describe('participation variants map to truthful actions', () => {
  const join = en.matchRegistration.join;
  const cta = (name: string) => screen.queryByRole('button', { name });
  const cases: Array<{
    name: string;
    frame: string;
    event: Partial<MatchEventDetail>;
    registration: MyMatchRegistration;
    check: () => void;
  }> = [
    {
      name: 'direct join',
      frame: 'fo8Zn',
      event: {},
      registration: none,
      check: () => {
        expect(screen.getByRole<HTMLButtonElement>('button', { name: join.button }).disabled).toBe(
          false
        );
        expect(cta(join.requestButton)).toBeNull();
      }
    },
    {
      name: 'approval required',
      frame: 'eYIgj / nNzWb',
      event: { caller_eligibility: 'nonmember', caller_requires_approval: true },
      registration: none,
      check: () => {
        expect(
          screen.getByRole<HTMLButtonElement>('button', { name: join.requestButton }).disabled
        ).toBe(false);
        expect(cta(join.button)).toBeNull();
      }
    },
    {
      name: 'full',
      frame: 'SYMLa',
      event: { accepted_count: 8, maximum_registrations: 8 },
      registration: none,
      check: () => {
        expect(
          screen.getByRole<HTMLButtonElement>('button', { name: en.matchRegistration.full.button })
            .disabled
        ).toBe(true);
        expect(cta(join.button)).toBeNull();
        expect(cta(join.requestButton)).toBeNull();
      }
    },
    {
      name: 'closed',
      frame: 'tYXlh',
      event: { registration_cutoff_at: '2020-01-01T00:00:00.000Z' },
      registration: none,
      check: () => {
        expect(cta(join.button)).toBeNull();
        expect(cta(join.requestButton)).toBeNull();
        expect(screen.getAllByText(en.matchRegistration.closed.badge).length).toBeGreaterThan(0);
      }
    },
    {
      name: 'pending request',
      frame: 'Za6r4',
      event: { caller_eligibility: 'nonmember', caller_requires_approval: true },
      registration: pending,
      check: () => {
        expect(cta(join.button)).toBeNull();
        expect(cta(join.requestButton)).toBeNull();
        expect(screen.getByText(en.matchRegistration.request.pendingBadge)).toBeTruthy();
      }
    },
    {
      name: 'playing',
      frame: 'Cpd7L / t1ywa',
      event: { caller_badge: 'playing' },
      registration: accepted(),
      check: () => {
        expect(cta(join.button)).toBeNull();
        expect(screen.getByText('Joined · Playing · Group 1')).toBeTruthy();
      }
    },
    {
      name: 'reserve',
      frame: 'xC04T / t1ywa',
      event: { caller_badge: 'reserve' },
      registration: accepted({ participation: 'reserve', position: 6, accepted_order: 6 }),
      check: () => {
        expect(cta(join.button)).toBeNull();
        expect(screen.getByText('Joined · Reserve #2')).toBeTruthy();
      }
    },
    {
      name: 'invited',
      frame: 'Fyhbv',
      event: { caller_is_invited: true, visibility: 'invite_only' },
      registration: none,
      check: () => {
        expect(cta(join.button)).toBeNull();
        expect(cta(join.requestButton)).toBeNull();
        expect(screen.getByText(en.matches.detail.invitationInfo)).toBeTruthy();
      }
    }
  ];
  it.each(cases)('$name ($frame)', ({ event, registration, check }) => {
    mount(detail(event), registration);
    expect(() => check()).not.toThrow();
  });
});

describe('sentence-case copy', () => {
  const keys: Array<(tree: typeof en) => string> = [
    (tree) => tree.matchRegistration.badges.playing,
    (tree) => tree.matchRegistration.badges.reserve,
    (tree) => tree.matchRegistration.badges.reserveNotPlaying,
    (tree) => tree.matchRegistration.badges.guest,
    (tree) => tree.matchRegistration.badges.creator,
    (tree) => tree.matchRegistration.badges.member,
    (tree) => tree.matchRegistration.roster.groupTitle,
    (tree) => tree.matchRegistration.roster.reserveTitle,
    (tree) => tree.matchRegistration.roster.notPlayingTitle,
    (tree) => tree.matchRegistration.closed.badge,
    (tree) => tree.matchRegistration.closed.button,
    (tree) => tree.matchRegistration.full.badge,
    (tree) => tree.matchRegistration.full.button,
    (tree) => tree.matchRegistration.join.button,
    (tree) => tree.matchRegistration.join.requestButton,
    (tree) => tree.matchRegistration.queue.approve,
    (tree) => tree.matchRegistration.queue.decline,
    (tree) => tree.matchRegistration.request.declinedBadge,
    (tree) => tree.matchRegistration.request.expiredBadge,
    (tree) => tree.matchRegistration.request.approvedPlayingBadge
  ];
  it.each([
    ['en', en],
    ['pt-BR', pt],
    ['es', es]
  ] as const)('keeps registration badges and controls out of capitals in %s', (_locale, tree) => {
    const capitals = keys
      .map((pick) => pick(tree).replace(/\{\{[^}]+\}\}/g, ''))
      .filter((value) => value === value.toUpperCase());
    expect(capitals).toEqual([]);
  });
});

describe('accessibility and access', () => {
  it('announces the status banner politely', () => {
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <MatchStatusBanner variant="closed" />
      </I18nextProvider>
    );
    const live = screen.getByRole('status');
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.getAttribute('aria-atomic')).toBe('true');
  });

  it('keeps the primary action a focusable native button', () => {
    mount(detail());
    const button = screen.getByRole('button', { name: en.matchRegistration.join.button });
    button.focus();
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('type')).toBe('button');
  });

  it('offers no public match route: the detail stays under the protected layout (D3)', () => {
    const routes = readdirSync('src/routes');
    expect(routes).toContain('_protected.matches.$eventId.tsx');
    expect(routes.filter((file) => /^matches[.$]/.test(file))).toEqual([]);
  });
});
