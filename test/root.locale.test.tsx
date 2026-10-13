/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ saveLocale: vi.fn<() => Promise<void>>() }));

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
  saveLocale: mocks.saveLocale
}));
vi.mock('../src/features/theme/theme.functions', () => ({
  getInitialTheme: async () => 'light',
  saveTheme: async () => undefined
}));

import { Route } from '../src/routes/__root';

afterEach(cleanup);

function renderRoot() {
  const RootComponent = Route.options.component;
  if (!RootComponent) throw new Error('Root route component is missing');
  return render(createElement(RootComponent), { container: document });
}

function getLocaleSelect() {
  const control = screen.getByRole('combobox', { name: 'Language' });
  if (!(control instanceof HTMLSelectElement)) throw new Error('Locale control is not a select');
  return control;
}

beforeEach(() => {
  mocks.saveLocale.mockReset().mockResolvedValue();
});

it('updates root preference labels after changing locale', async () => {
  const user = userEvent.setup();
  renderRoot();
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
  expect(document.documentElement.lang).toBe('en');
});

it('keeps locale copy, root state, and document language coherent when persistence rejects', async () => {
  let rejectSave!: (error: Error) => void;
  mocks.saveLocale.mockReturnValueOnce(
    new Promise<void>((_resolve, reject) => (rejectSave = reject))
  );
  const user = userEvent.setup();
  renderRoot();
  const selector = getLocaleSelect();
  await user.selectOptions(selector, 'es');
  await waitFor(() => expect(mocks.saveLocale).toHaveBeenCalledWith({ data: 'es' }));
  await act(async () => rejectSave(new Error('offline')));
  await waitFor(() => expect(selector.value).toBe('en'));
  expect(screen.getByRole('combobox', { name: 'Language' })).toBeTruthy();
  expect(screen.queryByRole('combobox', { name: 'Idioma' })).toBeNull();
  expect(document.documentElement.lang).toBe('en');
});

it('serializes overlapping locale selections and commits only the latest selection', async () => {
  let finishFirst!: () => void;
  let finishSecond!: () => void;
  mocks.saveLocale
    .mockReturnValueOnce(new Promise<void>((resolve) => (finishFirst = resolve)))
    .mockReturnValueOnce(new Promise<void>((resolve) => (finishSecond = resolve)));
  renderRoot();
  const selector = getLocaleSelect();
  fireEvent.change(selector, { target: { value: 'pt-BR' } });
  await waitFor(() => expect(mocks.saveLocale).toHaveBeenCalledTimes(1));
  fireEvent.change(selector, { target: { value: 'es' } });
  expect(mocks.saveLocale).toHaveBeenCalledTimes(1);
  await act(async () => finishFirst());
  await waitFor(() => expect(mocks.saveLocale).toHaveBeenCalledTimes(2));
  expect(document.documentElement.lang).toBe('en');
  expect(screen.getByRole('combobox', { name: 'Language' })).toBeTruthy();
  expect(selector.value).toBe('en');
  await act(async () => finishSecond());
  await waitFor(() => expect(document.documentElement.lang).toBe('es'));
  expect(mocks.saveLocale).toHaveBeenNthCalledWith(1, { data: 'pt-BR' });
  expect(mocks.saveLocale).toHaveBeenNthCalledWith(2, { data: 'es' });
  expect(screen.getByRole('combobox', { name: 'Idioma' })).toBeTruthy();
  expect(selector.value).toBe('es');
});
