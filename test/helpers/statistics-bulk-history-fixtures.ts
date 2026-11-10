import { matchPhotoPath } from './match-photo-fixtures';
import { sqlRows } from './match-registration-sql';
import { sqlText } from './provisional-player-fixtures';
import { rankedSets, type RankedResultKit } from './ranked-result-fixtures';
import { queryTrustedSql, type SqlQueryOptions } from './sql-transport';

/** What the bulk path needs from a ranked kit: its community, actors and group-one teams. */
export type BulkHistoryKit = Pick<
  RankedResultKit,
  'communityId' | 'creator' | 'players' | 'teamsOf'
>;

export type BulkConfirmedGroup = {
  eventType: 'competitive' | 'friendly';
  /** ISO instant the group was played (UTC, whole seconds). */
  playedAtIso: string;
};

export type BulkConfirmedGroupIds = { eventId: string; proposalId: string; confirmationId: string };

/**
 * Inserts already-confirmed group-one results for a kit in ONE atomic statement, without bypassing
 * any guard: every trigger and deferred constraint stays enabled and checks the rows at commit.
 * The rows follow the real lifecycle order (pending proposal, version, opposing-team approval,
 * manual confirmation, confirmed pointer, official pointer), so the confirmation guard's own
 * approval-coverage rule is satisfied rather than skipped.
 *
 * Rows live in kit.communityId, which the kit registered with its cleanup registry at creation;
 * kit cleanup discovers events by community and removes their proposal/version/review/confirmation/
 * official-pointer/photo rows, so nothing needs registering per group and a failed (rolled-back)
 * insert leaves nothing behind. Rating-ledger, League and audit-log rows are NOT created: the
 * statistics readers' official evidence (confirmation + version + event) is complete without them,
 * and rating-derived statistics columns stay empty.
 */
export async function insertBulkConfirmedGroups(
  kit: BulkHistoryKit,
  groups: readonly BulkConfirmedGroup[],
  options: SqlQueryOptions = {}
): Promise<BulkConfirmedGroupIds[]> {
  if (groups.length === 0) return [];
  const ids = groups.map(() => ({
    eventId: crypto.randomUUID(),
    proposalId: crypto.randomUUID(),
    confirmationId: crypto.randomUUID()
  }));
  const rows = groups.map((group, index) => ({
    event_id: ids[index]!.eventId,
    proposal_id: ids[index]!.proposalId,
    confirmation_id: ids[index]!.confirmationId,
    request_id: crypto.randomUUID(),
    event_type: group.eventType,
    played_at: group.playedAtIso,
    photo_path: matchPhotoPath(kit.communityId, ids[index]!.eventId, kit.creator.id)
  }));
  const submitter = sqlText(kit.players[0]!.id);
  const approver = sqlText(kit.players[2]!.id);
  const community = sqlText(kit.communityId);
  const creator = sqlText(kit.creator.id);
  await queryTrustedSql(
    `do $paf$
    declare
      v_rows jsonb := ${sqlText(JSON.stringify(rows))}::jsonb;
      v_now timestamptz := clock_timestamp();
      v_confirmed_at timestamptz;
      v_inserted bigint;
    begin
      insert into storage.objects (bucket_id, name, owner_id, metadata)
        select 'match-event-photos', r.photo_path, ${creator}, '{"size":"1024","mimetype":"image/webp"}'::jsonb
          from jsonb_to_recordset(v_rows) as r(photo_path text);
      insert into public.match_events (id, community_id, created_by, starts_at, timezone, event_type,
          visibility, team_assignment_mode, venue_name, maps_url, photo_path, registration_cutoff_at)
        select r.event_id, ${community}::uuid, ${creator}::uuid, now() + interval '10 days', 'UTC',
            r.event_type::public.match_event_type, 'community_open', 'POST_MATCH_TEAMS', 'Invitation court',
            'https://maps.google.com/maps/place/invitation', r.photo_path, now() - interval '1 minute'
          from jsonb_to_recordset(v_rows) as r(event_id uuid, event_type text, photo_path text);
      insert into public.match_event_result_proposals (id, match_event_id, group_number, status,
          active_version, review_deadline_at, submitted_by, submitted_at)
        select r.proposal_id, r.event_id, 1, 'pending', 1, v_now + interval '48 hours',
            ${submitter}::uuid, v_now
          from jsonb_to_recordset(v_rows) as r(proposal_id uuid, event_id uuid);
      insert into public.match_event_result_proposal_versions (proposal_id, version, teams, sets,
          classification, played_at_utc, played_at_local, played_at_offset_seconds, court_label,
          submitted_by, submitted_at, review_deadline_at)
        select r.proposal_id, 1, ${sqlText(JSON.stringify(kit.teamsOf(1)))}::jsonb,
            ${sqlText(JSON.stringify(rankedSets))}::jsonb, 'team_a', r.played_at::timestamptz,
            r.played_at::timestamptz at time zone 'UTC', 0, 'Court 1', ${submitter}::uuid,
            v_now, v_now + interval '48 hours'
          from jsonb_to_recordset(v_rows) as r(proposal_id uuid, played_at text);
      insert into public.match_event_result_reviews (proposal_id, proposal_version, reviewer_user_id,
          decision, request_id)
        select r.proposal_id, 1, ${approver}::uuid, 'approve', r.request_id
          from jsonb_to_recordset(v_rows) as r(proposal_id uuid, request_id uuid);
      v_confirmed_at := clock_timestamp();
      insert into public.match_event_result_confirmations (id, proposal_id, proposal_version,
          match_event_id, group_number, source, confirmed_at, effective_at, actor_id, event_type,
          ratable_eligible)
        select r.confirmation_id, r.proposal_id, 1, r.event_id, 1, 'MANUAL', v_confirmed_at,
            v_confirmed_at, ${approver}::uuid, r.event_type::public.match_event_type,
            r.event_type = 'competitive'
          from jsonb_to_recordset(v_rows) as r(confirmation_id uuid, proposal_id uuid, event_id uuid, event_type text);
      get diagnostics v_inserted = row_count;
      if v_inserted <> ${groups.length} then
        raise exception 'Bulk confirmation count mismatch: expected ${groups.length}, got %', v_inserted;
      end if;
      update public.match_event_result_proposals p set status = 'confirmed'
        where p.id in (select r.proposal_id from jsonb_to_recordset(v_rows) as r(proposal_id uuid));
      insert into public.match_event_result_official_state (proposal_id, match_event_id, group_number,
          current_confirmation_id, current_version)
        select r.proposal_id, r.event_id, 1, r.confirmation_id, 1
          from jsonb_to_recordset(v_rows) as r(proposal_id uuid, event_id uuid, confirmation_id uuid);
    end $paf$;`,
    options
  );
  return ids;
}

/** One supported rebuild of a community's statistics from its official evidence. */
export async function rebuildCommunityStatistics(
  communityId: string,
  options: SqlQueryOptions = {}
): Promise<void> {
  await sqlRows(`select public.rebuild_statistics(${sqlText(communityId)}::uuid)`, options);
}
