/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n, supportedLocales, type Locale } from '../src/i18n/config';
import { PRIVACY_CONTACT_EMAIL } from '../src/features/privacy/privacy-content';
import {
  PRIVACY_CASE_STATES,
  PRIVACY_REQUEST_ERROR_CODES,
  type MyDeletionRequest,
  type PrivacyReceipt,
  type PrivacyRequestResponse
} from '../src/features/privacy-requests/privacy-request-model';
import en from '../src/locales/en/translation.json';
import es from '../src/locales/es/translation.json';
import pt from '../src/locales/pt-BR/translation.json';

const mocks = vi.hoisted(() => ({
  request: vi.fn<(arg: { data: { command_id: string } }) => Promise<unknown>>(),
  status: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  withdraw: vi.fn<(arg: { data: { command_id: string } }) => Promise<unknown>>()
}));
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  Link: ({ children, to, ...rest }: any) => (
    <a href={String(to)} {...rest}>
      {children}
    </a>
  )
}));
vi.mock('../src/features/privacy-requests/privacy-request.functions', () => ({
  requestDeletion: mocks.request,
  getMyDeletionRequest: mocks.status,
  withdrawMyDeletionRequest: mocks.withdraw
}));
vi.mock('../src/features/player/player.functions', () => ({
  updateMyPlayerProfile: vi.fn<() => Promise<unknown>>(),
  getMyPlayerProfile: vi.fn<() => Promise<unknown>>()
}));
vi.mock('../src/features/player/AvatarUpload', () => ({ AvatarUpload: () => null }));
vi.mock('../src/lib/supabase/client', () => ({ getBrowserClient: vi.fn<() => unknown>() }));
vi.mock('../src/features/player/rating.functions', () => ({
  getMyRatingHistory: vi.fn<() => Promise<unknown>>(),
  getRatingGroupExplanation: vi.fn<() => Promise<unknown>>(),
  getMyRatingSummary: vi.fn<() => Promise<unknown>>(),
  getMyRatingProgress: vi.fn<() => Promise<unknown>>(),
  getMatchEventRatingChanges: vi.fn<() => Promise<unknown>>()
}));

import { AccountDeletionPage } from '../src/features/privacy-requests/AccountDeletionPage';
import { PlayerProfile } from '../src/features/player/PlayerProfile';

const REFERENCE = 'PR-0123456789AB';
const status = (overrides: Partial<MyDeletionRequest> = {}): MyDeletionRequest => ({
  reference: REFERENCE,
  state: 'received',
  received_at: '2026-11-27T10:00:00Z',
  blocked: false,
  can_withdraw: true,
  ...overrides
});
const receipt = (overrides: Partial<PrivacyReceipt> = {}): PrivacyReceipt => ({
  command_id: '11111111-2222-4333-8444-555555555555',
  reference: REFERENCE,
  state: 'received',
  received_at: '2026-11-27T10:00:00Z',
  replayed: false,
  can_withdraw: true,
  ...overrides
});
const ok = <T,>(value: T): PrivacyRequestResponse<T> => ({ status: 'ok', value });

const renderPage = (
  initial: PrivacyRequestResponse<MyDeletionRequest | null>,
  locale: Locale = 'en'
) =>
  render(
    <I18nextProvider i18n={createI18n(locale)}>
      <AccountDeletionPage initial={initial} />
    </I18nextProvider>
  );

afterEach(cleanup);
beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
});

describe('account deletion intake', () => {
  it('discloses all four areas before any mutation and sends nothing until confirmed', async () => {
    const user = userEvent.setup();
    renderPage(ok(null));
    expect(screen.getByText(en.accountDeletion.intro.sends)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: en.accountDeletion.intro.start }));
    const dialog = screen.getByRole('alertdialog', { name: en.accountDeletion.dialog.title });
    const inside = within(dialog);
    expect(
      inside.getByRole('heading', { name: en.accountDeletion.dialog.disappears.title })
    ).toBeTruthy();
    expect(inside.getAllByRole('listitem')).toHaveLength(5);
    expect(
      inside.getByRole('heading', { name: en.accountDeletion.dialog.remains.title })
    ).toBeTruthy();
    expect(inside.getByText(/Former player/)).toBeTruthy();
    expect(
      inside.getByRole('heading', { name: en.accountDeletion.dialog.access.title })
    ).toBeTruthy();
    expect(
      inside.getByRole('heading', { name: en.accountDeletion.dialog.cutoff.title })
    ).toBeTruthy();
    expect(inside.getByText(en.accountDeletion.dialog.summary)).toBeTruthy();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('is cancellable: the dialog closes, nothing is sent and focus returns to the trigger', async () => {
    const user = userEvent.setup();
    renderPage(ok(null));
    const trigger = screen.getByRole('button', { name: en.accountDeletion.intro.start });
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: en.accountDeletion.dialog.cancel }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(mocks.request).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
    await user.click(trigger);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('sends one idempotent request, then shows the status with the reference and announces it', async () => {
    const user = userEvent.setup();
    mocks.request.mockResolvedValue(ok(receipt()));
    renderPage(ok(null));
    await user.click(screen.getByRole('button', { name: en.accountDeletion.intro.start }));
    await user.click(screen.getByRole('button', { name: en.accountDeletion.dialog.confirm }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(mocks.request).toHaveBeenCalledTimes(1);
    const sent = mocks.request.mock.calls[0]?.[0];
    expect(Object.keys(sent?.data ?? {})).toEqual(['command_id']);
    expect(sent?.data.command_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByRole('heading', { name: en.accountDeletion.state.received })).toBeTruthy();
    expect(screen.getByText(REFERENCE)).toBeTruthy();
    expect(screen.getByText(en.accountDeletion.detail.received)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe(
      'Request sent. Your reference is ' + REFERENCE + '.'
    );
    // The request replaced the intake card: no second start button while a case is open.
    expect(screen.queryByRole('button', { name: en.accountDeletion.intro.start })).toBeNull();
  });

  it('tells the user about an existing open request instead of creating another', async () => {
    const user = userEvent.setup();
    mocks.request.mockResolvedValue(ok(receipt({ replayed: true })));
    renderPage(ok(null));
    await user.click(screen.getByRole('button', { name: en.accountDeletion.intro.start }));
    await user.click(screen.getByRole('button', { name: en.accountDeletion.dialog.confirm }));
    expect(
      await screen.findByText(
        'You already have an open request. Its reference is ' + REFERENCE + '.'
      )
    ).toBeTruthy();
  });

  it.each([
    ['rate_limited', en.accountDeletion.errors.rate_limited],
    ['disabled', en.accountDeletion.errors.disabled],
    ['unavailable', en.accountDeletion.errors.unavailable]
  ] as const)(
    'keeps the dialog open with the specific %s message and allows a retry',
    async (code, message) => {
      const user = userEvent.setup();
      mocks.request.mockResolvedValueOnce({ status: 'error', code });
      renderPage(ok(null));
      await user.click(screen.getByRole('button', { name: en.accountDeletion.intro.start }));
      await user.click(screen.getByRole('button', { name: en.accountDeletion.dialog.confirm }));
      expect((await screen.findByRole('alert')).textContent).toBe(message);
      mocks.request.mockResolvedValueOnce(ok(receipt()));
      await user.click(screen.getByRole('button', { name: en.accountDeletion.dialog.confirm }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
      // A retry reuses the same command id: the server answers with the original receipt.
      const ids = mocks.request.mock.calls.map((call) => call[0].data.command_id);
      expect(new Set(ids).size).toBe(1);
    }
  );

  it('treats a thrown request as unavailable, never as success', async () => {
    const user = userEvent.setup();
    mocks.request.mockRejectedValue(new Error('network'));
    renderPage(ok(null));
    await user.click(screen.getByRole('button', { name: en.accountDeletion.intro.start }));
    await user.click(screen.getByRole('button', { name: en.accountDeletion.dialog.confirm }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      en.accountDeletion.errors.unavailable
    );
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });
});

describe('account deletion status and withdrawal', () => {
  it('offers withdrawal only while withdrawable and withdraws after a confirmation', async () => {
    const user = userEvent.setup();
    mocks.withdraw.mockResolvedValue(ok(receipt({ state: 'withdrawn', can_withdraw: false })));
    renderPage(ok(status({ state: 'ready' })));
    expect(screen.getByText(en.accountDeletion.status.canWithdraw)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: en.accountDeletion.status.withdraw }));
    expect(mocks.withdraw).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole('button', { name: en.accountDeletion.withdrawDialog.confirm })
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(mocks.withdraw).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: en.accountDeletion.state.withdrawn })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe(en.accountDeletion.announce.withdrawn);
    // A withdrawn case can be requested again.
    expect(screen.getByRole('button', { name: en.accountDeletion.intro.start })).toBeTruthy();
  });

  it('hides the withdraw button once processing has been claimed', () => {
    renderPage(ok(status({ state: 'executing', can_withdraw: false })));
    expect(screen.queryByRole('button', { name: en.accountDeletion.status.withdraw })).toBeNull();
    expect(screen.getByText(en.accountDeletion.status.cannotWithdraw)).toBeTruthy();
    expect(screen.getByText(en.accountDeletion.detail.executing)).toBeTruthy();
  });

  it('refreshes the real state when the server refuses a late withdrawal', async () => {
    const user = userEvent.setup();
    mocks.withdraw.mockResolvedValue({ status: 'error', code: 'not_withdrawable' });
    mocks.status.mockResolvedValue(ok(status({ state: 'executing', can_withdraw: false })));
    renderPage(ok(status({ state: 'ready' })));
    await user.click(screen.getByRole('button', { name: en.accountDeletion.status.withdraw }));
    await user.click(
      screen.getByRole('button', { name: en.accountDeletion.withdrawDialog.confirm })
    );
    expect((await screen.findByRole('alert')).textContent).toBe(
      en.accountDeletion.errors.not_withdrawable
    );
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: en.accountDeletion.state.executing })).toBeTruthy()
    );
  });

  it('announces the refreshed state politely in the live region without moving focus', async () => {
    const user = userEvent.setup();
    mocks.status.mockResolvedValue(ok(status({ state: 'executing', can_withdraw: false })));
    renderPage(ok(status({ state: 'ready' })));
    const refresh = screen.getByRole('button', { name: en.accountDeletion.status.refresh });
    await user.click(refresh);
    const live = screen.getByRole('status');
    await waitFor(() =>
      expect(live.textContent).toBe(
        `Status updated: ${en.accountDeletion.state.executing}. ${en.accountDeletion.detail.executing}`
      )
    );
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(document.activeElement).toBe(refresh);
  });

  it('re-announces an unchanged state on every refresh by clearing the region first', async () => {
    const user = userEvent.setup();
    mocks.status.mockResolvedValue(
      ok(status({ state: 'blocked', blocked: true, can_withdraw: false }))
    );
    renderPage(ok(status({ state: 'blocked', blocked: true, can_withdraw: false })));
    const refresh = screen.getByRole('button', { name: en.accountDeletion.status.refresh });
    const live = screen.getByRole('status');
    const expected = `Status updated: ${en.accountDeletion.state.blocked}. ${en.accountDeletion.detail.blocked}`;
    const seen: string[] = [];
    const observer = new MutationObserver(() => seen.push(live.textContent ?? ''));
    observer.observe(live, { childList: true, characterData: true, subtree: true });
    await user.click(refresh);
    await waitFor(() => expect(live.textContent).toBe(expected));
    await user.click(refresh);
    await waitFor(() => expect(seen.filter((text) => text === expected)).toHaveLength(2));
    observer.disconnect();
    // Between two identical announcements the region was emptied.
    expect(seen).toContain('');
    expect(document.activeElement).toBe(refresh);
  });

  it('maps every state to a localized label and a detail without any timing promise', () => {
    for (const state of PRIVACY_CASE_STATES) {
      cleanup();
      renderPage(ok(status({ state, blocked: state === 'blocked', can_withdraw: false })));
      expect(screen.getByRole('heading', { name: en.accountDeletion.state[state] })).toBeTruthy();
      expect(screen.getByText(en.accountDeletion.detail[state])).toBeTruthy();
      expect(en.accountDeletion.detail[state]).not.toMatch(
        /\b(hours?|days?|weeks?|within|immediately|automatically)\b/i
      );
    }
  });

  it('explains a blocked case with the next step and never shows a code', () => {
    renderPage(ok(status({ state: 'blocked', blocked: true, can_withdraw: false })));
    expect(screen.getByText(en.accountDeletion.detail.blocked)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/PLAN_MISMATCH|operator_|ENVIRONMENT|_FAILED/);
  });

  it('shows a recoverable load failure with a retry that reloads the status', async () => {
    const user = userEvent.setup();
    mocks.status.mockResolvedValue(ok(status()));
    renderPage({ status: 'error', code: 'unavailable' });
    expect(screen.getByRole('alert').textContent).toBe(en.accountDeletion.errors.loadFailed);
    await user.click(screen.getByRole('button', { name: en.accountDeletion.retry }));
    await waitFor(() => expect(screen.getByText(REFERENCE)).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('points people who cannot sign in to the published privacy email, not a literal in the component', () => {
    renderPage(ok(null));
    const link = screen.getByRole('link', {
      name: en.accountDeletion.fallback.mailLabel.replace('{{address}}', PRIVACY_CONTACT_EMAIL)
    });
    // The accessible name contains the visible label, so voice control can activate it by speaking it.
    expect(link.getAttribute('aria-label')).toContain(link.textContent);
    expect(link.getAttribute('href')).toBe('mailto:' + PRIVACY_CONTACT_EMAIL);
    expect(link.textContent).toBe(PRIVACY_CONTACT_EMAIL);
    const source = readFileSync('src/features/privacy-requests/AccountDeletionPage.tsx', 'utf8');
    expect(source).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);
  });
});

describe('account deletion entry and copy', () => {
  it('renders the entry on the own profile page and links to the dedicated route', () => {
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <PlayerProfile
          initialProfile={{
            user_id: '11111111-1111-4111-8111-111111111111',
            display_name: 'Ana Souza',
            preferred_side: 'LEFT',
            dominant_hand: null,
            bio: null,
            preferred_playing_days: null,
            preferred_playing_times: null,
            avatar_signed_url: null,
            joined_at: '2026-01-01T00:00:00.000Z',
            initial_display_level: 1,
            display_level: 1.5,
            highest_display_level: 1.5,
            reliability_percent: 10,
            confirmed_competitive_game_groups: 0
          }}
          initialRating={{ status: 'error', code: 'unavailable' }}
          onRatingReload={vi.fn<() => void>()}
        />
      </I18nextProvider>
    );
    const link = screen.getByRole('link', { name: en.profile.links.accountDeletion });
    expect(link.getAttribute('href')).toBe('/account-deletion');
  });

  it('keeps the entry off every other player page', () => {
    const source = readFileSync('src/routes/_protected.players.$playerId.index.tsx', 'utf8');
    expect(source).not.toContain('account-deletion');
    expect(source).not.toContain('accountDeletion');
  });

  it('has every key in all three locales, with the same placeholders', () => {
    const flatten = (value: unknown, prefix = ''): Record<string, string> =>
      typeof value === 'string'
        ? { [prefix]: value }
        : Object.fromEntries(
            Object.entries(Object(value)).flatMap(([key, child]) =>
              Object.entries(flatten(child, prefix ? prefix + '.' + key : key))
            )
          );
    const keys = (tree: unknown) => flatten(tree);
    const base = keys(en.accountDeletion);
    expect(Object.keys(base).length).toBeGreaterThan(60);
    for (const [locale, tree] of [
      ['pt-BR', pt],
      ['es', es]
    ] as const) {
      const other = keys(tree.accountDeletion);
      expect({ locale, keys: Object.keys(other).sort() }).toEqual({
        locale,
        keys: Object.keys(base).sort()
      });
      for (const [key, text] of Object.entries(base)) {
        const tokens = (value: string) => [...value.matchAll(/{{\w+}}/g)].map((m) => m[0]).sort();
        expect({ locale, key, tokens: tokens(other[key] ?? '') }).toEqual({
          locale,
          key,
          tokens: tokens(text)
        });
      }
    }
    for (const code of PRIVACY_REQUEST_ERROR_CODES)
      expect(Object.hasOwn(en.accountDeletion.errors, code)).toBe(true);
    for (const state of PRIVACY_CASE_STATES) {
      expect(Object.hasOwn(en.accountDeletion.state, state)).toBe(true);
      expect(Object.hasOwn(en.accountDeletion.detail, state)).toBe(true);
    }
    for (const locale of supportedLocales)
      expect(createI18n(locale).t('accountDeletion.title')).not.toBe('accountDeletion.title');
  });

  it('never claims absolute anonymity for retained results, in any locale', () => {
    for (const tree of [en, pt, es]) {
      const body = tree.accountDeletion.dialog.remains.body;
      expect(body).not.toMatch(/nothing that links|nada que (os )?ligue|nada que (los )?vincule/i);
      expect(body).toContain('{{placeholder}}');
    }
  });

  it('renders the dialog in every locale without a missing key', async () => {
    const user = userEvent.setup();
    for (const locale of supportedLocales) {
      cleanup();
      renderPage(ok(null), locale);
      await user.click(
        screen.getByRole('button', { name: createI18n(locale).t('accountDeletion.intro.start') })
      );
      const dialog = screen.getByRole('alertdialog');
      expect(dialog.textContent).not.toMatch(/accountDeletion\./);
      expect(dialog.textContent).not.toMatch(/{{/);
      await user.keyboard('{Escape}');
    }
  });

  it('keeps hardcoded copy out of the component source', () => {
    const source = readFileSync('src/features/privacy-requests/AccountDeletionPage.tsx', 'utf8');
    // Generic type arguments (Promise<…>) also sit between angle brackets: drop them first.
    const markup = source.replace(/Promise<(?:[^<>]|<[^<>]*>)*>/g, '');
    const jsxText = [...markup.matchAll(/>\s*([A-Za-z][^<>{}]*[A-Za-z.!?])\s*</g)].map((m) => m[1]);
    expect(jsxText).toEqual([]);
    expect(source).not.toMatch(/aria-label=["'][A-Za-z]/);
  });
});
