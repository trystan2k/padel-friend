import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { requireTestEnv, TEST_API_PORT, TEST_REPO_ROOT } from '../scripts/test-stack-env.mjs';
import {
  sweepPrivacyRequestsOnSchedule,
  type PrivacyProcessorHooks
} from '../src/features/privacy-requests/privacy-processor.server';
import { parseResultProposals } from '../src/features/matches/match-result-model';
import type { AdminClient } from '../src/lib/supabase/admin.server';
import { waitForHydratedPage } from './auth-helpers';
import { day, leagueFixtures } from './leagues-fixtures';
import { copies, en, fill, sql, type Actor } from './matches-management-fixtures';

// PAF-235: browser-level proof of the account-deletion workflow on isolated data. Real entry points
// only: the in-app UI, the real operator script (node scripts/privacy-operator.mjs, the exact file
// pnpm privacy:operator runs) and the real worker processor (sweepPrivacyRequestsOnSchedule, the
// function the Worker cron calls). The preview Worker never runs the cron, so the spec invokes that
// same exported sweep from the test process with the TEST stack service-role client: no phase is
// short-circuited or faked. Trusted SQL is setup/inspection only. No external network: the spec
// asserts the pages only talk to the loopback origin. All users are fabricated @test.local actors.
const ad = en.accountDeletion;
const LOCALES = ['en', 'pt-BR', 'es'] as const;
const REFERENCE = /PR-[0-9A-F]{12}/;
const L = (value: string) => "'" + value.replaceAll("'", "''") + "'";

type Json = Record<string, unknown>;
function record(value: unknown): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Expected an object');
  return Object.fromEntries(Object.entries(value));
}
const text = (value: unknown) => (typeof value === 'string' ? value : '');

// ---------------------------------------------------------------- isolated transport fixture
const tuple = () => requireTestEnv();
const serviceClient = () => {
  const env = tuple();
  return createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
};
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the untyped service-role client is the processor's admin client
const adminClient = () => serviceClient() as unknown as AdminClient;

/** Real operator script, TEST-stack env only (the script itself refuses any non-local project). */
function operatorCli(args: string[], env?: Record<string, string>) {
  const target = tuple();
  const childEnv = env ?? {
    PATH: process.env.PATH ?? '',
    SUPABASE_URL: target.VITE_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: target.SUPABASE_SERVICE_ROLE_KEY
  };
  return new Promise<{ code: number | null; out: string; err: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/privacy-operator.mjs', ...args], {
      cwd: TEST_REPO_ROOT,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString()));
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, out, err }));
  });
}

async function operator(...args: string[]) {
  const result = await operatorCli(args);
  expect(result.code, 'operator exit code (' + args[0] + ')').toBe(0);
  return record(JSON.parse(result.out));
}

/** Runs the real worker sweep against the TEST stack (the production entry the cron calls). */
const sweep = (client: AdminClient = adminClient(), hooks?: PrivacyProcessorHooks) =>
  sweepPrivacyRequestsOnSchedule({
    client,
    env: {},
    projectRef: 'local',
    maxCases: 3,
    ...(hooks ? { hooks } : {})
  });

/** Admin client whose Storage removal fails (provider outage); everything else is the real client. */
function outageAdmin(): AdminClient {
  const real = serviceClient();
  const wrapper = {
    rpc: real.rpc.bind(real),
    storage: {
      from: () => ({
        remove: () => Promise.resolve({ data: null, error: { message: 'outage' } })
      })
    },
    auth: { admin: real.auth.admin }
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrow double: only the calls the processor makes
  return wrapper as unknown as AdminClient;
}

async function caseRow(reference: string) {
  const [row] = await sql(
    'select state::text as state, resume_state::text as resume_state, last_phase::text as last_phase, ' +
      'blocker_code, next_action, armed_consumed_at is not null as consumed, outcome::text as outcome ' +
      'from privacy_internal.privacy_cases where reference = ' +
      L(reference)
  );
  return record(row);
}

async function scalar(query: string) {
  const [row] = await sql(query);
  return row ? Object.values(row)[0] : undefined;
}

const authUsers = async (who: Actor) =>
  Number(await scalar('select count(*)::int from auth.users where id = ' + L(who.id)));
const profiles = async (who: Actor) =>
  Number(
    await scalar('select count(*)::int from public.player_profiles where user_id = ' + L(who.id))
  );

/** Operator verification: challenge, the "mail" (address printed to the console), then proof. */
async function verifyCase(reference: string, expectedEmail: string) {
  const started = await operator('start-verification', reference);
  expect(started['status']).toBe('ok');
  expect(started['address']).toBe(expectedEmail.toLowerCase());
  const code = text(started['code']);
  expect(code).toMatch(/^[A-Z2-9]{10}$/);
  // Only the digest is stored: the stored column never contains the code itself.
  const stored = await scalar(
    'select challenge_digest is not null and challenge_digest::text not ilike ' +
      L('%' + code + '%') +
      ' from privacy_internal.privacy_cases where reference = ' +
      L(reference)
  );
  expect(stored).toBe(true);
  // A wrong code and a missing operator confirmation are both refused without consuming the case.
  const wrong = await operator('confirm-proof', reference, '--code', 'WRONGCODE2', '--confirm');
  expect(wrong).toMatchObject({ status: 'rejected', code: 'CHALLENGE_INVALID' });
  const unconfirmed = await operator('confirm-proof', reference, '--code', code);
  expect(unconfirmed).toMatchObject({ status: 'rejected', code: 'OPERATOR_CONFIRMATION_REQUIRED' });
  const confirmed = await operator('confirm-proof', reference, '--code', code, '--confirm');
  expect(confirmed).toMatchObject({ status: 'ok', state: 'verified' });
  // The challenge is single-use.
  const replay = await operator('confirm-proof', reference, '--code', code, '--confirm');
  expect(replay['status']).toBe('rejected');
}

async function dryRun(reference: string) {
  const result = await operator('dry-run', reference);
  expect(result['status']).toBe('ok');
  const plan = record(result['plan']);
  expect(plan['blockers']).toEqual([]);
  expect(plan['fingerprint']).toBeTruthy();
  expect(record(plan['impact'])).toBeTruthy();
  return result;
}

const armed = (reference: string, dry: Json) =>
  operator('arm', reference, '--plan', JSON.stringify(dry));

// ------------------------------------------------------------------------- browser helpers
/** Records every request that leaves the loopback origin (no Resend/Google/Push/Cloudflare calls). */
function trackExternal(context: BrowserContext): string[] {
  const external: string[] = [];
  context.on('request', (request) => {
    const { protocol, hostname } = new URL(request.url());
    if (!['http:', 'https:'].includes(protocol)) return;
    if (!['127.0.0.1', 'localhost'].includes(hostname)) external.push(hostname);
  });
  return external;
}

async function visit(page: Page, path: string) {
  await page.goto(path);
  await waitForHydratedPage(page);
}

async function requestDeletion(page: Page) {
  await page.getByRole('button', { name: ad.intro.start }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: ad.dialog.confirm }).click();
  await expect(page.getByRole('heading', { name: ad.state.received, level: 2 })).toBeVisible();
  const reference = (await page.getByText(REFERENCE).first().textContent())?.match(REFERENCE)?.[0];
  if (!reference) throw new Error('No reference shown');
  return reference;
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

// ------------------------------------------------------------------------------ the fixture
test.use({ serviceWorkers: 'block' });
test.describe.configure({ mode: 'serial' });

let f: Awaited<ReturnType<typeof leagueFixtures>>;
let eventId: string;
let leagueId: string;
const players = () => [f.creator, f.members[0]!, f.members[1]!, f.members[2]!];
// Roles: viewer survives and reads shared history; A is erased (happy path); B withdraws, is refused
// after the claim, hits a provider outage and is retried; C is blocked; D stays idle for dialog UX.
const VIEWER = () => f.members[0]!;
const SUBJECT_A = () => f.members[2]!;
const SUBJECT_B = () => f.members[3]!;
const SUBJECT_C = () => f.members[4]!;
const SUBJECT_D = () => f.members[5]!;

const NAMES = [
  'Privacy Viewer',
  'Privacy Pal',
  'Erased Player A',
  'Privacy Withdrawer',
  'Privacy Blocked',
  'Privacy Idle'
];

async function uploadAvatar(who: Actor) {
  const path = who.id + '/' + crypto.randomUUID() + '.png';
  const uploaded = await serviceClient()
    .storage.from('player-avatars')
    .upload(path, new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]), {
      contentType: 'image/png'
    });
  if (uploaded.error) throw new Error('fixture avatar upload failed');
  await sql(
    'update public.player_profiles set avatar_url = ' + L(path) + ' where user_id = ' + L(who.id)
  );
  return path;
}

const avatarObjects = async (who: Actor) =>
  Number(
    await scalar(
      "select count(*)::int from storage.objects where bucket_id = 'player-avatars' and name like " +
        L(who.id + '/%')
    )
  );

async function playRankedMatch() {
  leagueId = await f.createLeague(f.creator, {
    name: 'Privacy League',
    endMode: 'manual',
    start: day(0),
    minimum: 1
  });
  await sql(
    'do $$ begin ' +
      "update public.leagues set start_at=now()-interval '10 days' where id=" +
      L(leagueId) +
      '; alter table public.community_members disable trigger community_member_guard; ' +
      "update public.community_members set valid_from=now()-interval '10 days', activated_at=now()-interval '10 days' where community_id=" +
      L(f.community) +
      '; alter table public.community_members enable trigger community_member_guard; end $$;'
  );
  const [league] = await sql(
    'select version, status::text as status from public.leagues where id=' + L(leagueId)
  );
  if (league?.status !== 'active')
    await f.rpc(f.creator, 'activate_league', {
      p_league_id: leagueId,
      p_expected_version: league?.version
    });
  eventId = await f.publish(f.creator, {
    competition: 'ranked',
    leagueId,
    date: day(1),
    venue: 'Privacy E2E court'
  });
  for (const player of players().slice(1))
    await f.rpc(player, 'submit_match_registration', { p_match_event_id: eventId });
  await f.cutoff(eventId);
  await sql(
    'do $$ begin ' +
      'alter table public.match_events disable trigger match_event_immutable; ' +
      'alter table public.match_events disable trigger match_event_league_binding; ' +
      "update public.match_events set starts_at=now()-interval '3 hours', registration_cutoff_at=now()-interval '4 hours' where id=" +
      L(eventId) +
      '; alter table public.match_events enable trigger match_event_league_binding; ' +
      'alter table public.match_events enable trigger match_event_immutable; end $$;'
  );
  const played = new Date(Math.floor((Date.now() - 90 * 60_000) / 1000) * 1000);
  const iso = played.toISOString().replace('.000Z', 'Z');
  await f.rpc(f.creator, 'submit_match_event_result', {
    p_match_event_id: eventId,
    p_group_number: 1,
    p_teams: {
      team_a: [players()[0]!.id, players()[1]!.id],
      team_b: [players()[2]!.id, players()[3]!.id]
    },
    p_sets: [
      [6, 4],
      [6, 3]
    ].map(([a, b], index) => ({
      position: index + 1,
      team_a_games: a,
      team_b_games: b,
      completed: true
    })),
    p_played_local: { local: iso.slice(0, 19).replace('T', ' '), offset_seconds: 0, instant: iso },
    p_court_label: 'Court 1',
    p_request_id: crypto.randomUUID()
  });
  const [proposal] = await sql(
    'select id::text as id from public.match_event_result_proposals where group_number=1 and match_event_id=' +
      L(eventId)
  );
  await f.rpc(players()[2]!, 'review_match_event_result', {
    p_proposal_id: String(proposal?.['id']),
    p_expected_version: 1,
    p_decision: 'approve',
    p_request_id: crypto.randomUUID()
  });
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(420_000);
  // The production settle time between freeze and erasure is not part of these flows.
  await sql(
    "update privacy_internal.privacy_settings set value = '0' where key = 'freeze_quiescence_seconds'"
  );
  f = await leagueFixtures(browser, {
    creatorName: 'Privacy Host',
    memberNames: NAMES,
    memberCount: 6,
    communityName: 'Privacy Club'
  });
  // Shared history first: creator + viewer vs the pal and the soon-to-be-erased player A.
  await playRankedMatch();
  // Subject B joins a friendly match so it has a registration. (Known gap, reported with this unit: the
  // erasure seam only rebuilds statistics for communities of events the subject registered for, so a
  // league member with NO registration is blocked with RESIDUAL_REFERENCE by derived league positions.)
  const friendly = await f.publish(f.creator, {
    type: 'friendly',
    venue: 'Privacy friendly court'
  });
  await f.rpc(SUBJECT_B(), 'submit_match_registration', { p_match_event_id: friendly });
  await uploadAvatar(SUBJECT_A());
  await uploadAvatar(SUBJECT_B());
});

test.afterAll(async () => {
  test.setTimeout(120_000);
  // Erased users leave tombstone references that the generic community cleanup does not know; the
  // global-setup prune removes @test.local leftovers on the next run, so cleanup is best-effort.
  await f?.cleanup().catch(() => undefined);
});
test.beforeEach(() => {
  test.setTimeout(240_000);
});

// ================================================================================== tests
test('isolation: the transport is the TEST stack and the operator refuses everything else', async () => {
  const url = new URL(tuple().VITE_SUPABASE_URL);
  expect(url.hostname).toBe('127.0.0.1');
  expect(url.port).toBe(TEST_API_PORT);
  for (const actor of [f.creator, ...f.members]) expect(actor.email).toMatch(/@test\.local$/);

  const base = { PATH: process.env.PATH ?? '', SUPABASE_SERVICE_ROLE_KEY: 'unused-key' };
  const hosted = 'https://abcdefghijklmnop.supabase.co';
  // Default allowlist is 'local': a hosted project is refused before any client exists.
  const blocked = await operatorCli(['list'], { ...base, SUPABASE_URL: hosted });
  expect(blocked.code).toBe(1);
  expect(blocked.err.trim()).toBe('OPERATOR_PROJECT_NOT_ALLOWED');
  // Even allow-listed, production needs the explicit flag and then the evidence variable.
  const allowed = {
    ...base,
    SUPABASE_URL: hosted,
    PRIVACY_OPERATOR_ALLOWED_PROJECTS: 'abcdefghijklmnop'
  };
  const noFlag = await operatorCli(['list'], allowed);
  expect(noFlag.err.trim()).toBe('OPERATOR_PRODUCTION_FLAG_REQUIRED');
  const noEvidence = await operatorCli(['list', '--allow-production'], allowed);
  expect(noEvidence.err.trim()).toBe('OPERATOR_PRODUCTION_EVIDENCE_MISSING');
  // Missing service config fails closed.
  const noKey = await operatorCli(['list'], { PATH: process.env.PATH ?? '' });
  expect(noKey.err.trim()).toBe('OPERATOR_CONFIG_MISSING');
});

test('happy path: request, operator verification, armed worker erasure, history survives for another viewer', async () => {
  const subject = SUBJECT_A();
  const page = await f.page(subject, 'en', 390);
  const external = trackExternal(page.context());

  await test.step('profile entry opens the pane', async () => {
    await visit(page, '/me');
    await page.getByRole('link', { name: en.profile.links.accountDeletion }).click();
    await expect(page).toHaveURL(/\/account-deletion$/);
    await waitForHydratedPage(page);
    await expect(page.getByRole('heading', { name: ad.intro.heading })).toBeVisible();
  });

  let reference = '';
  await test.step('disclosure dialog states all four areas, then the receipt and live region', async () => {
    await page.getByRole('button', { name: ad.intro.start }).click();
    const dialog = page.getByRole('alertdialog', { name: ad.dialog.title });
    await expect(dialog).toBeVisible();
    for (const heading of [
      ad.dialog.disappears.title,
      ad.dialog.remains.title,
      ad.dialog.access.title,
      ad.dialog.cutoff.title
    ])
      await expect(dialog.getByRole('heading', { name: heading })).toBeVisible();
    await expect(dialog).toContainText(ad.dialog.access.body);
    await expect(dialog).toContainText(ad.dialog.cutoff.body);
    await dialog.getByRole('button', { name: ad.dialog.confirm }).click();
    await expect(page.getByRole('heading', { name: ad.state.received, level: 2 })).toBeVisible();
    reference =
      (await page.getByText(REFERENCE).first().textContent())?.match(REFERENCE)?.[0] ?? '';
    expect(reference).toMatch(REFERENCE);
    // Neutral receipt: the live region announces it; nothing is deleted yet.
    await expect(page.locator('main output[aria-live="polite"]')).toHaveText(
      fill(ad.announce.requested, { reference })
    );
    await expect(page.getByText(ad.detail.received)).toBeVisible();
    expect(await avatarObjects(subject)).toBe(1);
  });

  await test.step('operator: list, verify, dry-run, arm through the real script', async () => {
    const listed = await operatorCli(['list']);
    expect(listed.code).toBe(0);
    expect(listed.out).toContain(reference);
    expect(listed.out).not.toContain(subject.email);
    expect(listed.out).not.toContain(subject.id);
    // Not verified, so not plannable: a plan cannot skip verification.
    const early = await operator('dry-run', reference);
    expect(early).toMatchObject({ status: 'rejected', code: 'STATE_NOT_PLANNABLE' });
    await verifyCase(reference, subject.email);
    const dry = await dryRun(reference);
    expect(await armed(reference, dry)).toMatchObject({ status: 'ok', state: 'ready' });
    // Armed but not claimed: nothing is erased and the user can still withdraw.
    await page.getByRole('button', { name: ad.status.refresh }).click();
    await expect(page.getByRole('heading', { name: ad.state.ready, level: 2 })).toBeVisible();
    // The refreshed state is announced to screen readers through the polite live region.
    await expect(page.locator('main output[aria-live="polite"]')).toHaveText(
      fill(ad.announce.statusUpdated, { state: ad.state.ready, detail: ad.detail.ready })
    );
    await expect(page.getByRole('button', { name: ad.status.withdraw })).toBeVisible();
  });

  await test.step('worker processor completes the case through every phase', async () => {
    const readProposals = () =>
      VIEWER().client.rpc('get_match_event_result_proposals', { p_match_event_id: eventId });
    expect((await readProposals()).error).toBeNull();
    // Baseline: before the erasure the viewer's match page loads its results without an error.
    const baseline = await f.page(VIEWER(), 'en', 390);
    await visit(baseline, '/matches/' + eventId);
    await expect(
      baseline.getByRole('heading', { name: 'Privacy E2E court', level: 2 })
    ).toBeVisible();
    await expect(baseline.getByRole('alert')).toHaveCount(0);
    await baseline.context().close();
    expect(await sweep()).toEqual({ disabled: false, processed: 1 });
    expect(await caseRow(reference)).toMatchObject({ state: 'closed', outcome: 'erased' });
    // The surviving viewer's server-side history read still works after the erasure.
    const afterRead = await readProposals();
    expect(afterRead.error, JSON.stringify(afterRead.error)).toBeNull();
    // The app's own parser accepts the erased participant's opaque historical ref.
    expect(parseResultProposals(afterRead.data)).not.toBeNull();
    // Server-side proof: identity, profile and storage are gone.
    expect(await authUsers(subject)).toBe(0);
    expect(await profiles(subject)).toBe(0);
    expect(await avatarObjects(subject)).toBe(0);
  });

  await test.step('old credentials, old token and old browser session are denied', async () => {
    const env = tuple();
    const anon = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const signedIn = await anon.auth.signInWithPassword({
      email: subject.email,
      password: 'Password123!'
    });
    expect(signedIn.error).not.toBeNull();
    expect(signedIn.data.session).toBeNull();
    expect((await subject.client.auth.getUser()).error).not.toBeNull();
    // The stale browser cookie still carries a signature-valid JWT until it expires. The protected boundary
    // checks live existence (no live participant identity), so the browser resolves as signed OUT: it lands
    // on the login page, never on /me, onboarding or any authenticated UI.
    await page.goto('/me');
    await expect(page).toHaveURL(/\/login(\?|$)/);
    await expect(page).not.toHaveURL(/onboarding|\/me/);
    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/login(\?|$)/);
    const revived = await subject.client.rpc('onboard_player', {
      p_display_name: 'Revived Player',
      p_preferred_side: 'EITHER',
      p_initial_level: 3.2
    });
    expect(revived.error).not.toBeNull();
    expect(await profiles(subject)).toBe(0);
    expect(await authUsers(subject)).toBe(0);
  });

  await test.step('a surviving viewer sees shared history with a localized placeholder and no stale media', async () => {
    const viewerPage = await f.page(VIEWER(), 'en', 390);
    const viewerExternal = trackExternal(viewerPage.context());
    await visit(viewerPage, '/matches/' + eventId);
    await expect(viewerPage.getByText(en.player.formerPlayer).first()).toBeVisible();
    await expect(viewerPage.getByText(NAMES[2]!)).toHaveCount(0);
    // Other players' history is intact.
    await expect(viewerPage.getByText('Privacy Host').first()).toBeVisible();
    const imageSources = await viewerPage
      .locator('img')
      .evaluateAll((images) => images.map((image) => image.getAttribute('src') ?? ''));
    expect(imageSources.filter((src) => src.includes(subject.id))).toEqual([]);
    expect(viewerExternal).toEqual([]);

    // The placeholder is localized for other viewers too.
    for (const locale of ['pt-BR', 'es'] as const) {
      const localized = await f.page(VIEWER(), locale, 390);
      await visit(localized, '/matches/' + eventId);
      await expect(localized.getByText(copies[locale].player.formerPlayer).first()).toBeVisible();
      await localized.context().close();
    }
    await viewerPage.context().close();
  });

  expect(external).toEqual([]);
  await page.context().close();
});

test('withdraw: intake returns after withdrawal; refused once the worker claimed; outage is retried by the operator', async () => {
  const subject = SUBJECT_B();
  const page = await f.page(subject, 'en', 390);
  await visit(page, '/account-deletion');

  await test.step('withdraw while pending restores the intake card', async () => {
    const first = await requestDeletion(page);
    await page.getByRole('button', { name: ad.status.withdraw }).click();
    const dialog = page.getByRole('alertdialog', { name: ad.withdrawDialog.title });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: ad.withdrawDialog.confirm }).click();
    await expect(page.getByRole('heading', { name: ad.state.withdrawn, level: 2 })).toBeVisible();
    await expect(page.locator('main output[aria-live="polite"]')).toHaveText(ad.announce.withdrawn);
    await expect(page.getByRole('button', { name: ad.intro.start })).toBeVisible();
    expect(await caseRow(first)).toMatchObject({ state: 'withdrawn' });
    // The operator cannot act on a withdrawn case.
    expect((await operator('start-verification', first))['status']).toBe('rejected');
  });

  let reference = '';
  await test.step('a new request is verified and armed; the user can still withdraw', async () => {
    reference = await requestDeletion(page);
    await verifyCase(reference, subject.email);
    expect(await armed(reference, await dryRun(reference))).toMatchObject({ state: 'ready' });
    await page.getByRole('button', { name: ad.status.refresh }).click();
    await expect(page.getByRole('heading', { name: ad.state.ready, level: 2 })).toBeVisible();
    await expect(page.getByRole('button', { name: ad.status.withdraw })).toBeVisible();
  });

  await test.step('after the worker claims, withdrawal is refused and the page shows the real state', async () => {
    // The processor's own claim RPC, exactly as the sweep issues it (the user is not frozen yet).
    const claim = await serviceClient().rpc('privacy_proc_claim', {
      p_lease_seconds: 60,
      p_project_ref: 'local'
    });
    expect(record(claim.data)['status']).toBe('claimed');
    await page.getByRole('button', { name: ad.status.withdraw }).click();
    const dialog = page.getByRole('alertdialog', { name: ad.withdrawDialog.title });
    await dialog.getByRole('button', { name: ad.withdrawDialog.confirm }).click();
    await expect(page.getByRole('heading', { name: ad.state.executing, level: 2 })).toBeVisible();
    await expect(page.getByRole('button', { name: ad.status.withdraw })).toHaveCount(0);
    await expect(page.getByText(ad.status.cannotWithdraw, { exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveText(ad.errors.not_withdrawable);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });

  await test.step('a provider outage exhausts retries, the operator retries, the worker completes', async () => {
    // The worker holding the lease "died": the case becomes claimable and Storage then keeps failing.
    await sql(
      "update privacy_internal.privacy_cases set lease_expires_at = now() - interval '1 second', next_attempt_at = null where reference = " +
        L(reference)
    );
    const outage = outageAdmin();
    let guard = 0;
    while ((await caseRow(reference))['state'] !== 'blocked' && guard++ < 10) {
      await sweep(outage);
      await sql(
        "update privacy_internal.privacy_cases set next_attempt_at = now() - interval '1 second' where state <> 'blocked' and reference = " +
          L(reference)
      );
    }
    expect(await caseRow(reference)).toMatchObject({
      state: 'blocked',
      blocker_code: 'RETRIES_EXHAUSTED',
      next_action: 'operator_retry'
    });
    // Nothing irreversible is skipped: Auth still holds the (frozen) user until storage is proven gone.
    expect(await authUsers(subject)).toBe(1);
    expect(await operator('retry', reference)).toMatchObject({ status: 'ok' });
    expect(await sweep()).toEqual({ disabled: false, processed: 1 });
    expect(await caseRow(reference)).toMatchObject({ state: 'closed', outcome: 'erased' });
    expect(await avatarObjects(subject)).toBe(0);
    expect(await authUsers(subject)).toBe(0);
  });
  await page.context().close();
});

test('blocked: generic needs-attention copy without raw codes; operator re-arms and refuses', async () => {
  const subject = SUBJECT_C();
  const page = await f.page(subject, 'en', 390);
  await visit(page, '/account-deletion');
  const reference = await requestDeletion(page);
  await verifyCase(reference, subject.email);
  const dry = await dryRun(reference);

  await test.step('a plan armed for another project blocks at the claim, before anything irreversible', async () => {
    // Fixture-induced blocker through the operator RPC with a different project label.
    const wrong = await serviceClient().rpc('privacy_op_arm', {
      p_reference: reference,
      p_expected: record(dry['plan']),
      p_project_ref: 'elsewhere',
      p_environment: 'local'
    });
    expect(record(wrong.data)['status']).toBe('ok');
    expect(await sweep()).toEqual({ disabled: false, processed: 0 });
    expect(await caseRow(reference)).toMatchObject({
      state: 'blocked',
      blocker_code: 'ENVIRONMENT_MISMATCH',
      next_action: 'operator_rearm',
      consumed: false
    });
    expect(await profiles(subject)).toBe(1);
  });

  await test.step('the user sees generic text, never a raw code, in every locale', async () => {
    await page.getByRole('button', { name: ad.status.refresh }).click();
    await expect(page.getByRole('heading', { name: ad.state.blocked, level: 2 })).toBeVisible();
    await expect(page.getByText(ad.detail.blocked, { exact: true })).toBeVisible();
    await expect(page.locator('main output[aria-live="polite"]')).toHaveText(
      fill(ad.announce.statusUpdated, { state: ad.state.blocked, detail: ad.detail.blocked })
    );
    const body = await page.locator('main').innerText();
    expect(body).not.toMatch(/ENVIRONMENT_MISMATCH|operator_rearm|elsewhere|blocker/i);
    expect(body).not.toContain(subject.id);
    await page.context().close();
    for (const locale of ['pt-BR', 'es'] as const) {
      const localized = await f.page(subject, locale, 320);
      await visit(localized, '/account-deletion');
      const copy = copies[locale].accountDeletion;
      await expect(
        localized.getByRole('heading', { name: copy.state.blocked, level: 2 })
      ).toBeVisible();
      await expect(localized.getByText(copy.detail.blocked)).toBeVisible();
      await noHorizontalOverflow(localized);
      await localized.context().close();
    }
  });

  await test.step('operator re-arms (retry applies only to resumable phases) and refuses explicitly', async () => {
    expect(await operator('retry', reference)).toMatchObject({ status: 'rejected' });
    expect(await armed(reference, await dryRun(reference))).toMatchObject({ state: 'ready' });
    expect(await caseRow(reference)).toMatchObject({ state: 'ready', blocker_code: null });
    // A justified refusal closes a case that has not started.
    expect(await operator('refuse', reference)).toMatchObject({ status: 'ok', state: 'closed' });
    expect(await caseRow(reference)).toMatchObject({ state: 'closed', outcome: 'refused' });
    expect(await sweep()).toEqual({ disabled: false, processed: 0 });
  });
});

test('unclaimed email-only people have no in-app request: the operator contract refuses blind actions', async () => {
  // There is no browser flow for a person without an account (the pane directs them to email). At
  // the operator contract level, nothing can be started, armed or erased from an address or an
  // unknown reference, and no output echoes the input. Automated erasure of awaiting-identity
  // operation rows is, by design (design doc section 9, runbook section 3), a private operator query
  // and has no CLI/worker surface to exercise here.
  const email = 'nobody-' + crypto.randomUUID() + '@test.local';
  for (const reference of [email, 'PR-000000000000']) {
    for (const command of [
      ['start-verification', reference],
      ['dry-run', reference],
      ['arm', reference, '--plan', '{"revision":1,"fingerprint":"x","impact":{},"successors":{}}'],
      ['retry', reference],
      ['refuse', reference]
    ]) {
      const result = await operatorCli(command);
      expect(result.code, command[0]).toBe(1);
      expect(result.err.trim()).toMatch(/^[A-Z_]+$/);
      expect(result.out + result.err).not.toContain(email);
    }
  }
  expect((await operatorCli(['arm', 'PR-000000000000'])).err.trim()).toBe('PLAN_REQUIRED');
  expect((await operatorCli(['confirm-proof', 'PR-000000000000'])).err.trim()).toBe(
    'CODE_REQUIRED'
  );
  expect((await operatorCli(['erase', email])).err.trim()).toBe('UNKNOWN_COMMAND');
  // The documented fallback is visible to a signed-in visitor of the pane in every locale.
  for (const locale of LOCALES) {
    const page = await f.page(SUBJECT_D(), locale, 390);
    await visit(page, '/account-deletion');
    const copy = copies[locale].accountDeletion;
    await expect(page.getByText(copy.fallback.body)).toBeVisible();
    const mail = page.locator('main a[href^="mailto:"]');
    const address = (await mail.innerText()).trim();
    await expect(mail).toHaveAttribute('aria-label', fill(copy.fallback.mailLabel, { address }));
    await page.context().close();
  }
});

test('i18n smoke: pane and dialog render in en, pt-BR and es without fallback markers', async () => {
  for (const locale of LOCALES) {
    const copy = copies[locale].accountDeletion;
    const page = await f.page(SUBJECT_D(), locale, 390);
    await visit(page, '/account-deletion');
    await expect(page.getByRole('heading', { name: copy.intro.heading })).toBeVisible();
    await page.getByRole('button', { name: copy.intro.start }).click();
    const dialog = page.getByRole('alertdialog', { name: copy.dialog.title });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(
      fill(copy.dialog.remains.body, { placeholder: copies[locale].player.formerPlayer })
    );
    for (const heading of [
      copy.dialog.disappears.title,
      copy.dialog.remains.title,
      copy.dialog.access.title,
      copy.dialog.cutoff.title
    ])
      await expect(dialog.getByRole('heading', { name: heading })).toBeVisible();
    const rendered = await page.locator('body').innerText();
    expect(rendered).not.toMatch(/\baccountDeletion\.|\bplayer\.formerPlayer|\{\{/);
    await dialog.getByRole('button', { name: copy.dialog.cancel }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await page.context().close();
  }
});

test('keyboard and focus: tab order reaches the entry and dialog controls, Escape cancels and returns focus', async () => {
  const page = await f.page(SUBJECT_D(), 'en', 390);
  await visit(page, '/account-deletion');
  const trigger = page.getByRole('button', { name: ad.intro.start });
  let reached = false;
  for (let index = 0; index < 40 && !reached; index++) {
    await page.keyboard.press('Tab');
    reached = await trigger.evaluate((element) => element === document.activeElement);
  }
  expect(reached, 'the entry button is reachable by Tab').toBe(true);
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('alertdialog', { name: ad.dialog.title });
  await expect(dialog).toBeVisible();
  // Focus is trapped in the dialog and reaches both of its controls.
  await expect
    .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);
  const seen = new Set<string>();
  for (let index = 0; index < 6; index++) {
    // Focus guards may hold focus for a tick before the trap hands it back inside the popup.
    await expect
      .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
      .toBe(true);
    seen.add(await page.evaluate(() => document.activeElement?.textContent?.trim() ?? ''));
    await page.keyboard.press('Tab');
  }
  expect(seen).toContain(ad.dialog.cancel);
  expect(seen).toContain(ad.dialog.confirm);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  // Nothing was sent by cancelling.
  expect(
    await scalar(
      'select count(*)::int from privacy_internal.privacy_cases where subject_id = ' +
        L(SUBJECT_D().id)
    )
  ).toBe(0);
  // The announcement region exists as a polite live region before any status change.
  await expect(page.locator('main output[aria-live="polite"]')).toHaveCount(1);
  await page.context().close();
});

test('narrow viewport: dialog stays usable at 320px with long translations', async () => {
  for (const locale of ['pt-BR', 'es'] as const) {
    const copy = copies[locale].accountDeletion;
    const page = await f.page(SUBJECT_D(), locale, 320, 'light', 568);
    await visit(page, '/account-deletion');
    await noHorizontalOverflow(page);
    await page.getByRole('button', { name: copy.intro.start }).click();
    const dialog = page.getByRole('alertdialog', { name: copy.dialog.title });
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
    const confirm = dialog.getByRole('button', { name: copy.dialog.confirm });
    await confirm.scrollIntoViewIfNeeded();
    await expect(confirm).toBeVisible();
    expect((await confirm.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await noHorizontalOverflow(page);
    await dialog.getByRole('button', { name: copy.dialog.cancel }).click();
    await page.context().close();
  }
});

test('public policy: reachable logged out with request, deletion and residual sections and the legal-review note', async ({
  browser
}) => {
  for (const locale of LOCALES) {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const external = trackExternal(context);
    await context.addCookies([{ name: 'locale', value: locale, url: 'http://127.0.0.1:4173' }]);
    const page = await context.newPage();
    const response = await page.goto('/privacy');
    expect(response?.status()).toBe(200);
    await waitForHydratedPage(page);
    await expect(page).toHaveURL(/\/privacy$/);
    const policy = copies[locale].privacy;
    for (const heading of [policy.requests.title, policy.deletion.title, policy.residual.title])
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    // Legal review is shown as pending (PRIVACY_LEGAL_REVIEW_COMPLETED=false); no compliance claim.
    await expect(page.getByRole('note')).toContainText(policy.reviewNotice);
    expect(external).toEqual([]);
    await context.close();
  }
});
