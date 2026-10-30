import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ResultCommandReceipt,
  ResultCommandResponse,
  ResultDecision,
  ResultProposal,
  ResultRejectionReason
} from './match-result-model';
import { MATCH_RESULT_CONFLICT_COPY, MATCH_RESULT_ERROR_COPY } from './match-result-error-copy';
import { reviewMatchEventResult } from './match-result.functions';

type ReviewCommand = {
  decision: ResultDecision;
  reasonCode: ResultRejectionReason | null;
  reasonNote: string | null;
};

export type MatchResultReviewFeedback =
  | {
      kind: 'recorded';
      decision: ResultDecision;
      version: number;
      status: ResultProposal['status'];
    }
  | { kind: 'offline' }
  | { kind: 'error'; copy: string; retryable: boolean }
  | {
      kind: 'stale';
      version: number;
      status: ResultProposal['status'];
      copy: string;
    }
  | { kind: 'deadline'; copy: string };

function isOnline() {
  return typeof navigator === 'undefined' || navigator.onLine;
}

export function useMatchResultReview({
  proposal,
  onRefresh
}: {
  proposal: ResultProposal;
  onRefresh: () => void | Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [online, setOnline] = useState(true);
  const [feedback, setFeedback] = useState<MatchResultReviewFeedback | null>(null);
  const pendingRef = useRef(false);
  const requestRef = useRef<{ payload: string; requestId: string; command: ReviewCommand } | null>(
    null
  );
  const refreshRef = useRef(onRefresh);

  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    const update = () => setOnline(isOnline());
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      await refreshRef.current();
    } catch {
      // A later focus, visibility, online, or polling refresh retries the read.
    }
  }, []);

  const execute = useCallback(
    async (command: ReviewCommand): Promise<boolean> => {
      if (pendingRef.current) return false;
      if (!isOnline()) {
        setOnline(false);
        setFeedback({ kind: 'offline' });
        return false;
      }
      if (
        command.decision === 'approve'
          ? !proposal.can_approve
          : !proposal.can_reject || command.reasonCode === null
      )
        return false;

      const payload = JSON.stringify({
        proposal_id: proposal.proposal_id,
        expected_version: proposal.version,
        decision: command.decision,
        reason_code: command.reasonCode,
        reason_note: command.reasonNote
      });
      if (requestRef.current?.payload !== payload) {
        requestRef.current = {
          payload,
          requestId: crypto.randomUUID(),
          command
        };
      }
      const requestId = requestRef.current.requestId;
      pendingRef.current = true;
      setPending(true);
      setFeedback(null);
      try {
        const response: ResultCommandResponse<ResultCommandReceipt> = await reviewMatchEventResult({
          data: {
            proposal_id: proposal.proposal_id,
            expected_version: proposal.version,
            decision: command.decision,
            reason_code: command.reasonCode,
            reason_note: command.reasonNote,
            request_id: requestId
          }
        });
        if (response.status === 'ok') {
          requestRef.current = null;
          setFeedback({
            kind: 'recorded',
            decision: command.decision,
            version: response.value.version,
            status: response.value.status
          });
          await refresh();
          return true;
        }
        if (response.status === 'conflict' && response.code === 'stale_version') {
          requestRef.current = null;
          setFeedback({
            kind: 'stale',
            version: response.current_version,
            status: response.current_status,
            copy: MATCH_RESULT_CONFLICT_COPY.stale_version
          });
          await refresh();
          return false;
        }
        if (response.status === 'conflict' && response.code === 'deadline_elapsed') {
          requestRef.current = null;
          setFeedback({ kind: 'deadline', copy: MATCH_RESULT_CONFLICT_COPY.deadline_elapsed });
          await refresh();
          return false;
        }
        if (response.code !== 'unavailable') requestRef.current = null;
        setFeedback({
          kind: 'error',
          copy: MATCH_RESULT_ERROR_COPY[response.code],
          retryable: response.code === 'unavailable'
        });
        return false;
      } catch {
        setFeedback({
          kind: 'error',
          copy: MATCH_RESULT_ERROR_COPY.unavailable,
          retryable: true
        });
        return false;
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    },
    [proposal, refresh]
  );

  const approve = useCallback(
    () =>
      execute({
        decision: 'approve',
        reasonCode: null,
        reasonNote: null
      }),
    [execute]
  );
  const reject = useCallback(
    (reasonCode: ResultRejectionReason, reasonNote: string | null) =>
      execute({ decision: 'reject', reasonCode, reasonNote }),
    [execute]
  );
  const retry = useCallback(() => {
    const previous = requestRef.current;
    if (!previous || feedback?.kind !== 'error' || !feedback.retryable)
      return Promise.resolve(false);
    return execute(previous.command);
  }, [execute, feedback]);
  const clearFeedback = useCallback(() => setFeedback(null), []);

  return { approve, reject, retry, clearFeedback, pending, online, feedback };
}
