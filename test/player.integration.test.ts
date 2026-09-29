import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { sportingProfile } from '../src/features/player/player.server';

// Integration suite against the LOCAL Supabase project only. Every client is built from the
// public (publishable) key exactly like the browser, optionally carrying a real user JWT.
// No service-role/secret credential is used anywhere in this file. The suite fails closed:
// it only runs when the configured Supabase URL points at a loopback host, so a hosted project
// can never receive the throwaway users and objects this suite creates.
vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });

type LocalEnv = { url: string; key: string; source: 'environment' | '.env file' };

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);

function usableLocalEnv(
  rawUrl: string | undefined,
  key: string | undefined,
  source: LocalEnv['source']
): LocalEnv | null {
  if (!rawUrl || !key || key.startsWith('replace-with')) return null;
  // Tolerate shell/env quoting (supabase status -o env prints quoted values).
  const url = rawUrl.replace(/^["']+|["']+$/g, '');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) return null;
  return { url, key, source };
}

function localSupabaseEnv(): { env: LocalEnv | null; reason: string } {
  // CI exports both variables after provisioning the pinned local stack, so the process
  // environment wins and no .env file is needed there. Once both variables are configured
  // they are authoritative: a non-loopback value must never silently fall back to .env.
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (url && key && !key.startsWith('replace-with')) {
    const fromEnvironment = usableLocalEnv(url, key, 'environment');
    return fromEnvironment
      ? { env: fromEnvironment, reason: '' }
      : {
          env: null,
          reason: `VITE_SUPABASE_URL '${url}' is not a loopback (127.0.0.1/localhost) local Supabase project — the suite refuses to run so it cannot create users or objects on a hosted instance`
        };
  }
  try {
    const raw = readFileSync(new URL('../.env', import.meta.url), 'utf8');
    const vars = new Map(
      raw
        .split('\n')
        .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
        .map((line) => {
          const index = line.indexOf('=');
          return [line.slice(0, index).trim(), line.slice(index + 1).trim()] as const;
        })
    );
    const fileUrl = vars.get('VITE_SUPABASE_URL');
    const fileKey = vars.get('VITE_SUPABASE_PUBLISHABLE_KEY');
    const fromFile = usableLocalEnv(fileUrl, fileKey, '.env file');
    if (fromFile) return { env: fromFile, reason: '' };
    if (fileUrl && fileKey && !fileKey.startsWith('replace-with')) {
      return {
        env: null,
        reason: `VITE_SUPABASE_URL '${fileUrl}' from .env is not a loopback (127.0.0.1/localhost) local Supabase project — the suite refuses to run so it cannot create users or objects on a hosted instance`
      };
    }
  } catch {
    // No .env file — treated like missing env vars.
  }
  return {
    env: null,
    reason:
      'VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY are missing (or the key is a placeholder) — start the local stack (pnpm db:start && pnpm db:reset) and export both variables to enable the suite'
  };
}

const environment = localSupabaseEnv();
if (environment.env === null)
  // Raw stderr write: vitest intercepts console.* and hides it for fully skipped files, but
  // the reason must stay visible in default output. Locally this is a graceful skip; under CI
  // the guard suite below turns the same condition into a hard failure instead.
  process.stderr.write(`[player.integration] suite NOT RUN: ${environment.reason}\n`);

// Explains every reason the current environment may not run this suite under CI: a skipped
// integration suite in CI means the backend contract was never validated, so the guard below
// turns a non-empty list into a hard failure instead of silently passing with zero coverage.
// The loopback fail-closed guard above still decides WHY the environment is unusable; only
// local runs (no CI) may proceed past this guard with the suite skipped.
function ciBackendBlocks(): string[] {
  if (process.env.CI === undefined || environment.env !== null) return [];
  return [
    'CI must provision a loopback local Supabase backend (VITE_SUPABASE_URL / ' +
      'VITE_SUPABASE_PUBLISHABLE_KEY pointing at 127.0.0.1/localhost) so the integration ' +
      'suite can run.',
    environment.reason
  ];
}

describe('player profiles and ratings (local Supabase integration) — CI backend guard', () => {
  it('fails the run when CI is set without a usable loopback local Supabase backend', () => {
    expect(ciBackendBlocks()).toEqual([]);
  });
});

describe.skipIf(environment.env === null)(
  'player profiles and ratings (local Supabase integration)',
  () => {
    const PASSWORD = 'Password123!';

    // describe.skipIf still evaluates this callback during collection, so the nullable
    // environment must never be destructured here. Resolving it per use keeps the guard
    // explicit: tests run only after the loopback check above passed.
    function env(): LocalEnv {
      if (environment.env === null)
        throw new Error(`local Supabase env unavailable: ${environment.reason}`);
      return environment.env;
    }

    async function signUpPlayer(
      label: string
    ): Promise<{ client: SupabaseClient; userId: string; email: string }> {
      const { url, key } = env();
      const bootstrap = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      const email = `${label}-${crypto.randomUUID()}@test.local`;
      const { data, error } = await bootstrap.auth.signUp({ email, password: PASSWORD });
      expect(error, `signUp failed: ${error?.message}`).toBeNull();
      const token = data.session?.access_token;
      expect(
        token,
        'local signup must return a session (email confirmations disabled)'
      ).toBeTruthy();
      const client = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } }
      });
      return { client, userId: data.user!.id, email };
    }

    async function onboard(
      client: SupabaseClient,
      displayName: string,
      side: 'LEFT' | 'RIGHT' | 'EITHER',
      level: number,
      dominantHand?: 'LEFT' | 'RIGHT' | null,
      bio?: string | null
    ) {
      const { error } = await client.rpc('onboard_player', {
        p_display_name: displayName,
        p_preferred_side: side,
        p_initial_level: level,
        ...(dominantHand === undefined ? {} : { p_dominant_hand: dominantHand }),
        ...(bio === undefined ? {} : { p_bio: bio })
      });
      expect(error, `onboard_player failed: ${error?.message}`).toBeNull();
    }

    async function ownProfile(client: SupabaseClient, userId: string) {
      const { data, error } = await client
        .from('player_profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      expect(error, `owner profile read failed: ${error?.message}`).toBeNull();
      return data;
    }

    async function ownRating(client: SupabaseClient, userId: string) {
      const { data, error } = await client
        .from('global_player_ratings')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      expect(error, `owner rating read failed: ${error?.message}`).toBeNull();
      return data;
    }

    it('creates exactly one profile and one rating on retry and concurrent onboarding, never resetting the initial rating', async () => {
      const { client, userId } = await signUpPlayer('retry');
      await onboard(client, 'Retry Player', 'EITHER', 3.5);
      // Sequential duplicate submit (double POST / callback replay).
      await onboard(client, 'Retry Player', 'EITHER', 3.5);
      // Concurrent duplicate submits race the same advisory lock; both must succeed idempotently
      // instead of surfacing an error to one of the racing requests.
      const [firstRace, secondRace] = await Promise.all([
        client.rpc('onboard_player', {
          p_display_name: 'Retry Player',
          p_preferred_side: 'EITHER',
          p_initial_level: 3.5
        }),
        client.rpc('onboard_player', {
          p_display_name: 'Retry Player',
          p_preferred_side: 'EITHER',
          p_initial_level: 3.5
        })
      ]);
      expect(
        firstRace.error,
        `first concurrent submit failed: ${firstRace.error?.message}`
      ).toBeNull();
      expect(
        secondRace.error,
        `second concurrent submit failed: ${secondRace.error?.message}`
      ).toBeNull();

      const profiles = await client.from('player_profiles').select('*').eq('user_id', userId);
      const ratings = await client.from('global_player_ratings').select('*').eq('user_id', userId);
      expect(profiles.data).toHaveLength(1);
      expect(ratings.data).toHaveLength(1);

      const profile = profiles.data![0];
      const rating = ratings.data![0];
      expect(profile.display_name).toBe('Retry Player');
      expect(profile.preferred_side).toBe('EITHER');
      expect(profile.dominant_hand).toBeNull();
      expect(profile.bio).toBeNull();
      expect(profile.avatar_url).toBeNull();
      expect(rating.initial_display_level).toBe(3.5);
      expect(rating.mu).toBe(3.5);
      expect(rating.sigma).toBe(1);
      expect(rating.display_level).toBe(3.5);
      expect(rating.highest_display_level).toBe(3.5);
      expect(rating.reliability_percent).toBe(10);
      expect(rating.confirmed_competitive_game_groups).toBe(0);
      expect(rating.rating_engine).toBe('app-wide-level');
      expect(rating.rating_engine_version).toBe('1.0.0');
      expect(rating.last_rating_at).toBeNull();
    });

    it('converges a race started before any row exists to exactly one profile and one rating', async () => {
      const { client, userId } = await signUpPlayer('race');
      // Both requests enter before either row is committed: the per-user advisory lock must
      // serialize them so one insert wins and the loser observes the complete state and returns.
      const [winner, loser] = await Promise.all([
        client.rpc('onboard_player', {
          p_display_name: 'Race Player',
          p_preferred_side: 'LEFT',
          p_initial_level: 2.5
        }),
        client.rpc('onboard_player', {
          p_display_name: 'Race Player',
          p_preferred_side: 'LEFT',
          p_initial_level: 2.5
        })
      ]);
      expect(winner.error, `race winner failed: ${winner.error?.message}`).toBeNull();
      expect(loser.error, `race loser failed: ${loser.error?.message}`).toBeNull();

      const profiles = await client.from('player_profiles').select('*').eq('user_id', userId);
      expect(profiles.data).toHaveLength(1);
      const ratings = await client.from('global_player_ratings').select('*').eq('user_id', userId);
      expect(ratings.data).toHaveLength(1);
      expect(ratings.data![0].initial_display_level).toBe(2.5);
      expect(ratings.data![0].reliability_percent).toBe(10);
    });

    it('persists dominant hand and bio atomically with the initial rating, and a retry never overwrites them', async () => {
      const { client, userId } = await signUpPlayer('atomic');
      const bio = 'Right-side player with a hard flat smash.';
      // Hand and bio ride the same five-argument RPC transaction as the profile and rating rows.
      await onboard(client, 'Atomic Player', 'RIGHT', 4.5, 'LEFT', bio);

      const created = await ownProfile(client, userId);
      expect(created).not.toBeNull();
      expect(created?.display_name).toBe('Atomic Player');
      expect(created?.dominant_hand).toBe('LEFT');
      expect(created?.bio).toBe(bio);
      const rating = await ownRating(client, userId);
      expect(rating?.initial_display_level).toBe(4.5);
      expect(rating?.display_level).toBe(4.5);
      expect(rating?.reliability_percent).toBe(10);

      // A duplicate submit that carries DIFFERENT optional values must be a no-op on both rows.
      await onboard(client, 'Atomic Player', 'RIGHT', 4.5, 'RIGHT', 'Overwritten bio');
      const afterRetry = await ownProfile(client, userId);
      expect(afterRetry?.dominant_hand).toBe('LEFT');
      expect(afterRetry?.bio).toBe(bio);
      expect((await ownRating(client, userId))?.initial_display_level).toBe(4.5);
    });

    it('rejects invalid optional hand and overlong bio at the SQL level before creating any row', async () => {
      const { client, userId } = await signUpPlayer('sqlvalid');
      const invalidHand = await client.rpc('onboard_player', {
        p_display_name: 'Hand Player',
        p_preferred_side: 'LEFT',
        p_initial_level: 3,
        p_dominant_hand: 'BOTH'
      });
      expect(invalidHand.error?.code).toBe('22023');
      const lowercaseHand = await client.rpc('onboard_player', {
        p_display_name: 'Hand Player',
        p_preferred_side: 'LEFT',
        p_initial_level: 3,
        p_dominant_hand: 'left'
      });
      expect(lowercaseHand.error?.code).toBe('22023');
      const overlongBio = await client.rpc('onboard_player', {
        p_display_name: 'Bio Player',
        p_preferred_side: 'LEFT',
        p_initial_level: 3,
        p_bio: 'x'.repeat(281)
      });
      expect(overlongBio.error?.code).toBe('22023');

      // The rejected inputs created nothing: validation happens before either insert.
      expect(await ownProfile(client, userId)).toBeNull();
      expect(await ownRating(client, userId)).toBeNull();

      // The 280-character boundary is accepted and lands in the same pass as the rating.
      const boundary = await client.rpc('onboard_player', {
        p_display_name: 'Edge Player',
        p_preferred_side: 'LEFT',
        p_initial_level: 3,
        p_dominant_hand: 'RIGHT',
        p_bio: 'x'.repeat(280)
      });
      expect(boundary.error, `boundary bio failed: ${boundary.error?.message}`).toBeNull();
      const profile = await ownProfile(client, userId);
      expect(profile?.bio).toHaveLength(280);
      expect(profile?.dominant_hand).toBe('RIGHT');
      expect(await ownRating(client, userId)).not.toBeNull();
    });

    it('lets the owner read and update only the granted profile columns', async () => {
      const { client, userId } = await signUpPlayer('owner');
      await onboard(client, 'Owner Player', 'LEFT', 3);
      const before = await ownProfile(client, userId);
      expect(before).not.toBeNull();

      const update = await client
        .from('player_profiles')
        .update({
          display_name: 'Owner Renamed',
          dominant_hand: 'RIGHT',
          bio: 'Direct bio',
          preferred_side: 'RIGHT'
        })
        .eq('user_id', userId)
        .select()
        .single();
      expect(update.error, `owner update failed: ${update.error?.message}`).toBeNull();
      expect(update.data.display_name).toBe('Owner Renamed');
      expect(update.data.dominant_hand).toBe('RIGHT');
      expect(update.data.bio).toBe('Direct bio');
      expect(update.data.preferred_side).toBe('RIGHT');
      // updated_at is database-owned: the trigger must move it past created_at.
      expect(new Date(update.data.updated_at).getTime()).toBeGreaterThanOrEqual(
        new Date(update.data.created_at).getTime()
      );

      // Identity and audit columns are not covered by the column-level UPDATE grant.
      const forgedId = await client
        .from('player_profiles')
        .update({ user_id: userId })
        .eq('user_id', userId);
      expect(forgedId.error?.code).toBe('42501');
      const forgedStamp = await client
        .from('player_profiles')
        .update({ created_at: '2000-01-01T00:00:00Z' })
        .eq('user_id', userId);
      expect(forgedStamp.error?.code).toBe('42501');
      // There is no DELETE grant at all.
      const deleted = await client.from('player_profiles').delete().eq('user_id', userId);
      expect(deleted.error?.code).toBe('42501');
    });

    it('rejects display names with leading or trailing whitespace at the SQL CHECK and in the RPC', async () => {
      const { client, userId } = await signUpPlayer('whitespace');
      await onboard(client, 'Whitespace Player', 'EITHER', 3);

      // Owner UPDATE: the tightened CHECK rejects every member of the btrim whitespace class,
      // including the whitespace-only name that the UI client guard blocks before submitting.
      for (const name of [
        '\tTabbed',
        'Tabbed\t',
        '\nNewlined',
        'Newlined\r',
        'Feed\f',
        'Vertical\v',
        ' Spaced',
        '   '
      ]) {
        const rejected = await client
          .from('player_profiles')
          .update({ display_name: name })
          .eq('user_id', userId);
        expect(
          rejected.error?.code,
          `update with ${JSON.stringify(name)} must violate the display name CHECK`
        ).toBe('23514');
        expect((await ownProfile(client, userId))?.display_name).toBe('Whitespace Player');
      }

      // A clean name still updates for the same owner.
      const renamed = await client
        .from('player_profiles')
        .update({ display_name: 'Clean Rename' })
        .eq('user_id', userId);
      expect(renamed.error, `clean rename failed: ${renamed.error?.message}`).toBeNull();
      expect((await ownProfile(client, userId))?.display_name).toBe('Clean Rename');

      // The RPC validates the same whitespace class on onboarding input before inserting,
      // whitespace-only names included.
      const fresh = await signUpPlayer('whitespacefresh');
      for (const name of ['\tFresh Player', 'Fresh Player\t', 'Fresh Player\n', '   ']) {
        const rejectedRpc = await fresh.client.rpc('onboard_player', {
          p_display_name: name,
          p_preferred_side: 'LEFT',
          p_initial_level: 3
        });
        expect(
          rejectedRpc.error?.code,
          `onboard with ${JSON.stringify(name)} must be rejected`
        ).toBe('22023');
      }
      // The rejected onboarding inputs created nothing.
      expect(await ownProfile(fresh.client, fresh.userId)).toBeNull();
      expect(await ownRating(fresh.client, fresh.userId)).toBeNull();

      // Internal whitespace (even a tab) stays legitimate.
      const internal = await fresh.client.rpc('onboard_player', {
        p_display_name: 'Ana\tLee',
        p_preferred_side: 'LEFT',
        p_initial_level: 3
      });
      expect(internal.error, `internal tab failed: ${internal.error?.message}`).toBeNull();
      expect((await ownProfile(fresh.client, fresh.userId))?.display_name).toBe('Ana\tLee');
    });

    it('denies missing or invalid authentication', async () => {
      const { url, key } = env();
      const anon = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false }
      });

      const rpc = await anon.rpc('onboard_player', {
        p_display_name: 'Anon',
        p_preferred_side: 'LEFT',
        p_initial_level: 3
      });
      expect(rpc.error?.code).toBe('42501');

      const select = await anon.from('player_profiles').select('*');
      expect(select.error?.code).toBe('42501');
      const ratingSelect = await anon.from('global_player_ratings').select('*');
      expect(ratingSelect.error?.code).toBe('42501');

      // Expired/tampered credentials are indistinguishable at the public API: the JWT fails
      // verification (PGRST301) exactly like an expired token would.
      const forged = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: 'Bearer invalid.token.here' } }
      });
      const forgedSelect = await forged.from('player_profiles').select('*');
      expect(forgedSelect.error?.code).toBe('PGRST301');
    });

    it('denies other users any read or write on foreign profiles and ratings, and denies direct rating writes', async () => {
      const alice = await signUpPlayer('alice');
      const bob = await signUpPlayer('bob');
      await onboard(alice.client, 'Alice Player', 'RIGHT', 3.5);

      // Foreign SELECT is filtered to zero rows by RLS, not an error.
      const foreignProfile = await bob.client
        .from('player_profiles')
        .select('*')
        .eq('user_id', alice.userId);
      expect(foreignProfile.error).toBeNull();
      expect(foreignProfile.data).toEqual([]);
      const foreignRating = await bob.client
        .from('global_player_ratings')
        .select('*')
        .eq('user_id', alice.userId);
      expect(foreignRating.error).toBeNull();
      expect(foreignRating.data).toEqual([]);

      // Foreign UPDATE touches zero rows and leaves the profile unchanged.
      const foreignUpdate = await bob.client
        .from('player_profiles')
        .update({ display_name: 'HACKED' })
        .eq('user_id', alice.userId);
      expect(foreignUpdate.error).toBeNull();
      expect(foreignUpdate.data).toBeNull();
      expect((await ownProfile(alice.client, alice.userId))?.display_name).toBe('Alice Player');

      // No INSERT policy/grant exists on either table — even for the owner.
      const directProfileInsert = await alice.client.from('player_profiles').insert({
        user_id: alice.userId,
        display_name: 'Forged',
        preferred_side: 'LEFT'
      });
      expect(directProfileInsert.error?.code).toBe('42501');

      // Direct rating INSERT/UPDATE/DELETE are always rejected for regular clients.
      const ratingInsert = await alice.client.from('global_player_ratings').insert({
        user_id: alice.userId,
        initial_display_level: 1,
        mu: 1,
        sigma: 1,
        display_level: 1,
        reliability_percent: 1,
        confirmed_competitive_game_groups: 1,
        highest_display_level: 1,
        rating_engine: 'forged',
        rating_engine_version: '9.9.9'
      });
      expect(ratingInsert.error?.code).toBe('42501');
      const ratingUpdate = await alice.client
        .from('global_player_ratings')
        .update({ reliability_percent: 99 })
        .eq('user_id', alice.userId);
      expect(ratingUpdate.error?.code).toBe('42501');
      const ratingDelete = await alice.client
        .from('global_player_ratings')
        .delete()
        .eq('user_id', alice.userId);
      expect(ratingDelete.error?.code).toBe('42501');
      expect((await ownRating(alice.client, alice.userId))?.reliability_percent).toBe(10);
    });

    it('enforces the avatar owner path, MIME allowlist and size limit in Storage', async () => {
      const alice = await signUpPlayer('storagea');
      const bob = await signUpPlayer('storageb');
      const bucket = 'player-avatars';
      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const aliceKey = `${alice.userId}/11111111-2222-4333-8444-555555555555.png`;

      const upload = await alice.client.storage.from(bucket).upload(aliceKey, png, {
        contentType: 'image/png',
        upsert: false
      });
      expect(upload.error, `owner avatar upload failed: ${upload.error?.message}`).toBeNull();
      expect(upload.data?.path).toBe(aliceKey);

      const listing = await alice.client.storage
        .from(bucket)
        .list(alice.userId, { search: '11111111' });
      expect(listing.error).toBeNull();
      expect(listing.data?.map((object) => object.name)).toContain(
        '11111111-2222-4333-8444-555555555555.png'
      );

      const signed = await alice.client.storage.from(bucket).createSignedUrl(aliceKey, 60);
      expect(signed.error, `owner signed URL failed: ${signed.error?.message}`).toBeNull();
      expect(signed.data?.signedUrl).toContain('/object/sign/');

      // Foreign upload into the owner folder violates the RLS with-check.
      const foreignUpload = await bob.client.storage
        .from(bucket)
        .upload(`${alice.userId}/22222222-2222-4333-8444-555555555555.png`, png, {
          contentType: 'image/png'
        });
      expect(foreignUpload.error).not.toBeNull();

      // Foreign download is "not found": RLS hides the object.
      const foreignDownload = await bob.client.storage.from(bucket).download(aliceKey);
      expect(foreignDownload.error).not.toBeNull();

      // Foreign listing is empty and foreign delete removes nothing.
      const foreignList = await bob.client.storage
        .from(bucket)
        .list(alice.userId, { search: '11111111' });
      expect(foreignList.error).toBeNull();
      expect(foreignList.data).toEqual([]);
      const foreignDelete = await bob.client.storage.from(bucket).remove([aliceKey]);
      expect(foreignDelete.error).toBeNull();
      expect(foreignDelete.data).toEqual([]);
      const stillThere = await alice.client.storage.from(bucket).download(aliceKey);
      expect(stillThere.error).toBeNull();

      // Bucket-level enforcement: over 2 MiB and disallowed MIME types are rejected.
      const oversized = await alice.client.storage
        .from(bucket)
        .upload(
          `${alice.userId}/33333333-2222-4333-8444-555555555555.png`,
          new Uint8Array(2 * 1024 * 1024 + 1),
          { contentType: 'image/png' }
        );
      expect(oversized.error).not.toBeNull();
      const wrongMime = await alice.client.storage
        .from(bucket)
        .upload(`${alice.userId}/44444444-2222-4333-8444-555555555555.txt`, new Uint8Array([1]), {
          contentType: 'text/plain'
        });
      expect(wrongMime.error).not.toBeNull();

      // Owner deletes their own object (explicit owner delete path).
      const ownerDelete = await alice.client.storage.from(bucket).remove([aliceKey]);
      expect(ownerDelete.error).toBeNull();
      const gone = await alice.client.storage.from(bucket).download(aliceKey);
      expect(gone.error).not.toBeNull();
    });

    it('enforces the avatar_url CHECK on direct owner updates: nested/extra segments, non-v4 object UUIDs and an uppercased owner prefix rejected with 23514; a canonical v4 key, a mixed-case extension and NULL accepted', async () => {
      const { client, userId } = await signUpPlayer('avatarurl');
      await onboard(client, 'Avatar Url Player', 'LEFT', 3);

      const v4Object = '22222222-2222-4222-8222-222222222222';
      const validKey = `${userId}/${v4Object}.png`;
      const setAvatar = (avatarUrl: string | null) =>
        client.from('player_profiles').update({ avatar_url: avatarUrl }).eq('user_id', userId);
      const currentAvatar = async () => (await ownProfile(client, userId))?.avatar_url;

      // Starts clean: onboarding never sets an avatar.
      expect(await currentAvatar()).toBeNull();

      // Nested/extra path segments break the `^<owner>/<v4>.<ext>$` anchor → SQLSTATE 23514.
      for (const nestedKey of [
        `${userId}/nested/${v4Object}.png`,
        `${userId}/${v4Object}/nested.png`,
        `${userId}/${v4Object}/nested/${v4Object}.png`
      ]) {
        const rejected = await setAvatar(nestedKey);
        expect(
          rejected.error?.code,
          `nested avatar key ${nestedKey} must violate the avatar_url CHECK`
        ).toBe('23514');
      }

      // Version nibble != 4 and a variant nibble outside [89ab] are equally rejected.
      for (const badObject of [
        '22222222-2222-3222-8222-222222222222',
        '22222222-2222-4222-c222-222222222222'
      ]) {
        const rejected = await setAvatar(`${userId}/${badObject}.png`);
        expect(
          rejected.error?.code,
          `object uuid ${badObject} must violate the avatar_url CHECK`
        ).toBe('23514');
      }
      expect(await currentAvatar()).toBeNull();

      // Owner-prefix matching is exact (case-sensitive): an UPPERCASED owner UUID with an
      // otherwise valid filename violates the `left(avatar_url, …) = user_id::text || '/'`
      // equality → SQLSTATE 23514, and the stored value stays untouched.
      const uppercasedPrefix = await setAvatar(`${userId.toUpperCase()}/${v4Object}.png`);
      expect(
        uppercasedPrefix.error?.code,
        'an uppercased owner prefix must violate the avatar_url CHECK'
      ).toBe('23514');
      expect(await currentAvatar()).toBeNull();

      // The canonical v4 key for the owner is accepted and read back verbatim.
      const accepted = await setAvatar(validKey);
      expect(accepted.error, `valid avatar key failed: ${accepted.error?.message}`).toBeNull();
      expect(await currentAvatar()).toBe(validKey);

      // A rejected write never clobbers an already-saved avatar_url.
      const rejectedAfterSave = await setAvatar(`${userId}/nested/${v4Object}.png`);
      expect(rejectedAfterSave.error?.code).toBe('23514');
      expect(await currentAvatar()).toBe(validKey);

      // Case-insensitivity is filename-scoped: a mixed-case extension on the SAME key is
      // accepted and read back verbatim.
      const upperExtensionKey = `${userId}/${v4Object}.PNG`;
      const acceptedUpperExtension = await setAvatar(upperExtensionKey);
      expect(
        acceptedUpperExtension.error,
        `mixed-case extension failed: ${acceptedUpperExtension.error?.message}`
      ).toBeNull();
      expect(await currentAvatar()).toBe(upperExtensionKey);

      // Clearing back to NULL stays allowed.
      const cleared = await setAvatar(null);
      expect(cleared.error, `null avatar failed: ${cleared.error?.message}`).toBeNull();
      expect(await currentAvatar()).toBeNull();
    });

    it('degrades an accepted-but-nonexistent avatar object key to a null signed URL instead of failing the profile read', async () => {
      const { client, userId } = await signUpPlayer('ghostsign');
      await onboard(client, 'Ghost Sign Player', 'LEFT', 3);

      // A syntactically valid v4+variant key for an object the owner never uploaded passes
      // the avatar_url CHECK and is stored verbatim.
      const ghostKey = `${userId}/33333333-2222-4333-8444-555555555555.png`;
      const stored = await client
        .from('player_profiles')
        .update({ avatar_url: ghostKey })
        .eq('user_id', userId);
      expect(stored.error, `ghost avatar key failed: ${stored.error?.message}`).toBeNull();
      expect((await ownProfile(client, userId))?.avatar_url).toBe(ghostKey);

      // The profile read path (sportingProfile) must NOT throw on the unresolvable key:
      // Storage answers the sign request with NoSuchKey and the read degrades it to a null
      // signed URL. This is the full server path against the real backend — no test double.
      const ghostRead = await sportingProfile(client, userId);
      expect(ghostRead.display_name).toBe('Ghost Sign Player');
      expect(ghostRead.avatar_signed_url).toBeNull();

      // Positive control: once the object really exists, the same read path signs it —
      // proving the null above is the degradation path, not a universal outcome.
      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const uploaded = await client.storage.from('player-avatars').upload(ghostKey, png, {
        contentType: 'image/png',
        upsert: false
      });
      expect(uploaded.error, `owner avatar upload failed: ${uploaded.error?.message}`).toBeNull();
      const withObject = await sportingProfile(client, userId);
      expect(withObject.avatar_signed_url).toContain('/object/sign/');
    });

    it('exposes only sporting columns in the profile/rating rows — never auth email or security metadata', async () => {
      const { client, userId, email } = await signUpPlayer('dto');
      await onboard(client, 'Dto Player', 'EITHER', 3);
      const profile = await ownProfile(client, userId);
      const rating = await ownRating(client, userId);

      expect(Object.keys(profile).sort()).toEqual([
        'avatar_url',
        'bio',
        'created_at',
        'display_name',
        'dominant_hand',
        'preferred_side',
        'updated_at',
        'user_id'
      ]);
      expect(Object.keys(rating).sort()).toEqual([
        'confirmed_competitive_game_groups',
        'display_level',
        'highest_display_level',
        'initial_display_level',
        'last_rating_at',
        'mu',
        'rating_engine',
        'rating_engine_version',
        'reliability_percent',
        'sigma',
        'updated_at',
        'user_id'
      ]);
      expect(JSON.stringify(profile)).not.toContain(email);
      expect(JSON.stringify(rating)).not.toContain(email);
    });

    it('reports a rowless authenticated state through the raw tables (getOnboardingStatus completeness source)', async () => {
      const { client, userId } = await signUpPlayer('status');
      expect(await ownProfile(client, userId)).toBeNull();
      expect(await ownRating(client, userId)).toBeNull();
    });
  }
);
