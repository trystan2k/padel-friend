import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
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
import { StatisticsFilterSection, type FilterControls } from './StatisticsFilterSection';

/** Headline record, current streak and last meeting: the compact summary the pair frame leads with. */
function PairSummary({ pair }: { pair: Pair }) {
  const { t } = useTranslation();
  const f = useRelationshipFormat();
  const { matches, streaks } = pair.record;
  const last = pair.recent[0];
  return (
    <section
      aria-label={t('statistics.relationships.sections.record')}
      {...stylex.props(s.section)}
    >
      <SurfaceCard>
        <p {...stylex.props(s.headline)}>
          {t('statistics.relationships.pair.headline', {
            played: f.count(matches.played),
            wins: f.count(matches.wins),
            losses: f.count(matches.losses),
            draws: f.count(matches.draws)
          })}
        </p>
        <p {...stylex.props(s.copy)}>
          {streaks.current.kind === null
            ? t('statistics.relationships.pair.noStreak')
            : t('statistics.relationships.pair.streak', {
                length: f.count(streaks.current.length),
                kind: t(`statistics.player.form.streak.${streaks.current.kind}`)
              })}
        </p>
        <p {...stylex.props(s.copy)}>
          {last
            ? t('statistics.relationships.pair.lastMeeting', { date: f.date(last.playedAt) })
            : t('statistics.relationships.pair.noMeeting')}
        </p>
      </SurfaceCard>
    </section>
  );
}

/** The canonical pair, shown from the focal player's route so the way back keeps its context. */
export function PairStatistics({
  pair,
  filterControls
}: {
  pair: Pair;
  filterControls?: FilterControls;
}) {
  const { t } = useTranslation();
  const f = useRelationshipFormat();
  const focal = pair.players.find((player) => player.userId === pair.focalId);
  const other = pair.players.find((player) => player.userId === pair.otherId);
  return (
    <main {...stylex.props(s.page)}>
      <header {...stylex.props(s.header)}>
        <StatisticsBreadcrumb playerId={pair.focalId} filters={pair.filters} current="pair" />
        <div {...stylex.props(s.lead)}>
          <h1 {...stylex.props(s.title)}>
            {t('statistics.relationships.pair.heading', {
              first: f.name(focal?.displayName ?? null),
              second: f.name(other?.displayName ?? null)
            })}
          </h1>
          <p {...stylex.props(s.copy)}>{t('statistics.relationships.pair.subtitle')}</p>
        </div>
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
      {filterControls && (
        <StatisticsFilterSection
          id="pair-stats-filters"
          filters={pair.filters}
          controls={filterControls}
        />
      )}
      <PairSummary pair={pair} />
      <RelationshipSections
        compact
        record={pair.record}
        kind="pair"
        upsetThreshold={pair.config.thresholds.upset_expected_score_max}
      />
      <RecentMatches matches={pair.recent} showRating={false} />
    </main>
  );
}
