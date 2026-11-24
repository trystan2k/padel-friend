import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  HomeAction,
  HomeActivity,
  HomeMatchCard,
  HomeMatches,
  HomeSection
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
    zoned: (instant: string, timeZone: string) =>
      new Intl.DateTimeFormat(locale, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
        timeZone
      }).format(new Date(instant)),
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

function NextMatchCard({ event }: { event: HomeMatchCard }) {
  const { t, zoned } = useFormat();
  const headingId = `home-next-${event.event_id}`;
  return (
    <article aria-labelledby={headingId} {...stylex.props(s.nextCard)}>
      <div {...stylex.props(s.nextTop)}>
        <p {...stylex.props(s.nextTime)}>
          <time dateTime={event.starts_at}>{zoned(event.starts_at, event.timezone)}</time>
        </p>
        {event.competition_status === 'ranked' && (
          <span {...stylex.props(s.chip)}>
            <span aria-hidden="true">★</span>
            {t('matches.competition.ranked')}
          </span>
        )}
      </div>
      <h3 id={headingId} {...stylex.props(s.nextVenue)}>
        {event.venue_name}
      </h3>
      <p {...stylex.props(s.nextMeta)}>
        {event.community_name}
        {' · '}
        {t('home.nextMatch.playing', { count: event.playing_count })}
        {event.more_needed > 0 &&
          ` · ${t('home.nextMatch.moreNeeded', { count: event.more_needed })}`}
      </p>
      <Link
        to="/matches/$eventId"
        params={{ eventId: event.event_id }}
        aria-describedby={headingId}
        {...stylex.props(s.openButton)}
      >
        {t('home.nextMatch.open')}
      </Link>
    </article>
  );
}

/**
 * Open matches are the Matches list's own "available" entry, so Home keeps one pointer to it
 * instead of repeating the list.
 */
export function NextMatchSection({ section }: { section: HomeSection<HomeMatches> }) {
  const { t } = useFormat();
  return (
    <SectionShell id="home-next-match" title={t('home.nextMatch.title')}>
      <Outcome section={section} empty="home.nextMatch.empty">
        {({ next }) => (
          <>
            {next ? (
              <NextMatchCard event={next} />
            ) : (
              <p {...stylex.props(s.state)}>{t('home.nextMatch.empty')}</p>
            )}
            <Link to="/matches" {...stylex.props(s.link, s.statsLink)}>
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

const ACTION_GLYPH: Record<HomeAction['kind'], { glyph: string; amber: boolean }> = {
  result_review: { glyph: '✓', amber: true },
  reconfirmation: { glyph: '◷', amber: true },
  organizer_requests: { glyph: '+', amber: false },
  reserve_standby: { glyph: '…', amber: false }
};

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
            <ul {...stylex.props(s.attention)}>
              {items.map((item) => {
                const { glyph, amber } = ACTION_GLYPH[item.kind];
                return (
                  <li key={`${item.kind}-${item.event_id}`} {...stylex.props(s.attentionItem)}>
                    <Link
                      to="/matches/$eventId"
                      params={{ eventId: item.event_id }}
                      {...stylex.props(s.attentionLink)}
                    >
                      <span
                        aria-hidden="true"
                        {...stylex.props(s.glyph, amber ? s.glyphAmber : s.glyphGreen)}
                      >
                        {glyph}
                      </span>
                      <span {...stylex.props(s.rowText)}>
                        <span {...stylex.props(s.rowTitle)}>{actionText(t, item)}</span>
                        <span {...stylex.props(s.rowMeta)}>
                          {when(item.starts_at, item.timezone)}
                        </span>
                      </span>
                      <span aria-hidden="true" {...stylex.props(s.chevron)}>
                        ›
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
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
