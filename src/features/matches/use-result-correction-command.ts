import { useCallback, useEffect, useRef, useState } from 'react';
import { MATCH_RESULT_ERROR_COPY } from './match-result-error-copy';
import type { ResultAmendmentResponse } from './result-amendment-model';

export type CorrectionFeedback =
  | { kind: 'done'; copy: string }
  | { kind: 'conflict'; copy: string }
  | { kind: 'error'; copy: string };

const CONFLICT_COPY = {
  base_conflict: 'matches.corrections.conflicts.baseConflict',
  candidate_version_conflict: 'matches.corrections.conflicts.candidateVersionConflict',
  state_conflict: 'matches.corrections.conflicts.stateConflict',
  already_open: 'matches.corrections.conflicts.alreadyOpen',
  already_resolved: 'matches.corrections.conflicts.alreadyResolved',
  deadline_elapsed: 'matches.corrections.conflicts.deadlineElapsed'
} as const;

const ERROR_COPY: Record<string, string> = {
  ...MATCH_RESULT_ERROR_COPY,
  not_confirmed: 'matches.corrections.errors.notConfirmed',
  no_change: 'matches.corrections.errors.noChange',
  invalid_justification: 'matches.corrections.errors.invalidJustification',
  invalid_decision: 'matches.corrections.errors.invalidDecision',
  ranked_ineligible: 'matches.corrections.errors.rankedIneligible'
};

export function correctionErrorCopy(code: string): string {
  return ERROR_COPY[code] ?? MATCH_RESULT_ERROR_COPY.unavailable;
}

/**
 * Runs one correction command at a time. A command id is reused for the identical payload until it
 * settles, so a lost response is retried as the same command (exactly once) and a changed payload
 * is a new command. Conflicts and stale reads refresh the page data instead of retrying blindly.
 */
export function useCorrectionCommand(onRefresh: () => void | Promise<void>) {
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<CorrectionFeedback | null>(null);
  const inFlight = useRef(false);
  const ids = useRef(new Map<string, string>());
  const refreshRef = useRef(onRefresh);
  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);

  const run = useCallback(
    async <T>(
      payload: unknown,
      send: (commandId: string) => Promise<ResultAmendmentResponse<T>>,
      doneCopy: string
    ): Promise<boolean> => {
      if (inFlight.current) return false;
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setFeedback({ kind: 'error', copy: 'matches.results.review.offline' });
        return false;
      }
      const key = JSON.stringify(payload);
      const commandId = ids.current.get(key) ?? crypto.randomUUID();
      ids.current.set(key, commandId);
      inFlight.current = true;
      setPending(true);
      setFeedback(null);
      const refresh = async () => {
        try {
          await refreshRef.current();
        } catch {
          // The next focus or polling refresh retries the read.
        }
      };
      try {
        const response = await send(commandId);
        if (response.status === 'ok') {
          ids.current.delete(key);
          setFeedback({ kind: 'done', copy: doneCopy });
          await refresh();
          return true;
        }
        if (response.status === 'conflict') {
          ids.current.delete(key);
          setFeedback({ kind: 'conflict', copy: CONFLICT_COPY[response.code] });
          await refresh();
          return false;
        }
        if (response.code !== 'unavailable') ids.current.delete(key);
        setFeedback({ kind: 'error', copy: correctionErrorCopy(response.code) });
        return false;
      } catch {
        setFeedback({ kind: 'error', copy: MATCH_RESULT_ERROR_COPY.unavailable });
        return false;
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    },
    []
  );

  return { run, pending, feedback, clearFeedback: () => setFeedback(null) };
}
