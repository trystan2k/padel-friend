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
import { MatchManagementUnavailable } from './MatchManagementUnavailable';
import type { ManagementErrorCode } from './match-management-model';
import { matchRegistrationStyles as card } from './match-registration.styles';

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
  const [unavailable, setUnavailable] = useState<ManagementErrorCode | null>(null);
  const [asOf] = useState(() => Date.now());
  const request = useRef<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const required = registration?.state === 'reconfirmation_required' ? registration : null;
  const players = participants.filter(requiresMatchReconfirmation);
  if (unavailable) return <MatchManagementUnavailable reason={unavailable} focus />;
  if (!required && (!isCreator || !players.length)) return null;
  const date = (instant: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      dateStyle: 'medium',
      timeStyle: 'medium',
      timeZone: event.timezone
    }).format(new Date(instant));
  const closed = event.is_past || Date.parse(event.registration_cutoff_at) <= asOf;
  return (
    <section
      {...stylex.props(card.panel, card.positive)}
      aria-labelledby="match-reconfirmation-heading"
    >
      <h2 id="match-reconfirmation-heading" {...stylex.props(card.title, card.reconfirmTitle)}>
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          {...stylex.props(card.refreshIcon)}
        >
          <path d="M20 7v5h-5M4 17v-5h5M6.1 6.1A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.9 5.9" />
        </svg>
        {t('matches.reconfirmation.title')}
      </h2>
      {isCreator && (
        <>
          <p {...stylex.props(card.reconfirmSummary)}>
            {t('matches.reconfirmation.creatorSummary', { count: players.length })}
          </p>
          <ul {...stylex.props(card.requestList)}>
            {players.map((player) => (
              <li key={player.attempt_id} {...stylex.props(card.reconfirmPlayer)}>
                <strong>
                  {player.display_name ?? t('matchRegistration.roster.playerFallback')}
                </strong>
                <span {...stylex.props(card.meta)}>
                  {t('matchRegistration.roster.awaitingStatus')}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {required && (
        <>
          <p {...stylex.props(card.copy)}>
            {t(closed ? 'matches.reconfirmation.excluded' : 'matches.reconfirmation.description')}
          </p>
          <p {...stylex.props(card.copy)}>
            {t('matches.reconfirmation.deadline', { deadline: date(event.registration_cutoff_at) })}
          </p>
          <button
            ref={trigger}
            type="button"
            {...stylex.props(card.secondaryButton)}
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
                          if (
                            [
                              'cancelled',
                              'result_protected',
                              'started',
                              'closed',
                              'forbidden',
                              'stale_attempt'
                            ].includes(result.code)
                          ) {
                            setUnavailable(result.code);
                            setOpen(false);
                          }
                          setStale(result.code === 'stale_generation');
                          setFeedback(
                            result.code === 'stale_generation'
                              ? 'matches.reconfirmation.staleGeneration'
                              : MANAGEMENT_ERROR_COPY[result.code]
                          );
                          await router.invalidate().catch(() => undefined);
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
