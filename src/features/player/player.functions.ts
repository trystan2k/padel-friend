import { createServerFn } from '@tanstack/react-start';
import { setResponseHeader } from '@tanstack/react-start/server';
import { getServerClient } from '../../lib/supabase/server';
import { requireAuthenticatedClient } from '../auth/auth.server';
import { playerRows, sportingProfile, verifiedAvatarKey } from './player.server';
import { claimErrorCode, parseProvisionalClaim } from './provisional-claim';
import {
  validateAvatarUpload,
  validateOnboardPlayer,
  validateUpdatePlayerProfile
} from './player.validators';

export const getOnboardingStatus = createServerFn().handler(async () => {
  setResponseHeader('Cache-Control', 'private, no-store');
  const client = getServerClient();
  const { data, error } = await client.auth.getClaims();
  if (error || !data?.claims?.sub) return { authenticated: false, complete: false, claim: null };
  const { profile } = await playerRows(client, data.claims.sub);
  if (profile) return { authenticated: true, complete: true, claim: null };
  // A provisional session cannot read its own profile (RLS), so a missing profile is
  // either a brand-new account or a provisional player; the restricted claim RPC
  // tells them apart and only discloses prefill after verified mailbox ownership.
  const claim = await client.rpc('get_provisional_claim_context');
  if (claim.error) throw claim.error;
  return { authenticated: true, complete: false, claim: parseProvisionalClaim(claim.data) };
});

export const onboardPlayer = createServerFn({ method: 'POST' })
  .validator(validateOnboardPlayer)
  .handler(async ({ data }) => {
    const { client, userId } = await requireAuthenticatedClient();
    try {
      const { error } = await client.rpc('onboard_player', {
        p_display_name: data.display_name,
        p_preferred_side: data.preferred_side,
        p_initial_level: data.initial_level,
        ...(data.dominant_hand ? { p_dominant_hand: data.dominant_hand } : {}),
        ...(data.bio != null ? { p_bio: data.bio } : {})
      });
      if (error) throw error;
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23514')
        throw new Error('INCOMPLETE_PLAYER_STATE', { cause: error });
      throw error;
    }
    return sportingProfile(client, userId);
  });

export const claimProvisionalPlayer = createServerFn({ method: 'POST' })
  .validator(validateOnboardPlayer)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    const { error } = await client.rpc('claim_provisional_player', {
      p_display_name: data.display_name,
      p_preferred_side: data.preferred_side,
      p_initial_level: data.initial_level,
      ...(data.dominant_hand ? { p_dominant_hand: data.dominant_hand } : {}),
      ...(data.bio != null ? { p_bio: data.bio } : {})
    });
    if (error) throw new Error(claimErrorCode(error) ?? 'PLAYER_CLAIM_FAILED', { cause: error });
  });

export const getMyPlayerProfile = createServerFn().handler(async () => {
  const { client, userId } = await requireAuthenticatedClient();
  return sportingProfile(client, userId);
});

export const updateMyPlayerProfile = createServerFn({ method: 'POST' })
  .validator(validateUpdatePlayerProfile)
  .handler(async ({ data }) => {
    const { client, userId } = await requireAuthenticatedClient();
    const { profile } = await playerRows(client, userId);
    if (!profile) throw new Error('PLAYER_NOT_ONBOARDED');
    if (data.avatar_url != null) await verifiedAvatarKey(client, userId, data.avatar_url);
    const { error } = await client.from('player_profiles').update(data).eq('user_id', userId);
    if (error) throw error;
    return sportingProfile(client, userId);
  });

export const completeAvatarUpload = createServerFn({ method: 'POST' })
  .validator(validateAvatarUpload)
  .handler(async ({ data }) => {
    const { client, userId } = await requireAuthenticatedClient();
    const { profile } = await playerRows(client, userId);
    if (!profile) throw new Error('PLAYER_NOT_ONBOARDED');
    await verifiedAvatarKey(client, userId, data.objectKey);
    const previousKey = profile.avatar_url;
    const update = client
      .from('player_profiles')
      .update({ avatar_url: data.objectKey })
      .eq('user_id', userId);
    const { data: updated, error } = await (
      previousKey === null ? update.is('avatar_url', null) : update.eq('avatar_url', previousKey)
    )
      .select('avatar_url')
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!updated) throw new Error('AVATAR_CONFLICT');
    // Do not delete avatar objects here: deletion cannot be atomic with avatar_url writes.
    // Leave orphaned keys for a future garbage-collection task.
    return sportingProfile(client, userId);
  });
