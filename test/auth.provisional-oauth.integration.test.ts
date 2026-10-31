import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertLocalSupabaseEnvInCi,
  dotEnvPathFromImportMetaUrl,
  localSupabaseEnv
} from './helpers/local-supabase-env';
import {
  startControlledProvider,
  type ControlledProvider
} from './helpers/controlled-oauth-provider';
import { authUsersByEmail, uniqueEmail } from './helpers/match-add-player-fixtures';
import {
  addInvitedPlayer,
  authenticationMethods,
  CLAIM_PROFILE,
  claimAudits,
  claimScenario,
  profileState,
  recoverySession,
  sessionClient
} from './helpers/provisional-claim-fixtures';
import { queryTrustedSql } from './helpers/sql-transport';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

// These drive Auth's real OAuth and account-linking code against a controlled provider
// stub (see helpers/controlled-oauth-provider.ts). They prove the linking behavior of this
// stack, not an external Google handshake. When Auth cannot reach the stub (Docker without
// host.docker.internal) the suite skips instead of failing.
let provider: ControlledProvider | undefined;
let reachable = false;

beforeAll(async () => {
  if (!environment.env) return;
  provider = await startControlledProvider();
  try {
    const probe = await provider.signIn(environment.env, {
      sub: crypto.randomUUID(),
      email: uniqueEmail('oauth-probe'),
      emailVerified: true
    });
    reachable = probe.session !== null;
  } catch {
    reachable = false;
  }
});
afterAll(async () => {
  await provider?.close();
});

async function identityProviders(userId: string): Promise<string[]> {
  const result = await queryTrustedSql(
    `select provider from auth.identities where user_id = $1 order by provider`,
    { values: [userId] }
  );
  return result.rows.map((row) => String(row.provider));
}

describe('provisional claim via an OAuth provider', () => {
  it('requires local Supabase in CI', () => {
    expect(() => assertLocalSupabaseEnvInCi(environment.env, process.env.CI)).not.toThrow();
  });

  it('links a provider sign-in with the same verified email to the same identity, then claims', async (context) => {
    if (!environment.env || !reachable) {
      context.skip();
      return;
    }
    const scenario = await claimScenario(environment.env, 'oauth-same');
    const player = await addInvitedPlayer(scenario, {
      displayName: 'Oauth Olivia',
      level: 3,
      label: 'oauth-same'
    });
    const before = await queryTrustedSql(`select count(*)::int as n from auth.users`);

    const signedIn = await provider!.signIn(environment.env, {
      sub: crypto.randomUUID(),
      email: player.email.toUpperCase(),
      emailVerified: true
    });
    expect(signedIn.error).toBeNull();
    // Same Auth identity: no duplicate account, provider identity attached to it.
    expect(signedIn.session?.user.id).toBe(player.id);
    expect((await authUsersByEmail(player.email)).map((user) => user.id)).toEqual([player.id]);
    const after = await queryTrustedSql(`select count(*)::int as n from auth.users`);
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    // Auth swaps the invited email identity for the verified provider identity.
    expect(await identityProviders(player.id)).toEqual(['keycloak']);
    expect(authenticationMethods(signedIn.session!)).toContain('oauth');

    const client = sessionClient(environment.env, signedIn.session!);
    expect((await client.rpc('get_provisional_claim_context')).data).toMatchObject({
      state: 'ready',
      display_name: 'Oauth Olivia',
      initial_level: 3,
      can_edit_level: true
    });
    expect((await client.rpc('claim_provisional_player', CLAIM_PROFILE)).error).toBeNull();
    expect((await profileState(player.id))?.is_provisional).toBe(false);
    expect(await claimAudits(player.id)).toEqual([
      expect.objectContaining({ actor_id: player.id, target_user_id: player.id })
    ]);
  });

  it('never claims on an unverified provider email or a different address', async (context) => {
    if (!environment.env || !reachable) {
      context.skip();
      return;
    }
    const scenario = await claimScenario(environment.env, 'oauth-deny');
    const player = await addInvitedPlayer(scenario, {
      displayName: 'Oauth Oscar',
      level: 3,
      label: 'oauth-deny'
    });

    // Provider says the address is unverified. Auth (whose keycloak linking ignores that flag,
    // unlike its Google provider) still lands on the invited identity, so the claim gate must
    // read the identity's own email_verified and refuse: the provider vouched for nothing.
    const squatterSub = crypto.randomUUID();
    const unverified = await provider!.signIn(environment.env, {
      sub: squatterSub,
      email: player.email,
      emailVerified: false
    });
    expect(unverified.session?.user.id).toBe(player.id);
    const squatter = sessionClient(environment.env, unverified.session!);
    expect((await squatter.rpc('get_provisional_claim_context')).data).toEqual({
      state: 'unverified'
    });
    expect((await squatter.rpc('claim_provisional_player', CLAIM_PROFILE)).error?.message).toBe(
      'PROVISIONAL_CLAIM_EMAIL_NOT_VERIFIED'
    );
    expect((await profileState(player.id))?.is_provisional).toBe(true);

    // The real owner proves the mailbox with the recovery email and claims. The squatter's
    // unverified provider identity and session are gone, so the claimed account is theirs alone.
    const owner = await recoverySession(environment.env, player.email);
    const ownerClient = sessionClient(environment.env, owner.session);
    expect((await ownerClient.rpc('claim_provisional_player', CLAIM_PROFILE)).error).toBeNull();
    expect(await identityProviders(player.id)).toEqual([]);
    const revoked = await createClient(environment.env.url, environment.env.key, {
      auth: { persistSession: false, autoRefreshToken: false }
    }).auth.getUser(unverified.session!.access_token);
    expect(revoked.error).not.toBeNull();
    expect((await ownerClient.auth.getUser(owner.session.access_token)).error).toBeNull();
    // A verified provider account on another address is a separate, unrelated account.
    const other = await provider!.signIn(environment.env, {
      sub: crypto.randomUUID(),
      email: uniqueEmail('oauth-other'),
      emailVerified: true
    });
    expect(other.session?.user.id).not.toBe(player.id);
    const stranger = sessionClient(environment.env, other.session!);
    expect((await stranger.rpc('claim_provisional_player', CLAIM_PROFILE)).error?.message).toBe(
      'PROVISIONAL_CLAIM_NOT_PENDING'
    );
    // The unrelated account changed nothing: only the owner's own claim exists.
    expect((await profileState(player.id))?.display_name).toBe('Claimed Carla');
    expect(await claimAudits(player.id)).toHaveLength(1);
  });
});
