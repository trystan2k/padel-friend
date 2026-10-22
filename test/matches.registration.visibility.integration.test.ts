import { spawn } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { Database } from '../src/lib/supabase/database.types';
import { matchPhotoFixture } from './helpers/match-photo-fixtures';
import {
  assertLocalSupabaseEnvInCi,
  dotEnvPathFromImportMetaUrl,
  localSupabaseEnv
} from './helpers/local-supabase-env';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
type Env = NonNullable<typeof environment.env>;
type Actor = { id: string; client: SupabaseClient<Database>; name: string };

async function fixtureSql(env: Env, sql: string): Promise<void> {
  const child = spawn(
    'pnpm',
    ['exec', 'supabase', 'db', 'query', '--local', '--output-format', 'json', sql],
    { cwd: process.cwd() }
  );
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  if (code !== 0) throw new Error(`Trusted fixture SQL failed (${code}): ${stdout}\n${stderr}`);
  void env;
}

describe('match registration visibility integration', () => {
  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  it('requires local Supabase in CI', () => {
    expect(() => assertLocalSupabaseEnvInCi(environment.env, process.env.CI)).not.toThrow();
  });

  it.skipIf(!environment.env)(
    'keeps non-accepted rows invisible, unreadable and uncounted while the raw write surface stays denied',
    async () => {
      const { url, key } = environment.env!;
      async function actor(label: string, displayName?: string, level = 3.2): Promise<Actor> {
        const signup = await createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false }
        }).auth.signUp({
          email: `reg-vis-${label}-${crypto.randomUUID()}@test.local`,
          password: 'Password123!'
        });
        expect(signup.error).toBeNull();
        expect(signup.data.session, 'local email confirmations must be disabled').not.toBeNull();
        const client = createClient<Database>(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { headers: { Authorization: `Bearer ${signup.data.session!.access_token}` } }
        });
        expect(
          (
            await client.rpc('onboard_player', {
              p_display_name: displayName ?? `Registration ${label}`,
              p_preferred_side: 'EITHER',
              p_initial_level: level
            })
          ).error
        ).toBeNull();
        return { id: signup.data.user!.id, client, name: displayName ?? `Registration ${label}` };
      }
      const [
        creator,
        admin,
        memberInRange,
        memberOutOfRange,
        memberPending,
        memberInactive,
        publicOutsider,
        privateOutsider,
        invitee,
        acceptedPlayer,
        requesterPending,
        requesterRejected,
        requesterExpired
      ] = await Promise.all([
        actor('creator', 'Registration Creator'),
        actor('admin', 'Registration Admin'),
        actor('in-range', 'Registration In Range', 3.2),
        actor('out-of-range', 'Registration Out Of Range', 5.2),
        actor('membership-pending'),
        actor('membership-inactive'),
        actor('public-outsider'),
        actor('private-outsider'),
        actor('invitee', 'Registration Invitee'),
        actor('accepted', 'Registration Accepted'),
        actor('requester-pending'),
        actor('requester-rejected'),
        actor('requester-expired')
      ]);
      const actors: Record<string, Actor> = {
        creator,
        admin,
        memberInRange,
        memberOutOfRange,
        memberPending,
        memberInactive,
        publicOutsider,
        privateOutsider,
        invitee,
        acceptedPlayer,
        requesterPending,
        requesterRejected,
        requesterExpired
      };
      const publicCommunity = crypto.randomUUID();
      const privateCommunity = crypto.randomUUID();
      const events: Record<string, string> = {
        pubOpen: crypto.randomUUID(),
        pubInvite: crypto.randomUUID(),
        privOpen: crypto.randomUUID(),
        privInvite: crypto.randomUUID(),
        exclFuture: crypto.randomUUID(),
        exclPast: crypto.randomUUID()
      };
      const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
      const photoFixtures = Object.fromEntries(
        Object.entries(events).map(([eventKey, eventId]) => [
          eventKey,
          matchPhotoFixture(
            eventKey.startsWith('priv') ? privateCommunity : publicCommunity,
            eventId,
            creator.id
          )
        ])
      );
      const insertEvent = (eventKey: string, communityId: string, visibility: string) =>
        `${photoFixtures[eventKey]!.sql}
       insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,registration_cutoff_at)
       values (${q(events[eventKey]!)},${q(communityId)},${q(creator.id)},now()+interval '3 days','UTC','friendly',${q(visibility)},'POST_MATCH_TEAMS','Visibility court','https://maps.google.com/maps/place/visibility','${photoFixtures[eventKey]!.path}',now()+interval '2 days');`;
      await fixtureSql(
        environment.env!,
        `do $$ begin
      insert into public.communities(id,name,visibility,created_by) values
        (${q(publicCommunity)},'Registration public fixture','public',${q(creator.id)}),
        (${q(privateCommunity)},'Registration private fixture','private',${q(creator.id)});
      insert into public.community_members(community_id,user_id,role,status,valid_from,activated_at) values
        (${q(publicCommunity)},${q(creator.id)},'admin','active',now()-interval '1 minute',now()-interval '1 minute'),
        (${q(publicCommunity)},${q(admin.id)},'admin','active',now()-interval '1 minute',now()-interval '1 minute'),
        (${q(publicCommunity)},${q(memberInRange.id)},'member','active',now()-interval '1 minute',now()-interval '1 minute'),
        (${q(publicCommunity)},${q(memberOutOfRange.id)},'member','active',now()-interval '1 minute',now()-interval '1 minute'),
        (${q(publicCommunity)},${q(memberPending.id)},'member','pending',now()-interval '1 minute',null),
        (${q(privateCommunity)},${q(creator.id)},'admin','active',now()-interval '1 minute',now()-interval '1 minute'),
        (${q(privateCommunity)},${q(admin.id)},'admin','active',now()-interval '1 minute',now()-interval '1 minute'),
        (${q(privateCommunity)},${q(memberPending.id)},'member','pending',now()-interval '1 minute',null);
      insert into public.community_members(community_id,user_id,role,status,valid_from,valid_until,activated_at)
        values (${q(publicCommunity)},${q(memberInactive.id)},'member','inactive',now()-interval '2 minutes',now()-interval '1 minute',now()-interval '2 minutes');
       ${insertEvent('pubOpen', publicCommunity, 'community_open')}
      ${insertEvent('pubInvite', publicCommunity, 'invite_only')}
      ${insertEvent('privOpen', privateCommunity, 'community_open')}
      ${insertEvent('privInvite', privateCommunity, 'invite_only')}
      ${insertEvent('exclFuture', publicCommunity, 'community_open')}
      -- Past events skip the future-start creator registration trigger.
      alter table public.match_events disable trigger match_event_creator_registration;
       ${photoFixtures.exclPast!.sql}
       insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,registration_cutoff_at)
         values (${q(events.exclPast!)},${q(publicCommunity)},${q(creator.id)},now()-interval '2 hours','UTC','friendly','community_open','POST_MATCH_TEAMS','Visibility court','https://maps.google.com/maps/place/visibility','${photoFixtures.exclPast!.path}',now()-interval '3 hours');
      alter table public.match_events enable trigger match_event_creator_registration;
      insert into public.match_event_invites(match_event_id,invitee_user_id,invited_by) values
        (${q(events.pubInvite!)},${q(invitee.id)},${q(creator.id)});
      -- Accepted rows keep their anchors; pending/rejected/expired rows carry none.
      insert into public.match_event_registrations(match_event_id,user_id,accepted_at,accepted_order,participation_status,registration_source) values
        (${q(events.pubOpen!)},${q(memberInRange.id)},now()+interval '1 minute',2,'reserve','member');
      insert into public.match_event_registrations(match_event_id,user_id,accepted_at,accepted_order,participation_status,registration_source) values
        (${q(events.pubInvite!)},${q(acceptedPlayer.id)},now()+interval '1 minute',2,'reserve','member');
      insert into public.match_event_registrations(match_event_id,user_id,lifecycle,requested_at,registration_source) values
        (${q(events.pubOpen!)},${q(memberOutOfRange.id)},'pending',now(),'member'),
        (${q(events.pubInvite!)},${q(requesterPending.id)},'pending',now(),'member'),
        (${q(events.pubInvite!)},${q(requesterRejected.id)},'rejected',now()-interval '1 minute','member'),
        (${q(events.pubInvite!)},${q(requesterExpired.id)},'expired',now()-interval '2 hours','member'),
        (${q(events.privOpen!)},${q(requesterPending.id)},'pending',now(),'member'),
        (${q(events.exclFuture!)},${q(requesterPending.id)},'pending',now(),'member'),
        (${q(events.exclPast!)},${q(requesterPending.id)},'pending',now()-interval '3 hours','member'),
        (${q(events.exclPast!)},${q(requesterRejected.id)},'rejected',now()-interval '3 hours','member');
      update public.match_event_registrations set resolved_at=now(), resolved_by=${q(creator.id)}
        where lifecycle in ('rejected','expired')
          and match_event_id in (${q(events.pubInvite!)},${q(events.privOpen!)},${q(events.exclFuture!)},${q(events.exclPast!)});
      insert into public.match_event_registration_attempts(registration_id,match_event_id,user_id,requested_at,decided_at,outcome,actor_id,accepted_at,approved_at,accepted_order,registration_source)
        select r.id,r.match_event_id,r.user_id,coalesce(r.requested_at,r.accepted_at),
          case when r.lifecycle='accepted' then r.accepted_at when r.lifecycle<>'pending' then r.resolved_at end,
          r.lifecycle,case when r.lifecycle='accepted' then r.user_id else r.resolved_by end,r.accepted_at,r.approved_at,r.accepted_order,r.registration_source
        from public.match_event_registrations r where r.current_attempt_id is null and r.match_event_id in (${Object.values(events).map(q).join(',')});
      update public.match_event_registrations r set current_attempt_id=a.id from public.match_event_registration_attempts a
        where a.registration_id=r.id and r.current_attempt_id is null and r.match_event_id in (${Object.values(events).map(q).join(',')});
    end $$;`
      );

      const detailOf = async (who: Actor, eventId: string): Promise<unknown> => {
        const result = await who.client.rpc('get_match_event', { p_event_id: eventId });
        expect(result.error, `${who.name} detail ${eventId}`).toBeNull();
        return result.data;
      };
      const canRead = async (who: Actor, eventId: string): Promise<boolean | null> => {
        const result = await who.client.rpc('can_read_match_event', { p_event_id: eventId });
        expect(result.error, `${who.name} can_read ${eventId}`).toBeNull();
        return result.data;
      };
      const listIds = async (who: Actor, entry: string, communityId: string): Promise<string[]> => {
        const result = await who.client.rpc('list_match_events', {
          p_entry: entry,
          p_community_id: communityId,
          p_cursor: '',
          p_limit: 50,
          p_as_of: new Date().toISOString()
        });
        expect(result.error, `${who.name} list ${entry}`).toBeNull();
        const rows: unknown = result.data;
        return (Array.isArray(rows) ? rows : []).map((row: Record<string, unknown>) =>
          String(row['event_id'])
        );
      };
      const asRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

      // --- Non-accepted rows are excluded from get_match_event counts and quartets.
      const inviteDetail = asRecord(await detailOf(creator, events.pubInvite!));
      // Creator + accepted player only: pending/rejected/expired must not count.
      expect(inviteDetail['accepted_count']).toBe(2);
      expect(inviteDetail['playing_count']).toBe(0);
      expect(inviteDetail['reserve_count']).toBe(2);
      expect(inviteDetail['group_count']).toBe(0);
      expect(inviteDetail['more_needed']).toBe(2);
      expect(inviteDetail['caller_badge']).toBe('creator');
      // The forged pending row on the private event must not inflate the count.
      const privDetail = asRecord(await detailOf(creator, events.privOpen!));
      expect(privDetail['accepted_count']).toBe(1);
      expect(privDetail['reserve_count']).toBe(1);
      expect(asRecord(await detailOf(acceptedPlayer, events.pubInvite!))['caller_badge']).toBe(
        'reserve'
      );

      // --- Non-accepted rows do not surface the event under my/past entries.
      const sorted = (values: string[]): string[] => [...values].sort((a, b) => a.localeCompare(b));
      expect(sorted(await listIds(creator, 'my', publicCommunity))).toEqual(
        sorted([events.pubOpen!, events.pubInvite!, events.exclFuture!])
      );
      expect(await listIds(creator, 'past', publicCommunity)).toEqual([events.exclPast]);
      // Requesters hold only pending/rejected rows: never in my or past.
      for (const who of [requesterPending, requesterRejected, requesterExpired]) {
        expect(await listIds(who, 'my', publicCommunity)).toEqual([]);
        expect(await listIds(who, 'past', publicCommunity)).toEqual([]);
      }
      // available still lists public open events to anyone; hidden ones stay hidden.
      expect(sorted(await listIds(requesterPending, 'available', publicCommunity))).toEqual(
        sorted([events.pubOpen!, events.exclFuture!])
      );
      // The invitee's invitation (not any registration) puts pubInvite under my.
      expect(await listIds(invitee, 'my', publicCommunity)).toEqual([events.pubInvite]);

      // --- A non-accepted row alone grants no visibility of invite-only or
      // private-community events.
      for (const who of [requesterPending, requesterRejected, requesterExpired]) {
        for (const hidden of [events.pubInvite!, events.privOpen!, events.privInvite!]) {
          expect(await detailOf(who, hidden), `${who.name} detail ${hidden}`).toBeNull();
          expect(await canRead(who, hidden), `${who.name} can_read ${hidden}`).toBe(false);
          const direct = await who.client.from('match_events').select('id').eq('id', hidden);
          expect(direct.error).toBeNull();
          expect(direct.data, `${who.name} direct ${hidden}`).toEqual([]);
        }
      }
      // Positive controls: an accepted row keeps invite visibility; an invite alone too.
      expect(await detailOf(acceptedPlayer, events.pubInvite!)).not.toBeNull();
      expect(await canRead(acceptedPlayer, events.pubInvite!)).toBe(true);
      expect(await detailOf(invitee, events.pubInvite!)).not.toBeNull();

      // --- Role matrix over match_event_registrations reads: own rows, plus
      // creator/community-admin rosters; nobody else's rows ever leak.
      const visibleRows = async (who: Actor) => {
        const result = await who.client.from('match_event_registrations').select('*');
        expect(result.error, `${who.name} roster read`).toBeNull();
        return result.data ?? [];
      };
      const totalRows = 15;
      const creatorRows = await visibleRows(creator);
      expect(creatorRows).toHaveLength(totalRows);
      // Finding F10 (PAF-5.2): pending/resolution metadata is visible only to the
      // requester and the creator; a community Admin is not an approver, so the
      // admin roster read narrows to the accepted rows only (5 creator slots +
      // the 2 explicitly accepted members).
      expect(await visibleRows(admin)).toHaveLength(7);
      // Ordinary actors see exactly their own rows; hidden event ids never leak
      // through the roster table.
      const ownRow = async (who: Actor, eventKey: string) => {
        const rows = await visibleRows(who);
        expect(rows, `${who.name} roster`).toHaveLength(1);
        expect(rows[0]!['match_event_id']).toBe(events[eventKey]);
        return rows[0]!;
      };
      expect((await ownRow(memberInRange, 'pubOpen'))['lifecycle']).toBe('accepted');
      const outOfRangeRow = await ownRow(memberOutOfRange, 'pubOpen');
      // Out-of-range membership does not change row visibility: own pending row.
      expect(outOfRangeRow['lifecycle']).toBe('pending');
      expect(outOfRangeRow['accepted_at']).toBeNull();
      expect(outOfRangeRow['accepted_order']).toBeNull();
      expect(outOfRangeRow['participation_status']).toBeNull();
      for (const who of [memberPending, memberInactive, publicOutsider, privateOutsider, invitee]) {
        expect(await visibleRows(who), `${who.name} roster`).toEqual([]);
      }
      const pendingRows = await visibleRows(requesterPending);
      expect(pendingRows).toHaveLength(4);
      for (const row of pendingRows) {
        expect(row['lifecycle']).toBe('pending');
        expect(row['accepted_at']).toBeNull();
        expect(row['accepted_order']).toBeNull();
        expect(row['participation_status']).toBeNull();
        expect(row['approved_at']).toBeNull();
        expect(row['requested_at']).not.toBeNull();
      }
      const rejectedRows = await visibleRows(requesterRejected);
      expect(rejectedRows).toHaveLength(2);
      for (const row of rejectedRows) {
        expect(row['lifecycle']).toBe('rejected');
        expect(row['resolved_by']).toBe(creator.id);
        expect(row['resolved_at']).not.toBeNull();
      }
      const expiredRows = await visibleRows(requesterExpired);
      expect(expiredRows).toHaveLength(1);
      expect(expiredRows[0]!['lifecycle']).toBe('expired');
      const acceptedRows = await visibleRows(acceptedPlayer);
      expect(acceptedRows).toHaveLength(1);
      expect(acceptedRows[0]!['match_event_id']).toBe(events.pubInvite);
      expect(acceptedRows[0]!['accepted_order']).toBe(2);
      // The accepted player must not see other rows of the same event.
      expect(creatorRows.filter((row) => row['match_event_id'] === events.pubInvite)).toHaveLength(
        5
      );

      // --- Raw writes are denied for every role: no insert, no forged approval
      // anchors, no delete, and no path through the internal state/attempt tables.
      type RegistrationUpdate = Database['public']['Tables']['match_event_registrations']['Update'];
      const denied = async (
        label: string,
        promise: PromiseLike<{ error: { code?: string | null } | null }>
      ) => {
        const result = await promise;
        expect(result.error, `${label} must be denied`).not.toBeNull();
        expect(result.error!.code, `${label} denial`).toBe('42501');
      };
      for (const [name, who] of Object.entries(actors)) {
        await denied(
          `${name} insert`,
          who.client.from('match_event_registrations').insert({
            match_event_id: events.privOpen!,
            user_id: who.id,
            accepted_at: new Date().toISOString(),
            accepted_order: 9,
            participation_status: 'playing',
            registration_source: 'member'
          })
        );
        await denied(
          `${name} crafted upsert`,
          who.client.from('match_event_registrations').upsert(
            {
              match_event_id: events.privOpen!,
              user_id: who.id,
              accepted_at: new Date().toISOString(),
              accepted_order: 9,
              participation_status: 'playing',
              registration_source: 'member'
            },
            { onConflict: 'match_event_id,user_id' }
          )
        );
        await denied(
          `${name} lifecycle tamper`,
          who.client
            .from('match_event_registrations')
            .update({ lifecycle: 'accepted' })
            .eq('match_event_id', events.pubInvite!)
        );
      }
      // The privileged readers (creator/admin) and the own-row owners cannot
      // forge approval state either.
      const forgeTargets: Array<[Actor, string]> = [
        [creator, events.pubInvite!],
        [admin, events.pubInvite!],
        [requesterPending, events.pubInvite!],
        [acceptedPlayer, events.pubInvite!]
      ];
      for (const [who, eventId] of forgeTargets) {
        const forged: RegistrationUpdate[] = [
          { lifecycle: 'accepted' },
          { participation_status: 'playing' },
          { accepted_at: new Date().toISOString() },
          { approved_at: new Date().toISOString() },
          { accepted_order: 7 },
          { resolved_at: new Date().toISOString() },
          { resolved_by: creator.id }
        ];
        for (const [index, patch] of forged.entries()) {
          await denied(
            `${who.name} forge ${Object.keys(patch)[0]}#${index}`,
            who.client
              .from('match_event_registrations')
              .update(patch)
              .eq('match_event_id', eventId)
              .eq('user_id', requesterPending.id)
          );
        }
      }
      await denied(
        'creator delete',
        creator.client.from('match_event_registrations').delete().eq('id', acceptedRows[0]!['id'])
      );
      await denied(
        'requester delete own',
        requesterPending.client
          .from('match_event_registrations')
          .delete()
          .eq('id', pendingRows[0]!['id'])
      );
      // The internal ordinal/attempt tables have no grants at all.
      for (const who of [creator, admin]) {
        await denied(
          `${who.name} state read`,
          who.client.from('match_event_registration_state').select('*')
        );
        await denied(
          `${who.name} state write`,
          who.client
            .from('match_event_registration_state')
            .update({ next_accepted_ordinal: 99 })
            .eq('match_event_id', events.pubInvite!)
        );
        await denied(
          `${who.name} attempts read`,
          who.client.from('match_event_registration_attempts').select('*')
        );
        await denied(
          `${who.name} attempts write`,
          who.client.from('match_event_registration_attempts').insert({
            match_event_id: events.pubInvite!,
            registration_id: crypto.randomUUID(),
            registration_source: 'member',
            user_id: requesterPending.id,
            requested_at: new Date().toISOString(),
            outcome: 'accepted'
          })
        );
      }

      // --- Anonymous sessions (no claims) are rejected outright.
      const anonClient = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      expect((await anonClient.from('match_events').select('id')).error).not.toBeNull();
      expect(
        (await anonClient.from('match_event_registrations').select('id')).error
      ).not.toBeNull();
      expect(
        (await anonClient.rpc('can_read_match_event', { p_event_id: events.pubOpen! })).error
      ).not.toBeNull();

      // --- Anonymous JWT claims (is_anonymous=true, authenticated role) must
      // see nothing, and is_private_match_event keys off accepted rows only.
      // The local gateway only accepts GoTrue-issued JWKS tokens, so claims are
      // evaluated through the trusted SQL channel exactly like the
      // community column-isolation suite does.
      await fixtureSql(
        environment.env!,
        `do $$
      declare
        v_read boolean;
        v_events integer;
        v_regs integer;
        v_private boolean;
       begin
        perform set_config('role','authenticated',true);
        perform set_config('request.jwt.claims', jsonb_build_object('sub',${q(invitee.id)},'role','authenticated','is_anonymous',true)::text, true);
        select public.can_read_match_event(${q(events.pubOpen!)}), (select count(*)::int from public.match_events),
          (select count(*)::int from public.match_event_registrations)
          into v_read, v_events, v_regs;
        if v_read is not false or v_events <> 0 or v_regs <> 0 then
          raise exception 'anonymous claims gained visibility: read=% events=% regs=%', v_read, v_events, v_regs;
        end if;
        select public.can_read_match_event(${q(events.pubInvite!)}) into v_read;
        if v_read is not false then raise exception 'anonymous claims can read invite-only events'; end if;
        -- is_private_match_event: pending/rejected/expired rows grant nothing.
        perform set_config('role','postgres',true);
        perform set_config('request.jwt.claims', jsonb_build_object('sub',${q(requesterPending.id)},'role','authenticated')::text, true);
        select public.is_private_match_event(${q(events.pubInvite!)}) into v_private;
        if v_private is not false then raise exception 'pending row marks invite-only event private'; end if;
        select public.is_private_match_event(${q(events.privOpen!)}) into v_private;
        if v_private is not false then raise exception 'pending row marks private event private'; end if;
        perform set_config('request.jwt.claims', jsonb_build_object('sub',${q(requesterExpired.id)},'role','authenticated')::text, true);
        select public.is_private_match_event(${q(events.pubInvite!)}) into v_private;
        if v_private is not false then raise exception 'expired row marks event private'; end if;
        perform set_config('request.jwt.claims', jsonb_build_object('sub',${q(requesterRejected.id)},'role','authenticated')::text, true);
        select public.is_private_match_event(${q(events.pubInvite!)}) into v_private;
        if v_private is not false then raise exception 'rejected row marks event private'; end if;
        -- Positive controls: accepted row and creator keep the helpers true.
        perform set_config('request.jwt.claims', jsonb_build_object('sub',${q(acceptedPlayer.id)},'role','authenticated')::text, true);
        select public.is_private_match_event(${q(events.pubInvite!)}) into v_private;
        if v_private is not true then raise exception 'accepted row lost private marking'; end if;
        perform set_config('request.jwt.claims', jsonb_build_object('sub',${q(creator.id)},'role','authenticated')::text, true);
        select public.is_private_match_event(${q(events.privInvite!)}) into v_private;
        if v_private is not true then raise exception 'creator lost private marking'; end if;
       end $$;`
      );
    },
    120000
  );
});
