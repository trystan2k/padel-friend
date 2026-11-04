import { expect } from '@playwright/test';
import {
  decodeLevelReviewAdminDetail,
  decodeLevelReviewCommand
} from '../src/features/level-reviews/level-review-decoders';
import { copies, sql, type Actor } from './matches-management-fixtures';

// Level review fixtures drive the PRODUCTION submit/review/resolve RPCs with real actors.
// The Platform Admin role is granted the way production does it (trusted SQL, no browser or
// metadata path); no rating value is ever written by the tests themselves.

export const lr = copies.en.levelReview;
export const ratingCopy = copies.en.rating;

export async function grantPlatformAdmin(userId: string): Promise<void> {
  await sql(
    `insert into public.platform_admins(user_id) values ('${userId}') on conflict do nothing`
  );
}

export type RequestRow = {
  id: string;
  status: string;
  requested_min_level: number;
  requested_max_level: number;
  reason: string;
  evidence: string | null;
  decision_note: string | null;
};

export async function requestRows(ownerId: string): Promise<RequestRow[]> {
  const rows =
    await sql(`select id::text, status::text, requested_min_level::float8 as requested_min_level,
      requested_max_level::float8 as requested_max_level, reason, evidence, decision_note
    from public.player_level_review_requests where owner_id='${ownerId}' order by created_at`);
  return rows.map((row) => ({
    id: String(row['id']),
    status: String(row['status']),
    requested_min_level: Number(row['requested_min_level']),
    requested_max_level: Number(row['requested_max_level']),
    reason: String(row['reason']),
    evidence: typeof row['evidence'] === 'string' ? row['evidence'] : null,
    decision_note: typeof row['decision_note'] === 'string' ? row['decision_note'] : null
  }));
}

/** A request submitted through the production RPC, as the owner's own session. */
export async function submitRequest(
  owner: Actor,
  options: { min?: number; max?: number; reason?: string; evidence?: string } = {}
): Promise<string> {
  const result = await owner.client.rpc('submit_level_review_request', {
    p_command_id: crypto.randomUUID(),
    p_requested_min_level: options.min ?? 4,
    p_requested_max_level: options.max ?? 4.2,
    p_reason: options.reason ?? 'I keep beating players rated well above me.',
    ...(options.evidence ? { p_evidence: options.evidence } : {})
  });
  expect(result.error, 'submit_level_review_request').toBeNull();
  return decodeLevelReviewCommand(result.data).request.id;
}

export async function markUnderReview(admin: Actor, requestId: string): Promise<void> {
  const result = await admin.client.rpc('mark_level_review_under_review', {
    p_request_id: requestId
  });
  expect(result.error, 'mark_level_review_under_review').toBeNull();
}

export async function rejectRequest(admin: Actor, requestId: string, note: string): Promise<void> {
  const result = await admin.client.rpc('resolve_level_review_request', {
    p_request_id: requestId,
    p_command_id: crypto.randomUUID(),
    p_decision: 'reject',
    p_note: note
  });
  expect(result.error, 'resolve reject').toBeNull();
}

export async function approveRequest(
  admin: Actor,
  requestId: string,
  target: number,
  note: string
): Promise<void> {
  const detail = await admin.client.rpc('get_level_review_admin_detail', {
    p_request_id: requestId
  });
  expect(detail.error, 'get_level_review_admin_detail').toBeNull();
  const revision = decodeLevelReviewAdminDetail(detail.data).current?.revision;
  expect(typeof revision).toBe('number');
  const result = await admin.client.rpc('resolve_level_review_request', {
    p_request_id: requestId,
    p_command_id: crypto.randomUUID(),
    p_decision: 'approve',
    p_note: note,
    p_target_level: target,
    p_expected_revision: revision
  });
  expect(result.error, 'resolve approve').toBeNull();
}

/**
 * Teardown for fixture owners. Review evidence is immutable and restricts user deletion, so the
 * guards are lifted for one transaction that removes only these actors' rows and restores them.
 * Never used by product code.
 */
export async function cleanupLevelReviews(actorIds: readonly string[]): Promise<void> {
  if (actorIds.length === 0) return;
  const ids = actorIds.map((id) => `'${id}'`).join(',');
  await sql(`do $$ begin
    alter table public.player_rating_adjustment_states disable trigger player_rating_adjustment_states_immutable;
    alter table public.player_rating_admin_adjustments disable trigger player_rating_adjustments_immutable;
    alter table public.player_level_review_requests disable trigger level_review_requests_no_delete;
    set constraints all deferred;
    delete from public.player_rating_adjustment_states where adjustment_id in (
      select id from public.player_rating_admin_adjustments where user_id in (${ids}));
    delete from public.player_rating_admin_adjustments where user_id in (${ids});
    delete from public.player_level_review_requests where owner_id in (${ids});
    delete from public.platform_admins where user_id in (${ids});
    set constraints all immediate;
    alter table public.player_level_review_requests enable trigger level_review_requests_no_delete;
    alter table public.player_rating_admin_adjustments enable trigger player_rating_adjustments_immutable;
    alter table public.player_rating_adjustment_states enable trigger player_rating_adjustment_states_immutable;
  end $$;`);
}
