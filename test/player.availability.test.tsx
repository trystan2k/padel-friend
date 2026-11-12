/** @vitest-environment jsdom */
import { useState } from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from '../src/i18n/config';
import { AvailabilityFields } from '../src/features/player/AvailabilityFields';
import { PlayerOnboarding } from '../src/features/player/PlayerOnboarding';
import { PlayerProfile } from '../src/features/player/PlayerProfile';
import {
  normalizePlayingDays,
  normalizePlayingTimes,
  projectPlayingDays,
  projectPlayingTimes,
  toggleChoice,
  type PlayingDay,
  type PlayingTime
} from '../src/features/player/player-availability';
import en from '../src/locales/en/translation.json';
import es from '../src/locales/es/translation.json';
import ptBR from '../src/locales/pt-BR/translation.json';

const mocks = vi.hoisted(() => ({
  claim: vi.fn<(input: { data: Record<string, unknown> }) => Promise<void>>(),
  onboard: vi.fn<(input: { data: Record<string, unknown> }) => Promise<void>>(),
  update: vi.fn<(input: { data: Record<string, unknown> }) => Promise<unknown>>(),
  getProfile: vi.fn<() => Promise<unknown>>(),
  passwordState: vi.fn<() => Promise<{ pending: boolean; canSkip: boolean }>>(),
  assign: vi.fn<(url: string) => void>()
}));
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  Link: ({ children, to, ...rest }: any) => (
    <a href={String(to)} {...rest}>
      {children}
    </a>
  )
}));
vi.mock('../src/features/player/player.functions', () => ({
  claimProvisionalPlayer: mocks.claim,
  onboardPlayer: mocks.onboard,
  updateMyPlayerProfile: mocks.update,
  getMyPlayerProfile: mocks.getProfile,
  completeAvatarUpload: vi.fn<() => Promise<unknown>>(),
  getPasswordSetupState: mocks.passwordState
}));
vi.mock('../src/features/player/AvatarUpload', () => ({ AvatarUpload: () => null }));
vi.mock('../src/features/player/avatar-upload', () => ({
  uploadOwnerAvatar: vi.fn<() => Promise<string>>()
}));
vi.mock('../src/lib/supabase/client', () => ({ getBrowserClient: vi.fn<() => unknown>() }));
vi.mock('../src/features/player/rating.functions', () => ({
  getMyRatingHistory: vi.fn<() => Promise<unknown>>(),
  getRatingGroupExplanation: vi.fn<() => Promise<unknown>>(),
  getMyRatingSummary: vi.fn<() => Promise<unknown>>(),
  getMyRatingProgress: vi.fn<() => Promise<unknown>>(),
  getMatchEventRatingChanges: vi.fn<() => Promise<unknown>>()
}));

const catalogs = { en, es, 'pt-BR': ptBR } as const;
type Locale = keyof typeof catalogs;

const profileFixture = {
  user_id: '11111111-1111-4111-8111-111111111111',
  display_name: 'Ana Souza',
  preferred_side: 'LEFT' as const,
  dominant_hand: null,
  bio: null,
  preferred_playing_days: null as PlayingDay[] | null,
  preferred_playing_times: null as PlayingTime[] | null,
  avatar_signed_url: null,
  joined_at: '2026-01-01T00:00:00.000Z',
  initial_display_level: 1,
  display_level: 1.5,
  highest_display_level: 1.5,
  reliability_percent: 10,
  confirmed_competitive_game_groups: 0
};

function Harness({
  locale = 'en',
  disabled = false,
  onChange
}: {
  locale?: Locale;
  disabled?: boolean;
  onChange?: (days: PlayingDay[] | null, times: PlayingTime[] | null) => void;
}) {
  const [days, setDays] = useState<PlayingDay[] | null>(null);
  const [times, setTimes] = useState<PlayingTime[] | null>(null);
  return (
    <I18nextProvider i18n={createI18n(locale)}>
      <AvailabilityFields
        days={days}
        times={times}
        disabled={disabled}
        onDaysChange={(next) => (setDays(next), onChange?.(next, times))}
        onTimesChange={(next) => (setTimes(next), onChange?.(days, next))}
      />
    </I18nextProvider>
  );
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.onboard.mockResolvedValue();
  mocks.claim.mockResolvedValue();
  mocks.passwordState.mockResolvedValue({ pending: true, canSkip: false });
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { assign: mocks.assign, reload: vi.fn<() => void>() }
  });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});
afterEach(cleanup);

describe('availability domain helpers', () => {
  it('normalizes to canonical order, dedupes and maps empty to null', () => {
    expect(normalizePlayingDays(['SUN', 'MON', 'SUN'])).toEqual(['MON', 'SUN']);
    expect(normalizePlayingTimes(['EVENING', 'MORNING'])).toEqual(['MORNING', 'EVENING']);
    expect(normalizePlayingDays([])).toBeNull();
    expect(normalizePlayingTimes(null)).toBeNull();
  });

  it('rejects malformed raw payloads', () => {
    for (const value of [undefined, 'MON', ['x'], [null], [['MON']], new Array(8).fill('MON')])
      expect(() => normalizePlayingDays(value)).toThrow('INVALID_PLAYER_INPUT');
    expect(() => normalizePlayingTimes(['MORNING', 'MORNING', 'MORNING', 'MORNING'])).toThrow(
      'INVALID_PLAYER_INPUT'
    );
  });

  it('projects stored arrays without unknown values and toggles in canonical order', () => {
    expect(projectPlayingDays(['SUN', 'bogus', 'MON'])).toEqual(['MON', 'SUN']);
    expect(projectPlayingTimes([])).toBeNull();
    expect(projectPlayingTimes(null)).toBeNull();
    const times: PlayingTime[] = ['MORNING', 'AFTERNOON', 'EVENING'];
    expect(toggleChoice(['EVENING'], times, 'MORNING', true)).toEqual(['MORNING', 'EVENING']);
    expect(toggleChoice(['EVENING'], times, 'EVENING', false)).toBeNull();
    expect(toggleChoice(null, times, 'AFTERNOON', true)).toEqual(['AFTERNOON']);
  });
});

describe('AvailabilityFields', () => {
  it('renders two labeled checkbox groups with every translated choice', () => {
    render(<Harness />);
    const days = screen.getByRole('group', { name: en.profile.availabilityDaysLegend });
    const times = screen.getByRole('group', { name: en.profile.availabilityTimesLegend });
    expect(within(days).getAllByRole('checkbox')).toHaveLength(7);
    expect(within(times).getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getByText(en.profile.availabilityHelp)).toBeTruthy();
    for (const label of Object.values(en.profile.availabilityDays))
      expect(within(days).getByRole('checkbox', { name: label })).toBeTruthy();
    for (const label of Object.values(en.profile.availabilityTimes))
      expect(within(times).getByRole('checkbox', { name: label })).toBeTruthy();
    expect(days.getAttribute('aria-describedby')).toBe(times.getAttribute('aria-describedby'));
  });

  it.each(['es', 'pt-BR'] as const)('translates groups and choices in %s', (locale) => {
    render(<Harness locale={locale} />);
    const copy = catalogs[locale].profile;
    const days = screen.getByRole('group', { name: copy.availabilityDaysLegend });
    expect(within(days).getByRole('checkbox', { name: copy.availabilityDays.SAT })).toBeTruthy();
    const times = screen.getByRole('group', { name: copy.availabilityTimesLegend });
    expect(
      within(times).getByRole('checkbox', { name: copy.availabilityTimes.EVENING })
    ).toBeTruthy();
  });

  it('multi-selects from the keyboard and keeps the groups independent', async () => {
    const onChange = vi.fn<(days: PlayingDay[] | null, times: PlayingTime[] | null) => void>();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);
    await user.tab();
    const monday = screen.getByRole<HTMLInputElement>('checkbox', {
      name: en.profile.availabilityDays.MON
    });
    expect(document.activeElement).toBe(monday);
    await user.keyboard(' ');
    await user.tab();
    await user.tab();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenLastCalledWith(['MON', 'WED'], null);
    const evening = screen.getByRole('checkbox', { name: en.profile.availabilityTimes.EVENING });
    await user.click(evening);
    expect(onChange).toHaveBeenLastCalledWith(['MON', 'WED'], ['EVENING']);
  });

  it('clears a draft back to null when the last choice is unchecked', async () => {
    const onChange = vi.fn<(days: PlayingDay[] | null, times: PlayingTime[] | null) => void>();
    render(<Harness onChange={onChange} />);
    const friday = screen.getByRole<HTMLInputElement>('checkbox', {
      name: en.profile.availabilityDays.FRI
    });
    await userEvent.click(friday);
    expect(friday.checked).toBe(true);
    await userEvent.click(friday);
    expect(friday.checked).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith(null, null);
  });

  it('reserves the same indicator slot whether a choice is selected or not', async () => {
    render(<Harness />);
    const box = screen.getByRole<HTMLInputElement>('checkbox', {
      name: en.profile.availabilityDays.MON
    });
    const mark = () => box.closest('label')!.querySelector<HTMLElement>('span[aria-hidden="true"]');
    // jsdom has no layout engine and StyleX CSS is not applied, so assert the slot contract:
    // the aria-hidden glyph is always in the DOM and only its visibility class differs.
    const before = mark();
    expect(before).not.toBeNull();
    expect(before!.textContent?.trim()).toBe('✓');
    const unselectedClasses = before!.className.split(' ').filter(Boolean);
    await userEvent.click(box);
    const after = mark();
    expect(after).toBe(before);
    expect(after!.textContent?.trim()).toBe('✓');
    const selectedClasses = after!.className.split(' ').filter(Boolean);
    expect(unselectedClasses.length).toBe(selectedClasses.length + 1);
    expect(selectedClasses.every((name) => unselectedClasses.includes(name))).toBe(true);
    expect(box.getAttribute('aria-hidden')).toBeNull();
  });

  it('disables every checkbox when frozen', () => {
    render(<Harness disabled />);
    for (const box of screen.getAllByRole<HTMLInputElement>('checkbox'))
      expect(box.disabled).toBe(true);
  });
});

describe('onboarding availability', () => {
  const mountOnboarding = (claim = false) =>
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <PlayerOnboarding
          claim={
            claim
              ? {
                  state: 'ready',
                  displayName: 'Marta Provisional',
                  initialLevel: 3.5,
                  matchCount: 0,
                  canEditLevel: true
                }
              : undefined
          }
        />
      </I18nextProvider>
    );
  const fillRequired = async () => {
    const user = userEvent.setup();
    const name = screen.queryByLabelText<HTMLInputElement>(en.onboarding.name);
    if (name && !name.value) await user.type(name, 'Ana Lopez');
    // The first "Left" radio is the court side; the second is the dominant hand.
    await user.click(screen.getAllByRole('radio', { name: en.onboarding.sideLeftShort })[0]!);
    return user;
  };

  it('sits after the primary action, precise level and bio, and never blocks submit', async () => {
    mountOnboarding();
    const submit = screen.getByRole('button', { name: new RegExp(en.onboarding.save) });
    const precise = screen.getByLabelText(en.onboarding.preciseLevel);
    const bio = screen.getByLabelText(en.profile.bio);
    const group = screen.getByRole('group', { name: en.profile.availabilityDaysLegend });
    const after = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(after(submit, group)).toBe(true);
    expect(after(precise, group)).toBe(true);
    expect(after(bio, group)).toBe(true);
    expect(screen.getAllByRole<HTMLInputElement>('checkbox').some((box) => box.required)).toBe(
      false
    );
    const user = await fillRequired();
    await user.click(submit);
    await waitFor(() => expect(mocks.onboard).toHaveBeenCalledOnce());
    expect(mocks.onboard.mock.calls[0]![0].data).toMatchObject({
      preferred_playing_days: null,
      preferred_playing_times: null
    });
  });

  it.each([
    { claim: false, label: 'direct' },
    { claim: true, label: 'claim' }
  ])('submits chosen days and times on the $label path', async ({ claim }) => {
    mountOnboarding(claim);
    const user = await fillRequired();
    await user.click(screen.getByRole('checkbox', { name: en.profile.availabilityDays.SUN }));
    await user.click(screen.getByRole('checkbox', { name: en.profile.availabilityDays.MON }));
    await user.click(screen.getByRole('checkbox', { name: en.profile.availabilityTimes.MORNING }));
    await user.click(
      screen.getByRole('button', {
        name: new RegExp(claim ? en.auth.claim.submit : en.onboarding.save)
      })
    );
    const create = claim ? mocks.claim : mocks.onboard;
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create.mock.calls[0]![0].data).toMatchObject({
      preferred_playing_days: ['MON', 'SUN'],
      preferred_playing_times: ['MORNING']
    });
  });
});

describe('profile availability', () => {
  const mountProfile = (override: Partial<typeof profileFixture> = {}) =>
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <PlayerProfile
          initialProfile={{ ...profileFixture, ...override }}
          initialRating={{ status: 'error', code: 'unavailable' }}
          onRatingReload={vi.fn<() => void>()}
        />
      </I18nextProvider>
    );

  it('reads out translated groups, with a not-provided state when empty', () => {
    const view = mountProfile();
    expect(screen.getAllByText(en.profile.availabilityNotProvided)).toHaveLength(2);
    view.unmount();
    mountProfile({
      preferred_playing_days: ['SAT', 'SUN'],
      preferred_playing_times: ['MORNING', 'EVENING']
    });
    expect(screen.getByText('Saturday and Sunday')).toBeTruthy();
    expect(screen.getByText('Morning and Evening')).toBeTruthy();
    expect(screen.queryByText(en.profile.availabilityNotProvided)).toBeNull();
  });

  it('edits, saves and clears availability with explicit null', async () => {
    const user = userEvent.setup();
    mockUpdate({ preferred_playing_days: ['TUE'], preferred_playing_times: null });
    mountProfile({ preferred_playing_days: ['MON'], preferred_playing_times: ['EVENING'] });
    await user.click(screen.getByRole('button', { name: en.profile.edit }));
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', { name: en.profile.availabilityDays.MON })
        .checked
    ).toBe(true);
    await user.click(screen.getByRole('checkbox', { name: en.profile.availabilityDays.MON }));
    await user.click(screen.getByRole('checkbox', { name: en.profile.availabilityDays.TUE }));
    await user.click(screen.getByRole('checkbox', { name: en.profile.availabilityTimes.EVENING }));
    await user.click(screen.getByRole('button', { name: en.profile.save }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
    expect(mocks.update.mock.calls[0]![0].data).toMatchObject({
      preferred_playing_days: ['TUE'],
      preferred_playing_times: null
    });
    expect(await screen.findByText('Tuesday')).toBeTruthy();
    expect(screen.getByText(en.profile.availabilityNotProvided)).toBeTruthy();
  });

  it('keeps drafts after a failed save', async () => {
    const user = userEvent.setup();
    mocks.update.mockRejectedValue(new Error('boom'));
    mountProfile();
    await user.click(screen.getByRole('button', { name: en.profile.edit }));
    await user.click(screen.getByRole('checkbox', { name: en.profile.availabilityDays.FRI }));
    await user.click(screen.getByRole('button', { name: en.profile.save }));
    expect(await screen.findByText(en.profile.saveFailed)).toBeTruthy();
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', { name: en.profile.availabilityDays.FRI })
        .checked
    ).toBe(true);
  });
});

function mockUpdate(next: {
  preferred_playing_days: PlayingDay[] | null;
  preferred_playing_times: PlayingTime[] | null;
}) {
  mocks.update.mockResolvedValue({ ...profileFixture, ...next });
}
