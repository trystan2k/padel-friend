import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { HomeLeagueRank, HomeRankMovement, HomeSection } from '../home/home-contracts';
import { formatDisplayLevel } from '../player/rating-config';
import { communityStyles as s } from './community-surface.styles';
import type { CommunitySurfaceData, RankingKind } from './community-surface';

type Props = Extract<CommunitySurfaceData, { view: 'ranking' }>;

function Movement({ movement }: { movement: HomeRankMovement | null }) {
  const { t } = useTranslation();
  if (!movement) return null;
  const count = 'places' in movement ? movement.places : undefined;
  return <p {...stylex.props(s.body)}>{t(`home.ranking.movement.${movement.state}`, { count })}</p>;
}

function RankingState({
  status,
  empty
}: {
  status: Exclude<HomeSection<unknown>['status'], 'ok'>;
  empty: string;
}) {
  const { t } = useTranslation();
  return (
    <p role={status === 'error' ? 'alert' : undefined} {...stylex.props(s.body)}>
      {status === 'empty'
        ? empty
        : t(status === 'error' ? 'home.sectionError' : 'home.sectionUnavailable')}
    </p>
  );
}

function SkillRanking({ data }: { data: Props }) {
  const { t, i18n } = useTranslation();
  const section = data.ranking.status === 'ok' ? data.ranking.value.skill : data.ranking;
  const rank = section.status === 'ok' ? section.value : null;
  const number = new Intl.NumberFormat(i18n.language);
  const position = rank?.status === 'ranked' ? rank.position : null;
  return (
    <>
      <p {...stylex.props(s.body)}>{t('communitySurface.skillDescription')}</p>
      <p data-skill-list-unavailable {...stylex.props(s.body)}>
        {t('communitySurface.skillListUnavailable')}
      </p>
      <ul {...stylex.props(s.list)}>
        <li data-rank-row="skill" data-rank-self {...stylex.props(s.row, s.self)}>
          <span>{position === null ? '—' : number.format(position)}</span>
          <div>
            <strong>
              {data.profile.display_name
                ? t('communitySurface.selfName', { name: data.profile.display_name })
                : t('home.ranking.you')}
            </strong>
            {data.level.reliability_percent < 50 && (
              <p {...stylex.props(s.body)}>{t('communitySurface.provisional')}</p>
            )}
            {rank?.status === 'unrated' && (
              <p {...stylex.props(s.body)}>{t('home.ranking.unrated')}</p>
            )}
            {rank?.status === 'not_member' && (
              <p {...stylex.props(s.body)}>{t('home.ranking.notMember')}</p>
            )}
            <Movement movement={rank?.movement ?? null} />
          </div>
          <strong>{formatDisplayLevel(data.level.display_level, i18n.language)}</strong>
        </li>
      </ul>
      {section.status !== 'ok' && (
        <RankingState status={section.status} empty={t('home.ranking.skillEmpty')} />
      )}
    </>
  );
}

function LeagueRanking({ league, communityId }: { league: HomeLeagueRank; communityId: string }) {
  const { t, i18n } = useTranslation();
  const number = new Intl.NumberFormat(i18n.language);
  const rows =
    league.self && !league.top.some(({ isSelf }) => isSelf)
      ? [...league.top, league.self]
      : league.top;
  return (
    <>
      <h2 {...stylex.props(s.heading)}>
        <Link
          to="/community/$communityId/leagues/$leagueId"
          params={{ communityId, leagueId: league.league_id }}
          {...stylex.props(s.link)}
        >
          {t('home.ranking.leagueTitle', { name: league.name })}
        </Link>
      </h2>
      <p {...stylex.props(s.body)}>
        {t(
          league.activeCount === 1 && league.activeCountExact
            ? 'home.ranking.leagueOnly'
            : league.activeCountExact
              ? 'home.ranking.leagueFirstOf'
              : 'home.ranking.leagueFirstOfMore',
          { count: league.activeCount }
        )}
      </p>
      {rows.length ? (
        <ol {...stylex.props(s.list)}>
          {rows.map((row) => (
            <li
              key={row.user_id}
              data-rank-row="league"
              data-rank-self={row.isSelf || undefined}
              {...stylex.props(s.row, row.isSelf && s.self)}
            >
              <span>{number.format(row.position)}</span>
              <strong>
                {row.isSelf
                  ? row.display_name
                    ? t('communitySurface.selfName', { name: row.display_name })
                    : t('home.ranking.you')
                  : (row.display_name ?? t('home.ranking.unnamed'))}
              </strong>
              <span>
                {t('home.ranking.record', {
                  wins: number.format(row.wins),
                  losses: number.format(row.losses)
                })}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p {...stylex.props(s.body)}>{t('communitySurface.noStandings')}</p>
      )}
      {rows.length > 0 && league.self === null && (
        <p {...stylex.props(s.body)}>{t('home.ranking.selfMissing')}</p>
      )}
      <Movement movement={league.movement} />
    </>
  );
}

export function CommunityRanking({ data, kind }: { data: Props; kind: RankingKind }) {
  const { t } = useTranslation();
  const params = { communityId: data.selected.id };
  const league = data.ranking.status === 'ok' ? data.ranking.value.league : data.ranking;
  return (
    <section aria-label={t('home.ranking.title')} {...stylex.props(s.stack)}>
      <nav aria-label={t('communitySurface.rankingKind')} {...stylex.props(s.segments)}>
        {(['skill', 'league'] as const).map((tab) => (
          <Link
            key={tab}
            to="/community/$communityId/ranking"
            params={params}
            search={tab === 'league' ? { by: 'league' } : {}}
            activeOptions={{ exact: true, explicitUndefined: true }}
            aria-current={kind === tab ? 'page' : undefined}
            {...stylex.props(s.link, s.compact, kind === tab && s.segmentActive)}
          >
            {t(`communitySurface.${tab}`)}
          </Link>
        ))}
      </nav>
      {kind === 'skill' ? (
        <SkillRanking data={data} />
      ) : league.status === 'ok' ? (
        <LeagueRanking league={league.value} communityId={params.communityId} />
      ) : (
        <RankingState status={league.status} empty={t('home.ranking.leagueEmpty')} />
      )}
      <Link to="/community/$communityId/statistics" params={params} {...stylex.props(s.link)}>
        {t('home.ranking.statistics')}
      </Link>
    </section>
  );
}
