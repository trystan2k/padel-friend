import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  beforeEach(() => {
    vi.resetAllMocks();
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
