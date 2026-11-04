import { requireAuthenticatedClient } from '../auth/auth.server';
import {
  LEVEL_REVIEW_PAGE_DEFAULT,
  type LevelReviewAccess,
  type LevelReviewAdminCommandResult,
  type LevelReviewAdminDetail,
  type LevelReviewCommandResult,
  type LevelReviewDetailResult,
  type LevelReviewListInput,
  type LevelReviewListResult,
  type LevelReviewQueueInput,
  type LevelReviewQueueResult,
  type LevelReviewReliabilityDecision,
  type LevelReviewRequestInput,
  type LevelReviewResolutionResult,
  type ResolveLevelReviewInput,
  type SubmitLevelReviewInput
} from './level-review-contracts';
import {
  decodeLevelReviewAccess,
  decodeLevelReviewAdminCommand,
  decodeLevelReviewAdminDetail,
  decodeLevelReviewCommand,
  decodeLevelReviewDetail,
  decodeLevelReviewList,
  decodeLevelReviewQueue,
  decodeLevelReviewResolution
} from './level-review-decoders';
import { levelReviewErrorFromDatabase } from './level-review-errors';

type Client = Awaited<ReturnType<typeof requireAuthenticatedClient>>['client'];

/** Database failures become stable codes; an undecodable payload is never passed through. */
async function run<T>(
  call: PromiseLike<{ data: unknown; error: { message?: string } | null }>,
  decode: (value: unknown) => T
): Promise<T> {
  const { data, error } = await call;
  if (error) throw new Error(levelReviewErrorFromDatabase(error));
  try {
    return decode(data);
  } catch {
    throw new Error('INVALID_LEVEL_REVIEW_RESPONSE');
  }
}

function pageArgs(input: LevelReviewListInput) {
  return {
    p_limit: input.limit ?? LEVEL_REVIEW_PAGE_DEFAULT,
    ...(input.cursor
      ? { p_after_created_at: input.cursor.created_at, p_after_id: input.cursor.id }
      : {})
  };
}

export function readLevelReviewAccess(client: Client): Promise<LevelReviewAccess> {
  return run(client.rpc('get_level_review_access'), decodeLevelReviewAccess);
}

export function submitLevelReview(
  client: Client,
  input: SubmitLevelReviewInput
): Promise<LevelReviewCommandResult> {
  return run(
    client.rpc('submit_level_review_request', {
      p_command_id: input.command_id,
      p_requested_min_level: input.requested_min_level,
      p_requested_max_level: input.requested_max_level,
      p_reason: input.reason,
      ...(input.evidence === null ? {} : { p_evidence: input.evidence })
    }),
    decodeLevelReviewCommand
  );
}

export function listMyLevelReviews(
  client: Client,
  input: LevelReviewListInput
): Promise<LevelReviewListResult> {
  return run(client.rpc('list_my_level_review_requests', pageArgs(input)), decodeLevelReviewList);
}

export function readMyLevelReview(
  client: Client,
  input: LevelReviewRequestInput
): Promise<LevelReviewDetailResult> {
  return run(
    client.rpc('get_my_level_review_request', { p_request_id: input.request_id }),
    decodeLevelReviewDetail
  );
}

export function cancelMyLevelReview(
  client: Client,
  input: LevelReviewRequestInput
): Promise<LevelReviewCommandResult> {
  return run(
    client.rpc('cancel_level_review_request', { p_request_id: input.request_id }),
    decodeLevelReviewCommand
  );
}

export function listLevelReviewQueue(
  client: Client,
  input: LevelReviewQueueInput
): Promise<LevelReviewQueueResult> {
  return run(
    client.rpc('list_level_review_queue', {
      ...pageArgs(input),
      ...(input.status ? { p_status: input.status } : {})
    }),
    decodeLevelReviewQueue
  );
}

export function readLevelReviewAdminDetail(
  client: Client,
  input: LevelReviewRequestInput
): Promise<LevelReviewAdminDetail> {
  return run(
    client.rpc('get_level_review_admin_detail', { p_request_id: input.request_id }),
    decodeLevelReviewAdminDetail
  );
}

export function markLevelReviewUnderReview(
  client: Client,
  input: LevelReviewRequestInput
): Promise<LevelReviewAdminCommandResult> {
  return run(
    client.rpc('mark_level_review_under_review', { p_request_id: input.request_id }),
    decodeLevelReviewAdminCommand
  );
}

/** Preserve is the database default: only a recorded exception adds arguments. */
function reliabilityArgs(decision: LevelReviewReliabilityDecision | undefined) {
  if (!decision || decision.mode === 'preserve') return {};
  return {
    p_reliability_mode: decision.mode,
    p_exception_justification: decision.justification,
    ...(decision.mode === 'reduce' ? { p_reliability_target: decision.target } : {})
  };
}

export function resolveLevelReview(
  client: Client,
  input: ResolveLevelReviewInput
): Promise<LevelReviewResolutionResult> {
  return run(
    client.rpc('resolve_level_review_request', {
      p_request_id: input.request_id,
      p_command_id: input.command_id,
      p_decision: input.decision,
      p_note: input.note,
      ...(input.decision === 'approve'
        ? {
            p_target_level: input.target_level,
            p_expected_revision: input.expected_revision,
            ...reliabilityArgs(input.reliability)
          }
        : {})
    }),
    decodeLevelReviewResolution
  );
}
