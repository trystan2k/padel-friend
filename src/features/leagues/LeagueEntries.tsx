import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { LeagueCommunityEntry } from './league-contracts';
import { styles } from './league.styles';

/** Member-reachable entry points: every community the caller actively belongs to. */
export function LeagueEntries({ communities }: { communities: LeagueCommunityEntry[] }) {
  const { t } = useTranslation();
  if (communities.length === 0) return null;
  return (
    <section aria-labelledby="league-entries-heading" {...stylex.props(styles.content)}>
      <h2 id="league-entries-heading" {...stylex.props(styles.sectionTitle)}>
        {t('leagues.entries.title')}
      </h2>
      <ul {...stylex.props(styles.list)}>
        {communities.map((community) => (
          <li key={community.id}>
            <Link
              to="/community/$communityId/leagues"
              params={{ communityId: community.id }}
              {...stylex.props(styles.itemLink)}
            >
              {t('leagues.entries.link', { community: community.name })}
            </Link>
            <Link
              to="/community/$communityId/statistics"
              params={{ communityId: community.id }}
              {...stylex.props(styles.itemLink)}
            >
              {t('statistics.community.titleCommunity', { name: community.name })}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
