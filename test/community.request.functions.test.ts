import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validate = (value: unknown) => value;
    const builder = {
      validator: (fn: (value: unknown) => unknown) => {
        validate = fn;
        return builder;
      },
      handler: (fn: (context: { data: unknown }) => unknown) => (options: { data: unknown }) =>
        fn({ data: validate(options.data) })
    };
    return builder;
  }
}));
vi.mock('../src/features/auth/auth.server', () => ({
  requireAuthenticatedClient: async () => ({ client: mocks.client })
}));
import {
  validateNotificationId,
  validateNotificationPage,
  validateSendCommunityRequestMessage
} from '../src/features/community/community-request.validators';
import { listMyCommunityNotifications } from '../src/features/community/community-request.functions';

const id = '123e4567-e89b-42d3-a456-426614174000';
describe('community request validators', () => {
  it('trims valid plain text and validates identifiers', () => {
    expect(
      validateSendCommunityRequestMessage({
        community_id: id,
        membership_id: id,
        body: '  Hello  ',
        client_request_id: id
      }).body
    ).toBe('Hello');
    expect(validateNotificationId({ notification_id: id })).toEqual({ notification_id: id });
  });
  it('rejects empty, oversized, NUL and forged fields', () => {
    for (const body of ['', ' '.repeat(2), 'x'.repeat(1001), 'x\u0000y'])
      expect(() =>
        validateSendCommunityRequestMessage({
          community_id: id,
          membership_id: id,
          body,
          client_request_id: id
        })
      ).toThrow('INVALID_COMMUNITY_INPUT');
    expect(() =>
      validateSendCommunityRequestMessage({
        community_id: id,
        membership_id: id,
        recipient_user_id: id,
        body: 'x',
        client_request_id: id
      })
    ).toThrow('INVALID_COMMUNITY_INPUT');
  });
  it('bounds inbox pagination', () => {
    expect(validateNotificationPage({ offset: 10000, limit: 50 })).toEqual({
      offset: 10000,
      limit: 50
    });
    expect(() => validateNotificationPage({ offset: 10001, limit: 50 })).toThrow(
      'INVALID_COMMUNITY_INPUT'
    );
    expect(() => validateNotificationPage({ offset: 0, limit: 51 })).toThrow(
      'INVALID_COMMUNITY_INPUT'
    );
  });
  it('maps inbox rows with one timezone RPC per page in stable server ordering', async () => {
    const rows = [
      {
        id: 'notification-1',
        created_at: '2026-01-02T00:00:00Z',
        read_at: null,
        request_message_id: 'message-1',
        community_request_messages: {
          id: 'message-1',
          body: '<b>text</b>',
          created_at: '2026-01-01T00:00:00Z'
        }
      },
      {
        id: 'notification-2',
        created_at: '2026-01-01T00:00:00Z',
        read_at: null,
        request_message_id: 'message-2',
        community_request_messages: {
          id: 'message-2',
          body: 'second message',
          created_at: '2025-12-31T00:00:00Z'
        }
      }
    ];
    type Query = {
      select: (columns: string) => Query;
      order: (column: string, options: { ascending: boolean }) => Query;
      range: (start: number, end: number) => Promise<{ data: typeof rows; error: null }>;
    };
    const query = {
      select: vi.fn<Query['select']>(),
      order: vi.fn<Query['order']>(),
      range: vi.fn<Query['range']>()
    };
    query.select.mockReturnValue(query);
    query.order.mockReturnValue(query);
    query.range.mockResolvedValue({ data: rows, error: null });
    const rpc = vi
      .fn<
        () => Promise<{
          data: { notification_id: string; time_zone: string }[];
          error: null;
        }>
      >()
      .mockResolvedValue({
        data: [
          { notification_id: 'notification-1', time_zone: 'UTC' },
          { notification_id: 'notification-2', time_zone: 'Europe/Madrid' }
        ],
        error: null
      });
    mocks.client = { from: vi.fn<() => typeof query>(() => query), rpc };
    const result = await listMyCommunityNotifications({ data: { offset: 0, limit: 20 } });
    expect(result).toEqual([
      {
        notification_id: 'notification-1',
        message_id: 'message-1',
        body: '<b>text</b>',
        created_at: '2026-01-01T00:00:00Z',
        read_at: null,
        time_zone: 'UTC'
      },
      {
        notification_id: 'notification-2',
        message_id: 'message-2',
        body: 'second message',
        created_at: '2025-12-31T00:00:00Z',
        read_at: null,
        time_zone: 'Europe/Madrid'
      }
    ]);
    expect(Object.keys(result[0]!).sort()).toEqual(
      ['notification_id', 'message_id', 'body', 'created_at', 'read_at', 'time_zone'].sort()
    );
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('get_my_community_notification_timezones', {
      p_notification_ids: ['notification-1', 'notification-2']
    });
    expect(query.order).toHaveBeenNthCalledWith(1, 'created_at', { ascending: false });
    expect(query.order).toHaveBeenNthCalledWith(2, 'id', { ascending: false });
    expect(query.range).toHaveBeenCalledWith(0, 19);
  });
  it('accepts Unicode code points within the 1000-character contract and rejects NUL', () => {
    const valid = '🟢'.repeat(1000);
    expect(
      validateSendCommunityRequestMessage({
        community_id: id,
        membership_id: id,
        body: valid,
        client_request_id: id
      }).body
    ).toHaveLength(valid.length);
    expect(() =>
      validateSendCommunityRequestMessage({
        community_id: id,
        membership_id: id,
        body: 'ok\u0000no',
        client_request_id: id
      })
    ).toThrow('INVALID_COMMUNITY_INPUT');
  });
});
