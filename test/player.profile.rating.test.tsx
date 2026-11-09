/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from '../src/i18n/config';
import {
  parseRatingHistoryPage,
  parseRatingProgress,
  parseRatingSummaryResult
} from '../src/features/player/rating-contracts';
import type { RatingLoad } from '../src/features/player/rating-view';
import { historyPayload, progressPayload, summaryPayload } from './helpers/rating-read-fixtures';

vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  Link: ({ children, to, ...rest }: any) => (
    <a href={String(to)} {...rest}>
      {children}
    </a>
  )
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

import { PlayerProfile } from '../src/features/player/PlayerProfile';

afterEach(cleanup);

// The profile row deliberately disagrees with the committed projection to prove which
// source the level card uses.
const profile: Parameters<typeof PlayerProfile>[0]['initialProfile'] = {
  user_id: '11111111-1111-4111-8111-111111111111',
  display_name: 'Ana Souza',
  preferred_side: 'LEFT',
  dominant_hand: null,
  bio: null,
  avatar_signed_url: null,
  joined_at: '2026-01-01T00:00:00.000Z',
  initial_display_level: 1,
  display_level: 1.5,
  highest_display_level: 1.5,
  reliability_percent: 10,
  confirmed_competitive_game_groups: 0
};

const rating: RatingLoad = {
  status: 'ok',
  revision: 3,
  summary: parseRatingSummaryResult(summaryPayload)!,
  progress: parseRatingProgress(progressPayload)!,
  history: (() => {
    const page = parseRatingHistoryPage(historyPayload)!;
    return { ...page, next_cursor: null };
  })()
};

const renderProfile = (initialRating: RatingLoad, onRatingReload = vi.fn<() => void>()) =>
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <PlayerProfile
        initialProfile={profile}
        initialRating={initialRating}
        onRatingReload={onRatingReload}
      />
    </I18nextProvider>
  );

describe('PlayerProfile rating journey', () => {
  it('uses a section and subordinate heading when embedded in Home', () => {
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <main>
          <h1>Home</h1>
          <PlayerProfile
            embedded
            initialProfile={profile}
            initialRating={rating}
            onRatingReload={vi.fn<() => void>()}
          />
        </main>
      </I18nextProvider>
    );
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole('heading', { level: 2, name: createI18n('en').t('profile.title') })
    ).toBeTruthy();
  });
  it('shows current, highest, initial, count and reliability from the committed projection', () => {
    renderProfile(rating);
    // Current and highest level are both 4.12.
    expect(screen.getAllByText('4.12', { selector: 'strong' })).toHaveLength(2);
    expect(screen.getByText('Reliability: 16%')).toBeTruthy();
    const rows = screen.getAllByText(/Initial level|Highest level|Confirmed competitive groups/);
    expect(rows.map((row) => row.nextElementSibling?.textContent)).toEqual(['4.00', '4.12', '1']);
    expect(screen.getByRole('region', { name: 'Rating journey' })).toBeTruthy();
    expect(screen.queryByText('1.50')).toBeNull();
  });

  it('falls back to the profile row and keeps an error with retry when ratings fail', async () => {
    const onReload = vi.fn<() => void>();
    renderProfile({ status: 'error', code: 'unavailable' }, onReload);
    expect(screen.getAllByText('1.50', { selector: 'strong' })).toHaveLength(2);
    const region = screen.getByRole('region', { name: 'Rating journey' });
    expect(within(region).getByRole('alert')).toBeTruthy();
    await userEvent.click(within(region).getByRole('button', { name: 'Try again' }));
    expect(onReload).toHaveBeenCalledOnce();
  });

  it('offers the level review entry points and no writable level input', () => {
    renderProfile(rating);
    const entry = screen.getByRole('region', { name: 'Level review' });
    expect(
      within(entry).getByRole('link', { name: 'Request level review' }).getAttribute('href')
    ).toBe('/level-reviews/new');
    expect(
      within(entry).getByRole('link', { name: 'My review requests' }).getAttribute('href')
    ).toBe('/level-reviews');
    // The level is shown, never editable: no spin button and no field holding it.
    expect(screen.queryByRole('spinbutton')).toBeNull();
    expect(screen.queryByDisplayValue('4.12')).toBeNull();
  });

  it('replaces the empty-history placeholder card', () => {
    renderProfile(rating);
    expect(screen.queryByText(/Your confirmed games will appear here/)).toBeNull();
  });
});
