import { describe, expect, it, vi } from 'vitest';
import type { MyMatchRegistration } from '../src/features/matches/match-registration-model';

const mocks = vi.hoisted(() => ({
  getMatchEvent: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  getMyMatchRegistration: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  listMatchEventRegistrationRequests: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  listMatchEventRegistrations: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  getMyPlayerProfile: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  getMyMatchInvitation: vi.fn<(...args: unknown[]) => Promise<unknown>>()
}));

vi.mock('../src/features/matches/matches.functions', () => ({
  getMatchEvent: mocks.getMatchEvent
}));
vi.mock('../src/features/matches/match-registration.functions', () => ({
  getMyMatchRegistration: mocks.getMyMatchRegistration,
  listMatchEventRegistrationRequests: mocks.listMatchEventRegistrationRequests,
  listMatchEventRegistrations: mocks.listMatchEventRegistrations,
  submitMatchRegistration: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  decideMatchRegistration: vi.fn<(...args: unknown[]) => Promise<unknown>>()
}));
vi.mock('../src/features/player/player.functions', () => ({
  getMyPlayerProfile: mocks.getMyPlayerProfile
}));
vi.mock('../src/features/matches/match-invitation.functions', () => ({
  getMyMatchInvitation: mocks.getMyMatchInvitation,
  respondMatchEventInvitation: vi.fn<(...args: unknown[]) => Promise<unknown>>()
}));
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  useRouter: () => ({ invalidate: vi.fn<() => Promise<void>>() }),
  Link: ({ children }: { children: import('react').ReactNode }) => children
}));

import {
  loadCallerLevel,
  loadMatchRegistration,
  loadMatchRequestQueue,
  loadMatchRoster,
  Route
} from '../src/routes/_protected.matches.$eventId';

const EVENT_ID = '00000000-0000-4000-8000-000000000001';

type MatchDetailRoute = {
  options: { loader: (context: { params: { eventId: string } }) => Promise<unknown> };
};

function hasLoader(route: unknown): route is MatchDetailRoute {
  const options =
    typeof route === 'object' && route !== null ? Reflect.get(route, 'options') : null;
  return (
    typeof options === 'object' &&
    options !== null &&
    typeof Reflect.get(options, 'loader') === 'function'
  );
}

function routeLoader(): MatchDetailRoute['options']['loader'] {
  if (!hasLoader(Route)) throw new Error('Match detail route has no loader');
  return Route.options.loader;
}

describe('match detail registration route loaders', () => {
  it('loads the caller registration DTO without nesting the flat event projection', async () => {
    const registration: MyMatchRegistration = {
      state: 'pending',
      event_id: EVENT_ID,
      registration_source: 'member',
      requested_at: '2026-10-18T09:30:00.000Z'
    };
    mocks.getMyMatchRegistration.mockResolvedValue({ status: 'ok', registration });
    expect(await loadMatchRegistration(EVENT_ID)).toEqual({
      registration,
      registrationFailed: false
    });
    expect(mocks.getMyMatchRegistration).toHaveBeenCalledWith({ data: { event_id: EVENT_ID } });
  });

  it('treats an unavailable registration read as a failed load', async () => {
    mocks.getMyMatchRegistration.mockResolvedValueOnce({ status: 'unavailable' });
    expect(await loadMatchRegistration(EVENT_ID)).toEqual({
      registration: null,
      registrationFailed: true
    });
    mocks.getMyMatchRegistration.mockRejectedValueOnce(new Error('boom'));
    expect(await loadMatchRegistration(EVENT_ID)).toEqual({
      registration: null,
      registrationFailed: true
    });
  });

  it('loads the creator queue and distinguishes empty from unavailable', async () => {
    const queue = {
      event_id: EVENT_ID,
      accepted_count: 0,
      playing_count: 0,
      reserve_count: 0,
      maximum_registrations: 8,
      registration_cutoff_at: '2026-10-20T17:30:00.000Z',
      requests: []
    };
    mocks.listMatchEventRegistrationRequests.mockResolvedValueOnce({ status: 'ok', queue });
    expect(await loadMatchRequestQueue(EVENT_ID)).toEqual({ queue, queueFailed: false });

    mocks.listMatchEventRegistrationRequests.mockResolvedValueOnce({ status: 'empty' });
    expect(await loadMatchRequestQueue(EVENT_ID)).toEqual({ queue: null, queueFailed: false });

    mocks.listMatchEventRegistrationRequests.mockResolvedValueOnce({ status: 'unavailable' });
    expect(await loadMatchRequestQueue(EVENT_ID)).toEqual({ queue: null, queueFailed: true });
  });

  it('loads the accepted roster and degrades empty/unavailable/non-readable reads to absent', async () => {
    const entries = [
      {
        display_name: 'Ada',
        display_level: 3.5,
        participation: 'playing',
        group_number: 1,
        reserve_position: null,
        registration_source: 'member',
        accepted_order: 1
      }
    ];
    mocks.listMatchEventRegistrations.mockResolvedValueOnce({ status: 'ok', entries });
    expect(await loadMatchRoster(EVENT_ID)).toEqual({ roster: entries });
    expect(mocks.listMatchEventRegistrations).toHaveBeenCalledWith({
      data: { event_id: EVENT_ID }
    });

    // Empty (a non-readable event returns no rows) and unavailable both degrade
    // to an absent roster, never a throw.
    mocks.listMatchEventRegistrations.mockResolvedValueOnce({ status: 'empty' });
    expect(await loadMatchRoster(EVENT_ID)).toEqual({ roster: null });
    mocks.listMatchEventRegistrations.mockResolvedValueOnce({ status: 'unavailable' });
    expect(await loadMatchRoster(EVENT_ID)).toEqual({ roster: null });
    mocks.listMatchEventRegistrations.mockRejectedValueOnce(new Error('boom'));
    expect(await loadMatchRoster(EVENT_ID)).toEqual({ roster: null });
  });

  it('loads the caller level best-effort', async () => {
    mocks.getMyPlayerProfile.mockResolvedValueOnce({ display_level: 3.82 });
    expect(await loadCallerLevel()).toBe(3.82);
    mocks.getMyPlayerProfile.mockResolvedValueOnce({ display_level: null });
    expect(await loadCallerLevel()).toBeNull();
    mocks.getMyPlayerProfile.mockRejectedValueOnce(new Error('PLAYER_NOT_ONBOARDED'));
    expect(await loadCallerLevel()).toBeNull();
  });

  it('forwards a failed registration read through the route loader', async () => {
    mocks.getMatchEvent.mockResolvedValue({ status: 'ok', event: { event_id: EVENT_ID } });
    mocks.getMyMatchRegistration.mockResolvedValue({ status: 'unavailable' });
    mocks.listMatchEventRegistrations.mockResolvedValue({ status: 'empty' });
    mocks.getMyPlayerProfile.mockResolvedValue({ display_level: null });
    mocks.getMyMatchInvitation.mockResolvedValue({ status: 'empty' });

    const data = await routeLoader()({ params: { eventId: EVENT_ID } });
    if (typeof data !== 'object' || data === null) throw new Error('route loader returned no data');
    expect(Reflect.get(data, 'registration')).toBeNull();
    expect(Reflect.get(data, 'registrationFailed')).toBe(true);
  });
  it('loads own invitation separately and degrades unavailable invitation reads safely', async () => {
    const invitation = {
      invitation_id: EVENT_ID,
      status: 'pending',
      effective_status: 'pending',
      expires_at: '2030-01-01T00:00:00Z',
      responded_at: null
    };
    mocks.getMatchEvent.mockResolvedValue({ status: 'ok', event: { event_id: EVENT_ID } });
    mocks.getMyMatchRegistration.mockResolvedValue({ status: 'unavailable' });
    mocks.listMatchEventRegistrations.mockResolvedValue({ status: 'empty' });
    mocks.getMyPlayerProfile.mockResolvedValue({ display_level: null });
    mocks.getMyMatchInvitation.mockResolvedValueOnce({ status: 'ok', invitation });
    expect(await routeLoader()({ params: { eventId: EVENT_ID } })).toMatchObject({ invitation });
    expect(mocks.getMyMatchInvitation).toHaveBeenCalledWith({ data: { event_id: EVENT_ID } });
    mocks.getMyMatchInvitation.mockRejectedValueOnce(new Error('unavailable'));
    expect(await routeLoader()({ params: { eventId: EVENT_ID } })).toMatchObject({
      invitation: null
    });
  });
});
