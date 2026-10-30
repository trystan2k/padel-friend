import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForRows } from './match-registration-sql';
import { queryTrustedSql } from './sql-transport';

vi.mock('./sql-transport', () => ({
  queryTrustedSql: vi.fn<typeof queryTrustedSql>(),
  registerSqlTransportCleanup: vi.fn<() => void>()
}));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('waitForRows', () => {
  it('polls until the probe proves readiness', async () => {
    vi.useFakeTimers();
    vi.mocked(queryTrustedSql)
      .mockResolvedValueOnce({ rows: [], command: 'SELECT', rowCount: 0, oid: 0, fields: [] })
      .mockResolvedValueOnce({
        rows: [{ locked: true }],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: []
      });
    const pending = waitForRows('probe', (rows) => rows.length === 1, 'lock', 100);
    await vi.advanceTimersByTimeAsync(25);
    await expect(pending).resolves.toEqual([{ locked: true }]);
    expect(queryTrustedSql).toHaveBeenCalledTimes(2);
  });

  it('rejects when the deadline expires without readiness', async () => {
    vi.useFakeTimers();
    vi.mocked(queryTrustedSql).mockResolvedValue({
      rows: [],
      command: 'SELECT',
      rowCount: 0,
      oid: 0,
      fields: []
    });
    const pending = waitForRows('probe', (rows) => rows.length === 1, 'lock', 50);
    const failure = pending.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(50);
    expect(await failure).toEqual(new Error('Timed out waiting for lock: []'));
    expect(queryTrustedSql).toHaveBeenCalledTimes(2);
  });
});
