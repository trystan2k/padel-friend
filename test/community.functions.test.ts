import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getServerClient: vi.fn<() => unknown>(),
  setResponseHeader: vi.fn<(name: string, value: string) => void>()
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
vi.mock('@tanstack/react-start/server', () => ({ setResponseHeader: mocks.setResponseHeader }));
vi.mock('../src/lib/supabase/server', () => ({ getServerClient: mocks.getServerClient }));

import {
  createCommunity,
  updateCommunitySettings
} from '../src/features/community/community.functions';

const id = '11111111-1111-4111-8111-111111111111';
const createInput = { name: 'Padel', visibility: 'private', join_policy: 'instant' } as const;
const row = { id, name: 'Padel', visibility: 'public', join_policy: 'admin_approval' };
function client(claimed = true, updated: unknown = row, error: unknown = null) {
  const rpc = vi
    .fn<() => Promise<{ data: string; error: unknown }>>()
    .mockResolvedValue({ data: id, error });
  const maybeSingle = vi
    .fn<() => Promise<{ data: unknown; error: unknown }>>()
    .mockResolvedValue({ data: updated, error });
  const select = vi.fn<(columns: string) => { maybeSingle: typeof maybeSingle }>(() => ({
    maybeSingle
  }));
  const eq = vi.fn<(column: string, value: string) => { select: typeof select }>(() => ({
    select
  }));
  const update = vi.fn<(changes: unknown) => { eq: typeof eq }>(() => ({ eq }));
  const from = vi.fn<(table: string) => { update: typeof update }>(() => ({ update }));
  return {
    auth: {
      getClaims: vi
        .fn<() => Promise<{ data: { claims: { sub: string } } | null; error: Error | null }>>()
        .mockResolvedValue(
          claimed
            ? { data: { claims: { sub: id } }, error: null }
            : { data: null, error: new Error('expired') }
        )
    },
    rpc,
    from,
    update,
    eq,
    select,
    maybeSingle
  };
}

beforeEach(() => {
  mocks.getServerClient.mockReset();
  mocks.setResponseHeader.mockReset();
});

describe('community server functions', () => {
  it('rejects invalid creation fields before authentication or writes', async () => {
    for (const input of [
      { ...createInput, name: ' Pad' },
      { ...createInput, name: 'x'.repeat(81) },
      { ...createInput, visibility: 'secret' },
      { ...createInput, join_policy: 'other' },
      { ...createInput, created_by: id },
      { ...createInput, description: 'x'.repeat(501) },
      { ...createInput, city_label: undefined }
    ])
      await expect(createCommunity({ data: input })).rejects.toThrow('INVALID_COMMUNITY_INPUT');
    expect(mocks.getServerClient).not.toHaveBeenCalled();
  });

  it('rejects invalid settings patches before authentication or writes', async () => {
    for (const input of [
      { community_id: id },
      { community_id: 'not-uuid', name: 'Padel' },
      { community_id: id, created_by: id },
      { community_id: id, settings: [] },
      { community_id: id, settings: { big: 'x'.repeat(4096) } },
      { community_id: id, settings: { invalid: undefined } },
      { community_id: id, join_policy: 'other' },
      { community_id: id, logo_path: 'x'.repeat(257) },
      { community_id: id, name: null }
    ])
      await expect(updateCommunitySettings({ data: input })).rejects.toThrow(
        'INVALID_COMMUNITY_INPUT'
      );
    expect(mocks.getServerClient).not.toHaveBeenCalled();
  });

  it('requires live claims for both mutations', async () => {
    const unauthenticated = client(false);
    mocks.getServerClient.mockReturnValue(unauthenticated);
    await expect(createCommunity({ data: createInput })).rejects.toThrow('UNAUTHENTICATED');
    await expect(
      updateCommunitySettings({ data: { community_id: id, name: 'New' } })
    ).rejects.toThrow('UNAUTHENTICATED');
    expect(unauthenticated.rpc).not.toHaveBeenCalled();
    expect(unauthenticated.update).not.toHaveBeenCalled();
    expect(mocks.setResponseHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  });

  it('creates through one typed RPC with no caller-supplied identity', async () => {
    const authenticated = client();
    mocks.getServerClient.mockReturnValue(authenticated);
    await expect(
      createCommunity({
        data: {
          ...createInput,
          description: null,
          city_label: 'Lisbon'
        }
      })
    ).resolves.toEqual({ id });
    expect(authenticated.rpc).toHaveBeenCalledExactlyOnceWith('create_community', {
      p_name: 'Padel',
      p_visibility: 'private',
      p_join_policy: 'instant',
      p_city_label: 'Lisbon'
    });
    expect(authenticated.from).not.toHaveBeenCalled();
  });

  it('sends only validated settings to the RLS-guarded row and returns it', async () => {
    const authenticated = client();
    mocks.getServerClient.mockReturnValue(authenticated);
    await expect(
      updateCommunitySettings({
        data: {
          community_id: id,
          visibility: 'public',
          join_policy: 'admin_approval',
          settings: {}
        }
      })
    ).resolves.toEqual(row);
    expect(authenticated.from).toHaveBeenCalledWith('communities');
    expect(authenticated.update).toHaveBeenCalledWith({
      visibility: 'public',
      join_policy: 'admin_approval',
      settings: {}
    });
    expect(authenticated.eq).toHaveBeenCalledWith('id', id);
    expect(authenticated.select).toHaveBeenCalledWith(
      'id,name,visibility,join_policy,description,city_label,logo_path,settings,updated_at'
    );
  });

  it('maps zero matching rows to NOT_COMMUNITY_ADMIN, including missing IDs', async () => {
    mocks.getServerClient.mockReturnValue(client(true, null));
    await expect(
      updateCommunitySettings({ data: { community_id: id, name: 'Other' } })
    ).rejects.toThrow('NOT_COMMUNITY_ADMIN');
  });

  it('propagates database failures without disguising them as authorization errors', async () => {
    const error = new Error('database unavailable');
    mocks.getServerClient.mockReturnValue(client(true, null, error));
    await expect(createCommunity({ data: createInput })).rejects.toBe(error);
    await expect(
      updateCommunitySettings({ data: { community_id: id, name: 'Other' } })
    ).rejects.toBe(error);
  });
});
