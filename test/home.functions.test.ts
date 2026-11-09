import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuthenticatedClient: vi.fn<() => Promise<unknown>>(),
  readHome: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  getClaims: vi.fn<() => Promise<unknown>>()
}));

type Handler = (context: { data: unknown }) => Promise<unknown>;
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator: (validate: (value: unknown) => unknown) => ({
        handler: (handler: Handler) => async (request: { data: unknown }) =>
          handler({ data: validate(request.data) })
      })
    };
    return chain;
  }
}));
vi.mock('../src/features/auth/auth.server', () => ({
  requireAuthenticatedClient: mocks.requireAuthenticatedClient
}));
vi.mock('../src/features/home/home.server', () => ({ readHome: mocks.readHome }));

import { getHome } from '../src/features/home/home.functions';

const USER = '00000000-0000-4000-8000-0000000000a1';
const A = '00000000-0000-4000-8000-00000000000a';

beforeEach(() => {
  mocks.readHome.mockReset();
  mocks.getClaims.mockReset();
  mocks.getClaims.mockResolvedValue({ data: { claims: { sub: USER } }, error: null });
  mocks.requireAuthenticatedClient.mockReset();
  mocks.requireAuthenticatedClient.mockResolvedValue({
    client: { auth: { getClaims: mocks.getClaims } },
    userId: USER
  });
});

describe('getHome', () => {
  it('validates input before any private read', async () => {
    await expect(getHome({ data: { community_id: 'nope' } })).rejects.toThrow('INVALID_HOME_INPUT');
    expect(mocks.requireAuthenticatedClient).not.toHaveBeenCalled();
  });

  it('reads with the verified user and the validated selection', async () => {
    mocks.readHome.mockResolvedValue({ asOf: 'x' });
    await expect(getHome({ data: { community_id: A } })).resolves.toEqual({ asOf: 'x' });
    expect(mocks.readHome).toHaveBeenCalledWith(expect.anything(), USER, { community_id: A });
  });

  it.each([
    ['an auth error', { data: null, error: new Error('x') }],
    ['missing claims', { data: { claims: {} }, error: null }],
    ['an anonymous identity', { data: { claims: { sub: USER, is_anonymous: true } }, error: null }]
  ])('rejects %s without reading', async (_name, claims) => {
    mocks.getClaims.mockResolvedValue(claims);
    await expect(getHome({ data: { community_id: null } })).rejects.toThrow('UNAUTHENTICATED');
    expect(mocks.readHome).not.toHaveBeenCalled();
  });

  it('rejects when the request has no authenticated client', async () => {
    mocks.requireAuthenticatedClient.mockRejectedValue(new Error('UNAUTHENTICATED'));
    await expect(getHome({ data: { community_id: null } })).rejects.toThrow('UNAUTHENTICATED');
  });
});
