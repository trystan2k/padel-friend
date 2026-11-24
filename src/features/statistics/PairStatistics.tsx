import * as stylex from '@stylexjs/stylex';
import {
  RelationshipIdentity,
  RelationshipTiles,
  RelationshipTopBar
} from './RelationshipHeadline';
import { FilterContext } from './PlayerStatistics';
import { RelationshipMeetings } from './RelationshipMeetings';
import { RelationshipSections } from './RelationshipRecordView';
import type { PairStatistics as Pair } from './statistics-relationship-contracts';
import { playerStyles as s } from './statistics-player.styles';
import { StatisticsFilterSection, type FilterControls } from './StatisticsFilterSection';

const FILTERS_ID = 'pair-stats-filters';

/** The canonical pair, shown from the focal player's route so the way back keeps its context. */
export function PairStatistics({
  pair,
  filterControls,
  recentOffset = 0,
  onRecentOffsetChange
}: {
  pair: Pair;
  filterControls?: FilterControls;
  recentOffset?: number;
  onRecentOffsetChange?: (offset: number) => void;
}) {
  const focal = pair.players.find((player) => player.userId === pair.focalId);
  const other = pair.players.find((player) => player.userId === pair.otherId);
  return (
    <main data-route-chrome="navigation" {...stylex.props(s.page)}>
      <RelationshipTopBar
        kind="pair"
        playerId={pair.focalId}
        filters={pair.filters}
        filtersId={filterControls ? FILTERS_ID : undefined}
      />
      <RelationshipIdentity kind="pair" focal={focal} other={other} />
      <RelationshipTiles kind="pair" record={pair.record} />
      <RelationshipMeetings
        key={JSON.stringify([pair.focalId, pair.otherId, pair.filters])}
        subject={pair}
        kind="pair"
        offset={recentOffset}
        onOffsetChange={onRecentOffsetChange}
      />
      <FilterContext filters={pair.filters} />
      {filterControls && (
        <StatisticsFilterSection id={FILTERS_ID} filters={pair.filters} controls={filterControls} />
      )}
      <RelationshipSections
        compact
        record={pair.record}
        kind="pair"
        upsetThreshold={pair.config.thresholds.upset_expected_score_max}
      />
    </main>
  );
}
