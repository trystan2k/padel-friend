import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import {
  RelationshipIdentity,
  RelationshipTiles,
  RelationshipTopBar
} from './RelationshipHeadline';
import { FilterContext } from './PlayerStatistics';
import { RelationshipMeetings } from './RelationshipMeetings';
import { RelationshipSections, useRelationshipFormat } from './RelationshipRecordView';
import type { OpponentStatistics as Opponent } from './statistics-relationship-contracts';
import { playerStyles as s } from './statistics-player.styles';
import { StatisticsFilterSection, type FilterControls } from './StatisticsFilterSection';

const FILTERS_ID = 'opponent-stats-filters';

/** Head-to-head, always from the focal player's point of view. */
export function OpponentStatistics({
  opponent,
  filterControls,
  recentOffset = 0,
  onRecentOffsetChange
}: {
  opponent: Opponent;
  filterControls?: FilterControls;
  recentOffset?: number;
  onRecentOffsetChange?: (offset: number) => void;
}) {
  const { t } = useTranslation();
  const f = useRelationshipFormat();
  return (
    <main {...stylex.props(s.page)}>
      <RelationshipTopBar
        playerId={opponent.focalId}
        filters={opponent.filters}
        heading={t('statistics.relationships.opponent.heading', {
          first: f.name(opponent.focal.displayName),
          second: f.name(opponent.other.displayName)
        })}
        filtersId={filterControls ? FILTERS_ID : undefined}
      />
      <RelationshipIdentity kind="opponent" focal={opponent.focal} other={opponent.other} />
      <RelationshipTiles kind="opponent" record={opponent.record} />
      <RelationshipMeetings
        key={JSON.stringify([opponent.focalId, opponent.otherId, opponent.filters])}
        subject={opponent}
        kind="opponent"
        offset={recentOffset}
        onOffsetChange={onRecentOffsetChange}
      />
      <FilterContext filters={opponent.filters} />
      {filterControls && (
        <StatisticsFilterSection
          id={FILTERS_ID}
          filters={opponent.filters}
          controls={filterControls}
        />
      )}
      <RelationshipSections
        record={opponent.record}
        kind="opponent"
        upsetThreshold={opponent.config.thresholds.upset_expected_score_max}
      />
    </main>
  );
}
