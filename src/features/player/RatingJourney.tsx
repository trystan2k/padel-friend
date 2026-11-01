import * as stylex from '@stylexjs/stylex';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import { RatingError } from './RatingError';
import {
  RatingExplanation,
  type ExplanationFocus,
  type ExplanationTarget
} from './RatingExplanation';
import { RatingHistory } from './RatingHistory';
import { RatingProgressChart } from './RatingProgressChart';
import type { RatingLoad } from './rating-view';
import { rating as s } from './rating.styles';

/**
 * Profile "Rating journey": lifetime chart, recent games and the explanation dialog, all
 * from one committed projection revision. When that revision moves (stale page, stale
 * explanation, retry) the caller re-runs the dashboard loader, so summary, chart and
 * history are always re-read together; mixed revisions never render. The caller keys this
 * component by revision so a new projection remounts it with fresh pages.
 */
export function RatingJourney({ load, onReload }: { load: RatingLoad; onReload: () => void }) {
  const { t } = useTranslation();
  const headingId = useId();
  const [target, setTarget] = useState<ExplanationTarget | null>(null);
  const trigger = useRef<HTMLElement | null>(null);

  function explain(groupId: string, focus: ExplanationFocus, opener: HTMLButtonElement) {
    if (load.status !== 'ok') return;
    trigger.current = opener;
    setTarget({ groupId, revision: load.revision, focus });
  }

  return (
    <section aria-labelledby={headingId} {...stylex.props(s.journey)}>
      <div {...stylex.props(s.journeyHeader)}>
        <h2 id={headingId} {...stylex.props(s.heading)}>
          {t('rating.journey.title')}
        </h2>
        <span {...stylex.props(s.scope)}>{t('rating.journey.scope')}</span>
      </div>
      {load.status === 'error' ? (
        <SurfaceCard xstyle={s.card}>
          <RatingError code={load.code} onRetry={onReload} />
        </SurfaceCard>
      ) : (
        <>
          <RatingProgressChart progress={load.progress} />
          <RatingHistory initial={load.history} onExplain={explain} onStale={onReload} />
          <RatingExplanation
            target={target}
            returnFocus={trigger}
            onClose={() => setTarget(null)}
            onStale={onReload}
          />
        </>
      )}
    </section>
  );
}
