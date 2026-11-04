/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';

const mocks = vi.hoisted(() => ({
  targetV3: vi.fn<(input: { data: { notificationId: string } }) => Promise<unknown>>(),
  matchContext: vi.fn<(input: { data: { notificationId: string } }) => Promise<unknown>>(),
  markRead: vi.fn<(input: { data: { notificationId: string } }) => Promise<unknown>>(),
  accept: vi.fn<(input: { data: { notificationId: string } }) => Promise<unknown>>()
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({
    children,
    params,
    to
  }: {
    children: import('react').ReactNode;
    params?: { requestId?: string };
    to: string;
  }) => <a href={params?.requestId ? to.replace('$requestId', params.requestId) : to}>{children}</a>
}));
vi.mock('../src/features/notifications/notifications.functions', () => ({
  getMyNotificationTargetV3: mocks.targetV3,
  getMyMatchNotificationContext: mocks.matchContext,
  markNotificationRead: mocks.markRead,
  acceptMyNotificationInvitation: mocks.accept
}));

import { createI18n } from '../src/i18n/config';
import en from '../src/locales/en/translation.json';
import ptBR from '../src/locales/pt-BR/translation.json';
import es from '../src/locales/es/translation.json';
import {
  decodeNotificationTarget,
  type NotificationTarget,
  type NotificationTargetInput
} from '../src/features/notifications/notification-target';
import { NotificationDetailPage } from '../src/features/notifications/NotificationDetailPage';

const notificationId = '9f1c3b2a-7d4e-4c8a-9b2f-1e6d5a7c3b40';
const requestId = '33333333-3333-4333-8333-333333333333';
const adjustmentId = '44444444-4444-4444-8444-444444444444';

const header = {
  community_id: null,
  community_name: null,
  invitation_id: null,
  membership_status: null,
  match_event_id: null,
  match_available: false,
  created_at: '2026-11-04T12:00:00.000Z',
  result_context: null
};
const approvedTarget = {
  ...header,
  target_status: 'level_review_available',
  kind: 'level_review_approved',
  level_review_context: {
    request_id: requestId,
    outcome: 'approved',
    requested_min_level: 4.5,
    requested_max_level: 5,
    approved_level: 4.75,
    decided_at: '2026-11-04T12:00:00.000Z',
    decision_note: 'Verified on court.',
    adjustment_id: adjustmentId
  }
};
const rejectedTarget = {
  ...header,
  target_status: 'level_review_available',
  kind: 'level_review_rejected',
  level_review_context: {
    request_id: requestId,
    outcome: 'rejected',
    requested_min_level: 5,
    requested_max_level: 5,
    approved_level: null,
    decided_at: '2026-11-04T12:00:00.000Z',
    decision_note: 'Not enough rated games.',
    adjustment_id: null
  }
};

function renderDetail(target: NotificationTarget, locale: 'en' | 'pt-BR' | 'es' = 'en') {
  return render(
    <I18nextProvider i18n={createI18n(locale)}>
      <NotificationDetailPage notificationId={notificationId} target={target} />
    </I18nextProvider>
  );
}

beforeEach(() => {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
  mocks.markRead.mockResolvedValue('2026-11-04T12:00:01.000Z');
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('level review notification target decoding', () => {
  it('decodes approved and rejected contexts and preserves the other variants', () => {
    expect(decodeNotificationTarget(approvedTarget).level_review_context).toMatchObject({
      outcome: 'approved',
      approved_level: 4.75,
      adjustment_id: adjustmentId
    });
    expect(decodeNotificationTarget(rejectedTarget).level_review_context).toMatchObject({
      outcome: 'rejected',
      approved_level: null,
      adjustment_id: null
    });
    const unavailable = decodeNotificationTarget({
      ...header,
      target_status: 'unavailable',
      kind: 'level_review_approved',
      level_review_context: null
    });
    expect(unavailable.target_status).toBe('unavailable');
    expect(unavailable.level_review_context).toBeUndefined();
  });

  it.each<[string, NotificationTargetInput]>([
    ['a missing context', { ...approvedTarget, level_review_context: null }],
    ['a mismatched kind', { ...approvedTarget, kind: 'level_review_rejected' }],
    [
      'an approval without an adjustment',
      {
        ...approvedTarget,
        level_review_context: { ...approvedTarget.level_review_context, adjustment_id: null }
      }
    ],
    [
      'a rejection carrying an approved level',
      {
        ...rejectedTarget,
        level_review_context: { ...rejectedTarget.level_review_context, approved_level: 5 }
      }
    ],
    [
      'an out-of-range level',
      {
        ...approvedTarget,
        level_review_context: { ...approvedTarget.level_review_context, approved_level: 7.5 }
      }
    ],
    [
      'an empty note',
      {
        ...approvedTarget,
        level_review_context: { ...approvedTarget.level_review_context, decision_note: '' }
      }
    ],
    [
      'an unsafe request id',
      {
        ...approvedTarget,
        level_review_context: { ...approvedTarget.level_review_context, request_id: '../x' }
      }
    ],
    [
      'a stray level review context on another target',
      {
        ...header,
        target_status: 'unavailable',
        kind: null,
        level_review_context: approvedTarget.level_review_context
      }
    ]
  ])('rejects %s', (_name, value) => {
    expect(() => decodeNotificationTarget(value)).toThrow(/INVALID_/);
  });
});

describe('level review notification detail', () => {
  it('shows the approved outcome, note and request link, and marks it read', async () => {
    renderDetail(decodeNotificationTarget(approvedTarget));
    const copy = en.notifications;
    expect(
      screen.getByRole('heading', { level: 1, name: copy.kinds.level_review_approved })
    ).toBeTruthy();
    expect(
      screen.getByText(copy.levelReview.approvedBody.replace('{{level}}', '4.75'))
    ).toBeTruthy();
    expect(screen.getByText(/Verified on court\./)).toBeTruthy();
    expect(screen.getByRole('link', { name: copy.levelReview.open }).getAttribute('href')).toBe(
      `/level-reviews/${requestId}`
    );
    expect(screen.getByRole('link', { name: copy.back }).getAttribute('href')).toBe(
      '/notifications'
    );
    await waitFor(() => expect(mocks.markRead).toHaveBeenCalledWith({ data: { notificationId } }));
  });

  it('shows the rejected outcome without claiming a rating change', () => {
    renderDetail(decodeNotificationTarget(rejectedTarget));
    const copy = en.notifications;
    expect(
      screen.getByRole('heading', { level: 1, name: copy.kinds.level_review_rejected })
    ).toBeTruthy();
    expect(screen.getByText(copy.levelReview.rejectedBody)).toBeTruthy();
    expect(screen.getByText(/Not enough rated games\./)).toBeTruthy();
    expect(screen.queryByText(/Your level is now/)).toBeNull();
  });

  it.each([
    ['pt-BR', ptBR],
    ['es', es]
  ] as const)('is translated in %s', (locale, catalog) => {
    renderDetail(decodeNotificationTarget(approvedTarget), locale);
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: catalog.notifications.kinds.level_review_approved
      })
    ).toBeTruthy();
    expect(catalog.notifications.kinds.level_review_approved).not.toBe(
      en.notifications.kinds.level_review_approved
    );
    expect(screen.getByRole('link', { name: catalog.notifications.levelReview.open })).toBeTruthy();
  });

  it('uses the safe unavailable state when the request is no longer accessible', () => {
    renderDetail(
      decodeNotificationTarget({
        ...header,
        target_status: 'unavailable',
        kind: 'level_review_approved',
        level_review_context: null
      })
    );
    expect(
      screen.getByRole('heading', { level: 1, name: en.notifications.targetUnavailable })
    ).toBeTruthy();
    expect(screen.queryByText(/Verified on court/)).toBeNull();
  });
});
