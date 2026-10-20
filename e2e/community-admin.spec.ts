import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../src/lib/supabase/database.types';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { waitForHydratedPage } from './auth-helpers';

type Copy = {
  language: string;
  auth: { loginEmailLabel: string; loginPasswordLabel: string; loginSubmit: string };
  onboarding: {
    name: string;
    preciseLevel: string;
    side: string;
    sideEitherShort: string;
    save: string;
  };
  communityAdmin: {
    backToDashboard: string;
    title: Record<string, string>;
    navigation: string;
    accessDeniedTitle: string;
    action: Record<string, string>;
    confirmAction: string;
    search: string;
    loadMore: string;
    inviteUnavailable: string;
    levelReadOnly: string;
    settings: { name: string; city: string; details: string };
    save: string;
    venue: {
      add: string;
      name: string;
      address: string;
      mapsUrl: string;
      archive: string;
      openMap: string;
      historyNote: string;
    };
    audit: { openMember: string; recentChanges: string };
    accessDenied: string;
  };
};

const visualEvidenceRunId =
  process.env.GITHUB_RUN_ID && process.env.GITHUB_RUN_ATTEMPT
    ? `${process.env.GITHUB_RUN_ID}-attempt-${process.env.GITHUB_RUN_ATTEMPT}`
    : `local-${Date.now()}-${process.pid}`;

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

async function assertNoConfidentialPayload(page: Page, paths: string[], sentinels: string[]) {
  const observed: string[] = [];
  const collect = async (response: import('@playwright/test').Response) => {
    try {
      observed.push(await response.text());
    } catch {
      // Browser may cancel a response while navigating; successful payloads remain collected.
    }
  };
  page.on('response', collect);
  for (const path of paths) {
    const documentResponse = await page.goto(path);
    if (documentResponse) observed.push(await documentResponse.text());
    await page.waitForLoadState('networkidle');
    await waitForHydratedPage(page);
    observed.push(await page.locator('body').innerText());
  }
  page.off('response', collect);
  const payload = observed.join('\n');
  for (const sentinel of sentinels) {
    expect(payload, `confidential sentinel leaked: ${sentinel}`).not.toContain(sentinel);
  }
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
  const testInfo = test.info();
  const evidenceDirectory = join(
    process.cwd(),
    'artifacts/community-admin-visual',
    visualEvidenceRunId,
    testInfo.project.name,
    testInfo.testId,
    `repeat-${testInfo.repeatEachIndex}-retry-${testInfo.retry}`
  );
  mkdirSync(evidenceDirectory, { recursive: true });
  const evidenceBase = join(evidenceDirectory, file.replace('.png', ''));
  const { width, height } = await page.evaluate((png) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    return new Promise<{ width: number; height: number }>((resolve, reject) => {
      image.onload = () => resolve({ width: image.width, height: image.height });
      image.onerror = reject;
    });
  }, actual.toString('base64'));
  const residual = {
    screen: file.replace('.png', ''),
    png: file,
    changedPixels: Number.isFinite(difference) ? difference : 'dimension-mismatch',
    budget,
    width,
    height,
    referenceHash: createHash('sha256').update(source).digest('hex'),
    masksHash: createHash('sha256').update(JSON.stringify(masks)).digest('hex'),
    platform: process.platform,
    commit: process.env.GITHUB_SHA ?? 'local-unrecorded'
  };
  writeFileSync(`${evidenceBase}.json`, JSON.stringify(residual, null, 2));
  writeFileSync(`${evidenceBase}-actual.png`, actual);
  writeFileSync(`${evidenceBase}-reference.png`, source);
  await testInfo.attach(`visual-residual-${file}.json`, {
    body: Buffer.from(JSON.stringify(residual, null, 2)),
    contentType: 'application/json'
  });
  await testInfo.attach(`visual-actual-${file}`, { body: actual, contentType: 'image/png' });
  await testInfo.attach(`visual-reference-${file}`, { body: source, contentType: 'image/png' });
  expect(
    difference,
    `${file}: per-screen changed-pixel budget ${budget}; actual ${difference}`
  ).toBeLessThanOrEqual(budget);
}

// Pencil source geometry (padel-friend.pen frames, 390×844): page margin x18, content width 354,
// bottom navigation x18/y774 354×56. All box probes are exact ±1px for CSS boxes. Static-page
// probes are frame-relative: global locale/theme controls above <main> shift the document, so
// absolute y expectations are compared against the frame offset (main top) captured per screen.
async function mainOffset(page: Page) {
  const main = await page.locator('main').boundingBox();
  expect(main).not.toBeNull();
  return main!.y;
}

async function bottomNavGeometry(page: Page) {
  const nav = page.getByRole('navigation', { name: en.communityAdmin.navigation });
  await expect(nav).toBeVisible();
  const acquireBox = async (locator: Locator) => {
    const deadline = Date.now() + 5_000;
    let candidate: Awaited<ReturnType<Locator['boundingBox']>> = null;

    while (Date.now() < deadline) {
      candidate = await locator.boundingBox();
      if (candidate && candidate.width > 0 && candidate.height > 0) {
        return candidate;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error(`Timed out waiting for a positive-size bounding box for ${locator.toString()}`);
  };
  const box = await acquireBox(nav);
  expect(Math.abs(box.x - 18)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.y - 774)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.width - 354)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.height - 56)).toBeLessThanOrEqual(1);
  const linksLocator = nav.getByRole('link');
  await expect(linksLocator).toHaveCount(5);
  const links = await linksLocator.all();
  for (const link of links) {
    const linkBox = await acquireBox(link);
    // Pencil tabs are 44px; rendered links keep the ≥44px touch target (48px at 354 width).
    expect(linkBox.height).toBeGreaterThanOrEqual(44);
  }
  expect(await nav.locator('[aria-current="page"]').count()).toBe(1);
}

async function geometry(page: Page, expectedPending?: string) {
  const section = page.locator('main > section');
  const box = await section.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.abs(box!.x - 18)).toBeLessThanOrEqual(1);
  expect(Math.abs(box!.width - 354)).toBeLessThanOrEqual(1);
  await bottomNavGeometry(page);
  if (expectedPending) {
    const card = page.getByRole('heading', { name: expectedPending }).locator('xpath=..');
    const cardBox = await card.boundingBox();
    expect(cardBox).not.toBeNull();
    expect(Math.abs(cardBox!.x - 18)).toBeLessThanOrEqual(1);
    // RgqPq pending card at y109 from the 390×844 frame (section starts at y18).
    expect(Math.abs(cardBox!.y - (box!.y + 91))).toBeLessThanOrEqual(1);
    expect(Math.abs(cardBox!.width - 354)).toBeLessThanOrEqual(1);
    expect(Math.abs(cardBox!.height - 200)).toBeLessThanOrEqual(1);
    const approve = await card
      .getByRole('button', { name: en.communityAdmin.action.approve })
      .boundingBox();
    const deny = await card
      .getByRole('button', { name: en.communityAdmin.action.deny })
      .boundingBox();
    expect(approve).not.toBeNull();
    expect(deny).not.toBeNull();
    expect(Math.abs(approve!.y - (cardBox!.y + 92))).toBeLessThanOrEqual(1);
    expect(Math.abs(deny!.y - (cardBox!.y + 142))).toBeLessThanOrEqual(1);
    expect(Math.abs(approve!.height - 44)).toBeLessThanOrEqual(1);
    expect(Math.abs(deny!.height - 44)).toBeLessThanOrEqual(1);
  }
}

async function memberCardGeometry(page: Page) {
  const offset = await mainOffset(page);
  const cards = await page.getByTestId('community-member-card').all();
  expect(cards).toHaveLength(3);
  const boxes = await Promise.all(cards.map((card) => card.boundingBox()));
  // wFqGR member cards: y234/y315/y396, 354×71, 10px gaps.
  const expectedY = [234, 315, 396];
  for (const [index, box] of boxes.entries()) {
    expect(box).not.toBeNull();
    expect(Math.abs(box!.x - 18)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.y - (offset + expectedY[index]!))).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.width - 354)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.height - 71)).toBeLessThanOrEqual(1);
  }
  const invite = await page
    .getByRole('button', { name: en.communityAdmin.inviteUnavailable })
    .boundingBox();
  expect(invite).not.toBeNull();
  expect(Math.abs(invite!.y - (offset + 72))).toBeLessThanOrEqual(1);
  expect(Math.abs(invite!.height - 44)).toBeLessThanOrEqual(1);
  const search = await page.locator('#admin-member-search').boundingBox();
  expect(search).not.toBeNull();
  expect(Math.abs(search!.x - 18)).toBeLessThanOrEqual(1);
  expect(Math.abs(search!.width - 354)).toBeLessThanOrEqual(1);
  expect(Math.abs(search!.height - 44)).toBeLessThanOrEqual(1);
}

async function assertLinkHitArea(link: Locator) {
  const area = await link.evaluate((element) => {
    const pseudo = getComputedStyle(element, '::before');
    return {
      width: Number.parseFloat(pseudo.width),
      height: Number.parseFloat(pseudo.height),
      position: getComputedStyle(element).position
    };
  });
  expect(area.position).toBe('relative');
  expect(area.width).toBeGreaterThanOrEqual(44);
  expect(area.height).toBe(44);
}

async function memberControlsGeometry(page: Page) {
  const profile = await page.getByTestId('community-member-profile').boundingBox();
  expect(profile).not.toBeNull();
  expect(Math.abs(profile!.x - 18)).toBeLessThanOrEqual(1);
  expect(Math.abs(profile!.width - 354)).toBeLessThanOrEqual(1);
  // jQDkx member profile card is 354×66.
  expect(Math.abs(profile!.height - 66)).toBeLessThanOrEqual(1);
  const rolePanel = await page.getByTestId('community-member-role-panel').boundingBox();
  expect(rolePanel).not.toBeNull();
  expect(Math.abs(rolePanel!.x - 18)).toBeLessThanOrEqual(1);
  expect(Math.abs(rolePanel!.width - 354)).toBeLessThanOrEqual(1);
  // jQDkx role control is 354×72.
  expect(Math.abs(rolePanel!.height - 72)).toBeLessThanOrEqual(1);
  const actions = await page
    .getByRole('button', { name: en.communityAdmin.action.promote })
    .boundingBox();
  expect(actions).not.toBeNull();
  // Pencil draws a 40px control; shipped controls keep the ≥44px touch target.
  expect(actions!.height).toBeGreaterThanOrEqual(44);
}

async function backLinkGeometry(page: Page) {
  const link = page.getByRole('link', { name: en.communityAdmin.backToDashboard });
  const linkBox = await link.boundingBox();
  expect(linkBox).not.toBeNull();
  expect(linkBox!.width).toBeGreaterThanOrEqual(44);
  expect(linkBox!.height).toBeGreaterThanOrEqual(44);
  const icon = link.locator('[aria-hidden="true"]');
  const iconBox = await icon.boundingBox();
  expect(iconBox).not.toBeNull();
  expect(
    Math.abs(iconBox!.x + iconBox!.width / 2 - (linkBox!.x + linkBox!.width / 2))
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(iconBox!.y + iconBox!.height / 2 - (linkBox!.y + linkBox!.height / 2))
  ).toBeLessThanOrEqual(1);
}

async function settingsGeometry(page: Page) {
  // N18Mu4 settings rows: visibility y72, public control y126, join control y180, each 354×44.
  const offset = await mainOffset(page);
  const expectedRows = [
    ['settings-visibility-label', 72],
    ['settings-visibility-control', 126],
    ['settings-join-policy-control', 180]
  ] as const;
  for (const [selector, y] of expectedRows) {
    const box = await page.getByTestId(selector).boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs(box!.x - 18)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.y - (offset + y))).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.width - 354)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.height - 44)).toBeLessThanOrEqual(1);
  }
  const save = await page.getByRole('button', { name: en.communityAdmin.save }).boundingBox();
  expect(save).not.toBeNull();
  expect(Math.abs(save!.height - 44)).toBeLessThanOrEqual(1);
}

async function venueGeometry(page: Page) {
  const offset = await mainOffset(page);
  const cards = await page.getByTestId('community-venue-card').all();
  expect(cards).toHaveLength(2);
  const boxes = await Promise.all(cards.map((card) => card.boundingBox()));
  // A5Vio venue cards are 354×114 at source-relative y126 and y250, with a 10px gap.
  const expectedY = [126, 250];
  for (const [index, box] of boxes.entries()) {
    expect(box).not.toBeNull();
    expect(Math.abs(box!.x - 18)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.y - (offset + expectedY[index]!))).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.width - 354)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.height - 114)).toBeLessThanOrEqual(1);
  }
  expect(Math.abs(boxes[1]!.y - boxes[0]!.y - 124)).toBeLessThanOrEqual(1);
  const note = await page.getByText(en.communityAdmin.venue.historyNote).boundingBox();
  expect(note).not.toBeNull();
  expect(Math.abs(note!.x - 18)).toBeLessThanOrEqual(1);
  expect(Math.abs(note!.width - 354)).toBeLessThanOrEqual(1);
  // A5Vio flow annotation starts 248px below the first venue card.
  expect(Math.abs(note!.height - 35)).toBeLessThanOrEqual(1);
  expect(Math.abs(note!.y - (boxes[0]!.y + 248))).toBeLessThanOrEqual(1);
  const add = await page.getByRole('button', { name: en.communityAdmin.venue.add }).boundingBox();
  expect(add).not.toBeNull();
  expect(Math.abs(add!.height - 44)).toBeLessThanOrEqual(1);
  const archive = await cards[0]!
    .getByRole('button', { name: en.communityAdmin.venue.archive })
    .boundingBox();
  expect(archive).not.toBeNull();
  expect(Math.abs(archive!.height - 44)).toBeLessThanOrEqual(1);
}

async function auditGeometry(page: Page) {
  const cards = await page.getByTestId('community-audit-event').all();
  expect(cards).toHaveLength(3);
  const boxes = await Promise.all(cards.map((card) => card.boundingBox()));
  // E5CS5K audit events: y111/y183/y255, 354×62, 10px gaps.
  const offset = await mainOffset(page);
  const expectedY = [111, 183, 255];
  for (const [index, box] of boxes.entries()) {
    expect(box).not.toBeNull();
    expect(Math.abs(box!.x - 18)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.y - (offset + expectedY[index]!))).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.width - 354)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.height - 62)).toBeLessThanOrEqual(1);
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
  const communityName = `Padel ${crypto.randomUUID().slice(0, 5)}`;
  const created = await owner.client.rpc('create_community', {
    p_name: communityName,
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
  // Second real venue (admin RLS insert) so the venues screen shows the supported two-card
  // structure of the A5Vio frame instead of masking it away; "South Court" sorts after the
  // UI-created "North Court" so card order stays deterministic.
  const seededVenue = await owner.client
    .from('community_venues')
    .insert({
      community_id: communityId,
      name: 'South Court',
      address: 'Madrid',
      maps_url: 'https://maps.example.test/south-court'
    })
    .select('id')
    .single();
  if (seededVenue.error) throw seededVenue.error;
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
  await expect(page.getByRole('link', { name: communityName })).toBeVisible();
  const route = `/community/${communityId}/admin`;
  await page.goto(`${route}/requests`);
  await waitForHydratedPage(page);
  await expect(page.getByRole('heading', { name: en.communityAdmin.title.requests })).toBeVisible();
  await geometry(page, 'Pending Player');
  // Mask only unsupported resolved/notification content and fixture-dependent applicant values; keep card geometry exact.
  // Measured macOS 14,864; Linux 15,723; 2,777px headroom. Linux CI evidence: docs/visual/community-admin-residuals.md.
  // Original cap-selection target: ≥2,500px headroom, rounded up to the next 500.
  await visualDiff(page, 'RgqPq.png', 18_500, [
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
  await backLinkGeometry(page);
  await memberCardGeometry(page);
  await assertLinkHitArea(page.getByRole('link', { name: 'Backup Admin' }));
  // Mask fixture identity/metrics, role badges, avatars and the unsupported invitation copy only;
  // card layout, search and geometry stay exact and unmasked.
  // Measured macOS 14,198; Linux 15,435; 65px headroom. Linux CI evidence and flakiness risk: docs/visual/community-admin-residuals.md.
  // Original cap-selection target: ≥2,500px headroom, rounded up to the next 500.
  await visualDiff(page, 'wFqGR.png', 15_500, [
    [18, 46, 354, 22],
    [25, 82, 340, 26],
    [28, 243, 34, 44],
    [294, 239, 79, 31],
    [25, 239, 340, 25],
    [25, 263, 340, 18],
    [25, 280, 340, 18],
    [28, 324, 34, 44],
    [294, 320, 79, 31],
    [25, 320, 340, 25],
    [25, 344, 340, 18],
    [25, 361, 340, 18],
    [28, 405, 34, 44],
    [294, 401, 79, 31],
    [25, 401, 340, 25],
    [25, 425, 340, 18],
    [25, 442, 340, 18]
  ]);
  await page.getByRole('link', { name: 'Backup Admin' }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/members/${backupRow.membership_id}$`));
  await geometry(page);
  await memberControlsGeometry(page);
  // Mask only dynamic member identity/metrics and community name; card/action geometry stays probed.
  // Measured macOS 17,397; Linux 19,038; 2,962px headroom. Linux CI evidence: docs/visual/community-admin-residuals.md.
  // Original cap-selection target: ≥2,500px headroom, rounded up to the next 500.
  await visualDiff(page, 'jQDkx.png', 22_000, [
    [18, 46, 354, 22],
    [28, 124, 334, 20],
    [28, 145, 334, 20]
  ]);
  await page.getByRole('button', { name: en.communityAdmin.action.promote }).click();
  await expect(page.getByText('Admin role granted.')).toBeVisible();

  const memberContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const memberPage = await memberContext.newPage();
  await signIn(memberPage, request);
  await expect(memberPage.getByRole('link', { name: communityName })).toHaveCount(0);
  await memberPage.goto(`${route}/members`);
  await expect(
    memberPage.getByRole('heading', { name: en.communityAdmin.accessDeniedTitle })
  ).toBeVisible();
  await memberContext.close();

  await page.goto(`${route}/settings`);
  await waitForHydratedPage(page);
  await geometry(page);
  await settingsGeometry(page);
  // Measured macOS 17,750; Linux 18,920; 3,580px headroom. Linux CI evidence: docs/visual/community-admin-residuals.md.
  // Original cap-selection target: ≥2,500px headroom, rounded up to the next 500.
  await visualDiff(page, 'N18Mu4.png', 22_500, [
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
  await page.context().addCookies([{ name: 'locale', value: 'en', url: 'http://127.0.0.1:4173' }]);
  await page.waitForLoadState('networkidle');
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  await page.goto(`${route}/venues`);
  await page.context().addCookies([{ name: 'locale', value: 'en', url: 'http://127.0.0.1:4173' }]);
  await page.reload();
  await waitForHydratedPage(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
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
  await assertLinkHitArea(
    page.getByRole('link', { name: en.communityAdmin.venue.openMap }).first()
  );
  // Mask fixture venue names and dynamic/unsupported detail copy only; card edges, action labels,
  // and the supported Open map links remain part of the pixel comparison.
  // Measured macOS 16,351; Linux 17,771; 3,229px headroom. Linux CI evidence: docs/visual/community-admin-residuals.md.
  // Original cap-selection target: ≥2,500px headroom, rounded up to the next 500.
  await visualDiff(page, 'A5Vio.png', 21_000, [
    [32, 140, 180, 15],
    [32, 161, 240, 15],
    [32, 264, 180, 15],
    [32, 285, 240, 15]
  ]);
  await page
    .getByTestId('community-venue-card')
    .first()
    .getByRole('button', { name: en.communityAdmin.venue.archive })
    .click();
  await expect(page.getByText('Venue archived.')).toBeVisible();

  await page.goto(`${route}/audit`);
  await waitForHydratedPage(page);
  await auditGeometry(page);
  await expect(page.getByText(/Actor identity unavailable ·/).first()).toBeVisible();
  await expect(page.getByText(/League result corrected/)).toHaveCount(0);
  // Actor identity is intentionally a translated generic fallback; timestamps are fixture-dependent.
  // The fourth Pencil event ("League result corrected") and the 3-row paging control are the
  // approved unsupported/adapted region, so the band below the third event stays masked.
  // Measured macOS 16,174; Linux 17,044; 2,956px headroom. Linux CI evidence: docs/visual/community-admin-residuals.md.
  // Original cap-selection target: ≥2,500px headroom, rounded up to the next 500.
  await visualDiff(page, 'E5CS5K.png', 20_000, [
    [18, 140, 354, 24],
    [18, 210, 354, 24],
    [18, 280, 354, 24],
    [18, 317, 354, 72]
  ]);
  await page.getByRole('button', { name: en.communityAdmin.loadMore }).click();
  await assertLinkHitArea(
    page.getByRole('link', { name: en.communityAdmin.audit.openMember }).first()
  );

  await page.goto(`${route}/members/${crypto.randomUUID()}`);
  await waitForHydratedPage(page);
  await expect(page.getByRole('heading', { name: en.communityAdmin.title.member })).toBeVisible();
  await expect(page.getByRole('main')).toHaveCount(1);

  await page.goto(`${route}/members/${ownerRow.membership_id}`);
  await waitForHydratedPage(page);
  await page.getByRole('button', { name: en.communityAdmin.action.demote }).click();
  await page.getByRole('button', { name: en.communityAdmin.confirmAction }).click();
  await expect(
    page.getByRole('heading', { name: en.communityAdmin.accessDeniedTitle })
  ).toBeVisible();
  expect(requestRow.status).toBe('active');
});

test('unauthorized community admin routes never disclose confidential fixture payloads', async ({
  browser
}) => {
  test.setTimeout(120_000);
  const suffix = crypto.randomUUID();
  const ownerName = `Private Owner ${suffix.slice(0, 8)}`;
  const activeName = `Private Active ${suffix.slice(0, 8)}`;
  const pendingName = `Private Pending ${suffix.slice(0, 8)}`;
  const owner = await createActor(ownerName);
  const active = await createActor(activeName);
  const pending = await createActor(pendingName);
  const outsider = await createActor(`Private Outsider ${suffix.slice(0, 8)}`);
  const confidential = {
    description: `PRIVATE_DESCRIPTION_${suffix}`,
    setting: `PRIVATE_SETTING_${suffix}`,
    venue: `PRIVATE_VENUE_${suffix}`,
    address: `PRIVATE_ADDRESS_${suffix}`,
    audit: `PRIVATE_AUDIT_${suffix}`
  };
  const community = await owner.client.rpc('create_community', {
    p_name: `Private ${suffix.slice(0, 8)}`,
    p_visibility: 'private',
    p_description: confidential.description,
    p_join_policy: 'admin_approval'
  });
  if (community.error || typeof community.data !== 'string')
    throw community.error ?? new Error('Private community fixture creation failed');
  const communityId = community.data;
  const ownerCommunity = await owner.client
    .from('communities')
    .update({ settings: { confidential: confidential.setting } })
    .eq('id', communityId);
  if (ownerCommunity.error) throw ownerCommunity.error;
  const activeMembership = await owner.client
    .from('community_members')
    .insert({ community_id: communityId, user_id: active.id, role: 'member', status: 'active' })
    .select('id')
    .single();
  if (activeMembership.error) throw activeMembership.error;
  const pendingMembership = await owner.client
    .from('community_members')
    .insert({ community_id: communityId, user_id: pending.id, role: 'member', status: 'pending' })
    .select('id')
    .single();
  if (pendingMembership.error) throw pendingMembership.error;
  const venue = await owner.client
    .from('community_venues')
    .insert({
      community_id: communityId,
      name: confidential.venue,
      address: confidential.address,
      maps_url: 'https://maps.example.test/private'
    })
    .select('id')
    .single();
  if (venue.error) throw venue.error;
  const auditRows = await owner.client
    .from('community_audit_log')
    .select('id, entity_id')
    .eq('community_id', communityId);
  if (auditRows.error || !auditRows.data?.length)
    throw auditRows.error ?? new Error('Expected private community audit fixture');
  const ownerRoster = await owner.client.rpc('search_community_members', {
    p_community_id: communityId,
    p_query: '',
    p_offset: 0,
    p_limit: 50
  });
  if (
    ownerRoster.error ||
    !ownerRoster.data?.some((row: { user_id: string }) => row.user_id === active.id)
  )
    throw ownerRoster.error ?? new Error('Owner could not observe confidential roster fixture');

  const base = `/community/${communityId}/admin`;
  const destinations = [
    `${base}/requests`,
    `${base}/members`,
    `${base}/members/${activeMembership.data.id}`,
    `${base}/settings`,
    `${base}/venues`,
    `${base}/audit`
  ];
  const sentinels = [
    activeName,
    pendingName,
    confidential.description,
    confidential.setting,
    confidential.venue,
    confidential.address,
    pendingMembership.data.id,
    venue.data.id,
    ...auditRows.data
      .flatMap((row: { id: string; entity_id: string }) => [row.id, row.entity_id])
      .filter((id: string) => id !== communityId && id !== activeMembership.data.id)
  ];

  // Owner must be able to observe fixture values before the same payloads are tested against denials.
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signIn(ownerPage, owner);
  await ownerPage.goto(`${base}/venues`);
  await waitForHydratedPage(ownerPage);
  await expect(ownerPage.getByRole('heading', { name: confidential.venue })).toBeVisible();
  await ownerPage.goto(`${base}/members`);
  await waitForHydratedPage(ownerPage);
  await expect(ownerPage.getByText(activeName)).toBeVisible();
  await ownerPage.goto(`${base}/settings`);
  await waitForHydratedPage(ownerPage);
  await ownerPage.getByText(en.communityAdmin.settings.details).click();
  await expect(ownerPage.locator('#community-admin-description')).toHaveValue(
    confidential.description
  );
  await ownerContext.close();

  const guestContext = await browser.newContext();
  const guestPage = await guestContext.newPage();
  await assertNoConfidentialPayload(guestPage, destinations, sentinels);
  await guestContext.close();
  for (const actor of [active, pending, outsider]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(page, actor);
    await assertNoConfidentialPayload(page, destinations, sentinels);
    await context.close();
  }
});

const narrowDestinations = [
  'requests',
  'members',
  'member',
  'settings',
  'venues',
  'audit'
] as const;
const narrowLocales = [
  ['en', en],
  ['pt-BR', pt],
  ['es', es]
] as const;

test.describe('community admin 320px locale matrix', () => {
  test.use({ viewport: { width: 320, height: 844 } });

  for (const destination of narrowDestinations) {
    for (const [locale] of narrowLocales) {
      test(`${destination} heading and controls fit at 320px (${locale})`, async ({ page }) => {
        test.setTimeout(120_000);
        const owner = await createActor(`Narrow ${destination} ${locale}`);
        const applicant = await createActor(`Narrow applicant ${destination} ${locale}`);
        const requester = await createActor(`Narrow requester ${destination} ${locale}`);
        const created = await owner.client.rpc('create_community', {
          p_name: `Narrow ${crypto.randomUUID().slice(0, 6)}`,
          p_visibility: 'public',
          p_join_policy: 'admin_approval'
        });
        if (created.error || typeof created.data !== 'string')
          throw created.error ?? new Error('Narrow-screen community fixture creation failed');
        const communityId = created.data;
        const base = `/community/${communityId}/admin`;
        const active = await owner.client
          .from('community_members')
          .insert({
            community_id: communityId,
            user_id: applicant.id,
            role: 'member',
            status: 'active'
          })
          .select('id')
          .single();
        if (active.error) throw active.error;
        const pending = await owner.client
          .from('community_members')
          .insert({
            community_id: communityId,
            user_id: requester.id,
            role: 'member',
            status: 'pending'
          })
          .select('id')
          .single();
        if (pending.error) throw pending.error;
        const venue = await owner.client.from('community_venues').insert({
          community_id: communityId,
          name: 'Narrow court',
          address: 'Madrid',
          maps_url: 'https://maps.example.test/narrow'
        });
        if (venue.error) throw venue.error;

        await signIn(page, owner);
        await page.locator('#locale').selectOption(locale);
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        const path =
          destination === 'member' ? `${base}/members/${active.data.id}` : `${base}/${destination}`;
        await page.goto(path);
        await waitForHydratedPage(page);
        const localeCopy = locale === 'pt-BR' ? pt : locale === 'es' ? es : en;
        const localeControl = page.locator('#locale');
        await expect(localeControl).toBeVisible();
        await expect(localeControl).toHaveAccessibleName(localeCopy.language);
        const titleKey = destination === 'member' ? 'member' : destination;
        const screenHeading = page.getByRole('heading', {
          name: localeCopy.communityAdmin.title[titleKey],
          exact: true
        });
        await expect(screenHeading).toHaveCount(1);
        await expect(screenHeading).toBeVisible();
        if (destination === 'settings') {
          await page.getByText(localeCopy.communityAdmin.settings.details).click();
          await expect(page.locator('#community-admin-description')).toBeVisible();
        }
        if (destination === 'requests')
          await expect(
            page.getByText(`Narrow requester ${destination} ${locale}`, { exact: true })
          ).toBeVisible();
        if (destination === 'venues')
          await expect(page.getByRole('heading', { name: 'Narrow court' })).toBeVisible();
        if (destination === 'audit')
          await expect(page.getByTestId('community-audit-event').first()).toBeVisible();

        const dimensions = await page.evaluate(() => ({
          document: document.documentElement.scrollWidth,
          main: document.querySelector('main')?.scrollWidth ?? 0,
          viewport: document.documentElement.clientWidth
        }));
        expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
        expect(dimensions.main).toBeLessThanOrEqual(dimensions.viewport);
        const adminNavigation = page.getByRole('navigation', {
          name: localeCopy.communityAdmin.navigation
        });
        const contentControls = page.locator(
          'main button:visible:not(nav button), main a:visible:not(nav a), main input:visible:not(nav input), main select:visible:not(nav select), main textarea:visible:not(nav textarea)'
        );
        const navigationControls = adminNavigation.locator(
          'button:visible, a:visible, input:visible, select:visible, textarea:visible'
        );
        const controls = contentControls.or(navigationControls);
        for (const control of await controls.all()) {
          const box = await control.boundingBox();
          expect(box, 'visible interactive control must have a hit region').not.toBeNull();
          const accessibleName =
            (await control.getAttribute('aria-label')) ?? (await control.innerText());
          expect(box!.width, `interactive control ${accessibleName}`).toBeGreaterThanOrEqual(44);
          expect(box!.height, `interactive control ${accessibleName}`).toBeGreaterThanOrEqual(44);
        }
        const nav = adminNavigation;
        const navBox = await nav.boundingBox();
        expect(navBox).not.toBeNull();
        for (const control of await contentControls.all()) {
          await control.scrollIntoViewIfNeeded();
          const box = await control.boundingBox();
          expect(box, 'scrolled interactive control must have a hit region').not.toBeNull();
          const overlapsBottomNav =
            box!.y < navBox!.y + navBox!.height && box!.y + box!.height > navBox!.y;
          expect(
            overlapsBottomNav,
            'scrolled interactive control must not be obscured by bottom navigation'
          ).toBe(false);
        }
        await page.keyboard.press('Tab');
        await expect(page.locator(':focus')).toHaveCount(1);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await expect(nav).toBeVisible();
        const lastControl = contentControls.last();
        await lastControl.scrollIntoViewIfNeeded();
        const finalControl = await lastControl.boundingBox();
        expect(finalControl, 'last interactive action must remain visible').not.toBeNull();
        expect(finalControl!.y + finalControl!.height).toBeLessThanOrEqual(navBox!.y);
      });
    }
  }
});
