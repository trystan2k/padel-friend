import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { rootStyles } from '../../root.styles';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import type { LeagueDto, LeagueListResult, LeagueStatus } from './league-contracts';
import { LeagueStatusBadge, useLeaguePeriodText } from './LeagueSummary';
import { listMoreLeagues } from './league.functions';
import { styles } from './league.styles';

const SECTIONS: readonly LeagueStatus[] = ['active', 'upcoming', 'closed'];

const leagueLinkId = (id: string) => `league-link-${id}`;

/** Presentation order inside a section; the database order is only a stable pagination key. */
function sectionOrder(status: LeagueStatus) {
  if (status === 'upcoming')
    return (left: LeagueDto, right: LeagueDto) => left.start_at.localeCompare(right.start_at);
  if (status === 'closed')
    return (left: LeagueDto, right: LeagueDto) =>
      (right.closed_at ?? '').localeCompare(left.closed_at ?? '');
  return () => 0;
}

function sectionItems(leagues: readonly LeagueDto[], status: LeagueStatus): LeagueDto[] {
  return leagues.filter((league) => league.status === status).sort(sectionOrder(status));
}

/** Every League in the order the sections render them (what keyboard users tab through). */
const displayOrder = (leagues: readonly LeagueDto[]) =>
  SECTIONS.flatMap((status) => sectionItems(leagues, status));

function LeagueListItem({ league }: { league: LeagueDto }) {
  const { t } = useTranslation();
  const period = useLeaguePeriodText(league);
  return (
    <li>
      <Link
        to="/community/$communityId/leagues/$leagueId"
        params={{ communityId: league.community_id, leagueId: league.id }}
        id={leagueLinkId(league.id)}
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
  const { community } = data;
  // Continuation pages belong to the loader result they continue; a refreshed loader starts over.
  const [more, setMore] = useState<{
    base: LeagueListResult;
    leagues: LeagueDto[];
    last: LeagueListResult;
  } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const focusAfterLoad = useRef<{ league: string } | { status: true } | null>(null);
  const statusRef = useRef<HTMLOutputElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const continued = more && more.base === data ? more : null;
  // One entry per League across the first page and every continuation page (a League can appear
  // on two pages when it moves between them); the latest copy of a row wins.
  const byId = new Map<string, LeagueDto>();
  for (const league of [...data.leagues, ...(continued?.leagues ?? [])])
    byId.set(league.id, league);
  const leagues = [...byId.values()];
  const { truncated, next_cursor: nextCursor } = continued?.last ?? data;
  // The list is a snapshot of the instant it was loaded: its total is the first page's. A League
  // created since sorts ahead of every cursor, so a later page's own total would overstate it.
  const total = data.total;
  // The partial-list status stays through the final page so completion is announced.
  const partialListing = data.truncated;
  useEffect(() => {
    const target = focusAfterLoad.current;
    if (!target) return;
    focusAfterLoad.current = null;
    if ('league' in target) document.getElementById(leagueLinkId(target.league))?.focus();
    else statusRef.current?.focus();
  });
  const showMore = async () => {
    if (loadingMore || !nextCursor) return;
    setLoadingMore(true);
    setMoreFailed(false);
    try {
      const page = await listMoreLeagues({
        data: { community_id: community.id, cursor: nextCursor }
      });
      // Focus only follows the response if the player is still on the button that asked for it;
      // anyone who moved on while it was pending stays exactly where they are.
      const ownsFocus =
        moreButtonRef.current !== null && document.activeElement === moreButtonRef.current;
      const accumulated = [...(continued?.leagues ?? []), ...page.leagues];
      const merged = new Map(byId);
      for (const league of page.leagues) merged.set(league.id, league);
      // Keyboard users continue from the first newly loaded League in RENDERED order. With
      // nothing new and no button left, they land on the completion status instead.
      const fresh = displayOrder([...merged.values()]).find((league) => !byId.has(league.id));
      focusAfterLoad.current = !ownsFocus
        ? null
        : fresh
          ? { league: fresh.id }
          : page.truncated
            ? null
            : { status: true };
      setMore({ base: data, leagues: accumulated, last: page });
    } catch {
      setMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  };
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
        {leagues.length > 0 && !leagues.some((league) => league.status === 'active') && (
          <SurfaceCard xstyle={styles.card}>
            <p {...stylex.props(styles.strongText)}>{t('leagues.standings.empty.noActive')}</p>
            <p {...stylex.props(styles.muted)}>{t('leagues.standings.empty.noActiveBody')}</p>
          </SurfaceCard>
        )}
        {leagues.length === 0 ? (
          <SurfaceCard xstyle={styles.card}>
            <p {...stylex.props(styles.strongText)}>{t('leagues.list.empty')}</p>
            <p {...stylex.props(styles.muted)}>{t('leagues.list.emptyHint')}</p>
          </SurfaceCard>
        ) : (
          SECTIONS.map((status) => {
            const items = sectionItems(leagues, status);
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
        {partialListing && (
          <>
            <output ref={statusRef} tabIndex={-1} {...stylex.props(styles.guidance)}>
              {loadingMore
                ? t('leagues.list.loading')
                : truncated
                  ? t('leagues.list.truncated', { shown: leagues.length, total })
                  : t('leagues.list.complete', { total })}
            </output>
            {moreFailed && (
              <p role="alert" {...stylex.props(styles.errorText)}>
                {t('leagues.list.moreError')}
              </p>
            )}
            {truncated && (
              <Button
                ref={moreButtonRef}
                variant="secondary"
                disabled={loadingMore}
                focusableWhenDisabled
                onClick={() => void showMore()}
              >
                {t('leagues.list.more')}
              </Button>
            )}
          </>
        )}
      </div>
    </main>
  );
}
