import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuthenticatedClient: vi.fn<() => Promise<{ client: unknown }>>(),
  signMatchPhoto: vi.fn<(client: unknown, eventId: string) => Promise<string>>()
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
vi.mock('../src/features/matches/match-photo.server', () => ({
  signMatchPhoto: mocks.signMatchPhoto
}));

import { getMatchEvent } from '../src/features/matches/matches.functions';

const eventId = '00000000-0000-4000-8000-000000000001';

describe('getMatchEvent result contract', () => {
  let client: {
    auth: {
      getClaims: ReturnType<
        typeof vi.fn<() => Promise<{ data: { claims: { sub: string } }; error: null }>>
      >;
    };
    rpc: ReturnType<
      typeof vi.fn<
        (name: string, args?: { p_event_id: string }) => Promise<{ data: unknown; error: unknown }>
      >
    >;
  };

  beforeEach(() => {
    client = {
      auth: {
        getClaims: vi
          .fn<() => Promise<{ data: { claims: { sub: string } }; error: null }>>()
          .mockResolvedValue({
            data: { claims: { sub: 'authenticated-user' } },
            error: null
          })
      },
      rpc: vi
        .fn<
          (
            name: string,
            args?: { p_event_id: string }
          ) => Promise<{ data: unknown; error: unknown }>
        >()
        .mockResolvedValue({ data: null, error: null })
    };
    mocks.requireAuthenticatedClient.mockReset().mockResolvedValue({ client });
    mocks.signMatchPhoto.mockReset().mockResolvedValue('https://example.test/signed-photo');
  });

  it('treats missing and forbidden projections as the same unavailable result', async () => {
    for (const data of [null, []]) {
      client.rpc.mockResolvedValueOnce({ data, error: null });
      await expect(getMatchEvent({ data: { event_id: eventId } })).resolves.toEqual({
        status: 'unavailable'
      });
    }
    expect(client.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.signMatchPhoto).not.toHaveBeenCalled();
  });

  it('returns an error state for RPC failures without exposing diagnostics', async () => {
    client.rpc.mockResolvedValue({
      data: null,
      error: { message: 'private SQL diagnostic' }
    });

    await expect(getMatchEvent({ data: { event_id: eventId } })).resolves.toEqual({
      status: 'error'
    });
    expect(mocks.signMatchPhoto).not.toHaveBeenCalled();
  });

  it('keeps authorized event projections and signed photo URLs', async () => {
    const projection = { event_id: eventId, venue_name: 'Court Central' };
    client.rpc.mockResolvedValue({ data: projection, error: null });

    await expect(getMatchEvent({ data: { event_id: eventId } })).resolves.toEqual({
      status: 'ok',
      event: { ...projection, photo_url: 'https://example.test/signed-photo' }
    });
    expect(client.auth.getClaims).toHaveBeenCalledOnce();
    expect(mocks.requireAuthenticatedClient).toHaveBeenCalledOnce();
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith('get_match_event', {
      p_event_id: eventId
    });
    expect(mocks.signMatchPhoto).toHaveBeenCalledExactlyOnceWith(client, eventId);
  });
});
