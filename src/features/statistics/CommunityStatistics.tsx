import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { CountStat, MetricStat, ReasonText, Section, Stat } from './PlayerMetric';
import { FilterContext } from './PlayerStatistics';
import { useRelationshipFormat } from './RelationshipRecordView';
import { StatisticsFilters } from './StatisticsFilters';
import type { MetricState, StatisticsFilters as Filters } from './statistics-contracts';
import type {
  CommunityFrequent,
  CommunityLeader,
  CommunityRivalry,
  CommunityStatistics as Statistics
} from './statistics-community-contracts';
import { communityStyles as c } from './statistics-community.styles';
import { playerStyles as s } from './statistics-player.styles';
import { filterSearch } from './statistics-search';
import type { RelationshipName } from './statistics-relationship-contracts';

type Format = ReturnType<typeof useRelationshipFormat>;

/** A player name; it opens that player's statistics in the same scope when one community is selected. */
function PlayerName({ player, filters }: { player: RelationshipName; filters: Filters }) {
  const f = useRelationshipFormat();
  if (filters.communityId === null) return <>{f.name(player.displayName)}</>;
  return (
    <Link
      to="/players/$playerId"
      params={{ playerId: player.userId }}
      search={filterSearch(filters)}
    >
      {f.name(player.displayName)}
    </Link>
  );
}

function NameList({ players, filters }: { players: RelationshipName[]; filters: Filters }) {
  return (
    <ul {...stylex.props(c.names)}>
      {players.map((player) => (
        <li key={player.userId}>
          <PlayerName player={player} filters={filters} />
        </li>
      ))}
    </ul>
  );
}

function Unavailable({
  label,
  metric,
  help
}: {
  label: string;
  metric: MetricState<unknown>;
  help?: string;
}) {
  const { t } = useTranslation();
  if (metric.state === 'ready') return null;
  return (
    <Stat label={label} {...(help ? { help } : {})}>
      <strong {...stylex.props(s.value, s.valueMuted)}>{t('statistics.player.noValue')}</strong>
      <ReasonText metric={metric} />
    </Stat>
  );
}

function Ties({ total, listed }: { total: number; listed: number }) {
  const { t } = useTranslation();
  const f = useRelationshipFormat();
  if (total <= 1) return null;
  return (
    <span {...stylex.props(s.detail)}>
      {total > listed
        ? t('statistics.community.tiesPartial', { total: f.count(total), listed: f.count(listed) })
        : t('statistics.community.ties', { total: f.count(total) })}
    </span>
  );
}

function LeaderStat({
  label,
  metric,
  filters,
  detail,
  help
}: {
  label: string;
  metric: MetricState<CommunityLeader>;
  filters: Filters;
  detail: (value: number, f: Format) => string;
  help?: string;
}) {
  const f = useRelationshipFormat();
  if (metric.state !== 'ready')
    return <Unavailable label={label} metric={metric} {...(help ? { help } : {})} />;
  return (
    <Stat label={label} {...(help ? { help } : {})}>
      <strong {...stylex.props(s.value)}>
        <NameList players={metric.value.players} filters={filters} />
      </strong>
      <span {...stylex.props(s.detail)}>{detail(metric.value.value, f)}</span>
      <Ties total={metric.value.total} listed={metric.value.players.length} />
    </Stat>
  );
}

function TeamText({ team }: { team: RelationshipName[] }) {
  const f = useRelationshipFormat();
  return <>{f.list(team.map((player) => f.name(player.displayName)))}</>;
}

function FrequentStat({
  label,
  metric,
  help
}: {
  label: string;
  metric: MetricState<CommunityFrequent>;
  help?: string;
}) {
  const { t } = useTranslation();
  const f = useRelationshipFormat();
  if (metric.state !== 'ready')
    return <Unavailable label={label} metric={metric} {...(help ? { help } : {})} />;
  const { items, groups, total } = metric.value;
  return (
    <Stat label={label} {...(help ? { help } : {})}>
      <strong {...stylex.props(s.value)}>
        <ul {...stylex.props(c.names)}>
          {items.map((item) => (
            <li key={item.id}>
              {item.teams.map((team, index) => (
                <span key={team.map((player) => player.userId).join('-')}>
                  {index > 0 && <> {t('statistics.community.versus')} </>}
                  <TeamText team={team} />
                </span>
              ))}
            </li>
          ))}
        </ul>
      </strong>
      <span {...stylex.props(s.detail)}>
        {t('statistics.community.groupsTogether', { groups: f.count(groups) })}
      </span>
      <Ties total={total} listed={items.length} />
    </Stat>
  );
}

function RivalryStat({
  label,
  metric,
  help
}: {
  label: string;
  metric: MetricState<CommunityRivalry>;
  help: string;
}) {
  const { t } = useTranslation();
  const f = useRelationshipFormat();
  if (metric.state !== 'ready') return <Unavailable label={label} metric={metric} help={help} />;
  const { relationships, imbalance, resolved, total } = metric.value;
  return (
    <Stat label={label} help={help}>
      <strong {...stylex.props(s.value)}>
        <ul {...stylex.props(c.names)}>
          {relationships.map((item) => (
            <li key={`${item.first.userId}-${item.second.userId}`}>
              {t('statistics.community.rivalryPair', {
                first: f.name(item.first.displayName),
                second: f.name(item.second.displayName),
                wins: f.count(item.wins),
                losses: f.count(item.losses),
                draws: f.count(item.draws)
              })}
            </li>
          ))}
        </ul>
      </strong>
      <span {...stylex.props(s.detail)}>
        {t('statistics.community.rivalryDetail', {
          gap: f.count(imbalance),
          matches: f.count(resolved)
        })}
      </span>
      <Ties total={total} listed={relationships.length} />
    </Stat>
  );
}

function SeriesTable({
  caption,
  heading,
  rows
}: {
  caption: string;
  heading: string;
  rows: { key: string; label: string; groups: number }[];
}) {
  const { t } = useTranslation();
  const f = useRelationshipFormat();
  return (
    <section aria-label={caption} {...stylex.props(c.scroll)}>
      <table {...stylex.props(s.table)}>
        <caption {...stylex.props(s.caption)}>{caption}</caption>
        <thead>
          <tr>
            <th scope="col" {...stylex.props(s.cell)}>
              {heading}
            </th>
            <th scope="col" {...stylex.props(s.cell)}>
              {t('statistics.community.frequency.groups')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row" {...stylex.props(s.cell)}>
                {row.label}
              </th>
              <td {...stylex.props(s.cell)}>{f.count(row.groups)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * Community insights (PRD 38). Every figure counts a Game Group once; the filter bar, the scope
 * badges and the window text say exactly which scope the figures describe.
 */
export function CommunityStatistics({
  stats,
  onApply
}: {
  stats: Statistics;
  onApply: (next: Filters) => void;
}) {
  const { t } = useTranslation();
  const f = useRelationshipFormat();
  const { filters } = stats;
  const community = stats.communities.find((item) => item.id === filters.communityId);
  const thresholds = stats.config.thresholds;
  const empty = stats.matches.played === 0;

  return (
    <main {...stylex.props(s.page)}>
      <header {...stylex.props(s.header)}>
        <h1 {...stylex.props(s.title)}>
          {community
            ? t('statistics.community.titleCommunity', { name: community.name })
            : t('statistics.community.title')}
        </h1>
        <p {...stylex.props(s.copy)}>{t('statistics.community.subtitle')}</p>
        <FilterContext filters={filters} />
      </header>

      <Section id="community-filters" title={t('statistics.filters.title')}>
        <StatisticsFilters
          key={JSON.stringify(filters)}
          filters={filters}
          leagues={stats.leagues}
          activeLeagueId={stats.activeLeagueId}
          onApply={onApply}
        />
      </Section>

      {stats.league && (
        <p {...stylex.props(c.notice)}>
          {t(`statistics.community.leagueScope.${stats.league.status}`, {
            name: stats.league.name
          })}
        </p>
      )}
      {stats.notice && (
        <output {...stylex.props(c.notice)}>
          {t(`statistics.community.notice.${stats.notice}`)}
        </output>
      )}

      <Section id="community-matches" title={t('statistics.community.matches.title')}>
        <p {...stylex.props(s.copy)}>{t('statistics.community.matches.help')}</p>
        {empty && !stats.notice && (
          <p {...stylex.props(c.notice)}>{t('statistics.community.empty')}</p>
        )}
        <dl {...stylex.props(s.stats)}>
          <CountStat
            label={t('statistics.community.matches.played')}
            value={stats.matches.played}
          />
          <CountStat
            label={t('statistics.community.matches.competitive')}
            value={stats.matches.competitive}
          />
          <CountStat
            label={t('statistics.community.matches.friendly')}
            value={stats.matches.friendly}
          />
          <CountStat
            label={t('statistics.community.matches.decided')}
            value={stats.matches.decided}
          />
          <CountStat label={t('statistics.community.matches.draws')} value={stats.matches.draws} />
          <CountStat
            label={t('statistics.community.matches.incomplete')}
            value={stats.matches.incomplete}
          />
          <MetricStat
            label={t('statistics.community.ranking.label')}
            metric={stats.rankingMatches}
            format={(value) => f.count(value.groups)}
            help={t('statistics.community.ranking.help')}
          />
          <CountStat
            label={t('statistics.community.activePlayers.label')}
            value={stats.activePlayers}
            help={t('statistics.community.activePlayers.help')}
          />
          <CountStat label={t('statistics.community.totals.sets')} value={stats.totals.sets} />
          <CountStat label={t('statistics.community.totals.games')} value={stats.totals.games} />
        </dl>
      </Section>

      <Section id="community-leaders" title={t('statistics.community.leaders.title')}>
        <dl {...stylex.props(s.stats)}>
          <LeaderStat
            label={t('statistics.community.leaders.mostActive')}
            metric={stats.mostActivePlayer}
            filters={filters}
            detail={(value, fmt) =>
              t('statistics.community.leaders.matches', { matches: fmt.count(value) })
            }
          />
          <LeaderStat
            label={t('statistics.community.leaders.mostWins')}
            metric={stats.mostWins}
            filters={filters}
            detail={(value, fmt) =>
              t('statistics.community.leaders.wins', { wins: fmt.count(value) })
            }
          />
          <LeaderStat
            label={t('statistics.community.leaders.highestWinRate')}
            metric={stats.highestWinRate}
            filters={filters}
            help={t('statistics.community.leaders.highestWinRateHelp', {
              required: f.count(thresholds.community_leader_min_matches)
            })}
            detail={(value, fmt) => fmt.ratio(value)}
          />
          <LeaderStat
            label={t('statistics.community.leaders.bestSets')}
            metric={stats.bestSetDifferential}
            filters={filters}
            detail={(value, fmt) =>
              t('statistics.community.leaders.sets', { sets: fmt.signed(value) })
            }
          />
          <LeaderStat
            label={t('statistics.community.leaders.bestGames')}
            metric={stats.bestGameDifferential}
            filters={filters}
            detail={(value, fmt) =>
              t('statistics.community.leaders.games', { games: fmt.signed(value) })
            }
          />
          <LeaderStat
            label={t('statistics.community.leaders.mostImproved')}
            metric={stats.mostImproved}
            filters={filters}
            help={t('statistics.community.leaders.mostImprovedHelp')}
            detail={(value, fmt) =>
              t('statistics.community.leaders.rating', { delta: fmt.signed(value) })
            }
          />
        </dl>
      </Section>

      <Section id="community-pairings" title={t('statistics.community.pairings.title')}>
        <dl {...stylex.props(s.stats)}>
          <FrequentStat
            label={t('statistics.community.pairings.pair')}
            metric={stats.mostFrequentPair}
          />
          <FrequentStat
            label={t('statistics.community.pairings.matchup')}
            metric={stats.mostCommonMatchup}
            help={t('statistics.community.pairings.matchupHelp')}
          />
          <RivalryStat
            label={t('statistics.community.pairings.rivalry')}
            metric={stats.closestRivalry}
            help={t('statistics.community.pairings.rivalryHelp', {
              required: f.count(thresholds.closest_rivalry_min_meetings)
            })}
          />
        </dl>
      </Section>

      <Section id="community-frequency" title={t('statistics.community.frequency.title')}>
        <p {...stylex.props(s.copy)}>
          {stats.window.from && stats.window.through
            ? t('statistics.community.frequency.window', {
                from: f.date(stats.window.from),
                through: f.date(stats.window.through),
                days: f.count(stats.window.elapsedDays)
              })
            : t('statistics.community.frequency.noWindow')}
        </p>
        <dl {...stylex.props(s.stats)}>
          <MetricStat
            label={t('statistics.community.frequency.average')}
            metric={stats.averageMatchesPerWeek}
            format={(value) => f.count(value)}
            help={t('statistics.community.frequency.averageHelp')}
          />
        </dl>
        {stats.weeks.length > 0 && (
          <SeriesTable
            caption={t('statistics.community.frequency.weekCaption')}
            heading={t('statistics.community.frequency.week')}
            rows={stats.weeks.map((week) => ({
              key: week.start,
              label: f.date(week.start),
              groups: week.groups
            }))}
          />
        )}
        {stats.months.length > 0 && (
          <SeriesTable
            caption={t('statistics.community.frequency.monthCaption')}
            heading={t('statistics.community.frequency.month')}
            rows={stats.months.map((month) => ({
              key: month.month,
              label: f.month(month.month),
              groups: month.groups
            }))}
          />
        )}
      </Section>
    </main>
  );
}
