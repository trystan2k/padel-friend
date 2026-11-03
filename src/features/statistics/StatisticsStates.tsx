import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import type { MetricState } from './statistics-contracts';
import type { StatisticsErrorCode } from './statistics-history-contracts';
import { playerStyles as s } from './statistics-player.styles';
import { statisticsStyles as c } from './statistics.styles';

const RETRYABLE: readonly StatisticsErrorCode[] = [
  'STATISTICS_UNAVAILABLE',
  'INVALID_STATISTICS_RESPONSE',
  'STATISTICS_STALE_REVISION'
];

/** The locale used for every statistics number and date; English reads day-first. */
export function statisticsLocale(language: string): string {
  return language === 'en' ? 'en-GB' : language;
}

/**
 * Localized explanation of an insufficient or unavailable metric. The server only sends a reason
 * token (and thresholds); the copy is resolved here, so a metric never shows 0, NaN or a blank.
 */
export function ReasonText({
  metric
}: {
  metric: Exclude<MetricState<unknown>, { state: 'ready' }>;
}) {
  const { t, i18n } = useTranslation();
  const format = new Intl.NumberFormat(statisticsLocale(i18n.language), {
    maximumFractionDigits: 2
  });
  const observed = metric.state === 'insufficient' ? (metric.observed ?? 0) : 0;
  const required = metric.state === 'insufficient' ? (metric.required ?? 0) : 0;
  return (
    <span {...stylex.props(s.detail)}>
      {t(`statistics.player.reasons.${metric.reason}`, {
        observed: format.format(observed),
        required: format.format(required)
      })}
    </span>
  );
}

/** Polite status while a statistics view loads; announced once, never as an alert. */
export function StatisticsLoading() {
  const { t } = useTranslation();
  return (
    <output aria-live="polite" aria-busy="true" {...stylex.props(c.state)}>
      {t('statistics.states.loading')}
    </output>
  );
}

/** A section with nothing to show for the current selection. */
export function StatisticsEmpty({ children }: { children?: React.ReactNode }) {
  const { t } = useTranslation();
  return <p {...stylex.props(c.state)}>{children ?? t('statistics.states.empty')}</p>;
}

/** A failed statistics read: localized message, plus Retry only for transient failures. */
export function StatisticsError({
  code,
  onRetry
}: {
  code: StatisticsErrorCode;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div role="alert" {...stylex.props(c.errorState)}>
      <p {...stylex.props(s.error)}>{t(`statistics.errors.${code}`)}</p>
      {onRetry && RETRYABLE.includes(code) && (
        <button type="button" onClick={onRetry} {...stylex.props(c.retry)}>
          {t('statistics.states.retry')}
        </button>
      )}
    </div>
  );
}
