/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
import {
  PRIVACY_CONTACT_EMAIL,
  PRIVACY_POLICY_APPROVED,
  PRIVACY_SECTIONS,
  PRIVACY_UPDATED_AT
} from '../src/features/privacy/privacy-content';
import { PrivacyPolicy } from '../src/features/privacy/PrivacyPolicy';
import en from '../src/locales/en/translation.json';
import es from '../src/locales/es/translation.json';
import pt from '../src/locales/pt-BR/translation.json';

// The real route tree is loaded with every private/server module stubbed: the policy route
// must resolve for a signed-out visitor, so any guard or auth lookup on it would be a defect.
const playerFunctions = vi.hoisted(() => ({
  getOnboardingStatus: vi.fn<() => Promise<{ authenticated: boolean; complete: boolean }>>(),
  getMyPlayerProfile: vi.fn<() => Promise<{ display_name: string }>>(),
  onboardPlayer: vi.fn<() => Promise<void>>(),
  updateMyPlayerProfile: vi.fn<() => Promise<void>>(),
  completeAvatarUpload: vi.fn<() => Promise<void>>()
}));
vi.mock('../src/features/player/player.functions', () => playerFunctions);
vi.mock('../src/features/community/community.functions', () => ({
  listPublicCommunities: vi.fn<() => Promise<{ communities: []; next_offset: null }>>(),
  joinCommunity: vi.fn<() => void>(),
  createCommunity: vi.fn<() => void>()
}));
vi.mock('../src/features/theme/theme.functions', () => ({
  getInitialTheme: vi.fn<() => Promise<string>>(async () => 'light'),
  saveTheme: vi.fn<() => void>()
}));
vi.mock('../src/i18n/locale.functions', () => ({
  getInitialLocale: vi.fn<() => Promise<string>>(async () => 'en'),
  saveLocale: vi.fn<() => void>()
}));

import { routeTree } from '../src/routeTree.gen';

const catalogs = { en, es, 'pt-BR': pt } as const;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Typed lookup of one policy section: every leaf is a string, so no assertion is needed.
function sectionOf(locale: Locale, id: string): Record<string, string> {
  const section = Object.entries(catalogs[locale].privacy).find(([key]) => key === id)?.[1];
  if (section === undefined || typeof section === 'string')
    throw new Error(`missing section ${id}`);
  return section;
}

async function renderPolicy(locale: Locale) {
  const i18n = createI18n(locale);
  const rootRoute = createRootRoute({
    component: () => createElement(I18nextProvider, { i18n }, createElement(Outlet))
  });
  const privacyRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/privacy',
    component: PrivacyPolicy
  });
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/login',
    component: () => createElement('div')
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([privacyRoute, loginRoute]),
    history: createMemoryHistory({ initialEntries: ['/privacy'] })
  });
  await router.load();
  render(createElement(RouterProvider, { router }));
}

describe('/privacy route', () => {
  it('is public: it has no guard and loads without any auth lookup', async () => {
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ['/privacy'] })
    });
    await router.load();

    expect(router.state.location.pathname).toBe('/privacy');
    expect(router.routesById['/privacy'].options.beforeLoad).toBeUndefined();
    expect(playerFunctions.getOnboardingStatus).not.toHaveBeenCalled();
  });
});

describe('skip link target', () => {
  it('lands inside the real root layout: one focusable #main-content that contains <main>', async () => {
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ['/privacy'] })
    });
    await router.load();
    render(createElement(RouterProvider, { router }), { container: document });

    const targets = document.querySelectorAll('#main-content');
    expect(targets).toHaveLength(1);
    const target = targets[0];
    expect(target?.getAttribute('tabindex')).toBe('-1');
    expect(target?.querySelector('main')).not.toBeNull();
    // D1: the legal sections and login footer remain; no homepage chrome spills into the policy.
    expect(target?.querySelectorAll('main > section')).toHaveLength(PRIVACY_SECTIONS.length);
    expect(target?.querySelector('main > footer a')?.getAttribute('href')).toBe('/login');
    expect(target?.querySelector('[data-public-homepage], header img')).toBeNull();
    expect(
      screen.getByRole('combobox', { name: en.language }).closest('label')?.textContent
    ).toContain('en');
    expect(
      screen.queryByRole('link', { name: en.publicHomepage.actions.createAccount })
    ).toBeNull();

    const skip = await screen.findByRole('link', { name: en.accessibility.skipToContent });
    expect(skip.getAttribute('href')).toBe('#main-content');
    fireEvent.click(skip);
    expect(document.activeElement).toBe(target);
  });
});

describe('PrivacyPolicy page', () => {
  it.each(supportedLocales)('renders every section in %s', async (locale) => {
    await renderPolicy(locale);
    const copy = catalogs[locale].privacy;

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(copy.title);
    const titles = PRIVACY_SECTIONS.map(({ id }) => sectionOf(locale, id).title);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(titles);
    for (const { id, items } of PRIVACY_SECTIONS) {
      const section = screen.getByRole('region', { name: sectionOf(locale, id).title });
      expect(within(section).queryAllByRole('listitem')).toHaveLength(items);
    }
  });

  it.each(supportedLocales)(
    'shows no draft notice by default once the policy is approved (%s)',
    async (locale) => {
      await renderPolicy(locale);

      expect(PRIVACY_POLICY_APPROVED).toBe(true);
      expect(screen.queryByRole('note')).toBeNull();
    }
  );

  it('hides the draft notice once approved', async () => {
    const i18n = createI18n('en');
    render(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(RouterProvider, {
          router: createRouter({
            routeTree: createRootRoute({
              component: () => createElement(PrivacyPolicy, { approved: true })
            }),
            history: createMemoryHistory()
          })
        })
      )
    );

    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('shows the update date localized from the content constant', async () => {
    await renderPolicy('en');

    const date = new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' }).format(
      new Date(PRIVACY_UPDATED_AT)
    );
    expect(screen.getByText(en.privacy.updated.replace('{{date}}', date))).toBeTruthy();
  });

  it('exposes the privacy contact as a mailto link', async () => {
    await renderPolicy('en');

    const link = screen.getByRole('link', { name: PRIVACY_CONTACT_EMAIL });
    expect(link.getAttribute('href')).toBe(`mailto:${PRIVACY_CONTACT_EMAIL}`);
  });

  it('links back to sign-in', async () => {
    await renderPolicy('es');

    const link = screen.getByRole('link', { name: es.auth.backToSignIn });
    expect(link.getAttribute('href')).toBe('/login');
  });
});

describe('privacy copy contract', () => {
  it.each(supportedLocales)('defines every section key and the link label in %s', (locale) => {
    const catalog = catalogs[locale];

    expect(typeof catalog.auth.privacyLink).toBe('string');
    expect(catalog.privacy.title.length).toBeGreaterThan(0);
    expect(catalog.privacy.updated).toContain('{{date}}');
    for (const { id, paragraphs, items } of PRIVACY_SECTIONS) {
      const section = sectionOf(locale, id);
      const expected = [
        'title',
        ...Array.from({ length: paragraphs }, (_, n) => `p${n + 1}`),
        ...Array.from({ length: items }, (_, n) => `i${n + 1}`)
      ];
      expect(Object.keys(section).sort()).toEqual(expected.sort());
      for (const key of expected) expect(section[key]?.trim()).toBeTruthy();
    }
  });

  it.each(supportedLocales)('states rights, complaint route and legal bases in %s', (locale) => {
    const { privacy } = catalogs[locale];

    expect(privacy.rights.p3).toContain('www.aepd.es');
    expect(privacy.legalBases.i1).toMatch(/6[.(]1[.)]\(?b\)/);
    expect(privacy.legalBases.i4).toMatch(/6[.(]1[.)]\(?a\)/);
    expect(privacy.transfers.i1).toContain('Supabase');
    expect(privacy.google.p2.length).toBeGreaterThan(0);
  });

  it.each(supportedLocales)(
    'does not disclaim legal deadlines or cite technical limits (%s)',
    (locale) => {
      const copy = JSON.stringify(catalogs[locale].privacy).toLowerCase();

      expect(copy).not.toMatch(
        /linked to other records|vinculados a otros registros|ligados a outros registros/
      );
      expect(copy).not.toMatch(/cannot promise|no podemos prometer|não podemos prometer/);
    }
  );

  it.each(supportedLocales)('states the confirmed hosting and log facts in %s', (locale) => {
    const { privacy } = catalogs[locale];

    expect(privacy.transfers.p1).toMatch(/London|Londres/);
    expect(privacy.retention.p2).toContain('3');
    expect(privacy.retention.p2).toContain('Cloudflare');
    expect(JSON.stringify(privacy)).not.toMatch(
      /we do not control|que no controlamos|que não controlamos/
    );
  });

  it.each(supportedLocales)(
    'describes scoped visibility without blanket claims in %s',
    (locale) => {
      const { sharing } = catalogs[locale].privacy;
      const text = JSON.stringify(sharing).toLowerCase();

      expect(Object.keys(sharing).filter((key) => key.startsWith('i'))).toHaveLength(6);
      expect(text).not.toMatch(/avatar|e-?mail address|correo electr[oó]nico no|anonym|an[oó]nim/);
      expect(sharing.i1.length).toBeGreaterThan(0);
    }
  );

  it.each(supportedLocales)('states invitee data source and photo guidance in %s', (locale) => {
    const { invitees, photos, requests } = catalogs[locale].privacy;

    expect(invitees.p1.length).toBeGreaterThan(0);
    expect(invitees.p2.length).toBeGreaterThan(0);
    expect(photos.p1.length).toBeGreaterThan(0);
    expect(requests.p1.length).toBeGreaterThan(0);
  });

  it('stays consistent across locales: same keys, no untranslated copy', () => {
    const keys = (value: object) => Object.keys(value).sort();
    expect(keys(es.privacy)).toEqual(keys(en.privacy));
    expect(keys(pt.privacy)).toEqual(keys(en.privacy));
    expect(es.privacy.title).not.toBe(en.privacy.title);
    expect(pt.privacy.contact.p1).not.toBe(en.privacy.contact.p1);
  });
});
