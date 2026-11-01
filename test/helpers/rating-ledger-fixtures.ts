import { fixtureSql, sqlRows } from './match-registration-sql';

export type ConfirmedGroup = {
  proposalId: string;
  confirmationId: string;
  version: number;
  playedAt: string;
  teams: { team_a: [string, string]; team_b: [string, string] };
};

/**
 * Official confirmed group for an existing competitive event: a pending proposal version
 * older than its 48-hour review window, confirmed through the real AUTO_48H finalizer so
 * the immutable confirmation and its eligibility facts are produced by production code.
 */
export async function insertConfirmedGroup(input: {
  eventId: string;
  submittedBy: string;
  playerIds: readonly [string, string, string, string];
  groupNumber: number;
  playedAt?: string;
}): Promise<ConfirmedGroup> {
  const proposalId = crypto.randomUUID();
  const playedAt = input.playedAt ?? '2020-01-01T12:00:00.000Z';
  const [a1, a2, b1, b2] = input.playerIds;
  await fixtureSql(`do $proposal$
    declare
      v_submitted_at timestamptz := clock_timestamp() - interval '49 hours';
      v_deadline timestamptz := v_submitted_at + interval '48 hours';
    begin
      insert into public.match_event_result_proposals(
        id, match_event_id, group_number, status, active_version, review_deadline_at,
        submitted_by, submitted_at
      ) values (
        '${proposalId}', '${input.eventId}', ${input.groupNumber}, 'pending', 1, v_deadline,
        '${input.submittedBy}', v_submitted_at
      );
      insert into public.match_event_result_proposal_versions(
        proposal_id, version, submitted_by, submitted_at, review_deadline_at,
        teams, sets, classification, played_at_utc, played_at_local,
        played_at_offset_seconds, court_label
      ) values (
        '${proposalId}', 1, '${input.submittedBy}', v_submitted_at, v_deadline,
        jsonb_build_object(
          'team_a', jsonb_build_array('${a1}', '${a2}'),
          'team_b', jsonb_build_array('${b1}', '${b2}')
        ),
        '[{"position":1,"team_a_games":6,"team_b_games":4,"completed":true}]'::jsonb,
        'team_a', '${playedAt}'::timestamptz,
        ('${playedAt}'::timestamptz at time zone 'UTC'), 0, 'Court 1'
      );
    end $proposal$;`);
  const confirmed = await sqlRows(
    `select public.finalize_match_event_result_locked('${proposalId}', 1, 'AUTO_48H', null)::text as id`
  );
  const confirmationId = confirmed[0]?.['id'];
  if (typeof confirmationId !== 'string') throw new Error('Fixture group was not confirmed');
  return {
    proposalId,
    confirmationId,
    version: 1,
    playedAt,
    teams: { team_a: [a1, a2], team_b: [b1, b2] }
  };
}

/** Frozen four-player calculation inputs in the exact shape the ledger constraint accepts. */
export function calculationInputs(group: ConfirmedGroup, mu = 4) {
  const state = {
    mu,
    sigma: 1,
    display_level: mu,
    reliability_percent: 10,
    confirmed_competitive_game_groups: 0,
    highest_display_level: mu
  };
  const members = [...group.teams.team_a, ...group.teams.team_b];
  return {
    classification: 'team_a',
    played_at: group.playedAt,
    teams: group.teams,
    states: Object.fromEntries(members.map((id) => [id, state]))
  };
}
