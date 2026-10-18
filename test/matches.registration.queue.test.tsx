/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from '../src/i18n/config';
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
        display_name: 'Paula Guest',
        display_level: null,
        registration_source: 'guest',
        requested_at: '2026-10-18T10:00:00.000Z'
      },
      {
        user_id: MEMBER_ID,
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
  locale = 'en',
  props: { error?: boolean; onRetry?: () => void } = {}
) {
  return render(
    <I18nextProvider i18n={createI18n(locale)}>
      <MatchRequestQueue
        eventId={EVENT_ID}
        eventName="Court Central"
        queue={value}
        minLevel={2.5}
        maxLevel={5}
        {...props}
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
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

describe('match request queue', () => {
  it('renders the creator queue with FIFO copy, request types and context', () => {
    mount(queue());
    expect(screen.getByRole('heading', { name: en.matchRegistration.queue.title })).toBeTruthy();
    expect(screen.getByText('Court Central · 2 to review')).toBeTruthy();
    expect(screen.getByText('2 REQUESTS')).toBeTruthy();
    expect(screen.getByText(en.matchRegistration.queue.sort)).toBeTruthy();
    expect(screen.getByText(en.matchRegistration.queue.fifoTitle)).toBeTruthy();
    expect(screen.getByText(en.matchRegistration.queue.fifoCopy)).toBeTruthy();
    expect(screen.getByText('Paula Guest')).toBeTruthy();
    expect(screen.getByText(en.matchRegistration.queue.typeGuest)).toBeTruthy();
    expect(screen.getByText(en.matchRegistration.queue.typeOutOfRange)).toBeTruthy();
    expect(screen.getByText(/Not a community member · Requested .+/)).toBeTruthy();
    expect(screen.getByText(/Above your 2.5–5 range · Requested .+/)).toBeTruthy();
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
    expect(screen.getByText(en.matchRegistration.queue.empty)).toBeTruthy();
    expect(screen.getByText('0 REQUESTS')).toBeTruthy();
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
      data: { event_id: EVENT_ID, user_id: GUEST_ID, decision: 'approve' }
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
      data: { event_id: EVENT_ID, user_id: MEMBER_ID, decision: 'reject' }
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
    expect(screen.getByText(pt.matchRegistration.queue.fifoTitle)).toBeTruthy();
    cleanup();
    mount(queue(), 'es');
    expect(screen.getByText(es.matchRegistration.queue.title)).toBeTruthy();
    expect(screen.getAllByText(es.matchRegistration.queue.decline).length).toBeGreaterThan(0);
  });
});
