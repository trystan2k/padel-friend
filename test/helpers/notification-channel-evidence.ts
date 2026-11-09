import { expect } from 'vitest';
import { NOTIFICATION_CHANNEL_MATRIX } from '../fixtures/notification-channel-matrix';
import { NOTIFICATION_CHANNEL_PROOFS } from '../fixtures/notification-channel-proofs';
import { queryTrustedSql } from './sql-transport';

/** Generate row-to-proof evidence from the versioned inventory; reject missing/duplicate bindings. */
export function notificationChannelLedger() {
  return NOTIFICATION_CHANNEL_MATRIX.map((row) => {
    const proofs = NOTIFICATION_CHANNEL_PROOFS.filter((proof) => proof.events.includes(row.event));
    if (proofs.length !== 1) throw new Error('Expected one proof for ' + row.event);
    const proof = proofs[0]!;
    return { ...row, testName: proof.testName, recipients: proof.recipients };
  });
}

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

/** Prove a transition's exact in-app recipients and one durable Push job per persisted notification. */
export async function expectNotificationOutcome({
  targetId,
  kind,
  recipients
}: {
  targetId: string;
  kind: string;
  recipients: readonly string[];
}) {
  const result = await queryTrustedSql(
    `select n.recipient_user_id::text as recipient, n.id::text as id, j.notification_id::text as job from public.notifications n left join public.notification_push_jobs j on j.notification_id=n.id where n.target_id=$1 and n.kind=$2 order by n.recipient_user_id`,
    { values: [targetId, kind] }
  );
  expect(
    result.rows.map((row) => String(row.recipient)),
    `${kind} recipients`
  ).toEqual([...recipients].sort((a, b) => a.localeCompare(b)));
  expect(
    result.rows.map((row) => row.job),
    `${kind} push jobs`
  ).toEqual(result.rows.map((row) => row.id));
}
