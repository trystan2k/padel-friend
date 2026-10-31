import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuthenticatedClient: vi.fn<() => Promise<{ client: unknown }>>()
}));

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validate: (value: unknown) => unknown = (value) => value;
    const builder = {
      validator: (fn: (value: unknown) => unknown) => {
        validate = fn;
        return builder;
      },
      handler:
        (fn: (context: { data: unknown }) => unknown) => async (options: { data: unknown }) =>
          fn({ data: validate(options.data) })
    };
    return builder;
  }
}));
vi.mock('../src/features/auth/auth.server', () => ({
  requireAuthenticatedClient: mocks.requireAuthenticatedClient
}));

import {
  matchRegistrationActionError,
  parseDecideMatchRegistrationResult,
  parseMatchRegistrationQueue,
  parseMyMatchRegistration,
  parseSubmitMatchRegistrationResult
} from '../src/features/matches/match-registration-model';
import {
  decideMatchRegistration,
  getMyMatchRegistration,
  listMatchEventRegistrations,
  listMatchEventRegistrationRequests,
  submitMatchRegistration
} from '../src/features/matches/match-registration.functions';

const eventId = '00000000-0000-4000-8000-000000000001';
const requesterId = 'a3bb189e-8bf9-4888-9912-ace4e6543002';
const attemptId = 'b7c2f9de-1111-4222-8333-444455556666';
const now = '2026-10-17T12:00:00.000Z';

// The exact jsonb shapes the four registration RPCs return on success.
const acceptedPayload = {
  event_id: eventId,
  user_id: requesterId,
  lifecycle: 'accepted',
  participation: 'reserve',
  accepted_order: 3,
  registration_source: 'member',
  requested_at: now,
  approved_at: now,
  accepted_at: now,
  already_registered: false
};
const pendingPayload = {
  event_id: eventId,
  user_id: requesterId,
  lifecycle: 'pending',
  participation: null,
  accepted_order: null,
  registration_source: 'guest',
  requested_at: now,
  approved_at: null,
  accepted_at: null,
  already_registered: false
};
const rejectedPayload = {
  event_id: eventId,
  user_id: requesterId,
  lifecycle: 'rejected',
  registration_source: 'member',
  resolved_at: now,
  resolved_by: '00000000-0000-4000-8000-000000000009',
  replayed: false
};

describe('match registration error mapping', () => {
  it('maps each of the ten domain tokens to its own distinct code', () => {
    const tokens: [string, string][] = [
      ['MATCH_REGISTRATION_EVENT_NOT_FOUND', 'event_not_found'],
      ['MATCH_REGISTRATION_INVITE_ONLY', 'invite_only'],
      ['MATCH_REGISTRATION_CLOSED', 'closed'],
      ['MATCH_REGISTRATION_DENIED', 'denied'],
      ['MATCH_REGISTRATION_DUPLICATE', 'duplicate'],
      ['MATCH_REGISTRATION_PENDING_DUPLICATE', 'pending_duplicate'],
      ['MATCH_REGISTRATION_FULL', 'full'],
      ['MATCH_REGISTRATION_NOT_FOUND', 'not_found'],
      ['MATCH_REGISTRATION_ALREADY_RESOLVED', 'already_resolved'],
      ['MATCH_REGISTRATION_REQUESTER_INELIGIBLE', 'requester_ineligible']
    ];
    const mapped = tokens.map(([, code]) => code);
    expect(new Set(mapped).size).toBe(10);
    for (const [token, code] of tokens) {
      expect(matchRegistrationActionError({ code: 'P0001', message: token })).toEqual({
        status: 'error',
        code
      });
      // Postgres/PostgREST may wrap the raise message; mapping stays token-based.
      expect(
        matchRegistrationActionError({ code: 'P0001', message: `raise: ${token} (once)` })
      ).toEqual({ status: 'error', code });
    }
  });

  it('maps the caller/auth codes and lets a token message take precedence', () => {
    expect(
      matchRegistrationActionError({ code: '28000', message: 'Authentication required' })
    ).toEqual({ status: 'error', code: 'unauthenticated' });
    expect(
      matchRegistrationActionError({ code: '22023', message: 'Invalid registration decision' })
    ).toEqual({ status: 'error', code: 'invalid' });
    expect(
      matchRegistrationActionError({
        code: '42501',
        message: 'Registration decisions are creator-only'
      })
    ).toEqual({ status: 'error', code: 'forbidden' });
    expect(
      matchRegistrationActionError({ code: '28000', message: 'MATCH_REGISTRATION_FULL' })
    ).toEqual({ status: 'error', code: 'full' });
  });

  it('degrades unknown or raw failures to null so callers can surface a safe generic', () => {
    const raw: ({ code?: string | null; message?: string | null } | null | undefined)[] = [
      { code: 'P0001', message: 'SOMETHING_ELSE' },
      { code: '23505', message: 'NOTIFICATION_EVENT_CONFLICT' },
      { code: 'P0001', message: 'match_registration_closed' },
      { code: '0A000', message: 'relation "auth.users" does not exist' },
      { code: null, message: null },
      { code: 'P0001' },
      {},
      null,
      undefined
    ];
    for (const error of raw) {
      expect(matchRegistrationActionError(error)).toBeNull();
    }
  });
});

describe('match registration jsonb parsers', () => {
  it('parses submit results and rejects malformed or nested payloads without throwing', () => {
    expect(parseSubmitMatchRegistrationResult(acceptedPayload)).toEqual({
      status: 'accepted',
      registration: {
        event_id: eventId,
        user_id: requesterId,
        lifecycle: 'accepted',
        participation: 'reserve',
        accepted_order: 3,
        registration_source: 'member',
        approved_at: now,
        accepted_at: now
      }
    });
    expect(parseSubmitMatchRegistrationResult(pendingPayload)).toEqual({
      status: 'pending',
      registration: {
        event_id: eventId,
        user_id: requesterId,
        lifecycle: 'pending',
        registration_source: 'guest',
        requested_at: now
      }
    });
    const malformed: unknown[] = [
      null,
      undefined,
      42,
      'x',
      [],
      { ...acceptedPayload, lifecycle: 'rejected' },
      { ...acceptedPayload, event_id: 'not-a-uuid' },
      { ...acceptedPayload, user_id: null },
      { ...acceptedPayload, accepted_order: 0 },
      { ...acceptedPayload, accepted_order: -1 },
      { ...acceptedPayload, accepted_order: '3' },
      { ...acceptedPayload, participation: 'bogus' },
      { ...acceptedPayload, participation: null },
      { ...acceptedPayload, registration_source: 'nobody' },
      { ...acceptedPayload, accepted_at: null },
      { ...acceptedPayload, accepted_at: '' },
      { ...pendingPayload, requested_at: null },
      { lifecycle: 'accepted', registration: acceptedPayload },
      { lifecycle: 'accepted' },
      { lifecycle: 'unknown' }
    ];
    for (const payload of malformed) {
      expect(() => parseSubmitMatchRegistrationResult(payload)).not.toThrow();
      expect(parseSubmitMatchRegistrationResult(payload)).toBeNull();
    }
  });

  it('parses decision results with the replay flag and rejects malformed payloads', () => {
    expect(parseDecideMatchRegistrationResult({ ...acceptedPayload, replayed: true })).toEqual({
      status: 'approved',
      replayed: true,
      registration: {
        event_id: eventId,
        user_id: requesterId,
        lifecycle: 'accepted',
        participation: 'reserve',
        accepted_order: 3,
        registration_source: 'member',
        approved_at: now,
        accepted_at: now
      }
    });
    // The replay flag is a strict boolean: anything else degrades to false.
    expect(parseDecideMatchRegistrationResult(acceptedPayload)).toEqual({
      status: 'approved',
      replayed: false,
      registration: expect.objectContaining({ lifecycle: 'accepted' })
    });
    expect(parseDecideMatchRegistrationResult({ ...acceptedPayload, replayed: 'yes' })).toEqual({
      status: 'approved',
      replayed: false,
      registration: expect.objectContaining({ lifecycle: 'accepted' })
    });
    expect(parseDecideMatchRegistrationResult(rejectedPayload)).toEqual({
      status: 'rejected',
      replayed: false,
      registration: {
        event_id: eventId,
        user_id: requesterId,
        lifecycle: 'rejected',
        registration_source: 'member',
        resolved_at: now
      }
    });
    const malformed: unknown[] = [
      null,
      42,
      'x',
      [],
      { ...rejectedPayload, resolved_at: null },
      { ...rejectedPayload, resolved_at: '' },
      { ...acceptedPayload, lifecycle: 'pending' },
      { lifecycle: 'rejected', registration: rejectedPayload },
      { replayed: true }
    ];
    for (const payload of malformed) {
      expect(() => parseDecideMatchRegistrationResult(payload)).not.toThrow();
      expect(parseDecideMatchRegistrationResult(payload)).toBeNull();
    }
  });

  it('parses the caller own-state read across every lifecycle', () => {
    expect(parseMyMatchRegistration({ event_id: eventId, lifecycle: null })).toEqual({
      state: 'none'
    });
    // A missing lifecycle key is tolerated the same way as an explicit null.
    expect(parseMyMatchRegistration({ event_id: eventId })).toEqual({ state: 'none' });
    expect(
      parseMyMatchRegistration({
        event_id: eventId,
        lifecycle: 'pending',
        participation: null,
        accepted_order: null,
        position: null,
        registration_source: 'guest',
        requested_at: now,
        approved_at: null,
        accepted_at: null,
        resolved_at: null
      })
    ).toEqual({
      state: 'pending',
      event_id: eventId,
      registration_source: 'guest',
      requested_at: now
    });
    expect(
      parseMyMatchRegistration({
        event_id: eventId,
        lifecycle: 'accepted',
        participation: 'playing',
        accepted_order: 4,
        position: 4,
        registration_source: 'creator',
        requested_at: null,
        approved_at: null,
        accepted_at: now,
        resolved_at: null
      })
    ).toEqual({
      state: 'accepted',
      event_id: eventId,
      participation: 'playing',
      accepted_order: 4,
      position: 4,
      registration_source: 'creator',
      requested_at: null,
      approved_at: null,
      accepted_at: now
    });
    expect(
      parseMyMatchRegistration({
        event_id: eventId,
        lifecycle: 'rejected',
        registration_source: 'member',
        resolved_at: now
      })
    ).toEqual({
      state: 'rejected',
      event_id: eventId,
      registration_source: 'member',
      resolved_at: now
    });
    expect(
      parseMyMatchRegistration({
        event_id: eventId,
        lifecycle: 'expired',
        registration_source: 'member',
        resolved_at: null
      })
    ).toEqual({
      state: 'expired',
      event_id: eventId,
      registration_source: 'member',
      resolved_at: null
    });
    const malformed: unknown[] = [
      null,
      'x',
      [],
      { lifecycle: null },
      { event_id: 'bad', lifecycle: 'pending' },
      { event_id: eventId, lifecycle: 'bogus', registration_source: 'member' },
      { event_id: eventId, lifecycle: 'pending' },
      {
        event_id: eventId,
        lifecycle: 'accepted',
        participation: 'reserve',
        accepted_order: 1,
        position: -1,
        registration_source: 'member',
        accepted_at: now
      }
    ];
    for (const payload of malformed) {
      expect(() => parseMyMatchRegistration(payload)).not.toThrow();
      expect(parseMyMatchRegistration(payload)).toBeNull();
    }
  });

  it('parses the creator queue row and rejects malformed counts, capacity and requests', () => {
    const queueRow = {
      event_id: eventId,
      accepted_count: 5,
      playing_count: 4,
      reserve_count: 1,
      maximum_registrations: 8,
      registration_cutoff_at: now,
      requests: [
        {
          user_id: requesterId,
          attempt_id: attemptId,
          display_name: 'Requester',
          display_level: 3.5,
          is_provisional: true,
          registration_source: 'guest',
          requested_at: now
        },
        {
          user_id: '00000000-0000-4000-8000-000000000002',
          attempt_id: '00000000-0000-4000-8000-0000000000a2',
          display_name: null,
          display_level: null,
          is_provisional: false,
          registration_source: 'member',
          requested_at: now
        }
      ]
    };
    expect(parseMatchRegistrationQueue(queueRow)).toEqual(queueRow);
    expect(
      parseMatchRegistrationQueue({ ...queueRow, maximum_registrations: null, requests: [] })
    ).toEqual({ ...queueRow, maximum_registrations: null, requests: [] });
    const malformed: unknown[] = [
      null,
      'x',
      [],
      { ...queueRow, event_id: 'bad' },
      { ...queueRow, accepted_count: -1 },
      { ...queueRow, playing_count: 1.5 },
      { ...queueRow, reserve_count: '1' },
      { ...queueRow, registration_cutoff_at: null },
      { ...queueRow, maximum_registrations: -2 },
      { ...queueRow, maximum_registrations: '8' },
      { ...queueRow, requests: '[]' },
      { ...queueRow, requests: null },
      { ...queueRow, requests: [null] },
      { ...queueRow, requests: [{ ...queueRow.requests[0], user_id: 'bad' }] },
      { ...queueRow, requests: [{ ...queueRow.requests[0], attempt_id: 'bad' }] },
      { ...queueRow, requests: [{ ...queueRow.requests[0], attempt_id: null }] },
      { ...queueRow, requests: [{ ...queueRow.requests[0], registration_source: 'nobody' }] },
      { ...queueRow, requests: [{ ...queueRow.requests[0], requested_at: null }] },
      { ...queueRow, requests: [{ ...queueRow.requests[0], display_level: '3.5' }] }
    ];
    for (const payload of malformed) {
      expect(() => parseMatchRegistrationQueue(payload)).not.toThrow();
      expect(parseMatchRegistrationQueue(payload)).toBeNull();
    }
  });

  it('parses the additive reserve_not_playing_count on the queue row and refuses malformed values', () => {
    const queueRow = {
      event_id: eventId,
      accepted_count: 5,
      playing_count: 4,
      reserve_count: 0,
      reserve_not_playing_count: 1,
      maximum_registrations: null,
      registration_cutoff_at: now,
      requests: []
    };
    // A post-cutoff payload carries the split count: ordinary Reserve never
    // includes Reserve Not Playing.
    expect(parseMatchRegistrationQueue(queueRow)).toEqual(queueRow);
    // A pre-cutoff payload may omit the additive key; it stays absent instead
    // of being fabricated as zero, and an explicit null is tolerated the same
    // way.
    const withoutCount = parseMatchRegistrationQueue({
      ...queueRow,
      reserve_not_playing_count: undefined
    });
    expect(withoutCount).not.toBeNull();
    expect('reserve_not_playing_count' in withoutCount!).toBe(false);
    expect(
      'reserve_not_playing_count' in
        parseMatchRegistrationQueue({
          ...queueRow,
          reserve_not_playing_count: null
        })!
    ).toBe(false);
    // Any other malformed value degrades the WHOLE payload to null so the UI
    // never renders a garbage count.
    for (const malformed of ['1', -1, 1.5, true, []]) {
      expect(() =>
        parseMatchRegistrationQueue({ ...queueRow, reserve_not_playing_count: malformed })
      ).not.toThrow();
      expect(
        parseMatchRegistrationQueue({ ...queueRow, reserve_not_playing_count: malformed })
      ).toBeNull();
    }
  });
});

describe('registration server function contracts', () => {
  let client: {
    auth: {
      getClaims: ReturnType<
        typeof vi.fn<
          () => Promise<{
            data: { claims: { sub: string; is_anonymous?: boolean } };
            error: null | { message: string };
          }>
        >
      >;
    };
    rpc: ReturnType<
      typeof vi.fn<
        (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
      >
    >;
  };

  beforeEach(() => {
    client = {
      auth: {
        getClaims: vi
          .fn<
            () => Promise<{
              data: { claims: { sub: string; is_anonymous?: boolean } };
              error: null | { message: string };
            }>
          >()
          .mockResolvedValue({ data: { claims: { sub: requesterId } }, error: null })
      },
      rpc: vi
        .fn<
          (
            name: string,
            args?: Record<string, unknown>
          ) => Promise<{ data: unknown; error: unknown }>
        >()
        .mockResolvedValue({ data: null, error: null })
    };
    mocks.requireAuthenticatedClient.mockReset().mockResolvedValue({ client });
  });

  it.each(['started', 'cancelled', 'result_protected'] as const)(
    'preserves shared %s guards for submit and both decisions',
    async (code) => {
      client.rpc.mockResolvedValue({
        data: null,
        error: { code: 'P0001', message: `MATCH_MANAGEMENT_${code.toUpperCase()}` }
      });
      expect(await submitMatchRegistration({ data: { event_id: eventId } })).toEqual({
        status: 'error',
        code
      });
      for (const decision of ['approve', 'reject'] as const)
        expect(
          await decideMatchRegistration({
            data: { event_id: eventId, attempt_id: attemptId, decision }
          })
        ).toEqual({ status: 'error', code });
    }
  );
  it('rejects anonymous claim sets before any RPC fires', async () => {
    client.auth.getClaims.mockResolvedValueOnce({
      data: { claims: { sub: requesterId, is_anonymous: true } },
      error: null
    });
    await expect(submitMatchRegistration({ data: { event_id: eventId } })).rejects.toThrow(
      'UNAUTHENTICATED'
    );
    expect(client.rpc).not.toHaveBeenCalled();

    // Non-anonymous claim sets proceed to the (default null) RPC response and
    // degrade to the safe generic error for submit.
    for (const claims of [{ sub: requesterId, is_anonymous: false }, { sub: requesterId }]) {
      client.auth.getClaims.mockResolvedValueOnce({ data: { claims }, error: null });
      await expect(submitMatchRegistration({ data: { event_id: eventId } })).resolves.toEqual({
        status: 'error',
        code: 'unavailable'
      });
    }
    expect(client.rpc).toHaveBeenCalledTimes(2);
  });

  it('surfaces a failed claims lookup as UNAUTHENTICATED, never as diagnostics', async () => {
    client.auth.getClaims.mockResolvedValue({
      data: { claims: { sub: requesterId } },
      error: { message: 'private jwt failure' }
    });
    await expect(submitMatchRegistration({ data: { event_id: eventId } })).rejects.toThrow(
      'UNAUTHENTICATED'
    );
    await expect(getMyMatchRegistration({ data: { event_id: eventId } })).rejects.toThrow(
      'UNAUTHENTICATED'
    );
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('maps submit RPC failures to typed codes and degrades raw text to unavailable', async () => {
    for (const [token, code] of [
      ['MATCH_REGISTRATION_CLOSED', 'closed'],
      ['MATCH_REGISTRATION_FULL', 'full'],
      ['MATCH_REGISTRATION_PENDING_DUPLICATE', 'pending_duplicate'],
      ['MATCH_REGISTRATION_DENIED', 'denied']
    ] as const) {
      client.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: token } });
      await expect(submitMatchRegistration({ data: { event_id: eventId } })).resolves.toEqual({
        status: 'error',
        code
      });
    }
    const hostile: { code?: string; message?: string }[] = [
      { code: 'XX000', message: 'connection refused to db.internal' },
      { message: 'relation "auth.users" does not exist' },
      { code: '28000', message: 'Authentication required' }
    ];
    for (const error of hostile) {
      client.rpc.mockResolvedValueOnce({ data: null, error });
      const expected = {
        status: 'error',
        code: error.code === '28000' ? 'unauthenticated' : 'unavailable'
      };
      await expect(submitMatchRegistration({ data: { event_id: eventId } })).resolves.toEqual(
        expected
      );
    }
    expect(client.rpc).toHaveBeenCalledTimes(7);
    expect(client.rpc).toHaveBeenNthCalledWith(1, 'submit_match_registration', {
      p_match_event_id: eventId
    });
  });

  it('parses submit successes and degrades malformed payloads to unavailable', async () => {
    client.rpc.mockResolvedValueOnce({ data: pendingPayload, error: null });
    await expect(submitMatchRegistration({ data: { event_id: eventId } })).resolves.toEqual({
      status: 'pending',
      registration: {
        event_id: eventId,
        user_id: requesterId,
        lifecycle: 'pending',
        registration_source: 'guest',
        requested_at: now
      }
    });
    for (const data of [null, undefined, { lifecycle: 'accepted' }, 'x']) {
      client.rpc.mockResolvedValueOnce({ data, error: null });
      await expect(submitMatchRegistration({ data: { event_id: eventId } })).resolves.toEqual({
        status: 'error',
        code: 'unavailable'
      });
    }
  });

  it('maps decide failures and parses approved/rejected successes with replay flags', async () => {
    client.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'Registration decisions are creator-only' }
    });
    await expect(
      decideMatchRegistration({
        data: { event_id: eventId, attempt_id: attemptId, decision: 'approve' }
      })
    ).resolves.toEqual({ status: 'error', code: 'forbidden' });

    client.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: 'MATCH_REGISTRATION_ALREADY_RESOLVED' }
    });
    await expect(
      decideMatchRegistration({
        data: { event_id: eventId, attempt_id: attemptId, decision: 'reject' }
      })
    ).resolves.toEqual({ status: 'error', code: 'already_resolved' });

    client.rpc.mockResolvedValueOnce({ data: { ...acceptedPayload, replayed: true }, error: null });
    await expect(
      decideMatchRegistration({
        data: { event_id: eventId, attempt_id: attemptId, decision: 'approve' }
      })
    ).resolves.toEqual({
      status: 'approved',
      replayed: true,
      registration: expect.objectContaining({ lifecycle: 'accepted', accepted_order: 3 })
    });

    client.rpc.mockResolvedValueOnce({ data: rejectedPayload, error: null });
    await expect(
      decideMatchRegistration({
        data: { event_id: eventId, attempt_id: attemptId, decision: 'reject' }
      })
    ).resolves.toEqual({
      status: 'rejected',
      replayed: false,
      registration: expect.objectContaining({ lifecycle: 'rejected', resolved_at: now })
    });

    client.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: 'structural failure: pg_catalog.pg_sleep details' }
    });
    await expect(
      decideMatchRegistration({
        data: { event_id: eventId, attempt_id: attemptId, decision: 'approve' }
      })
    ).resolves.toEqual({ status: 'error', code: 'unavailable' });
    expect(client.rpc).toHaveBeenCalledTimes(5);
    expect(client.rpc).toHaveBeenNthCalledWith(1, 'decide_match_registration', {
      p_match_event_id: eventId,
      p_attempt_id: attemptId,
      p_decision: 'approve'
    });
  });

  it('keeps the own-state read unavailable on errors and malformed payloads', async () => {
    client.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: 'MATCH_REGISTRATION_EVENT_NOT_FOUND' }
    });
    await expect(getMyMatchRegistration({ data: { event_id: eventId } })).resolves.toEqual({
      status: 'unavailable'
    });
    client.rpc.mockResolvedValueOnce({
      data: {
        event_id: eventId,
        lifecycle: 'accepted',
        participation: 'reserve',
        accepted_order: 2,
        position: 2,
        registration_source: 'member',
        requested_at: null,
        approved_at: null,
        accepted_at: now,
        resolved_at: null
      },
      error: null
    });
    await expect(getMyMatchRegistration({ data: { event_id: eventId } })).resolves.toEqual({
      status: 'ok',
      registration: {
        state: 'accepted',
        event_id: eventId,
        participation: 'reserve',
        accepted_order: 2,
        position: 2,
        registration_source: 'member',
        requested_at: null,
        approved_at: null,
        accepted_at: now
      }
    });
    client.rpc.mockResolvedValueOnce({ data: { lifecycle: 'accepted' }, error: null });
    await expect(getMyMatchRegistration({ data: { event_id: eventId } })).resolves.toEqual({
      status: 'unavailable'
    });
    expect(client.rpc).toHaveBeenCalledTimes(3);
    expect(client.rpc).toHaveBeenNthCalledWith(1, 'get_my_match_registration', {
      p_match_event_id: eventId
    });
  });

  it('maps the queue read to ok/empty/unavailable without leaking rows to others', async () => {
    const queueRow = {
      event_id: eventId,
      accepted_count: 1,
      playing_count: 0,
      reserve_count: 1,
      maximum_registrations: null,
      registration_cutoff_at: now,
      requests: []
    };
    client.rpc.mockResolvedValueOnce({ data: [queueRow], error: null });
    await expect(
      listMatchEventRegistrationRequests({ data: { event_id: eventId } })
    ).resolves.toEqual({ status: 'ok', queue: queueRow });
    for (const data of [[], undefined, null]) {
      client.rpc.mockResolvedValueOnce({ data, error: null });
      await expect(
        listMatchEventRegistrationRequests({ data: { event_id: eventId } })
      ).resolves.toEqual({ status: 'empty' });
    }
    client.rpc.mockResolvedValueOnce({ data: [{ event_id: 'bad' }], error: null });
    await expect(
      listMatchEventRegistrationRequests({ data: { event_id: eventId } })
    ).resolves.toEqual({ status: 'unavailable' });
    client.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '28000', message: 'Authentication required' }
    });
    await expect(
      listMatchEventRegistrationRequests({ data: { event_id: eventId } })
    ).resolves.toEqual({ status: 'unavailable' });
    expect(client.rpc).toHaveBeenCalledTimes(6);
    expect(client.rpc).toHaveBeenNthCalledWith(1, 'list_match_event_registration_requests', {
      p_match_event_id: eventId
    });
  });

  it('maps the accepted-roster read to ok/empty/unavailable with a safe projection', async () => {
    const row = {
      display_name: 'Ada',
      display_level: 3.5,
      is_provisional: false,
      participation: 'playing',
      group_number: 1,
      reserve_position: null,
      registration_source: 'member',
      accepted_order: 1
    };
    client.rpc.mockResolvedValueOnce({ data: [row], error: null });
    await expect(listMatchEventRegistrations({ data: { event_id: eventId } })).resolves.toEqual({
      status: 'ok',
      entries: [row]
    });
    // A non-readable event returns an empty set, never an error or leaked rows.
    client.rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(listMatchEventRegistrations({ data: { event_id: eventId } })).resolves.toEqual({
      status: 'empty'
    });
    // A malformed payload degrades the whole read to unavailable.
    for (const data of [undefined, null, 'x', [{ ...row, accepted_order: 0 }]]) {
      client.rpc.mockResolvedValueOnce({ data, error: null });
      await expect(listMatchEventRegistrations({ data: { event_id: eventId } })).resolves.toEqual({
        status: 'unavailable'
      });
    }
    client.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '28000', message: 'Authentication required' }
    });
    await expect(listMatchEventRegistrations({ data: { event_id: eventId } })).resolves.toEqual({
      status: 'unavailable'
    });
    expect(client.rpc).toHaveBeenNthCalledWith(1, 'list_match_event_registrations', {
      p_match_event_id: eventId
    });
  });

  it('runs the narrow validators before any client work', async () => {
    await expect(
      submitMatchRegistration({ data: { event_id: eventId, user_id: requesterId } })
    ).rejects.toThrow('INVALID_MATCH_INPUT');
    await expect(
      decideMatchRegistration({
        data: { event_id: eventId, attempt_id: attemptId, decision: 'maybe' }
      })
    ).rejects.toThrow('INVALID_MATCH_INPUT');
    await expect(
      listMatchEventRegistrations({ data: { event_id: eventId, extra: true } })
    ).rejects.toThrow('INVALID_MATCH_INPUT');
    expect(mocks.requireAuthenticatedClient).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
