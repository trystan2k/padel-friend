import { afterAll, describe, expect, it } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { sqlRows } from './helpers/match-registration-sql';
import { sqlText } from './helpers/provisional-player-fixtures';
import { createRankedResultFixtures, type RankedResultKit } from './helpers/ranked-result-fixtures';
import {
  backdateMemberships,
  closeLeague,
  confirmRankedGroup,
  dayAt,
  installFailure,
  leagueCounters,
  leagueRevisionEvents,
  normalizeEntries,
  publicationCounts,
  removeFailure,
  standingsSnapshots,
  type ConfirmedGroup
} from './helpers/result-correction-fixtures';
import {
  committedRevisionNumber,
  queueCorrection,
  repairAttempts,
  repairJob,
  repairNow,
  requeueJob,
  sourceFingerprint
} from './helpers/result-replay-fixtures';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

/**
 * PAF-14 / T15.4: the League standings, the statistics replacement, the rating revision, the audit
 * and the completion notice publish in ONE transaction. A failure injected after the League
 * snapshot, or after the statistics, rolls everything back; the retry equals a clean run.
 */
describe.skipIf(!environment.env)('atomic correction publication', { timeout: 600_000 }, () => {
  const anchor = new Date(Date.now() - 40 * 86_400_000);
  const kits: RankedResultKit[] = [];
  afterAll(async () => {
    for (const kit of kits) await kit.cleanup();
  });

  type World = {
    kit: RankedResultKit;
    leagueId: string;
    october: ConfirmedGroup;
    november: ConfirmedGroup;
  };

  async function world(): Promise<World> {
    const kit = await createRankedResultFixtures(environment.env!, {
      levels: [7, 6, 5, 4, 4, 4, 4, 4]
    });
    kits.push(kit);
    await backdateMemberships(kit, new Date(Date.now() - 90 * 86_400_000).toISOString());
    const leagueId = await kit.league({
      status: 'active',
      endMode: 'manual',
      endAt: null,
      startAt: dayAt(anchor, 0)
    });
    const october = await confirmRankedGroup(kit, {
      eventId: await kit.event(leagueId),
      playedAt: dayAt(anchor, 2)
    });
    const november = await confirmRankedGroup(kit, {
      eventId: await kit.event(leagueId),
      playedAt: dayAt(anchor, 12),
      classification: 'team_b'
    });
    await closeLeague(kit, leagueId);
    return { kit, leagueId, october, november };
  }

  /** Everything a rolled-back repair must leave byte-identical. */
  async function observable(w: World) {
    const proposals = [w.october.proposalId, w.november.proposalId];
    const ids = proposals.map(sqlText).join(',');
    const players = w.kit.players.map((p) => sqlText(p.id)).join(',');
    const [state] = await sqlRows(
      "select (select md5(coalesce(string_agg(to_jsonb(o)::text, '' order by proposal_id), '')) from public.match_event_result_official_state o " +
        'where proposal_id in (' +
        ids +
        ')) as official, ' +
        "(select md5(coalesce(string_agg(to_jsonb(s)::text, '' order by subject_kind, subject_a, subject_b, scope_kind, scope_id, match_type), '')) " +
        'from public.statistics_scope_summaries s where subject_players && array[' +
        players +
        ']::uuid[]) as summaries, ' +
        "(select md5(coalesce(string_agg(to_jsonb(f)::text, '' order by game_group_id), '')) from public.statistics_group_facts f where game_group_id in (" +
        ids +
        ')) as facts, ' +
        "(select md5(coalesce(string_agg(to_jsonb(p)::text, '' order by game_group_id, user_id), '')) from public.statistics_participant_facts p where game_group_id in (" +
        ids +
        ')) as participants, ' +
        "(select md5(coalesce(string_agg(to_jsonb(t)::text, '' order by community_id, player_id, effective_from), '')) from public.statistics_rank_transitions t where community_id = " +
        sqlText(w.kit.communityId) +
        ') as ranks, ' +
        '(select lifecycle from public.result_amendment_requests where proposal_id = ' +
        sqlText(w.october.proposalId) +
        ' limit 1) as lifecycle'
    );
    return {
      state,
      rating: await committedRevisionNumber(),
      sources: await sourceFingerprint(proposals),
      snapshots: await standingsSnapshots(w.leagueId),
      counters: await leagueCounters(w.leagueId),
      revisions: await leagueRevisionEvents(w.leagueId),
      counts: await publicationCounts(w.leagueId, proposals)
    };
  }

  /** Player-index normalized outcome so two independent worlds can be compared. */
  async function normalized(w: World) {
    const order = new Map(w.kit.players.map((p, index) => [p.id, index]));
    const at = (id: unknown) => order.get(String(id));
    return {
      snapshots: (await standingsSnapshots(w.leagueId)).map((s) => ({
        version: s['version'],
        cause: s['cause'],
        prior: s['prior'],
        included: s['included'],
        entries: normalizeEntries(s['entries'])
          .map((e) => ({ ...e, u: at(e.u) }))
          .sort((a, b) => Number(a.u) - Number(b.u))
      })),
      counters: (await leagueCounters(w.leagueId))
        .map((c) => ({ ...c, user_id: at(c['user_id']) }))
        .sort((a, b) => Number(a.user_id) - Number(b.user_id)),
      counts: await (async () => {
        const c = await publicationCounts(w.leagueId, [
          w.october.proposalId,
          w.november.proposalId
        ]);
        return {
          snapshots: c['snapshots'],
          events: c['league_events'],
          receipts: c['receipts'],
          notices: c['completion_notices'],
          audits: c['completion_audits'],
          stat_groups: c['stat_groups']
        };
      })()
    };
  }

  async function failThenRetry(
    inject: { name: string; table: string; timing: 'insert' | 'update'; when: string },
    stage: string
  ) {
    const w = await world();
    const before = await observable(w);
    const job = await queueCorrection(w.october, { facts: { classification: 'team_b' } });
    await installFailure(inject.name, inject.table, inject.timing, inject.when);
    let receipt;
    try {
      receipt = await repairNow(job.jobId);
    } finally {
      await removeFailure(inject.name, inject.table);
    }
    expect(receipt).toMatchObject({ outcome: 'failed', failure_stage: stage });
    const failedJob = await repairJob(job.jobId);
    expect(failedJob).toMatchObject({
      status: 'failed',
      failure_stage: stage,
      committed_revision: null
    });

    // Full rollback: no orphan final, no partial counters or statistics, no completion notice.
    const afterFailure = await observable(w);
    const withoutQueue = (value: Awaited<ReturnType<typeof observable>>) => ({
      ...value,
      state: { ...value.state, lifecycle: undefined }
    });
    expect(withoutQueue(afterFailure)).toEqual(withoutQueue(before));
    expect(afterFailure.state!['lifecycle']).toBe('approved_pending_repair');
    expect(afterFailure.counts).toMatchObject({
      snapshots: 1,
      completion_notices: 0,
      completion_audits: 0
    });
    const failedAttempts = await repairAttempts(job.jobId);
    expect(failedAttempts.map((a) => a['status'])).toEqual(['failed']);

    // Retry of the same logical job converges and publishes exactly once.
    await requeueJob(job.jobId);
    expect((await repairNow(job.jobId)).outcome).toBe('succeeded');
    expect((await repairAttempts(job.jobId)).map((a) => a['status'])).toEqual([
      'failed',
      'succeeded'
    ]);
    return { w, job };
  }

  it('rolls everything back after the League snapshot and before the statistics, then converges', async () => {
    const { w, job } = await failThenRetry(
      {
        name: 'after_snapshot',
        table: 'public.league_standings_snapshots',
        timing: 'insert',
        when: 'new.repair_job_id is not null'
      },
      'publish'
    );
    const clean = await world();
    const cleanJob = await queueCorrection(clean.october, { facts: { classification: 'team_b' } });
    expect((await repairNow(cleanJob.jobId)).outcome).toBe('succeeded');
    expect(await normalized(w)).toEqual(await normalized(clean));

    const snapshots = await standingsSnapshots(w.leagueId);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1]).toMatchObject({ cause: 'result_amendment', prior: 1, job: job.jobId });
    const counts = await publicationCounts(w.leagueId, [
      w.october.proposalId,
      w.november.proposalId
    ]);
    expect(counts).toMatchObject({ snapshots: 2, league_events: 1, completion_audits: 1 });
    // One notice per recipient of the corrected result (the quartet; the creator plays in it).
    expect(counts['completion_notices']).toBe(4);
  });

  it('rolls everything back after the statistics and before completion, then converges', async () => {
    const { w, job } = await failThenRetry(
      {
        name: 'before_completion',
        table: 'public.result_amendment_requests',
        timing: 'update',
        when: "new.lifecycle = 'applied'"
      },
      'complete'
    );
    const clean = await world();
    const cleanJob = await queueCorrection(clean.october, { facts: { classification: 'team_b' } });
    expect((await repairNow(cleanJob.jobId)).outcome).toBe('succeeded');
    expect(await normalized(w)).toEqual(await normalized(clean));
    expect((await repairJob(job.jobId))['status']).toBe('succeeded');
  });

  it('publishes the completion audit and notice once, with the old and new revisions, and repeats add nothing', async () => {
    const w = await world();
    const job = await queueCorrection(w.october, { facts: { classification: 'team_b' } });
    const receipt = await repairNow(job.jobId);
    expect(receipt.outcome).toBe('succeeded');
    const settled = await observable(w);
    const [audit] = await sqlRows(
      "select after_data from public.match_event_audit_log where action = 'result_repair_applied' and match_event_id = " +
        sqlText(w.october.eventId)
    );
    expect(audit!['after_data']).toMatchObject({
      old_standings_version: 1,
      new_standings_version: 2,
      old_official_revision: 1,
      new_official_revision: 2,
      rating_revision: receipt.revision
    });
    const attempts = await repairAttempts(job.jobId);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!['publication']).toMatchObject({
      new_standings_version: 2,
      rating_revision: receipt.revision
    });

    // Repeating the publication (retry after commit, duplicate delivery) changes nothing.
    for (let i = 0; i < 2; i += 1)
      await sqlRows(
        'select public.result_repair_publish_derived(' +
          sqlText(job.jobId) +
          ', ' +
          String(receipt.revision) +
          ')'
      );
    const [claim] = await sqlRows(
      'select public.claim_result_repair_job(' + sqlText(job.jobId) + ')::text as r'
    );
    expect(JSON.parse(String(claim!['r']))).toMatchObject({ claimed: false });
    expect(await observable(w)).toEqual(settled);
  });
});
