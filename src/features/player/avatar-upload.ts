import { getBrowserClient } from '../../lib/supabase/client';

/**
 * Uploads an already validated avatar to the caller's own folder of the private bucket and
 * returns the immutable object key. The key is only a candidate until `completeAvatarUpload`
 * verifies and persists it. Uploaded objects are never deleted here: deletion cannot be atomic
 * with the profile write, so unused keys are left for a future garbage-collection task.
 */
export async function uploadOwnerAvatar(file: File): Promise<string> {
  const client = getBrowserClient();
  const { data: claims, error: authError } = await client.auth.getClaims();
  if (authError || !claims?.claims?.sub) throw new Error('UNAUTHENTICATED');
  const ext = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp';
  const key = `${claims.claims.sub}/${crypto.randomUUID()}.${ext}`;
  const { data, error } = await client.storage
    .from('player-avatars')
    .upload(key, file, { upsert: false, contentType: file.type });
  if (error) throw error;
  return data.path;
}
