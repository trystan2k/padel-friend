/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter
} from '@tanstack/react-router';
import { createElement } from 'react';
import { jsx } from 'react/jsx-runtime';
import { afterEach, describe, expect, it } from 'vitest';
import { TextLink } from '../src/components/ui/TextLink';

afterEach(cleanup);

async function renderLink() {
  const root = createRootRoute();
  const login = createRoute({
    getParentRoute: () => root,
    path: '/login',
    component: () => jsx(TextLink, { to: '/dashboard', children: 'Dashboard' })
  });
  const dashboard = createRoute({
    getParentRoute: () => root,
    path: '/dashboard',
    component: () => createElement('div', null, 'Dashboard destination')
  });
  const router = createRouter({
    routeTree: root.addChildren([login, dashboard]),
    history: createMemoryHistory({ initialEntries: ['/login'] })
  });
  await router.load();
  render(createElement(RouterProvider, { router }));
  return router;
}

describe('TextLink', () => {
  it('uses a native keyboard-accessible link for TanStack navigation', async () => {
    const router = await renderLink();
    const link = screen.getByRole('link', { name: 'Dashboard' });
    expect(link.getAttribute('href')).toBe('/dashboard');
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(link);
    await user.click(link);
    expect(router.state.location.pathname).toBe('/dashboard');
  });
});
