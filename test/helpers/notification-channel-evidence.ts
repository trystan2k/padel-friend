import { expect } from 'vitest';
import { queryTrustedSql } from './sql-transport';

/** Attach Push identity proof to existing exact-recipient domain-transition suites, without replacing them. */
export async function expectNotificationPushJobs(
  notifications: readonly Record<string, unknown>[]
) {
  const ids = notifications.map((row) => String(row.id)).sort();
  if (!ids.length) return;
  const result = await queryTrustedSql(
    `select n.id::text as id, j.notification_id::text as job from public.notifications n left join public.notification_push_jobs j on j.notification_id=n.id where n.id=any($1::uuid[]) order by n.id`,
    { values: [ids] }
  );
  expect(result.rows).toEqual(ids.map((id) => ({ id, job: id })));
}
