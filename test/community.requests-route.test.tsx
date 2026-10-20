/** @vitest-environment jsdom */
import { act, render, screen } from '@testing-library/react';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  context: vi.fn<(input: { data: { community_id: string } }) => Promise<unknown>>(),
  defaults: vi.fn<() => Promise<unknown>>(),
  members: vi.fn<() => Promise<unknown>>(),
  onboarding: vi.fn<() => Promise<unknown>>(),
  locale: vi.fn<() => Promise<unknown>>(),
  theme: vi.fn<() => Promise<unknown>>()
}));
vi.mock('../src/features/community/community-admin.functions', () => ({
  getCommunityAdminContext: mocks.context,
  getCommunityAdminDefaults: mocks.defaults,
  searchCommunityMembers: mocks.members
}));
vi.mock('../src/features/player/player.functions', () => ({
  getOnboardingStatus: mocks.onboarding
}));
vi.mock('../src/i18n/locale.functions', () => ({ getInitialLocale: mocks.locale }));
vi.mock('../src/features/theme/theme.functions', () => ({ getInitialTheme: mocks.theme }));
vi.mock('../src/features/community/CommunityAdmin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/features/community/CommunityAdmin')>();
  return {
    ...actual,
    CommunityAdminScreen: ({
      datasetGeneration,
      community,
      members
    }: {
      datasetGeneration: number;
      community: { id: string };
      members: { display_name: string }[];
    }) => (
      <output data-testid="revision" data-generation={datasetGeneration}>
        {community.id}:{members.map((row) => row.display_name).join(',')}
      </output>
    )
  };
});

import { routeTree } from '../src/routeTree.gen';

const community = (id: string) => ({
  id,
  name: id,
  city_label: null,
  description: null,
  visibility: 'private',
  join_policy: 'admin_approval'
});
const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  mocks.context.mockImplementation(({ data }: { data: { community_id: string } }) =>
    Promise.resolve(community(data.community_id))
  );
  mocks.defaults.mockResolvedValue({
    timezone: 'Europe/Madrid',
    currency: 'EUR',
    member_created_leagues_enabled: true
  });
  mocks.members.mockImplementation(async ({ data }: { data: { community_id: string } }) => [
    { display_name: data.community_id === second ? 'Community B row' : 'Same row' }
  ]);
  mocks.onboarding.mockResolvedValue({ authenticated: true, complete: true });
  mocks.locale.mockResolvedValue('en');
  mocks.theme.mockResolvedValue('light');
});

it('publishes a new generation per invalidated loader, not per rerender, and scopes rows by community', async () => {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [`/community/${first}/admin/requests`] })
  });
  await router.load();
  const view = render(<RouterProvider router={router} />);
  expect((await screen.findByTestId('revision')).getAttribute('data-generation')).toBe('1');
  const initial = screen.getByTestId('revision').getAttribute('data-generation');
  view.rerender(<RouterProvider router={router} />);
  expect(screen.getByTestId('revision').getAttribute('data-generation')).toBe(initial);
  await act(async () => router.invalidate());
  expect(screen.getByTestId('revision').getAttribute('data-generation')).toBe('2');
  expect(mocks.members).toHaveBeenCalledTimes(2);
  await act(async () =>
    router.navigate({
      to: '/community/$communityId/admin/requests',
      params: { communityId: second }
    })
  );
  expect(screen.getByTestId('revision').textContent).toBe(`${second}:Community B row`);
  expect(screen.getByTestId('revision').getAttribute('data-generation')).toBe('3');
});
