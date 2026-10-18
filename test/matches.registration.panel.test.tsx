/** @vitest-environment jsdom */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from '../src/i18n/config';
import type { MyMatchRegistration } from '../src/features/matches/match-registration-model';
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
  listMatchEventRegistrationRequests: vi.fn<(...args: unknown[]) => Promise<unknown>>()
}));
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  useRouter: () => ({ invalidate: mocks.invalidate }),
  Link: ({ children, to }: { children: import('react').ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  )
}));

import {
  MatchRegistrationPanel,
  matchRegistrationAction
} from '../src/features/matches/MatchRegistrationPanel';

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
    restriction_enabled: true,
    min_level: 2.5,
    max_level: 5,
    is_past: false,
    ...extra
  };
}

const none: MyMatchRegistration = { state: 'none' };
const pending: MyMatchRegistration = {
  state: 'pending',
  event_id: EVENT_ID,
  registration_source: 'member',
  requested_at: '2026-10-18T09:30:00.000Z'
};
function accepted(
  extra: Partial<Extract<MyMatchRegistration, { state: 'accepted' }>> = {}
): MyMatchRegistration {
  return {
    state: 'accepted',
    event_id: EVENT_ID,
    participation: 'playing',
    accepted_order: 6,
    position: 6,
    registration_source: 'member',
    requested_at: '2026-10-18T09:00:00.000Z',
    approved_at: '2026-10-18T09:41:00.000Z',
    accepted_at: '2026-10-18T09:41:00.000Z',
    ...extra
  };
}
const rejected: MyMatchRegistration = {
  state: 'rejected',
  event_id: EVENT_ID,
  registration_source: 'member',
  resolved_at: '2026-10-18T09:50:00.000Z'
};
const expired: MyMatchRegistration = {
  state: 'expired',
  event_id: EVENT_ID,
  registration_source: 'member',
  resolved_at: '2026-10-20T17:30:00.000Z'
};

function mount(
  eventValue: Record<string, unknown>,
  registration: MyMatchRegistration,
  locale = 'en',
  callerLevel: number | null = 3.82
) {
  return render(
    <I18nextProvider i18n={createI18n(locale)}>
      <MatchRegistrationPanel
        event={eventValue}
        registration={registration}
        callerLevel={callerLevel}
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
  vi.useRealTimers();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

describe('match registration panel', () => {
  it('renders the direct-join CTA with capacity, level range and note', () => {
    mount(event(), none);
    expect(
      screen.getByRole('heading', { name: en.matchRegistration.join.sectionTitle })
    ).toBeTruthy();
    expect(screen.getByText(en.matchRegistration.join.openCopy)).toBeTruthy();
    expect(screen.getByRole('button', { name: en.matchRegistration.join.button })).toBeTruthy();
    expect(screen.getByText('2 of 8 places left')).toBeTruthy();
    expect(screen.getByText('Level range 2.5–5 · You: 3.82')).toBeTruthy();
    expect(screen.getByText(en.matchRegistration.join.note)).toBeTruthy();
  });

  it('submits a direct join, announces confirmation and invalidates the router', async () => {
    mocks.submit.mockResolvedValue({ status: 'accepted', registration: accepted() });
    mount(event(), none);
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: en.matchRegistration.join.button }));
    await waitFor(() =>
      expect(screen.getByText(en.matchRegistration.feedback.accepted)).toBeTruthy()
    );
    expect(mocks.submit).toHaveBeenCalledWith({ data: { event_id: EVENT_ID } });
    expect(mocks.invalidate).toHaveBeenCalled();
  });

  it('renders the request CTA for an out-of-range caller and announces the pending request', async () => {
    mocks.submit.mockResolvedValue({ status: 'pending', registration: pending });
    mount(event({ caller_eligibility: 'out_of_range', caller_requires_approval: true }), none);
    expect(screen.getByText(en.matches.detail.outOfRangeApprovalRequired)).toBeTruthy();
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: en.matchRegistration.join.requestButton }));
    await waitFor(() =>
      expect(screen.getByText(en.matchRegistration.feedback.pending)).toBeTruthy()
    );
  });

  it('renders the full capacity state as its own explicit blocked state', () => {
    mount(
      event({
        accepted_count: 8,
        playing_count: 8,
        reserve_count: 0,
        maximum_registrations: 8,
        registration_open: false
      }),
      none
    );
    expect(screen.getAllByText(en.matchRegistration.full.badge).length).toBeGreaterThan(0);
    expect(screen.getByText('8 of 8 places taken.')).toBeTruthy();
    expect(
      screen.getByText(en.matchRegistration.full.copy.replace('{{maximum}}', '8'))
    ).toBeTruthy();
    expect(screen.getByText(en.matchRegistration.full.note)).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: en.matchRegistration.full.button })
        .hasAttribute('disabled')
    ).toBe(true);
  });

  it('renders the closed state with the reserve-not-playing split as a distinct state', () => {
    mount(
      event({
        registration_cutoff_at: '2026-10-01T10:30:00.000Z',
        accepted_count: 9,
        playing_count: 8,
        reserve_count: 0,
        reserve_not_playing_count: 1,
        maximum_registrations: null,
        registration_open: false
      }),
      none
    );
    expect(screen.getAllByText(en.matchRegistration.closed.badge).length).toBeGreaterThan(0);
    expect(screen.getByText('8 playing · 1 reserve not playing')).toBeTruthy();
    expect(screen.getByText(en.matchRegistration.closed.sectionTitle)).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: en.matchRegistration.closed.button })
        .hasAttribute('disabled')
    ).toBe(true);
    expect(screen.getByText(en.matchRegistration.closed.note)).toBeTruthy();
  });

  it('renders the pending requester state with its meta and view link', () => {
    mount(event(), pending);
    expect(screen.getByRole('heading', { name: /Your request status/ })).toBeTruthy();
    expect(screen.getByText(en.matchRegistration.request.context)).toBeTruthy();
    expect(screen.getByText(en.matchRegistration.request.pendingBadge)).toBeTruthy();
    expect(screen.getByText(en.matchRegistration.request.pendingCopy)).toBeTruthy();
    expect(screen.getByText(/Requested .+ \u00b7 no place reserved yet/)).toBeTruthy();
    expect(screen.getByRole('link', { name: en.matchRegistration.request.viewMatch })).toBeTruthy();
    expect(screen.getByText(en.matchRegistration.request.note)).toBeTruthy();
  });

  it('renders an approved playing state with the group badge and safe roster', () => {
    mount(event(), accepted({ accepted_order: 6, position: 6 }));
    expect(
      screen.getByText(en.matchRegistration.request.approvedPlayingBadge.replace('{{group}}', '2'))
    ).toBeTruthy();
    expect(
      screen.getByText(/Approved at .+ \u00b7 your queue position started then\./)
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: en.matchRegistration.request.viewGroup })).toBeTruthy();
    expect(
      screen.getByText(en.matchRegistration.roster.groupTitle.replace('{{group}}', '2'))
    ).toBeTruthy();
    expect(screen.getByText(en.matchRegistration.roster.you)).toBeTruthy();
    expect(screen.getByText(en.matchRegistration.badges.playing)).toBeTruthy();
  });

  it('renders an approved reserve state with FIFO position and the reserve queue section', () => {
    mount(
      event({ accepted_count: 7, playing_count: 4, reserve_count: 3 }),
      accepted({ participation: 'reserve', accepted_order: 7, position: 7 })
    );
    expect(
      screen.getByText(
        en.matchRegistration.request.approvedReserveBadge.replace('{{position}}', '3')
      )
    ).toBeTruthy();
    expect(screen.getByText(en.matchRegistration.roster.reserveTitle)).toBeTruthy();
    expect(screen.getByText(en.matchRegistration.roster.fifo)).toBeTruthy();
    expect(screen.getByText(en.matchRegistration.badges.reserve)).toBeTruthy();
  });

  it('renders a reserve-not-playing acceptance as a first-class badge', () => {
    mount(
      event({ reserve_not_playing_count: 1, reserve_count: 0 }),
      accepted({ participation: 'reserve_not_playing', accepted_order: 9, position: 9 })
    );
    expect(
      screen.getAllByText(en.matchRegistration.badges.reserveNotPlaying).length
    ).toBeGreaterThan(0);
    expect(screen.getByText(en.matchRegistration.roster.notPlayingTitle)).toBeTruthy();
  });

  it('marks a guest source on the caller row and keeps creator distinct from participation', () => {
    const { rerender } = mount(event(), accepted({ registration_source: 'guest' }));
    expect(screen.getByText(en.matchRegistration.badges.guest)).toBeTruthy();
    rerender(
      <I18nextProvider i18n={createI18n('en')}>
        <MatchRegistrationPanel
          event={event()}
          registration={accepted({ registration_source: 'creator' })}
          callerLevel={3.82}
        />
      </I18nextProvider>
    );
    expect(screen.getByText(en.matchRegistration.badges.creator)).toBeTruthy();
    expect(screen.getByText(en.matchRegistration.badges.playing)).toBeTruthy();
  });

  it('offers request-again for a declined request and re-submits through the controller', async () => {
    mocks.submit.mockResolvedValue({ status: 'pending', registration: pending });
    mount(event(), rejected);
    expect(screen.getByText(en.matchRegistration.request.declinedBadge)).toBeTruthy();
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: en.matchRegistration.request.requestAgain }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
  });

  it('renders the expired-at-cutoff state without a re-request action', () => {
    mount(event(), expired);
    expect(screen.getByText(en.matchRegistration.request.expiredBadge)).toBeTruthy();
    expect(screen.getByText(en.matchRegistration.request.expiredCopy)).toBeTruthy();
    expect(
      screen.getByRole('link', { name: en.matchRegistration.request.viewMatchHistory })
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: en.matchRegistration.request.requestAgain })
    ).toBeNull();
  });

  it('localizes the panel copy in pt-BR and es', () => {
    mount(event(), accepted({ accepted_order: 6 }), 'pt-BR');
    expect(screen.getByText(/APROVADO · JOGANDO · Grupo 2/)).toBeTruthy();
    expect(
      screen.getByText(pt.matchRegistration.roster.groupTitle.replace('{{group}}', '2'))
    ).toBeTruthy();
    cleanup();
    mount(event(), none, 'es');
    expect(screen.getByRole('button', { name: es.matchRegistration.join.button })).toBeTruthy();
    expect(screen.getByText(es.matchRegistration.join.openCopy)).toBeTruthy();
  });

  it('disables the action and announces offline state', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    mount(event(), none);
    await waitFor(() =>
      expect(screen.getByText(en.matchRegistration.feedback.offline)).toBeTruthy()
    );
    expect(
      screen
        .getByRole('button', { name: en.matchRegistration.join.button })
        .hasAttribute('disabled')
    ).toBe(true);
  });

  it('marks the action busy and blocks a double submit while in flight', async () => {
    let resolveSubmit!: (value: unknown) => void;
    mocks.submit.mockReturnValue(
      new Promise((resolve) => {
        resolveSubmit = resolve;
      })
    );
    mount(event(), none);
    const button = screen.getByRole('button', { name: en.matchRegistration.join.button });
    const user = userEvent.setup();
    await user.click(button);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    await user.click(button);
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    resolveSubmit({ status: 'accepted', registration: accepted() });
    await waitFor(() =>
      expect(screen.getByText(en.matchRegistration.feedback.accepted)).toBeTruthy()
    );
  });

  it('surfaces an explicit capacity-filled outcome instead of a silent result', async () => {
    mocks.submit.mockResolvedValue({ status: 'error', code: 'full' });
    mount(event(), none);
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: en.matchRegistration.join.button }));
    await waitFor(() => expect(screen.getByText(en.matchRegistration.feedback.full)).toBeTruthy());
    expect(mocks.invalidate).toHaveBeenCalled();
  });

  it('retries a failed action and refreshes authoritative state after success', async () => {
    mocks.submit
      .mockResolvedValueOnce({ status: 'error', code: 'unavailable' })
      .mockResolvedValueOnce({ status: 'accepted', registration: accepted() });
    mount(event(), none);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: en.matchRegistration.join.button }));
    await waitFor(() =>
      expect(screen.getByText(en.matchRegistration.feedback.unavailable)).toBeTruthy()
    );
    expect(mocks.invalidate).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: en.matchRegistration.join.button }));
    await waitFor(() =>
      expect(screen.getByText(en.matchRegistration.feedback.accepted)).toBeTruthy()
    );
    expect(mocks.submit).toHaveBeenCalledTimes(2);
    expect(mocks.invalidate).toHaveBeenCalled();
  });

  it('switches to the closed state and revalidates at the cutoff while the screen is open', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-18T10:00:00.000Z'));
    mount(event({ registration_cutoff_at: '2026-10-18T10:00:30.000Z' }), none);
    expect(screen.getByRole('button', { name: en.matchRegistration.join.button })).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    expect(screen.getAllByText(en.matchRegistration.closed.badge).length).toBeGreaterThan(0);
    expect(mocks.invalidate).toHaveBeenCalled();
  });

  it('exposes focusable controls and a labelled region', () => {
    mount(event(), none);
    const section = screen.getByRole('region', {
      name: en.matchRegistration.join.sectionTitle
    });
    expect(section.getAttribute('aria-labelledby')).toBe('match-registration-heading');
    const button = screen.getByRole('button', { name: en.matchRegistration.join.button });
    button.focus();
    expect(document.activeElement).toBe(button);
  });

  it('derives the CTA state purely from the flat event projection', () => {
    const now = Date.parse('2026-10-18T10:00:00.000Z');
    expect(matchRegistrationAction(event(), now)).toBe('join');
    expect(
      matchRegistrationAction(
        event({ caller_eligibility: 'nonmember', caller_requires_approval: true }),
        now
      )
    ).toBe('request');
    expect(
      matchRegistrationAction(event({ accepted_count: 8, maximum_registrations: 8 }), now)
    ).toBe('full');
    expect(
      matchRegistrationAction(event({ registration_cutoff_at: '2026-10-01T00:00:00.000Z' }), now)
    ).toBe('closed');
    expect(matchRegistrationAction(event({ caller_eligibility: 'invited' }), now)).toBe('invited');
  });

  it('renders nothing for an invited caller with no registration row', () => {
    // The invitation sentence is owned by the detail page's participation
    // section (matches.detail.invitationInfo); the panel must not repeat it.
    const { container } = mount(event({ caller_eligibility: 'invited' }), none);
    expect(container.firstChild).toBeNull();
  });
});

describe('match registration styles', () => {
  it('uses design tokens, 44px touch targets and no literal colour or pixel values', () => {
    const styles = readFileSync('src/features/matches/match-registration.styles.ts', 'utf8');
    expect(styles).toContain('var(--color-');
    expect(styles).toContain('var(--space-');
    expect(styles).toContain('calc(var(--space-40) + var(--space-4))');
    expect(styles).not.toMatch(/#[0-9a-f]{3,8}|\b\d+px\b/i);
    expect(styles).toContain('var(--border-width-lg) solid var(--color-green)');
  });
});
