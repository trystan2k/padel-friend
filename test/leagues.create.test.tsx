/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n, type Locale } from '../src/i18n/config';
import en from '../src/locales/en/translation.json';
import es from '../src/locales/es/translation.json';
import pt from '../src/locales/pt-BR/translation.json';

const mocks = vi.hoisted(() => ({
  createLeague: vi.fn<(request: { data: Record<string, unknown> }) => Promise<{ id: string }>>(),
  navigate: vi.fn<(options: Record<string, unknown>) => Promise<void>>()
}));
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  Link: ({ children, to, params, ...rest }: any) => (
    <a
      href={String(to)
        .replace('$communityId', params?.communityId ?? '')
        .replace('$leagueId', params?.leagueId ?? '')}
      {...rest}
    >
      {children}
    </a>
  ),
  useNavigate: () => mocks.navigate
}));
vi.mock('../src/features/leagues/league.functions', () => ({
  createLeague: mocks.createLeague
}));

import { CreateLeaguePage } from '../src/features/leagues/CreateLeaguePage';
import { LEAGUE_COMMUNITY_ID, makeLeagueDto, makeLeagueList } from './helpers/league-dto-fixtures';

const today = '2030-06-15';

function renderPage(data = makeLeagueList(), locale: Locale = 'en') {
  return render(
    <I18nextProvider i18n={createI18n(locale)}>
      <CreateLeaguePage data={data} today={today} />
    </I18nextProvider>
  );
}

const name = () => screen.getByLabelText(/League name|Nome da Liga|Nombre de la Liga/);

describe('League creation page', () => {
  beforeEach(() => {
    mocks.createLeague.mockReset().mockResolvedValue({ id: 'new-league' });
    mocks.navigate.mockReset().mockResolvedValue();
  });
  afterEach(cleanup);

  it('matches the Pencil composition: header, name, dates card, minimum, create action, guidance', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Create a League' })).toBeTruthy();
    expect(screen.getByText('Pádel & Amigos · one active League at a time')).toBeTruthy();
    const order = [
      name(),
      screen.getByRole('radio', { name: /Fixed end date/ }),
      screen.getByLabelText(/Start date/),
      screen.getByLabelText(/End date/),
      screen.getByLabelText(/Minimum matches for final award/),
      screen.getByRole('button', { name: 'Create League' }),
      screen.getByText(
        'Fixed End Date must follow start date. Only one Active League per community.'
      )
    ];
    order
      .slice(1)
      .forEach((node, index) =>
        expect(
          order[index]!.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy()
      );
    // Defaults: Fixed End Date selected, starts today, minimum matches 1.
    expect(screen.getByRole('radio', { name: /Fixed end date/ }).getAttribute('aria-checked')).toBe(
      'true'
    );
    expect(screen.getByLabelText<HTMLInputElement>(/Start date/).value).toBe(today);
    expect(screen.getByLabelText<HTMLInputElement>(/Minimum matches for final award/).value).toBe(
      '1'
    );
  });

  it('shows the live date summary for both modes', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText(/End date/), '2030-09-15');
    expect(screen.getByText('Starts Jun 15, 2030 · Ends Sep 15, 2030')).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: /Open-ended · manual/ }));
    expect(screen.getByText('Starts Jun 15, 2030 · No end date')).toBeTruthy();
    expect(screen.queryByLabelText(/End date/)).toBeNull();
  });

  it('creates a Fixed End Date League and opens it', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(name(), '  Autumn League ');
    await user.type(screen.getByLabelText(/Description/), 'Weekly ladder');
    await user.type(screen.getByLabelText(/End date/), '2030-09-15');
    await user.click(screen.getByRole('button', { name: 'Create League' }));
    await waitFor(() => expect(mocks.createLeague).toHaveBeenCalledTimes(1));
    expect(mocks.createLeague.mock.calls[0]![0].data).toEqual({
      request_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      community_id: LEAGUE_COMMUNITY_ID,
      name: 'Autumn League',
      description: 'Weekly ladder',
      end_mode: 'fixed_date',
      start_date: today,
      end_date: '2030-09-15',
      minimum_matches: 1
    });
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: '/community/$communityId/leagues/$leagueId',
        params: { communityId: LEAGUE_COMMUNITY_ID, leagueId: 'new-league' }
      })
    );
  });

  it('creates a Manual End League with no end date and a custom minimum', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(name(), 'Open ladder');
    await user.click(screen.getByRole('radio', { name: /Open-ended · manual/ }));
    await user.clear(screen.getByLabelText(/Minimum matches for final award/));
    await user.type(screen.getByLabelText(/Minimum matches for final award/), '5');
    await user.click(screen.getByRole('button', { name: 'Create League' }));
    await waitFor(() => expect(mocks.createLeague).toHaveBeenCalled());
    expect(mocks.createLeague.mock.calls[0]![0].data).toMatchObject({
      end_mode: 'manual',
      end_date: null,
      description: null,
      minimum_matches: 5
    });
  });

  it('rejects an empty submission, names each error and focuses the first invalid field', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Create League' }));
    expect(mocks.createLeague).not.toHaveBeenCalled();
    expect(await screen.findByText('Enter a League name.')).toBeTruthy();
    expect(screen.getByText('Fixed End Date requires an end date.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(name()));
    expect(name().getAttribute('aria-invalid')).toBe('true');
    const describedBy = name().getAttribute('aria-describedby') ?? '';
    expect(
      describedBy
        .split(' ')
        .some((id) => document.getElementById(id)?.textContent === 'Enter a League name.')
    ).toBe(true);
  });

  it('rejects an end date that is before or equal to the start date and focuses it', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(name(), 'Autumn League');
    await user.type(screen.getByLabelText(/End date/), '2030-06-01');
    await user.click(screen.getByRole('button', { name: 'Create League' }));
    expect(await screen.findByText('End date must be later than start date.')).toBeTruthy();
    expect(mocks.createLeague).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/End date/)));
  });

  it('rejects a start date in the past', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(name(), 'Autumn League');
    const start = screen.getByLabelText(/Start date/);
    await user.clear(start);
    await user.type(start, '2030-06-01');
    await user.type(screen.getByLabelText(/End date/), '2030-09-01');
    await user.click(screen.getByRole('button', { name: 'Create League' }));
    expect(await screen.findByText('The start date cannot be in the past.')).toBeTruthy();
    expect(mocks.createLeague).not.toHaveBeenCalled();
  });

  it('maps a server date rejection to the date field and other rejections to an alert', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(name(), 'Autumn League');
    await user.type(screen.getByLabelText(/End date/), '2030-09-15');
    mocks.createLeague.mockRejectedValueOnce(new Error('LEAGUE_END_NOT_AFTER_START'));
    await user.click(screen.getByRole('button', { name: 'Create League' }));
    expect(await screen.findByText('End date must be later than start date.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/End date/)));

    mocks.createLeague.mockRejectedValueOnce(new Error('LEAGUE_CREATION_DISABLED'));
    await user.click(screen.getByRole('button', { name: 'Create League' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('League creation is turned off for members. Ask an Admin.');
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('replays the same request id for an identical retry and issues a new one for edited input', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(name(), 'Autumn League');
    await user.type(screen.getByLabelText(/End date/), '2030-09-15');
    mocks.createLeague.mockRejectedValue(new Error('LEAGUE_UNAVAILABLE'));
    await user.click(screen.getByRole('button', { name: 'Create League' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Create League' }));
    await waitFor(() => expect(mocks.createLeague).toHaveBeenCalledTimes(2));
    const [first, second] = mocks.createLeague.mock.calls.map((call) => call[0].data.request_id);
    expect(second).toBe(first);
    await user.type(name(), ' 2');
    await user.click(screen.getByRole('button', { name: 'Create League' }));
    await waitFor(() => expect(mocks.createLeague).toHaveBeenCalledTimes(3));
    expect(mocks.createLeague.mock.calls[2]![0].data.request_id).not.toBe(first);
  });

  it('shows the one-Active guidance with a link to the Active League', () => {
    renderPage(
      makeLeagueList([
        makeLeagueDto({
          id: 'a1111111-1111-4111-8111-111111111111',
          name: 'Summer Ladder',
          status: 'active'
        })
      ])
    );
    const note = screen.getByRole('note');
    expect(within(note).getByText('Summer Ladder · ACTIVE')).toBeTruthy();
    expect(
      within(note).getByText(
        'This community already has one Active League. A League starting now cannot activate while it remains Active.'
      )
    ).toBeTruthy();
    expect(within(note).getByRole('link', { name: /Review Active League/ })).toBeTruthy();
  });

  it('replaces the form with guidance when members may not create Leagues', () => {
    renderPage(makeLeagueList([], { creation_enabled: false, can_create: false }));
    expect(screen.queryByRole('button', { name: 'Create League' })).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain(
      'League creation is turned off for members'
    );
  });

  it('renders the translated form in Portuguese and Spanish', () => {
    renderPage(makeLeagueList(), 'pt-BR');
    expect(screen.getByRole('heading', { level: 1, name: 'Criar uma Liga' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Criar Liga' })).toBeTruthy();
    cleanup();
    renderPage(makeLeagueList(), 'es');
    expect(screen.getByRole('heading', { level: 1, name: 'Crear una Liga' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Crear Liga' })).toBeTruthy();
  });
});

describe('League i18n and styling contracts', () => {
  const paths = (value: unknown, prefix = ''): string[] =>
    value !== null && typeof value === 'object'
      ? Object.entries(value).flatMap(([key, child]) =>
          paths(child, prefix ? `${prefix}.${key}` : key)
        )
      : [prefix];
  const placeholders = (value: unknown): Record<string, string[]> =>
    Object.fromEntries(
      paths(value).map((path) => {
        const text = path.split('.').reduce<any>((node, key) => node[key], value);
        return [
          path,
          [...String(text).matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((m) => m[1]!).sort()
        ];
      })
    );

  it('has the same League keys and interpolation variables in en, pt-BR and es', () => {
    const base = paths(en.leagues).sort();
    expect(base.length).toBeGreaterThan(80);
    expect(paths(pt.leagues).sort()).toEqual(base);
    expect(paths(es.leagues).sort()).toEqual(base);
    expect(placeholders(pt.leagues)).toEqual(placeholders(en.leagues));
    expect(placeholders(es.leagues)).toEqual(placeholders(en.leagues));
  });

  it('translates every error code a command can return, with no empty strings', () => {
    const codes = [
      'UNAUTHENTICATED',
      'LEAGUE_FORBIDDEN',
      'LEAGUE_CREATION_DISABLED',
      'PROVISIONAL_PLAYER_RESTRICTED',
      'LEAGUE_NOT_FOUND',
      'LEAGUE_NAME_INVALID',
      'LEAGUE_DESCRIPTION_INVALID',
      'LEAGUE_MINIMUM_INVALID',
      'LEAGUE_END_MODE_INVALID',
      'LEAGUE_START_DATE_INVALID',
      'LEAGUE_START_IN_PAST',
      'LEAGUE_END_DATE_REQUIRED',
      'LEAGUE_END_DATE_NOT_ALLOWED',
      'LEAGUE_END_NOT_AFTER_START',
      'LEAGUE_END_IN_PAST',
      'LEAGUE_CHANGES_INVALID',
      'LEAGUE_INVALID_INPUT',
      'LEAGUE_INVALID_STATE',
      'LEAGUE_NOT_DUE',
      'LEAGUE_ACTIVE_EXISTS',
      'LEAGUE_CLOSE_NOT_MANUAL',
      'LEAGUE_PERIOD_LOCKED',
      'LEAGUE_START_LOCKED',
      'LEAGUE_VERSION_CONFLICT',
      'LEAGUE_REQUEST_CONFLICT',
      'LEAGUE_UNAVAILABLE',
      'INVALID_LEAGUE_INPUT',
      'INVALID_LEAGUE_RESPONSE'
    ];
    for (const locale of [en, pt, es]) {
      expect(Object.keys(locale.leagues.errors).sort()).toEqual([...codes].sort());
      for (const text of paths(locale.leagues).map((path) =>
        path.split('.').reduce<any>((n, k) => n[k], locale.leagues)
      ))
        expect(String(text).trim()).not.toBe('');
    }
  });

  it('keeps interactive controls at the 44px touch target and uses tokens only', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/features/leagues/league.styles.ts'),
      'utf8'
    );
    expect(source).toContain("const touchTarget = 'calc(var(--space-40) + var(--space-4))'");
    for (const style of ['backLink', 'mode', 'actionLink', 'primaryLink', 'itemLink']) {
      const block = source.slice(source.indexOf(`  ${style}: {`)).split('\n  },')[0]!;
      expect({ style, block }).toEqual({
        style,
        block: expect.stringContaining('minHeight: touchTarget')
      });
    }
    // No literal colors, pixel sizes or hex values: every design value is a token.
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|\b\d+px\b/);
  });
});
