import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import { RepairIcon } from './RepairIcon';
import { repairDiagnostics as rd } from './repair-diagnostics.styles';
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
    <main data-repair-load-error={denied ? 'denied' : 'unavailable'} {...stylex.props(rd.page)}>
      <h1 {...stylex.props(rd.title)}>{t('matches.corrections.diagnostics.title')}</h1>
      <SurfaceCard>
        <p role="alert" {...stylex.props(rd.error, rd.notice)}>
          <RepairIcon name="warning" size={16} />{' '}
          {t(
            denied
              ? 'matches.corrections.diagnostics.denied'
              : 'matches.corrections.diagnostics.unavailable'
          )}
        </p>
        {!denied && (
          <Button variant="secondary" xstyle={rd.controlCompact} onClick={onRetry}>
            {t('matches.corrections.diagnostics.retry')}
          </Button>
        )}
      </SurfaceCard>
    </main>
  );
}
