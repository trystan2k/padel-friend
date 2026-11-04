/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, expect, it, vi } from 'vitest';
import { createI18n } from '../src/i18n/config';
import type { LevelReviewQueueResult } from '../src/features/level-reviews/level-review-contracts';

const mocks = vi.hoisted(() => ({ list: vi.fn<(...args: unknown[]) => Promise<unknown>>() }));
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  Link: ({ children, to, params, ...rest }: any) => (
    <a href={String(to).replace('$requestId', params?.requestId ?? '')} {...rest}>
      {children}
    </a>
  )
}));
vi.mock('../src/features/level-reviews/level-review.functions', () => ({
  listLevelReviewQueueRequests: mocks.list
}));
import { PlatformLevelReviewQueue } from '../src/features/level-reviews/PlatformLevelReviewQueue';

afterEach(() => {
  cleanup();
  mocks.list.mockReset();
});
const initial: LevelReviewQueueResult = {
  pending_count: 1,
  under_review_count: 0,
  next_cursor: null,
  items: [
    {
      id: 'one',
      owner_id: 'owner',
      owner_display_name: 'Player',
      status: 'pending',
      snapshot_display_level: 3,
      snapshot_reliability_percent: 50,
      requested_min_level: 4,
      requested_max_level: 4,
      created_at: '2026-01-01T12:00:00Z',
      under_review_at: null,
      decided_at: null
    }
  ]
};
function setup() {
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <PlatformLevelReviewQueue initial={initial} />
    </I18nextProvider>
  );
}
it('renders queue identity, status, count and detail link', () => {
  setup();
  expect(screen.getByText('1 pending request')).toBeTruthy();
  expect(screen.getByText('Player')).toBeTruthy();
  expect(screen.getByRole('link').getAttribute('href')).toBe('/platform-admin/level-reviews/one');
});
it('filters server-side and shows empty results distinctly', async () => {
  mocks.list.mockResolvedValue({ ...initial, items: [], pending_count: 1 });
  setup();
  fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'approved' } });
  await waitFor(() => expect(screen.getByText('No requests match this filter.')).toBeTruthy());
  expect(mocks.list).toHaveBeenCalledWith({ data: { limit: 20, status: 'approved' } });
});
it('shows an error and retries the same filter', async () => {
  mocks.list
    .mockRejectedValueOnce(new Error('LEVEL_REVIEW_UNAVAILABLE'))
    .mockResolvedValueOnce({ ...initial, items: [] });
  setup();
  fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'rejected' } });
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: /try again/i }));
  await screen.findByText('No requests match this filter.');
  expect(mocks.list).toHaveBeenCalledTimes(2);
});
