/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from '../src/i18n/config';
import type { ResultRepairJob } from '../src/features/matches/result-dispute-model';

const mocks = vi.hoisted(() => ({
  retry: vi.fn<(options: { data: { job_id: string } }) => Promise<unknown>>()
}));
vi.mock('../src/features/result-repairs/repair.functions', () => ({
  retryResultRepair: mocks.retry
}));

import { ResultRepairStatus } from '../src/features/result-repairs/ResultRepairStatus';

const job: ResultRepairJob = {
  job_id: '11111111-1111-4111-8111-111111111111',
  amendment_id: '22222222-2222-4222-8222-222222222222',
  resolution_id: null,
  proposal_id: '33333333-3333-4333-8333-333333333333',
  group_number: 1,
  kind: 'replace',
  status: 'failed',
  publication: 'failed',
  projections_complete: false,
  attempt_count: 2,
  failure_code: 'REPLAY_FAILED',
  next_attempt_at: null,
  requested_at: '2026-10-01T10:00:00.000Z',
  started_at: null,
  finished_at: null,
  committed_revision: null
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

async function openRetryDialog(onChanged: () => void | Promise<void>) {
  const user = userEvent.setup();
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <ResultRepairStatus job={job} canRetry onChanged={onChanged} />
    </I18nextProvider>
  );
  await user.click(screen.getByRole('button', { name: 'Retry update' }));
  return {
    user,
    confirm: () => user.click(screen.getAllByRole('button', { name: 'Retry update' }).at(-1)!)
  };
}

describe('result repair retry connectivity', () => {
  it('sends nothing offline and keeps the dialog open with an offline alert', async () => {
    const onChanged = vi.fn<() => void>();
    const { confirm } = await openRetryDialog(onChanged);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });

    await confirm();

    expect((await screen.findByRole('alert')).textContent).toContain('You are offline');
    expect(mocks.retry).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('reports an unconfirmed outcome on a transport failure, refetches once and does not replay', async () => {
    mocks.retry.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const onChanged = vi.fn<() => void>();
    const { confirm } = await openRetryDialog(onChanged);

    await confirm();

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain("couldn't confirm the retry")
    );
    expect(mocks.retry).toHaveBeenCalledOnce();
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it('reports an unavailable failure without claiming an unknown outcome', async () => {
    mocks.retry.mockRejectedValueOnce(new Error('boom'));
    const onChanged = vi.fn<() => void>();
    const { confirm } = await openRetryDialog(onChanged);

    await confirm();

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('could not be retried')
    );
    expect(onChanged).not.toHaveBeenCalled();
  });
});
