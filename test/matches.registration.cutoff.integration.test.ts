import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../src/lib/supabase/database.types';
import {
  assertLocalSupabaseEnvInCi,
  dotEnvPathFromImportMetaUrl,
  localSupabaseEnv
} from './helpers/local-supabase-env';
import {
  asRecord,
  expectDomainError,
  expectOrdinalInvariants,
  expectRosterAgreement,
  fixtureSql,
  leakedHolderBackends,
  makeRawRpc,
  registrationStateById,
  sqlRows,
  startSql,
  waitForRows,
  withDeadline,
  type RawRpc,
  type RpcResult,
  type SqlHandle,
  type SqlRow
} from './helpers/match-registration-sql';

vi.setConfig({ testTimeout: 240000, hookTimeout: 120000 });

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

type Actor = { id: string; token: string; client: SupabaseClient<Database>; name: string };

// The two PAF-5.4 alert kinds and their stable revision-keyed event_key shapes:
// match.cutoff_expired:<event>:<revision>:<recipient> and
// match.cutoff_not_playing:<event>:<revision>:<recipient>.
const CUTOFF_KINDS = ['match_registration_expired', 'match_registration_not_playing'] as const;

describe('match registration cutoff integration', () => {
  it('requires local Supabase in CI', () => {
    expect(() => assertLocalSupabaseEnvInCi(environment.env, process.env.CI)).not.toThrow();
  });

  // Shared fixture: real JWT actors and trusted SQL events in one public
  // community. Every test below runs against this state sequentially.
  const actors: Record<string, Actor> = {};
  const events: Record<string, string> = {};
  let publicCommunity = '';
  let rawRpc: RawRpc = async () => ({ data: null, error: null });

  const submit = (who: Actor, eventKey: string): PromiseLike<RpcResult> =>
    who.client.rpc('submit_match_registration', { p_match_event_id: events[eventKey]! });
  /** The current attempt identity for (event, user), latest-first. */
  const latestAttemptId = async (eventKey: string, userId: string): Promise<string> => {
    const rows = await sqlRows(
      `select id::text as id from public.match_event_registration_attempts
        where match_event_id = '${events[eventKey]!}' and user_id = '${userId}'
        order by requested_at desc, id desc limit 1`
    );
    expect(rows, `attempt for ${userId} on ${eventKey}`).toHaveLength(1);
    return String(rows[0]!['id']);
  };
  const decide = async (
    who: Actor,
    eventKey: string,
    targetId: string,
    decision: 'approve' | 'reject'
  ): Promise<RpcResult> => {
    const attemptId = await latestAttemptId(eventKey, targetId);
    return who.client.rpc('decide_match_registration', {
      p_match_event_id: events[eventKey]!,
      p_attempt_id: attemptId,
      p_decision: decision
    });
  };
  const detailAs = async (who: Actor, eventKey: string): Promise<Record<string, unknown>> => {
    const result = await who.client.rpc('get_match_event', { p_event_id: events[eventKey]! });
    expect(result.error, `${who.name} detail read`).toBeNull();
    return asRecord(result.data);
  };
  const listAs = async (
    who: Actor,
    entry: 'my' | 'available'
  ): Promise<Record<string, unknown>[]> => {
    const result = await who.client.rpc('list_match_events', { p_entry: entry });
    expect(result.error, `${who.name} list read`).toBeNull();
    return (Array.isArray(result.data) ? result.data : []).map(asRecord);
  };
  const queueAs = async (who: Actor, eventKey: string): Promise<Record<string, unknown>> => {
    const result = await who.client.rpc('list_match_event_registration_requests', {
      p_match_event_id: events[eventKey]!
    });
    expect(result.error, 'creator queue read').toBeNull();
    const rows: unknown[] = Array.isArray(result.data) ? result.data : [];
    expect(rows, 'queue row').toHaveLength(1);
    return asRecord(rows[0]);
  };
  const ownRegistrationAs = async (
    who: Actor,
    eventKey: string
  ): Promise<Record<string, unknown>> => {
    const result = await who.client.rpc('get_my_match_registration', {
      p_match_event_id: events[eventKey]!
    });
    expect(result.error, `${who.name} own registration read`).toBeNull();
    return asRecord(result.data);
  };
  const inboxOf = async (who: Actor, eventKey: string): Promise<SqlRow[]> => {
    const result = await who.client
      .from('notifications')
      .select('id,recipient_user_id,event_key,kind,category,target_type,target_id,community_id')
      .eq('target_id', events[eventKey]!);
    expect(result.error, `${who.name} inbox`).toBeNull();
    return result.data ?? [];
  };
  const cutoffAlerts = (rows: SqlRow[]): SqlRow[] =>
    rows.filter((row) => (CUTOFF_KINDS as readonly string[]).includes(String(row['kind'])));
  const notificationsOfKind = async (
    who: Actor,
    kind: string,
    eventKey: string
  ): Promise<SqlRow[]> => {
    const result = await who.client
      .from('notifications')
      .select('id,kind,target_id')
      .eq('kind', kind)
      .eq('target_id', events[eventKey]!);
    expect(result.error, `${who.name} ${kind} inbox`).toBeNull();
    return result.data ?? [];
  };
  /** Revision-keyed key shape for the two cutoff kinds. */
  const expectCutoffKey = (
    row: SqlRow,
    prefix: string,
    eventKey: string,
    revision: number,
    recipient: Actor
  ): void => {
    const parts = String(row['event_key']).split(':');
    expect(parts, `${prefix} key shape`).toHaveLength(4);
    expect(parts[0]).toBe(prefix);
    expect(parts[1]).toBe(events[eventKey]!);
    expect(Number(parts[2]), `${prefix} revision segment`).toBe(revision);
    expect(parts[3], `${prefix} recipient segment`).toBe(recipient.id);
    expect(row['kind']).toBe(
      prefix === 'match.cutoff_expired'
        ? 'match_registration_expired'
        : 'match_registration_not_playing'
    );
  };

  // --- trusted-channel helpers ---------------------------------------------------

  /** Runs the internal per-event processor as the database owner. */
  const processCutoff = async (eventKey: string): Promise<Record<string, unknown>> => {
    const rows = await sqlRows(
      `select public.process_match_event_registration_cutoff('${events[eventKey]!}') as result`
    );
    return asRecord(rows[0]!['result']);
  };
  /** Runs the restricted bounded batch as the database owner. */
  const processBatch = async (limit: number): Promise<Record<string, unknown>> => {
    const rows = await sqlRows(
      `select public.process_due_match_event_registration_cutoffs(${limit}) as result`
    );
    return asRecord(rows[0]!['result']);
  };
  /** The processor shaped as an RPC result so it can race browser RPCs. */
  const processorAsRpc = (eventKey: string): Promise<RpcResult> =>
    processCutoff(eventKey).then(
      (data) => ({ data, error: null }),
      (error: unknown): RpcResult => ({
        data: null,
        error: { code: 'P0001', message: String(error) }
      })
    );
  /**
   * DB-time fixture: moves one event's cutoff to an arbitrary clock expression.
   * Trusted, transaction-scoped immutability-trigger bypass (never the
   * production clock).
   */
  const setCutoff = (eventKey: string, expression: string): Promise<void> =>
    fixtureSql(
      [
        `do $$ begin`,
        `alter table public.match_events disable trigger match_event_immutable;`,
        `update public.match_events set registration_cutoff_at = ${expression} where id = '${events[eventKey]!}';`,
        `alter table public.match_events enable trigger match_event_immutable;`,
        `end $$;`
      ].join('\n')
    );
  const cutoffMarker = async (eventKey: string): Promise<string | null> => {
    const rows = await sqlRows(
      `select cutoff_processed_at::text as marker
         from public.match_event_registration_state
        where match_event_id = '${events[eventKey]!}'`
    );
    expect(rows, `state row for ${eventKey}`).toHaveLength(1);
    const marker = rows[0]!['marker'];
    return typeof marker === 'string' ? marker : null;
  };
  /** Durable per-event failure record the operator can query (F24). */
  const failureRecordOf = async (eventKey: string): Promise<SqlRow> => {
    const rows = await sqlRows(
      `select cutoff_failure_count::int as failure_count,
              cutoff_last_failure_sqlstate as sqlstate,
              cutoff_last_failure_message as message,
              cutoff_last_failure_at is not null as stamped,
              cutoff_attempt_count::int as attempt_count
         from public.match_event_registration_state
        where match_event_id = '${events[eventKey]!}'`
    );
    expect(rows, `failure record for ${eventKey}`).toHaveLength(1);
    return rows[0]!;
  };
  /** Cutoff marker by raw event id (used by the starvation fixtures). */
  const cutoffProcessedById = async (eventId: string): Promise<boolean> => {
    const rows = await sqlRows(
      `select cutoff_processed_at is not null as processed
         from public.match_event_registration_state where match_event_id = '${eventId}'`
    );
    expect(rows, `state row for ${eventId}`).toHaveLength(1);
    return rows[0]!['processed'] === true;
  };
  /** Lifecycle/stored-participation rows ordered by accepted ordinal, pendings last. */
  const storedRows = async (eventKey: string): Promise<SqlRow[]> =>
    sqlRows(
      `select r.user_id::text as user_id, r.lifecycle::text as lifecycle,
              r.participation_status::text as participation, r.accepted_order::int as ordinal,
              r.resolved_at is not null as resolved
         from public.match_event_registrations r
        where r.match_event_id = '${events[eventKey]!}'
        order by r.accepted_order nulls last, r.requested_at nulls last`
    );
  const storedRowOf = async (eventKey: string, who: Actor): Promise<SqlRow> => {
    const rows = await storedRows(eventKey);
    const row = rows.find((candidate) => candidate['user_id'] === who.id);
    expect(row, `stored row of ${who.name} on ${eventKey}`).toBeDefined();
    return row!;
  };
  const attemptsOf = async (eventKey: string, who: Actor): Promise<SqlRow[]> =>
    sqlRows(
      `select outcome::text as outcome, decided_at is not null as decided, actor_id::text as actor
         from public.match_event_registration_attempts
        where match_event_id = '${events[eventKey]!}' and user_id = '${who.id}'
        order by requested_at, id`
    );
  const membershipTotal = async (): Promise<number> =>
    Number(
      (
        await sqlRows(
          `select pg_catalog.count(*)::int as n from public.community_members where community_id = '${publicCommunity}'`
        )
      )[0]!['n']
    );
  /**
   * Cutoff-aware positional oracle: the stored participation of every accepted
   * row must equal the derived roster expectation and positions stay
   * contiguous. Unlike the pre-cutoff FIFO helper it does not assume
   * reserve = accepted - playing, because past the cutoff the residual Reserve
   * legitimately becomes Reserve Not Playing.
   */
  const expectCutoffRoster = async (eventKey: string): Promise<void> => {
    const rows = await sqlRows(
      `select r.id::text as rid, r.participation_status::text as stored,
              q.roster_position::int as pos, q.participation_status::text as derived
         from public.match_event_registrations r
         join public.match_registration_roster('${events[eventKey]!}') q on q.registration_id = r.id
        order by q.roster_position`
    );
    rows.forEach((row, index) => {
      expect(Number(row['pos']), `roster position ${index + 1} on ${eventKey}`).toBe(index + 1);
      expect(row['stored'], `stored participation of ${String(row['rid'])}`).toBe(row['derived']);
    });
  };

  /**
   * Proven-overlap barrier for cutoff races. A trusted holder keeps the
   * community row locked (the first lock every registration RPC and the
   * processor must take) while the contenders are fired. A trusted-SQL
   * contender spawns through `supabase db query`, whose startup can take
   * seconds, so the database itself is polled until EVERY contender backend is
   * visible, active and lock-waiting behind the holder — at that point each
   * one is necessarily blocked on the chain. The in-database proof then
   * verifies the wait chain (expected blocked count, at least one directly
   * behind the holder) before `whileBlocked` runs — the cutoff move cannot
   * block because nobody in the chain holds the match_events row — and the
   * holder is terminated so the contenders proceed back-to-back. Overlap is
   * observed inside Postgres, never assumed from Promise.all or sleeps.
   */
  const raceBarrier = async <T>(params: {
    /** SQL regex fragment matching every contender query. */
    rpcPattern: string;
    fire: () => readonly [PromiseLike<T>, PromiseLike<T>];
    whileBlocked?: () => Promise<void>;
  }): Promise<[T, T]> => {
    const marker = `paf54-holder-${crypto.randomUUID().replaceAll('-', '')}`;
    const holder = startSql(
      `/* ${marker} */ select pg_catalog.pg_sleep(900) from (select id from public.communities where id = '${publicCommunity}' for update) locked;`
    );
    let probe: SqlHandle | null = null;
    try {
      const [holderRow] = await waitForRows(
        `select pid as value from pg_catalog.pg_stat_activity
          where query like '%${marker}%' and state = 'active' and pid <> pg_catalog.pg_backend_pid()`,
        (rows) => rows.length === 1,
        'the trusted lock holder backend',
        20000,
        100
      );
      const holderPid = Number(holderRow!['value']);
      expect(Number.isInteger(holderPid), 'holder pid').toBe(true);
      const contenders = params.fire();
      // With the holder sleeping on the community row, an active contender
      // running the contender query is a blocked contender.
      await waitForRows(
        `select pg_catalog.count(*)::int as value from pg_catalog.pg_stat_activity
          where query ~ '(${params.rpcPattern})' and state = 'active'
            and wait_event_type = 'Lock'
            and pid <> pg_catalog.pg_backend_pid() and pid <> ${holderPid}`,
        (rows) => Number(rows[0]!['value']) === 2,
        '2 blocked contender backends',
        60000,
        50
      );
      // Strict in-database proof: every contender is lock-waiting and at least
      // one sits directly behind the holder.
      probe = startSql(`do $barrier$
        declare
          v_blocked integer;
          v_holder_direct integer;
        begin
          select pg_catalog.count(*),
                 pg_catalog.count(*) filter (where ${holderPid} = any(pg_catalog.pg_blocking_pids(pid)))
            into v_blocked, v_holder_direct
            from pg_catalog.pg_stat_activity
           where wait_event_type = 'Lock'
             and query ~ '(${params.rpcPattern})'
             and pid <> pg_catalog.pg_backend_pid()
             and pid <> ${holderPid};
          if v_blocked <> 2 or v_holder_direct < 1 then
            raise exception 'cutoff barrier not proven: blocked=% holder_direct=%', v_blocked, v_holder_direct;
          end if;
        end $barrier$;`);
      const probeResult = await withDeadline(probe.done, 30000, 'cutoff barrier proof');
      if (probeResult.code !== 0)
        throw new Error(
          `Cutoff barrier proof failed (${probeResult.code}): ${probeResult.stdout}\n${probeResult.stderr}`
        );
      if (params.whileBlocked) await params.whileBlocked();
      await sqlRows(`select pg_catalog.pg_terminate_backend(${holderPid}) as released`);
      return Promise.all(contenders);
    } finally {
      await sqlRows(
        `select pg_catalog.pg_terminate_backend(pid) as swept from pg_catalog.pg_stat_activity
          where query like '%${marker}%' and pid <> pg_catalog.pg_backend_pid()`
      ).catch(() => []);
      if (probe) await probe.stop();
      await holder.stop();
    }
  };

  it('seeds actors, communities and events through the trusted channel', async () => {
    const env = environment.env!;
    rawRpc = makeRawRpc(env.url, env.key);
    const roster = ['creator', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'g1', 'g2', 'g3', 'g4'];
    const newActor = async (label: string): Promise<Actor> => {
      const signup = await createClient(env.url, env.key, {
        auth: { persistSession: false, autoRefreshToken: false }
      }).auth.signUp({
        email: `paf54-cutoff-${label}-${crypto.randomUUID()}@test.local`,
        password: 'Password123!'
      });
      expect(signup.error, `${label} signup`).toBeNull();
      expect(signup.data.session, 'local email confirmations must be disabled').not.toBeNull();
      const token = signup.data.session!.access_token;
      const client = createClient<Database>(env.url, env.key, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } }
      });
      return { id: signup.data.user!.id, token, client, name: `Cutoff ${label}` };
    };
    const created = await Promise.all(roster.map((label) => newActor(label)));
    roster.forEach((label, index) => {
      actors[label] = created[index]!;
    });
    for (const eventKey of [
      'before',
      'after',
      'blocked',
      'effective',
      'ownread',
      'mixed',
      'complete',
      'thin',
      'racejoin',
      'raceapprove',
      'rollback',
      'due1',
      'due2',
      'duefail',
      'catchup'
    ])
      events[eventKey] = crypto.randomUUID();
    publicCommunity = crypto.randomUUID();
    const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
    const insertEvent = (eventKey: string, cutoffExpression: string) =>
      `insert into public.match_events(
        id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,
        venue_name,maps_url,photo_path,restriction_enabled,min_level,max_level,maximum_registrations,registration_cutoff_at)
        values (${q(events[eventKey]!)},${q(publicCommunity)},${q(actors.creator!.id)},
          now() + interval '10 days','UTC','friendly','community_open','POST_MATCH_TEAMS',
          'Cutoff court','https://maps.google.com/maps/place/cutoff','${crypto.randomUUID()}/photo.webp',
          false,null,null,null,${cutoffExpression});`;
    // Accepted member row at a given ordinal with an explicit stored
    // participation state, mirroring what the FIFO engine persists.
    const acceptedMember = (eventKey: string, label: string, ordinal: number, status: string) =>
      `insert into public.match_event_registrations(
        match_event_id,user_id,lifecycle,accepted_at,accepted_order,participation_status,registration_source,requested_at)
        values (${q(events[eventKey]!)},${q(actors[label]!.id)},'accepted',
          now() - interval '1 day' + (${ordinal} * interval '1 minute'),${ordinal},'${status}','member',
          now() - interval '1 day' + (${ordinal} * interval '1 minute'));`;
    const pendingGuest = (eventKey: string, label: string) =>
      `insert into public.match_event_registrations(match_event_id,user_id,lifecycle,requested_at,registration_source)
         values (${q(events[eventKey]!)},${q(actors[label]!.id)},'pending',now() - interval '1 hour','guest');
       insert into public.match_event_registration_attempts(match_event_id,user_id,requested_at,outcome)
         values (${q(events[eventKey]!)},${q(actors[label]!.id)},now() - interval '1 hour','pending');`;
    const creatorPlaying = (eventKey: string) =>
      `update public.match_event_registrations set participation_status = 'playing'
        where match_event_id = ${q(events[eventKey]!)} and accepted_order = 1;`;
    const due = `pg_catalog.clock_timestamp() - interval '5 seconds'`;
    await fixtureSql(
      [
        `do $$ begin`,
        `insert into public.communities(id,name,visibility,created_by) values
          (${q(publicCommunity)},'Cutoff public fixture','public',${q(actors.creator!.id)});`,
        `insert into public.community_members(community_id,user_id,role,status,valid_from,activated_at) values
          (${q(publicCommunity)},${q(actors.creator!.id)},'admin','active',now()-interval '1 minute',now()-interval '1 minute'),`,
        ...['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].map(
          (label, index) =>
            `${index === 0 ? '' : ','}(${q(publicCommunity)},${q(actors[label]!.id)},'member','active',now()-interval '1 minute',now()-interval '1 minute')`
        ),
        `;`,
        `alter table public.match_events disable trigger lock_match_photo_publication;`,
        // The publication alert would pollute exact inbox assertions; every
        // cutoff producer under test stays live.
        `alter table public.match_events disable trigger match_event_published_notification;`,
        // Boundary events start open; each probe moves its cutoff explicitly.
        insertEvent('before', `now() + interval '7 days'`),
        insertEvent('after', `now() + interval '7 days'`),
        insertEvent('blocked', `now() + interval '7 days'`),
        // Effective-read event: due and unprocessed for its whole test.
        insertEvent('effective', due),
        creatorPlaying('effective'),
        acceptedMember('effective', 'm1', 2, 'playing'),
        acceptedMember('effective', 'm2', 3, 'playing'),
        acceptedMember('effective', 'm3', 4, 'playing'),
        acceptedMember('effective', 'm4', 5, 'reserve'),
        `update public.match_event_registration_state set next_accepted_ordinal = 6
          where match_event_id = ${q(events['effective']!)};`,
        // Own-registration effective-read event: due, unprocessed, one pending.
        insertEvent('ownread', due),
        pendingGuest('ownread', 'g4'),
        `update public.match_event_registration_state set next_accepted_ordinal = 2
          where match_event_id = ${q(events['ownread']!)};`,
        // Mixed event: N=5 (first quartet playing + one reserve) and two pendings.
        insertEvent('mixed', due),
        creatorPlaying('mixed'),
        acceptedMember('mixed', 'm1', 2, 'playing'),
        acceptedMember('mixed', 'm2', 3, 'playing'),
        acceptedMember('mixed', 'm3', 4, 'playing'),
        acceptedMember('mixed', 'm4', 5, 'reserve'),
        pendingGuest('mixed', 'g1'),
        pendingGuest('mixed', 'g2'),
        `update public.match_event_registration_state set next_accepted_ordinal = 6
          where match_event_id = ${q(events['mixed']!)};`,
        // Complete quartet: four playing, nothing residual.
        insertEvent('complete', due),
        creatorPlaying('complete'),
        acceptedMember('complete', 'm1', 2, 'playing'),
        acceptedMember('complete', 'm2', 3, 'playing'),
        acceptedMember('complete', 'm3', 4, 'playing'),
        `update public.match_event_registration_state set next_accepted_ordinal = 5
          where match_event_id = ${q(events['complete']!)};`,
        // Thin event: N=2, everyone residual Reserve including the creator.
        insertEvent('thin', due),
        acceptedMember('thin', 'm1', 2, 'reserve'),
        `update public.match_event_registration_state set next_accepted_ordinal = 3
          where match_event_id = ${q(events['thin']!)};`,
        // Race events: due with one pending request each.
        insertEvent('racejoin', due),
        pendingGuest('racejoin', 'g1'),
        insertEvent('raceapprove', due),
        pendingGuest('raceapprove', 'g2'),
        // Rollback event: N=2 plus one pending, due.
        insertEvent('rollback', due),
        acceptedMember('rollback', 'm1', 2, 'reserve'),
        pendingGuest('rollback', 'g3'),
        `update public.match_event_registration_state set next_accepted_ordinal = 3
          where match_event_id = ${q(events['rollback']!)};`,
        // Batch events: two healthy, one that will fail, one long overdue.
        insertEvent('due1', due),
        insertEvent('due2', due),
        insertEvent('duefail', due),
        acceptedMember('duefail', 'm1', 2, 'reserve'),
        pendingGuest('duefail', 'g4'),
        `update public.match_event_registration_state set next_accepted_ordinal = 3
          where match_event_id = ${q(events['duefail']!)};`,
        // Long-overdue catch-up event.
        insertEvent('catchup', `pg_catalog.clock_timestamp() - interval '2 hours'`),
        `alter table public.match_events enable trigger match_event_published_notification;`,
        `alter table public.match_events enable trigger lock_match_photo_publication;`,
        `end $$;`
      ].join('\n')
    );
    const expectedNext: Record<string, number> = {
      before: 2,
      after: 2,
      blocked: 2,
      effective: 6,
      ownread: 2,
      mixed: 6,
      complete: 5,
      thin: 3,
      racejoin: 2,
      raceapprove: 2,
      rollback: 3,
      due1: 2,
      due2: 2,
      duefail: 3,
      catchup: 2
    };
    for (const [eventKey, next] of Object.entries(expectedNext)) {
      expect(await registrationStateById(events[eventKey]!), `${eventKey} initial state`).toEqual({
        next,
        revision: 0
      });
      expect(await cutoffMarker(eventKey), `${eventKey} initial marker`).toBeNull();
    }
  });

  it.skipIf(!environment.env)(
    'treats the cutoff boundary as closed at equality and after, open strictly before, with committed approvals still replaying',
    async () => {
      // Just BEFORE the cutoff everything behaves normally.
      await setCutoff('before', `pg_catalog.clock_timestamp() + interval '10 seconds'`);
      const joined = await submit(actors.m1!, 'before');
      expect(joined.error, 'pre-cutoff direct join').toBeNull();
      expect(asRecord(joined.data)).toMatchObject({ lifecycle: 'accepted', accepted_order: 2 });
      for (const guest of ['g1', 'g2'] as const) {
        const request = await submit(actors[guest]!, 'before');
        expect(request.error, `${guest} pre-cutoff request`).toBeNull();
        expect(asRecord(request.data)['lifecycle']).toBe('pending');
      }
      const committed = await decide(actors.creator!, 'before', actors.g1!.id, 'approve');
      expect(committed.error, 'pre-cutoff approval').toBeNull();
      const committedData = asRecord(committed.data);
      expect(committedData).toMatchObject({ lifecycle: 'accepted', replayed: false });
      await expectRosterAgreement(events.before!);

      // AT exactly the cutoff (equality is CLOSED): the fixture pins the cutoff
      // to the DB instant of the fixture statement, so every later DB clock
      // read under lock is at-or-after it — a refusal here proves the boundary
      // comparison is closed at equality, not merely after it.
      await setCutoff('before', `pg_catalog.clock_timestamp()`);
      await expectDomainError(submit(actors.m2!, 'before'), 'MATCH_REGISTRATION_CLOSED');
      await expectDomainError(
        decide(actors.creator!, 'before', actors.g2!.id, 'approve'),
        'MATCH_REGISTRATION_CLOSED'
      );

      // An approval already committed BEFORE the cutoff still replays after it
      // with the original anchors: no late promotion, no new timestamp.
      const replay = await decide(actors.creator!, 'before', actors.g1!.id, 'approve');
      expect(replay.error, 'post-cutoff replay').toBeNull();
      const replayData = asRecord(replay.data);
      expect(replayData['replayed']).toBe(true);
      expect(replayData['accepted_at']).toBe(committedData['accepted_at']);
      expect(replayData['approved_at']).toBe(committedData['approved_at']);
      expect(replayData['accepted_order']).toBe(committedData['accepted_order']);
      // Two genuine mutations happened pre-cutoff (m1's join, g1's approval);
      // the replay and both refusals consumed no revision.
      expect(await registrationStateById(events.before!)).toEqual({ next: 4, revision: 2 });

      // The processor agrees: equality is DUE, not "not due".
      const processed = await processCutoff('before');
      expect(processed).toMatchObject({ processed: true, reason: 'processed', expired_count: 1 });
      expect(await cutoffMarker('before')).not.toBeNull();

      // JUST AFTER the cutoff: brand-new submissions and approvals are refused.
      // One request is seeded while the event is still open.
      const afterRequest = await submit(actors.g3!, 'after');
      expect(afterRequest.error, 'g3 pre-cutoff request on after').toBeNull();
      expect(asRecord(afterRequest.data)['lifecycle']).toBe('pending');
      await setCutoff('after', `pg_catalog.clock_timestamp() - interval '1 second'`);
      await expectDomainError(submit(actors.m3!, 'after'), 'MATCH_REGISTRATION_CLOSED');
      await expectDomainError(
        decide(actors.creator!, 'after', actors.g3!.id, 'approve'),
        'MATCH_REGISTRATION_CLOSED'
      );
      // The refusals consumed nothing: no row for m3, g3 still pending.
      const m3Row = await sqlRows(
        `select 1 as found from public.match_event_registrations
          where match_event_id = '${events.after!}' and user_id = '${actors.m3!.id}'`
      );
      expect(m3Row).toEqual([]);
      const g3 = await storedRowOf('after', actors.g3!);
      expect(g3['lifecycle']).toBe('pending');
      expect(await registrationStateById(events.after!)).toEqual({ next: 2, revision: 0 });
    }
  );

  it.skipIf(!environment.env)(
    'refuses a submission and an approval that were blocked across the cutoff, proving genuine overlap before the clock moves',
    async () => {
      // Pre-cutoff seeding while the event is still open.
      const joined = await submit(actors.m4!, 'blocked');
      expect(joined.error, 'pre-cutoff join on blocked').toBeNull();
      const request = await submit(actors.g4!, 'blocked');
      expect(request.error, 'pre-cutoff request on blocked').toBeNull();
      const stateBefore = await registrationStateById(events.blocked!);
      expect(stateBefore).toEqual({ next: 3, revision: 1 });
      const attemptG4 = await latestAttemptId('blocked', actors.g4!.id);

      // Hold the community row; fire a direct join and a creator approval;
      // prove BOTH are blocked on that chain inside the database; only then
      // move the cutoff past the DB clock and release.
      const [joinOutcome, approvalOutcome] = await raceBarrier({
        rpcPattern: 'submit_match_registration|decide_match_registration',
        fire: () => [
          rawRpc(actors.m5!, 'submit_match_registration', { p_match_event_id: events.blocked! }),
          rawRpc(actors.creator!, 'decide_match_registration', {
            p_match_event_id: events.blocked!,
            p_attempt_id: attemptG4,
            p_decision: 'approve'
          })
        ],
        whileBlocked: () =>
          setCutoff('blocked', `pg_catalog.clock_timestamp() - interval '1 second'`)
      });
      expect(joinOutcome.error, 'blocked join must lose').not.toBeNull();
      expect(joinOutcome.error!.code).toBe('P0001');
      expect(joinOutcome.error!.message).toBe('MATCH_REGISTRATION_CLOSED');
      expect(approvalOutcome.error, 'blocked approval must lose').not.toBeNull();
      expect(approvalOutcome.error!.code).toBe('P0001');
      expect(approvalOutcome.error!.message).toBe('MATCH_REGISTRATION_CLOSED');

      // The blocked transactions left nothing behind: no row for m5, the
      // request is still pending (NOT expired — the processor never ran), no
      // ordinal, no revision, no alert.
      const m5Row = await sqlRows(
        `select 1 as found from public.match_event_registrations
          where match_event_id = '${events.blocked!}' and user_id = '${actors.m5!.id}'`
      );
      expect(m5Row).toEqual([]);
      const g4 = await storedRowOf('blocked', actors.g4!);
      expect(g4['lifecycle']).toBe('pending');
      expect(await registrationStateById(events.blocked!)).toEqual(stateBefore);
      expect(await cutoffMarker('blocked')).toBeNull();
      expect(await inboxOf(actors.g4!, 'blocked')).toEqual([]);
      expect(await inboxOf(actors.m5!, 'blocked')).toEqual([]);
    }
  );

  it.skipIf(!environment.env)(
    'reports the effective not-playing status on reads while the event is due but unprocessed, writing nothing',
    async () => {
      const markerBefore = await cutoffMarker('effective');
      const stateBefore = await registrationStateById(events.effective!);
      const storedBefore = await storedRowOf('effective', actors.m4!);
      expect(storedBefore['participation']).toBe('reserve');

      // The reserve player reads the event: residual Reserve already reports
      // as Reserve Not Playing on the flat detail DTO.
      const detail = await detailAs(actors.m4!, 'effective');
      expect(detail).toMatchObject({
        accepted_count: 5,
        playing_count: 4,
        reserve_count: 0,
        reserve_not_playing_count: 1,
        caller_badge: 'reserve_not_playing'
      });

      // The same holds on the list surface.
      const listed = await listAs(actors.m4!, 'my');
      const row = listed.find((item) => item['event_id'] === events.effective);
      expect(row, 'effective event in my list').toBeDefined();
      expect(row).toMatchObject({
        reserve_count: 0,
        reserve_not_playing_count: 1,
        caller_badge: 'reserve_not_playing'
      });

      // ...and the creator queue carries the split counts too.
      expect(await queueAs(actors.creator!, 'effective')).toMatchObject({
        accepted_count: 5,
        playing_count: 4,
        reserve_count: 0,
        reserve_not_playing_count: 1
      });

      // No write happened anywhere: marker unset, stored status untouched.
      expect(await cutoffMarker('effective')).toBe(markerBefore);
      expect(await registrationStateById(events.effective!)).toEqual(stateBefore);
      const storedAfter = await storedRowOf('effective', actors.m4!);
      expect(storedAfter['participation']).toBe('reserve');
    }
  );

  it.skipIf(!environment.env)(
    'projects the DB-time effective expiry on the caller own-registration read while due but unprocessed, writing nothing',
    async () => {
      const markerBefore = await cutoffMarker('ownread');
      expect((await storedRowOf('ownread', actors.g4!))['lifecycle']).toBe('pending');

      // F23: before the processor runs, the pending request already reads as
      // expired because the DB clock is past the cutoff — the same effective
      // projection the roster applies to reserve_not_playing.
      const effective = await ownRegistrationAs(actors.g4!, 'ownread');
      expect(effective).toMatchObject({ lifecycle: 'expired', registration_source: 'guest' });

      // The read is side-effect free: no marker, stored lifecycle untouched.
      expect(await cutoffMarker('ownread')).toBe(markerBefore);
      expect((await storedRowOf('ownread', actors.g4!))['lifecycle']).toBe('pending');

      // The processor persists the same effective state; the read agrees after.
      const processed = await processCutoff('ownread');
      expect(processed).toMatchObject({ processed: true, expired_count: 1 });
      expect((await ownRegistrationAs(actors.g4!, 'ownread'))['lifecycle']).toBe('expired');
      expect((await storedRowOf('ownread', actors.g4!))['lifecycle']).toBe('expired');
    }
  );

  it.skipIf(!environment.env)(
    'expires every pending request and flips only the residual Reserve, preserving the complete quartet and the accepted order',
    async () => {
      const membershipBefore = await membershipTotal();
      const stateBefore = await registrationStateById(events.mixed!);
      expect(stateBefore).toEqual({ next: 6, revision: 0 });
      const baselineInboxes = new Map<string, SqlRow[]>();
      for (const label of ['creator', 'm1', 'm2', 'm3', 'm4', 'g1', 'g2']) {
        baselineInboxes.set(label, await inboxOf(actors[label]!, 'mixed'));
        expect(baselineInboxes.get(label), `${label} starts silent`).toEqual([]);
      }

      const processed = await processCutoff('mixed');
      expect(processed).toMatchObject({
        processed: true,
        reason: 'processed',
        expired_count: 2,
        accepted_count: 5,
        playing_count: 4,
        reserve_count: 0,
        reserve_not_playing_count: 1,
        transition_revision: 1
      });

      // Pending rows: expired, resolved by nobody, and still anchor-free.
      for (const guest of ['g1', 'g2'] as const) {
        const row = await storedRowOf('mixed', actors[guest]!);
        expect(row).toMatchObject({ lifecycle: 'expired', participation: null, ordinal: null });
        expect(row['resolved']).toBe(true);
        const attempts = await attemptsOf('mixed', actors[guest]!);
        expect(attempts).toHaveLength(1);
        expect(attempts[0]).toMatchObject({ outcome: 'expired', decided: true, actor: null });
      }
      // No membership side effect for anyone.
      expect(await membershipTotal()).toBe(membershipBefore);

      // The stored roster: quartet untouched, ONLY the residual reserve flipped.
      const rows = await storedRows('mixed');
      expect(rows).toHaveLength(7);
      expect(
        rows
          .filter((row) => row['lifecycle'] === 'accepted')
          .map((row) => [row['user_id'], row['ordinal'], row['participation']])
      ).toEqual([
        [actors.creator!.id, 1, 'playing'],
        [actors.m1!.id, 2, 'playing'],
        [actors.m2!.id, 3, 'playing'],
        [actors.m3!.id, 4, 'playing'],
        [actors.m4!.id, 5, 'reserve_not_playing']
      ]);
      await expectCutoffRoster('mixed');
      await expectOrdinalInvariants(events.mixed!, { nextAcceptedOrdinal: 6 });

      // Exactly-once scoped alerts: expiry to each requester, not-playing to
      // the flipped reserve, nothing to the quartet.
      for (const guest of ['g1', 'g2'] as const) {
        const alerts = cutoffAlerts(await inboxOf(actors[guest]!, 'mixed'));
        expect(alerts, `${guest} expiry alert`).toHaveLength(1);
        expectCutoffKey(alerts[0]!, 'match.cutoff_expired', 'mixed', 1, actors[guest]!);
      }
      const m4Alerts = cutoffAlerts(await inboxOf(actors.m4!, 'mixed'));
      expect(m4Alerts).toHaveLength(1);
      expectCutoffKey(m4Alerts[0]!, 'match.cutoff_not_playing', 'mixed', 1, actors.m4!);
      for (const label of ['creator', 'm1', 'm2', 'm3'] as const) {
        expect(cutoffAlerts(await inboxOf(actors[label]!, 'mixed')), `${label} unaffected`).toEqual(
          []
        );
      }

      // Counts never conflate: all four counts, on the counts projection, the
      // detail DTO, the list DTO and the creator queue.
      const counts = await sqlRows(
        `select accepted_count::int as accepted, playing_count::int as playing,
                reserve_count::int as reserve, reserve_not_playing_count::int as not_playing
           from public.match_registration_counts('${events.mixed!}')`
      );
      expect(counts[0]).toMatchObject({ accepted: 5, playing: 4, reserve: 0, not_playing: 1 });
      const creatorDetail = await detailAs(actors.creator!, 'mixed');
      expect(creatorDetail).toMatchObject({
        accepted_count: 5,
        playing_count: 4,
        reserve_count: 0,
        reserve_not_playing_count: 1
      });
      const m4Detail = await detailAs(actors.m4!, 'mixed');
      expect(m4Detail['caller_badge']).toBe('reserve_not_playing');
      const listed = await listAs(actors.m4!, 'my');
      expect(listed.find((item) => item['event_id'] === events.mixed)).toMatchObject({
        reserve_count: 0,
        reserve_not_playing_count: 1
      });
      expect(await queueAs(actors.creator!, 'mixed')).toMatchObject({
        accepted_count: 5,
        playing_count: 4,
        reserve_count: 0,
        reserve_not_playing_count: 1
      });
    }
  );

  it.skipIf(!environment.env)(
    'makes a second processor run a no-op: already-processed, same marker, no second alert and no second revision bump',
    async () => {
      const markerBefore = await cutoffMarker('mixed');
      const stateBefore = await registrationStateById(events.mixed!);
      const inboxesBefore = new Map<string, SqlRow[]>();
      for (const label of ['creator', 'm1', 'm2', 'm3', 'm4', 'g1', 'g2']) {
        inboxesBefore.set(label, await inboxOf(actors[label]!, 'mixed'));
      }

      const second = await processCutoff('mixed');
      expect(second).toMatchObject({ processed: false, reason: 'already_processed' });
      expect(await cutoffMarker('mixed')).toBe(markerBefore);
      expect(await registrationStateById(events.mixed!)).toEqual(stateBefore);
      for (const label of ['creator', 'm1', 'm2', 'm3', 'm4', 'g1', 'g2']) {
        expect(await inboxOf(actors[label]!, 'mixed')).toEqual(inboxesBefore.get(label));
      }
    }
  );

  it.skipIf(!environment.env)(
    'serializes concurrent processors to exactly one transition and flips every accepted player including the creator when N < 4',
    async () => {
      const stateBefore = await registrationStateById(events.thin!);
      expect(stateBefore).toEqual({ next: 3, revision: 0 });

      const [first, second] = await raceBarrier({
        rpcPattern: 'process_match_event_registration_cutoff',
        fire: () => [processorAsRpc('thin'), processorAsRpc('thin')]
      });
      expect(first.error, 'processor contender one').toBeNull();
      expect(second.error, 'processor contender two').toBeNull();
      const outcomes = [asRecord(first.data), asRecord(second.data)];
      // Deterministic pair: one genuine transition, one already-processed
      // no-op — regardless of which backend won the lock.
      expect(outcomes.map((outcome) => String(outcome['processed'])).sort()).toEqual([
        'false',
        'true'
      ]);
      const winner = outcomes.find((outcome) => outcome['processed'] === true)!;
      expect(winner).toMatchObject({
        reason: 'processed',
        expired_count: 0,
        accepted_count: 2,
        playing_count: 0,
        reserve_count: 0,
        reserve_not_playing_count: 2,
        transition_revision: 1
      });
      expect(outcomes.find((outcome) => outcome['processed'] === false)!['reason']).toBe(
        'already_processed'
      );

      // EVERY accepted player flipped, including the creator.
      const rows = await storedRows('thin');
      expect(rows.map((row) => [row['user_id'], row['ordinal'], row['participation']])).toEqual([
        [actors.creator!.id, 1, 'reserve_not_playing'],
        [actors.m1!.id, 2, 'reserve_not_playing']
      ]);
      await expectCutoffRoster('thin');
      await expectOrdinalInvariants(events.thin!, { nextAcceptedOrdinal: 3 });
      expect(await cutoffMarker('thin')).not.toBeNull();

      // Exactly one alert per affected player, revision-keyed once.
      for (const label of ['creator', 'm1'] as const) {
        const alerts = cutoffAlerts(await inboxOf(actors[label]!, 'thin'));
        expect(alerts, `${label} not-playing alert`).toHaveLength(1);
        expectCutoffKey(alerts[0]!, 'match.cutoff_not_playing', 'thin', 1, actors[label]!);
      }
    }
  );

  it.skipIf(!environment.env)(
    'keeps a complete quartet playable and silent: the processor writes no state change and no cutoff alert',
    async () => {
      const inboxesBefore = new Map<string, SqlRow[]>();
      for (const label of ['creator', 'm1', 'm2', 'm3']) {
        inboxesBefore.set(label, await inboxOf(actors[label]!, 'complete'));
        expect(inboxesBefore.get(label), `${label} starts silent`).toEqual([]);
      }
      const storedBefore = await storedRows('complete');

      const processed = await processCutoff('complete');
      expect(processed).toMatchObject({
        processed: true,
        reason: 'processed',
        expired_count: 0,
        accepted_count: 4,
        playing_count: 4,
        reserve_count: 0,
        reserve_not_playing_count: 0
      });

      // The four players are untouched and still playing; order preserved.
      expect(await storedRows('complete')).toEqual(storedBefore);
      await expectCutoffRoster('complete');
      const detail = await detailAs(actors.creator!, 'complete');
      expect(detail).toMatchObject({
        accepted_count: 4,
        playing_count: 4,
        reserve_count: 0,
        reserve_not_playing_count: 0
      });
      for (const label of ['creator', 'm1', 'm2', 'm3']) {
        expect(await inboxOf(actors[label]!, 'complete')).toEqual(inboxesBefore.get(label));
      }
      expect(await cutoffMarker('complete')).not.toBeNull();
    }
  );

  it.skipIf(!environment.env)(
    'resolves a direct join racing the processor without slipped-in acceptance or ordinal double-allocation',
    async () => {
      const stateBefore = await registrationStateById(events.racejoin!);
      expect(stateBefore).toEqual({ next: 2, revision: 0 });

      // The cutoff is already past, so the outcome is deterministic in BOTH
      // lock orders: the join reads a fresh clock under the lock and is
      // refused; the processor transitions exactly once.
      const [joinOutcome, processorOutcome] = await raceBarrier({
        rpcPattern: 'submit_match_registration|process_match_event_registration_cutoff',
        fire: () => [
          rawRpc(actors.m1!, 'submit_match_registration', { p_match_event_id: events.racejoin! }),
          processorAsRpc('racejoin')
        ]
      });
      expect(joinOutcome.error, 'the join must lose the cutoff').not.toBeNull();
      expect(joinOutcome.error!.message).toBe('MATCH_REGISTRATION_CLOSED');
      expect(processorOutcome.error).toBeNull();
      expect(asRecord(processorOutcome.data)).toMatchObject({
        processed: true,
        reason: 'processed',
        expired_count: 1,
        transition_revision: 1
      });

      // No slipped-in acceptance: m1 has no row, ordinals unmoved, the request
      // expired exactly once with exactly one alert.
      const m1Row = await sqlRows(
        `select 1 as found from public.match_event_registrations
          where match_event_id = '${events.racejoin!}' and user_id = '${actors.m1!.id}'`
      );
      expect(m1Row).toEqual([]);
      const g1 = await storedRowOf('racejoin', actors.g1!);
      expect(g1).toMatchObject({ lifecycle: 'expired', ordinal: null, participation: null });
      await expectOrdinalInvariants(events.racejoin!, { nextAcceptedOrdinal: 2 });
      const alerts = cutoffAlerts(await inboxOf(actors.g1!, 'racejoin'));
      expect(alerts).toHaveLength(1);
      expectCutoffKey(alerts[0]!, 'match.cutoff_expired', 'racejoin', 1, actors.g1!);
      expect(await cutoffMarker('racejoin')).not.toBeNull();
    }
  );

  it.skipIf(!environment.env)(
    'resolves an approval racing the processor to one expiry and zero acceptances',
    async () => {
      const stateBefore = await registrationStateById(events.raceapprove!);
      expect(stateBefore).toEqual({ next: 2, revision: 0 });
      const attemptG2 = await latestAttemptId('raceapprove', actors.g2!.id);

      const [approvalOutcome, processorOutcome] = await raceBarrier({
        rpcPattern: 'decide_match_registration|process_match_event_registration_cutoff',
        fire: () => [
          rawRpc(actors.creator!, 'decide_match_registration', {
            p_match_event_id: events.raceapprove!,
            p_attempt_id: attemptG2,
            p_decision: 'approve'
          }),
          processorAsRpc('raceapprove')
        ]
      });
      // Deterministic outcome in both orders: the approval never lands. If the
      // processor won, the row is already expired (ALREADY_RESOLVED); if the
      // approval went first, its own clock read refuses it (CLOSED).
      expect(approvalOutcome.error, 'the approval must not land').not.toBeNull();
      expect(['MATCH_REGISTRATION_CLOSED', 'MATCH_REGISTRATION_ALREADY_RESOLVED']).toContain(
        approvalOutcome.error!.message
      );
      expect(processorOutcome.error).toBeNull();
      expect(asRecord(processorOutcome.data)).toMatchObject({
        processed: true,
        reason: 'processed',
        expired_count: 1,
        accepted_count: 1,
        playing_count: 0,
        reserve_not_playing_count: 1,
        transition_revision: 1
      });

      // Exactly one expiry, no acceptance, no ordinal movement, one alert.
      const g2 = await storedRowOf('raceapprove', actors.g2!);
      expect(g2).toMatchObject({ lifecycle: 'expired', ordinal: null, participation: null });
      await expectOrdinalInvariants(events.raceapprove!, { nextAcceptedOrdinal: 2 });
      const alerts = cutoffAlerts(await inboxOf(actors.g2!, 'raceapprove'));
      expect(alerts).toHaveLength(1);
      expectCutoffKey(alerts[0]!, 'match.cutoff_expired', 'raceapprove', 1, actors.g2!);
      expect(await registrationStateById(events.raceapprove!)).toEqual({
        next: 2,
        revision: 1
      });
      // The creator is a genuinely affected player here (N=1 flips to
      // not-playing) and gets exactly the not-playing alert — never an
      // approval effect, because the racing approval never landed.
      const creatorAlerts = cutoffAlerts(await inboxOf(actors.creator!, 'raceapprove'));
      expect(creatorAlerts).toHaveLength(1);
      expectCutoffKey(
        creatorAlerts[0]!,
        'match.cutoff_not_playing',
        'raceapprove',
        1,
        actors.creator!
      );
      expect(
        await notificationsOfKind(actors.g2!, 'match_registration_approved', 'raceapprove')
      ).toEqual([]);
    }
  );

  it.skipIf(!environment.env)(
    'rolls the ENTIRE cutoff transition back when a notification effect fails, then succeeds cleanly after the blocker is removed',
    async () => {
      const membershipBefore = await membershipTotal();
      const stateBefore = await registrationStateById(events.rollback!);
      expect(stateBefore).toEqual({ next: 3, revision: 0 });
      const storedBefore = await storedRows('rollback');
      const baselineInboxes = new Map<string, SqlRow[]>();
      for (const label of ['creator', 'm1', 'g3']) {
        baselineInboxes.set(label, await inboxOf(actors[label]!, 'rollback'));
        expect(baselineInboxes.get(label), `${label} starts silent`).toEqual([]);
      }

      // Test-only trusted mechanism: any notification for THIS event raises.
      await fixtureSql(
        `create function public.paf54_block_cutoff_alert() returns trigger language plpgsql as $fn$ begin raise exception 'PAF54_ROLLBACK_PROOF' using errcode = 'P0001'; end $fn$;`
      );
      await fixtureSql(
        `create trigger paf54_block_cutoff_alert before insert on public.notifications for each row when (new.target_id = '${events.rollback!}') execute function public.paf54_block_cutoff_alert();`
      );

      try {
        // The failing run surfaces the blocker instead of a JSON row.
        const failing = startSql(
          `select public.process_match_event_registration_cutoff('${events.rollback!}');`
        );
        const result = await withDeadline(failing.done, 30000, 'failing processor run');
        expect(result.code, 'the blocked processor run must fail').not.toBe(0);
        expect(`${result.stdout}${result.stderr}`).toContain('PAF54_ROLLBACK_PROOF');

        // Whole-transition rollback: no marker, no expiry, no participation
        // change, no partial alert set, no membership side effect.
        expect(await cutoffMarker('rollback')).toBeNull();
        expect(await registrationStateById(events.rollback!)).toEqual(stateBefore);
        expect(await storedRows('rollback')).toEqual(storedBefore);
        for (const label of ['creator', 'm1', 'g3']) {
          expect(await inboxOf(actors[label]!, 'rollback')).toEqual(baselineInboxes.get(label));
        }
        expect(await membershipTotal()).toBe(membershipBefore);
      } finally {
        await fixtureSql(
          `drop trigger if exists paf54_block_cutoff_alert on public.notifications;`
        );
        await fixtureSql(`drop function if exists public.paf54_block_cutoff_alert();`);
      }
      const residue = await sqlRows(
        `select
           (select pg_catalog.count(*)::int from pg_catalog.pg_trigger
             where tgname = 'paf54_block_cutoff_alert' and not tgisinternal) as triggers,
           (select pg_catalog.count(*)::int from pg_catalog.pg_proc p
             join pg_catalog.pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'paf54_block_cutoff_alert') as functions`
      );
      expect(Number(residue[0]!['triggers'])).toBe(0);
      expect(Number(residue[0]!['functions'])).toBe(0);

      // With the database unpolluted, the very same transition succeeds.
      const retried = await processCutoff('rollback');
      expect(retried).toMatchObject({
        processed: true,
        reason: 'processed',
        expired_count: 1,
        accepted_count: 2,
        playing_count: 0,
        reserve_count: 0,
        reserve_not_playing_count: 2,
        transition_revision: 1
      });
      await expectCutoffRoster('rollback');
      const g3 = await storedRowOf('rollback', actors.g3!);
      expect(g3).toMatchObject({ lifecycle: 'expired', ordinal: null });
      const g3Alerts = cutoffAlerts(await inboxOf(actors.g3!, 'rollback'));
      expect(g3Alerts).toHaveLength(1);
      expectCutoffKey(g3Alerts[0]!, 'match.cutoff_expired', 'rollback', 1, actors.g3!);
      for (const label of ['creator', 'm1'] as const) {
        const alerts = cutoffAlerts(await inboxOf(actors[label]!, 'rollback'));
        expect(alerts, `${label} late not-playing alert`).toHaveLength(1);
        expectCutoffKey(alerts[0]!, 'match.cutoff_not_playing', 'rollback', 1, actors[label]!);
      }
      expect(await cutoffMarker('rollback')).not.toBeNull();
    }
  );

  it.skipIf(!environment.env)(
    'picks up overdue events by the bounded batch, isolates a failing event, and leaves the scheduler job unscheduled locally',
    async () => {
      // The batch predicate is GLOBAL, so the due slate can also carry past
      // cutoff fixtures left by suites that ran earlier in the same gate.
      // Every count below is therefore asserted relative to the slate
      // measured in the database immediately before each tick, which keeps
      // the assertions exact without depending on other suites' rows.
      const dueSlate = async (): Promise<string[]> =>
        (
          await sqlRows(
            `select e.id::text as id
               from public.match_event_registration_state s
               join public.match_events e on e.id = s.match_event_id
              where s.cutoff_processed_at is null
                and e.registration_cutoff_at <= pg_catalog.clock_timestamp()
              order by s.cutoff_attempt_count, e.registration_cutoff_at, e.id`
          )
        ).map((row) => String(row['id']));
      const myDue = ['after', 'blocked', 'effective', 'catchup', 'due1', 'due2', 'duefail'];
      const slate = await dueSlate();
      for (const eventKey of myDue) {
        expect(slate, `${eventKey} must be due and unprocessed now`).toContain(events[eventKey]);
      }

      // Bounded batch: limit 1 selects exactly the earliest due event (the
      // SQL ordering is the oracle) and processes only it.
      const firstTick = await processBatch(1);
      expect(firstTick).toMatchObject({ processed: 1, skipped: 0, failed: 0, selected: 1 });
      const earliestBefore = slate[0]!;
      const earliestMarker = await sqlRows(
        `select cutoff_processed_at is not null as processed
           from public.match_event_registration_state where match_event_id = '${earliestBefore}'`
      );
      expect(earliestMarker[0]!['processed']).toBe(true);
      expect(await cutoffMarker('due1')).toBeNull();

      // The failing event is isolated: a test-only blocker makes its effects
      // roll back while the other due events complete in the same batch.
      await fixtureSql(
        `create function public.paf54_block_duefail_alert() returns trigger language plpgsql as $fn$ begin raise exception 'PAF54_DUEFAIL_PROOF' using errcode = 'P0001'; end $fn$;`
      );
      await fixtureSql(
        `create trigger paf54_block_duefail_alert before insert on public.notifications for each row when (new.target_id = '${events.duefail!}') execute function public.paf54_block_duefail_alert();`
      );
      try {
        const remaining = await dueSlate();
        expect(remaining, 'duefail stays in the slate').toContain(events.duefail);
        const bigTick = await processBatch(50);
        expect(bigTick).toMatchObject({
          processed: remaining.length - 1,
          skipped: 0,
          failed: 1,
          selected: remaining.length
        });
        const errors = Array.isArray(bigTick['errors']) ? bigTick['errors'] : [];
        expect(errors).toHaveLength(1);
        expect(asRecord(errors[0])).toMatchObject({ event_id: events.duefail });
        expect(String(asRecord(errors[0])['message'])).toContain('PAF54_DUEFAIL_PROOF');
        // F24: the failure is retained durably on the state row, where an
        // operator can actually see it — pg_cron only records "1 row" for a
        // successful command, so the returned errors JSON never survives in
        // cron.job_run_details.
        const retained = await failureRecordOf('duefail');
        expect(retained).toMatchObject({ failure_count: 1, sqlstate: 'P0001', stamped: true });
        expect(String(retained['message'])).toContain('PAF54_DUEFAIL_PROOF');
        // A healthy event in the same batch carries no failure record.
        expect(await failureRecordOf('due1')).toMatchObject({ failure_count: 0, message: null });
        // Every one of MY due events completed except the isolated one.
        for (const eventKey of ['after', 'blocked', 'effective', 'catchup', 'due1', 'due2']) {
          expect(await cutoffMarker(eventKey), `${eventKey} processed by the batch`).not.toBeNull();
        }
        expect(await cutoffMarker('duefail')).toBeNull();
      } finally {
        await fixtureSql(
          `drop trigger if exists paf54_block_duefail_alert on public.notifications;`
        );
        await fixtureSql(`drop function if exists public.paf54_block_duefail_alert();`);
      }
      // Loud residue check: a leftover blocker here would silently poison
      // every later notifications insert for this event in the shared local
      // database, so the cleanup must be provably complete.
      const duefailResidue = await sqlRows(
        `select
           (select pg_catalog.count(*)::int from pg_catalog.pg_trigger
             where tgname = 'paf54_block_duefail_alert' and not tgisinternal) as triggers,
           (select pg_catalog.count(*)::int from pg_catalog.pg_proc p
             join pg_catalog.pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'paf54_block_duefail_alert') as functions`
      );
      expect(Number(duefailResidue[0]!['triggers'])).toBe(0);
      expect(Number(duefailResidue[0]!['functions'])).toBe(0);

      // Job definition/permissions state: pg_cron is available and functional
      // locally; the migration names a singleton 1-minute job for the batch
      // processor, and the local seed deliberately unschedules it so no live
      // job mutates fixtures mid-suite (hosted keeps the migration job).
      const extension = await sqlRows(
        `select pg_catalog.count(*)::int as n from pg_catalog.pg_extension where extname = 'pg_cron'`
      );
      expect(Number(extension[0]!['n'])).toBe(1);
      const jobs = await sqlRows(
        `select pg_catalog.count(*)::int as n from cron.job where jobname = 'padel-friend-match-registration-cutoff'`
      );
      expect(Number(jobs[0]!['n'])).toBe(0);
      const internalFns = await sqlRows(
        `select p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid) as args
           from pg_catalog.pg_proc p
           join pg_catalog.pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in ('process_match_event_registration_cutoff',
                              'process_due_match_event_registration_cutoffs',
                              'lock_match_event_registration_skip_locked')
          order by 1`
      );
      expect(internalFns.map((row) => [row['proname'], row['args']])).toEqual([
        ['lock_match_event_registration_skip_locked', 'p_event_id uuid'],
        ['process_due_match_event_registration_cutoffs', 'p_limit integer'],
        ['process_match_event_registration_cutoff', 'p_match_event_id uuid, p_skip_locked boolean']
      ]);
      const grants = await sqlRows(
        `select has_function_privilege('authenticated','public.process_match_event_registration_cutoff(uuid,boolean)','EXECUTE') as can_process,
                has_function_privilege('authenticated','public.process_due_match_event_registration_cutoffs(integer)','EXECUTE') as can_batch,
                has_function_privilege('authenticated','public.lock_match_event_registration_skip_locked(uuid)','EXECUTE') as can_lock,
                has_function_privilege('authenticated','public.get_match_event(uuid)','EXECUTE') as can_read`
      );
      expect(grants[0]).toMatchObject({
        can_process: false,
        can_batch: false,
        can_lock: false,
        can_read: true
      });
      // Live proof from the browser role: the processors and the lock helper
      // are not executable over PostgREST.
      for (const [name, body] of [
        ['process_match_event_registration_cutoff', { p_match_event_id: events.due2! }],
        ['process_due_match_event_registration_cutoffs', { p_limit: 25 }],
        ['lock_match_event_registration_skip_locked', { p_event_id: events.due2! }]
      ] as const) {
        const denied = await rawRpc(actors.m1!, name, body);
        expect(denied.error, `${name} must be denied to browser roles`).not.toBeNull();
        expect(denied.error!.code).toBe('42501');
      }

      // After the blocker is gone, the next tick catches the failed event up.
      const remainingAfterFailure = await dueSlate();
      expect(remainingAfterFailure, 'only the isolated event is left').toEqual([events.duefail]);
      const catchUpTick = await processBatch(50);
      expect(catchUpTick).toMatchObject({
        processed: remainingAfterFailure.length,
        skipped: 0,
        failed: 0,
        selected: remainingAfterFailure.length
      });
      expect(await cutoffMarker('duefail')).not.toBeNull();
      // F24: the durable failure record is cleared once the event finally
      // processes cleanly, so it always reflects the CURRENT outstanding set.
      expect(await failureRecordOf('duefail')).toMatchObject({ failure_count: 0, message: null });
      const g4Alerts = cutoffAlerts(await inboxOf(actors.g4!, 'duefail'));
      expect(g4Alerts).toHaveLength(1);
      expectCutoffKey(g4Alerts[0]!, 'match.cutoff_expired', 'duefail', 1, actors.g4!);
      for (const label of ['creator', 'm1'] as const) {
        const alerts = cutoffAlerts(await inboxOf(actors[label]!, 'duefail'));
        expect(alerts, `${label} duefail not-playing alert`).toHaveLength(1);
        expectCutoffKey(alerts[0]!, 'match.cutoff_not_playing', 'duefail', 1, actors[label]!);
      }
    }
  );

  it.skipIf(!environment.env)(
    'rotates the batch cursor so a poisoned oldest prefix cannot starve later due events',
    async () => {
      const limit = 25;
      const failingIds = Array.from({ length: limit }, () => crypto.randomUUID());
      const targetId = crypto.randomUUID();
      const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
      const eventColumns =
        `id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,` +
        `venue_name,maps_url,photo_path,registration_cutoff_at`;
      // Ancient cutoffs keep the poisoned prefix globally oldest, so a fixed
      // oldest-first LIMIT would keep selecting it forever. Every fixture lives
      // in the suite's public community; the blocker is scoped to the failing
      // event ids so the target is never affected.
      const eventInsert = (id: string, cutoff: string) =>
        `insert into public.match_events(${eventColumns}) values
          (${q(id)},${q(publicCommunity)},${q(actors.creator!.id)},now()+interval '10 days','UTC','friendly','community_open','POST_MATCH_TEAMS',
           'Starvation court','https://maps.google.com/maps/place/starvation','${crypto.randomUUID()}/photo.webp',${cutoff});`;
      const failingEvents = failingIds
        .map((id, index) =>
          eventInsert(id, `timestamptz '2000-01-01 00:00:00+00' + (${index} * interval '1 second')`)
        )
        .join('\n');
      await fixtureSql(
        [
          `do $$ begin`,
          `alter table public.match_events disable trigger lock_match_photo_publication;`,
          `alter table public.match_events disable trigger match_event_published_notification;`,
          failingEvents,
          eventInsert(targetId, `timestamptz '2000-01-02 00:00:00+00'`),
          `alter table public.match_events enable trigger match_event_published_notification;`,
          `alter table public.match_events enable trigger lock_match_photo_publication;`,
          `end $$;`
        ].join('\n')
      );
      const failingArray = failingIds.map((id) => q(id)).join(',');
      await fixtureSql(
        `create function public.paf54_block_starvation_alert() returns trigger language plpgsql as $fn$ begin raise exception 'PAF54_STARVATION_PROOF' using errcode = 'P0001'; end $fn$;`
      );
      await fixtureSql(
        `create trigger paf54_block_starvation_alert before insert on public.notifications for each row when (new.target_id = any(array[${failingArray}]::uuid[])) execute function public.paf54_block_starvation_alert();`
      );
      try {
        // Tick 1: the poisoned prefix fills the batch and every event fails.
        const tick1 = await processBatch(limit);
        expect(tick1).toMatchObject({ failed: limit, selected: limit });
        expect(await cutoffProcessedById(targetId), 'target not yet reached').toBe(false);

        // Tick 2: the attempt cursor rotated the poisoned prefix to the back, so
        // the never-attempted target is selected even though it is younger.
        await processBatch(limit);
        expect(
          await cutoffProcessedById(targetId),
          'the later due event must not be starved by the poisoned prefix'
        ).toBe(true);
      } finally {
        await fixtureSql(
          `drop trigger if exists paf54_block_starvation_alert on public.notifications;`
        );
        await fixtureSql(`drop function if exists public.paf54_block_starvation_alert();`);
        // The fixture events belong to the suite's public community and are
        // removed by the shared cleanup test below.
      }
      // Loud residue check, same contract as the other PAF54 blockers: the
      // shared local database must be verifiably clean after the finally.
      const starvationResidue = await sqlRows(
        `select
           (select pg_catalog.count(*)::int from pg_catalog.pg_trigger
             where tgname = 'paf54_block_starvation_alert' and not tgisinternal) as triggers,
           (select pg_catalog.count(*)::int from pg_catalog.pg_proc p
             join pg_catalog.pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'paf54_block_starvation_alert') as functions`
      );
      expect(Number(starvationResidue[0]!['triggers'])).toBe(0);
      expect(Number(starvationResidue[0]!['functions'])).toBe(0);
    }
  );

  it.skipIf(!environment.env)(
    'scopes each cutoff alert to its recipient only, through RLS and the typed target resolution',
    async () => {
      // The expired requester reads their own alert...
      const g1Alerts = cutoffAlerts(await inboxOf(actors.g1!, 'mixed'));
      expect(g1Alerts).toHaveLength(1);
      const expiredId = String(g1Alerts[0]!['id']);
      const ownRead = await actors
        .g1!.client.from('notifications')
        .select('id')
        .eq('id', expiredId);
      expect(ownRead.error).toBeNull();
      expect(ownRead.data).toHaveLength(1);
      // ...nobody else can, not even the creator or a fellow expired player.
      for (const outsider of [actors.creator!, actors.g2!]) {
        const foreignRead = await outsider.client
          .from('notifications')
          .select('id')
          .eq('id', expiredId);
        expect(foreignRead.error, `${outsider.name} scoped read`).toBeNull();
        expect(foreignRead.data, `${outsider.name} sees nothing`).toEqual([]);
      }

      // Same for the not-playing alert of the flipped reserve.
      const m4Alerts = cutoffAlerts(await inboxOf(actors.m4!, 'mixed'));
      expect(m4Alerts).toHaveLength(1);
      const notPlayingId = String(m4Alerts[0]!['id']);
      const foreignNotPlaying = await actors
        .g1!.client.from('notifications')
        .select('id')
        .eq('id', notPlayingId);
      expect(foreignNotPlaying.error).toBeNull();
      expect(foreignNotPlaying.data).toEqual([]);

      // The typed target resolution allows BOTH new kinds for their
      // recipients and refuses everyone else.
      for (const [who, notificationId] of [
        [actors.g1!, expiredId],
        [actors.m4!, notPlayingId]
      ] as const) {
        const target = await who.client.rpc('get_my_notification_target_v2', {
          p_notification_id: notificationId
        });
        expect(target.error, `${who.name} target resolution`).toBeNull();
        const rows: unknown[] = Array.isArray(target.data) ? target.data : [];
        expect(rows).toHaveLength(1);
        expect(asRecord(rows[0])).toMatchObject({
          target_status: 'match_available',
          match_event_id: events.mixed,
          match_available: true
        });
      }
      const foreignTarget = await actors.g2!.client.rpc('get_my_notification_target_v2', {
        p_notification_id: notPlayingId
      });
      expect(foreignTarget.error, 'foreign target resolution').not.toBeNull();
    }
  );

  it.skipIf(!environment.env)(
    'leaves no retained holder backends and cleans every fixture row from the local database',
    async () => {
      expect(await leakedHolderBackends('paf54-holder-')).toBe(0);
      const residue = await sqlRows(
        `select
           (select pg_catalog.count(*)::int from pg_catalog.pg_trigger
             where tgname like 'paf54%' and not tgisinternal) as triggers,
           (select pg_catalog.count(*)::int from pg_catalog.pg_proc p
             join pg_catalog.pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'paf54%') as functions`
      );
      expect(Number(residue[0]!['triggers'])).toBe(0);
      expect(Number(residue[0]!['functions'])).toBe(0);

      // Remove every fixture EVENT row this suite created, including stale
      // events from earlier interrupted runs: past-cutoff unprocessed events
      // would otherwise be swept by the GLOBAL batch of a later run and break
      // its exact selected/processed counts. Deletion order follows the
      // RESTRICT foreign keys; the immutable-fact triggers are bypassed
      // transactionally exactly like every other trusted fixture in this
      // suite. The community shell and its membership history stay: membership
      // rows are append-only by design (PAF-2.7) and carry no cutoff behavior.
      await fixtureSql(
        [
          `do $$ begin`,
          `alter table public.match_event_registrations disable trigger match_registration_identity_guard;`,
          `alter table public.match_events disable trigger match_event_immutable;`,
          `delete from public.notifications where community_id = '${publicCommunity}';`,
          `delete from public.match_event_registration_attempts a
             using public.match_events e
            where a.match_event_id = e.id and e.community_id = '${publicCommunity}';`,
          `delete from public.match_event_registrations r
             using public.match_events e
            where r.match_event_id = e.id and e.community_id = '${publicCommunity}';`,
          `delete from public.match_event_registration_state s
             using public.match_events e
            where s.match_event_id = e.id and e.community_id = '${publicCommunity}';`,
          `delete from public.match_events where community_id = '${publicCommunity}';`,
          `alter table public.match_events enable trigger match_event_immutable;`,
          `alter table public.match_event_registrations enable trigger match_registration_identity_guard;`,
          `end $$;`
        ].join('\n')
      );
      const leftover = await sqlRows(
        `select
           (select pg_catalog.count(*)::int from public.match_events where community_id = '${publicCommunity}') as events,
           (select pg_catalog.count(*)::int from public.match_event_registrations r
              join public.match_events e on e.id = r.match_event_id
             where e.community_id = '${publicCommunity}') as registrations,
           (select pg_catalog.count(*)::int from public.notifications where community_id = '${publicCommunity}') as notifications`
      );
      expect(leftover[0]).toMatchObject({
        events: 0,
        registrations: 0,
        notifications: 0
      });
    }
  );
});
