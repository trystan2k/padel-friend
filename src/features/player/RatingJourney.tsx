import * as stylex from '@stylexjs/stylex';
import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import { RatingError, isRetryableRatingError } from './RatingError';
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
 * history are always re-read together; mixed revisions never render. The content is keyed by
 * revision so a new projection gets fresh pages, while the section and its heading stay
 * mounted: after a stale/retry reload focus moves to the heading (the dialog or load-more
 * control that held it is gone) and a live status announces the refreshed content.
 */
export function RatingJourney({ load, onReload }: { load: RatingLoad; onReload: () => void }) {
  const { t } = useTranslation();
  const headingId = useId();
  const [target, setTarget] = useState<ExplanationTarget | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const [reloadedFrom, setReloadedFrom] = useState<RatingLoad | null>(null);
  const reloaded = reloadedFrom !== null && reloadedFrom !== load;
  const completedReload = reloaded ? load : null;
  const refreshed = reloaded && load.status === 'ok';
  const refreshFailed = reloaded && load.status === 'error';
  const revision = load.status === 'ok' ? load.revision : 'error';
  // A target from an older revision is dropped with its keyed content, never re-opened.
  const activeTarget = load.status === 'ok' && target?.revision === load.revision ? target : null;

  useEffect(() => {
    // Each completed reload (ok or error) is a new load object, so repeated failures refocus.
    if (completedReload) heading.current?.focus();
  }, [completedReload]);

  function reload() {
    setReloadedFrom(load);
    onReload();
  }

  function explain(groupId: string, focus: ExplanationFocus, opener: HTMLButtonElement) {
    if (load.status !== 'ok') return;
    trigger.current = opener;
    setTarget({ groupId, revision: load.revision, focus });
  }

  return (
    <section aria-labelledby={headingId} {...stylex.props(s.journey)}>
      <div {...stylex.props(s.journeyHeader)}>
        <h2 id={headingId} ref={heading} tabIndex={-1} {...stylex.props(s.heading)}>
          {t('rating.journey.title')}
        </h2>
        <span {...stylex.props(s.scope)}>{t('rating.journey.scope')}</span>
      </div>
      <output {...stylex.props(s.srOnly)}>
        {refreshed
          ? t('rating.journey.refreshed')
          : refreshFailed && load.status === 'error'
            ? t(
                isRetryableRatingError(load.code)
                  ? 'rating.journey.refreshFailed'
                  : `rating.errors.${load.code}`
              )
            : ''}
      </output>
      {load.status === 'error' ? (
        <SurfaceCard xstyle={s.card}>
          {/* A failed reload is announced by the status above; first-load keeps the alert. */}
          <RatingError code={load.code} onRetry={reload} announce={!refreshFailed} />
        </SurfaceCard>
      ) : (
        <Fragment key={revision}>
          <RatingProgressChart progress={load.progress} />
          <RatingHistory initial={load.history} onExplain={explain} onStale={reload} />
          <RatingExplanation
            target={activeTarget}
            returnFocus={trigger}
            onClose={() => setTarget(null)}
            onStale={reload}
          />
        </Fragment>
      )}
    </section>
  );
}
