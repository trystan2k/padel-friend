import { describe, expect, it } from 'vitest';
import {
  parseResultRepairClaim,
  parseResultRepairDiagnostics,
  parseResultRepairExecution,
  resultRepairError
} from '../src/features/result-repairs/repair-model';

const id = (n: number) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const job = {
  job_id: id(1),
  amendment_id: id(2),
  resolution_id: null,
  proposal_id: id(3),
  group_number: 1,
  kind: 'replace',
  status: 'queued',
  publication: 'pending',
  projections_complete: false,
  attempt_count: 0,
  failure_code: null,
  next_attempt_at: null,
  requested_at: '2026-11-05T10:00:00Z',
  started_at: null,
  finished_at: null,
  committed_revision: null,
  community_id: id(4),
  failure_stage: null,
  retryable: false,
  stale_lease: false
};

describe('repair diagnostics contracts', () => {
  it('accepts sanitized pending jobs and scheduler health', () => {
    expect(
      parseResultRepairDiagnostics({
        jobs: [job],
        scheduler: { pg_cron_installed: false, provisioned: false, jobs: [], overdue_jobs: 0 }
      })
    ).toMatchObject({ jobs: [{ publication: 'pending' }], scheduler: { provisioned: false } });
  });
  it('rejects malformed or falsely published jobs', () => {
    expect(
      parseResultRepairDiagnostics({
        jobs: [{ ...job, publication: 'published' }],
        scheduler: null
      })
    ).toBeNull();
    expect(
      parseResultRepairDiagnostics({ jobs: [{ ...job, community_id: 'invalid' }], scheduler: null })
    ).toBeNull();
  });
  it('only executes an acknowledged claim with an attempt', () => {
    expect(parseResultRepairClaim({ claim: { claimed: false } })).toEqual({ claimed: false });
    expect(parseResultRepairClaim({ claim: { claimed: true, attempt_number: 0 }, job })).toBeNull();
    expect(
      parseResultRepairClaim({ claim: { claimed: true, attempt_number: 1 }, job })
    ).toMatchObject({ claimed: true, attempt_number: 1 });
  });
  it('does not infer success from an invalid execution receipt', () => {
    expect(
      parseResultRepairExecution({
        outcome: 'succeeded',
        job: { ...job, status: 'succeeded', publication: 'published' }
      })
    ).toBeNull();
    expect(parseResultRepairExecution({ outcome: 'succeeded', job })).toBeNull();
    expect(parseResultRepairExecution({ outcome: 'failed', job })).toBeNull();
    expect(parseResultRepairExecution({ outcome: 'stale', job })).toMatchObject({
      outcome: 'stale'
    });
    expect(
      parseResultRepairExecution({
        outcome: 'failed',
        job: { ...job, status: 'failed', publication: 'failed', failure_code: 'INTERNAL' }
      })
    ).toMatchObject({ outcome: 'failed' });
  });
  it('maps permission and busy errors without exposing raw SQL', () => {
    expect(resultRepairError({ message: 'RESULT_REPAIR_BUSY' })).toEqual({
      status: 'error',
      code: 'busy'
    });
    expect(resultRepairError({ code: '42501', message: 'private SQL' })).toEqual({
      status: 'error',
      code: 'forbidden'
    });
  });
});
