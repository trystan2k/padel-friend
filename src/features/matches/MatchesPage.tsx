import * as stylex from '@stylexjs/stylex';
import { Link, useRouter } from '@tanstack/react-router';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { rootStyles } from '../../root.styles';
import { listMatchEvents } from './matches.functions';
import type { MatchEventListItem } from './match-model';
import { MatchCard } from './MatchCard';
import { matchListStyles as s } from './match-list.styles';

type DayGroup = { key: string; label: string; items: MatchEventListItem[] };

/** Consecutive events on the same calendar day (in the event's own timezone) share one heading. */
function groupByDay(items: MatchEventListItem[], locale: string): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const event of items) {
    const key = new Intl.DateTimeFormat('en-CA', { timeZone: event.timezone }).format(
      new Date(event.starts_at)
    );
    const last = groups.at(-1);
    if (last?.key === key) last.items.push(event);
    else
      groups.push({
        key,
        label: new Intl.DateTimeFormat(locale, {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          timeZone: event.timezone
        }).format(new Date(event.starts_at)),
        items: [event]
      });
  }
  return groups;
}

export type MatchEntry = 'available' | 'my' | 'past';
const EMPTY_ITEMS: MatchEventListItem[] = [];
export function MatchesPage({
  entry,
  initialItems = EMPTY_ITEMS,
  initialCursor = null,
  initialAsOf = null,
  initialError = false,
  history
}: {
  entry: MatchEntry;
  initialItems?: MatchEventListItem[];
  initialCursor?: string | null;
  initialAsOf?: string | null;
  initialError?: boolean;
  history?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [listing, setListing] = useState({
    sourceItems: initialItems,
    sourceCursor: initialCursor,
    sourceAsOf: initialAsOf,
    sourceError: initialError,
    items: initialItems,
    cursor: initialCursor,
    asOf: initialAsOf,
    error: initialError,
    generation: 0
  });
  if (
    listing.sourceItems !== initialItems ||
    listing.sourceCursor !== initialCursor ||
    listing.sourceAsOf !== initialAsOf ||
    listing.sourceError !== initialError
  ) {
    setListing({
      sourceItems: initialItems,
      sourceCursor: initialCursor,
      sourceAsOf: initialAsOf,
      sourceError: initialError,
      items: initialItems,
      cursor: initialCursor,
      asOf: initialAsOf,
      error: initialError,
      generation: listing.generation + 1
    });
  }
  const { items, cursor, error } = listing;
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const online = () => setOffline(false);
    const offlineEvent = () => setOffline(true);
    if (typeof window === 'undefined') return undefined;
    window.addEventListener('online', online);
    window.addEventListener('offline', offlineEvent);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offlineEvent);
    };
  }, []);
  async function loadMore() {
    if (!cursor || loading || (offline && typeof navigator !== 'undefined' && !navigator.onLine))
      return;
    const version = listing.generation;
    setLoading(true);
    setListing((previous) => ({ ...previous, error: false }));
    try {
      const result = await listMatchEvents({
        data: { entry, cursor, limit: 20, as_of: listing.asOf }
      });
      setListing((previous) =>
        previous.generation === version
          ? {
              ...previous,
              items: [...previous.items, ...result.items],
              cursor: result.next_cursor
            }
          : previous
      );
      setOffline(false);
    } catch {
      setListing((previous) =>
        previous.generation === version ? { ...previous, error: true } : previous
      );
      setOffline(typeof navigator !== 'undefined' && !navigator.onLine);
    } finally {
      setLoading(false);
    }
  }
  const tabPaths: Record<MatchEntry, '/matches' | '/matches/my' | '/matches/past'> = {
    available: '/matches',
    my: '/matches/my',
    past: '/matches/past'
  };
  // Past keeps one flat history; Available and My group by day. A day that may still gain events on
  // the next page shows no count, so a partial total is never presented as final.
  const groups = entry === 'past' ? null : groupByDay(items, i18n.language);
  return (
    <main {...stylex.props(s.page)}>
      <header {...stylex.props(s.header, rootStyles.pageHeader)}>
        <h1 {...stylex.props(s.title)}>{t('matches.title')}</h1>
        <Link to="/matches/create" {...stylex.props(s.newAction)}>
          <span aria-hidden="true">+</span> {t('matches.new')}
        </Link>
      </header>
      <nav aria-label={t('matches.navigationLabel')} {...stylex.props(s.segments)}>
        {(['available', 'my', 'past'] as const).map((tab) => (
          <Link
            key={tab}
            to={tabPaths[tab]}
            activeOptions={{ exact: true }}
            aria-current={entry === tab ? 'page' : undefined}
            {...stylex.props(s.segment, entry === tab && s.segmentActive)}
          >
            {t(`matches.tabs.${tab}`)}
          </Link>
        ))}
      </nav>
      {initialError && (
        <section role="alert" {...stylex.props(s.alert)}>
          <p>{t('matches.error')}</p>
          <Button variant="secondary" onClick={() => void router.invalidate()}>
            {t('matches.retry')}
          </Button>
        </section>
      )}
      {history}
      {offline && <output>{t('matches.offline')}</output>}
      {error && !initialError && !offline && (
        <section role="alert" {...stylex.props(s.alert)}>
          <p>{t('matches.error')}</p>
          <Button variant="secondary" onClick={() => void loadMore()}>
            {t('matches.retry')}
          </Button>
        </section>
      )}
      {!initialError && items.length === 0 && (
        <section {...stylex.props(s.empty)}>
          <span aria-hidden="true" {...stylex.props(s.emptyIcon)}>
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-4-4" />
            </svg>
          </span>
          <p {...stylex.props(s.emptyTitle)}>{t(`matches.empty.${entry}`)}</p>
          <p {...stylex.props(s.meta)}>{t(`matches.emptyHint.${entry}`)}</p>
          <Link to="/matches/create" {...stylex.props(s.primary)}>
            {t('matches.create')}
          </Link>
        </section>
      )}
      <section aria-label={t(`matches.tabs.${entry}`)} {...stylex.props(s.list)}>
        {groups
          ? groups.map((group, index) => {
              // Chronological order across timezones can repeat a local date in nonconsecutive groups.
              const groupId = `${index}-${group.key}`;
              const headingId = `matches-day-${groupId}`;
              const open = cursor !== null && index === groups.length - 1;
              return (
                <section key={groupId} aria-labelledby={headingId} {...stylex.props(s.group)}>
                  <div {...stylex.props(s.day)}>
                    <h2 id={headingId} {...stylex.props(s.dayTitle)}>
                      {group.label}
                    </h2>
                    {!open && (
                      <span {...stylex.props(s.dayCount)}>
                        {t('matches.group.count', { count: group.items.length })}
                      </span>
                    )}
                  </div>
                  {group.items.map((event) => (
                    <MatchCard key={event.event_id} event={event} grouped />
                  ))}
                </section>
              );
            })
          : items.map((event) => <MatchCard key={event.event_id} event={event} />)}
      </section>
      {cursor && (
        <Button variant="secondary" disabled={loading || offline} onClick={() => void loadMore()}>
          {loading ? t('matches.loading') : t('matches.loadMore')}
        </Button>
      )}
    </main>
  );
}
