import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { HeroCard } from '../../components/ui/HeroCard';
import { ProvisionalBadge } from '../../components/ui/ProvisionalBadge';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import {
  formatFraction,
  formatLevel,
  formatPercentPoints,
  formatSignedDelta
} from '../player/rating-format';
import type {
  DetailPlayer,
  DetailTimelineEntry,
  GroupDetail
} from './statistics-history-contracts';
import { historyStyles as s } from './statistics-history.styles';

/**
 * One confirmed Game Group with every PRD §37 fact: when and where it was played, the actual
 * teams, the result, all four rating effects (or an explicit reason there are none), who
 * submitted and approved it, an audit-correction badge only with correction evidence, and a safe
 * timeline that never carries dispute notes or contact data.
 */
export function ConfirmedGroupDetail({ detail }: { detail: GroupDetail }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en-GB' : i18n.language;
  const stamp = (instant: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: detail.timezone
    }).format(new Date(instant));
  const playedDate = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeZone: detail.timezone
  }).format(new Date(detail.played_at));
  const playedTime = new Intl.DateTimeFormat(locale, {
    timeStyle: 'short',
    timeZone: detail.timezone
  }).format(new Date(detail.played_at));
  const { result, confirmation } = detail;
  const incomplete = result.classification === 'incomplete';
  const name = (player: { display_name: string | null }) =>
    player.display_name ?? t('matches.results.unknownPlayer');
  const heroTeam = (side: 'team_a' | 'team_b') => (
    <div {...stylex.props(s.heroTeam)}>
      <span {...stylex.props(s.heroLabel)}>{t(`matches.results.teams.${side}`)}</span>
      <span {...stylex.props(s.heroNames)}>
        {new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(
          detail.teams[side].map((player) => name(player))
        )}
      </span>
    </div>
  );

  return (
    <main {...stylex.props(s.page)}>
      <header {...stylex.props(s.pageHeader)}>
        <Link
          to="/matches/$eventId"
          params={{ eventId: detail.event_id }}
          {...stylex.props(s.link)}
        >
          {t('statistics.detail.back')}
        </Link>
        <h1 {...stylex.props(s.title)}>{t('statistics.detail.title')}</h1>
        <div {...stylex.props(s.badges)}>
          <StatusBadge tone={incomplete ? 'neutral' : 'positive'}>
            {t(`statistics.history.status.${incomplete ? 'incomplete' : 'played'}`)}
          </StatusBadge>
          <StatusBadge tone="neutral">{t(`matches.type.${detail.match_type}`)}</StatusBadge>
          <StatusBadge tone="muted">
            {t('statistics.history.group', { number: detail.group_number })}
          </StatusBadge>
          {detail.correction.corrected && (
            <StatusBadge tone="provisional">{t('statistics.detail.correction.badge')}</StatusBadge>
          )}
        </div>
        {detail.correction.corrected && (
          <p {...stylex.props(s.copy)}>
            {t('statistics.detail.correction.help', { version: detail.correction.version })}
          </p>
        )}
      </header>

      <section aria-labelledby="statistics-detail-result">
        <HeroCard xstyle={s.hero}>
          <h2 id="statistics-detail-result" {...stylex.props(s.heroLabel)}>
            {t('statistics.detail.sections.result')}
          </h2>
          <div {...stylex.props(s.heroGrid)}>
            {heroTeam('team_a')}
            <p {...stylex.props(s.heroScores)}>
              {result.sets.map((set) => (
                <span key={set.position} {...stylex.props(s.heroScore)}>
                  {set.team_a_games}–{set.team_b_games}
                </span>
              ))}
            </p>
            {heroTeam('team_b')}
          </div>
          <div {...stylex.props(s.heroLine)}>
            <span>{t(`statistics.detail.winner.${result.winner ?? 'incomplete'}`)}</span>
            <span>
              {t('statistics.detail.setsTotal', { a: result.sets_a, b: result.sets_b })} ·{' '}
              {t('statistics.detail.gamesTotal', { a: result.games_a, b: result.games_b })}
            </span>
          </div>
        </HeroCard>
      </section>

      <section aria-labelledby="statistics-detail-players">
        <SurfaceCard>
          <h2 id="statistics-detail-players" {...stylex.props(s.subheading)}>
            {t('statistics.detail.sections.teams')}
          </h2>
          <p {...stylex.props(s.copy)}>
            {t(`statistics.detail.rating.state.${detail.rating_state}`)}
          </p>
          {(['team_a', 'team_b'] as const).map((side) => (
            <section key={side} {...stylex.props(s.team)}>
              <h3 {...stylex.props(s.teamLabel)}>
                {t(`matches.results.teams.${side}`)}{' '}
                <span {...stylex.props(s.teamScore)}>
                  {side === 'team_a' ? result.sets_a : result.sets_b}
                </span>
              </h3>
              {detail.teams[side].map((player) => (
                <PlayerRatingCard
                  key={player.user_id}
                  player={player}
                  locale={locale}
                  name={name(player)}
                />
              ))}
            </section>
          ))}
        </SurfaceCard>
      </section>

      <section aria-labelledby="statistics-detail-sets">
        <SurfaceCard>
          <h2 id="statistics-detail-sets" {...stylex.props(s.subheading)}>
            {t('statistics.detail.sections.sets')}
          </h2>
          <ol {...stylex.props(s.list)}>
            {result.sets.map((set) => (
              <li key={set.position} {...stylex.props(s.setRow)}>
                <span {...stylex.props(s.copy)}>
                  {t('matches.results.setNumber', { number: set.position })}
                </span>
                <span {...stylex.props(s.setScore)}>
                  {set.team_a_games}–{set.team_b_games}
                </span>
                <StatusBadge tone={set.completed ? 'positive' : 'muted'}>
                  {t(
                    set.completed
                      ? 'matches.results.setState.complete'
                      : 'matches.results.setState.inProgress'
                  )}
                </StatusBadge>
              </li>
            ))}
          </ol>
          {incomplete && <p {...stylex.props(s.copy)}>{t('statistics.detail.incompleteNote')}</p>}
        </SurfaceCard>
      </section>

      <section aria-labelledby="statistics-detail-matchup">
        <SurfaceCard>
          <h2 id="statistics-detail-matchup" {...stylex.props(s.subheading)}>
            {t('statistics.detail.matchup.title')}
          </h2>
          {detail.matchup.reason === null &&
          detail.matchup.team_a_strength !== null &&
          detail.matchup.team_b_strength !== null &&
          detail.matchup.team_a_expected !== null &&
          detail.matchup.team_b_expected !== null ? (
            <>
              {(['team_a', 'team_b'] as const).map((side) => (
                <div key={side}>
                  <p>
                    {t('statistics.detail.matchup.strength', {
                      team: t(`matches.results.teams.${side}`),
                      value: formatLevel(
                        side === 'team_a'
                          ? detail.matchup.team_a_strength!
                          : detail.matchup.team_b_strength!,
                        locale
                      )
                    })}
                  </p>
                  <p>
                    {t('statistics.detail.matchup.expected', {
                      team: t(`matches.results.teams.${side}`),
                      value: formatPercentPoints(
                        (side === 'team_a'
                          ? detail.matchup.team_a_expected!
                          : detail.matchup.team_b_expected!) * 100,
                        locale
                      )
                    })}
                  </p>
                </div>
              ))}
              {detail.matchup.upset && (
                <output aria-label={t('statistics.detail.matchup.upsetAria')}>
                  <StatusBadge tone="positive">{t('statistics.detail.matchup.upset')}</StatusBadge>
                </output>
              )}
            </>
          ) : (
            <p>
              {t(`statistics.detail.rating.absent.${detail.matchup.reason ?? 'missing_evidence'}`)}
            </p>
          )}
        </SurfaceCard>
      </section>

      <SurfaceCard>
        <dl {...stylex.props(s.facts)}>
          <dt {...stylex.props(s.factLabel)}>{t('statistics.detail.summary.community')}</dt>
          <dd {...stylex.props(s.factValue)}>{detail.community.name}</dd>
          <dt {...stylex.props(s.factLabel)}>{t('statistics.detail.summary.venue')}</dt>
          <dd {...stylex.props(s.factValue)}>
            {detail.venue_name}
            {detail.court_label && (
              <> · {t('statistics.detail.summary.court', { label: detail.court_label })}</>
            )}
          </dd>
          <dt {...stylex.props(s.factLabel)}>{t('statistics.history.title')}</dt>
          <dd {...stylex.props(s.factValue)}>
            <time dateTime={detail.played_at}>
              {t('statistics.detail.summary.played', { date: playedDate, time: playedTime })}
            </time>
          </dd>
          <dt {...stylex.props(s.factLabel)}>{t('statistics.detail.summary.type')}</dt>
          <dd {...stylex.props(s.factValue)}>{t(`matches.type.${detail.match_type}`)}</dd>
          {detail.league && (
            <>
              <dt {...stylex.props(s.factLabel)}>{t('statistics.detail.summary.league')}</dt>
              <dd {...stylex.props(s.factValue)}>
                {detail.league.name} ·{' '}
                {t(
                  detail.league.eligible
                    ? 'statistics.detail.summary.leagueCounts'
                    : 'statistics.detail.summary.leagueNotCounted'
                )}
              </dd>
            </>
          )}
        </dl>
      </SurfaceCard>

      <section aria-labelledby="statistics-detail-confirmation">
        <SurfaceCard>
          <h2 id="statistics-detail-confirmation" {...stylex.props(s.subheading)}>
            {t('statistics.detail.sections.confirmation')}
          </h2>
          <p {...stylex.props(s.strong)}>
            {confirmation.automatic || !confirmation.approver
              ? t('statistics.detail.confirmation.automatic')
              : t('statistics.detail.confirmation.manual', { name: name(confirmation.approver) })}
          </p>
          <p {...stylex.props(s.copy)}>
            {t('statistics.detail.confirmation.confirmedAt', {
              date: stamp(confirmation.confirmed_at)
            })}
          </p>
          <p {...stylex.props(s.copy)}>
            {t('statistics.detail.confirmation.effectiveAt', {
              date: stamp(confirmation.effective_at)
            })}
          </p>
          <p {...stylex.props(s.copy)}>
            {t('statistics.detail.confirmation.submittedBy', {
              name: name(detail.submitter),
              date: stamp(detail.submitter.submitted_at)
            })}
          </p>
        </SurfaceCard>
      </section>

      <section aria-labelledby="statistics-detail-timeline">
        <SurfaceCard>
          <h2 id="statistics-detail-timeline" {...stylex.props(s.subheading)}>
            {t('statistics.detail.sections.timeline')}
          </h2>
          <ol {...stylex.props(s.timeline)}>
            {detail.timeline.map((entry) => (
              <li key={`${entry.kind}-${entry.occurred_at}`}>
                <TimelineText entry={entry} stamp={stamp} />
              </li>
            ))}
          </ol>
        </SurfaceCard>
      </section>
    </main>
  );
}

function TimelineText({
  entry,
  stamp: format
}: {
  entry: DetailTimelineEntry;
  stamp: (instant: string) => string;
}) {
  const { t } = useTranslation();
  const key =
    entry.kind === 'confirmed'
      ? entry.source === 'AUTO_48H'
        ? 'confirmedAuto'
        : 'confirmedManual'
      : entry.kind;
  return (
    <>
      <strong>{t(`statistics.detail.timeline.${key}`, { version: entry.version })}</strong>
      {entry.actor && (
        <>
          {' '}
          {t('statistics.detail.timeline.by', {
            name: entry.actor.display_name ?? t('matches.results.unknownPlayer')
          })}
        </>
      )}
      <br />
      <time dateTime={entry.occurred_at} {...stylex.props(s.copy)}>
        {format(entry.occurred_at)}
      </time>
    </>
  );
}

function PlayerRatingCard({
  player,
  locale,
  name
}: {
  player: DetailPlayer;
  locale: string;
  name: string;
}) {
  const { t } = useTranslation();
  const { rating } = player;
  return (
    <div {...stylex.props(s.player)}>
      <h4 {...stylex.props(s.playerName)}>
        {name}
        {player.is_provisional && <ProvisionalBadge />}
      </h4>
      {rating.state === 'applied' &&
      rating.before_level !== null &&
      rating.after_level !== null &&
      rating.delta !== null &&
      rating.before_reliability !== null &&
      rating.after_reliability !== null &&
      rating.expected_score !== null ? (
        <dl {...stylex.props(s.facts)}>
          <dt {...stylex.props(s.factLabel)}>{t('statistics.detail.rating.before')}</dt>
          <dd {...stylex.props(s.factValue)}>{formatLevel(rating.before_level, locale)}</dd>
          <dt {...stylex.props(s.factLabel)}>{t('statistics.detail.rating.after')}</dt>
          <dd {...stylex.props(s.factValue)}>{formatLevel(rating.after_level, locale)}</dd>
          <dt {...stylex.props(s.factLabel)}>{t('statistics.detail.rating.change')}</dt>
          <dd {...stylex.props(s.factValue)}>{formatSignedDelta(rating.delta, locale)}</dd>
          <dt {...stylex.props(s.factLabel)}>
            {t('statistics.history.ratingChange', { delta: '' }).trim()}
          </dt>
          <dd {...stylex.props(s.factValue)}>
            {t('statistics.detail.rating.reliability', {
              before: formatPercentPoints(rating.before_reliability, locale)
                .replace('%', '')
                .trim(),
              after: formatPercentPoints(rating.after_reliability, locale).replace('%', '').trim()
            })}
          </dd>
          <dt {...stylex.props(s.factLabel)}>{t('statistics.detail.summary.ratingKind')}</dt>
          <dd {...stylex.props(s.factValue)}>
            {t('statistics.detail.rating.expected', {
              value: formatFraction(rating.expected_score, locale)
            })}
          </dd>
        </dl>
      ) : (
        <p {...stylex.props(s.copy)}>
          {t(`statistics.detail.rating.absent.${rating.reason ?? 'missing_evidence'}`)}
        </p>
      )}
    </div>
  );
}
