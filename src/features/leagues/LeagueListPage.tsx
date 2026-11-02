import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { rootStyles } from '../../root.styles';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import type { LeagueDto, LeagueListResult, LeagueStatus } from './league-contracts';
import { LeagueStatusBadge, useLeaguePeriodText } from './LeagueSummary';
import { styles } from './league.styles';

const SECTIONS: readonly LeagueStatus[] = ['active', 'upcoming', 'closed'];

function LeagueListItem({ league }: { league: LeagueDto }) {
  const { t } = useTranslation();
  const period = useLeaguePeriodText(league);
  return (
    <li>
      <Link
        to="/community/$communityId/leagues/$leagueId"
        params={{ communityId: league.community_id, leagueId: league.id }}
        {...stylex.props(styles.itemLink)}
      >
        <span {...stylex.props(styles.itemHeader)}>
          <span {...stylex.props(styles.itemName)}>{league.name}</span>
          <LeagueStatusBadge status={league.status} />
        </span>
        <span {...stylex.props(styles.muted)}>{period}</span>
        {league.blocked_reason && (
          <span {...stylex.props(styles.blocked)}>
            {t(`leagues.blocked.${league.blocked_reason}`)}
          </span>
        )}
      </Link>
    </li>
  );
}

export function LeagueListPage({ data }: { data: LeagueListResult }) {
  const { t } = useTranslation();
  const { community, leagues, total, truncated } = data;
  return (
    <main {...stylex.props(styles.page)}>
      <header {...stylex.props(styles.header, rootStyles.pageHeader)}>
        <div {...stylex.props(styles.headingRow)}>
          <Link
            to="/dashboard"
            aria-label={t('leagues.backToDashboard')}
            {...stylex.props(styles.backLink)}
          >
            <span aria-hidden="true">‹</span>
          </Link>
          <h1 {...stylex.props(styles.title)}>{t('leagues.title')}</h1>
        </div>
        <p {...stylex.props(styles.context)}>
          {t('leagues.communityContext', { community: community.name })}
        </p>
      </header>
      <div {...stylex.props(styles.content)}>
        {community.can_create ? (
          <Link
            to="/community/$communityId/leagues/create"
            params={{ communityId: community.id }}
            {...stylex.props(styles.primaryLink)}
          >
            {t('leagues.list.create')}
          </Link>
        ) : (
          <p {...stylex.props(styles.guidance)}>{t('leagues.list.creationDisabled')}</p>
        )}
        {truncated && (
          <output {...stylex.props(styles.guidance)}>
            {t('leagues.list.truncated', { shown: leagues.length, total })}
          </output>
        )}
        {leagues.length === 0 ? (
          <SurfaceCard xstyle={styles.card}>
            <p {...stylex.props(styles.strongText)}>{t('leagues.list.empty')}</p>
            <p {...stylex.props(styles.muted)}>{t('leagues.list.emptyHint')}</p>
          </SurfaceCard>
        ) : (
          SECTIONS.map((status) => {
            const items = leagues.filter((league) => league.status === status);
            if (items.length === 0) return null;
            return (
              <section
                key={status}
                aria-labelledby={`leagues-${status}`}
                {...stylex.props(styles.content)}
              >
                <h2 id={`leagues-${status}`} {...stylex.props(styles.sectionTitle)}>
                  {t(`leagues.list.sections.${status}`)}
                </h2>
                <ul {...stylex.props(styles.list)}>
                  {items.map((league) => (
                    <LeagueListItem key={league.id} league={league} />
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </div>
    </main>
  );
}
