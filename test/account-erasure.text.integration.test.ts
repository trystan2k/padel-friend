import { describe, expect, it } from 'vitest';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import {
  confirmGroup,
  eraseAccount,
  erasurePlan,
  scalar,
  survivorSnapshot,
  tablesMentioning
} from './helpers/account-erasure-fixtures';
import { fixtureSql, sqlRows } from './helpers/match-registration-sql';
import { sqlText } from './helpers/provisional-player-fixtures';
import { createRankedResultFixtures } from './helpers/ranked-result-fixtures';

const environment = localSupabaseEnv();
const L = sqlText;

/**
 * Every text column that survives erasure, minus the ones the seam redacts or deletes (the disposition
 * registry), must be justified here. A new text column fails this contract until it is classified.
 *   codes      enum-like codes, hashes, engine/version labels, fixed system templates (evidence in the note)
 *   deleted    the subject's rows are deleted by the seam (personal state); other rows hold codes only
 *   assets     text describing a place or a community asset, typed for shared use; kept on purpose
 *              (design doc 3.2/4: venue and community assets stay unless the subject appears: operator REV)
 */
const CLASSIFIED_TEXT: Record<string, { note: string; columns: Record<string, string[]> }> = {
  deleted: {
    note: 'rows of the subject are deleted (account-owned or delete_rows); remaining rows carry codes',
    columns: {
      community_request_messages: ['body'],
      community_notifications: ['kind'],
      notifications: ['category', 'event_key', 'kind', 'target_type'],
      notification_push_deliveries: ['status'],
      notification_push_jobs: ['status'],
      push_subscriptions: [
        'auth',
        'endpoint',
        'locale',
        'p256dh',
        'retired_reason',
        'vapid_key_id'
      ],
      player_profiles: [
        'avatar_url',
        'bio',
        'display_name',
        'dominant_hand',
        'preferred_side',
        'rating_input_source'
      ],
      global_player_ratings: ['rating_engine', 'rating_engine_version'],
      match_player_add_throttle_hits: ['scope']
    }
  },
  codes: {
    note: 'CHECK-constrained enum, hash, engine label or fixed template written by system code (never user text)',
    columns: {
      community_audit_log: ['action', 'entity'],
      community_invitations: ['token_hash'],
      league_events: ['action', 'system_reason'],
      league_standings_snapshots: ['basis', 'cause', 'source_fingerprint'],
      leagues: ['closed_reason', 'name', 'timezone'],
      match_event_audit_log: ['action'],
      match_event_management_commands: ['action'],
      match_event_registration_attempts: ['end_kind'],
      match_event_registration_state: ['cutoff_last_failure_sqlstate'],
      match_event_result_confirmations: ['source'],
      match_event_result_processing_state: ['last_failure_code', 'last_failure_message'],
      match_event_result_proposal_versions: ['classification'],
      match_event_result_proposals: ['status'],
      match_event_result_reviews: ['decision', 'reason_code'],
      match_events: ['currency', 'status', 'timezone'],
      match_player_add_operations: [
        'branch',
        'dispatch_state',
        'fingerprint',
        'locale',
        'outcome',
        'state'
      ],
      match_result_alert_processing_state: [
        'alert_kind',
        'last_failure_code',
        'last_failure_message',
        'roster_fingerprint',
        'terminal_outcome'
      ],
      match_result_alert_retry_fallback: ['alert_kind', 'last_failure_code'],
      match_result_alert_scan_state: ['alert_kind'],
      operational_alerts: ['alert_key', 'reference', 'severity', 'source'],
      operational_job_events: ['code', 'event', 'event_key', 'outcome', 'stage'],
      operational_push_health: ['code'],
      participant_identities: ['state'],
      player_level_review_requests: ['decision_fingerprint', 'fingerprint'],
      player_rating_adjustment_states: ['rating_engine', 'rating_engine_version'],
      player_rating_admin_adjustments: [
        'after_engine_version',
        'before_engine_version',
        'boundary_basis',
        'event_type',
        'rating_engine',
        'reliability_mode'
      ],
      player_rating_event_calculations: ['rating_engine', 'rating_engine_version'],
      player_rating_event_sources: ['reason'],
      player_rating_initializations: [
        'provenance',
        'rating_engine',
        'rating_engine_version',
        'reason'
      ],
      result_amendment_events: ['decision_source', 'event_type', 'from_lifecycle', 'to_lifecycle'],
      result_amendment_requests: ['decision_source', 'fingerprint', 'lifecycle'],
      result_dispute_resolutions: ['decision', 'fingerprint', 'resolution_kind'],
      result_repair_attempts: ['failure_code', 'stage', 'status'],
      result_repair_jobs: [
        'command_fingerprint',
        'failure_code',
        'failure_stage',
        'frozen_rating_engine',
        'frozen_rating_engine_version',
        'kind',
        'status'
      ],
      statistics_daily_buckets: ['match_type', 'scope_kind', 'subject_kind'],
      statistics_group_facts: [
        'classification',
        'confirmation_source',
        'deciding_winner',
        'first_set_winner',
        'match_type',
        'matchup_low_side',
        'source_hash',
        'straight_winner'
      ],
      statistics_league_positions: ['basis'],
      statistics_opponent_facts: ['low_side', 'match_type'],
      statistics_pair_facts: ['match_type', 'side'],
      statistics_participant_facts: ['match_type', 'side'],
      statistics_participant_lifecycle: [
        'entry_kind',
        'lifecycle_status',
        'match_type',
        'viewer_side'
      ],
      statistics_rank_dirty: ['cause'],
      statistics_rank_transitions: ['status'],
      statistics_scope_summaries: ['match_type', 'scope_kind', 'subject_kind']
    }
  },
  assets: {
    note: 'place or community-asset text typed for shared use (operator REV when the subject appears in it)',
    columns: {
      communities: ['city_label', 'logo_path', 'name'],
      community_venues: ['address', 'maps_url', 'name', 'photo_path'],
      match_events: ['maps_url', 'photo_path', 'venue_name']
    }
  }
};

describe.skipIf(!environment.env)(
  'Account erasure free-text coverage (live catalog)',
  { timeout: 300_000 },
  () => {
    it('classifies every surviving text column or redacts it in the seam', async () => {
      const catalog = await sqlRows(
        'select c.relname::text as t, a.attname::text as c from pg_attribute a join pg_class c on c.oid = a.attrelid ' +
          "where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped " +
          "and a.atttypid in ('text'::regtype, 'varchar'::regtype, 'bpchar'::regtype) order by 1, 2"
      );
      const registered = new Set(
        (
          await sqlRows(
            'select table_name::text as t, column_name::text as c from privacy_internal.erasure_dispositions'
          )
        ).map((row) => String(row['t']) + '.' + String(row['c']))
      );
      const justified = new Set<string>();
      for (const group of Object.values(CLASSIFIED_TEXT))
        for (const [table, columns] of Object.entries(group.columns))
          for (const column of columns) justified.add(table + '.' + column);
      const present = new Set(catalog.map((row) => String(row['t']) + '.' + String(row['c'])));
      const unclassified = [...present].filter(
        (key) => !registered.has(key) && !justified.has(key)
      );
      const stale = [...justified].filter((key) => !present.has(key));
      expect({ unclassified, stale }).toEqual({ unclassified: [], stale: [] });
    });

    it('redacts a subject-authored canary in every seedable retained text location', async () => {
      const kit = await createRankedResultFixtures(environment.env!);
      const subject = kit.players[0]!.id;
      const other = kit.players[1]!.id;
      const leagueId = await kit.league();
      const eventId = await kit.event(leagueId);
      await confirmGroup(kit, eventId, 1);
      const community = kit.communityId;

      await fixtureSql(
        'do $seed$ begin insert into privacy_internal.erasure_windows(txid) values (pg_catalog.txid_current()); ' +
          "update public.match_events set notes = 'CANARY_notes', court_notes = 'CANARY_court_notes', payment_note = 'CANARY_payment' where created_by = " +
          L(subject) +
          '; ' +
          "update public.communities set description = 'CANARY_community_description' where id = " +
          L(community) +
          '; ' +
          "update public.leagues set description = 'CANARY_league_description', create_input = jsonb_build_object('name', 'CANARY_create_name', 'description', 'CANARY_create_description', 'keep', 1) where id = " +
          L(leagueId) +
          '; ' +
          "update public.match_event_result_proposal_versions set court_label = 'CANARY_court_label' where submitted_by = " +
          L(subject) +
          '; ' +
          'insert into public.match_event_audit_log (match_event_id, community_id, actor_id, target_user_id, action, reason, request_id, transition_revision, before_data, after_data, changed_fields) values (' +
          L(eventId) +
          ', ' +
          L(community) +
          ', ' +
          L(subject) +
          ', ' +
          L(subject) +
          ", 'cancel', 'CANARY_audit_reason', gen_random_uuid(), 99, jsonb_build_object('reason', 'CANARY_audit_before', 'keep', 'x'), jsonb_build_object('note', 'CANARY_audit_after'), array['status']); " +
          'insert into public.match_event_audit_log (match_event_id, community_id, actor_id, action, reason, request_id, transition_revision, before_data, after_data, changed_fields) values (' +
          L(eventId) +
          ', ' +
          L(community) +
          ', ' +
          L(other) +
          ", 'cancel', 'CANARY_OTHER_reason', gen_random_uuid(), 100, '{}'::jsonb, '{}'::jsonb, array['status']); " +
          'insert into public.match_event_management_commands values (' +
          L(eventId) +
          ', ' +
          L(subject) +
          ", gen_random_uuid(), 'withdraw', jsonb_build_object('reason', 'CANARY_command_reason', 'attempt_id', gen_random_uuid()), '{}'::jsonb, now()); " +
          'insert into public.community_audit_log (community_id, actor_user_id, action, entity, entity_id, details) select community_id, ' +
          L(subject) +
          ", action, entity, entity_id, jsonb_build_object('note', 'CANARY_community_audit') from public.community_audit_log where community_id = " +
          L(community) +
          ' limit 1; ' +
          'delete from privacy_internal.erasure_windows where txid = pg_catalog.txid_current(); end $seed$;'
      );
      const seeded = await tablesMentioning('CANARY_');
      expect(seeded).toEqual(
        expect.arrayContaining([
          'communities',
          'community_audit_log',
          'leagues',
          'match_event_audit_log',
          'match_event_management_commands',
          'match_event_result_proposal_versions',
          'match_events'
        ])
      );
      expect(await tablesMentioning('CANARY_OTHER')).toEqual(['match_event_audit_log']);

      const plan = await erasurePlan(subject);
      for (const disposition of ['text_redact', 'jsonb_strip_text'])
        expect({ disposition, rows: Number(plan.impact[disposition]) > 0 }).toEqual({
          disposition,
          rows: true
        });
      const survivors = kit.players.slice(1).map((player) => player.id);
      const before = await survivorSnapshot(survivors, community, [eventId]);

      await eraseAccount(subject);

      // Nothing the subject authored survives; text authored by another player does.
      expect(
        (await tablesMentioning('CANARY_')).filter((table) => table !== 'match_event_audit_log')
      ).toEqual([]);
      expect(await tablesMentioning('CANARY_OTHER')).toEqual(['match_event_audit_log']);
      expect(
        await scalar(
          "select count(*)::int from public.match_event_audit_log where reason like 'CANARY_audit%'"
        )
      ).toBe(0);
      expect(await survivorSnapshot(survivors, community, [eventId])).toEqual(before);
      // Structured evidence keeps its non-text keys.
      expect(
        await scalar(
          "select count(*)::int from public.match_event_audit_log where before_data ? 'keep' and not (before_data ? 'reason')"
        )
      ).toBeGreaterThan(0);
      expect(
        await scalar(
          'select count(*)::int from public.leagues where id = ' +
            L(leagueId) +
            " and create_input ? 'keep' and not (create_input ? 'name')"
        )
      ).toBe(1);
      expect(await tablesMentioning(subject)).toEqual([]);
    });
  }
);
