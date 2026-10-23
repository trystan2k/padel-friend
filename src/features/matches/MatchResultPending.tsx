import * as stylex from '@stylexjs/stylex';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ResultProposal, ResultSubmission } from './match-result-model';
import { matchResultStyles as s } from './match-result.styles';

export function MatchResultPending({
  proposal,
  timezone,
  asOf
}: {
  proposal: ResultProposal | ResultSubmission;
  timezone: string;
  asOf: string;
}) {
  const { t, i18n } = useTranslation();
  const [now, setNow] = useState(() => Date.parse(asOf));
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const deadline = new Date(proposal.review_deadline_at);
  return (
    <section
      {...stylex.props(s.card, s.pending)}
      aria-label={t('matches.results.pending')}
      aria-live="polite"
    >
      <h2 {...stylex.props(s.heading)}>{t('matches.results.pending')}</h2>
      <p {...stylex.props(s.copy)}>{t('matches.results.pendingDescription')}</p>
      <p>
        {t('matches.results.group', { number: proposal.group_number })} ·{' '}
        {t('matches.results.versionLabel', { version: proposal.version })}
      </p>
      <p>
        {t('matches.results.autoConfirmIn', {
          hours: Math.max(0, Math.ceil((deadline.getTime() - now) / 3600000))
        })}
      </p>
      <p {...stylex.props(s.copy)}>
        {t('matches.results.reviewDeadline', {
          deadline: new Intl.DateTimeFormat(i18n.language, {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone: timezone
          }).format(deadline)
        })}
      </p>
    </section>
  );
}
