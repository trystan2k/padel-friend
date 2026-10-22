import * as stylex from '@stylexjs/stylex';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { respondMatchEventInvitation } from './match-invitation.functions';
import {
  MATCH_INVITATION_ERROR_COPY,
  type InvitationResult,
  type MatchInvitation
} from './match-invitation-model';
import { matchInvitationStyles as s } from './match-invitation.styles';
import { matchRegistrationStyles as buttons } from './match-registration.styles';
import { MatchManagementUnavailable } from './MatchManagementUnavailable';

export function MatchInvitationPanel({
  eventId,
  invitation,
  timezone,
  pendingApproval = false
}: {
  eventId: string;
  invitation: MatchInvitation;
  timezone: string;
  pendingApproval?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<InvitationResult | null>(null);
  const current =
    invitation.status === 'pending' && result && result.status !== 'error'
      ? result.status
      : invitation.effective_status;
  const approval =
    current === 'accepted' &&
    (pendingApproval ||
      (invitation.status === 'pending' &&
        result?.status === 'accepted' &&
        result.registration.lifecycle === 'pending'));
  const errorKey =
    current === 'pending' && result?.status === 'error'
      ? MATCH_INVITATION_ERROR_COPY[result.code]
      : null;
  const unavailable =
    result?.status === 'error' &&
    (result.code === 'cancelled' ||
      result.code === 'result_protected' ||
      result.code === 'started' ||
      result.code === 'closed' ||
      result.code === 'forbidden')
      ? result.code
      : null;
  async function respond(response: 'accept' | 'decline') {
    if (busy) return;
    setBusy(true);
    try {
      const next = await respondMatchEventInvitation({
        data: { event_id: eventId, invitation_id: invitation.invitation_id, response }
      });
      setResult(next);
      await router.invalidate();
    } catch {
      setResult({ status: 'error', code: 'unavailable' });
    } finally {
      setBusy(false);
    }
  }
  if (unavailable) return <MatchManagementUnavailable reason={unavailable} />;
  return (
    <section aria-labelledby="match-invitation-title" aria-busy={busy} {...stylex.props(s.panel)}>
      <h2 id="match-invitation-title" {...stylex.props(s.title)}>
        {t('matches.invitations.title')}
      </h2>
      <output aria-live="polite" aria-atomic="true" {...stylex.props(s.status)}>
        <span {...stylex.props(s.copy)}>
          {t(`matches.invitations.${approval ? 'pendingApproval' : current}`)}
        </span>
        {errorKey && <span {...stylex.props(s.copy)}>{t(errorKey)}</span>}
      </output>
      {current === 'pending' && (
        <>
          <p {...stylex.props(s.copy)}>
            {t('matches.invitations.expiresAt', {
              deadline: new Intl.DateTimeFormat(i18n.language, {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: timezone
              }).format(new Date(invitation.expires_at))
            })}
          </p>
          <div {...stylex.props(s.actions)}>
            <button
              type="button"
              disabled={busy}
              onClick={() => void respond('accept')}
              {...stylex.props(buttons.primaryButton, busy && buttons.disabledButton)}
            >
              {t('matches.invitations.accept')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void respond('decline')}
              {...stylex.props(buttons.secondaryButton, busy && buttons.disabledButton)}
            >
              {t('matches.invitations.decline')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
