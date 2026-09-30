/**
 * @vitest-environment jsdom
 */
import userEvent from '@testing-library/user-event';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter
} from '@tanstack/react-router';
import { AccountPrompt } from '../src/components/ui/AccountPrompt';

afterEach(cleanup);

async function renderPromptOnLogin() {
  const rootRoute = createRootRoute();
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/login',
    component: () =>
      createElement(AccountPrompt, {
        text: 'New to Padel Friend?',
        action: 'Create an account',
        to: '/onboarding/account'
      })
  });
  const accountRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/onboarding/account',
    component: () => createElement('div', null, 'account-route')
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([loginRoute, accountRoute]),
    history: createMemoryHistory({ initialEntries: ['/login'] })
  });
  await router.load();

  render(createElement(RouterProvider, { router }));
  return router;
}

describe('AccountPrompt', () => {
  it('renders the prompt text and the action link', async () => {
    await renderPromptOnLogin();

    expect(screen.getByText('New to Padel Friend?').tagName).toBe('P');
    const link = screen.getByRole('link', { name: 'Create an account' });
    expect(link.getAttribute('href')).toBe('/onboarding/account');
  });

  it('is reachable by keyboard as a focused link', async () => {
    const user = userEvent.setup();
    const router = await renderPromptOnLogin();

    await user.tab();
    const link = screen.getByRole('link', { name: 'Create an account' });
    expect(document.activeElement).toBe(link);
    await user.click(link);
    expect(router.state.location.pathname).toBe('/onboarding/account');
  });
});
