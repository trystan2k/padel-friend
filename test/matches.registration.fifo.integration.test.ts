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
  proveEventLockBarrier,
  registrationStateById,
  sqlRows,
  type RawRpc,
  type RpcResult
} from './helpers/match-registration-sql';

vi.setConfig({ testTimeout: 240000, hookTimeout: 120000 });

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

type Actor = { id: string; token: string; client: SupabaseClient<Database>; name: string };
type SqlRow = Record<string, unknown>;

describe('match registration FIFO integration', () => {
  it('requires local Supabase in CI', () => {
    expect(() => assertLocalSupabaseEnvInCi(environment.env, process.env.CI)).not.toThrow();
  });

  // Shared fixture: real JWT actors and trusted SQL events, one public
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
  /** The creator reads any registration row through RLS (creator policy). */
  const rowOf = async (eventKey: string, userId: string): Promise<SqlRow> => {
    const result = await actors
      .creator!.client.from('match_event_registrations')
      .select('*')
      .eq('match_event_id', events[eventKey]!)
      .eq('user_id', userId);
    expect(result.error, `creator row read ${eventKey}`).toBeNull();
    expect(result.data, `row exists on ${eventKey}`).toHaveLength(1);
    return result.data![0]!;
  };
  const inboxOf = async (who: Actor, eventKey: string): Promise<SqlRow[]> => {
    const result = await who.client
      .from('notifications')
      .select('id,recipient_user_id,event_key,kind,target_id')
      .eq('target_id', events[eventKey]!);
    expect(result.error, `${who.name} inbox`).toBeNull();
    return result.data ?? [];
  };
  const ordinalRows = async (eventKey: string): Promise<SqlRow[]> =>
    sqlRows(
      `select r.user_id::text as user_id, r.accepted_order::int as ordinal,
              r.accepted_at, r.approved_at, r.requested_at
         from public.match_event_registrations r
        where r.match_event_id = '${events[eventKey]!}' and r.lifecycle = 'accepted'
        order by r.accepted_order`
    );
  const attemptsOf = async (eventKey: string, userId: string): Promise<SqlRow[]> =>
    sqlRows(
      `select outcome, decided_at, actor_id from public.match_event_registration_attempts
        where match_event_id = '${events[eventKey]!}' and user_id = '${userId}'
        order by requested_at, id`
    );
  /** Permutation-proof comparison for race outcomes. */
  const sorted = (values: string[]): string[] => [...values].sort((a, b) => a.localeCompare(b));

  it('seeds actors, communities and events through the trusted channel', async () => {
    const env = environment.env!;
    rawRpc = makeRawRpc(env.url, env.key);
    const roster: [string, 'member' | 'guest'][] = [
      ['creator', 'member'],
      ['m1', 'member'],
      ['m2', 'member'],
      ['m3', 'member'],
      ['m4', 'member'],
      ['m5', 'member'],
      ['m6', 'member'],
      ['m7', 'member'],
      ['m8', 'member'],
      ['g1', 'guest'],
      ['g2', 'guest'],
      ['g3', 'guest'],
      ['g4', 'guest'],
      ['g5', 'guest'],
      ['g6', 'guest'],
      ['g7', 'guest'],
      ['g8', 'guest'],
      ['g9', 'guest'],
      ['g10', 'guest']
    ];
    const newActor = async (label: string): Promise<Actor> => {
      const signup = await createClient(env.url, env.key, {
        auth: { persistSession: false, autoRefreshToken: false }
      }).auth.signUp({
        email: `paf53-fifo-${label}-${crypto.randomUUID()}@test.local`,
        password: 'Password123!'
      });
      expect(signup.error, `${label} signup`).toBeNull();
      expect(signup.data.session, 'local email confirmations must be disabled').not.toBeNull();
      const token = signup.data.session!.access_token;
      const client = createClient<Database>(env.url, env.key, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } }
      });
      return { id: signup.data.user!.id, token, client, name: `Fifo ${label}` };
    };
    const created = await Promise.all(roster.map(([label]) => newActor(label)));
    roster.forEach(([label], index) => {
      actors[label] = created[index]!;
    });
    for (const eventKey of [
      'ordinal',
      'cap1',
      'ties',
      'duprace',
      'n789',
      'lastslot',
      'samereq',
      'tworeq',
      'joinrace'
    ])
      events[eventKey] = crypto.randomUUID();
    publicCommunity = crypto.randomUUID();
    const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
    const insertEvent = (eventKey: string, maximum: string) =>
      `insert into public.match_events(
        id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,
        venue_name,maps_url,photo_path,restriction_enabled,min_level,max_level,maximum_registrations,registration_cutoff_at)
        values (${q(events[eventKey]!)},${q(publicCommunity)},${q(actors.creator!.id)},
          now() + interval '10 days','UTC','friendly','community_open','POST_MATCH_TEAMS',
          'Fifo court','https://maps.google.com/maps/place/fifo','${crypto.randomUUID()}/photo.webp',
          false,null,null,${maximum},now() + interval '7 days');`;
    const memberRows = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8']
      .map(
        (key) =>
          `(${q(publicCommunity)},${q(actors[key]!.id)},'member','active',now()-interval '1 minute',now()-interval '1 minute')`
      )
      .join(',');
    await fixtureSql(
      [
        `do $$ begin`,
        `insert into public.communities(id,name,visibility,created_by) values
          (${q(publicCommunity)},'Fifo public fixture','public',${q(actors.creator!.id)});`,
        `insert into public.community_members(community_id,user_id,role,status,valid_from,activated_at) values
          (${q(publicCommunity)},${q(actors.creator!.id)},'admin','active',now()-interval '1 minute',now()-interval '1 minute'),${memberRows};`,
        `alter table public.match_events disable trigger lock_match_photo_publication;`,
        insertEvent('ordinal', 'null'),
        insertEvent('cap1', '1'),
        insertEvent('ties', 'null'),
        insertEvent('duprace', 'null'),
        insertEvent('n789', 'null'),
        insertEvent('lastslot', '2'),
        insertEvent('samereq', 'null'),
        insertEvent('tworeq', '2'),
        insertEvent('joinrace', 'null'),
        `alter table public.match_events enable trigger lock_match_photo_publication;`,
        `end $$;`
      ].join('\n')
    );
    // The publication trigger gave every event an accepted creator slot and
    // the matching ordinal state: each starts at next_accepted_ordinal = 2.
    for (const eventKey of Object.keys(events)) {
      expect(await registrationStateById(events[eventKey]!), `${eventKey} initial state`).toEqual({
        next: 2,
        revision: 0
      });
    }
  });

  it.skipIf(!environment.env)(
    'allocates unique ordinals in acceptance-time order, never renumbers them, and bumps the revision exactly once per mutation',
    async () => {
      // Five sequential direct acceptances: ordinals 2..6 in completion order.
      for (const [index, key] of ['m1', 'm2', 'm3', 'm4', 'm5'].entries()) {
        const accepted = await submit(actors[key]!, 'ordinal');
        expect(accepted.error, `${key} submit`).toBeNull();
        expect(asRecord(accepted.data)['accepted_order']).toBe(index + 2);
        // Positional invariant after EVERY mutation.
        await expectRosterAgreement(events.ordinal!);
      }
      const early = await ordinalRows('ordinal');
      expect(early.map((row) => Number(row['ordinal']))).toEqual([1, 2, 3, 4, 5, 6]);

      // A pending request between acceptances changes nothing: no ordinal,
      // no revision, no counts movement.
      const beforeRequest = await registrationStateById(events.ordinal!);
      const request = await submit(actors.g1!, 'ordinal');
      expect(request.error).toBeNull();
      expect(asRecord(request.data)['lifecycle']).toBe('pending');
      expect(await registrationStateById(events.ordinal!)).toEqual(beforeRequest);
      await expectRosterAgreement(events.ordinal!);

      // Two more acceptances.
      for (const key of ['m6', 'm7']) {
        expect((await submit(actors[key]!, 'ordinal')).error).toBeNull();
        await expectRosterAgreement(events.ordinal!);
      }

      // Ordinals unique per event, and early rows are never renumbered.
      const mid = await ordinalRows('ordinal');
      expect(mid).toHaveLength(8);
      expect(new Set(mid.map((row) => Number(row['ordinal']))).size).toBe(8);
      for (const row of early) {
        const unchanged = mid.find((candidate) => candidate['user_id'] === row['user_id']);
        expect(Number(unchanged!['ordinal'])).toBe(Number(row['ordinal']));
      }
      await expectOrdinalInvariants(events.ordinal!);
      // Accepted order tracks acceptance time: timestamps never go backwards
      // along the ordinal sequence.
      const stamps = mid.map((row) => new Date(String(row['accepted_at'])).getTime());
      for (let index = 1; index < stamps.length; index += 1)
        expect(stamps[index]!).toBeGreaterThanOrEqual(stamps[index - 1]!);
      expect((await registrationStateById(events.ordinal!)).revision).toBe(7);

      // An approval that happens LATER than an earlier request queues behind
      // it: the request timestamp never influences the position.
      const guestRequest = await submit(actors.g2!, 'ordinal');
      expect(guestRequest.error).toBeNull();
      const requestedAt = String(asRecord(guestRequest.data)['requested_at']);
      expect((await submit(actors.m8!, 'ordinal')).error).toBeNull();
      const memberRow = await rowOf('ordinal', actors.m8!.id);
      const approved = await decide(actors.creator!, 'ordinal', actors.g2!.id, 'approve');
      expect(approved.error).toBeNull();
      expect(asRecord(approved.data)).toMatchObject({
        lifecycle: 'accepted',
        accepted_order: 10,
        replayed: false
      });
      const guestRow = await rowOf('ordinal', actors.g2!.id);
      expect(Number(guestRow['accepted_order'])).toBe(10);
      // FIFO by acceptance: the late-approved request sits behind the direct
      // join even though it was requested earlier.
      expect(new Date(requestedAt).getTime()).toBeLessThan(
        new Date(String(memberRow['accepted_at'])).getTime()
      );
      expect(new Date(String(memberRow['accepted_at'])).getTime()).toBeLessThan(
        new Date(String(guestRow['accepted_at'])).getTime()
      );
      await expectRosterAgreement(events.ordinal!);
      expect((await registrationStateById(events.ordinal!)).revision).toBe(9);

      // No-op mutations never move the revision: an exact approval replay.
      const stateBeforeReplay = await registrationStateById(events.ordinal!);
      const replay = await decide(actors.creator!, 'ordinal', actors.g2!.id, 'approve');
      expect(replay.error).toBeNull();
      expect(asRecord(replay.data)['replayed']).toBe(true);
      expect(asRecord(replay.data)['accepted_order']).toBe(10);
      expect(await registrationStateById(events.ordinal!)).toEqual(stateBeforeReplay);

      // No-op: duplicate direct submission.
      await expectDomainError(submit(actors.m1!, 'ordinal'), 'MATCH_REGISTRATION_DUPLICATE');
      expect(await registrationStateById(events.ordinal!)).toEqual(stateBeforeReplay);

      // No-op: capacity refusal on the cap1 event (creator already fills it).
      await expectDomainError(submit(actors.m1!, 'cap1'), 'MATCH_REGISTRATION_FULL');
      expect(await registrationStateById(events.cap1!)).toEqual({ next: 2, revision: 0 });
      await expectOrdinalInvariants(events.ordinal!, { nextAcceptedOrdinal: 11 });
    }
  );

  it.skipIf(!environment.env)(
    'breaks equal-timestamp ties deterministically and keeps the stable order across later mutations',
    async () => {
      // Seed two accepted rows, then force their accepted_at to the exact same
      // database instant (trusted, identity-guard-respecting update).
      expect((await submit(actors.m1!, 'ties')).error).toBeNull();
      await fixtureSql(
        `update public.match_event_registrations set accepted_at = pg_catalog.now()
          where match_event_id = '${events.ties!}' and lifecycle = 'accepted';`
      );
      // Repeated reads return the identical ordinal order — the roster never
      // re-sorts equal-timestamp rows (the id tiebreak is defensive: accepted
      // ordinals are unique by the partial unique index).
      const first = await ordinalRows('ties');
      const second = await ordinalRows('ties');
      const third = await ordinalRows('ties');
      expect(second).toEqual(first);
      expect(third).toEqual(first);
      expect(first.map((row) => Number(row['ordinal']))).toEqual([1, 2]);

      // A later acceptance neither renumbers nor re-sorts the tied rows.
      expect((await submit(actors.m2!, 'ties')).error).toBeNull();
      const after = await ordinalRows('ties');
      expect(after).toHaveLength(3);
      expect(after.slice(0, 2)).toEqual(first);
      expect(Number(after[2]!['ordinal'])).toBe(3);
      await expectRosterAgreement(events.ties!);

      // Equal requested_at ties in the creator queue break deterministically
      // by id and stay stable across reads.
      await fixtureSql(
        `insert into public.match_event_registrations(match_event_id,user_id,lifecycle,requested_at,registration_source)
         values ('${events.ties!}','${actors.g3!.id}','pending',pg_catalog.now(),'guest'),
                ('${events.ties!}','${actors.g4!.id}','pending',pg_catalog.now(),'guest');`
      );
      const readQueue = async (): Promise<SqlRow[]> => {
        const result = await actors.creator!.client.rpc('list_match_event_registration_requests', {
          p_match_event_id: events.ties!
        });
        expect(result.error, 'queue read').toBeNull();
        const rows: unknown[] = Array.isArray(result.data) ? result.data : [];
        expect(rows).toHaveLength(1);
        const queue = asRecord(rows[0]);
        return (Array.isArray(queue['requests']) ? queue['requests'] : []).map(asRecord);
      };
      const queueOne = await readQueue();
      const queueTwo = await readQueue();
      expect(queueTwo).toEqual(queueOne);
      expect(queueOne).toHaveLength(2);
      const tiedIds = queueOne.map((row) => String(row['user_id']));
      // The queue's tie order IS the SQL (requested_at, id) order — read from
      // the database as the oracle rather than assuming text ordering rules
      // for UUID bytes — and it is stable across reads.
      const sqlOrder = await sqlRows(
        `select r.user_id::text as user_id
           from public.match_event_registrations r
          where r.match_event_id = '${events.ties!}' and r.lifecycle = 'pending'
          order by r.requested_at, r.id`
      );
      expect(tiedIds).toEqual(sqlOrder.map((row) => String(row['user_id'])));
      expect(new Date(String(queueOne[0]!['requested_at'])).getTime()).toBe(
        new Date(String(queueOne[1]!['requested_at'])).getTime()
      );
    }
  );

  it.skipIf(!environment.env)(
    'keeps exactly one identity row per (event, user) for duplicate direct submissions and a submission racing itself',
    async () => {
      // Serial duplicate: the second direct submission is refused and leaves
      // the single accepted row untouched.
      expect((await submit(actors.m2!, 'duprace')).error).toBeNull();
      await expectDomainError(submit(actors.m2!, 'duprace'), 'MATCH_REGISTRATION_DUPLICATE');
      const serialRows = await actors
        .creator!.client.from('match_event_registrations')
        .select('id,lifecycle')
        .eq('match_event_id', events.duprace!)
        .eq('user_id', actors.m2!.id);
      expect(serialRows.error).toBeNull();
      expect(serialRows.data).toHaveLength(1);
      expect(serialRows.data![0]!['lifecycle']).toBe('accepted');

      // Concurrent duplicate: two raw submissions by the same guest race on
      // the proven event-lock barrier; exactly one pending row survives.
      const [first, second] = await proveEventLockBarrier({
        communityId: publicCommunity,
        eventId: events.duprace!,
        rpcToken: 'submit_match_registration',
        fire: () => [
          rawRpc(actors.g5!, 'submit_match_registration', { p_match_event_id: events.duprace! }),
          rawRpc(actors.g5!, 'submit_match_registration', { p_match_event_id: events.duprace! })
        ]
      });
      const outcomes = [first, second];
      expect(outcomes.filter((result) => result.error === null)).toHaveLength(1);
      expect(outcomes.filter((result) => result.error !== null)).toHaveLength(1);
      const winner = outcomes.find((result) => result.error === null)!;
      expect(asRecord(winner.data)['lifecycle']).toBe('pending');
      const loser = outcomes.find((result) => result.error !== null)!;
      expect(loser.error!.code).toBe('P0001');
      expect(loser.error!.message).toBe('MATCH_REGISTRATION_PENDING_DUPLICATE');
      const guestRows = await actors
        .creator!.client.from('match_event_registrations')
        .select('id,lifecycle')
        .eq('match_event_id', events.duprace!)
        .eq('user_id', actors.g5!.id);
      expect(guestRows.error).toBeNull();
      expect(guestRows.data).toHaveLength(1);
      expect(guestRows.data![0]!['lifecycle']).toBe('pending');
      // The race consumed no ordinal and changed no participation.
      expect(await registrationStateById(events.duprace!)).toEqual({ next: 3, revision: 1 });
      await expectRosterAgreement(events.duprace!);
    }
  );

  it.skipIf(!environment.env)(
    'admits the simultaneous eighth and ninth acceptances from N=7 with the first eight playing and the ninth reserve',
    async () => {
      // Seed N=7 (creator + six members); every mutation reconciles.
      for (const key of ['m1', 'm2', 'm3', 'm4', 'm5', 'm6']) {
        expect((await submit(actors[key]!, 'n789')).error).toBeNull();
      }
      await expectRosterAgreement(events.n789!);
      const seeded = await registrationStateById(events.n789!);
      expect(seeded).toEqual({ next: 8, revision: 6 });

      // Two contenders race for the eighth and ninth seat. The lock decides
      // the order; the split never corrupts: exactly one of them lands in the
      // completing quartet and the other becomes the first reserve of it.
      const [first, second] = await proveEventLockBarrier({
        communityId: publicCommunity,
        eventId: events.n789!,
        rpcToken: 'submit_match_registration',
        fire: () => [
          rawRpc(actors.m7!, 'submit_match_registration', { p_match_event_id: events.n789! }),
          rawRpc(actors.m8!, 'submit_match_registration', { p_match_event_id: events.n789! })
        ]
      });
      expect(first.error, 'contender one').toBeNull();
      expect(second.error, 'contender two').toBeNull();
      const firstOrder = Number(asRecord(first.data)['accepted_order']);
      const secondOrder = Number(asRecord(second.data)['accepted_order']);
      expect(sorted([String(firstOrder), String(secondOrder)])).toEqual(['8', '9']);

      // Post-race invariants: ordinals 1..9 unique, counter consistent, and
      // the positional invariant intact — first eight playing, ninth reserve.
      await expectOrdinalInvariants(events.n789!, { nextAcceptedOrdinal: 10 });
      const agreement = await expectRosterAgreement(events.n789!);
      expect(agreement).toEqual({ acceptedTotal: 9, playingTotal: 8, reserveTotal: 1 });
      const rows = await ordinalRows('n789');
      for (const [index, row] of rows.entries()) {
        expect(Number(row['ordinal'])).toBe(index + 1);
      }
      const detail = await actors.creator!.client.rpc('get_match_event', {
        p_event_id: events.n789!
      });
      expect(detail.error).toBeNull();
      expect(asRecord(detail.data)).toMatchObject({
        accepted_count: 9,
        playing_count: 8,
        reserve_count: 1
      });
      expect((await registrationStateById(events.n789!)).revision).toBe(8);
    }
  );

  it.skipIf(!environment.env)(
    'admits exactly one contender for the last explicit capacity slot and the loser receives MATCH_REGISTRATION_FULL',
    async () => {
      const stateBefore = await registrationStateById(events.lastslot!);
      const [first, second] = await proveEventLockBarrier({
        communityId: publicCommunity,
        eventId: events.lastslot!,
        rpcToken: 'submit_match_registration',
        fire: () => [
          rawRpc(actors.m1!, 'submit_match_registration', { p_match_event_id: events.lastslot! }),
          rawRpc(actors.m2!, 'submit_match_registration', { p_match_event_id: events.lastslot! })
        ]
      });
      const outcomes = [first, second];
      const successes = outcomes.filter((result) => result.error === null);
      const errors = outcomes.filter((result) => result.error !== null);
      expect(successes).toHaveLength(1);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.error!.code).toBe('P0001');
      expect(errors[0]!.error!.message).toBe('MATCH_REGISTRATION_FULL');
      expect(asRecord(successes[0]!.data)).toMatchObject({
        lifecycle: 'accepted',
        accepted_order: stateBefore.next
      });
      // Capacity was never exceeded: the creator slot plus exactly one racer.
      await expectOrdinalInvariants(events.lastslot!, { nextAcceptedOrdinal: 3 });
      await expectRosterAgreement(events.lastslot!);
      const winnerId = String(asRecord(successes[0]!.data)['user_id']);
      const loser = winnerId === actors.m1!.id ? actors.m2! : actors.m1!;
      const loserRows = await actors
        .creator!.client.from('match_event_registrations')
        .select('id')
        .eq('match_event_id', events.lastslot!)
        .eq('user_id', loser.id);
      expect(loserRows.error).toBeNull();
      expect(loserRows.data).toEqual([]);
      // Exactly one accepted mutation happened: revision moved once.
      expect(await registrationStateById(events.lastslot!)).toEqual({
        next: 3,
        revision: stateBefore.revision + 1
      });
    }
  );

  it.skipIf(!environment.env)(
    'replays exactly one of two concurrent approvals of the same request with one ordinal, one attempt and one alert set',
    async () => {
      const request = await submit(actors.g6!, 'samereq');
      expect(request.error).toBeNull();
      expect(asRecord(request.data)['lifecycle']).toBe('pending');
      const stateBefore = await registrationStateById(events.samereq!);
      const attemptId = await latestAttemptId('samereq', actors.g6!.id);

      const [first, second] = await proveEventLockBarrier({
        communityId: publicCommunity,
        eventId: events.samereq!,
        rpcToken: 'decide_match_registration',
        fire: () => [
          rawRpc(actors.creator!, 'decide_match_registration', {
            p_match_event_id: events.samereq!,
            p_attempt_id: attemptId,
            p_decision: 'approve'
          }),
          rawRpc(actors.creator!, 'decide_match_registration', {
            p_match_event_id: events.samereq!,
            p_attempt_id: attemptId,
            p_decision: 'approve'
          })
        ]
      });
      expect(first.error).toBeNull();
      expect(second.error).toBeNull();
      const outcomes = [asRecord(first.data), asRecord(second.data)];
      // Per the shipped contract this is an idempotent replay: exactly one
      // replayed:false and one replayed:true, never a double effect.
      expect(sorted(outcomes.map((outcome) => String(outcome['replayed'])))).toEqual([
        'false',
        'true'
      ]);
      const original = outcomes.find((outcome) => outcome['replayed'] === false)!;
      const replayed = outcomes.find((outcome) => outcome['replayed'] === true)!;
      expect(original).toMatchObject({ lifecycle: 'accepted', accepted_order: stateBefore.next });
      // The replay returns the ORIGINAL anchors and order.
      expect(replayed['accepted_at']).toBe(original['accepted_at']);
      expect(replayed['approved_at']).toBe(original['approved_at']);
      expect(replayed['accepted_order']).toBe(original['accepted_order']);

      // Exactly one ordinal, one attempt row, one alert set.
      await expectOrdinalInvariants(events.samereq!, { nextAcceptedOrdinal: 3 });
      await expectRosterAgreement(events.samereq!);
      const attempts = await attemptsOf('samereq', actors.g6!.id);
      expect(attempts).toHaveLength(1);
      expect(String(attempts[0]!['outcome'])).toBe('accepted');
      const inbox = await inboxOf(actors.g6!, 'samereq');
      expect(sorted(inbox.map((row) => String(row['kind'])))).toEqual([
        'match_registration_approved',
        'match_registration_reserve'
      ]);
      // One successful mutation: the revision moved exactly once.
      expect(await registrationStateById(events.samereq!)).toEqual({
        next: 3,
        revision: stateBefore.revision + 1
      });
    }
  );

  it.skipIf(!environment.env)(
    'admits exactly one of two concurrent approvals of DIFFERENT requests at last capacity and deterministically refuses the other',
    async () => {
      // Capacity 2 with only the creator accepted: the LAST slot is exactly
      // what the two pending requests will contest.
      await expectRosterAgreement(events.tworeq!);
      // Two pending requests while one slot remains.
      for (const key of ['g7', 'g8']) {
        const request = await submit(actors[key]!, 'tworeq');
        expect(request.error).toBeNull();
        expect(asRecord(request.data)['lifecycle']).toBe('pending');
      }
      const stateBefore = await registrationStateById(events.tworeq!);
      expect(stateBefore).toEqual({ next: 2, revision: 0 });
      const attemptG7 = await latestAttemptId('tworeq', actors.g7!.id);
      const attemptG8 = await latestAttemptId('tworeq', actors.g8!.id);

      const [first, second] = await proveEventLockBarrier({
        communityId: publicCommunity,
        eventId: events.tworeq!,
        rpcToken: 'decide_match_registration',
        fire: () => [
          rawRpc(actors.creator!, 'decide_match_registration', {
            p_match_event_id: events.tworeq!,
            p_attempt_id: attemptG7,
            p_decision: 'approve'
          }),
          rawRpc(actors.creator!, 'decide_match_registration', {
            p_match_event_id: events.tworeq!,
            p_attempt_id: attemptG8,
            p_decision: 'approve'
          })
        ]
      });
      const outcomes = [first, second];
      const successes = outcomes.filter((result) => result.error === null);
      const errors = outcomes.filter((result) => result.error !== null);
      expect(successes).toHaveLength(1);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.error!.code).toBe('P0001');
      expect(errors[0]!.error!.message).toBe('MATCH_REGISTRATION_FULL');
      const winnerOutcome = asRecord(successes[0]!.data);
      expect(winnerOutcome).toMatchObject({
        lifecycle: 'accepted',
        accepted_order: stateBefore.next,
        replayed: false
      });
      const winnerId = String(winnerOutcome['user_id']);
      const loser = winnerId === actors.g7!.id ? actors.g8! : actors.g7!;

      // The winner holds the single new ordinal; the loser's request is
      // unresolved: still pending, no anchors, no alert, attempt untouched.
      await expectOrdinalInvariants(events.tworeq!, { nextAcceptedOrdinal: 3 });
      await expectRosterAgreement(events.tworeq!);
      const loserRow = await rowOf('tworeq', loser.id);
      expect(loserRow['lifecycle']).toBe('pending');
      expect(loserRow['accepted_at']).toBeNull();
      expect(loserRow['accepted_order']).toBeNull();
      expect(loserRow['approved_at']).toBeNull();
      expect((await attemptsOf('tworeq', loser.id)).map((row) => row['outcome'])).toEqual([
        'pending'
      ]);
      expect(await inboxOf(loser, 'tworeq')).toEqual([]);
      const winnerInbox = await inboxOf(
        winnerId === actors.g7!.id ? actors.g7! : actors.g8!,
        'tworeq'
      );
      expect(sorted(winnerInbox.map((row) => String(row['kind'])))).toEqual([
        'match_registration_approved',
        'match_registration_reserve'
      ]);
      // Exactly one mutation: revision moved once, capacity held.
      expect(await registrationStateById(events.tworeq!)).toEqual({
        next: 3,
        revision: stateBefore.revision + 1
      });
    }
  );

  it.skipIf(!environment.env)(
    'resolves a direct join racing an approval deterministically without double ordinal allocation',
    async () => {
      const request = await submit(actors.g9!, 'joinrace');
      expect(request.error).toBeNull();
      expect(asRecord(request.data)['lifecycle']).toBe('pending');
      const stateBefore = await registrationStateById(events.joinrace!);
      const attemptG9 = await latestAttemptId('joinrace', actors.g9!.id);

      // One direct join and one creator approval contend. Both paths succeed
      // under the lock in SOME serialized order, but the outcome is
      // deterministic: two acceptances, two distinct consecutive ordinals.
      const [first, second] = await proveEventLockBarrier({
        communityId: publicCommunity,
        eventId: events.joinrace!,
        // One token that matches BOTH RPC names in pg_stat_activity.
        rpcToken: 'match_registration',
        fire: () => [
          rawRpc(actors.m4!, 'submit_match_registration', { p_match_event_id: events.joinrace! }),
          rawRpc(actors.creator!, 'decide_match_registration', {
            p_match_event_id: events.joinrace!,
            p_attempt_id: attemptG9,
            p_decision: 'approve'
          })
        ]
      });
      expect(first.error, 'join contender').toBeNull();
      expect(second.error, 'approval contender').toBeNull();
      const joinOutcome = asRecord(first.data);
      const approvalOutcome = asRecord(second.data);
      // The submit DTO carries no replay marker at all; the approval is a
      // genuine first decision.
      expect('replayed' in joinOutcome, 'submit carries no replay marker').toBe(false);
      expect(approvalOutcome).toMatchObject({ lifecycle: 'accepted', replayed: false });
      const joinOrder = Number(joinOutcome['accepted_order']);
      const approvalOrder = Number(approvalOutcome['accepted_order']);
      expect(sorted([String(joinOrder), String(approvalOrder)])).toEqual([
        String(stateBefore.next),
        String(stateBefore.next + 1)
      ]);

      // No double allocation: ordinals unique and consecutive, counter moved
      // by exactly two, and every stored participation matches the roster.
      await expectOrdinalInvariants(events.joinrace!, {
        nextAcceptedOrdinal: stateBefore.next + 2
      });
      await expectRosterAgreement(events.joinrace!);
      expect(await registrationStateById(events.joinrace!)).toEqual({
        next: stateBefore.next + 2,
        revision: stateBefore.revision + 2
      });
    }
  );

  it.skipIf(!environment.env)('leaves no retained holder backends behind', async () => {
    expect(await leakedHolderBackends()).toBe(0);
  });
});
