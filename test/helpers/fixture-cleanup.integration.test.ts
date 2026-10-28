import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { createFixtureCleanupRegistry } from './fixture-cleanup';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './local-supabase-env';
import { executeTrustedSql, queryTrustedSql } from './sql-transport';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

async function createCommunityFixture(scope: string) {
  const env = environment.env;
  if (!env) throw new Error(environment.reason);

  const registry = createFixtureCleanupRegistry(scope);
  registry.setCleanupExecutor(async (current) => {
    await current.deleteRegisteredRowsInOrder({
      beforeStatements: [
        'alter table public.community_members disable trigger community_member_guard'
      ],
      afterStatements: [
        'alter table public.community_members enable trigger community_member_guard'
      ],
      restoreOnFailure: [
        'alter table public.community_members enable trigger community_member_guard'
      ]
    });
  });
  const email = `cleanup-${registry.namespace}@test.local`;
  registry.register('auth.users', { email });
  const signup = await createClient(env.url, env.key, {
    auth: { persistSession: false, autoRefreshToken: false }
  }).auth.signUp({ email, password: 'Password123!' });
  if (signup.error || !signup.data.user)
    throw new Error(`Fixture signup failed: ${signup.error?.message ?? 'no user returned'}`);

  const userId = signup.data.user.id;
  const communityId = crypto.randomUUID();
  registry.register('auth.users', { id: userId });
  registry.register('public.communities', { id: communityId });
  registry.register('public.community_members', { community_id: communityId });
  registry.register('public.community_audit_log', { community_id: communityId });
  await executeTrustedSql(
    `insert into public.communities(id,name,visibility,created_by)
     values ('${communityId}','cleanup-${registry.namespace.slice(-21)}','private','${userId}')`
  );
  await executeTrustedSql(
    `insert into public.community_members(community_id,user_id,role,status,valid_from,activated_at)
     values ('${communityId}','${userId}','admin','active',now(),now())`
  );

  return { registry, communityId };
}

describe.skipIf(environment.env === null)('fixture cleanup integration', () => {
  it('deletes child rows before parents and proves no fixture residue remains', async () => {
    const { registry, communityId } = await createCommunityFixture('fixture-cleanup-order');
    await registry.cleanup();

    await expect(registry.assertNoResidue()).resolves.toBeUndefined();
    const remaining = await queryTrustedSql(
      'select count(*)::int as count from public.communities where id = $1',
      { values: [communityId] }
    );
    expect(Number(remaining.rows[0]?.['count'])).toBe(0);
  });

  it('runs cleanup from a failure-path finally block', async () => {
    const { registry, communityId } = await createCommunityFixture('fixture-cleanup-failure');

    await expect(
      (async () => {
        try {
          throw new Error('simulated mid-test failure');
        } finally {
          await registry.cleanup();
        }
      })()
    ).rejects.toThrow('simulated mid-test failure');

    await expect(registry.assertNoResidue()).resolves.toBeUndefined();
    const remaining = await queryTrustedSql(
      'select count(*)::int as count from public.communities where id = $1',
      { values: [communityId] }
    );
    expect(Number(remaining.rows[0]?.['count'])).toBe(0);
  });

  it('leaves fixtures from another run namespace untouched', async () => {
    const first = await createCommunityFixture('fixture-cleanup-isolation');
    const second = await createCommunityFixture('fixture-cleanup-isolation');

    expect(first.registry.namespace).not.toBe(second.registry.namespace);
    await first.registry.cleanup();

    const untouched = await queryTrustedSql(
      'select count(*)::int as count from public.communities where id = $1',
      { values: [second.communityId] }
    );
    expect(Number(untouched.rows[0]?.['count'])).toBe(1);
    await expect(second.registry.assertNoResidue()).rejects.toThrow(/Fixture residue remains/);

    await second.registry.cleanup();
    await expect(second.registry.assertNoResidue()).resolves.toBeUndefined();
  });
});
