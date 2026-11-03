import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { CountStat, MetricStat, Section, Stat, usePlayerFormat } from './PlayerMetric';
import { ReasonText, StatisticsEmpty } from './StatisticsStates';
import type { MetricState } from './statistics-contracts';
import type {
  RelationshipExtremum,
  RelationshipMatch,
  RelationshipRecord
} from './statistics-relationship-contracts';
import { playerStyles as s } from './statistics-player.styles';

const OUTCOME_TONE = { W: 'positive', L: 'danger', D: 'neutral', I: 'muted' } as const;

/** Player formatting plus the shared fallback for a player without a display name. */
export function useRelationshipFormat() {
  const { t } = useTranslation();
  const f = usePlayerFormat();
  return {
    ...f,
    name: (displayName: string | null) =>
      displayName ?? t('statistics.relationships.unknownPlayer'),
    list: (names: string[]) =>
      new Intl.ListFormat(f.locale, { style: 'long', type: 'conjunction' }).format(names)
  };
}

function MatchLink({ evidence }: { evidence: RelationshipExtremum }) {
  const { t } = useTranslation();
  if (evidence.eventId === null) return null;
  return (
    <Link
      to="/matches/$eventId/groups/$groupId"
      params={{ eventId: evidence.eventId, groupId: evidence.g }}
      {...stylex.props(s.link)}
    >
      {t('statistics.relationships.viewMatch')}
    </Link>
  );
}

/** An extremum with its visible evidence (value, date) and a link to the confirmed match. */
function ExtremumStat({
  id,
  label,
  metric,
  value
}: {
  id: string;
  label: string;
  metric: MetricState<RelationshipExtremum>;
  value: (evidence: RelationshipExtremum) => string;
}) {
  const { t } = useTranslation();
  if (metric.state !== 'ready') {
    return (
      <Stat id={id} label={label}>
        <strong {...stylex.props(s.value, s.valueMuted)}>{t('statistics.player.noValue')}</strong>
        <ReasonText metric={metric} />
      </Stat>
    );
  }
  return (
    <Stat id={id} label={label}>
      <strong {...stylex.props(s.value)}>{value(metric.value)}</strong>
      <MatchLink evidence={metric.value} />
    </Stat>
  );
}

function Eligibility({ metric, kind }: { metric: MetricState; kind: 'pair' | 'opponent' }) {
  const { t } = useTranslation();
  const { count } = usePlayerFormat();
  return (
    <p {...stylex.props(s.copy)}>
      {metric.state === 'ready'
        ? t(`statistics.relationships.eligibility.${kind}.ready`, { matches: count(metric.value) })
        : metric.state === 'insufficient'
          ? t(`statistics.relationships.eligibility.${kind}.notYet`, {
              observed: count(metric.observed ?? 0),
              required: count(metric.required ?? 0)
            })
          : t('statistics.player.reasons.unavailable')}
    </p>
  );
}

/** Count, scores, streaks and rating evidence of one pair or head-to-head record. */
export function RelationshipSections({
  record,
  kind,
  upsetThreshold
}: {
  record: RelationshipRecord;
  kind: 'pair' | 'opponent';
  upsetThreshold: number;
}) {
  const { t } = useTranslation();
  const f = useRelationshipFormat();
  const { matches, sets, games, streaks } = record;
  const upset = (e: RelationshipExtremum) =>
    t('statistics.player.records.expectedOn', { chance: f.ratio(e.v), date: f.date(e.at) });
  const delta = (e: RelationshipExtremum) =>
    t('statistics.player.records.ratingOn', { delta: f.signed(e.v), date: f.date(e.at) });
  return (
    <>
      <Section id={`${kind}-stats-record`} title={t('statistics.relationships.sections.record')}>
        <dl {...stylex.props(s.stats)}>
          <CountStat
            id={`relationships.${kind}.played`}
            label={t(`statistics.relationships.${kind}.played`)}
            value={matches.played}
          />
          <CountStat
            id="player.matches.wins"
            label={t('statistics.player.matches.wins')}
            value={matches.wins}
          />
          <CountStat
            id="player.matches.losses"
            label={t('statistics.player.matches.losses')}
            value={matches.losses}
          />
          <CountStat
            id="player.matches.draws"
            label={t('statistics.player.matches.draws')}
            value={matches.draws}
          />
          <CountStat
            id="player.matches.incomplete"
            label={t('statistics.player.matches.incomplete')}
            value={matches.incomplete}
          />
          <MetricStat
            id="player.matches.winRate"
            label={t('statistics.player.matches.winRate')}
            metric={matches.winRate}
            format={f.ratio}
            unit="matches"
          />
          <CountStat
            id="player.matches.competitive"
            label={t('statistics.player.matches.competitive')}
            value={matches.competitive}
          />
          <CountStat
            id="player.matches.friendly"
            label={t('statistics.player.matches.friendly')}
            value={matches.friendly}
          />
        </dl>
        <Eligibility metric={record.leaderEligibility} kind={kind} />
      </Section>

      <Section id={`${kind}-stats-scores`} title={t('statistics.player.sections.scores')}>
        <dl {...stylex.props(s.stats)}>
          <CountStat
            id="player.sets.won"
            label={t('statistics.player.sets.won')}
            value={sets.won}
          />
          <CountStat
            id="player.sets.lost"
            label={t('statistics.player.sets.lost')}
            value={sets.lost}
          />
          <CountStat
            id="player.sets.differential"
            label={t('statistics.player.sets.differential')}
            value={f.signed(sets.differential)}
          />
          <CountStat
            id="player.games.won"
            label={t('statistics.player.games.won')}
            value={games.won}
          />
          <CountStat
            id="player.games.lost"
            label={t('statistics.player.games.lost')}
            value={games.lost}
          />
          <CountStat
            id="player.games.differential"
            label={t('statistics.player.games.differential')}
            value={f.signed(games.differential)}
          />
        </dl>
      </Section>

      <Section id={`${kind}-stats-streaks`} title={t('statistics.relationships.sections.streaks')}>
        <dl {...stylex.props(s.stats)}>
          <Stat id="player.form.current" label={t('statistics.player.form.current')}>
            <strong {...stylex.props(s.value, streaks.current.kind === null && s.valueMuted)}>
              {streaks.current.kind === null
                ? t('statistics.player.form.noStreak')
                : f.count(streaks.current.length)}
            </strong>
            {streaks.current.kind !== null && (
              <span {...stylex.props(s.detail)}>
                {t(`statistics.player.form.streak.${streaks.current.kind}`)}
              </span>
            )}
          </Stat>
          <CountStat
            id="player.form.longestWins"
            label={t('statistics.player.form.longestWins')}
            value={streaks.longestWins}
          />
          <CountStat
            id="player.form.longestLosses"
            label={t('statistics.player.form.longestLosses')}
            value={streaks.longestLosses}
          />
        </dl>
      </Section>

      <Section id={`${kind}-stats-rating`} title={t('statistics.relationships.sections.rating')}>
        <dl {...stylex.props(s.stats)}>
          {kind === 'pair' && (
            <MetricStat
              id="relationships.averageOpponentLevel"
              label={t('statistics.relationships.averageOpponentLevel')}
              metric={record.averageOpponentLevel}
              format={f.level}
              unit="rated"
            />
          )}
          <CountStat
            id="relationships.upsetWins"
            label={t('statistics.relationships.upsetWins')}
            value={record.upsetWins}
            helpValues={{ chance: f.ratio(upsetThreshold) }}
          />
          <ExtremumStat
            id="player.records.strongestUpset"
            label={t('statistics.player.records.strongestUpset')}
            metric={record.biggestUpset}
            value={upset}
          />
          {kind === 'opponent' && (
            <>
              <ExtremumStat
                id="player.records.toughestLoss"
                label={t('statistics.player.records.toughestLoss')}
                metric={record.toughestLoss}
                value={upset}
              />
              <ExtremumStat
                id="player.records.biggestGain"
                label={t('statistics.player.records.biggestGain')}
                metric={record.biggestGain}
                value={delta}
              />
              <ExtremumStat
                id="player.records.biggestLoss"
                label={t('statistics.player.records.biggestLoss')}
                metric={record.biggestLoss}
                value={delta}
              />
            </>
          )}
        </dl>
      </Section>

      {kind === 'pair' && (
        <Section id="pair-stats-leagues" title={t('statistics.relationships.sections.leagues')}>
          {record.leagues.length === 0 ? (
            <StatisticsEmpty>{t('statistics.relationships.noLeagues')}</StatisticsEmpty>
          ) : (
            <ul {...stylex.props(s.filters)}>
              {record.leagues.map((league) => (
                <li key={league.leagueId}>
                  <StatusBadge tone="muted">
                    {t('statistics.relationships.leagueMatches', {
                      name: league.name ?? t('statistics.relationships.unknownLeague'),
                      matches: f.count(league.groups)
                    })}
                  </StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
    </>
  );
}

/** Newest matches of the relationship with their result, score and (head-to-head) rating effect. */
export function RecentMatches({
  matches,
  showRating
}: {
  matches: RelationshipMatch[];
  showRating: boolean;
}) {
  const { t } = useTranslation();
  const f = useRelationshipFormat();
  return (
    <Section id="relationship-recent" title={t('statistics.relationships.sections.recent')}>
      {matches.length === 0 ? (
        <StatisticsEmpty>{t('statistics.relationships.noRecent')}</StatisticsEmpty>
      ) : (
        <div {...stylex.props(s.tableScroll)}>
          <table {...stylex.props(s.table)}>
            <caption {...stylex.props(s.caption)}>
              {t('statistics.relationships.recentCaption')}
            </caption>
            <thead>
              <tr>
                <th scope="col" {...stylex.props(s.cell)}>
                  {t('statistics.relationships.columns.date')}
                </th>
                <th scope="col" {...stylex.props(s.cell)}>
                  {t('statistics.relationships.columns.result')}
                </th>
                <th scope="col" {...stylex.props(s.cell)}>
                  {t('statistics.relationships.columns.sets')}
                </th>
                <th scope="col" {...stylex.props(s.cell)}>
                  {t('statistics.relationships.columns.games')}
                </th>
                {showRating && (
                  <th scope="col" {...stylex.props(s.cell)}>
                    {t('statistics.relationships.columns.rating')}
                  </th>
                )}
                <th scope="col" {...stylex.props(s.cell)}>
                  {t('statistics.relationships.columns.match')}
                </th>
              </tr>
            </thead>
            <tbody>
              {matches.map((match) => (
                <tr key={match.groupId}>
                  <th scope="row" {...stylex.props(s.cell)}>
                    {f.date(match.playedAt)}
                  </th>
                  <td {...stylex.props(s.cell)}>
                    <StatusBadge tone={OUTCOME_TONE[match.outcome]}>
                      {t(`statistics.relationships.outcome.${match.outcome}`)}
                    </StatusBadge>
                  </td>
                  <td {...stylex.props(s.cell)}>
                    {f.count(match.setsFor)}–{f.count(match.setsAgainst)}
                  </td>
                  <td {...stylex.props(s.cell)}>
                    {f.count(match.gamesFor)}–{f.count(match.gamesAgainst)}
                  </td>
                  {showRating && (
                    <td {...stylex.props(s.cell)}>
                      {match.ratingDelta === null
                        ? t('statistics.relationships.noRating')
                        : f.signed(match.ratingDelta)}
                    </td>
                  )}
                  <td {...stylex.props(s.cell)}>
                    <Link
                      to="/matches/$eventId/groups/$groupId"
                      params={{ eventId: match.eventId, groupId: match.groupId }}
                      aria-label={t('statistics.relationships.matchLabel', {
                        date: f.date(match.playedAt)
                      })}
                      {...stylex.props(s.link)}
                    >
                      {t('statistics.relationships.viewMatch')}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
