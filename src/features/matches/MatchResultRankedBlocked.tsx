import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { ResultPlayer, ResultProposal } from './match-result-model';
import { matchResultReviewStyles as s } from './match-result.styles';

/**
 * Visible blocked state for a Ranked group that cannot become official. The only resolution is the
 * existing authorized correction (a truthful played time); play that genuinely breaks the Ranked
 * rules is never converted to Unranked after the fact.
 */
export function MatchResultRankedBlocked({
  eventId,
  proposal
}: {
  eventId: string;
  proposal: ResultProposal;
}) {
  const { t } = useTranslation();
  const blocked = proposal.ranked_blocked;
  if (!blocked) return null;
  const players: ResultPlayer[] = [...proposal.teams.team_a, ...proposal.teams.team_b];
  const names = blocked.user_ids
    .map(
      (id) =>
        players.find((player) => player.user_id === id)?.display_name ??
        t('matches.results.unknownPlayer')
    )
    .join(', ');
  const headingId = `ranked-blocked-${proposal.proposal_id}`;
  return (
    <section aria-labelledby={headingId} {...stylex.props(s.rankedBlocked)}>
      <h4 id={headingId} {...stylex.props(s.rankedBlockedTitle)}>
        {t('matches.results.rankedBlocked.title')}
      </h4>
      <p {...stylex.props(s.impactCopy)}>
        {t(`matches.results.rankedBlocked.reason.${blocked.reason}`, { names })}
      </p>
      <p {...stylex.props(s.impactCopy)}>
        {proposal.can_correct
          ? t('matches.results.rankedBlocked.resolution')
          : t('matches.results.rankedBlocked.organizerOnly')}
      </p>
      {proposal.can_correct && (
        <Link
          to="/matches/$eventId/record"
          params={{ eventId }}
          search={{
            correctionProposalId: proposal.proposal_id,
            groupNumber: proposal.group_number
          }}
          {...stylex.props(s.correctionAction)}
        >
          {t('matches.results.correctResult')}
        </Link>
      )}
    </section>
  );
}
