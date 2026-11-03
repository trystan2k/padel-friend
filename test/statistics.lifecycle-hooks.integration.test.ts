import { describe, expect, it } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, fixtureSql, sqlRows } from './helpers/match-registration-sql';
import { sqlText } from './helpers/provisional-player-fixtures';
import { createRankedResultFixtures, playedAt } from './helpers/ranked-result-fixtures';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

describe.skipIf(!environment.env)('lifecycle projection maintenance', { timeout: 300_000 }, () => {
  it('tracks submission, dispute, correction, confirmation and rebuild', async () => {
    const kit = await createRankedResultFixtures(environment.env!);
    try {
      const event = await kit.event();
      const actor = kit.players[0]!;
      const query = async () =>
        await sqlRows(
          `select lifecycle_status, stable_id::text from public.statistics_participant_lifecycle where event_id = ${sqlText(event)} and user_id = ${sqlText(actor.id)} order by stable_id`
        );
      expect((await query()).map((row) => row['lifecycle_status'])).toEqual(['awaiting_result']);
      const submitted = await kit.submit(event, playedAt(600).played);
      expect(submitted.error).toBeNull();
      const proposal = String(asRecord(submitted.data)['proposal_id']);
      expect(await query()).toMatchObject([{ lifecycle_status: 'pending', stable_id: proposal }]);
      const rejected = await kit.rpc(kit.players[2]!, 'review_match_event_result', {
        p_proposal_id: proposal,
        p_expected_version: 1,
        p_decision: 'reject',
        p_reason_code: 'SCORE_INCORRECT',
        p_reason_note: 'wrong score',
        p_request_id: crypto.randomUUID()
      });
      expect(rejected.error).toBeNull();
      expect(await query()).toMatchObject([{ lifecycle_status: 'disputed', stable_id: proposal }]);
      const corrected = await kit.correct(proposal, 1, playedAt(500).played);
      expect(corrected.error).toBeNull();
      expect(await query()).toMatchObject([{ lifecycle_status: 'pending', stable_id: proposal }]);
      const approved = await kit.approve(proposal, 2);
      expect(approved.error).toBeNull();
      expect(await query()).toEqual([]);
      const later = await kit.event(null, 'competitive', false);
      await fixtureSql(
        `alter table public.match_events disable trigger match_event_immutable; update public.match_events set registration_cutoff_at = now() + interval '5 minutes' where id = ${sqlText(later)}; alter table public.match_events enable trigger match_event_immutable;`
      );
      const member = kit.players[1]!;
      const [registration] = await sqlRows(
        `select current_attempt_id::text as attempt from public.match_event_registrations where match_event_id = ${sqlText(later)} and user_id = ${sqlText(member.id)}`
      );
      const withdrawn = await kit.rpc(member, 'withdraw_match_registration', {
        p_match_event_id: later,
        p_attempt_id: String(registration?.['attempt']),
        p_request_id: crypto.randomUUID()
      });
      expect(withdrawn.error).toBeNull();
      expect(
        await sqlRows(
          `select stable_id from public.statistics_participant_lifecycle where event_id = ${sqlText(later)} and user_id = ${sqlText(member.id)}`
        )
      ).toEqual([]);
      const [eventRow] = await sqlRows(
        `select version from public.match_events where id = ${sqlText(later)}`
      );
      const canceled = await kit.rpc(actor, 'cancel_match_event', {
        p_match_event_id: later,
        p_reason: 'Court unavailable',
        p_expected_version: Number(eventRow?.['version']),
        p_request_id: crypto.randomUUID()
      });
      expect(canceled.error).toBeNull();
      expect(
        await sqlRows(
          `select lifecycle_status from public.statistics_participant_lifecycle where event_id = ${sqlText(later)} and user_id = ${sqlText(actor.id)}`
        )
      ).toEqual([{ lifecycle_status: 'canceled' }]);
      const snapshot = async () =>
        await sqlRows(
          `select user_id::text, stable_id::text, sort_at::text, event_id::text, community_id::text, lifecycle_status, entry_kind from public.statistics_participant_lifecycle where community_id = ${sqlText(kit.communityId)} order by user_id, stable_id`
        );
      const before = await snapshot();
      await fixtureSql(`select public.rebuild_statistics(${sqlText(kit.communityId)}::uuid)`);
      expect(await snapshot()).toEqual(before);
    } finally {
      const players = kit.players.map((p) => sqlText(p.id)).join(',');
      await fixtureSql(
        `delete from public.statistics_scope_summaries where subject_players && array[${players}]::uuid[] or subject_a = ${sqlText(kit.communityId)}; delete from public.statistics_daily_buckets where subject_players && array[${players}]::uuid[] or subject_a = ${sqlText(kit.communityId)};`
      );
      await kit.cleanup();
    }
  });
});
