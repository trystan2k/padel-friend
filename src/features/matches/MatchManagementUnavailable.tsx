import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import type { ManagementErrorCode, MatchEventManagement } from './match-management-model';
import { matchManagementStyles as s } from './match-management.styles';

export function managementUnavailableReason(
  management: MatchEventManagement | null,
  error?: ManagementErrorCode | null
): ManagementErrorCode | null {
  const reasons = [
    error,
    ...Object.values(management?.actions ?? {}).map((action) => action.reason)
  ];
  if (management?.status === 'cancelled' || reasons.includes('cancelled')) return 'cancelled';
  if (management?.results_protected || reasons.includes('result_protected'))
    return 'result_protected';
  if (management?.phase === 'started' || reasons.includes('started')) return 'started';
  if (reasons.includes('closed')) return 'closed';
  if (error) return error;
  return management ? null : 'unavailable';
}

/** Informational only: PAF-7 owns correction; never advertise a dead action. */
export function MatchManagementUnavailable({
  reason,
  onBack,
  focus = false
}: {
  reason: ManagementErrorCode;
  onBack?: () => void;
  focus?: boolean;
}) {
  const { t } = useTranslation();
  const key =
    reason === 'result_protected' ? 'resultProtected' : reason === 'closed' ? 'cutoff' : reason;
  const explanation = ['cancelled', 'started', 'cutoff', 'resultProtected'].includes(key)
    ? `matches.management.unavailable.${key}`
    : reason === 'forbidden'
      ? 'matches.management.errors.forbidden'
      : 'matches.management.errors.unavailable';
  return (
    <section {...stylex.props(s.section)}>
      <output
        {...stylex.props(s.section)}
        aria-live="polite"
        aria-atomic="true"
        tabIndex={-1}
        ref={(node) => {
          if (focus) node?.focus();
        }}
      >
        <span>{t(explanation)}</span>
        {reason === 'result_protected' && (
          <>
            <span>{t('matches.management.unavailable.correctionExplanation')}</span>
            <span>{t('matches.management.unavailable.correctionUnavailable')}</span>
          </>
        )}
      </output>
      {onBack && (
        <button type="button" {...stylex.props(s.button)} onClick={onBack}>
          {t('matches.management.unavailable.backToMatch')}
        </button>
      )}
    </section>
  );
}
