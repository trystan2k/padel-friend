/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  saveLocale: vi.fn<(input: { data: string }) => Promise<void>>(),
  cookie: 'en'
}));

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
  document.cookie = 'locale=; path=/; max-age=0';
  mocks.cookie = 'en';
  mocks.saveLocale.mockReset().mockImplementation(async ({ data }) => persistedSave(data));
});

function persistedSave(locale: string) {
  mocks.cookie = locale;
  document.cookie = `locale=${locale}; path=/; samesite=lax`;
}

it('keeps compact preference chips native with complete options and accessible names', async () => {
  const user = userEvent.setup();
  renderRoot();
  const locale = getLocaleSelect();
  expect([...locale.options].map((option) => option.text)).toEqual([
    'English',
    'Português (Brasil)',
    'Español'
  ]);
  expect(locale.closest('label')?.querySelector('[aria-hidden="true"]')?.textContent).toBe('en');
  const theme = screen.getByRole('combobox', { name: 'Theme' });
  expect(theme).toBeInstanceOf(HTMLSelectElement);
  await user.selectOptions(theme, 'dark');
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(theme.closest('label')?.querySelector('[aria-hidden="true"]')?.textContent).toBe('Dark');
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

it('restores committed locale after obsolete save succeeds and latest save fails', async () => {
  let finishFirst!: () => void;
  let rejectSecond!: (error: Error) => void;
  mocks.saveLocale
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishFirst = () => {
            persistedSave('pt-BR');
            resolve();
          };
        })
    )
    .mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSecond = reject;
        })
    )
    .mockImplementationOnce(async () => persistedSave('en'));
  renderRoot();
  const selector = getLocaleSelect();
  fireEvent.change(selector, { target: { value: 'pt-BR' } });
  await waitFor(() => expect(mocks.saveLocale).toHaveBeenCalledTimes(1));
  fireEvent.change(selector, { target: { value: 'es' } });
  expect(mocks.saveLocale).toHaveBeenCalledTimes(1);
  await act(async () => finishFirst());
  await waitFor(() => expect(mocks.saveLocale).toHaveBeenCalledTimes(2));
  await act(async () => rejectSecond(new Error('offline')));
  await waitFor(() => expect(mocks.saveLocale).toHaveBeenCalledTimes(3));
  await waitFor(() => expect(mocks.cookie).toBe('en'));
  expect(selector.value).toBe('en');
  expect(document.documentElement.lang).toBe('en');
  expect(screen.getByRole('combobox', { name: 'Language' })).toBeTruthy();
  expect(mocks.saveLocale).toHaveBeenNthCalledWith(3, { data: 'en' });
});

it('restores a non-English committed preference before processing the next queued choice', async () => {
  renderRoot();
  const selector = getLocaleSelect();
  fireEvent.change(selector, { target: { value: 'pt-BR' } });
  await waitFor(() => expect(document.documentElement.lang).toBe('pt-BR'));
  expect(mocks.cookie).toBe('pt-BR');

  let finishObsolete!: () => void;
  let rejectLatest!: (error: Error) => void;
  let finishRecovery!: () => void;
  let finishNext!: () => void;
  mocks.saveLocale
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishObsolete = () => {
            persistedSave('en');
            resolve();
          };
        })
    )
    .mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectLatest = reject;
        })
    )
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRecovery = () => {
            persistedSave('pt-BR');
            resolve();
          };
        })
    )
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishNext = () => {
            persistedSave('en');
            resolve();
          };
        })
    );
  fireEvent.change(selector, { target: { value: 'en' } });
  await waitFor(() => expect(mocks.saveLocale).toHaveBeenCalledTimes(2));
  fireEvent.change(selector, { target: { value: 'es' } });
  await act(async () => finishObsolete());
  await waitFor(() => expect(mocks.saveLocale).toHaveBeenCalledTimes(3));
  await act(async () => rejectLatest(new Error('offline')));
  await waitFor(() => expect(mocks.saveLocale).toHaveBeenCalledTimes(4));
  expect(mocks.saveLocale).toHaveBeenNthCalledWith(3, { data: 'es' });
  expect(mocks.saveLocale).toHaveBeenNthCalledWith(4, { data: 'pt-BR' });
  expect(mocks.saveLocale).toHaveBeenCalledTimes(4);
  fireEvent.change(selector, { target: { value: 'en' } });
  await act(async () => finishRecovery());
  await waitFor(() => expect(mocks.cookie).toBe('pt-BR'));
  await waitFor(() => expect(mocks.saveLocale).toHaveBeenCalledTimes(5));
  await act(async () => finishNext());
  await waitFor(() => expect(document.documentElement.lang).toBe('en'));
  expect(mocks.saveLocale).toHaveBeenNthCalledWith(5, { data: 'en' });
  expect(mocks.cookie).toBe('en');
});

it('keeps committed UI on failed recovery and restores consistency on a later selection', async () => {
  let finishFirst!: () => void;
  let rejectSecond!: (error: Error) => void;
  let rejectRecovery!: (error: Error) => void;
  mocks.saveLocale
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishFirst = () => {
            persistedSave('pt-BR');
            resolve();
          };
        })
    )
    .mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSecond = reject;
        })
    )
    .mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectRecovery = reject;
        })
    );
  renderRoot();
  const selector = getLocaleSelect();
  fireEvent.change(selector, { target: { value: 'pt-BR' } });
  await waitFor(() => expect(mocks.saveLocale).toHaveBeenCalledTimes(1));
  fireEvent.change(selector, { target: { value: 'es' } });
  await act(async () => finishFirst());
  await waitFor(() => expect(mocks.saveLocale).toHaveBeenCalledTimes(2));
  await act(async () => rejectSecond(new Error('offline')));
  await waitFor(() => expect(mocks.saveLocale).toHaveBeenCalledTimes(3));
  await act(async () => rejectRecovery(new Error('still offline')));
  await waitFor(() => expect(selector.value).toBe('en'));
  expect(document.documentElement.lang).toBe('en');
  expect(mocks.cookie).toBe('pt-BR');

  mocks.saveLocale.mockImplementationOnce(async ({ data }) => persistedSave(data));
  fireEvent.change(selector, { target: { value: 'es' } });
  await waitFor(() => expect(document.documentElement.lang).toBe('es'));
  expect(selector.value).toBe('es');
  expect(mocks.cookie).toBe('es');
});
