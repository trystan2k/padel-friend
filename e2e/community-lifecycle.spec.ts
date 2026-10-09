import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { waitForHydratedPage } from './auth-helpers';

type Copy = {
  auth: { loginEmailLabel: string; loginPasswordLabel: string; loginSubmit: string };
  communityOnboarding: {
    createTitle: string;
    createSubmit: string;
    nameLabel: string;
    private: string;
    created: string;
    searchLabel: string;
    emptySearch: string;
    join: string;
    joined: string;
    membershipInactive: string;
  };
  communityAdmin: {
    accessDeniedTitle: string;
    accessDenied: string;
    title: { requests: string; member: string };
    searchLabel: string;
    memberFilters: string;
    status: { inactive: string };
    action: { approve: string; remove: string; reactivate: string };
    confirmAction: string;
    result: { approve: string; remove: string; reactivate: string };
    empty: { member: string };
  };
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
    throw new Error('Community lifecycle E2E requires loopback Supabase');
  return { url, key };
}

async function createActor(label: string): Promise<Actor> {
  const bootstrap = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const email = `lifecycle-${crypto.randomUUID()}@test.local`;
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
  await page.context().addCookies([{ name: 'locale', value: 'en', url: 'http://127.0.0.1:4173' }]);
  await page.goto('/login');
  await waitForHydratedPage(page);
  await page.getByLabel(en.auth.loginEmailLabel).fill(actor.email);
  await page.getByLabel(en.auth.loginPasswordLabel).fill(password);
  await page.getByRole('button', { name: en.auth.loginSubmit }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await waitForHydratedPage(page);
}

async function createCommunityThroughUi(
  page: Page,
  owner: Actor,
  name: string,
  visibility: 'public' | 'private'
) {
  await page.goto('/onboarding/community?view=create');
  await waitForHydratedPage(page);
  await expect(
    page.getByRole('heading', { name: en.communityOnboarding.createTitle })
  ).toBeVisible();
  await page.getByLabel(en.communityOnboarding.nameLabel).fill(name);
  if (visibility === 'private')
    await page
      .getByRole('radio', { name: new RegExp(en.communityOnboarding.private, 'i') })
      .click();
  await page.getByRole('button', { name: en.communityOnboarding.createSubmit }).click();
  await expect(page.getByText(en.communityOnboarding.created)).toBeVisible();
  const created = await owner.client.from('communities').select('id').eq('name', name).single();
  if (created.error || !created.data)
    throw created.error ?? new Error('Community creation missing');
  return created.data.id;
}

async function insertInvitation(owner: Actor, communityId: string, invitee: Actor) {
  // Existing issueInvitation persists through an authenticated owner INSERT; no invite UI or SQL
  // issuance RPC exists. The invitee redeems the resulting token with the real database RPC.
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

async function ownMembership(owner: Actor, communityId: string, userId: string) {
  const result = await owner.client
    .from('community_members')
    .select('*')
    .eq('community_id', communityId)
    .eq('user_id', userId)
    .order('valid_from', { ascending: true })
    .order('id', { ascending: true });
  if (result.error || !result.data?.length)
    throw result.error ?? new Error('Membership row missing');
  return result.data.find((row) => row.valid_until === null) ?? result.data.at(-1)!;
}

async function assertDeniedWithoutFixtureData(
  page: Page,
  path: string,
  privateData: string[],
  expected: 'admin' | 'foreign'
) {
  const payloads: Promise<string>[] = [];
  const onResponse = (response: import('@playwright/test').Response) => {
    if (['document', 'fetch', 'xhr'].includes(response.request().resourceType()))
      payloads.push(response.text().catch(() => ''));
  };
  page.on('response', onResponse);
  try {
    await page.goto(path);
    await waitForHydratedPage(page);
    if (expected === 'admin') {
      await expect(
        page.getByRole('heading', { name: en.communityAdmin.accessDeniedTitle })
      ).toBeVisible();
      await expect(page.getByText(en.communityAdmin.accessDenied)).toBeVisible();
    } else {
      await expect(
        page.getByRole('heading', { name: en.communityAdmin.title.member })
      ).toBeVisible();
      await expect(page.getByText(en.communityAdmin.empty.member)).toBeVisible();
    }
    const body = (await Promise.all(payloads)).join('\n');
    for (const secret of privateData) expect(body).not.toContain(secret);
  } finally {
    page.off('response', onResponse);
  }
}

test('real lifecycle journey: UI membership controls, RPC-only leave/redemption, and protected routes', async ({
  browser
}) => {
  test.setTimeout(180000);
  const [owner, joiner, invitee, outsider] = await Promise.all([
    createActor('Lifecycle Owner'),
    createActor('Lifecycle Joiner'),
    createActor('Lifecycle Invitee'),
    createActor('Lifecycle Outsider')
  ]);
  const contexts: BrowserContext[] = [];
  try {
    const ownerContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      serviceWorkers: 'block'
    });
    const joinerContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      serviceWorkers: 'block'
    });
    const inviteeContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      serviceWorkers: 'block'
    });
    const outsiderContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      serviceWorkers: 'block'
    });
    const guestContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      serviceWorkers: 'block'
    });
    contexts.push(ownerContext, joinerContext, inviteeContext, outsiderContext, guestContext);
    const ownerPage = await ownerContext.newPage();
    const joinerPage = await joinerContext.newPage();
    const inviteePage = await inviteeContext.newPage();
    const outsiderPage = await outsiderContext.newPage();
    const guestPage = await guestContext.newPage();
    await Promise.all([
      signIn(ownerPage, owner),
      signIn(joinerPage, joiner),
      signIn(inviteePage, invitee),
      signIn(outsiderPage, outsider)
    ]);

    const publicName = `Public lifecycle ${crypto.randomUUID().slice(0, 8)}`;
    const publicId = await createCommunityThroughUi(ownerPage, owner, publicName, 'public');
    await joinerPage.goto(`/onboarding/community?q=${encodeURIComponent(publicName)}`);
    await waitForHydratedPage(joinerPage);
    await expect(joinerPage.getByRole('heading', { name: publicName })).toBeVisible();
    await joinerPage.getByRole('button', { name: en.communityOnboarding.join }).click();
    await expect(joinerPage.getByText(en.communityOnboarding.joined)).toBeVisible();
    const joinedPublic = await ownMembership(owner, publicId, joiner.id);
    expect(joinedPublic).toMatchObject({ status: 'active', valid_until: null });

    const privateName = `Private lifecycle ${crypto.randomUUID().slice(0, 8)}`;
    const privateId = await createCommunityThroughUi(ownerPage, owner, privateName, 'private');
    await joinerPage.goto(`/onboarding/community?q=${encodeURIComponent(privateName)}`);
    await waitForHydratedPage(joinerPage);
    await expect(joinerPage.getByText(en.communityOnboarding.emptySearch)).toBeVisible();
    const privateMarker = `Restricted venue ${crypto.randomUUID()}`;
    const venue = await owner.client
      .from('community_venues')
      .insert({ community_id: privateId, name: privateMarker })
      .select('id')
      .single();
    if (venue.error) throw venue.error;

    const firstInvitation = await insertInvitation(owner, privateId, invitee);
    const accepted = await invitee.client.rpc('accept_community_invitation', {
      p_token: firstInvitation.token
    });
    expect(accepted.error).toBeNull();
    expect(accepted.data).toMatchObject([{ community_id: privateId, status: 'pending' }]);
    const pendingMember = await ownMembership(owner, privateId, invitee.id);
    expect(pendingMember).toMatchObject({ status: 'pending', activated_at: null });
    await assertDeniedWithoutFixtureData(
      inviteePage,
      `/community/${privateId}/admin/requests`,
      [privateName, privateMarker, invitee.displayName, invitee.email],
      'admin'
    );

    await ownerPage.goto(`/community/${privateId}/admin/requests`);
    await waitForHydratedPage(ownerPage);
    await expect(ownerPage.getByRole('heading', { name: invitee.displayName })).toBeVisible();
    await ownerPage.getByRole('button', { name: en.communityAdmin.action.approve }).click();
    await expect(ownerPage.getByText(en.communityAdmin.result.approve)).toBeVisible();
    const approvedMember = await ownMembership(owner, privateId, invitee.id);
    expect(approvedMember).toMatchObject({ status: 'active', valid_until: null });
    expect(approvedMember.activated_at).toBeTruthy();

    await ownerPage.goto(`/community/${privateId}/admin/members`);
    await waitForHydratedPage(ownerPage);
    await ownerPage
      .getByRole('searchbox', { name: en.communityAdmin.searchLabel })
      .fill(invitee.displayName);
    const inviteeLink = ownerPage.getByRole('link', { name: invitee.displayName });
    await expect(inviteeLink).toBeVisible();
    await inviteeLink.click();
    await waitForHydratedPage(ownerPage);
    await ownerPage.getByRole('button', { name: en.communityAdmin.action.remove }).click();
    await ownerPage.getByRole('button', { name: en.communityAdmin.confirmAction }).click();
    await expect(ownerPage.getByText(en.communityAdmin.result.remove)).toBeVisible();
    const removedMember = await ownMembership(owner, privateId, invitee.id);
    expect(removedMember).toMatchObject({
      id: approvedMember.id,
      role: approvedMember.role,
      status: 'inactive',
      valid_from: approvedMember.valid_from,
      activated_at: approvedMember.activated_at
    });
    expect(removedMember.valid_until).toBeTruthy();
    const removedSnapshot = { ...removedMember };
    expect(
      (await invitee.client.rpc('can_read_community', { p_community_id: privateId })).data
    ).toBe(false);
    expect(
      (await invitee.client.from('community_venues').select('name').eq('community_id', privateId))
        .data
    ).toEqual([]);

    const blockedInvitation = await insertInvitation(owner, privateId, invitee);
    const blocked = await invitee.client.rpc('accept_community_invitation', {
      p_token: blockedInvitation.token
    });
    expect(blocked.error?.code).toBe('PJ008');
    expect(
      (
        await owner.client
          .from('community_invitations')
          .select('redeemed_at')
          .eq('id', blockedInvitation.id)
          .single()
      ).data?.redeemed_at
    ).toBeNull();
    await assertDeniedWithoutFixtureData(
      inviteePage,
      `/community/${privateId}/admin/venues`,
      [privateName, privateMarker, invitee.displayName, invitee.email],
      'admin'
    );

    await ownerPage.getByRole('button', { name: en.communityAdmin.action.reactivate }).click();
    await expect(ownerPage).not.toHaveURL(new RegExp(`/admin/members/${removedMember.id}$`));
    await expect(ownerPage).toHaveURL(/\/admin\/members\/[0-9a-f-]{36}$/);
    const reactivatedMember = await ownMembership(owner, privateId, invitee.id);
    expect(reactivatedMember.id).not.toBe(removedMember.id);
    expect(reactivatedMember).toMatchObject({
      status: 'active',
      role: 'member',
      valid_until: null
    });
    expect(await ownMembership(owner, privateId, invitee.id)).toMatchObject({
      status: 'active',
      valid_until: null
    });
    const afterReactivation = await owner.client
      .from('community_members')
      .select('*')
      .eq('id', removedMember.id)
      .single();
    expect(afterReactivation.error).toBeNull();
    expect(afterReactivation.data).toEqual(removedSnapshot);
    expect(
      (await invitee.client.rpc('can_read_community', { p_community_id: privateId })).data
    ).toBe(true);
    expect(
      (await invitee.client.from('community_venues').select('name').eq('community_id', privateId))
        .data
    ).toEqual([{ name: privateMarker }]);
    expect(
      (
        await invitee.client.rpc('accept_community_invitation', {
          p_token: blockedInvitation.token
        })
      ).error?.code
    ).toBe('PJ006');
    expect(
      (
        await owner.client
          .from('community_invitations')
          .select('redeemed_at')
          .eq('id', blockedInvitation.id)
          .single()
      ).data?.redeemed_at
    ).toBeNull();
    await assertDeniedWithoutFixtureData(
      inviteePage,
      `/community/${privateId}/admin/audit`,
      [privateName, privateMarker, invitee.displayName, invitee.email],
      'admin'
    );

    const publicLeave = await joiner.client.rpc('leave_community', { p_community_id: publicId });
    expect(publicLeave.error).toBeNull();
    expect(publicLeave.data).toMatchObject([
      { membership_id: joinedPublic.id, status: 'inactive', community_id: publicId }
    ]);
    expect(
      (await joiner.client.rpc('join_public_community', { p_community_id: publicId })).error?.code
    ).toBe('PJ008');
    await joinerPage.goto(`/onboarding/community?q=${encodeURIComponent(publicName)}`);
    await waitForHydratedPage(joinerPage);
    await joinerPage.getByRole('button', { name: en.communityOnboarding.join }).click();
    await expect(joinerPage.getByText(en.communityOnboarding.membershipInactive)).toBeVisible();
    const inactiveJoinButton = joinerPage.getByRole('button', {
      name: en.communityOnboarding.join
    });
    await expect(inactiveJoinButton).toBeDisabled();

    await ownerPage.goto(`/community/${publicId}/admin/members`);
    await waitForHydratedPage(ownerPage);
    const filterGroup = ownerPage.getByRole('group', { name: en.communityAdmin.memberFilters });
    await filterGroup.getByRole('button', { name: en.communityAdmin.status.inactive }).click();
    await ownerPage
      .getByRole('searchbox', { name: en.communityAdmin.searchLabel })
      .fill(joiner.displayName);
    const joinerLink = ownerPage.getByRole('link', { name: joiner.displayName });
    await expect(joinerLink).toBeVisible();
    await joinerLink.click();
    await waitForHydratedPage(ownerPage);
    await ownerPage.getByRole('button', { name: en.communityAdmin.action.reactivate }).click();
    await expect(ownerPage).not.toHaveURL(new RegExp(`/admin/members/${joinedPublic.id}$`));
    await expect(ownerPage).toHaveURL(/\/admin\/members\/[0-9a-f-]{36}$/);
    const publicReactivated = await ownMembership(owner, publicId, joiner.id);
    expect(publicReactivated.id).not.toBe(joinedPublic.id);
    expect(publicReactivated).toMatchObject({ status: 'active', valid_until: null });
    expect((await ownMembership(owner, publicId, joiner.id)).id).toBe(publicReactivated.id);
    expect(
      (await joiner.client.rpc('join_public_community', { p_community_id: publicId })).error?.code
    ).toBe('PJ006');

    await assertDeniedWithoutFixtureData(
      outsiderPage,
      `/community/${privateId}/admin/members`,
      [privateName, privateMarker, invitee.displayName, invitee.email],
      'admin'
    );
    const foreignCommunityName = `Foreign lifecycle ${crypto.randomUUID()}`;
    const otherCommunity = await outsider.client.rpc('create_community', {
      p_name: foreignCommunityName,
      p_visibility: 'public',
      p_join_policy: 'instant'
    });
    expect(otherCommunity.error).toBeNull();
    const foreignMembership = await ownMembership(outsider, otherCommunity.data, outsider.id);
    await assertDeniedWithoutFixtureData(
      ownerPage,
      `/community/${privateId}/admin/members/${foreignMembership.id}`,
      [foreignCommunityName, outsider.displayName, outsider.email],
      'foreign'
    );
    await guestPage.goto(`/community/${privateId}/admin/audit`);
    await expect(guestPage).toHaveURL(/\/login\?next=/);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
