/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from '@testing-library/react';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter
} from '@tanstack/react-router';
import { readFileSync } from 'node:fs';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it } from 'vitest';
import { AppShell } from '../src/features/app-shell/AppShell';
import { createI18n } from '../src/i18n/config';

afterEach(cleanup);

async function mount(entry: string, locale: 'en' | 'pt-BR' | 'es' = 'en') {
  const root = createRootRoute({
    component: () => (
      <I18nextProvider i18n={createI18n(locale)}>
        <Outlet />
        <AppShell />
      </I18nextProvider>
    )
  });
  const page = createRoute({
    getParentRoute: () => root,
    path: '$',
    component: () => <main data-testid="page" />
  });
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: [entry] })
  });
  render(<RouterProvider router={router} />);
  await screen.findByTestId('page');
}

describe('AppShell', () => {
  it('renders exactly one navigation with the five destinations in order', async () => {
    await mount('/dashboard');
    const navs = screen.getAllByRole('navigation');
    expect(navs).toHaveLength(1);
    const links = within(navs[0]!).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/dashboard',
      '/matches',
      '/matches/create',
      '/dashboard#home-community',
      '/me'
    ]);
    expect(links.map((link) => link.getAttribute('aria-label') ?? link.textContent)).toEqual([
      'Home',
      'Matches',
      'Create a match',
      'Community',
      'Me'
    ]);
    expect(within(navs[0]!).queryByText('Ranking')).toBeNull();
  });

  it.each([
    ['/dashboard', 'Home'],
    ['/dashboard#home-community', 'Community'],
    ['/matches', 'Matches'],
    ['/matches/my', 'Matches'],
    ['/matches/past', 'Matches'],
    ['/me', 'Me'],
    ['/players/p1', 'Me'],
    ['/community/c1/statistics', 'Community']
  ])('marks only the owning destination current on %s', async (entry, label) => {
    await mount(entry);
    const current = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');
    expect(current.map((link) => link.textContent)).toEqual([label]);
  });

  it('never marks the central Create action as current', async () => {
    await mount('/matches');
    expect(
      screen.getByRole('link', { name: 'Create a match' }).getAttribute('aria-current')
    ).toBeNull();
  });

  it('gives Create and every tab a target of at least 44px through tokens', () => {
    const styles = readFileSync('src/features/app-shell/app-shell.styles.ts', 'utf8');
    expect(styles).toContain("const target = 'calc(var(--space-40) + var(--space-16))'");
    expect(styles).toMatch(/minHeight: target/);
    expect(styles).toMatch(/width: target,\s+height: target/);
  });

  it.each([
    '/matches/create',
    '/matches/e1',
    '/matches/e1/record',
    '/matches/e1/groups/g1',
    '/community/c1/leagues/create',
    '/community/c1/admin/members',
    '/level-reviews/new',
    '/notifications/n1'
  ])('suppresses the bar on wizard, result and nested screen %s', async (entry) => {
    await mount(entry);
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(document.querySelector('[data-app-nav]')).toBeNull();
  });

  it.each([
    [
      'pt-BR',
      ['Início', 'Partidas', 'Criar uma partida', 'Comunidade', 'Eu'],
      'Navegação principal'
    ],
    ['es', ['Inicio', 'Partidos', 'Crear un partido', 'Comunidad', 'Yo'], 'Navegación principal']
  ] as const)('translates the bar in %s', async (locale, labels, name) => {
    await mount('/me', locale);
    const nav = screen.getByRole('navigation', { name });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.getAttribute('aria-label') ?? link.textContent)
    ).toEqual(labels);
  });
});

describe('protected shell wiring', () => {
  const read = (path: string) => readFileSync(path, 'utf8');

  it('mounts the shell once, in the protected layout only', () => {
    expect(read('src/routes/_protected.tsx')).toContain('<AppShell />');
    for (const path of [
      'src/routes/__root.tsx',
      'src/routes/index.tsx',
      'src/routes/_protected.dashboard.tsx',
      'src/routes/_protected.me.tsx',
      'src/features/matches/RecordMatchResultPage.tsx',
      'src/features/matches/MatchResultDetail.tsx'
    ])
      expect(read(path)).not.toContain('<AppShell');
  });

  it('keeps the public homepage and auth journeys outside the protected layout', () => {
    expect(read('src/routes/index.tsx')).not.toContain("'/_protected");
    expect(read('src/routes/index.tsx')).toContain("createFileRoute('/')");
    expect(read('src/routes/__root.tsx')).toContain('isAuthJourney');
  });

  it('composes the existing profile on a dedicated Me route', () => {
    const me = read('src/routes/_protected.me.tsx');
    expect(me).toContain("createFileRoute('/_protected/me')");
    expect(me).toContain('<PlayerProfile');
    expect(me).toContain('getMyPlayerProfile');
    expect(me).toContain('loadRatingView');
  });

  it('keeps the shared bar inset in sync across shell, scroll padding and the PWA banner', () => {
    const inset =
      'calc(var(--space-6) + var(--space-40) + var(--space-16) + max(var(--space-18), env(safe-area-inset-bottom))';
    expect(read('src/features/app-shell/app-shell.styles.ts')).toContain(inset);
    expect(read('src/features/pwa/pwa.styles.ts')).toContain(inset);
    expect(read('src/routes/__root.tsx')).toContain('viewport-fit=cover');
  });
});
