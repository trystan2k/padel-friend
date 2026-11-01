import * as stylex from '@stylexjs/stylex';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProvisionalBadge } from '../../components/ui/ProvisionalBadge';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import type { MatchEventRatingChanges, RatingErrorCode } from '../player/rating-contracts';
import {
  formatLevel,
  formatPercentPoints,
  formatRatingDate,
  formatSignedDelta
} from '../player/rating-format';
import { ratingFailureCode } from '../player/rating-view';
import { RatingError } from '../player/RatingError';
import { RatingExplanation, type ExplanationTarget } from '../player/RatingExplanation';
import { getMatchEventRatingChanges } from '../player/rating.functions';
import { rating as s } from '../player/rating.styles';

type Load =
  | { status: 'loading' }
  | { status: 'ready'; value: MatchEventRatingChanges }
  | { status: 'error'; code: RatingErrorCode };

/**
 * Per-player rating changes for the confirmed groups of a competitive event. Only played
 * participants have stored changes, so reserves and non-ratable results simply produce no
 * groups and nothing is rendered for them. The accessible explanation action opens the
 * stored calculation; nothing here recomputes a rating. The caller keys it by the confirmed
 * group count so a newly confirmed group re-reads the changes.
 */
export function MatchResultRatingChanges({ eventId }: { eventId: string }) {
  const returnPath = `/matches/${encodeURIComponent(eventId)}`;
  const { t, i18n } = useTranslation();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const latest = useRef(0);
  const [target, setTarget] = useState<ExplanationTarget | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const locale = i18n.language;

  const run = useCallback(async () => {
    const request = ++latest.current;
    let next: Load;
    try {
      const response = await getMatchEventRatingChanges({ data: { event_id: eventId } });
      next =
        response.status === 'ok'
          ? { status: 'ready', value: response.value }
          : { status: 'error', code: response.code };
    } catch (cause) {
      next = { status: 'error', code: ratingFailureCode(cause) };
    }
    if (request === latest.current) setLoad(next);
  }, [eventId]);

  useEffect(() => {
    void run();
  }, [run]);

  const changes = load.status === 'ready' ? load.value : null;
  if (changes?.groups.length === 0) return null;

  const retry = () => {
    setTarget(null);
    setLoad({ status: 'loading' });
    void run();
  };

  return (
    <SurfaceCard xstyle={s.card}>
      <h2 {...stylex.props(s.subheading)}>{t('rating.changes.title')}</h2>
      {load.status === 'loading' && (
        <output aria-busy="true" {...stylex.props(s.copy)}>
          {t('rating.changes.loading')}
        </output>
      )}
      {load.status === 'error' && (
        <RatingError code={load.code} onRetry={retry} returnPath={returnPath} />
      )}
      {changes && (
        <>
          <p {...stylex.props(s.copy)}>{t('rating.changes.description')}</p>
          {changes.groups.map((group) => (
            <section key={group.game_group_id} {...stylex.props(s.teamSection)}>
              <h3 {...stylex.props(s.teamLabel)}>
                {t('rating.changes.groupTitle', { number: group.game_group_number })}
              </h3>
              <ul {...stylex.props(s.list)}>
                {group.players.map((player) => (
                  <li key={player.user_id} {...stylex.props(s.row)}>
                    <div {...stylex.props(s.rowTop)}>
                      <div {...stylex.props(s.rowMain)}>
                        <p {...stylex.props(s.rowTitle)}>
                          {player.display_name}
                          {player.is_provisional && <ProvisionalBadge />}
                        </p>
                        <p {...stylex.props(s.copy)}>
                          {t('rating.history.levelChange', {
                            before: formatLevel(player.before_display_level, locale),
                            after: formatLevel(player.after_display_level, locale)
                          })}
                        </p>
                        <p {...stylex.props(s.copy)}>
                          {t('rating.history.reliabilityChange', {
                            before: formatPercentPoints(player.before_reliability_percent, locale),
                            after: formatPercentPoints(player.after_reliability_percent, locale)
                          })}
                        </p>
                      </div>
                      <strong
                        {...stylex.props(
                          s.delta,
                          player.applied_delta > 0 && s.deltaGain,
                          player.applied_delta < 0 && s.deltaLoss
                        )}
                      >
                        {formatSignedDelta(player.applied_delta, locale)}
                      </strong>
                    </div>
                    <button
                      type="button"
                      aria-label={t('rating.changes.explainLabel', {
                        name: player.display_name,
                        number: group.game_group_number
                      })}
                      onClick={(event) => {
                        trigger.current = event.currentTarget;
                        setTarget({
                          groupId: group.game_group_id,
                          revision: changes.revision,
                          focus: { userId: player.user_id }
                        });
                      }}
                      {...stylex.props(s.textButton)}
                    >
                      {t('rating.history.explain')}
                    </button>
                  </li>
                ))}
              </ul>
              <p {...stylex.props(s.copy)}>
                <time dateTime={group.played_at}>{formatRatingDate(group.played_at, locale)}</time>
              </p>
            </section>
          ))}
          <RatingExplanation
            target={target}
            returnFocus={trigger}
            onClose={() => setTarget(null)}
            onStale={retry}
            returnPath={returnPath}
          />
        </>
      )}
    </SurfaceCard>
  );
}
