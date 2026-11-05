import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  decodeLevelReviewAdminDetail,
  decodeLevelReviewDetail
} from '../src/features/level-reviews/level-review-decoders';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import {
  drainDueRegistrationCutoffs,
  adjustmentRowFor,
  approveOk,
  levelReviewRow,
  platformAdminPlayer,
  submitExact,
  submitRequest,
  type LevelReviewActor
} from './helpers/level-review-fixtures';
import {
  confirmedGroup,
  nextTailPlayedAt,
  ratingWorld,
  toQuartet,
  type RatingWorld
} from './helpers/rating-fixtures';
import { sqlText } from './helpers/provisional-player-fixtures';
import { executeTrustedSql, queryTrustedSql } from './helpers/sql-transport';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

describe('level review audit chain', { timeout: 300_000 }, () => {
  let world: RatingWorld;
  let admin: LevelReviewActor;

  beforeAll(async () => {
    if (!environment.env) return;
    world = await ratingWorld(environment.env, 'lra');
    admin = await platformAdminPlayer(world);
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

  it.skipIf(!environment.env)(
    'links submission, review, decision, unique adjustment and notification target on approval',
    async () => {
      const owner = await ratedOwner('chain');
      const requestId = await submitExact(owner, 5);
      const marked = await admin.client.rpc('mark_level_review_under_review', {
        p_request_id: requestId
      });
      expect(marked.error).toBeNull();
      const resolution = await approveOk(admin, requestId, { target: 5, note: 'Verified.' });
      const adjustment = (await adjustmentRowFor(requestId))!;
      const row = await levelReviewRow(requestId);

      // Request row: immutable submission, review actor/time, terminal decision actor/time/note.
      expect(row).toMatchObject({
        owner_id: owner.id,
        status: 'approved',
        under_review_by: admin.id,
        decision_actor_id: admin.id,
        decision_note: 'Verified.',
        adjustment_id: adjustment['id']
      });
      expect(row['under_review_at']).toBeTruthy();
      expect(new Date(String(row['decided_at'])).getTime()).toBeGreaterThanOrEqual(
        new Date(String(row['under_review_at'])).getTime()
      );
      // Adjustment row points back at the request and carries the same actor and instant.
      expect(adjustment).toMatchObject({
        level_review_request_id: requestId,
        user_id: owner.id,
        actor_id: admin.id,
        event_type: 'ADMIN_REVIEW_ADJUSTMENT'
      });
      expect(new Date(String(adjustment['decided_at'])).getTime()).toBe(
        new Date(String(row['decided_at'])).getTime()
      );
      // Notification target resolves back to the request.
      const notices = await queryTrustedSql(
        `select target_id::text as target_id from public.notifications
          where recipient_user_id = $1 and event_key = $2`,
        { values: [owner.id, `level-review:${requestId}:resolved`] }
      );
      expect(notices.rows.map((notice) => notice['target_id'])).toEqual([requestId]);

      // Protected admin detail exposes the whole internal chain.
      const detail = await admin.client.rpc('get_level_review_admin_detail', {
        p_request_id: requestId
      });
      expect(detail.error).toBeNull();
      const adminView = decodeLevelReviewAdminDetail(detail.data);
      expect(adminView.request).toMatchObject({
        under_review_by: admin.id,
        decision_actor_id: admin.id
      });
      expect(adminView.adjustment).toMatchObject({
        id: resolution.adjustment!.id,
        level_review_request_id: requestId,
        actor_id: admin.id,
        before_display_level: expect.any(Number),
        after_display_level: 5
      });

      // The owner sees a safe trail only: no internal actors, no raw adjustment payload.
      const ownerView = await owner.client.rpc('get_my_level_review_request', {
        p_request_id: requestId
      });
      expect(ownerView.error).toBeNull();
      const safe = decodeLevelReviewDetail(ownerView.data).request;
      expect(safe).toMatchObject({
        status: 'approved',
        decision_note: 'Verified.',
        approved_level: 5,
        adjustment_id: resolution.adjustment!.id
      });
      expect(JSON.stringify(ownerView.data)).not.toContain(admin.id);
    }
  );

  it.skipIf(!environment.env)(
    'keeps decision evidence on rejection without an adjustment',
    async () => {
      const owner = await ratedOwner('reject');
      const requestId = await submitRequest(owner, {
        p_requested_min_level: 4.5,
        p_requested_max_level: 4.5
      });
      const rejected = await admin.client.rpc('resolve_level_review_request', {
        p_request_id: requestId,
        p_command_id: crypto.randomUUID(),
        p_decision: 'reject',
        p_note: 'Not enough rated games.'
      });
      expect(rejected.error).toBeNull();
      expect(await levelReviewRow(requestId)).toMatchObject({
        status: 'rejected',
        decision_actor_id: admin.id,
        decision_note: 'Not enough rated games.',
        approved_level: null,
        adjustment_id: null
      });
      expect(await adjustmentRowFor(requestId)).toBeUndefined();
    }
  );

  it.skipIf(!environment.env)(
    'records the owner cancellation time without an admin decision',
    async () => {
      const owner = await ratedOwner('cancel');
      const requestId = await submitExact(owner, 4.5);
      expect(
        (await owner.client.rpc('cancel_level_review_request', { p_request_id: requestId })).error
      ).toBeNull();
      const row = await levelReviewRow(requestId);
      expect(row).toMatchObject({
        status: 'canceled',
        decision_actor_id: null,
        adjustment_id: null
      });
      expect(row['canceled_at']).toBeTruthy();
    }
  );

  it.skipIf(!environment.env)(
    'rejects deletes, rewrites and truncation of resolved audit evidence',
    async () => {
      const owner = await ratedOwner('immutable');
      const requestId = await submitExact(owner, 5);
      await approveOk(admin, requestId, { target: 5 });

      await expect(
        executeTrustedSql(
          `delete from public.player_level_review_requests where id = ${sqlText(requestId)}`
        )
      ).rejects.toThrow(/LEVEL_REVIEW_EVIDENCE_IMMUTABLE/);
      await expect(
        executeTrustedSql(
          `update public.player_level_review_requests set decision_note = 'rewritten'
            where id = ${sqlText(requestId)}`
        )
      ).rejects.toThrow(/LEVEL_REVIEW_TERMINAL_IMMUTABLE/);
      await expect(
        executeTrustedSql('truncate public.player_level_review_requests cascade')
      ).rejects.toThrow(/LEVEL_REVIEW_EVIDENCE_IMMUTABLE/);
      await expect(
        executeTrustedSql(
          `delete from public.player_rating_admin_adjustments where level_review_request_id = ${sqlText(requestId)}`
        )
      ).rejects.toThrow(/RATING_EVIDENCE_IMMUTABLE/);
    }
  );
});
