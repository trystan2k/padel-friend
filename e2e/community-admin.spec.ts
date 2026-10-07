import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../src/lib/supabase/database.types';
import { expect, test, type Page } from '@playwright/test';
import { waitForHydratedPage } from './auth-helpers';

type Copy = {
  auth: { loginEmailLabel: string; loginPasswordLabel: string; loginSubmit: string };
  onboarding: {
    name: string;
    preciseLevel: string;
    side: string;
    sideEitherShort: string;
    save: string;
  };
  communityAdmin: {
    title: Record<string, string>;
    accessDeniedTitle: string;
    action: Record<string, string>;
    confirmAction: string;
    search: string;
    settings: { name: string; city: string; details: string };
    save: string;
    venue: { add: string; name: string; address: string; mapsUrl: string; archive: string };
    accessDenied: string;
  };
};

const en: Copy = JSON.parse(
  readFileSync(new URL('../src/locales/en/translation.json', import.meta.url), 'utf8')
);
const pt: Copy = JSON.parse(
  readFileSync(new URL('../src/locales/pt-BR/translation.json', import.meta.url), 'utf8')
);
const es: Copy = JSON.parse(
  readFileSync(new URL('../src/locales/es/translation.json', import.meta.url), 'utf8')
);
const references = {
  'RgqPq.png': 'a85a6235eefc9c8387f6ff463401ad4dbec8d7d158949df69518d3bd0b9c16df',
  'wFqGR.png': '9283fea3d94cc022c7e19718bed6d30f5958b08886b4a89a9d582a7f7218299d',
  'jQDkx.png': 'b2152acc83eb205abea4483d990e61d872140ed0dfbf414e66ab1483aff9db8b',
  'N18Mu4.png': '512027e33e546fa478206ed57806b06132306a4c6516d51ef9e6fb5be88b3fe6',
  'A5Vio.png': '707a4741bf6fef96bafc3b07cc429b208ab03f600c91cc681b72cb4cf83cceb7',
  'E5CS5K.png': '9f785a3cd61ea8e21075897b8d438c5be8c0ead4ff948f7ef09f73a1343d7eec'
} as const;

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  colorScheme: 'light',
  serviceWorkers: 'block'
});

function localConfig() {
  const vars = new Map(
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
  const url = process.env.VITE_SUPABASE_URL ?? vars.get('VITE_SUPABASE_URL') ?? '';
  const key =
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? vars.get('VITE_SUPABASE_PUBLISHABLE_KEY') ?? '';
  if (!url || !key || !['localhost', '127.0.0.1'].includes(new URL(url).hostname))
    throw new Error('Community admin E2E requires loopback Supabase');
  return { url, key };
}
const config = localConfig();
const password = 'Password123!';
type Actor = { email: string; client: SupabaseClient; id: string };

async function createActor(label: string): Promise<Actor> {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const email = `admin-ui-${slug}-${crypto.randomUUID()}@test.local`;
  const anon = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const created = await anon.auth.signUp({ email, password });
  if (created.error || !created.data.session || !created.data.user)
    throw new Error(
      `Could not create real-Supabase E2E user (${created.error?.message ?? 'session unavailable'})`
    );
  const client = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const sessionResult = await client.auth.setSession(created.data.session);
  if (sessionResult.error) throw sessionResult.error;
  const profile = await client.rpc('onboard_player', {
    p_display_name: label,
    p_preferred_side: 'EITHER',
    p_initial_level: 3.2
  });
  if (profile.error) throw profile.error;
  return { email, client, id: created.data.user.id };
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

async function visualDiff(
  page: Page,
  file: keyof typeof references,
  budget: number,
  masks: [number, number, number, number][] = []
) {
  const source = readFileSync(new URL(`./references/paf-31/${file}`, import.meta.url));
  const baseline = readFileSync(
    new URL(`./community-admin.spec.ts-snapshots/${file}`, import.meta.url)
  );
  expect(createHash('sha256').update(source).digest('hex')).toBe(references[file]);
  expect(baseline).toEqual(source);
  await page.evaluate(() => document.fonts.ready);
  const actual = await page.locator('main').screenshot({ animations: 'disabled', caret: 'hide' });
  const difference = await page.evaluate(
    async ({ expected, received, masks: maskAreas }) => {
      const decode = async (base64: string) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas 2D context unavailable');
        context.drawImage(image, 0, 0);
        return {
          width: image.width,
          height: image.height,
          pixels: context.getImageData(0, 0, image.width, image.height).data
        };
      };
      const [a, b] = await Promise.all([decode(expected), decode(received)]);
      if (a.width !== b.width || a.height !== b.height) return Number.POSITIVE_INFINITY;
      let changed = 0;
      for (let i = 0; i < a.pixels.length; i += 4) {
        const pixel = i / 4;
        const x = pixel % a.width;
        const y = Math.floor(pixel / a.width);
        if (
          maskAreas.some(
            ([left, top, width, height]) =>
              x >= left && x < left + width && y >= top && y < top + height
          )
        )
          continue;
        const delta = Math.max(
          Math.abs(a.pixels[i]! - b.pixels[i]!),
          Math.abs(a.pixels[i + 1]! - b.pixels[i + 1]!),
          Math.abs(a.pixels[i + 2]! - b.pixels[i + 2]!)
        );
        if (delta > 24) changed++;
      }
      return changed;
    },
    { expected: source.toString('base64'), received: actual.toString('base64'), masks }
  );
  console.info(`${file} visual diff: ${difference}/${budget} changed pixels`);
  expect(
    difference,
    `${file}: per-screen changed-pixel budget ${budget}; actual ${difference}`
  ).toBeLessThanOrEqual(budget);
}

async function geometry(page: Page, expectedPending?: string) {
  const section = page.locator('main > section');
  const box = await section.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.abs(box!.x - 18)).toBeLessThanOrEqual(1);
  expect(Math.abs(box!.width - 354)).toBeLessThanOrEqual(1);
  if (expectedPending) {
    const card = page.getByRole('heading', { name: expectedPending }).locator('xpath=..');
    const cardBox = await card.boundingBox();
    expect(cardBox).not.toBeNull();
    expect(Math.abs(cardBox!.x - 18)).toBeLessThanOrEqual(1);
    expect(Math.abs(cardBox!.y - (box!.y + 91))).toBeLessThanOrEqual(1);
    expect(Math.abs(cardBox!.width - 354)).toBeLessThanOrEqual(1);
    expect(Math.abs(cardBox!.height - 200)).toBeLessThanOrEqual(1);
  }
}

async function memberCardGeometry(page: Page) {
  const cards = await page.getByTestId('community-member-card').all();
  expect(cards).toHaveLength(3);
  const boxes = await Promise.all(cards.map((card) => card.boundingBox()));
  for (const box of boxes) {
    expect(box).not.toBeNull();
    expect(Math.abs(box!.x - 18)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.width - 354)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.height - 70)).toBeLessThanOrEqual(1);
  }
  for (let index = 1; index < boxes.length; index++)
    expect(Math.abs(boxes[index]!.y - boxes[index - 1]!.y - 80)).toBeLessThanOrEqual(1);
}

async function memberControlsGeometry(page: Page) {
  for (const selector of ['community-member-profile', 'community-member-role-panel']) {
    const box = await page.getByTestId(selector).boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs(box!.x - 18)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.width - 354)).toBeLessThanOrEqual(1);
  }
  const profile = await page.getByTestId('community-member-profile').boundingBox();
  expect(profile).not.toBeNull();
  expect(Math.abs(profile!.height - 70)).toBeLessThanOrEqual(1);
  const actions = await page
    .getByRole('button', { name: en.communityAdmin.action.promote })
    .boundingBox();
  expect(actions).not.toBeNull();
  expect(Math.abs(actions!.height - 44)).toBeLessThanOrEqual(1);
}

async function settingsGeometry(page: Page) {
  for (const [selector, height] of [
    ['settings-visibility-label', 44],
    ['settings-visibility-control', 44],
    ['settings-join-policy-control', 44]
  ] as const) {
    const box = await page.getByTestId(selector).boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs(box!.x - 18)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.width - 354)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.height - height)).toBeLessThanOrEqual(1);
  }
}

async function venueGeometry(page: Page) {
  const card = await page.getByTestId('community-venue-card').boundingBox();
  expect(card).not.toBeNull();
  expect(Math.abs(card!.x - 18)).toBeLessThanOrEqual(1);
  expect(Math.abs(card!.width - 354)).toBeLessThanOrEqual(1);
  expect(Math.abs(card!.height - 114)).toBeLessThanOrEqual(1);
  const add = await page.getByRole('button', { name: en.communityAdmin.venue.add }).boundingBox();
  expect(add).not.toBeNull();
  expect(Math.abs(add!.height - 44)).toBeLessThanOrEqual(1);
}

async function auditGeometry(page: Page) {
  const cards = await page.getByTestId('community-audit-event').all();
  expect(cards).toHaveLength(3);
  const boxes = await Promise.all(cards.map((card) => card.boundingBox()));
  for (const box of boxes) {
    expect(box).not.toBeNull();
    expect(Math.abs(box!.x - 18)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.width - 354)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.height - 64)).toBeLessThanOrEqual(1);
  }
}

test('real admin requests, membership, settings, venues and audit stay protected and responsive', async ({
  browser,
  page
}) => {
  test.setTimeout(120_000);
  const owner = await createActor('Owner Admin');
  const request = await createActor('Pending Player');
  const backup = await createActor('Backup Admin');
  const created = await owner.client.rpc('create_community', {
    p_name: `Padel ${crypto.randomUUID().slice(0, 5)}`,
    p_visibility: 'public',
    p_join_policy: 'admin_approval'
  });
  if (created.error || typeof created.data !== 'string')
    throw created.error ?? new Error('Community fixture creation failed');
  const communityId = created.data;
  const joined = await request.client.rpc('join_public_community', { p_community_id: communityId });
  if (joined.error) throw joined.error;
  expect(joined.data).toMatchObject([{ status: 'pending' }]);
  const backupMembership = await owner.client
    .from('community_members')
    .insert({ community_id: communityId, user_id: backup.id, role: 'member', status: 'active' })
    .select('id')
    .single();
  if (backupMembership.error) throw backupMembership.error;
  const pending = await owner.client.rpc('search_community_members', {
    p_community_id: communityId,
    p_query: '',
    p_status: 'pending',
    p_offset: 0,
    p_limit: 50
  });
  if (pending.error || pending.data?.length !== 1)
    throw pending.error ?? new Error('Pending fixture rows missing');

  const guestContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1
  });
  const guest = await guestContext.newPage();
  await guest.goto(`/community/${communityId}/admin/audit`);
  await expect(guest).toHaveURL(/\/login\?next=/);
  await guestContext.close();

  await signIn(page, owner);
  const route = `/community/${communityId}/admin`;
  await page.goto(`${route}/requests`);
  await waitForHydratedPage(page);
  await expect(page.getByRole('heading', { name: en.communityAdmin.title.requests })).toBeVisible();
  await geometry(page, 'Pending Player');
  // Mask only unsupported resolved/notification content and fixture-dependent applicant values; keep card geometry exact.
  await visualDiff(page, 'RgqPq.png', 21_000, [
    [0, 309, 390, 147],
    [28, 124, 334, 20],
    [28, 151, 334, 36]
  ]);
  for (const name of ['Pending Player']) {
    const card = page.getByRole('heading', { name }).locator('xpath=..');
    await card.getByRole('button', { name: en.communityAdmin.action.approve }).click();
    await expect(page.getByText('Request approved.')).toBeVisible();
  }
  const rows = await owner.client.rpc('search_community_members', {
    p_community_id: communityId,
    p_query: '',
    p_offset: 0,
    p_limit: 50
  });
  if (rows.error || !rows.data) throw rows.error ?? new Error('Community roster unavailable');
  const roster: Database['public']['Functions']['search_community_members']['Returns'] = rows.data;
  const backupRow = roster.find((row) => row.user_id === backup.id);
  const requestRow = roster.find((row) => row.user_id === request.id);
  const ownerRow = roster.find((row) => row.user_id === owner.id);
  if (!backupRow || !requestRow || !ownerRow) throw new Error('Expected fixture member not found');

  await page.goto(`${route}/members`);
  await waitForHydratedPage(page);
  await page.getByRole('heading', { name: en.communityAdmin.title.members }).waitFor();
  await geometry(page);
  await memberCardGeometry(page);
  // Mask fixture names/metrics and unsupported invitation copy only; card/layout geometry remains exact.
  await visualDiff(page, 'wFqGR.png', 18_000, [
    [18, 46, 354, 22],
    [25, 82, 340, 26],
    [25, 136, 340, 26],
    [25, 242, 340, 24],
    [25, 267, 340, 20],
    [25, 288, 340, 20],
    [25, 322, 340, 24],
    [25, 347, 340, 20],
    [25, 368, 340, 20],
    [25, 402, 340, 24],
    [25, 427, 340, 20],
    [25, 448, 340, 20]
  ]);
  await page.getByRole('link', { name: 'Backup Admin' }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/members/${backupRow.membership_id}$`));
  await geometry(page);
  await memberControlsGeometry(page);
  // Mask only dynamic member identity/metrics and community name; card/action geometry stays probed.
  await visualDiff(page, 'jQDkx.png', 18_000, [
    [18, 46, 354, 22],
    [28, 124, 334, 20],
    [28, 145, 334, 20]
  ]);
  await page.getByRole('button', { name: en.communityAdmin.action.promote }).click();
  await expect(page.getByText('Admin role granted.')).toBeVisible();

  const memberContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const memberPage = await memberContext.newPage();
  await signIn(memberPage, request);
  await memberPage.goto(`${route}/members`);
  await expect(
    memberPage.getByRole('heading', { name: en.communityAdmin.accessDeniedTitle })
  ).toBeVisible();
  await memberContext.close();

  await page.goto(`${route}/settings`);
  await waitForHydratedPage(page);
  await geometry(page);
  await settingsGeometry(page);
  await visualDiff(page, 'N18Mu4.png', 19_000, [
    [18, 46, 354, 22],
    [18, 230, 354, 120]
  ]);
  await page.getByText(en.communityAdmin.settings.details).click();
  await page.getByLabel(en.communityAdmin.settings.city).fill('Madrid');
  await page.getByRole('button', { name: en.communityAdmin.save }).click();
  await expect(page.getByText('Community settings saved.')).toBeVisible();
  for (const [locale, copy] of [
    ['es', es],
    ['pt-BR', pt]
  ] as const) {
    await page.locator('#locale').selectOption(locale);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(
      page.getByRole('heading', { name: copy.communityAdmin.title.settings })
    ).toBeVisible();
  }
  await page.locator('#locale').selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.waitForLoadState('networkidle');
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  await page.goto(`${route}/venues`);
  await waitForHydratedPage(page);
  await geometry(page);
  await page.getByRole('button', { name: en.communityAdmin.venue.add }).click();
  await page.getByLabel(en.communityAdmin.venue.name).fill('North Court');
  await page.getByLabel(en.communityAdmin.venue.address).fill('Madrid');
  await page.getByLabel(en.communityAdmin.venue.mapsUrl).fill('https://maps.example.test/court');
  await page.getByRole('button', { name: en.communityAdmin.save }).click();
  await expect(page.getByRole('heading', { name: 'North Court' })).toBeVisible();
  await page.reload();
  await waitForHydratedPage(page);
  await venueGeometry(page);
  // The Pencil reference's second saved venue is a sample row with no fixture-backed counterpart.
  await visualDiff(page, 'A5Vio.png', 18_000, [[0, 248, 390, 120]]);
  await page.getByRole('button', { name: en.communityAdmin.venue.archive }).click();
  await expect(page.getByText('Venue archived.')).toBeVisible();

  await page.goto(`${route}/audit`);
  await waitForHydratedPage(page);
  await auditGeometry(page);
  await expect(page.getByText(/Community admin ·/).first()).toBeVisible();
  await expect(page.getByText(/League result corrected/)).toHaveCount(0);
  // Actor identity is intentionally a translated generic fallback; timestamps are fixture-dependent.
  await visualDiff(page, 'E5CS5K.png', 18_000, [
    [18, 140, 354, 24],
    [18, 210, 354, 24],
    [18, 280, 354, 24],
    [18, 317, 354, 48]
  ]);

  await page.goto(`${route}/members/${ownerRow.membership_id}`);
  await waitForHydratedPage(page);
  await page.getByRole('button', { name: en.communityAdmin.action.demote }).click();
  await page.getByRole('button', { name: en.communityAdmin.confirmAction }).click();
  await expect(
    page.getByRole('heading', { name: en.communityAdmin.accessDeniedTitle })
  ).toBeVisible();
  expect(requestRow.status).toBe('active');
});
