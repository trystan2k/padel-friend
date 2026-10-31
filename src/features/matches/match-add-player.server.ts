import type { AdminClient } from '../../lib/supabase/admin.server';
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
  | { action: 'create'; email: string; capability: string; locale: string; match_event_id: string }
  | { action: 'resend'; email: string; locale: string; match_event_id: string }
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
  if (!text(row.email) || !text(row.locale) || !text(row.match_event_id)) return null;
  const base = { email: row.email, locale: row.locale, match_event_id: row.match_event_id };
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

/**
 * Runs after add_match_player accepted the request for this actor. The actor
 * comes from verified claims; SQL re-checks authorization when it completes.
 */
export async function deliverMatchPlayerAdd(
  admin: AdminClient,
  input: { actor_id: string; event_id: string; request_id: string; origin: string }
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
  const settled = await admin.rpc('settle_match_player_add', { ...key, p_delivered: delivered });
  if (settled.error) return addMatchPlayerError(settled.error);
  // A failed create leaves no identity; the same request id retries safely.
  const completed =
    typeof settled.data === 'object' &&
    settled.data !== null &&
    Reflect.get(settled.data, 'completed') === true;
  return completed ? ADD_MATCH_PLAYER_OK : { status: 'error', code: 'unavailable' };
}
