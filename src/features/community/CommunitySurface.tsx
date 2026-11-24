import * as stylex from '@stylexjs/stylex';
import { Link, useLocation, useNavigate, useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import { rootStyles } from '../../root.styles';
import { useRouteRefresh } from '../../lib/use-route-refresh';
import { CommunitySwitcher } from '../home/CommunitySwitcher';
import { ActivitySection } from '../home/HomeSections';
import { LeagueEntries } from '../leagues/LeagueEntries';
import { ProfileError } from '../player/ProfileStates';
import { CommunityAdminEntries } from './CommunityAdmin';
import { CommunityInbox } from './CommunityInbox';
import { CommunityRanking } from './CommunityRanking';
import { InvitationDiscoverability } from './InvitationDiscoverability';
import { communityStyles as s } from './community-surface.styles';
import type { CommunitySurfaceData, CommunityView, RankingKind } from './community-surface';

type OverviewData = Extract<CommunitySurfaceData, { view: 'overview' }>;

export function CommunitySurfaceError({ error }: { error: unknown }) {
  const href = useLocation({ select: (location) => location.href });
  return <ProfileError error={error} next={encodeURIComponent(href)} />;
}

function CommunityOverview({ data }: { data: OverviewData }) {
  const { t, i18n } = useTranslation();
  const communityId = data.status === 'ready' ? data.selected.id : null;
  const visibility = data.metadata?.visibility ?? data.adminContext?.visibility;
  const city = data.metadata?.city_label ?? data.adminContext?.city_label;
  const count = data.metadata?.member_count;
  const formatter = new Intl.NumberFormat(i18n.language);
  const events =
    data.matches.status === 'ok'
      ? [data.matches.value.next, ...data.matches.value.available]
          .filter((event) => event !== null)
          .filter(
            (event, index, all) =>
              all.findIndex((other) => other.event_id === event.event_id) === index
          )
          .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
      : [];
  return (
    <>
      {communityId ? (
        <>
          <SurfaceCard data-community-summary xstyle={s.card}>
            <div {...stylex.props(s.inline)}>
              <span {...stylex.props(s.chip)}>
                {visibility
                  ? t(`communitySurface.${visibility}`)
                  : t('communitySurface.visibilityUnavailable')}
              </span>
              {city && <span {...stylex.props(s.chip)}>{city}</span>}
            </div>
            <dl {...stylex.props(s.metrics)}>
              <div {...stylex.props(s.metricItem)}>
                <dt {...stylex.props(s.body)}>{t('communitySurface.members')}</dt>
                <dd {...stylex.props(s.metric)}>
                  {count === undefined
                    ? t('communitySurface.unavailable')
                    : formatter.format(count)}
                </dd>
              </div>
              <div {...stylex.props(s.metricItem)}>
                <dt {...stylex.props(s.body)}>{t('communitySurface.activeWeek')}</dt>
                <dd {...stylex.props(s.metric)}>{t('communitySurface.unavailable')}</dd>
              </div>
            </dl>
            <div {...stylex.props(s.inline)}>
              <Link
                to="/matches/create"
                search={{ communityId }}
                {...stylex.props(s.link, s.primary)}
              >
                {t('matches.create')}
              </Link>
              {data.adminContext?.visibility === 'private' && (
                <Link
                  to="/community/$communityId/admin/members"
                  params={{ communityId }}
                  {...stylex.props(s.link)}
                >
                  {t('communitySurface.invite')}
                </Link>
              )}
            </div>
          </SurfaceCard>
          <SurfaceCard xstyle={s.card}>
            {data.joinRequests.status === 'ok' ? (
              <Link
                to="/community/$communityId/admin/requests"
                params={{ communityId }}
                {...stylex.props(s.link)}
              >
                {data.joinRequests.total === 0
                  ? t('communitySurface.joinRequestsNone')
                  : t(
                      data.joinRequests.exact
                        ? 'communitySurface.joinRequests'
                        : 'communitySurface.joinRequestsAtLeast',
                      { count: data.joinRequests.total }
                    )}
              </Link>
            ) : (
              <p {...stylex.props(s.body)}>{t('communitySurface.joinCountUnavailable')}</p>
            )}
          </SurfaceCard>
          <section aria-labelledby="community-upcoming" {...stylex.props(s.stack)}>
            <h2 id="community-upcoming" {...stylex.props(s.heading)}>
              {t('communitySurface.upcoming')}
            </h2>
            {data.matches.status === 'error' ? (
              <p role="alert" {...stylex.props(s.body)}>
                {t('home.sectionError')}
              </p>
            ) : events.length ? (
              <ul {...stylex.props(s.list)}>
                {events.map((event) => (
                  <li key={event.event_id}>
                    <SurfaceCard>
                      <Link
                        to="/matches/$eventId"
                        params={{ eventId: event.event_id }}
                        {...stylex.props(s.link, s.match)}
                      >
                        <time dateTime={event.starts_at} {...stylex.props(s.when)}>
                          <span {...stylex.props(s.whenTime)}>
                            {new Intl.DateTimeFormat(i18n.language, {
                              timeStyle: 'short',
                              timeZone: event.timezone
                            }).format(new Date(event.starts_at))}
                          </span>
                          <span {...stylex.props(s.whenDay)}>
                            {new Intl.DateTimeFormat(i18n.language, {
                              weekday: 'short',
                              day: 'numeric',
                              timeZone: event.timezone
                            }).format(new Date(event.starts_at))}
                          </span>
                        </time>
                        <span>
                          {event.venue_name}
                          <small {...stylex.props(s.body)}>
                            {' · '}
                            {t('home.nextMatch.playing', { count: event.playing_count })}
                          </small>
                        </span>
                        <span aria-hidden="true">›</span>
                      </Link>
                    </SurfaceCard>
                  </li>
                ))}
              </ul>
            ) : (
              <p {...stylex.props(s.body)}>
                {t(
                  data.matches.status === 'unavailable'
                    ? 'home.sectionUnavailable'
                    : 'communitySurface.noUpcoming'
                )}
              </p>
            )}
          </section>
        </>
      ) : (
        <SurfaceCard xstyle={s.card}>
          <h2 {...stylex.props(s.heading)}>{t('home.noCommunity.title')}</h2>
          <p {...stylex.props(s.body)}>{t('home.noCommunity.description')}</p>
          <Link to="/onboarding/community" {...stylex.props(s.link)}>
            {t('home.noCommunity.action')}
          </Link>
        </SurfaceCard>
      )}
      <div data-community-entries {...stylex.props(s.stack)}>
        <CommunityAdminEntries communities={data.adminCommunities} />
        <LeagueEntries communities={data.leagueCommunities} />
        <CommunityInbox initialItems={data.inbox.items} loadError={data.inbox.error} />
        <InvitationDiscoverability />
      </div>
      <ActivitySection section={data.activity} />
    </>
  );
}

export function CommunitySurface({
  data,
  view,
  ranking = 'skill'
}: {
  data: CommunitySurfaceData;
  view: CommunityView;
  ranking?: RankingKind;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const router = useRouter();
  const communityId = data.status === 'ready' ? data.selected.id : null;
  const params = communityId ? { communityId } : null;
  const communities = 'communities' in data ? (data.communities ?? []) : [];
  useRouteRefresh({ scope: `community:${communityId ?? 'none'}:${view}` });

  const segment = (active: boolean) => stylex.props(s.link, active && s.segmentActive);
  return (
    <main data-community-view={view} {...stylex.props(s.page)}>
      <header {...stylex.props(s.header, rootStyles.pageHeader)}>
        <div {...stylex.props(s.headerGroup)}>
          <h1 {...stylex.props(s.headerTitle, data.status === 'ready' && s.srOnly)}>
            {data.status === 'ready' ? data.selected.name : t('appShell.nav.community')}
          </h1>
          {communities.length > 0 && (
            <CommunitySwitcher
              variant="community"
              communities={communities}
              value={communityId}
              onSelect={(id) => {
                if (view === 'ranking')
                  void navigate({
                    to: '/community/$communityId/ranking',
                    params: { communityId: id },
                    search: { by: ranking === 'league' ? 'league' : undefined }
                  });
                else void navigate({ to: '/community/$communityId', params: { communityId: id } });
              }}
            />
          )}
        </div>
        {params &&
          'adminCommunities' in data &&
          data.adminCommunities.some(({ id }) => id === params.communityId) && (
            <Link
              to="/community/$communityId/admin/settings"
              params={params}
              aria-label={t('communitySurface.settings')}
              {...stylex.props(s.link, s.gear)}
            >
              <svg
                aria-hidden="true"
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="m10 3-.7 2.6-2 .9L5 5.2 3 8.7l1.8 1.9v2.8L3 15.3l2 3.5 2.3-1.3 2 .9L10 21h4l.7-2.6 2-.9 2.3 1.3 2-3.5-1.8-1.9v-2.8L21 8.7l-2-3.5-2.3 1.3-2-.9L14 3Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </Link>
          )}
      </header>
      {params && (
        <nav aria-label={t('communitySurface.navigation')} {...stylex.props(s.segments)}>
          <Link
            to="/community/$communityId"
            params={params}
            activeOptions={{ exact: true }}
            aria-current={view === 'overview' ? 'page' : undefined}
            {...segment(view === 'overview')}
          >
            {t('communitySurface.overview')}
          </Link>
          <Link
            to="/community/$communityId/ranking"
            params={params}
            activeOptions={{ exact: true }}
            {...segment(view === 'ranking')}
          >
            {t('home.ranking.title')}
          </Link>
          <Link to="/community/$communityId/leagues" params={params} {...segment(false)}>
            {t('communitySurface.leagues')}
          </Link>
        </nav>
      )}
      {data.status === 'error' && (
        <SurfaceCard xstyle={s.card}>
          <p role="alert" {...stylex.props(s.body)}>
            {t('home.communitiesError')}
          </p>
          <Button variant="secondary" onClick={() => void router.invalidate()}>
            {t('home.retry')}
          </Button>
        </SurfaceCard>
      )}
      {data.status === 'denied' && (
        <SurfaceCard xstyle={s.card}>
          <p {...stylex.props(s.body)}>{t('home.ranking.notMember')}</p>
          <Link to="/community" {...stylex.props(s.link)}>
            {t('communitySurface.overview')}
          </Link>
        </SurfaceCard>
      )}
      {'view' in data &&
        (data.view === 'overview' ? (
          <CommunityOverview data={data} />
        ) : (
          <CommunityRanking data={data} kind={ranking} />
        ))}
    </main>
  );
}
