import { Dialog } from '@base-ui/react/dialog';
import * as stylex from '@stylexjs/stylex';
import { useRef, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { MatchEventDetail } from './match-contracts';
import type { ManagementParticipant } from './match-management-model';
import type { MyMatchRegistration } from './match-registration-model';
import { reconfirmMatchRegistration } from './match-reconfirmation.functions';
import { requiresMatchReconfirmation } from './match-reconfirmation-model';
import { MANAGEMENT_ERROR_COPY } from './match-management-error-copy';
import { matchManagementStyles as s } from './match-management.styles';

/** Parent keys this panel by generation: never silently consent to newer terms. */
export function MatchReconfirmationPanel({
  event,
  registration,
  participants = [],
  isCreator = false
}: {
  event: MatchEventDetail;
  registration: MyMatchRegistration | null;
  participants?: ManagementParticipant[];
  isCreator?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [asOf] = useState(() => Date.now());
  const request = useRef<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const required = registration?.state === 'reconfirmation_required' ? registration : null;
  const players = participants.filter(requiresMatchReconfirmation);
  if (!required && (!isCreator || !players.length)) return null;
  const date = (instant: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      dateStyle: 'medium',
      timeStyle: 'medium',
      timeZone: event.timezone
    }).format(new Date(instant));
  const closed = event.is_past || Date.parse(event.registration_cutoff_at) <= asOf;
  return (
    <section {...stylex.props(s.section)} aria-labelledby="match-reconfirmation-heading">
      <h2 id="match-reconfirmation-heading">{t('matches.reconfirmation.title')}</h2>
      {isCreator && (
        <>
          <p>{t('matches.reconfirmation.creatorSummary', { count: players.length })}</p>
          <ul>
            {players.map((player) => (
              <li key={player.attempt_id}>
                {player.display_name ?? t('matchRegistration.roster.playerFallback')} ·{' '}
                {t('matches.reconfirmation.requiredBadge')}
              </li>
            ))}
          </ul>
        </>
      )}
      {required && (
        <>
          <p>
            {t(closed ? 'matches.reconfirmation.excluded' : 'matches.reconfirmation.description')}
          </p>
          <p>
            {t('matches.reconfirmation.deadline', { deadline: date(event.registration_cutoff_at) })}
          </p>
          <button
            ref={trigger}
            type="button"
            {...stylex.props(s.button)}
            disabled={closed || pending}
            onClick={() => {
              setOpen(true);
              request.current = null;
            }}
          >
            {t('matches.reconfirmation.reviewTerms')}
          </button>
          <Dialog.Root
            open={open}
            onOpenChange={(next) => {
              if (!pending) setOpen(next);
            }}
            disablePointerDismissal={pending}
          >
            <Dialog.Portal>
              <Dialog.Backdrop {...stylex.props(s.backdrop)} />
              <Dialog.Popup {...stylex.props(s.popup)} finalFocus={trigger}>
                <Dialog.Title>{t('matches.reconfirmation.reviewTerms')}</Dialog.Title>
                <Dialog.Description>{t('matches.reconfirmation.description')}</Dialog.Description>
                <p>
                  {t(`matches.type.${event.event_type}`)} · {date(event.starts_at)} ·{' '}
                  {event.timezone}
                </p>
                <p>{event.venue_name}</p>
                <p>
                  {t('matches.reconfirmation.deadline', {
                    deadline: date(event.registration_cutoff_at)
                  })}
                </p>
                {feedback && <p role="alert">{t(feedback)}</p>}
                {stale ? (
                  <button
                    type="button"
                    {...stylex.props(s.button)}
                    onClick={async () => {
                      await router.invalidate();
                      setOpen(false);
                    }}
                  >
                    {t('matches.management.edit.reload')}
                  </button>
                ) : (
                  <button
                    type="button"
                    {...stylex.props(s.button)}
                    disabled={pending || closed}
                    aria-busy={pending}
                    onClick={async () => {
                      if (pending || stale) return;
                      request.current ??= crypto.randomUUID();
                      setPending(true);
                      setFeedback(null);
                      try {
                        const result = await reconfirmMatchRegistration({
                          data: {
                            event_id: event.event_id,
                            attempt_id: required.attempt_id,
                            generation: required.required_generation,
                            request_id: request.current
                          }
                        });
                        if (result.status === 'ok') {
                          setFeedback('matches.reconfirmation.confirmed');
                          await router.invalidate();
                          setOpen(false);
                        } else if (result.status === 'error') {
                          setStale(result.code === 'stale_generation');
                          setFeedback(
                            result.code === 'stale_generation'
                              ? 'matches.reconfirmation.staleGeneration'
                              : MANAGEMENT_ERROR_COPY[result.code]
                          );
                        }
                      } catch {
                        setFeedback('matches.management.errors.unavailable');
                      } finally {
                        setPending(false);
                      }
                    }}
                  >
                    {t('matches.reconfirmation.confirm')}
                  </button>
                )}
                <Dialog.Close disabled={pending} {...stylex.props(s.button)}>
                  {t('matches.management.cancel')}
                </Dialog.Close>
              </Dialog.Popup>
            </Dialog.Portal>
          </Dialog.Root>
        </>
      )}
      {!open && feedback && <output aria-live="polite">{t(feedback)}</output>}
    </section>
  );
}
