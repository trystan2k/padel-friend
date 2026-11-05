/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from '@tanstack/react-router';

// The real route tree is loaded with every private server function mocked, so the guards,
// loaders and result shapes of the player level review pages are proven at the route boundary.
const mocks = vi.hoisted(() => ({
  onboarding: vi.fn<() => Promise<{ authenticated: boolean; complete: boolean; claim: null }>>(),
  list: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  get: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  submit: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  cancel: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  summary: vi.fn<(...args: unknown[]) => Promise<unknown>>()
}));
vi.mock('../src/features/player/player.functions', () => ({
  getOnboardingStatus: mocks.onboarding,
  getMyPlayerProfile: vi.fn<() => Promise<unknown>>(),
  onboardPlayer: vi.fn<() => Promise<void>>(),
  updateMyPlayerProfile: vi.fn<() => Promise<void>>(),
  completeAvatarUpload: vi.fn<() => Promise<void>>()
}));
vi.mock('../src/features/level-reviews/level-review.functions', () => ({
  listMyLevelReviewRequests: mocks.list,
  getMyLevelReviewRequest: mocks.get,
  submitLevelReviewRequest: mocks.submit,
  cancelLevelReviewRequest: mocks.cancel
}));
vi.mock('../src/features/player/rating.functions', () => ({
  getMyRatingSummary: mocks.summary
}));
vi.mock('../src/features/theme/theme.functions', () => ({
  getInitialTheme: vi.fn<() => Promise<string>>(async () => 'light'),
  saveTheme: vi.fn<() => void>()
}));
vi.mock('../src/i18n/locale.functions', () => ({
  getInitialLocale: vi.fn<() => Promise<string>>(async () => 'pt-BR'),
  saveLocale: vi.fn<() => void>()
}));

import { routeTree } from '../src/routeTree.gen';

const ID = '11111111-1111-4111-8111-111111111111';
const COMPLETE = { authenticated: true, complete: true, claim: null };
const request = {
  id: ID,
  status: 'pending',
  snapshot_display_level: 3.82,
  snapshot_reliability_percent: 76,
  requested_min_level: 4,
  requested_max_level: 4,
  reason: 'reason',
  evidence: null,
  created_at: '2026-09-24T10:00:00.000000Z',
  under_review_at: null,
  canceled_at: null,
  decided_at: null,
  decision_note: null,
  approved_level: null,
  adjustment_id: null
};
const summaryResponse = {
  status: 'ok',
  value: {
    revision: 3,
    state: 'ready',
    summary: { display_level: 3.82, reliability_percent: 76 }
  }
};

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.onboarding.mockResolvedValue(COMPLETE);
  mocks.summary.mockResolvedValue(summaryResponse);
});

async function load(entry: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [entry] })
  });
  await router.load();
  return router;
}
const dataOf = (router: Awaited<ReturnType<typeof load>>, routeId: string): unknown =>
  router.state.matches.find((match) => match.routeId === routeId)?.loaderData;

const PATHS = {
  index: '/level-reviews',
  new: '/level-reviews/new',
  detail: '/level-reviews/' + ID
} as const;

describe('level review route guards', () => {
  it.each(Object.values(PATHS))(
    'sends an anonymous visitor from %s to sign-in before any read',
    async (path) => {
      mocks.onboarding.mockResolvedValue({ authenticated: false, complete: false, claim: null });
      const router = await load(path);
      expect(router.state.location.pathname).toBe('/login');
      for (const mock of [mocks.list, mocks.get, mocks.summary, mocks.submit, mocks.cancel])
        expect(mock).not.toHaveBeenCalled();
    }
  );

  it.each(Object.values(PATHS))(
    'sends a player who has not finished onboarding from %s to onboarding',
    async (path) => {
      mocks.onboarding.mockResolvedValue({ authenticated: true, complete: false, claim: null });
      const router = await load(path);
      expect(router.state.location.pathname).toBe('/onboarding');
      for (const mock of [mocks.list, mocks.get, mocks.summary])
        expect(mock).not.toHaveBeenCalled();
    }
  );

  it('keeps the three pages under the protected parent', async () => {
    const router = createRouter({ routeTree });
    expect(router.routesById['/_protected/level-reviews/'].parentRoute.id).toBe('/_protected');
    expect(router.routesById['/_protected/level-reviews/new'].parentRoute.id).toBe('/_protected');
    expect(router.routesById['/_protected/level-reviews/$requestId'].parentRoute.id).toBe(
      '/_protected'
    );
  });
});

describe('/level-reviews (history)', () => {
  const id = '/_protected/level-reviews/';

  it('loads the first keyset page for the signed-in owner', async () => {
    const page = { items: [request], next_cursor: null };
    mocks.list.mockResolvedValue(page);
    const router = await load(PATHS.index);
    expect(mocks.list).toHaveBeenCalledWith({ data: { limit: 20 } });
    expect(dataOf(router, id)).toEqual({
      result: { status: 'ok', value: page },
      locale: 'pt-BR'
    });
  });

  it('keeps an empty list distinct from a failure', async () => {
    mocks.list.mockResolvedValue({ items: [], next_cursor: null });
    expect(dataOf(await load(PATHS.index), id)).toMatchObject({
      result: { status: 'ok', value: { items: [] } }
    });
  });

  it.each([
    ['LEVEL_REVIEW_FORBIDDEN', 'LEVEL_REVIEW_FORBIDDEN'],
    ['PROVISIONAL_PLAYER_RESTRICTED', 'PROVISIONAL_PLAYER_RESTRICTED'],
    ['LEVEL_REVIEW_UNAVAILABLE', 'LEVEL_REVIEW_UNAVAILABLE'],
    ['UNAUTHENTICATED', 'UNAUTHENTICATED'],
    ['socket hang up', 'LEVEL_REVIEW_UNAVAILABLE']
  ])('surfaces a %s failure instead of an empty list', async (message, code) => {
    mocks.list.mockRejectedValue(new Error(message));
    expect(dataOf(await load(PATHS.index), id)).toMatchObject({
      result: { status: 'error', code }
    });
  });
});

describe('/level-reviews/new', () => {
  const id = '/_protected/level-reviews/new';

  it('reads only the server-owned current level', async () => {
    const router = await load(PATHS.new);
    expect(dataOf(router, id)).toEqual({
      current: { status: 'ok', current: { display_level: 3.82, reliability_percent: 76 } },
      locale: 'pt-BR'
    });
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('reports a player without a rating as unavailable, not as a level', async () => {
    mocks.summary.mockResolvedValue({
      status: 'ok',
      value: { revision: 1, state: 'unavailable', summary: null }
    });
    expect(dataOf(await load(PATHS.new), id)).toMatchObject({
      current: { status: 'ok', current: null }
    });
  });

  it.each([
    [{ status: 'error', code: 'forbidden' }, 'forbidden'],
    [{ status: 'error', code: 'unavailable' }, 'unavailable']
  ])('surfaces a rating reader error %j', async (response, code) => {
    mocks.summary.mockResolvedValue(response);
    expect(dataOf(await load(PATHS.new), id)).toMatchObject({ current: { status: 'error', code } });
  });

  it('maps a lost session and a transport failure to explicit errors', async () => {
    mocks.summary.mockRejectedValue(new Error('UNAUTHENTICATED'));
    expect(dataOf(await load(PATHS.new), id)).toMatchObject({
      current: { status: 'error', code: 'unauthenticated' }
    });
    mocks.summary.mockRejectedValue(new Error('boom'));
    expect(dataOf(await load(PATHS.new), id)).toMatchObject({
      current: { status: 'error', code: 'unavailable' }
    });
  });
});

describe('/level-reviews/$requestId', () => {
  const id = '/_protected/level-reviews/$requestId';

  it('loads the owner request and the current level together', async () => {
    mocks.get.mockResolvedValue({ request });
    const router = await load(PATHS.detail);
    expect(mocks.get).toHaveBeenCalledWith({ data: { request_id: ID } });
    expect(dataOf(router, id)).toEqual({
      result: { status: 'ok', value: request },
      current: { status: 'ok', current: { display_level: 3.82, reliability_percent: 76 } },
      locale: 'pt-BR'
    });
  });

  it('answers a malformed id as not found without a round trip', async () => {
    const router = await load('/level-reviews/not-a-uuid');
    expect(mocks.get).not.toHaveBeenCalled();
    expect(dataOf(router, id)).toMatchObject({
      result: { status: 'error', code: 'LEVEL_REVIEW_NOT_FOUND' }
    });
  });

  it('shows another player or a missing request as a denial, never as data', async () => {
    mocks.get.mockRejectedValue(new Error('LEVEL_REVIEW_NOT_FOUND'));
    expect(dataOf(await load(PATHS.detail), id)).toMatchObject({
      result: { status: 'error', code: 'LEVEL_REVIEW_NOT_FOUND' }
    });
    mocks.get.mockRejectedValue(new Error('LEVEL_REVIEW_FORBIDDEN'));
    expect(dataOf(await load(PATHS.detail), id)).toMatchObject({
      result: { status: 'error', code: 'LEVEL_REVIEW_FORBIDDEN' }
    });
  });

  it('surfaces a server failure and an undecodable response', async () => {
    mocks.get.mockRejectedValue(new Error('LEVEL_REVIEW_UNAVAILABLE'));
    expect(dataOf(await load(PATHS.detail), id)).toMatchObject({
      result: { status: 'error', code: 'LEVEL_REVIEW_UNAVAILABLE' }
    });
    mocks.get.mockRejectedValue(new Error('INVALID_LEVEL_REVIEW_RESPONSE'));
    expect(dataOf(await load(PATHS.detail), id)).toMatchObject({
      result: { status: 'error', code: 'INVALID_LEVEL_REVIEW_RESPONSE' }
    });
  });

  it('still shows the request when only the current level read fails', async () => {
    mocks.get.mockResolvedValue({ request });
    mocks.summary.mockResolvedValue({ status: 'error', code: 'unavailable' });
    expect(dataOf(await load(PATHS.detail), id)).toMatchObject({
      result: { status: 'ok' },
      current: { status: 'error', code: 'unavailable' }
    });
  });
});
