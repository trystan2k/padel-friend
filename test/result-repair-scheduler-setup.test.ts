import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INTEGRATION_DB_URL_ENV } from '../scripts/integration-db-url.mjs';
import setupResultRepairScheduler from './helpers/result-repair-scheduler-setup';

const mocks = vi.hoisted(() => ({
  status: vi.fn<(...args: unknown[]) => string>(),
  connect: vi.fn<() => Promise<void>>(),
  query: vi.fn<(...args: unknown[]) => Promise<{ rows: unknown[] }>>(),
  end: vi.fn<() => Promise<void>>(),
  constructor: vi.fn<(options: unknown) => void>()
}));
vi.mock('node:child_process', () => ({ execFileSync: mocks.status }));
vi.mock('pg', () => ({
  Client: class {
    constructor(options: unknown) {
      mocks.constructor(options);
    }
    connect = mocks.connect;
    query = mocks.query;
    end = mocks.end;
  }
}));

describe('integration repair scheduler isolation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv(INTEGRATION_DB_URL_ENV, undefined);
    mocks.status.mockReturnValue(
      'DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"'
    );
    mocks.connect.mockResolvedValue(undefined);
    mocks.end.mockResolvedValue(undefined);
    mocks.query.mockResolvedValue({ rows: [] });
  });

  it('pauses only repair and amendment jobs and restores their exact previous active settings', async () => {
    const jobs = [
      { jobid: 12, active: true },
      { jobid: 13, active: false }
    ];
    mocks.query
      .mockResolvedValueOnce({ rows: [{ available: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: jobs });
    const teardown = await setupResultRepairScheduler();
    expect(mocks.query).toHaveBeenCalledWith(
      'select jobid, active from cron.job where jobname = any($1::text[])',
      [
        [
          'padel-friend-result-repair-claim',
          'padel-friend-result-repair-run',
          'padel-friend-result-amendment-auto-accept'
        ]
      ]
    );
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('cron.alter_job'), [
      12,
      false
    ]);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('cron.alter_job'), [
      13,
      false
    ]);
    expect(mocks.end).not.toHaveBeenCalled();
    if (!teardown) throw new Error('Missing scheduler teardown');
    await teardown();
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('cron.alter_job'), [12, true]);
    expect(mocks.query).toHaveBeenLastCalledWith(expect.stringContaining('cron.alter_job'), [
      13,
      false
    ]);
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it('leaves databases without pg_cron alone and closes the connection', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ available: false }] });
    expect(await setupResultRepairScheduler()).toBeUndefined();
    expect(mocks.query).toHaveBeenCalledOnce();
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it.each([
    'API_URL="http://localhost"',
    'DB_URL="postgresql://postgres:postgres@db.example.com/postgres"'
  ])('rejects missing or nonlocal database configuration before connecting: %s', async (status) => {
    mocks.status.mockReturnValue(status);
    await expect(setupResultRepairScheduler()).rejects.toThrow(/DB_URL|local database/);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('uses the launcher-provided database URL without calling the Supabase CLI', async () => {
    const handedOff = 'postgresql://postgres:handoff-pw@127.0.0.1:55322/postgres';
    vi.stubEnv(INTEGRATION_DB_URL_ENV, handedOff);
    mocks.query.mockResolvedValueOnce({ rows: [{ available: false }] });
    await setupResultRepairScheduler();
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.constructor).toHaveBeenCalledWith(
      expect.objectContaining({ connectionString: handedOff })
    );
  });

  it.each([
    ['empty', ''],
    ['malformed', 'handoff-pw not a url'],
    ['non-loopback', 'postgresql://postgres:handoff-pw@db.example.com:55322/postgres'],
    ['wrong port', 'postgresql://postgres:handoff-pw@127.0.0.1:5432/postgres']
  ])(
    'fails closed on a %s launcher value without CLI fallback or leaking it',
    async (_l, value) => {
      vi.stubEnv(INTEGRATION_DB_URL_ENV, value);
      const failure = await setupResultRepairScheduler().then(
        () => undefined,
        (error: unknown) => error
      );
      expect(failure).toBeInstanceOf(Error);
      expect(failure instanceof Error ? failure.message : '').not.toContain('handoff-pw');
      expect(mocks.status).not.toHaveBeenCalled();
      expect(mocks.connect).not.toHaveBeenCalled();
    }
  );

  it('closes the connection and propagates setup failures', async () => {
    mocks.query.mockRejectedValueOnce(new Error('scheduler unavailable'));
    await expect(setupResultRepairScheduler()).rejects.toThrow('scheduler unavailable');
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it('closes the connection even when restoring scheduler settings fails', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ available: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ jobid: 12, active: true }] });
    const teardown = await setupResultRepairScheduler();
    if (!teardown) throw new Error('Missing scheduler teardown');
    mocks.query.mockRejectedValueOnce(new Error('restore unavailable'));
    await expect(teardown()).rejects.toThrow('restore unavailable');
    expect(mocks.end).toHaveBeenCalledOnce();
  });
});
