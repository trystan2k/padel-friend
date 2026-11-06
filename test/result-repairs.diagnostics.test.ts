/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  getResultRepairAttempts,
  retryResultRepair
} from '../src/features/result-repairs/repair.functions';
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
const attempt = {
  attempt_id: job.job_id,
  job_id: job.job_id,
  attempt_number: 1,
  status: 'failed',
  base_revision: 1,
  result_revision: null,
  failure_code: 'PUBLICATION_FAILED',
  started_at: job.requested_at,
  finished_at: job.requested_at
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
      .mockResolvedValueOnce({ status: 'ok', value: [attempt] });
    const view = (count: number) =>
      createElement(ResultRepairDiagnostics, {
        diagnostics: { jobs: [{ ...job, attempt_count: count }], scheduler: null },
        scope: { kind: 'platform' },
        onRefresh: vi.fn<() => void>()
      });
    const { rerender } = render(view(0));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    rerender(view(1));
    await screen.findByRole('list', { name: 'matches.corrections.diagnostics.attemptsCaption' });
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
      const list = await screen.findByRole('list', {
        name: 'matches.corrections.diagnostics.attemptsCaption'
      });
      expect(list.textContent).toContain(expected);
      expect(list.textContent).toContain(
        `matches.corrections.repair.failureCodes.${expectedFailure}`
      );
      expect(list.textContent).not.toContain('private_backend');
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
  it('announces a rejected retry request inside the open confirm dialog', async () => {
    vi.mocked(retryResultRepair).mockReset().mockRejectedValue(new Error('network down'));
    const refresh = vi.fn<() => void>();
    render(
      createElement(ResultRepairDiagnostics, {
        diagnostics: {
          jobs: [{ ...job, status: 'failed', failure_code: 'PUBLICATION_FAILED', retryable: true }],
          scheduler: null
        },
        scope: { kind: 'platform' },
        onRefresh: refresh
      })
    );
    await userEvent.click(screen.getByRole('button', { name: 'matches.corrections.repair.retry' }));
    await userEvent.click(
      screen.getByRole('button', { name: 'matches.corrections.repair.confirmAction' })
    );
    const dialog = await screen.findByRole('dialog');
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toBe('matches.corrections.repair.retryErrors.unavailable');
    expect(dialog.textContent).not.toContain('network down');
    expect(refresh).not.toHaveBeenCalled();
    // A fresh attempt clears the stale error while it runs.
    vi.mocked(retryResultRepair).mockReturnValue(new Promise(() => undefined));
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'matches.corrections.repair.confirmAction' })
    );
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });
  it('does not re-announce a dismissed retry error when the dialog reopens', async () => {
    vi.mocked(retryResultRepair).mockReset().mockRejectedValue(new Error('network down'));
    render(
      createElement(ResultRepairDiagnostics, {
        diagnostics: {
          jobs: [{ ...job, status: 'failed', failure_code: 'PUBLICATION_FAILED', retryable: true }],
          scheduler: null
        },
        scope: { kind: 'platform' },
        onRefresh: vi.fn<() => void>()
      })
    );
    const retryButton = () =>
      screen.getByRole('button', { name: 'matches.corrections.repair.retry' });
    await userEvent.click(retryButton());
    await userEvent.click(
      screen.getByRole('button', { name: 'matches.corrections.repair.confirmAction' })
    );
    expect(await within(await screen.findByRole('dialog')).findByRole('alert')).toBeTruthy();

    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'matches.corrections.dialog.cancel'
      })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await userEvent.click(retryButton());
    expect(within(await screen.findByRole('dialog')).queryByRole('alert')).toBeNull();

    // A new failed attempt announces again.
    await userEvent.click(
      screen.getByRole('button', { name: 'matches.corrections.repair.confirmAction' })
    );
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toBeTruthy();
  });
  it('lays out the queue before the adjacent detail column in DOM order', () => {
    const { container } = mount('failed');
    const queue = container.querySelector('[data-repair-region="queue"]');
    const detail = container.querySelector('[data-repair-region="detail"]');
    expect(queue).not.toBeNull();
    expect(detail).not.toBeNull();
    expect(queue!.compareDocumentPosition(detail!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(queue!.querySelector('[data-repair-job]')).not.toBeNull();
    expect(detail!.querySelector('[data-repair-count]')).not.toBeNull();
    expect(detail!.querySelector('[data-repair-job]')).toBeNull();
    expect(detail!.querySelector('[data-repair-detail]')).not.toBeNull();
  });
  it('renders a distinct translated heading for every status in the summary', () => {
    mount('queued');
    const headings = screen.getAllByRole('columnheader').map((header) => header.textContent);
    expect(headings).toEqual([
      'matches.corrections.repair.status.queued',
      'matches.corrections.repair.status.running',
      'matches.corrections.repair.status.failed',
      'matches.corrections.repair.status.succeeded'
    ]);
    expect(new Set(headings).size).toBe(headings.length);
    expect(headings.join('')).not.toContain('${');
  });
  describe('selected job detail', () => {
    const second = {
      ...job,
      job_id: '00000000-0000-4000-8000-000000000011',
      status: 'succeeded' as const,
      attempt_count: 1,
      committed_revision: 3,
      group_number: 2
    };
    const queue = () => document.querySelector<HTMLElement>('[data-repair-region="queue"]')!;
    const detail = () => document.querySelector<HTMLElement>('[data-repair-region="detail"]')!;
    function mountTwo() {
      vi.mocked(getResultRepairAttempts)
        .mockReset()
        .mockImplementation((options) =>
          Promise.resolve({
            status: 'ok',
            value: JSON.stringify(options).includes(second.job_id)
              ? [
                  {
                    ...attempt,
                    status: 'succeeded',
                    base_revision: 2,
                    result_revision: 3,
                    failure_code: null
                  }
                ]
              : [attempt]
          })
        );
      return render(
        createElement(ResultRepairDiagnostics, {
          diagnostics: {
            jobs: [{ ...job, status: 'failed', attempt_count: 1 }, second],
            scheduler: null
          },
          scope: { kind: 'platform' },
          onRefresh: vi.fn<() => void>()
        })
      );
    }
    const selectors = () =>
      within(queue()).getAllByRole('button', { name: /diagnostics\.jobHeading/ });

    it('selects the first job by default and exposes the choice as current', async () => {
      mountTwo();
      const [first, other] = selectors();
      expect(first!.getAttribute('aria-current')).toBe('true');
      expect(other!.getAttribute('aria-current')).toBeNull();
      expect(
        detail().querySelector('[data-repair-detail]')!.getAttribute('data-repair-detail')
      ).toBe(job.job_id);
      await within(detail()).findByRole('list', {
        name: 'matches.corrections.diagnostics.attemptsCaption'
      });
    });
    it('shows the attempt timeline, official revision and correlation ID of the picked job', async () => {
      mountTwo();
      await userEvent.click(selectors()[1]!);
      expect(selectors()[1]!.getAttribute('aria-current')).toBe('true');
      expect(selectors()[0]!.getAttribute('aria-current')).toBeNull();
      const region = detail().querySelector<HTMLElement>('[data-repair-detail]')!;
      expect(region.getAttribute('data-repair-detail')).toBe(second.job_id);
      await waitFor(() => expect(region.textContent).toContain('2 → 3'));
      expect(region.textContent).toContain(second.job_id);
      expect(region.textContent).toContain('matches.corrections.diagnostics.timeline');
      expect(region.textContent).toContain('matches.corrections.repair.status.succeeded');
    });
    it('selects with Enter and Space and moves focus with the arrow keys', async () => {
      mountTwo();
      selectors()[0]!.focus();
      await userEvent.keyboard('{ArrowDown}');
      expect(document.activeElement).toBe(selectors()[1]);
      await userEvent.keyboard('{Enter}');
      expect(selectors()[1]!.getAttribute('aria-current')).toBe('true');
      await userEvent.keyboard('{ArrowUp}');
      expect(document.activeElement).toBe(selectors()[0]);
      await userEvent.keyboard(' ');
      expect(selectors()[0]!.getAttribute('aria-current')).toBe('true');
      expect(
        detail().querySelector('[data-repair-detail]')!.getAttribute('data-repair-detail')
      ).toBe(job.job_id);
    });
    it('shows an empty prompt and no job detail when the queue is empty', () => {
      render(
        createElement(ResultRepairDiagnostics, {
          diagnostics: { jobs: [], scheduler: null },
          scope: { kind: 'platform' },
          onRefresh: vi.fn<() => void>()
        })
      );
      expect(detail().querySelector('[data-repair-detail]')).toBeNull();
      expect(detail().textContent).toContain('matches.corrections.diagnostics.detailEmpty');
    });
    it('keeps attempt evidence out of a community view', () => {
      vi.mocked(getResultRepairAttempts).mockClear();
      mount('failed');
      expect(vi.mocked(getResultRepairAttempts)).not.toHaveBeenCalled();
      expect(detail().textContent).toContain(job.job_id);
      expect(detail().textContent).not.toContain('matches.corrections.diagnostics.timeline');
    });
  });
  it('gives Retry the primary emphasis and keeps other actions neutral', () => {
    vi.mocked(retryResultRepair).mockReset();
    render(
      createElement(ResultRepairDiagnostics, {
        diagnostics: {
          jobs: [{ ...job, status: 'failed', failure_code: 'PUBLICATION_FAILED', retryable: true }],
          scheduler: null
        },
        scope: { kind: 'platform' },
        onRefresh: vi.fn<() => void>()
      })
    );
    const retry = screen.getByRole('button', { name: 'matches.corrections.repair.retry' });
    const reload = screen.getByRole('button', { name: 'matches.results.reload' });
    expect(retry.getAttribute('data-emphasis')).toBe('primary');
    expect(reload.getAttribute('data-emphasis')).toBeNull();
    expect(retry.className).not.toBe(reload.className);
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
