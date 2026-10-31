import { MATCH_RESULT_ERROR_COPY, type MatchResultErrorCode } from './match-result-error-copy';
import { validateMatchUuid } from './matches.validators';
import {
  RESULT_REJECTION_REASONS,
  classifyMatchResultSets,
  validateMatchResultSets,
  validateMatchResultTeams,
  validateResultPlayedLocal
} from './match-result.validators';

export type ResultClassification = 'team_a' | 'team_b' | 'draw' | 'incomplete';

export type ResultSetRow = {
  position: number;
  team_a_games: number;
  team_b_games: number;
  completed: boolean;
};

export type ResultTeams = {
  team_a: [string, string];
  team_b: [string, string];
};

export type ResultValidationDetail = {
  // One-based array index, not an untrusted submitted position; null for collection errors.
  set_index: number | null;
  side: 'team_a' | 'team_b' | null;
  reason_token: string;
};

export type MatchResultResponse<T> =
  | { status: 'ok'; value: T; replayed: boolean }
  | {
      status: 'conflict';
      code: 'active_proposal';
      active_version: number;
      review_deadline_at: string;
    }
  | { status: 'error'; code: MatchResultErrorCode; detail?: ResultValidationDetail };

export type ResultCommandResponse<T> =
  | { status: 'ok'; value: T; replayed: boolean }
  | {
      status: 'conflict';
      code: 'stale_version';
      current_version: number;
      current_status: ResultProposalStatus;
    }
  | {
      status: 'conflict';
      code: 'deadline_elapsed';
      current_version: number;
      current_status: 'confirmed';
      confirmation_id: string;
    }
  | { status: 'error'; code: MatchResultErrorCode; detail?: ResultValidationDetail };

export type ResultSubmission = {
  event_id: string;
  proposal_id: string;
  group_number: number;
  version: number;
  submitted_at: string;
  review_deadline_at: string;
  request_id: string;
};
export type ResultPlayer = {
  user_id: string;
  display_name: string | null;
  is_provisional: boolean;
};
export type ResultProposalStatus = 'pending' | 'disputed' | 'confirmed';
export type ResultDecision = 'approve' | 'reject';
export type ResultConfirmationSource = 'MANUAL' | 'AUTO_48H';
export type ResultConfirmation = {
  confirmation_id: string;
  source: ResultConfirmationSource;
  confirmed_at: string;
  effective_at: string;
  actor_id: string | null;
};
export type ResultDisputeEvidence = {
  rejector_id: string;
  rejector_name: string | null;
  reason_code: ResultRejectionReason;
  reason_note: string | null;
  decided_at: string;
};
export type ResultRejectionReason = (typeof RESULT_REJECTION_REASONS)[number];
export type ResultDecisionEvidence = {
  reviewer_id: string;
  reviewer_name: string | null;
  decision: ResultDecision;
  reason_code: ResultRejectionReason | null;
  reason_note: string | null;
  decided_at: string;
};
export type ResultVersionTimelineEntry = {
  version: number;
  status: ResultProposalStatus | 'superseded';
  submitted_by: string;
  submitted_by_name: string | null;
  submitted_at: string;
  review_deadline_at: string;
  decisions: ResultDecisionEvidence[];
  confirmation_id: string | null;
};
export type ResultProposal = Omit<ResultSubmission, 'request_id'> & {
  status: ResultProposalStatus;
  teams: { team_a: [ResultPlayer, ResultPlayer]; team_b: [ResultPlayer, ResultPlayer] };
  sets: ResultSetRow[];
  classification: ResultClassification;
  played_at_utc: string;
  played_at_local: string;
  played_at_offset_seconds: number;
  court_label: string | null;
  rating_effective: boolean;
  submitted_by: string;
  submitted_by_name: string | null;
  can_approve: boolean;
  can_reject: boolean;
  can_correct: boolean;
  caller_decision: ResultDecision | null;
  required_team_coverage_count: 1 | 2;
  received_team_coverage_count: 0 | 1 | 2;
  team_a_approval_count: number;
  team_b_approval_count: number;
  dispute_evidence: ResultDisputeEvidence | null;
  confirmation: ResultConfirmation | null;
  version_timeline: ResultVersionTimelineEntry[];
};
export type ResultOfficialFact = {
  event_id: string;
  confirmation_id: string;
  proposal_id: string;
  group_number: number;
  version: number;
  source: ResultConfirmationSource;
  confirmed_at: string;
  effective_at: string;
  actor_id: string | null;
  event_type: 'friendly' | 'competitive';
  ratable_eligible: boolean;
  teams: ResultTeams;
  sets: ResultSetRow[];
  classification: ResultClassification;
  played_at_utc: string;
  played_at_local: string;
  played_at_offset_seconds: number;
  court_label: string | null;
};
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
function timestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
function submission(value: Record<string, unknown>): ResultSubmission | null {
  try {
    if (
      !positive(value.group_number) ||
      !positive(value.version) ||
      !timestamp(value.submitted_at) ||
      !timestamp(value.review_deadline_at) ||
      Date.parse(value.review_deadline_at) - Date.parse(value.submitted_at) !== 48 * 3600000
    )
      return null;
    return {
      event_id: validateMatchUuid(value.event_id),
      proposal_id: validateMatchUuid(value.proposal_id),
      group_number: value.group_number,
      version: value.version,
      submitted_at: value.submitted_at,
      review_deadline_at: value.review_deadline_at,
      request_id: validateMatchUuid(value.request_id)
    };
  } catch {
    return null;
  }
}
export function parseResultSubmission(
  value: unknown
): MatchResultResponse<ResultSubmission> | null {
  if (!record(value) || typeof value.replayed !== 'boolean') return null;
  const parsed = submission(value);
  return parsed ? { status: 'ok', value: parsed, replayed: value.replayed } : null;
}
export function parseResultProposals(value: unknown): ResultProposal[] | null {
  if (!Array.isArray(value)) return null;
  const proposals: ResultProposal[] = [];
  const groups = new Set<number>();
  try {
    for (const row of value) {
      if (!record(row) || !record(row.teams)) return null;
      // Reuse the shared event/proposal and 48-hour clock validation.
      const base = submission({ ...row, request_id: row.proposal_id });
      const status = proposalStatus(row.status);
      if (
        !base ||
        !status ||
        groups.has(base.group_number) ||
        typeof row.rating_effective !== 'boolean' ||
        !timestamp(row.played_at_utc) ||
        typeof row.can_approve !== 'boolean' ||
        typeof row.can_reject !== 'boolean' ||
        typeof row.can_correct !== 'boolean'
      )
        return null;
      const parsePlayers = (players: unknown): [ResultPlayer, ResultPlayer] => {
        if (!Array.isArray(players) || players.length !== 2) throw new Error('INVALID_TEAMS');
        const player = (item: unknown): ResultPlayer => {
          if (
            !record(item) ||
            !(item.display_name === null || typeof item.display_name === 'string') ||
            !(item.is_provisional === undefined || typeof item.is_provisional === 'boolean')
          )
            throw new Error('INVALID_TEAMS');
          // Additive flag: absent in pre-provisional payloads.
          return {
            user_id: validateMatchUuid(item.user_id),
            display_name: item.display_name,
            is_provisional: item.is_provisional ?? false
          };
        };
        return [player(players[0]), player(players[1])];
      };
      if (Object.keys(row.teams).length !== 2) return null;
      const teams = {
        team_a: parsePlayers(row.teams.team_a),
        team_b: parsePlayers(row.teams.team_b)
      };
      validateMatchResultTeams({
        team_a: teams.team_a.map((p) => p.user_id),
        team_b: teams.team_b.map((p) => p.user_id)
      });
      const sets = validateMatchResultSets(row.sets);
      const classification = classifyMatchResultSets(sets);
      if (
        row.classification !== classification ||
        (classification === 'incomplete' && row.rating_effective)
      )
        return null;
      const played = validateResultPlayedLocal({
        local: row.played_at_local,
        offset_seconds: row.played_at_offset_seconds
      });
      if (
        Date.parse(row.played_at_utc) !==
          Date.parse(`${played.local.replace(' ', 'T')}Z`) - played.offset_seconds * 1000 ||
        !(
          row.court_label === null ||
          (typeof row.court_label === 'string' &&
            row.court_label === row.court_label.trim() &&
            row.court_label.length > 0 &&
            row.court_label.length <= 100 &&
            !/\p{Cc}/u.test(row.court_label))
        )
      )
        return null;
      const submittedBy = uuid(row.submitted_by);
      const submittedByName = nullableName(row.submitted_by_name);
      const callerDecision = parseCallerDecision(row.caller_decision);
      const requiredCoverage = coverageCount(row.required_team_coverage_count, 1, 2);
      const receivedCoverage = coverageCount(row.received_team_coverage_count, 0, 2);
      const teamACount = coverageCount(row.team_a_approval_count, 0, 2);
      const teamBCount = coverageCount(row.team_b_approval_count, 0, 2);
      const expectedCoverage = teams.team_a.some((player) => player.user_id === submittedBy)
        ? 1
        : teams.team_b.some((player) => player.user_id === submittedBy)
          ? 1
          : 2;
      const expectedReceivedCoverage = teams.team_a.some((player) => player.user_id === submittedBy)
        ? Math.min(teamBCount, 1)
        : teams.team_b.some((player) => player.user_id === submittedBy)
          ? Math.min(teamACount, 1)
          : Number(teamACount > 0) + Number(teamBCount > 0);
      const dispute = parseDisputeEvidence(row.dispute_evidence);
      const confirmation = parseResultConfirmation(row.confirmation);
      const timeline = parseVersionTimeline(row.version_timeline, base.version, status);
      if (
        requiredCoverage !== expectedCoverage ||
        receivedCoverage !== expectedReceivedCoverage ||
        receivedCoverage > requiredCoverage ||
        (status !== 'pending' && (row.can_approve || row.can_reject)) ||
        (status === 'confirmed' && row.can_correct) ||
        (status === 'disputed' && row.can_approve) ||
        (status === 'pending' && dispute !== null) ||
        (status === 'confirmed' && dispute !== null) ||
        (status === 'disputed' && dispute === null) ||
        (status === 'confirmed' && confirmation === null) ||
        (status !== 'confirmed' && confirmation !== null) ||
        ((status === 'pending' || status === 'confirmed') && callerDecision === 'reject') ||
        (status === 'pending' && receivedCoverage === requiredCoverage) ||
        (row.can_approve && callerDecision === 'approve') ||
        !timeline ||
        (dispute !== null &&
          !timeline
            .at(-1)
            ?.decisions.some(
              (item) =>
                item.decision === 'reject' &&
                item.reviewer_id === dispute.rejector_id &&
                item.reason_code === dispute.reason_code &&
                item.reason_note === dispute.reason_note &&
                Date.parse(item.decided_at) === Date.parse(dispute.decided_at)
            )) ||
        (confirmation !== null && timeline.at(-1)?.confirmation_id !== confirmation.confirmation_id)
      )
        return null;
      const currentTimeline = timeline.at(-1);
      if (
        !currentTimeline ||
        currentTimeline.submitted_by !== submittedBy ||
        currentTimeline.submitted_by_name !== submittedByName ||
        currentTimeline.submitted_at !== base.submitted_at ||
        currentTimeline.review_deadline_at !== base.review_deadline_at ||
        (status === 'pending' &&
          currentTimeline.decisions.some((item) => item.decision === 'reject')) ||
        (status === 'confirmed' &&
          currentTimeline.decisions.some((item) => item.decision === 'reject')) ||
        (confirmation?.source === 'MANUAL' &&
          (receivedCoverage !== requiredCoverage ||
            Date.parse(confirmation.confirmed_at) >= Date.parse(base.review_deadline_at))) ||
        (confirmation?.source === 'AUTO_48H' &&
          (Date.parse(confirmation.effective_at) !== Date.parse(base.review_deadline_at) ||
            Date.parse(confirmation.confirmed_at) < Date.parse(base.review_deadline_at)))
      )
        return null;
      groups.add(base.group_number);
      proposals.push({
        event_id: base.event_id,
        proposal_id: base.proposal_id,
        group_number: base.group_number,
        version: base.version,
        submitted_at: base.submitted_at,
        review_deadline_at: base.review_deadline_at,
        status,
        teams,
        sets,
        classification,
        played_at_utc: row.played_at_utc,
        played_at_local: played.local,
        played_at_offset_seconds: played.offset_seconds,
        court_label: row.court_label,
        rating_effective: row.rating_effective,
        submitted_by: submittedBy,
        submitted_by_name: submittedByName,
        can_approve: row.can_approve,
        can_reject: row.can_reject,
        can_correct: row.can_correct,
        caller_decision: callerDecision,
        required_team_coverage_count: requiredCoverage,
        received_team_coverage_count: receivedCoverage,
        team_a_approval_count: teamACount,
        team_b_approval_count: teamBCount,
        dispute_evidence: dispute,
        confirmation,
        version_timeline: timeline
      });
    }
    return proposals;
  } catch {
    return null;
  }
}

export type ResultCommandReceipt = {
  proposal_id: string;
  version: number;
  status: ResultProposalStatus;
  confirmation_id: string | null;
  review_deadline_at: string;
  request_id: string;
};

export function parseResultCommandReceipt(
  value: unknown
): ResultCommandResponse<ResultCommandReceipt> | null {
  if (!record(value) || typeof value.replayed !== 'boolean') return null;
  const status = proposalStatus(value.status);
  if (
    !status ||
    !positive(value.version) ||
    !timestamp(value.review_deadline_at) ||
    value.version > Number.MAX_SAFE_INTEGER
  )
    return null;
  let proposalId: string;
  let requestId: string;
  let confirmationId: string | null;
  try {
    proposalId = validateMatchUuid(value.proposal_id);
    requestId = validateMatchUuid(value.request_id);
    confirmationId =
      value.confirmation_id === null ? null : validateMatchUuid(value.confirmation_id);
  } catch {
    return null;
  }
  if ((status === 'confirmed') !== (confirmationId !== null)) return null;
  const receipt: ResultCommandReceipt = {
    proposal_id: proposalId,
    version: value.version,
    status,
    confirmation_id: confirmationId,
    review_deadline_at: value.review_deadline_at,
    request_id: requestId
  };
  if (value.conflict === 'deadline_elapsed') {
    return status === 'confirmed' && confirmationId
      ? {
          status: 'conflict',
          code: 'deadline_elapsed',
          current_version: value.version,
          current_status: 'confirmed',
          confirmation_id: confirmationId
        }
      : null;
  }
  if (value.conflict !== undefined) return null;
  return { status: 'ok', value: receipt, replayed: value.replayed };
}

export function parseOfficialResultFacts(
  value: unknown,
  expectedEventId?: string
): ResultOfficialFact[] | null {
  if (!Array.isArray(value)) return null;
  const facts: ResultOfficialFact[] = [];
  const groups = new Set<number>();
  const confirmationIds = new Set<string>();
  let eventId = expectedEventId;
  try {
    for (const item of value) {
      if (!record(item) || !record(item.teams) || Object.hasOwn(item, 'status')) return null;
      if (Object.keys(item.teams).length !== 2) return null;
      const currentEventId = validateMatchUuid(item.event_id);
      eventId ??= currentEventId;
      if (currentEventId !== eventId) return null;
      const groupNumber = item.group_number;
      const version = item.version;
      if (
        !positive(groupNumber) ||
        !positive(version) ||
        groupNumber > Number.MAX_SAFE_INTEGER ||
        version > Number.MAX_SAFE_INTEGER ||
        groups.has(groupNumber)
      )
        return null;
      const confirmationId = validateMatchUuid(item.confirmation_id);
      const proposalId = validateMatchUuid(item.proposal_id);
      if (confirmationIds.has(confirmationId)) return null;
      const source = item.source;
      const confirmedAt = item.confirmed_at;
      const effectiveAt = item.effective_at;
      const actorId = item.actor_id === null ? null : validateMatchUuid(item.actor_id);
      if (
        (source !== 'MANUAL' && source !== 'AUTO_48H') ||
        !timestamp(confirmedAt) ||
        !timestamp(effectiveAt) ||
        (source === 'MANUAL' &&
          (actorId === null || Date.parse(effectiveAt) !== Date.parse(confirmedAt))) ||
        (source === 'AUTO_48H' &&
          (actorId !== null || Date.parse(effectiveAt) > Date.parse(confirmedAt)))
      )
        return null;
      if (item.event_type !== 'friendly' && item.event_type !== 'competitive') return null;
      if (typeof item.ratable_eligible !== 'boolean' || !timestamp(item.played_at_utc)) return null;
      const rawTeams = {
        team_a: item.teams.team_a,
        team_b: item.teams.team_b
      };
      const teams = validateMatchResultTeams(rawTeams);
      const sets = validateMatchResultSets(item.sets);
      const classification = classifyMatchResultSets(sets);
      if (
        item.classification !== classification ||
        item.ratable_eligible !==
          (item.event_type === 'competitive' && classification !== 'incomplete')
      )
        return null;
      const played = validateResultPlayedLocal({
        local: item.played_at_local,
        offset_seconds: item.played_at_offset_seconds
      });
      const courtLabel = item.court_label;
      if (
        Date.parse(item.played_at_utc) !==
          Date.parse(`${played.local.replace(' ', 'T')}Z`) - played.offset_seconds * 1000 ||
        !(
          courtLabel === null ||
          (typeof courtLabel === 'string' &&
            courtLabel === courtLabel.trim() &&
            courtLabel.length > 0 &&
            courtLabel.length <= 100 &&
            !/\p{Cc}/u.test(courtLabel))
        )
      )
        return null;
      groups.add(groupNumber);
      confirmationIds.add(confirmationId);
      facts.push({
        event_id: currentEventId,
        confirmation_id: confirmationId,
        proposal_id: proposalId,
        group_number: groupNumber,
        version,
        source,
        confirmed_at: confirmedAt,
        effective_at: effectiveAt,
        actor_id: actorId,
        event_type: item.event_type,
        ratable_eligible: item.ratable_eligible,
        teams,
        sets,
        classification,
        played_at_utc: item.played_at_utc,
        played_at_local: played.local,
        played_at_offset_seconds: played.offset_seconds,
        court_label: courtLabel
      });
    }
    return facts;
  } catch {
    return null;
  }
}

function proposalStatus(value: unknown): ResultProposalStatus | null {
  return value === 'pending' || value === 'disputed' || value === 'confirmed' ? value : null;
}
function parseCallerDecision(value: unknown): ResultDecision | null {
  return value === null || value === 'approve' || value === 'reject' ? value : invalid();
}
function nullableName(value: unknown): string | null {
  return value === null || typeof value === 'string' ? value : invalid();
}
function uuid(value: unknown): string {
  return validateMatchUuid(value);
}
function coverageCount(value: unknown, minimum: 1, maximum: 2): 1 | 2;
function coverageCount(value: unknown, minimum: 0, maximum: 2): 0 | 1 | 2;
function coverageCount(value: unknown, minimum: number, maximum: number): 0 | 1 | 2 {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  )
    return invalid();
  if (value === 0) return 0;
  if (value === 1) return 1;
  if (value === 2) return 2;
  return invalid();
}
function invalid(): never {
  throw new Error('INVALID_MATCH_RESPONSE');
}
function resultReason(value: unknown): ResultRejectionReason | null {
  return value === null
    ? null
    : (RESULT_REJECTION_REASONS.find((reason) => reason === value) ?? invalid());
}
function parseDisputeEvidence(value: unknown): ResultDisputeEvidence | null {
  if (value === null) return null;
  if (!record(value)) return invalid();
  const rejectorId = uuid(value.rejector_id);
  const rejectorName = nullableName(value.rejector_name);
  const reasonCode = resultReason(value.reason_code);
  const decidedAt = value.decided_at;
  if (!reasonCode || !timestamp(decidedAt)) return invalid();
  const note = value.reason_note;
  if (
    !(note === null || typeof note === 'string') ||
    (note !== null && (!note.trim() || note.length > 500 || /\p{Cc}/u.test(note))) ||
    (reasonCode === 'OTHER' && note === null)
  )
    return invalid();
  return {
    rejector_id: rejectorId,
    rejector_name: rejectorName,
    reason_code: reasonCode,
    reason_note: note,
    decided_at: decidedAt
  };
}
function parseResultConfirmation(value: unknown): ResultConfirmation | null {
  if (value === null) return null;
  if (!record(value)) return invalid();
  let confirmationId: string;
  let actorId: string | null;
  try {
    confirmationId = validateMatchUuid(value.confirmation_id);
    actorId = value.actor_id === null ? null : validateMatchUuid(value.actor_id);
  } catch {
    return invalid();
  }
  const source = value.source;
  const confirmedAt = value.confirmed_at;
  const effectiveAt = value.effective_at;
  if (
    (source !== 'MANUAL' && source !== 'AUTO_48H') ||
    !timestamp(confirmedAt) ||
    !timestamp(effectiveAt) ||
    (source === 'MANUAL' &&
      (actorId === null || Date.parse(effectiveAt) !== Date.parse(confirmedAt))) ||
    (source === 'AUTO_48H' &&
      (actorId !== null || Date.parse(effectiveAt) > Date.parse(confirmedAt)))
  )
    return invalid();
  return {
    confirmation_id: confirmationId,
    source,
    confirmed_at: confirmedAt,
    effective_at: effectiveAt,
    actor_id: actorId
  };
}
function parseVersionTimeline(
  value: unknown,
  currentVersion: number,
  currentStatus: ResultProposalStatus
): ResultVersionTimelineEntry[] | null {
  if (!Array.isArray(value) || value.length !== currentVersion) return null;
  const timeline: ResultVersionTimelineEntry[] = [];
  for (let index = 0; index < value.length; index++) {
    const entry = value[index];
    if (!record(entry) || entry.version !== index + 1) return null;
    const expectedStatus: ResultVersionTimelineEntry['status'] =
      index + 1 === currentVersion ? currentStatus : 'superseded';
    const status = expectedStatus;
    if (
      entry.status !== expectedStatus ||
      (typeof entry.submitted_by_name !== 'string' && entry.submitted_by_name !== null) ||
      !timestamp(entry.submitted_at) ||
      !timestamp(entry.review_deadline_at) ||
      Date.parse(entry.review_deadline_at) - Date.parse(entry.submitted_at) !== 48 * 3600000 ||
      !Array.isArray(entry.decisions)
    )
      return null;
    let submittedBy: string;
    let confirmationId: string | null;
    try {
      submittedBy = validateMatchUuid(entry.submitted_by);
      confirmationId =
        entry.confirmation_id === null ? null : validateMatchUuid(entry.confirmation_id);
    } catch {
      return null;
    }
    const decisions: ResultDecisionEvidence[] = [];
    for (const rawDecision of entry.decisions) {
      if (!record(rawDecision)) return null;
      let reviewerId: string;
      try {
        reviewerId = validateMatchUuid(rawDecision.reviewer_id);
      } catch {
        return null;
      }
      const vote = rawDecision.decision;
      const reasonCode = resultReason(rawDecision.reason_code);
      const reasonNote = rawDecision.reason_note;
      if (
        (typeof rawDecision.reviewer_name !== 'string' && rawDecision.reviewer_name !== null) ||
        (vote !== 'approve' && vote !== 'reject') ||
        !timestamp(rawDecision.decided_at) ||
        (vote === 'approve' && (reasonCode !== null || reasonNote !== null)) ||
        (vote === 'reject' && reasonCode === null) ||
        !(reasonNote === null || typeof reasonNote === 'string') ||
        (reasonNote !== null &&
          (!reasonNote.trim() || reasonNote.length > 500 || /\p{Cc}/u.test(reasonNote))) ||
        (reasonCode === 'OTHER' && reasonNote === null)
      )
        return null;
      decisions.push({
        reviewer_id: reviewerId,
        reviewer_name: rawDecision.reviewer_name,
        decision: vote,
        reason_code: reasonCode,
        reason_note: reasonNote,
        decided_at: rawDecision.decided_at
      });
    }
    if (
      new Set(decisions.map((item) => `${item.reviewer_id}:${item.decision}`)).size !==
        decisions.length ||
      (status === 'confirmed') !== (confirmationId !== null)
    )
      return null;
    timeline.push({
      version: index + 1,
      status,
      submitted_by: submittedBy,
      submitted_by_name: entry.submitted_by_name,
      submitted_at: entry.submitted_at,
      review_deadline_at: entry.review_deadline_at,
      decisions,
      confirmation_id: confirmationId
    });
  }
  return timeline;
}
export function matchResultActionError(error: {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}): MatchResultResponse<never> {
  let detail: unknown;
  try {
    detail = JSON.parse(error.details ?? 'null');
  } catch {
    detail = null;
  }
  const code = error.message?.startsWith('MATCH_RESULT_')
    ? error.message.slice(13).toLowerCase()
    : '';
  if (code === 'active_proposal') {
    return record(detail) && positive(detail.active_version) && timestamp(detail.review_deadline_at)
      ? {
          status: 'conflict',
          code,
          active_version: detail.active_version,
          review_deadline_at: detail.review_deadline_at
        }
      : { status: 'error', code: 'unavailable' };
  }
  const known = Object.keys(MATCH_RESULT_ERROR_COPY).find(
    (key): key is MatchResultErrorCode => key === code
  );
  if (known) {
    const safe: ResultValidationDetail | undefined =
      record(detail) &&
      (detail.set_index === null || (positive(detail.set_index) && detail.set_index <= 3)) &&
      (detail.side === null || detail.side === 'team_a' || detail.side === 'team_b') &&
      detail.reason_token === code.toUpperCase()
        ? { set_index: detail.set_index, side: detail.side, reason_token: detail.reason_token }
        : undefined;
    return { status: 'error', code: known, ...(safe ? { detail: safe } : {}) };
  }
  return {
    status: 'error',
    code:
      error.code === '28000'
        ? 'unauthenticated'
        : error.code === '42501'
          ? 'forbidden'
          : 'unavailable'
  };
}

export function matchResultCommandError(error: {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}): ResultCommandResponse<never> {
  const code = error.message?.startsWith('MATCH_RESULT_')
    ? error.message.slice(13).toLowerCase()
    : '';
  if (
    code === 'review_version_conflict' ||
    code === 'correction_version_conflict' ||
    code === 'review_conflict' ||
    code === 'correction_conflict'
  ) {
    let detail: unknown;
    try {
      detail = JSON.parse(error.details ?? 'null');
    } catch {
      detail = null;
    }
    return staleVersionConflict(detail);
  }
  const mapped = matchResultActionError(error);
  return mapped.status === 'error' ? mapped : { status: 'error', code: 'unavailable' };
}

function staleVersionConflict(value: unknown): ResultCommandResponse<never> {
  if (
    !record(value) ||
    !positive(value.current_version) ||
    value.current_version > Number.MAX_SAFE_INTEGER ||
    (value.current_status !== 'pending' &&
      value.current_status !== 'disputed' &&
      value.current_status !== 'confirmed')
  )
    return { status: 'error', code: 'unavailable' };
  return {
    status: 'conflict',
    code: 'stale_version',
    current_version: value.current_version,
    current_status: value.current_status
  };
}
