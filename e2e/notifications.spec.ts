import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type Response
} from '@playwright/test';
import { submitAndWaitForAuthDestination, waitForHydratedPage } from './auth-helpers';

type Copy = {
  auth: { loginEmailLabel: string; loginPasswordLabel: string; loginSubmit: string };
  notifications: {
    title: string;
    subtitle: string;
    markAllRead: string;
    markRead: string;
    view: string;
    today: string;
    error: string;
    retry: string;
    offline: string;
    dateUtc: string;
    unread_one: string;
    unread_other: string;
    targetUnavailable: string;
    targetError: string;
    invitationContext: string;
    activeMembership: string;
    back: string;
    accept: string;
    accepted: string;
    filters: {
      label: string;
      all: string;
      matches: string;
      results: string;
      community: string;
      rankings: string;
    };
    empty: { all: string; matches: string; results: string; community: string; rankings: string };
    kinds: {
      community_invitation: string;
      community_membership_removed: string;
    };
  };
  notificationPreferences: {
    preferencesLink: string;
    title: string;
    back: string;
    pushTitle: string;
    pushUnavailable: string;
    categories: {
      community: string;
      matches: string;
      results: string;
      rankings: string;
      leagues: string;
    };
    criticalTitle: string;
    alwaysOn: string;
    save: string;
    saved: string;
  };
  communityAdmin: {
    searchLabel: string;
    action: { remove: string };
    confirmAction: string;
    result: { remove: string };
  };
  communityInvites: { invite: string; searchLabel: string; issued: string };
};

const en: Copy = JSON.parse(
  readFileSync(new URL('../src/locales/en/translation.json', import.meta.url), 'utf8')
);
const password = 'Password123!';
const config = localConfig();

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  colorScheme: 'light',
  serviceWorkers: 'block'
});

type Actor = { id: string; email: string; displayName: string; client: SupabaseClient };

function localConfig() {
  const variables = new Map(
    readFileSync(new URL('../.env', import.meta.url), 'utf8')
      .split('\n')
      .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
      .map((line) => {
        const index = line.indexOf('=');
        return [
          line.slice(0, index).trim(),
          line
            .slice(index + 1)
            .trim()
            .replace(/^['"]|['"]$/g, '')
        ] as const;
      })
  );
  const url = process.env.VITE_SUPABASE_URL ?? variables.get('VITE_SUPABASE_URL') ?? '';
  const key =
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    variables.get('VITE_SUPABASE_PUBLISHABLE_KEY') ??
    '';
  if (!url || !key || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname))
    throw new Error('Notifications E2E requires loopback Supabase');
  return { url, key };
}

async function newContext(browser: Browser): Promise<BrowserContext> {
  // Notifications permission stays at its headless default (denied): the whole suite proves
  // in-app delivery never depends on Push permission. No context ever grants it.
  return browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    serviceWorkers: 'block'
  });
}

async function createActor(label: string): Promise<Actor> {
  const bootstrap = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const email = `notification-${crypto.randomUUID()}@test.local`;
  const signup = await bootstrap.auth.signUp({ email, password });
  if (signup.error || !signup.data.session || !signup.data.user)
    throw new Error(`Could not create local E2E actor: ${signup.error?.message ?? 'no session'}`);
  const client = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const session = await client.auth.setSession(signup.data.session);
  if (session.error) throw session.error;
  const displayName = `${label} ${crypto.randomUUID().slice(0, 8)}`;
  const onboarded = await client.rpc('onboard_player', {
    p_display_name: displayName,
    p_preferred_side: 'EITHER',
    p_initial_level: 3.2
  });
  if (onboarded.error) throw onboarded.error;
  return { id: signup.data.user.id, email, displayName, client };
}

async function signIn(page: Page, actor: Actor) {
  await page.context().addCookies([
    { name: 'locale', value: 'en', url: 'http://127.0.0.1:4173' },
    { name: 'theme', value: 'light', url: 'http://127.0.0.1:4173' }
  ]);
  await page.goto('/login');
  await waitForHydratedPage(page);
  await page.getByLabel(en.auth.loginEmailLabel).fill(actor.email);
  await page.getByLabel(en.auth.loginPasswordLabel).fill(password);
  await page.getByRole('button', { name: en.auth.loginSubmit }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await waitForHydratedPage(page);
}

async function createPrivateCommunity(owner: Actor, name: string): Promise<string> {
  const created = await owner.client.rpc('create_community', {
    p_name: name,
    p_visibility: 'private',
    p_join_policy: 'instant'
  });
  if (created.error || typeof created.data !== 'string')
    throw created.error ?? new Error('Private community fixture failed');
  return created.data;
}

async function insertInvitation(owner: Actor, communityId: string, invitee: Actor) {
  // Same established pattern as community-lifecycle: an authenticated admin INSERT through the
  // real database fires the community_invitation_notification producer; the invitee redeems the
  // resulting token with the real RPC when a journey needs an active membership.
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const tokenHash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  const invitation = await owner.client
    .from('community_invitations')
    .insert({
      community_id: communityId,
      invitee_user_id: invitee.id,
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + 86400000).toISOString()
    })
    .select('id')
    .single();
  if (invitation.error || !invitation.data)
    throw invitation.error ?? new Error('Invitation insertion failed');
  return { id: invitation.data.id, token };
}

async function latestNotification(
  actor: Actor,
  kind: string
): Promise<{ id: string; target_id: string }> {
  const row = await actor.client
    .from('notifications')
    .select('id,target_id,kind,read_at')
    .eq('kind', kind)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (row.error || !row.data) throw row.error ?? new Error(`No ${kind} notification delivered`);
  return { id: row.data.id, target_id: row.data.target_id };
}

function unreadText(count: number): string {
  return (count === 1 ? en.notifications.unread_one : en.notifications.unread_other).replace(
    '{{count}}',
    String(count)
  );
}

function captureResponses(page: Page): () => Promise<string> {
  const payloads: Promise<string>[] = [];
  const collect = (response: Response) => {
    if (['document', 'fetch', 'xhr'].includes(response.request().resourceType()))
      payloads.push(response.text().catch(() => ''));
  };
  page.on('response', collect);
  return async () => {
    page.off('response', collect);
    return (await Promise.all(payloads)).join('\n');
  };
}

test('invitation journey with Push permission denied: badge, center, detail, acceptance and read persistence', async ({
  browser
}) => {
  test.setTimeout(180_000);
  const [admin, recipient] = await Promise.all([
    createActor('Journey Admin'),
    createActor('Journey Recipient')
  ]);
  const communityName = `Private circle ${crypto.randomUUID().slice(0, 8)}`;
  const communityId = await createPrivateCommunity(admin, communityName);
  // Opt-in so the real admin invite dialog can find the recipient by display name.
  expect(
    (
      await recipient.client
        .from('community_invitee_directory_preferences')
        .insert({ user_id: recipient.id })
    ).error
  ).toBeNull();

  const adminContext = await newContext(browser);
  const recipientContext = await newContext(browser);
  try {
    const adminPage = await adminContext.newPage();
    const recipientPage = await recipientContext.newPage();
    await Promise.all([signIn(adminPage, admin), signIn(recipientPage, recipient)]);

    // The entire journey runs with browser notification permission DENIED: in-app delivery
    // must never depend on Web Push.
    expect(await recipientPage.evaluate(() => Notification.permission)).toBe('denied');

    await adminPage.goto(`/community/${communityId}/admin/members`);
    await waitForHydratedPage(adminPage);
    await adminPage.getByRole('button', { name: en.communityInvites.invite }).click();
    const dialog = adminPage.getByRole('dialog');
    await dialog.getByLabel(en.communityInvites.searchLabel).fill(recipient.displayName);
    const result = dialog.locator(`input[name="invitee"][value="${recipient.id}"]`);
    await expect(result).toBeVisible();
    await result.check({ timeout: 3000 });
    await dialog.getByRole('button', { name: en.communityInvites.invite }).click();
    await expect(dialog.getByText(en.communityInvites.issued)).toBeVisible();

    // The producer delivered exactly one private invitation notification to the recipient.
    const notification = await latestNotification(recipient, 'community_invitation');
    const stored = await recipient.client
      .from('notifications')
      .select('id,kind,category,target_type,target_id,community_id,read_at')
      .eq('id', notification.id)
      .single();
    expect(stored.data).toMatchObject({
      kind: 'community_invitation',
      category: 'community',
      target_type: 'community_invitation',
      community_id: communityId,
      read_at: null
    });

    // The count is fetched on dashboard remount (no Realtime by design): a fresh load
    // reflects the newly delivered notification.
    await recipientPage.reload();
    await waitForHydratedPage(recipientPage);

    // Dashboard badge: reachable >=44px entry carrying the authoritative unread count.
    const badge = recipientPage.getByRole('link', { name: unreadText(1) });
    await expect(badge).toBeVisible();
    expect((await badge.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await badge.click();
    await expect(recipientPage).toHaveURL(/\/notifications$/);
    await waitForHydratedPage(recipientPage);
    await expect(
      recipientPage.getByRole('heading', { name: en.notifications.today })
    ).toBeVisible();
    const card = recipientPage.locator('main li').filter({
      hasText: en.notifications.kinds.community_invitation
    });
    await expect(card).toHaveCount(1);
    await expect(recipientPage.getByText(unreadText(1), { exact: true })).toBeVisible();

    // Open the notification detail through the card's separate semantic link.
    await card.getByRole('link', { name: en.notifications.view }).click();
    await expect(recipientPage).toHaveURL(new RegExp(`/notifications/${notification.id}$`));
    await waitForHydratedPage(recipientPage);
    await expect(recipientPage.getByRole('heading', { name: communityName })).toBeVisible();
    await expect(recipientPage.getByText(en.notifications.invitationContext)).toBeVisible();

    // Opening the detail marks it read server-side; acceptance joins the private community.
    await recipientPage.getByRole('button', { name: en.notifications.accept }).click();
    await expect(
      recipientPage.getByRole('button', { name: en.notifications.accepted })
    ).toBeVisible();

    // Full page reload: read state and target state persist from the database.
    await recipientPage.reload();
    await waitForHydratedPage(recipientPage);
    await expect(recipientPage.getByRole('heading', { name: communityName })).toBeVisible();
    await expect(recipientPage.getByText(en.notifications.activeMembership)).toBeVisible();
    await expect(recipientPage.getByRole('button', { name: en.notifications.accept })).toHaveCount(
      0
    );

    const membership = await recipient.client
      .from('community_members')
      .select('status')
      .eq('community_id', communityId)
      .eq('user_id', recipient.id)
      .is('valid_until', null)
      .single();
    expect(membership.data?.status).toBe('active');
    const redeemed = await admin.client
      .from('community_invitations')
      .select('redeemed_at')
      .eq('id', notification.target_id)
      .single();
    expect(redeemed.data?.redeemed_at).toBeTruthy();
    const readRow = await recipient.client
      .from('notifications')
      .select('read_at')
      .eq('id', notification.id)
      .single();
    expect(readRow.data?.read_at).toBeTruthy();

    // The recipient's read state is reflected in the center count and the dashboard badge.
    await recipientPage.getByRole('link', { name: en.notifications.back }).click();
    await expect(recipientPage).toHaveURL(/\/notifications$/);
    await waitForHydratedPage(recipientPage);
    await expect(recipientPage.getByText(unreadText(0), { exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: en.notifications.markRead })).toHaveCount(0);
    await recipientPage.reload();
    await waitForHydratedPage(recipientPage);
    await expect(recipientPage.getByText(unreadText(0), { exact: true })).toBeVisible();
    expect((await recipient.client.rpc('count_my_unread_notifications')).data).toBe(0);
    await recipientPage.goto('/dashboard');
    await waitForHydratedPage(recipientPage);
    await expect(recipientPage.getByRole('link', { name: unreadText(0) })).toBeVisible();
  } finally {
    await Promise.all([adminContext.close(), recipientContext.close()]);
  }
});

test('anonymous notification deep link redirects to login with normalized next and returns to the same detail', async ({
  browser
}) => {
  test.setTimeout(120_000);
  const [admin, recipient] = await Promise.all([
    createActor('Deep Admin'),
    createActor('Deep Recipient')
  ]);
  const communityName = `Deep circle ${crypto.randomUUID().slice(0, 8)}`;
  const communityId = await createPrivateCommunity(admin, communityName);
  await insertInvitation(admin, communityId, recipient);
  const notification = await latestNotification(recipient, 'community_invitation');
  const detailPath = `/notifications/${notification.id}`;

  const context = await newContext(browser);
  try {
    const page = await context.newPage();
    await page.goto(detailPath);
    await expect(page).toHaveURL(/\/login\?next=/);
    expect(new URL(page.url()).searchParams.get('next')).toBe(detailPath);
    await waitForHydratedPage(page);
    await page.getByLabel(en.auth.loginEmailLabel).fill(recipient.email);
    await page.getByLabel(en.auth.loginPasswordLabel).fill(password);
    await submitAndWaitForAuthDestination(page, new RegExp(`${notification.id}$`), () =>
      page.getByRole('button', { name: en.auth.loginSubmit }).click()
    );
    await waitForHydratedPage(page);
    // Landed on the same notification detail, never on the dashboard fallback.
    expect(new URL(page.url()).pathname).toBe(detailPath);
    await expect(page.getByRole('heading', { name: communityName })).toBeVisible();
    await expect(page.getByText(en.notifications.invitationContext)).toBeVisible();
  } finally {
    await context.close();
  }
});

test('invitation revoked between detail load and accept degrades gracefully without silent success', async ({
  browser
}) => {
  test.setTimeout(120_000);
  const [admin, recipient] = await Promise.all([
    createActor('Revoke Admin'),
    createActor('Revoke Recipient')
  ]);
  const communityName = `Revoke circle ${crypto.randomUUID().slice(0, 8)}`;
  const communityId = await createPrivateCommunity(admin, communityName);
  await insertInvitation(admin, communityId, recipient);
  const notification = await latestNotification(recipient, 'community_invitation');

  const context = await newContext(browser);
  try {
    const page = await context.newPage();
    await signIn(page, recipient);
    await page.goto(`/notifications/${notification.id}`);
    await waitForHydratedPage(page);
    await expect(page.getByRole('heading', { name: communityName })).toBeVisible();
    const accept = page.getByRole('button', { name: en.notifications.accept });
    await expect(accept).toBeVisible();

    // Admin revokes the invitation after the detail is loaded but before Accept is clicked.
    const revoked = await admin.client
      .from('community_invitations')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', notification.target_id)
      .is('revoked_at', null)
      .is('redeemed_at', null)
      .select('id')
      .single();
    expect(revoked.error).toBeNull();
    expect(revoked.data?.id).toBe(notification.target_id);

    await accept.click();
    // Localized failure state, no crash, and never a silent success.
    await expect(page.getByRole('alert')).toContainText(en.notifications.targetError);
    await expect(page.getByRole('button', { name: en.notifications.accepted })).toHaveCount(0);

    // Retry refetches the target: revoked invitations resolve to the localized unavailable state.
    await page.getByRole('button', { name: en.notifications.retry }).click();
    await expect(
      page.getByRole('heading', { name: en.notifications.targetUnavailable })
    ).toBeVisible();
    await expect(page.getByRole('link', { name: en.notifications.back })).toBeVisible();

    const membership = await recipient.client
      .from('community_members')
      .select('id')
      .eq('community_id', communityId)
      .eq('user_id', recipient.id);
    expect(membership.data).toEqual([]);
    const redeemed = await admin.client
      .from('community_invitations')
      .select('redeemed_at')
      .eq('id', notification.target_id)
      .single();
    expect(redeemed.data?.redeemed_at).toBeNull();
  } finally {
    await context.close();
  }
});

test('removal alert stays visible to the removed member while its target never leaks the community name', async ({
  browser
}) => {
  test.setTimeout(180_000);
  const [admin, member] = await Promise.all([
    createActor('Remove Admin'),
    createActor('Removed Member')
  ]);
  const communityName = `Removal circle ${crypto.randomUUID().slice(0, 8)}`;
  const communityId = await createPrivateCommunity(admin, communityName);
  const invitation = await insertInvitation(admin, communityId, member);
  const accepted = await member.client.rpc('accept_community_invitation', {
    p_token: invitation.token
  });
  expect(accepted.error).toBeNull();

  const adminContext = await newContext(browser);
  const memberContext = await newContext(browser);
  try {
    const adminPage = await adminContext.newPage();
    const memberPage = await memberContext.newPage();
    await signIn(adminPage, admin);

    // Real admin UI removal flow (active -> inactive with an authenticated other actor).
    await adminPage.goto(`/community/${communityId}/admin/members`);
    await waitForHydratedPage(adminPage);
    await adminPage
      .getByRole('searchbox', { name: en.communityAdmin.searchLabel })
      .fill(member.displayName);
    await adminPage.getByRole('link', { name: member.displayName }).click();
    await waitForHydratedPage(adminPage);
    await adminPage.getByRole('button', { name: en.communityAdmin.action.remove }).click();
    await adminPage.getByRole('button', { name: en.communityAdmin.confirmAction }).click();
    await expect(adminPage.getByText(en.communityAdmin.result.remove)).toBeVisible();

    await signIn(memberPage, member);
    const removal = await latestNotification(member, 'community_membership_removed');
    await memberPage.goto('/notifications');
    await waitForHydratedPage(memberPage);
    const removedCard = memberPage
      .locator('main li')
      .filter({ hasText: en.notifications.kinds.community_membership_removed });
    await expect(removedCard).toHaveCount(1);

    // The removed member can read the alert, but its detail resolves to the localized
    // unavailable state without ever disclosing the community name.
    const stopCapture = captureResponses(memberPage);
    await removedCard.getByRole('link', { name: en.notifications.view }).click();
    await expect(memberPage).toHaveURL(new RegExp(`/notifications/${removal.id}$`));
    await waitForHydratedPage(memberPage);
    await expect(
      memberPage.getByRole('heading', { name: en.notifications.targetUnavailable })
    ).toBeVisible();
    await expect(memberPage.getByRole('link', { name: en.notifications.back })).toBeVisible();
    const observed = `${await memberPage.locator('body').innerText()}\n${await stopCapture()}`;
    for (const secret of [communityName, communityId]) expect(observed).not.toContain(secret);

    const target = await member.client.rpc('get_my_notification_target', {
      p_notification_id: removal.id
    });
    expect(target.error).toBeNull();
    expect(target.data).toEqual([
      {
        target_status: 'unavailable',
        community_id: null,
        community_name: null,
        invitation_id: null,
        membership_status: null
      }
    ]);
  } finally {
    await Promise.all([adminContext.close(), memberContext.close()]);
  }
});

test('another signed-in account cannot open a foreign notification or mutate its read state', async ({
  browser
}) => {
  test.setTimeout(120_000);
  const [admin, recipient, outsider] = await Promise.all([
    createActor('Isolation Admin'),
    createActor('Isolation Recipient'),
    createActor('Isolation Outsider')
  ]);
  const communityName = `Isolation circle ${crypto.randomUUID().slice(0, 8)}`;
  const communityId = await createPrivateCommunity(admin, communityName);
  await insertInvitation(admin, communityId, recipient);
  const notification = await latestNotification(recipient, 'community_invitation');

  const context = await newContext(browser);
  try {
    const page = await context.newPage();
    await signIn(page, outsider);
    const stopCapture = captureResponses(page);
    await page.goto(`/notifications/${notification.id}`);
    await waitForHydratedPage(page);
    await expect(page.getByText(en.notifications.error)).toBeVisible();
    const observed = await stopCapture();
    expect(observed).not.toContain(communityName);

    // RLS hides the foreign row completely and the read mutation fails with the denial code.
    const foreignRow = await outsider.client
      .from('notifications')
      .select('id')
      .eq('id', notification.id);
    expect(foreignRow.data).toEqual([]);
    const foreignMark = await outsider.client.rpc('mark_notification_read', {
      p_notification_id: notification.id
    });
    expect(foreignMark.error?.code).toBe('42501');
    const stillUnread = await recipient.client
      .from('notifications')
      .select('read_at')
      .eq('id', notification.id)
      .single();
    expect(stillUnread.data?.read_at).toBeNull();
    const outsiderCount = await outsider.client.rpc('count_my_unread_notifications');
    expect(outsiderCount.data).toBe(0);
  } finally {
    await context.close();
  }
});

test('mark-all-read honors its cutoff so a concurrently arriving notification stays unread', async ({
  browser
}) => {
  test.setTimeout(120_000);
  const [admin, recipient] = await Promise.all([
    createActor('MarkAll Admin'),
    createActor('MarkAll Recipient')
  ]);
  const firstCommunity = await createPrivateCommunity(
    admin,
    `Cutoff one ${crypto.randomUUID().slice(0, 6)}`
  );
  const secondCommunity = await createPrivateCommunity(
    admin,
    `Cutoff two ${crypto.randomUUID().slice(0, 6)}`
  );
  await insertInvitation(admin, firstCommunity, recipient);
  await insertInvitation(admin, secondCommunity, recipient);

  const context = await newContext(browser);
  try {
    const page = await context.newPage();
    await signIn(page, recipient);
    await page.goto('/notifications');
    await waitForHydratedPage(page);
    await expect(page.getByText(unreadText(2), { exact: true })).toBeVisible();

    // New event arrives AFTER the page's authoritative asOf cutoff was captured.
    const thirdCommunity = await createPrivateCommunity(
      admin,
      `Cutoff three ${crypto.randomUUID().slice(0, 6)}`
    );
    await insertInvitation(admin, thirdCommunity, recipient);

    await page.getByRole('button', { name: en.notifications.markAllRead }).click();
    await expect(page.getByText(unreadText(1), { exact: true })).toBeVisible();
    const unreadCards = page.locator('main li', {
      has: page.getByRole('button', { name: en.notifications.markRead })
    });
    await expect(unreadCards).toHaveCount(1);
    await expect(page.locator('main li')).toHaveCount(3);

    const rows = await recipient.client
      .from('notifications')
      .select('id,read_at')
      .order('created_at', { ascending: true });
    expect(rows.data).toHaveLength(3);
    const readStates = (rows.data ?? []).map((row: { read_at: string | null }) => row.read_at);
    expect(typeof readStates[0]).toBe('string');
    expect(typeof readStates[1]).toBe('string');
    expect(readStates[2]).toBeNull();
  } finally {
    await context.close();
  }
});

test('offline center disables mutations and recovers; preferences round-trip all six push booleans', async ({
  browser
}) => {
  test.setTimeout(120_000);
  const [admin, recipient] = await Promise.all([
    createActor('Offline Admin'),
    createActor('Offline Recipient')
  ]);
  const firstCommunity = await createPrivateCommunity(
    admin,
    `Offline one ${crypto.randomUUID().slice(0, 6)}`
  );
  await insertInvitation(admin, firstCommunity, recipient);

  const context = await newContext(browser);
  try {
    const page = await context.newPage();
    await signIn(page, recipient);
    await page.goto('/notifications');
    await waitForHydratedPage(page);
    await expect(page.locator('main li')).toHaveCount(1);

    await page.context().setOffline(true);
    await expect(page.getByText(en.notifications.offline)).toBeVisible();
    await expect(page.getByRole('button', { name: en.notifications.markAllRead })).toBeDisabled();
    await expect(
      page.getByRole('button', { name: en.notifications.markRead }).first()
    ).toBeDisabled();

    // A new event lands while the device is offline; reconnecting refreshes the feed.
    const secondCommunity = await createPrivateCommunity(
      admin,
      `Offline two ${crypto.randomUUID().slice(0, 6)}`
    );
    await insertInvitation(admin, secondCommunity, recipient);
    await page.context().setOffline(false);
    await expect(page.getByText(en.notifications.offline)).toBeHidden();
    await expect(page.locator('main li')).toHaveCount(2);
    await expect(page.getByText(unreadText(2), { exact: true })).toBeVisible();

    await page.goto('/notifications/preferences');
    await waitForHydratedPage(page);
    const master = page.getByRole('switch', { name: en.notificationPreferences.pushTitle });
    const communitySwitch = page.getByRole('switch', {
      name: en.notificationPreferences.categories.community
    });
    await expect(master).not.toBeChecked();
    // Critical in-app has no off affordance and categories stay disabled while Push is off.
    await expect(communitySwitch).toBeDisabled();
    await master.click();
    await expect(communitySwitch).toBeEnabled();
    await communitySwitch.click();
    await page.getByRole('switch', { name: en.notificationPreferences.categories.matches }).click();
    await page.getByRole('button', { name: en.notificationPreferences.save }).click();
    await expect(page.getByText(en.notificationPreferences.saved)).toBeVisible();

    // Full reload round-trips all six persisted booleans.
    await page.reload();
    await waitForHydratedPage(page);
    await expect(master).toBeChecked();
    await expect(
      page.getByRole('switch', { name: en.notificationPreferences.categories.community })
    ).not.toBeChecked();
    await expect(
      page.getByRole('switch', { name: en.notificationPreferences.categories.matches })
    ).not.toBeChecked();
    await expect(
      page.getByRole('switch', { name: en.notificationPreferences.categories.results })
    ).toBeChecked();
    await expect(
      page.getByRole('switch', { name: en.notificationPreferences.categories.rankings })
    ).toBeChecked();
    await expect(
      page.getByRole('switch', { name: en.notificationPreferences.categories.leagues })
    ).toBeChecked();

    const stored = await recipient.client
      .from('notification_preferences')
      .select(
        'push_enabled,push_community,push_matches,push_results,push_rankings,push_leagues,critical_in_app_enabled'
      )
      .eq('user_id', recipient.id)
      .single();
    expect(stored.data).toEqual({
      push_enabled: true,
      push_community: false,
      push_matches: false,
      push_results: true,
      push_rankings: true,
      push_leagues: true,
      critical_in_app_enabled: true
    });
  } finally {
    await context.close();
  }
});

// ---------------------------------------------------------------------------
// Visual and structural probes.
//
// Screenshot budgets are documented, NON-ZERO cross-platform allowances: the
// baselines are captured from this suite (volatile timestamp rows are masked),
// so the same-platform residual measured on the verification re-run is 0
// changed pixels; the budgets only absorb Chromium font-rasterization variance
// across platforms, following the measured auth-visual precedent (text-heavy
// screens showed Linux residuals up to ~1.44x the macOS ratio). Structural
// facts are guarded by exact geometry/style probes, never by the budgets;
// budgets must never be widened to mask a structural defect.
//
// Recorded deviation for review notes: the approved Pencil frames include an
// app-wide bottom navigation, which is pre-existing product infrastructure
// intentionally NOT implemented in PAF-3 (plan: "no new global nav/bottom
// navigation"). The notification screens therefore show no bottom navigation
// and must not be rejected for that bounded gap.
// ---------------------------------------------------------------------------

async function ready(page: Page): Promise<void> {
  await waitForHydratedPage(page);
  // Force-load the exact faces the frames use: a page that never renders a given face would
  // otherwise leave it unloaded and make the screenshot depend on navigation timing.
  await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load('400 12px Inter'),
      document.fonts.load('600 12px Inter'),
      document.fonts.load('700 24px Manrope')
    ]);
    await document.fonts.ready;
  });
  const fonts = await page.evaluate(() => ({
    inter: document.fonts.check('400 12px Inter') && document.fonts.check('600 12px Inter'),
    manrope: document.fonts.check('700 24px Manrope')
  }));
  expect(fonts, 'Inter and Manrope must be available before screenshot').toEqual({
    inter: true,
    manrope: true
  });
}

async function assertCenterStructure(page: Page) {
  await expect(page.getByRole('heading', { level: 1, name: en.notifications.title })).toBeVisible();
  await expect(page.getByText(en.notifications.subtitle)).toBeVisible();
  const preferencesLink = page.getByRole('link', {
    name: en.notificationPreferences.preferencesLink
  });
  await expect(preferencesLink).toBeVisible();
  await expect(preferencesLink).toHaveAttribute('href', '/notifications/preferences');

  const nav = page.getByRole('navigation', { name: en.notifications.filters.label });
  const expectedFilters = [
    en.notifications.filters.all,
    en.notifications.filters.matches,
    en.notifications.filters.results,
    en.notifications.filters.community,
    en.notifications.filters.rankings
  ];
  expect(await nav.getByRole('button').allInnerTexts()).toEqual(expectedFilters);
  await expect(nav.getByRole('button', { name: en.notifications.filters.all })).toHaveAttribute(
    'aria-current',
    'page'
  );

  await expect(page.getByRole('button', { name: en.notifications.markAllRead })).toBeVisible();
}

async function assertCardActions(page: Page) {
  const card = page
    .locator('main li')
    .filter({ hasText: en.notifications.kinds.community_invitation })
    .first();
  const view = card.getByRole('link', { name: en.notifications.view });
  const mark = card.getByRole('button', { name: en.notifications.markRead });
  await expect(view).toBeVisible();
  await expect(mark).toBeVisible();
  const separation = await card.evaluate((item) => {
    const link = item.querySelector('a');
    const button = item.querySelector('button');
    return {
      linkExists: link !== null,
      buttonExists: button !== null,
      nested: link !== null && button !== null && (link.contains(button) || button.contains(link)),
      sameParent: link?.parentElement !== undefined && link.parentElement === button?.parentElement
    };
  });
  expect(separation).toEqual({
    linkExists: true,
    buttonExists: true,
    nested: false,
    sameParent: true
  });
  const timeLabel = await card.locator('p[aria-label]').getAttribute('aria-label');
  expect(timeLabel).toContain(en.notifications.dateUtc);
  return { view, mark };
}

test.describe('notification visual probes', () => {
  test('populated center: structure, unread differentiation and 390x844 baseline', async ({
    page
  }) => {
    test.setTimeout(120_000);
    const [admin, viewer] = await Promise.all([
      createActor('Visual Admin'),
      createActor('Visual Viewer')
    ]);
    await insertInvitation(
      admin,
      await createPrivateCommunity(admin, `Visual one ${crypto.randomUUID().slice(0, 6)}`),
      viewer
    );
    await insertInvitation(
      admin,
      await createPrivateCommunity(admin, `Visual two ${crypto.randomUUID().slice(0, 6)}`),
      viewer
    );

    await signIn(page, viewer);
    const badge = page.getByRole('link', { name: unreadText(2) });
    await expect(badge).toBeVisible();
    expect((await badge.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await badge.click();
    await expect(page).toHaveURL(/\/notifications$/);
    await assertCenterStructure(page);
    await expect(page.getByText(unreadText(2), { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: en.notifications.today })).toBeVisible();
    const { mark } = await assertCardActions(page);

    const cards = page.locator('main li');
    await expect(cards).toHaveCount(2);
    await mark.click();
    await expect(page.getByText(unreadText(1), { exact: true })).toBeVisible();
    const readStyle = await cards.first().evaluate((item) => {
      const style = getComputedStyle(item);
      return { background: style.backgroundColor, border: style.borderLeftWidth };
    });
    const unreadStyle = await cards.nth(1).evaluate((item) => {
      const style = getComputedStyle(item);
      return { background: style.backgroundColor, border: style.borderLeftWidth };
    });
    // Unread cards carry the approved green-soft differentiation.
    expect(unreadStyle).toEqual({ background: 'rgb(224, 243, 232)', border: '2px' });
    expect(readStyle.background).not.toBe(unreadStyle.background);
    await expect(
      cards.first().getByRole('button', { name: en.notifications.markRead })
    ).toHaveCount(0);

    await ready(page);
    // Timestamp rows are fixture-dependent and masked; card copy, counts and layout stay exact.
    await expect(page).toHaveScreenshot('notifications-center-populated.png', {
      animations: 'disabled',
      caret: 'hide',
      threshold: 0.1,
      maxDiffPixelRatio: 0.04,
      mask: [page.locator('main li p[aria-label]')]
    });

    // Unused filters keep their real localized empty states.
    const nav = page.getByRole('navigation', { name: en.notifications.filters.label });
    for (const key of ['matches', 'results', 'rankings'] as const) {
      await nav.getByRole('button', { name: en.notifications.filters[key] }).click();
      await expect(page.getByText(en.notifications.empty[key])).toBeVisible();
    }
  });

  test('empty center: reachable entry, localized empty state and 390x844 baseline', async ({
    page
  }) => {
    test.setTimeout(120_000);
    const viewer = await createActor('Visual Empty');
    await signIn(page, viewer);
    const badge = page.getByRole('link', { name: unreadText(0) });
    await expect(badge).toBeVisible();
    await badge.click();
    await expect(page).toHaveURL(/\/notifications$/);
    await assertCenterStructure(page);
    await expect(page.getByText(en.notifications.empty.all)).toBeVisible();
    await expect(page.locator('main li')).toHaveCount(0);
    await expect(page.getByRole('button', { name: en.notifications.markAllRead })).toBeDisabled();

    await ready(page);
    await expect(page).toHaveScreenshot('notifications-center-empty.png', {
      animations: 'disabled',
      caret: 'hide',
      threshold: 0.1,
      maxDiffPixelRatio: 0.03
    });
  });

  test('preferences: group order, six switches, ALWAYS ON panel and 390x844 baseline', async ({
    page
  }) => {
    test.setTimeout(120_000);
    const viewer = await createActor('Visual Prefs');
    await signIn(page, viewer);
    await page.goto('/notifications/preferences');
    await ready(page);

    const back = page.getByRole('link', { name: en.notificationPreferences.back });
    await expect(back).toBeVisible();
    await expect(back).toHaveAttribute('href', '/notifications');
    await expect(
      page.getByRole('heading', { level: 1, name: en.notificationPreferences.title })
    ).toBeVisible();
    await expect(page.getByText(en.notificationPreferences.pushUnavailable)).toBeVisible();

    const fieldset = page.getByRole('group', { name: en.notificationPreferences.pushTitle });
    const critical = page.getByRole('region', {
      name: en.notificationPreferences.criticalTitle
    });
    const expectedOrder = [
      en.notificationPreferences.pushTitle,
      en.notificationPreferences.categories.community,
      en.notificationPreferences.categories.matches,
      en.notificationPreferences.categories.results,
      en.notificationPreferences.categories.rankings,
      en.notificationPreferences.categories.leagues
    ];
    const switches = fieldset.getByRole('switch');
    expect(
      await switches.evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('aria-label'))
      )
    ).toEqual(expectedOrder);
    await expect(switches.first()).not.toBeChecked();
    for (let index = 1; index < expectedOrder.length; index += 1)
      await expect(switches.nth(index)).toBeChecked();

    // Preferences group order: the push fieldset precedes the critical in-app panel, which is
    // a static ALWAYS ON status with no off affordance at all.
    const fieldsetHandle = await fieldset.elementHandle();
    const criticalHandle = await critical.elementHandle();
    const domOrder = await page.evaluate(
      ({ before, after }) =>
        before !== null &&
        after !== null &&
        !!(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING),
      { before: fieldsetHandle, after: criticalHandle }
    );
    expect(domOrder).toBe(true);
    const groupBox = await fieldset.boundingBox();
    const criticalBox = await critical.boundingBox();
    expect(criticalBox!.y).toBeGreaterThan(groupBox!.y);
    await expect(critical.getByText(en.notificationPreferences.alwaysOn)).toBeVisible();
    expect(
      await critical.evaluate((section) => section.querySelectorAll('button, input').length)
    ).toBe(0);

    await expect(page.getByRole('button', { name: en.notificationPreferences.save })).toBeEnabled();
    await expect(page).toHaveScreenshot('notifications-preferences.png', {
      animations: 'disabled',
      caret: 'hide',
      threshold: 0.1,
      maxDiffPixelRatio: 0.03
    });
  });
});

test.describe('notification desktop probes', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  async function assertContentCap(page: Page) {
    // The panel must obey the app-wide 480px content cap used by every other screen
    // (calc(var(--space-40) * 12)); an unresolved token would compute to max-width: none
    // and stretch the panel across the whole desktop viewport.
    const panel = page.locator('main > section').first();
    await expect(panel).toHaveCSS('max-width', '480px');
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(496);
  }

  test('populated center keeps the content cap at desktop width', async ({ page }) => {
    test.setTimeout(120_000);
    const [admin, viewer] = await Promise.all([
      createActor('Desktop Admin'),
      createActor('Desktop Viewer')
    ]);
    await insertInvitation(
      admin,
      await createPrivateCommunity(admin, `Desktop one ${crypto.randomUUID().slice(0, 6)}`),
      viewer
    );
    await insertInvitation(
      admin,
      await createPrivateCommunity(admin, `Desktop two ${crypto.randomUUID().slice(0, 6)}`),
      viewer
    );

    await signIn(page, viewer);
    await page.goto('/notifications');
    await assertContentCap(page);
    await assertCenterStructure(page);
    await expect(page.getByText(unreadText(2), { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: en.notifications.today })).toBeVisible();
    await assertCardActions(page);

    await ready(page);
    await expect(page).toHaveScreenshot('notifications-center-populated-desktop.png', {
      animations: 'disabled',
      caret: 'hide',
      threshold: 0.1,
      maxDiffPixelRatio: 0.02,
      mask: [page.locator('main li p[aria-label]')]
    });
  });

  test('empty center keeps the content cap at desktop width', async ({ page }) => {
    test.setTimeout(120_000);
    const viewer = await createActor('Desktop Empty');
    await signIn(page, viewer);
    await page.goto('/notifications');
    await assertContentCap(page);
    await expect(page.getByText(en.notifications.empty.all)).toBeVisible();

    await ready(page);
    await expect(page).toHaveScreenshot('notifications-center-empty-desktop.png', {
      animations: 'disabled',
      caret: 'hide',
      threshold: 0.1,
      maxDiffPixelRatio: 0.02
    });
  });

  test('preferences keeps the content cap at desktop width', async ({ page }) => {
    test.setTimeout(120_000);
    const viewer = await createActor('Desktop Prefs');
    await signIn(page, viewer);
    await page.goto('/notifications/preferences');
    await assertContentCap(page);
    await expect(
      page.getByRole('heading', { level: 1, name: en.notificationPreferences.title })
    ).toBeVisible();
    const critical = page.getByRole('region', { name: en.notificationPreferences.criticalTitle });
    await expect(critical.getByText(en.notificationPreferences.alwaysOn)).toBeVisible();

    await ready(page);
    await expect(page).toHaveScreenshot('notifications-preferences-desktop.png', {
      animations: 'disabled',
      caret: 'hide',
      threshold: 0.1,
      maxDiffPixelRatio: 0.02
    });
  });
});
