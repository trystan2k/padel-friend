/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, expect, it, vi } from 'vitest';
import { createI18n } from '../src/i18n/config';
const list = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<unknown>>());
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  Link: ({ children }: any) => <a href="/">{children}</a>
}));
vi.mock('../src/features/level-reviews/level-review.functions', () => ({
  listLevelReviewQueueRequests: list
}));
import { PlatformLevelReviewQueue } from '../src/features/level-reviews/PlatformLevelReviewQueue';
afterEach(() => {
  cleanup();
  list.mockReset();
});
it('uses the keyset cursor and appends the next page', async () => {
  const cursor = { created_at: '2026-01-01T12:00:00Z', id: 'id' };
  const item = {
    id: 'one',
    owner_id: 'owner',
    owner_display_name: 'Player',
    status: 'pending' as const,
    snapshot_display_level: 3,
    snapshot_reliability_percent: 50,
    requested_min_level: 4,
    requested_max_level: 4,
    created_at: cursor.created_at,
    under_review_at: null,
    decided_at: null
  };
  list.mockResolvedValue({
    pending_count: 1,
    under_review_count: 0,
    items: [{ ...item, id: 'two', owner_display_name: 'Second player' }],
    next_cursor: null
  });
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <PlatformLevelReviewQueue
        initial={{ pending_count: 1, under_review_count: 0, items: [item], next_cursor: cursor }}
      />
    </I18nextProvider>
  );
  fireEvent.click(screen.getByRole('button', { name: /load more/i }));
  await screen.findByText('Second player');
  expect(screen.getByText('Player')).toBeTruthy();
  expect(list).toHaveBeenCalledWith({ data: { limit: 20, cursor } });
});
