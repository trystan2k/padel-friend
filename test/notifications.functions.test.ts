import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validate = (v: unknown) => v;
    const builder = {
      validator: (fn: (v: unknown) => unknown) => {
        validate = fn;
        return builder;
      },
      handler:
        (fn: (ctx: { data: unknown }) => unknown) =>
        (options: { data?: unknown } = {}) =>
          fn({ data: validate(options.data) })
    };
    return builder;
  }
}));
vi.mock('../src/features/auth/auth.server', () => ({
  requireAuthenticatedClient: async () => ({
    client: mocks.client,
    userId: '123e4567-e89b-12d3-a456-426614174000'
  })
}));
import {
  acceptMyNotificationInvitation,
  getMyNotificationPreferences,
  getMyNotificationTarget,
  getMyNotificationTargetV3,
  getMyUnreadNotificationCount,
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  saveMyNotificationPreferences
} from '../src/features/notifications/notifications.functions';
const id = '123e4567-e89b-12d3-a456-426614174000';
describe('notification server functions', () => {
  it('keeps category cursor queries ordered and unread counts whole-store', async () => {
    const databaseAsOf = '2026-10-16T12:34:56.000000+00:00';
    const query = {
      select: vi.fn<(...args: unknown[]) => unknown>(),
      lte: vi.fn<(...args: unknown[]) => unknown>(),
      eq: vi.fn<(...args: unknown[]) => unknown>(),
      or: vi.fn<(...args: unknown[]) => unknown>(),
      order: vi.fn<(...args: unknown[]) => unknown>(),
      limit: vi.fn<() => Promise<{ data: never[]; error: null }>>().mockResolvedValue({
        data: [],
        error: null
      })
    };
    query.select.mockReturnValue(query);
    query.lte.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.or.mockReturnValue(query);
    query.order.mockReturnValue(query);
    const from = vi.fn<(...args: unknown[]) => unknown>(() => query);
    const rpc = vi
      .fn<(...args: unknown[]) => Promise<{ data: unknown; error: null }>>()
      .mockImplementation(async (functionName) => ({
        data: functionName === 'get_my_notifications_as_of' ? databaseAsOf : 0,
        error: null
      }));
    mocks.client = { from, rpc };

    const cursor = { sequence: 12, createdAt: '2026-10-15T12:00:00.123456+00:00', id };
    await listMyNotifications({ data: { category: 'community', cursor, limit: 20 } });

    expect(rpc).toHaveBeenCalledWith('get_my_notifications_as_of');
    expect(from).toHaveBeenCalledWith('notifications');
    expect(query.select).toHaveBeenCalledWith(
      'id,kind,category,target_type,target_id,community_id,sequence,created_at,read_at'
    );
    expect(query.lte).toHaveBeenCalledWith('created_at', databaseAsOf);
    expect(query.eq.mock.calls).toEqual([['category', 'community']]);
    expect(query.order.mock.calls).toEqual([
      ['sequence', { ascending: false }],
      ['created_at', { ascending: false }],
      ['id', { ascending: false }]
    ]);
    expect(query.or).toHaveBeenCalledExactlyOnceWith(
      `sequence.lt.${cursor.sequence},and(sequence.eq.${cursor.sequence},created_at.lt.${cursor.createdAt}),and(sequence.eq.${cursor.sequence},created_at.eq.${cursor.createdAt},id.lt.${id})`
    );
    expect(query.limit).toHaveBeenCalledExactlyOnceWith(21);
    expect(rpc.mock.calls).toEqual([
      ['get_my_notifications_as_of'],
      ['count_my_unread_notifications']
    ]);

    query.eq.mockClear();
    query.or.mockClear();
    await listMyNotifications({ data: { category: 'all', limit: 20 } });
    expect(query.eq).not.toHaveBeenCalled();
    expect(query.or).not.toHaveBeenCalled();
  });

  it('batches result contexts and excludes event-ready alerts from match contexts', async () => {
    const eventId = '223e4567-e89b-12d3-a456-426614174001';
    const proposalId = '323e4567-e89b-12d3-a456-426614174002';
    const resultNotificationId = '423e4567-e89b-12d3-a456-426614174003';
    const readyNotificationId = '523e4567-e89b-12d3-a456-426614174004';
    const createdAt = '2026-10-16T12:00:00.000Z';
    const rows = [
      {
        id: resultNotificationId,
        kind: 'result_added',
        category: 'results',
        target_type: 'result_available',
        target_id: eventId,
        community_id: id,
        sequence: 2,
        created_at: createdAt,
        read_at: null
      },
      {
        id: readyNotificationId,
        kind: 'result_entry_ready',
        category: 'results',
        target_type: 'match_event',
        target_id: eventId,
        community_id: id,
        sequence: 1,
        created_at: createdAt,
        read_at: null
      }
    ];
    const query = {
      select: vi.fn<(...args: unknown[]) => unknown>(),
      lte: vi.fn<(...args: unknown[]) => unknown>(),
      eq: vi.fn<(...args: unknown[]) => unknown>(),
      or: vi.fn<(...args: unknown[]) => unknown>(),
      order: vi.fn<(...args: unknown[]) => unknown>(),
      limit: vi.fn<() => Promise<{ data: typeof rows; error: null }>>().mockResolvedValue({
        data: rows,
        error: null
      })
    };
    query.select.mockReturnValue(query);
    query.lte.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.or.mockReturnValue(query);
    query.order.mockReturnValue(query);
    const from = vi.fn<(...args: unknown[]) => unknown>(() => query);
    const resultContexts = [
      {
        notification_id: resultNotificationId,
        notification_kind: 'result_added',
        match_event_id: eventId,
        community_id: id,
        proposal_id: proposalId,
        proposal_version: 1,
        group_number: 1,
        proposal_status: 'pending',
        current_version: 1,
        current_status: 'pending',
        is_current: true,
        classification: 'team_a',
        score: '6–4',
        submitted_by_name: 'Ari',
        review_deadline_at: '2026-10-18T12:00:00.000Z',
        venue: 'Central Court',
        starts_at: createdAt,
        timezone: 'UTC',
        entry_ready: false
      },
      {
        notification_id: readyNotificationId,
        notification_kind: 'result_entry_ready',
        match_event_id: eventId,
        community_id: id,
        proposal_id: null,
        proposal_version: null,
        group_number: null,
        proposal_status: null,
        current_version: null,
        current_status: null,
        is_current: true,
        classification: null,
        score: null,
        submitted_by_name: null,
        review_deadline_at: null,
        venue: 'Central Court',
        starts_at: createdAt,
        timezone: 'UTC',
        entry_ready: true
      }
    ];
    const rpc = vi
      .fn<(...args: unknown[]) => Promise<{ data: unknown; error: null }>>()
      .mockImplementation(async (functionName) => ({
        data:
          functionName === 'get_my_notifications_as_of'
            ? createdAt
            : functionName === 'get_my_result_notification_contexts'
              ? resultContexts
              : 0,
        error: null
      }));
    mocks.client = { from, rpc };

    const page = await listMyNotifications({ data: { category: 'all', limit: 20 } });

    expect(rpc).toHaveBeenCalledWith('get_my_result_notification_contexts', {
      p_notification_ids: [resultNotificationId, readyNotificationId]
    });
    expect(rpc).not.toHaveBeenCalledWith('get_my_match_notification_contexts', expect.anything());
    expect(page.items.map((item) => item.resultContext?.entry_ready)).toEqual([false, true]);
    expect(page.items.every((item) => !item.matchContext)).toBe(true);
  });

  it('uses the whole-store count RPC after authenticated access', async () => {
    const rpc = vi
      .fn<(...args: unknown[]) => Promise<{ data: number; error: null }>>()
      .mockResolvedValue({ data: 4, error: null });
    mocks.client = { rpc };
    await expect(getMyUnreadNotificationCount()).resolves.toBe(4);
    expect(rpc).toHaveBeenCalledWith('count_my_unread_notifications');
  });
  it('keeps mutation contracts recipient-free and validates unexpected data', async () => {
    const rpc = vi
      .fn<(...args: unknown[]) => Promise<{ data: null; error: null }>>()
      .mockResolvedValue({ data: null, error: null });
    mocks.client = { rpc };
    await markNotificationRead({ data: { notificationId: id } });
    expect(rpc).toHaveBeenCalledWith('mark_notification_read', { p_notification_id: id });
    expect(() => markNotificationRead({ data: { notificationId: id, recipientId: id } })).toThrow(
      'INVALID_COMMUNITY_INPUT'
    );
    expect([
      listMyNotifications,
      markAllNotificationsRead,
      getMyNotificationPreferences,
      saveMyNotificationPreferences,
      getMyNotificationTarget,
      acceptMyNotificationInvitation
    ]).toHaveLength(6);
  });

  it('preserves the legacy v1 community target resolver contract', async () => {
    const communityTarget = {
      target_status: 'invitation_available',
      community_id: id,
      community_name: 'Padel Norte',
      invitation_id: '223e4567-e89b-12d3-a456-426614174001',
      membership_status: null
    };
    const single = vi.fn<() => Promise<{ data: typeof communityTarget; error: null }>>();
    single.mockResolvedValue({ data: communityTarget, error: null });
    const rpc = vi.fn<(...args: unknown[]) => { single: typeof single }>(() => ({ single }));
    mocks.client = { rpc };

    await expect(getMyNotificationTarget({ data: { notificationId: id } })).resolves.toEqual(
      communityTarget
    );
    expect(rpc).toHaveBeenCalledWith('get_my_notification_target', { p_notification_id: id });
    expect(single).toHaveBeenCalledTimes(1);
  });

  it('resolves v3 targets with validated result context', async () => {
    const eventId = '223e4567-e89b-12d3-a456-426614174001';
    const proposalId = '323e4567-e89b-12d3-a456-426614174002';
    const target = {
      target_status: 'result_available',
      community_id: id,
      community_name: null,
      invitation_id: null,
      membership_status: null,
      match_event_id: eventId,
      match_available: true,
      kind: 'result_added',
      created_at: '2026-10-16T12:00:00.000Z',
      result_context: {
        notification_id: id,
        notification_kind: 'result_added',
        match_event_id: eventId,
        community_id: id,
        proposal_id: proposalId,
        proposal_version: 1,
        group_number: 1,
        proposal_status: 'pending',
        current_version: 1,
        current_status: 'pending',
        is_current: true,
        classification: 'team_a',
        score: '6–4',
        submitted_by_name: 'Ari',
        review_deadline_at: '2026-10-18T12:00:00.000Z',
        venue: 'Central Court',
        starts_at: '2026-10-16T12:00:00.000Z',
        timezone: 'UTC',
        entry_ready: false
      }
    };
    const single = vi.fn<() => Promise<{ data: typeof target; error: null }>>();
    single.mockResolvedValue({ data: target, error: null });
    const rpc = vi.fn<(...args: unknown[]) => { single: typeof single }>(() => ({ single }));
    mocks.client = { rpc };

    await expect(getMyNotificationTargetV3({ data: { notificationId: id } })).resolves.toEqual(
      target
    );
    expect(rpc).toHaveBeenCalledWith('get_my_notification_target_v3', {
      p_notification_id: id
    });
  });

  it('round-trips a raw Postgres cursor from one list page into the next request', async () => {
    const cursorId = '223e4567-e89b-12d3-a456-426614174001';
    const newerTimestamp = '2026-10-15T12:00:00.123456+00:00';
    const olderTimestamp = '2026-10-15T11:59:59.999999+00:00';
    const rows: {
      id: string;
      kind: string;
      category: string;
      sequence: number;
      created_at: string;
      read_at: null;
    }[][] = [
      [
        {
          id: cursorId,
          kind: 'community_invitation',
          category: 'community',
          sequence: 3,
          created_at: newerTimestamp,
          read_at: null
        },
        {
          id: '323e4567-e89b-12d3-a456-426614174002',
          kind: 'community_invitation',
          category: 'community',
          sequence: 2,
          created_at: olderTimestamp,
          read_at: null
        }
      ],
      [
        {
          id: '423e4567-e89b-12d3-a456-426614174003',
          kind: 'community_membership_approved',
          category: 'community',
          sequence: 1,
          created_at: olderTimestamp,
          read_at: null
        }
      ]
    ];
    let page = 0;
    const query = {
      select: vi.fn<(...args: unknown[]) => unknown>(),
      lte: vi.fn<(...args: unknown[]) => unknown>(),
      eq: vi.fn<(...args: unknown[]) => unknown>(),
      or: vi.fn<(...args: unknown[]) => unknown>(),
      order: vi.fn<(...args: unknown[]) => unknown>(),
      limit: vi.fn<() => Promise<{ data: (typeof rows)[number]; error: null }>>(async () => ({
        data: rows[page++] ?? [],
        error: null
      }))
    };
    query.select.mockReturnValue(query);
    query.lte.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.or.mockReturnValue(query);
    query.order.mockReturnValue(query);
    const from = vi.fn<(...args: unknown[]) => unknown>(() => query);
    const rpc = vi
      .fn<(...args: unknown[]) => Promise<{ data: unknown; error: null }>>()
      .mockImplementation(async (functionName) => ({
        data: functionName === 'get_my_notifications_as_of' ? '2026-10-16T12:34:56.000Z' : 2,
        error: null
      }));
    mocks.client = { from, rpc };

    const firstPage = await listMyNotifications({ data: { limit: 1 } });
    expect(firstPage.items[0]?.created_at).toBe(newerTimestamp);
    expect(firstPage.nextCursor).toEqual({
      sequence: 3,
      createdAt: newerTimestamp,
      id: cursorId
    });

    const nextPage = await listMyNotifications({
      data: { limit: 1, cursor: firstPage.nextCursor ?? undefined }
    });
    expect(query.or).toHaveBeenCalledWith(
      `sequence.lt.3,and(sequence.eq.3,created_at.lt.${newerTimestamp}),and(sequence.eq.3,created_at.eq.${newerTimestamp},id.lt.${cursorId})`
    );
    expect(nextPage.items[0]?.created_at).toBe(olderTimestamp);
  });

  it('returns missing-row defaults and selects the authenticated preference row', async () => {
    const maybeSingle = vi
      .fn<() => Promise<{ data: null; error: null }>>()
      .mockResolvedValue({ data: null, error: null });
    const eq = vi.fn<(...args: unknown[]) => { maybeSingle: typeof maybeSingle }>(() => ({
      maybeSingle
    }));
    const select = vi.fn<(...args: unknown[]) => { eq: typeof eq }>(() => ({ eq }));
    const from = vi.fn<(...args: unknown[]) => { select: typeof select }>(() => ({ select }));
    mocks.client = { from };
    await expect(getMyNotificationPreferences()).resolves.toBeNull();
    expect(mocks.client).toBeTruthy();
    expect(select).toHaveBeenCalledWith(
      'push_enabled,push_community,push_matches,push_results,push_rankings,push_leagues,critical_in_app_enabled,updated_at'
    );
    expect(eq).toHaveBeenCalledWith('user_id', id);
  });

  it('returns the stored preference row unchanged', async () => {
    const row = {
      push_enabled: true,
      push_community: false,
      push_matches: true,
      push_results: false,
      push_rankings: true,
      push_leagues: false,
      critical_in_app_enabled: true,
      updated_at: '2026-10-15T00:00:00.000Z'
    };
    const maybeSingle = vi
      .fn<() => Promise<{ data: typeof row; error: null }>>()
      .mockResolvedValue({ data: row, error: null });
    const eq = vi.fn<(...args: unknown[]) => { maybeSingle: typeof maybeSingle }>(() => ({
      maybeSingle
    }));
    const select = vi.fn<(...args: unknown[]) => { eq: typeof eq }>(() => ({ eq }));
    const from = vi.fn<(...args: unknown[]) => { select: typeof select }>(() => ({ select }));
    mocks.client = { from };
    await expect(getMyNotificationPreferences()).resolves.toEqual(row);
  });

  it('forwards exactly six validated booleans to the preferences RPC', async () => {
    const rpc = vi
      .fn<(...args: unknown[]) => Promise<{ data: { push_enabled: boolean }; error: null }>>()
      .mockResolvedValue({ data: { push_enabled: true }, error: null });
    mocks.client = { rpc };
    const values = {
      push_enabled: true,
      push_community: false,
      push_matches: true,
      push_results: false,
      push_rankings: true,
      push_leagues: false
    };
    await saveMyNotificationPreferences({ data: values });
    expect(rpc).toHaveBeenCalledWith('set_my_notification_preferences', {
      p_push_enabled: true,
      p_push_community: false,
      p_push_matches: true,
      p_push_results: false,
      p_push_rankings: true,
      p_push_leagues: false
    });
    expect(() =>
      saveMyNotificationPreferences({ data: { ...values, critical_in_app_enabled: false } })
    ).toThrow('INVALID_COMMUNITY_INPUT');
  });
});
