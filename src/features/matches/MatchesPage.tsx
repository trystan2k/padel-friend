import * as stylex from '@stylexjs/stylex';
import { Link, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listMatchEvents } from './matches.functions';
import type { MatchEventListItem } from './match-model';
import { MatchCard } from './MatchCard';
import { matchesStyles as s } from './matches.styles';

export type MatchEntry = 'available' | 'my' | 'past';
export function MatchesPage({
  entry,
  initialItems = [],
  initialCursor = null,
  initialError = false
}: {
  entry: MatchEntry;
  initialItems?: MatchEventListItem[];
  initialCursor?: string | null;
  initialError?: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);
  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    setError(false);
    try {
      const result = await listMatchEvents({ data: { entry, cursor, limit: 20 } });
      setItems((previous) => [...previous, ...result.items]);
      setCursor(result.next_cursor);
      setOffline(false);
    } catch {
      setError(true);
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
        <h1>{t('matches.title')}</h1>
        <p>{t('matches.subtitle')}</p>
      </header>
      <nav aria-label={t('matches.navigationLabel')} {...stylex.props(s.tabs)}>
        {(['available', 'my', 'past'] as const).map((tab) => (
          <Link
            key={tab}
            to={tabPaths[tab]}
            aria-current={entry === tab ? 'page' : undefined}
            {...stylex.props(s.link)}
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
      {!initialError && items.length === 0 && <p>{t(`matches.empty.${entry}`)}</p>}
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
