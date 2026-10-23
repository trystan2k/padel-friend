/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from '../src/i18n/config';
import type { Locale } from '../src/i18n/config';
import type { MatchRegistrationQueue } from '../src/features/matches/match-registration-model';
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

import { MatchRequestQueue } from '../src/features/matches/MatchRequestQueue';

const EVENT_ID = '00000000-0000-4000-8000-000000000001';
const GUEST_ID = '00000000-0000-4000-8000-0000000000a1';
const MEMBER_ID = '00000000-0000-4000-8000-0000000000b2';
const ABOVE_ID = '00000000-0000-4000-8000-0000000000c3';
const BELOW_ID = '00000000-0000-4000-8000-0000000000d4';
const UNRATED_ID = '00000000-0000-4000-8000-0000000000e5';
const REQUESTED_AT = '2026-10-18T10:00:00.000Z';
const ATTEMPT_GUEST = '00000000-0000-4000-8000-000000000f01';
const ATTEMPT_MEMBER = '00000000-0000-4000-8000-000000000f02';
const ATTEMPT_ABOVE = '00000000-0000-4000-8000-000000000f03';
const ATTEMPT_BELOW = '00000000-0000-4000-8000-000000000f04';
const ATTEMPT_UNRATED = '00000000-0000-4000-8000-000000000f05';

function queue(overrides: Partial<MatchRegistrationQueue> = {}): MatchRegistrationQueue {
  return {
    event_id: EVENT_ID,
    accepted_count: 4,
    playing_count: 4,
    reserve_count: 0,
    reserve_not_playing_count: 0,
    maximum_registrations: 8,
    registration_cutoff_at: '2026-10-20T17:30:00.000Z',
    requests: [
      {
        user_id: GUEST_ID,
        attempt_id: ATTEMPT_GUEST,
        display_name: 'Paula Guest',
        display_level: null,
        registration_source: 'guest',
        requested_at: '2026-10-18T10:00:00.000Z'
      },
      {
        user_id: MEMBER_ID,
        attempt_id: ATTEMPT_MEMBER,
        display_name: 'Rui Member',
        display_level: 6.5,
        registration_source: 'member',
        requested_at: '2026-10-18T10:05:00.000Z'
      }
    ],
    ...overrides
  };
}

function mount(
  value: MatchRegistrationQueue | null,
  locale: Locale = 'en',
  props: {
    error?: boolean;
    onRetry?: () => void;
    minLevel?: number | null;
    maxLevel?: number | null;
  } = {}
) {
  return render(
    <I18nextProvider i18n={createI18n(locale)}>
      <MatchRequestQueue eventId={EVENT_ID} queue={value} minLevel={2.5} maxLevel={5} {...props} />
    </I18nextProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.invalidate.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

describe('match request queue', () => {
  it('renders the creator queue with FIFO copy, request types and context', () => {
    mount(queue());
    expect(screen.getByRole('heading', { name: en.matchRegistration.queue.title })).toBeTruthy();
    expect(screen.getByText('2 requests')).toBeTruthy();
    expect(screen.getByText(en.matchRegistration.queue.fifoCopy)).toBeTruthy();
    expect(screen.getByText('Paula Guest')).toBeTruthy();
    expect(screen.getByText(en.matchRegistration.queue.typeGuest)).toBeTruthy();
    expect(screen.getByText(en.matchRegistration.queue.typeOutOfRange)).toBeTruthy();
    expect(screen.getByText(/Not a community member · Requested .+/)).toBeTruthy();
    expect(screen.getByText(/Above your 2.5–5 range · Requested .+/)).toBeTruthy();
  });

  it('describes above-range, below-range, unrated and member requesters distinctly', () => {
    mount(
      queue({
        requests: [
          {
            user_id: ABOVE_ID,
            attempt_id: ATTEMPT_ABOVE,
            display_name: 'Above Range',
            display_level: 6.5,
            registration_source: 'member',
            requested_at: REQUESTED_AT
          },
          {
            user_id: BELOW_ID,
            attempt_id: ATTEMPT_BELOW,
            display_name: 'Below Range',
            display_level: 1.5,
            registration_source: 'member',
            requested_at: REQUESTED_AT
          },
          {
            user_id: UNRATED_ID,
            attempt_id: ATTEMPT_UNRATED,
            display_name: 'Unrated Member',
            display_level: null,
            registration_source: 'member',
            requested_at: REQUESTED_AT
          },
          {
            user_id: GUEST_ID,
            attempt_id: ATTEMPT_GUEST,
            display_name: 'Paula Guest',
            display_level: null,
            registration_source: 'guest',
            requested_at: REQUESTED_AT
          }
        ]
      })
    );
    expect(screen.getByText(/Above your 2\.5–5 range · Requested/)).toBeTruthy();
    expect(screen.getByText(/Below your 2\.5–5 range · Requested/)).toBeTruthy();
    expect(screen.getByText(/No level set · range 2\.5–5 · Requested/)).toBeTruthy();
    expect(screen.getByText(/Not a community member · Requested/)).toBeTruthy();
    // Only the genuinely above-range requester is described as above range.
    expect(screen.getAllByText(/Above your 2\.5–5 range/)).toHaveLength(1);
    expect(screen.getAllByText(en.matchRegistration.queue.typeOutOfRange)).toHaveLength(2);
    expect(screen.getByText(en.matchRegistration.queue.typeUnrated)).toBeTruthy();
  });

  it('describes a member neutrally when the event has no level restriction', () => {
    mount(
      queue({
        requests: [
          {
            user_id: MEMBER_ID,
            attempt_id: ATTEMPT_MEMBER,
            display_name: 'Rui Member',
            display_level: 6.5,
            registration_source: 'member',
            requested_at: REQUESTED_AT
          }
        ]
      }),
      'en',
      { minLevel: null, maxLevel: null }
    );
    expect(screen.getByText(/Community member · Requested/)).toBeTruthy();
    expect(screen.queryByText(/Not a community member/)).toBeNull();
    expect(screen.queryByText(/Above your/)).toBeNull();
  });

  it('renders nothing for an unauthorized caller with no queue payload', () => {
    const { container } = mount(null);
    expect(container.textContent).toBe('');
  });

  it('renders the loading error with a retry action', async () => {
    const onRetry = vi.fn<() => void>();
    mount(null, 'en', { error: true, onRetry });
    expect(screen.getByRole('alert').textContent).toContain(en.matchRegistration.queue.error);
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: en.matchRegistration.queue.retry }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('renders an empty queue message', () => {
    mount(queue({ requests: [] }));
    expect(screen.getByText(en.matchRegistration.queue.emptyCopy)).toBeTruthy();
    expect(screen.getByText('0 requests')).toBeTruthy();
  });

  it('approves a request with a labelled control and refreshes authoritative state', async () => {
    mocks.decide.mockResolvedValue({
      status: 'approved',
      replayed: false,
      registration: {}
    });
    mount(queue());
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Approve request from Paula Guest' }));
    expect(mocks.decide).toHaveBeenCalledWith({
      data: { event_id: EVENT_ID, attempt_id: ATTEMPT_GUEST, decision: 'approve' }
    });
    await waitFor(() =>
      expect(screen.getByText(en.matchRegistration.feedback.approved)).toBeTruthy()
    );
    expect(mocks.invalidate).toHaveBeenCalled();
  });

  it('declines a request', async () => {
    mocks.decide.mockResolvedValue({ status: 'rejected', replayed: false, registration: {} });
    mount(queue());
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Decline request from Rui Member' }));
    expect(mocks.decide).toHaveBeenCalledWith({
      data: { event_id: EVENT_ID, attempt_id: ATTEMPT_MEMBER, decision: 'reject' }
    });
    await waitFor(() =>
      expect(screen.getByText(en.matchRegistration.feedback.rejected)).toBeTruthy()
    );
  });

  it('gives an explicit full-capacity outcome and refreshes after the conflict', async () => {
    mocks.decide.mockResolvedValue({ status: 'error', code: 'full' });
    mount(queue());
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Approve request from Paula Guest' }));
    await waitFor(() => expect(screen.getByText(en.matchRegistration.feedback.full)).toBeTruthy());
    expect(mocks.invalidate).toHaveBeenCalled();
  });

  it('renders translated copy for a snake_case decision error instead of the raw key', async () => {
    mocks.decide.mockResolvedValue({ status: 'error', code: 'already_resolved' });
    mount(queue());
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Approve request from Paula Guest' }));
    await waitFor(() =>
      expect(screen.getByText(en.matchRegistration.feedback.alreadyResolved)).toBeTruthy()
    );
    expect(screen.queryByText('matchRegistration.feedback.already_resolved')).toBeNull();
    expect(screen.queryByText('matchRegistration.feedback.alreadyResolved')).toBeNull();
  });

  it('disables decisions and announces offline state', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    mount(queue());
    await waitFor(() =>
      expect(screen.getByText(en.matchRegistration.feedback.offline)).toBeTruthy()
    );
    expect(
      screen
        .getByRole('button', { name: 'Approve request from Paula Guest' })
        .hasAttribute('disabled')
    ).toBe(true);
  });

  it('falls back to a safe name when the requester has no display name', () => {
    mount(
      queue({
        requests: [
          {
            user_id: GUEST_ID,
            attempt_id: ATTEMPT_GUEST,
            display_name: null,
            display_level: null,
            registration_source: 'guest',
            requested_at: '2026-10-18T10:00:00.000Z'
          }
        ]
      })
    );
    expect(screen.getByText(en.matchRegistration.queue.requesterFallback)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve request from Guest player' })).toBeTruthy();
  });

  it('localizes the creator queue in pt-BR and es', () => {
    mount(queue(), 'pt-BR');
    expect(screen.getAllByText(pt.matchRegistration.queue.approve).length).toBeGreaterThan(0);
    expect(screen.getByText(pt.matchRegistration.queue.fifoCopy)).toBeTruthy();
    cleanup();
    mount(queue(), 'es');
    expect(screen.getByText(es.matchRegistration.queue.joinTitle)).toBeTruthy();
    expect(screen.getAllByText(es.matchRegistration.queue.decline).length).toBeGreaterThan(0);
  });
});
