import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';
import { testSupabaseConfig } from './test-supabase-config';
import { trustedClient } from '../test/helpers/trusted-client';
import { waitForHydratedPage } from './auth-helpers';

const en: {
  auth: { loginEmailLabel: string; loginPasswordLabel: string; loginSubmit: string };
  communityAdmin: { loadMore: string };
} = JSON.parse(
  readFileSync(new URL('../src/locales/en/translation.json', import.meta.url), 'utf8')
);
const config = testSupabaseConfig();
const password = 'Password123!';
type Actor = { email: string; id: string; client: SupabaseClient };

async function createActor(label: string): Promise<Actor> {
  const anonymous = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const email = `sheet-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${crypto.randomUUID()}@example.test`;
  const signup = await anonymous.auth.signUp({ email, password });
  if (signup.error || !signup.data.session || !signup.data.user)
    throw signup.error ?? new Error('Local Supabase actor session missing');
  const client = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${signup.data.session.access_token}` } }
  });
  const onboard = await client.rpc('onboard_player', {
    p_display_name: label,
    p_preferred_side: 'EITHER',
    p_initial_level: 3.2
  });
  if (onboard.error) throw onboard.error;
  return { email, id: signup.data.user.id, client };
}

async function signIn(page: Page, actor: Actor) {
  await page.goto('/login');
  await waitForHydratedPage(page);
  await page.getByLabel(en.auth.loginEmailLabel).fill(actor.email);
  await page.getByLabel(en.auth.loginPasswordLabel).fill(password);
  await page.getByRole('button', { name: en.auth.loginSubmit }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await waitForHydratedPage(page);
}

// U6 residual (F33): the route-driven member sheet opens over the mounted roster. Loaded pages,
// the scroll position and the focused row must survive open and close, with no background re-read
// of the roster (shouldReload: false on the layout route).
test('member sheet keeps the loaded roster, scroll position and focus, with no roster re-read', async ({
  page
}) => {
  test.setTimeout(240_000);
  const owner = await createActor('Sheet Owner');
  const created = await owner.client.rpc('create_community', {
    p_name: `Sheet ${crypto.randomUUID().slice(0, 6)}`,
    p_visibility: 'public',
    p_join_policy: 'instant'
  });
  if (created.error || typeof created.data !== 'string')
    throw created.error ?? new Error('Community creation failed');
  const communityId = created.data;
  // 51 more active members: the first page holds 50, so a second page exists.
  const extra = 51;
  const members: Actor[] = [];
  for (let start = 0; start < extra; start += 9) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(9, extra - start) }, (_, index) =>
        createActor(`Sheet Member ${String(start + index).padStart(2, '0')}`)
      )
    );
    members.push(...batch);
  }
  const inserted = await trustedClient()
    .from('community_members')
    .insert(
      members.map((member) => ({
        community_id: communityId,
        user_id: member.id,
        role: 'member' as const,
        status: 'active' as const
      }))
    );
  if (inserted.error) throw inserted.error;

  await signIn(page, owner);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/community/${communityId}/admin/members`);
  await waitForHydratedPage(page);

  const rows = page.getByTestId('community-member-card');
  await expect(rows).toHaveCount(50);
  await page.getByRole('button', { name: en.communityAdmin.loadMore }).click();
  await expect(rows).toHaveCount(extra + 1);

  // Bring a row from the second page to the middle of the scrollport and remember the offset.
  const target = rows.nth(extra - 5);
  const link = target.locator('[data-member-link]');
  const membershipId = await link.getAttribute('data-member-link');
  expect(membershipId).not.toBeNull();
  await target.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  const scrollOf = () => page.locator('main').evaluate((main) => main.scrollTop);
  const before = await scrollOf();
  expect(before).toBeGreaterThan(500);

  const serverCalls: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/_serverFn'))
      serverCalls.push(request.method() + ' ' + request.url());
  });

  await link.click();
  const sheet = page.getByTestId('community-member-sheet');
  await expect(sheet).toBeVisible();
  // F53: the fixed admin bottom navigation never paints over the sheet or its backdrop.
  const navCovers = await page.evaluate(() => {
    const nav = document.querySelector('nav');
    if (!nav) return null;
    const box = nav.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return hit ? nav.contains(hit) : null;
  });
  expect(navCovers).toBe(false);
  // Give any background re-read time to land before asserting on the roster.
  await page.waitForTimeout(1_500);
  await expect(rows).toHaveCount(extra + 1);
  const openCalls = [...serverCalls];
  console.info(`server calls while opening the member sheet: ${JSON.stringify(openCalls)}`);
  // Opening reads the sheet's own member exactly once (one call carrying the clicked membership id)
  // plus the route chain's parameterless/community reads. Router intent-preload may also read
  // ANOTHER member the pointer rests on while the roster scrolls (a different membership id, seen on
  // Linux CI): a legitimate prefetch, not a re-read of the sheet's member. The roster search (query,
  // status, offset, limit arguments) is never repeated in the background: no call may carry it.
  expect(openCalls.filter((call) => call.includes(membershipId!))).toHaveLength(1);
  expect(openCalls.filter((call) => /%22(query|offset|limit)%22/.test(call))).toEqual([]);

  // The visible close path is Escape/backdrop (the Close control is visually hidden).
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(rows).toHaveCount(extra + 1);
  expect(Math.abs((await scrollOf()) - before)).toBeLessThanOrEqual(2);
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-member-link')))
    .toBe(membershipId);
  // Closing re-validates the route chain only; the roster search must not be repeated either.
  const closeCalls = serverCalls.slice(openCalls.length);
  console.info(`server calls while closing the member sheet: ${JSON.stringify(closeCalls)}`);
  expect(closeCalls.filter((call) => /%22(query|offset|limit)%22/.test(call))).toEqual([]);
});

// F47: the close path depends on in-memory roster origin, never on history.state (which survives
// a reload). Roster-open closes back to the roster row; a reloaded sheet closes through the
// explicit Members route and lands on the Members heading.
test('member sheet close uses the roster path, and the Members fallback after a reload', async ({
  page
}) => {
  test.setTimeout(120_000);
  const owner = await createActor('Origin Owner');
  const created = await owner.client.rpc('create_community', {
    p_name: `Origin ${crypto.randomUUID().slice(0, 6)}`,
    p_visibility: 'public',
    p_join_policy: 'instant'
  });
  if (created.error || typeof created.data !== 'string')
    throw created.error ?? new Error('Community creation failed');
  const communityId = created.data;
  const member = await createActor('Origin Member');
  const inserted = await trustedClient()
    .from('community_members')
    .insert({ community_id: communityId, user_id: member.id, role: 'member', status: 'active' });
  if (inserted.error) throw inserted.error;

  await signIn(page, owner);
  await page.setViewportSize({ width: 390, height: 844 });
  const membersUrl = new RegExp(`/community/${communityId}/admin/members$`);
  await page.goto(`/community/${communityId}/admin/members`);
  await waitForHydratedPage(page);

  const link = page.locator('[data-member-link]').first();
  const membershipId = await link.getAttribute('data-member-link');
  const sheet = page.getByTestId('community-member-sheet');
  const activeMemberLink = () =>
    page.evaluate(() => document.activeElement?.getAttribute('data-member-link'));
  const activeId = () => page.evaluate(() => document.activeElement?.id);

  // Roster origin: close returns to the roster with the row focused.
  await link.click();
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(page).toHaveURL(membersUrl);
  await expect.poll(activeMemberLink).toBe(membershipId);

  // Reload with the sheet open: the history entry still carries its state, the document does not.
  await link.click();
  await expect(sheet).toBeVisible();
  await page.reload();
  await waitForHydratedPage(page);
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(page).toHaveURL(membersUrl);
  await expect.poll(activeId).toBe('admin-screen-title');
  expect(await activeMemberLink()).toBeNull();
});
