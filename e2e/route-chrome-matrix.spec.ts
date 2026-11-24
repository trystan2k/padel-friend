import { test, type Page } from '@playwright/test';
import { waitForHydratedPage } from './auth-helpers';
import { assertChipsStepAside, assertNoUaFieldsetBorders } from './route-chrome';
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

type RouteCase = { label: string; who: Who; path: () => string };

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
  { label: 'admin overview', who: 'admin', path: () => adminBase() },
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
  { label: 'league index', who: 'player', path: () => `/community/${w.f.community}/leagues` },
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
    await visit(page, route.path());
    await assertChipsStepAside(page, route.label);
    await assertNoUaFieldsetBorders(page, route.label);
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
