import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

const serverClient = vi.hoisted(() => ({ current: null as SupabaseClient | null }));
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validate: (value: unknown) => unknown = (value) => value;
    const builder = {
      validator: (fn: (value: unknown) => unknown) => {
        validate = fn;
        return builder;
      },
      handler:
        (fn: (context: { data: unknown }) => unknown) => async (options: { data: unknown }) =>
          fn({ data: validate(options.data) })
    };
    return builder;
  }
}));
vi.mock('@tanstack/react-start/server', () => ({ setResponseHeader: vi.fn<() => void>() }));
vi.mock('../src/lib/supabase/server', () => ({ getServerClient: () => serverClient.current }));
import {
  getCommunitySettings,
  updateCommunitySettings
} from '../src/features/community/community.functions';

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });

type LocalEnv = { url: string; key: string; source: 'environment' | '.env file' };
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);
function usableLocalEnv(
  rawUrl: string | undefined,
  key: string | undefined,
  source: LocalEnv['source']
): LocalEnv | null {
  if (!rawUrl || !key || key.startsWith('replace-with')) return null;
  const url = rawUrl.replace(/^["']+|["']+$/g, '');
  try {
    if (!LOOPBACK_HOSTS.has(new URL(url).hostname)) return null;
  } catch {
    return null;
  }
  return { url, key, source };
}
function localSupabaseEnv(): { env: LocalEnv | null; reason: string } {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (url && key && !key.startsWith('replace-with')) {
    return {
      env: usableLocalEnv(url, key, 'environment'),
      reason: `Non-loopback environment URL: ${url}`
    };
  }
  try {
    const vars = new Map(
      readFileSync(new URL('../.env', import.meta.url), 'utf8')
        .split('\n')
        .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
        .map((line) => {
          const index = line.indexOf('=');
          return [line.slice(0, index).trim(), line.slice(index + 1).trim()] as const;
        })
    );
    const fileUrl = vars.get('VITE_SUPABASE_URL');
    const fileKey = vars.get('VITE_SUPABASE_PUBLISHABLE_KEY');
    return {
      env: usableLocalEnv(fileUrl, fileKey, '.env file'),
      reason: `Missing or non-loopback .env URL: ${fileUrl ?? 'unset'}`
    };
  } catch {
    return { env: null, reason: 'Missing loopback Supabase environment and .env' };
  }
}
const environment = localSupabaseEnv();
if (!environment.env)
  process.stderr.write(`[community.column-isolation] suite NOT RUN: ${environment.reason}\n`);
describe('community column isolation — CI backend guard', () => {
  it('fails closed without local backend in CI', () => {
    expect(process.env.CI === undefined || environment.env !== null).toBe(true);
  });
});

describe.skipIf(environment.env === null)('community column isolation (local Supabase)', () => {
  function env(): LocalEnv {
    if (!environment.env) throw new Error(environment.reason);
    return environment.env;
  }
  // Single test exercises dozens of column-ACL and settings-RPC round trips;
  // measured >3s under full-suite worker contention, so it carries an explicit
  // timeout.
  it('enforces anonymous denial, column ACLs and settings-RPC authorization while returning null nullable columns without expanding member settings projection', async () => {
    const { url, key } = env();
    async function queryLocal(sql: string) {
      const child = spawn(
        'pnpm',
        ['exec', 'supabase', 'db', 'query', '--local', '--output-format', 'json', sql],
        { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] }
      );
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', resolve);
      });
      if (code !== 0) throw new Error(`Local Supabase SQL failed: ${stderr || stdout}`);
      return stdout;
    }
    const base = () =>
      createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const anon = base();
    async function actor(label: string) {
      const signup = await anon.auth.signUp({
        email: `${label}-${crypto.randomUUID()}@test.local`,
        password: 'Password123!'
      });
      expect(signup.error).toBeNull();
      const session = signup.data.session;
      expect(session).toBeTruthy();
      const client = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${session!.access_token}` } }
      });
      expect((await client.auth.setSession(session!)).error).toBeNull();
      return { id: signup.data.user!.id, client };
    }
    const [admin, member, outsider] = await Promise.all([
      actor('ColumnAdmin'),
      actor('ColumnMember'),
      actor('ColumnOutsider')
    ]);
    // Fresh, never-signed-in client: `anon` signed the actors in above and now holds a
    // session, so it would test "authenticated + missing community" instead of anon denial.
    const anonymous = base();
    expect(
      (await anonymous.rpc('get_community_settings', { p_community_id: crypto.randomUUID() })).error
        ?.code
    ).toBe('42501');
    const anonymousSignIn = await anonymous.auth.signInAnonymously();
    // Local Auth configuration disables anonymous sign-in; DB helper rejection is separately
    // enforced in SQL by the auth.jwt()->>'is_anonymous' check.
    expect(anonymousSignIn.error?.code).toBe('anonymous_provider_disabled');
    const created = await admin.client.rpc('create_community', {
      p_name: `Isolation ${crypto.randomUUID()}`,
      p_visibility: 'public',
      p_join_policy: 'instant',
      p_description: 'preserve me',
      p_city_label: 'Lisbon'
    });
    expect(created.error).toBeNull();
    if (typeof created.data !== 'string') throw new Error('Community creation failed');
    const id = created.data;
    expect(
      await queryLocal(`select created_by from public.communities where id = '${id}'`)
    ).toContain(admin.id);
    const simulatedAnonymous = await queryLocal(
      `with claims as materialized (select set_config('request.jwt.claim.sub','${admin.id}',false), set_config('request.jwt.claims','{"sub":"${admin.id}","is_anonymous":"true"}',false)), check_member as (select public.is_community_member('${id}') as is_member from claims) select is_member from check_member`
    );
    expect(simulatedAnonymous).toContain('false');
    expect(
      (
        await admin.client
          .from('communities')
          .update({ settings: { original: true } })
          .eq('id', id)
      ).error
    ).toBeNull();
    const membership = await admin.client
      .from('community_members')
      .insert({ community_id: id, user_id: member.id, status: 'active', role: 'member' });
    expect(membership.error).toBeNull();

    for (const query of [
      outsider.client.from('communities').select('settings').eq('id', id),
      outsider.client.from('communities').select('created_by').eq('id', id),
      outsider.client.from('communities').select('*').eq('id', id),
      admin.client.from('communities').select('settings').eq('id', id)
    ]) {
      const result = await query;
      expect(result.error?.code).toBe('42501');
    }
    const safe = await outsider.client
      .from('communities')
      .select(
        'id,name,description,logo_path,city_label,visibility,join_policy,created_at,updated_at'
      )
      .eq('id', id);
    expect(safe.error).toBeNull();
    expect(safe.data).toHaveLength(1);
    const privateRow = await admin.client
      .from('communities')
      .update({ visibility: 'private' })
      .eq('id', id);
    expect(privateRow.error).toBeNull();
    expect((await outsider.client.from('communities').select('id').eq('id', id)).data).toEqual([]);
    await admin.client.from('communities').update({ visibility: 'public' }).eq('id', id);

    const memberRead = await member.client
      .rpc('get_community_settings', { p_community_id: id })
      .single();
    expect(memberRead.error).toBeNull();
    expect(memberRead.data).toEqual({ id, settings: { original: true } });
    serverClient.current = member.client;
    expect(await getCommunitySettings({ data: { community_id: id } })).toMatchObject({
      id,
      settings: { original: true }
    });
    expect(
      (
        await member.client.rpc('update_community_settings', {
          p_community_id: id,
          p_changes: { name: 'Member attempt' }
        })
      ).error?.code
    ).toBe('PG001');
    const before = await admin.client
      .from('communities')
      .select('updated_at')
      .eq('id', id)
      .single();
    const updated = await admin.client
      .rpc('update_community_settings', {
        p_community_id: id,
        p_changes: { city_label: null, settings: { replacement: true } }
      })
      .single();
    expect(updated.error).toBeNull();
    expect(updated.data).toMatchObject({
      id,
      description: 'preserve me',
      city_label: null,
      settings: { replacement: true }
    });
    expect(updated.data).not.toHaveProperty('created_by');
    expect(updated.data).not.toEqual(
      expect.objectContaining({ updated_at: before.data?.updated_at })
    );
    serverClient.current = admin.client;
    expect(await getCommunitySettings({ data: { community_id: id } })).toMatchObject({
      settings: { replacement: true }
    });

    expect(
      (await outsider.client.rpc('get_community_settings', { p_community_id: id })).error?.code
    ).toBe('PG006');
    expect(
      (
        await outsider.client.rpc('update_community_settings', {
          p_community_id: id,
          p_changes: { name: 'No' }
        })
      ).error?.code
    ).toBe('PG001');
    expect(
      (await admin.client.rpc('get_community_settings', { p_community_id: crypto.randomUUID() }))
        .error?.code
    ).toBe('PG006');
    expect(
      (
        await admin.client.rpc('update_community_settings', {
          p_community_id: crypto.randomUUID(),
          p_changes: { name: 'No' }
        })
      ).error?.code
    ).toBe('PG001');
    for (const p_changes of [{}, { created_by: admin.id }, { name: null }, []]) {
      const rejected = await admin.client.rpc('update_community_settings', {
        p_community_id: id,
        p_changes
      });
      expect(rejected.error).not.toBeNull();
    }
    const afterInvalid = await admin.client
      .rpc('get_community_settings', { p_community_id: id })
      .single();
    expect(afterInvalid.data).toMatchObject({ settings: { replacement: true } });
    serverClient.current = admin.client;
    expect(
      (await updateCommunitySettings({ data: { community_id: id, settings: { server: true } } }))
        .settings
    ).toEqual({ server: true });
    serverClient.current = admin.client;
    const cleared = await updateCommunitySettings({
      data: { community_id: id, description: null, city_label: null, logo_path: null }
    });
    expect(cleared).toMatchObject({ description: null, city_label: null, logo_path: null });
    serverClient.current = member.client;
    const memberSettings = await getCommunitySettings({ data: { community_id: id } });
    expect(Object.keys(memberSettings ?? {}).sort()).toEqual(['id', 'settings']);
    expect(memberSettings).toEqual({ id, settings: { server: true } });
  }, 15000);
});
