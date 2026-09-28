import { getServerClient } from '../../lib/supabase/server';

export type PlayerClient = ReturnType<typeof getServerClient>;
export const AVATAR_BUCKET = 'player-avatars';
const SIGNED_URL_SECONDS = 60;
const PROFILE_FIELDS = 'display_name, avatar_url, preferred_side, dominant_hand, bio, created_at';
const RATING_FIELDS =
  'initial_display_level, display_level, highest_display_level, reliability_percent, confirmed_competitive_game_groups';

export async function playerRows(client: PlayerClient, userId: string) {
  const [profile, rating] = await Promise.all([
    client.from('player_profiles').select(PROFILE_FIELDS).eq('user_id', userId).maybeSingle(),
    client.from('global_player_ratings').select(RATING_FIELDS).eq('user_id', userId).maybeSingle()
  ]);
  if (profile.error) throw profile.error;
  if (rating.error) throw rating.error;
  if (Boolean(profile.data) !== Boolean(rating.data)) throw new Error('INCOMPLETE_PLAYER_STATE');
  return { profile: profile.data, rating: rating.data };
}

async function signedAvatarUrl(
  client: PlayerClient,
  objectKey: string | null
): Promise<string | null> {
  if (!objectKey) return null;
  const { data, error } = await client.storage
    .from(AVATAR_BUCKET)
    .createSignedUrl(objectKey, SIGNED_URL_SECONDS);
  if (error) throw error;
  return data.signedUrl;
}

export async function sportingProfile(client: PlayerClient, userId: string) {
  const { profile, rating } = await playerRows(client, userId);
  if (!profile || !rating) throw new Error('PLAYER_NOT_ONBOARDED');
  return {
    display_name: profile.display_name,
    avatar_signed_url: await signedAvatarUrl(client, profile.avatar_url),
    preferred_side: profile.preferred_side,
    dominant_hand: profile.dominant_hand,
    bio: profile.bio,
    initial_display_level: rating.initial_display_level,
    display_level: rating.display_level,
    highest_display_level: rating.highest_display_level,
    reliability_percent: rating.reliability_percent,
    confirmed_competitive_game_groups: rating.confirmed_competitive_game_groups,
    joined_at: profile.created_at
  };
}

export async function verifiedAvatarKey(client: PlayerClient, userId: string, objectKey: string) {
  const prefix = `${userId}/`;
  if (
    !objectKey.startsWith(prefix) ||
    objectKey.length > 256 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|jpeg|png|webp)$/i.test(
      objectKey.slice(prefix.length)
    )
  )
    throw new Error('INVALID_AVATAR_KEY');
  const filename = objectKey.slice(prefix.length);
  const { data, error } = await client.storage
    .from(AVATAR_BUCKET)
    .list(userId, { search: filename });
  if (error) throw error;
  if (!data?.some((object) => object.name === filename)) throw new Error('AVATAR_NOT_FOUND');
}
