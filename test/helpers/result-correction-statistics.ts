import { asRecord, sqlRows } from './match-registration-sql';
import { sqlText } from './provisional-player-fixtures';
import type { Classification, Quartet } from './rating-fixtures';

/**
 * Independent expected-value oracle for the statistics projection. It is computed in TypeScript
 * from the facts of the groups alone (single-set fixtures: team_a 6-4, team_b 4-6, draw 6-6,
 * incomplete 3-2 unfinished), never from the production rebuild.
 */
export type StatGroup = {
  id: string;
  communityId: string;
  /** League when the group is League-eligible (ranked, all four members covered, in period). */
  leagueId: string | null;
  matchType: 'competitive' | 'friendly';
  playedAt: string;
  players: Quartet;
  classification: Classification;
};

type Totals = {
  confirmed: number;
  wins: number;
  losses: number;
  draws: number;
  incomplete: number;
  competitive: number;
  friendly: number;
  setsWon: number;
  setsLost: number;
  gamesWon: number;
  gamesLost: number;
  partners: Record<string, { g: number; w: number; l: number; d: number }>;
  /** Ordered (played_at, group, outcome) of the non-incomplete groups, reduced to streak facts. */
  seq: [string, string, string][];
  streak?: { n: number; bestWin: number; bestLoss: number; suffix: string };
};

const NIL = '00000000-0000-0000-0000-000000000000';

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('Expected a list of strings');
  return value.map((item) => String(item));
}
const GAMES: Record<Classification, [number, number, number, number]> = {
  // games_a, games_b, sets_a, sets_b
  team_a: [6, 4, 1, 0],
  team_b: [4, 6, 0, 1],
  draw: [6, 6, 0, 0],
  incomplete: [3, 2, 0, 0]
};

const empty = (): Totals => ({
  confirmed: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  incomplete: 0,
  competitive: 0,
  friendly: 0,
  setsWon: 0,
  setsLost: 0,
  gamesWon: 0,
  gamesLost: 0,
  partners: {},
  seq: []
});

/** Streak facts of an ordered W/L/D string: count, longest win/loss runs and the trailing run. */
function streakOf(outcomes: string): NonNullable<Totals['streak']> {
  let bestWin = 0;
  let bestLoss = 0;
  let run = 0;
  let previous = '';
  for (const outcome of outcomes) {
    run = outcome === previous ? run + 1 : 1;
    previous = outcome;
    if (outcome === 'W') bestWin = Math.max(bestWin, run);
    if (outcome === 'L') bestLoss = Math.max(bestLoss, run);
  }
  return {
    n: outcomes.length,
    bestWin,
    bestLoss,
    suffix: outcomes.length ? previous + String(run) : ''
  };
}

function finish(map: Map<string, Totals>): Map<string, Totals> {
  for (const totals of map.values()) {
    const ordered = [...totals.seq].sort(
      (a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1])
    );
    totals.streak = streakOf(ordered.map((entry) => entry[2]).join(''));
    totals.seq = [];
  }
  return map;
}

function add(
  map: Map<string, Totals>,
  key: string,
  group: StatGroup,
  side: 'team_a' | 'team_b' | 'community',
  partner?: string
) {
  const totals = map.get(key) ?? empty();
  const [ga, gb, sa, sb] = GAMES[group.classification];
  const outcome =
    group.classification === 'incomplete'
      ? 'I'
      : group.classification === 'draw'
        ? 'D'
        : side === 'community' || group.classification === side
          ? 'W'
          : 'L';
  totals.confirmed += 1;
  if (outcome === 'W') totals.wins += 1;
  if (outcome === 'L') totals.losses += 1;
  if (outcome === 'D') totals.draws += 1;
  if (outcome === 'I') totals.incomplete += 1;
  if (group.matchType === 'competitive') totals.competitive += 1;
  else totals.friendly += 1;
  if (side === 'community') {
    totals.setsWon += sa + sb;
    totals.gamesWon += ga + gb;
  } else if (side === 'team_a') {
    totals.setsWon += sa;
    totals.setsLost += sb;
    totals.gamesWon += ga;
    totals.gamesLost += gb;
  } else {
    totals.setsWon += sb;
    totals.setsLost += sa;
    totals.gamesWon += gb;
    totals.gamesLost += ga;
  }
  if (outcome !== 'I') totals.seq.push([group.playedAt, group.id, outcome]);
  if (partner) {
    const relation = (totals.partners[partner] ??= { g: 0, w: 0, l: 0, d: 0 });
    relation.g += 1;
    if (outcome === 'W') relation.w += 1;
    if (outcome === 'L') relation.l += 1;
    if (outcome === 'D') relation.d += 1;
  }
  map.set(key, totals);
}

const scopes = (group: StatGroup, allowAll: boolean) => [
  ...(allowAll ? [['all', NIL]] : []),
  ['community', group.communityId],
  ...(group.leagueId ? [['league', group.leagueId]] : [])
];

export function expectedStatistics(groups: readonly StatGroup[]): Map<string, Totals> {
  const map = new Map<string, Totals>();
  for (const group of groups) {
    const [a1, a2, b1, b2] = group.players;
    const sides: [readonly [string, string], 'team_a' | 'team_b'][] = [
      [[a1, a2], 'team_a'],
      [[b1, b2], 'team_b']
    ];
    for (const [scopeKind, scopeId] of scopes(group, true))
      for (const matchType of ['all', group.matchType]) {
        for (const [team, side] of sides) {
          const [x, y] = team;
          add(
            map,
            'player|' + x + '|' + NIL + '|' + scopeKind + '|' + scopeId + '|' + matchType,
            group,
            side,
            y
          );
          add(
            map,
            'player|' + y + '|' + NIL + '|' + scopeKind + '|' + scopeId + '|' + matchType,
            group,
            side,
            x
          );
          add(
            map,
            'pair|' + [x, y].sort().join('+') + '|' + scopeKind + '|' + scopeId + '|' + matchType,
            group,
            side
          );
          const others = side === 'team_a' ? [b1, b2] : [a1, a2];
          for (const other of others)
            for (const focal of [x, y]) {
              add(
                map,
                'opponent|' +
                  focal +
                  '|' +
                  other +
                  '|' +
                  scopeKind +
                  '|' +
                  scopeId +
                  '|' +
                  matchType,
                group,
                side
              );
            }
        }
      }
    for (const [scopeKind, scopeId] of scopes(group, false))
      for (const matchType of ['all', group.matchType])
        add(
          map,
          'community|' +
            group.communityId +
            '|' +
            NIL +
            '|' +
            scopeKind +
            '|' +
            scopeId +
            '|' +
            matchType,
          group,
          'community'
        );
  }
  return finish(map);
}

export async function observedStatistics(
  players: readonly string[],
  communities: readonly string[]
): Promise<Map<string, Totals>> {
  const playerList = players.map(sqlText).join(',');
  const communityList = communities.map(sqlText).join(',');
  const rows = await sqlRows(
    'select subject_kind, subject_a::text as a, subject_b::text as b, scope_kind, scope_id::text as scope_id, ' +
      'match_type, subject_players::text[] as players, confirmed_groups, wins, losses, draws, incomplete_groups, ' +
      'competitive_groups, friendly_groups, sets_won, sets_lost, games_won, games_lost, ' +
      "relations -> 'partners' as partners, sequence from public.statistics_scope_summaries " +
      "where subject_kind in ('player', 'pair', 'opponent') and subject_players && array[" +
      playerList +
      ']::uuid[] ' +
      "or subject_kind = 'community' and subject_a = any (array[" +
      communityList +
      ']::uuid[])'
  );
  const map = new Map<string, Totals>();
  for (const row of rows) {
    if (Number(row['confirmed_groups']) === 0) continue;
    const kind = String(row['subject_kind']);
    const scope =
      String(row['scope_kind']) + '|' + String(row['scope_id']) + '|' + String(row['match_type']);
    const members = stringList(row['players']).sort();
    const key =
      kind === 'player'
        ? 'player|' + String(row['a']) + '|' + NIL + '|' + scope
        : kind === 'pair'
          ? 'pair|' + members.join('+') + '|' + scope
          : kind === 'opponent'
            ? 'opponent|' + String(row['a']) + '|' + String(row['b']) + '|' + scope
            : 'community|' + String(row['a']) + '|' + NIL + '|' + scope;
    const seq = asRecord(row['sequence']);
    const suffix = seq['suffix'] ? asRecord(seq['suffix']) : null;
    const partners: Totals['partners'] = {};
    if (kind === 'player' && row['partners'])
      for (const [partner, value] of Object.entries(asRecord(row['partners']))) {
        const relation = asRecord(value);
        partners[partner] = {
          g: Number(relation['g']),
          w: Number(relation['w']),
          l: Number(relation['l']),
          d: Number(relation['d'])
        };
      }
    map.set(key, {
      confirmed: Number(row['confirmed_groups']),
      wins: Number(row['wins']),
      losses: Number(row['losses']),
      draws: Number(row['draws']),
      incomplete: Number(row['incomplete_groups']),
      competitive: Number(row['competitive_groups']),
      friendly: Number(row['friendly_groups']),
      setsWon: Number(row['sets_won']),
      setsLost: Number(row['sets_lost']),
      gamesWon: Number(row['games_won']),
      gamesLost: Number(row['games_lost']),
      partners,
      seq: [],
      streak: {
        n: Number(seq['n']),
        bestWin: Number(seq['best_win']),
        bestLoss: Number(seq['best_loss']),
        suffix: suffix ? String(suffix['k']) + String(suffix['len']) : ''
      }
    });
  }
  return map;
}

const canonical = (value: unknown) =>
  JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([x], [y]) => x.localeCompare(y)))
      : item
  );

/** Differences between oracle and projection, as readable strings (empty means equal). */
export function diffStatistics(
  expected: Map<string, Totals>,
  observed: Map<string, Totals>
): string[] {
  const problems: string[] = [];
  for (const key of new Set([...expected.keys(), ...observed.keys()])) {
    const want = expected.get(key);
    const got = observed.get(key);
    if (canonical(want) !== canonical(got))
      problems.push(key + ' expected ' + canonical(want) + ' observed ' + canonical(got));
  }
  return problems;
}

/**
 * Rating-derived fields of the statistics facts against the ledger, formulated independently:
 * a fact carries the latest calculation of its ACTIVE effective source at the committed revision,
 * and a group without an active source carries none.
 */
export async function ratingFactMismatches(playerIds: readonly string[]): Promise<string[]> {
  const rows = await sqlRows(
    'with rev as (select committed_revision as r from public.player_rating_projection_control), ' +
      'expected as (' +
      ' select e.game_group_id, e.user_id, c.projection_revision as calc_revision, ' +
      "  (c.explanation ->> 'applied_delta')::numeric as delta, c.after_display_level as after_level " +
      ' from public.player_rating_events e cross join rev ' +
      ' cross join lateral (select s.is_active from public.player_rating_event_sources s ' +
      '   where s.rating_event_id = e.id and s.projection_revision <= rev.r order by s.projection_revision desc limit 1) src ' +
      ' cross join lateral (select k.* from public.player_rating_event_calculations k ' +
      '   where k.rating_event_id = e.id and k.projection_revision <= rev.r order by k.projection_revision desc limit 1) c ' +
      ' where src.is_active and e.user_id = any (array[' +
      playerIds.map(sqlText).join(',') +
      ']::uuid[])) ' +
      'select coalesce(pf.game_group_id, x.game_group_id)::text as g, coalesce(pf.user_id, x.user_id)::text as u, ' +
      ' pf.rating_calc_revision as got_revision, x.calc_revision as want_revision, ' +
      ' pf.rating_delta as got_delta, x.delta as want_delta, pf.after_level as got_level, x.after_level as want_level ' +
      'from public.statistics_participant_facts pf full join expected x ' +
      ' on x.game_group_id = pf.game_group_id and x.user_id = pf.user_id ' +
      'where (pf.user_id = any (array[' +
      playerIds.map(sqlText).join(',') +
      ']::uuid[]) or x.user_id is not null) ' +
      ' and (pf.rating_calc_revision is distinct from x.calc_revision or pf.rating_delta is distinct from x.delta ' +
      '  or pf.after_level is distinct from x.after_level) ' +
      ' and (x.user_id is not null or pf.user_id = any (array[' +
      playerIds.map(sqlText).join(',') +
      ']::uuid[]))'
  );
  return rows.map((row) => JSON.stringify(row));
}

/**
 * Current skill ranks of a community against the ledger: members ordered by app-wide level (all
 * fixture players are below the established threshold), competition ranking, from the ledger and
 * initializations, not from the rank projection. Transitions store a row only when the rank
 * itself changes, so the rank (not the level shown on the latest row) is what is compared.
 */
export async function rankMismatches(communityId: string): Promise<string[]> {
  const members = await sqlRows(
    'select m.user_id::text as user_id, coalesce(' +
      ' (select k.after_display_level from public.rating_event_sources_latest() s ' +
      '   join public.player_rating_events e on e.id = s.rating_event_id ' +
      '   join lateral (select c.after_display_level from public.player_rating_event_calculations c ' +
      '     where c.rating_event_id = e.id order by c.projection_revision desc limit 1) k on true ' +
      '  where s.user_id = m.user_id and s.is_active order by s.played_at desc, s.game_group_id desc limit 1), ' +
      ' (select i.initial_level from public.player_rating_initializations i where i.user_id = m.user_id ' +
      '   order by i.sequence desc limit 1))::numeric(4,2) as level ' +
      'from public.community_members m where m.community_id = ' +
      sqlText(communityId) +
      ' and m.activated_at is not null and m.valid_until is null'
  );
  const levels = members.map((row) => ({
    id: String(row['user_id']),
    level: Number(row['level'])
  }));
  const expected = new Map(
    levels.map((member) => [
      member.id,
      1 + levels.filter((other) => other.level > member.level).length
    ])
  );
  const observed = await sqlRows(
    'select distinct on (player_id) player_id::text as player_id, status, skill_rank ' +
      'from public.statistics_rank_transitions where community_id = ' +
      sqlText(communityId) +
      ' order by player_id, effective_from desc'
  );
  const problems: string[] = [];
  for (const row of observed) {
    const id = String(row['player_id']);
    if (row['status'] !== 'ranked') continue;
    if (!expected.has(id)) continue;
    if (Number(row['skill_rank']) !== expected.get(id))
      problems.push(id + ' rank ' + String(row['skill_rank']) + ' != ' + String(expected.get(id)));
  }
  for (const id of expected.keys())
    if (!observed.some((row) => String(row['player_id']) === id && row['status'] === 'ranked'))
      problems.push(id + ' has no ranked transition');
  return problems;
}
