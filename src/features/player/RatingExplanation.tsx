import { Dialog } from '@base-ui/react/dialog';
import * as stylex from '@stylexjs/stylex';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { ProvisionalBadge } from '../../components/ui/ProvisionalBadge';
import { MAX_LEVEL, MIN_LEVEL } from './rating-config';
import type {
  RatingErrorCode,
  RatingExplanationPlayer,
  RatingGroupExplanation,
  RatingTeam
} from './rating-contracts';
import {
  formatAbsoluteDelta,
  formatFraction,
  formatLevel,
  formatPercentPoints,
  formatRatingDate,
  formatSignedDelta,
  formatTeamStrength
} from './rating-format';
import { isReliabilityEstablished, ratingExplanationNote, ratingOutcome } from './rating-model';
import { ratingFailureCode } from './rating-view';
import { RatingError } from './RatingError';
import { getRatingGroupExplanation } from './rating.functions';
import { rating as s } from './rating.styles';

export type ExplanationFocus = { userId?: string; team?: RatingTeam };
export type ExplanationTarget = { groupId: string; revision: number; focus: ExplanationFocus };

type Load =
  | { status: 'loading' }
  | { status: 'ready'; value: RatingGroupExplanation }
  | { status: 'error'; code: RatingErrorCode };

const TEAMS: readonly RatingTeam[] = ['team_a', 'team_b'];

function deltaStyle(delta: number) {
  return delta > 0 ? s.deltaGain : delta < 0 ? s.deltaLoss : undefined;
}

function PlayerExplanation({
  player,
  selected,
  locale
}: {
  player: RatingExplanationPlayer;
  selected: boolean;
  locale: string;
}) {
  const { t } = useTranslation();
  const note = ratingExplanationNote(player);
  const outcome = ratingOutcome(player.outcome_value);
  const rows: [string, string, ReturnType<typeof deltaStyle>?][] = [
    [
      t('rating.explanation.level'),
      t('rating.explanation.transition', {
        before: formatLevel(player.before_display_level, locale),
        after: formatLevel(player.after_display_level, locale)
      })
    ],
    [
      t('rating.explanation.change'),
      formatSignedDelta(player.applied_delta, locale),
      deltaStyle(player.applied_delta)
    ],
    [
      t('rating.explanation.reliability'),
      t('rating.explanation.transition', {
        before: formatPercentPoints(player.before_reliability_percent, locale),
        after: formatPercentPoints(player.after_reliability_percent, locale)
      })
    ],
    [t('rating.explanation.ownStrength'), formatTeamStrength(player.own_team_strength, locale)],
    [
      t('rating.explanation.opponentStrength'),
      formatTeamStrength(player.opponent_team_strength, locale)
    ],
    [t('rating.explanation.expected'), formatFraction(player.expected_score, locale)],
    [t('rating.explanation.result'), t(`rating.outcome.${outcome}`)],
    [
      t('rating.explanation.version'),
      t('rating.explanation.versionValue', {
        engine: player.engine,
        version: player.engine_version,
        config: player.config_version,
        revision: player.calculation_revision
      })
    ]
  ];
  return (
    <li {...stylex.props(s.playerCard, selected && s.playerSelected)}>
      <h4 {...stylex.props(s.playerName)}>
        {player.display_name}
        {player.is_provisional && <ProvisionalBadge />}
      </h4>
      <dl {...stylex.props(s.facts)}>
        {rows.map(([label, value, style]) => (
          <div key={label} {...stylex.props(s.factRow)}>
            <dt {...stylex.props(s.factLabel)}>{label}</dt>
            <dd {...stylex.props(s.factValue, style)}>{value}</dd>
          </div>
        ))}
      </dl>
      <p {...stylex.props(s.note)}>
        {t(`rating.explanation.note.${note}`, {
          delta: formatAbsoluteDelta(player.applied_delta, locale),
          min: formatLevel(MIN_LEVEL, locale),
          max: formatLevel(MAX_LEVEL, locale)
        })}
      </p>
      {isReliabilityEstablished(player.after_reliability_percent) && (
        <p {...stylex.props(s.note)}>{t('rating.explanation.established')}</p>
      )}
      {player.recalculated && (
        <p {...stylex.props(s.recalculated)}>{t('rating.explanation.recalculated')}</p>
      )}
    </li>
  );
}

function ExplanationBody({
  target,
  onStale,
  returnPath
}: {
  target: ExplanationTarget;
  onStale: () => void;
  returnPath?: string;
}) {
  const { t, i18n } = useTranslation();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const latest = useRef(0);
  const locale = i18n.language;

  const run = useCallback(async () => {
    const request = ++latest.current;
    let next: Load;
    try {
      const response = await getRatingGroupExplanation({
        data: { game_group_id: target.groupId, revision: target.revision }
      });
      next =
        response.status === 'ok'
          ? { status: 'ready', value: response.value }
          : { status: 'error', code: response.code };
    } catch (cause) {
      next = { status: 'error', code: ratingFailureCode(cause) };
    }
    if (request === latest.current) setLoad(next);
  }, [target.groupId, target.revision]);

  useEffect(() => {
    void run();
  }, [run]);

  if (load.status === 'loading')
    return (
      <output {...stylex.props(s.copy)} aria-busy="true">
        {t('rating.explanation.loading')}
      </output>
    );
  if (load.status === 'error')
    return (
      <RatingError
        code={load.code}
        returnPath={returnPath}
        onRetry={
          load.code === 'stale_revision'
            ? onStale
            : () => {
                setLoad({ status: 'loading' });
                void run();
              }
        }
      />
    );

  const { value } = load;
  return (
    <>
      <p {...stylex.props(s.copy)}>
        {t('rating.explanation.playedOn', {
          number: value.game_group_number,
          date: formatRatingDate(value.played_at, locale)
        })}
      </p>
      {TEAMS.map((team) => {
        const label = t(`matches.results.teams.${team}`);
        return (
          <section key={team} {...stylex.props(s.teamSection)}>
            <h3
              {...stylex.props(
                s.teamLabel,
                target.focus.team !== undefined && target.focus.team !== team && s.teamLabelOpponent
              )}
            >
              {target.focus.team === team
                ? t('rating.explanation.yourTeam', { team: label })
                : label}
            </h3>
            <ul {...stylex.props(s.list)}>
              {value.players
                .filter((player) => player.team === team)
                .map((player) => (
                  <PlayerExplanation
                    key={player.user_id}
                    player={player}
                    selected={player.user_id === target.focus.userId}
                    locale={locale}
                  />
                ))}
            </ul>
          </section>
        );
      })}
      <p {...stylex.props(s.copy)}>{t('rating.explanation.expectedHint')}</p>
    </>
  );
}

/**
 * Accessible modal over the stored calculation of one game group. Focus returns to the
 * control that opened it; every number comes from the stored payload, never from today's
 * ratings.
 */
export function RatingExplanation({
  target,
  returnFocus,
  onClose,
  onStale,
  returnPath
}: {
  target: ExplanationTarget | null;
  returnFocus: RefObject<HTMLElement | null>;
  onClose: () => void;
  onStale: () => void;
  /** Sign-in return destination for an expired session; defaults to the dashboard. */
  returnPath?: string;
}) {
  const { t } = useTranslation();
  return (
    <Dialog.Root open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop {...stylex.props(s.backdrop)} />
        <Dialog.Viewport {...stylex.props(s.viewport)}>
          <Dialog.Popup
            finalFocus={() => (returnFocus.current?.isConnected ? returnFocus.current : true)}
            {...stylex.props(s.popup)}
          >
            <Dialog.Title {...stylex.props(s.dialogTitle)}>
              {t('rating.explanation.title')}
            </Dialog.Title>
            <Dialog.Description {...stylex.props(s.copy)}>
              {t('rating.explanation.description')}
            </Dialog.Description>
            {target && (
              <ExplanationBody
                key={`${target.groupId}:${target.revision}`}
                target={target}
                onStale={onStale}
                returnPath={returnPath}
              />
            )}
            <Dialog.Close {...stylex.props(s.textButton)}>
              {t('rating.explanation.close')}
            </Dialog.Close>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
