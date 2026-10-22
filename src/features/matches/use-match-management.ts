import { useRef, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { withdrawMatchRegistration, removeMatchRegistration } from './match-management.functions';
import { MANAGEMENT_ERROR_COPY } from './match-management-error-copy';

export function useMatchManagement(eventId: string) {
  const router = useRouter();
  const busy = useRef(false);
  const retry = useRef<{ intent: string; requestId: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  async function depart(attemptId: string, target?: { userId: string; reason: string }) {
    if (busy.current) return false;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setFeedback('matches.management.offline');
      return false;
    }
    busy.current = true;
    setPending(true);
    setFeedback(null);
    const intent = JSON.stringify([eventId, attemptId, target?.userId, target?.reason.trim()]);
    const requestId =
      retry.current?.intent === intent ? retry.current.requestId : crypto.randomUUID();
    retry.current = { intent, requestId };
    try {
      const data = { event_id: eventId, attempt_id: attemptId, request_id: requestId };
      const result = target
        ? await removeMatchRegistration({
            data: { ...data, target_user_id: target.userId, reason: target.reason }
          })
        : await withdrawMatchRegistration({ data });
      if (result.status === 'ok') {
        retry.current = null;
        setFeedback(
          target ? 'matches.management.removedFeedback' : 'matches.management.withdrawnFeedback'
        );
        await router.invalidate().catch(() => undefined);
        return true;
      }
      setFeedback(MANAGEMENT_ERROR_COPY[result.code]);
      // Definite domain rejection is a resolved intent; network failures retain
      // the original key so retry cannot duplicate an already committed command.
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
  return { pending, feedback, depart };
}
