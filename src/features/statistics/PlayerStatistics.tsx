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
  ReasonText,
  Section,
  Stat,
  usePlayerFormat
} from './PlayerMetric';
import { PlayerStatisticsRecords } from './PlayerStatisticsRecords';
import { playerStyles as s } from './statistics-player.styles';

const CHART_MONTHS = 12;
const CHART_WIDTH = 240;
const CHART_HEIGHT = 80;

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

function FormStat({ label, metric }: { label: string; metric: Statistics['form']['last5'] }) {
  const { t } = useTranslation();
  const { count } = usePlayerFormat();
  if (metric.state !== 'ready') {
    return (
      <Stat label={label}>
        <strong {...stylex.props(s.value, s.valueMuted)}>{t('statistics.player.noValue')}</strong>
        <ReasonText metric={metric} />
      </Stat>
    );
  }
  const sample = metric.value;
  return (
    <Stat label={label}>
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
    <Stat label={t('statistics.player.form.current')}>
      <strong {...stylex.props(s.value, kind === null && s.valueMuted)}>
        {kind === null ? t('statistics.player.form.noStreak') : count(current.length)}
      </strong>
      {kind !== null && (
        <span {...stylex.props(s.detail)}>{t(`statistics.player.form.streak.${kind}`)}</span>
      )}
    </Stat>
  );
}

/**
 * Bars for matches per month plus the same numbers as a table: the table is the textual
 * equivalent of the chart, so no figure is conveyed by shape alone.
 */
function ActivitySeries({ months }: { months: Statistics['activity']['months'] }) {
  const { t } = useTranslation();
  const { count, month } = usePlayerFormat();
  const recent = months.slice(-CHART_MONTHS);
  const peak = Math.max(1, ...recent.map((entry) => entry.groups));
  const slot = CHART_WIDTH / Math.max(1, recent.length);
  if (recent.length === 0) {
    return <p {...stylex.props(s.copy)}>{t('statistics.player.activity.empty')}</p>;
  }
  return (
    <div {...stylex.props(s.section)}>
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        preserveAspectRatio="none"
        {...stylex.props(s.chart)}
      >
        {recent.map((entry, index) => {
          const height = (entry.groups / peak) * CHART_HEIGHT;
          return (
            <rect
              key={entry.period}
              x={index * slot + slot * 0.15}
              y={CHART_HEIGHT - height}
              width={slot * 0.7}
              height={height}
              {...stylex.props(s.bar)}
            />
          );
        })}
      </svg>
      <table {...stylex.props(s.table)}>
        <caption {...stylex.props(s.caption)}>{t('statistics.player.activity.caption')}</caption>
        <thead>
          <tr>
            <th scope="col" {...stylex.props(s.cell)}>
              {t('statistics.player.activity.month')}
            </th>
            <th scope="col" {...stylex.props(s.cell)}>
              {t('statistics.player.activity.matches')}
            </th>
          </tr>
        </thead>
        <tbody>
          {recent.map((entry) => (
            <tr key={entry.period}>
              <th scope="row" {...stylex.props(s.cell)}>
                {month(entry.period)}
              </th>
              <td {...stylex.props(s.cell)}>{count(entry.groups)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A player's sporting statistics for one filter set. Every figure is an evidence state from the
 * server: insufficient data reads as a localized reason, never as 0, NaN or a blank.
 */
export function PlayerStatistics({
  stats,
  children
}: {
  stats: Statistics;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const f = usePlayerFormat();
  const { matches, sets, games, rating, form, activity } = stats;
  return (
    <main {...stylex.props(s.page)}>
      <header {...stylex.props(s.header)}>
        <h1 {...stylex.props(s.title)}>{t('statistics.player.title')}</h1>
        <p {...stylex.props(s.copy)}>{t('statistics.player.subtitle')}</p>
        <FilterContext filters={stats.filters} />
        {!stats.config.rating_aligned && (
          <output {...stylex.props(s.copy)}>{t('statistics.player.ratingLagging')}</output>
        )}
      </header>

      <Section id="player-stats-matches" title={t('statistics.player.sections.matches')}>
        <dl {...stylex.props(s.stats)}>
          <CountStat label={t('statistics.player.matches.played')} value={matches.played} />
          <CountStat
            label={t('statistics.player.matches.competitive')}
            value={matches.competitive}
          />
          <CountStat label={t('statistics.player.matches.friendly')} value={matches.friendly} />
          <CountStat label={t('statistics.player.matches.wins')} value={matches.wins} />
          <CountStat label={t('statistics.player.matches.losses')} value={matches.losses} />
          <CountStat label={t('statistics.player.matches.draws')} value={matches.draws} />
          <CountStat
            label={t('statistics.player.matches.incomplete')}
            value={matches.incomplete}
            help={t('statistics.player.matches.incompleteHelp')}
          />
          <MetricStat
            label={t('statistics.player.matches.winRate')}
            metric={matches.winRate}
            format={f.ratio}
            unit="matches"
            help={t('statistics.player.matches.winRateHelp')}
          />
          <MetricStat
            label={t('statistics.player.matches.competitiveWinRate')}
            metric={matches.competitiveWinRate}
            format={f.ratio}
            unit="matches"
          />
          <MetricStat
            label={t('statistics.player.matches.friendlyWinRate')}
            metric={matches.friendlyWinRate}
            format={f.ratio}
            unit="matches"
          />
        </dl>
      </Section>

      <Section id="player-stats-scores" title={t('statistics.player.sections.scores')}>
        <dl {...stylex.props(s.stats)}>
          <CountStat label={t('statistics.player.sets.won')} value={sets.won} />
          <CountStat label={t('statistics.player.sets.lost')} value={sets.lost} />
          <CountStat
            label={t('statistics.player.sets.differential')}
            value={f.signed(sets.differential)}
          />
          <MetricStat
            label={t('statistics.player.sets.winRate')}
            metric={sets.winRate}
            format={f.ratio}
            unit="sets"
          />
          <CountStat label={t('statistics.player.games.won')} value={games.won} />
          <CountStat label={t('statistics.player.games.lost')} value={games.lost} />
          <CountStat
            label={t('statistics.player.games.differential')}
            value={f.signed(games.differential)}
          />
          <MetricStat
            label={t('statistics.player.games.winRate')}
            metric={games.winRate}
            format={f.ratio}
            unit="games"
          />
          <MetricStat
            label={t('statistics.player.games.averageWon')}
            metric={games.averageWonPerGroup}
            format={f.count}
            unit="matches"
            help={t('statistics.player.games.averageHelp')}
          />
          <MetricStat
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
            label={t('statistics.player.rating.current')}
            metric={rating.currentLevel}
            format={f.level}
            help={t('statistics.player.rating.currentHelp')}
          />
          <MetricStat
            label={t('statistics.player.rating.reliability')}
            metric={rating.reliability}
            format={f.reliability}
          />
          <MetricStat
            label={t('statistics.player.rating.starting')}
            metric={rating.startingLevel}
            format={f.level}
          />
          <MetricStat
            label={t('statistics.player.rating.highest')}
            metric={rating.highestLevel}
            format={f.level}
          />
          <MetricStat
            label={t('statistics.player.rating.lowestEstablished')}
            metric={rating.lowestEstablishedLevel}
            format={f.level}
            help={t('statistics.player.rating.lowestEstablishedHelp')}
          />
          <MetricStat
            label={t('statistics.player.rating.filteredDelta')}
            metric={rating.filteredDelta}
            format={f.signed}
            unit="rated"
            help={t('statistics.player.rating.filteredDeltaHelp')}
          />
          <RankStat
            label={t('statistics.player.rating.communityRank')}
            metric={rating.communitySkillRank}
          />
          <RankStat
            label={t('statistics.player.rating.leaguePosition')}
            metric={rating.activeLeaguePosition}
          />
          <BestRankStat
            label={t('statistics.player.rating.bestCommunityRank')}
            history={rating.bestCommunitySkillRank}
          />
          <BestRankStat
            label={t('statistics.player.rating.bestLeaguePosition')}
            history={rating.bestLeaguePosition}
          />
        </dl>
      </Section>

      <Section id="player-stats-form" title={t('statistics.player.sections.form')}>
        <dl {...stylex.props(s.stats)}>
          <FormStat label={t('statistics.player.form.last5')} metric={form.last5} />
          <FormStat label={t('statistics.player.form.last10')} metric={form.last10} />
          <CurrentStreak current={form.current} />
          <CountStat
            label={t('statistics.player.form.longestWins')}
            value={form.longestWins}
            help={t('statistics.player.form.streakHelp')}
          />
          <CountStat label={t('statistics.player.form.longestLosses')} value={form.longestLosses} />
        </dl>
      </Section>

      <Section id="player-stats-activity" title={t('statistics.player.sections.activity')}>
        <ActivitySeries months={activity.months} />
      </Section>

      <PlayerStatisticsRecords stats={stats} />
      {children}
    </main>
  );
}
