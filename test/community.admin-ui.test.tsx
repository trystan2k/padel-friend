/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';

const mocks = vi.hoisted(() => ({
  invalidate: vi.fn<() => Promise<void>>(),
  navigate: vi.fn<() => Promise<void>>(),
  listVenues: vi.fn<() => Promise<unknown>>(),
  listAudit: vi.fn<() => Promise<unknown>>(),
  approve: vi.fn<() => Promise<unknown>>(),
  deny: vi.fn<() => Promise<unknown>>(),
  remove: vi.fn<() => Promise<unknown>>(),
  reactivate: vi.fn<() => Promise<unknown>>(),
  promote: vi.fn<() => Promise<unknown>>(),
  demote: vi.fn<() => Promise<unknown>>(),
  issueInvitation: vi.fn<() => Promise<unknown>>(),
  search: vi.fn<() => Promise<unknown>>(),
  searchInvitees: vi.fn<() => Promise<unknown>>(),
  addVenue: vi.fn<() => Promise<unknown>>(),
  editVenue: vi.fn<() => Promise<unknown>>(),
  archiveVenue: vi.fn<() => Promise<unknown>>(),
  updateSettings: vi.fn<() => Promise<unknown>>(),
  sendRequestMessage: vi.fn<() => Promise<unknown>>(),
  listNotifications: vi.fn<() => Promise<unknown>>(),
  markRead: vi.fn<() => Promise<unknown>>(),
  getDiscoverability: vi.fn<() => Promise<{ enabled: boolean }>>(),
  setDiscoverability: vi.fn<() => Promise<{ enabled: boolean }>>()
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
  issueInvitation: mocks.issueInvitation,
  approveCommunityMember: mocks.approve,
  denyCommunityMember: mocks.deny,
  removeCommunityMember: mocks.remove,
  reactivateCommunityMember: mocks.reactivate,
  promoteCommunityMember: mocks.promote,
  demoteCommunityMember: mocks.demote,
  searchCommunityMembers: mocks.search,
  listCommunityAudit: mocks.listAudit,
  listCommunityVenues: mocks.listVenues,
  addCommunityVenue: mocks.addVenue,
  editCommunityVenue: mocks.editVenue,
  archiveCommunityVenue: mocks.archiveVenue
}));
vi.mock('../src/features/community/community.functions', () => ({
  updateCommunitySettings: mocks.updateSettings
}));
vi.mock('../src/features/community/community-request.functions', () => ({
  sendCommunityRequestMessage: mocks.sendRequestMessage,
  listMyCommunityNotifications: mocks.listNotifications,
  markCommunityNotificationRead: mocks.markRead
}));
vi.mock('../src/features/community/community-invitee.functions', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../src/features/community/community-invitee.functions')
  >()),
  searchCommunityInvitees: mocks.searchInvitees,
  getMyInviteeDiscoverability: mocks.getDiscoverability,
  setMyInviteeDiscoverability: mocks.setDiscoverability
}));

import { createI18n } from '../src/i18n/config';
import { CommunityInbox } from '../src/features/community/CommunityInbox';
import { InviteeSearch } from '../src/features/community/InviteeSearch';
import { InvitationDiscoverability } from '../src/features/community/InvitationDiscoverability';
import {
  CommunityAdminDenied,
  CommunityAdminEntries,
  CommunityAdminScreen
} from '../src/features/community/CommunityAdmin';

const community = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Madrid Collective',
  city_label: 'Chamberí',
  description: null,
  visibility: 'private',
  join_policy: 'admin_approval'
} as const;
type Member = import('../src/features/community/community-admin.types').CommunityMemberSearchResult;
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
  const props =
    screenName === 'requests' || screenName === 'members'
      ? {
          screen: screenName,
          community,
          members: [member],
          ...(screenName === 'requests'
            ? { timezone: 'Europe/Madrid' as const, datasetGeneration: 1 }
            : {})
        }
      : screenName === 'member'
        ? { screen: screenName, community, member, membershipId: member.membership_id }
        : screenName === 'venues'
          ? { screen: screenName, community, venues: [] }
          : screenName === 'audit'
            ? { screen: screenName, community, audit: [] }
            : screenName === 'settings'
              ? {
                  screen: screenName,
                  community,
                  defaults: {
                    timezone: 'Europe/Madrid',
                    currency: 'EUR',
                    member_created_leagues_enabled: true
                  }
                }
              : { screen: screenName, community };
  return render(
    <I18nextProvider i18n={createI18n(locale)}>
      <CommunityAdminScreen {...props} />
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
  mocks.listAudit.mockResolvedValue([]);
  mocks.sendRequestMessage.mockResolvedValue({ message_id: 'message-id' });
  mocks.listNotifications.mockResolvedValue([]);
  mocks.markRead.mockResolvedValue({ read_at: '2026-01-01T00:00:00Z' });
  mocks.issueInvitation.mockResolvedValue({ token: 'invite-token' });
  mocks.searchInvitees.mockResolvedValue([]);
  mocks.getDiscoverability.mockResolvedValue({ enabled: false });
  mocks.setDiscoverability.mockResolvedValue({ enabled: true });
});
afterEach(cleanup);

function mockClipboard() {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const writeText = vi.fn<(token: string) => Promise<void>>().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText }
  });
  return {
    writeText,
    restore() {
      if (descriptor) Object.defineProperty(navigator, 'clipboard', descriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  };
}

async function searchInvitees(
  input: HTMLElement,
  query: string,
  rows: { user_id: string; display_name: string }[]
) {
  mocks.searchInvitees.mockResolvedValueOnce(rows);
  vi.useFakeTimers();
  try {
    fireEvent.change(input, { target: { value: query } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
  } finally {
    vi.useRealTimers();
  }
}

async function openInviteeSearch(rows: { user_id: string; display_name: string }[]) {
  const user = userEvent.setup();
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <InviteeSearch communityId={community.id} />
    </I18nextProvider>
  );
  await user.click(screen.getByRole('button', { name: 'Issue invitation' }));
  const dialog = screen.getByRole('dialog');
  const input = within(dialog).getByRole('textbox', {
    name: 'Search opted-in display names'
  });
  await searchInvitees(input, 'applicants', rows);
  return { user, dialog, input };
}

describe('community admin UI', () => {
  it('composes request updates through the dialog and reports send errors', async () => {
    const user = userEvent.setup();
    mount('requests');
    await user.click(screen.getByRole('button', { name: 'Send update' }));
    await user.type(screen.getByLabelText('Message'), 'Hello applicant');
    mocks.sendRequestMessage.mockRejectedValueOnce(new Error('failed'));
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not send message');
    mocks.sendRequestMessage.mockResolvedValueOnce({ message_id: 'message-id' });
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(mocks.sendRequestMessage).toHaveBeenCalled());
  });

  it('renders XSS-like inbox text literally and keeps load failure distinct from empty', () => {
    const body = '<img src=x onerror=alert(1)>';
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <CommunityInbox
          initialItems={[
            {
              notification_id: 'n',
              message_id: 'm',
              body,
              created_at: '2026-01-01T00:00:00Z',
              read_at: null,
              time_zone: 'Europe/Madrid'
            }
          ]}
          loadError={false}
        />
      </I18nextProvider>
    );
    expect(screen.getByText(body)).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
    cleanup();
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <CommunityInbox initialItems={null} loadError />
      </I18nextProvider>
    );
    expect(screen.getByRole('alert').textContent).toContain('Inbox unavailable');
    expect(screen.queryByText('No messages yet')).toBeNull();
  });
  it('formats each inbox timestamp with its own timezone', () => {
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <CommunityInbox
          initialItems={[
            {
              notification_id: 'utc',
              message_id: 'm-utc',
              body: 'UTC notification',
              created_at: '2026-01-01T00:30:00Z',
              read_at: '2026-01-02T00:00:00Z',
              time_zone: 'UTC'
            },
            {
              notification_id: 'madrid',
              message_id: 'm-madrid',
              body: 'Madrid notification',
              created_at: '2026-01-01T00:30:00Z',
              read_at: '2026-01-02T00:00:00Z',
              time_zone: 'Europe/Madrid'
            }
          ]}
          loadError={false}
        />
      </I18nextProvider>
    );

    expect(screen.getByText('Jan 1, 2026, 12:30 AM UTC')).toBeTruthy();
    expect(screen.getByText('Jan 1, 2026, 1:30 AM GMT+1')).toBeTruthy();
  });
  it('shows discoverability confirmation only after a successful change', async () => {
    const user = userEvent.setup();
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <InvitationDiscoverability />
      </I18nextProvider>
    );

    const checkbox = await screen.findByRole('checkbox');
    await waitFor(() => expect(checkbox.hasAttribute('disabled')).toBe(false));
    expect(screen.queryByText('Discoverability preference saved.')).toBeNull();

    await user.click(checkbox);

    expect(await screen.findByText('Discoverability preference saved.')).toBeTruthy();
    expect(mocks.setDiscoverability).toHaveBeenCalledWith({ data: { enabled: true } });
  });
  it('keeps items visible after mark-read errors and retries the item', async () => {
    mocks.markRead.mockRejectedValueOnce(new Error('mutation failed'));
    const user = userEvent.setup();
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <CommunityInbox
          initialItems={[
            {
              notification_id: 'n1',
              message_id: 'm1',
              body: 'Visible request',
              created_at: '2026-01-01T00:00:00Z',
              read_at: null,
              time_zone: 'Europe/Madrid'
            }
          ]}
          loadError={false}
        />
      </I18nextProvider>
    );
    await user.click(screen.getByRole('button', { name: 'Mark as read' }));
    expect(await screen.findByText('Could not mark this message as read')).toBeTruthy();
    expect(screen.getByText('Visible request')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(mocks.markRead).toHaveBeenCalledTimes(2));
  });
  it('preserves loaded items when a page fails and retries at same offset', async () => {
    const items = Array.from({ length: 20 }, (_, index) => ({
      notification_id: `n${index}`,
      message_id: `m${index}`,
      body: `Request ${index}`,
      created_at: '2026-01-01T00:00:00Z',
      read_at: '2026-01-02T00:00:00Z',
      time_zone: 'Europe/Madrid' as const
    }));
    mocks.listNotifications.mockRejectedValueOnce(new Error('page failed')).mockResolvedValueOnce([
      {
        notification_id: 'n20',
        message_id: 'm20',
        body: 'Request 20',
        created_at: '2025-12-31T00:00:00Z',
        read_at: null,
        time_zone: 'Europe/Madrid'
      }
    ]);
    const user = userEvent.setup();
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <CommunityInbox initialItems={items} loadError={false} />
      </I18nextProvider>
    );
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Could not load more messages')).toBeTruthy();
    expect(screen.getByText('Request 0')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Request 20')).toBeTruthy();
    expect(mocks.listNotifications).toHaveBeenLastCalledWith({ data: { offset: 20, limit: 20 } });
  });
  it('serializes inbox pages and appends each result in page order', async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) => ({
      notification_id: `n${index}`,
      message_id: `m${index}`,
      body: `Request ${index}`,
      created_at: '2026-01-01T00:00:00Z',
      read_at: '2026-01-02T00:00:00Z',
      time_zone: 'Europe/Madrid' as const
    }));
    const nextPage = Array.from({ length: 20 }, (_, index) => ({
      notification_id: `n${index + 20}`,
      message_id: `m${index + 20}`,
      body: `Request ${index + 20}`,
      created_at: '2025-12-31T00:00:00Z',
      read_at: null,
      time_zone: 'Europe/Madrid' as const
    }));
    let resolveNextPage!: (rows: typeof nextPage) => void;
    const pendingPage = new Promise<typeof nextPage>((resolve) => (resolveNextPage = resolve));
    mocks.listNotifications.mockReturnValueOnce(pendingPage).mockResolvedValueOnce([
      {
        ...nextPage[0],
        notification_id: 'n40',
        message_id: 'm40',
        body: 'Request 40'
      }
    ]);
    const user = userEvent.setup();
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <CommunityInbox initialItems={firstPage} loadError={false} />
      </I18nextProvider>
    );

    const loadMore = screen.getByRole('button', { name: 'Load more' });
    await user.click(loadMore);
    await waitFor(() => expect(loadMore.hasAttribute('disabled')).toBe(true));
    await user.click(loadMore);
    expect(mocks.listNotifications).toHaveBeenCalledTimes(1);

    await act(async () => resolveNextPage(nextPage));
    await screen.findByText('Request 39');
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('Request 40');

    expect(mocks.listNotifications).toHaveBeenNthCalledWith(1, {
      data: { offset: 20, limit: 20 }
    });
    expect(mocks.listNotifications).toHaveBeenNthCalledWith(2, {
      data: { offset: 40, limit: 20 }
    });
    expect(
      Array.from(document.querySelectorAll('article')).map(
        (article) => article.querySelector('p')?.textContent
      )
    ).toEqual(Array.from({ length: 41 }, (_, index) => `Request ${index}`));
  });
  it('does not carry copied confirmation from applicant A to applicant B', async () => {
    let clipboard: ReturnType<typeof mockClipboard> | undefined;
    try {
      const { user, dialog } = await openInviteeSearch([
        { user_id: 'applicant-a', display_name: 'Applicant A' },
        { user_id: 'applicant-b', display_name: 'Applicant B' }
      ]);
      clipboard = mockClipboard();
      await user.click(within(dialog).getByRole('radio', { name: /Applicant A/ }));
      mocks.issueInvitation.mockResolvedValueOnce({ token: 'token-a' });
      await user.click(within(dialog).getByRole('button', { name: 'Issue invitation' }));
      expect(await within(dialog).findByText('token-a')).toBeTruthy();
      await user.click(within(dialog).getByRole('button', { name: 'Copy link' }));
      expect(await within(dialog).findByText('Copied')).toBeTruthy();

      await user.click(within(dialog).getByRole('radio', { name: /Applicant B/ }));
      expect(within(dialog).queryByText('Copied')).toBeNull();
      mocks.issueInvitation.mockResolvedValueOnce({ token: 'token-b' });
      await user.click(within(dialog).getByRole('button', { name: 'Issue invitation' }));

      expect(await within(dialog).findByText('token-b')).toBeTruthy();
      expect(within(dialog).queryByText('token-a')).toBeNull();
      expect(within(dialog).queryByText('Copied')).toBeNull();
      expect(clipboard.writeText).toHaveBeenCalledTimes(1);
      expect(clipboard.writeText).toHaveBeenCalledWith('token-a');
    } finally {
      clipboard?.restore();
    }
  });

  it('preserves a successful invitation response for its original applicant after selection changes', async () => {
    let resolveInvitation!: (result: { token: string }) => void;
    const pendingInvitation = new Promise<{ token: string }>(
      (resolve) => (resolveInvitation = resolve)
    );
    const { user, dialog } = await openInviteeSearch([
      { user_id: 'applicant-a', display_name: 'Applicant A' },
      { user_id: 'applicant-b', display_name: 'Applicant B' }
    ]);
    await user.click(within(dialog).getByRole('radio', { name: /Applicant A/ }));
    mocks.issueInvitation.mockReturnValueOnce(pendingInvitation);
    await user.click(within(dialog).getByRole('button', { name: 'Issue invitation' }));
    expect(mocks.issueInvitation).toHaveBeenCalledWith({
      data: { community_id: community.id, invitee_user_id: 'applicant-a' }
    });

    await user.click(within(dialog).getByRole('radio', { name: /Applicant B/ }));
    await act(async () => resolveInvitation({ token: 'stale-token-a' }));

    expect(within(dialog).getByText('stale-token-a')).toBeTruthy();
    const issuedOutput = within(dialog).getByText(
      (_, element) =>
        element?.tagName === 'OUTPUT' && element.textContent?.includes('stale-token-a')
    );
    expect(issuedOutput.textContent).toContain('Applicant A');
    expect(issuedOutput.textContent).not.toContain('Applicant B');
  });

  it('prevents duplicate invitation requests and preserves the single returned token', async () => {
    let resolveInvitation!: (result: { token: string }) => void;
    const pendingInvitation = new Promise<{ token: string }>(
      (resolve) => (resolveInvitation = resolve)
    );
    const { user, dialog } = await openInviteeSearch([
      { user_id: 'applicant-a', display_name: 'Applicant A' }
    ]);
    await user.click(within(dialog).getByRole('radio', { name: /Applicant A/ }));
    mocks.issueInvitation.mockReturnValueOnce(pendingInvitation);
    const issueButton = within(dialog).getByRole('button', { name: 'Issue invitation' });

    act(() => {
      fireEvent.click(issueButton);
      fireEvent.click(issueButton);
    });

    expect(mocks.issueInvitation).toHaveBeenCalledTimes(1);
    expect(issueButton.hasAttribute('disabled')).toBe(true);
    expect(issueButton.getAttribute('aria-busy')).toBe('true');
    await act(async () => resolveInvitation({ token: 'single-token-a' }));

    expect(within(dialog).getByText('single-token-a')).toBeTruthy();
    expect(mocks.issueInvitation).toHaveBeenCalledTimes(1);
  });

  it('shows a retryable issuance error without displaying a token after failure', async () => {
    const { user, dialog } = await openInviteeSearch([
      { user_id: 'applicant-a', display_name: 'Applicant A' }
    ]);
    await user.click(within(dialog).getByRole('radio', { name: /Applicant A/ }));
    mocks.issueInvitation
      .mockRejectedValueOnce(new Error('issuance failed'))
      .mockResolvedValueOnce({ token: 'retry-token-a' });
    const issueButton = within(dialog).getByRole('button', { name: 'Issue invitation' });

    await user.click(issueButton);
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    expect(within(dialog).queryByText('retry-token-a')).toBeNull();
    expect(issueButton.hasAttribute('disabled')).toBeFalsy();

    await user.click(issueButton);

    expect(await within(dialog).findByText('retry-token-a')).toBeTruthy();
    expect(mocks.issueInvitation).toHaveBeenCalledTimes(2);
  });

  it('confirms copying only after the current applicant token is copied', async () => {
    let clipboard: ReturnType<typeof mockClipboard> | undefined;
    try {
      const { user, dialog } = await openInviteeSearch([
        { user_id: 'applicant-b', display_name: 'Applicant B' }
      ]);
      clipboard = mockClipboard();
      await user.click(within(dialog).getByRole('radio', { name: /Applicant B/ }));
      mocks.issueInvitation.mockResolvedValueOnce({ token: 'token-b' });
      await user.click(within(dialog).getByRole('button', { name: 'Issue invitation' }));
      expect(await within(dialog).findByText('token-b')).toBeTruthy();
      expect(within(dialog).queryByText('Copied')).toBeNull();

      await user.click(within(dialog).getByRole('button', { name: 'Copy link' }));

      expect(await within(dialog).findByText('Copied')).toBeTruthy();
      expect(clipboard.writeText).toHaveBeenCalledTimes(1);
      expect(clipboard.writeText).toHaveBeenCalledWith('token-b');
    } finally {
      clipboard?.restore();
    }
  });

  it('clears copied confirmation and token when starting a new invitee search', async () => {
    let clipboard: ReturnType<typeof mockClipboard> | undefined;
    try {
      const { user, dialog, input } = await openInviteeSearch([
        { user_id: 'applicant-a', display_name: 'Applicant A' }
      ]);
      clipboard = mockClipboard();
      await user.click(within(dialog).getByRole('radio', { name: /Applicant A/ }));
      mocks.issueInvitation.mockResolvedValueOnce({ token: 'token-a' });
      await user.click(within(dialog).getByRole('button', { name: 'Issue invitation' }));
      await within(dialog).findByText('token-a');
      await user.click(within(dialog).getByRole('button', { name: 'Copy link' }));
      expect(await within(dialog).findByText('Copied')).toBeTruthy();

      await searchInvitees(input, 'new applicants', [
        { user_id: 'applicant-b', display_name: 'Applicant B' }
      ]);

      expect(within(dialog).queryByText('Copied')).toBeNull();
      expect(within(dialog).queryByText('token-a')).toBeNull();
      expect(within(dialog).getByRole('radio', { name: /Applicant B/ })).toBeTruthy();
      expect(clipboard.writeText).toHaveBeenCalledTimes(1);
      expect(clipboard.writeText).toHaveBeenCalledWith('token-a');
    } finally {
      clipboard?.restore();
    }
  });

  it('clears a failed invitee search before rendering results for the next query', async () => {
    mocks.searchInvitees
      .mockRejectedValueOnce(new Error('search failed'))
      .mockResolvedValueOnce([{ user_id: 'invitee-id', display_name: 'Alicia Searchable' }]);
    const user = userEvent.setup();
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <InviteeSearch communityId={community.id} />
      </I18nextProvider>
    );
    await user.click(screen.getByRole('button', { name: 'Issue invitation' }));
    const search = screen.getByRole('textbox', { name: 'Search opted-in display names' });
    await user.type(search, 'failure');
    expect(await screen.findByRole('alert')).toBeTruthy();

    await user.clear(search);
    await user.type(search, 'success');

    expect(await screen.findByRole('radio', { name: /Alicia Searchable/ })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('shows empty state after a failed invitee search is followed by no results', async () => {
    let resolveEmptySearch!: (rows: { user_id: string; display_name: string }[]) => void;
    const emptySearch = new Promise<{ user_id: string; display_name: string }[]>((resolve) => {
      resolveEmptySearch = resolve;
    });
    mocks.searchInvitees
      .mockRejectedValueOnce(new Error('search failed'))
      .mockReturnValueOnce(emptySearch);
    const user = userEvent.setup();
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <InviteeSearch communityId={community.id} />
      </I18nextProvider>
    );
    await user.click(screen.getByRole('button', { name: 'Issue invitation' }));
    const search = screen.getByRole('textbox', { name: 'Search opted-in display names' });
    await user.type(search, 'failure');
    expect(await screen.findByRole('alert')).toBeTruthy();

    await user.clear(search);
    await user.type(search, 'empty');

    await waitFor(() =>
      expect(mocks.searchInvitees).toHaveBeenNthCalledWith(2, {
        data: { community_id: community.id, query: 'empty' }
      })
    );
    expect(await screen.findByText('Searching…')).toBeTruthy();
    expect(screen.queryByText('No eligible invitees found.')).toBeNull();
    await act(async () => resolveEmptySearch([]));
    expect(await screen.findByText('No eligible invitees found.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not let a superseded invitee search overwrite newer results', async () => {
    let resolveOldSearch!: (rows: { user_id: string; display_name: string }[]) => void;
    const oldSearch = new Promise<{ user_id: string; display_name: string }[]>(
      (resolve) => (resolveOldSearch = resolve)
    );
    mocks.searchInvitees
      .mockReturnValueOnce(oldSearch)
      .mockResolvedValueOnce([{ user_id: 'new-result', display_name: 'Current Applicant' }]);
    const user = userEvent.setup();
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <InviteeSearch communityId={community.id} />
      </I18nextProvider>
    );
    await user.click(screen.getByRole('button', { name: 'Issue invitation' }));
    const search = screen.getByRole('textbox', { name: 'Search opted-in display names' });
    vi.useFakeTimers();
    try {
      fireEvent.change(search, { target: { value: 'older query' } });
      await act(async () => vi.advanceTimersByTimeAsync(250));
      expect(mocks.searchInvitees).toHaveBeenCalledTimes(1);

      fireEvent.change(search, { target: { value: 'current query' } });
      await act(async () => vi.advanceTimersByTimeAsync(250));
      expect(screen.getByRole('radio', { name: /Current Applicant/ })).toBeTruthy();

      await act(async () =>
        resolveOldSearch([{ user_id: 'old-result', display_name: 'Superseded Applicant' }])
      );

      expect(screen.getByRole('radio', { name: /Current Applicant/ })).toBeTruthy();
      expect(screen.queryByRole('radio', { name: /Superseded Applicant/ })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
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
          member={active}
          membershipId={active.membership_id}
        />
      </I18nextProvider>
    );
    const trigger = screen.getByRole('button', { name: 'Remove from community' });
    trigger.focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText('Confirm Remove from community for Alicia Ramos?')
    ).toBeTruthy();
    const cancel = within(dialog).getByRole('button', { name: 'CANCEL' });
    const dialogPortal = dialog.closest('[data-base-ui-portal]');
    expect(document.activeElement).toBe(cancel);
    await user.tab();
    expect(dialogPortal?.contains(document.activeElement)).toBe(true);
    await user.tab();
    expect(dialogPortal?.contains(document.activeElement)).toBe(true);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(
      within(dialog).getByRole('button', { name: 'CONFIRM CHANGE' })
    );
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
    await user.keyboard('{Enter}');
    await screen.findByRole('alertdialog');
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'CANCEL' })
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
    await user.keyboard('{Enter}');
    await screen.findByRole('alertdialog');
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'CONFIRM CHANGE' })
    );
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Member controls' }));
  });

  it('keeps failed confirmation open for retry and restores focus after cancel', async () => {
    const user = userEvent.setup();
    const active = { ...member, status: 'active' as const };
    mocks.remove.mockRejectedValueOnce(new Error('temporary failure'));
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <CommunityAdminScreen
          screen="member"
          community={community}
          member={active}
          membershipId={active.membership_id}
        />
      </I18nextProvider>
    );
    const trigger = screen.getByRole('button', { name: 'Remove from community' });
    await user.click(trigger);
    const dialog = await screen.findByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', { name: 'CONFIRM CHANGE' });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'CANCEL' }));
    await user.click(confirm);
    const error = await within(dialog).findByRole('alert');
    expect(error.textContent).toContain('Could not complete the change');
    expect(within(dialog).getByRole('button', { name: 'TRY AGAIN' })).toBeTruthy();
    expect(screen.getByRole('alertdialog')).toBe(dialog);
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'CANCEL' })
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('shows unavailable nullable ratings on requests, roster, and detail without changing valid ratings', () => {
    const noRatings: Member = {
      ...member,
      display_name: 'No rating player',
      display_level: null,
      reliability_percent: null,
      activated_at: null,
      valid_until: null
    };
    for (const view of ['requests', 'members', 'member'] as const) {
      cleanup();
      const displayed =
        view === 'members' ? { ...noRatings, status: 'active' as const } : noRatings;
      render(
        <I18nextProvider i18n={createI18n('en')}>
          {view === 'member' ? (
            <CommunityAdminScreen
              screen="member"
              community={community}
              member={displayed}
              membershipId={displayed.membership_id}
            />
          ) : (
            <CommunityAdminScreen screen={view} community={community} members={[displayed]} />
          )}
        </I18nextProvider>
      );
      expect(screen.getByText(/ratings unavailable/i)).toBeTruthy();
      expect(document.body.textContent).not.toContain('NaN');
      expect(document.body.textContent).not.toContain('Invalid Date');
      expect(document.body.textContent).not.toContain('Level 0');
    }

    cleanup();
    const activeMember = { ...member, status: 'active' as const };
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <CommunityAdminScreen screen="members" community={community} members={[activeMember]} />
      </I18nextProvider>
    );
    expect(screen.getByText('App-wide level 3.4 · reliability 82%')).toBeTruthy();
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
        <CommunityAdminScreen
          screen="requests"
          community={community}
          members={firstRequests}
          timezone="Europe/Madrid"
          datasetGeneration={1}
        />
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
        <CommunityAdminScreen
          screen="requests"
          community={community}
          members={firstPage}
          timezone="Europe/Madrid"
          datasetGeneration={1}
        />
      </I18nextProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'LOAD MORE CHANGES' }));
    await screen.findByText('End of list.');
    expect(mocks.search).toHaveBeenCalledWith({
      data: { community_id: community.id, query: '', status: 'pending', offset: 50, limit: 50 }
    });
  });

  it('discards an obsolete request page when loader generation changes', async () => {
    let resolveOld!: (rows: Member[]) => void;
    const oldPage = new Promise<Member[]>((resolve) => {
      resolveOld = resolve;
    });
    const firstPage = Array.from({ length: 50 }, (_, index) => ({
      ...member,
      membership_id: `old-${index}`,
      display_name: `Old ${index}`
    }));
    const fresh = [{ ...member, membership_id: 'fresh', display_name: 'Fresh first page' }];
    mocks.search.mockReturnValueOnce(oldPage);
    const i18n = createI18n('en');
    const view = render(
      <I18nextProvider i18n={i18n}>
        <CommunityAdminScreen
          screen="requests"
          community={community}
          members={firstPage}
          timezone="Europe/Madrid"
          datasetGeneration={1}
        />
      </I18nextProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'LOAD MORE CHANGES' }));
    expect(mocks.search).toHaveBeenCalledWith({
      data: { community_id: community.id, query: '', status: 'pending', offset: 50, limit: 50 }
    });
    view.rerender(
      <I18nextProvider i18n={i18n}>
        <CommunityAdminScreen
          screen="requests"
          community={community}
          members={fresh}
          timezone="Europe/Madrid"
          datasetGeneration={2}
        />
      </I18nextProvider>
    );
    await act(async () =>
      resolveOld([{ ...member, membership_id: 'stale', display_name: 'Stale page row' }])
    );
    expect(screen.getByText('Fresh first page')).toBeTruthy();
    expect(screen.queryByText('Stale page row')).toBeNull();
  });

  it('keeps current request pagination busy when obsolete page rejects', async () => {
    let rejectOld!: (error: Error) => void;
    let resolveCurrent!: (rows: Member[]) => void;
    const old = new Promise<Member[]>((_resolve, reject) => {
      rejectOld = reject;
    });
    const current = new Promise<Member[]>((resolve) => {
      resolveCurrent = resolve;
    });
    const firstPage = Array.from({ length: 50 }, (_, index) => ({
      ...member,
      membership_id: `race-${index}`,
      display_name: `Race ${index}`
    }));
    mocks.search.mockReturnValueOnce(old).mockReturnValueOnce(current);
    const i18n = createI18n('en');
    const view = render(
      <I18nextProvider i18n={i18n}>
        <CommunityAdminScreen
          screen="requests"
          community={community}
          members={firstPage}
          timezone="Europe/Madrid"
          datasetGeneration={1}
        />
      </I18nextProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'LOAD MORE CHANGES' }));
    view.rerender(
      <I18nextProvider i18n={i18n}>
        <CommunityAdminScreen
          screen="requests"
          community={community}
          members={firstPage}
          timezone="Europe/Madrid"
          datasetGeneration={2}
        />
      </I18nextProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'LOAD MORE CHANGES' }));
    await act(async () => rejectOld(new Error('obsolete')));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'LOAD MORE CHANGES' }).hasAttribute('disabled')).toBe(
      true
    );
    await act(async () =>
      resolveCurrent([
        { ...member, membership_id: 'current-row', display_name: 'Current page row' }
      ])
    );
    expect(screen.getByText('Current page row')).toBeTruthy();
    expect(mocks.search).toHaveBeenLastCalledWith({
      data: { community_id: community.id, query: '', status: 'pending', offset: 50, limit: 50 }
    });
  });

  it('resets accumulated pages only when the explicit requests generation changes', async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) => ({
      ...member,
      membership_id: `reset-${index}`,
      display_name: `Reset ${index}`
    }));
    mocks.search.mockResolvedValueOnce([
      { ...member, membership_id: 'extra', display_name: 'Accumulated page' }
    ]);
    const i18n = createI18n('en');
    const view = render(
      <I18nextProvider i18n={i18n}>
        <CommunityAdminScreen
          screen="requests"
          community={community}
          members={firstPage}
          timezone="Europe/Madrid"
          datasetGeneration={1}
        />
      </I18nextProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'LOAD MORE CHANGES' }));
    expect(await screen.findByText('Accumulated page')).toBeTruthy();
    view.rerender(
      <I18nextProvider i18n={i18n}>
        <CommunityAdminScreen
          screen="requests"
          community={community}
          members={[...firstPage]}
          timezone="Europe/Madrid"
          datasetGeneration={1}
        />
      </I18nextProvider>
    );
    expect(screen.getByText('Accumulated page')).toBeTruthy();
    view.rerender(
      <I18nextProvider i18n={i18n}>
        <CommunityAdminScreen
          screen="requests"
          community={community}
          members={firstPage}
          timezone="Europe/Madrid"
          datasetGeneration={2}
        />
      </I18nextProvider>
    );
    expect(screen.queryByText('Accumulated page')).toBeNull();
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
          member={inactive}
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
    await userEvent.click(
      screen.getByText('Community admins control access. Player level stays read-only.')
    );
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
        <CommunityAdminScreen
          screen="settings"
          community={secondCommunity}
          defaults={{
            timezone: 'Europe/Madrid',
            currency: 'EUR',
            member_created_leagues_enabled: true
          }}
        />
      </I18nextProvider>
    );
    await userEvent.click(
      screen.getByText('Community admins control access. Player level stays read-only.')
    );
    expect(screen.getByLabelText('City or area').value).toBe('Community B');
  });

  it('renders supported settings controls without an unsupported photo placeholder', async () => {
    const settingsView = mount('settings');
    expect(screen.getByRole('combobox', { name: 'Community time zone' })).toBeTruthy();
    expect(screen.getByText('Preference saved; league creation is not supported yet')).toBeTruthy();
    expect(screen.getByTestId('settings-currency-control').textContent).toContain('Euro (EUR)');
    settingsView.unmount();
    mount('venues');
    await userEvent.click(screen.getByRole('button', { name: 'Add a venue' }));
    expect(screen.queryByText('Venue photo upload is unavailable.')).toBeNull();
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

  it('characterizes a pending member load-more response crossing a loader refresh', async () => {
    let resolvePage!: (rows: Member[]) => void;
    const page = new Promise<Member[]>((resolve) => (resolvePage = resolve));
    const firstPage = Array.from({ length: 50 }, (_, index) => ({
      ...member,
      membership_id: `00000000-0000-4000-8000-${String(index + 601).padStart(12, '0')}`,
      display_name: `Pending source A ${index}`,
      status: 'pending' as const
    }));
    const freshLoader = { ...member, display_name: 'Fresh loader row', status: 'active' as const };
    const refreshedPage = firstPage.map((row) => ({
      ...row,
      display_name: `Fresh ${row.display_name}`
    }));
    const nextPage = [
      { ...member, display_name: 'Fresh next-page row', status: 'pending' as const }
    ];
    mocks.search
      .mockResolvedValueOnce(firstPage)
      .mockReturnValueOnce(page)
      .mockResolvedValueOnce(refreshedPage)
      .mockResolvedValueOnce(nextPage);
    const view = render(
      <I18nextProvider i18n={createI18n('en')}>
        <CommunityAdminScreen screen="members" community={community} members={[member]} />
      </I18nextProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'Pending' }));
    await screen.findByText('Pending source A 0');
    await userEvent.click(screen.getByRole('button', { name: 'LOAD MORE CHANGES' }));
    view.rerender(
      <I18nextProvider i18n={createI18n('en')}>
        <CommunityAdminScreen screen="members" community={community} members={[freshLoader]} />
      </I18nextProvider>
    );
    await screen.findByText('Fresh Pending source A 0');
    const loadMore = screen.getByRole('button', { name: 'LOAD MORE CHANGES' });
    await waitFor(() => expect(loadMore.hasAttribute('disabled')).toBe(false));
    await userEvent.click(loadMore);
    await screen.findByText('Fresh next-page row');
    await act(async () =>
      resolvePage([{ ...member, display_name: 'Old source appended row', status: 'pending' }])
    );
    await waitFor(() => expect(screen.queryByText('Old source appended row')).toBeNull());
    expect(screen.getByText('Fresh next-page row')).toBeTruthy();
  });

  it('characterizes a pending audit page completion crossing a loader refresh', async () => {
    const auditEvent = (id: string, action = 'INSERT') => ({
      id,
      actor_user_id: null,
      entity: 'community_members',
      entity_id: member.membership_id,
      action,
      details: { role: 'member', status: 'pending' },
      occurred_at: '2026-10-01T10:30:00Z'
    });
    let resolvePage!: (rows: ReturnType<typeof auditEvent>[]) => void;
    const page = new Promise<ReturnType<typeof auditEvent>[]>((resolve) => (resolvePage = resolve));
    const initial = [auditEvent('audit-a'), auditEvent('audit-b'), auditEvent('audit-c')];
    const refreshed = [
      auditEvent('audit-new-a'),
      auditEvent('audit-new-b'),
      auditEvent('audit-new-c')
    ];
    mocks.listAudit.mockReturnValueOnce(page);
    const view = render(
      <I18nextProvider i18n={createI18n('en')}>
        <CommunityAdminScreen screen="audit" community={community} audit={initial} />
      </I18nextProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'LOAD MORE CHANGES' }));
    view.rerender(
      <I18nextProvider i18n={createI18n('en')}>
        <CommunityAdminScreen screen="audit" community={community} audit={refreshed} />
      </I18nextProvider>
    );
    const loadMore = screen.getByRole('button', { name: 'LOAD MORE CHANGES' });
    await waitFor(() => expect(loadMore.hasAttribute('disabled')).toBe(false));
    const nextPage = [
      { ...auditEvent('audit-next-page'), details: { role: 'member', status: 'active' } }
    ];
    mocks.listAudit.mockResolvedValueOnce(nextPage);
    await userEvent.click(loadMore);
    await waitFor(() => expect(screen.getAllByTestId('community-audit-event')).toHaveLength(4));
    await act(async () =>
      resolvePage([{ ...auditEvent('audit-old-page'), entity: 'community_venues' }])
    );
    await waitFor(() => expect(screen.getAllByTestId('community-audit-event')).toHaveLength(4));
    expect(screen.queryByText('Venue added')).toBeNull();
    expect(screen.getAllByTestId('community-audit-event')).toHaveLength(4);
  });

  it('releases venue pagination after a loader refresh and accepts the next page', async () => {
    const venue = (id: string, name: string) => ({
      id,
      community_id: community.id,
      name,
      address: null,
      maps_url: null,
      photo_path: null,
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
      archived_at: null
    });
    const firstPage = Array.from({ length: 50 }, (_, index) =>
      venue(
        `00000000-0000-4000-8000-${String(index + 701).padStart(12, '0')}`,
        `Old venue ${index}`
      )
    );
    let resolveOldPage!: (rows: ReturnType<typeof venue>[]) => void;
    const oldPage = new Promise<ReturnType<typeof venue>[]>(
      (resolve) => (resolveOldPage = resolve)
    );
    mocks.listVenues.mockReturnValueOnce(oldPage);
    const view = render(
      <I18nextProvider i18n={createI18n('en')}>
        <CommunityAdminScreen screen="venues" community={community} venues={firstPage} />
      </I18nextProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'LOAD MORE CHANGES' }));
    const freshPage = Array.from({ length: 50 }, (_, index) =>
      venue(
        `00000000-0000-4000-8000-${String(index + 801).padStart(12, '0')}`,
        `Fresh venue ${index}`
      )
    );
    view.rerender(
      <I18nextProvider i18n={createI18n('en')}>
        <CommunityAdminScreen screen="venues" community={community} venues={freshPage} />
      </I18nextProvider>
    );
    const loadMore = screen.getByRole('button', { name: 'LOAD MORE CHANGES' });
    await waitFor(() => expect(loadMore.hasAttribute('disabled')).toBe(false));
    const next = venue('00000000-0000-4000-8000-000000000901', 'Fresh page venue');
    mocks.listVenues.mockResolvedValueOnce([next]);
    await userEvent.click(loadMore);
    await screen.findByText('Fresh page venue');
    await act(async () =>
      resolveOldPage([venue('00000000-0000-4000-8000-000000000902', 'Stale venue')])
    );
    expect(screen.queryByText('Stale venue')).toBeNull();
    expect(screen.getByText('Fresh page venue')).toBeTruthy();
    expect(screen.getAllByTestId('community-venue-card')).toHaveLength(51);
    expect(mocks.listVenues).toHaveBeenCalledTimes(2);
    expect(
      screen
        .getAllByRole('button', { name: 'Archive venue' })
        .every((button) => !button.hasAttribute('disabled'))
    ).toBe(true);
  });

  it('restores demote focus to its own trigger and falls back after successful demotion', async () => {
    const user = userEvent.setup();
    const activeAdmin = { ...member, role: 'admin' as const, status: 'active' as const };
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <CommunityAdminScreen
          screen="member"
          community={community}
          member={activeAdmin}
          membershipId={activeAdmin.membership_id}
        />
      </I18nextProvider>
    );
    const demote = screen.getByRole('button', { name: 'Demote to member' });
    const remove = screen.getByRole('button', { name: 'Remove from community' });
    demote.focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('alertdialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(document.activeElement).toBe(demote);
    demote.focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('alertdialog');
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'CANCEL' })
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(document.activeElement).toBe(demote);
    expect(remove.isConnected).toBe(true);
    await user.click(demote);
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'CONFIRM CHANGE' })
    );
    await waitFor(() => expect(mocks.demote).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Member controls' }));
  });

  it('keeps member actions available across demote-promote and remove-reactivate lifecycles', async () => {
    const user = userEvent.setup();
    const activeAdmin = { ...member, role: 'admin' as const, status: 'active' as const };
    const view = render(
      <I18nextProvider i18n={createI18n('en')}>
        <CommunityAdminScreen
          screen="member"
          community={community}
          member={activeAdmin}
          membershipId={activeAdmin.membership_id}
        />
      </I18nextProvider>
    );
    await user.click(screen.getByRole('button', { name: 'Demote to member' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'CONFIRM CHANGE' })
    );
    await waitFor(() => expect(mocks.demote).toHaveBeenCalledOnce());
    const demoted = { ...activeAdmin, role: 'member' as const };
    view.rerender(
      <I18nextProvider i18n={createI18n('en')}>
        <CommunityAdminScreen
          screen="member"
          community={community}
          member={demoted}
          membershipId={demoted.membership_id}
        />
      </I18nextProvider>
    );
    const promote = screen.getByRole('button', { name: 'Promote to admin' });
    expect(screen.queryByRole('button', { name: 'Demote to member' })).toBeNull();
    await user.click(promote);
    await waitFor(() => expect(mocks.promote).toHaveBeenCalledOnce());
    const promoted = { ...activeAdmin, role: 'admin' as const };
    view.rerender(
      <I18nextProvider i18n={createI18n('en')}>
        <CommunityAdminScreen
          screen="member"
          community={community}
          member={promoted}
          membershipId={promoted.membership_id}
        />
      </I18nextProvider>
    );
    expect(screen.getByRole('button', { name: 'Demote to member' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Remove from community' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'CONFIRM CHANGE' })
    );
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledOnce());
    const inactive = { ...promoted, status: 'inactive' as const };
    view.rerender(
      <I18nextProvider i18n={createI18n('en')}>
        <CommunityAdminScreen
          screen="member"
          community={community}
          member={inactive}
          membershipId={inactive.membership_id}
        />
      </I18nextProvider>
    );
    expect(screen.getByRole('button', { name: 'Reactivate membership' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove from community' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Reactivate membership' }));
    await waitFor(() => expect(mocks.reactivate).toHaveBeenCalledOnce());
    const replacement = { ...member, status: 'active' as const };
    view.rerender(
      <I18nextProvider i18n={createI18n('en')}>
        <CommunityAdminScreen
          screen="member"
          community={community}
          member={replacement}
          membershipId="44444444-4444-4444-8444-444444444444"
        />
      </I18nextProvider>
    );
    expect(screen.getByRole('button', { name: 'Remove from community' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Promote to admin' })).toBeTruthy();
  });

  it('closes a committed removal confirmation when refresh fails and retries refresh only', async () => {
    const user = userEvent.setup();
    mocks.invalidate.mockRejectedValueOnce(new Error('offline'));
    const active = { ...member, status: 'active' as const };
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <CommunityAdminScreen
          screen="member"
          community={community}
          member={active}
          membershipId={active.membership_id}
        />
      </I18nextProvider>
    );
    await user.click(screen.getByRole('button', { name: 'Remove from community' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'CONFIRM CHANGE' })
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(mocks.remove).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'TRY AGAIN' }));
    await waitFor(() => expect(mocks.invalidate).toHaveBeenCalledTimes(2));
    expect(mocks.remove).toHaveBeenCalledOnce();
  });

  it('isolates member search state when switching to settings and back', async () => {
    const view = render(
      <I18nextProvider i18n={createI18n('en')}>
        <CommunityAdminScreen screen="members" community={community} members={[member]} />
      </I18nextProvider>
    );
    const input = screen.getByRole('searchbox', { name: 'Search members' });
    fireEvent.change(input, { target: { value: 'Private query' } });
    await waitFor(() => expect(mocks.search).toHaveBeenCalled());
    const searchCount = mocks.search.mock.calls.length;
    view.rerender(
      <I18nextProvider i18n={createI18n('en')}>
        <CommunityAdminScreen
          screen="settings"
          community={community}
          defaults={{
            timezone: 'Europe/Madrid',
            currency: 'EUR',
            member_created_leagues_enabled: true
          }}
        />
      </I18nextProvider>
    );
    expect(screen.getByRole('combobox', { name: 'Community time zone' })).toBeTruthy();
    expect(screen.getByText('Preference saved; league creation is not supported yet')).toBeTruthy();
    expect(screen.getByTestId('settings-currency-control').textContent).toContain('Euro (EUR)');
    expect(mocks.search).toHaveBeenCalledTimes(searchCount);
    view.rerender(
      <I18nextProvider i18n={createI18n('en')}>
        <CommunityAdminScreen screen="members" community={community} members={[member]} />
      </I18nextProvider>
    );
    expect(screen.getByRole('searchbox', { name: 'Search members' }).value).toBe('');
  });

  it('isolates audit paging state when switching to another screen and back', async () => {
    const event = (id: string) =>
      ({
        id,
        actor_user_id: null,
        entity: 'community_members',
        entity_id: member.membership_id,
        action: 'INSERT',
        details: { role: 'member', status: 'pending' },
        occurred_at: '2026-10-01T10:30:00Z'
      }) as const;
    const firstEvents = [event('audit-first'), event('audit-second'), event('audit-third')];
    const nextEvent = { ...event('audit-appended'), entity: 'community_venues' };
    mocks.listAudit.mockResolvedValueOnce([nextEvent]);
    const view = render(
      <I18nextProvider i18n={createI18n('en')}>
        <CommunityAdminScreen screen="audit" community={community} audit={firstEvents} />
      </I18nextProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'LOAD MORE CHANGES' }));
    await screen.findByText('Venue added');
    const auditCalls = mocks.listAudit.mock.calls.length;
    view.rerender(
      <I18nextProvider i18n={createI18n('en')}>
        <CommunityAdminScreen screen="venues" community={community} venues={[]} />
      </I18nextProvider>
    );
    expect(mocks.listAudit).toHaveBeenCalledTimes(auditCalls);
    view.rerender(
      <I18nextProvider i18n={createI18n('en')}>
        <CommunityAdminScreen screen="audit" community={community} audit={firstEvents} />
      </I18nextProvider>
    );
    expect(screen.queryByText('Venue added')).toBeNull();
    expect(screen.getAllByTestId('community-audit-event')).toHaveLength(3);
  });

  it.each(['en', 'es', 'pt-BR'] as const)(
    'provides localized recoverable error controls (%s)',
    async (locale) => {
      const reset = vi.fn<() => void>();
      let release!: () => void;
      mocks.invalidate.mockReturnValueOnce(new Promise<void>((resolve) => (release = resolve)));
      const user = userEvent.setup();
      const show = (error: Error) =>
        render(
          <I18nextProvider i18n={createI18n(locale)}>
            <CommunityAdminDenied error={error} reset={reset} />
          </I18nextProvider>
        );
      show(new Error('temporary failure'));
      expect(screen.getByRole('button')).toBeTruthy();
      expect(
        screen.getByRole('link', { name: /dashboard|painel|panel/i }).getAttribute('href')
      ).toBe('/dashboard');
      const retry = screen.getByRole('button');
      await user.click(retry);
      await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(true));
      await user.click(retry);
      expect(mocks.invalidate).toHaveBeenCalledOnce();
      expect(reset).not.toHaveBeenCalled();
      await act(async () => release());
      await waitFor(() => expect(reset).toHaveBeenCalledOnce());

      cleanup();
      show(new Error('NOT_COMMUNITY_ADMIN'));
      expect(screen.queryByRole('button')).toBeNull();
      expect(screen.getByRole('link', { name: /dashboard|painel|panel/i })).toBeTruthy();
      cleanup();
      show(new Error('COMMUNITY_MEMBER_NOT_FOUND'));
      expect(screen.queryByRole('button')).toBeNull();
    }
  );

  it('keeps generic loader error visible when retry invalidation fails', async () => {
    mocks.invalidate.mockRejectedValueOnce(new Error('offline'));
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <CommunityAdminDenied error={new Error('temporary failure')} reset={vi.fn<() => void>()} />
      </I18nextProvider>
    );
    await userEvent.click(screen.getByRole('button'));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button')).toBeTruthy();
  });
});
