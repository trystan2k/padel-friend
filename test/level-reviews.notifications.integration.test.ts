import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeNotificationTarget } from '../src/features/notifications/notification-target';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import {
  drainDueRegistrationCutoffs,
  adjustmentCount,
  approveArgs,
  approveOk,
  levelReviewRow,
  levelReviewWorld,
  platformAdminPlayer,
  ratingFingerprint,
  submitArgs,
  submitExact,
  submitRequest,
  type LevelReviewActor,
  type LevelReviewWorld
} from './helpers/level-review-fixtures';
import {
  confirmedGroup,
  nextTailPlayedAt,
  ratingWorld,
  toQuartet,
  type RatingWorld
} from './helpers/rating-fixtures';
import { sqlText } from './helpers/provisional-player-fixtures';
import { executeTrustedSql, queryTrustedSql, type SqlRow } from './helpers/sql-transport';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

/** Every notification of a recipient that targets a level review request. */
async function reviewNotifications(userId: string, requestId?: string): Promise<SqlRow[]> {
  const result = await queryTrustedSql(
    `select id, event_key, kind, category, target_type, target_id, community_id, read_at
       from public.notifications
      where recipient_user_id = $1 and target_type = 'level_review_request'
        and ($2::uuid is null or target_id = $2::uuid)
      order by created_at`,
    { values: [userId, requestId ?? null] }
  );
  return result.rows;
}

describe('level review resolution notifications', { timeout: 300_000 }, () => {
  let world: RatingWorld;
  let admin: LevelReviewActor;
  let roles: LevelReviewWorld;

  beforeAll(async () => {
    if (!environment.env) return;
    world = await ratingWorld(environment.env, 'lrn');
    admin = await platformAdminPlayer(world);
    roles = await levelReviewWorld(environment.env, 'lrnr');
  });

  afterAll(async () => {
    if (environment.env) await drainDueRegistrationCutoffs();
  });

  async function ratedOwner(label: string) {
    const players = await Promise.all(
      [4, 4.5, 5, 3.5].map((level, index) => world.player(`${label}${index}`, level))
    );
    await confirmedGroup({
      eventId: await world.newEvent(),
      players: toQuartet(players.map((player) => player.id)),
      playedAt: await nextTailPlayedAt(),
      submittedBy: world.admin.id,
      classification: 'team_a'
    });
    return players[0]!;
  }

  const reject = (adminActor: LevelReviewActor, requestId: string, note = 'Not enough evidence.') =>
    adminActor.client.rpc('resolve_level_review_request', {
      p_request_id: requestId,
      p_command_id: crypto.randomUUID(),
      p_decision: 'reject',
      p_note: note
    });

  it.skipIf(!environment.env)(
    'notifies the owner of an approval once, in the same transaction, with a safe target',
    async () => {
      const owner = await ratedOwner('apr');
      const requestId = await submitExact(owner, 5);
      expect(await reviewNotifications(owner.id)).toHaveLength(0);

      const commandId = crypto.randomUUID();
      const approved = await approveOk(admin, requestId, {
        commandId,
        target: 5,
        note: 'Evidence checked.'
      });
      const [notice] = await reviewNotifications(owner.id, requestId);
      expect(await reviewNotifications(owner.id, requestId)).toHaveLength(1);
      expect(notice).toMatchObject({
        event_key: `level-review:${requestId}:resolved`,
        kind: 'level_review_approved',
        category: 'rankings',
        target_type: 'level_review_request',
        target_id: requestId,
        community_id: null,
        read_at: null
      });

      // An exact retry replays the decision and does not duplicate the notification.
      const replay = await approveOk(admin, requestId, {
        commandId,
        target: 5,
        note: 'Evidence checked.'
      });
      expect(replay.replayed).toBe(true);
      expect(await reviewNotifications(owner.id, requestId)).toHaveLength(1);

      const target = await owner.client
        .rpc('get_my_notification_target_v3', { p_notification_id: String(notice!['id']) })
        .single();
      expect(target.error).toBeNull();
      const decoded = decodeNotificationTarget(target.data!);
      expect(decoded).toMatchObject({
        target_status: 'level_review_available',
        kind: 'level_review_approved',
        community_id: null,
        level_review_context: {
          request_id: requestId,
          outcome: 'approved',
          approved_level: 5,
          decision_note: 'Evidence checked.',
          adjustment_id: approved.adjustment!.id
        }
      });

      // The admin who decided is not a recipient.
      expect(await reviewNotifications(admin.id)).toHaveLength(0);
    }
  );

  it.skipIf(!environment.env)(
    'notifies a rejection with the visible note and no adjustment',
    async () => {
      const owner = await ratedOwner('rej');
      const requestId = await submitExact(owner, 5);
      const before = await ratingFingerprint(owner.id);
      const result = await reject(admin, requestId, 'Please play more rated games first.');
      expect(result.error).toBeNull();

      const [notice] = await reviewNotifications(owner.id, requestId);
      expect(notice).toMatchObject({ kind: 'level_review_rejected', category: 'rankings' });
      const target = await owner.client
        .rpc('get_my_notification_target_v3', { p_notification_id: String(notice!['id']) })
        .single();
      expect(decodeNotificationTarget(target.data!)).toMatchObject({
        target_status: 'level_review_available',
        level_review_context: {
          outcome: 'rejected',
          approved_level: null,
          adjustment_id: null,
          decision_note: 'Please play more rated games first.'
        }
      });
      expect(await adjustmentCount(owner.id)).toBe(0);
      expect(await ratingFingerprint(owner.id)).toBe(before);
    }
  );

  it.skipIf(!environment.env)(
    'does not notify for under review, owner cancellation or submission',
    async () => {
      const owner = roles.owner;
      const requestId = await submitRequest(owner);
      expect(await reviewNotifications(owner.id)).toHaveLength(0);
      const marked = await roles.platformAdmin.client.rpc('mark_level_review_under_review', {
        p_request_id: requestId
      });
      expect(marked.error).toBeNull();
      expect(await reviewNotifications(owner.id)).toHaveLength(0);
      const canceled = await owner.client.rpc('cancel_level_review_request', {
        p_request_id: requestId
      });
      expect(canceled.error).toBeNull();
      expect(await reviewNotifications(owner.id)).toHaveLength(0);
      expect(await reviewNotifications(roles.platformAdmin.id)).toHaveLength(0);
    }
  );

  it.skipIf(!environment.env)(
    'still delivers in-app when the owner opted out of push delivery',
    async () => {
      const owner = await world.player('optout', 4);
      const saved = await owner.client.rpc('set_my_notification_preferences', {
        p_push_enabled: false,
        p_push_community: false,
        p_push_matches: false,
        p_push_results: false,
        p_push_rankings: false,
        p_push_leagues: false
      });
      expect(saved.error).toBeNull();
      const requestId = await submitRequest(owner, {
        p_requested_min_level: 4.5,
        p_requested_max_level: 4.5
      });
      expect((await reject(admin, requestId)).error).toBeNull();

      const feed = await owner.client
        .from('notifications')
        .select('id,kind,category,target_type,target_id,read_at')
        .eq('target_id', requestId);
      expect(feed.error).toBeNull();
      expect(feed.data).toHaveLength(1);
      // The feed row carries no request content (reason, evidence, note).
      expect(Object.keys(feed.data![0]!).sort()).toEqual([
        'category',
        'id',
        'kind',
        'read_at',
        'target_id',
        'target_type'
      ]);
      expect(JSON.stringify(feed.data)).not.toContain(submitArgs().p_reason);
    }
  );

  it.skipIf(!environment.env)(
    'rolls the whole decision back when the notification cannot be recorded',
    async () => {
      const owner = await ratedOwner('rollback');
      const requestId = await submitExact(owner, 5);
      // A conflicting pre-existing notice under the stable event key makes persistence fail.
      await executeTrustedSql(
        `insert into public.notifications(recipient_user_id, event_key, kind, category, target_type, target_id)
         values (${sqlText(owner.id)}, ${sqlText(`level-review:${requestId}:resolved`)}, 'level_review_rejected',
           'rankings', 'level_review_request', ${sqlText(requestId)})`
      );
      const before = await ratingFingerprint(owner.id);
      const result = await admin.client.rpc(
        'resolve_level_review_request',
        await approveArgs(requestId)
      );
      expect(result.error).not.toBeNull();

      expect((await levelReviewRow(requestId))['status']).toBe('pending');
      expect(await adjustmentCount(owner.id)).toBe(0);
      expect(await ratingFingerprint(owner.id)).toBe(before);
      expect(await reviewNotifications(owner.id, requestId)).toHaveLength(1);
      await executeTrustedSql(
        `delete from public.notifications where recipient_user_id = ${sqlText(owner.id)}
           and target_id = ${sqlText(requestId)}`
      );
      // Once the blocker is gone the same decision succeeds.
      await approveOk(admin, requestId);
      expect(await reviewNotifications(owner.id, requestId)).toHaveLength(1);
    }
  );

  it.skipIf(!environment.env)(
    'resolves a foreign or mismatched target to the safe unavailable state',
    async () => {
      const owner = roles.owner;
      const requestId = await submitRequest(owner, {
        p_requested_min_level: 3.8,
        p_requested_max_level: 3.8
      });
      expect((await reject(roles.platformAdmin, requestId)).error).toBeNull();
      const [own] = await reviewNotifications(owner.id, requestId);

      // The other player cannot read the owner's notification at all.
      const foreign = await roles.other.client
        .rpc('get_my_notification_target_v3', { p_notification_id: String(own!['id']) })
        .single();
      expect(foreign.error).not.toBeNull();

      // Provisional actors stay locked out of the target reader.
      const provisional = await roles.provisional.client.rpc('get_my_notification_target_v3', {
        p_notification_id: String(own!['id'])
      });
      expect(provisional.error).not.toBeNull();

      // A notice pointing at someone else's request is unavailable, never a leak.
      await executeTrustedSql(
        `insert into public.notifications(recipient_user_id, event_key, kind, category, target_type, target_id)
         values (${sqlText(roles.other.id)}, 'level-review:forged', 'level_review_rejected', 'rankings',
           'level_review_request', ${sqlText(requestId)})`
      );
      const [forged] = await reviewNotifications(roles.other.id);
      const target = await roles.other.client
        .rpc('get_my_notification_target_v3', { p_notification_id: String(forged!['id']) })
        .single();
      expect(target.error).toBeNull();
      expect(target.data).toMatchObject({
        target_status: 'unavailable',
        level_review_context: null
      });
      expect(JSON.stringify(target.data)).not.toContain(submitArgs().p_reason);
    }
  );
});
