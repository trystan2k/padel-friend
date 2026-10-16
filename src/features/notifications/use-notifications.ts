import { useEffect, useEffectEvent, useRef, useState } from 'react';
import {
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead
} from './notifications.functions';
import type { NotificationCategory, NotificationDto, NotificationPage } from './notification-model';

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
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isCurrentCategory = useEffectEvent(
    (requestedCategory: NotificationCategory) => requestedCategory === category
  );

  const refresh = async (append = false) => {
    // Read liveness from the ref: the online-event handler schedules this refresh before the
    // setOnline re-render, so a captured state would still hold the stale offline value.
    if (!onlineRef.current || (typeof navigator !== 'undefined' && !navigator.onLine)) {
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
    setLoading(true);
    try {
      const response: unknown = await listMyNotifications({
        data: {
          category: requestedCategory,
          ...(append && cursor ? { cursor } : {}),
          limit: 20
        }
      });
      if (!isNotificationPage(response)) throw new Error('INVALID_NOTIFICATION_PAGE');
      const page = response;
      if (token !== generation.current || !mounted.current || !isCurrentCategory(requestedCategory))
        return;
      setRows((current) =>
        append
          ? [...current, ...page.items.filter((item) => !current.some((row) => row.id === item.id))]
          : page.items
      );
      setUnreadCount(page.unreadCount);
      setCursor(page.nextCursor);
      setAsOf(page.asOf);
      setLoadedCategory(requestedCategory);
      setError(false);
    } catch {
      if (token === generation.current && mounted.current) setError(true);
    } finally {
      pending.current = false;
      if (token === generation.current && mounted.current) setLoading(false);
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
  const scheduleRefresh = useEffectEvent(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(refreshLatest, 30);
  });

  useEffect(() => {
    mounted.current = true;
    const setConnection = () => {
      onlineRef.current = typeof navigator === 'undefined' || navigator.onLine;
      setOnline(onlineRef.current);
    };
    const onOnline = () => {
      setConnection();
      scheduleRefresh();
    };
    const onFocus = () => scheduleRefresh();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') scheduleRefresh();
    };

    queueMicrotask(() => {
      if (mounted.current) setConnection();
    });
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', setConnection);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      mounted.current = false;
      generation.current += 1;
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', setConnection);
      document.removeEventListener('visibilitychange', onVisibilityChange);
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
