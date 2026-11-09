import { beforeAll, describe, expect, it, vi } from 'vitest';
import webPush from 'web-push';
import type { PushTransport } from '../src/features/notifications/push-transport.server';
import { dispatchNotificationPush } from '../src/features/notifications/push-dispatch.server';
import { localAdminClient } from './helpers/match-add-player-fixtures';
import { signUpFixtureActor } from './helpers/provisional-player-fixtures';
import { submitRequest } from './helpers/level-review-fixtures';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { executeTrustedSql, queryTrustedSql } from './helpers/sql-transport';
import { ratingEvidenceCleanupSql } from './helpers/fixture-cleanup';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
const query = async (sql: string, values: unknown[] = []) =>
  (await queryTrustedSql(sql, { values })).rows;

// Global claimant + real service-role RPCs, therefore intentionally serial.
describe.skipIf(!environment.env)('Push dispatcher with real outbox and domain transition', () => {
  let client: ReturnType<typeof localAdminClient>;
  beforeAll(() => {
    client = localAdminClient(environment.env!);
  });
  it.each([404, 410, 429, 503, 400, 401, 403, 'timeout'] as const)(
    'provider %s preserves in-app and independent second device',
    async (outcome) => {
      const owner = await signUpFixtureActor(environment.env!, `push-send-${outcome}`, {
        displayName: 'Push Owner',
        level: 4
      });
      // Defer unrelated pending jobs temporarily; restore exact due timestamps in finally.
      const held =
        await query(`with held as materialized (select notification_id,next_attempt_at from public.notification_push_jobs where status='pending' for update)
      update public.notification_push_jobs j set next_attempt_at=now()+interval '2 days' from held h where j.notification_id=h.notification_id returning h.notification_id,h.next_attempt_at`);
      const vapid = webPush.generateVAPIDKeys();
      const keyring = {
        keys: new Map([['test-key', { ...vapid, subject: 'mailto:test@example.test' }]]),
        revoked: []
      };
      const endpoints = [0, 1].map(
        () => `https://fcm.googleapis.com/fcm/send/${crypto.randomUUID()}`
      );
      const log = vi.spyOn(console, 'info').mockImplementation(() => {});
      try {
        for (const endpoint of endpoints)
          expect(
            (
              await owner.client.rpc('register_my_push_subscription', {
                p_endpoint: endpoint,
                p_p256dh: vapid.publicKey,
                p_auth: Buffer.alloc(16, 7).toString('base64url'),
                p_vapid_key_id: 'test-key',
                p_locale: 'es'
              })
            ).error
          ).toBeNull();
        expect(
          (
            await owner.client.rpc('set_my_notification_preferences', {
              p_push_enabled: true,
              p_push_community: true,
              p_push_matches: true,
              p_push_results: true,
              p_push_rankings: true,
              p_push_leagues: true
            })
          ).error
        ).toBeNull();
        const requestId = await submitRequest(owner); // Actual production domain command, not hand-inserted alert.
        // Other suites may have many platform reviewers. Their zero-device jobs must not crowd this
        // isolated owner's notification out of the bounded claim; all fixture notices are removed below.
        await query(
          `update public.notification_push_jobs j set next_attempt_at=now()+interval '2 days' from public.notifications n where n.id=j.notification_id and n.target_id=$1 and n.recipient_user_id<>$2`,
          [requestId, owner.id]
        );
        const [notice] = await query(
          `select id::text,read_at from public.notifications where recipient_user_id=$1 and target_id=$2 and kind='level_review_submitted'`,
          [owner.id, requestId]
        );
        expect(notice).toBeDefined();
        let firstEndpoint: string | undefined;
        const sent: string[] = [];
        const send = vi.fn<PushTransport>(async (device: { endpoint: string }, payload: string) => {
          sent.push(device.endpoint);
          expect(JSON.parse(payload)).toMatchObject({
            notificationId: notice!.id,
            category: 'rankings'
          });
          if (sent.length === 1) {
            firstEndpoint = device.endpoint;
            if (outcome === 'timeout') throw new Error('provider timeout with sensitive endpoint');
            return { status: outcome, retryAfter: outcome === 429 ? '1200' : null };
          }
          return { status: 201, retryAfter: null };
        });
        await expect(
          dispatchNotificationPush(client, keyring, send).then(
            () => null,
            (error: unknown) => (error instanceof Error ? error.message : 'unexpected')
          )
        ).resolves.toBe(outcome === 401 || outcome === 403 ? 'PUSH_CONFIG_UNAVAILABLE' : null);
        expect(send).toHaveBeenCalledTimes(2);
        const devices = await query(
          `select s.endpoint,s.retired_at,d.status,d.attempt_count from public.notification_push_deliveries d join public.push_subscriptions s on s.id=d.subscription_id where d.notification_id=$1`,
          [notice!.id]
        );
        const first = devices.find((row) => row.endpoint === firstEndpoint)!;
        const second = devices.find((row) => row.endpoint !== firstEndpoint)!;
        expect(second).toMatchObject({ status: 'accepted', retired_at: null, attempt_count: 1 });
        const expected =
          outcome === 404 || outcome === 410 ? 'expired' : outcome === 400 ? 'failed' : 'pending';
        expect(first.status).toBe(expected);
        expect(first.retired_at !== null).toBe(outcome === 404 || outcome === 410);
        expect(first.attempt_count).toBe(outcome === 401 || outcome === 403 ? 0 : 1);
        expect(
          await query('select id::text,read_at from public.notifications where id=$1', [notice!.id])
        ).toEqual([notice]);
        // Before a retry, switch global intent off: first becomes terminal skipped, second never resent.
        if (expected === 'pending') {
          await executeTrustedSql(`update public.notification_preferences set push_enabled=false where user_id='${owner.id}';
          update public.notification_push_deliveries set next_attempt_at=now() where notification_id='${String(notice!.id)}' and status='pending';
          update public.notification_push_jobs set next_attempt_at=now() where notification_id='${String(notice!.id)}'`);
          await dispatchNotificationPush(client, keyring, send);
        }
        expect(send).toHaveBeenCalledTimes(2);
        expect(
          (
            await query(
              'select status from public.notification_push_deliveries where notification_id=$1 order by status',
              [notice!.id]
            )
          ).map((row) => row.status)
        ).toEqual(['accepted', expected === 'pending' ? 'skipped' : expected]);
        expect(JSON.stringify(log.mock.calls)).not.toContain('fcm.googleapis.com');
      } finally {
        log.mockRestore();
        await executeTrustedSql(
          `delete from public.notifications where target_type='level_review_request' and target_id in(select id from public.player_level_review_requests where owner_id='${owner.id}'); ${ratingEvidenceCleanupSql(`'${owner.id}'::uuid`)} delete from auth.users where id='${owner.id}'`
        );
        await query(
          `update public.notification_push_jobs j set next_attempt_at=h.next_attempt_at from jsonb_to_recordset($1::jsonb) as h(notification_id uuid,next_attempt_at timestamptz) where j.notification_id=h.notification_id and j.status='pending'`,
          [JSON.stringify(held)]
        );
      }
    },
    60000
  );

  // Staggered retries (device A backs off on 429 while device B retries on 503 and then succeeds) make
  // the job claim far more often than either delivery sends. Each delivery owns its attempt budget, so
  // job claims must never exhaust a device early; exhaustion is durable per device.
  it('bounds staggered multi-device retries by each delivery budget, not by job claims', async () => {
    const owner = await signUpFixtureActor(environment.env!, 'push-staggered', {
      displayName: 'Push Staggered',
      level: 4
    });
    const held =
      await query(`with held as materialized (select notification_id,next_attempt_at from public.notification_push_jobs where status='pending' for update)
      update public.notification_push_jobs j set next_attempt_at=now()+interval '2 days' from held h where j.notification_id=h.notification_id returning h.notification_id,h.next_attempt_at`);
    const vapid = webPush.generateVAPIDKeys();
    const keyring = {
      keys: new Map([['test-key', { ...vapid, subject: 'mailto:test@example.test' }]]),
      revoked: []
    };
    const deviceA = `https://fcm.googleapis.com/fcm/send/${crypto.randomUUID()}`;
    const deviceB = `https://fcm.googleapis.com/fcm/send/${crypto.randomUUID()}`;
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      for (const endpoint of [deviceA, deviceB])
        expect(
          (
            await owner.client.rpc('register_my_push_subscription', {
              p_endpoint: endpoint,
              p_p256dh: vapid.publicKey,
              p_auth: Buffer.alloc(16, 7).toString('base64url'),
              p_vapid_key_id: 'test-key',
              p_locale: 'en'
            })
          ).error
        ).toBeNull();
      expect(
        (
          await owner.client.rpc('set_my_notification_preferences', {
            p_push_enabled: true,
            p_push_community: true,
            p_push_matches: true,
            p_push_results: true,
            p_push_rankings: true,
            p_push_leagues: true
          })
        ).error
      ).toBeNull();
      const requestId = await submitRequest(owner);
      await query(
        `update public.notification_push_jobs j set next_attempt_at=now()+interval '2 days' from public.notifications n where n.id=j.notification_id and n.target_id=$1 and n.recipient_user_id<>$2`,
        [requestId, owner.id]
      );
      const [notice] = await query(
        `select id::text from public.notifications where recipient_user_id=$1 and target_id=$2 and kind='level_review_submitted'`,
        [owner.id, requestId]
      );
      const attempts = new Map([
        [deviceA, 0],
        [deviceB, 0]
      ]);
      const send = vi.fn<PushTransport>(async (device: { endpoint: string }) => {
        const attempt = (attempts.get(device.endpoint) ?? 0) + 1;
        attempts.set(device.endpoint, attempt);
        if (device.endpoint === deviceA) return { status: 429, retryAfter: '1200' };
        return attempt < 4 ? { status: 503, retryAfter: null } : { status: 201, retryAfter: null };
      });
      const deliveries = () =>
        query(
          `select s.endpoint,d.status,d.attempt_count::int as attempts from public.notification_push_deliveries d join public.push_subscriptions s on s.id=d.subscription_id where d.notification_id=$1`,
          [notice!.id]
        );
      let afterEightClaims: Awaited<ReturnType<typeof deliveries>> = [];
      // Only one device is due per round, so every round is one more job claim for a single send.
      for (let round = 1; round <= 11; round += 1) {
        const target = round % 2 === 1 ? deviceA : deviceB;
        await executeTrustedSql(
          `update public.notification_push_deliveries d set next_attempt_at = case when s.endpoint='${target}' then now() else now()+interval '1 day' end from public.push_subscriptions s where s.id=d.subscription_id and d.notification_id='${String(notice!.id)}' and d.status='pending';
          update public.notification_push_jobs set next_attempt_at=now() where notification_id='${String(notice!.id)}' and status='pending'`
        );
        await dispatchNotificationPush(client, keyring, send);
        if (round === 8) afterEightClaims = await deliveries();
      }
      // Eight job claims already exceed the old job budget, yet both devices kept their own attempts.
      expect(afterEightClaims).toEqual(
        expect.arrayContaining([
          { endpoint: deviceB, status: 'accepted', attempts: 4 },
          { endpoint: deviceA, status: 'pending', attempts: 4 }
        ])
      );
      expect(await deliveries()).toEqual(
        expect.arrayContaining([
          { endpoint: deviceA, status: 'exhausted', attempts: 6 },
          { endpoint: deviceB, status: 'accepted', attempts: 4 }
        ])
      );
      expect(attempts.get(deviceA)).toBe(6);
      expect(attempts.get(deviceB)).toBe(4);
      expect(
        await query(
          'select status,attempt_count::int as claims from public.notification_push_jobs where notification_id=$1',
          [notice!.id]
        )
      ).toEqual([{ status: 'exhausted', claims: 0 }]);
    } finally {
      log.mockRestore();
      await executeTrustedSql(
        `delete from public.notifications where target_type='level_review_request' and target_id in(select id from public.player_level_review_requests where owner_id='${owner.id}'); ${ratingEvidenceCleanupSql(`'${owner.id}'::uuid`)} delete from auth.users where id='${owner.id}'`
      );
      await query(
        `update public.notification_push_jobs j set next_attempt_at=h.next_attempt_at from jsonb_to_recordset($1::jsonb) as h(notification_id uuid,next_attempt_at timestamptz) where j.notification_id=h.notification_id and j.status='pending'`,
        [JSON.stringify(held)]
      );
    }
  }, 120000);
});
