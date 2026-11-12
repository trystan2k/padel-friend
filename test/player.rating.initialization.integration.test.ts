import { describe, expect, it } from 'vitest';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import {
  addInvitedPlayer,
  CLAIM_PROFILE,
  claimScenario,
  sessionClient,
  verifyInvitation
} from './helpers/provisional-claim-fixtures';
import {
  insertFixtureCommunity,
  insertFixtureEvent,
  provisionProvisionalPlayer,
  signUpFixtureActor
} from './helpers/provisional-player-fixtures';
import { insertConfirmedGroup } from './helpers/rating-ledger-fixtures';
import { withDormantProjection } from './helpers/rating-fixtures';
import { queryTrustedSql, sqlErrorMessage } from './helpers/sql-transport';

const environment = localSupabaseEnv();

async function initializations(userId: string) {
  const result = await queryTrustedSql(
    `select sequence, provenance, reason, before_initial_level::float8 as before_level,
            initial_level::float8 as level, original_estimate_level::float8 as original_estimate,
            rating_engine, rating_engine_version, rating_config_version
       from public.player_rating_initializations where user_id = $1 order by sequence`,
    { values: [userId] }
  );
  return result.rows;
}

async function ratingState(userId: string) {
  const result = await queryTrustedSql(
    `select initial_display_level::float8 as initial_level, mu::float8 as mu,
            display_level::float8 as display_level, highest_display_level::float8 as highest,
            confirmed_competitive_game_groups as groups, last_rating_at,
            projection_revision::int as revision, rating_config_version as config
       from public.global_player_ratings where user_id = $1`,
    { values: [userId] }
  );
  return result.rows[0];
}

async function eventCount(userId: string): Promise<number> {
  const result = await queryTrustedSql(
    'select count(*)::int as count from public.player_rating_events where user_id = $1',
    { values: [userId] }
  );
  return Number(result.rows[0]?.['count']);
}

async function rejection(sql: string, values: unknown[]): Promise<string> {
  try {
    await queryTrustedSql(sql, { values });
  } catch (error) {
    return sqlErrorMessage(error);
  }
  throw new Error(`Expected SQL to fail: ${sql}`);
}

const SELF_DECLARED = {
  sequence: 1,
  provenance: 'self_declared',
  reason: 'onboarding',
  before_level: null,
  original_estimate: null,
  rating_engine: 'app-wide-level',
  rating_engine_version: '1.0.0',
  rating_config_version: 1
};

describe('rating initialization audit', { timeout: 120_000 }, () => {
  it.skipIf(!environment.env)(
    'onboarding creates the single state and a sequence-1 audit without any match event',
    async () => {
      const player = await signUpFixtureActor(environment.env!, 'init-onboard', {
        displayName: 'Init Olga',
        level: 3.5
      });
      expect(await initializations(player.id)).toEqual([{ ...SELF_DECLARED, level: 3.5 }]);
      expect(await ratingState(player.id)).toMatchObject({
        initial_level: 3.5,
        mu: 3.5,
        display_level: 3.5,
        highest: 3.5,
        groups: 0,
        last_rating_at: null,
        revision: 0,
        config: 1
      });
      // Re-onboarding is a no-op: no second state, audit entry or event.
      const again = await player.client.rpc('onboard_player', {
        p_display_name: 'Init Olga',
        p_preferred_side: 'LEFT',
        p_initial_level: 6
      });
      expect(again.error).toBeNull();
      expect(await initializations(player.id)).toHaveLength(1);
      expect((await ratingState(player.id))?.initial_level).toBe(3.5);
      expect(await eventCount(player.id)).toBe(0);
    }
  );

  it.skipIf(!environment.env)(
    'creator estimate is audited with its provenance and survives a re-add',
    async () => {
      const env = environment.env!;
      const [admin, provisional] = await Promise.all([
        signUpFixtureActor(env, 'init-admin', { displayName: 'Init Admin', level: 4 }),
        signUpFixtureActor(env, 'init-provisional')
      ]);
      const communityId = crypto.randomUUID();
      const eventId = crypto.randomUUID();
      await insertFixtureCommunity({
        id: communityId,
        visibility: 'private',
        adminId: admin.id
      });
      await insertFixtureEvent({
        id: eventId,
        communityId,
        creatorId: admin.id,
        visibility: 'community_open'
      });
      const input = {
        userId: provisional.id,
        displayName: 'Estimated Eva',
        estimatedLevel: 3.5,
        invitedBy: admin.id,
        sourceEventId: eventId
      };
      expect(await provisionProvisionalPlayer(input)).toBe(true);
      const expected = {
        sequence: 1,
        provenance: 'creator_estimated',
        reason: 'creator_estimate',
        before_level: null,
        level: 3.5,
        original_estimate: 3.5,
        rating_engine: 'app-wide-level',
        rating_engine_version: '1.0.0',
        rating_config_version: 1
      };
      expect(await initializations(provisional.id)).toEqual([expected]);

      // A later add with another estimate never overwrites the first creator's estimate.
      expect(await provisionProvisionalPlayer({ ...input, estimatedLevel: 6 })).toBe(false);
      expect(await initializations(provisional.id)).toEqual([expected]);
      expect((await ratingState(provisional.id))?.initial_level).toBe(3.5);
      const profile = await queryTrustedSql(
        'select estimated_level::float8 as estimate, rating_input_source from public.player_profiles where user_id = $1',
        { values: [provisional.id] }
      );
      expect(profile.rows).toEqual([{ estimate: 3.5, rating_input_source: 'creator_estimated' }]);
      expect(await eventCount(provisional.id)).toBe(0);
    }
  );

  it.skipIf(!environment.env)(
    'the initialization seam rejects re-initialization and unsupported reasons',
    async () => {
      const player = await signUpFixtureActor(environment.env!, 'init-seam', {
        displayName: 'Seam Sam',
        level: 4
      });
      const call = 'select public.initialize_global_player_rating_locked($1, $2, $3)';
      expect(await rejection(call, [player.id, 5, 'onboarding'])).toContain(
        'Player rating already initialized'
      );
      expect(await rejection(call, [player.id, 5, 'migration_snapshot'])).toContain(
        'Invalid rating initialization'
      );
      expect(await rejection(call, [player.id, 5.55, 'claim_before_history'])).toContain(
        'Invalid rating initialization'
      );
      expect(await rejection(call, [crypto.randomUUID(), 5, 'onboarding'])).toContain(
        'Incomplete player state'
      );
      expect(await initializations(player.id)).toHaveLength(1);
    }
  );

  it.skipIf(!environment.env)(
    'a claim edit before any history appends only initialization audit; same level appends nothing',
    async () => {
      const scenario = await claimScenario(environment.env!, 'init-claim-edit');
      const player = await addInvitedPlayer(scenario, {
        displayName: 'Edit Edu',
        level: 3.5,
        label: 'init-edit'
      });
      const verified = await verifyInvitation(scenario.env, player.tokenHash);
      const client = sessionClient(scenario.env, verified.data.session!);
      const before = await ratingState(player.id);

      const claimed = await client.rpc('claim_provisional_player', CLAIM_PROFILE);
      expect(claimed.error).toBeNull();

      expect(await initializations(player.id)).toEqual([
        expect.objectContaining({
          sequence: 1,
          provenance: 'creator_estimated',
          reason: 'creator_estimate',
          level: 3.5,
          original_estimate: 3.5
        }),
        expect.objectContaining({
          sequence: 2,
          provenance: 'creator_estimated',
          reason: 'claim_before_history',
          before_level: 3.5,
          level: 4.2,
          original_estimate: 3.5
        })
      ]);
      expect(await ratingState(player.id)).toMatchObject({
        initial_level: 4.2,
        mu: 4.2,
        display_level: 4.2,
        highest: 4.2,
        groups: 0,
        last_rating_at: null,
        revision: before?.revision,
        config: 1
      });
      // The original estimate and provenance on the profile are never relabeled.
      const profile = await queryTrustedSql(
        'select estimated_level::float8 as estimate, rating_input_source, is_provisional from public.player_profiles where user_id = $1',
        { values: [player.id] }
      );
      expect(profile.rows).toEqual([
        { estimate: 3.5, rating_input_source: 'creator_estimated', is_provisional: false }
      ]);
      expect(await eventCount(player.id)).toBe(0);

      // Same-level claim: no initialization entry at all.
      const same = await addInvitedPlayer(scenario, {
        displayName: 'Same Sol',
        level: 5,
        label: 'init-same'
      });
      const sameClient = sessionClient(
        scenario.env,
        (await verifyInvitation(scenario.env, same.tokenHash)).data.session!
      );
      expect(
        (await sameClient.rpc('claim_provisional_player', { ...CLAIM_PROFILE, p_initial_level: 5 }))
          .error
      ).toBeNull();
      expect(await initializations(same.id)).toHaveLength(1);
      expect((await ratingState(same.id))?.initial_level).toBe(5);
    }
  );

  it.skipIf(!environment.env)(
    'a confirmed predecessor result locks the claim edit before it is projected',
    async () => {
      const scenario = await claimScenario(environment.env!, 'init-claim-locked');
      const player = await addInvitedPlayer(scenario, {
        displayName: 'Locked Lia',
        level: 5,
        label: 'init-locked'
      });
      expect((await ratingState(player.id))?.groups).toBe(0);
      const eventId = crypto.randomUUID();
      await insertFixtureEvent({
        id: eventId,
        communityId: scenario.communityId,
        creatorId: scenario.owner.id,
        visibility: 'community_open',
        past: true
      });
      const others = await Promise.all(
        ['a', 'b'].map((suffix) =>
          signUpFixtureActor(scenario.env, `init-locked-${suffix}`, {
            displayName: `Locked ${suffix}`,
            level: 4
          })
        )
      );
      // A confirmation recorded while projection is dormant (predecessor data): the
      // confirmation alone is the history evidence.
      await withDormantProjection(() =>
        insertConfirmedGroup({
          eventId,
          submittedBy: scenario.owner.id,
          playerIds: [player.id, scenario.owner.id, others[0]!.id, others[1]!.id],
          groupNumber: 1
        })
      );
      expect(await eventCount(player.id)).toBe(0);
      expect((await ratingState(player.id))?.groups).toBe(0);

      const client = sessionClient(
        scenario.env,
        (await verifyInvitation(scenario.env, player.tokenHash)).data.session!
      );
      expect((await client.rpc('get_provisional_claim_context')).data).toMatchObject({
        state: 'ready',
        initial_level: 5,
        can_edit_level: false
      });
      const refused = await client.rpc('claim_provisional_player', CLAIM_PROFILE);
      expect(refused.error?.message).toBe('PROVISIONAL_CLAIM_LEVEL_LOCKED');
      expect(await initializations(player.id)).toHaveLength(1);
      expect((await ratingState(player.id))?.initial_level).toBe(5);

      const ok = await client.rpc('claim_provisional_player', {
        ...CLAIM_PROFILE,
        p_initial_level: 5
      });
      expect(ok.error).toBeNull();
      expect(await initializations(player.id)).toHaveLength(1);
      expect((await ratingState(player.id))?.initial_level).toBe(5);
    }
  );
});
