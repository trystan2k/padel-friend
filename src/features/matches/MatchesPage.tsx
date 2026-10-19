import * as stylex from '@stylexjs/stylex';
import { Link, useRouter } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listMatchEvents } from './matches.functions';
import type { MatchEventListItem } from './match-model';
import { MatchCard } from './MatchCard';
import { matchesStyles as s } from './matches.styles';

export type MatchEntry = 'available' | 'my' | 'past';
const EMPTY_ITEMS: MatchEventListItem[] = [];
export function MatchesPage({
  entry,
  initialItems = EMPTY_ITEMS,
  initialCursor = null,
  initialAsOf = null,
  initialError = false
}: {
  entry: MatchEntry;
  initialItems?: MatchEventListItem[];
  initialCursor?: string | null;
  initialAsOf?: string | null;
  initialError?: boolean;
}) {
  const { t } = useTranslation();
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
  return (
    <main {...stylex.props(s.page)}>
      <header {...stylex.props(s.heading)}>
        <h1 {...stylex.props(s.title)}>{t('matches.title')}</h1>
        <p>{t('matches.subtitle')}</p>
        <Link to="/matches/create" {...stylex.props(s.primaryAction)}>
          {t('matches.create')}
        </Link>
      </header>
      <nav aria-label={t('matches.navigationLabel')} {...stylex.props(s.tabs)}>
        {(['available', 'my', 'past'] as const).map((tab) => (
          <Link
            key={tab}
            to={tabPaths[tab]}
            activeOptions={{ exact: true }}
            aria-current={entry === tab ? 'page' : undefined}
            {...stylex.props(s.link, entry === tab && s.activeLink)}
          >
            {t(`matches.tabs.${tab}`)}
          </Link>
        ))}
      </nav>
      {initialError && (
        <section role="alert">
          <p>{t('matches.error')}</p>
          <button {...stylex.props(s.button)} onClick={() => void router.invalidate()}>
            {t('matches.retry')}
          </button>
        </section>
      )}
      {offline && <output>{t('matches.offline')}</output>}
      {error && !initialError && !offline && (
        <section role="alert">
          <p>{t('matches.error')}</p>
          <button {...stylex.props(s.button)} onClick={() => void loadMore()}>
            {t('matches.retry')}
          </button>
        </section>
      )}
      {!initialError && items.length === 0 && (
        <section {...stylex.props(s.empty)}>
          <p>{t(`matches.empty.${entry}`)}</p>
          <Link to="/matches/create" {...stylex.props(s.primaryAction)}>
            {t('matches.create')}
          </Link>
        </section>
      )}
      <section aria-label={t(`matches.tabs.${entry}`)} {...stylex.props(s.list)}>
        {items.map((event) => (
          <MatchCard key={event.event_id} event={event} />
        ))}
      </section>
      {cursor && (
        <button
          type="button"
          disabled={loading || offline}
          onClick={() => void loadMore()}
          {...stylex.props(s.button)}
        >
          {loading ? t('matches.loading') : t('matches.loadMore')}
        </button>
      )}
    </main>
  );
}
