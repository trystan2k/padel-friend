import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  HomeAction,
  HomeActivity,
  HomeLeagueRank,
  HomeMatchCard,
  HomeMatches,
  HomeRankMovement,
  HomeRanking,
  HomeSection,
  HomeSkillRank
} from './home-contracts';
import { homeStyles as s } from './home.styles';

type Translate = (key: string, options?: Record<string, unknown>) => string;

function useFormat() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  return {
    t: t as Translate,
    when: (instant: string, timeZone: string) =>
      new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(
        new Date(instant)
      ),
    day: (instant: string) =>
      new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
        new Date(instant)
      ),
    number: (value: number, options?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat(locale, { maximumFractionDigits: 2, ...options }).format(value)
  };
}

/** Unavailable, failed or empty reads are always shown as such, never as a successful zero. */
function Outcome<T>({
  section,
  empty,
  children
}: {
  section: HomeSection<T>;
  empty: string;
  children: (value: T) => ReactNode;
}) {
  const { t } = useTranslation();
  if (section.status === 'ok') return <>{children(section.value)}</>;
  const key =
    section.status === 'empty'
      ? empty
      : section.status === 'unavailable'
        ? 'home.sectionUnavailable'
        : 'home.sectionError';
  return (
    <p role={section.status === 'error' ? 'alert' : undefined} {...stylex.props(s.state)}>
      {t(key)}
    </p>
  );
}

function SectionShell({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} {...stylex.props(s.section)}>
      <div {...stylex.props(s.sectionHeading)}>
        <h2 id={`${id}-heading`} {...stylex.props(s.sectionTitle)}>
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

function MatchItem({ event, heading }: { event: HomeMatchCard; heading: 'h3' | 'h4' }) {
  const { t, when } = useFormat();
  const Heading = heading;
  return (
    <article {...stylex.props(s.card)}>
      <Heading {...stylex.props(s.cardTitle)}>
        <Link to="/matches/$eventId" params={{ eventId: event.event_id }} {...stylex.props(s.link)}>
          {event.venue_name}
        </Link>
      </Heading>
      <p {...stylex.props(s.body)}>
        <time dateTime={event.starts_at}>{when(event.starts_at, event.timezone)}</time>
        {' · '}
        {event.timezone}
      </p>
      <p {...stylex.props(s.meta)}>
        {event.community_name}
        {' · '}
        {t('home.nextMatch.playing', { count: event.playing_count })}
        {event.more_needed > 0 &&
          ` · ${t('home.nextMatch.moreNeeded', { count: event.more_needed })}`}
      </p>
    </article>
  );
}

export function NextMatchSection({ section }: { section: HomeSection<HomeMatches> }) {
  const { t } = useFormat();
  return (
    <SectionShell id="home-next-match" title={t('home.nextMatch.title')}>
      <Outcome section={section} empty="home.nextMatch.empty">
        {({ next, available }) => (
          <>
            {next ? (
              <MatchItem event={next} heading="h3" />
            ) : (
              <p {...stylex.props(s.state)}>{t('home.nextMatch.empty')}</p>
            )}
            {available.length > 0 && (
              <>
                <h3 {...stylex.props(s.cardTitle)}>{t('home.available.title')}</h3>
                <ul {...stylex.props(s.list)}>
                  {available.map((event) => (
                    <li key={event.event_id}>
                      <MatchItem event={event} heading="h4" />
                    </li>
                  ))}
                </ul>
              </>
            )}
            <Link to="/matches" {...stylex.props(s.link)}>
              {t('home.available.all')}
            </Link>
          </>
        )}
      </Outcome>
    </SectionShell>
  );
}

function actionText(t: Translate, action: HomeAction) {
  const venue = action.venue_name;
  switch (action.kind) {
    case 'result_review':
      return t('home.actions.resultReview', { count: action.count ?? 1, venue });
    case 'reconfirmation':
      return t('home.actions.reconfirmation', { venue });
    case 'organizer_requests':
      return t('home.actions.organizerRequests', { count: action.count ?? 1, venue });
    default:
      return t('home.actions.reserveStandby', { venue });
  }
}

export function ActionsSection({
  section
}: {
  section: HomeSection<{ items: HomeAction[]; partial: boolean }>;
}) {
  const { t, when } = useFormat();
  return (
    <SectionShell id="home-actions" title={t('home.actions.title')}>
      <Outcome section={section} empty="home.actions.empty">
        {({ items, partial }) => (
          <>
            {partial && <output {...stylex.props(s.state)}>{t('home.actions.partial')}</output>}
            <ul {...stylex.props(s.list)}>
              {items.map((item) => (
                <li key={`${item.kind}-${item.event_id}`} {...stylex.props(s.card)}>
                  <p {...stylex.props(s.body)}>{actionText(t, item)}</p>
                  <p {...stylex.props(s.meta)}>{when(item.starts_at, item.timezone)}</p>
                  <Link
                    to="/matches/$eventId"
                    params={{ eventId: item.event_id }}
                    aria-label={t('home.actions.openVenue', { venue: item.venue_name })}
                    {...stylex.props(s.link)}
                  >
                    {t('home.actions.open')}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Outcome>
    </SectionShell>
  );
}

function movementText(t: Translate, movement: HomeRankMovement | null): string | null {
  if (movement === null) return null;
  if (movement.state === 'new') return t('home.ranking.movement.new');
  if (movement.state === 'same') return t('home.ranking.movement.same');
  return t(`home.ranking.movement.${movement.state}`, { count: movement.places });
}

function SkillRank({ rank }: { rank: HomeSkillRank }) {
  const { t, number } = useFormat();
  const movement = movementText(t, rank.movement);
  if (rank.status !== 'ranked' || rank.position === null)
    return (
      <p {...stylex.props(s.state)}>
        {t(rank.status === 'unrated' ? 'home.ranking.unrated' : 'home.ranking.notMember')}
      </p>
    );
  return (
    <p {...stylex.props(s.body)}>
      {rank.rankedMembers === null
        ? t('home.ranking.skillRankedNoTotal', { position: number(rank.position) })
        : t('home.ranking.skillRanked', {
            position: number(rank.position),
            total: number(rank.rankedMembers)
          })}
      {movement && ` · ${movement}`}
    </p>
  );
}

function LeagueRank({ league, communityId }: { league: HomeLeagueRank; communityId: string }) {
  const { t, number } = useFormat();
  const movement = movementText(t, league.movement);
  const rows =
    league.self && !league.top.some((row) => row.isSelf)
      ? [...league.top, league.self]
      : league.top;
  return (
    <>
      <h3 {...stylex.props(s.cardTitle)}>
        <Link
          to="/community/$communityId/leagues/$leagueId"
          params={{ communityId, leagueId: league.league_id }}
          {...stylex.props(s.link)}
        >
          {t('home.ranking.leagueTitle', { name: league.name })}
        </Link>
      </h3>
      <p {...stylex.props(s.meta)}>
        {league.activeCount === 1
          ? t('home.ranking.leagueOnly')
          : t(
              league.activeCountExact
                ? 'home.ranking.leagueFirstOf'
                : 'home.ranking.leagueFirstOfMore',
              {
                count: league.activeCount
              }
            )}
      </p>
      <ol {...stylex.props(s.list)}>
        {rows.map((row) => (
          <li key={row.user_id} {...stylex.props(s.rankRow, row.isSelf && s.rankSelf)}>
            <span>
              {number(row.position)}.{' '}
              {row.isSelf ? t('home.ranking.you') : (row.display_name ?? t('home.ranking.unnamed'))}
            </span>
            <span>{t('home.ranking.record', { wins: row.wins, losses: row.losses })}</span>
          </li>
        ))}
      </ol>
      {league.self === null && <p {...stylex.props(s.meta)}>{t('home.ranking.selfMissing')}</p>}
      {movement && <p {...stylex.props(s.meta)}>{movement}</p>}
    </>
  );
}

export function RankingSection({
  section,
  communityId
}: {
  section: HomeSection<HomeRanking>;
  communityId: string | null;
}) {
  const { t } = useFormat();
  return (
    <SectionShell id="home-ranking" title={t('home.ranking.title')}>
      <Outcome section={section} empty="home.ranking.empty">
        {({ skill, league }) => (
          <>
            <h3 {...stylex.props(s.cardTitle)}>{t('home.ranking.skillTitle')}</h3>
            <Outcome section={skill} empty="home.ranking.skillEmpty">
              {(rank) => <SkillRank rank={rank} />}
            </Outcome>
            <Outcome section={league} empty="home.ranking.leagueEmpty">
              {(value) =>
                communityId ? <LeagueRank league={value} communityId={communityId} /> : null
              }
            </Outcome>
            {communityId && (
              <Link
                to="/community/$communityId/statistics"
                params={{ communityId }}
                {...stylex.props(s.link)}
              >
                {t('home.ranking.statistics')}
              </Link>
            )}
          </>
        )}
      </Outcome>
    </SectionShell>
  );
}

function activityText(
  t: Translate,
  item: HomeActivity,
  number: (v: number, o?: Intl.NumberFormatOptions) => string
) {
  if (item.kind === 'rating')
    return t('home.activity.rating', {
      delta: number(item.delta, { signDisplay: 'exceptZero' }),
      level: number(item.level)
    });
  if (item.kind === 'adjustment')
    return t('home.activity.adjustment', { level: number(item.level) });
  return item.previous === null
    ? t('home.activity.rankNew', { position: number(item.position) })
    : t('home.activity.rank', { position: number(item.position), previous: number(item.previous) });
}

export function ActivitySection({ section }: { section: HomeSection<HomeActivity[]> }) {
  const { t, day, number } = useFormat();
  return (
    <SectionShell id="home-activity" title={t('home.activity.title')}>
      <Outcome section={section} empty="home.activity.empty">
        {(items) => (
          <ul {...stylex.props(s.list)}>
            {items.map((item) => (
              <li key={`${item.kind}-${item.at}`} {...stylex.props(s.card)}>
                <p {...stylex.props(s.body)}>{activityText(t, item, number)}</p>
                <p {...stylex.props(s.meta)}>
                  <time dateTime={item.at}>{day(item.at)}</time>
                  {' · '}
                  {t(
                    item.scope === 'global'
                      ? 'home.activity.scopeGlobal'
                      : 'home.activity.scopeCommunity'
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Outcome>
    </SectionShell>
  );
}
