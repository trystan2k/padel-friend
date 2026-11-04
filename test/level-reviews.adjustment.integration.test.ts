import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  decodeLevelReviewAdminDetail,
  decodeLevelReviewPreview
} from '../src/features/level-reviews/level-review-decoders';
import {
  parseRatingHistoryPage,
  parseRatingProgress
} from '../src/features/player/rating-contracts';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import {
  drainDueRegistrationCutoffs,
  addActiveMember,
  adjustmentCount,
  adjustmentFingerprint,
  adjustmentRowFor,
  adjustmentStates,
  approveOk,
  approveRequest,
  committedRevision,
  leagueFingerprint,
  levelReviewRow,
  ownRatingSummary,
  platformAdminPlayer,
  ratingRow,
  statisticsAlignment,
  submitExact,
  submitRequest,
  type LevelReviewActor
} from './helpers/level-review-fixtures';
import {
  confirmedGroup,
  ledgerFingerprint,
  nextTailPlayedAt,
  ratingProjectionControl,
  ratingWorld,
  toQuartet,
  type Quartet,
  type RatingWorld
} from './helpers/rating-fixtures';
import { executeTrustedSql, queryTrustedSql } from './helpers/sql-transport';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

describe('immutable ADMIN_REVIEW_ADJUSTMENT approval', { timeout: 180_000 }, () => {
  let world: RatingWorld;
  let admin: LevelReviewActor;

  beforeAll(async () => {
    if (!environment.env) return;
    world = await ratingWorld(environment.env, 'adj');
    admin = await platformAdminPlayer(world);
  });

  afterAll(async () => {
    if (environment.env) await drainDueRegistrationCutoffs();
  });

  /** A rated owner (level 4) with a confirmed game, plus the three peers of that game. */
  async function ratedOwner(label: string) {
    const players = await Promise.all(
      [4, 4.5, 5, 3.5].map((level, index) => world.player(`${label}${index}`, level))
    );
    const quartet: Quartet = toQuartet(players.map((player) => player.id));
    const group = await confirmedGroup({
      eventId: await world.newEvent(),
      players: quartet,
      playedAt: await nextTailPlayedAt(),
      submittedBy: world.admin.id,
      classification: 'team_a'
    });
    return { owner: players[0]!, players, quartet, group };
  }

  it.skipIf(!environment.env)(
    'appends exactly one immutable event with the full audit trail and changes only the future state',
    async () => {
      const { owner, quartet, group } = await ratedOwner('one');
      // A community member: the correction must reach the community skill ranks too.
      await addActiveMember(world.communityId, owner.id);
      const requestId = await submitExact(owner, 5);
      const before = await ratingRow(owner.id);
      const control = await ratingProjectionControl();
      const history = await ledgerFingerprint(quartet);
      const league = await leagueFingerprint();

      const approved = await approveOk(admin, requestId, { target: 5, note: 'Evidence checked.' });
      expect(approved.replayed).toBe(false);
      const event = approved.adjustment!;
      expect(approved.request).toMatchObject({
        status: 'approved',
        approved_level: 5,
        adjustment_id: event.id,
        decision_actor_id: admin.id,
        decision_note: 'Evidence checked.'
      });
      expect(event).toMatchObject({
        event_type: 'ADMIN_REVIEW_ADJUSTMENT',
        level_review_request_id: requestId,
        user_id: owner.id,
        actor_id: admin.id,
        reason: 'Evidence checked.',
        decided_at: approved.request.decided_at,
        projection_revision: Number(control['revision']) + 1,
        reliability_mode: 'preserve',
        reliability_target: null,
        exception_justification: null,
        before_display_level: before['display_level'],
        after_display_level: 5,
        before_reliability_percent: before['reliability'],
        after_reliability_percent: before['reliability'],
        before_confirmed_groups: 1,
        after_confirmed_groups: 1,
        before_sigma: 1,
        after_sigma: 1,
        before_highest_display_level: before['highest'],
        after_highest_display_level: Math.max(Number(before['highest']), 5),
        before_engine_version: '1.0.0',
        after_engine_version: '1.0.0'
      });
      // The boundary key is the greater of the watermark key and (decision clock, max UUID); the
      // fixture's tail match is future-dated, so it is the watermark key itself (no inflation).
      // The decision instant stays separate. (compared in the database: microsecond precision)
      const ordering = await queryTrustedSql(
        `select (a.boundary_played_at, a.boundary_group_id) >= ($2::timestamptz, $3::uuid) as not_before_watermark,
                (a.boundary_played_at, a.boundary_group_id) = ($2::timestamptz, $3::uuid) as is_watermark,
                a.boundary_played_at >= a.effective_at as after_decision, a.boundary_basis
           from public.player_rating_admin_adjustments a where a.id = $1`,
        { values: [event.id, String(control['watermark_at']), String(control['watermark_group'])] }
      );
      expect(ordering.rows[0]).toEqual({
        not_before_watermark: true,
        is_watermark: true,
        after_decision: true,
        boundary_basis: 'match_watermark'
      });

      // Materialization: level and peak moved; reliability, sigma, count, initial level and
      // last-match timestamp are preserved exactly.
      const after = await ratingRow(owner.id);
      expect(after).toMatchObject({
        mu: 5,
        display_level: 5,
        reliability: before['reliability'],
        sigma: 1,
        groups: 1,
        initial_level: 4,
        last_rating_at: before['last_rating_at'],
        highest: Math.max(Number(before['highest']), 5),
        revision: event.projection_revision
      });
      expect((await ratingProjectionControl())['revision']).toBe(event.projection_revision);
      expect((await ratingProjectionControl())['watermark_group']).toBe(group.proposalId);
      // Historical results and League standings are never replayed.
      expect(await ledgerFingerprint(quartet)).toBe(history);
      expect(await leagueFingerprint()).toBe(league);

      // Readers agree: summary, discriminated history and chart.
      const summary = await ownRatingSummary(owner);
      expect(summary.summary).toMatchObject({
        display_level: 5,
        reliability_percent: before['reliability'],
        confirmed_competitive_game_groups: 1
      });
      const page = parseRatingHistoryPage((await owner.client.rpc('get_my_rating_history')).data)!;
      expect(page.total_events).toBe(1);
      expect(page.items.map((item) => item.kind)).toEqual(['adjustment', 'match']);
      expect(page.items[0]).toMatchObject({
        kind: 'adjustment',
        adjustment_id: event.id,
        level_review_request_id: requestId,
        reason: 'Evidence checked.',
        outcome: 'approved',
        before_display_level: before['display_level'],
        after_display_level: 5,
        reliability_changed: false
      });
      expect(JSON.stringify(page.items[0])).not.toContain(admin.id);
      const progress = parseRatingProgress(
        (await owner.client.rpc('get_my_rating_progress')).data
      )!;
      expect(progress).toMatchObject({ total_events: 1, total_points: 2 });
      expect(progress.points.map((point) => point.kind)).toEqual(['match', 'adjustment']);
      expect(progress.points.at(-1)).toMatchObject({ event_id: event.id, display_level: 5 });

      // Zero statistics drift: ranks and summaries are published for the new revision.
      const alignment = await statisticsAlignment();
      expect(alignment).toMatchObject({
        statisticsRating: alignment.rating,
        rankRating: alignment.rating,
        dirty: 0
      });

      // The initialization level is now locked by the correction evidence.
      const locked = await queryTrustedSql('select public.player_has_rated_history($1) as locked', {
        values: [owner.id]
      });
      expect(locked.rows[0]?.['locked']).toBe(true);
    }
  );

  it.skipIf(!environment.env)(
    'previews the approval on the server, bound to one revision, with the resolve arithmetic',
    async () => {
      const { owner } = await ratedOwner('prev');
      const requestId = await submitExact(owner, 5);
      const preview = async (args: Record<string, unknown>) =>
        admin.client.rpc('get_level_review_adjustment_preview', {
          p_request_id: requestId,
          p_target_level: 5,
          ...args
        });

      // Preserve: the after-state carries the new level and the untouched reliability.
      const row = await ratingRow(owner.id);
      const preserved = decodeLevelReviewPreview((await preview({})).data);
      expect(preserved.revision).toBe(await committedRevision());
      expect(preserved.before).toMatchObject({
        mu: Number(row['mu']),
        display_level: Number(row['display_level']),
        reliability_percent: Number(row['reliability']),
        confirmed_groups: 1
      });
      expect(preserved.after).toMatchObject({
        mu: 5,
        display_level: 5,
        reliability_percent: Number(row['reliability']),
        engine_version: '1.0.0'
      });

      // Reduce: the exception stamps the engine and carries the explicit target.
      const reduced = decodeLevelReviewPreview(
        (await preview({ p_reliability_mode: 'reduce', p_reliability_target: 5 })).data
      );
      expect(reduced.after).toMatchObject({ reliability_percent: 5, engine_version: '1.1.0' });
      expect(reduced.revision).toBe(preserved.revision);

      // Invalid inputs are the resolve transaction's own errors.
      expect((await preview({ p_target_level: 6 })).error?.message).toBe(
        'LEVEL_REVIEW_TARGET_OUT_OF_RANGE'
      );
      expect(
        (await preview({ p_reliability_mode: 'reduce', p_reliability_target: 99 })).error?.message
      ).toBe('LEVEL_REVIEW_RELIABILITY_INVALID');
      expect(
        (
          await preview({
            p_reliability_mode: 'reduce',
            p_reliability_target: 5,
            p_target_level: 7.5
          })
        ).error?.message
      ).toBe('LEVEL_REVIEW_INVALID_ARGUMENT');
      expect(
        (
          await owner.client.rpc('get_level_review_adjustment_preview', {
            p_request_id: requestId,
            p_target_level: 5
          })
        ).error?.message
      ).toBe('LEVEL_REVIEW_FORBIDDEN');

      // A revision moved by another confirmation: the preview follows it and the old one is stale.
      await ratedOwner('prevmove');
      const moved = decodeLevelReviewPreview((await preview({})).data);
      expect(moved.revision).toBeGreaterThan(preserved.revision);
      expect(
        (await approveRequest(admin, requestId, { expectedRevision: preserved.revision })).error
          ?.message
      ).toBe('LEVEL_REVIEW_STALE_RATING');
      expect(await adjustmentRowFor(requestId)).toBeUndefined();

      // The committed event equals what the fresh preview promised, internal mu included.
      const approved = await approveOk(admin, requestId, {
        target: 5,
        expectedRevision: moved.revision
      });
      const event = approved.adjustment!;
      const stored = (
        await queryTrustedSql(
          'select before_mu::float8 as before_mu, after_mu::float8 as after_mu, after_display_level::float8 as after_level, ' +
            'after_reliability_percent::int as after_rel, after_highest_display_level::float8 as after_highest, ' +
            'after_engine_version from public.player_rating_admin_adjustments where id = $1',
          { values: [event.id] }
        )
      ).rows[0];
      expect(stored).toEqual({
        before_mu: moved.before.mu,
        after_mu: moved.after.mu,
        after_level: moved.after.display_level,
        after_rel: moved.after.reliability_percent,
        after_highest: moved.after.highest_display_level,
        after_engine_version: moved.after.engine_version
      });
      // The DTO exposes the stored internal state on both admin surfaces.
      expect(event).toMatchObject({
        before_mu: stored!['before_mu'],
        after_mu: stored!['after_mu']
      });
      const detail = decodeLevelReviewAdminDetail(
        (await admin.client.rpc('get_level_review_admin_detail', { p_request_id: requestId })).data
      );
      expect(detail.adjustment).toEqual(event);
      expect(detail.adjustment).toMatchObject({ before_mu: moved.before.mu, after_mu: 5 });
      // A resolved request has nothing left to preview.
      expect((await preview({})).error?.message).toBe('LEVEL_REVIEW_INVALID_TRANSITION');
      // Owner-facing readers never carry the internal state.
      const page = (await owner.client.rpc('get_my_rating_history')).data;
      expect(JSON.stringify(page)).not.toContain('before_mu');
      expect(JSON.stringify(page)).not.toContain('after_mu');
    }
  );

  it.skipIf(!environment.env)(
    'retries identically, rejects changed payloads and later opposite decisions',
    async () => {
      const { owner } = await ratedOwner('retry');
      const requestId = await submitExact(owner, 5);
      const commandId = crypto.randomUUID();
      const first = await approveOk(admin, requestId, {
        commandId,
        expectedRevision: await committedRevision()
      });
      const revision = await committedRevision();

      // Exact retry returns the original outcome even though the preview revision is stale now.
      const retry = await approveOk(admin, requestId, {
        commandId,
        expectedRevision: revision - 1
      });
      expect(retry.replayed).toBe(true);
      expect(retry.adjustment!.id).toBe(first.adjustment!.id);
      expect(await committedRevision()).toBe(revision);
      expect(await adjustmentCount(owner.id)).toBe(1);

      for (const changed of [
        { commandId, note: 'Another note.' },
        { commandId: crypto.randomUUID() },
        { commandId, reliability: { mode: 'reset' as const, justification: 'Changed my mind' } }
      ]) {
        const result = await approveRequest(admin, requestId, {
          expectedRevision: revision,
          ...changed
        });
        expect(result.error?.message).toBe('LEVEL_REVIEW_RESOLUTION_CONFLICT');
      }
      const reject = await admin.client.rpc('resolve_level_review_request', {
        p_request_id: requestId,
        p_command_id: crypto.randomUUID(),
        p_decision: 'reject',
        p_note: 'Too late.'
      });
      expect(reject.error?.message).toBe('LEVEL_REVIEW_RESOLUTION_CONFLICT');
      expect(await adjustmentCount(owner.id)).toBe(1);
      expect(await committedRevision()).toBe(revision);
    }
  );

  it.skipIf(!environment.env)(
    'rejects a stale preview and an out-of-range target without side effects',
    async () => {
      const { owner } = await ratedOwner('stale');
      const requestId = await submitRequest(owner, {
        p_requested_min_level: 4.5,
        p_requested_max_level: 5
      });
      const revision = await committedRevision();
      const fingerprint = await adjustmentFingerprint(owner.id);
      const stale = await approveRequest(admin, requestId, {
        target: 4.75,
        expectedRevision: revision - 1
      });
      expect(stale.error?.message).toBe('LEVEL_REVIEW_STALE_RATING');
      const outside = await approveRequest(admin, requestId, { target: 5.5 });
      expect(outside.error?.message).toBe('LEVEL_REVIEW_TARGET_OUT_OF_RANGE');
      const denied = await owner.client.rpc('resolve_level_review_request', {
        p_request_id: requestId,
        p_command_id: crypto.randomUUID(),
        p_decision: 'approve',
        p_note: 'self',
        p_target_level: 4.75,
        p_expected_revision: revision
      });
      expect(denied.error?.message).toBe('LEVEL_REVIEW_FORBIDDEN');
      expect(await levelReviewRow(requestId)).toMatchObject({
        status: 'pending',
        adjustment_id: null
      });
      expect(await adjustmentFingerprint(owner.id)).toBe(fingerprint);
      expect(await committedRevision()).toBe(revision);
      // The corrected target inside the requested range is accepted afterwards.
      expect((await approveOk(admin, requestId, { target: 4.75 })).adjustment).toMatchObject({
        after_display_level: 4.75
      });
    }
  );

  it.skipIf(!environment.env)(
    'records a zero-delta approval and corrections of a player without matches, repeatedly',
    async () => {
      const owner = await world.player('nomatch', 4);
      const initial = await ratingRow(owner.id);
      expect(initial).toMatchObject({ groups: 0, last_rating_at: null });
      const league = await leagueFingerprint();

      // Same level as today: the manual review still produces an explicit event.
      const zero = await approveOk(admin, await submitExact(owner, 4), { target: 4 });
      expect(zero.adjustment).toMatchObject({
        before_display_level: 4,
        after_display_level: 4,
        before_confirmed_groups: 0,
        after_confirmed_groups: 0
      });
      expect(await ratingRow(owner.id)).toMatchObject({ mu: 4, reliability: 10, groups: 0 });
      const locked = await queryTrustedSql('select public.player_has_rated_history($1) as locked', {
        values: [owner.id]
      });
      expect(locked.rows[0]?.['locked']).toBe(true);
      const empty = await ownRatingSummary(owner);
      expect(empty.state).toBe('empty');
      expect(empty.summary).toMatchObject({
        display_level: 4,
        confirmed_competitive_game_groups: 0
      });

      const second = await approveOk(admin, await submitExact(owner, 4.5), { target: 4.5 });
      expect(await adjustmentCount(owner.id)).toBe(2);
      // Fixed-width UTC instants: lexicographic order is chronological order (microseconds kept).
      // Checkpoints may share a key; their order is the committed revision.
      expect(second.adjustment!.boundary_played_at >= zero.adjustment!.boundary_played_at).toBe(
        true
      );
      expect(second.adjustment!.projection_revision).toBeGreaterThan(
        zero.adjustment!.projection_revision
      );
      expect(await ratingRow(owner.id)).toMatchObject({
        mu: 4.5,
        groups: 0,
        highest: 4.5,
        last_rating_at: null
      });
      expect((await ownRatingSummary(owner)).summary).toMatchObject({ display_level: 4.5 });

      const page = parseRatingHistoryPage((await owner.client.rpc('get_my_rating_history')).data)!;
      expect(page).toMatchObject({ state: 'ready', total_events: 0 });
      expect(
        page.items.map((item) => (item.kind === 'adjustment' ? item.adjustment_id : null))
      ).toEqual([second.adjustment!.id, zero.adjustment!.id]);
      expect(await leagueFingerprint()).toBe(league);
    }
  );

  it.skipIf(!environment.env)(
    'supports the 0 and 7 boundaries and never lowers the historical peak',
    async () => {
      const low = await world.player('low', 4);
      const high = await world.player('high', 4);
      const down = await approveOk(admin, await submitExact(low, 0), { target: 0 });
      expect(down.adjustment).toMatchObject({
        after_display_level: 0,
        after_highest_display_level: 4
      });
      expect(await ratingRow(low.id)).toMatchObject({ mu: 0, highest: 4 });
      const up = await approveOk(admin, await submitExact(high, 7), { target: 7 });
      expect(up.adjustment).toMatchObject({
        after_display_level: 7,
        after_highest_display_level: 7
      });
      expect(await ratingRow(high.id)).toMatchObject({ mu: 7, highest: 7 });
    }
  );

  it.skipIf(!environment.env)('rolls the whole approval back when a later step fails', async () => {
    const owner = await world.player('rollback', 4);
    const requestId = await submitExact(owner, 5);
    const revision = await committedRevision();
    const before = await ratingRow(owner.id);
    await executeTrustedSql(`
        create function public.zz_paf148_fail() returns trigger language plpgsql as $$
        begin raise exception 'PAF148_INJECTED_FAILURE'; end $$;
        create trigger zz_paf148_fail before update on public.global_player_ratings
          for each row when (new.user_id = '${owner.id}') execute function public.zz_paf148_fail();`);
    try {
      const failed = await approveRequest(admin, requestId, { target: 5 });
      expect(failed.error?.message).toBe('PAF148_INJECTED_FAILURE');
    } finally {
      await executeTrustedSql(
        'drop trigger zz_paf148_fail on public.global_player_ratings; drop function public.zz_paf148_fail()'
      );
    }
    // The event insert happened before the failing update: it must not have survived.
    expect(await adjustmentCount(owner.id)).toBe(0);
    expect(await adjustmentStates(owner.id)).toHaveLength(0);
    expect(await levelReviewRow(requestId)).toMatchObject({
      status: 'pending',
      adjustment_id: null
    });
    expect(await ratingRow(owner.id)).toEqual(before);
    expect(await committedRevision()).toBe(revision);
    // The request is still approvable once the fault is gone.
    expect((await approveOk(admin, requestId, { target: 5 })).adjustment).not.toBeNull();
  });

  it.skipIf(!environment.env)(
    'keeps the evidence insert-only: no UPDATE, DELETE, TRUNCATE or runtime access',
    async () => {
      const owner = await world.player('immutable', 4);
      const requestId = await submitExact(owner, 5);
      const event = (await approveOk(admin, requestId, { target: 5 })).adjustment!;
      const fingerprint = await adjustmentFingerprint(owner.id);
      for (const statement of [
        `update public.player_rating_admin_adjustments set reason = 'x' where id = '${event.id}'`,
        `delete from public.player_rating_admin_adjustments where id = '${event.id}'`,
        'truncate public.player_rating_admin_adjustments cascade',
        `update public.player_rating_adjustment_states set mu = 1 where adjustment_id = '${event.id}'`,
        `delete from public.player_rating_adjustment_states where adjustment_id = '${event.id}'`,
        'truncate public.player_rating_adjustment_states'
      ]) {
        await expect(executeTrustedSql(statement)).rejects.toThrow(/RATING_EVIDENCE_IMMUTABLE/);
      }
      expect(await adjustmentFingerprint(owner.id)).toBe(fingerprint);

      // No runtime role may read or write the evidence tables directly.
      for (const client of [owner.client, admin.client]) {
        const read = await client.from('player_rating_admin_adjustments').select('id');
        expect(read.error?.code).toBe('42501');
        const write = await client
          .from('player_rating_admin_adjustments')
          .update({ reason: 'x' })
          .eq('id', event.id);
        expect(write.error?.code).toBe('42501');
        expect(
          (await client.from('player_rating_adjustment_states').select('mu')).error?.code
        ).toBe('42501');
      }
      // Only the DTO RPCs expose it: the owner never sees internal states or the justification.
      const mine = JSON.stringify(
        (await owner.client.rpc('get_my_level_review_request', { p_request_id: requestId })).data
      );
      expect(mine).not.toContain(admin.id);
      expect(mine).not.toContain('exception_justification');
      // The admin audit detail carries the committed event.
      const detail = await admin.client.rpc('get_level_review_admin_detail', {
        p_request_id: requestId
      });
      expect(detail.data).toMatchObject({ adjustment: { id: event.id, actor_id: admin.id } });
    }
  );

  it.skipIf(!environment.env)(
    'refuses an adjustment that disagrees with its request at commit',
    async () => {
      const owner = await world.player('mismatch', 4);
      const requestId = await submitExact(owner, 5);
      // A direct trusted insert without the approving request update must fail at commit.
      await expect(
        executeTrustedSql(`
          insert into public.player_rating_admin_adjustments (level_review_request_id, user_id, reason, actor_id,
            decided_at, effective_at, projection_revision, boundary_played_at, boundary_group_id, boundary_basis,
            rating_engine, rating_config_version, before_engine_version, after_engine_version,
            before_mu, before_sigma, before_display_level, before_reliability_percent, before_confirmed_groups,
            before_highest_display_level, after_mu, after_sigma, after_display_level, after_reliability_percent,
            after_confirmed_groups, after_highest_display_level, reliability_mode)
          select r.id, r.owner_id, 'forged', r.owner_id, now(), now(), 999999999, now(),
            'ffffffff-ffff-ffff-ffff-ffffffffffff', 'decision_clock', 'app-wide-level', 1, '1.0.0', '1.0.0',
            4, 1, 4, 10, 0, 4, 5, 1, 5, 10, 0, 5, 'preserve'
          from public.player_level_review_requests r where r.id = '${requestId}'`)
      ).rejects.toThrow(/RATING_ADJUSTMENT_REQUEST_MISMATCH/);
      expect(await adjustmentRowFor(requestId)).toBeUndefined();
    }
  );
});
