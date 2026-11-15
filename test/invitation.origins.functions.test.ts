import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeMatchRpcDetail } from './helpers/match-fixtures';
import { makeMatchManagement } from './helpers/match-management-capabilities';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  schedule: vi.fn<(admin: unknown, input: unknown) => Promise<void>>(),
  reconcile: vi.fn<(origin: string) => Promise<void>>(),
  requestUrl: vi.fn<() => URL>(() => new URL('https://attacker.example/matches/x'))
}));
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const builder = {
      validator: () => builder,
      handler: (fn: (context: { data: unknown }) => unknown) => fn
    };
    return builder;
  }
}));
vi.mock('@tanstack/react-start/server', () => ({ getRequestUrl: mocks.requestUrl }));
vi.mock('../src/features/auth/auth.server', () => ({
  requireAuthenticatedClient: async () => ({
    client: {
      rpc: mocks.rpc,
      auth: { getClaims: async () => ({ data: { claims: { sub: 'actor' } }, error: null }) }
    }
  })
}));
vi.mock('../src/lib/supabase/admin.server', () => ({ getAdminClient: () => ({}) }));
vi.mock('../src/features/matches/match-add-player.server', () => ({
  scheduleMatchPlayerAdd: mocks.schedule,
  scheduleMatchPlayerAddReconcile: mocks.reconcile
}));
vi.mock('../src/features/matches/match-photo.server', () => ({
  signMatchPhoto: async () => null,
  signMatchPhotoBatch: async () => new Map()
}));
import { addMatchPlayer } from '../src/features/matches/match-add-player.functions';
import { getMatchEvent } from '../src/features/matches/matches.functions';
import { getMatchEventManagement } from '../src/features/matches/match-management.functions';

const eventId = '11111111-1111-4111-8111-111111111111';
const input = {
  data: {
    event_id: eventId,
    request_id: eventId,
    display_name: 'Ana',
    email: 'ana@example.test',
    estimated_level: 3,
    locale: 'en' as const
  }
};

describe('request invitation origins', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('APP_ORIGIN', 'https://trusted.example');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('uses APP_ORIGIN for add, event reader and organizer reader, ignoring poisoned Host', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { status: 'ok' }, error: null });
    await expect(addMatchPlayer(input)).resolves.toEqual({ status: 'ok' });
    expect(mocks.schedule).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ origin: 'https://trusted.example' })
    );
    mocks.rpc.mockResolvedValueOnce({ data: makeMatchRpcDetail(), error: null });
    await expect(getMatchEvent({ data: { event_id: eventId } })).resolves.toMatchObject({
      status: 'ok'
    });
    expect(mocks.reconcile).toHaveBeenLastCalledWith('https://trusted.example');
    mocks.rpc.mockResolvedValueOnce({
      data: makeMatchManagement({ is_organizer: true }),
      error: null
    });
    await expect(getMatchEventManagement({ data: { event_id: eventId } })).resolves.toMatchObject({
      status: 'ok'
    });
    expect(mocks.reconcile).toHaveBeenCalledTimes(2);
    expect(mocks.reconcile).toHaveBeenLastCalledWith('https://trusted.example');
    expect(mocks.requestUrl).not.toHaveBeenCalled();
  });

  it.each(['', 'https://trusted.example/path', 'http://evil.example'])(
    'fails closed before writes; reader reconciliation stays best effort (%s)',
    async (origin) => {
      vi.stubEnv('APP_ORIGIN', origin);
      await expect(addMatchPlayer(input)).rejects.toThrow('OPERATION_FAILED');
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(mocks.schedule).not.toHaveBeenCalled();
      mocks.rpc.mockResolvedValueOnce({ data: makeMatchRpcDetail(), error: null });
      await expect(getMatchEvent({ data: { event_id: eventId } })).resolves.toMatchObject({
        status: 'ok'
      });
      mocks.rpc.mockResolvedValueOnce({
        data: makeMatchManagement({ is_organizer: true }),
        error: null
      });
      await expect(getMatchEventManagement({ data: { event_id: eventId } })).resolves.toMatchObject(
        { status: 'ok' }
      );
      expect(mocks.reconcile).not.toHaveBeenCalled();
    }
  );
});
