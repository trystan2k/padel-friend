import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { FilterContext } from './PlayerStatistics';
import {
  RecentMatches,
  RelationshipSections,
  useRelationshipFormat
} from './RelationshipRecordView';
import type { PairStatistics as Pair } from './statistics-relationship-contracts';
import { playerStyles as s } from './statistics-player.styles';
import { filterSearch } from './statistics-search';
import { StatisticsBreadcrumb } from './StatisticsBreadcrumb';

/** The canonical pair, shown from the focal player's route so the way back keeps its context. */
export function PairStatistics({ pair }: { pair: Pair }) {
  const { t } = useTranslation();
  const f = useRelationshipFormat();
  const focal = pair.players.find((player) => player.userId === pair.focalId);
  const other = pair.players.find((player) => player.userId === pair.otherId);
  return (
    <main {...stylex.props(s.page)}>
      <header {...stylex.props(s.header)}>
        <StatisticsBreadcrumb playerId={pair.focalId} filters={pair.filters} current="pair" />
        <h1 {...stylex.props(s.title)}>
          {t('statistics.relationships.pair.heading', {
            first: f.name(focal?.displayName ?? null),
            second: f.name(other?.displayName ?? null)
          })}
        </h1>
        <p {...stylex.props(s.copy)}>{t('statistics.relationships.pair.subtitle')}</p>
        <FilterContext filters={pair.filters} />
        <Link
          to="/players/$playerId"
          params={{ playerId: pair.focalId }}
          search={filterSearch(pair.filters)}
          {...stylex.props(s.link)}
        >
          {t('statistics.relationships.backToPlayer')}
        </Link>
      </header>
      <RelationshipSections
        record={pair.record}
        kind="pair"
        upsetThreshold={pair.config.thresholds.upset_expected_score_max}
      />
      <RecentMatches matches={pair.recent} showRating={false} />
    </main>
  );
}
