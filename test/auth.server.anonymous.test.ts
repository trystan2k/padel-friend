import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getClaims: vi.fn<() => Promise<{ data: unknown; error: unknown }>>(),
  setResponseHeader: vi.fn<(name: string, value: string) => void>(),
  emitDiagnostic: vi.fn<(...args: unknown[]) => void>()
}));

vi.mock('@tanstack/react-start/server', () => ({ setResponseHeader: mocks.setResponseHeader }));
vi.mock('../src/lib/diagnostics.server', () => ({ emitDiagnostic: mocks.emitDiagnostic }));
vi.mock('../src/lib/supabase/server', () => ({
  getServerClient: () => ({ auth: { getClaims: mocks.getClaims } })
}));

import { requireAuthenticatedClient } from '../src/features/auth/auth.server';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('requireAuthenticatedClient', () => {
  it('returns the user id for a regular session', async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: 'u1' } }, error: null });
    await expect(requireAuthenticatedClient()).resolves.toMatchObject({ userId: 'u1' });
  });

  it('rejects anonymous sign-in sessions even if the hosted setting is on', async () => {
    mocks.getClaims.mockResolvedValue({
      data: { claims: { sub: 'anon', is_anonymous: true } },
      error: null
    });
    await expect(requireAuthenticatedClient()).rejects.toThrow('UNAUTHENTICATED');
    expect(mocks.emitDiagnostic).toHaveBeenCalledWith('auth.failure', 'rejected', {
      code: 'UNAUTHENTICATED'
    });
  });

  it('rejects missing claims', async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: new Error('x') });
    await expect(requireAuthenticatedClient()).rejects.toThrow('UNAUTHENTICATED');
  });
});
