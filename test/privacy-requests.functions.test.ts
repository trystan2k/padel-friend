import { beforeEach, describe, expect, it, vi } from 'vitest';

type RpcResult = { data: unknown; error: { message: string; code?: string } | null };
const mocks = vi.hoisted(() => ({
  requireAuthenticatedClient: vi.fn<() => Promise<{ client: unknown; userId: string }>>(),
  requireSameOrigin: vi.fn<() => void>()
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
        (fn: (context: { data: unknown }) => unknown) => async (options?: { data: unknown }) =>
          fn({ data: validate(options?.data) })
    };
    return builder;
  }
}));
vi.mock('../src/features/auth/auth.server', () => ({
  requireAuthenticatedClient: mocks.requireAuthenticatedClient
}));
vi.mock('../src/features/privacy-requests/request-origin.server', () => ({
  requireSameOrigin: mocks.requireSameOrigin
}));

import {
  getMyDeletionRequest,
  requestDeletion,
  withdrawMyDeletionRequest
} from '../src/features/privacy-requests/privacy-request.functions';

const COMMAND = '11111111-2222-4333-8444-555555555555';
const receipt = {
  command_id: COMMAND,
  reference: 'PR-0123456789AB',
  state: 'received',
  received_at: '2026-11-27T10:00:00Z',
  replayed: false,
  can_withdraw: true
};
const rpc = vi.fn<(name: string, args?: Record<string, unknown>) => Promise<RpcResult>>();

beforeEach(() => {
  rpc.mockReset();
  mocks.requireSameOrigin.mockReset();
  mocks.requireAuthenticatedClient.mockReset();
  mocks.requireAuthenticatedClient.mockResolvedValue({ client: { rpc }, userId: 'caller' });
});

describe('privacy request server functions', () => {
  it('sends only the command id: the subject is the verified session, never an input', async () => {
    rpc.mockResolvedValue({ data: receipt, error: null });
    const result = await requestDeletion({ data: { command_id: COMMAND } });
    expect(result).toEqual({ status: 'ok', value: receipt });
    expect(rpc).toHaveBeenCalledWith('request_account_deletion', { p_command_id: COMMAND });
    const withEmail = Object.assign({ command_id: COMMAND }, { email: 'x@y.z' });
    const withUser = Object.assign({ command_id: COMMAND }, { user_id: 'other' });
    await expect(requestDeletion({ data: withEmail })).rejects.toThrow('INVALID_PRIVACY_REQUEST');
    await expect(requestDeletion({ data: withUser })).rejects.toThrow('INVALID_PRIVACY_REQUEST');
  });

  it('enforces the same-origin check before touching the session or the database', async () => {
    mocks.requireSameOrigin.mockImplementation(() => {
      throw new Error('ORIGIN_REJECTED');
    });
    await expect(requestDeletion({ data: { command_id: COMMAND } })).rejects.toThrow(
      'ORIGIN_REJECTED'
    );
    await expect(withdrawMyDeletionRequest({ data: { command_id: COMMAND } })).rejects.toThrow(
      'ORIGIN_REJECTED'
    );
    expect(mocks.requireAuthenticatedClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated caller without a database call', async () => {
    mocks.requireAuthenticatedClient.mockRejectedValue(new Error('UNAUTHENTICATED'));
    await expect(requestDeletion({ data: { command_id: COMMAND } })).rejects.toThrow(
      'UNAUTHENTICATED'
    );
    await expect(getMyDeletionRequest()).rejects.toThrow('UNAUTHENTICATED');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns a typed error and never the database message', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'PRIVACY_REQUEST_RATE_LIMITED', code: 'P0001' }
    });
    expect(await requestDeletion({ data: { command_id: COMMAND } })).toEqual({
      status: 'error',
      code: 'rate_limited'
    });
    rpc.mockResolvedValue({ data: null, error: { message: 'PRIVACY_REQUEST_NOT_WITHDRAWABLE' } });
    expect(await withdrawMyDeletionRequest({ data: { command_id: COMMAND } })).toEqual({
      status: 'error',
      code: 'not_withdrawable'
    });
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'relation "privacy_cases" does not exist', code: '42P01' }
    });
    expect(JSON.stringify(await getMyDeletionRequest())).toBe(
      '{"status":"error","code":"unavailable"}'
    );
  });

  it('treats a receipt for another command or an unknown shape as an untrusted transport', async () => {
    rpc.mockResolvedValue({
      data: { ...receipt, command_id: '99999999-2222-4333-8444-555555555555' },
      error: null
    });
    expect(await requestDeletion({ data: { command_id: COMMAND } })).toEqual({
      status: 'error',
      code: 'unavailable'
    });
    rpc.mockResolvedValue({ data: { ...receipt, subject_id: 'x' }, error: null });
    expect(await withdrawMyDeletionRequest({ data: { command_id: COMMAND } })).toEqual({
      status: 'error',
      code: 'unavailable'
    });
  });

  it('reads the status: none, a case, or untrusted', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await getMyDeletionRequest()).toEqual({ status: 'ok', value: null });
    const status = {
      reference: 'PR-0123456789AB',
      state: 'received',
      received_at: receipt.received_at,
      blocked: false,
      can_withdraw: true
    };
    rpc.mockResolvedValue({ data: status, error: null });
    expect(await getMyDeletionRequest()).toEqual({ status: 'ok', value: status });
    rpc.mockResolvedValue({ data: { reference: 'x' }, error: null });
    expect(await getMyDeletionRequest()).toEqual({ status: 'error', code: 'unavailable' });
  });
});
