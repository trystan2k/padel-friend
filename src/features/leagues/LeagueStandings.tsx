import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import type { LeagueStandingEntry, LeagueStandingsResult } from './league-standings-contracts';
import { styles as leagueStyles } from './league.styles';
import { styles } from './league-standings.styles';

const STATS = [
  ['matches', 'leagues.counters.matches'],
  ['wins', 'leagues.counters.wins'],
  ['draws', 'leagues.counters.draws'],
  ['losses', 'leagues.counters.losses'],
  ['sets_won', 'leagues.counters.setsWon'],
  ['sets_lost', 'leagues.counters.setsLost'],
  ['set_differential', 'leagues.counters.setDifferential']
] as const;

/** Award state of one row: threshold-only, never a rank or a champion claim. */
function useAwardText(standings: LeagueStandingsResult) {
  const { t } = useTranslation();
  return (entry: LeagueStandingEntry): string => {
    if (standings.source === 'final')
      return t(
        entry.award_eligible ? 'leagues.award.finalEligible' : 'leagues.award.finalIneligible'
      );
    return entry.award_eligible
      ? t('leagues.award.eligible')
      : t('leagues.award.remaining', { count: entry.matches_remaining });
  };
}

function calloutKey(standings: LeagueStandingsResult, entry: LeagueStandingEntry): string {
  if (standings.source === 'final')
    return entry.award_eligible
      ? 'leagues.award.callout.finalEligible'
      : 'leagues.award.callout.finalIneligible';
  return entry.award_eligible
    ? 'leagues.award.callout.eligible'
    : 'leagues.award.callout.remaining';
}

/**
 * Authoritative standings of one League: the live table of an open League or one immutable final
 * version of a closed one. Order and positions are the database's; this only presents them.
 */
export function LeagueStandings({
  standings,
  viewerId
}: {
  standings: LeagueStandingsResult;
  viewerId: string | null;
}) {
  const { t, i18n } = useTranslation();
  const awardText = useAwardText(standings);
  const number = new Intl.NumberFormat(i18n.language);
  const signed = new Intl.NumberFormat(i18n.language, { signDisplay: 'exceptZero' });
  const { entries } = standings;
  const own = entries.find((entry) => entry.user_id === viewerId) ?? null;
  const shared = (entry: LeagueStandingEntry) =>
    entries.some((other) => other !== entry && other.position === entry.position);
  const allZero = entries.length > 0 && entries.every((entry) => entry.matches === 0);

  return (
    <section aria-labelledby="league-standings-heading" {...stylex.props(leagueStyles.content)}>
      <div {...stylex.props(styles.headingRow)}>
        <h2 id="league-standings-heading" {...stylex.props(leagueStyles.sectionTitle)}>
          {t('leagues.standings.title')}
        </h2>
        {standings.status !== 'upcoming' && (
          <StatusBadge tone={standings.source === 'live' ? 'positive' : 'muted'}>
            {t(standings.source === 'live' ? 'leagues.standings.live' : 'leagues.standings.final')}
          </StatusBadge>
        )}
      </div>

      {entries.length === 0 ? (
        <SurfaceCard xstyle={leagueStyles.card}>
          {standings.source === 'final' ? (
            <>
              <p {...stylex.props(leagueStyles.strongText)}>
                {t('leagues.standings.empty.closedTitle')}
              </p>
              <p {...stylex.props(leagueStyles.muted)}>{t('leagues.standings.empty.closedBody')}</p>
            </>
          ) : (
            <p {...stylex.props(leagueStyles.muted)}>
              {t('leagues.standings.empty.noEligibleResults')}
            </p>
          )}
        </SurfaceCard>
      ) : (
        <>
          {own ? (
            <dl {...stylex.props(styles.summary)}>
              <div {...stylex.props(styles.summaryStat)}>
                <dt {...stylex.props(styles.summaryLabel)}>{t('leagues.standings.yourPlace')}</dt>
                <dd {...stylex.props(styles.summaryValue, styles.summaryValueAccent)}>
                  {number.format(own.position)}
                </dd>
              </div>
              <div {...stylex.props(styles.summaryStat)}>
                <dt {...stylex.props(styles.summaryLabel)}>
                  {t('leagues.counters.setDifferential')}
                </dt>
                <dd {...stylex.props(styles.summaryValue)}>
                  {signed.format(own.set_differential)}
                </dd>
              </div>
              <div {...stylex.props(styles.summaryStat)}>
                <dt {...stylex.props(styles.summaryLabel)}>{t('leagues.counters.matches')}</dt>
                <dd {...stylex.props(styles.summaryValue)}>{number.format(own.matches)}</dd>
              </div>
            </dl>
          ) : (
            <p {...stylex.props(leagueStyles.muted)}>
              {t('leagues.standings.empty.notParticipant')}
            </p>
          )}
          {allZero && standings.source === 'live' && (
            <p {...stylex.props(leagueStyles.muted)}>
              {t('leagues.standings.empty.noEligibleResults')}
            </p>
          )}
          {/* A focusable, named scroll region: every statistic stays reachable on narrow screens. */}
          <section
            aria-label={t('leagues.standings.tableLabel')}
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region must be keyboard reachable
            tabIndex={0}
            {...stylex.props(styles.scroll)}
          >
            <table {...stylex.props(styles.table)}>
              <thead>
                <tr>
                  <th scope="col" {...stylex.props(styles.headCell)}>
                    {t('leagues.standings.position')}
                  </th>
                  <th scope="col" {...stylex.props(styles.headCell, styles.playerCell)}>
                    {t('leagues.standings.player')}
                  </th>
                  {STATS.map(([key, label]) => (
                    <th key={key} scope="col" {...stylex.props(styles.headCell)}>
                      {t(label)}
                    </th>
                  ))}
                  <th scope="col" {...stylex.props(styles.headCell)}>
                    {t('leagues.standings.award')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const isOwn = entry.user_id === viewerId;
                  return (
                    <tr
                      key={entry.user_id}
                      aria-current={isOwn ? 'true' : undefined}
                      {...stylex.props(isOwn && styles.ownRow)}
                    >
                      <td {...stylex.props(styles.cell, styles.position)}>
                        {number.format(entry.position)}
                        {shared(entry) && (
                          <span {...stylex.props(styles.hidden)}>
                            {t('leagues.standings.sharedPosition', { position: entry.position })}
                          </span>
                        )}
                      </td>
                      <th scope="row" {...stylex.props(styles.cell, styles.playerCell)}>
                        <span {...stylex.props(styles.playerName)}>
                          {entry.display_name ?? t('leagues.counters.unknownPlayer')}
                        </span>
                        {entry.is_provisional && (
                          <span {...stylex.props(styles.tag)}>{t('player.provisional.badge')}</span>
                        )}
                        {isOwn && (
                          <span {...stylex.props(styles.tag)}>{t('leagues.standings.you')}</span>
                        )}
                      </th>
                      {STATS.map(([key]) => (
                        <td key={key} {...stylex.props(styles.cell)}>
                          {key === 'set_differential'
                            ? signed.format(entry[key])
                            : number.format(entry[key])}
                        </td>
                      ))}
                      <td {...stylex.props(styles.cell)}>{awardText(entry)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
          {own && (
            <p {...stylex.props(styles.callout)}>
              {t(calloutKey(standings, own), { count: own.matches_remaining })}
            </p>
          )}
        </>
      )}
      <p {...stylex.props(leagueStyles.muted)}>{t('leagues.standings.rankingRule')}</p>
      <p {...stylex.props(leagueStyles.muted)}>
        {t('leagues.standings.eligibilityRule', {
          count: standings.minimum_matches_for_final_award
        })}
      </p>
    </section>
  );
}

/** The standings reader failed or answered for another League state: say so, never guess. */
export function LeagueStandingsUnavailable({
  message,
  busy,
  onRetry
}: {
  message: string;
  busy: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="league-standings-heading" {...stylex.props(leagueStyles.content)}>
      <h2 id="league-standings-heading" {...stylex.props(leagueStyles.sectionTitle)}>
        {t('leagues.standings.title')}
      </h2>
      <p role="alert" {...stylex.props(leagueStyles.errorText)}>
        {message}
      </p>
      <Button variant="secondary" busy={busy} onClick={onRetry}>
        {t('leagues.standings.retry')}
      </Button>
    </section>
  );
}

/** A close just happened: the live table is gone, the final is still loading. */
export function LeagueStandingsRefreshing() {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="league-standings-heading" {...stylex.props(leagueStyles.content)}>
      <h2 id="league-standings-heading" {...stylex.props(leagueStyles.sectionTitle)}>
        {t('leagues.standings.title')}
      </h2>
      <output {...stylex.props(leagueStyles.muted)}>{t('leagues.standings.refreshing')}</output>
    </section>
  );
}
