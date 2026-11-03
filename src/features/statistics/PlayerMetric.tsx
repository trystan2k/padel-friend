import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import { formatLevel, formatPercentPoints, formatRatingDate } from '../player/rating-format';
import { ReasonText, statisticsLocale } from './StatisticsStates';
import type { MetricState } from './statistics-contracts';
import type { PlayerRank, PlayerRankHistory } from './statistics-player-contracts';
import { playerStyles as s } from './statistics-player.styles';

/** Locale-aware number formatting shared by every player statistics surface. */
export function usePlayerFormat() {
  const { i18n } = useTranslation();
  const locale = statisticsLocale(i18n.language);
  return {
    locale,
    count: (value: number) =>
      new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value),
    signed: (value: number) =>
      new Intl.NumberFormat(locale, { signDisplay: 'exceptZero', maximumFractionDigits: 2 }).format(
        value
      ),
    ratio: (value: number) =>
      new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(value),
    level: (value: number) => formatLevel(value, locale),
    reliability: (value: number) => formatPercentPoints(value, locale),
    date: (instant: string) => formatRatingDate(instant, locale),
    month: (period: string) =>
      new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
        new Date(`${period}-01T00:00:00Z`)
      )
  };
}

export function Section({
  id,
  title,
  children
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} {...stylex.props(s.section)}>
      <h2 id={id} {...stylex.props(s.heading)}>
        {title}
      </h2>
      <SurfaceCard>{children}</SurfaceCard>
    </section>
  );
}

/** `id` is the metric id: its help text is `statistics.metrics.<id>.help` for every metric. */
type StatProps = {
  id: string;
  label: string;
  helpValues?: Record<string, string>;
  children: React.ReactNode;
};

/** One labelled figure; the label is the term and the value block its description. */
export function Stat({ id, label, helpValues, children }: StatProps) {
  const { t } = useTranslation();
  return (
    <div {...stylex.props(s.stat)}>
      <dt {...stylex.props(s.statLabel)}>{label}</dt>
      <dd {...stylex.props(s.statValue)}>
        {children}
        <span {...stylex.props(s.detail)}>{t(`statistics.metrics.${id}.help`, helpValues)}</span>
      </dd>
    </div>
  );
}

export function CountStat({
  id,
  label,
  value,
  helpValues
}: {
  id: string;
  label: string;
  value: string | number;
  helpValues?: Record<string, string>;
}) {
  const { count } = usePlayerFormat();
  return (
    <Stat id={id} label={label} {...(helpValues ? { helpValues } : {})}>
      <strong {...stylex.props(s.value)}>{typeof value === 'number' ? count(value) : value}</strong>
    </Stat>
  );
}

/**
 * A metric in its evidence state. Ready values show the figure with its labelled denominator;
 * insufficient and unavailable states show a typed explanation instead of 0, NaN or a blank.
 */
export function MetricStat<T = number>({
  id,
  label,
  metric,
  format,
  unit,
  helpValues
}: {
  id: string;
  label: string;
  metric: MetricState<T>;
  format: (value: T) => string;
  /** Denominator noun key under statistics.player.units, shown as "n of d <unit>". */
  unit?: 'matches' | 'sets' | 'games' | 'opportunities' | 'rated';
  helpValues?: Record<string, string>;
}) {
  const { t } = useTranslation();
  const { count } = usePlayerFormat();
  const extra = { id, label, ...(helpValues ? { helpValues } : {}) };
  if (metric.state !== 'ready') {
    return (
      <Stat {...extra}>
        <strong {...stylex.props(s.value, s.valueMuted)}>{t('statistics.player.noValue')}</strong>
        <ReasonText metric={metric} />
      </Stat>
    );
  }
  return (
    <Stat {...extra}>
      <strong {...stylex.props(s.value)}>{format(metric.value)}</strong>
      {unit && metric.denominator !== null && (
        <span {...stylex.props(s.detail)}>
          {metric.numerator === null
            ? t('statistics.player.basedOn', {
                denominator: count(metric.denominator),
                unit: t(`statistics.player.units.${unit}`)
              })
            : t('statistics.player.ratioOf', {
                numerator: count(metric.numerator),
                denominator: count(metric.denominator),
                unit: t(`statistics.player.units.${unit}`)
              })}
        </span>
      )}
    </Stat>
  );
}

function RankDetail({ rank }: { rank: PlayerRank }) {
  const { t } = useTranslation();
  const { date } = usePlayerFormat();
  return (
    <span {...stylex.props(s.detail)}>
      {t(`statistics.player.rank.provenance.${rank.provenance}`, { date: date(rank.at) })}
    </span>
  );
}

/** Current rank metrics: the position plus whether it was published or reconstructed. */
export function RankStat({
  id,
  label,
  metric
}: {
  id: string;
  label: string;
  metric: MetricState<PlayerRank>;
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
  return (
    <Stat id={id} label={label}>
      <strong {...stylex.props(s.value)}>
        {t('statistics.player.rank.position', { position: count(metric.value.position) })}
      </strong>
      <RankDetail rank={metric.value} />
    </Stat>
  );
}

/**
 * Best-ever rank. When the stored evidence does not cover the whole selected period the boundary
 * is shown, so a partial history is never read as the all-time best.
 */
export function BestRankStat({
  id,
  label,
  history
}: {
  id: string;
  label: string;
  history: PlayerRankHistory;
}) {
  const { t } = useTranslation();
  const { count, date } = usePlayerFormat();
  const best = history.best;
  return (
    <Stat id={id} label={label}>
      {best.state === 'ready' ? (
        <>
          <strong {...stylex.props(s.value)}>
            {t('statistics.player.rank.position', { position: count(best.value.position) })}
          </strong>
          <RankDetail rank={best.value} />
        </>
      ) : (
        <>
          <strong {...stylex.props(s.value, s.valueMuted)}>{t('statistics.player.noValue')}</strong>
          <ReasonText metric={best} />
        </>
      )}
      {!history.coverageComplete && (
        <span {...stylex.props(s.detail)}>
          {history.coverageFrom
            ? t('statistics.player.rank.coverageFrom', { date: date(history.coverageFrom) })
            : t('statistics.player.rank.coverageUnknown')}
          {history.coverageReason &&
            ` ${t(`statistics.player.rank.coverageReason.${history.coverageReason}`)}`}
        </span>
      )}
    </Stat>
  );
}
