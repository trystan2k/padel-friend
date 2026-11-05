import { asRecord, fixtureSql, sqlRows } from './match-registration-sql';
import {
  confirmAuto,
  submitPendingGroup,
  toQuartet,
  type Classification,
  type PendingGroup,
  type Quartet
} from './rating-fixtures';
import { setMembershipHistory, type RankedResultKit } from './ranked-result-fixtures';
import { sqlText } from './provisional-player-fixtures';

export type ConfirmedGroup = PendingGroup & { confirmationId: string };

const DAY_MS = 86_400_000;

/** ISO instant a whole number of days from a fixed anchor (second granular, UTC). */
export function dayAt(anchor: Date, days: number, hour = 10): string {
  const instant = new Date(anchor.getTime() + days * DAY_MS);
  instant.setUTCHours(hour, 0, 0, 0);
  return instant.toISOString();
}

/** Long-standing memberships so every played instant in a multi-week chronology is covered. */
export async function backdateMemberships(kit: RankedResultKit, since: string): Promise<void> {
  for (const player of kit.players)
    await setMembershipHistory(kit.communityId, player.id, [{ activatedAt: since }]);
}

/**
 * A confirmed group through the production AUTO_48H finalizer (League hook, statistics and rating
 * projector included). Players are the kit's quartet for the group number unless overridden.
 */
export async function confirmRankedGroup(
  kit: RankedResultKit,
  spec: {
    eventId: string;
    playedAt: string;
    groupNumber?: number;
    classification?: Classification;
    players?: Quartet;
  }
): Promise<ConfirmedGroup> {
  const groupNumber = spec.groupNumber ?? 1;
  const players = spec.players ?? toQuartet(kit.group(groupNumber).map((player) => player.id));
  const pending = await submitPendingGroup({
    eventId: spec.eventId,
    groupNumber,
    players,
    playedAt: spec.playedAt,
    submittedBy: kit.creator.id,
    classification: spec.classification ?? 'team_a'
  });
  return { ...pending, confirmationId: await confirmAuto(pending) };
}

export async function closeLeague(kit: RankedResultKit, leagueId: string, version = 1) {
  const closed = await kit.rpc(kit.creator, 'close_league', {
    p_league_id: leagueId,
    p_expected_version: version
  });
  if (closed.error) throw new Error('close_league failed: ' + closed.error.message);
}

/** Full-row fingerprints of every snapshot, so immutability is a byte comparison. */
export function standingsSnapshots(leagueId: string) {
  return sqlRows(
    'select standings_version::int as version, cause, basis, repair_job_id::text as job, amendment_id::text as amendment, ' +
      'prior_standings_version::int as prior, source_fingerprint as fingerprint, ' +
      'cardinality(included_confirmation_ids)::int as included, md5(s::text) as row_hash, ' +
      "(select coalesce(jsonb_agg(jsonb_build_object('u', x ->> 'user_id', 'pos', (x ->> 'position')::int, 'm', (x ->> 'matches')::int, " +
      "'w', (x ->> 'wins')::int, 'l', (x ->> 'losses')::int, 'd', (x ->> 'draws')::int, 'sw', (x ->> 'sets_won')::int, " +
      "'sl', (x ->> 'sets_lost')::int, 'award', (x ->> 'award_eligible')::boolean) order by x ->> 'user_id'), '[]'::jsonb) " +
      'from jsonb_array_elements(s.entries) x) as entries ' +
      'from public.league_standings_snapshots s where league_id = ' +
      sqlText(leagueId) +
      ' order by standings_version'
  );
}

export function leagueCounters(leagueId: string) {
  return sqlRows(
    'select user_id::text as user_id, matches, wins, losses, draws, sets_won, sets_lost ' +
      'from public.league_player_counters where league_id = ' +
      sqlText(leagueId) +
      ' order by user_id'
  );
}

export async function leagueRevisionEvents(leagueId: string) {
  return sqlRows(
    'select actor_id::text as actor, system_reason, details from public.league_events where league_id = ' +
      sqlText(leagueId) +
      " and action = 'standings_revised' order by occurred_at, id"
  );
}

/** Counts of everything a retry or a rolled-back repair must not duplicate. */
export async function publicationCounts(leagueId: string | null, proposalIds: readonly string[]) {
  const ids = proposalIds.map(sqlText).join(',');
  const [row] = await sqlRows(
    'select ' +
      '(select count(*)::int from public.league_standings_snapshots where league_id = ' +
      (leagueId ? sqlText(leagueId) : 'null') +
      ') as snapshots, ' +
      '(select count(*)::int from public.league_events where league_id = ' +
      (leagueId ? sqlText(leagueId) : 'null') +
      " and action = 'standings_revised') as league_events, " +
      '(select count(*)::int from public.league_projection_confirmations where league_id = ' +
      (leagueId ? sqlText(leagueId) : 'null') +
      ') as receipts, ' +
      "(select count(*)::int from public.notifications where event_key like 'result.repair_applied:%' " +
      'and target_id = any (select match_event_id from public.match_event_result_proposals where id in (' +
      ids +
      '))) as completion_notices, ' +
      "(select count(*)::int from public.match_event_audit_log where action = 'result_repair_applied' " +
      'and match_event_id in (select match_event_id from public.match_event_result_proposals where id in (' +
      ids +
      '))) as completion_audits, ' +
      '(select count(*)::int from public.statistics_group_facts where game_group_id in (' +
      ids +
      ')) as stat_groups, ' +
      '(select revision::int from public.statistics_projection_control) as statistics_revision, ' +
      '(select committed_revision::int from public.player_rating_projection_control) as rating_revision'
  );
  return row!;
}

/** Observes the engine-independent oracle inputs: a failure injected through a trigger on one table. */
export async function installFailure(
  name: string,
  table: string,
  timing: 'insert' | 'update',
  when?: string
): Promise<void> {
  await fixtureSql(
    'create or replace function public.fixture_fail_' +
      name +
      '() returns trigger language plpgsql as $f$ ' +
      "begin raise exception 'FIXTURE_INJECTED_FAILURE_" +
      name +
      "'; end $f$; " +
      'create trigger fixture_fail_' +
      name +
      ' after ' +
      timing +
      ' on ' +
      table +
      ' for each row ' +
      (when ? 'when (' + when + ') ' : '') +
      'execute function public.fixture_fail_' +
      name +
      '();'
  );
}

export async function removeFailure(name: string, table: string): Promise<void> {
  await fixtureSql(
    'drop trigger if exists fixture_fail_' +
      name +
      ' on ' +
      table +
      '; drop function if exists public.fixture_fail_' +
      name +
      '();'
  );
}

export type StandingsRow = {
  u: string;
  pos: number;
  m: number;
  w: number;
  l: number;
  d: number;
  sw: number;
  sl: number;
  award: boolean;
};

/**
 * Expected League table from the facts alone: Win/Loss per side, a Draw adds only Match and Draw,
 * one completed set per decided fixture result; rank by Wins desc, Losses asc, set differential
 * desc, Sets Won desc with competition ranking (1, 1, 3).
 */
export function standingsOracle(
  groups: readonly { players: Quartet; classification: Classification }[],
  minimumMatches: number
): StandingsRow[] {
  const rows = new Map<string, StandingsRow>();
  for (const group of groups) {
    // Incomplete results never count toward a League table.
    if (group.classification === 'incomplete') continue;
    group.players.forEach((player, index) => {
      const side = index < 2 ? 'team_a' : 'team_b';
      const row = rows.get(player) ?? {
        u: player,
        pos: 0,
        m: 0,
        w: 0,
        l: 0,
        d: 0,
        sw: 0,
        sl: 0,
        award: false
      };
      row.m += 1;
      if (group.classification === 'draw') row.d += 1;
      else if (group.classification === side) {
        row.w += 1;
        row.sw += 1;
      } else {
        row.l += 1;
        row.sl += 1;
      }
      rows.set(player, row);
    });
  }
  const list = [...rows.values()];
  const key = (row: StandingsRow) => [-row.w, row.l, -(row.sw - row.sl), -row.sw];
  const compare = (a: StandingsRow, b: StandingsRow) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i += 1) if (ka[i] !== kb[i]) return ka[i]! - kb[i]!;
    return 0;
  };
  for (const row of list) {
    row.pos = 1 + list.filter((other) => compare(other, row) < 0).length;
    row.award = row.m >= minimumMatches;
  }
  return list.sort((a, b) => a.u.localeCompare(b.u));
}

/** Normalizes snapshot/counters entries to the oracle shape for a direct comparison. */
export function normalizeEntries(entries: unknown): StandingsRow[] {
  if (!Array.isArray(entries)) throw new Error('Expected snapshot entries');
  return entries
    .map((item): StandingsRow => {
      const row = asRecord(item);
      return {
        u: String(row['u']),
        pos: Number(row['pos']),
        m: Number(row['m']),
        w: Number(row['w']),
        l: Number(row['l']),
        d: Number(row['d']),
        sw: Number(row['sw']),
        sl: Number(row['sl']),
        award: Boolean(row['award'])
      };
    })
    .sort((a, b) => a.u.localeCompare(b.u));
}
