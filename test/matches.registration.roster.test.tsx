/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from '../src/i18n/config';
import type {
  MatchRosterEntry,
  MyMatchRegistration
} from '../src/features/matches/match-registration-model';
import { parseMatchRoster } from '../src/features/matches/match-registration-model';
import en from '../src/locales/en/translation.json';
import pt from '../src/locales/pt-BR/translation.json';
import es from '../src/locales/es/translation.json';

const mocks = vi.hoisted(() => ({
  submit: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  decide: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  invalidate: vi.fn<() => Promise<void>>()
}));

vi.mock('../src/features/matches/match-registration.functions', () => ({
  submitMatchRegistration: mocks.submit,
  decideMatchRegistration: mocks.decide,
  getMyMatchRegistration: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  listMatchEventRegistrationRequests: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  listMatchEventRegistrations: vi.fn<(...args: unknown[]) => Promise<unknown>>()
}));
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  useRouter: () => ({ invalidate: mocks.invalidate }),
  Link: ({ children, to }: { children: import('react').ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  )
}));

import { MatchRegistrationPanel } from '../src/features/matches/MatchRegistrationPanel';

const EVENT_ID = '00000000-0000-4000-8000-000000000001';

function event(extra: Record<string, unknown> = {}) {
  return {
    event_id: EVENT_ID,
    venue_name: 'Court Central',
    timezone: 'UTC',
    starts_at: '2026-10-20T18:30:00.000Z',
    registration_cutoff_at: '2026-10-20T17:30:00.000Z',
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
    caller_badge: 'member',
    restriction_enabled: false,
    min_level: null,
    max_level: null,
    is_past: false,
    ...extra
  };
}

function accepted(
  extra: Partial<Extract<MyMatchRegistration, { state: 'accepted' }>> = {}
): MyMatchRegistration {
  return {
    state: 'accepted',
    event_id: EVENT_ID,
    participation: 'playing',
    accepted_order: 2,
    position: 2,
    registration_source: 'member',
    requested_at: '2026-10-18T09:00:00.000Z',
    approved_at: '2026-10-18T09:41:00.000Z',
    accepted_at: '2026-10-18T09:41:00.000Z',
    ...extra
  };
}

function entry(extra: Partial<MatchRosterEntry> = {}): MatchRosterEntry {
  return {
    display_name: 'Ada Player',
    display_level: 3.5,
    participation: 'playing',
    group_number: 1,
    reserve_position: null,
    registration_source: 'member',
    accepted_order: 1,
    ...extra
  };
}

const ROSTER: MatchRosterEntry[] = [
  entry({ display_name: 'Ada One', display_level: 3.5, accepted_order: 1 }),
  entry({ display_name: 'Bea Two', display_level: 4, accepted_order: 2 }),
  entry({
    display_name: 'Cleo Guest',
    display_level: null,
    registration_source: 'guest',
    accepted_order: 3
  }),
  entry({ display_name: 'Dan Four', display_level: 3, accepted_order: 4 }),
  entry({
    display_name: 'Eve Reserve',
    display_level: 5,
    participation: 'reserve',
    group_number: null,
    reserve_position: 1,
    accepted_order: 5
  }),
  entry({
    display_name: 'Finn Guest',
    display_level: null,
    participation: 'reserve',
    group_number: null,
    reserve_position: 2,
    registration_source: 'guest',
    accepted_order: 6
  })
];

const DUE_ROSTER: MatchRosterEntry[] = [
  ...ROSTER.slice(0, 4),
  entry({
    display_name: 'Eve Reserve',
    display_level: 5,
    participation: 'reserve_not_playing',
    group_number: null,
    reserve_position: 1,
    accepted_order: 5
  }),
  entry({
    display_name: 'Finn Guest',
    display_level: null,
    participation: 'reserve_not_playing',
    group_number: null,
    reserve_position: 2,
    registration_source: 'guest',
    accepted_order: 6
  })
];

function mount(
  registration: MyMatchRegistration,
  roster: MatchRosterEntry[] | null,
  eventValue = event(),
  locale = 'en'
) {
  return render(
    <I18nextProvider i18n={createI18n(locale)}>
      <MatchRegistrationPanel
        event={eventValue}
        registration={registration}
        callerLevel={3.82}
        roster={roster}
      />
    </I18nextProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.invalidate.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
});

describe('accepted roster projection parser', () => {
  it('parses a well-formed roster payload and keeps the server order', () => {
    const parsed = parseMatchRoster([
      {
        display_name: 'Ada',
        display_level: 3.5,
        participation: 'playing',
        group_number: 1,
        reserve_position: null,
        registration_source: 'member',
        accepted_order: 1
      },
      {
        display_name: null,
        display_level: null,
        participation: 'reserve',
        group_number: null,
        reserve_position: 1,
        registration_source: 'guest',
        accepted_order: 5
      }
    ]);
    expect(parsed).toEqual([
      {
        display_name: 'Ada',
        display_level: 3.5,
        participation: 'playing',
        group_number: 1,
        reserve_position: null,
        registration_source: 'member',
        accepted_order: 1
      },
      {
        display_name: null,
        display_level: null,
        participation: 'reserve',
        group_number: null,
        reserve_position: 1,
        registration_source: 'guest',
        accepted_order: 5
      }
    ]);
  });

  it('degrades malformed rows to null instead of throwing', () => {
    const valid = {
      display_name: 'Ada',
      display_level: 3.5,
      participation: 'playing',
      group_number: 1,
      reserve_position: null,
      registration_source: 'member',
      accepted_order: 1
    };
    const malformed: unknown[] = [
      null,
      undefined,
      42,
      'x',
      {},
      [valid, null],
      [valid, { ...valid, accepted_order: 0 }],
      [valid, { ...valid, participation: 'bogus' }],
      [valid, { ...valid, registration_source: 'nobody' }],
      [valid, { ...valid, group_number: null }],
      [valid, { ...valid, group_number: 0 }],
      [valid, { ...valid, display_level: '3.5' }],
      [{ ...valid, participation: 'reserve', group_number: null, reserve_position: null }],
      [{ ...valid, participation: 'reserve', group_number: 1, reserve_position: null }]
    ];
    for (const payload of malformed) {
      expect(() => parseMatchRoster(payload)).not.toThrow();
      expect(parseMatchRoster(payload)).toBeNull();
    }
  });
});

describe('accepted roster panel', () => {
  it('renders playing groups, the reserve queue and the authoritative notes', () => {
    mount(accepted({ accepted_order: 2 }), ROSTER);
    expect(screen.getByRole('region', { name: en.matchRegistration.aria.roster })).toBeTruthy();
    expect(
      screen.getByText(en.matchRegistration.roster.groupTitle.replace('{{group}}', '1'))
    ).toBeTruthy();
    expect(screen.getByText(en.matchRegistration.roster.reserveTitle)).toBeTruthy();
    expect(screen.getByText(en.matchRegistration.roster.fifo)).toBeTruthy();
    expect(screen.queryByText(en.matchRegistration.roster.notPlayingTitle)).toBeNull();
    expect(screen.getByText(en.matchRegistration.roster.orderNote)).toBeTruthy();
    expect(screen.getByText(en.matchRegistration.roster.authoritativeNote)).toBeTruthy();
    // Real display names and levels, not just the caller row.
    expect(screen.getByText('Ada One')).toBeTruthy();
    expect(
      screen.getByText(en.matchRegistration.roster.level.replace('{{level}}', '4'))
    ).toBeTruthy();
  });

  it('renders the not-playing section for a cutoff-due roster, distinct from reserve', () => {
    mount(
      accepted({ participation: 'reserve_not_playing', accepted_order: 5, position: 5 }),
      DUE_ROSTER
    );
    expect(screen.getByText(en.matchRegistration.roster.notPlayingTitle)).toBeTruthy();
    expect(screen.queryByText(en.matchRegistration.roster.reserveTitle)).toBeNull();
    expect(
      screen.getAllByText(en.matchRegistration.badges.reserveNotPlaying).length
    ).toBeGreaterThan(0);
    expect(screen.queryByText(en.matchRegistration.badges.reserve)).toBeNull();
    expect(en.matchRegistration.badges.reserveNotPlaying).not.toBe(
      en.matchRegistration.badges.reserve
    );
  });

  it('marks guest rows with the public guest badge only', () => {
    mount(accepted({ accepted_order: 2 }), ROSTER);
    // Two guests in the payload; the caller (order 2) keeps its own source
    // badge, but no other member row fabricates a member badge.
    expect(screen.getAllByText(en.matchRegistration.badges.guest)).toHaveLength(2);
    expect(screen.getAllByText(en.matchRegistration.badges.member)).toHaveLength(1);
  });

  it('shows the reserve position per reserve row', () => {
    mount(accepted({ accepted_order: 2 }), ROSTER);
    expect(
      screen.getByText(en.matchRegistration.roster.position.replace('{{position}}', '1'))
    ).toBeTruthy();
    expect(
      screen.getByText(en.matchRegistration.roster.position.replace('{{position}}', '2'))
    ).toBeTruthy();
  });

  it('orders the rendered rows by accepted order', () => {
    const { container } = mount(accepted({ accepted_order: 99 }), ROSTER);
    const text = container.textContent ?? '';
    const order = ['Ada One', 'Bea Two', 'Cleo Guest', 'Dan Four', 'Eve Reserve', 'Finn Guest'];
    let cursor = -1;
    for (const name of order) {
      const index = text.indexOf(name);
      expect(index, `${name} present after the previous row`).toBeGreaterThan(cursor);
      cursor = index;
    }
  });

  it('highlights the caller row by accepted order without leaking names', () => {
    mount(accepted({ accepted_order: 2 }), ROSTER);
    expect(screen.getByText(en.matchRegistration.roster.you)).toBeTruthy();
    expect(screen.queryByText('Bea Two')).toBeNull();
    // Exactly one caller row is highlighted.
    expect(screen.getAllByText(en.matchRegistration.roster.you)).toHaveLength(1);
  });

  it('degrades an empty or unavailable roster to the caller placement row', () => {
    for (const roster of [null, []] as const) {
      cleanup();
      mount(accepted({ accepted_order: 2 }), roster);
      // The caller's own placement row survives, exactly as before the read.
      expect(screen.getByText(en.matchRegistration.roster.you)).toBeTruthy();
      expect(screen.getByText(en.matchRegistration.badges.playing)).toBeTruthy();
      // No other player row is fabricated from a missing read.
      expect(screen.queryByText('Ada One')).toBeNull();
      expect(screen.queryByText('Eve Reserve')).toBeNull();
      expect(screen.queryByText(en.matchRegistration.roster.reserveTitle)).toBeNull();
    }
  });

  it('renders no roster rows for a non-readable event (absent payload)', () => {
    mount(accepted({ accepted_order: 2 }), null);
    expect(screen.queryByText('Ada One')).toBeNull();
    expect(screen.queryByText('Eve Reserve')).toBeNull();
  });

  it('localizes the roster level label', () => {
    mount(accepted({ accepted_order: 2 }), ROSTER, event(), 'pt-BR');
    expect(
      screen.getByText(pt.matchRegistration.roster.level.replace('{{level}}', '4'))
    ).toBeTruthy();
    cleanup();
    mount(accepted({ accepted_order: 2 }), ROSTER, event(), 'es');
    expect(
      screen.getByText(es.matchRegistration.roster.level.replace('{{level}}', '4'))
    ).toBeTruthy();
  });
});

describe('accepted roster styles', () => {
  it('reuses design tokens and 44px touch targets with no literal colours or pixels', () => {
    const styles = readFileSync('src/features/matches/match-registration.styles.ts', 'utf8');
    expect(styles).toContain('var(--color-');
    expect(styles).toContain('var(--space-');
    expect(styles).toContain('calc(var(--space-40) + var(--space-4))');
    expect(styles).not.toMatch(/#[0-9a-f]{3,8}|\b\d+px\b/i);
  });
});
