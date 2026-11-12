import { Client } from 'pg';
import { testDatabaseUrl } from './test-supabase-config';
import { expect, test } from '@playwright/test';
import { waitForHydratedPage } from './auth-helpers';
import { acquireRatingSuite, releaseRatingSuite } from './rating-suite-lock';
import { amendmentFixtures, copies, repairNow } from './result-amendments-fixtures';
import { sql } from './matches-management-fixtures';
import {
  assertContrast,
  assertNoOverflow,
  assertReducedMotion,
  assertTargets
} from './result-corrections-visual';

type Fixtures = Awaited<ReturnType<typeof amendmentFixtures>>;
let f: Fixtures;
const c = copies.en.matches.corrections;
const failureFunction = 'public.fixture_result_repair_browser_failure';

test.beforeAll(async ({ browser }) => {
  test.setTimeout(1_500_000);
  await acquireRatingSuite();
  f = await amendmentFixtures(browser);
});
test.afterAll(async () => {
  test.setTimeout(180_000);
  await removeFailure();
  await f?.cleanup();
});
// Declared after the cleanup hook so the suite lock is released last.
test.afterAll(releaseRatingSuite);
test.beforeEach(() => test.setTimeout(180_000));

async function removeFailure() {
  await sql(
    `do $cleanup$ begin drop trigger if exists fixture_result_repair_browser_failure on public.statistics_group_facts; drop function if exists ${failureFunction}(); end $cleanup$`
  );
}
let retriedJob: Promise<string> | undefined;
/** Seeds, once per worker community, a repair that failed then succeeded on an admin retry (attempt_count 2). */
function retriedRepairJob() {
  retriedJob ??= (async () => {
    await f.grantAdmin();
    const group = await f.confirmed();
    const queued = await f.accepted(group);
    const suffix = group.original.proposal_id.replaceAll('-', '').slice(0, 12);
    const fn = `public.fixture_repair_retried_${suffix}`;
    await sql(`do $setup$ begin create function ${fn}() returns trigger language plpgsql as $failure$ begin raise exception 'FIXTURE_PUBLICATION_FAILURE'; end $failure$;
      create trigger fixture_repair_retried_${suffix} after insert or update on public.statistics_group_facts for each row when (new.game_group_id='${group.original.proposal_id}'::uuid) execute function ${fn}(); end $setup$`);
    try {
      expect(await repairNow(queued.jobId)).toBe('failed');
    } finally {
      await sql(
        `do $cleanup$ begin drop trigger if exists fixture_repair_retried_${suffix} on public.statistics_group_facts; drop function if exists ${fn}(); end $cleanup$`
      );
    }
    const retry = await f.creator.client.rpc('retry_result_repair', { p_job_id: queued.jobId });
    expect(retry.error).toBeNull();
    // The retry command claims the job for its caller; execute that claimed attempt.
    const [claimed] = await sql(
      `select attempt_count::int as attempts from public.result_repair_jobs where id='${queued.jobId}' and status='running'`
    );
    const executed = await f.creator.client.rpc('execute_claimed_result_repair', {
      p_job_id: queued.jobId,
      p_attempt_number: Number(claimed?.['attempts'])
    });
    expect(executed.error).toBeNull();
    // A concurrent scheduler may have run the claimed attempt first ("stale"); the terminal state is the contract.
    expect(['succeeded', 'stale']).toContain(executed.data?.outcome);
    await expect
      .poll(
        async () => {
          const [job] = await sql(
            `select status::text as status, attempt_count::int as attempts from public.result_repair_jobs where id='${queued.jobId}'`
          );
          const status = job?.['status'];
          return `${typeof status === 'string' ? status : 'missing'}:${Number(job?.['attempts'] ?? 0)}`;
        },
        { timeout: 60_000, intervals: [250, 500, 1000] }
      )
      .toMatch(/^succeeded:([2-9]|\d{2,})$/);
    return queued.jobId;
  })();
  return retriedJob;
}
async function counts(eventId: string) {
  return sql(`select
    (select count(*)::int from public.match_event_result_confirmations where match_event_id='${eventId}') as facts,
    (select count(*)::int from public.player_rating_events where match_event_id='${eventId}') as events,
    (select count(*)::int from public.notifications where target_id='${eventId}' and kind='result_repair_applied') as notices,
    (select count(*)::int from public.match_event_audit_log where match_event_id='${eventId}' and action='result_repair_applied') as audits`);
}
test('failed publication survives reload, admin retries, original facts remain auditable and retry is idempotent', async ({
  browserName
}, testInfo) => {
  expect(browserName).toBe('chromium');
  await f.grantAdmin();
  const group = await f.confirmed();
  const ratingBefore = await sql(
    `select user_id::text, mu::text, confirmed_competitive_game_groups from public.global_player_ratings where user_id in ('${group.teams.team_a.join("','")}','${group.teams.team_b.join("','")}') order by user_id`
  );
  const queued = await f.accepted(group);
  await sql(`do $setup$ begin create function ${failureFunction}() returns trigger language plpgsql as $failure$ begin raise exception 'FIXTURE_PUBLICATION_FAILURE'; end $failure$;
    create trigger fixture_result_repair_browser_failure after insert or update on public.statistics_group_facts for each row when (new.game_group_id='${group.original.proposal_id}'::uuid) execute function ${failureFunction}(); end $setup$`);
  try {
    expect(await repairNow(queued.jobId)).toBe('failed');
  } finally {
    await removeFailure();
  }
  const page = await f.page(f.creator);
  await page.goto(`/community/${f.community}/repairs`);
  await waitForHydratedPage(page);
  const job = page.locator(`[data-repair-job="${queued.jobId}"]`);
  await expect(job.locator('[data-repair-status=failed]')).toContainText(
    c.repair.publication.failed
  );
  await page.reload();
  await waitForHydratedPage(page);
  await expect(job.locator('[data-repair-status=failed]')).toBeVisible();
  expect((await f.proposal(group.eventId)).confirmation?.confirmation_id).toBe(group.baseId);
  await job.getByRole('button', { name: c.repair.retry, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: c.repair.confirmTitle, exact: true });
  await dialog.getByRole('button', { name: c.repair.confirmAction, exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(job.locator('[data-repair-status=succeeded]')).toContainText(
    c.repair.publication.published
  );
  const after = await counts(group.eventId);
  const ratingAfter = await sql(
    `select user_id::text, mu::text, confirmed_competitive_game_groups from public.global_player_ratings where user_id in ('${group.teams.team_a.join("','")}','${group.teams.team_b.join("','")}') order by user_id`
  );
  expect(ratingAfter).not.toEqual(ratingBefore);
  expect(ratingAfter.every((row) => row['confirmed_competitive_game_groups'] === 1)).toBe(true);
  expect(
    await sql(
      `select classification, count(*)::int as facts from public.statistics_group_facts where game_group_id='${group.original.proposal_id}' group by classification`
    )
  ).toEqual([{ classification: 'team_b', facts: 1 }]);
  expect(after[0]?.['audits']).toBe(1);
  expect(Number(after[0]?.['notices'])).toBeGreaterThan(0);
  console.info('rating-replay-evidence', JSON.stringify({ ratingBefore, ratingAfter }));
  const again = await f.creator.client.rpc('retry_result_repair', { p_job_id: queued.jobId });
  expect(again.error?.message).toBe('RESULT_REPAIR_ALREADY_APPLIED');
  expect(await counts(group.eventId)).toEqual(after);
  const facts = await sql(
    `select proposal_version::int as version from public.match_event_result_confirmations where match_event_id='${group.eventId}' order by proposal_version`
  );
  expect(facts).toEqual([{ version: 1 }, { version: 2 }]);
  const evidence = await sql(
    `select id::text, status, committed_revision, attempt_count from public.result_repair_jobs where id='${queued.jobId}'`
  );
  console.info(
    'committed-repair-evidence',
    JSON.stringify({
      eventId: group.eventId,
      priorConfirmation: group.baseId,
      ...queued,
      evidence,
      after
    })
  );
  await testInfo.attach('committed-repair-evidence', {
    body: JSON.stringify(
      { eventId: group.eventId, priorConfirmation: group.baseId, ...queued, evidence, after },
      null,
      2
    ),
    contentType: 'application/json'
  });
  // The applied notice resolves to its translated kind, explanation and the match it concerns.
  const [notice] = await sql(
    `select id::text from public.notifications where kind='result_repair_applied' and target_id='${group.eventId}' and recipient_user_id='${f.creator.id}'`
  );
  await page.goto(`/notifications/${String(notice?.['id'])}`);
  await waitForHydratedPage(page);
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: copies.en.notifications.kinds.result_repair_applied
    })
  ).toBeVisible();
  await expect(
    page.getByText(copies.en.notifications.result.kindBody.result_repair_applied, { exact: true })
  ).toBeVisible();
  await f.open(page, group.eventId);
  await expect(page.locator('[data-amendment-lifecycle=applied]')).toHaveAttribute(
    'data-pending-application',
    'false'
  );
  await page.locator('[data-amendment-lifecycle=applied] summary').click();
  await expect(page.locator('[data-amendment-lifecycle=applied]')).toContainText(
    queued.amendmentId.slice(0, 8)
  );
  expect((await f.proposal(group.eventId)).classification).toBe('team_b');
  await page
    .getByRole('link', { name: copies.en.statistics.history.viewDetails, exact: true })
    .click();
  await waitForHydratedPage(page);
  await expect(
    page.getByRole('heading', { level: 1, name: copies.en.statistics.detail.title, exact: true })
  ).toBeVisible();
  await expect(
    page.getByText(copies.en.statistics.detail.correction.badge, { exact: true })
  ).toBeVisible();
});

test('backend collision exposes running diagnostics until committed publication', async ({
  browserName
}, testInfo) => {
  expect(browserName).toBe('chromium');
  await f.grantAdmin();
  const group = await f.confirmed();
  const queued = await f.accepted(group);
  const claim = await f.claimRepair(queued.jobId);
  if (claim.status !== 'claimed') throw new Error('Collision fixture needs an owned repair claim');
  const connectionString = testDatabaseUrl();
  const blocker = new Client({
    connectionString,
    connectionTimeoutMillis: 5_000,
    query_timeout: 60_000
  });
  const worker = new Client({
    connectionString,
    connectionTimeoutMillis: 5_000,
    query_timeout: 60_000
  });
  await blocker.connect();
  let execution: Promise<unknown> | undefined;
  try {
    await worker.connect();
    await blocker.query(
      "select pg_advisory_lock(hashtextextended('padel-friend:test-rating-prelock',0))"
    );
    await worker.query("select set_config('app.test_pause','before_rating_lock',false)");
    const pid = await worker.query<{ pid: number }>('select pg_backend_pid() as pid');
    const workerPid = pid.rows[0]!.pid;
    execution = worker.query('select public.execute_result_repair($1,$2) as receipt', [
      queued.jobId,
      claim.token
    ]);
    await expect
      .poll(async () => {
        const result = await blocker.query<{ wait_event: string }>(
          'select wait_event from pg_stat_activity where pid=$1',
          [workerPid]
        );
        return result.rows[0]?.wait_event;
      })
      .toBe('advisory');
    const page = await f.page(f.creator);
    await page.goto(`/community/${f.community}/repairs`);
    await waitForHydratedPage(page);
    await expect(
      page.locator(`[data-repair-job="${queued.jobId}"] [data-repair-status=running]`)
    ).toBeVisible();
    await expect(
      page
        .locator(`[data-repair-job="${queued.jobId}"]`)
        .getByRole('button', { name: c.repair.retry, exact: true })
    ).toHaveCount(0);
    await testInfo.attach('backend-collision-evidence', {
      body: JSON.stringify({
        jobId: queued.jobId,
        workerPid,
        waitEvent: 'advisory',
        visibleStatus: 'running'
      }),
      contentType: 'application/json'
    });
    await blocker.query('select pg_advisory_unlock_all()');
    await execution;
    await page.getByRole('button', { name: copies.en.matches.results.reload, exact: true }).click();
    await expect(
      page.locator(`[data-repair-job="${queued.jobId}"] [data-repair-status=succeeded]`)
    ).toBeVisible();
  } finally {
    await blocker.query('select pg_advisory_unlock_all()');
    if (execution) await execution;
    await worker.end();
    await blocker.end();
  }
});

function localConnectionString(): string {
  return testDatabaseUrl();
}

test('admin replay during live reads exposes only the prior committed generation, applies once and rejects unauthorized replay', async ({
  browserName
}) => {
  expect(browserName).toBe('chromium');
  await f.grantAdmin();
  const group = await f.confirmed();
  const players = [...group.teams.team_a, ...group.teams.team_b];
  const snapshot = () =>
    sql(`select user_id::text, display_level::text, mu::text, reliability_percent::text,
        confirmed_competitive_game_groups::int as groups
      from public.global_player_ratings where user_id in ('${players.join("','")}') order by user_id`);
  const ledgerRows = () =>
    sql(
      `select count(*)::int as events from public.player_rating_events where match_event_id='${group.eventId}'`
    );
  const official = async () => (await f.proposal(group.eventId)).confirmation?.confirmation_id;
  const jobStatus = async () =>
    (
      await sql(
        `select status::text as status from public.result_repair_jobs where id='${queued.jobId}'`
      )
    )[0]?.['status'];
  const before = await snapshot();
  const ledgerBefore = await ledgerRows();
  expect(await official()).toBe(group.baseId);

  const queued = await f.accepted(group);
  const claim = await f.claimRepair(queued.jobId);
  if (claim.status !== 'claimed') throw new Error('Replay fixture needs an owned repair claim');

  // Unauthorized replay: neither a plain player nor a foreign account can claim or execute it.
  for (const actor of [f.members[0]!, f.guest]) {
    const claimed = await actor.client.rpc('claim_result_repair_job', {
      p_job_id: queued.jobId,
      p_lease_seconds: 600
    });
    expect(claimed.error).not.toBeNull();
    const executed = await actor.client.rpc('execute_result_repair', {
      p_job_id: queued.jobId,
      p_fence_token: claim.token
    });
    expect(executed.error).not.toBeNull();
  }
  expect(await official()).toBe(group.baseId);
  expect(await snapshot()).toEqual(before);

  const connectionString = localConnectionString();
  const blocker = new Client({
    connectionString,
    connectionTimeoutMillis: 5_000,
    query_timeout: 60_000
  });
  const worker = new Client({
    connectionString,
    connectionTimeoutMillis: 5_000,
    query_timeout: 60_000
  });
  await blocker.connect();
  let execution: Promise<unknown> | undefined;
  try {
    await worker.connect();
    await blocker.query(
      "select pg_advisory_lock(hashtextextended('padel-friend:test-rating-prelock',0))"
    );
    await worker.query("select set_config('app.test_pause','before_rating_lock',false)");
    const pid = await worker.query<{ pid: number }>('select pg_backend_pid() as pid');
    const workerPid = pid.rows[0]!.pid;
    execution = worker.query('select public.execute_result_repair($1,$2) as receipt', [
      queued.jobId,
      claim.token
    ]);
    await expect
      .poll(async () => {
        const result = await blocker.query<{ wait_event: string }>(
          'select wait_event from pg_stat_activity where pid=$1',
          [workerPid]
        );
        return result.rows[0]?.wait_event;
      })
      .toBe('advisory');

    // Live reads while the replay is in flight: the prior committed generation, never a mix.
    const page = await f.page(f.members[1]!);
    await f.open(page, group.eventId);
    await expect(
      page.locator('[data-amendment-lifecycle=approved_pending_repair]')
    ).toHaveAttribute('data-pending-application', 'true');
    for (let sample = 0; sample < 3; sample++) {
      expect(await official()).toBe(group.baseId);
      expect(await snapshot()).toEqual(before);
      expect(await ledgerRows()).toEqual(ledgerBefore);
    }
    expect(await jobStatus()).toBe('running');

    await blocker.query('select pg_advisory_unlock_all()');
    await execution;
  } finally {
    await blocker.query('select pg_advisory_unlock_all()');
    if (execution) await execution;
    await worker.end();
    await blocker.end();
  }

  // One committed generation: new official confirmation, replayed ratings, one audit, one notice set.
  await expect.poll(jobStatus).toBe('succeeded');
  expect(await official()).not.toBe(group.baseId);
  const after = await counts(group.eventId);
  const ratingAfter = await snapshot();
  expect(ratingAfter).not.toEqual(before);
  expect(after[0]?.['audits']).toBe(1);
  expect(Number(after[0]?.['notices'])).toBeGreaterThan(0);
  expect(await repairNow(queued.jobId)).toBe('succeeded');
  expect(await counts(group.eventId)).toEqual(after);
  expect(await snapshot()).toEqual(ratingAfter);
  expect(await ledgerRows()).toEqual(ledgerBefore);
});

test('player and foreign member cannot open community diagnostics or retry directly', async () => {
  const group = await f.confirmed();
  const queued = await f.accepted(group);
  for (const actor of [f.members[0]!, f.guest]) {
    const page = await f.page(actor);
    await page.goto(`/community/${f.community}/repairs`);
    await waitForHydratedPage(page);
    await expect(page.locator('[data-result-route=repair-diagnostics]')).toHaveCount(0);
    const denied = await actor.client.rpc('retry_result_repair', { p_job_id: queued.jobId });
    expect(denied.error).not.toBeNull();
  }
});

test('community admin sees no platform diagnostics and a retry of an unreadable job looks missing', async () => {
  await f.grantAdmin();
  const group = await f.confirmed();
  await f.accepted(group);
  const page = await f.page(f.creator);
  await page.goto('/platform-admin/result-repairs');
  await waitForHydratedPage(page);
  await expect(page.locator('[data-result-route=repair-diagnostics]')).toHaveCount(0);
  const platformScope = await f.creator.client.rpc('get_result_repair_diagnostics', {});
  expect(platformScope.error).not.toBeNull();
  const missing = await f.creator.client.rpc('retry_result_repair', {
    p_job_id: crypto.randomUUID()
  });
  expect(missing.error?.message).toBe('RESULT_REPAIR_NOT_FOUND');
  expect((await f.proposal(group.eventId)).confirmation?.confirmation_id).toBe(group.baseId);
});

for (const theme of ['light', 'dark'] as const) {
  test(`diagnostics meet target size, contrast, reduced motion and heading semantics at 320px: ${theme}`, async () => {
    await f.grantAdmin();
    const page = await f.page(f.creator, 'en', 320, theme, 844);
    await page.goto(`/community/${f.community}/repairs`);
    await waitForHydratedPage(page);
    const root = page.locator('[data-result-route=repair-diagnostics]');
    await expect(root).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await assertTargets(root, `diagnostics ${theme}`);
    await assertContrast(root, `diagnostics ${theme}`);
    await assertReducedMotion(page, root, `diagnostics ${theme}`);
    await assertNoOverflow(page, `diagnostics ${theme}`);
  });
}

for (const scope of ['community', 'platform'] as const) {
  for (const locale of ['en', 'pt-BR', 'es'] as const) {
    test(`${scope} diagnostics locale survives SSR and hydration: ${locale}`, async ({
      browserName
    }, testInfo) => {
      expect(browserName).toBe('chromium');
      await f.grantAdmin();
      if (scope === 'platform')
        await sql(
          `insert into public.platform_admins(user_id) values ('${f.creator.id}') on conflict do nothing`
        );
      const path =
        scope === 'platform'
          ? '/platform-admin/result-repairs'
          : `/community/${f.community}/repairs`;
      // Seed before loading: the diagnostics list is server-rendered, so a retry seeded after goto would be missing from it.
      const completedId = scope === 'platform' ? await retriedRepairJob() : undefined;
      const page = await f.page(f.creator, locale, 1280, 'light');
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const serverResponse = await page.request.get(path);
      const serverHtml = await serverResponse.text();
      expect(serverHtml).toContain(`lang="${locale}"`);
      expect(serverHtml).toContain(copies[locale].matches.corrections.diagnostics.title);
      await page.goto(path);
      await waitForHydratedPage(page);
      await expect(
        page.getByRole('heading', {
          level: 1,
          name: copies[locale].matches.corrections.diagnostics.title,
          exact: true
        })
      ).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true);
      expect(errors).toEqual([]);
      if (completedId) {
        const job = page.locator(`[data-repair-job="${completedId}"]`);
        // The selected job's attempt timeline is always visible in the detail region.
        await job.locator('[data-repair-select]').click();
        const attempts = page.locator(
          `[data-repair-detail="${completedId}"] ol[aria-label="${copies[locale].matches.corrections.diagnostics.attemptsCaption}"]`
        );
        await expect(attempts).toContainText(
          copies[locale].matches.corrections.repair.status.failed
        );
        await expect(attempts).toContainText(
          copies[locale].matches.corrections.repair.status.succeeded
        );
      }
      await page.screenshot({
        path: testInfo.outputPath('diagnostics-desktop-light.png'),
        fullPage: true
      });
    });
  }
}
