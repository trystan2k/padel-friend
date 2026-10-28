import type { ManagementActor } from './match-management-fixtures';
import { createMatchManagementFixtures } from './match-management-fixtures';
import { fixtureSql } from './match-registration-sql';

export const reviewResultSets = [
  { position: 1, team_a_games: 6, team_b_games: 4, completed: true }
];

export const reviewResultPlayedAt = {
  local: '2020-01-01 12:00:00',
  offset_seconds: 0,
  instant: '2020-01-01T12:00:00.000Z'
};

export type ResultTeams = { team_a: string[]; team_b: string[] };

export type ReviewFixtureOptions = {
  groupNumber?: number;
  teams?: ResultTeams;
  submitter?: ManagementActor;
  sets?: unknown;
};

/** Real Supabase users, frozen event rosters, and compact result command builders. */
export async function createMatchResultReviewFixtures(env: { url: string; key: string }) {
  const management = await createMatchManagementFixtures(env);
  const players = [
    management.creator,
    ...(await Promise.all(Array.from({ length: 7 }, () => management.member())))
  ];
  const admin = await management.member();
  const reserve = await management.member();
  const outsider = await management.actor();

  async function promoteAdmin(actor: ManagementActor) {
    await fixtureSql(`do $$ begin
      alter table public.community_members disable trigger community_member_guard;
      update public.community_members set role='admin'
       where community_id='${management.communityId}' and user_id='${actor.id}';
      alter table public.community_members enable trigger community_member_guard;
    end $$;`);
  }
  await promoteAdmin(admin);

  async function protectedEvent(options: { reserve?: boolean; competitive?: boolean } = {}) {
    const accepted = [...players.slice(1), ...(options.reserve ? [reserve] : [])];
    const event = await management.event({ accepted });
    if (options.competitive) {
      await fixtureSql(`do $$ begin
        alter table public.match_events disable trigger match_event_immutable;
        update public.match_events set event_type='competitive' where id='${event.id}';
        alter table public.match_events enable trigger match_event_immutable;
      end $$;`);
    }
    await management.setCutoff(event.id, "now()-interval '1 minute'");
    await management.protectResults(event.id);
    return event.id;
  }

  function teamsForGroup(groupNumber = 1): ResultTeams {
    const group = players.slice((groupNumber - 1) * 4, groupNumber * 4);
    if (group.length !== 4) throw new Error('RESULT_FIXTURE_GROUP_MISSING');
    return {
      team_a: group.slice(0, 2).map(({ id }) => id),
      team_b: group.slice(2).map(({ id }) => id)
    };
  }

  function submissionArgs(eventId: string, options: ReviewFixtureOptions = {}) {
    const groupNumber = options.groupNumber ?? 1;
    return {
      p_match_event_id: eventId,
      p_group_number: groupNumber,
      p_teams: options.teams ?? teamsForGroup(groupNumber),
      p_sets: options.sets ?? reviewResultSets,
      p_played_local: reviewResultPlayedAt,
      p_court_label: 'Court 3',
      p_request_id: crypto.randomUUID()
    };
  }

  async function submit(eventId: string, options: ReviewFixtureOptions = {}) {
    const actor = options.submitter ?? management.creator;
    return management.rpc(actor, 'submit_match_event_result', submissionArgs(eventId, options));
  }

  return {
    ...management,
    players,
    admin,
    reserve,
    outsider,
    anonymousToken: env.key,
    promoteAdmin,
    protectedEvent,
    teamsForGroup,
    submissionArgs,
    submit
  };
}
