/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, expect, it, vi } from 'vitest';
import { createI18n } from '../src/i18n/config';
import type { LevelReviewAdminDetail } from '../src/features/level-reviews/level-review-contracts';
const mocks = vi.hoisted(() => ({
  resolve: vi.fn<(...args: any[]) => Promise<any>>(),
  mark: vi.fn<(...args: any[]) => Promise<any>>(),
  read: vi.fn<(...args: any[]) => Promise<any>>()
}));
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  Link: ({ children, ...props }: any) => (
    <a href="/" {...props}>
      {children}
    </a>
  )
}));
vi.mock('../src/features/level-reviews/level-review.functions', () => ({
  resolveLevelReviewRequest: mocks.resolve,
  markLevelReviewRequestUnderReview: mocks.mark,
  getLevelReviewAdminDetail: mocks.read
}));
import { PlatformLevelReviewDetail } from '../src/features/level-reviews/PlatformLevelReviewDetail';
const detail: LevelReviewAdminDetail = {
  request: {
    id: 'request',
    owner_id: 'owner',
    owner_display_name: 'Player',
    status: 'pending',
    snapshot_display_level: 3,
    snapshot_reliability_percent: 50,
    requested_min_level: 4,
    requested_max_level: 5,
    reason: 'Reason',
    evidence: null,
    created_at: '2026-01-01T12:00:00Z',
    under_review_at: null,
    canceled_at: null,
    decided_at: null,
    decision_note: null,
    approved_level: null,
    adjustment_id: null,
    snapshot_rating_revision: 2,
    under_review_by: null,
    decision_actor_id: null
  },
  current: {
    revision: 2,
    mu: 3,
    display_level: 3,
    reliability_percent: 50,
    confirmed_competitive_game_groups: 3
  },
  rating_changed: false,
  adjustment: null,
  recent_history: []
};
function setup(value = detail) {
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <PlatformLevelReviewDetail initial={value} onRevalidate={() => {}} />
    </I18nextProvider>
  );
}
function fill() {
  fireEvent.change(screen.getByLabelText('Approved target level'), { target: { value: '4.25' } });
  fireEvent.change(screen.getByLabelText('Decision note'), { target: { value: 'Verified' } });
}
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('validates range and focuses first error', () => {
  setup();
  fireEvent.change(screen.getByLabelText('Approved target level'), { target: { value: '6' } });
  fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
  expect(screen.getByLabelText('Approved target level').getAttribute('aria-invalid')).toBe('true');
  expect(document.activeElement).toBe(screen.getByLabelText('Approved target level'));
  expect(mocks.resolve).not.toHaveBeenCalled();
});
it('requires note to reject', () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
  expect(screen.getByLabelText('Decision note').getAttribute('aria-invalid')).toBe('true');
});
it('defaults to preserve and approves with a committed event', async () => {
  mocks.resolve.mockResolvedValue({
    request: {
      ...detail.request,
      status: 'approved',
      decision_note: 'Verified',
      adjustment_id: 'event',
      decided_at: '2026-01-02T12:00:00Z'
    },
    adjustment: { id: 'event' }
  });
  setup();
  expect(screen.getByLabelText<HTMLInputElement>('Preserve reliability').checked).toBe(true);
  fill();
  fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }));
  await waitFor(() => expect(screen.getByText('Committed adjustment event: event')).toBeTruthy());
  expect(mocks.resolve.mock.calls[0]?.[0].data).toMatchObject({
    decision: 'approve',
    expected_revision: 2,
    target_level: 4.25,
    reliability: { mode: 'preserve' }
  });
});
it('requires exception justification', () => {
  setup();
  fill();
  fireEvent.click(screen.getByLabelText('Reset to 10%'));
  fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
  expect(screen.getByLabelText('Reliability justification').getAttribute('aria-invalid')).toBe(
    'true'
  );
});
it('rejects reset at ten percent and invalid reductions', () => {
  setup({ ...detail, current: { ...detail.current!, reliability_percent: 10 } });
  fill();
  fireEvent.click(screen.getByLabelText('Reset to 10%'));
  fireEvent.change(screen.getByLabelText('Reliability justification'), {
    target: { value: 'Reason' }
  });
  fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
  expect(screen.getByText('Reset is unavailable when reliability is 10% or less.')).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Reduce reliability'));
  fireEvent.change(screen.getByLabelText('New reliability (%)'), { target: { value: '10' } });
  fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
  expect(screen.getByLabelText('New reliability (%)').getAttribute('aria-invalid')).toBe('true');
});
it('marks pending request under review', async () => {
  mocks.mark.mockResolvedValue({ request: { ...detail.request, status: 'under_review' } });
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Mark under review' }));
  await screen.findByText('Request marked under review.');
  expect(screen.queryByRole('button', { name: 'Mark under review' })).toBeNull();
});
it('refreshes a stale rating and requires another confirmation', async () => {
  mocks.resolve.mockRejectedValueOnce(new Error('LEVEL_REVIEW_STALE_RATING'));
  mocks.read.mockResolvedValue({
    ...detail,
    current: { ...detail.current!, revision: 3, mu: 3.5, display_level: 3.5 }
  });
  setup();
  fill();
  fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }));
  await screen.findByText('Rating changed. Preview refreshed; review and confirm again.');
  expect(screen.queryByRole('button', { name: 'Confirm decision' })).toBeNull();
  expect(screen.getByText(/Internal μ 3.5/)).toBeTruthy();
});
it('locks controls on conflicting decision', async () => {
  mocks.resolve.mockRejectedValueOnce(new Error('LEVEL_REVIEW_RESOLUTION_CONFLICT'));
  setup();
  fill();
  fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }));
  await screen.findByText('This request was already closed or changed elsewhere.');
  expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
});
it('retries uncertain responses with the same command', async () => {
  mocks.resolve.mockRejectedValueOnce(new Error('LEVEL_REVIEW_UNAVAILABLE')).mockResolvedValueOnce({
    request: { ...detail.request, status: 'rejected', decision_note: 'Verified' },
    adjustment: null
  });
  setup();
  fireEvent.change(screen.getByLabelText('Decision note'), { target: { value: 'Verified' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }));
  await screen.findAllByText('The result could not be confirmed. Retry the same decision safely.');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }));
  await waitFor(() => expect(mocks.resolve).toHaveBeenCalledTimes(2));
  expect(mocks.resolve.mock.calls[0]?.[0]).toEqual(mocks.resolve.mock.calls[1]?.[0]);
});
it('terminal request is read only', () => {
  setup({ ...detail, request: { ...detail.request, status: 'rejected', decision_note: 'No' } });
  expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  expect(screen.getByText('No')).toBeTruthy();
});
