import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';
import { waitForHydratedPage } from './auth-helpers';

const en: {
  auth: { loginEmailLabel: string; loginPasswordLabel: string; loginSubmit: string };
  communityAdmin: {
    inviteUnavailable: string;
    requestMessage: { action: string; title: string; label: string; send: string; sent: string };
    venue: { edit: string; photo: { label: string; upload: string; previewAlt: string } };
  };
  communityInbox: { title: string; markRead: string; read: string };
  communityInvites: {
    title: string;
    searchLabel: string;
    invite: string;
    issued: string;
    noResults: string;
    discoverableLabel: string;
  };
} = JSON.parse(
  readFileSync(new URL('../src/locales/en/translation.json', import.meta.url), 'utf8')
);
const config = (() => {
  const values = new Map(
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
  const url = process.env.VITE_SUPABASE_URL ?? values.get('VITE_SUPABASE_URL') ?? '';
  const key =
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? values.get('VITE_SUPABASE_PUBLISHABLE_KEY') ?? '';
  if (!url || !key || !['localhost', '127.0.0.1'].includes(new URL(url).hostname))
    throw new Error('Request message E2E requires loopback Supabase');
  return { url, key };
})();
const password = 'Password123!';
type Actor = { email: string; id: string; client: SupabaseClient };
async function createActor(label: string): Promise<Actor> {
  const anonymous = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const email = `request-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${crypto.randomUUID()}@example.test`;
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

test('admin sends one-way request update; applicant reads it after refresh; outsider cannot read', async ({
  page
}) => {
  test.setTimeout(120_000);
  const admin = await createActor('Request Admin');
  const applicant = await createActor('Request Applicant');
  const outsider = await createActor('Request Outsider');
  const community = await admin.client.rpc('create_community', {
    p_name: `Requests ${crypto.randomUUID().slice(0, 6)}`,
    p_visibility: 'public',
    p_join_policy: 'admin_approval'
  });
  if (community.error || typeof community.data !== 'string')
    throw community.error ?? new Error('Community creation failed');
  const joined = await applicant.client.rpc('join_public_community', {
    p_community_id: community.data
  });
  if (joined.error) throw joined.error;
  const pending = await admin.client.rpc('search_community_members', {
    p_community_id: community.data,
    p_query: '',
    p_status: 'pending',
    p_offset: 0,
    p_limit: 50
  });
  if (pending.error || !pending.data?.[0])
    throw pending.error ?? new Error('Pending application missing');
  await signIn(page, admin);
  await page.goto(`/community/${community.data}/admin/requests`);
  await waitForHydratedPage(page);
  const requestCard = page.getByRole('heading', { name: 'Request Applicant' }).locator('xpath=..');
  await requestCard.getByRole('button', { name: en.communityAdmin.requestMessage.action }).click();
  await expect(
    page.getByRole('heading', { name: en.communityAdmin.requestMessage.title })
  ).toBeVisible();
  const body = `Important update ${crypto.randomUUID()}`;
  await page.getByRole('textbox', { name: en.communityAdmin.requestMessage.label }).fill(body);
  await page.getByRole('button', { name: en.communityAdmin.requestMessage.send }).click();
  await expect(
    page.getByRole('button', { name: en.communityAdmin.requestMessage.sent })
  ).toBeVisible();
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await signIn(page, applicant);
  await page.reload();
  await waitForHydratedPage(page);
  const inbox = page.getByRole('region', { name: en.communityInbox.title });
  await expect(inbox.getByText(body)).toBeVisible();
  await inbox.getByRole('button', { name: en.communityInbox.markRead }).click();
  await expect(inbox.getByText(en.communityInbox.read)).toBeVisible();
  const recipientRows = await outsider.client
    .from('community_notifications')
    .select('id')
    .eq('recipient_user_id', applicant.id);
  expect(recipientRows.data).toEqual([]);
  await outsider.client.auth.signOut();
  const observed: string[] = [];
  const capture = (response: import('@playwright/test').Response) => {
    void response
      .text()
      .then((text) => observed.push(text))
      .catch(() => undefined);
  };
  page.on('response', capture);
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await signIn(page, outsider);
  await page.reload();
  await waitForHydratedPage(page);
  await expect(
    page.getByRole('region', { name: en.communityInbox.title }).getByText(body)
  ).toHaveCount(0);
  page.off('response', capture);
  expect(observed.join('\n')).not.toContain(body);
});

function pngFixture() {
  const crc32 = (bytes: Buffer) => {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, payload: Buffer) => {
    const name = Buffer.from(type);
    const body = Buffer.concat([name, payload]);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(body));
    const length = Buffer.alloc(4);
    length.writeUInt32BE(payload.length);
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, 30, 90, 130, 255]))),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

test('admin uploads a real venue photo to local Storage and sees it after refresh', async ({
  page
}) => {
  test.setTimeout(120_000);
  const admin = await createActor('Photo Admin');
  const created = await admin.client.rpc('create_community', {
    p_name: `Photo Club ${crypto.randomUUID().slice(0, 6)}`,
    p_visibility: 'private',
    p_join_policy: 'instant'
  });
  if (created.error || typeof created.data !== 'string')
    throw created.error ?? new Error('Photo community creation failed');
  const venue = await admin.client
    .from('community_venues')
    .insert({ community_id: created.data, name: 'Preview Court' })
    .select('id')
    .single();
  if (venue.error || !venue.data) throw venue.error ?? new Error('Photo venue creation failed');

  await signIn(page, admin);
  await page.goto(`/community/${created.data}/admin/venues`);
  await waitForHydratedPage(page);
  const card = page.getByTestId('community-venue-card').filter({ hasText: 'Preview Court' });
  await card.getByRole('button', { name: en.communityAdmin.venue.edit }).click();
  await page.getByLabel(en.communityAdmin.venue.photo.label).setInputFiles({
    name: 'venue.png',
    mimeType: 'image/png',
    buffer: pngFixture()
  });
  await page.getByRole('button', { name: en.communityAdmin.venue.photo.upload }).click();
  await expect(
    page.getByRole('img', { name: en.communityAdmin.venue.photo.previewAlt })
  ).toBeVisible();
  await expect(page.getByText('Photo uploaded')).toBeVisible();
  const linked = await admin.client
    .from('community_venues')
    .select('photo_path')
    .eq('id', venue.data.id)
    .single();
  expect(linked.data?.photo_path).toMatch(
    new RegExp(`^${created.data}/${venue.data.id}/${admin.id}/`)
  );

  await page.reload();
  await waitForHydratedPage(page);
  await page
    .getByTestId('community-venue-card')
    .filter({ hasText: 'Preview Court' })
    .getByRole('button', { name: en.communityAdmin.venue.edit })
    .click();
  await expect(
    page.getByRole('img', { name: en.communityAdmin.venue.photo.previewAlt })
  ).toBeVisible();
  const stored = await admin.client.storage
    .from('community-venue-photos')
    .download(linked.data!.photo_path);
  expect(stored.error).toBeNull();
});

test('private Admin invites an opted-in player; withdrawal removes directory result and unauthorized HTML stays private', async ({
  page
}) => {
  test.setTimeout(45_000);
  const admin = await createActor('Invite Directory Admin');
  const inviteeName = `Invitee Sentinel ${crypto.randomUUID().slice(0, 6)}`;
  const invitee = await createActor(inviteeName);
  const created = await admin.client.rpc('create_community', {
    p_name: `Invite Directory ${crypto.randomUUID().slice(0, 6)}`,
    p_visibility: 'private',
    p_join_policy: 'instant'
  });
  if (created.error || typeof created.data !== 'string')
    throw created.error ?? new Error('Private community creation failed');
  const communityId = created.data;
  expect(
    (
      await invitee.client
        .from('community_invitee_directory_preferences')
        .insert({ user_id: invitee.id })
    ).error
  ).toBeNull();
  await signIn(page, admin);
  await page.goto(`/community/${communityId}/admin/members`);
  await waitForHydratedPage(page);
  await page.getByRole('button', { name: en.communityAdmin.inviteUnavailable }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(en.communityInvites.searchLabel).fill(inviteeName);
  const result = dialog.locator(`input[name="invitee"][value="${invitee.id}"]`);
  await expect(result).toBeVisible();
  await result.check({ timeout: 3_000 });
  await expect(result).toBeChecked({ timeout: 3_000 });
  await dialog.getByRole('button', { name: en.communityInvites.invite }).click();
  await expect(dialog.getByText(en.communityInvites.issued)).toBeVisible();
  const rawToken = await dialog.locator('code').textContent();
  expect(rawToken).toMatch(/^[a-f0-9]{64}$/);
  expect(
    (
      await invitee.client
        .from('community_invitee_directory_preferences')
        .delete()
        .eq('user_id', invitee.id)
    ).error
  ).toBeNull();
  await dialog.getByLabel(en.communityInvites.searchLabel).fill('');
  await dialog.getByLabel(en.communityInvites.searchLabel).fill(inviteeName);
  await expect(dialog.getByText(en.communityInvites.noResults)).toBeVisible();

  const outsider = await createActor('Directory Outsider');
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  const observed: string[] = [];
  const capture = (response: import('@playwright/test').Response) => {
    void response
      .text()
      .then((text) => observed.push(text))
      .catch(() => undefined);
  };
  page.on('response', capture);
  await signIn(page, outsider);
  await page.reload();
  await waitForHydratedPage(page);
  page.off('response', capture);
  const unauthorizedPayload = observed.join('\n');
  for (const sentinel of [inviteeName, rawToken!, 'PHOTO_SENTINEL', 'MESSAGE_SENTINEL'])
    expect(unauthorizedPayload).not.toContain(sentinel);
});
