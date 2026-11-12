import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { readHome } from '../src/features/home/home.server';
import type { Database } from '../src/lib/supabase/database.types';
import { executeTrustedSql } from './helpers/sql-transport';
import { assertLocalSupabaseEnvInCi, localSupabaseEnv } from './helpers/local-supabase-env';

const environment = localSupabaseEnv();
type Actor = { id: string; client: SupabaseClient<Database> };

async function actor(label: string): Promise<Actor> {
  const { url, key } = environment.env!;
  const signup = await createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  }).auth.signUp({ email: `${label}-${crypto.randomUUID()}@test.local`, password: 'Password123!' });
  expect(signup.error).toBeNull();
  expect(signup.data.session, 'local email confirmations must be disabled').not.toBeNull();
  const client = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${signup.data.session!.access_token}` } }
  });
  expect(
    (
      await client.rpc('onboard_player', {
        p_display_name: label,
        p_preferred_side: 'EITHER',
        p_initial_level: 3.2
      })
    ).error
  ).toBeNull();
  return { id: signup.data.user!.id, client };
}

const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
const home = (who: Actor, communityId: string | null) =>
  readHome(who.client, who.id, { community_id: communityId });
const visibleCommunityNames = async (who: Actor, id: string) =>
  (await who.client.from('communities').select('name').eq('id', id)).data?.map((row) => row.name);

describe('private cache and subscription isolation', () => {
  it('requires local Supabase in CI', () => {
    expect(() => assertLocalSupabaseEnvInCi(environment.env, process.env.CI)).not.toThrow();
  });

  it.skipIf(!environment.env)(
    'every authorized re-read is scoped to the caller: A then B, outsider and revoked member see no private community data',
    async () => {
      const token = crypto.randomUUID().replaceAll('-', '').slice(0, 8);
      const [owner, userA, userB, outsider] = await Promise.all([
        actor('cache-owner'),
        actor('cache-a'),
        actor('cache-b'),
        actor('cache-outsider')
      ]);
      const alpha = crypto.randomUUID();
      const beta = crypto.randomUUID();
      const names = { alpha: `Cache Alpha ${token}`, beta: `Cache Beta ${token}` };
      const member = (community: string, user: Actor, role: string) =>
        `(${q(community)},${q(user.id)},${q(role)},'active',now()-interval '1 minute',now()-interval '1 minute')`;
      await executeTrustedSql(`do $$ begin
        insert into public.communities(id,name,visibility,created_by,settings) values
          (${q(alpha)},${q(names.alpha)},'private',${q(owner.id)},'{}'::jsonb),
          (${q(beta)},${q(names.beta)},'private',${q(owner.id)},'{}'::jsonb);
        insert into public.community_members(community_id,user_id,role,status,valid_from,activated_at) values
          ${member(alpha, owner, 'admin')},
          ${member(beta, owner, 'admin')},
          ${member(alpha, userA, 'member')},
          ${member(beta, userB, 'member')};
      end $$;`);

      // Same process, same code path, two identities back to back and concurrently: nothing carries over.
      const asA = await home(userA, null);
      const [asB, asBForA] = await Promise.all([home(userB, null), home(userB, alpha)]);
      expect(asA.selection.selectedId).toBe(alpha);
      expect(JSON.stringify(asA)).not.toContain(names.beta);
      expect(asB.selection.selectedId).toBe(beta);
      expect(JSON.stringify(asB)).not.toContain(names.alpha);
      expect(asBForA.selection).toEqual({ selectedId: beta, requestedUnavailable: true });
      expect(JSON.stringify(asBForA)).not.toContain(names.alpha);

      // Outsider: RLS hides the private community at the table and Home exposes nothing.
      expect(await visibleCommunityNames(outsider, alpha)).toEqual([]);
      expect(await visibleCommunityNames(userB, alpha)).toEqual([]);
      expect(await visibleCommunityNames(userA, alpha)).toEqual([names.alpha]);
      const none = await home(outsider, alpha);
      expect(none.communities).toEqual({ status: 'empty' });
      expect(JSON.stringify(none)).not.toContain(names.alpha);

      // Revoked member: the very next polling read loses access; no stale DTO is served.
      await executeTrustedSql(`update public.community_members
        set status='inactive', valid_until=now()
        where community_id=${q(alpha)} and user_id=${q(userA.id)};`);
      expect(await visibleCommunityNames(userA, alpha)).toEqual([]);
      const revoked = await home(userA, alpha);
      expect(revoked.communities).toEqual({ status: 'empty' });
      expect(revoked.selection).toEqual({ selectedId: null, requestedUnavailable: true });
      expect(JSON.stringify(revoked)).not.toContain(names.alpha);
    },
    120_000
  );
});
