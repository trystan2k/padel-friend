import { useEffect, useEffectEvent, useRef, useState } from 'react';
import {
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead
} from './notifications.functions';
import type { NotificationCategory, NotificationDto, NotificationPage } from './notification-model';

export function useNotifications(
  initial: NotificationPage,
  category: NotificationCategory = 'all',
  loadOnMount = false
) {
  const [rows, setRows] = useState<NotificationDto[]>(initial.items);
  const [unreadCount, setUnreadCount] = useState<number | null>(initial.unreadCount);
  const [loading, setLoading] = useState(loadOnMount);
  const [error, setError] = useState(false);
  const [online, setOnline] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [asOf, setAsOf] = useState(initial.asOf);
  const generation = useRef(0);
  const pending = useRef(false);
  const trailing = useRef(false);
  const mutationPending = useRef(false);
  const mounted = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = async (append = false) => {
    if (!online || (typeof navigator !== 'undefined' && !navigator.onLine)) {
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
    setLoading(true);
    try {
      const page = await listMyNotifications({
        data: { category, ...(append && cursor ? { cursor } : {}), limit: 20 }
      });
      if (token !== generation.current || !mounted.current) return;
      setRows((current) =>
        append
          ? [...current, ...page.items.filter((item) => !current.some((row) => row.id === item.id))]
          : page.items
      );
      setUnreadCount(page.unreadCount);
      setCursor(page.nextCursor);
      setAsOf(page.asOf);
      setError(false);
    } catch {
      if (token === generation.current && mounted.current) setError(true);
    } finally {
      pending.current = false;
      if (token === generation.current && mounted.current) setLoading(false);
      if (trailing.current && mounted.current && !mutationPending.current) {
        trailing.current = false;
        queueMicrotask(() => void refresh());
      }
    }
  };

  const refreshOnMount = useEffectEvent(() => {
    void refresh();
  });
  const scheduleRefresh = useEffectEvent(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void refresh(), 30);
  });

  useEffect(() => {
    mounted.current = true;
    const setConnection = () => setOnline(typeof navigator === 'undefined' || navigator.onLine);
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
        setError(true);
      }
    } finally {
      mutationPending.current = false;
      if (mounted.current) {
        setMutating(false);
        void refresh();
      }
    }
  };

  const markAll = async () => {
    if (!online || mutationPending.current) return;

    mutationPending.current = true;
    const token = ++generation.current;
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
    } catch {
      if (mounted.current) {
        setRows((current) =>
          current.map((row) =>
            patchedIds.includes(row.id) && row.read_at === cutoff ? { ...row, read_at: null } : row
          )
        );
        if (generation.current === token) setError(true);
      }
    } finally {
      mutationPending.current = false;
      if (mounted.current) {
        setMutating(false);
        void refresh();
      }
    }
  };

  return {
    rows,
    unreadCount,
    loading,
    error,
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
