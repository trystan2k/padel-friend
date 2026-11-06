import { expect, type Browser } from '@playwright/test';
import { parseResultProposals } from '../src/features/matches/match-result-model';
import {
  parseResultAmendments,
  parseResultAmendmentReceipt
} from '../src/features/matches/result-amendment-model';
import { runMatchFixtureCleanup } from './match-fixture-cleanup';
import { resultFixtures, sql, type Actor } from './matches-results-fixtures';

export { copies, fill } from './matches-results-fixtures';
export const playedLocal = {
  local: '2026-10-23 18:30:00',
  offset_seconds: 0,
  instant: '2026-10-23T18:30:00Z'
};
export const winningSets = [
  { position: 1, team_a_games: 6, team_b_games: 2, completed: true },
  { position: 2, team_a_games: 6, team_b_games: 4, completed: true }
];
export const correctedSets = [
  { position: 1, team_a_games: 2, team_b_games: 6, completed: true },
  { position: 2, team_a_games: 4, team_b_games: 6, completed: true }
];

type RepairClaim = { status: 'claimed'; token: string } | { status: 'succeeded' | 'failed' };

/** Claims a queued repair as the scheduler would, or reports the terminal state another runner reached. */
export async function claimRepair(jobId: string): Promise<RepairClaim> {
  let receipt: RepairClaim | null = null;
  await expect
    .poll(
      async () => {
        const [job] = await sql(`select status from public.result_repair_jobs where id='${jobId}'`);
        if (job?.['status'] === 'succeeded' || job?.['status'] === 'failed') {
          receipt = { status: job['status'] };
          return true;
        }
        const [claim] = await sql(
          `select public.claim_result_repair_job('${jobId}',600)->>'fence_token' as token`
        );
        if (typeof claim?.['token'] !== 'string') return false;
        receipt = { status: 'claimed', token: claim['token'] };
        return true;
      },
      { timeout: 90_000, intervals: [100, 250, 500] }
    )
    .toBe(true);
  if (!receipt) throw new Error('Repair claim missing');
  return receipt;
}

/** Runs one queued repair to its outcome through the production claim and execute commands. */
export async function repairNow(jobId: string): Promise<string> {
  const claim = await claimRepair(jobId);
  if (claim.status !== 'claimed') return claim.status;
  const [result] = await sql(
    `select public.execute_result_repair('${jobId}','${claim.token}')->>'outcome' as outcome`
  );
  return String(result?.['outcome']);
}

/** Real authenticated commands only for proposals, reviews, amendments and decisions. */
export async function amendmentFixtures(browser: Browser) {
  const f = await resultFixtures(browser, { memberCount: 7 });
  const actors = [f.creator, ...f.members, f.guest];
  const actorFor = (id: string) => {
    const actor = actors.find((item) => item.id === id);
    if (!actor) throw new Error('Unknown fixture actor');
    return actor;
  };
  async function proposal(eventId: string, who = f.creator) {
    const rows = parseResultProposals(
      await f.rpc(who, 'get_match_event_result_proposals', { p_match_event_id: eventId })
    );
    if (!rows?.[0]) throw new Error('Missing proposal');
    return rows[0];
  }
  async function amendments(eventId: string, who = f.creator) {
    const rows = parseResultAmendments(
      await f.rpc(who, 'get_result_amendments', { p_match_event_id: eventId }),
      eventId
    );
    if (!rows) throw new Error('Invalid amendment response');
    return rows;
  }
  async function confirmed(type: 'competitive' | 'friendly' = 'competitive', incomplete = false) {
    const eventId = await f.completedEvent(type, 4);
    const teams = {
      team_a: [f.creator.id, f.members[0]!.id],
      team_b: [f.members[1]!.id, f.members[2]!.id]
    };
    await f.rpc(f.creator, 'submit_match_event_result', {
      p_match_event_id: eventId,
      p_group_number: 1,
      p_teams: teams,
      p_sets: incomplete
        ? [{ position: 1, team_a_games: 2, team_b_games: 1, completed: false }]
        : winningSets,
      p_played_local: playedLocal,
      p_court_label: 'Court 2',
      p_request_id: crypto.randomUUID()
    });
    const pending = await proposal(eventId);
    await f.rpc(f.members[1]!, 'review_match_event_result', {
      p_proposal_id: pending.proposal_id,
      p_expected_version: pending.version,
      p_decision: 'approve',
      p_request_id: crypto.randomUUID()
    });
    const original = await proposal(eventId);
    expect(original.status).toBe('confirmed');
    if (!original.confirmation) throw new Error('No confirmation');
    return { eventId, original, teams, baseId: original.confirmation.confirmation_id };
  }
  type Group = Awaited<ReturnType<typeof confirmed>>;
  async function requested(group: Group, who: Actor = f.creator) {
    const response = parseResultAmendmentReceipt(
      await f.rpc(who, 'request_result_amendment', {
        p_proposal_id: group.original.proposal_id,
        p_expected_confirmation_id: group.baseId,
        p_reason: 'Score recorded backwards',
        p_command_id: crypto.randomUUID()
      })
    );
    if (response?.status !== 'ok') throw new Error('Amendment request failed');
    return response.value.amendment_id;
  }
  async function candidate(group: Group, amendmentId: string, expectedVersion?: number) {
    const response = parseResultAmendmentReceipt(
      await f.rpc(f.creator, 'submit_result_amendment_candidate', {
        p_amendment_id: amendmentId,
        p_expected_base_confirmation_id: group.baseId,
        ...(expectedVersion ? { p_expected_candidate_version: expectedVersion } : {}),
        p_teams: group.teams,
        p_sets: correctedSets,
        p_played_local: playedLocal,
        p_court_label: expectedVersion ? 'Court 3' : 'Court 2',
        p_command_id: crypto.randomUUID()
      })
    );
    if (response?.status !== 'ok' || response.value.candidate_version === null)
      throw new Error('Candidate submission failed');
    return response.value.candidate_version;
  }
  async function accepted(group: Group) {
    const amendmentId = await requested(group);
    const version = await candidate(group, amendmentId);
    await f.rpc(f.members[1]!, 'review_result_amendment', {
      p_amendment_id: amendmentId,
      p_expected_base_confirmation_id: group.baseId,
      p_expected_candidate_version: version,
      p_decision: 'approve',
      p_command_id: crypto.randomUUID()
    });
    const amendment = (await amendments(group.eventId))[0];
    expect(amendment?.pending_application).toBe(true);
    if (!amendment?.repair_job_id) throw new Error('No queued repair');
    return { amendmentId, version, jobId: amendment.repair_job_id };
  }
  async function grantAdmin(who: Actor = f.creator) {
    await sql(
      `update public.community_members set role='admin' where community_id='${f.community}' and user_id='${who.id}'`
    );
  }
  async function cleanup() {
    // Shared dependency-aware cleanup removes sources/jobs before their immutable parent facts.
    await runMatchFixtureCleanup({ actorIds: actors.map((actor) => actor.id) });
    await sql(
      `delete from public.platform_admins where user_id in (${actors.map((actor) => `'${actor.id}'`).join(',')})`
    );
    await f.cleanup();
  }
  return {
    ...f,
    actorFor,
    proposal,
    amendments,
    confirmed,
    requested,
    candidate,
    accepted,
    claimRepair,
    grantAdmin,
    cleanup
  };
}
