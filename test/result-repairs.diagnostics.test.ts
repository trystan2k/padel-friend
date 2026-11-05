/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getResultRepairAttempts } from '../src/features/result-repairs/repair.functions';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResultRepairDiagnostics } from '../src/features/result-repairs/ResultRepairDiagnostics';
import type { ResultRepairDiagnosticJob } from '../src/features/result-repairs/repair-model';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } })
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => createElement('a', {}, children)
}));
vi.mock('../src/features/result-repairs/repair.functions', () => ({
  getResultRepairAttempts: vi.fn<() => void>(),
  retryResultRepair: vi.fn<() => void>()
}));

const job: ResultRepairDiagnosticJob = {
  job_id: '00000000-0000-4000-8000-000000000001',
  amendment_id: '00000000-0000-4000-8000-000000000002',
  resolution_id: null,
  proposal_id: '00000000-0000-4000-8000-000000000003',
  community_id: '00000000-0000-4000-8000-000000000004',
  group_number: 1,
  kind: 'replace',
  status: 'queued',
  publication: 'pending',
  projections_complete: false,
  attempt_count: 0,
  failure_code: null,
  failure_stage: null,
  retryable: false,
  stale_lease: false,
  next_attempt_at: null,
  requested_at: '2026-11-05T10:00:00Z',
  started_at: null,
  finished_at: null,
  committed_revision: null
};
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function mount(status: ResultRepairDiagnosticJob['status']) {
  const refresh = vi.fn<() => void>();
  const view = render(
    createElement(ResultRepairDiagnostics, {
      diagnostics: { jobs: [{ ...job, status }], scheduler: null },
      scope: { kind: 'community', communityId: job.community_id },
      onRefresh: refresh
    })
  );
  return { ...view, refresh };
}
describe('repair diagnostics refresh and announcements', () => {
  it('refreshes open attempt evidence after retry and refuses an incomplete audit response', async () => {
    const read = vi
      .mocked(getResultRepairAttempts)
      .mockReset()
      .mockResolvedValue({ status: 'ok', value: [] });
    const view = (count: number) =>
      createElement(ResultRepairDiagnostics, {
        diagnostics: { jobs: [{ ...job, attempt_count: count }], scheduler: null },
        scope: { kind: 'platform' },
        onRefresh: vi.fn<() => void>()
      });
    const { rerender } = render(view(0));
    await userEvent.click(screen.getByText('matches.corrections.diagnostics.attempts'));
    await waitFor(() => expect(read).toHaveBeenCalled());
    const calls = read.mock.calls.length;
    rerender(view(1));
    await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(calls));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'matches.corrections.diagnostics.attemptsUnavailable'
    );
  });
  it('ignores an older attempt read that finishes after a newer read', async () => {
    type AttemptsResponse = Awaited<ReturnType<typeof getResultRepairAttempts>>;
    let resolveLate!: (value: AttemptsResponse) => void;
    const late = new Promise<AttemptsResponse>((resolve) => {
      resolveLate = resolve;
    });
    const read = vi
      .mocked(getResultRepairAttempts)
      .mockReset()
      .mockReturnValueOnce(late)
      .mockResolvedValueOnce({ status: 'ok', value: [] });
    render(
      createElement(ResultRepairDiagnostics, {
        diagnostics: { jobs: [job], scheduler: null },
        scope: { kind: 'platform' },
        onRefresh: vi.fn<() => void>()
      })
    );
    const toggle = screen.getByText('matches.corrections.diagnostics.attempts');
    await userEvent.click(toggle);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    await userEvent.click(toggle);
    await userEvent.click(toggle);
    await screen.findByRole('table', { name: 'matches.corrections.diagnostics.attemptsCaption' });
    await act(async () => resolveLate({ status: 'error', code: 'unavailable' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it.each([
    [
      'failed',
      'matches.corrections.repair.status.failed',
      'PUBLICATION_FAILED',
      'PUBLICATION_FAILED'
    ],
    ['expired', 'matches.corrections.repair.staleLease', 'LEASE_EXPIRED', 'LEASE_EXPIRED'],
    [
      'private_backend_status',
      'matches.corrections.diagnostics.schedulerStatusUnknown',
      'private_backend_failure',
      'INTERNAL'
    ]
  ])(
    'localizes attempt status %s and sanitized failure codes',
    async (status, expected, failure, expectedFailure) => {
      vi.mocked(getResultRepairAttempts)
        .mockReset()
        .mockResolvedValue({
          status: 'ok',
          value: [
            {
              attempt_id: job.job_id,
              job_id: job.job_id,
              attempt_number: 1,
              status,
              base_revision: 1,
              result_revision: null,
              failure_code: failure,
              started_at: job.requested_at,
              finished_at: job.requested_at
            }
          ]
        });
      render(
        createElement(ResultRepairDiagnostics, {
          diagnostics: { jobs: [{ ...job, attempt_count: 1 }], scheduler: null },
          scope: { kind: 'platform' },
          onRefresh: vi.fn<() => void>()
        })
      );
      await userEvent.click(screen.getByText('matches.corrections.diagnostics.attempts'));
      const table = await screen.findByRole('table', {
        name: 'matches.corrections.diagnostics.attemptsCaption'
      });
      expect(table.textContent).toContain(expected);
      expect(table.textContent).toContain(
        `matches.corrections.repair.failureCodes.${expectedFailure}`
      );
      expect(table.textContent).not.toContain('private_backend');
    }
  );
  it.each(['queued', 'running'] as const)(
    'refreshes %s work and clears interval on unmount',
    (status) => {
      vi.useFakeTimers();
      const { refresh, unmount } = mount(status);
      vi.advanceTimersByTime(10_000);
      expect(refresh).toHaveBeenCalledTimes(1);
      unmount();
      vi.advanceTimersByTime(20_000);
      expect(refresh).toHaveBeenCalledTimes(1);
    }
  );
  it.each(['failed', 'succeeded'] as const)('does not poll %s work', (status) => {
    vi.useFakeTimers();
    const { refresh } = mount(status);
    vi.advanceTimersByTime(30_000);
    expect(refresh).not.toHaveBeenCalled();
  });
  it('pins status timestamps to UTC when no event timezone exists', () => {
    const format = vi.spyOn(Intl, 'DateTimeFormat');
    mount('running');
    expect(format).toHaveBeenCalledWith('en-GB', expect.objectContaining({ timeZone: 'UTC' }));
  });
  it.each([
    ['failed', 'matches.corrections.repair.status.failed'],
    ['unrecognized_backend_state', 'matches.corrections.diagnostics.schedulerStatusUnknown']
  ])('translates scheduler status %s without rendering raw tokens', (status, expected) => {
    render(
      createElement(ResultRepairDiagnostics, {
        diagnostics: {
          jobs: [],
          scheduler: {
            pg_cron_installed: true,
            provisioned: true,
            overdue_jobs: 0,
            jobs: [
              {
                name: 'result-repair',
                schedule: '* * * * *',
                active: true,
                last_run_at: '2026-11-05T10:00:00Z',
                last_status: status
              }
            ]
          }
        },
        scope: { kind: 'platform' },
        onRefresh: vi.fn<() => void>()
      })
    );
    const table = screen.getByRole('table', {
      name: 'matches.corrections.diagnostics.schedulerCaption'
    });
    expect(table.textContent).toContain(expected);
    expect(table.textContent).not.toContain('unrecognized_backend_state');
  });
  it('offers translated Reload and live status without moving focus', () => {
    const { refresh } = mount('running');
    fireEvent.click(screen.getByRole('button', { name: 'matches.results.reload' }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('status')[0]!.textContent).toBe(
      'matches.corrections.repair.status.running'
    );
  });
});
