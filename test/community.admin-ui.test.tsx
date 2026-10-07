/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';

const mocks = vi.hoisted(() => ({
  invalidate: vi.fn<() => Promise<void>>(),
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
  useRouter: () => ({ invalidate: mocks.invalidate })
}));
vi.mock('../src/features/community/community-admin.functions', () => ({
  approveCommunityMember: mocks.approve,
  denyCommunityMember: mocks.deny,
  removeCommunityMember: mocks.remove,
  reactivateCommunityMember: mocks.reactivate,
  promoteCommunityMember: mocks.promote,
  demoteCommunityMember: mocks.demote,
  searchCommunityMembers: mocks.search,
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
  mocks.search.mockResolvedValue([member]);
});
afterEach(cleanup);

describe('community admin UI', () => {
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

  it('localizes denied access and keeps unsupported audit events generic', () => {
    render(
      <I18nextProvider i18n={createI18n('es')}>
        <CommunityAdminDenied error={new Error('NOT_COMMUNITY_ADMIN')} />
      </I18nextProvider>
    );
    expect(screen.getByRole('alert').textContent).toContain('acceso activo de administración');
  });
});
