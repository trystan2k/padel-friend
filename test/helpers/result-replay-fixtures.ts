import { asRecord, fixtureSql, sqlRows } from './match-registration-sql';
import { SETS, type Classification, type PendingGroup, type Quartet } from './rating-fixtures';
import { openDedicatedSqlConnection, queryTrustedSql, type SqlRow } from './sql-transport';

/** A corrected fact for a confirmed group; omitted fields keep the original value. */
export type CorrectionFacts = {
  players?: Quartet;
  classification?: Classification;
  playedAt?: string;
};

export type QueuedCorrection = {
  jobId: string;
  amendmentId: string;
  candidateVersion: number;
};

const text = (value: unknown) => String(value);

function teamsJson(players: Quartet): string {
  const [a1, a2, b1, b2] = players;
  return `jsonb_build_object('team_a', jsonb_build_array('${a1}', '${a2}'), 'team_b', jsonb_build_array('${b1}', '${b2}'))`;
}

/**
 * Trusted-SQL stand-in for the amendment commands (their approval flow is proven in the
 * amendment suites): an immutable candidate version, an accepted amendment and the correction
 * job queued through the production enqueue function. The processor under test does the rest.
 */
export async function queueCorrection(
  group: PendingGroup & { confirmationId: string },
  options: {
    kind?: 'replace' | 'void';
    facts?: CorrectionFacts;
    /** Admin overrides need a decision actor and, for void, the audited resolution row. */
    adminId?: string;
  } = {}
): Promise<QueuedCorrection> {
  const kind = options.kind ?? 'replace';
  const facts = options.facts ?? {};
  const players = facts.players ?? group.players;
  const classification = facts.classification ?? group.classification;
  const playedAt = facts.playedAt ?? group.playedAt;
  const amendmentId = crypto.randomUUID();
  // The base is whatever is official NOW, so repeated corrections chain version after version.
  const [official] = await sqlRows(
    `select current_confirmation_id::text as confirmation_id, current_version::int as version
       from public.match_event_result_official_state where proposal_id = '${group.proposalId}'`
  );
  const baseConfirmationId = text(official!['confirmation_id']);
  const baseVersion = Number(official!['version']);
  const candidateVersion = baseVersion + 1;
  const override = options.adminId !== undefined || kind === 'void';
  if (override && options.adminId === undefined) throw new Error('A void needs an admin override');
  await fixtureSql(`do $fx$
    declare
      v_now timestamptz := clock_timestamp();
      v_submitted timestamptz := clock_timestamp() - interval '49 hours';
      v_group_number bigint;
      v_resolution uuid := gen_random_uuid();
    begin
      select p.group_number into v_group_number from public.match_event_result_proposals p
       where p.id = '${group.proposalId}';
      insert into public.match_event_result_proposal_versions(
        proposal_id, version, submitted_by, submitted_at, review_deadline_at, teams, sets, classification,
        played_at_utc, played_at_local, played_at_offset_seconds, court_label
      ) values ('${group.proposalId}', ${candidateVersion}, '${group.submittedBy}', v_submitted, v_submitted + interval '48 hours',
        ${teamsJson(players)}, '${SETS[classification]}'::jsonb, '${classification}',
        '${playedAt}'::timestamptz, ('${playedAt}'::timestamptz at time zone 'UTC'), 0, 'Court 2');
      insert into public.result_amendment_requests(
        id, match_event_id, proposal_id, group_number, base_confirmation_id, base_version, requester_id,
        reason, command_id, fingerprint
      ) values ('${amendmentId}', '${group.eventId}', '${group.proposalId}', v_group_number,
        '${baseConfirmationId}', ${baseVersion}, '${group.submittedBy}', 'Fixture correction', gen_random_uuid(), 'fixture');
      insert into public.result_amendment_candidates(proposal_id, version, amendment_id, base_confirmation_id)
        values ('${group.proposalId}', ${candidateVersion}, '${amendmentId}', '${baseConfirmationId}');
      update public.result_amendment_requests set lifecycle = 'proposal_pending', candidate_version = ${candidateVersion}
       where id = '${amendmentId}';
      update public.result_amendment_requests
         set lifecycle = 'approved_pending_repair',
             decision_source = '${override ? 'ADMIN_OVERRIDE' : 'AUTO_48H'}',
             decision_actor_id = ${override ? `'${options.adminId}'` : 'null'},
             decided_at = v_now${override ? ", decision_note = 'Fixture override'" : ''}
       where id = '${amendmentId}';
      ${
        override
          ? `insert into public.result_dispute_resolutions(
              id, match_event_id, proposal_id, group_number, resolution_kind, amendment_id, base_confirmation_id,
              candidate_version, decision, actor_id, justification, command_id, fingerprint
            ) values (v_resolution, '${group.eventId}', '${group.proposalId}', v_group_number, 'amendment',
              '${amendmentId}', '${baseConfirmationId}', ${candidateVersion}, '${kind}', '${options.adminId}',
              'Fixture justification', gen_random_uuid(), 'fixture');`
          : ''
      }
      perform public.queue_result_repair_job_locked('${amendmentId}', '${kind}',
        ${override ? `'${options.adminId}'` : 'null'}, ${override ? 'v_resolution' : 'null'},
        '${override ? `admin_override_${kind}` : 'amendment_accepted'}', null, v_now);
    end $fx$;`);
  const [job] = await sqlRows(
    `select id::text as id from public.result_repair_jobs where amendment_id = '${amendmentId}'`
  );
  return { jobId: text(job!['id']), amendmentId, candidateVersion };
}

export async function repairJob(jobId: string): Promise<SqlRow> {
  const [row] = await sqlRows(
    `select j.*, j.lease_token::text as lease_token_text from public.result_repair_jobs j where j.id = '${jobId}'`
  );
  return row!;
}

export async function repairAttempts(jobId: string): Promise<SqlRow[]> {
  return sqlRows(
    `select * from public.result_repair_attempts where job_id = '${jobId}' order by attempt_number`
  );
}

/** Trusted operator-style re-queue of a failed job (the production path is retry_result_repair). */
export async function requeueJob(jobId: string): Promise<void> {
  await fixtureSql(
    `update public.result_repair_jobs set status = 'queued', next_attempt_at = clock_timestamp(), finished_at = null
      where id = '${jobId}' and status = 'failed'`
  );
}

export type ClaimReceipt = {
  claimed: boolean;
  reason?: string;
  job_id?: string;
  fence_token?: string;
  attempt_number?: number;
};

export async function claimRepair(jobId?: string, leaseSeconds = 600): Promise<ClaimReceipt> {
  const [row] = await sqlRows(
    `select public.claim_result_repair_job(${jobId ? `'${jobId}'` : 'null'}, ${leaseSeconds})::text as receipt`
  );
  const receipt = asRecord(JSON.parse(text(row!['receipt'])) as unknown);
  if (typeof receipt['claimed'] !== 'boolean') throw new Error('Invalid claim receipt');
  return {
    claimed: receipt['claimed'],
    reason: typeof receipt['reason'] === 'string' ? receipt['reason'] : undefined,
    job_id: typeof receipt['job_id'] === 'string' ? receipt['job_id'] : undefined,
    fence_token: typeof receipt['fence_token'] === 'string' ? receipt['fence_token'] : undefined,
    attempt_number:
      typeof receipt['attempt_number'] === 'number' ? receipt['attempt_number'] : undefined
  };
}

export type ExecutionReceipt = {
  outcome: 'succeeded' | 'failed' | 'stale' | 'not_found';
  revision?: number;
  failure_code?: string;
  failure_stage?: string;
  job?: Record<string, unknown>;
};

export async function executeRepair(jobId: string, token: string): Promise<ExecutionReceipt> {
  const [row] = await sqlRows(
    `select public.execute_result_repair('${jobId}', '${token}')::text as receipt`
  );
  const receipt = asRecord(JSON.parse(text(row!['receipt'])) as unknown);
  const outcome = receipt['outcome'];
  if (
    outcome !== 'succeeded' &&
    outcome !== 'failed' &&
    outcome !== 'stale' &&
    outcome !== 'not_found'
  ) {
    throw new Error('Invalid execution receipt');
  }
  return {
    outcome,
    revision: typeof receipt['revision'] === 'number' ? receipt['revision'] : undefined,
    failure_code: typeof receipt['failure_code'] === 'string' ? receipt['failure_code'] : undefined,
    failure_stage:
      typeof receipt['failure_stage'] === 'string' ? receipt['failure_stage'] : undefined,
    job: receipt['job'] == null ? undefined : asRecord(receipt['job'])
  };
}

/** Claim (committed) and execute (separate transaction), like the user-facing flow. */
export async function repairNow(jobId: string): Promise<ExecutionReceipt> {
  const claim = await claimRepair(jobId);
  if (!claim.claimed || !claim.fence_token)
    throw new Error(`Job was not claimed: ${JSON.stringify(claim)}`);
  return executeRepair(jobId, claim.fence_token);
}

const SEAM = 'public.result_repair_publish_derived(uuid, bigint)';

/**
 * Runs with the publication seam replaced by a no-op (the derived League/statistics
 * publishers do not exist in this unit) and always restores the production definition.
 */
export async function withNoopPublication<T>(run: () => Promise<T>): Promise<T> {
  const [row] = await sqlRows(`select pg_get_functiondef('${SEAM}'::regprocedure) as def`);
  const original = text(row!['def']);
  await fixtureSql(
    `create or replace function public.result_repair_publish_derived(p_job_id uuid, p_revision bigint) returns void
      language plpgsql security definer set search_path = '' as $$ begin null; end $$;`
  );
  try {
    return await run();
  } finally {
    await fixtureSql(original);
  }
}

export type SourceRow = {
  groupId: string;
  userId: string;
  eventId: string;
  revision: number;
  active: boolean;
  confirmationId: string;
  playedAt: string;
};

/** Latest effective source per event of the groups (current committed + this session). */
export async function effectiveSources(groupIds: readonly string[]): Promise<SourceRow[]> {
  const result = await queryTrustedSql(
    `select s.game_group_id::text as group_id, s.user_id::text as user_id, s.rating_event_id::text as event_id,
            s.source_revision::int as revision, s.is_active as active, s.confirmation_id::text as confirmation_id,
            to_char(s.played_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as played_at
       from public.rating_event_sources_latest() s
      where s.game_group_id = any($1::uuid[]) order by s.game_group_id, s.user_id`,
    { values: [groupIds] }
  );
  return result.rows.map((row) => ({
    groupId: text(row['group_id']),
    userId: text(row['user_id']),
    eventId: text(row['event_id']),
    revision: Number(row['revision']),
    active: Boolean(row['active']),
    confirmationId: text(row['confirmation_id']),
    playedAt: text(row['played_at'])
  }));
}

export async function activeQuartet(groupId: string): Promise<string[]> {
  return (await effectiveSources([groupId]))
    .filter((s) => s.active)
    .map((s) => s.userId)
    .sort();
}

/** Every append-only row of the given users' events, as a byte-comparable fingerprint. */
export async function sourceFingerprint(groupIds: readonly string[]): Promise<string> {
  const result = await queryTrustedSql(
    `select coalesce(jsonb_agg(to_jsonb(s) order by s.game_group_id, s.rating_event_id, s.projection_revision), '[]'::jsonb)::text as dump
       from public.player_rating_event_sources s where s.game_group_id = any($1::uuid[])`,
    { values: [groupIds] }
  );
  return text(result.rows[0]?.['dump']);
}

export async function committedRevisionNumber(): Promise<number> {
  const [row] = await sqlRows(
    'select committed_revision::int as revision from public.player_rating_projection_control'
  );
  return Number(row!['revision']);
}

/**
 * Re-runs the full replay inside a rolled-back transaction and reports whether it would
 * write anything: a deterministic replay of unchanged inputs is a no-op.
 */
export async function replayWouldChange(): Promise<{ changed: boolean; groups: number }> {
  const connection = await openDedicatedSqlConnection();
  try {
    await connection.query('begin');
    await connection.query('select public.rating_projection_lock_covered()');
    const result = await connection.query(
      `select (r.o_changed)::text as changed, r.o_groups::int as groups
         from public.rating_projection_replay((select committed_revision + 1 from public.player_rating_projection_control)) r`
    );
    await connection.query('rollback');
    const row = asRecord(result.rows[0]);
    return { changed: row['changed'] === 'true', groups: Number(row['groups']) };
  } finally {
    await connection.close();
  }
}
