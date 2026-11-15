import { isVerifiedImage } from '../../lib/image-verification';
import { emitDiagnostic } from '../../lib/diagnostics.server';
import { getAdminClient } from '../../lib/supabase/admin.server';
import { AVATAR_MAX_BYTES } from './player.validators';
import { toClientError } from '../../lib/client-error.server';
import { getServerClient } from '../../lib/supabase/server';
import { AVATAR_FILENAME_PATTERN } from './avatar-key';
import { projectPlayingDays, projectPlayingTimes } from './player-availability';

export type PlayerClient = ReturnType<typeof getServerClient>;
export const AVATAR_BUCKET = 'player-avatars';
const SIGNED_URL_SECONDS = 60;
const PROFILE_FIELDS =
  'display_name, avatar_url, preferred_side, dominant_hand, bio, preferred_playing_days, preferred_playing_times, created_at';
const RATING_FIELDS =
  'initial_display_level, display_level, highest_display_level, reliability_percent, confirmed_competitive_game_groups';
export async function playerRows(client: PlayerClient, userId: string) {
  const [profileResult, ratingResult] = await Promise.all([
    client.from('player_profiles').select(PROFILE_FIELDS).eq('user_id', userId).maybeSingle(),
    client.from('global_player_ratings').select(RATING_FIELDS).eq('user_id', userId).maybeSingle()
  ]);
  if (profileResult.error) throw toClientError(profileResult.error);
  if (ratingResult.error) throw toClientError(ratingResult.error);
  const profile = profileResult.data;
  const rating = ratingResult.data;
  if (Boolean(profile) !== Boolean(rating)) throw new Error('INCOMPLETE_PLAYER_STATE');
  return { profile, rating };
}

async function signedAvatarUrl(
  client: PlayerClient,
  objectKey: string | null
): Promise<string | null> {
  if (!objectKey) return null;
  const { data, error } = await client.storage
    .from(AVATAR_BUCKET)
    .createSignedUrl(objectKey, SIGNED_URL_SECONDS);
  if (error) return null;
  return data.signedUrl;
}

export async function sportingProfile(client: PlayerClient, userId: string) {
  const { profile, rating } = await playerRows(client, userId);
  if (!profile || !rating) throw new Error('PLAYER_NOT_ONBOARDED');
  return {
    user_id: userId,
    display_name: profile.display_name,
    avatar_signed_url: await signedAvatarUrl(client, profile.avatar_url),
    preferred_side: profile.preferred_side,
    dominant_hand: profile.dominant_hand,
    bio: profile.bio,
    preferred_playing_days: projectPlayingDays(profile.preferred_playing_days),
    preferred_playing_times: projectPlayingTimes(profile.preferred_playing_times),
    initial_display_level: rating.initial_display_level,
    display_level: rating.display_level,
    highest_display_level: rating.highest_display_level,
    reliability_percent: rating.reliability_percent,
    confirmed_competitive_game_groups: rating.confirmed_competitive_game_groups,
    joined_at: profile.created_at
  };
}

export async function verifiedAvatarKey(
  client: PlayerClient,
  userId: string,
  objectKey: string,
  protectedKey: string | null = null
) {
  const prefix = `${userId}/`;
  if (
    !objectKey.startsWith(prefix) ||
    objectKey.length > 256 ||
    !AVATAR_FILENAME_PATTERN.test(objectKey.slice(prefix.length))
  )
    throw new Error('INVALID_AVATAR_KEY');
  const filename = objectKey.slice(prefix.length);
  const bucket = client.storage.from(AVATAR_BUCKET);
  const { data, error } = await bucket.list(userId, { search: filename });
  if (error) throw toClientError(error);
  const object = data?.find((entry) => entry.name === filename);
  if (!object) throw new Error('AVATAR_NOT_FOUND');
  let valid = false;
  if (object.metadata && object.metadata.size > 0 && object.metadata.size <= AVATAR_MAX_BYTES) {
    const { data: blob, error: downloadError } = await bucket.download(objectKey);
    if (downloadError) throw toClientError(downloadError);
    const extension = filename.split('.').at(-1)?.toLowerCase();
    const expectedMime =
      extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';
    valid = !!blob && blob.type === expectedMime && (await isVerifiedImage(blob, AVATAR_MAX_BYTES));
  }
  if (!valid) {
    // The key has already passed exact owner/filename validation. Never delete a stored avatar.
    if (objectKey !== protectedKey) {
      try {
        const { error: cleanupError } = await getAdminClient()
          .storage.from(AVATAR_BUCKET)
          .remove([objectKey]);
        if (cleanupError) throw new Error('AVATAR_CLEANUP_FAILED');
      } catch {
        emitDiagnostic('request.failure', 'failure', {
          code: 'AVATAR_CLEANUP_FAILED',
          stage: 'avatar_cleanup'
        });
        throw toClientError(new Error('AVATAR_CLEANUP_FAILED'));
      }
    }
    throw toClientError(new Error('INVALID_AVATAR'));
  }
}
