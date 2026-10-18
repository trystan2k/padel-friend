import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MatchRegistrationQueue, MatchRegistrationRequest } from './match-registration-model';
import { matchRegistrationStyles as s } from './match-registration.styles';
import { useMatchRequestQueue } from './use-match-registration';

// PAF-5.5 creator-only pending request queue with approve/decline. Rendered only
// for the event creator (the server returns no rows to anyone else), so an
// unauthorized caller never sees the surface at all.

function relativeWhen(language: string, iso: string, now: number): string | null {
  const target = Date.parse(iso);
  if (!Number.isFinite(target)) return null;
  const formatter = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  const minutes = Math.round((target - now) / 60000);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour');
  return formatter.format(Math.round(hours / 24), 'day');
}

export function MatchRequestQueue({
  eventId,
  eventName,
  queue,
  minLevel = null,
  maxLevel = null,
  error = false,
  onRetry = () => undefined
}: {
  eventId: string;
  eventName: string;
  queue: MatchRegistrationQueue | null;
  minLevel?: number | null;
  maxLevel?: number | null;
  error?: boolean;
  onRetry?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const controller = useMatchRequestQueue({ eventId });
  const now = useState(() => Date.now())[0];

  const feedbackMessage = (() => {
    const feedback = controller.feedback;
    if (!feedback) return null;
    if (feedback.kind === 'approved') return t('matchRegistration.feedback.approved');
    if (feedback.kind === 'rejected') return t('matchRegistration.feedback.rejected');
    if (feedback.kind === 'offline') return t('matchRegistration.feedback.offline');
    return t(`matchRegistration.feedback.${feedback.code}`);
  })();

  if (error) {
    return (
      <section aria-labelledby="match-requests-heading" role="alert" {...stylex.props(s.panel)}>
        <h2 id="match-requests-heading" {...stylex.props(s.title)}>
          {t('matchRegistration.queue.title')}
        </h2>
        <p {...stylex.props(s.copy)}>{t('matchRegistration.queue.error')}</p>
        <div {...stylex.props(s.actions)}>
          <button type="button" onClick={onRetry} {...stylex.props(s.secondaryButton)}>
            {t('matchRegistration.queue.retry')}
          </button>
        </div>
      </section>
    );
  }

  if (!queue) return null;

  const requests = queue.requests;
  const requestType = (request: MatchRegistrationRequest) => {
    if (request.registration_source === 'guest') return 'guest' as const;
    if (
      minLevel !== null &&
      maxLevel !== null &&
      (request.display_level === null ||
        request.display_level < minLevel ||
        request.display_level > maxLevel)
    )
      return 'out_of_range' as const;
    return null;
  };

  return (
    <section aria-labelledby="match-requests-heading" {...stylex.props(s.panel, s.queue)}>
      <header {...stylex.props(s.queueHeader)}>
        <div {...stylex.props(s.header)}>
          <h2 id="match-requests-heading" {...stylex.props(s.title)}>
            {t('matchRegistration.queue.title')}
          </h2>
          <p {...stylex.props(s.meta)}>
            {t('matchRegistration.queue.subtitle', {
              event: eventName,
              count: requests.length
            })}
          </p>
        </div>
        <span {...stylex.props(s.queueSort)}>{t('matchRegistration.queue.sort')}</span>
      </header>
      <p {...stylex.props(s.badgeRow)}>
        <span {...stylex.props(s.badge, s.badgeReserve)}>
          {t('matchRegistration.queue.count', { count: requests.length })}
        </span>
      </p>
      <div {...stylex.props(s.body)}>
        <h3 {...stylex.props(s.rosterTitle)}>{t('matchRegistration.queue.fifoTitle')}</h3>
        <p {...stylex.props(s.note)}>{t('matchRegistration.queue.fifoCopy')}</p>
      </div>
      {requests.length === 0 ? (
        <p {...stylex.props(s.copy)}>{t('matchRegistration.queue.empty')}</p>
      ) : (
        <ul {...stylex.props(s.requestList)}>
          {requests.map((request) => {
            const type = requestType(request);
            const name = request.display_name ?? t('matchRegistration.queue.requesterFallback');
            const when = relativeWhen(i18n.language, request.requested_at, now);
            const busy = controller.pending || !controller.online;
            return (
              <li key={request.user_id} {...stylex.props(s.requestCard)}>
                <div {...stylex.props(s.requestHeader)}>
                  <p {...stylex.props(s.requestName)}>{name}</p>
                  {type === 'guest' && (
                    <span {...stylex.props(s.badge, s.badgeGuest)}>
                      {t('matchRegistration.queue.typeGuest')}
                    </span>
                  )}
                  {type === 'out_of_range' && (
                    <span {...stylex.props(s.badge, s.badgeDanger)}>
                      {t('matchRegistration.queue.typeOutOfRange')}
                    </span>
                  )}
                </div>
                <p {...stylex.props(s.meta)}>
                  {type === 'out_of_range'
                    ? t('matchRegistration.queue.contextOutOfRange', {
                        min: minLevel,
                        max: maxLevel,
                        when
                      })
                    : t('matchRegistration.queue.contextGuest', { when })}
                </p>
                <div {...stylex.props(s.actions)}>
                  <button
                    type="button"
                    onClick={() => controller.decide(request.user_id, 'approve')}
                    disabled={busy}
                    aria-label={t('matchRegistration.queue.approveLabel', { name })}
                    {...stylex.props(s.primaryButton, busy && s.disabledButton)}
                  >
                    {t('matchRegistration.queue.approve')}
                  </button>
                  <button
                    type="button"
                    onClick={() => controller.decide(request.user_id, 'reject')}
                    disabled={busy}
                    aria-label={t('matchRegistration.queue.declineLabel', { name })}
                    {...stylex.props(s.secondaryButton, busy && s.disabledButton)}
                  >
                    {t('matchRegistration.queue.decline')}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <output aria-live="polite" {...stylex.props(s.status)}>
        {feedbackMessage}
      </output>
      {!controller.online && (
        <output aria-live="polite" {...stylex.props(s.status)}>
          {t('matchRegistration.feedback.offline')}
        </output>
      )}
    </section>
  );
}
