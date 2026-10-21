/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from '../src/i18n/config';
import type { Locale } from '../src/i18n/config';
import type { MyMatchRegistration } from '../src/features/matches/match-registration-model';
import en from '../src/locales/en/translation.json';
import pt from '../src/locales/pt-BR/translation.json';
import es from '../src/locales/es/translation.json';

const routeMocks = vi.hoisted(() => ({
  getMatchEvent: vi.fn<(options: { data: { event_id: string } }) => Promise<unknown>>()
}));
vi.mock('../src/features/matches/matches.functions', () => ({
  getMatchEvent: routeMocks.getMatchEvent
}));
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  Link: ({ children, to }: { children: import('react').ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  )
}));
import { MatchDetailPage, shareMatchLink } from '../src/features/matches/MatchDetailPage';
import { loadMatchDetail } from '../src/routes/_protected.matches.$eventId';
import type { MatchEventDetail } from '../src/features/matches/match-contracts';
import { makeMatchDetail } from './helpers/match-fixtures';

const event = (id = 1, extra: Partial<MatchEventDetail> = {}): MatchEventDetail =>
  makeMatchDetail({
    event_id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    community_id: '11111111-1111-4111-8111-111111111111',
    community_name: 'Club Hidden',
    creator_id: '22222222-2222-4222-8222-222222222222',
    creator_name: 'Ana Silva',
    creator_level: 3.5,
    starts_at: '2026-10-20T18:30:00.000Z',
    timezone: 'Europe/Madrid',
    event_type: 'friendly',
    visibility: 'invite_only',
    team_assignment_mode: 'POST_MATCH_TEAMS',
    venue_name: 'Court Central',
    maps_url: 'https://www.google.com/maps/place/Court+Central',
    photo_url: 'https://example.test/photo.jpg',
    notes: 'Bring water',
    court_notes: null,
    duration_minutes: 90,
    payment_note: null,
    court_booked: true,
    restriction_enabled: false,
    min_level: null,
    max_level: null,
    registration_cutoff_at: '2026-10-20T17:30:00.000Z',
    price_minor: 1250,
    currency: 'EUR',
    accepted_count: 5,
    playing_count: 4,
    reserve_count: 1,
    reserve_not_playing_count: 0,
    group_count: 1,
    more_needed: 3,
    caller_badge: 'invited',
    is_past: false,
    registration_open: true,
    caller_eligibility: 'nonmember',
    caller_is_invited: true,
    caller_requires_approval: false,
    ...extra
  });
function mount(
  value: MatchEventDetail | null,
  locale: Locale = 'en',
  props: { loadError?: boolean; onRetry?: () => void } = {}
) {
  return render(
    <I18nextProvider i18n={createI18n(locale)}>
      <MatchDetailPage event={value} {...props} />
    </I18nextProvider>
  );
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.defineProperty(window.navigator, 'share', { configurable: true, value: undefined });
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: undefined });
});

describe('match detail surface', () => {
  it('renders complete authorized DTO context, counts, cost, photo and maps safely', () => {
    mount(event());
    const groups = screen.getAllByRole('region');
    expect(groups.map((group) => group.getAttribute('aria-labelledby'))).toEqual([
      'match-overview-heading',
      'match-participation-heading',
      'match-eligibility-heading'
    ]);
    expect(screen.getByRole('heading', { name: /Court Central/ })).toBeTruthy();
    expect(screen.getByRole('img', { name: en.matches.card.photoAlt }).getAttribute('src')).toBe(
      'https://example.test/photo.jpg'
    );
    const maps = screen.getByRole('link', { name: 'Open map for Court Central' });
    expect(maps.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByText(/€12\.50/)).toBeTruthy();
    expect(screen.getByText(/Notes included: Bring water/)).toBeTruthy();
    expect(screen.getByText(/5 · Accepted/)).toBeTruthy();
    expect(screen.getByText(/4 playing · 1 reserve · 1 group · 3 more needed/)).toBeTruthy();
    expect(screen.getByText('Invite only')).toBeTruthy();
    expect(screen.getByText(en.matches.detail.invitationInfo)).toBeTruthy();
    expect(screen.queryByText(/Club Hidden|saved_venue_id/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /accept|decline/i })).toBeNull();
  });
  it.each([
    ['pt-BR', '1 falta'],
    ['es', '1 falta']
  ] as const)('renders singular more-needed count in %s', (locale, expected) => {
    mount(
      event(10, {
        accepted_count: 7,
        playing_count: 4,
        reserve_count: 3,
        group_count: 1,
        more_needed: 1
      }),
      locale
    );
    expect(screen.getAllByRole('region')[1]?.textContent).toContain(expected);
  });
  it('renders optional published constraints and court/payment facts truthfully', () => {
    mount(
      event(12, {
        court_notes: 'Court 2',
        payment_note: 'Pay the venue directly',
        duration_minutes: 90,
        restriction_enabled: true,
        min_level: 2,
        max_level: 5,
        maximum_registrations: 8,
        registration_open: false
      })
    );
    expect(screen.getByText(/Court notes: Court 2/)).toBeTruthy();
    expect(screen.getByText(/Payment note: Pay the venue directly/)).toBeTruthy();
    expect(screen.getByText(/Expected duration: 90/)).toBeTruthy();
    expect(screen.getByText(/Level range: 2–5/)).toBeTruthy();
    expect(screen.getByText(/Maximum: 8/)).toBeTruthy();
    expect(screen.getByText(en.matches.detail.registrationClosed)).toBeTruthy();
  });
  it('formats monetary value by active locale and shows truthful approval text without join action', () => {
    mount(
      event(2, {
        price_minor: 1250,
        currency: 'BRL',
        caller_eligibility: 'out_of_range',
        caller_is_invited: true,
        caller_requires_approval: true
      }),
      'pt-BR'
    );
    expect(screen.getByText(/R\$\s?12,50/)).toBeTruthy();
    expect(screen.getByText(pt.matches.detail.outOfRangeApprovalRequired)).toBeTruthy();
    expect(screen.getByText(pt.matches.detail.invitationInfo)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /join|entrar|participar/i })).toBeNull();
  });
  it('keeps invite-only invited approval-required callers out of the request CTA while community-open callers can request', () => {
    const invitedOutOfRange: Pick<
      MatchEventDetail,
      'caller_eligibility' | 'caller_is_invited' | 'caller_requires_approval'
    > = {
      caller_eligibility: 'out_of_range',
      caller_is_invited: true,
      caller_requires_approval: true
    };
    const registration: MyMatchRegistration = { state: 'none' };

    const startsAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
    const cutoff = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    const inviteOnly = event(21, {
      ...invitedOutOfRange,
      visibility: 'invite_only',
      starts_at: startsAt,
      registration_cutoff_at: cutoff
    });
    const inviteOnlyView = render(
      <I18nextProvider i18n={createI18n('en')}>
        <MatchDetailPage event={inviteOnly} registration={registration} />
      </I18nextProvider>
    );
    expect(screen.getByText(en.matches.detail.invitationInfo)).toBeTruthy();
    expect(
      screen.getAllByText(en.matches.detail.outOfRangeApprovalRequired).length
    ).toBeGreaterThan(0);
    expect(
      screen.queryByRole('button', { name: en.matchRegistration.join.requestButton })
    ).toBeNull();

    inviteOnlyView.unmount();
    const communityOpen = event(22, {
      ...invitedOutOfRange,
      visibility: 'community_open',
      starts_at: startsAt,
      registration_cutoff_at: cutoff
    });
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <MatchDetailPage event={communityOpen} registration={registration} />
      </I18nextProvider>
    );
    expect(screen.getByText(en.matches.detail.invitationInfo)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: en.matchRegistration.join.requestButton })
    ).toBeTruthy();
  });
  it('shows participation and invitation without approval wording for an accepted invitee', () => {
    const acceptedRegistration: MyMatchRegistration = {
      state: 'accepted',
      event_id: event(23).event_id,
      participation: 'playing',
      accepted_order: 1,
      position: 1,
      registration_source: 'member',
      requested_at: '2026-10-18T09:00:00.000Z',
      approved_at: null,
      accepted_at: '2026-10-18T09:00:00.000Z'
    };
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <MatchDetailPage
          event={event(23, {
            caller_eligibility: 'out_of_range',
            caller_is_invited: true,
            caller_requires_approval: true
          })}
          registration={acceptedRegistration}
        />
      </I18nextProvider>
    );
    expect(screen.getByText(en.matches.detail.invitationInfo)).toBeTruthy();
    expect(screen.getByText(en.matchRegistration.badges.playing)).toBeTruthy();
    expect(screen.queryByText(en.matches.detail.outOfRangeApprovalRequired)).toBeNull();
  });
  it('keeps approval requirement visible for a nonaccepted out-of-range invitee', () => {
    mount(
      event(24, {
        caller_eligibility: 'out_of_range',
        caller_is_invited: true,
        caller_requires_approval: true
      })
    );
    expect(screen.getByText(en.matches.detail.invitationInfo)).toBeTruthy();
    expect(screen.getByText(en.matches.detail.outOfRangeApprovalRequired)).toBeTruthy();
  });
  it('shows guest approval information without registration action', () => {
    mount(event(9, { caller_eligibility: 'nonmember', caller_requires_approval: true }));
    expect(screen.getByText(en.matches.detail.guestApprovalRequired)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /join|register/i })).toBeNull();
  });
  it('renders past scheduled event with no result language or fabricated score', () => {
    mount(event(8, { is_past: true, caller_badge: null }));
    expect(screen.getByText(en.matches.detail.pastScheduled)).toBeTruthy();
    expect(screen.getByText(en.matches.detail.outcomeUnavailable)).toBeTruthy();
    expect(screen.queryByText(/\bscore\b|\bconfirmed\b|\bdisputed\b/i)).toBeNull();
  });
  it('labels creator acceptance distinctly from playing and supports localized formatting in Spanish', () => {
    mount(event(3, { caller_badge: 'creator', price_minor: 0, currency: 'EUR' }), 'es');
    expect(screen.getByText(es.matches.detail.creatorAccepted)).toBeTruthy();
    expect(screen.queryByText(es.matches.badges.playing)).toBeNull();
    expect(screen.getByText(/0,00\s?€/)).toBeTruthy();
  });
  it('renders unavailable photo, unavailable event and server-error retry states', async () => {
    mount(event(4, { photo_url: null }));
    expect(screen.queryByRole('img')).toBeNull();
    cleanup();
    mount(null);
    expect(screen.getByText(en.matches.unavailable)).toBeTruthy();
    cleanup();
    const retry = vi.fn<() => void>();
    mount(null, 'en', { loadError: true, onRetry: retry });
    expect(screen.getByRole('alert').textContent).toContain(en.matches.error);
    await userEvent.setup().click(screen.getByRole('button', { name: en.matches.retry }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it('renders a retryable registration error region when the registration read fails', async () => {
    const retry = vi.fn<() => void>();
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <MatchDetailPage event={event(20)} registration={null} registrationError onRetry={retry} />
      </I18nextProvider>
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(en.matchRegistration.loadError.body);
    expect(
      screen.getByRole('heading', { name: en.matchRegistration.loadError.title })
    ).toBeTruthy();
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: en.matchRegistration.loadError.retry }));
    expect(retry).toHaveBeenCalledOnce();
    // The registration error surface does not depend on registration data.
    expect(screen.queryByRole('button', { name: en.matchRegistration.join.button })).toBeNull();
  });
  it('keeps missing events unavailable and retries transient detail RPC failures', async () => {
    const eventId = event(44).event_id;
    routeMocks.getMatchEvent.mockResolvedValueOnce({ status: 'unavailable' });
    const unavailable = await loadMatchDetail(eventId);
    expect(unavailable).toEqual({ event: null, failed: false });
    mount(unavailable.event);
    expect(screen.getByText(en.matches.unavailable)).toBeTruthy();

    cleanup();
    routeMocks.getMatchEvent
      .mockReset()
      .mockResolvedValueOnce({ status: 'error' })
      .mockResolvedValueOnce({ status: 'ok', event: event(44) });
    let result = await loadMatchDetail(eventId);
    expect(result).toEqual({ event: null, failed: true });
    let view: ReturnType<typeof mount>;
    const onRetry = async () => {
      result = await loadMatchDetail(eventId);
      view.rerender(
        <I18nextProvider i18n={createI18n('en')}>
          <MatchDetailPage event={result.event} loadError={result.failed} />
        </I18nextProvider>
      );
    };
    view = mount(result.event, 'en', { loadError: result.failed, onRetry });
    expect(screen.getByRole('alert').textContent).toContain(en.matches.error);
    await userEvent.setup().click(screen.getByRole('button', { name: en.matches.retry }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Court Central/ })).toBeTruthy()
    );
    expect(routeMocks.getMatchEvent).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('uses navigator.share when available', async () => {
    const share = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'share', { configurable: true, value: share });
    mount(event(5));
    await userEvent.setup().click(screen.getByRole('button', { name: en.matches.detail.share }));
    expect(share).toHaveBeenCalledWith({
      url: `${window.location.origin}/matches/${event(5).event_id}`
    });
  });
  it('falls back to clipboard and resets copied state when event id changes', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    const canonical = `${window.location.origin}/matches/${event(6).event_id}`;
    // Model a browser without navigator.share: production reads the platform
    // from window.navigator when no sharePlatform prop is passed.
    Object.defineProperty(window.navigator, 'share', { configurable: true, value: undefined });
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    });
    expect(await shareMatchLink(canonical, window.navigator)).toBe('copied');
    expect(writeText).toHaveBeenCalledWith(canonical);
    const view = render(
      <I18nextProvider i18n={createI18n('en')}>
        <MatchDetailPage event={event(6)} />
      </I18nextProvider>
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: en.matches.detail.share }));
    expect(screen.getByText(en.matches.detail.copied)).toBeTruthy();
    view.rerender(
      <I18nextProvider i18n={createI18n('en')}>
        <MatchDetailPage event={event(7)} />
      </I18nextProvider>
    );
    expect(screen.queryByText(en.matches.detail.copied)).toBeNull();
  });
});
