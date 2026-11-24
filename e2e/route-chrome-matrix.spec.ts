import { test, type Page } from '@playwright/test';
import { waitForHydratedPage } from './auth-helpers';
import {
  assertChipsStepAside,
  assertNoUaFieldsetBorders,
  assertTopChrome,
  type TopChromePattern
} from './route-chrome';
import { sql } from './matches-management-fixtures';
import { statisticsWorld, type StatisticsWorld } from './statistics-fixtures';

// F66/F27 class guard. Every route that resolveAppShell hides the bottom navigation on owns its top
// chrome (TopBar), so it must also mark its <main> data-route-chrome="navigation" and let the global
// language/theme chips step aside. This matrix visits those routes against the seeded statistics
// world and runs assertChipsStepAside on each, so a newly nested route that forgets the mark (or a
// refactor that drops one) fails here instead of shipping chips floating over a title.
//
// Routes that need data the shared world does not seed are NOT forced; each is listed with its reason
// in UNCOVERED below and stays covered only by its owning spec or by none.

let w: StatisticsWorld;
const pages = new Map<string, Page>();

test.describe.configure({ mode: 'serial' });
test.use({ serviceWorkers: 'block' });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(420_000);
  w = await statisticsWorld(browser);
});
test.afterAll(async () => {
  test.setTimeout(240_000);
  if (w) await sql(`delete from public.platform_admins where user_id = '${w.f.creator.id}'`);
  await w?.cleanup();
});
test.beforeEach(() => test.setTimeout(180_000));

type Who = 'admin' | 'player';

async function pageFor(who: Who): Promise<Page> {
  const cached = pages.get(who);
  if (cached) return cached;
  const page = await w.f.page(who === 'admin' ? w.f.creator : w.actors.A, 'en', 1280, 'light', 900);
  pages.set(who, page);
  return page;
}

async function visit(page: Page, path: string) {
  await page.goto(path);
  await waitForHydratedPage(page);
}

// chrome: the header pattern the route's frame draws; defaults to the shared TopBar.
type RouteCase = {
  label: string;
  who: Who;
  path: () => string;
  chrome?: TopChromePattern;
  /** Seeds a precondition the shared world lacks (idempotent). */
  setup?: () => Promise<void>;
};

const adminBase = () => `/community/${w.f.community}/admin`;

const ROUTES: RouteCase[] = [
  // matches/* except the my/past lists
  { label: 'create wizard', who: 'player', path: () => '/matches/create' },
  { label: 'match detail', who: 'player', path: () => `/matches/${w.groupIds['g3']!.eventId}` },
  {
    label: 'confirmed group detail',
    who: 'player',
    path: () => `/matches/${w.groupIds['g3']!.eventId}/groups/${w.groupIds['g3']!.proposalId}`
  },
  // community admin, statistics and leagues
  // /admin itself only redirects to /admin/requests (visited below), so it is not a distinct destination.
  { label: 'admin members', who: 'admin', path: () => `${adminBase()}/members` },
  { label: 'admin requests', who: 'admin', path: () => `${adminBase()}/requests` },
  { label: 'admin settings', who: 'admin', path: () => `${adminBase()}/settings` },
  { label: 'admin venues', who: 'admin', path: () => `${adminBase()}/venues` },
  { label: 'admin audit', who: 'admin', path: () => `${adminBase()}/audit` },
  {
    label: 'community statistics',
    who: 'player',
    path: () => `/community/${w.f.community}/statistics`
  },
  {
    label: 'league index',
    who: 'player',
    chrome: 'navbar',
    path: () => `/community/${w.f.community}/leagues`
  },
  {
    label: 'league detail',
    who: 'player',
    path: () => `/community/${w.f.community}/leagues/${w.leagues.active.id}`
  },
  {
    label: 'league create',
    who: 'player',
    path: () => `/community/${w.f.community}/leagues/create`
  },
  // result-repair diagnostics: own frame header (cuVwp/bomAY), not a TopBar. The community route is
  // open to its admin; the platform route needs a platform_admins row for the world's host.
  {
    label: 'community repair diagnostics',
    who: 'admin',
    chrome: 'diagnostics',
    path: () => `/community/${w.f.community}/repairs`
  },
  {
    label: 'platform repair diagnostics',
    who: 'admin',
    chrome: 'diagnostics',
    setup: async () => {
      await sql(
        `insert into public.platform_admins(user_id) values ('${w.f.creator.id}') on conflict do nothing`
      );
    },
    path: () => '/platform-admin/result-repairs'
  },
  // notifications
  { label: 'notifications index', who: 'player', path: () => '/notifications' },
  { label: 'notification preferences', who: 'player', path: () => '/notifications/preferences' },
  // level reviews and statistics
  { label: 'level reviews history', who: 'player', path: () => '/level-reviews' },
  { label: 'level review request', who: 'player', path: () => '/level-reviews/new' },
  { label: 'player statistics', who: 'player', path: () => `/players/${w.idOf('A')}` },
  {
    label: 'relationship pair',
    who: 'player',
    path: () => `/players/${w.idOf('A')}/partners/${w.idOf('B')}`
  },
  {
    label: 'relationship opponent',
    who: 'player',
    path: () => `/players/${w.idOf('A')}/opponents/${w.idOf('C')}`
  }
];

for (const route of ROUTES) {
  test(`${route.label} owns its top chrome`, async () => {
    const page = await pageFor(route.who);
    await route.setup?.();
    await visit(page, route.path());
    await assertChipsStepAside(page, route.label);
    await assertNoUaFieldsetBorders(page, route.label);
    await assertTopChrome(page, route.label, route.chrome ?? 'topbar');
  });
}

// Hidden-bottom-nav routes this matrix cannot reach with the shared world (documented, not faked):
//  - /notifications/:id: the world delivers no notification to any actor, so there is no row to open;
//    notifications.spec.ts (invitation detail) owns it with the same assertChipsStepAside call.
//  - /matches/:id/record: needs an open, record-eligible event for the organizer; the world seeds only
//    finalized, pending-review and cancelled events (covered by matches-results*.spec.ts markers).
//  - /me/* (profile edit) is not a resolveAppShell hide case; it carries its own data-app-chrome mark.
//  - /level-reviews/:requestId: needs a submitted request; none is seeded (level-reviews specs own it).
//  - /platform-admin/level-reviews[/:id]: needs a platform admin account; the world has none
//    (level-reviews-admin.spec.ts owns the queue and detail).
//  - /community/:id/admin/members/:membershipId: member sheet detail; covered by
//    community-admin-members-sheet.spec.ts.
