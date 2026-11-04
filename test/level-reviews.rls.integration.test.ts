import { createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/lib/supabase/database.types';
import {
  forgedRoleClient,
  grantPlatformAdmin,
  levelReviewRow,
  levelReviewWorld,
  revokePlatformAdmin,
  submitArgs,
  submitRequest,
  type LevelReviewActor,
  type LevelReviewWorld
} from './helpers/level-review-fixtures';
import {
  decodeLevelReviewList,
  decodeLevelReviewQueue
} from '../src/features/level-reviews/level-review-decoders';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { signUpFixtureActor } from './helpers/provisional-player-fixtures';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
const ID = '11111111-1111-4111-8111-111111111111';

describe('level review RLS and role denial', { timeout: 240_000 }, () => {
  let world: LevelReviewWorld;
  let requestId: string;
  let denied: { name: string; actor: () => LevelReviewActor }[];

  beforeAll(async () => {
    if (!environment.env) return;
    world = await levelReviewWorld(environment.env, 'lrrls');
    requestId = await submitRequest(world.owner);
    denied = [
      { name: 'owner', actor: () => world.owner },
      { name: 'unrelated player', actor: () => world.other },
      { name: 'Community Admin', actor: () => world.communityAdmin },
      { name: 'Match Creator', actor: () => world.matchCreator }
    ];
  });

  const adminCalls = (id: string) =>
    [
      ['list_level_review_queue', {}],
      ['get_level_review_admin_detail', { p_request_id: id }],
      ['mark_level_review_under_review', { p_request_id: id }],
      [
        'resolve_level_review_request',
        { p_request_id: id, p_command_id: crypto.randomUUID(), p_decision: 'reject', p_note: 'no' }
      ]
    ] as const;

  it.skipIf(!environment.env)(
    'denies the queue, detail and every resolution command to non-Platform-Admins',
    async () => {
      for (const { name, actor } of denied)
        for (const [rpc, args] of adminCalls(requestId)) {
          const result = await actor().client.rpc(rpc, args);
          expect(result.error?.message, `${name} ${rpc}`).toBe('LEVEL_REVIEW_FORBIDDEN');
          expect(result.data).toBeNull();
        }
      expect(await levelReviewRow(requestId)).toMatchObject({ status: 'pending' });
    }
  );

  it.skipIf(!environment.env)('reports access only for the calling actor', async () => {
    const admin = await world.platformAdmin.client.rpc('get_level_review_access');
    expect(admin.data).toEqual({ is_platform_admin: true });
    for (const { actor } of denied) {
      const result = await actor().client.rpc('get_level_review_access');
      expect(result.data).toEqual({ is_platform_admin: false });
    }
  });

  it.skipIf(!environment.env)('lets a Platform Admin read the queue and detail', async () => {
    const queue = await world.platformAdmin.client.rpc('list_level_review_queue', {
      p_status: 'pending',
      p_limit: 50
    });
    expect(queue.error).toBeNull();
    const ids = decodeLevelReviewQueue(queue.data).items.map((item) => item.id);
    expect(ids).toContain(requestId);
    const detail = await world.platformAdmin.client.rpc('get_level_review_admin_detail', {
      p_request_id: requestId
    });
    expect(detail.error).toBeNull();
    expect(detail.data).toMatchObject({
      request: { id: requestId, owner_id: world.owner.id, status: 'pending' },
      current: { mu: 4, display_level: 4, reliability_percent: 10 },
      rating_changed: false,
      recent_history: []
    });
  });

  it.skipIf(!environment.env)(
    'ignores forged role metadata in the JWT and revokes access on the next call',
    async () => {
      const forged = await forgedRoleClient(environment.env!, world.other);
      const queue = await forged.rpc('list_level_review_queue', {});
      expect(queue.error?.message).toBe('LEVEL_REVIEW_FORBIDDEN');
      expect((await forged.rpc('get_level_review_access')).data).toEqual({
        is_platform_admin: false
      });

      const temp = await signUpFixtureActor(environment.env!, 'lrrls-temp', {
        displayName: 'Temp admin',
        level: 3
      });
      await grantPlatformAdmin(temp.id);
      expect((await temp.client.rpc('list_level_review_queue', {})).error).toBeNull();
      await revokePlatformAdmin(temp.id);
      expect((await temp.client.rpc('list_level_review_queue', {})).error?.message).toBe(
        'LEVEL_REVIEW_FORBIDDEN'
      );
    }
  );

  it.skipIf(!environment.env)(
    'limits direct table reads to the owner and hides non-owners entirely',
    async () => {
      const own = await world.owner.client
        .from('player_level_review_requests')
        .select('id, status, reason, requested_min_level');
      expect(own.error).toBeNull();
      expect(own.data?.map((row) => row.id)).toEqual([requestId]);
      for (const actor of [
        world.other,
        world.communityAdmin,
        world.matchCreator,
        world.platformAdmin
      ]) {
        const rows = await actor.client.from('player_level_review_requests').select('id');
        expect(rows.error).toBeNull();
        expect(rows.data).toEqual([]);
      }
      const hidden = await world.owner.client
        .from('player_level_review_requests')
        .select('decision_actor_id, command_id, fingerprint');
      expect(hidden.error?.code).toBe('42501');
    }
  );

  it.skipIf(!environment.env)(
    'denies every direct table write to owners, admins and other players',
    async () => {
      const everyone = [world.owner, world.other, world.platformAdmin, world.communityAdmin];
      for (const actor of everyone) {
        const insert = await actor.client.from('player_level_review_requests').insert({
          owner_id: actor.id,
          command_id: crypto.randomUUID(),
          fingerprint: 'x',
          snapshot_display_level: 4,
          snapshot_reliability_percent: 10,
          snapshot_rating_revision: 0,
          requested_min_level: 4,
          requested_max_level: 5,
          reason: 'forged'
        });
        expect(insert.error?.code).toBe('42501');
        const update = await actor.client
          .from('player_level_review_requests')
          .update({ status: 'approved', approved_level: 5 })
          .eq('id', requestId);
        expect(update.error?.code).toBe('42501');
        const remove = await actor.client
          .from('player_level_review_requests')
          .delete()
          .eq('id', requestId);
        expect(remove.error?.code).toBe('42501');
      }
      expect(await levelReviewRow(requestId)).toMatchObject({
        status: 'pending',
        approved_level: null
      });
    }
  );

  it.skipIf(!environment.env)(
    'keeps the Platform Admin allowlist unreadable and unwritable at runtime',
    async () => {
      for (const actor of [world.platformAdmin, world.owner, world.communityAdmin]) {
        const read = await actor.client.from('platform_admins').select('user_id');
        expect(read.error?.code).toBe('42501');
        const insert = await actor.client.from('platform_admins').insert({ user_id: actor.id });
        expect(insert.error?.code).toBe('42501');
        const remove = await actor.client
          .from('platform_admins')
          .delete()
          .eq('user_id', world.platformAdmin.id);
        expect(remove.error?.code).toBe('42501');
        const rpc = await actor.client.rpc('is_platform_admin');
        expect(rpc.error?.code).toBe('42501');
      }
      const direct = await world.platformAdmin.client
        .from('global_player_ratings')
        .update({ display_level: 7 })
        .eq('user_id', world.owner.id);
      expect(direct.error?.code).toBe('42501');
    }
  );

  it.skipIf(!environment.env)('denies anonymous callers every command', async () => {
    const anon = createClient<Database>(environment.env!.url, environment.env!.key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const attempts = [
      anon.rpc('get_level_review_access'),
      anon.rpc('submit_level_review_request', submitArgs()),
      anon.rpc('list_my_level_review_requests', {}),
      anon.rpc('get_my_level_review_request', { p_request_id: requestId }),
      anon.rpc('cancel_level_review_request', { p_request_id: requestId }),
      anon.rpc('list_level_review_queue', {}),
      anon.rpc('get_level_review_admin_detail', { p_request_id: requestId }),
      anon.rpc('mark_level_review_under_review', { p_request_id: requestId }),
      anon.rpc('resolve_level_review_request', {
        p_request_id: requestId,
        p_command_id: ID,
        p_decision: 'reject',
        p_note: 'x'
      })
    ];
    for (const result of await Promise.all(attempts)) expect(result.error?.code).toBe('42501');
    const table = await anon.from('player_level_review_requests').select('id');
    expect(table.error?.code).toBe('42501');
  });

  it.skipIf(!environment.env)(
    'restricts provisional actors from every owner and admin entry point',
    async () => {
      const { client } = world.provisional;
      const results = await Promise.all([
        client.rpc('get_level_review_access'),
        client.rpc('submit_level_review_request', submitArgs()),
        client.rpc('list_my_level_review_requests', {}),
        client.rpc('get_my_level_review_request', { p_request_id: requestId }),
        client.rpc('cancel_level_review_request', { p_request_id: requestId })
      ]);
      for (const result of results)
        expect(result.error?.message).toBe('PROVISIONAL_PLAYER_RESTRICTED');
      for (const [rpc, args] of adminCalls(requestId))
        expect(['PROVISIONAL_PLAYER_RESTRICTED', 'LEVEL_REVIEW_FORBIDDEN']).toContain(
          (await client.rpc(rpc, args)).error?.message
        );
      const table = await client.from('player_level_review_requests').select('id');
      expect(table.data ?? []).toEqual([]);
    }
  );

  it.skipIf(!environment.env)(
    'never lets a caller choose the owner, snapshot, status or actor',
    async () => {
      // Not an object literal at the call site, so the extra parameters are not type-checked away.
      const forgedArgs = {
        ...submitArgs(),
        p_owner_id: world.owner.id,
        p_snapshot_display_level: 1,
        p_status: 'approved'
      };
      const forged = await world.other.client.rpc('submit_level_review_request', forgedArgs);
      expect(forged.error).not.toBeNull();
      const resolveArgs = {
        p_request_id: requestId,
        p_command_id: crypto.randomUUID(),
        p_decision: 'reject',
        p_note: 'self',
        p_actor_id: world.owner.id
      };
      const resolve = await world.owner.client.rpc('resolve_level_review_request', resolveArgs);
      expect(resolve.error).not.toBeNull();
      expect(await levelReviewRow(requestId)).toMatchObject({ status: 'pending' });
    }
  );

  it.skipIf(!environment.env)(
    'discloses nothing about requests the caller does not own',
    async () => {
      for (const actor of [
        world.other,
        world.communityAdmin,
        world.matchCreator,
        world.platformAdmin
      ]) {
        const read = await actor.client.rpc('get_my_level_review_request', {
          p_request_id: requestId
        });
        expect(read.error?.message).toBe('LEVEL_REVIEW_NOT_FOUND');
        const cancel = await actor.client.rpc('cancel_level_review_request', {
          p_request_id: requestId
        });
        expect(cancel.error?.message).toBe('LEVEL_REVIEW_NOT_FOUND');
        const list = await actor.client.rpc('list_my_level_review_requests', {});
        expect(decodeLevelReviewList(list.data).items.map((item) => item.id)).not.toContain(
          requestId
        );
      }
      expect(await levelReviewRow(requestId)).toMatchObject({ status: 'pending' });
    }
  );
});
