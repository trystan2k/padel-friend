import { useRef, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { editMatchEvent } from './match-management.functions';
import { MANAGEMENT_ERROR_COPY } from './match-management-error-copy';
import type { MatchEditPatch } from './match-management-edit';

export function useMatchEdit(eventId: string, version: number) {
  const router = useRouter();
  const busy = useRef(false);
  const retry = useRef<{ intent: string; requestId: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  async function save(patch: MatchEditPatch) {
    if (busy.current || conflict) return false;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setFeedback('matches.management.offline');
      return false;
    }
    busy.current = true;
    setPending(true);
    setFeedback(null);
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
        setFeedback('matches.management.edit.saved');
        await router.invalidate().catch(() => undefined);
        return true;
      }
      if (result.status === 'conflict') setConflict(true);
      else setFeedback(MANAGEMENT_ERROR_COPY[result.code]);
      if (result.code !== 'unavailable') retry.current = null;
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
  return { pending, feedback, conflict, save, reload };
}
