/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  createRootRoute: (options: unknown) => ({
    options,
    useRouteContext: () => ({ locale: 'en', theme: 'light' })
  }),
  HeadContent: () => null,
  Outlet: () => null,
  Scripts: () => null,
  useRouterState: () => false
}));
vi.mock('../src/components/PwaRegistration', () => ({ PwaRegistration: () => null }));
vi.mock('../src/components/DevStyleXInject', () => ({ DevStyleXInject: () => null }));
vi.mock('../src/i18n/locale.functions', () => ({
  getInitialLocale: async () => 'en',
  saveLocale: async () => undefined
}));
vi.mock('../src/features/theme/theme.functions', () => ({
  getInitialTheme: async () => 'light',
  saveTheme: async () => undefined
}));

import { Route } from '../src/routes/__root';

afterEach(cleanup);

it('updates root preference labels after changing locale', async () => {
  const user = userEvent.setup();
  const RootComponent = Route.options.component;
  if (!RootComponent) throw new Error('Root route component is missing');

  render(createElement(RootComponent), { container: document });
  const localeSelect = screen.getByRole('combobox', { name: 'Language' });
  await user.selectOptions(localeSelect, 'pt-BR');
  await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Idioma' })).not.toBeNull());
  expect(screen.getByRole('combobox', { name: 'Tema' })).toBeTruthy();
  expect(screen.getByRole('option', { name: 'Escuro' })).toBeTruthy();

  await user.selectOptions(localeSelect, 'es');
  await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Idioma' })).not.toBeNull());
  expect(screen.getByRole('combobox', { name: 'Tema' })).toBeTruthy();
  expect(screen.getByRole('option', { name: 'Oscuro' })).toBeTruthy();

  await user.selectOptions(localeSelect, 'en');
  await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Language' })).not.toBeNull());
  expect(screen.getByRole('combobox', { name: 'Theme' })).toBeTruthy();
  expect(screen.getByRole('option', { name: 'Dark' })).toBeTruthy();
});
