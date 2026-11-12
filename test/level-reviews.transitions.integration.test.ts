import { beforeAll, describe, expect, it } from 'vitest';
import {
  levelReviewRow,
  levelReviewWorld,
  ratingFingerprint,
  submitArgs,
  submitRequest,
  type LevelReviewActor,
  type LevelReviewWorld
} from './helpers/level-review-fixtures';
import {
  decodeLevelReviewAdminCommand,
  decodeLevelReviewResolution,
  decodeLevelReviewCommand,
  decodeLevelReviewDetail,
  decodeLevelReviewList,
  decodeLevelReviewQueue
} from '../src/features/level-reviews/level-review-decoders';
import type { LevelReviewCursor } from '../src/features/level-reviews/level-review-contracts';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import { signUpFixtureActor } from './helpers/provisional-player-fixtures';
import { openDedicatedSqlConnection, queryTrustedSql } from './helpers/sql-transport';

const environment = localSupabaseEnv();

describe('level review transitions', { timeout: 300_000 }, () => {
  let world: LevelReviewWorld;
  const submit = (actor: LevelReviewActor, overrides = {}) =>
    actor.client.rpc('submit_level_review_request', submitArgs(overrides));
  const cancel = (actor: LevelReviewActor, id: string) =>
    actor.client.rpc('cancel_level_review_request', { p_request_id: id });
  const mark = (id: string) =>
    world.platformAdmin.client.rpc('mark_level_review_under_review', { p_request_id: id });
  const resolve = (id: string, overrides: Record<string, unknown> = {}) =>
    world.platformAdmin.client.rpc('resolve_level_review_request', {
      p_request_id: id,
      p_command_id: crypto.randomUUID(),
      p_decision: 'reject',
      p_note: 'Not enough evidence.',
      ...overrides
    });
  const fresh = (label: string) =>
    signUpFixtureActor(environment.env!, `lrtr-${label}`, {
      displayName: `Player ${label}`,
      level: 4
    });
  const revision = async () =>
    Number(
      (
        await queryTrustedSql(
          'select committed_revision from public.player_rating_projection_control'
        )
      ).rows[0]?.['committed_revision']
    );

  beforeAll(async () => {
    if (environment.env) world = await levelReviewWorld(environment.env, 'lrtr');
  });

  it.skipIf(!environment.env)(
    'submits with a database-captured snapshot and returns the safe owner view',
    async () => {
      const actor = await fresh('snap');
      const result = await submit(actor, {
        p_requested_min_level: 4.25,
        p_requested_max_level: 4.25,
        p_evidence: '  https://example.test/video  '
      });
      expect(result.error).toBeNull();
      const { request, replayed } = decodeLevelReviewCommand(result.data);
      expect(replayed).toBe(false);
      expect(request).toMatchObject({
        status: 'pending',
        snapshot_display_level: 4,
        snapshot_reliability_percent: 10,
        requested_min_level: 4.25,
        requested_max_level: 4.25,
        evidence: 'https://example.test/video',
        decision_note: null,
        approved_level: null,
        adjustment_id: null
      });
      expect(request).not.toHaveProperty('owner_id');
      expect(request).not.toHaveProperty('decision_actor_id');
      const row = await levelReviewRow(request.id);
      expect(row).toMatchObject({ owner_id: actor.id });
      expect(Number(row['snapshot_rating_revision'])).toBe(await revision());
      const detail = await actor.client.rpc('get_my_level_review_request', {
        p_request_id: request.id
      });
      expect(decodeLevelReviewDetail(detail.data).request.id).toBe(request.id);
    }
  );

  it.skipIf(!environment.env)(
    'validates the requested range, precision and text bounds in the database',
    async () => {
      const actor = await fresh('bounds');
      const cases: Record<string, unknown>[] = [
        { p_requested_min_level: 5, p_requested_max_level: 4 },
        { p_requested_min_level: -0.01 },
        { p_requested_max_level: 7.01 },
        { p_requested_min_level: 4.555, p_requested_max_level: 5 },
        { p_requested_max_level: 5.001 },
        { p_reason: '' },
        { p_reason: '   ' },
        { p_reason: 'r'.repeat(2001) },
        { p_evidence: 'e'.repeat(4001) }
      ];
      for (const overrides of cases) {
        const result = await submit(actor, overrides);
        expect({ overrides, message: result.error?.message }).toEqual({
          overrides,
          message: 'LEVEL_REVIEW_INVALID_ARGUMENT'
        });
      }
      const edges = await submit(actor, {
        p_requested_min_level: 0,
        p_requested_max_level: 7,
        p_reason: '😀'.repeat(2000),
        p_evidence: 'e'.repeat(4000)
      });
      expect(edges.error).toBeNull();
    }
  );

  it.skipIf(!environment.env)('rejects a caller without a rating', async () => {
    const noProfile = await signUpFixtureActor(environment.env!, 'lrtr-norating');
    expect((await submit(noProfile)).error?.message).toBe('LEVEL_REVIEW_RATING_UNAVAILABLE');
  });

  it.skipIf(!environment.env)(
    'replays an identical command, conflicts on a changed payload, and rejects a second active request',
    async () => {
      const actor = await fresh('idem');
      const args = submitArgs();
      const first = await actor.client.rpc('submit_level_review_request', args);
      const replay = await actor.client.rpc('submit_level_review_request', args);
      expect(replay.error).toBeNull();
      expect(decodeLevelReviewCommand(replay.data).replayed).toBe(true);
      expect(decodeLevelReviewCommand(replay.data).request.id).toBe(
        decodeLevelReviewCommand(first.data).request.id
      );
      const changed = await actor.client.rpc('submit_level_review_request', {
        ...args,
        p_reason: 'A different reason'
      });
      expect(changed.error?.message).toBe('LEVEL_REVIEW_IDEMPOTENCY_CONFLICT');
      const duplicate = await submit(actor);
      expect(duplicate.error?.message).toBe('LEVEL_REVIEW_DUPLICATE_ACTIVE');
    }
  );

  it.skipIf(!environment.env)('lets exactly one of two concurrent submissions win', async () => {
    const actor = await fresh('race');
    const results = await Promise.all([submit(actor), submit(actor), submit(actor)]);
    const wins = results.filter((result) => !result.error);
    expect(wins).toHaveLength(1);
    for (const loser of results.filter((result) => result.error))
      expect(loser.error?.message).toBe('LEVEL_REVIEW_DUPLICATE_ACTIVE');
    const rows = await queryTrustedSql(
      'select count(*)::int as n from public.player_level_review_requests where owner_id = $1',
      { values: [actor.id] }
    );
    expect(rows.rows[0]?.['n']).toBe(1);
  });

  it.skipIf(!environment.env)(
    'serializes a submission behind the owner lock held by an in-flight transaction',
    async () => {
      const actor = await fresh('lock');
      const holder = await openDedicatedSqlConnection();
      try {
        await holder.query('begin');
        await holder.query(
          `select set_config('request.jwt.claims', '{"sub":"${actor.id}","role":"authenticated"}', true)`
        );
        await holder.query('set local role authenticated');
        const held = await holder.query(
          'select public.submit_level_review_request($1, 4.5, 5, $2, null)',
          { values: [crypto.randomUUID(), 'holder'] }
        );
        expect(held.rows).toHaveLength(1);

        // Supabase builders are lazy: `.then` starts the request now.
        const contender = submit(actor).then((result) => result);
        let waiting = false;
        for (let attempt = 0; attempt < 400 && !waiting; attempt++) {
          const probe = await queryTrustedSql(
            `select 1 from pg_locks where locktype = 'advisory' and not granted`
          );
          waiting = probe.rows.length > 0;
          if (!waiting) await new Promise((done) => setTimeout(done, 25));
        }
        expect(waiting, 'contender must block on the owner advisory lock').toBe(true);
        await holder.query('commit');
        expect((await contender).error?.message).toBe('LEVEL_REVIEW_DUPLICATE_ACTIVE');
      } finally {
        await holder.query('rollback').catch(() => undefined);
        await holder.close();
      }
    }
  );

  it.skipIf(!environment.env)(
    'throttles to three new requests per rolling day, counting canceled ones but not replays',
    async () => {
      const actor = await fresh('rate');
      const commands: string[] = [];
      for (let index = 0; index < 3; index++) {
        const command = crypto.randomUUID();
        commands.push(command);
        const created = await submit(actor, { p_command_id: command });
        expect(created.error).toBeNull();
        const id = decodeLevelReviewCommand(created.data).request.id;
        expect((await cancel(actor, id)).error).toBeNull();
      }
      const blocked = await submit(actor);
      expect(blocked.error?.message).toBe('LEVEL_REVIEW_RATE_LIMITED');
      // An idempotent retry of an accepted command is not another attempt.
      const replay = await submit(actor, { p_command_id: commands[0] });
      expect(replay.error).toBeNull();
      expect(decodeLevelReviewCommand(replay.data).replayed).toBe(true);
    }
  );

  it.skipIf(!environment.env)(
    'follows pending -> under_review -> rejected and never reopens',
    async () => {
      const actor = await fresh('flow');
      const id = await submitRequest(actor);

      const marked = await mark(id);
      expect(marked.error).toBeNull();
      expect(marked.data).toMatchObject({
        replayed: false,
        request: { status: 'under_review', under_review_by: world.platformAdmin.id }
      });
      expect(decodeLevelReviewAdminCommand((await mark(id)).data).replayed).toBe(true);
      // Active uniqueness covers under_review.
      expect((await submit(actor)).error?.message).toBe('LEVEL_REVIEW_DUPLICATE_ACTIVE');

      const command = crypto.randomUUID();
      const rejected = await resolve(id, { p_command_id: command, p_note: '  Needs match proof ' });
      expect(rejected.error).toBeNull();
      expect(rejected.data).toMatchObject({
        replayed: false,
        request: {
          status: 'rejected',
          decision_note: 'Needs match proof',
          decision_actor_id: world.platformAdmin.id,
          approved_level: null,
          adjustment_id: null
        }
      });
      const retry = await resolve(id, { p_command_id: command, p_note: 'Needs match proof' });
      expect(decodeLevelReviewResolution(retry.data).replayed).toBe(true);

      expect((await resolve(id, { p_note: 'Needs match proof' })).error?.message).toBe(
        'LEVEL_REVIEW_RESOLUTION_CONFLICT'
      );
      expect((await resolve(id, { p_command_id: command, p_note: 'Changed' })).error?.message).toBe(
        'LEVEL_REVIEW_RESOLUTION_CONFLICT'
      );
      expect(
        (
          await resolve(id, {
            p_command_id: command,
            p_decision: 'approve',
            p_target_level: 4.5,
            p_expected_revision: await revision()
          })
        ).error?.message
      ).toBe('LEVEL_REVIEW_RESOLUTION_CONFLICT');
      expect((await cancel(actor, id)).error?.message).toBe('LEVEL_REVIEW_INVALID_TRANSITION');
      expect((await mark(id)).error?.message).toBe('LEVEL_REVIEW_INVALID_TRANSITION');
      expect(await levelReviewRow(id)).toMatchObject({ status: 'rejected' });

      // The owner may file a fresh request afterwards.
      expect((await submit(actor)).error).toBeNull();
    }
  );

  it.skipIf(!environment.env)(
    'resolves a pending request directly and shows the owner the decision note',
    async () => {
      const actor = await fresh('direct');
      const id = await submitRequest(actor);
      expect((await resolve(id, { p_note: 'Declined.' })).error).toBeNull();
      const view = await actor.client.rpc('get_my_level_review_request', { p_request_id: id });
      expect(view.data).toMatchObject({
        request: { status: 'rejected', decision_note: 'Declined.' }
      });
      expect(JSON.stringify(view.data)).not.toContain(world.platformAdmin.id);
    }
  );

  it.skipIf(!environment.env)('lets the owner cancel from either active state, once', async () => {
    const pending = await fresh('cancelp');
    const pendingId = await submitRequest(pending);
    const first = await cancel(pending, pendingId);
    expect(first.data).toMatchObject({ replayed: false, request: { status: 'canceled' } });
    expect(decodeLevelReviewCommand((await cancel(pending, pendingId)).data).replayed).toBe(true);

    const reviewed = await fresh('cancelu');
    const reviewedId = await submitRequest(reviewed);
    expect((await mark(reviewedId)).error).toBeNull();
    expect((await cancel(reviewed, reviewedId)).data).toMatchObject({
      request: { status: 'canceled' }
    });
    expect((await resolve(reviewedId)).error?.message).toBe('LEVEL_REVIEW_INVALID_TRANSITION');
    expect((await mark(reviewedId)).error?.message).toBe('LEVEL_REVIEW_INVALID_TRANSITION');
    // Canceling frees the active slot.
    expect((await submit(reviewed)).error).toBeNull();
  });

  it.skipIf(!environment.env)(
    'validates the decision input: nonempty note, bounded fields, reject carries no target',
    async () => {
      const actor = await fresh('dec');
      const id = await submitRequest(actor);
      const invalid: Record<string, unknown>[] = [
        { p_note: '   ' },
        { p_note: 'n'.repeat(2001) },
        { p_decision: 'reopen' },
        { p_target_level: 4.5 },
        { p_expected_revision: 1 },
        { p_decision: 'approve' },
        { p_decision: 'approve', p_target_level: 4.555, p_expected_revision: 1 },
        { p_decision: 'approve', p_target_level: 4.5 }
      ];
      for (const overrides of invalid)
        expect({ overrides, message: (await resolve(id, overrides)).error?.message }).toEqual({
          overrides,
          message: 'LEVEL_REVIEW_INVALID_ARGUMENT'
        });
      expect((await resolve(randomId())).error?.message).toBe('LEVEL_REVIEW_NOT_FOUND');
      expect(await levelReviewRow(id)).toMatchObject({ status: 'pending' });
    }
  );

  it.skipIf(!environment.env)(
    'validates target and revision with no side effects, then approves atomically',
    async () => {
      const actor = await fresh('approve');
      const id = await submitRequest(actor, {
        p_requested_min_level: 4.5,
        p_requested_max_level: 5
      });
      const before = await ratingFingerprint(actor.id);
      const current = await revision();
      const approve = (overrides: Record<string, unknown>) =>
        resolve(id, {
          p_decision: 'approve',
          p_note: 'Approved.',
          p_target_level: 4.75,
          p_expected_revision: current,
          ...overrides
        });

      expect((await approve({ p_target_level: 5.5 })).error?.message).toBe(
        'LEVEL_REVIEW_TARGET_OUT_OF_RANGE'
      );
      expect((await approve({ p_target_level: 4.49 })).error?.message).toBe(
        'LEVEL_REVIEW_TARGET_OUT_OF_RANGE'
      );
      expect((await approve({ p_expected_revision: current + 1 })).error?.message).toBe(
        'LEVEL_REVIEW_STALE_RATING'
      );
      expect(await levelReviewRow(id)).toMatchObject({
        status: 'pending',
        approved_level: null,
        adjustment_id: null,
        decision_actor_id: null,
        decided_at: null
      });
      expect(await ratingFingerprint(actor.id)).toBe(before);

      // The validated approval is applied together with its immutable adjustment.
      const approved = await approve({ p_target_level: 4.75 });
      expect(approved.error).toBeNull();
      expect(await levelReviewRow(id)).toMatchObject({
        status: 'approved',
        approved_level: '4.75'
      });
      expect(await ratingFingerprint(actor.id)).not.toBe(before);

      // A non-admin cannot reach the branch at all.
      const denied = await actor.client.rpc('resolve_level_review_request', {
        p_request_id: id,
        p_command_id: crypto.randomUUID(),
        p_decision: 'approve',
        p_note: 'self',
        p_target_level: 5,
        p_expected_revision: current
      });
      expect(denied.error?.message).toBe('LEVEL_REVIEW_FORBIDDEN');
    }
  );

  it.skipIf(!environment.env)(
    'pages the owner history newest first with a keyset cursor',
    async () => {
      const actor = await fresh('hist');
      const ids: string[] = [];
      for (let index = 0; index < 3; index++) {
        const id = await submitRequest(actor);
        ids.push(id);
        await cancel(actor, id);
      }
      const first = decodeLevelReviewList(
        (await actor.client.rpc('list_my_level_review_requests', { p_limit: 2 })).data
      );
      expect(first.items.map((item) => item.id)).toEqual([ids[2], ids[1]]);
      expect(first.next_cursor).not.toBeNull();
      const second = decodeLevelReviewList(
        (
          await actor.client.rpc('list_my_level_review_requests', {
            p_limit: 2,
            p_after_created_at: first.next_cursor!.created_at,
            p_after_id: first.next_cursor!.id
          })
        ).data
      );
      expect(second.items.map((item) => item.id)).toEqual([ids[0]]);
      expect(second.next_cursor).toBeNull();
      for (const bad of [
        { p_limit: 0 },
        { p_limit: 51 },
        { p_after_id: ids[0] },
        { p_after_created_at: first.items[0]!.created_at }
      ])
        expect((await actor.client.rpc('list_my_level_review_requests', bad)).error?.message).toBe(
          'LEVEL_REVIEW_INVALID_ARGUMENT'
        );
    }
  );

  it.skipIf(!environment.env)(
    'pages the admin queue oldest first, filters by an allowlisted status, and counts',
    async () => {
      const a = await fresh('qa');
      const b = await fresh('qb');
      const idA = await submitRequest(a);
      const idB = await submitRequest(b);
      await mark(idB);
      const queue = (limit: number, extra: Record<string, unknown> = {}) =>
        world.platformAdmin.client.rpc('list_level_review_queue', { p_limit: limit, ...extra });

      const seen: string[] = [];
      let cursor: LevelReviewCursor | null = null;
      let page = 0;
      do {
        const result = await queue(
          1,
          cursor ? { p_after_created_at: cursor.created_at, p_after_id: cursor.id } : {}
        );
        expect(result.error).toBeNull();
        const data = decodeLevelReviewQueue(result.data);
        expect(data.items.length).toBeLessThanOrEqual(1);
        seen.push(...data.items.map((item) => item.id));
        cursor = data.next_cursor;
        page += 1;
      } while (cursor && page < 500);
      expect(new Set(seen).size).toBe(seen.length);
      expect(seen.indexOf(idA)).toBeGreaterThanOrEqual(0);
      expect(seen.indexOf(idA)).toBeLessThan(seen.indexOf(idB));

      const pending = decodeLevelReviewQueue((await queue(50, { p_status: 'pending' })).data);
      expect(pending.items.every((item) => item.status === 'pending')).toBe(true);
      expect(pending.pending_count).toBeGreaterThanOrEqual(1);
      const reviewed = decodeLevelReviewQueue((await queue(50, { p_status: 'under_review' })).data);
      expect(reviewed.items.map((item) => item.id)).toContain(idB);
      expect(reviewed.under_review_count).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(reviewed.items[0])).not.toContain('reason');

      for (const bad of [
        { p_status: 'all' },
        { p_status: 'PENDING' },
        { p_limit: 51 },
        { p_limit: 0 }
      ])
        expect((await queue(20, bad)).error?.message).toBe('LEVEL_REVIEW_INVALID_ARGUMENT');
    }
  );

  it.skipIf(!environment.env)(
    'shows the admin the submission snapshot next to fresh rating state and hides unknown ids',
    async () => {
      const actor = await fresh('detail');
      const id = await submitRequest(actor);
      const detail = await world.platformAdmin.client.rpc('get_level_review_admin_detail', {
        p_request_id: id
      });
      expect(detail.data).toMatchObject({
        request: { snapshot_display_level: 4, owner_display_name: 'Player detail' },
        current: { display_level: 4 },
        rating_changed: false
      });
      expect(
        (
          await world.platformAdmin.client.rpc('get_level_review_admin_detail', {
            p_request_id: randomId()
          })
        ).error?.message
      ).toBe('LEVEL_REVIEW_NOT_FOUND');
    }
  );
});

function randomId(): string {
  return crypto.randomUUID();
}
