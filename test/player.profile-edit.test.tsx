/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from '../src/i18n/config';
import {
  AppPreferencesContext,
  type AppPreferences
} from '../src/features/preferences/app-preferences';
import en from '../src/locales/en/translation.json';

vi.mock('../src/features/player/player.functions', () => ({
  updateMyPlayerProfile: vi.fn<() => Promise<unknown>>(),
  getMyPlayerProfile: vi.fn<() => Promise<unknown>>()
}));
vi.mock('../src/features/player/AvatarUpload', () => ({ AvatarUpload: () => null }));

import { ProfileEditForm } from '../src/features/player/ProfileEditForm';
import { updateMyPlayerProfile } from '../src/features/player/player.functions';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const profile: Parameters<typeof ProfileEditForm>[0]['profile'] = {
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
};

function setup(preferences: AppPreferences | null = null) {
  const onSaved = vi.fn<(next: unknown) => void>();
  const onCancel = vi.fn<() => void>();
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <AppPreferencesContext value={preferences}>
        <ProfileEditForm
          profile={profile}
          onProfileChange={vi.fn<() => void>()}
          onSaved={onSaved}
          onCancel={onCancel}
        />
      </AppPreferencesContext>
    </I18nextProvider>
  );
  return { onSaved, onCancel };
}

const preferences = (): AppPreferences => ({
  locale: 'en',
  theme: 'light',
  changeLocale: vi.fn<(next: string) => Promise<void>>(async () => undefined),
  changeTheme: vi.fn<(next: 'light' | 'dark') => void>()
});

describe('ProfileEditForm (frames VpcMM / xlgw8)', () => {
  it('lays out the frame groups: heading, name, availability pills, preferences, actions', () => {
    setup(preferences());
    expect(screen.getByRole('heading', { level: 1, name: en.profile.edit })).toBeTruthy();
    expect(screen.getByLabelText(en.onboarding.name)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: en.profile.availability })).toBeTruthy();
    expect(screen.getByRole('group', { name: en.profile.preferredDays })).toBeTruthy();
    expect(screen.getAllByRole('checkbox')).toHaveLength(10);
    expect(screen.getByRole('heading', { level: 2, name: en.profile.preferences })).toBeTruthy();
    expect(screen.getByRole('button', { name: en.profile.save })).toBeTruthy();
    expect(screen.getByRole('button', { name: en.profile.cancel })).toBeTruthy();
  });

  it('omits the preferences group outside the root layout', () => {
    setup(null);
    expect(screen.queryByRole('heading', { name: en.profile.preferences })).toBeNull();
  });

  it('keeps the name validation: an empty name is rejected and refocused', async () => {
    setup();
    const name = screen.getByLabelText(en.onboarding.name);
    await userEvent.clear(name);
    await userEvent.click(screen.getByRole('button', { name: en.profile.save }));
    expect((await screen.findByRole('alert')).textContent).toBe(en.onboarding.validationName);
    expect(updateMyPlayerProfile).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(name);
  });

  it('applies theme and language only after the profile saved', async () => {
    const prefs = preferences();
    vi.mocked(updateMyPlayerProfile).mockResolvedValue(profile);
    const { onSaved } = setup(prefs);
    await userEvent.click(screen.getByLabelText(en.dark));
    await userEvent.selectOptions(screen.getByLabelText(en.language), 'es');
    expect(prefs.changeTheme).not.toHaveBeenCalled();
    expect(prefs.changeLocale).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: en.profile.save }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(prefs.changeTheme).toHaveBeenCalledWith('dark');
    expect(prefs.changeLocale).toHaveBeenCalledWith('es');
  });

  it('leaves every preference untouched on Cancel', async () => {
    const prefs = preferences();
    const { onCancel } = setup(prefs);
    await userEvent.click(screen.getByLabelText(en.dark));
    await userEvent.click(screen.getByRole('button', { name: en.profile.cancel }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(prefs.changeTheme).not.toHaveBeenCalled();
    expect(updateMyPlayerProfile).not.toHaveBeenCalled();
  });
});
