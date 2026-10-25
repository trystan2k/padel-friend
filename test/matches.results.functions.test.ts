import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resultCommand, resultProposal, resultSuccess } from './helpers/match-result-fixtures';

const mocks = vi.hoisted(() => ({
  auth: vi.fn<() => Promise<unknown>>(),
  claims: vi.fn<() => Promise<unknown>>(),
  rpc: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  event: vi.fn<() => Promise<unknown>>(),
  header: vi.fn<(...args: unknown[]) => void>(),
  from: vi.fn<(...args: unknown[]) => unknown>()
}));
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validate = (value: unknown) => value;
    const builder = {
      validator: (fn: typeof validate) => {
        validate = fn;
        return builder;
      },
      handler: (fn: (context: { data: unknown }) => unknown) => (options: { data: unknown }) =>
        fn({ data: validate(options.data) })
    };
    return builder;
  }
}));
vi.mock('@tanstack/react-start/server', () => ({ setResponseHeader: mocks.header }));
vi.mock('../src/features/auth/auth.server', () => ({ requireAuthenticatedClient: mocks.auth }));
import {
  getMatchEventResultProposals,
  submitMatchEventResult
} from '../src/features/matches/match-result.functions';

describe('result server boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.claims.mockResolvedValue({
      data: { claims: { sub: resultCommand.event_id } },
      error: null
    });
    mocks.event.mockResolvedValue({ data: { timezone: 'UTC' }, error: null });
    const builder = {
      select: vi.fn<(...args: unknown[]) => unknown>().mockReturnThis(),
      eq: vi.fn<(...args: unknown[]) => unknown>().mockReturnThis(),
      maybeSingle: mocks.event
    };
    mocks.from.mockReturnValue(builder);
    mocks.auth.mockResolvedValue({
      client: { auth: { getClaims: mocks.claims }, rpc: mocks.rpc, from: mocks.from }
    });
    mocks.rpc.mockResolvedValue({ data: resultSuccess, error: null });
  });
  it('submits computed instant using DB event timezone and sets no-store', async () => {
    const result = await submitMatchEventResult({ data: resultCommand });
    expect(result).toMatchObject({
      status: 'ok',
      replayed: false,
      value: { proposal_id: resultSuccess.proposal_id }
    });
    expect(mocks.header).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(mocks.from).toHaveBeenCalledWith('match_events');
    expect(mocks.rpc).toHaveBeenCalledWith('submit_match_event_result', {
      p_match_event_id: resultCommand.event_id,
      p_group_number: 1,
      p_teams: resultCommand.teams,
      p_sets: resultCommand.sets,
      p_played_local: { ...resultCommand.played_local, instant: '2020-01-01T12:00:00.000Z' },
      p_court_label: undefined,
      p_request_id: resultCommand.request_id
    });
  });
  it('uses authoritative timezone and accepts explicit later fall-back offset', async () => {
    mocks.event.mockResolvedValue({ data: { timezone: 'America/New_York' }, error: null });
    await submitMatchEventResult({
      data: {
        ...resultCommand,
        court_label: ' Court 2 ',
        played_local: { local: '2020-11-01 01:30:00', offset_seconds: -18000 }
      }
    });
    expect(mocks.rpc.mock.calls[0]?.[1]).toMatchObject({
      p_played_local: { instant: '2020-11-01T06:30:00.000Z' },
      p_court_label: 'Court 2'
    });
  });
  it('rejects DST gap and inconsistent offset before any mutation', async () => {
    mocks.event.mockResolvedValue({ data: { timezone: 'America/New_York' }, error: null });
    for (const played_local of [
      { local: '2020-03-08 02:30:00', offset_seconds: -18000 },
      { local: '2020-11-01 01:30:00', offset_seconds: 0 }
    ])
      expect(await submitMatchEventResult({ data: { ...resultCommand, played_local } })).toEqual({
        status: 'error',
        code: 'invalid_played_at'
      });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('reads safe proposal projection and fails closed for malformed payloads', async () => {
    mocks.rpc.mockResolvedValue({ data: [resultProposal], error: null });
    expect(
      await getMatchEventResultProposals({ data: { event_id: resultCommand.event_id } })
    ).toEqual({ status: 'ok', value: [resultProposal], replayed: false });
    expect(mocks.rpc).toHaveBeenLastCalledWith('get_match_event_result_proposals', {
      p_match_event_id: resultCommand.event_id
    });
    expect(mocks.header).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    mocks.rpc.mockResolvedValue({ data: { private: true }, error: null });
    expect(
      await getMatchEventResultProposals({ data: { event_id: resultCommand.event_id } })
    ).toEqual({ status: 'error', code: 'unavailable' });
    expect(await submitMatchEventResult({ data: resultCommand })).toEqual({
      status: 'error',
      code: 'unavailable'
    });
  });
  it.each([
    { data: null, error: null },
    { data: { claims: {} }, error: null },
    { data: { claims: { sub: 'id', is_anonymous: true } }, error: null },
    { data: { claims: { sub: 'id' } }, error: { message: 'bad' } }
  ])('rechecks authentication and rejects anonymous claims %#', async (claims) => {
    mocks.claims.mockResolvedValue(claims);
    await expect(submitMatchEventResult({ data: resultCommand })).rejects.toThrow(
      'UNAUTHENTICATED'
    );
    await expect(
      getMatchEventResultProposals({ data: { event_id: resultCommand.event_id } })
    ).rejects.toThrow('UNAUTHENTICATED');
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('does not bypass requireAuthenticatedClient or validate unknown keys', async () => {
    mocks.auth.mockRejectedValue(new Error('UNAUTHENTICATED'));
    await expect(submitMatchEventResult({ data: resultCommand })).rejects.toThrow(
      'UNAUTHENTICATED'
    );
    const invalid = { ...resultCommand, injected: true };
    expect(() => submitMatchEventResult({ data: invalid })).toThrow('INVALID_REQUEST');
  });
  it('returns typed stale conflict and original idempotent replay without retry', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: 'P0001',
        message: 'MATCH_RESULT_ACTIVE_PROPOSAL',
        details: JSON.stringify({
          active_version: 1,
          review_deadline_at: resultSuccess.review_deadline_at
        })
      }
    });
    expect(await submitMatchEventResult({ data: resultCommand })).toEqual({
      status: 'conflict',
      code: 'active_proposal',
      active_version: 1,
      review_deadline_at: resultSuccess.review_deadline_at
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    mocks.rpc.mockResolvedValue({ data: { ...resultSuccess, replayed: true }, error: null });
    expect(await submitMatchEventResult({ data: resultCommand })).toMatchObject({
      status: 'ok',
      replayed: true
    });
  });
  it('maps read and submission errors without leaking DB copy', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'Private database internals' }
    });
    expect(
      await getMatchEventResultProposals({ data: { event_id: resultCommand.event_id } })
    ).toEqual({ status: 'error', code: 'forbidden' });
    expect(await submitMatchEventResult({ data: resultCommand })).toEqual({
      status: 'error',
      code: 'forbidden'
    });
    for (const result of [
      { data: null, error: null },
      { data: null, error: { message: 'DB failure' } }
    ]) {
      mocks.event.mockResolvedValue(result);
      expect(await submitMatchEventResult({ data: resultCommand })).toEqual({
        status: 'error',
        code: 'not_found'
      });
    }
  });
});
