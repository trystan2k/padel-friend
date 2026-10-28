import { describe, expect, it, vi } from 'vitest';
import {
  assertLocalSupabaseEnvInCi,
  dotEnvPathFromImportMetaUrl,
  localSupabaseEnv
} from './local-supabase-env';
import {
  openDedicatedSqlConnection,
  queryTrustedSql,
  sqlErrorMessage,
  startSql
} from './sql-transport';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

describe('trusted SQL transport integration', () => {
  it('requires local Supabase in CI', () => {
    expect(() => assertLocalSupabaseEnvInCi(environment.env, process.env.CI)).not.toThrow();
  });

  describe.skipIf(environment.env === null)('local PostgreSQL pool behavior', () => {
    it('preserves CLI temporal JSON precision and a consistent SQL error contract', async () => {
      const result = await queryTrustedSql(`
        SELECT '2026-11-07 09:48:35.123456+02:00'::timestamptz AS instant,
               '2026-11-07'::date AS day,
               '2026-11-07 07:48:35.120000'::timestamp AS local_timestamp
      `);
      expect(result.rows[0]).toEqual({
        instant: '2026-11-07T07:48:35.123456Z',
        day: '2026-11-07T00:00:00Z',
        local_timestamp: '2026-11-07T07:48:35.12Z'
      });

      const failingSql = `DO $failure$
        BEGIN
          RAISE EXCEPTION 'transport failure'
            USING ERRCODE = '23514', DETAIL = 'fixture detail';
        END
      $failure$;`;
      const queryError = await queryTrustedSql(failingSql).then(
        () => undefined,
        (error: unknown) => error
      );
      expect(queryError).toMatchObject({
        code: '23514',
        message: 'transport failure',
        detail: 'fixture detail'
      });
      expect(sqlErrorMessage(queryError)).toBe('23514: transport failure\nDETAIL: fixture detail');

      const handle = startSql(failingSql);
      try {
        const sqlResult = await handle.done;
        expect(sqlResult.code).toBe(1);
        expect(sqlResult.sqlError).toMatchObject({
          code: '23514',
          message: 'transport failure',
          detail: 'fixture detail'
        });
        expect(sqlResult.stderr).toBe('23514: transport failure\nDETAIL: fixture detail');
      } finally {
        await handle.stop();
      }
    });

    it('rejects timed-out queries and discards the failed connection', async () => {
      const before = await queryTrustedSql('SELECT pg_catalog.pg_backend_pid() AS pid');
      const beforePid = Number(before.rows[0]?.['pid']);

      await expect(
        queryTrustedSql('SELECT pg_catalog.pg_sleep(5)', { timeoutMs: 50 })
      ).rejects.toMatchObject({ code: '57014' });

      const after = await queryTrustedSql('SELECT pg_catalog.pg_backend_pid() AS pid');
      expect(Number(after.rows[0]?.['pid'])).not.toBe(beforePid);
    });

    it('surfaces explicit cancellation errors from dedicated connections', async () => {
      const connection = await openDedicatedSqlConnection();
      try {
        const pendingError = connection.query('SELECT pg_catalog.pg_sleep(30)').then(
          () => {
            throw new Error('Expected the dedicated query to be canceled');
          },
          (error: unknown) => error
        );
        await waitForActiveQuery(connection.backendPid);

        await expect(connection.cancel()).resolves.toBe(true);
        await expect(pendingError).resolves.toMatchObject({ code: '57014' });
      } finally {
        await connection.close();
      }
    });

    it('surfaces intentional backend termination through the dedicated query promise', async () => {
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const connection = await openDedicatedSqlConnection();
        try {
          const pendingFailure = connection.query('SELECT pg_catalog.pg_sleep(30)').then(
            () => undefined,
            (error: unknown) => error
          );
          await waitForActiveQuery(connection.backendPid);

          await expect(connection.terminate()).resolves.toBe(true);
          const error = await pendingFailure;
          expect(error).toBeInstanceOf(Error);
          if (!(error instanceof Error)) throw new Error('Expected dedicated query failure');
          expect(error.message).toMatch(/terminat/i);
        } finally {
          await connection.close();
        }
        expect(warning).not.toHaveBeenCalled();
      } finally {
        warning.mockRestore();
      }
    });

    it('replaces a connection after a query failure and serves the next acquire', async () => {
      const before = await queryTrustedSql('SELECT pg_catalog.pg_backend_pid() AS pid');
      const beforePid = Number(before.rows[0]?.['pid']);

      await expect(queryTrustedSql('SELECT 1 / 0')).rejects.toMatchObject({ code: '22012' });

      const recovered = await queryTrustedSql(
        'SELECT pg_catalog.pg_backend_pid() AS pid, 42::integer AS value'
      );
      expect(Number(recovered.rows[0]?.['pid'])).not.toBe(beforePid);
      expect(recovered.rows[0]?.['value']).toBe(42);
    });

    it('discards session settings between pooled queries', async () => {
      await queryTrustedSql("SET paf_test.session_hygiene = 'leaked'");

      const next = await queryTrustedSql(
        "SELECT pg_catalog.current_setting('paf_test.session_hygiene', true) AS leaked_value"
      );
      expect(next.rows[0]?.['leaked_value']).not.toBe('leaked');
    });
  });
});

async function waitForActiveQuery(backendPid: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  do {
    const result = await queryTrustedSql(
      `SELECT state, query FROM pg_catalog.pg_stat_activity WHERE pid = $1::integer`,
      { values: [backendPid] }
    );
    const row = result.rows[0];
    if (row?.['state'] === 'active' && String(row['query']).includes('pg_sleep')) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  } while (Date.now() < deadline);

  throw new Error(`Dedicated backend ${backendPid} did not start its query`);
}
