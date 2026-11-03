import { randomUUID } from 'node:crypto';
import type { Browser } from '@playwright/test';
import { leagueFixtures } from './leagues-fixtures';
import { sql, type Actor } from './matches-management-fixtures';
import { finalize, review, secondCommunity, type Quartet } from './player-ratings-fixtures';

// PAF-13 U8 fixtures. Every sporting fact is confirmed through the PRODUCTION finalizer
// (finalize_match_event_result_locked, MANUAL and AUTO_48H) from real proposal rows; no statistic,
// rating or projection row is ever written here. Dates and actors are deterministic and isolated
// per run (fresh community, fresh users). The expectations below are hand-calculated from the score
// lines and share no code with the statistics reducers, so the browser journeys compare the UI with
// an independent oracle.

export type PlayerKey = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';
export type SeedType = 'competitive' | 'friendly';
export type SeedLeague = 'closed' | 'active' | null;
export type SeedSet = readonly [number, number, boolean];

export type SeedGroup = {
  key: string;
  community: 'main' | 'cross';
  type: SeedType;
  league: SeedLeague;
  /** Played instant (UTC). */
  at: string;
  teamA: readonly [PlayerKey, PlayerKey];
  teamB: readonly [PlayerKey, PlayerKey];
  sets: readonly SeedSet[];
  classification: 'team_a' | 'team_b' | 'draw' | 'incomplete';
  source: 'MANUAL' | 'AUTO_48H';
};

/**
 * A = focal player, B/E/F/H partners, C/D opponents, G = guest (no community membership) and F is
 * made an inactive community member after play. Third sets marked false are unfinished.
 */
export const SEED_GROUPS: readonly SeedGroup[] = [
  {
    key: 'g1',
    community: 'main',
    type: 'competitive',
    league: 'closed',
    at: '2026-09-02T18:00:00Z',
    teamA: ['A', 'B'],
    teamB: ['C', 'D'],
    sets: [
      [6, 4, true],
      [6, 3, true]
    ],
    classification: 'team_a',
    source: 'MANUAL'
  },
  {
    key: 'g2',
    community: 'main',
    type: 'competitive',
    league: 'active',
    at: '2026-09-20T18:00:00Z',
    teamA: ['A', 'B'],
    teamB: ['C', 'D'],
    sets: [
      [6, 4, true],
      [3, 6, true],
      [6, 3, true]
    ],
    classification: 'team_a',
    source: 'AUTO_48H'
  },
  {
    key: 'g3',
    community: 'main',
    type: 'friendly',
    league: null,
    at: '2026-09-27T18:00:00Z',
    teamA: ['A', 'B'],
    teamB: ['C', 'D'],
    sets: [
      [6, 4, true],
      [3, 6, true],
      [2, 1, false]
    ],
    classification: 'draw',
    source: 'MANUAL'
  },
  {
    key: 'g4',
    community: 'main',
    type: 'competitive',
    league: 'active',
    at: '2026-10-04T18:00:00Z',
    teamA: ['A', 'E'],
    teamB: ['C', 'D'],
    sets: [
      [6, 3, true],
      [6, 2, true]
    ],
    classification: 'team_a',
    source: 'AUTO_48H'
  },
  {
    key: 'gx',
    community: 'cross',
    type: 'competitive',
    league: null,
    at: '2026-10-05T18:00:00Z',
    teamA: ['A', 'H'],
    teamB: ['B', 'C'],
    sets: [
      [6, 3, true],
      [6, 4, true]
    ],
    classification: 'team_a',
    source: 'AUTO_48H'
  },
  {
    key: 'g5',
    community: 'main',
    type: 'competitive',
    league: null,
    at: '2026-10-11T18:00:00Z',
    teamA: ['B', 'C'],
    teamB: ['A', 'D'],
    sets: [
      [6, 2, true],
      [6, 4, true]
    ],
    classification: 'team_a',
    source: 'MANUAL'
  },
  {
    key: 'g6',
    community: 'main',
    type: 'competitive',
    league: null,
    at: '2026-10-18T18:00:00Z',
    teamA: ['A', 'B'],
    teamB: ['C', 'D'],
    sets: [[6, 4, true]],
    classification: 'incomplete',
    source: 'AUTO_48H'
  },
  {
    key: 'g7',
    community: 'main',
    type: 'friendly',
    league: null,
    at: '2026-10-22T18:00:00Z',
    teamA: ['A', 'F'],
    teamB: ['C', 'G'],
    sets: [
      [6, 1, true],
      [6, 2, true]
    ],
    classification: 'team_a',
    source: 'MANUAL'
  }
];

export type Outcome = 'W' | 'L' | 'D' | 'I';

/** Focal view of one seed group, calculated from the score lines only. */
export type Line = {
  group: SeedGroup;
  outcome: Outcome;
  partner: PlayerKey;
  opponents: readonly PlayerKey[];
  setsWon: number;
  setsLost: number;
  gamesWon: number;
  gamesLost: number;
};

export function lineFor(group: SeedGroup, focal: PlayerKey): Line | null {
  const onA = group.teamA.includes(focal);
  const onB = group.teamB.includes(focal);
  if (!onA && !onB) return null;
  const own = onA ? group.teamA : group.teamB;
  const other = onA ? group.teamB : group.teamA;
  let setsWon = 0;
  let setsLost = 0;
  let gamesWon = 0;
  let gamesLost = 0;
  for (const [a, b, completed] of group.sets) {
    const mine = onA ? a : b;
    const theirs = onA ? b : a;
    gamesWon += mine;
    gamesLost += theirs;
    if (completed && mine > theirs) setsWon += 1;
    if (completed && theirs > mine) setsLost += 1;
  }
  const outcome: Outcome =
    group.classification === 'incomplete'
      ? 'I'
      : group.classification === 'draw'
        ? 'D'
        : (group.classification === 'team_a') === onA
          ? 'W'
          : 'L';
  return {
    group,
    outcome,
    partner: own.find((key) => key !== focal) ?? focal,
    opponents: other,
    setsWon,
    setsLost,
    gamesWon,
    gamesLost
  };
}

export type Filter = {
  community?: 'main' | 'cross';
  league?: 'closed' | 'active';
  type?: SeedType;
  from?: string;
  through?: string;
};

export function linesFor(focal: PlayerKey, filter: Filter = {}): Line[] {
  return SEED_GROUPS.flatMap((group) => {
    const line = lineFor(group, focal);
    if (!line) return [];
    if (filter.community && group.community !== filter.community) return [];
    if (filter.league && group.league !== filter.league) return [];
    // League scope counts decided Competitive groups only.
    if (filter.league && line.outcome === 'I') return [];
    if (filter.type && group.type !== filter.type) return [];
    const day = group.at.slice(0, 10);
    if (filter.from && day < filter.from) return [];
    if (filter.through && day > filter.through) return [];
    return [line];
  });
}

export type Totals = {
  groups: number;
  wins: number;
  losses: number;
  draws: number;
  incomplete: number;
  setsWon: number;
  setsLost: number;
  gamesWon: number;
  gamesLost: number;
};

export function totalsOf(lines: readonly Line[]): Totals {
  const count = (outcome: Outcome) => lines.filter((line) => line.outcome === outcome).length;
  const sum = (pick: (line: Line) => number) =>
    lines.reduce((total, line) => total + pick(line), 0);
  return {
    groups: lines.length,
    wins: count('W'),
    losses: count('L'),
    draws: count('D'),
    incomplete: count('I'),
    setsWon: sum((line) => line.setsWon),
    setsLost: sum((line) => line.setsLost),
    gamesWon: sum((line) => line.gamesWon),
    gamesLost: sum((line) => line.gamesLost)
  };
}

/** Literal hand calculation for the unfiltered focal player, asserted next to the computed oracle. */
export const A_ALL_TOTALS: Totals = {
  groups: 8,
  wins: 5,
  losses: 1,
  draws: 1,
  incomplete: 1,
  setsWon: 12,
  setsLost: 4,
  gamesWon: 86,
  gamesLost: 62
};

/** Lifecycle-only events of the focal player (no confirmed result). */
export const LIFECYCLE_DAYS = {
  pending: '2026-10-25',
  disputed: '2026-10-26',
  canceled: '2026-10-27',
  reserve: '2026-10-28',
  awaiting: '2026-10-29'
} as const;

/** Pending proposal v1 with explicit sets; 49h-aged windows are AUTO_48H eligible. */
async function submitScored(
  eventId: string,
  players: Quartet,
  group: Pick<SeedGroup, 'sets' | 'classification' | 'at'>,
  submittedBy: string,
  ageHours: 49 | 1
): Promise<string> {
  const proposalId = randomUUID();
  const [a1, a2, b1, b2] = players;
  const sets = JSON.stringify(
    group.sets.map(([a, b, completed], index) => ({
      position: index + 1,
      team_a_games: a,
      team_b_games: b,
      completed
    }))
  );
  await sql(`do $proposal$
    declare
      v_submitted_at timestamptz := clock_timestamp() - interval '${ageHours} hours';
      v_deadline timestamptz := v_submitted_at + interval '48 hours';
    begin
      insert into public.match_event_result_proposals(
        id, match_event_id, group_number, status, active_version, review_deadline_at, submitted_by, submitted_at
      ) values ('${proposalId}', '${eventId}', 1, 'pending', 1, v_deadline, '${submittedBy}', v_submitted_at);
      insert into public.match_event_result_proposal_versions(
        proposal_id, version, submitted_by, submitted_at, review_deadline_at, teams, sets, classification,
        played_at_utc, played_at_local, played_at_offset_seconds, court_label
      ) values ('${proposalId}', 1, '${submittedBy}', v_submitted_at, v_deadline,
        jsonb_build_object('team_a', jsonb_build_array('${a1}', '${a2}'), 'team_b', jsonb_build_array('${b1}', '${b2}')),
        '${sets}'::jsonb, '${group.classification}', '${group.at}'::timestamptz,
        ('${group.at}'::timestamptz at time zone 'UTC'), 0, 'Court 1');
    end $proposal$;`);
  return proposalId;
}

/**
 * The seeded world. Main community (Public, instant join, backdated memberships), a second
 * Private community administered by the focal player, one closed and one active League, and
 * every history lifecycle state for the focal player. Cleanup removes everything it created.
 */
export async function statisticsWorld(browser: Browser) {
  const f = await leagueFixtures(browser, {
    memberCount: 7,
    communityName: `Statistics Club ${randomUUID().slice(0, 6)}`,
    creatorName: 'Statistics Host',
    memberNames: [
      'Ana Focal',
      'Bruno Partner',
      'Carla Rival',
      'Diego Rival',
      'Elena Once',
      'Fabio Inactive',
      'Hugo Cross'
    ]
  });
  const actors: Record<PlayerKey, Actor> = {
    A: f.members[0]!,
    B: f.members[1]!,
    C: f.members[2]!,
    D: f.members[3]!,
    E: f.members[4]!,
    F: f.members[5]!,
    H: f.members[6]!,
    G: f.guest
  };
  const idOf = (key: PlayerKey) => actors[key].id;
  const nameOf = (key: PlayerKey) => actors[key].name;

  // Memberships predate every played instant, so League eligibility is evaluated historically.
  await sql(`do $$ begin
    alter table public.community_members disable trigger community_member_guard;
    update public.community_members set valid_from = '2026-01-01T00:00:00Z', activated_at = '2026-01-01T00:00:00Z'
     where community_id = '${f.community}';
    alter table public.community_members enable trigger community_member_guard;
  end $$;`);

  const insertLeague = async (
    name: string,
    status: 'active' | 'closed',
    startAt: string,
    endAt: string | null
  ) => {
    const id = randomUUID();
    await sql(`insert into public.leagues(id, community_id, owner_id, name, timezone, start_at, end_mode, end_at, status,
        minimum_matches_for_final_award, activated_at, closed_at, closed_by, closed_reason, create_request_id, create_input)
      values ('${id}', '${f.community}', '${f.creator.id}', '${name}', 'UTC', '${startAt}'::timestamptz,
        '${endAt ? 'fixed_date' : 'manual'}', ${endAt ? `'${endAt}'::timestamptz` : 'null'}, '${status}', 1,
        '${startAt}'::timestamptz, ${status === 'closed' ? `'${endAt}'::timestamptz` : 'null'}, null,
        ${status === 'closed' ? "'fixed_end_reached'" : 'null'}, gen_random_uuid(), '{}'::jsonb)`);
    return id;
  };
  const leagues = {
    closed: {
      name: 'Autumn Closed League',
      id: await insertLeague(
        'Autumn Closed League',
        'closed',
        '2026-08-25T00:00:00Z',
        '2026-09-10T00:00:00Z'
      )
    },
    active: {
      name: 'Spring Active League',
      id: await insertLeague('Spring Active League', 'active', '2026-09-15T00:00:00Z', null)
    }
  };

  const cross = await secondCommunity(actors.A);
  const crossName = (
    await sql(`select name from public.communities where id = '${cross.communityId}'`)
  )[0]?.['name'];

  /** Event of the main community at a fixed instant, optionally League-bound / typed / registered. */
  async function seedEvent(
    startsAt: string,
    type: SeedType,
    leagueId: string | null,
    registered = 1,
    processCutoff = false
  ): Promise<string> {
    const id = await f.event(registered);
    // Lifecycle events register a full quartet plus a reserve and run the production cutoff.
    if (processCutoff) await f.cutoff(id);
    await sql(`do $$ begin
      alter table public.match_events disable trigger match_event_immutable;
      alter table public.match_events disable trigger match_event_league_binding;
      update public.match_events set starts_at = '${startsAt}'::timestamptz,
        registration_cutoff_at = '${startsAt}'::timestamptz - interval '2 hours',
        event_type = '${type}', league_id = ${leagueId ? `'${leagueId}'` : 'null'} where id = '${id}';
      alter table public.match_events enable trigger match_event_league_binding;
      alter table public.match_events enable trigger match_event_immutable;
    end $$;`);
    return id;
  }

  const groupIds: Record<string, { proposalId: string; eventId: string; confirmationId: string }> =
    {};
  for (const group of SEED_GROUPS) {
    const eventId =
      group.community === 'cross'
        ? cross.eventId
        : await seedEvent(group.at, group.type, group.league ? leagues[group.league].id : null);
    const players: Quartet = [
      idOf(group.teamA[0]),
      idOf(group.teamA[1]),
      idOf(group.teamB[0]),
      idOf(group.teamB[1])
    ];
    const submitter = group.community === 'cross' ? actors.A.id : f.creator.id;
    const proposalId = await submitScored(
      eventId,
      players,
      group,
      submitter,
      group.source === 'AUTO_48H' ? 49 : 1
    );
    if (group.source === 'MANUAL') {
      await review(proposalId, players[0], 'approve');
      await review(proposalId, players[2], 'approve');
    }
    const confirmationId = await finalize(proposalId, group.source, players[0]);
    if (!confirmationId) throw new Error(`Group ${group.key} did not confirm`);
    groupIds[group.key] = { proposalId, eventId, confirmationId };
  }

  // Lifecycle-only entries of the focal player.
  const quartet: Quartet = [idOf('A'), idOf('B'), idOf('C'), idOf('D')];
  const pendingEvent = await seedEvent(
    `${LIFECYCLE_DAYS.pending}T18:00:00Z`,
    'competitive',
    null,
    5,
    true
  );
  const pendingProposal = await submitScored(
    pendingEvent,
    quartet,
    {
      sets: [
        [6, 4, true],
        [6, 4, true]
      ],
      classification: 'team_a',
      at: `${LIFECYCLE_DAYS.pending}T18:00:00Z`
    },
    f.creator.id,
    1
  );
  const disputedEvent = await seedEvent(
    `${LIFECYCLE_DAYS.disputed}T18:00:00Z`,
    'competitive',
    null,
    5,
    true
  );
  const disputedProposal = await submitScored(
    disputedEvent,
    quartet,
    {
      sets: [
        [6, 4, true],
        [6, 4, true]
      ],
      classification: 'team_a',
      at: `${LIFECYCLE_DAYS.disputed}T18:00:00Z`
    },
    f.creator.id,
    1
  );
  // The real command moves the proposal to disputed (a bare review row would not).
  await f.rpc(actors.C, 'review_match_event_result', {
    p_proposal_id: disputedProposal,
    p_expected_version: 1,
    p_decision: 'reject',
    p_reason_code: 'SCORE_INCORRECT',
    p_request_id: randomUUID()
  });
  const canceledEvent = await seedEvent(
    `${LIFECYCLE_DAYS.canceled}T18:00:00Z`,
    'friendly',
    null,
    5,
    true
  );
  await sql(`do $$ begin
    alter table public.match_events disable trigger match_event_immutable;
    update public.match_events set status = 'cancelled', cancelled_at = now(), cancelled_by = '${f.creator.id}', cancel_reason = 'Court unavailable' where id = '${canceledEvent}';
    alter table public.match_events enable trigger match_event_immutable;
  end $$;`);
  // Five registrants: the fifth (D) is the Reserve Not Playing player of this event.
  const reserveEvent = await seedEvent(
    `${LIFECYCLE_DAYS.reserve}T18:00:00Z`,
    'competitive',
    null,
    5,
    true
  );
  await seedEvent(`${LIFECYCLE_DAYS.awaiting}T18:00:00Z`, 'competitive', null, 5, true);

  // The Friendly partner leaves the community after play; their actual history must remain.
  await sql(`do $$ begin
    alter table public.community_members disable trigger community_member_guard;
    update public.community_members set status = 'inactive', valid_until = now()
     where community_id = '${f.community}' and user_id = '${idOf('F')}' and valid_until is null;
    alter table public.community_members enable trigger community_member_guard;
  end $$;`);

  async function cleanup() {
    const actorIds = Object.values(actors).map((actor) => actor.id);
    const leagueIds = [leagues.closed.id, leagues.active.id];
    await cross.cleanup();
    await f.cleanup();
    const list = (values: readonly string[]) => values.map((value) => `'${value}'`).join(',');
    // Derived statistics rows have no foreign keys; remove this run's scopes and subjects.
    for (const table of ['statistics_scope_summaries', 'statistics_daily_buckets'])
      await sql(`delete from public.${table}
        where scope_id in (${list([f.community, cross.communityId, ...leagueIds])})
           or subject_a in (${list([f.community, cross.communityId, ...actorIds])})
           or subject_b in (${list(actorIds)})`);
  }

  return {
    f,
    actors,
    idOf,
    nameOf,
    leagues,
    cross: { ...cross, name: String(crossName) },
    groupIds,
    lifecycle: {
      pendingEvent,
      pendingProposal,
      disputedEvent,
      disputedProposal,
      canceledEvent,
      reserveEvent
    },
    cleanup
  };
}

export type StatisticsWorld = Awaited<ReturnType<typeof statisticsWorld>>;
