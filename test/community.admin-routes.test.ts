import { createMemoryHistory, createRouter } from '@tanstack/react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({
  context: vi.fn<(input: { data: unknown }) => Promise<unknown>>(),
  defaults: vi.fn<(input: { data: unknown }) => Promise<unknown>>(),
  members: vi.fn<(input: { data: unknown }) => Promise<unknown>>(),
  member: vi.fn<(input: { data: unknown }) => Promise<unknown>>(),
  venues: vi.fn<(input: { data: unknown }) => Promise<unknown>>(),
  audit: vi.fn<(input: { data: unknown }) => Promise<unknown>>(),
  onboarding: vi.fn<() => Promise<unknown>>(),
  locale: vi.fn<() => Promise<unknown>>(),
  theme: vi.fn<() => Promise<unknown>>()
}));

vi.mock('../src/features/community/community-admin.functions', () => ({
  getCommunityAdminContext: calls.context,
  getCommunityAdminDefaults: calls.defaults,
  searchCommunityMembers: calls.members,
  getCommunityMemberById: calls.member,
  listCommunityVenues: calls.venues,
  listCommunityAudit: calls.audit
}));
vi.mock('../src/features/player/player.functions', () => ({
  getOnboardingStatus: calls.onboarding
}));
vi.mock('../src/i18n/locale.functions', () => ({
  getInitialLocale: calls.locale,
  saveLocale: vi.fn<(input: unknown) => Promise<void>>()
}));
vi.mock('../src/features/theme/theme.functions', () => ({
  getInitialTheme: calls.theme,
  saveTheme: vi.fn<(input: unknown) => Promise<void>>()
}));

import { Route as AdminRoute } from '../src/routes/_protected.community.$communityId.admin';
import { Route as AdminIndexRoute } from '../src/routes/_protected.community.$communityId.admin.index';
import { Route as AuditRoute } from '../src/routes/_protected.community.$communityId.admin.audit';
import { Route as MembersRoute } from '../src/routes/_protected.community.$communityId.admin.members';
import { Route as MemberDetailRoute } from '../src/routes/_protected.community.$communityId.admin.members.$membershipId';
import { Route as MembersIndexRoute } from '../src/routes/_protected.community.$communityId.admin.members.index';
import { Route as ProtectedRoute } from '../src/routes/_protected';
import { Route as RequestsRoute } from '../src/routes/_protected.community.$communityId.admin.requests';
import { Route as SettingsRoute } from '../src/routes/_protected.community.$communityId.admin.settings';
import { Route as VenuesRoute } from '../src/routes/_protected.community.$communityId.admin.venues';
import { routeTree } from '../src/routeTree.gen';

const communityId = '11111111-1111-4111-8111-111111111111';
const membershipId = '22222222-2222-4222-8222-222222222222';
const community = { id: communityId, name: 'Test community' };
const routeParams = { communityId, membershipId };

function hasLoader(
  route: unknown
): route is { options: { loader: (context: { params: typeof routeParams }) => Promise<unknown> } } {
  return (
    typeof route === 'object' &&
    route !== null &&
    typeof Reflect.get(route, 'options') === 'object' &&
    typeof Reflect.get(Reflect.get(route, 'options'), 'loader') === 'function'
  );
}

function loader(route: unknown) {
  if (!hasLoader(route)) throw new Error('Route has no loader');
  return route.options.loader;
}

type RouteNode = {
  options: { id: string; getParentRoute?: () => RouteNode };
  children?: RouteNode[];
};

function routeNodes(parent: unknown): RouteNode[] {
  if (typeof parent !== 'object' || parent === null) return [];
  const children = Reflect.get(parent, 'children');
  if (typeof children !== 'object' || children === null) return [];
  return Object.values(children).filter(isRouteNode);
}

function isRouteNode(value: unknown): value is RouteNode {
  const options =
    typeof value === 'object' && value !== null ? Reflect.get(value, 'options') : null;
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof options === 'object' &&
    options !== null &&
    typeof Reflect.get(options, 'id') === 'string' &&
    typeof Reflect.get(value, 'update') === 'function'
  );
}

function makeRouter(path: string) {
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] })
  });
}

function invokeBeforeLoad(route: unknown, context: unknown): unknown {
  if (typeof route !== 'object' || route === null) throw new Error('Invalid route');
  const options = Reflect.get(route, 'options');
  const beforeLoad =
    typeof options === 'object' && options !== null ? Reflect.get(options, 'beforeLoad') : null;
  if (typeof beforeLoad !== 'function') throw new Error('Route has no beforeLoad');
  return Reflect.apply(beforeLoad, route, [context]);
}

beforeEach(() => {
  calls.defaults.mockResolvedValue({
    timezone: 'Europe/Madrid',
    currency: 'EUR',
    member_created_leagues_enabled: true
  });
  vi.clearAllMocks();
  calls.context.mockResolvedValue(community);
  calls.members.mockResolvedValue([{ membership_id: membershipId }]);
  calls.member.mockResolvedValue({ membership_id: membershipId });
  calls.venues.mockResolvedValue([{ id: 'venue' }]);
  calls.audit.mockResolvedValue([{ id: 'audit' }]);
  calls.onboarding.mockResolvedValue({ authenticated: true, complete: true });
  calls.locale.mockResolvedValue('en');
  calls.theme.mockResolvedValue('light');
});

describe('community admin executable routes', () => {
  it('runs each data leaf loader with authorization first and correct params/counts', async () => {
    const cases = [
      {
        route: RequestsRoute,
        reader: calls.members,
        resultKey: 'members',
        expected: { community_id: communityId, query: '', status: 'pending', offset: 0, limit: 50 }
      },
      {
        route: MembersIndexRoute,
        reader: calls.members,
        resultKey: 'members',
        expected: { community_id: communityId, query: '', status: 'active', offset: 0, limit: 50 }
      },
      {
        route: VenuesRoute,
        reader: calls.venues,
        resultKey: 'venues',
        expected: { community_id: communityId, offset: 0, limit: 50 }
      },
      {
        route: AuditRoute,
        reader: calls.audit,
        resultKey: 'audit',
        expected: { community_id: communityId, offset: 0, limit: 3 }
      },
      {
        route: MemberDetailRoute,
        reader: calls.member,
        resultKey: 'member',
        expected: { community_id: communityId, membership_id: membershipId }
      }
    ] as const;

    for (const { route, reader, resultKey, expected } of cases) {
      vi.clearAllMocks();
      calls.context.mockResolvedValue(community);
      calls.members.mockResolvedValue([{ membership_id: membershipId }]);
      calls.member.mockResolvedValue({ membership_id: membershipId });
      calls.venues.mockResolvedValue([{ id: 'venue' }]);
      calls.audit.mockResolvedValue([{ id: 'audit' }]);
      const result = await loader(route)({ params: routeParams });
      expect(calls.context).toHaveBeenCalledExactlyOnceWith({
        data: { community_id: communityId }
      });
      expect(reader).toHaveBeenCalledExactlyOnceWith({ data: expected });
      const contextOrder = calls.context.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER;
      const readerOrder = reader.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER;
      expect(contextOrder).toBeLessThan(readerOrder);
      expect(typeof result).toBe('object');
      if (typeof result !== 'object' || result === null || !(resultKey in result))
        throw new Error(`Loader result is missing ${resultKey}`);
      const value: unknown = Reflect.get(result, resultKey);
      const observed =
        resultKey === 'member' && typeof value === 'object' && value !== null
          ? Reflect.get(value, 'membership_id')
          : Array.isArray(value)
            ? value.length
            : null;
      expect(observed).toEqual(resultKey === 'member' ? membershipId : 1);
    }

    for (const { route, reader } of cases) {
      vi.clearAllMocks();
      calls.context.mockRejectedValue(new Error('NOT_COMMUNITY_ADMIN'));
      await expect(loader(route)({ params: routeParams })).rejects.toThrow('NOT_COMMUNITY_ADMIN');
      expect(calls.context).toHaveBeenCalledExactlyOnceWith({
        data: { community_id: communityId }
      });
      expect(calls.members).not.toHaveBeenCalled();
      expect(calls.member).not.toHaveBeenCalled();
      expect(calls.venues).not.toHaveBeenCalled();
      expect(calls.audit).not.toHaveBeenCalled();
      expect(reader).not.toHaveBeenCalled();
    }
  });

  it('runs admin and settings context loaders with their route params', async () => {
    calls.defaults.mockResolvedValue({
      timezone: 'Europe/Madrid',
      currency: 'EUR',
      member_created_leagues_enabled: true
    });
    await expect(loader(AdminRoute)({ params: routeParams })).resolves.toEqual(community);
    expect(calls.context).toHaveBeenCalledExactlyOnceWith({ data: { community_id: communityId } });
    calls.context.mockClear();
    await expect(loader(SettingsRoute)({ params: routeParams })).resolves.toEqual({
      community,
      defaults: { timezone: 'Europe/Madrid', currency: 'EUR', member_created_leagues_enabled: true }
    });
    expect(calls.context).toHaveBeenCalledExactlyOnceWith({ data: { community_id: communityId } });
    expect(calls.members).not.toHaveBeenCalled();
    expect(calls.venues).not.toHaveBeenCalled();
    expect(calls.audit).not.toHaveBeenCalled();
  });

  it('executes the actual generated protected/admin/members/index/detail hierarchy', () => {
    const protectedRoute = routeNodes(routeTree).find(
      (route) => route.options.id === '/_protected'
    );
    const adminRoute = protectedRoute?.children?.find(
      (route) => route.options.id === '/community/$communityId/admin'
    );
    const membersRoute = adminRoute?.children?.find((route) => route.options.id === '/members');
    expect(adminRoute?.options.getParentRoute?.()).toBe(protectedRoute);
    expect(membersRoute?.options.getParentRoute?.()).toBe(adminRoute);
    expect(membersRoute?.children?.find((route) => route.options.id === '/')).toBeDefined();
    expect(
      membersRoute?.children
        ?.find((route) => route.options.id === '/$membershipId')
        ?.options.getParentRoute?.()
    ).toBe(membersRoute);
  });

  it('redirects admin root to requests and resolves members trailing slash to its index leaf', async () => {
    let redirect: unknown;
    try {
      invokeBeforeLoad(AdminIndexRoute, { params: { communityId } });
    } catch (error) {
      redirect = error;
    }
    expect(redirect).toBeDefined();
    if (typeof redirect !== 'object' || redirect === null) throw new Error('Expected redirect');
    expect(Reflect.get(Reflect.get(redirect, 'options'), 'to')).toBe(
      '/community/$communityId/admin/requests'
    );

    const membersRouter = makeRouter(`/community/${communityId}/admin/members/`);
    const matches = membersRouter.matchRoutes(`/community/${communityId}/admin/members/`);
    expect(matches.map((match) => match.routeId)).toContain(
      '/_protected/community/$communityId/admin/members/'
    );
  });

  it('navigates to detail without invoking the active-roster loader', async () => {
    const router = makeRouter(`/community/${communityId}/admin/members/${membershipId}`);
    const matches = router.matchRoutes(`/community/${communityId}/admin/members/${membershipId}`);
    expect(matches.map((match) => match.routeId)).toContain(
      '/_protected/community/$communityId/admin/members/$membershipId'
    );
    await loader(MemberDetailRoute)({ params: routeParams });
    expect(calls.member).toHaveBeenCalledExactlyOnceWith({
      data: { community_id: communityId, membership_id: membershipId }
    });
    expect(calls.members).not.toHaveBeenCalled();
  });

  it.each([
    [{ authenticated: false, complete: false }, '/login'],
    [{ authenticated: true, complete: false }, '/onboarding']
  ])('redirects protected admin navigation for status %j', async (status, destination) => {
    calls.onboarding.mockResolvedValue(status);
    await expect(
      Promise.resolve().then(() =>
        invokeBeforeLoad(ProtectedRoute, {
          location: { href: `/community/${communityId}/admin/members` }
        })
      )
    ).rejects.toMatchObject({ options: { to: destination } });
    expect(calls.onboarding).toHaveBeenCalledOnce();
    expect(calls.context).not.toHaveBeenCalled();
    expect(calls.members).not.toHaveBeenCalled();
  });

  it('surfaces a live non-admin failure without reading private route data', async () => {
    calls.context.mockRejectedValue(new Error('NOT_COMMUNITY_ADMIN'));
    await expect(loader(VenuesRoute)({ params: routeParams })).rejects.toThrow(
      'NOT_COMMUNITY_ADMIN'
    );
    expect(calls.context).toHaveBeenCalled();
    expect(calls.venues).not.toHaveBeenCalled();
  });

  it('recovers the admin loader after a transient first failure', async () => {
    calls.context.mockRejectedValueOnce(new Error('temporary loader failure'));
    calls.context.mockResolvedValueOnce(community);
    await expect(loader(AdminRoute)({ params: routeParams })).rejects.toThrow(
      'temporary loader failure'
    );
    await expect(loader(AdminRoute)({ params: routeParams })).resolves.toEqual(community);
    expect(calls.context).toHaveBeenCalledTimes(2);
  });

  it('keeps route-level redirect and loader exports bound to the actual route definitions', () => {
    expect(AdminRoute.options.loader).toBeDefined();
    expect(AdminIndexRoute.options.beforeLoad).toBeDefined();
    expect(MembersRoute.options.component).toBeDefined();
    expect(SettingsRoute.options.loader).toBeDefined();
  });
});
