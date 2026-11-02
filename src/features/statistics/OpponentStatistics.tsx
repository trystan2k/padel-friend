import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { FilterContext } from './PlayerStatistics';
import {
  RecentMatches,
  RelationshipSections,
  useRelationshipFormat
} from './RelationshipRecordView';
import type { OpponentStatistics as Opponent } from './statistics-relationship-contracts';
import { playerStyles as s } from './statistics-player.styles';
import { filterSearch } from './statistics-links';

/** Head-to-head, always from the focal player's point of view. */
export function OpponentStatistics({ opponent }: { opponent: Opponent }) {
  const { t } = useTranslation();
  const f = useRelationshipFormat();
  return (
    <main {...stylex.props(s.page)}>
      <header {...stylex.props(s.header)}>
        <h1 {...stylex.props(s.title)}>
          {t('statistics.relationships.opponent.heading', {
            first: f.name(opponent.focal.displayName),
            second: f.name(opponent.other.displayName)
          })}
        </h1>
        <p {...stylex.props(s.copy)}>{t('statistics.relationships.opponent.subtitle')}</p>
        <FilterContext filters={opponent.filters} />
        <Link
          to="/players/$playerId"
          params={{ playerId: opponent.focalId }}
          search={filterSearch(opponent.filters)}
          {...stylex.props(s.link)}
        >
          {t('statistics.relationships.backToPlayer')}
        </Link>
      </header>
      <RelationshipSections
        record={opponent.record}
        kind="opponent"
        upsetThreshold={opponent.config.thresholds.upset_expected_score_max}
      />
      <RecentMatches matches={opponent.recent} showRating />
    </main>
  );
}
