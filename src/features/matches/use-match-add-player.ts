import { useRef, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { resolveLocale } from '../../i18n/config';
import { ADD_PLAYER_ERROR_COPY } from './match-add-player-error-copy';
import type { AddPlayerFields } from './match-add-player-form';
import { addMatchPlayer } from './match-add-player.functions';

export type AddPlayerFeedback =
  | { kind: 'success'; name: string }
  | { kind: 'error'; key: string }
  | null;

export function useMatchAddPlayer(eventId: string) {
  const router = useRouter();
  const { i18n } = useTranslation();
  const busy = useRef(false);
  const retry = useRef<{ intent: string; requestId: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<AddPlayerFeedback>(null);

  async function add(fields: AddPlayerFields) {
    if (busy.current) return false;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setFeedback({ kind: 'error', key: 'matches.addPlayer.offline' });
      return false;
    }
    busy.current = true;
    setPending(true);
    setFeedback(null);
    // Same input keeps one request id so a retry after a lost response cannot
    // double-add; edited input is a new logical add.
    const intent = JSON.stringify([eventId, fields]);
    const requestId =
      retry.current?.intent === intent ? retry.current.requestId : crypto.randomUUID();
    retry.current = { intent, requestId };
    try {
      const result = await addMatchPlayer({
        data: {
          event_id: eventId,
          ...fields,
          locale: resolveLocale(i18n.language),
          request_id: requestId
        }
      });
      if (result.status === 'ok') {
        retry.current = null;
        setFeedback({ kind: 'success', name: fields.display_name });
        await router.invalidate().catch(() => undefined);
        return true;
      }
      setFeedback({ kind: 'error', key: ADD_PLAYER_ERROR_COPY[result.code] });
      // A definite domain rejection resolves the intent; transient failures keep
      // the key so the retry replays the original command.
      if (result.code !== 'unavailable') retry.current = null;
      return false;
    } catch {
      setFeedback({ kind: 'error', key: ADD_PLAYER_ERROR_COPY.unavailable });
      return false;
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return { pending, feedback, add, clearFeedback: () => setFeedback(null) };
}
