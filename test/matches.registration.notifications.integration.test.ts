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
  expectRosterAgreement,
  fixtureSql,
  registrationStateById,
  sqlRows
} from './helpers/match-registration-sql';

vi.setConfig({ testTimeout: 240000, hookTimeout: 120000 });

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

type Actor = { id: string; token: string; client: SupabaseClient<Database>; name: string };
type SqlRow = Record<string, unknown>;

// FIFO alert kinds and their stable revision-keyed event_key shape:
// match.fifo_<variant>:<eventId>:<POST-bump revision>:<recipientId>
const FIFO_KINDS = [
  'match_registration_playing',
  'match_registration_reserve',
  'match_registration_promoted',
  'match_registration_quartet_complete'
] as const;

describe('match registration FIFO notifications integration', () => {
  it('requires local Supabase in CI', () => {
    expect(() => assertLocalSupabaseEnvInCi(environment.env, process.env.CI)).not.toThrow();
  });

  const actors: Record<string, Actor> = {};
  const events: Record<string, string> = {};
  let publicCommunity = '';

  const submit = (who: Actor, eventKey: string): PromiseLike<{ error: unknown; data: unknown }> =>
    who.client.rpc('submit_match_registration', { p_match_event_id: events[eventKey]! });
  const decide = (
    who: Actor,
    eventKey: string,
    targetId: string,
    decision: 'approve' | 'reject'
  ): PromiseLike<{ error: unknown; data: unknown }> =>
    who.client.rpc('decide_match_registration', {
      p_match_event_id: events[eventKey]!,
      p_user_id: targetId,
      p_decision: decision
    });
  const inboxOf = async (who: Actor, eventKey: string): Promise<SqlRow[]> => {
    const result = await who.client
      .from('notifications')
      .select('id,recipient_user_id,event_key,kind,category,target_type,target_id,community_id')
      .eq('target_id', events[eventKey]!);
    expect(result.error, `${who.name} inbox`).toBeNull();
    return result.data ?? [];
  };

  it('seeds actors, communities and events through the trusted channel', async () => {
    const env = environment.env!;
    const roster = ['creator', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'g1'];
    const newActor = async (label: string): Promise<Actor> => {
      const signup = await createClient(env.url, env.key, {
        auth: { persistSession: false, autoRefreshToken: false }
      }).auth.signUp({
        email: `paf53-notif-${label}-${crypto.randomUUID()}@test.local`,
        password: 'Password123!'
      });
      expect(signup.error, `${label} signup`).toBeNull();
      expect(signup.data.session, 'local email confirmations must be disabled').not.toBeNull();
      const token = signup.data.session!.access_token;
      const client = createClient<Database>(env.url, env.key, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } }
      });
      return { id: signup.data.user!.id, token, client, name: `Notif ${label}` };
    };
    const created = await Promise.all(roster.map((label) => newActor(label)));
    roster.forEach((label, index) => {
      actors[label] = created[index]!;
    });
    events.kinds = crypto.randomUUID();
    events.rollback = crypto.randomUUID();
    publicCommunity = crypto.randomUUID();
    const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
    const insertEvent = (eventKey: string) =>
      `insert into public.match_events(
        id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,
        venue_name,maps_url,photo_path,restriction_enabled,min_level,max_level,maximum_registrations,registration_cutoff_at)
        values (${q(events[eventKey]!)},${q(publicCommunity)},${q(actors.creator!.id)},
          now() + interval '10 days','UTC','friendly','community_open','POST_MATCH_TEAMS',
          'Notif court','https://maps.google.com/maps/place/notif','${crypto.randomUUID()}/photo.webp',
          false,null,null,null,now() + interval '7 days');`;
    const memberRows = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9']
      .map(
        (key) =>
          `(${q(publicCommunity)},${q(actors[key]!.id)},'member','active',now()-interval '1 minute',now()-interval '1 minute')`
      )
      .join(',');
    await fixtureSql(
      [
        `do $$ begin`,
        `insert into public.communities(id,name,visibility,created_by) values
          (${q(publicCommunity)},'Notif public fixture','public',${q(actors.creator!.id)});`,
        `insert into public.community_members(community_id,user_id,role,status,valid_from,activated_at) values
          (${q(publicCommunity)},${q(actors.creator!.id)},'admin','active',now()-interval '1 minute',now()-interval '1 minute'),${memberRows};`,
        `alter table public.match_events disable trigger lock_match_photo_publication;`,
        // The publication alert is T04 behavior and would pollute the exact
        // creator inbox assertions below; every other producer stays live.
        `alter table public.match_events disable trigger match_event_published_notification;`,
        insertEvent('kinds'),
        insertEvent('rollback'),
        `alter table public.match_events enable trigger match_event_published_notification;`,
        `alter table public.match_events enable trigger lock_match_photo_publication;`,
        `end $$;`
      ].join('\n')
    );
    for (const eventKey of Object.keys(events)) {
      expect(await registrationStateById(events[eventKey]!), `${eventKey} initial state`).toEqual({
        next: 2,
        revision: 0
      });
    }
  });

  it.skipIf(!environment.env)(
    'fires each FIFO kind to exactly the changed recipients with revision-keyed event keys',
    async () => {
      const eventKey = 'kinds';
      const accept = async (label: string) => {
        const result = await submit(actors[label]!, eventKey);
        expect(result.error, `${label} submit`).toBeNull();
        await expectRosterAgreement(events[eventKey]!);
      };

      // rev1: m1 accepted at N=2 -> Reserve only. Nobody else changed.
      await accept('m1');
      expect((await inboxOf(actors.m1!, eventKey)).map((row) => String(row['kind']))).toEqual([
        'match_registration_reserve'
      ]);
      expect(await inboxOf(actors.creator!, eventKey)).toEqual([]);

      // rev2: m2 accepted at N=3 -> Reserve only.
      await accept('m2');
      expect((await inboxOf(actors.m2!, eventKey)).map((row) => String(row['kind']))).toEqual([
        'match_registration_reserve'
      ]);

      // rev3: m3 completes the first quartet at N=4. The new player gets
      // playing; every reserve->playing mover gets promoted; all four members
      // of the newly completed group get quartet_complete.
      await accept('m3');
      const quartetOne = [actors.creator!, actors.m1!, actors.m2!, actors.m3!];
      for (const member of quartetOne) {
        const inbox = await inboxOf(member, eventKey);
        expect(
          inbox.some((row) => String(row['kind']) === 'match_registration_quartet_complete')
        ).toBe(true);
      }
      expect((await inboxOf(actors.m3!, eventKey)).map((row) => String(row['kind']))).toEqual([
        'match_registration_playing',
        'match_registration_quartet_complete'
      ]);
      for (const mover of [actors.creator!, actors.m1!, actors.m2!])
        expect(
          (await inboxOf(mover, eventKey)).some(
            (row) => String(row['kind']) === 'match_registration_promoted'
          )
        ).toBe(true);

      // rev4: m4 accepted at N=5 -> ONLY the changed player is notified. The
      // already-complete first quartet receives nothing new.
      const beforeFifth = await Promise.all(
        quartetOne.map(async (member) => (await inboxOf(member, eventKey)).length)
      );
      await accept('m4');
      expect((await inboxOf(actors.m4!, eventKey)).map((row) => String(row['kind']))).toEqual([
        'match_registration_reserve'
      ]);
      const afterFifth = await Promise.all(
        quartetOne.map(async (member) => (await inboxOf(member, eventKey)).length)
      );
      expect(afterFifth).toEqual(beforeFifth);

      // rev5: guest request approved into Reserve at N=6.
      const request = await submit(actors.g1!, eventKey);
      expect(request.error).toBeNull();
      const approved = await decide(actors.creator!, eventKey, actors.g1!.id, 'approve');
      expect(approved.error).toBeNull();
      expect(asRecord(approved.data)).toMatchObject({ lifecycle: 'accepted', replayed: false });
      await expectRosterAgreement(events[eventKey]!);
      expect(
        (await inboxOf(actors.g1!, eventKey)).map((row) => String(row['kind'])).sort()
      ).toEqual(['match_registration_approved', 'match_registration_reserve']);

      // rev6: m5 accepted at N=7 -> Reserve.
      await accept('m5');

      // rev7: m6 completes the second quartet at N=8. Positions 5-8 were
      // reserve (or new) and all flip to playing; the new group is notified.
      await accept('m6');

      // Final exact inboxes with per-kind revision segments. This is the
      // revision-keyed exactly-once evidence: every genuine transition wrote
      // exactly one alert keyed by its own POST-bump revision.
      const KIND = {
        playing: 'match_registration_playing',
        reserve: 'match_registration_reserve',
        promoted: 'match_registration_promoted',
        quartet: 'match_registration_quartet_complete',
        approved: 'match_registration_approved',
        requested: 'match_registration_requested'
      } as const;
      const expectedKinds: Record<string, string[]> = {
        // The creator is promoted once (rev3, when the first quartet flips it
        // out of Reserve) and notified once with that group; the second
        // quartet is unrelated to the creator, and the guest request alert
        // arrives on top. Only CHANGED players ever receive FIFO effects.
        creator: [KIND.promoted, KIND.quartet, KIND.requested],
        m1: [KIND.reserve, KIND.promoted, KIND.quartet],
        m2: [KIND.reserve, KIND.promoted, KIND.quartet],
        m3: [KIND.playing, KIND.quartet],
        m4: [KIND.reserve, KIND.promoted, KIND.quartet],
        m5: [KIND.reserve, KIND.promoted, KIND.quartet],
        m6: [KIND.playing, KIND.quartet],
        g1: [KIND.approved, KIND.reserve, KIND.promoted, KIND.quartet]
      };
      const expectedRevisions: Record<string, Record<string, number[]>> = {
        creator: { [KIND.promoted]: [3], [KIND.quartet]: [3] },
        m1: { [KIND.reserve]: [1], [KIND.promoted]: [3], [KIND.quartet]: [3] },
        m2: { [KIND.reserve]: [2], [KIND.promoted]: [3], [KIND.quartet]: [3] },
        m3: { [KIND.playing]: [3], [KIND.quartet]: [3] },
        m4: { [KIND.reserve]: [4], [KIND.promoted]: [7], [KIND.quartet]: [7] },
        m5: { [KIND.reserve]: [6], [KIND.promoted]: [7], [KIND.quartet]: [7] },
        m6: { [KIND.playing]: [7], [KIND.quartet]: [7] },
        g1: { [KIND.reserve]: [5], [KIND.promoted]: [7], [KIND.quartet]: [7] }
      };
      for (const [label, expected] of Object.entries(expectedRevisions)) {
        const inbox = await inboxOf(actors[label]!, eventKey);
        const kinds = inbox.map((row) => String(row['kind']));
        expect(
          [...kinds].sort((a, b) => a.localeCompare(b)),
          `exact inbox kinds for ${label}`
        ).toEqual([...expectedKinds[label]!].sort((a, b) => a.localeCompare(b)));
        for (const row of inbox) {
          const kind = String(row['kind']);
          expect(row['recipient_user_id'], `${kind} recipient`).toBe(actors[label]!.id);
          expect(row['category'], `${kind} category`).toBe('matches');
          expect(row['target_type'], `${kind} target type`).toBe('match_event');
          expect(row['target_id']).toBe(events[eventKey]);
        }
        // FIFO alerts carry the stable revision-keyed key:
        // match.fifo_<variant>:<eventId>:<POST-bump revision>:<recipientId>.
        const fifoAlerts = inbox.filter((row) =>
          (FIFO_KINDS as readonly string[]).includes(String(row['kind']))
        );
        for (const row of fifoAlerts) {
          const kind = String(row['kind']);
          const parts = String(row['event_key']).split(':');
          expect(parts, `${kind} key shape`).toHaveLength(4);
          expect(parts[0]).toBe(`match.fifo_${kind.replace('match_registration_', '')}`);
          expect(parts[1]).toBe(events[eventKey]);
          expect(parts[3]).toBe(actors[label]!.id);
          expect(expected[kind], `${kind} revision expected for ${label}`).toBeDefined();
          expect(expected[kind]!.map(Number), `${kind} revision segment for ${label}`).toContain(
            Number(parts[2])
          );
        }
      }
      // The approval alert keeps its own registration+attempt-scoped key.
      const g1Inbox = await inboxOf(actors.g1!, eventKey);
      const approvedAlert = g1Inbox.find(
        (row) => String(row['kind']) === 'match_registration_approved'
      )!;
      expect(String(approvedAlert['event_key'])).toMatch(
        /^match\.registration_approved:[0-9a-f-]{36}:[0-9a-f-]{36}$/
      );
    }
  );

  it.skipIf(!environment.env)(
    'writes no second alert on replay or retried duplicate actions, while a genuinely new transition writes a genuinely new revision-keyed alert',
    async () => {
      const eventKey = 'kinds';
      const g1Inbox = await inboxOf(actors.g1!, eventKey);
      const revisionBefore = await registrationStateById(events[eventKey]!);

      // Replay of the committed approval: success, original anchors, but not
      // one single additional alert and no revision movement.
      const replay = await decide(actors.creator!, eventKey, actors.g1!.id, 'approve');
      expect(replay.error).toBeNull();
      expect(asRecord(replay.data)['replayed']).toBe(true);
      expect(await inboxOf(actors.g1!, eventKey)).toEqual(g1Inbox);
      expect(await registrationStateById(events[eventKey]!)).toEqual(revisionBefore);

      // A retried duplicate submission is refused and alerts nobody.
      const m4Before = await inboxOf(actors.m4!, eventKey);
      const duplicate = await submit(actors.m4!, eventKey);
      expect(duplicate.error).not.toBeNull();
      expect(asRecord(duplicate.error)['message']).toBe('MATCH_REGISTRATION_DUPLICATE');
      expect(await inboxOf(actors.m4!, eventKey)).toEqual(m4Before);

      // A genuinely NEW transition (N=8 -> N=9, new player into Reserve)
      // writes exactly one new alert under the next revision.
      const acceptedBefore = Number(
        (
          await sqlRows(`select pg_catalog.count(*)::int as n from public.match_event_registrations
           where match_event_id = '${events[eventKey]!}' and lifecycle = 'accepted'`)
        )[0]!['n']
      );
      const seventh = await submit(actors.m7!, eventKey);
      expect(seventh.error).toBeNull();
      const revisionAfter = await registrationStateById(events[eventKey]!);
      expect(revisionAfter.revision).toBe(revisionBefore.revision + 1);
      const m7Inbox = await inboxOf(actors.m7!, eventKey);
      expect(m7Inbox).toHaveLength(1);
      expect(String(m7Inbox[0]!['kind'])).toBe('match_registration_reserve');
      const keyParts = String(m7Inbox[0]!['event_key']).split(':');
      expect(Number(keyParts[2])).toBe(revisionAfter.revision);
      // No other player was touched by this transition.
      expect(acceptedBefore).toBe(8);
      await expectRosterAgreement(events[eventKey]!);
    }
  );

  it.skipIf(!environment.env)(
    'rolls the ENTIRE acceptance back when a notification effect fails, consuming no row, ordinal, participation change or partial alert set',
    async () => {
      const eventKey = 'rollback';
      // Seed N=3: creator + two members, all still Reserve.
      for (const label of ['m7', 'm8']) {
        const result = await submit(actors[label]!, eventKey);
        expect(result.error, `${label} submit`).toBeNull();
      }
      await expectRosterAgreement(events[eventKey]!);
      const stateBefore = await registrationStateById(events[eventKey]!);
      expect(stateBefore).toEqual({ next: 4, revision: 2 });
      // Baseline inboxes before the blocked acceptance: m7 and m8 carry their
      // seed-phase Reserve alerts, the creator carries nothing for this event.
      const baselines = new Map<string, SqlRow[]>();
      for (const label of ['creator', 'm7', 'm8', 'm9']) {
        baselines.set(label, await inboxOf(actors[label]!, eventKey));
      }

      // Test-only trusted mechanism: any FIFO alert for THIS event raises, so
      // the quartet-completing acceptance below cannot persist its effects.
      // One command per call: the trusted channel runs single statements.
      await fixtureSql(
        `create function public.paf54_block_fifo_alert() returns trigger language plpgsql as $fn$ begin raise exception 'PAF54_ROLLBACK_PROOF' using errcode = 'P0001'; end $fn$;`
      );
      await fixtureSql(
        `create trigger paf54_block_fifo_alert before insert on public.notifications for each row when (new.target_id = '${events[eventKey]}') execute function public.paf54_block_fifo_alert();`
      );

      try {
        const failing = await submit(actors.m9!, eventKey);
        expect(failing.error, 'blocked acceptance must fail').not.toBeNull();
        expect(String(asRecord(failing.error)['message'])).toContain('PAF54_ROLLBACK_PROOF');

        // No registration row, no attempt row, no ordinal, no revision.
        const leakedRows = await sqlRows(
          `select
             (select pg_catalog.count(*)::int from public.match_event_registrations
               where match_event_id = '${events[eventKey]!}' and user_id = '${actors.m9!.id}') as registrations,
             (select pg_catalog.count(*)::int from public.match_event_registration_attempts
               where match_event_id = '${events[eventKey]!}' and user_id = '${actors.m9!.id}') as attempts`
        );
        expect(Number(leakedRows[0]!['registrations'])).toBe(0);
        expect(Number(leakedRows[0]!['attempts'])).toBe(0);
        expect(await registrationStateById(events[eventKey]!)).toEqual(stateBefore);
        // No participation change and no partial notification set anywhere.
        await expectRosterAgreement(events[eventKey]!);
        expect(await inboxOf(actors.m9!, eventKey)).toEqual([]);
        for (const label of ['creator', 'm7', 'm8']) {
          expect(await inboxOf(actors[label]!, eventKey)).toEqual(baselines.get(label));
        }
      } finally {
        // Remove the test-only mechanism and prove the database is unpolluted.
        await fixtureSql(`drop trigger if exists paf54_block_fifo_alert on public.notifications;`);
        await fixtureSql(`drop function if exists public.paf54_block_fifo_alert();`);
      }
      const residue = await sqlRows(
        `select
           (select pg_catalog.count(*)::int from pg_catalog.pg_trigger
             where tgname = 'paf54_block_fifo_alert' and not tgisinternal) as triggers,
           (select pg_catalog.count(*)::int from pg_catalog.pg_proc p
             join pg_catalog.pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'paf54_block_fifo_alert') as functions`
      );
      expect(Number(residue[0]!['triggers'])).toBe(0);
      expect(Number(residue[0]!['functions'])).toBe(0);

      // With the mechanism gone, the very same acceptance succeeds in full:
      // the quartet promotes atomically and every effect lands.
      const retried = await submit(actors.m9!, eventKey);
      expect(retried.error, 'retry after cleanup').toBeNull();
      expect(asRecord(retried.data)).toMatchObject({
        lifecycle: 'accepted',
        participation: 'playing',
        accepted_order: 4
      });
      const agreement = await expectRosterAgreement(events[eventKey]!);
      expect(agreement).toEqual({ acceptedTotal: 4, playingTotal: 4, reserveTotal: 0 });
      const m9Inbox = await inboxOf(actors.m9!, eventKey);
      expect(m9Inbox.map((row) => String(row['kind'])).sort((a, b) => a.localeCompare(b))).toEqual([
        'match_registration_playing',
        'match_registration_quartet_complete'
      ]);
      for (const label of ['creator', 'm7', 'm8']) {
        const inbox = await inboxOf(actors[label]!, eventKey);
        expect(inbox.map((row) => String(row['kind'])).sort((a, b) => a.localeCompare(b))).toEqual(
          [
            ...(baselines.get(label) ?? []).map((row) => String(row['kind'])),
            'match_registration_promoted',
            'match_registration_quartet_complete'
          ].sort((a, b) => a.localeCompare(b))
        );
      }
      expect(await registrationStateById(events[eventKey]!)).toEqual({
        next: 5,
        revision: stateBefore.revision + 1
      });
    }
  );

  it.skipIf(!environment.env)('scopes every alert to its recipient only', async () => {
    const eventKey = 'kinds';
    const m1Inbox = await inboxOf(actors.m1!, eventKey);
    const promoted = m1Inbox.find((row) => String(row['kind']) === 'match_registration_promoted');
    expect(promoted, 'm1 holds a promoted alert').toBeDefined();

    // The recipient reads it; nobody else can, not even the event creator.
    const recipientRead = await actors
      .m1!.client.from('notifications')
      .select('id')
      .eq('id', String(promoted!['id']));
    expect(recipientRead.error).toBeNull();
    expect(recipientRead.data).toHaveLength(1);
    for (const outsider of [actors.m2!, actors.creator!]) {
      const foreignRead = await outsider.client
        .from('notifications')
        .select('id')
        .eq('id', String(promoted!['id']));
      expect(foreignRead.error, `${outsider.name} scoped read`).toBeNull();
      expect(foreignRead.data, `${outsider.name} sees nothing`).toEqual([]);
    }

    // The typed target resolution allows the new kinds for the recipient and
    // refuses everyone else.
    const target = await actors.m1!.client.rpc('get_my_notification_target_v2', {
      p_notification_id: String(promoted!['id'])
    });
    expect(target.error).toBeNull();
    const rows: unknown[] = Array.isArray(target.data) ? target.data : [];
    expect(rows).toHaveLength(1);
    expect(asRecord(rows[0])).toMatchObject({
      target_status: 'match_available',
      match_event_id: events[eventKey],
      match_available: true
    });
    const foreignTarget = await actors.m2!.client.rpc('get_my_notification_target_v2', {
      p_notification_id: String(promoted!['id'])
    });
    expect(foreignTarget.error).not.toBeNull();
  });
});
