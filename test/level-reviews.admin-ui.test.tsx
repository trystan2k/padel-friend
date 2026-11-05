/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createI18n } from '../src/i18n/config';
import type { LevelReviewAdminDetail } from '../src/features/level-reviews/level-review-contracts';
const mocks = vi.hoisted(() => ({
  resolve: vi.fn<(...args: any[]) => Promise<any>>(),
  mark: vi.fn<(...args: any[]) => Promise<any>>(),
  read: vi.fn<(...args: any[]) => Promise<any>>(),
  preview: vi.fn<(...args: any[]) => Promise<any>>()
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
  getLevelReviewAdminDetail: mocks.read,
  previewLevelReviewApproval: mocks.preview
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
const projected = {
  mu: 3,
  display_level: 3,
  reliability_percent: 50,
  confirmed_groups: 3,
  highest_display_level: 3,
  engine_version: '1.0.0'
};
const preview = {
  revision: 2,
  before: projected,
  after: { ...projected, mu: 4.25, display_level: 4.25, highest_display_level: 4.25 }
};
const adjustment = {
  id: 'event',
  actor_id: 'admin-actor',
  decided_at: '2026-01-02T12:00:00.000000Z',
  boundary_played_at: '2026-01-02T12:00:00.000000Z',
  boundary_basis: 'decision_clock',
  projection_revision: 3,
  before_engine_version: '1.0.0',
  after_engine_version: '1.0.0',
  before_mu: 3,
  after_mu: 4.25,
  before_display_level: 3,
  after_display_level: 4.25,
  before_reliability_percent: 50,
  after_reliability_percent: 50,
  reliability_mode: 'preserve',
  exception_justification: null
};
function ui(value: LevelReviewAdminDetail) {
  return (
    <I18nextProvider i18n={createI18n('en')}>
      <PlatformLevelReviewDetail initial={value} onRevalidate={() => {}} />
    </I18nextProvider>
  );
}
function setup(value = detail) {
  return render(ui(value));
}
async function approve() {
  fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
  await screen.findByRole('button', { name: 'Confirm decision' });
}
function fill() {
  fireEvent.change(screen.getByLabelText('Approved target level'), { target: { value: '4.25' } });
  fireEvent.change(screen.getByLabelText('Decision note'), { target: { value: 'Verified' } });
}
beforeEach(() => {
  mocks.preview.mockResolvedValue(preview);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
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
    adjustment
  });
  setup();
  expect(screen.getByLabelText<HTMLInputElement>('Preserve reliability').checked).toBe(true);
  fill();
  await approve();
  // The confirmation shows ONLY the server-computed before/after, internal μ included.
  expect(mocks.preview.mock.calls[0]?.[0].data).toEqual({
    request_id: 'request',
    target_level: 4.25,
    reliability: { mode: 'preserve' }
  });
  expect(
    screen.getByText(
      'Level 3.00 (internal μ 3.00) → 4.25 (internal μ 4.25); reliability 50% → 50%.'
    )
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }));
  await waitFor(() => expect(screen.getByText('Committed adjustment event: event')).toBeTruthy());
  // The committed event is a navigable, labeled audit section with the stored internal state.
  const link = screen.getByRole('link', { name: 'Committed adjustment event: event' });
  expect(link.getAttribute('href')).toBe('#adjustment-event');
  fireEvent.click(link);
  const section = screen.getByRole('region', {
    name: 'Adjustment event (decision-time evidence)'
  });
  expect(document.activeElement).toBe(section);
  expect(section.textContent).toContain('Level 3.00 (internal μ 3.00) → 4.25 (internal μ 4.25)');
  expect(mocks.resolve.mock.calls[0]?.[0].data).toMatchObject({
    decision: 'approve',
    expected_revision: 2,
    target_level: 4.25,
    reliability: { mode: 'preserve' }
  });
});
it('freezes approval inputs during a delayed preview and confirms captured values', async () => {
  let deliver!: (value: typeof preview) => void;
  mocks.preview.mockReturnValueOnce(
    new Promise((resolve) => {
      deliver = resolve;
    })
  );
  mocks.resolve.mockRejectedValueOnce(new Error('LEVEL_REVIEW_UNAVAILABLE'));
  setup();
  fill();
  fireEvent.click(screen.getByLabelText('Reduce reliability'));
  fireEvent.change(screen.getByLabelText('New reliability (%)'), { target: { value: '30' } });
  fireEvent.change(screen.getByLabelText('Reliability justification'), {
    target: { value: 'Reason' }
  });
  fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
  expect(screen.getByLabelText<HTMLInputElement>('Approved target level').disabled).toBe(true);
  expect(screen.getByLabelText<HTMLInputElement>('Reduce reliability').disabled).toBe(true);
  expect(screen.getByLabelText<HTMLInputElement>('New reliability (%)').disabled).toBe(true);
  expect(screen.getByLabelText<HTMLTextAreaElement>('Reliability justification').disabled).toBe(
    true
  );
  const note = screen.getByLabelText<HTMLTextAreaElement>('Decision note');
  expect(note.disabled).toBe(true);
  await userEvent.type(note, ' changed');
  expect(note.value).toBe('Verified');
  deliver(preview);
  await screen.findByRole('alertdialog');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }));
  await waitFor(() => expect(mocks.resolve).toHaveBeenCalledTimes(1));
  expect(mocks.resolve.mock.calls[0]?.[0].data).toMatchObject({
    target_level: 4.25,
    reliability: { mode: 'reduce', target: 30, justification: 'Reason' }
  });
});
it('discards an open preview when an approval input changes', async () => {
  setup();
  fill();
  const target = screen.getByLabelText('Approved target level');
  await approve();
  fireEvent.change(target, { target: { value: '4.75' } });
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect(mocks.resolve).not.toHaveBeenCalled();
});
it('preserves internal mu precision in preview and audit', async () => {
  mocks.preview.mockResolvedValueOnce({
    ...preview,
    before: { ...preview.before, mu: 3.3333 },
    after: { ...preview.after, mu: 4.4444 }
  });
  setup();
  fill();
  await approve();
  expect(screen.getByText(/internal μ 3.3333.*internal μ 4.4444/)).toBeTruthy();
  mocks.resolve.mockResolvedValueOnce({
    request: { ...detail.request, status: 'approved' },
    adjustment: { ...adjustment, before_mu: 3.3333, after_mu: 4.4444 }
  });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }));
  await screen.findByText(/internal μ 3.3333.*internal μ 4.4444/);
});
it('labels the forward-only explanation', () => {
  setup();
  expect(screen.getByRole('heading', { name: 'Forward-only correction' })).toBeTruthy();
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
  await approve();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }));
  await screen.findByText('Rating changed. Preview refreshed; review and confirm again.');
  expect(screen.queryByRole('button', { name: 'Confirm decision' })).toBeNull();
  expect(screen.getByText(/Internal μ 3.5/)).toBeTruthy();
});
it('locks controls on conflicting decision', async () => {
  mocks.resolve.mockRejectedValueOnce(new Error('LEVEL_REVIEW_RESOLUTION_CONFLICT'));
  setup();
  fill();
  await approve();
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
it('follows refreshed loader data instead of a stale local snapshot', async () => {
  mocks.mark.mockResolvedValue({ request: { ...detail.request, status: 'under_review' } });
  const view = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Mark under review' }));
  await screen.findByText('Request marked under review.');
  const revalidated: LevelReviewAdminDetail = {
    ...detail,
    request: { ...detail.request, status: 'under_review' },
    current: { ...detail.current!, revision: 4, mu: 3.5, display_level: 3.5 }
  };
  view.rerender(ui(revalidated));
  expect(screen.getByText(/Internal μ 3.5/)).toBeTruthy();
  expect(screen.getByText(/Revision 4/)).toBeTruthy();
});
it('closes an open confirmation when revalidation moves the rating revision', async () => {
  const view = setup();
  fill();
  await approve();
  view.rerender(
    ui({ ...detail, current: { ...detail.current!, revision: 3, mu: 3.5, display_level: 3.5 } })
  );
  await screen.findByText('Rating changed. Preview refreshed; review and confirm again.');
  expect(screen.queryByRole('button', { name: 'Confirm decision' })).toBeNull();
  expect(mocks.resolve).not.toHaveBeenCalled();
});
it('refreshes instead of confirming when the server preview is from a newer revision', async () => {
  mocks.preview.mockResolvedValue({ ...preview, revision: 7 });
  mocks.read.mockResolvedValue({ ...detail, current: { ...detail.current!, revision: 7 } });
  setup();
  fill();
  fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
  await screen.findByText('Rating changed. Preview refreshed; review and confirm again.');
  expect(screen.queryByRole('button', { name: 'Confirm decision' })).toBeNull();
  expect(screen.getByText(/Revision 7/)).toBeTruthy();
  expect(mocks.resolve).not.toHaveBeenCalled();
});
it('sends the server preview revision with the decision and never composes a preview', async () => {
  mocks.preview.mockResolvedValue({ ...preview, revision: 7 });
  mocks.resolve.mockRejectedValueOnce(new Error('LEVEL_REVIEW_UNAVAILABLE'));
  setup({ ...detail, current: { ...detail.current!, revision: 7 } });
  fill();
  await approve();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }));
  await waitFor(() => expect(mocks.resolve).toHaveBeenCalledTimes(1));
  expect(mocks.resolve.mock.calls[0]?.[0].data.expected_revision).toBe(7);
});
it('reports a failed preview without opening the confirmation', async () => {
  mocks.preview.mockRejectedValue(new Error('LEVEL_REVIEW_UNAVAILABLE'));
  setup();
  fill();
  fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
  await screen.findByText('Could not compute the preview. Try again.');
  expect(screen.queryByRole('button', { name: 'Confirm decision' })).toBeNull();
  expect(mocks.resolve).not.toHaveBeenCalled();
});
it('renders recent rating history and a translated empty state', () => {
  const history = [
    {
      played_at: '2026-01-02T12:00:00.000000Z',
      before_display_level: 3,
      after_display_level: 3.25,
      after_reliability_percent: 50
    }
  ];
  const view = setup({ ...detail, recent_history: history });
  expect(screen.getByRole('heading', { name: 'Recent rating history' })).toBeTruthy();
  expect(screen.getByText(/Level 3\.00 → 3\.25 · Reliability 50%/)).toBeTruthy();
  view.rerender(ui(detail));
  expect(screen.getByText('No confirmed matches yet.')).toBeTruthy();
});
it('operates the confirmation by keyboard only and restores focus to the trigger on cancel', async () => {
  const user = userEvent.setup();
  setup();
  await user.type(screen.getByLabelText('Approved target level'), '4.25');
  await user.type(screen.getByLabelText('Decision note'), 'Verified');
  screen.getByRole('button', { name: 'Approve' }).focus();
  await user.keyboard('{Enter}');
  const dialog = await screen.findByRole('alertdialog');
  // Focus moves into the dialog and stays inside it while it is open.
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  await user.tab();
  expect(dialog.contains(document.activeElement)).toBe(true);
  await user.tab({ shift: true });
  expect(dialog.contains(document.activeElement)).toBe(true);
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Approve' }))
  );
  expect(mocks.resolve).not.toHaveBeenCalled();
});
it('returns focus to the trigger after a keyboard cancel of the reject confirmation', async () => {
  const user = userEvent.setup();
  setup();
  await user.type(screen.getByLabelText('Decision note'), 'No');
  screen.getByRole('button', { name: 'Reject' }).focus();
  await user.keyboard(' ');
  await screen.findByRole('alertdialog', { name: 'Confirm rejection?' });
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reject' }))
  );
});
it('denies and locks the form when the admin role is revoked before the preview', async () => {
  mocks.preview.mockRejectedValue(new Error('LEVEL_REVIEW_FORBIDDEN'));
  setup();
  fill();
  fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
  await screen.findByText("You can't request or see this review.");
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
  expect(mocks.resolve).not.toHaveBeenCalled();
});
it('denies the decision when the admin role is revoked between preview and confirmation', async () => {
  mocks.resolve.mockRejectedValueOnce(new Error('LEVEL_REVIEW_FORBIDDEN'));
  setup();
  fill();
  await approve();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }));
  await screen.findByText("You can't request or see this review.");
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
});
it('denies marking under review when the admin role is revoked', async () => {
  mocks.mark.mockRejectedValue(new Error('LEVEL_REVIEW_FORBIDDEN'));
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Mark under review' }));
  await screen.findByText("You can't request or see this review.");
  expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
});
it('reports an expired session as a translated error and locks the form', async () => {
  mocks.resolve.mockRejectedValueOnce(new Error('UNAUTHENTICATED'));
  setup();
  fill();
  await approve();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }));
  await screen.findByText('Your session expired. Sign in again.');
  expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
});
it('shows a translated resolve failure inside the open confirmation and keeps it retryable', async () => {
  mocks.resolve.mockRejectedValueOnce(new Error('boom'));
  setup();
  fill();
  await approve();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }));
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toBe(
    'The result could not be confirmed. Retry the same decision safely.'
  );
  expect(screen.getByRole('alertdialog')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Confirm decision' })).toBeTruthy();
});
it('shows a translated failure when the stale-rating refresh itself fails', async () => {
  mocks.resolve.mockRejectedValueOnce(new Error('LEVEL_REVIEW_STALE_RATING'));
  mocks.read.mockRejectedValue(new Error('LEVEL_REVIEW_UNAVAILABLE'));
  setup();
  fill();
  await approve();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }));
  await screen.findByText('Could not refresh the preview. Reload before deciding.');
  expect(screen.queryByRole('button', { name: 'Confirm decision' })).toBeNull();
});
it('reports the preview failure translated in a non-English locale', async () => {
  mocks.preview.mockRejectedValue(new Error('LEVEL_REVIEW_UNAVAILABLE'));
  const i18n = createI18n('pt-BR');
  const label = (key: string) => i18n.t('levelReview.adminDecision.' + key);
  render(
    <I18nextProvider i18n={i18n}>
      <PlatformLevelReviewDetail initial={detail} onRevalidate={() => {}} />
    </I18nextProvider>
  );
  fireEvent.change(screen.getByLabelText(label('target')), { target: { value: '4,25' } });
  fireEvent.change(screen.getByLabelText(label('note')), { target: { value: 'Ok' } });
  fireEvent.click(screen.getByRole('button', { name: label('approve') }));
  await screen.findByText(label('previewFailed'));
  expect(label('previewFailed')).not.toBe('Could not compute the preview. Try again.');
});
it('terminal request is read only', () => {
  setup({ ...detail, request: { ...detail.request, status: 'rejected', decision_note: 'No' } });
  expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  expect(screen.getByText('No')).toBeTruthy();
});
