import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ResultProposal, ResultSubmission } from './match-result-model';
import { MatchResultTeams, resultSetWins } from './MatchResultFacts';
import { matchResultStyles as s } from './match-result.styles';

export function MatchResultPending({
  proposal,
  timezone,
  asOf,
  focusReceipt = false,
  approvalProgress
}: {
  proposal: ResultProposal | ResultSubmission;
  timezone: string;
  asOf: string;
  focusReceipt?: boolean;
  approvalProgress?: string;
}) {
  const { t, i18n } = useTranslation();
  const clockKey = `${proposal.proposal_id}:${proposal.version}:${asOf}`;
  const [clock, setClock] = useState(() => ({ key: clockKey, now: Date.parse(asOf) }));
  const receiptHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusReceipt) receiptHeading.current?.focus();
  }, [focusReceipt]);
  useEffect(() => {
    const seed = Date.parse(asOf);
    const observedAt = performance.now();
    const timer = setInterval(
      () => setClock({ key: clockKey, now: seed + (performance.now() - observedAt) }),
      60000
    );
    return () => clearInterval(timer);
  }, [asOf, clockKey]);
  const deadline = new Date(proposal.review_deadline_at);
  const locale = i18n.language === 'en' ? 'en-GB' : i18n.language;
  const date = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: timezone
  });
  const time = new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone: timezone });
  const full = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone
  });
  const facts = 'teams' in proposal ? proposal : null;
  const wins = resultSetWins(facts?.sets ?? []);
  const winner = wins.team_a > wins.team_b ? 'team_a' : 'team_b';
  const now = clock.key === clockKey ? clock.now : Date.parse(asOf);
  const remainingHours = Math.max(0, Math.ceil((deadline.getTime() - now) / 3600000));
  const countdownLabel = t('matches.results.autoConfirmIn', { hours: remainingHours });
  return (
    <section
      {...stylex.props(s.form)}
      aria-label={t('matches.results.pending')}
      aria-live={focusReceipt ? 'polite' : undefined}
    >
      <div {...stylex.props(s.pendingRows)}>
        <h2 {...stylex.props(s.heading)}>{t('matches.results.proposalTitle')}</h2>
        <div {...stylex.props(s.pendingRows)}>
          <div {...stylex.props(s.pendingRow)}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
              {...stylex.props(s.statusIcon, s.clockIcon)}
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 6v6h5" />
            </svg>
            <div {...stylex.props(s.statusCopy)}>
              <h3 {...stylex.props(s.statusTitle)} tabIndex={-1} ref={receiptHeading}>
                {t('matches.results.pending')}
              </h3>
              <p {...stylex.props(s.copy)}>{t('matches.results.pendingDescription')}</p>
              {approvalProgress && <p {...stylex.props(s.pendingProgress)}>{approvalProgress}</p>}
            </div>
          </div>
          <div role="timer" aria-label={countdownLabel} {...stylex.props(s.pendingRow)}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
              {...stylex.props(s.statusIcon)}
            >
              <circle cx="12" cy="14" r="8" />
              <path d="M9 2h6m-3 7v5l-3 3m9-13 2 2" />
            </svg>
            <div {...stylex.props(s.statusCopy)}>
              <h3 {...stylex.props(s.statusTitle)}>
                {t('matches.results.autoConfirmIn', {
                  hours: remainingHours
                })}
              </h3>
              <p {...stylex.props(s.copy)}>{t('matches.results.autoConfirmDescription')}</p>
            </div>
          </div>
        </div>
        <p {...stylex.props(s.copy)}>
          {t('matches.results.group', { number: proposal.group_number })} ·{' '}
          {t('matches.results.versionLabel', { version: proposal.version })} ·{' '}
          {facts &&
            t('matches.results.submittedBy', {
              name: facts.submitted_by_name ?? t('matches.results.unknownPlayer'),
              date: date.format(new Date(proposal.submitted_at)),
              time: time.format(new Date(proposal.submitted_at))
            })}{' '}
          {t('matches.results.autoConfirmDeadline', { deadline: full.format(deadline) })}
        </p>
      </div>
      {facts && (
        <>
          <MatchResultTeams teams={facts.teams} />
          <section {...stylex.props(s.proposed)} aria-label={t('matches.results.setScores')}>
            <table {...stylex.props(s.scoreMatrix)}>
              <thead>
                <tr>
                  <th scope="col" {...stylex.props(s.matrixTeamHead)}>
                    {t('matches.results.matrixTeams')}
                  </th>
                  {[1, 2, 3].map((position) => (
                    <th scope="col" key={position} {...stylex.props(s.matrixHead)}>
                      {t('matches.results.matrixSet', { number: position })}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(['team_a', 'team_b'] as const).map((side) => (
                  <tr key={side}>
                    <th scope="row" {...stylex.props(s.matrixTeam)}>
                      <span {...stylex.props(s.label, s.matrixTeamLabel)}>
                        {t(`matches.results.teams.${side}`)}
                      </span>
                      <br />
                      <span {...stylex.props(s.matrixName)}>
                        {facts.teams[side]
                          .map(
                            (player) =>
                              (player.display_name ?? t('matches.results.unknownPlayer')).split(
                                ' '
                              )[0] +
                              (player.is_provisional ? ` (${t('player.provisional.badge')})` : '')
                          )
                          .join(' + ')}
                      </span>
                    </th>
                    {[1, 2, 3].map((position) => (
                      <td key={position} {...stylex.props(s.matrixCell)}>
                        {facts.sets.find((set) => set.position === position)?.[`${side}_games`] ??
                          '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p {...stylex.props(s.copy)}>
              {t(
                wins.team_a !== wins.team_b && facts.classification !== 'incomplete'
                  ? 'matches.results.proposedWin'
                  : 'matches.results.proposedOther',
                {
                  winnerSets: wins[winner],
                  loserSets: wins[winner === 'team_a' ? 'team_b' : 'team_a'],
                  team: t(`matches.results.teams.${winner}`),
                  outcome: t(`matches.results.outcome.${facts.classification}`, {
                    winnerSets: wins[winner],
                    loserSets: wins[winner === 'team_a' ? 'team_b' : 'team_a']
                  })
                }
              )}
            </p>
          </section>
        </>
      )}
    </section>
  );
}
