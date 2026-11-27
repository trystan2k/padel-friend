import { asRecord, sqlRows } from './match-registration-sql';
import { sqlText } from './provisional-player-fixtures';
import { playedAt, type RankedResultKit } from './ranked-result-fixtures';

export type ErasurePlan = {
  revision: number;
  fingerprint: string;
  impact: Record<string, unknown>;
  successors: Record<string, Record<string, string>>;
  blockers: string[];
};

const jsonLiteral = (value: unknown) => sqlText(JSON.stringify(value)) + '::jsonb';

/** Read-only dry run of the private seam (trusted SQL only: no client role may execute it). */
export async function erasurePlan(
  subject: string,
  successors: ErasurePlan['successors'] | Record<string, never> = {}
): Promise<ErasurePlan> {
  const [row] = await sqlRows(
    'select privacy_internal.account_erasure_plan(' +
      sqlText(subject) +
      ', ' +
      jsonLiteral(successors) +
      ') as plan'
  );
  return parsePlan(asRecord(row)['plan']);
}

export const asStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => String(item)) : [];

function parsePlan(value: unknown): ErasurePlan {
  const plan = asRecord(value);
  const successors: ErasurePlan['successors'] = {};
  for (const [kind, entries] of Object.entries(asRecord(plan['successors'])))
    successors[kind] = Object.fromEntries(
      Object.entries(asRecord(entries)).map(([entity, user]) => [entity, String(user)])
    );
  return {
    revision: Number(plan['revision']),
    fingerprint: String(plan['fingerprint']),
    impact: asRecord(plan['impact']),
    successors,
    blockers: asStrings(plan['blockers'])
  };
}

export const approvedPlan = ({ blockers: _blockers, ...plan }: ErasurePlan) => plan;

export async function executeErasure(subject: string, expected: unknown) {
  const [row] = await sqlRows(
    'select privacy_internal.account_erasure_execute(' +
      sqlText(subject) +
      ', ' +
      jsonLiteral(expected) +
      ') as result'
  );
  return asRecord(asRecord(row)['result']);
}

/** Plans, approves the plan unchanged and executes. */
export async function eraseAccount(subject: string, successors: ErasurePlan['successors'] = {}) {
  const plan = await erasurePlan(subject, successors);
  if (plan.blockers.length > 0) throw new Error('Unexpected blockers: ' + plan.blockers.join(','));
  return executeErasure(subject, approvedPlan(plan));
}

/** Tables (any column, any type, jsonb and arrays included) whose rows still mention the needle. */
export async function tablesMentioning(needle: string): Promise<string[]> {
  const rows = await sqlRows(
    "select c.relname::text as relname, (xpath('/row/n/text()', query_to_xml(" +
      "format('select count(*) as n from public.%I t where t::text like %L', c.relname, " +
      sqlText('%' + needle + '%') +
      "), false, true, '')))[1]::text::int as n " +
      "from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' order by 1"
  );
  return rows.filter((row) => Number(row['n']) > 0).map((row) => String(row['relname']));
}

export async function scalar(sql: string): Promise<unknown> {
  const [row] = await sqlRows(sql);
  return Object.values(asRecord(row))[0];
}

export const countWithdrawn = async () =>
  Number(
    await scalar(
      "select count(*)::int from public.participant_identities where state = 'withdrawn'"
    )
  );

/** Business facts of surviving players that must not move when another player departs. */
export async function survivorSnapshot(
  playerIds: string[],
  communityId: string,
  eventIds: string[]
) {
  const ids = playerIds.map(sqlText).join(',');
  const events = eventIds.map(sqlText).join(',');
  const [row] = await sqlRows(
    'select jsonb_build_object(' +
      "'ratings', (select coalesce(jsonb_agg(to_jsonb(g) - 'updated_at' order by g.user_id), '[]') from public.global_player_ratings g where g.user_id in (" +
      ids +
      ')),' +
      "'rating_events', (select coalesce(jsonb_agg(jsonb_build_object('g', e.game_group_id, 'u', e.user_id, 'n', e.game_group_number, 'v', e.proposal_version) order by e.game_group_id, e.user_id), '[]') from public.player_rating_events e where e.user_id in (" +
      ids +
      ')),' +
      "'counters', (select coalesce(jsonb_agg(to_jsonb(c) - 'updated_at' order by c.league_id, c.user_id), '[]') from public.league_player_counters c where c.user_id in (" +
      ids +
      ')),' +
      "'versions', (select coalesce(jsonb_agg(jsonb_build_object('p', v.proposal_id, 'v', v.version, 'sets', v.sets) order by v.proposal_id, v.version), '[]') from public.match_event_result_proposal_versions v join public.match_event_result_proposals p on p.id = v.proposal_id where p.match_event_id in (" +
      events +
      ')),' +
      "'confirmations', (select coalesce(jsonb_agg(jsonb_build_object('p', c.proposal_id, 'v', c.proposal_version, 's', c.source) order by c.proposal_id), '[]') from public.match_event_result_confirmations c where c.match_event_id in (" +
      events +
      ')),' +
      "'facts', (select coalesce(jsonb_agg(to_jsonb(f) - 'updated_at' - 'partner_id' - 'rating_calc_revision' order by f.game_group_id, f.user_id), '[]') from public.statistics_participant_facts f where f.user_id in (" +
      ids +
      ') and f.community_id = ' +
      sqlText(communityId) +
      ')' +
      ') as snapshot'
  );
  return asRecord(row)['snapshot'];
}

/** Submits and fully approves one group of an event through the production protocol. */
export async function confirmGroup(kit: RankedResultKit, eventId: string, groupNumber: number) {
  const submitted = await kit.submit(eventId, playedAt(120).played, { groupNumber });
  if (submitted.error) throw new Error('submit failed: ' + JSON.stringify(submitted.error));
  const proposalId = String(asRecord(submitted.data)['proposal_id']);
  const first = (groupNumber - 1) * 4;
  const reviewers = groupNumber === 1 ? [first + 2] : [first, first + 2];
  for (const index of reviewers) {
    const approved = await kit.approve(proposalId, 1, kit.players[index]);
    if (approved.error) throw new Error('approve failed: ' + JSON.stringify(approved.error));
  }
  return proposalId;
}
