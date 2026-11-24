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
  list: vi.fn<() => Promise<unknown>>(),
  routerState: { pending: false }
}));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
  useRouter: () => ({ invalidate: mocks.invalidate }),
  useRouterState: ({
    select
  }: {
    select: (state: {
      matches: { routeId: string; status: string; isFetching: boolean }[];
    }) => unknown;
  }) =>
    select({
      matches: mocks.routerState.pending
        ? [{ routeId: '/onboarding_/community', status: 'pending', isFetching: true }]
        : []
    })
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
  member_count: 3,
  join_policy: 'instant',
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z'
};

function mount(
  view?: 'create',
  data: {
    communities: PublicCommunity[];
    next_offset: number | null;
    failed: boolean;
  } = {
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
  },
  next?: string,
  locale: 'en' | 'pt-BR' | 'es' = 'en'
) {
  return render(
    <I18nextProvider i18n={createI18n(locale)}>
      <CommunityOnboarding search={view ? { view } : {}} data={data} next={next} />
    </I18nextProvider>
  );
}

beforeEach(() => {
  mocks.navigate.mockReset();
  mocks.invalidate.mockReset();
  mocks.join.mockReset();
  mocks.create.mockReset();
  mocks.list.mockReset();
  mocks.routerState.pending = false;
});
afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

describe('community onboarding', () => {
  it.each(['en', 'pt-BR', 'es'] as const)(
    'renders labeled discovery and creation landmarks in %s',
    (locale) => {
      const { t } = createI18n(locale);
      const discovery = mount(undefined, undefined, undefined, locale);
      expect(screen.getByRole('main').dataset.communityScreen).toBe('discovery');
      expect(
        screen.getByRole('heading', { level: 1, name: t('communityOnboarding.lead') })
      ).toBeTruthy();
      const search = screen.getByRole('searchbox', { name: t('communityOnboarding.searchLabel') });
      expect(search.closest('search')).not.toBeNull();
      expect(screen.getByText(t('communityOnboarding.step')).getAttribute('aria-current')).toBe(
        'step'
      );
      // dSEX3: the sticky footer always carries Finish (once) beside the skip action, and the top
      // bar a Back target that leaves for the validated return path.
      expect(screen.getAllByRole('button', { name: t('communityOnboarding.done') })).toHaveLength(
        1
      );
      expect(
        screen.getByRole('button', { name: t('communityOnboarding.discoveryBack') })
      ).toBeTruthy();
      discovery.unmount();
      mount('create', undefined, undefined, locale);
      expect(screen.getByRole('main').dataset.communityScreen).toBe('creation');
      expect(
        screen.getByRole('heading', { level: 1, name: t('communityOnboarding.createLead') })
      ).toBeTruthy();
      expect(
        screen.getByRole('radiogroup', { name: t('communityOnboarding.visibilityLegend') })
      ).toBeTruthy();
      expect(
        screen.getByRole('textbox', { name: t('communityOnboarding.nameLabel') })
      ).toHaveProperty('required', true);
    }
  );
  it.each([
    [
      'COMMUNITY_CREATE_RATE_LIMITED',
      'You have created too many communities recently. Try again later.'
    ],
    [
      'COMMUNITY_OWNED_LIMIT_REACHED',
      'You have reached the maximum number of communities you can own.'
    ]
  ])('localizes %s without showing the database code', async (code, copy) => {
    mocks.create.mockRejectedValue(new Error(code));
    mount('create');
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Northside');
    await userEvent.click(screen.getByRole('button', { name: 'Create community' }));
    expect((await screen.findByRole('alert')).textContent).toBe(copy);
    expect(screen.queryByText(code)).toBeNull();
  });

  it('rejects offline join at invocation and never replays on reconnect', async () => {
    mount();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(screen.getByText(/Offline. Nothing sent/)).toBeTruthy();
    expect(mocks.join).not.toHaveBeenCalled();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    fireEvent(window, new Event('online'));
    expect(mocks.join).not.toHaveBeenCalled();
  });
  it('keeps search draft and shows unconfirmed state after false-online/lost-ack join', async () => {
    mocks.join.mockRejectedValue(new TypeError('Failed to fetch'));
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    await screen.findByText(/Could not confirm this change/);
    expect(screen.queryByText('Joined')).toBeNull();
    fireEvent(window, new Event('online'));
    expect(mocks.join).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Join' }).hasAttribute('disabled')).toBe(false);
  });
  it.each(['en', 'pt-BR', 'es'] as const)(
    'formats zero, singular and large discovery counts in %s',
    (locale) => {
      const i18n = createI18n(locale);
      const values = [0, 1, 1240];
      const communities = values.map((member_count, index) => ({
        ...row,
        id: `${index + 1}1111111-1111-4111-8111-111111111111`,
        name: `Count fixture ${index}`,
        member_count
      }));
      render(
        <I18nextProvider i18n={i18n}>
          <CommunityOnboarding
            search={{}}
            data={{ communities, next_offset: null, failed: false }}
          />
        </I18nextProvider>
      );
      for (const count of values) {
        const formattedCount = new Intl.NumberFormat(i18n.resolvedLanguage).format(count);
        expect(
          screen.getByText(i18n.t('communityOnboarding.memberCount', { count, formattedCount }))
        ).toBeTruthy();
      }
    }
  );

  it('shows a discovery error without fabricating a zero count', () => {
    const i18n = createI18n('en');
    render(
      <I18nextProvider i18n={i18n}>
        <CommunityOnboarding
          search={{}}
          data={{ communities: [], next_offset: null, failed: true }}
        />
      </I18nextProvider>
    );
    expect(screen.getByRole('alert').textContent).toBe(i18n.t('communityOnboarding.loadFailed'));
    expect(screen.queryByText(/0 members/)).toBeNull();
  });

  it.each(['en', 'pt-BR', 'es'] as const)(
    'announces draft and route pending state in %s, keeps search focused and suppresses empty results',
    async (locale) => {
      const i18n = createI18n(locale);
      const data = { communities: [], next_offset: null, failed: false };
      const view = (q?: string) => (
        <I18nextProvider i18n={i18n}>
          <CommunityOnboarding search={q ? { q } : {}} data={data} />
        </I18nextProvider>
      );
      const mounted = render(view());
      const input = screen.getByRole('searchbox', {
        name: i18n.t('communityOnboarding.searchLabel')
      });
      await userEvent.type(input, 'No match');
      expect(screen.getByRole('status').textContent).toBe(
        i18n.t('communityOnboarding.searchLoading')
      );
      expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
      expect(input.hasAttribute('disabled')).toBe(false);
      expect(document.activeElement).toBe(input);
      mocks.routerState.pending = true;
      mounted.rerender(view('No match'));
      expect(screen.getByRole('status').textContent).toBe(
        i18n.t('communityOnboarding.searchLoading')
      );
      expect(screen.queryByText(i18n.t('communityOnboarding.emptySearch'))).toBeNull();
      expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
      expect(screen.getByRole('status').closest('[aria-busy="true"]')).toBeNull();
      mocks.routerState.pending = false;
      mounted.rerender(view('No match'));
      expect(screen.queryByText(i18n.t('communityOnboarding.searchLoading'))).toBeNull();
      expect(document.activeElement).toBe(input);
    }
  );

  it.each(['en', 'pt-BR', 'es'] as const)(
    'keeps filled optional labels visible in %s',
    async (locale) => {
      const i18n = createI18n(locale);
      render(
        <I18nextProvider i18n={i18n}>
          <CommunityOnboarding
            search={{ view: 'create' }}
            data={{ communities: [], next_offset: null, failed: false }}
          />
        </I18nextProvider>
      );
      const description = screen.getByLabelText(i18n.t('communityOnboarding.descriptionLabel'));
      const city = screen.getByLabelText(i18n.t('communityOnboarding.cityLabel'));
      if (!(description instanceof HTMLInputElement) || !(city instanceof HTMLInputElement))
        throw new TypeError('Expected input elements');
      await userEvent.type(description, 'Description');
      await userEvent.type(city, 'Lisbon');
      expect(description.id).toBe('community-description');
      expect(city.id).toBe('community-city');
      expect(description.value).toBe('Description');
      expect(city.value).toBe('Lisbon');
      expect(description.labels?.[0]?.htmlFor).toBe(description.id);
      expect(city.labels?.[0]?.htmlFor).toBe(city.id);
    }
  );

  it('blocks duplicate retry while same-route invalidation is fetching and retains load-more busy state', async () => {
    const i18n = createI18n('en');
    const failed = { communities: [], next_offset: null, failed: true };
    const view = () => (
      <I18nextProvider i18n={i18n}>
        <CommunityOnboarding search={{}} data={failed} />
      </I18nextProvider>
    );
    const mounted = render(view());
    mocks.routerState.pending = true;
    mounted.rerender(view());
    const retry = screen.getByRole('button', { name: i18n.t('communityOnboarding.retry') });
    expect(retry.hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('status')).toBeTruthy();
    mocks.routerState.pending = false;
    mounted.rerender(view());
    expect(
      screen
        .getByRole('button', { name: i18n.t('communityOnboarding.retry') })
        .hasAttribute('disabled')
    ).toBe(false);
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });

  it('keeps load more busy until its page promise settles', async () => {
    let finish!: (value: { communities: PublicCommunity[]; next_offset: null }) => void;
    mocks.list.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    mount(undefined, { communities: [row], next_offset: 20, failed: false });
    const button = screen.getByRole('button', { name: 'Load more' });
    await userEvent.click(button);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(true);
    finish({ communities: [], next_offset: null });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull());
  });

  it('shows real city and policy only, joins with server-authoritative outcomes and supports skip', async () => {
    mocks.join
      .mockResolvedValueOnce({ status: 'active' })
      .mockResolvedValueOnce({ status: 'pending' });
    mount();
    expect(screen.getByText('Chamberí · Open join')).toBeTruthy();
    expect(screen.getByText('Retiro · Approval required')).toBeTruthy();
    expect(screen.getAllByText('3 members')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Join' }));
    await waitFor(() => expect(screen.getByText('Joined community')).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: 'Request' }));
    await waitFor(() => expect(screen.getByText('Request sent')).toBeTruthy());
    expect(mocks.join).toHaveBeenCalledTimes(2);
    expect(mocks.join).toHaveBeenCalledWith({ data: { community_id: row.id } });
    await userEvent.click(screen.getByRole('button', { name: 'I’ll do this later' }));
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/dashboard' });
  });

  it('debounces name or city search, leaves skip available on list failure', async () => {
    const user = userEvent.setup();
    mount(undefined, { communities: [], next_offset: null, failed: true });
    expect(screen.getByRole('alert').textContent).toContain('Could not load');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(mocks.invalidate).toHaveBeenCalledOnce();
    await user.type(screen.getByRole('searchbox', { name: 'Search community' }), 'Madrid');
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: '/onboarding/community',
        search: { q: 'Madrid' },
        replace: true
      })
    );
    await user.click(screen.getByRole('button', { name: 'I’ll do this later' }));
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/dashboard' });
  });

  it('omits the default dashboard next and preserves real match deep links in navigation', async () => {
    const user = userEvent.setup();
    const data = { communities: [], next_offset: null, failed: false };
    const defaultMounted = mount(undefined, data, '/dashboard');
    await user.type(screen.getByRole('searchbox', { name: 'Search community' }), 'Madrid');
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: '/onboarding/community',
        search: { q: 'Madrid' },
        replace: true
      })
    );
    await user.click(screen.getByRole('button', { name: /Create a community/ }));
    expect(mocks.navigate).toHaveBeenLastCalledWith({
      to: '/onboarding/community',
      search: { q: 'Madrid', view: 'create' }
    });
    defaultMounted.unmount();

    mocks.navigate.mockClear();
    const deepLink = '/matches/123e4567-e89b-42d3-a456-426614174000';
    const deepMounted = mount(undefined, data, deepLink);
    await user.click(screen.getByRole('button', { name: /Create a community/ }));
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/onboarding/community',
      search: { view: 'create', next: deepLink }
    });
    deepMounted.unmount();
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
    await user.click(screen.getByRole('button', { name: 'Join' }));
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
    expect(screen.getByRole('button', { name: 'Join' }).hasAttribute('disabled')).toBe(true);
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
    await user.click(screen.getByRole('button', { name: /Create a community/ }));
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
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Could not load communities.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(mocks.invalidate).toHaveBeenCalledOnce();
    mounted.rerender(view(refreshed));
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
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
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'First club');
    await userEvent.click(screen.getByRole('button', { name: 'Create community' }));
    expect(await screen.findByText('Your community is ready.')).toBeTruthy();
    mounted.rerender(view(false));
    mounted.rerender(view(true));
    expect(screen.queryByText('Your community is ready.')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveProperty('value', '');
    expect(screen.getByRole('button', { name: 'Create community' })).toBeTruthy();
  });

  it('retries a failed join and accepts the next server outcome', async () => {
    mocks.join
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce({ status: 'pending' });
    mount();
    const button = screen.getByRole('button', { name: 'Join' });
    await userEvent.click(button);
    expect(await screen.findByText(/Could not confirm this change/)).toBeTruthy();
    await userEvent.click(button);
    await waitFor(() => expect(screen.getByText('Request sent')).toBeTruthy());
    expect(mocks.join).toHaveBeenCalledTimes(2);
  });

  it('validates name, maps visibility to join policy and omits blank optional fields', async () => {
    const user = userEvent.setup();
    mocks.create.mockResolvedValue({ id: row.id });
    mount('create');
    await user.click(screen.getByRole('button', { name: 'Create community' }));
    expect(screen.getByRole('alert').textContent).toContain('Enter a community name');
    expect(mocks.create).not.toHaveBeenCalled();
    await user.type(screen.getByRole('textbox', { name: 'Name' }), '  Northside  ');
    await user.click(screen.getByRole('radio', { name: /Private/ }));
    await user.type(screen.getByRole('textbox', { name: 'City or area' }), 'Madrid');
    fireEvent.submit(screen.getByRole('button', { name: 'Create community' }).closest('form')!);
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
    await user.click(screen.getByRole('button', { name: 'Go to dashboard' }));
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/dashboard' });
  });

  it('reports duplicate membership and create errors without claiming success', async () => {
    mocks.join.mockRejectedValue(new Error('ALREADY_MEMBER_OR_PENDING'));
    const view = mount();
    await userEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(await screen.findByText('Already a member or request pending')).toBeTruthy();
    view.unmount();
    mocks.create.mockRejectedValue(new Error('unavailable'));
    mount('create');
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Northside');
    await userEvent.click(screen.getByRole('button', { name: 'Create community' }));
    expect(await screen.findByText('Could not create community. Please try again.')).toBeTruthy();
  });

  it('shows inactive membership as terminal instead of offering a retry', async () => {
    mocks.join.mockRejectedValue(new Error('MEMBERSHIP_INACTIVE'));
    mount();
    const button = screen.getByRole('button', { name: 'Join' });
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
