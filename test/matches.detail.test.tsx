/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from '../src/i18n/config';
import en from '../src/locales/en/translation.json';
import pt from '../src/locales/pt-BR/translation.json';
import es from '../src/locales/es/translation.json';

vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  Link: ({ children, to }: { children: import('react').ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  )
}));
import { MatchDetailPage, shareMatchLink } from '../src/features/matches/MatchDetailPage';

const event = (id = 1, extra: Record<string, unknown> = {}) => ({
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
  photo_path: 'photo.jpg',
  photo_url: 'https://example.test/photo.jpg',
  notes: 'Bring water',
  price_minor: 1250,
  currency: 'EUR',
  accepted_count: 5,
  playing_count: 4,
  reserve_count: 1,
  group_count: 1,
  more_needed: 3,
  caller_badge: 'invited',
  is_past: false,
  registration_open: true,
  caller_eligibility: 'invited',
  caller_requires_approval: false,
  ...extra
});
function mount(
  value: Record<string, unknown> | null,
  locale = 'en',
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
    expect(screen.getByRole('heading', { name: /Court Central/ })).toBeTruthy();
    expect(screen.getByRole('img', { name: en.matches.card.photoAlt }).getAttribute('src')).toBe(
      'https://example.test/photo.jpg'
    );
    const maps = screen.getByRole('link', { name: 'Open map for Court Central' });
    expect(maps.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByText(/€12\.50/)).toBeTruthy();
    expect(screen.getByText('Bring water')).toBeTruthy();
    expect(screen.getByText(/5 · Accepted/)).toBeTruthy();
    expect(screen.getByText(/4 playing · 1 reserve · 1 group · 3 more needed/)).toBeTruthy();
    expect(screen.getByText('Invite only')).toBeTruthy();
    expect(screen.getByText(en.matches.detail.invitationInfo)).toBeTruthy();
    expect(screen.queryByText(/Club Hidden|saved_venue_id/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /accept|decline/i })).toBeNull();
  });
  it('formats monetary value by active locale and shows truthful approval text without join action', () => {
    mount(
      event(2, {
        price_minor: 1250,
        currency: 'BRL',
        caller_eligibility: 'out_of_range',
        caller_requires_approval: true
      }),
      'pt-BR'
    );
    expect(screen.getByText(/R\$\s?12,50/)).toBeTruthy();
    expect(screen.getByText(pt.matches.detail.outOfRangeApprovalRequired)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /join|entrar|participar/i })).toBeNull();
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
    expect(await shareMatchLink(canonical, { share: undefined, clipboard: { writeText } })).toBe(
      'copied'
    );
    expect(writeText).toHaveBeenCalledWith(canonical);
    const view = render(
      <I18nextProvider i18n={createI18n('en')}>
        <MatchDetailPage
          event={event(6)}
          sharePlatform={{ share: undefined, clipboard: { writeText } }}
        />
      </I18nextProvider>
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: en.matches.detail.share }));
    expect(screen.getByText(en.matches.detail.copied)).toBeTruthy();
    view.rerender(
      <I18nextProvider i18n={createI18n('en')}>
        <MatchDetailPage
          event={event(7)}
          sharePlatform={{ share: undefined, clipboard: { writeText } }}
        />
      </I18nextProvider>
    );
    expect(screen.queryByText(en.matches.detail.copied)).toBeNull();
  });
});
