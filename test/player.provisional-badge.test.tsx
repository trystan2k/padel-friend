/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProvisionalBadge } from '../src/components/ui/ProvisionalBadge';
import { createI18n, supportedLocales } from '../src/i18n/config';
import { MatchResultTeams } from '../src/features/matches/MatchResultFacts';
import { MatchRosterCard } from '../src/features/matches/MatchRosterCard';
import type { ManagementParticipant } from '../src/features/matches/match-management-model';
import type {
  MatchRegistrationQueue,
  MatchRosterEntry
} from '../src/features/matches/match-registration-model';
import en from '../src/locales/en/translation.json';
import es from '../src/locales/es/translation.json';
import pt from '../src/locales/pt-BR/translation.json';

vi.mock('../src/features/matches/MatchParticipantActions', () => ({
  MatchParticipantActions: ({ name }: { name: string }) => (
    <button type="button" aria-label={name}>
      ⋯
    </button>
  )
}));
vi.mock('../src/features/matches/match-registration.functions', () => ({
  submitMatchRegistration: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  decideMatchRegistration: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  getMyMatchRegistration: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  listMatchEventRegistrationRequests: vi.fn<(...args: unknown[]) => Promise<unknown>>()
}));
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn<() => Promise<void>>() })
}));
import { MatchRequestQueue } from '../src/features/matches/MatchRequestQueue';

afterEach(cleanup);
const wrap = (node: ReactNode, locale: 'en' | 'pt-BR' | 'es' = 'en') => (
  <I18nextProvider i18n={createI18n(locale)}>{node}</I18nextProvider>
);

const entry = (overrides: Partial<MatchRosterEntry>): MatchRosterEntry => ({
  accepted_order: 1,
  display_name: 'Marta Silva',
  display_level: 3.5,
  is_provisional: true,
  participation: 'playing',
  registration_source: 'member',
  group_number: 1,
  reserve_position: null,
  ...overrides
});

describe('provisional badge', () => {
  it('renders visible localized text with a decorative icon in every locale', () => {
    const labels = { en: en, 'pt-BR': pt, es };
    for (const locale of supportedLocales) {
      const { container, unmount } = render(wrap(<ProvisionalBadge />, locale));
      const label = labels[locale].player.provisional.badge;
      expect(screen.getByText(label).textContent).toContain(label);
      // Not color-only: text plus an icon that stays out of the accessibility tree.
      expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
      unmount();
    }
  });
});

describe('badge surfaces', () => {
  it('marks provisional players in the public roster and not registered ones', () => {
    render(
      wrap(
        <MatchRosterCard
          eventId="event"
          callerOrder={null}
          roster={[
            entry({}),
            entry({ accepted_order: 2, display_name: 'Ana Real', is_provisional: false })
          ]}
        />
      )
    );
    expect(screen.getAllByText(en.player.provisional.badge)).toHaveLength(1);
    const row = screen.getByText('Marta Silva').closest('div');
    expect(within(row!.parentElement!).getByText(en.player.provisional.badge)).toBeTruthy();
  });

  it('marks provisional participants on the management roster, including those not yet in the safe roster', () => {
    const participant: ManagementParticipant = {
      registration_id: 'r',
      user_id: 'u',
      attempt_id: 'a',
      display_name: 'Marta Silva',
      display_level: 3.5,
      is_provisional: true,
      lifecycle: 'accepted',
      participation: 'playing',
      accepted_order: 5
    };
    render(
      wrap(
        <MatchRosterCard
          eventId="event"
          callerOrder={null}
          roster={[]}
          participants={[participant]}
        />
      )
    );
    expect(screen.getAllByText(en.player.provisional.badge)).toHaveLength(1);
  });

  it('marks provisional requesters in the registration queue', () => {
    const queue: MatchRegistrationQueue = {
      event_id: 'e',
      accepted_count: 0,
      playing_count: 0,
      reserve_count: 0,
      reserve_not_playing_count: 0,
      maximum_registrations: 8,
      registration_cutoff_at: '2030-01-01T00:00:00Z',
      requests: [
        ['u1', 'Marta Silva', true],
        ['u2', 'Ana Real', false]
      ].map(([user_id, display_name, is_provisional]) => ({
        user_id: String(user_id),
        attempt_id: `a-${user_id}`,
        display_name: String(display_name),
        display_level: 3,
        is_provisional: Boolean(is_provisional),
        registration_source: 'member' as const,
        requested_at: '2029-12-01T00:00:00Z'
      }))
    };
    render(wrap(<MatchRequestQueue eventId="e" queue={queue} />));
    expect(screen.getAllByText(en.player.provisional.badge)).toHaveLength(1);
  });

  it('marks provisional result players and explains they cannot review', () => {
    const teams = {
      team_a: [
        { user_id: '1', display_name: 'Marta Silva', is_provisional: true },
        { user_id: '2', display_name: 'Ana Real', is_provisional: false }
      ],
      team_b: [
        { user_id: '3', display_name: 'Rui Santos', is_provisional: false },
        { user_id: '4', display_name: 'Eva Costa', is_provisional: false }
      ]
    };
    const { rerender } = render(wrap(<MatchResultTeams teams={teams} />));
    expect(screen.getAllByText(en.player.provisional.badge)).toHaveLength(1);
    expect(screen.getByText(en.player.provisional.reviewNote)).toBeTruthy();
    rerender(
      wrap(
        <MatchResultTeams
          teams={{
            team_a: teams.team_a.map((player) => ({ ...player, is_provisional: false })),
            team_b: teams.team_b
          }}
        />
      )
    );
    expect(screen.queryByText(en.player.provisional.badge)).toBeNull();
    expect(screen.queryByText(en.player.provisional.reviewNote)).toBeNull();
  });
});
