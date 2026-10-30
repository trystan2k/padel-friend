/** @vitest-environment jsdom */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import type { ComponentType } from 'react';

const mocks = vi.hoisted(() => ({
  targetV3: vi.fn<(input: { data: { notificationId: string } }) => Promise<unknown>>(),
  matchContext: vi.fn<(input: { data: { notificationId: string } }) => Promise<unknown>>(),
  markRead: vi.fn<(input: { data: { notificationId: string } }) => Promise<unknown>>(),
  accept: vi.fn<(input: { data: { notificationId: string } }) => Promise<unknown>>(),
  invalidate: vi.fn<() => Promise<void>>()
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useRouter: () => ({ invalidate: mocks.invalidate }),
  Link: ({
    children,
    params: _params,
    to
  }: {
    children: import('react').ReactNode;
    params?: object;
    to: string;
  }) => <a href={to}>{children}</a>
}));
vi.mock('../src/features/notifications/notifications.functions', () => ({
  getMyNotificationTargetV3: mocks.targetV3,
  getMyMatchNotificationContext: mocks.matchContext,
  markNotificationRead: mocks.markRead,
  acceptMyNotificationInvitation: mocks.accept
}));

import { createI18n } from '../src/i18n/config';
import en from '../src/locales/en/translation.json';
import {
  decodeNotificationTarget,
  type MatchNotificationContext,
  type NotificationTarget
} from '../src/features/notifications/notification-target';
import { NotificationDetailPage } from '../src/features/notifications/NotificationDetailPage';
import { Route as NotificationDetailRoute } from '../src/routes/_protected.notifications.$notificationId';
import { Route as NotificationListRoute } from '../src/routes/_protected.notifications.index';

// Rendered strings are asserted against the REAL en locale resource below, so
// any hardcoded copy in the component breaks these expectations.
const copy = en.notifications;
const outcomeCopy = en.matches.results.outcome;

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replace(`{{${key}}}`, String(value)),
    template
  );
}
const notificationId = '9f1c3b2a-7d4e-4c8a-9b2f-1e6d5a7c3b40';
const communityId = '11111111-1111-4111-8111-111111111111';
const invitationId = '22222222-2222-4222-8222-222222222222';
const communityName = 'Padel Norte';

const unavailable: NotificationTarget = {
  target_status: 'unavailable',
  community_id: null,
  community_name: null,
  invitation_id: null,
  membership_status: null
};
const invited: NotificationTarget = {
  target_status: 'invitation_available',
  community_id: communityId,
  community_name: communityName,
  invitation_id: invitationId,
  membership_status: null
};
const membership = (status: string): NotificationTarget => ({
  target_status: 'membership_available',
  community_id: communityId,
  community_name: communityName,
  invitation_id: null,
  membership_status: status
});
const availableMatch: NotificationTarget = {
  target_status: 'match_available',
  community_id: communityId,
  community_name: communityName,
  invitation_id: null,
  membership_status: null,
  match_event_id: '33333333-3333-4333-8333-333333333333',
  match_available: true
};
const resultTarget: NotificationTarget = {
  target_status: 'result_available',
  community_id: communityId,
  community_name: communityName,
  invitation_id: null,
  membership_status: null,
  match_event_id: availableMatch.match_event_id,
  match_available: true,
  kind: 'result_added',
  created_at: '2026-10-20T10:00:00.000Z',
  result_context: {
    notification_id: notificationId,
    notification_kind: 'result_added',
    match_event_id: availableMatch.match_event_id!,
    community_id: communityId,
    proposal_id: '44444444-4444-4444-8444-444444444444',
    proposal_version: 1,
    group_number: 2,
    proposal_status: 'pending',
    current_version: 1,
    current_status: 'pending',
    is_current: true,
    classification: 'team_a',
    winner_sets: 2,
    loser_sets: 0,
    score: '6–4, 6–3',
    submitted_by_name: 'Alex',
    review_deadline_at: '2026-10-22T10:00:00.000Z',
    venue: 'Central Court',
    starts_at: '2026-10-20T10:00:00.000Z',
    timezone: 'UTC',
    entry_ready: false
  }
};
const matchContext = (
  venue: string,
  extra: Partial<MatchNotificationContext> = {}
): MatchNotificationContext => ({
  match_event_id: availableMatch.match_event_id!,
  creator_display_name: 'Alex',
  scheduled_at: '2026-10-20T10:00:00.000Z',
  timezone: 'UTC',
  venue,
  event_type: 'friendly',
  playing_count: 0,
  reserve_count: 1,
  price_minor: null,
  currency: null,
  ...extra
});

function hasLoader(route: unknown): route is {
  options: { loader: (context: { params: { notificationId: string } }) => Promise<unknown> };
} {
  const options =
    typeof route === 'object' && route !== null ? Reflect.get(route, 'options') : null;
  return (
    typeof options === 'object' &&
    options !== null &&
    typeof Reflect.get(options, 'loader') === 'function'
  );
}

function detailLoader(params: { notificationId: string }): Promise<unknown> {
  if (!hasLoader(NotificationDetailRoute))
    throw new Error('Notification detail route has no loader');
  return NotificationDetailRoute.options.loader({ params });
}

type RouteErrorProps = { error: Error; reset: () => void };

function isRouteErrorComponent(value: unknown): value is ComponentType<RouteErrorProps> {
  return typeof value === 'function';
}

function routeErrorComponent(route: unknown) {
  const options =
    typeof route === 'object' && route !== null ? Reflect.get(route, 'options') : null;
  const errorComponent: unknown =
    typeof options === 'object' && options !== null ? Reflect.get(options, 'errorComponent') : null;
  if (!isRouteErrorComponent(errorComponent)) throw new Error('Route has no error component');
  return errorComponent;
}

function isTarget(value: unknown): value is NotificationTarget {
  return typeof value === 'object' && value !== null && 'target_status' in value;
}

function mountPage(target: NotificationTarget, context?: MatchNotificationContext | null) {
  return render(
    <I18nextProvider i18n={createI18n('en')}>
      <NotificationDetailPage
        notificationId={notificationId}
        target={target}
        matchContext={context}
      />
    </I18nextProvider>
  );
}

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: online });
}

beforeEach(() => {
  mocks.targetV3.mockReset();
  mocks.matchContext.mockReset();
  mocks.markRead.mockReset();
  mocks.accept.mockReset();
  mocks.invalidate.mockReset().mockResolvedValue(undefined);
  setOnline(true);
  mocks.targetV3.mockResolvedValue(unavailable);
  mocks.matchContext.mockResolvedValue(null);
  mocks.markRead.mockResolvedValue('2026-10-15T00:00:00.000Z');
  mocks.accept.mockResolvedValue({ community_id: communityId, status: 'active' });
});
afterEach(cleanup);

describe('notification detail page', () => {
  it('accepts safe cancellation targets and rejects malformed match links', () => {
    expect(
      decodeNotificationTarget({ ...availableMatch, kind: 'match_event_cancelled' })
    ).toMatchObject({ match_available: true });
    expect(() =>
      decodeNotificationTarget({ ...availableMatch, match_event_id: '../private' })
    ).toThrow('INVALID_NOTIFICATION_TARGET');
    expect(() => decodeNotificationTarget({ ...availableMatch, match_available: false })).toThrow(
      'INVALID_NOTIFICATION_TARGET'
    );
  });
  it.each(['match_event_ownership_transferred', 'match_event_cancelled'] as const)(
    'renders %s with a safe event target and noninvitation heading',
    async (kind) => {
      mountPage({ ...availableMatch, kind }, matchContext('Central Court'));
      expect(await screen.findByRole('heading', { name: copy.kinds[kind] })).toBeTruthy();
      expect(screen.getByRole('link', { name: copy.match.openEvent }).getAttribute('href')).toBe(
        `/matches/${availableMatch.match_event_id}`
      );
      expect(screen.queryByText(copy.match.invitedBy)).toBeNull();
    }
  );
  it('resolves an older playing notification to a current cancelled tombstone', async () => {
    mountPage(
      { ...availableMatch, kind: 'match_registration_playing' },
      matchContext('Central Court', { event_status: 'cancelled' })
    );
    expect(
      await screen.findByRole('heading', { name: copy.kinds.match_event_cancelled })
    ).toBeTruthy();
    expect(screen.getByText(copy.match.cancelledBody)).toBeTruthy();
  });
  it('renders a result alert with a validated group/version review link', async () => {
    mountPage(resultTarget);

    expect(await screen.findByRole('heading', { name: copy.kinds.result_added })).toBeTruthy();
    expect(
      screen.getByText(
        (_content, element) =>
          element?.tagName === 'P' &&
          (element.textContent?.includes(fill(copy.result.group, { number: 2 })) ?? false)
      )
    ).toBeTruthy();
    expect(screen.getByText(fill(copy.result.score, { score: '6–4, 6–3' }))).toBeTruthy();
    expect(
      screen.getByText(fill(outcomeCopy.team_a, { winnerSets: 2, loserSets: 0 }))
    ).toBeTruthy();
    expect(screen.getByText(fill(copy.result.submittedBy, { name: 'Alex' }))).toBeTruthy();
    expect(screen.getByRole('link', { name: copy.result.openResult }).getAttribute('href')).toBe(
      `/matches/${availableMatch.match_event_id}?result_group=2&result_proposal=44444444-4444-4444-8444-444444444444&result_version=1#result-group-2`
    );
  });
  it('keeps incomplete outcomes parameter-free and omits team outcomes without counts', async () => {
    const incompleteTarget: NotificationTarget = {
      ...resultTarget,
      result_context: {
        ...resultTarget.result_context!,
        classification: 'incomplete',
        winner_sets: null,
        loser_sets: null
      }
    };
    mountPage(incompleteTarget);

    expect(await screen.findByText(outcomeCopy.incomplete)).toBeTruthy();
    expect(screen.queryByText(/\{\{(?:winnerSets|loserSets)\}\}/)).toBeNull();

    cleanup();
    const missingTeamCountsTarget: NotificationTarget = {
      ...resultTarget,
      result_context: {
        ...resultTarget.result_context!,
        winner_sets: null,
        loser_sets: null
      }
    };
    mountPage(missingTeamCountsTarget);

    expect(await screen.findByRole('heading', { name: copy.kinds.result_added })).toBeTruthy();
    expect(screen.queryByText(/TEAM A WINS/)).toBeNull();
  });
  it('renders the localized unavailable state with a back link to the notification center', async () => {
    mountPage(unavailable);

    expect(await screen.findByRole('heading', { name: copy.targetUnavailable })).toBeTruthy();
    const back = screen.getByRole('link', { name: copy.back });
    expect(back.getAttribute('href')).toBe('/notifications');
    expect(screen.queryByRole('button')).toBeNull();
    await waitFor(() => expect(mocks.markRead).toHaveBeenCalledTimes(1));
  });

  it('renders the invited state and accepts through the server function using the notification id', async () => {
    let resolveAccept!: (result: unknown) => void;
    mocks.accept.mockReturnValueOnce(new Promise((resolve) => (resolveAccept = resolve)));
    mocks.targetV3.mockResolvedValueOnce(membership('active'));
    const user = userEvent.setup();
    mountPage(invited);

    expect(await screen.findByRole('heading', { name: communityName })).toBeTruthy();
    expect(screen.getByText(copy.invitationContext)).toBeTruthy();
    const acceptButton = screen.getByRole('button', { name: copy.accept });
    await user.click(acceptButton);
    expect(mocks.accept).toHaveBeenCalledWith({ data: { notificationId } });
    expect(await screen.findByRole('button', { name: copy.accepting })).toBeTruthy();
    resolveAccept({ community_id: communityId, status: 'active' });
    expect(await screen.findByText(copy.accepted)).toBeTruthy();
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
    expect(await screen.findByText(copy.activeMembership)).toBeTruthy();
    expect(screen.queryByRole('button', { name: copy.accept })).toBeNull();
    expect(mocks.targetV3).toHaveBeenCalledWith({ data: { notificationId } });
    await waitFor(() => expect(mocks.markRead).toHaveBeenCalledTimes(1));
  });

  it('renders the localized current membership status copy', async () => {
    mountPage(membership('active'));

    expect(await screen.findByText(copy.activeMembership)).toBeTruthy();
    expect(screen.queryByRole('button', { name: copy.accept })).toBeNull();
    cleanup();

    mountPage(membership('pending'));
    expect(await screen.findByText(copy.pendingMembership)).toBeTruthy();
    expect(screen.queryByRole('button', { name: copy.accept })).toBeNull();
  });

  it('retries a failed mark-read mutation instead of only refreshing the target', async () => {
    mocks.markRead.mockRejectedValueOnce(new Error('read marking failed'));
    const user = userEvent.setup();
    mountPage(invited);

    expect(await screen.findByRole('heading', { name: communityName })).toBeTruthy();
    expect((await screen.findByRole('alert')).textContent).toBe(copy.targetError);
    expect(mocks.targetV3).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: copy.retry }));

    await waitFor(() => expect(mocks.markRead).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mocks.targetV3).not.toHaveBeenCalled();
  });

  it('shows offline state, skips read writes, disables acceptance and reconciles on reconnect', async () => {
    setOnline(false);
    mocks.targetV3.mockResolvedValue(invited);
    mountPage(invited);

    expect(await screen.findByText(copy.offline)).toBeTruthy();
    expect(mocks.markRead).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: copy.accept })).toHaveProperty('disabled', true);

    setOnline(true);
    window.dispatchEvent(new Event('online'));
    await waitFor(() => expect(mocks.markRead).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.targetV3).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: copy.accept })).toHaveProperty('disabled', false);
  });

  it('refreshes the authorized match target and context together after reconnect', async () => {
    setOnline(false);
    mocks.targetV3.mockResolvedValue(availableMatch);
    mocks.matchContext.mockResolvedValue(matchContext('Updated club'));
    mountPage(availableMatch, matchContext('Stale club'));

    expect(await screen.findByText(/Stale club/)).toBeTruthy();
    setOnline(true);
    await act(async () => window.dispatchEvent(new Event('online')));

    expect(await screen.findByText(/Updated club/)).toBeTruthy();
    expect(screen.getByRole('link', { name: copy.match.openEvent }).getAttribute('href')).toBe(
      `/matches/${availableMatch.match_event_id}`
    );
    expect(mocks.targetV3).toHaveBeenCalledWith({ data: { notificationId } });
    expect(mocks.matchContext).toHaveBeenCalledWith({ data: { notificationId } });
  });

  it('uses v2 target and refreshes match context when retrying a failed reconnect', async () => {
    setOnline(false);
    mocks.targetV3.mockRejectedValueOnce(new Error('offline refresh failed'));
    mountPage(availableMatch, matchContext('Stale club'));
    expect(await screen.findByText(copy.offline)).toBeTruthy();
    setOnline(true);
    await act(async () => window.dispatchEvent(new Event('online')));

    expect(await screen.findByRole('alert')).toBeTruthy();
    mocks.targetV3.mockResolvedValueOnce(availableMatch);
    mocks.matchContext.mockResolvedValueOnce(matchContext('Retried club'));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: copy.retry }));

    expect(await screen.findByText(/Retried club/)).toBeTruthy();
    expect(mocks.targetV3).toHaveBeenCalledTimes(2);
    expect(mocks.matchContext).toHaveBeenCalledTimes(1);
  });

  it('provides localized retry and safe back navigation for route loader errors', async () => {
    const user = userEvent.setup();
    const reset = vi.fn<() => void>();
    const ListError = routeErrorComponent(NotificationListRoute);
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <ListError error={new Error('load failed')} reset={reset} />
      </I18nextProvider>
    );

    expect(screen.getByRole('alert').textContent).toBe(copy.error);
    expect(
      screen.getByRole('link', { name: en.communityAdmin.backToDashboard }).getAttribute('href')
    ).toBe('/dashboard');
    await user.click(screen.getByRole('button', { name: copy.retry }));
    await waitFor(() => expect(mocks.invalidate).toHaveBeenCalledTimes(1));
    expect(reset).toHaveBeenCalledTimes(1);

    cleanup();
    const detailReset = vi.fn<() => void>();
    const DetailError = routeErrorComponent(NotificationDetailRoute);
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <DetailError error={new Error('load failed')} reset={detailReset} />
      </I18nextProvider>
    );
    expect(screen.getByRole('alert').textContent).toBe(copy.error);
    expect(screen.getByRole('link', { name: copy.back }).getAttribute('href')).toBe(
      '/notifications'
    );
    await user.click(screen.getByRole('button', { name: copy.retry }));
    await waitFor(() => expect(mocks.invalidate).toHaveBeenCalledTimes(2));
    expect(detailReset).toHaveBeenCalledTimes(1);
  });

  it('marks unread notifications read after mount only, never inside the loader', async () => {
    const loaded = await detailLoader({ notificationId });

    expect(loaded).toEqual({ ...unavailable, matchContext: null });
    expect(mocks.targetV3).toHaveBeenCalledTimes(1);
    expect(mocks.targetV3).toHaveBeenCalledWith({ data: { notificationId } });
    expect(mocks.markRead).not.toHaveBeenCalled();

    if (!isTarget(loaded)) throw new Error('Loader returned no notification target');
    mountPage(loaded);

    await waitFor(() => expect(mocks.markRead).toHaveBeenCalledTimes(1));
    expect(mocks.markRead).toHaveBeenCalledWith({ data: { notificationId } });
    expect(mocks.targetV3).toHaveBeenCalledTimes(1);
  });

  it('loads authorized match details through v3 target and context resolvers', async () => {
    const context = matchContext('Authorized club');
    mocks.targetV3.mockResolvedValueOnce(availableMatch);
    mocks.matchContext.mockResolvedValueOnce(context);

    await expect(detailLoader({ notificationId })).resolves.toEqual({
      ...availableMatch,
      matchContext: context
    });
    expect(mocks.targetV3).toHaveBeenCalledWith({ data: { notificationId } });
    expect(mocks.matchContext).toHaveBeenCalledWith({ data: { notificationId } });
  });

  it('loads authorized result context from the v3 target without a match-context request', async () => {
    mocks.targetV3.mockResolvedValueOnce(resultTarget);

    await expect(detailLoader({ notificationId })).resolves.toEqual({
      ...resultTarget,
      matchContext: null
    });
    expect(mocks.targetV3).toHaveBeenCalledWith({ data: { notificationId } });
    expect(mocks.matchContext).not.toHaveBeenCalled();
  });

  it('uses current FIFO position rather than historical ordinal after departures', async () => {
    mountPage(
      { ...availableMatch, kind: 'match_registration_playing' },
      matchContext('Current court', {
        caller_participation: 'playing',
        caller_accepted_order: 5,
        caller_roster_position: 4,
        playing_count: 4
      })
    );
    expect(
      await screen.findByRole('heading', {
        name: fill(copy.match.registrationPlayingTitle, { group: 1 })
      })
    ).toBeTruthy();
    expect(
      screen.queryByRole('heading', {
        name: fill(copy.match.registrationPlayingTitle, { group: 2 })
      })
    ).toBeNull();
  });

  it.each([
    ['match_invitation_accepted', 'invitationAcceptedBody'],
    ['match_invitation_declined', 'invitationDeclinedBody'],
    ['match_invitation_expired', 'invitationExpiredBody'],
    ['match_registration_withdrawn', 'registrationWithdrawnBody'],
    ['match_registration_removed', 'registrationRemovedBody'],
    ['match_registration_group_changed', 'registrationGroupChangedBody']
  ] as const)('renders %s with lifecycle copy and safe match target', async (kind, body) => {
    mountPage({ ...availableMatch, kind }, matchContext('Invitation court'));
    expect(await screen.findByRole('heading', { name: copy.kinds[kind] })).toBeTruthy();
    expect(screen.getByText(copy.match[body])).toBeTruthy();
    expect(screen.queryByText(copy.match.invitedBy)).toBeNull();
    expect(screen.getByRole('link', { name: copy.match.openEvent }).getAttribute('href')).toBe(
      `/matches/${availableMatch.match_event_id}`
    );
  });

  it('renders the cutoff expired kind with its own heading and body copy', async () => {
    mountPage(
      { ...availableMatch, kind: 'match_registration_expired' },
      matchContext('Expiry court')
    );

    expect(
      await screen.findByRole('heading', { name: copy.kinds.match_registration_expired })
    ).toBeTruthy();
    expect(screen.getByText(copy.match.registrationExpiredBody)).toBeTruthy();
    expect(screen.queryByText(copy.match.invitedBy)).toBeNull();
    expect(screen.getByRole('link', { name: copy.match.openEvent }).getAttribute('href')).toBe(
      `/matches/${availableMatch.match_event_id}`
    );
  });

  it('distinguishes broadcast publication from invitation and preserves copy on reconnect', async () => {
    const published = { ...availableMatch, kind: 'match_event_published' };
    setOnline(false);
    mocks.targetV3.mockResolvedValue(published);
    mocks.matchContext.mockResolvedValue(matchContext('Published court'));
    mountPage(published, matchContext('Published court'));

    expect(
      await screen.findByRole('heading', { name: copy.kinds.match_event_published })
    ).toBeTruthy();
    expect(screen.getByText(fill(copy.match.publishedBy, { name: 'Alex' }))).toBeTruthy();
    expect(screen.queryByText(copy.match.invitedBy)).toBeNull();
    expect(screen.queryByRole('button', { name: copy.accept })).toBeNull();

    setOnline(true);
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(await screen.findByText(fill(copy.match.publishedBy, { name: 'Alex' }))).toBeTruthy();
    expect(screen.getByRole('heading', { name: copy.kinds.match_event_published })).toBeTruthy();

    cleanup();
    mountPage({ ...availableMatch, kind: 'match_event_invitation' }, matchContext('Invite court'));
    expect(
      await screen.findByRole('heading', { name: copy.kinds.match_event_invitation })
    ).toBeTruthy();
    expect(screen.getByText(fill(copy.match.invitedBy, { name: 'Alex' }))).toBeTruthy();
    expect(screen.queryByText(copy.match.publishedBy)).toBeNull();
  });

  it('uses generic copy for missing notification kind instead of invitation wording', async () => {
    mountPage(availableMatch, matchContext('Unknown court'));

    expect(await screen.findByRole('heading', { name: copy.generic })).toBeTruthy();
    expect(screen.getAllByText(copy.generic)).toHaveLength(2);
    expect(screen.queryByText(copy.match.invitedBy)).toBeNull();
  });

  it('renders the cutoff not-playing kind with its own heading and body copy', async () => {
    mountPage(
      { ...availableMatch, kind: 'match_registration_not_playing' },
      matchContext('NotPlaying court')
    );

    expect(
      await screen.findByRole('heading', { name: copy.kinds.match_registration_not_playing })
    ).toBeTruthy();
    expect(screen.getByText(copy.match.registrationNotPlayingBody)).toBeTruthy();
    expect(screen.queryByText(copy.match.registrationExpiredBody)).toBeNull();
  });

  it('degrades a cutoff kind without match context to the kind heading and unavailable copy', async () => {
    mountPage({ ...availableMatch, kind: 'match_registration_not_playing' }, null);

    expect(
      await screen.findByRole('heading', { name: copy.kinds.match_registration_not_playing })
    ).toBeTruthy();
    expect(screen.getByText(copy.match.unavailable)).toBeTruthy();
    expect(screen.queryByText(copy.match.registrationNotPlayingBody)).toBeNull();
  });

  it('renders a present-tense reserve position only while the caller is still on reserve', async () => {
    mountPage(
      { ...availableMatch, kind: 'match_registration_reserve' },
      matchContext('Reserve court', {
        caller_participation: 'reserve',
        caller_accepted_order: 7,
        playing_count: 4
      })
    );

    expect(
      await screen.findByText(
        fill(copy.match.registrationReserveBody, { position: 3, event: 'Reserve court' })
      )
    ).toBeTruthy();
    expect(screen.queryByText(copy.match.registrationReservePromotedBody)).toBeNull();
    expect(screen.queryByText(copy.match.registrationReserveNotPlayingBody)).toBeNull();
  });

  it('uses historical wording for a caller promoted since the reserve alert', async () => {
    mountPage(
      { ...availableMatch, kind: 'match_registration_reserve' },
      matchContext('Promoted court', {
        caller_participation: 'playing',
        caller_accepted_order: 2,
        playing_count: 4
      })
    );

    expect(
      await screen.findByText(
        fill(copy.match.registrationReservePromotedBody, { group: 1, event: 'Promoted court' })
      )
    ).toBeTruthy();
    // The old present-tense copy clamped a promoted caller to a fabricated #1.
    expect(
      screen.queryByText(
        fill(copy.match.registrationReserveBody, { position: 1, event: 'Promoted court' })
      )
    ).toBeNull();
  });

  it('uses historical wording for a caller no longer playing after the reserve alert', async () => {
    mountPage(
      { ...availableMatch, kind: 'match_registration_reserve' },
      matchContext('Closed court', {
        caller_participation: 'reserve_not_playing',
        caller_accepted_order: 9,
        playing_count: 4
      })
    );

    expect(
      await screen.findByText(
        fill(copy.match.registrationReserveNotPlayingBody, { event: 'Closed court' })
      )
    ).toBeTruthy();
    expect(
      screen.queryByText(
        fill(copy.match.registrationReserveBody, { position: 5, event: 'Closed court' })
      )
    ).toBeNull();
  });
});
