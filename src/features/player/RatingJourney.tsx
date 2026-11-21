import * as stylex from '@stylexjs/stylex';
import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { normalizeReturnPath } from '../auth/return-path';
import { isRetryableRatingError } from './RatingError';
import {
  RatingExplanation,
  type ExplanationFocus,
  type ExplanationTarget
} from './RatingExplanation';
import { RatingHistory } from './RatingHistory';
import { RatingProgressChart } from './RatingProgressChart';
import type { RatingLoad } from './rating-view';
import { journey as j } from './rating-journey.styles';
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

  // A brand-new player (no confirmed game yet) gets the single empty card of the frames.
  const empty =
    load.status === 'ok' && load.progress.state === 'empty' && load.history.items.length === 0;
  return (
    <section aria-labelledby={headingId} {...stylex.props(j.section)}>
      <h2 id={headingId} ref={heading} tabIndex={-1} {...stylex.props(j.title)}>
        {t('rating.journey.title')}
      </h2>
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
        <>
          {/* A failed reload is announced by the status above; first-load keeps the alert. */}
          <div role={refreshFailed ? undefined : 'alert'} {...stylex.props(j.banner)}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              {...stylex.props(j.bannerIcon)}
            >
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4M12 17h.01" />
            </svg>
            <p {...stylex.props(j.bannerText)}>{t(`rating.errors.${load.code}`)}</p>
          </div>
          {isRetryableRatingError(load.code) && (
            <Button variant="secondary" onClick={reload}>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                {...stylex.props(j.actionIcon)}
              >
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M3 21v-5h5" />
              </svg>
              {t('rating.errors.reload')}
            </Button>
          )}
          {load.code === 'unauthenticated' && (
            <Button
              variant="secondary"
              onClick={() =>
                window.location.assign(
                  `/login?next=${encodeURIComponent(normalizeReturnPath('/dashboard'))}`
                )
              }
            >
              {t('signIn')}
            </Button>
          )}
        </>
      ) : (
        <Fragment key={revision}>
          <RatingProgressChart progress={load.progress} />
          {!empty && <RatingHistory initial={load.history} onExplain={explain} onStale={reload} />}
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
