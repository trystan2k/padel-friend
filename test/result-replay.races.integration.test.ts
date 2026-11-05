import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import {
  asRecord,
  fixtureSql,
  sqlRows,
  waitForRows,
  withDeadline
} from './helpers/match-registration-sql';
import {
  confirmedGroup,
  finalizeSql,
  ledgerFingerprint,
  nextTailPlayedAt,
  ratingStates,
  ratingWorld,
  submitPendingGroup,
  toQuartet,
  type RatingWorld
} from './helpers/rating-fixtures';
import {
  claimRepair,
  committedRevisionNumber,
  effectiveSources,
  executeRepair,
  queueCorrection,
  repairAttempts,
  repairJob,
  repairNow,
  sourceFingerprint,
  withNoopPublication
} from './helpers/result-replay-fixtures';
import { openDedicatedSqlConnection, type DedicatedSqlConnection } from './helpers/sql-transport';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
const BOUND_MS = 30_000;

describe('result repair claim fencing on separate connections', { timeout: 120_000 }, () => {
  let world: RatingWorld;
  const connections: DedicatedSqlConnection[] = [];
  beforeAll(async () => {
    if (environment.env) world = await ratingWorld(environment.env, 'repair-fence');
  });
  afterEach(async () => {
    await Promise.all(connections.splice(0).map((connection) => connection.close()));
  });
  async function connect() {
    const connection = await openDedicatedSqlConnection();
    connections.push(connection);
    return connection;
  }
  async function queued(label: string) {
    const players = await Promise.all(
      [4, 4.5, 5, 3.5].map((level, i) => world.player(label + i, level))
    );
    const group = await confirmedGroup({
      eventId: await world.newEvent(),
      players: toQuartet(players.map((player) => player.id)),
      playedAt: await nextTailPlayedAt(),
      submittedBy: world.admin.id
    });
    return queueCorrection(group, { facts: { classification: 'team_b' } });
  }
  it.skipIf(!environment.env)('only one connection can claim a queued job', async () => {
    const job = await queued('compete');
    const first = await connect();
    const second = await connect();
    await first.query('begin');
    const one = asRecord(
      (await first.query(`select public.claim_result_repair_job('${job.jobId}', 600) as result`))
        .rows[0]?.['result']
    );
    const two = asRecord(
      (
        await withDeadline(
          second.query(`select public.claim_result_repair_job('${job.jobId}', 600) as result`),
          BOUND_MS,
          'competing claim'
        )
      ).rows[0]?.['result']
    );
    expect(one['claimed']).toBe(true);
    expect(two['claimed']).toBe(false);
    expect(two['fence_token']).toBeUndefined();
    await first.query('commit');
    expect(await repairAttempts(job.jobId)).toHaveLength(1);
    const token = one['fence_token'];
    if (typeof token !== 'string') throw new Error('Missing fence token');
    expect((await executeRepair(job.jobId, token)).outcome).toBe('failed');
  });
  it.skipIf(!environment.env)(
    'reclaims an expired lease and rejects the stale worker token',
    async () => {
      const job = await queued('expire');
      const first = await claimRepair(job.jobId);
      if (!first.fence_token) throw new Error('Missing first token');
      await fixtureSql(
        `update public.result_repair_jobs set lease_expires_at = clock_timestamp() - interval '1 second' where id = '${job.jobId}'`
      );
      const holder = await connect();
      await holder.query('begin');
      await holder.query(
        `select id from public.result_repair_jobs where id = '${job.jobId}' for update`
      );
      const blockedReclaim = await withDeadline(
        claimRepair(job.jobId),
        BOUND_MS,
        'locked lease reclaim'
      );
      expect(blockedReclaim.claimed).toBe(false);
      await holder.query('commit');
      const reclaimed = await claimRepair(job.jobId);
      if (!reclaimed.fence_token) throw new Error('Missing replacement token');
      expect(reclaimed.fence_token).not.toBe(first.fence_token);
      expect((await executeRepair(job.jobId, first.fence_token)).outcome).toBe('stale');
      expect(await repairJob(job.jobId)).toMatchObject({ status: 'running', attempt_count: 2 });
      expect((await repairAttempts(job.jobId)).map((attempt) => attempt['status'])).toEqual([
        'expired',
        'running'
      ]);
      expect((await executeRepair(job.jobId, reclaimed.fence_token)).outcome).toBe('failed');
    }
  );
  it.skipIf(!environment.env)(
    'denies trusted processor and repair administration to unauthorized actors',
    async () => {
      const job = await queued('permissions');
      const outsider = await world.player('outsider', 4);
      const foreign = await world.newCommunity();
      const roleChecks = await sqlRows(
        `select r.role, f.name, has_function_privilege(r.role, f.name, 'EXECUTE') as allowed
         from (values ('anon'), ('authenticated')) r(role)
         cross join (values ('public.claim_result_repair_job(uuid,integer)'),
           ('public.execute_result_repair(uuid,uuid)')) f(name)`
      );
      expect(roleChecks).toHaveLength(4);
      expect(roleChecks.every((row) => row['allowed'] === false)).toBe(true);
      for (const actor of [outsider, world.admin]) {
        const audit = await actor.client.rpc('get_rating_history_audit', {
          p_user_id: outsider.id,
          p_revision: 0,
          p_limit: 5
        });
        expect(audit.error).not.toBeNull();
      }
      const denied = await outsider.client.rpc('retry_result_repair', { p_job_id: job.jobId });
      expect(denied.error).not.toBeNull();
      const foreignDenied = await import('./helpers/level-review-fixtures').then(
        async ({ callOnConnection }) => {
          const connection = await connect();
          return callOnConnection(
            connection,
            foreign.adminId,
            `public.retry_result_repair('${job.jobId}'::uuid)`
          );
        }
      );
      expect(foreignDenied.ok).toBe(false);
      const claim = await claimRepair(job.jobId);
      if (!claim.fence_token) throw new Error('Missing fence token');
      expect((await executeRepair(job.jobId, claim.fence_token)).outcome).toBe('failed');
    }
  );
  it.skipIf(!environment.env)(
    'rolls back failed publication and converges after authorized retry',
    async () => {
      const players = await Promise.all(
        [4, 4.5, 5, 3.5].map((level, i) => world.player('retry' + i, level))
      );
      const ids = players.map((player) => player.id);
      const group = await confirmedGroup({
        eventId: await world.newEvent(),
        players: toQuartet(ids),
        playedAt: await nextTailPlayedAt(),
        submittedBy: world.admin.id
      });
      const job = await queueCorrection(group, { facts: { classification: 'team_b' } });
      const before = {
        revision: await committedRevisionNumber(),
        ratings: await ratingStates(ids),
        sources: await sourceFingerprint([group.proposalId]),
        ledger: await ledgerFingerprint(ids),
        events: await effectiveSources([group.proposalId])
      };
      const claim = await claimRepair(job.jobId);
      if (!claim.fence_token) throw new Error('Missing fence token');
      const failed = await executeRepair(job.jobId, claim.fence_token);
      expect(failed).toMatchObject({ outcome: 'failed', failure_code: 'PUBLICATION_FAILED' });
      expect(await committedRevisionNumber()).toBe(before.revision);
      expect(await ratingStates(ids)).toEqual(before.ratings);
      expect(await sourceFingerprint([group.proposalId])).toBe(before.sources);
      expect(await ledgerFingerprint(ids)).toBe(before.ledger);
      expect(
        await sqlRows(
          `select current_confirmation_id::text as id from public.match_event_result_official_state where proposal_id = '${group.proposalId}'`
        )
      ).toEqual([{ id: group.confirmationId }]);
      const retry = await world.admin.client.rpc('retry_result_repair', { p_job_id: job.jobId });
      expect(retry.error).toBeNull();
      const receipt = asRecord(retry.data);
      const retryClaim = asRecord(receipt['claim']);
      expect(retryClaim['claimed']).toBe(true);
      const attempt = retryClaim['attempt_number'];
      if (typeof attempt !== 'number') throw new Error('Missing retry attempt');
      await withNoopPublication(async () => {
        const result = await world.admin.client.rpc('execute_claimed_result_repair', {
          p_job_id: job.jobId,
          p_attempt_number: attempt
        });
        expect(result.error).toBeNull();
        expect(asRecord(result.data)['outcome']).toBe('succeeded');
      });
      expect(await committedRevisionNumber()).toBe(before.revision + 1);
      expect(
        (await effectiveSources([group.proposalId])).map((event) => event.eventId).sort()
      ).toEqual(before.events.map((event) => event.eventId).sort());
      expect((await repairAttempts(job.jobId)).map((entry) => entry['status'])).toEqual([
        'failed',
        'succeeded'
      ]);
      expect((await executeRepair(job.jobId, claim.fence_token)).outcome).toBe('stale');
    }
  );
  it.skipIf(!environment.env)(
    'keeps the old rating history visible until repair commits and rejects a stale revision afterward',
    async () => {
      const players = await Promise.all(
        [4, 4.5, 5, 3.5].map((level, i) => world.player('read' + i, level))
      );
      const owner = players[0]!;
      const group = await confirmedGroup({
        eventId: await world.newEvent(),
        players: toQuartet(players.map((player) => player.id)),
        playedAt: await nextTailPlayedAt(),
        submittedBy: world.admin.id
      });
      const job = await queueCorrection(group, { facts: { classification: 'team_b' } });
      const before = await owner.client.rpc('get_my_rating_history', { p_limit: 1 });
      expect(before.error).toBeNull();
      const oldPage = asRecord(before.data);
      const revision = oldPage['revision'];
      if (typeof revision !== 'number') throw new Error('Missing history revision');
      const claim = await claimRepair(job.jobId);
      if (!claim.fence_token) throw new Error('Missing fence token');
      await withNoopPublication(async () => {
        const worker = await connect();
        await worker.query('begin');
        const execution = asRecord(
          (
            await worker.query(
              `select public.execute_result_repair('${job.jobId}', '${claim.fence_token}') as result`
            )
          ).rows[0]?.['result']
        );
        expect(execution['outcome']).toBe('succeeded');
        const concurrent = await withDeadline(
          Promise.resolve(
            owner.client.rpc('get_my_rating_history', {
              p_limit: 1,
              p_revision: revision
            })
          ),
          BOUND_MS,
          'rating read during repair'
        );
        expect(concurrent.error).toBeNull();
        expect(concurrent.data).toEqual(before.data);
        await worker.query('commit');
      });
      const stale = await owner.client.rpc('get_my_rating_history', {
        p_limit: 1,
        p_revision: revision
      });
      expect(stale.error?.message).toContain('RATING_REVISION_STALE');
      const refreshed = await owner.client.rpc('get_my_rating_history', { p_limit: 1 });
      expect(refreshed.error).toBeNull();
      expect(asRecord(refreshed.data)['revision']).toBe(revision + 1);
    }
  );
  it.skipIf(!environment.env)(
    'rejects a competing correction against the old base after the winner commits',
    async () => {
      const players = await Promise.all(
        [4, 4.5, 5, 3.5].map((level, i) => world.player('base' + i, level))
      );
      const group = await confirmedGroup({
        eventId: await world.newEvent(),
        players: toQuartet(players.map((player) => player.id)),
        playedAt: await nextTailPlayedAt(),
        submittedBy: world.admin.id
      });
      const job = await queueCorrection(group, { facts: { classification: 'team_b' } });
      const claim = await claimRepair(job.jobId);
      if (!claim.fence_token) throw new Error('Missing fence token');
      await withNoopPublication(async () => {
        const winner = await connect();
        const contender = await connect();
        await winner.query('begin');
        const published = asRecord(
          (
            await winner.query(
              `select public.execute_result_repair('${job.jobId}', '${claim.fence_token}') as result`
            )
          ).rows[0]?.['result']
        );
        expect(published['outcome']).toBe('succeeded');
        const { callOnConnection } = await import('./helpers/level-review-fixtures');
        const request = callOnConnection(
          contender,
          world.admin.id,
          `public.request_result_amendment('${group.proposalId}'::uuid, '${group.confirmationId}'::uuid, 'Second correction', '${crypto.randomUUID()}'::uuid)`
        );
        await waitForRows(
          `select 1 from pg_catalog.pg_stat_activity where pid = ${contender.backendPid} and wait_event_type = 'Lock'`,
          (rows) => rows.length > 0,
          'competing correction waits for sporting lock',
          BOUND_MS
        );
        await winner.query('commit');
        const result = await withDeadline(request, BOUND_MS, 'competing correction');
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('Competing correction unexpectedly succeeded');
        expect(result.message).toContain('RESULT_AMENDMENT_BASE_CONFLICT');
      });
    }
  );
  it.skipIf(!environment.env)(
    'serializes authorized repair retry and same-community confirmation without deadlock',
    async () => {
      const players = await Promise.all(
        [4, 4.5, 5, 3.5].map((level, i) => world.player('confirm-race' + i, level))
      );
      const quartet = toQuartet(players.map((player) => player.id));
      const first = await confirmedGroup({
        eventId: await world.newEvent(),
        players: quartet,
        playedAt: await nextTailPlayedAt(),
        submittedBy: world.admin.id
      });
      const later = await submitPendingGroup({
        eventId: await world.newEvent(),
        players: quartet,
        playedAt: await nextTailPlayedAt(),
        submittedBy: world.admin.id
      });
      const job = await queueCorrection(first, { facts: { classification: 'team_b' } });
      const claim = await claimRepair(job.jobId);
      if (!claim.fence_token) throw new Error('Missing fence token');
      expect((await executeRepair(job.jobId, claim.fence_token)).outcome).toBe('failed');
      const retry = await world.admin.client.rpc('retry_result_repair', { p_job_id: job.jobId });
      expect(retry.error).toBeNull();
      const attempt = asRecord(asRecord(retry.data)['claim'])['attempt_number'];
      if (typeof attempt !== 'number') throw new Error('Missing retry attempt');
      await withNoopPublication(async () => {
        const holder = await connect();
        const worker = await connect();
        const confirmer = await connect();
        await holder.query('begin');
        await holder.query('select public.lock_global_rating_projection()');
        const { callOnConnection } = await import('./helpers/level-review-fixtures');
        const repair = callOnConnection(
          worker,
          world.admin.id,
          `public.execute_claimed_result_repair('${job.jobId}'::uuid, ${attempt})`
        );
        await waitForRows(
          `select 1 from pg_catalog.pg_stat_activity where pid = ${worker.backendPid} and wait_event_type = 'Lock'`,
          (rows) => rows.length > 0,
          'repair waiting for rating lock',
          BOUND_MS
        );
        const confirmation = confirmer.query(finalizeSql(later.proposalId, 'AUTO_48H'));
        await waitForRows(
          `select 1 from pg_catalog.pg_stat_activity where pid = ${confirmer.backendPid} and wait_event_type = 'Lock'`,
          (rows) => rows.length > 0,
          'confirmation waiting for community lock',
          BOUND_MS
        );
        await holder.query('commit');
        const results = await withDeadline(
          Promise.all([repair, confirmation]),
          BOUND_MS,
          'repair and confirmation'
        );
        expect(results[0].ok).toBe(true);
        if (!results[0].ok) throw new Error(results[0].message);
        expect(asRecord(results[0].data)['outcome']).toBe('succeeded');
        expect(typeof results[1].rows[0]?.['id']).toBe('string');
      });
      expect(
        (await effectiveSources([later.proposalId])).filter((source) => source.active)
      ).toHaveLength(4);
    }
  );
  it.skipIf(!environment.env)(
    'rejects a second logical repair job for the same base at the database constraint',
    async () => {
      const job = await queued('duplicate-base');
      const contender = await connect();
      let rejection = '';
      try {
        await contender.query(`insert into public.result_repair_jobs
        (community_id, match_event_id, proposal_id, group_number, kind, amendment_id, resolution_id,
         expected_base_confirmation_id, candidate_version, command_fingerprint, reason, requested_by)
        select community_id, match_event_id, proposal_id, group_number, kind, amendment_id, resolution_id,
         expected_base_confirmation_id, candidate_version, command_fingerprint, reason, requested_by
          from public.result_repair_jobs where id = '${job.jobId}'`);
      } catch (error) {
        const { sqlErrorMessage } = await import('./helpers/sql-transport');
        rejection = sqlErrorMessage(error);
      }
      expect(rejection).toMatch(/result_repair_job_(logical_correction|amendment_unique)/);
      const claim = await claimRepair(job.jobId);
      if (!claim.fence_token) throw new Error('Missing fence token');
      expect((await executeRepair(job.jobId, claim.fence_token)).outcome).toBe('failed');
    }
  );
  it.skipIf(!environment.env)(
    'fails closed with BASE_STALE when the queued base is no longer official',
    async () => {
      const players = await Promise.all(
        [4, 4.5, 5, 3.5].map((level, i) => world.player('stale-base' + i, level))
      );
      const ids = players.map((player) => player.id);
      const group = await confirmedGroup({
        eventId: await world.newEvent(),
        players: toQuartet(ids),
        playedAt: await nextTailPlayedAt(),
        submittedBy: world.admin.id
      });
      const job = await queueCorrection(group, { facts: { classification: 'team_b' } });
      const revision = await committedRevisionNumber();
      const ratings = await ratingStates(ids);
      const sources = await sourceFingerprint([group.proposalId]);
      const ledger = await ledgerFingerprint(ids);
      // Trusted fixture simulates loss of the official base; normal commands retain their guards.
      await fixtureSql(`update public.match_event_result_official_state
      set current_confirmation_id = null, current_version = null, is_void = true,
          official_revision = official_revision + 1
      where proposal_id = '${group.proposalId}'`);
      const claim = await claimRepair(job.jobId);
      if (!claim.fence_token) throw new Error('Missing fence token');
      const worker = await connect();
      const result = asRecord(
        (
          await withDeadline(
            worker.query(
              `select public.execute_result_repair('${job.jobId}', '${claim.fence_token}') as result`
            ),
            BOUND_MS,
            'stale-base repair'
          )
        ).rows[0]?.['result']
      );
      expect(result).toMatchObject({
        outcome: 'failed',
        failure_code: 'BASE_STALE',
        failure_stage: 'base'
      });
      expect(await repairJob(job.jobId)).toMatchObject({
        status: 'failed',
        failure_code: 'BASE_STALE',
        next_attempt_at: null
      });
      expect(await committedRevisionNumber()).toBe(revision);
      expect(await ratingStates(ids)).toEqual(ratings);
      expect(await sourceFingerprint([group.proposalId])).toBe(sources);
      expect(await ledgerFingerprint(ids)).toBe(ledger);
    }
  );
  it.skipIf(!environment.env)(
    'resnapshots a superseded confirmation with the same group identity before replay',
    async () => {
      const players = await Promise.all(
        [4, 4.5, 5, 3.5].map((level, i) => world.player('coverage' + i, level))
      );
      const quartet = toQuartet(players.map((player) => player.id));
      const first = await confirmedGroup({
        eventId: await world.newEvent(),
        players: quartet,
        playedAt: await nextTailPlayedAt(),
        submittedBy: world.admin.id
      });
      const job = await queueCorrection(first, { facts: { classification: 'team_b' } });
      const foreign = await world.newCommunity();
      const racing = await confirmedGroup({
        eventId: await world.newEvent(foreign.communityId),
        players: quartet,
        playedAt: await nextTailPlayedAt(),
        submittedBy: foreign.adminId
      });
      const births = await effectiveSources([racing.proposalId]);
      expect(births).toHaveLength(4);
      // Trusted fact-only fixture leaves an already-ledgered group bound to its old source.
      // Preflight must cover the superseding v2 fact, not treat group UUID as coverage.
      const superseded = await queueCorrection(racing, { facts: { classification: 'team_b' } });
      const supersededClaim = await claimRepair(superseded.jobId);
      if (!supersededClaim.fence_token) throw new Error('Missing fence token');
      await fixtureSql(
        `select public.result_repair_apply_fact_locked('${superseded.jobId}', ${(await committedRevisionNumber()) + 1})`
      );
      expect(await executeRepair(superseded.jobId, supersededClaim.fence_token)).toMatchObject({
        outcome: 'failed',
        failure_code: 'BASE_STALE'
      });
      // Only the trusted fixture closes this fact-only amendment; production keeps publication gated.
      await fixtureSql(
        `update public.result_amendment_requests set lifecycle = 'applied', closed_at = clock_timestamp() where id = '${superseded.amendmentId}'`
      );
      const replacement = await queueCorrection(racing, {
        facts: { players: toQuartet([quartet[1], quartet[0], quartet[2], quartet[3]]) }
      });
      const replacementClaim = await claimRepair(replacement.jobId);
      if (!replacementClaim.fence_token) throw new Error('Missing fence token');
      await withNoopPublication(async () => {
        const gate = await connect();
        const worker = await connect();
        const confirmer = await connect();
        await gate.query('begin');
        await gate.query(
          "select pg_advisory_xact_lock(hashtextextended('padel-friend:test-rating-prelock', 0))"
        );
        await worker.query('begin');
        await worker.query("set local app.test_pause = 'before_rating_lock'");
        // Stage the same repair preflight explicitly: the singleton processor correctly
        // forbids two running repairs. This isolates its shared coverage primitive without
        // disabling the singleton guard or inventing an impossible second running worker.
        await worker.query(`select public.result_repair_prepare_locked('${job.jobId}')`);
        const coverage = worker.query('select public.rating_projection_lock_covered()');
        await waitForRows(
          `select 1 from pg_stat_activity where pid = ${worker.backendPid}
        and wait_event_type = 'Lock' and ${gate.backendPid} = any(pg_blocking_pids(pid))`,
          (rows) => rows.length === 1,
          'repair paused after coverage snapshot',
          BOUND_MS
        );
        // Trusted fixture splits fact selection from projection to force the exact coverage
        // transition. The guarded production confirmation insert still validates the candidate.
        const fact = await withDeadline(
          confirmer.query(
            `select public.result_repair_apply_fact_locked('${replacement.jobId}', ${(await committedRevisionNumber()) + 1}) as result`
          ),
          BOUND_MS,
          'racing corrected confirmation'
        );
        const confirmation = asRecord(fact.rows[0]?.['result'])['confirmation_id'];
        expect(confirmation).not.toBe(racing.confirmationId);
        await gate.query('commit');
        await withDeadline(coverage, BOUND_MS, 'coverage retry');
        const attempts = await worker.query(
          "select current_setting('app.test_rating_prelock_attempt')::int as attempts"
        );
        // Group-only matching returns on attempt one: this assertion catches that regression.
        expect(attempts.rows[0]?.['attempts']).toBe(2);
        await worker.query('commit');
        expect(await executeRepair(replacement.jobId, replacementClaim.fence_token!)).toMatchObject(
          {
            outcome: 'failed',
            failure_code: 'BASE_STALE'
          }
        );
        expect((await repairNow(job.jobId)).outcome).toBe('succeeded');
        const sources = (await effectiveSources([racing.proposalId])).filter(
          (source) => source.active
        );
        expect(sources).toHaveLength(4);
        expect(sources.every((source) => source.confirmationId === confirmation)).toBe(true);
        expect(sources.map((source) => source.eventId).sort()).toEqual(
          births.map((source) => source.eventId).sort()
        );
      });
    }
  );

  it.skipIf(!environment.env)(
    'keeps source appends atomic while a same-group confirmation queues behind repair',
    async () => {
      const players = await Promise.all(
        [4, 4.5, 5, 3.5].map((level, i) => world.player('append-lock' + i, level))
      );
      const group = await confirmedGroup({
        eventId: await world.newEvent(),
        players: toQuartet(players.map((player) => player.id)),
        playedAt: await nextTailPlayedAt(),
        submittedBy: world.admin.id
      });
      const job = await queueCorrection(group, { facts: { classification: 'team_b' } });
      const claim = await claimRepair(job.jobId);
      if (!claim.fence_token) throw new Error('Missing fence token');
      const before = await sourceFingerprint([group.proposalId]);
      await withNoopPublication(async () => {
        const gate = await connect();
        const worker = await connect();
        const confirmer = await connect();
        await gate.query('begin');
        await gate.query('select public.lock_global_rating_projection()');
        await worker.query('begin');
        const execution = worker.query(
          `select public.execute_result_repair('${job.jobId}', '${claim.fence_token}') as result`
        );
        const ratingWait = `select 1 from pg_stat_activity a join pg_locks l on l.pid = a.pid
        where a.pid = ${worker.backendPid} and a.wait_event_type = 'Lock'
          and l.locktype = 'advisory' and not l.granted
          and ((l.classid::bigint << 32) | l.objid::bigint)
            = hashtextextended('padel-friend:app-wide-rating-projection', 0)`;
        await waitForRows(
          ratingWait,
          (rows) => rows.length === 1,
          'source writer waits on global rating lock',
          BOUND_MS
        );
        const confirmation = confirmer.query(finalizeSql(group.proposalId, 'AUTO_48H'));
        await waitForRows(
          `select 1 from pg_stat_activity where pid = ${confirmer.backendPid}
        and wait_event_type = 'Lock' and ${worker.backendPid} = any(pg_blocking_pids(pid))`,
          (rows) => rows.length === 1,
          'same-group confirmation waits on repair sporting locks',
          BOUND_MS
        );
        expect(await sourceFingerprint([group.proposalId])).toBe(before);
        await gate.query('commit');
        const result = await withDeadline(execution, BOUND_MS, 'source append phase');
        expect(asRecord(result.rows[0]?.['result'])['outcome']).toBe('succeeded');
        const held = await worker.query(`select 1 from pg_locks where pid = pg_backend_pid()
        and locktype = 'advisory' and granted
        and ((classid::bigint << 32) | objid::bigint)
          = hashtextextended('padel-friend:app-wide-rating-projection', 0)`);
        expect(held.rows).toHaveLength(1);
        const appended =
          await worker.query(`select count(*)::int as n from public.player_rating_event_sources
        where game_group_id = '${group.proposalId}' and projection_revision = ${(await committedRevisionNumber()) + 1}`);
        expect(appended.rows[0]?.['n']).toBe(4);
        // A stale finalizer stops before projecting. Exercise the actual confirmation
        // projector separately as well, so the shared global-lock edge is proven, not inferred.
        const projector = await connect();
        await projector.query('begin');
        const projected = projector.query(
          `select public.project_confirmed_rating_group('${group.proposalId}')`
        );
        await waitForRows(
          `select 1 from pg_stat_activity a join pg_locks l on l.pid = a.pid
          where a.pid = ${projector.backendPid} and a.wait_event_type = 'Lock'
            and ${worker.backendPid} = any(pg_blocking_pids(a.pid))
            and l.locktype = 'advisory' and not l.granted
            and ((l.classid::bigint << 32) | l.objid::bigint)
              = hashtextextended('padel-friend:app-wide-rating-projection', 0)`,
          (rows) => rows.length === 1,
          'confirmation projector waits behind repair source append',
          BOUND_MS
        );
        // All four rows exist inside the writer, none outside until its atomic commit.
        expect(await sourceFingerprint([group.proposalId])).toBe(before);
        await worker.query('commit');
        const receipt = await withDeadline(
          confirmation,
          BOUND_MS,
          'same-group confirmation after repair'
        );
        // The queued command targeted version one; replacement made it stale, so no new fact.
        expect(receipt.rows[0]?.['id']).toBeNull();
        await withDeadline(projected, BOUND_MS, 'confirmation projector after repair');
        const projectorLock =
          await projector.query(`select 1 from pg_locks where pid = pg_backend_pid()
          and locktype = 'advisory' and granted
          and ((classid::bigint << 32) | objid::bigint)
            = hashtextextended('padel-friend:app-wide-rating-projection', 0)`);
        expect(projectorLock.rows).toHaveLength(1);
        const committed = await sourceFingerprint([group.proposalId]);
        await projector.query('commit');
        expect(await sourceFingerprint([group.proposalId])).toBe(committed);
      });
      // Lock order: community -> source/FK -> League -> global rating -> statistics.
      // League/statistics publication remains gated until the dependent publication unit.
      const sources = (await effectiveSources([group.proposalId])).filter(
        (source) => source.active
      );
      expect(sources).toHaveLength(4);
      expect(new Set(sources.map((source) => source.confirmationId)).size).toBe(1);
      expect(await repairJob(job.jobId)).toMatchObject({ status: 'succeeded', attempt_count: 1 });
    }
  );

  it.skipIf(!environment.env)(
    'claims a re-added provisional identity during repair without a second logical birth',
    async () => {
      if (!environment.env) throw new Error('Missing environment');
      const { claimScenario, addInvitedPlayer, verifyInvitation } =
        await import('./helpers/provisional-claim-fixtures');
      const { insertFixtureEvent, sqlText } = await import('./helpers/provisional-player-fixtures');
      const scenario = await claimScenario(environment.env, 'repair-identity');
      const invited = await addInvitedPlayer(scenario, {
        displayName: 'Replay identity',
        level: 5,
        label: 'repair-identity'
      });
      const others = await Promise.all(
        [4, 4.5, 3.5, 4].map((level, i) => world.player('identity' + i, level))
      );
      const eventId = crypto.randomUUID();
      await insertFixtureEvent({
        id: eventId,
        communityId: scenario.communityId,
        creatorId: scenario.owner.id,
        visibility: 'community_open',
        past: true
      });
      const original = toQuartet([invited.id, ...others.slice(0, 3).map((player) => player.id)]);
      const group = await confirmedGroup({
        eventId,
        players: original,
        playedAt: await nextTailPlayedAt(),
        submittedBy: scenario.owner.id
      });
      const birth = (await effectiveSources([group.proposalId])).find(
        (source) => source.userId === invited.id
      )!;
      await withNoopPublication(async () => {
        const removal = await queueCorrection(group, {
          facts: { players: toQuartet(others.map((player) => player.id)) }
        });
        expect((await repairNow(removal.jobId)).outcome).toBe('succeeded');
        expect(
          (await effectiveSources([group.proposalId])).find(
            (source) => source.userId === invited.id
          )?.active
        ).toBe(false);
        const readdition = await queueCorrection(group, { facts: { players: original } });
        const claim = await claimRepair(readdition.jobId);
        if (!claim.fence_token) throw new Error('Missing fence token');
        const verified = await verifyInvitation(scenario.env, invited.tokenHash);
        expect(verified.error).toBeNull();
        const session = verified.data.session;
        if (!session) throw new Error('Missing verified invitation session');
        const jwtClaims = Buffer.from(session.access_token.split('.')[1]!, 'base64url').toString(
          'utf8'
        );
        const gate = await connect();
        const worker = await connect();
        const claimant = await connect();
        await gate.query('begin');
        await gate.query('select public.lock_global_rating_projection()');
        const execution = worker.query(
          `select public.execute_result_repair('${readdition.jobId}', '${claim.fence_token}') as result`
        );
        await waitForRows(
          `select 1 from pg_stat_activity where pid = ${worker.backendPid}
        and wait_event_type = 'Lock' and ${gate.backendPid} = any(pg_blocking_pids(pid))`,
          (rows) => rows.length === 1,
          're-add repair waits on global rating lock',
          BOUND_MS
        );
        await claimant.query('begin');
        await claimant.query(
          `select set_config('request.jwt.claims', ${sqlText(jwtClaims)}, true)`
        );
        await claimant.query('set local role authenticated');
        const onboarding = claimant.query(
          "select public.claim_provisional_player(p_display_name => 'Replay identity', p_preferred_side => 'LEFT', p_initial_level => 5)"
        );
        await waitForRows(
          `select 1 from pg_stat_activity where pid = ${claimant.backendPid}
        and wait_event_type = 'Lock'`,
          (rows) => rows.length === 1,
          'identity claim races re-add repair',
          BOUND_MS
        );
        await gate.query('commit');
        const [repaired, claimed] = await withDeadline(
          Promise.all([execution, onboarding]),
          BOUND_MS,
          'identity claim and repair'
        );
        expect(asRecord(repaired.rows[0]?.['result'])['outcome']).toBe('succeeded');
        expect(claimed.rows).toHaveLength(1);
        await claimant.query('commit');
        const readded = (await effectiveSources([group.proposalId])).find(
          (source) => source.userId === invited.id
        )!;
        expect(readded).toMatchObject({ eventId: birth.eventId, active: true });
        expect(
          await sqlRows(`select count(*)::int as n from public.player_rating_events
        where game_group_id = '${group.proposalId}' and user_id = '${invited.id}'`)
        ).toEqual([{ n: 1 }]);
        expect(
          await sqlRows(
            `select is_provisional from public.player_profiles where user_id = '${invited.id}'`
          )
        ).toEqual([{ is_provisional: false }]);
        expect(await repairJob(readdition.jobId)).toMatchObject({
          status: 'succeeded',
          attempt_count: 1
        });
      });
    }
  );

  it.skipIf(!environment.env)(
    'waits for corrected participant source locks before replay',
    async () => {
      const players = await Promise.all(
        [4, 4.5, 5, 3.5].map((level, i) => world.player('source-lock' + i, level))
      );
      const group = await confirmedGroup({
        eventId: await world.newEvent(),
        players: toQuartet(players.map((player) => player.id)),
        playedAt: await nextTailPlayedAt(),
        submittedBy: world.admin.id
      });
      const job = await queueCorrection(group, { facts: { classification: 'team_b' } });
      const claim = await claimRepair(job.jobId);
      if (!claim.fence_token) throw new Error('Missing fence token');
      await withNoopPublication(async () => {
        const holder = await connect();
        const worker = await connect();
        await holder.query('begin');
        await holder.query(
          `select user_id from public.player_profiles where user_id = '${players[0]!.id}' for update`
        );
        const repair = worker.query(
          `select public.execute_result_repair('${job.jobId}', '${claim.fence_token}') as result`
        );
        await waitForRows(
          `select 1 from pg_catalog.pg_stat_activity where pid = ${worker.backendPid} and wait_event_type = 'Lock'`,
          (rows) => rows.length > 0,
          'repair waiting for participant source lock',
          BOUND_MS
        );
        await holder.query('commit');
        const result = await withDeadline(repair, BOUND_MS, 'repair after participant source lock');
        expect(asRecord(result.rows[0]?.['result'])['outcome']).toBe('succeeded');
      });
      expect(
        (await effectiveSources([group.proposalId])).filter((source) => source.active)
      ).toHaveLength(4);
    }
  );
});
