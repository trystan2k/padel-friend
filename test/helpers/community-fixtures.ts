import { expect } from 'vitest';
import type { Database } from '../../src/lib/supabase/database.types';
import { trustedClient } from './trusted-client';

type CommunityArgs = Database['public']['Functions']['create_community']['Args'];

/** Historical discovery/join setup, not a creation journey. Never raises production quotas. */
export async function seedHistoricalCommunity(actorId: string, input: CommunityArgs) {
  const inserted = await trustedClient()
    .from('communities')
    .insert({
      name: input.p_name,
      visibility: input.p_visibility,
      join_policy: input.p_join_policy,
      description: input.p_description,
      city_label: input.p_city_label,
      created_by: actorId,
      created_at: new Date(Date.now() - 2 * 86_400_000).toISOString()
    })
    .select('id')
    .single();
  expect(inserted.error).toBeNull();
  if (!inserted.data) throw new Error('Historical community fixture missing');
  expect(
    (
      await trustedClient().from('community_members').insert({
        community_id: inserted.data.id,
        user_id: actorId,
        role: 'admin',
        status: 'active'
      })
    ).error
  ).toBeNull();
  return { data: inserted.data.id, error: null };
}
