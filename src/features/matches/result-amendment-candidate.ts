import type { ResultCommandReceipt, ResultCommandResponse } from './match-result-model';
import { MATCH_RESULT_ERROR_COPY, type MatchResultErrorCode } from './match-result-error-copy';
import type { ResultAmendment } from './result-amendment-model';
import { submitResultAmendmentCandidate } from './result-amendment.functions';
import type { correctMatchEventResult } from './match-result.functions';

function isMatchResultErrorCode(code: string): code is MatchResultErrorCode {
  return Object.hasOwn(MATCH_RESULT_ERROR_COPY, code);
}

/**
 * Lets the existing correction form submit a corrected candidate for an amendment: the same
 * teams/sets/played-at facts, the amendment's own command (base confirmation and candidate version
 * are checked by the server under its locks).
 */
export function amendmentCandidateSubmitter(amendment: ResultAmendment) {
  return async (
    options: Parameters<typeof correctMatchEventResult>[0]
  ): Promise<ResultCommandResponse<ResultCommandReceipt>> => {
    const facts = options?.data;
    // The correction form assembled these facts; the server function validates every field.
    if (
      typeof facts !== 'object' ||
      facts === null ||
      !('request_id' in facts) ||
      typeof facts.request_id !== 'string'
    )
      return { status: 'error', code: 'unavailable' };
    const requestId = facts.request_id;
    const response = await submitResultAmendmentCandidate({
      data: {
        event_id: 'event_id' in facts ? facts.event_id : undefined,
        amendment_id: amendment.amendment_id,
        expected_base_confirmation_id: amendment.base_confirmation_id,
        expected_candidate_version: amendment.candidate?.version ?? null,
        teams: 'teams' in facts ? facts.teams : undefined,
        sets: 'sets' in facts ? facts.sets : undefined,
        played_local: 'played_local' in facts ? facts.played_local : undefined,
        court_label: 'court_label' in facts ? facts.court_label : null,
        command_id: requestId
      }
    });
    if (response.status === 'ok') {
      const receipt = response.value;
      if (receipt.candidate_version === null || receipt.review_deadline_at === null)
        return { status: 'error', code: 'unavailable' };
      return {
        status: 'ok',
        replayed: response.replayed,
        value: {
          proposal_id: receipt.proposal_id,
          version: receipt.candidate_version,
          status: 'pending',
          confirmation_id: null,
          review_deadline_at: receipt.review_deadline_at,
          request_id: requestId
        }
      };
    }
    if (response.status === 'conflict')
      return {
        status: 'conflict',
        code: 'stale_version',
        current_version:
          'current_version' in response && response.current_version !== null
            ? response.current_version
            : (amendment.candidate?.version ?? 1),
        current_status: 'pending'
      };
    return {
      status: 'error',
      code: isMatchResultErrorCode(response.code) ? response.code : 'unavailable',
      detail: response.detail
    };
  };
}
