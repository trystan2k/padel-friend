import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { fixtures, en, sql } from './matches-management-fixtures';
import { leagueFixtures } from './leagues-fixtures';
import { cleanupLevelReviews, submitRequest } from './level-reviews-fixtures';
import { enterScore, openRecord, resultFixtures, review } from './matches-results-fixtures';
import { waitForHydratedPage } from './auth-helpers';
import { builtWorker, installBuiltWorker } from './service-worker-helpers';

// Synthetic events enter the REAL built worker. Only the OS notification display boundary is
// replaced; window focus/navigation and recipient-private server resolution remain real.
//
// Worker churn (PAF-175): each case owns one context with exactly one real worker install (fixture
// contexts block workers). Readiness is the activated + controlled signal from
// service-worker-helpers.ts and the Worker handle is the verified built `/sw.js` (event subscribed
// before navigation), never an unchecked `serviceWorkers()[0]`. Patched worker state is restored in
// `finally` so no override outlives the tap that needed it.
test.setTimeout(120_000);
async function worker(context: BrowserContext, page: Page) {
  return installBuiltWorker(context, page, '/notifications');
}
async function tap(context: BrowserContext, data: unknown) {
  const installed = builtWorker(context);
  if (!installed) throw new Error('Built service worker missing');
  await installed.evaluate(async (value) => {
    // Synthetic clicks lack Chromium user activation: replace focus only, not navigation/auth.
    const clients: unknown = Reflect.get(self, 'clients');
    if (typeof clients !== 'object' || clients === null) throw new Error('Missing clients');
    const matchAll: unknown = Reflect.get(clients, 'matchAll');
    if (typeof matchAll !== 'function') throw new Error('Missing matchAll');
    const windows: unknown = await Reflect.apply(matchAll, clients, [
      { type: 'window', includeUncontrolled: true }
    ]);
    if (!Array.isArray(windows)) throw new Error('Missing app windows');
    const patched = windows.map((client) => {
      const prototype = Object.getPrototypeOf(client);
      const original = Object.getOwnPropertyDescriptor(prototype, 'focus');
      Object.defineProperty(prototype, 'focus', {
        configurable: true,
        value: async function () {
          return this;
        }
      });
      return { prototype, original };
    });
    try {
      const pending: Promise<unknown>[] = [];
      const event = new Event('notificationclick');
      Object.defineProperties(event, {
        notification: { value: { data: value, close() {} } },
        waitUntil: { value: (task: Promise<unknown>) => pending.push(task) }
      });
      self.dispatchEvent(event);
      await Promise.all(pending);
    } finally {
      for (const { prototype, original } of patched)
        if (original) Object.defineProperty(prototype, 'focus', original);
    }
  }, data);
}

test('built worker displays stable tags, ignores malformed Push and ignores payload href on tap', async ({
  browser
}) => {
  const f = await fixtures(browser, { memberCount: 1 });
  let context: BrowserContext | undefined;
  try {
    const source = await f.page(f.members[0]!);
    const eventId = await f.event(1);
    const notices = await f.notifications(f.members[0]!, 'match_event_published', eventId);
    expect(notices).toHaveLength(1);
    const id = notices[0]!.id;
    context = await browser.newContext({
      storageState: await source.context().storageState(),
      serviceWorkers: 'allow'
    });
    const page = await context.newPage();
    const installed = await worker(context, page);
    const shown = await installed.evaluate(async (notificationId) => {
      const registration: unknown = Reflect.get(self, 'registration');
      if (!(registration instanceof ServiceWorkerRegistration))
        throw new Error('Missing worker registration');
      const original = registration.showNotification.bind(registration);
      const displayed: { title: string; options?: NotificationOptions }[] = [];
      registration.showNotification = async (title, options) => {
        displayed.push({ title, options });
      };
      try {
        for (const payload of [
          null,
          { version: 1, notificationId: '../../evil' },
          {
            version: 1,
            notificationId,
            category: 'matches',
            title: 'Match update',
            body: 'Open Padel Friends to view.'
          }
        ]) {
          const pending: Promise<unknown>[] = [];
          const event = new Event('push');
          Object.defineProperties(event, {
            data: { value: { json: () => payload } },
            waitUntil: { value: (task: Promise<unknown>) => pending.push(task) }
          });
          self.dispatchEvent(event);
          await Promise.all(pending);
        }
        return displayed;
      } finally {
        registration.showNotification = original;
      }
    }, id);
    expect(shown).toEqual([
      {
        title: 'Match update',
        options: {
          body: 'Open Padel Friends to view.',
          tag: 'notification:' + id,
          renotify: false,
          data: { notificationId: id, category: 'matches' }
        }
      }
    ]);
    const before = page.url();
    await tap(context, { notificationId: '../../evil', href: 'https://example.org' });
    expect(page.url()).toBe(before);
    await tap(context, { notificationId: id, href: 'https://example.org' });
    await expect(page).toHaveURL('/notifications/' + id);
    await waitForHydratedPage(page);
    await page.getByRole('link', { name: en.notifications.match.openEvent }).click();
    await expect(page).toHaveURL('/matches/' + eventId);
  } finally {
    await context?.close();
    await f.cleanup();
  }
});

test('signed-out tap preserves safe detail through login; foreign account receives no private target', async ({
  browser
}) => {
  const f = await fixtures(browser, { memberCount: 1 });
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  try {
    const eventId = await f.event(1);
    const [notice] = await f.notifications(f.members[0]!, 'match_event_published', eventId);
    expect(notice).toBeDefined();
    const page = await context.newPage();
    await installBuiltWorker(context, page, '/login');
    await tap(context, { notificationId: notice!.id });
    await expect(page).toHaveURL(/\/login\?next=/);
    await waitForHydratedPage(page);
    await page.getByLabel(en.auth.loginEmailLabel).fill(f.members[0]!.email);
    await page.getByLabel(en.auth.loginPasswordLabel).fill('Password123!');
    await page.getByRole('button', { name: en.auth.loginSubmit }).click();
    await expect(page).toHaveURL('/notifications/' + notice!.id);
    await waitForHydratedPage(page);
    await expect(
      page.getByRole('link', { name: en.notifications.match.openEvent })
    ).toHaveAttribute('href', '/matches/' + eventId);
    const foreign = await f.page(f.guest);
    await foreign.goto('/notifications/' + notice!.id);
    await waitForHydratedPage(foreign);
    await expect(foreign.getByRole('alert')).toContainText(en.notifications.error);
    await expect(foreign.getByRole('link', { name: en.notifications.match.openEvent })).toHaveCount(
      0
    );
    const [stored] = await sql(
      `select read_at from public.notifications where id='` + notice!.id + `'`
    );
    expect(stored).toBeDefined();
  } finally {
    await context.close();
    await f.cleanup();
  }
});

test('community, rating, review and League taps resolve only currently authorized destinations', async ({
  browser
}) => {
  const f = await leagueFixtures(browser, { memberCount: 1 });
  let context: BrowserContext | undefined;
  try {
    const member = f.members[0]!;
    const requestId = await submitRequest(member);
    const leagueId = await f.createLeague(f.creator);
    const [membership] = await sql(
      `select id from public.community_members where community_id='${f.community}' and user_id='${member.id}' and valid_until is null`
    );
    if (!membership) throw new Error('Missing membership fixture');
    // These fixtures isolate target resolution, not producer coverage (the matrix integration owns
    // producer commands). Notification persistence/RLS and all destination reads remain real.
    const targets = [
      {
        kind: 'community_role_changed',
        category: 'community',
        type: 'community_membership',
        target: String(membership.id),
        href: '/community/' + f.community
      },
      {
        kind: 'rating_changed',
        category: 'rankings',
        type: 'player_rating',
        target: member.id,
        href: '/players/' + member.id
      },
      {
        kind: 'level_review_submitted',
        category: 'rankings',
        type: 'level_review_request',
        target: requestId,
        href: '/level-reviews/' + requestId
      },
      {
        kind: 'league_started',
        category: 'leagues',
        type: 'league',
        target: leagueId,
        href: '/community/' + f.community + '/leagues/' + leagueId
      }
    ];
    const signedIn = await f.page(member);
    context = await browser.newContext({
      storageState: await signedIn.context().storageState(),
      serviceWorkers: 'allow'
    });
    const page = await context.newPage();
    await worker(context, page);
    for (const target of targets) {
      await test.step(target.kind, async () => {
        const [notice] = await sql(
          `select public.persist_notification('${member.id}','browser-target:${crypto.randomUUID()}','${target.kind}','${target.category}','${target.type}','${target.target}',${target.category === 'rankings' ? 'null' : "'" + f.community + "'"}) as id`
        );
        if (!notice) throw new Error('Missing target notice');
        await tap(context!, { notificationId: notice.id });
        await expect(page).toHaveURL('/notifications/' + String(notice.id));
        await waitForHydratedPage(page);
        const link = page.getByRole('link', { name: en.notifications.openTarget });
        await expect(link).toHaveAttribute('href', target.href);
        await link.click();
        await expect(page).toHaveURL(target.href);
        await waitForHydratedPage(page);
      });
    }
    const [id] = await sql(
      `select id from public.notifications where recipient_user_id='${member.id}' and kind='community_role_changed' order by created_at desc limit 1`
    );
    await f.rpc(f.creator, 'govern_community_member', {
      p_community_id: f.community,
      p_membership_id: membership.id,
      p_action: 'remove'
    });
    await tap(context, { notificationId: id!.id });
    await expect(page).toHaveURL('/notifications/' + String(id!.id));
    await waitForHydratedPage(page);
    await expect(page.getByRole('link', { name: en.notifications.openTarget })).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText(f.community);
  } finally {
    await context?.close();
    await cleanupLevelReviews([f.members[0]!.id]);
    await f.cleanup();
  }
});

test('result tap preserves proposal version and group anchor', async ({ browser }) => {
  const f = await resultFixtures(browser, { memberCount: 3 });
  let context: BrowserContext | undefined;
  try {
    const eventId = await f.completedEvent('competitive', 4);
    const source = await f.page(f.creator);
    await openRecord(source, eventId);
    await enterScore(source);
    await review(source);
    await source.getByRole('button', { name: en.matches.results.submit, exact: true }).click();
    await expect(source.getByText(en.matches.results.pending, { exact: true })).toBeVisible();
    const notices = await f.notifications(f.creator, 'result_added', eventId);
    expect(notices).toHaveLength(1);
    context = await browser.newContext({
      storageState: await source.context().storageState(),
      serviceWorkers: 'allow'
    });
    const page = await context.newPage();
    await worker(context, page);
    await tap(context, { notificationId: notices[0]!.id });
    await expect(page).toHaveURL('/notifications/' + notices[0]!.id);
    await waitForHydratedPage(page);
    const link = page.getByRole('link', { name: en.notifications.result.openResult, exact: true });
    await expect(link).toHaveAttribute(
      'href',
      new RegExp(
        '/matches/' +
          eventId +
          '\\?result_group=1&result_proposal=.+&result_version=1#result-group-1$'
      )
    );
    await link.click();
    await expect(page).toHaveURL(/result_version=1#result-group-1$/);
  } finally {
    await context?.close();
    await f.cleanup();
  }
});
