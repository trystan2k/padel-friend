/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';

const mocks = vi.hoisted(() => ({
  invalidate: vi.fn<() => Promise<void>>(),
  navigate: vi.fn<() => Promise<void>>(),
  listVenues: vi.fn<() => Promise<unknown>>(),
  approve: vi.fn<() => Promise<unknown>>(),
  deny: vi.fn<() => Promise<unknown>>(),
  remove: vi.fn<() => Promise<unknown>>(),
  reactivate: vi.fn<() => Promise<unknown>>(),
  promote: vi.fn<() => Promise<unknown>>(),
  demote: vi.fn<() => Promise<unknown>>(),
  search: vi.fn<() => Promise<unknown>>(),
  addVenue: vi.fn<() => Promise<unknown>>(),
  editVenue: vi.fn<() => Promise<unknown>>(),
  archiveVenue: vi.fn<() => Promise<unknown>>(),
  updateSettings: vi.fn<() => Promise<unknown>>()
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    params: _params,
    to,
    ...props
  }: {
    children: import('react').ReactNode;
    params?: object;
    to: string;
  }) => (
    <a
      href={to.replace('$communityId', 'community-id').replace('$membershipId', 'member-id')}
      {...props}
    >
      {children}
    </a>
  ),
  Outlet: () => null,
  useParams: () => ({ communityId: 'community-id', membershipId: 'member-id' }),
  useRouter: () => ({ invalidate: mocks.invalidate, navigate: mocks.navigate })
}));
vi.mock('../src/features/community/community-admin.functions', () => ({
  approveCommunityMember: mocks.approve,
  denyCommunityMember: mocks.deny,
  removeCommunityMember: mocks.remove,
  reactivateCommunityMember: mocks.reactivate,
  promoteCommunityMember: mocks.promote,
  demoteCommunityMember: mocks.demote,
  searchCommunityMembers: mocks.search,
  listCommunityVenues: mocks.listVenues,
  addCommunityVenue: mocks.addVenue,
  editCommunityVenue: mocks.editVenue,
  archiveCommunityVenue: mocks.archiveVenue
}));
vi.mock('../src/features/community/community.functions', () => ({
  updateCommunitySettings: mocks.updateSettings
}));

import { createI18n } from '../src/i18n/config';
import {
  CommunityAdminDenied,
  CommunityAdminEntries,
  CommunityAdminScreen
} from '../src/features/community/CommunityAdmin';
import type { Database } from '../src/lib/supabase/database.types';

const community = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Madrid Collective',
  city_label: 'Chamberí',
  description: null,
  visibility: 'private',
  join_policy: 'admin_approval'
} as const;
type Member = Database['public']['Functions']['search_community_members']['Returns'][number];
const member: Member = {
  membership_id: '22222222-2222-4222-8222-222222222222',
  user_id: '33333333-3333-4333-8333-333333333333',
  display_name: 'Alicia Ramos',
  role: 'member',
  status: 'pending',
  valid_from: '2026-10-01T00:00:00Z',
  valid_until: null,
  activated_at: null,
  display_level: 3.4,
  reliability_percent: 82
};

function mount(
  screenName: 'requests' | 'members' | 'member' | 'settings' | 'venues' | 'audit',
  locale: 'en' | 'es' | 'pt-BR' = 'en'
) {
  return render(
    <I18nextProvider i18n={createI18n(locale)}>
      <CommunityAdminScreen
        screen={screenName}
        community={community}
        members={[member]}
        membershipId={member.membership_id}
      />
    </I18nextProvider>
  );
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.invalidate.mockResolvedValue();
  mocks.approve.mockResolvedValue({ status: 'active' });
  mocks.remove.mockResolvedValue({ status: 'inactive' });
  mocks.reactivate.mockResolvedValue({ membership_id: '44444444-4444-4444-8444-444444444444' });
  mocks.search.mockResolvedValue([member]);
  mocks.listVenues.mockResolvedValue([]);
});
afterEach(cleanup);

describe('community admin UI', () => {
  it('renders only supplied authorized community admin destinations', () => {
    const { rerender } = render(
      <I18nextProvider i18n={createI18n('en')}>
        <CommunityAdminEntries communities={[{ id: community.id, name: community.name }]} />
      </I18nextProvider>
    );
    expect(screen.getByRole('link', { name: community.name })).toBeTruthy();
    rerender(
      <I18nextProvider i18n={createI18n('en')}>
        <CommunityAdminEntries communities={[]} />
      </I18nextProvider>
    );
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders pending access request and approves via keyboard-accessible button', async () => {
    const user = userEvent.setup();
    mount('requests');
    expect(screen.getByRole('heading', { name: 'Access requests' })).toBeTruthy();
    expect(screen.getByText('Alicia Ramos')).toBeTruthy();
    const approve = screen.getByRole('button', { name: 'Approve request' });
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Back to dashboard' }));
    await user.tab();
    expect(document.activeElement).toBe(approve);
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(mocks.approve).toHaveBeenCalledWith({
        data: {
          community_id: community.id,
          membership_id: member.membership_id
        }
      })
    );
  });

  it('uses server-scoped member search and requires confirmation for removal', async () => {
    const user = userEvent.setup();
    const active = { ...member, status: 'active' as const };
    mocks.search.mockResolvedValue([active]);
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <CommunityAdminScreen screen="members" community={community} members={[active]} />
      </I18nextProvider>
    );
    const search = screen.getByRole('searchbox', { name: 'Search members' });
    expect(screen.getByRole('group', { name: 'Filter community members' })).toBeTruthy();
    await user.type(search, 'Alicia');
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(mocks.search).toHaveBeenCalledWith({
        data: {
          community_id: community.id,
          query: 'Alicia',
          status: 'active',
          offset: 0,
          limit: 50
        }
      })
    );
    cleanup();
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <CommunityAdminScreen
          screen="member"
          community={community}
          members={[active]}
          membershipId={active.membership_id}
        />
      </I18nextProvider>
    );
    await user.click(screen.getByRole('button', { name: 'Remove from community' }));
    expect(screen.getByRole('status').textContent).toContain(
      'Confirm Remove from community for Alicia Ramos?'
    );
    await user.click(screen.getByRole('button', { name: 'CONFIRM CHANGE' }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledOnce());
  });

  it('debounces changed searches and replaces narrowed results when search clears', async () => {
    const narrow = { ...member, display_name: 'Alison Narrow' };
    const broad = { ...member, display_name: 'Alicia Broad' };
    mocks.search.mockImplementation(async ({ data }: { data: { query: string } }) =>
      data.query ? [narrow] : [broad]
    );
    mount('members');
    const input = screen.getByRole('searchbox', { name: 'Search members' });
    fireEvent.change(input, { target: { value: 'Alison' } });
    await screen.findByText('Alison Narrow');
    fireEvent.change(input, { target: { value: '' } });
    await screen.findByText('Alicia Broad');
    expect(mocks.search).toHaveBeenLastCalledWith({
      data: { community_id: community.id, query: '', status: 'active', offset: 0, limit: 50 }
    });
  });

  it('paginates a server-filtered roster beyond fifty rows', async () => {
    const pendingPage = Array.from({ length: 50 }, (_, index) => ({
      ...member,
      membership_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      display_name: `Pending ${index + 1}`,
      status: 'pending' as const
    }));
    const last = {
      ...member,
      membership_id: '00000000-0000-4000-8000-000000000051',
      display_name: 'Pending 51',
      status: 'pending' as const
    };
    mocks.search.mockResolvedValueOnce(pendingPage).mockResolvedValueOnce([last]);
    const active = { ...member, status: 'active' as const };
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <CommunityAdminScreen screen="members" community={community} members={[active]} />
      </I18nextProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'Pending' }));
    await waitFor(() => expect(screen.getAllByTestId('community-member-card')).toHaveLength(50));
    await userEvent.click(screen.getByRole('button', { name: 'LOAD MORE CHANGES' }));
    await waitFor(() => expect(screen.getAllByTestId('community-member-card')).toHaveLength(51));
    expect(mocks.search).toHaveBeenNthCalledWith(1, {
      data: { community_id: community.id, query: '', status: 'pending', offset: 0, limit: 50 }
    });
    expect(mocks.search).toHaveBeenNthCalledWith(2, {
      data: { community_id: community.id, query: '', status: 'pending', offset: 50, limit: 50 }
    });
    expect(screen.getByText('End of list.')).toBeTruthy();
  });

  it('paginates the loader-backed initial active roster without search', async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) => ({
      ...member,
      membership_id: `00000000-0000-4000-8000-${String(index + 301).padStart(12, '0')}`,
      display_name: `Active ${index + 1}`,
      status: 'active' as const
    }));
    const next = {
      ...member,
      membership_id: '00000000-0000-4000-8000-000000000351',
      display_name: 'Active 51',
      status: 'active' as const
    };
    mocks.search.mockResolvedValueOnce([next]);
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <CommunityAdminScreen screen="members" community={community} members={firstPage} />
      </I18nextProvider>
    );

    await userEvent.click(screen.getByRole('button', { name: 'LOAD MORE CHANGES' }));
    await screen.findByText('Active 51');
    expect(screen.getAllByTestId('community-member-card')).toHaveLength(51);
    expect(mocks.search).toHaveBeenCalledWith({
      data: { community_id: community.id, query: '', status: 'active', offset: 50, limit: 50 }
    });
  });

  it('reconciles appended request and venue pages after successful mutations', async () => {
    const firstRequests = Array.from({ length: 50 }, (_, index) => ({
      ...member,
      membership_id: `00000000-0000-4000-8000-${String(index + 401).padStart(12, '0')}`,
      display_name: `Request ${index + 1}`,
      status: 'pending' as const
    }));
    const nextRequest = {
      ...member,
      membership_id: '00000000-0000-4000-8000-000000000451',
      display_name: 'Page two request',
      status: 'pending' as const
    };
    mocks.search.mockResolvedValueOnce([nextRequest]);
    const requestView = render(
      <I18nextProvider i18n={createI18n('en')}>
        <CommunityAdminScreen screen="requests" community={community} members={firstRequests} />
      </I18nextProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'LOAD MORE CHANGES' }));
    await screen.findByText('Page two request');
    const requestCard = screen.getByText('Page two request').parentElement;
    if (!requestCard) throw new Error('Page-two request card not rendered');
    await userEvent.click(within(requestCard).getByRole('button', { name: 'Approve request' }));
    await waitFor(() => expect(screen.queryByText('Page two request')).toBeNull());
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(50);
    expect(mocks.invalidate).toHaveBeenCalledOnce();
    requestView.unmount();

    const firstVenues = Array.from({ length: 50 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 501).padStart(12, '0')}`,
      community_id: community.id,
      name: `Venue ${index + 1}`,
      address: null,
      maps_url: null,
      photo_path: null,
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
      archived_at: null
    }));
    const nextVenue = {
      ...firstVenues[0],
      id: '00000000-0000-4000-8000-000000000551',
      name: 'Page two venue'
    };
    mocks.listVenues.mockResolvedValueOnce([nextVenue]);
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <CommunityAdminScreen screen="venues" community={community} venues={firstVenues} />
      </I18nextProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'LOAD MORE CHANGES' }));
    await screen.findByText('Page two venue');
    const venueCard = screen
      .getByText('Page two venue')
      .closest('[data-testid="community-venue-card"]');
    if (!venueCard) throw new Error('Page-two venue card not rendered');
    await userEvent.click(within(venueCard).getByRole('button', { name: 'Archive venue' }));
    await waitFor(() => expect(screen.queryByText('Page two venue')).toBeNull());
    expect(screen.getAllByTestId('community-venue-card')).toHaveLength(50);
    expect(mocks.archiveVenue).toHaveBeenCalledWith({
      data: { community_id: community.id, venue_id: nextVenue.id }
    });
  });

  it('loads the next server-filtered requests page and exposes end of list', async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) => ({
      ...member,
      membership_id: `00000000-0000-4000-8000-${String(index + 101).padStart(12, '0')}`,
      display_name: `Request ${index + 1}`,
      status: 'pending' as const
    }));
    mocks.search.mockResolvedValueOnce([]);
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <CommunityAdminScreen screen="requests" community={community} members={firstPage} />
      </I18nextProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'LOAD MORE CHANGES' }));
    await screen.findByText('End of list.');
    expect(mocks.search).toHaveBeenCalledWith({
      data: { community_id: community.id, query: '', status: 'pending', offset: 50, limit: 50 }
    });
  });

  it('loads the next venue page and shows end of list', async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 201).padStart(12, '0')}`,
      community_id: community.id,
      name: `Venue ${index + 1}`,
      address: null,
      maps_url: null,
      photo_path: null,
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
      archived_at: null
    }));
    mocks.listVenues.mockResolvedValueOnce([]);
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <CommunityAdminScreen screen="venues" community={community} venues={firstPage} />
      </I18nextProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'LOAD MORE CHANGES' }));
    await screen.findByText('End of list.');
    expect(mocks.listVenues).toHaveBeenCalledWith({
      data: { community_id: community.id, offset: 50, limit: 50 }
    });
  });

  it('navigates to the replacement membership ID after reactivation', async () => {
    const inactive = { ...member, status: 'inactive' as const };
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <CommunityAdminScreen
          screen="member"
          community={community}
          members={[inactive]}
          membershipId={inactive.membership_id}
        />
      </I18nextProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'Reactivate membership' }));
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: '/community/$communityId/admin/members/$membershipId',
        params: {
          communityId: community.id,
          membershipId: '44444444-4444-4444-8444-444444444444'
        }
      })
    );
  });

  it('resets settings draft when the community identity changes', async () => {
    const first = mount('settings');
    await userEvent.click(screen.getByText('Edit community details'));
    const city = screen.getByLabelText('City or area');
    await userEvent.clear(city);
    await userEvent.type(city, 'Community A draft');
    const secondCommunity = {
      ...community,
      id: '55555555-5555-4555-8555-555555555555',
      city_label: 'Community B'
    };
    first.rerender(
      <I18nextProvider i18n={createI18n('en')}>
        <CommunityAdminScreen screen="settings" community={secondCommunity} />
      </I18nextProvider>
    );
    await userEvent.click(screen.getByText('Edit community details'));
    expect(screen.getByLabelText('City or area').value).toBe('Community B');
  });

  it('marks unsupported settings and venue photo uploads unavailable without inventing values', async () => {
    const settingsView = mount('settings');
    expect(
      screen.getByText(/Timezone, currency, and league defaults are unavailable/)
    ).toBeTruthy();
    expect(screen.queryByText(/Europe\/Madrid|EUR|Enabled/)).toBeNull();
    settingsView.unmount();
    mount('venues');
    await userEvent.click(screen.getByRole('button', { name: 'Add a venue' }));
    expect(screen.getByText('Venue photo upload is unavailable.')).toBeTruthy();
  });

  it('uses neutral audit actors and displays only whitelisted role/status evidence', () => {
    const event = {
      id: '66666666-6666-4666-8666-666666666666',
      actor_user_id: '77777777-7777-4777-8777-777777777777',
      entity: 'community_members',
      entity_id: member.membership_id,
      action: 'INSERT',
      details: { role: 'member', status: 'pending' },
      occurred_at: '2026-10-01T10:30:00Z'
    } as const;
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <CommunityAdminScreen screen="audit" community={community} audit={[event]} />
      </I18nextProvider>
    );
    const auditCard = screen.getByTestId('community-audit-event');
    expect(auditCard.textContent).toContain('Actor identity unavailable');
    expect(auditCard.textContent).toContain('Oct 1, 2026, 10:30 AM');
    expect(auditCard.textContent).toContain('Access request created');
    expect(auditCard.textContent).toContain('Access request created · Member · Pending');
    expect(screen.queryByText('Community admin')).toBeNull();
  });

  it('localizes denied access and keeps unsupported audit events generic', () => {
    render(
      <I18nextProvider i18n={createI18n('es')}>
        <CommunityAdminDenied error={new Error('NOT_COMMUNITY_ADMIN')} />
      </I18nextProvider>
    );
    expect(screen.getByRole('alert').textContent).toContain('acceso activo de administración');
  });
});
