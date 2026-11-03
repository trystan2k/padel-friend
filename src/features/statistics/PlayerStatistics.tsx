import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import { StatusBadge } from '../../components/ui/StatusBadge';
import type { StatisticsFilters } from './statistics-contracts';
import type {
  PlayerFormSample,
  PlayerStatistics as Statistics
} from './statistics-player-contracts';
import {
  CountStat,
  BestRankStat,
  MetricStat,
  RankStat,
  Section,
  Stat,
  usePlayerFormat
} from './PlayerMetric';
import { PlayerStatisticsRecords } from './PlayerStatisticsRecords';
import { StatisticsChart } from './StatisticsChart';
import { StatisticsFilterSection, type FilterControls } from './StatisticsFilterSection';
import { ReasonText, StatisticsEmpty } from './StatisticsStates';
import { playerStyles as s } from './statistics-player.styles';

const CHART_MONTHS = 12;

const OUTCOME_TONE = { W: 'positive', L: 'danger', D: 'neutral' } as const;

/** The active filter set, read back so the figures below are never ambiguous about their scope. */
export function FilterContext({ filters }: { filters: StatisticsFilters }) {
  const { t } = useTranslation();
  const { date } = usePlayerFormat();
  const scope = filters.leagueId ? 'league' : filters.communityId ? 'community' : 'all';
  const range =
    filters.from && filters.through
      ? t('statistics.player.filters.between', {
          from: date(filters.from),
          through: date(filters.through)
        })
      : filters.from
        ? t('statistics.player.filters.since', { date: date(filters.from) })
        : filters.through
          ? t('statistics.player.filters.until', { date: date(filters.through) })
          : t('statistics.player.filters.anyDate');
  return (
    <ul aria-label={t('statistics.player.filters.label')} {...stylex.props(s.filters)}>
      <li>
        <StatusBadge tone="muted">{t(`statistics.player.filters.scope.${scope}`)}</StatusBadge>
      </li>
      <li>
        <StatusBadge tone="muted">
          {t(`statistics.player.filters.type.${filters.type}`)}
        </StatusBadge>
      </li>
      <li>
        <StatusBadge tone="muted">{range}</StatusBadge>
      </li>
    </ul>
  );
}

function OutcomeBadges({ outcomes }: { outcomes: PlayerFormSample['outcomes'] }) {
  const { t } = useTranslation();
  return (
    <ul aria-label={t('statistics.player.form.outcomes')} {...stylex.props(s.outcomes)}>
      {outcomes.map((entry, index) => (
        <li key={`${entry.g}-${index}`}>
          <StatusBadge tone={OUTCOME_TONE[entry.o]}>
            {t(`statistics.player.form.outcome.${entry.o}`)}
          </StatusBadge>
        </li>
      ))}
    </ul>
  );
}

function FormStat({
  id,
  label,
  metric
}: {
  id: string;
  label: string;
  metric: Statistics['form']['last5'];
}) {
  const { t } = useTranslation();
  const { count } = usePlayerFormat();
  if (metric.state !== 'ready') {
    return (
      <Stat id={id} label={label}>
        <strong {...stylex.props(s.value, s.valueMuted)}>{t('statistics.player.noValue')}</strong>
        <ReasonText metric={metric} />
      </Stat>
    );
  }
  const sample = metric.value;
  return (
    <Stat id={id} label={label}>
      <strong {...stylex.props(s.value)}>
        {t('statistics.player.form.record', {
          wins: count(sample.wins),
          losses: count(sample.losses),
          draws: count(sample.draws)
        })}
      </strong>
      <span {...stylex.props(s.detail)}>
        {t('statistics.player.form.sample', {
          size: count(sample.sampleSize),
          capacity: count(sample.capacity)
        })}
      </span>
      <OutcomeBadges outcomes={sample.outcomes} />
    </Stat>
  );
}

function CurrentStreak({ current }: { current: Statistics['form']['current'] }) {
  const { t } = useTranslation();
  const { count } = usePlayerFormat();
  const kind = current.kind;
  return (
    <Stat id="player.form.current" label={t('statistics.player.form.current')}>
      <strong {...stylex.props(s.value, kind === null && s.valueMuted)}>
        {kind === null ? t('statistics.player.form.noStreak') : count(current.length)}
      </strong>
      {kind !== null && (
        <span {...stylex.props(s.detail)}>{t(`statistics.player.form.streak.${kind}`)}</span>
      )}
    </Stat>
  );
}

/** Matches per month; the chart's table holds every month, so no figure is conveyed by shape alone. */
function ActivitySeries({ months }: { months: Statistics['activity']['months'] }) {
  const { t } = useTranslation();
  const { count, month } = usePlayerFormat();
  if (months.length === 0) {
    return <StatisticsEmpty>{t('statistics.player.activity.empty')}</StatisticsEmpty>;
  }
  return (
    <StatisticsChart
      title={t('statistics.player.activity.caption')}
      headerLabel={t('statistics.player.activity.month')}
      valueLabel={t('statistics.player.activity.matches')}
      points={months.map((entry) => ({
        key: entry.period,
        label: month(entry.period),
        value: entry.groups
      }))}
      plotLimit={CHART_MONTHS}
      formatValue={count}
    />
  );
}

/**
 * A player's sporting statistics for one filter set. Every figure is an evidence state from the
 * server: insufficient data reads as a localized reason, never as 0, NaN or a blank.
 */
export function PlayerStatistics({
  stats,
  filterControls,
  children
}: {
  stats: Statistics;
  filterControls?: FilterControls;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const f = usePlayerFormat();
  const { matches, sets, games, rating, form, activity } = stats;
  return (
    <main {...stylex.props(s.page)}>
      <header {...stylex.props(s.header)}>
        <div {...stylex.props(s.lead)}>
          <h1 {...stylex.props(s.title)}>{t('statistics.player.title')}</h1>
          <p {...stylex.props(s.copy)}>{t('statistics.player.subtitle')}</p>
        </div>
        <FilterContext filters={stats.filters} />
        {!stats.config.rating_aligned && (
          <output {...stylex.props(s.copy)}>{t('statistics.player.ratingLagging')}</output>
        )}
      </header>

      {filterControls && (
        <StatisticsFilterSection
          id="player-stats-filters"
          filters={stats.filters}
          controls={filterControls}
        />
      )}

      <section aria-label={t('statistics.player.sections.highlights')} {...stylex.props(s.section)}>
        <dl {...stylex.props(s.hero)}>
          <MetricStat
            tile
            id="player.matches.winRate"
            label={t('statistics.player.matches.winRate')}
            metric={matches.winRate}
            format={f.ratio}
            unit="matches"
          />
          <CountStat
            tile
            id="player.sets.differential"
            label={t('statistics.player.sets.differential')}
            value={f.signed(sets.differential)}
          />
          <CountStat
            tile
            id="player.games.differential"
            label={t('statistics.player.games.differential')}
            value={f.signed(games.differential)}
          />
        </dl>
        <p {...stylex.props(s.strip)}>
          <span {...stylex.props(s.stripLabel)}>{t('statistics.player.hero.record')}</span>
          <strong {...stylex.props(s.stripValue)}>
            {t('statistics.player.hero.recordValue', {
              wins: f.count(matches.wins),
              losses: f.count(matches.losses),
              draws: f.count(matches.draws)
            })}
          </strong>
        </p>
      </section>

      <Section id="player-stats-form" title={t('statistics.player.sections.form')}>
        <dl {...stylex.props(s.stats)}>
          <FormStat
            id="player.form.last5"
            label={t('statistics.player.form.last5')}
            metric={form.last5}
          />
          <FormStat
            id="player.form.last10"
            label={t('statistics.player.form.last10')}
            metric={form.last10}
          />
          <CurrentStreak current={form.current} />
          <CountStat
            id="player.form.longestWins"
            label={t('statistics.player.form.longestWins')}
            value={form.longestWins}
          />
          <CountStat
            id="player.form.longestLosses"
            label={t('statistics.player.form.longestLosses')}
            value={form.longestLosses}
          />
        </dl>
      </Section>

      {children}

      <Section id="player-stats-matches" title={t('statistics.player.sections.matches')}>
        <dl {...stylex.props(s.stats)}>
          <CountStat
            id="player.matches.played"
            label={t('statistics.player.matches.played')}
            value={matches.played}
          />
          <CountStat
            id="player.matches.competitive"
            label={t('statistics.player.matches.competitive')}
            value={matches.competitive}
          />
          <CountStat
            id="player.matches.friendly"
            label={t('statistics.player.matches.friendly')}
            value={matches.friendly}
          />
          <CountStat
            id="player.matches.wins"
            label={t('statistics.player.matches.wins')}
            value={matches.wins}
          />
          <CountStat
            id="player.matches.losses"
            label={t('statistics.player.matches.losses')}
            value={matches.losses}
          />
          <CountStat
            id="player.matches.draws"
            label={t('statistics.player.matches.draws')}
            value={matches.draws}
          />
          <CountStat
            id="player.matches.incomplete"
            label={t('statistics.player.matches.incomplete')}
            value={matches.incomplete}
          />
          <MetricStat
            id="player.matches.competitiveWinRate"
            label={t('statistics.player.matches.competitiveWinRate')}
            metric={matches.competitiveWinRate}
            format={f.ratio}
            unit="matches"
          />
          <MetricStat
            id="player.matches.friendlyWinRate"
            label={t('statistics.player.matches.friendlyWinRate')}
            metric={matches.friendlyWinRate}
            format={f.ratio}
            unit="matches"
          />
        </dl>
      </Section>

      <Section id="player-stats-scores" title={t('statistics.player.sections.scores')}>
        <dl {...stylex.props(s.stats)}>
          <CountStat
            id="player.sets.won"
            label={t('statistics.player.sets.won')}
            value={sets.won}
          />
          <CountStat
            id="player.sets.lost"
            label={t('statistics.player.sets.lost')}
            value={sets.lost}
          />
          <MetricStat
            id="player.sets.winRate"
            label={t('statistics.player.sets.winRate')}
            metric={sets.winRate}
            format={f.ratio}
            unit="sets"
          />
          <CountStat
            id="player.games.won"
            label={t('statistics.player.games.won')}
            value={games.won}
          />
          <CountStat
            id="player.games.lost"
            label={t('statistics.player.games.lost')}
            value={games.lost}
          />
          <MetricStat
            id="player.games.winRate"
            label={t('statistics.player.games.winRate')}
            metric={games.winRate}
            format={f.ratio}
            unit="games"
          />
          <MetricStat
            id="player.games.averageWon"
            label={t('statistics.player.games.averageWon')}
            metric={games.averageWonPerGroup}
            format={f.count}
            unit="matches"
          />
          <MetricStat
            id="player.games.averageConceded"
            label={t('statistics.player.games.averageConceded')}
            metric={games.averageConcededPerGroup}
            format={f.count}
            unit="matches"
          />
        </dl>
      </Section>

      <Section id="player-stats-rating" title={t('statistics.player.sections.rating')}>
        <dl {...stylex.props(s.stats)}>
          <MetricStat
            id="player.rating.current"
            label={t('statistics.player.rating.current')}
            metric={rating.currentLevel}
            format={f.level}
          />
          <MetricStat
            id="player.rating.reliability"
            label={t('statistics.player.rating.reliability')}
            metric={rating.reliability}
            format={f.reliability}
          />
          <MetricStat
            id="player.rating.starting"
            label={t('statistics.player.rating.starting')}
            metric={rating.startingLevel}
            format={f.level}
          />
          <MetricStat
            id="player.rating.highest"
            label={t('statistics.player.rating.highest')}
            metric={rating.highestLevel}
            format={f.level}
          />
          <MetricStat
            id="player.rating.lowestEstablished"
            label={t('statistics.player.rating.lowestEstablished')}
            metric={rating.lowestEstablishedLevel}
            format={f.level}
          />
          <MetricStat
            id="player.rating.filteredDelta"
            label={t('statistics.player.rating.filteredDelta')}
            metric={rating.filteredDelta}
            format={f.signed}
            unit="rated"
          />
          <RankStat
            id="player.rating.communityRank"
            label={t('statistics.player.rating.communityRank')}
            metric={rating.communitySkillRank}
          />
          <RankStat
            id="player.rating.leaguePosition"
            label={t('statistics.player.rating.leaguePosition')}
            metric={rating.activeLeaguePosition}
          />
          <BestRankStat
            id="player.rating.bestCommunityRank"
            label={t('statistics.player.rating.bestCommunityRank')}
            history={rating.bestCommunitySkillRank}
          />
          <BestRankStat
            id="player.rating.bestLeaguePosition"
            label={t('statistics.player.rating.bestLeaguePosition')}
            history={rating.bestLeaguePosition}
          />
        </dl>
      </Section>

      <Section id="player-stats-activity" title={t('statistics.player.sections.activity')}>
        <ActivitySeries months={activity.months} />
      </Section>

      <PlayerStatisticsRecords stats={stats} />
    </main>
  );
}
