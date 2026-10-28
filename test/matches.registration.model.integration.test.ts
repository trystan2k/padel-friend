import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../src/lib/supabase/database.types';
import { matchPhotoFixture } from './helpers/match-photo-fixtures';
import {
  assertLocalSupabaseEnvInCi,
  dotEnvPathFromImportMetaUrl,
  localSupabaseEnv
} from './helpers/local-supabase-env';
import {
  asRecord,
  expectDomainError,
  fixtureSql,
  registrationStateById,
  sqlRows,
  type RpcResult
} from './helpers/match-registration-sql';

vi.setConfig({ testTimeout: 240000, hookTimeout: 120000 });

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

type Actor = { id: string; token: string; client: SupabaseClient<Database>; name: string };

// ---------------------------------------------------------------------------
// Independent oracle.
//
// The system under test is public.match_registration_roster /
// match_registration_counts / reconcile_match_registration_participation. The
// expectation below is deliberately NOT the SQL arithmetic
// (accepted_total / 4) * 4: it is a simulation of the PRD rule "the ordered
// roster splits into consecutive quartets and only a quartet whose four seats
// are all filled is playing", expressed as seat chunking and cross-checked
// against a hand-computed table. The pure test asserts the two oracles agree,
// so the DB sections compare the real SQL against a proven expectation.
// ---------------------------------------------------------------------------

const HAND_COMPUTED_PLAYING: readonly number[] = [0, 0, 0, 0, 4, 4, 4, 4, 8, 8, 8, 8, 12, 12];
const HAND_COMPUTED_RESERVE: readonly number[] = [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1];

type OracleSeat = { position: number; group: number; playing: boolean };

/** Chunk positions 1..n into consecutive groups of four; complete groups play. */
function quartetOracle(n: number): OracleSeat[] {
  const seats: OracleSeat[] = [];
  for (let start = 1; start <= n; start += 4) {
    const group = Math.ceil(start / 4);
    const seatsInGroup = Math.min(4, n - start + 1);
    for (let offset = 0; offset < seatsInGroup; offset += 1) {
      seats.push({ position: start + offset, group, playing: seatsInGroup === 4 });
    }
  }
  return seats;
}

const COUNT_NS: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

describe('match registration FIFO model', () => {
  it('requires local Supabase in CI', () => {
    expect(() => assertLocalSupabaseEnvInCi(environment.env, process.env.CI)).not.toThrow();
  });

  it('proves the independent oracle: seat chunking, hand table and boundaries agree for N=0..13', () => {
    for (const n of COUNT_NS) {
      const seats = quartetOracle(n);
      expect(seats, `oracle size at N=${n}`).toHaveLength(n);
      // Positions contiguous from 1.
      expect(seats.map((seat) => seat.position)).toEqual(
        Array.from({ length: n }, (_, index) => index + 1)
      );
      const playing = seats.filter((seat) => seat.playing);
      // Split matches the hand-computed table exactly.
      expect(playing, `oracle playing at N=${n}`).toHaveLength(HAND_COMPUTED_PLAYING[n]!);
      expect(seats.length - playing.length, `oracle reserve at N=${n}`).toBe(
        HAND_COMPUTED_RESERVE[n]!
      );
      // Group membership boundaries lie exactly at multiples of four: every
      // seat sits inside its own group range and only complete groups play.
      for (const seat of seats) {
        expect(seat.position).toBeGreaterThan((seat.group - 1) * 4);
        expect(seat.position).toBeLessThanOrEqual(seat.group * 4);
        expect(seat.playing).toBe(seat.position <= HAND_COMPUTED_PLAYING[n]!);
      }
      // N < 4 leaves everything Reserve.
      expect(n < 4 ? playing.length : 0).toBe(0);
    }
  });

  it.skipIf(!environment.env)(
    'splits the roster across N=0..13 exactly like the oracle, with contiguous positions and group boundaries at multiples of four',
    async () => {
      const env = environment.env!;
      const actors = await seedActors(env, 13);
      const countEvents = new Map<number, string>(COUNT_NS.map((n) => [n, crypto.randomUUID()]));
      await fixtureSql(modelFixtureSql(actors, countEvents));

      const readRoster = async (
        eventId: string
      ): Promise<{ roster: Record<string, unknown>[]; counts: Record<string, unknown> }> => {
        const rows = await sqlRows(
          `select (select coalesce(pg_catalog.jsonb_agg(s.payload order by (s.payload->>'pos')::int), '[]'::jsonb)
                     from (select pg_catalog.jsonb_build_object(
                             'rid', r.registration_id, 'uid', r.user_id, 'ord', r.accepted_order,
                             'pos', r.roster_position, 'total', r.accepted_total,
                             'play', r.playing_total, 'res', r.reserve_total,
                             'status', r.participation_status::text) as payload
                            from public.match_registration_roster('${eventId}') r) s) as roster,
                  c.accepted_count, c.playing_count, c.reserve_count
             from public.match_registration_counts('${eventId}') c`
        );
        return {
          roster: (Array.isArray(rows[0]!['roster']) ? rows[0]!['roster'] : []).map(asRecord),
          counts: asRecord(rows[0])
        };
      };

      for (const n of COUNT_NS) {
        const eventId = countEvents.get(n)!;
        const { roster, counts } = await readRoster(eventId);
        const seats = quartetOracle(n);

        // Counts: accepted, playing, reserve exactly as the oracle says.
        expect(Number(counts['accepted_count']), `accepted at N=${n}`).toBe(n);
        expect(Number(counts['playing_count']), `playing at N=${n}`).toBe(
          HAND_COMPUTED_PLAYING[n]!
        );
        expect(Number(counts['reserve_count']), `reserve at N=${n}`).toBe(
          HAND_COMPUTED_RESERVE[n]!
        );
        expect(roster, `roster rows at N=${n}`).toHaveLength(n);

        let playingRows = 0;
        for (const [index, seat] of seats.entries()) {
          const row = roster[index]!;
          // Positions contiguous from 1.
          expect(Number(row['pos']), `position at N=${n} seat ${index + 1}`).toBe(seat.position);
          // Split per seat.
          expect(row['status'], `status at N=${n} seat ${seat.position}`).toBe(
            seat.playing ? 'playing' : 'reserve'
          );
          if (seat.playing) playingRows += 1;
          // Row-carried totals agree with the counts function.
          expect(Number(row['total'])).toBe(n);
          expect(Number(row['play'])).toBe(HAND_COMPUTED_PLAYING[n]!);
          expect(Number(row['res'])).toBe(HAND_COMPUTED_RESERVE[n]!);
        }
        expect(playingRows).toBe(HAND_COMPUTED_PLAYING[n]!);

        // Group membership boundaries lie exactly at multiples of four: the
        // playing set is exactly the first complete-group seats and the
        // reserve tail starts right after the last complete group.
        const playingPositions = roster
          .filter((row) => row['status'] === 'playing')
          .map((row) => Number(row['pos']));
        expect(playingPositions).toEqual(
          Array.from({ length: HAND_COMPUTED_PLAYING[n]! }, (_, index) => index + 1)
        );
        // The reserve tail starts right after the last complete group; when
        // the whole roster plays there is no reserve seat to check.
        const reservePositions = roster
          .filter((row) => row['status'] === 'reserve')
          .map((row) => Number(row['pos']));
        expect(
          reservePositions.length > 0
            ? Math.min(...reservePositions)
            : HAND_COMPUTED_PLAYING[n]! + 1
        ).toBe(HAND_COMPUTED_PLAYING[n]! + 1);
        // N < 4 leaves everything Reserve.
        expect(n < 4 ? playingPositions.length : 0).toBe(0);

        // Ordinals 1..n are assigned and unique per event.
        const ordinals = roster.map((row) => Number(row['ord']));
        expect(new Set(ordinals).size).toBe(n);
        expect(n > 0 ? ordinals : []).toEqual(Array.from({ length: n }, (_, index) => index + 1));
      }

      // After a reconcile of every seeded event, the STORED participation of
      // each row equals the derived roster expectation (no provisional
      // 'reserve' anchor survives) and no ordinals moved.
      for (const n of COUNT_NS) {
        const eventId = countEvents.get(n)!;
        await fixtureSql(`select public.reconcile_match_registration_participation('${eventId}');`);
        const stored = await sqlRows(
          `select r.id::text as rid, r.participation_status::text as stored,
                  q.roster_position::int as pos, q.participation_status::text as derived,
                  r.accepted_order::int as ord
             from public.match_event_registrations r
             join public.match_registration_roster('${eventId}') q on q.registration_id = r.id
            order by q.roster_position`
        );
        expect(stored, `stored rows at N=${n}`).toHaveLength(n);
        for (const [index, row] of stored.entries()) {
          expect(row['stored'], `stored status at N=${n} row ${index + 1}`).toBe(row['derived']);
          expect(Number(row['pos'])).toBe(index + 1);
          expect(Number(row['ord'])).toBe(index + 1);
        }
      }
    }
  );

  it.skipIf(!environment.env)(
    'binds explicit capacities 1,3,4,5,8,9 to accepted players and never closes an unlimited event at four or eight',
    async () => {
      const env = environment.env!;
      const actors = await seedActors(env, 9);
      const capacityEvents = new Map<string, string>(
        [1, 3, 4, 5, 8, 9, 'null'].map((capacity) => [String(capacity), crypto.randomUUID()])
      );
      await fixtureSql(capacityFixtureSql(actors, capacityEvents));

      const detail = async (eventId: string): Promise<Record<string, unknown>> => {
        const result = await actors.creator.client.rpc('get_match_event', { p_event_id: eventId });
        expect(result.error, 'detail read').toBeNull();
        return asRecord(result.data);
      };
      const submit = (member: Actor, eventId: string): PromiseLike<RpcResult> =>
        member.client.rpc('submit_match_registration', { p_match_event_id: eventId });

      // Finite capacities: the creator slot already occupies one seat, so
      // capacity k admits exactly k-1 members and refuses the k-th with the
      // deterministic FULL error, never exceeding the bound.
      for (const capacity of [1, 3, 4, 5, 8, 9] as const) {
        const eventId = capacityEvents.get(String(capacity))!;
        for (let seat = 1; seat <= capacity - 1; seat += 1) {
          const accepted = await submit(actors.members[seat - 1]!, eventId);
          expect(accepted.error, `capacity ${capacity} seat ${seat}`).toBeNull();
          expect(asRecord(accepted.data)['lifecycle']).toBe('accepted');
        }
        const stateBefore = await registrationStateById(eventId);
        await expectDomainError(
          submit(actors.members[capacity - 1]!, eventId),
          'MATCH_REGISTRATION_FULL'
        );
        // The refusal consumed no ordinal and no revision.
        expect(await registrationStateById(eventId)).toEqual(stateBefore);
        expect(stateBefore.revision, `capacity ${capacity} mutations`).toBe(capacity - 1);

        const view = await detail(eventId);
        expect(view['accepted_count'], `capacity ${capacity} accepted`).toBe(capacity);
        expect(view['playing_count'], `capacity ${capacity} playing`).toBe(
          HAND_COMPUTED_PLAYING[capacity]!
        );
        expect(view['reserve_count'], `capacity ${capacity} reserve`).toBe(
          HAND_COMPUTED_RESERVE[capacity]!
        );
        expect(view['registration_open'], `capacity ${capacity} closed`).toBe(false);
      }

      // Unlimited (null): open after four, after eight and after nine; the
      // derived split keeps following the oracle at every step. The accepted
      // count is step + 1 because the creator slot always participates.
      const unlimitedId = capacityEvents.get('null')!;
      for (const step of [1, 2, 3, 4, 5, 6, 7, 8, 9] as const) {
        const accepted = await submit(actors.members[step - 1]!, unlimitedId);
        expect(accepted.error, `unlimited seat ${step}`).toBeNull();
        expect(asRecord(accepted.data)['lifecycle']).toBe('accepted');
        const view = await detail(unlimitedId);
        expect(view['accepted_count'], `unlimited accepted at N=${step + 1}`).toBe(step + 1);
        expect(view['playing_count'], `unlimited playing at N=${step + 1}`).toBe(
          HAND_COMPUTED_PLAYING[step + 1]
        );
        expect(view['reserve_count'], `unlimited reserve at N=${step + 1}`).toBe(
          HAND_COMPUTED_RESERVE[step + 1]
        );
        // An unlimited event never closes at four or at eight players.
        expect(view['registration_open'], `unlimited open at N=${step + 1}`).toBe(true);
      }
    }
  );
});

// --- Local helpers -------------------------------------------------------------

type ActorSet = { creator: Actor; members: Actor[] };

async function seedActors(
  env: { url: string; key: string },
  memberCount: number
): Promise<ActorSet> {
  const newActor = async (label: string): Promise<Actor> => {
    const signup = await createClient(env.url, env.key, {
      auth: { persistSession: false, autoRefreshToken: false }
    }).auth.signUp({
      email: `paf53-model-${label}-${crypto.randomUUID()}@test.local`,
      password: 'Password123!'
    });
    expect(signup.error, `${label} signup`).toBeNull();
    expect(signup.data.session, 'local email confirmations must be disabled').not.toBeNull();
    const token = signup.data.session!.access_token;
    const client = createClient<Database>(env.url, env.key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } }
    });
    return { id: signup.data.user!.id, token, client, name: `Model ${label}` };
  };
  const creator = await newActor('creator');
  const members = await Promise.all(
    Array.from({ length: memberCount }, (_, index) => newActor(`m${index + 1}`))
  );
  return { creator, members };
}

const q = (value: string): string => `'${value.replaceAll("'", "''")}'`;

function insertEventSql(
  eventId: string,
  creatorId: string,
  communityId: string,
  maximum: string
): string {
  const photo = matchPhotoFixture(communityId, eventId, creatorId);
  return `${photo.sql}\ninsert into public.match_events(
      id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,
      venue_name,maps_url,photo_path,restriction_enabled,min_level,max_level,maximum_registrations,registration_cutoff_at)
      values (${q(eventId)},${q(communityId)},${q(creatorId)},
        now() + interval '10 days','UTC','friendly','community_open','POST_MATCH_TEAMS',
        'Model court','https://maps.google.com/maps/place/model',${q(photo.path)},
        false,null,null,${maximum},now() + interval '7 days');`;
}

function communityFixture(communityId: string, actors: ActorSet): string[] {
  const memberRows = [actors.creator, ...actors.members].map(
    (actor) =>
      `(${q(communityId)},${q(actor.id)},'${actor === actors.creator ? 'admin' : 'member'}','active',now()-interval '1 minute',now()-interval '1 minute')`
  );
  return [
    `insert into public.communities(id,name,visibility,created_by) values
      (${q(communityId)},'Model fixture community','public',${q(actors.creator.id)});`,
    `insert into public.community_members(community_id,user_id,role,status,valid_from,activated_at) values
      ${memberRows.join(',')};`
  ];
}

/**
 * Trusted fixture for the N=0..13 split: one public community, all actor
 * memberships, and fourteen count events. count0 is inserted with the creator
 * registration trigger disabled (a legitimately empty roster, N=0, with a
 * manually created state row); every other event keeps the trigger's creator
 * slot and receives N-1 accepted member rows with ordinals 2..N.
 */
function modelFixtureSql(actors: ActorSet, countEvents: Map<number, string>): string {
  const communityId = crypto.randomUUID();
  const statements: string[] = [
    `do $$ begin`,
    ...communityFixture(communityId, actors),
    // N=0: no creator slot at all, state created manually.
    `alter table public.match_events disable trigger match_event_creator_registration;`,
    insertEventSql(countEvents.get(0)!, actors.creator.id, communityId, 'null'),
    `insert into public.match_event_registration_state(match_event_id,next_accepted_ordinal)
      values (${q(countEvents.get(0)!)},1);`,
    `alter table public.match_events enable trigger match_event_creator_registration;`
  ];
  for (const n of COUNT_NS) {
    if (n === 0) continue;
    statements.push(insertEventSql(countEvents.get(n)!, actors.creator.id, communityId, 'null'));
    for (let ordinal = 2; ordinal <= n; ordinal += 1) {
      const member = actors.members[ordinal - 2]!;
      const instant = `now() - interval '1 day' + (${ordinal} * interval '1 minute')`;
      statements.push(
        `insert into public.match_event_registrations(
           match_event_id,user_id,lifecycle,accepted_at,accepted_order,participation_status,registration_source,requested_at)
         values (${q(countEvents.get(n)!)},${q(member.id)},'accepted',${instant},${ordinal},'reserve','member',${instant});
         insert into public.match_event_registration_attempts(
           registration_id,match_event_id,user_id,requested_at,outcome,decided_at,accepted_at,accepted_order,registration_source)
         select id,match_event_id,user_id,requested_at,'accepted',accepted_at,accepted_at,accepted_order,registration_source
           from public.match_event_registrations
          where match_event_id=${q(countEvents.get(n)!)} and user_id=${q(member.id)};
         update public.match_event_registrations r set current_attempt_id=a.id
           from public.match_event_registration_attempts a
         where a.registration_id=r.id and r.match_event_id=${q(countEvents.get(n)!)} and r.user_id=${q(member.id)};`
      );
    }
    // Accepted history and derived participation must agree before deferred constraints commit.
    statements.push(
      `perform public.reconcile_match_registration_participation(${q(countEvents.get(n)!)});`
    );
  }
  statements.push(`end $$;`);
  return statements.join('\n');
}

/** Trusted fixture for the capacity matrix: fresh community, members, events. */
function capacityFixtureSql(actors: ActorSet, capacityEvents: Map<string, string>): string {
  const communityId = crypto.randomUUID();
  return [
    `do $$ begin`,
    ...communityFixture(communityId, actors),
    ...[...capacityEvents.entries()].map(([capacity, eventId]) =>
      insertEventSql(
        eventId,
        actors.creator.id,
        communityId,
        capacity === 'null' ? 'null' : capacity
      )
    ),
    `end $$;`
  ].join('\n');
}
