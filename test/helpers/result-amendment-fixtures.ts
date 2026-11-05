import { asRecord, fixtureSql, sqlRows } from './match-registration-sql';
import type { ManagementActor } from './match-management-fixtures';
import {
  createMatchResultReviewFixtures,
  reviewResultPlayedAt,
  type ResultTeams
} from './match-result-review-fixtures';

export const originalResultSets = [
  { position: 1, team_a_games: 6, team_b_games: 4, completed: true },
  { position: 2, team_a_games: 6, team_b_games: 3, completed: true }
];

export const correctedResultSets = [
  { position: 1, team_a_games: 3, team_b_games: 6, completed: true },
  { position: 2, team_a_games: 2, team_b_games: 6, completed: true }
];

export type ConfirmedGroup = {
  eventId: string;
  proposalId: string;
  confirmationId: string;
};

function firstQuartet(
  players: ManagementActor[]
): [ManagementActor, ManagementActor, ManagementActor, ManagementActor] {
  const [a, b, c, d] = players;
  if (!a || !b || !c || !d) throw new Error('RESULT_FIXTURE_GROUP_MISSING');
  return [a, b, c, d];
}

/** Real users, a frozen roster and an official (confirmed) group ready for correction. */
export async function createResultAmendmentFixtures(
  env: { url: string; key: string },
  options: { onboard?: boolean } = {}
) {
  const base = await createMatchResultReviewFixtures(env);
  const [p0, p1, p2, p3] = firstQuartet(base.players);

  // Rated (competitive) groups need rating state, which onboarding provisions.
  for (const [index, player] of (options.onboard === false ? [] : [p0, p1, p2, p3]).entries()) {
    const onboarded = await player.client.rpc('onboard_player', {
      p_display_name: `Amendment Player ${index}`,
      p_preferred_side: 'EITHER',
      p_initial_level: 3 + index / 2
    });
    if (onboarded.error) throw new Error(`Fixture onboarding failed: ${onboarded.error.message}`);
  }

  // Original arrangement is {p0,p1} vs {p2,p3}; the corrected one pairs p0 with p2.
  const correctedTeams: ResultTeams = {
    team_a: [p0.id, p2.id],
    team_b: [p1.id, p3.id]
  };

  async function confirmedGroup(
    groupOptions: { competitive?: boolean } = {}
  ): Promise<ConfirmedGroup> {
    const eventId = await base.protectedEvent({ competitive: groupOptions.competitive });
    const submitted = await base.submit(eventId, { sets: originalResultSets });
    if (submitted.error) throw new Error(String(submitted.error.message));
    const proposalId = String(asRecord(submitted.data).proposal_id);
    const approval = await base.rpc(p2, 'review_match_event_result', {
      p_proposal_id: proposalId,
      p_expected_version: 1,
      p_decision: 'approve',
      p_reason_code: null,
      p_reason_note: null,
      p_request_id: crypto.randomUUID()
    });
    const confirmationId = asRecord(approval.data).confirmation_id;
    if (approval.error || typeof confirmationId !== 'string')
      throw new Error(`Fixture group did not confirm: ${JSON.stringify(approval.error)}`);
    return { eventId, proposalId, confirmationId };
  }

  function request(
    actor: ManagementActor,
    group: ConfirmedGroup,
    patch: Record<string, unknown> = {}
  ) {
    return base.rpc(actor, 'request_result_amendment', {
      p_proposal_id: group.proposalId,
      p_expected_confirmation_id: group.confirmationId,
      p_reason: 'Score was entered wrongly',
      p_command_id: crypto.randomUUID(),
      ...patch
    });
  }

  function candidate(
    actor: ManagementActor,
    group: ConfirmedGroup,
    amendmentId: string,
    patch: Record<string, unknown> = {}
  ) {
    return base.rpc(actor, 'submit_result_amendment_candidate', {
      p_amendment_id: amendmentId,
      p_expected_base_confirmation_id: group.confirmationId,
      p_teams: correctedTeams,
      p_sets: correctedResultSets,
      p_played_local: reviewResultPlayedAt,
      p_court_label: 'Court 3',
      p_command_id: crypto.randomUUID(),
      ...patch
    });
  }

  function review(
    actor: ManagementActor,
    group: ConfirmedGroup,
    amendmentId: string,
    version: number,
    patch: Record<string, unknown> = {}
  ) {
    return base.rpc(actor, 'review_result_amendment', {
      p_amendment_id: amendmentId,
      p_expected_base_confirmation_id: group.confirmationId,
      p_expected_candidate_version: version,
      p_decision: 'approve',
      p_command_id: crypto.randomUUID(),
      ...patch
    });
  }

  function cancel(
    actor: ManagementActor,
    amendmentId: string,
    patch: Record<string, unknown> = {}
  ) {
    return base.rpc(actor, 'cancel_result_amendment', {
      p_amendment_id: amendmentId,
      p_command_id: crypto.randomUUID(),
      ...patch
    });
  }

  /** Opens a request and a first corrected candidate (submitted by the given actor). */
  async function openCandidate(group: ConfirmedGroup, submitter: ManagementActor = p0) {
    const requested = await request(p0, group);
    const amendmentId = String(asRecord(requested.data).amendment_id);
    const submitted = await candidate(submitter, group, amendmentId);
    if (submitted.error) throw new Error(String(submitted.error.message));
    return { amendmentId, version: Number(asRecord(submitted.data).candidate_version) };
  }

  /** Moves a candidate's fresh 48h window into the past (trusted fixture time travel only). */
  async function expireCandidate(proposalId: string, version: number) {
    await fixtureSql(`do $$ begin
      alter table public.match_event_result_proposal_versions disable trigger match_result_proposal_version_immutable;
      update public.match_event_result_proposal_versions
         set submitted_at = submitted_at - interval '49 hours',
             review_deadline_at = review_deadline_at - interval '49 hours'
       where proposal_id = '${proposalId}' and version = ${version};
      alter table public.match_event_result_proposal_versions enable trigger match_result_proposal_version_immutable;
    end $$;`);
  }

  /** Byte-comparable fingerprint of every original (version 1) fact and its evidence. */
  async function originalEvidence(eventId: string): Promise<string> {
    const rows = await sqlRows(`select jsonb_build_object(
      'proposals', (select jsonb_agg(to_jsonb(p) order by p.id) from public.match_event_result_proposals p
         where p.match_event_id = '${eventId}'),
      'versions', (select jsonb_agg(to_jsonb(v) order by v.proposal_id) from public.match_event_result_proposal_versions v
         join public.match_event_result_proposals p on p.id = v.proposal_id
        where p.match_event_id = '${eventId}' and v.version = 1),
      'reviews', (select jsonb_agg(to_jsonb(r) order by r.id) from public.match_event_result_reviews r
         join public.match_event_result_proposals p on p.id = r.proposal_id
        where p.match_event_id = '${eventId}' and r.proposal_version = 1),
      'confirmations', (select jsonb_agg(to_jsonb(c) order by c.id) from public.match_event_result_confirmations c
        where c.match_event_id = '${eventId}'),
      'official', (select jsonb_agg(to_jsonb(s) order by s.proposal_id) from public.match_event_result_official_state s
        where s.match_event_id = '${eventId}'),
      'audit', (select jsonb_agg(to_jsonb(a) order by a.id) from public.match_event_audit_log a
        where a.match_event_id = '${eventId}'
          and a.action in ('result_approved', 'result_disputed', 'result_corrected', 'result_confirmed'))
    )::text as evidence`);
    return String(rows[0]!['evidence']);
  }

  /** Rating, statistics and League projection fingerprint for the group's players and event. */
  async function projectionFingerprint(group: ConfirmedGroup): Promise<string> {
    const ids = base.players
      .slice(0, 4)
      .map(({ id }) => "'" + id + "'")
      .join(',');
    const rows = await sqlRows(`select jsonb_build_object(
      'events', (select count(*) from public.player_rating_events e where e.game_group_id = '${group.proposalId}'),
      'calculations', (select count(*) from public.player_rating_event_calculations c
         join public.player_rating_events e on e.id = c.rating_event_id
        where e.game_group_id = '${group.proposalId}'),
      'ratings', (select jsonb_agg(to_jsonb(r) order by r.user_id) from public.global_player_ratings r
        where r.user_id in (${ids})),
      'facts', (select count(*) from public.statistics_group_facts f where f.game_group_id = '${group.proposalId}'),
      'lifecycle', (select public.match_event_result_summary('${group.eventId}'))
    )::text as fingerprint`);
    return String(rows[0]!['fingerprint']);
  }

  function resolve(
    actor: ManagementActor,
    proposalId: string,
    version: number,
    decision: string,
    patch: Record<string, unknown> = {}
  ) {
    return base.rpc(actor, 'resolve_result_dispute', {
      p_proposal_id: proposalId,
      p_expected_candidate_version: version,
      p_decision: decision,
      p_justification: 'Court booking record confirms the score',
      p_command_id: crypto.randomUUID(),
      ...patch
    });
  }

  /** Confirmed group + corrected candidate that a corrected-team player rejected. */
  async function disputedCandidate(group: ConfirmedGroup) {
    const opened = await openCandidate(group, p0);
    const rejected = await review(p1, group, opened.amendmentId, opened.version, {
      p_decision: 'reject',
      p_reason_code: 'SCORE_INCORRECT'
    });
    if (rejected.error) throw new Error(String(rejected.error.message));
    return opened;
  }

  /** Never-confirmed result whose only version was rejected (status disputed). */
  async function disputedOriginal(original: { competitive?: boolean } = {}) {
    const eventId = await base.protectedEvent({ competitive: original.competitive });
    const submitted = await base.submit(eventId, { sets: originalResultSets });
    if (submitted.error) throw new Error(String(submitted.error.message));
    const proposalId = String(asRecord(submitted.data).proposal_id);
    const rejected = await base.rpc(p2, 'review_match_event_result', {
      p_proposal_id: proposalId,
      p_expected_version: 1,
      p_decision: 'reject',
      p_reason_code: 'SCORE_INCORRECT',
      p_reason_note: null,
      p_request_id: crypto.randomUUID()
    });
    if (rejected.error) throw new Error(String(rejected.error.message));
    return { eventId, proposalId };
  }

  async function revokeAdmin(actor: ManagementActor) {
    await fixtureSql(`do $$ begin
      alter table public.community_members disable trigger community_member_guard;
      update public.community_members set role='member'
       where community_id='${base.communityId}' and user_id='${actor.id}';
      alter table public.community_members enable trigger community_member_guard;
    end $$;`);
  }

  async function repairJobs(proposalId: string) {
    return sqlRows(
      `select * from public.result_repair_jobs where proposal_id = '${proposalId}' order by requested_at`
    );
  }

  async function amendmentRow(amendmentId: string) {
    const rows = await sqlRows(
      `select * from public.result_amendment_requests where id = '${amendmentId}'`
    );
    return rows[0]!;
  }

  async function officialState(proposalId: string) {
    const rows = await sqlRows(
      `select * from public.match_event_result_official_state where proposal_id = '${proposalId}'`
    );
    return rows[0];
  }

  return {
    ...base,
    p0,
    p1,
    p2,
    p3,
    correctedTeams,
    confirmedGroup,
    request,
    candidate,
    review,
    cancel,
    resolve,
    disputedCandidate,
    disputedOriginal,
    revokeAdmin,
    repairJobs,
    openCandidate,
    expireCandidate,
    originalEvidence,
    projectionFingerprint,
    amendmentRow,
    officialState
  };
}
