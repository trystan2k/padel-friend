/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter
} from '@tanstack/react-router';
import { createI18n, supportedLocales, type Locale } from '../src/i18n/config';
import { PRIVACY_CONTACT_EMAIL } from '../src/features/privacy/privacy-content';
import { PublicHomepage } from '../src/features/public-homepage/PublicHomepage';
import en from '../src/locales/en/translation.json';
import es from '../src/locales/es/translation.json';
import pt from '../src/locales/pt-BR/translation.json';

const catalogs = { en, es, 'pt-BR': pt } as const;

afterEach(cleanup);

async function renderHomepage(locale: Locale, authenticated: boolean) {
  const i18n = createI18n(locale);
  const rootRoute = createRootRoute({
    component: () => createElement(I18nextProvider, { i18n }, createElement(Outlet))
  });
  const routes = ['/', '/login', '/onboarding/account', '/dashboard'].map((path) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      component:
        path === '/'
          ? () => createElement(PublicHomepage, { authenticated })
          : () => createElement('div')
    })
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren(routes),
    history: createMemoryHistory({ initialEntries: ['/'] })
  });
  await router.load();
  render(createElement(RouterProvider, { router }));
}

const featureKeys = ['findMatches', 'inviteFriends', 'trackResults'] as const;

describe('PublicHomepage', () => {
  it.each(supportedLocales)('renders the guest variant in %s', async (locale) => {
    await renderHomepage(locale, false);
    const copy = catalogs[locale].publicHomepage;

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(copy.hero.title);
    expect(screen.getByText(copy.hero.description)).toBeTruthy();
    expect(screen.getByRole('link', { name: copy.actions.signIn }).getAttribute('href')).toBe(
      '/login'
    );
    expect(
      screen.getByRole('link', { name: copy.actions.createAccount }).getAttribute('href')
    ).toBe('/onboarding/account');
    expect(screen.queryByRole('link', { name: copy.actions.dashboard })).toBeNull();
  });

  it.each(supportedLocales)('renders the signed-in variant in %s', async (locale) => {
    await renderHomepage(locale, true);
    const copy = catalogs[locale].publicHomepage;

    expect(screen.getByRole('link', { name: copy.actions.dashboard }).getAttribute('href')).toBe(
      '/dashboard'
    );
    expect(screen.getByText(copy.actions.signedInNote)).toBeTruthy();
    expect(screen.queryByRole('link', { name: copy.actions.signIn })).toBeNull();
    expect(screen.queryByRole('link', { name: copy.actions.createAccount })).toBeNull();
    // Same public body in both states.
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(copy.hero.title);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(copy.features.heading);
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(3);
    expect(screen.getByRole('contentinfo')).toBeTruthy();
  });

  it('has header, main and footer landmarks with one h1 and a features section heading and three subordinate card headings', async () => {
    await renderHomepage('en', false);

    expect(screen.getAllByRole('banner')).toHaveLength(1);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getAllByRole('contentinfo')).toHaveLength(1);
    expect(within(screen.getByRole('banner')).getByText(en.publicHomepage.brand)).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { level: 2 }).textContent).toBe(
      en.publicHomepage.features.heading
    );
    expect(
      within(main)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent)
    ).toEqual(featureKeys.map((key) => en.publicHomepage.features[key].title));
    const items = within(within(main).getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    featureKeys.forEach((key, index) => {
      expect(items[index]?.textContent).toContain(en.publicHomepage.features[key].description);
    });
    expect(document.querySelectorAll('[id]')).toHaveLength(0);
  });

  it('keeps the decorative icons out of the accessibility tree and has no nested interactives', async () => {
    await renderHomepage('en', false);

    const logo = document.querySelector('header img');
    expect(logo?.getAttribute('alt')).toBe('');
    expect(logo?.getAttribute('src')).toContain('padel-friends-app-icon.png');
    const icons = document.querySelectorAll('svg');
    expect(icons).toHaveLength(3);
    for (const icon of icons) expect(icon.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(document.querySelectorAll('a a, a button, button a')).toHaveLength(0);
    expect(document.querySelectorAll('button')).toHaveLength(0);
  });

  it.each(supportedLocales)(
    'has a canonical privacy link and contact mailto in %s',
    async (locale) => {
      await renderHomepage(locale, false);
      const footer = within(screen.getByRole('contentinfo'));
      const copy = catalogs[locale];

      const privacy = footer.getByRole('link', { name: copy.auth.privacyLink });
      expect(privacy.getAttribute('href')).toBe('/privacy');
      expect(new URL(privacy.getAttribute('href') ?? '', 'https://app.padelfriend.es').href).toBe(
        'https://app.padelfriend.es/privacy'
      );
      expect(footer.getByText(copy.publicHomepage.footer.contact)).toBeTruthy();
      const email = footer.getByRole('link', { name: PRIVACY_CONTACT_EMAIL });
      expect(email.getAttribute('href')).toBe(`mailto:${PRIVACY_CONTACT_EMAIL}`);
      expect(footer.getByText(copy.publicHomepage.footer.operator)).toBeTruthy();
      expect(footer.getByText(copy.publicHomepage.footer.audience)).toBeTruthy();
    }
  );

  it('interpolates the visible contact address through i18n', () => {
    expect(en.publicHomepage.footer.contactEmail).toBe('{{email}}');
  });
});

describe('publicHomepage copy contract', () => {
  const leafPaths = (value: object, prefix = ''): string[] =>
    Object.entries(value).flatMap(([key, child]) =>
      typeof child === 'string' ? [`${prefix}${key}`] : leafPaths(child, `${prefix}${key}.`)
    );
  const expectedPaths = [
    'actions.createAccount',
    'actions.dashboard',
    'actions.signIn',
    'actions.signedInNote',
    'brand',
    'features.findMatches.description',
    'features.findMatches.title',
    'features.heading',
    'features.inviteFriends.description',
    'features.inviteFriends.title',
    'features.trackResults.description',
    'features.trackResults.title',
    'footer.audience',
    'footer.contact',
    'footer.contactEmail',
    'footer.operator',
    'hero.description',
    'hero.title'
  ];

  it.each(supportedLocales)('defines every key path as raw %s resources', (locale) => {
    const group = catalogs[locale].publicHomepage;

    expect(leafPaths(group).sort()).toEqual(expectedPaths);
    for (const path of expectedPaths) {
      const text = path
        .split('.')
        .reduce<unknown>(
          (node, key) =>
            typeof node === 'object' && node !== null ? Reflect.get(node, key) : node,
          group
        );
      expect(typeof text === 'string' && text.trim().length > 0).toBe(true);
    }
    expect(group.footer.contactEmail).toBe('{{email}}');
  });

  it.each(['es', 'pt-BR'] as const)('translates the visible copy in %s', (locale) => {
    const group = catalogs[locale].publicHomepage;

    expect(group.hero.title).not.toBe(en.publicHomepage.hero.title);
    expect(group.hero.description).not.toBe(en.publicHomepage.hero.description);
    expect(group.actions.signIn).not.toBe(en.publicHomepage.actions.signIn);
    expect(group.actions.dashboard).not.toBe(en.publicHomepage.actions.dashboard);
    expect(group.footer.operator).not.toBe(en.publicHomepage.footer.operator);
    expect(group.footer.audience).not.toBe(en.publicHomepage.footer.audience);
  });

  it('keeps the approved English copy', () => {
    expect(en.publicHomepage.hero.title).toBe('Find your next padel match.');
    expect(en.publicHomepage.footer.operator).toBe(
      'Padel Friends is run by Thiago Mendonça, an individual operator based in Spain.'
    );
    expect(en.publicHomepage.footer.audience).toBe('For players aged 16 and over.');
  });
});
