import { expect, it } from 'vitest';
import { serializeMatchFixtureSql } from '../e2e/match-fixture-sql';
import {
  fixtureSql,
  sqlRows,
  startSql,
  waitForRows,
  withDeadline
} from './helpers/match-registration-sql';

it(
  'queues a parallel fixture before its relation locks and releases it on rollback',
  { timeout: 60000 },
  async () => {
    const marker = `paf108-fixture-${crypto.randomUUID()}`;
    const holder = startSql(
      serializeMatchFixtureSql(`do $$ begin
    perform set_config('application_name','${marker}',true);
    perform pg_sleep(60);
  end $$;`)
    );
    let contender: ReturnType<typeof startSql> | undefined;
    try {
      const holderRows = await waitForRows(
        `select pid from pg_stat_activity where application_name='${marker}' and wait_event='PgSleep'`,
        (rows) => rows.length === 1,
        'retained fixture serialization lock'
      );
      const pid = Number(holderRows[0]!.pid);
      contender = startSql(
        serializeMatchFixtureSql(`do $$ begin
      -- ${marker}-contender
      lock table public.match_events in share row exclusive mode;
    end $$;`)
      );
      const blocked = await waitForRows(
        `select a.pid from pg_stat_activity a where a.pid<>pg_backend_pid()
        and a.query like '%${marker}-contender%' and ${pid}=any(pg_blocking_pids(a.pid))
        and not exists(select 1 from pg_locks l where l.pid=a.pid
          and l.relation='public.match_events'::regclass and l.granted)`,
        (rows) => rows.length === 1,
        'parallel fixture waits before taking match-event relation lock'
      );
      expect(blocked).toHaveLength(1);
      expect(await sqlRows(`select pg_terminate_backend(${pid}) as released`)).toEqual([
        { released: true }
      ]);
      expect((await withDeadline(contender.done, 30000, 'released fixture contender')).code).toBe(
        0
      );
    } finally {
      await holder.stop();
      await contender?.stop();
    }
  }
);

it('releases the fixture transaction lock after an SQL error', { timeout: 30000 }, async () => {
  await expect(
    fixtureSql(
      serializeMatchFixtureSql("do $$ begin raise exception 'FIXTURE_ROLLBACK_PROBE'; end $$;")
    )
  ).rejects.toThrow('FIXTURE_ROLLBACK_PROBE');
  await fixtureSql(
    serializeMatchFixtureSql(
      "do $$ begin perform set_config('lock_timeout','1s',true); perform 1; end $$;"
    )
  );
});
