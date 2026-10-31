import { afterResponse } from '../../lib/post-response.server';
import { getAdminClient, type AdminClient } from '../../lib/supabase/admin.server';
import {
  buildInvitationEmailMetadata,
  invitationRedirectTo,
  type InvitationEmailContext
} from './invitation-email';
import {
  ADD_MATCH_PLAYER_OK,
  addMatchPlayerError,
  type AddMatchPlayerResult
} from './match-add-player-model';

export type PlayerAddDispatch =
  | {
      action: 'create';
      email: string;
      capability: string;
      locale: string;
      match_event_id: string;
      attempt: string;
    }
  | { action: 'resend'; email: string; locale: string; match_event_id: string; attempt: string }
  | { action: 'none' };

/** Metadata key the auth.users bridge trigger consumes (and scrubs) on insert. */
const PLAYER_ADD_CAPABILITY_KEY = 'padel_add_capability';

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function parsePlayerAddDispatch(value: unknown): PlayerAddDispatch | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const row = Object.fromEntries(Object.entries(value));
  if (row.action === 'none') return { action: 'none' };
  if (!text(row.email) || !text(row.locale) || !text(row.match_event_id) || !text(row.attempt))
    return null;
  const base = {
    email: row.email,
    locale: row.locale,
    match_event_id: row.match_event_id,
    attempt: row.attempt
  };
  if (row.action === 'resend') return { action: 'resend', ...base };
  if (row.action === 'create' && text(row.capability))
    return { action: 'create', capability: row.capability, ...base };
  return null;
}

type InviteContext = InvitationEmailContext & { targetUserId: string | null };

function parseInviteContext(value: unknown, locale: string): InviteContext | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = Object.fromEntries(Object.entries(value));
  const { inviter_name, venue_name, starts_at, timezone, target_user_id } = row;
  if (!text(inviter_name) || !text(venue_name) || !text(starts_at) || !text(timezone)) return null;
  return {
    locale,
    inviterName: inviter_name,
    venueName: venue_name,
    startsAt: starts_at,
    timezone,
    targetUserId: text(target_user_id) ? target_user_id : null
  };
}

/**
 * Invite-email seam. 'create' makes GoTrue insert the auth.users row (the SQL
 * bridge provisions everything in that same transaction and the invite mail is
 * sent only if it commits); 'resend' re-sends the invite to the existing
 * unclaimed identity without a second UUID. The email is localized by GoTrue's
 * single invite template from per-send metadata (dispatch.locale, inviter,
 * event); GoTrue renders a resend from the stored metadata, so it is refreshed
 * just before the send (the recipient throttle admits one in-flight send per
 * email). The link goes to /auth/callback on `origin`, then the event. Returns
 * whether Auth accepted the send; never logs the email or raw Auth errors.
 */
export async function deliverPlayerAddInvite(
  admin: AdminClient,
  dispatch: Exclude<PlayerAddDispatch, { action: 'none' }>,
  input: { actor_id: string; request_id: string; origin: string }
): Promise<boolean> {
  const loaded = await admin.rpc('get_match_player_add_invite_context', {
    p_actor_id: input.actor_id,
    p_match_event_id: dispatch.match_event_id,
    p_request_id: input.request_id
  });
  const context = loaded.error ? null : parseInviteContext(loaded.data, dispatch.locale);
  if (!context) return false;
  const metadata = buildInvitationEmailMetadata(context);
  if (dispatch.action === 'resend') {
    if (!context.targetUserId) return false;
    const refreshed = await admin.auth.admin.updateUserById(context.targetUserId, {
      user_metadata: metadata
    });
    if (refreshed.error) return false;
  }
  const { error } = await admin.auth.admin.inviteUserByEmail(dispatch.email, {
    redirectTo: invitationRedirectTo(input.origin, dispatch.match_event_id),
    data:
      dispatch.action === 'create'
        ? { ...metadata, [PLAYER_ADD_CAPABILITY_KEY]: dispatch.capability }
        : metadata
  });
  return !error;
}

type PlayerAddKey = { actor_id: string; event_id: string; request_id: string };

function parseAddKeys(list: unknown): PlayerAddKey[] {
  if (!Array.isArray(list)) return [];
  const keys: PlayerAddKey[] = [];
  for (const entry of list) {
    const row = typeof entry === 'object' && entry !== null ? entry : {};
    const actorId = Reflect.get(row, 'actor_id');
    const eventId = Reflect.get(row, 'match_event_id');
    const requestId = Reflect.get(row, 'request_id');
    if (text(actorId) && text(eventId) && text(requestId))
      keys.push({ actor_id: actorId, event_id: eventId, request_id: requestId });
  }
  return keys;
}

/** Other adds of the same email that were left waiting on this one (see settle_match_player_add). */
function parseWaitingAdds(value: unknown): PlayerAddKey[] {
  return parseAddKeys(
    typeof value === 'object' && value !== null ? Reflect.get(value, 'waiting') : undefined
  );
}

/**
 * Delivers one add after add_match_player accepted it for this actor. The actor
 * comes from verified claims; SQL re-checks authorization when it completes.
 *
 * The answer never depends on what the email resolved to, including when the
 * invitation could not be delivered: registered, provisional and unknown
 * addresses all answer ok. An undelivered invitation stays in the ledger
 * (dispatch_state 'failed', recipient slot released, retry scheduled) and
 * reconcileMatchPlayerAdds re-delivers it. Only infrastructure failures of the
 * dispatch/settle calls themselves surface as errors, to the caller of this
 * function, which never is the user's response (see scheduleMatchPlayerAdd).
 */
export async function deliverMatchPlayerAdd(
  admin: AdminClient,
  input: PlayerAddKey & { origin: string },
  options: { redriveWaiting?: boolean } = {}
): Promise<AddMatchPlayerResult> {
  const key = {
    p_actor_id: input.actor_id,
    p_match_event_id: input.event_id,
    p_request_id: input.request_id
  };
  const dispatched = await admin.rpc('dispatch_match_player_add', key);
  if (dispatched.error) return addMatchPlayerError(dispatched.error);
  const dispatch = parsePlayerAddDispatch(dispatched.data);
  if (!dispatch) return { status: 'error', code: 'unavailable' };
  if (dispatch.action === 'none') return ADD_MATCH_PLAYER_OK;
  const delivered = await deliverPlayerAddInvite(admin, dispatch, {
    actor_id: input.actor_id,
    request_id: input.request_id,
    origin: input.origin
  });
  // Fenced on the attempt token: if the sweep abandoned this attempt while the call was
  // slow, settle is a no-op for it and the newer attempt keeps its own state.
  const settled = await admin.rpc('settle_match_player_add', {
    ...key,
    p_delivered: delivered,
    p_attempt: dispatch.attempt
  });
  if (settled.error) return addMatchPlayerError(settled.error);
  // Adds that waited on this one: a failed create releases the capability and a bridge that
  // skipped a locked event completes nobody. Re-drive each once right away (fast path; the
  // durable guarantee is reconcileMatchPlayerAdds, which also covers a waiter that arrives
  // while this re-drive runs, a failed re-drive and a holder that crashed).
  if (options.redriveWaiting !== false) {
    for (const waiting of parseWaitingAdds(settled.data))
      await deliverMatchPlayerAdd(
        admin,
        { ...waiting, origin: input.origin },
        { redriveWaiting: false }
      );
  }
  return ADD_MATCH_PLAYER_OK;
}

/** Operations handed out per claim and claims per sweep: a sweep does bounded work. */
const RECONCILE_BATCH = 5;
const RECONCILE_MAX_ROUNDS = 3;

/**
 * Durable reconciliation. The ledger remembers every add whose invitation is not
 * settled (never dispatched, failed, abandoned by a crashed holder, waiting for an
 * identity); claim_match_player_add_redrives hands out the due ones with exponential
 * backoff and a bounded attempt count (a spent budget retires the operation as exhausted: slot released,
 * audited), and each is driven through the normal
 * dispatch -> Auth -> settle path. Runs after any add and on event reads (detail and management), so no scheduler is needed. Rounds repeat until nothing is due, which
 * also picks up operations that became due while an earlier one was being driven.
 */
export async function reconcileMatchPlayerAdds(admin: AdminClient, origin: string): Promise<void> {
  for (let round = 0; round < RECONCILE_MAX_ROUNDS; round++) {
    const claimed = await admin.rpc('claim_match_player_add_redrives', {
      p_limit: RECONCILE_BATCH
    });
    const due = claimed.error ? [] : parseAddKeys(claimed.data);
    if (due.length === 0) return;
    for (const key of due) {
      try {
        await deliverMatchPlayerAdd(admin, { ...key, origin });
      } catch {
        // One operation's failure must not starve the rest; it was rescheduled on claim.
      }
    }
  }
}

/**
 * Everything an accepted add does after its response: deliver it, then reconcile
 * stragglers. Identical for every branch (a registered address simply dispatches
 * 'none'), run after the response so its cost never reaches the caller.
 */
export function scheduleMatchPlayerAdd(
  admin: AdminClient,
  input: PlayerAddKey & { origin: string }
): Promise<void> {
  return afterResponse(async () => {
    try {
      await deliverMatchPlayerAdd(admin, input);
    } finally {
      await reconcileMatchPlayerAdds(admin, input.origin);
    }
  });
}

/** Any reader opens an event: reconcile stragglers after the page data was returned. */
export function scheduleMatchPlayerAddReconcile(origin: string): Promise<void> {
  return afterResponse(async () => {
    await reconcileMatchPlayerAdds(getAdminClient(), origin);
  });
}
