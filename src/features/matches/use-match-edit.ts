import { useRef, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { editMatchEvent } from './match-management.functions';
import { MANAGEMENT_ERROR_COPY } from './match-management-error-copy';
import type { MatchEditPatch } from './match-management-edit';
import type { ManagementErrorCode, ManagementErrorDetail } from './match-management-model';

/** Typed Ranked/League rejections the organizer repairs explicitly in the dialog. */
const RANKED_REJECTIONS: readonly ManagementErrorCode[] = [
  'league_out_of_period',
  'league_unavailable',
  'league_closed',
  'league_friendly',
  'ranked_nonmembers_accepted'
];
export type MatchEditRejection = { code: ManagementErrorCode; detail?: ManagementErrorDetail };

export function useMatchEdit(eventId: string, version: number) {
  const router = useRouter();
  const busy = useRef(false);
  const retry = useRef<{ intent: string; requestId: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [unavailable, setUnavailable] = useState<ManagementErrorCode | null>(null);
  const [rejection, setRejection] = useState<MatchEditRejection | null>(null);
  async function save(patch: MatchEditPatch) {
    if (busy.current || conflict || unavailable) return false;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setFeedback('matches.management.offline');
      return false;
    }
    busy.current = true;
    setPending(true);
    setFeedback(null);
    setRejection(null);
    const intent = JSON.stringify([version, patch]);
    const requestId =
      retry.current?.intent === intent ? retry.current.requestId : crypto.randomUUID();
    retry.current = { intent, requestId };
    try {
      const result = await editMatchEvent({
        data: { event_id: eventId, expected_version: version, request_id: requestId, patch }
      });
      if (result.status === 'ok') {
        retry.current = null;
        setFeedback(
          result.value.carried_count > 0
            ? 'matches.management.edit.savedCarried'
            : 'matches.management.edit.saved'
        );
        await router.invalidate().catch(() => undefined);
        return true;
      }
      if (result.status === 'conflict') setConflict(true);
      else {
        if (RANKED_REJECTIONS.includes(result.code))
          setRejection({ code: result.code, ...(result.detail ? { detail: result.detail } : {}) });
        setFeedback(MANAGEMENT_ERROR_COPY[result.code]);
        if (
          ['cancelled', 'result_protected', 'started', 'closed', 'forbidden'].includes(result.code)
        )
          setUnavailable(result.code);
      }
      if (result.code !== 'unavailable') retry.current = null;
      await router.invalidate().catch(() => undefined);
      return false;
    } catch {
      setFeedback('matches.management.errors.unavailable');
      return false;
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  async function reload() {
    if (busy.current) return false;
    busy.current = true;
    setPending(true);
    try {
      await router.invalidate();
      return true;
    } catch {
      setFeedback('matches.management.errors.unavailable');
      return false;
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return {
    pending,
    feedback,
    conflict,
    unavailable,
    rejection,
    clearRejection: () => setRejection(null),
    save,
    reload
  };
}
