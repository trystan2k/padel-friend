import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import { levelReview as lr } from '../level-reviews/level-review.styles';
import { resultCorrectionStyles as c } from '../matches/result-correction.styles';
import type { ResultRepairErrorCode } from './repair-model';

export function ResultRepairLoadError({
  code,
  onRetry
}: {
  code: ResultRepairErrorCode;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const denied = code === 'forbidden' || code === 'unauthenticated' || code === 'not_found';
  return (
    <main {...stylex.props(lr.page)}>
      <h1 {...stylex.props(lr.title)}>{t('matches.corrections.diagnostics.title')}</h1>
      <p role="alert" {...stylex.props(c.error)}>
        {t(
          denied
            ? 'matches.corrections.diagnostics.denied'
            : 'matches.corrections.diagnostics.unavailable'
        )}
      </p>
      {!denied && (
        <div {...stylex.props(c.actions)}>
          <button type="button" {...stylex.props(c.action)} onClick={onRetry}>
            {t('matches.corrections.diagnostics.retry')}
          </button>
        </div>
      )}
    </main>
  );
}
