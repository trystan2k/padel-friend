/** @vitest-environment jsdom */
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import { createI18n } from '../src/i18n/config';
import { CommunityOnboarding } from '../src/features/community/CommunityOnboarding';
import type { PublicCommunity } from '../src/features/community/community.validators';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn<() => void>(),
  invalidate: vi.fn<() => void>(),
  join: vi.fn<() => Promise<unknown>>(),
  create: vi.fn<() => Promise<unknown>>(),
  list: vi.fn<() => Promise<unknown>>()
}));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
  useRouter: () => ({ invalidate: mocks.invalidate })
}));
vi.mock('../src/features/community/community.functions', () => ({
  joinCommunity: mocks.join,
  createCommunity: mocks.create,
  listPublicCommunities: mocks.list
}));

const row: PublicCommunity = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Madrid Collective',
  city_label: 'Chamberí',
  description: null,
  logo_path: null,
  visibility: 'public',
  join_policy: 'instant',
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z'
};

function mount(
  view?: 'create',
  data = {
    communities: [
      row,
      {
        ...row,
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Retiro',
        city_label: 'Retiro',
        join_policy: 'admin_approval' as const
      }
    ],
    next_offset: null,
    failed: false
  }
) {
  return render(
    <I18nextProvider i18n={createI18n('en')}>
      <CommunityOnboarding search={view ? { view } : {}} data={data} />
    </I18nextProvider>
  );
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
});
afterEach(cleanup);

describe('community onboarding', () => {
  it('shows real city and policy only, joins with server-authoritative outcomes and supports skip', async () => {
    mocks.join
      .mockResolvedValueOnce({ status: 'active' })
      .mockResolvedValueOnce({ status: 'pending' });
    mount();
    expect(screen.getByText('Chamberí · Open join')).toBeTruthy();
    expect(screen.getByText('Retiro · Approval required')).toBeTruthy();
    expect(screen.queryByText(/members|typical player level/i)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'JOIN COMMUNITY' }));
    await waitFor(() => expect(screen.getByText('Joined community')).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: 'REQUEST TO JOIN' }));
    await waitFor(() => expect(screen.getByText('Request sent')).toBeTruthy());
    expect(mocks.join).toHaveBeenCalledTimes(2);
    expect(mocks.join).toHaveBeenCalledWith({ data: { community_id: row.id } });
    await userEvent.click(screen.getByRole('button', { name: 'I’LL DO THIS LATER' }));
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/dashboard' });
  });

  it('debounces name or city search, leaves skip available on list failure', async () => {
    const user = userEvent.setup();
    mount(undefined, { communities: [], next_offset: null, failed: true });
    expect(screen.getByRole('alert').textContent).toContain('Could not load');
    await user.click(screen.getByRole('button', { name: 'TRY AGAIN' }));
    expect(mocks.invalidate).toHaveBeenCalledOnce();
    await user.type(screen.getByRole('searchbox', { name: 'Search community' }), 'Madrid');
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: '/onboarding/community',
        search: { q: 'Madrid' },
        replace: true
      })
    );
    await user.click(screen.getByRole('button', { name: 'I’LL DO THIS LATER' }));
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/dashboard' });
  });

  it('keeps focus and newer draft through query responses, and retains membership by id', async () => {
    const user = userEvent.setup();
    mocks.join.mockResolvedValue({ status: 'active' });
    const i18n = createI18n('en');
    const initial = { communities: [row], next_offset: null, failed: false };
    const view = (q: string | undefined, data = initial) => (
      <I18nextProvider i18n={i18n}>
        <CommunityOnboarding search={q ? { q } : {}} data={data} />
      </I18nextProvider>
    );
    const mounted = render(view(undefined));
    const input = screen.getByRole('searchbox', { name: 'Search community' });
    await user.click(screen.getByRole('button', { name: 'JOIN COMMUNITY' }));
    await waitFor(() => expect(screen.getByText('Joined community')).toBeTruthy());
    await user.click(input);
    await user.type(input, 'Mad');
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: '/onboarding/community',
        search: { q: 'Mad' },
        replace: true
      })
    );
    mounted.rerender(view('Mad', initial));
    expect(document.activeElement).toBe(input);
    await user.type(input, 'rid');
    mounted.rerender(view('Mad', { communities: [], next_offset: null, failed: false }));
    expect(input).toHaveProperty('value', 'Madrid');
    expect(document.activeElement).toBe(input);
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: '/onboarding/community',
        search: { q: 'Madrid' },
        replace: true
      })
    );
    mounted.rerender(view('Madrid', initial));
    expect(screen.getByText('Joined community')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'JOIN COMMUNITY' }).hasAttribute('disabled')).toBe(
      true
    );
  });

  it('does not restore a pending search after the user clears its draft', async () => {
    const user = userEvent.setup();
    const i18n = createI18n('en');
    const data = { communities: [], next_offset: null, failed: false };
    const view = (q?: string) => (
      <I18nextProvider i18n={i18n}>
        <CommunityOnboarding search={q ? { q } : {}} data={data} />
      </I18nextProvider>
    );
    const mounted = render(view());
    const input = screen.getByRole('searchbox', { name: 'Search community' });
    await user.type(input, 'Mad');
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: '/onboarding/community',
        search: { q: 'Mad' },
        replace: true
      })
    );
    await user.clear(input);
    mounted.rerender(view('Mad'));
    expect(input).toHaveProperty('value', '');
    expect(document.activeElement).toBe(input);
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: '/onboarding/community',
        search: {},
        replace: true
      })
    );
    mounted.rerender(view());
    expect(input).toHaveProperty('value', '');
    expect(document.activeElement).toBe(input);
  });

  it('restores a history query after Create consumes an unsent draft, rejecting late search', async () => {
    const user = userEvent.setup();
    const i18n = createI18n('en');
    const data = { communities: [], next_offset: null, failed: false };
    const view = (q: string, create = false) => (
      <I18nextProvider i18n={i18n}>
        <CommunityOnboarding
          search={{ q, ...(create ? { view: 'create' as const } : {}) }}
          data={data}
        />
      </I18nextProvider>
    );
    const mounted = render(view('Mad'));
    await user.type(screen.getByRole('searchbox', { name: 'Search community' }), 'rid');
    await user.click(screen.getByRole('button', { name: /CREATE A COMMUNITY/ }));
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/onboarding/community',
      search: { q: 'Madrid', view: 'create' }
    });
    mounted.rerender(view('Madrid', true));
    window.dispatchEvent(new PopStateEvent('popstate'));
    mounted.rerender(view('Mad'));
    expect(screen.getByRole('searchbox', { name: 'Search community' })).toHaveProperty(
      'value',
      'Mad'
    );
    mounted.rerender(view('Madrid'));
    expect(screen.getByRole('searchbox', { name: 'Search community' })).toHaveProperty(
      'value',
      'Mad'
    );
    mounted.rerender(view('Mad'));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
  });

  it('resumes pagination after a successful same-query loader retry', async () => {
    const i18n = createI18n('en');
    const first = { communities: [row], next_offset: 20, failed: false };
    const refreshed = { ...first };
    const view = (data: typeof first) => (
      <I18nextProvider i18n={i18n}>
        <CommunityOnboarding search={{}} data={data} />
      </I18nextProvider>
    );
    mocks.list.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce({
      communities: [],
      next_offset: null
    });
    const mounted = render(view(first));
    await userEvent.click(screen.getByRole('button', { name: 'LOAD MORE' }));
    expect(await screen.findByText('Could not load communities.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'TRY AGAIN' }));
    expect(mocks.invalidate).toHaveBeenCalledOnce();
    mounted.rerender(view(refreshed));
    await userEvent.click(screen.getByRole('button', { name: 'LOAD MORE' }));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    expect(mocks.list).toHaveBeenLastCalledWith({ data: { offset: 20, limit: 20 } });
  });

  it('opens a fresh create form after success and return to discovery', async () => {
    const i18n = createI18n('en');
    const data = { communities: [], next_offset: null, failed: false };
    const view = (create: boolean) => (
      <I18nextProvider i18n={i18n}>
        <CommunityOnboarding search={create ? { view: 'create' } : {}} data={data} />
      </I18nextProvider>
    );
    mocks.create.mockResolvedValue({ id: row.id });
    const mounted = render(view(false));
    mounted.rerender(view(true));
    await userEvent.type(screen.getByRole('textbox', { name: 'COMMUNITY NAME' }), 'First club');
    await userEvent.click(screen.getByRole('button', { name: 'CREATE COMMUNITY' }));
    expect(await screen.findByText('Your community is ready.')).toBeTruthy();
    mounted.rerender(view(false));
    mounted.rerender(view(true));
    expect(screen.queryByText('Your community is ready.')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'COMMUNITY NAME' })).toHaveProperty('value', '');
    expect(screen.getByRole('button', { name: 'CREATE COMMUNITY' })).toBeTruthy();
  });

  it('retries a failed join and accepts the next server outcome', async () => {
    mocks.join
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce({ status: 'pending' });
    mount();
    const button = screen.getByRole('button', { name: 'JOIN COMMUNITY' });
    await userEvent.click(button);
    expect(await screen.findByText('Could not join. Please try again.')).toBeTruthy();
    await userEvent.click(button);
    await waitFor(() => expect(screen.getByText('Request sent')).toBeTruthy());
    expect(mocks.join).toHaveBeenCalledTimes(2);
  });

  it('validates name, maps visibility to join policy and omits blank optional fields', async () => {
    const user = userEvent.setup();
    mocks.create.mockResolvedValue({ id: row.id });
    mount('create');
    await user.click(screen.getByRole('button', { name: 'CREATE COMMUNITY' }));
    expect(screen.getByRole('alert').textContent).toContain('Enter a community name');
    expect(mocks.create).not.toHaveBeenCalled();
    await user.type(screen.getByRole('textbox', { name: 'COMMUNITY NAME' }), '  Northside  ');
    await user.click(screen.getByRole('radio', { name: /Private/ }));
    await user.type(screen.getByRole('textbox', { name: 'City or area' }), 'Madrid');
    fireEvent.submit(screen.getByRole('button', { name: 'CREATE COMMUNITY' }).closest('form')!);
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        data: {
          name: 'Northside',
          visibility: 'private',
          join_policy: 'admin_approval',
          city_label: 'Madrid'
        }
      })
    );
    expect(await screen.findByText('Your community is ready.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'GO TO DASHBOARD' }));
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/dashboard' });
  });

  it('reports duplicate membership and create errors without claiming success', async () => {
    mocks.join.mockRejectedValue(new Error('ALREADY_MEMBER_OR_PENDING'));
    const view = mount();
    await userEvent.click(screen.getByRole('button', { name: 'JOIN COMMUNITY' }));
    expect(await screen.findByText('Already a member or request pending')).toBeTruthy();
    view.unmount();
    mocks.create.mockRejectedValue(new Error('unavailable'));
    mount('create');
    await userEvent.type(screen.getByRole('textbox', { name: 'COMMUNITY NAME' }), 'Northside');
    await userEvent.click(screen.getByRole('button', { name: 'CREATE COMMUNITY' }));
    expect(await screen.findByText('Could not create community. Please try again.')).toBeTruthy();
  });

  it('shows inactive membership as terminal instead of offering a retry', async () => {
    mocks.join.mockRejectedValue(new Error('MEMBERSHIP_INACTIVE'));
    mount();
    const button = screen.getByRole('button', { name: 'JOIN COMMUNITY' });
    await userEvent.click(button);
    expect(
      await screen.findByText(
        'Your membership is inactive. Contact a community Admin to reactivate it.'
      )
    ).toBeTruthy();
    expect(button.hasAttribute('disabled')).toBe(true);
    await userEvent.click(button);
    expect(mocks.join).toHaveBeenCalledOnce();
  });
});
