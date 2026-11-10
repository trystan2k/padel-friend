import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useAuthoritativeRefresh } from '../../lib/use-authoritative-refresh';
import {
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead
} from './notifications.functions';
import type { NotificationCategory, NotificationDto, NotificationPage } from './notification-model';

// Bounds the cursor walk of a background refresh when a burst outgrows the loaded window.
const MAX_BURST_PAGES = 10;
const notificationCategories = new Set(['community', 'matches', 'results', 'rankings', 'leagues']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNotificationDto(value: unknown): value is NotificationDto {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.kind === 'string' &&
    typeof value.category === 'string' &&
    notificationCategories.has(value.category) &&
    typeof value.created_at === 'string' &&
    (typeof value.read_at === 'string' || value.read_at === null)
  );
}

function isNotificationPage(value: unknown): value is NotificationPage {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    !value.items.every(isNotificationDto) ||
    typeof value.unreadCount !== 'number' ||
    !Number.isFinite(value.unreadCount) ||
    typeof value.asOf !== 'string'
  )
    return false;

  return (
    value.nextCursor === null ||
    (isRecord(value.nextCursor) &&
      typeof value.nextCursor.sequence === 'number' &&
      Number.isSafeInteger(value.nextCursor.sequence) &&
      value.nextCursor.sequence > 0 &&
      typeof value.nextCursor.createdAt === 'string' &&
      typeof value.nextCursor.id === 'string')
  );
}

export function useNotifications(
  initial: NotificationPage,
  category: NotificationCategory = 'all',
  loadOnMount = false
) {
  const [rows, setRows] = useState<NotificationDto[]>(initial.items);
  const [unreadCount, setUnreadCount] = useState<number | null>(initial.unreadCount);
  const [loading, setLoading] = useState(loadOnMount);
  const [error, setError] = useState(false);
  const [mutationError, setMutationError] = useState(false);
  const [online, setOnline] = useState(true);
  const [mutating, setMutating] = useState(false);
  const onlineRef = useRef(true);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [asOf, setAsOf] = useState(initial.asOf);
  const [loadedCategory, setLoadedCategory] = useState(category);
  const previousCategory = useRef(category);
  const generation = useRef(0);
  const pending = useRef(false);
  const trailing = useRef(false);
  const mutationPending = useRef(false);
  const mounted = useRef(false);
  const isCurrentCategory = useEffectEvent(
    (requestedCategory: NotificationCategory) => requestedCategory === category
  );

  // `silent` is the background cadence read: no loading flash or error banner, and it merges into
  // the rows already shown (keeping loaded older pages) instead of resetting pagination.
  const refresh = async (append = false, silent = false) => {
    // Read liveness from the ref: the online-event handler schedules this refresh before the
    // setOnline re-render, so a captured state would still hold the stale offline value.
    // The background cadence trusts navigator alone (its own online listener may run first).
    if (
      (!silent && !onlineRef.current) ||
      (typeof navigator !== 'undefined' && !navigator.onLine)
    ) {
      setLoading(false);
      return;
    }
    if (pending.current || mutationPending.current) {
      trailing.current = true;
      return;
    }

    pending.current = true;
    trailing.current = false;
    const token = ++generation.current;
    const requestedCategory = category;
    if (!silent) setLoading(true);
    try {
      const response: unknown = await listMyNotifications({
        data: {
          category: requestedCategory,
          ...(append && cursor ? { cursor } : {}),
          limit: 20
        }
      });
      if (!isNotificationPage(response)) throw new Error('INVALID_NOTIFICATION_PAGE');
      let page = response;
      if (token !== generation.current || !mounted.current || !isCurrentCategory(requestedCategory))
        return;
      // A burst larger than one page leaves no overlap between the newest page and the rows already
      // loaded, so the older retained rows would sit past a gap. Follow the cursors until the
      // authoritative prefix reaches a loaded row; if it never does, pagination restarts from it.
      const loadedIds = new Set(rows.map((row) => row.id));
      const overlaps = (items: NotificationDto[]) => items.some((item) => loadedIds.has(item.id));
      let connected = !silent || append || loadedIds.size === 0 || overlaps(page.items);
      for (
        let hops = 0;
        !connected && page.nextCursor !== null && hops < MAX_BURST_PAGES;
        hops += 1
      ) {
        const nextResponse: unknown = await listMyNotifications({
          data: { category: requestedCategory, cursor: page.nextCursor, limit: 20 }
        });
        if (!isNotificationPage(nextResponse)) throw new Error('INVALID_NOTIFICATION_PAGE');
        if (
          token !== generation.current ||
          !mounted.current ||
          !isCurrentCategory(requestedCategory)
        )
          return;
        const seen = new Set(page.items.map((item) => item.id));
        page = {
          ...page,
          items: [...page.items, ...nextResponse.items.filter((item) => !seen.has(item.id))],
          nextCursor: nextResponse.nextCursor
        };
        connected = overlaps(nextResponse.items);
      }
      // The page is the authoritative newest prefix (ordered by sequence, created_at, id), so any
      // loaded row it does not contain sits past its boundary. Ordering by created_at alone would
      // drop rows that share the boundary timestamp.
      const olderRows = (current: NotificationDto[]) => {
        if (page.nextCursor === null) return [];
        const ids = new Set(page.items.map((item) => item.id));
        return current.filter((row) => !ids.has(row.id));
      };
      const keepsOlderRows =
        silent && (connected || page.nextCursor === null) && olderRows(rows).length > 0;
      setRows((current) => {
        if (append)
          return [
            ...current,
            ...page.items.filter((item) => !current.some((row) => row.id === item.id))
          ];
        return silent && (connected || page.nextCursor === null)
          ? [...page.items, ...olderRows(current)]
          : page.items;
      });
      setUnreadCount(page.unreadCount);
      if (!keepsOlderRows) setCursor(page.nextCursor);
      setAsOf(page.asOf);
      setLoadedCategory(requestedCategory);
      setError(false);
    } catch (caught) {
      if (silent) throw caught;
      if (token === generation.current && mounted.current) setError(true);
    } finally {
      pending.current = false;
      if (!silent && token === generation.current && mounted.current) setLoading(false);
      if (trailing.current && mounted.current && !mutationPending.current) {
        trailing.current = false;
        queueMicrotask(refreshLatest);
      }
    }
  };

  const refreshLatest = useEffectEvent(() => {
    void refresh();
  });
  const refreshOnMount = useEffectEvent(() => {
    refreshLatest();
  });
  const refreshOnCategoryChange = useEffectEvent(() => {
    generation.current += 1;
    trailing.current = false;
    setRows([]);
    setCursor(null);
    setLoadedCategory(category);
    setError(false);
    refreshLatest();
  });
  const refreshInBackground = useEffectEvent(async () => {
    await refresh(false, true);
  });
  useAuthoritativeRefresh({
    scope: `notifications:${category}`,
    refresh: refreshInBackground
  });

  useEffect(() => {
    mounted.current = true;
    const setConnection = () => {
      onlineRef.current = typeof navigator === 'undefined' || navigator.onLine;
      setOnline(onlineRef.current);
    };

    queueMicrotask(() => {
      if (mounted.current) setConnection();
    });
    window.addEventListener('online', setConnection);
    window.addEventListener('offline', setConnection);
    return () => {
      mounted.current = false;
      generation.current += 1;
      window.removeEventListener('online', setConnection);
      window.removeEventListener('offline', setConnection);
    };
  }, []);

  useEffect(() => {
    if (loadOnMount) refreshOnMount();
  }, [loadOnMount]);

  useEffect(() => {
    if (previousCategory.current === category) return;
    previousCategory.current = category;
    refreshOnCategoryChange();
  }, [category]);

  const markRead = async (id: string) => {
    if (!online || mutationPending.current) return;
    const row = rows.find((item) => item.id === id);
    if (!row || row.read_at) return;

    mutationPending.current = true;
    const token = ++generation.current;
    const patch = new Date().toISOString();
    setMutating(true);
    setRows((current) =>
      current.map((item) => (item.id === id ? { ...item, read_at: patch } : item))
    );
    setUnreadCount((count) => (count === null ? null : Math.max(0, count - 1)));
    try {
      await markNotificationRead({ data: { notificationId: id } });
      setMutationError(false);
    } catch {
      if (mounted.current) {
        setRows((current) =>
          current.map((item) =>
            item.id === id && item.read_at === patch ? { ...item, read_at: null } : item
          )
        );
        if (generation.current === token) {
          setUnreadCount((count) => (count === null ? null : count + 1));
        }
        setMutationError(true);
      }
    } finally {
      mutationPending.current = false;
      if (mounted.current) {
        setMutating(false);
        refreshLatest();
      }
    }
  };

  const markAll = async () => {
    if (!online || mutationPending.current) return;

    mutationPending.current = true;
    generation.current += 1;
    const cutoff = asOf;
    const patchedIds = rows
      .filter((row) => !row.read_at && row.created_at <= cutoff)
      .map((row) => row.id);
    setMutating(true);
    setRows((current) =>
      current.map((row) =>
        patchedIds.includes(row.id) && !row.read_at ? { ...row, read_at: cutoff } : row
      )
    );
    try {
      await markAllNotificationsRead({ data: { before: cutoff } });
      setMutationError(false);
    } catch {
      if (mounted.current) {
        setRows((current) =>
          current.map((row) =>
            patchedIds.includes(row.id) && row.read_at === cutoff ? { ...row, read_at: null } : row
          )
        );
        setMutationError(true);
      }
    } finally {
      mutationPending.current = false;
      if (mounted.current) {
        setMutating(false);
        refreshLatest();
      }
    }
  };

  return {
    rows: loadedCategory === category ? rows : [],
    unreadCount,
    loading,
    error,
    mutationError,
    online,
    mutating,
    cursor,
    asOf,
    refresh,
    loadMore: () => refresh(true),
    markRead,
    markAll
  };
}
