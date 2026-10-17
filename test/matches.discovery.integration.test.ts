import { spawn } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { Database } from '../src/lib/supabase/database.types';
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
  if (code !== 0) throw new Error(`Trusted fixture SQL failed (${code}): ${stdout}\\n${stderr}`);
  void env;
}

const expectedDetailKeys = [
  'accepted_count',
  'caller_badge',
  'caller_eligibility',
  'caller_requires_approval',
  'community_id',
  'community_name',
  'court_booked',
  'court_notes',
  'creator_id',
  'creator_level',
  'creator_name',
  'currency',
  'duration_minutes',
  'event_id',
  'event_type',
  'group_count',
  'maps_url',
  'max_level',
  'maximum_registrations',
  'min_level',
  'more_needed',
  'is_past',
  'notes',
  'payment_note',
  'photo_path',
  'playing_count',
  'price_minor',
  'registration_cutoff_at',
  'registration_open',
  'reserve_count',
  'restriction_enabled',
  'starts_at',
  'team_assignment_mode',
  'timezone',
  'venue_name',
  'visibility'
].sort();
type ListRow = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const recordPayload = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error('Expected a JSON object payload');
  return value;
};
const listPayload = (value: unknown): ListRow[] =>
  Array.isArray(value) ? value.map(recordPayload) : [];
const textOf = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('Expected a string field');
  return value;
};
const eventIdOf = (row: ListRow) => textOf(row['event_id']);
const sorted = (values: string[]): string[] => [...values].sort((a, b) => a.localeCompare(b));
const listedIds = (rows: ListRow[]) => sorted(rows.map(eventIdOf));

describe('match event discovery integration', () => {
  it('requires local Supabase in CI', () => {
    expect(() => assertLocalSupabaseEnvInCi(environment.env, process.env.CI)).not.toThrow();
  });

  it.skipIf(!environment.env)(
    'returns readable event details without leakage, filters listings by entry rules, derives counts and FIFO badges, pages keysets and searches invitees',
    async () => {
      const { url, key } = environment.env!;
      async function actor(label: string, displayName: string, level = 3.2): Promise<Actor> {
        const signup = await createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false }
        }).auth.signUp({
          email: `${label}-${crypto.randomUUID()}@test.local`,
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
              p_display_name: displayName,
              p_preferred_side: 'EITHER',
              p_initial_level: level
            })
          ).error
        ).toBeNull();
        return { id: signup.data.user!.id, client, name: displayName };
      }
      const token = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
      const [
        creator,
        member,
        outOfRange,
        admin2,
        invitee,
        accepted,
        both,
        fifth,
        nonmember,
        stranger,
        target,
        pending,
        inactive
      ] = await Promise.all([
        actor('disc-creator', 'Discovery Creator'),
        actor('disc-member', `Zebra ${token} Caller`),
        actor('disc-out-of-range', 'Discovery Out Of Range', 5.2),
        actor('disc-admin', 'Discovery Admin'),
        actor('disc-invitee', 'Discovery Invitee'),
        actor('disc-accepted', 'Discovery Accepted'),
        actor('disc-both', 'Discovery Both'),
        actor('disc-fifth', 'Discovery Fifth'),
        actor('disc-nonmember', 'Discovery Nonmember'),
        actor('disc-stranger', 'Discovery Stranger'),
        actor('disc-target', `Zebra ${token} Target`),
        actor('disc-pending', `Zebra ${token} Pending`),
        actor('disc-inactive', `Zebra ${token} Inactive`)
      ]);
      const actors: Record<string, Actor> = {
        creator: creator,
        member: member,
        outOfRange: outOfRange,
        admin2: admin2,
        invitee: invitee,
        accepted: accepted,
        both: both,
        fifth: fifth,
        nonmember: nonmember,
        stranger: stranger,
        target: target,
        pending: pending,
        inactive: inactive
      };
      const publicCommunity = crypto.randomUUID();
      const privateCommunity = crypto.randomUUID();
      const pageCommunity = crypto.randomUUID();
      const events: Record<string, string> = {
        anchor: crypto.randomUUID(),
        full: crypto.randomUUID(),
        inviteOnly: crypto.randomUUID(),
        pastRecent: crypto.randomUUID(),
        pastOldest: crypto.randomUUID(),
        pastMiddle: crypto.randomUUID(),
        cutoffElapsed: crypto.randomUUID(),
        fourAccepted: crypto.randomUUID(),
        fiveAccepted: crypto.randomUUID(),
        privateOpen: crypto.randomUUID(),
        pageA: crypto.randomUUID(),
        pageB: crypto.randomUUID(),
        pageC: crypto.randomUUID()
      };
      const venueA = crypto.randomUUID();
      const venueB = crypto.randomUUID();
      const venueC = crypto.randomUUID();
      const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
      const photo = () => `'${crypto.randomUUID()}/photo.webp'`;
      const insertEvent = (
        eventKey: string,
        communityId: string,
        startsAt: string,
        cutoff: string,
        extra = ',null,null,null,null,false,null',
        restricted = false
      ) =>
        `insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,registration_cutoff_at,maximum_registrations,price_minor,currency,duration_minutes,court_booked,notes,restriction_enabled,min_level,max_level)
         values (${q(events[eventKey]!)},${q(communityId)},${q(creator.id)},${startsAt},'UTC','friendly','community_open','POST_MATCH_TEAMS','Discovery court','https://maps.google.com/maps/place/discovery',${photo()},${cutoff}${extra},${restricted},${restricted ? 3 : 'null'},${restricted ? 4 : 'null'});`;
      await fixtureSql(
        environment.env!,
        `do $$ begin
      insert into public.communities(id,name,visibility,created_by,settings) values
        (${q(publicCommunity)},'Discovery public','public',${q(creator.id)},'{}'::jsonb),
        (${q(privateCommunity)},'Discovery private','private',${q(creator.id)},'{}'::jsonb),
        (${q(pageCommunity)},'Discovery paging','public',${q(creator.id)},'{}'::jsonb);
      insert into public.community_members(community_id,user_id,role,status,valid_from,activated_at) values
        (${q(publicCommunity)},${q(creator.id)},'admin','active',now()-interval '1 minute',now()-interval '1 minute'),
         (${q(publicCommunity)},${q(member.id)},'member','active',now()-interval '1 minute',now()-interval '1 minute'),
         (${q(publicCommunity)},${q(outOfRange.id)},'member','active',now()-interval '1 minute',now()-interval '1 minute'),
        (${q(publicCommunity)},${q(admin2.id)},'admin','active',now()-interval '1 minute',now()-interval '1 minute'),
        (${q(publicCommunity)},${q(invitee.id)},'member','active',now()-interval '1 minute',now()-interval '1 minute'),
        (${q(publicCommunity)},${q(accepted.id)},'member','active',now()-interval '1 minute',now()-interval '1 minute'),
        (${q(publicCommunity)},${q(target.id)},'member','active',now()-interval '1 minute',now()-interval '1 minute'),
        (${q(publicCommunity)},${q(pending.id)},'member','pending',now()-interval '1 minute',null),
        (${q(privateCommunity)},${q(creator.id)},'admin','active',now()-interval '1 minute',now()-interval '1 minute'),
        (${q(privateCommunity)},${q(member.id)},'member','active',now()-interval '1 minute',now()-interval '1 minute'),
        (${q(pageCommunity)},${q(creator.id)},'admin','active',now()-interval '1 minute',now()-interval '1 minute');
      insert into public.community_members(community_id,user_id,role,status,valid_from,valid_until,activated_at)
        values (${q(publicCommunity)},${q(inactive.id)},'member','inactive',now()-interval '2 minutes',now()-interval '1 minute',now()-interval '2 minutes');
      insert into public.community_venues(id,community_id,name,created_by,maps_url) values
        (${q(venueA)},${q(publicCommunity)},'Alpha venue',${q(creator.id)},'https://maps.app.goo.gl/alpha'),
        (${q(venueB)},${q(publicCommunity)},'Archived venue',${q(creator.id)},'https://maps.app.goo.gl/archived'),
        (${q(venueC)},${q(privateCommunity)},'Private venue',${q(creator.id)},'https://maps.app.goo.gl/private');
      update public.community_venues set archived_at=now() where id=${q(venueB)};
      -- Publication photo binding is the publication suite's job; discovery
      -- fixtures disable the PAF-72 lock like the visibility suite does.
      alter table public.match_events disable trigger lock_match_photo_publication;
       ${insertEvent('anchor', publicCommunity, "now()+interval '3 days'", "now()+interval '2 days'", ",null,1500,'BRL',90,true,'Discovered notes'", true)}
      ${insertEvent('full', publicCommunity, "now()+interval '2 days'", "now()+interval '1 day'", ',2,null,null,null,false,null')}
      insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,registration_cutoff_at)
        values (${q(events.inviteOnly!)},${q(publicCommunity)},${q(creator.id)},now()+interval '2 days','UTC','friendly','invite_only','POST_MATCH_TEAMS','Invite court','https://maps.google.com/maps/place/invite',${photo()},now()+interval '1 day');
      ${insertEvent('cutoffElapsed', publicCommunity, "now()+interval '30 minutes'", "now()-interval '30 minutes'")}
      ${insertEvent('fourAccepted', publicCommunity, "now()+interval '4 days'", "now()+interval '3 days'", ',8,null,null,null,false,null')}
      ${insertEvent('fiveAccepted', publicCommunity, "now()+interval '4 days'", "now()+interval '3 days'")}
      ${insertEvent('privateOpen', privateCommunity, "now()+interval '3 days'", "now()+interval '2 days'")}
      ${insertEvent('pageA', pageCommunity, "now()+interval '5 hours'", "now()+interval '4 hours'")}
      ${insertEvent('pageB', pageCommunity, "now()+interval '5 hours'", "now()+interval '4 hours'")}
      ${insertEvent('pageC', pageCommunity, "now()+interval '5 hours'", "now()+interval '4 hours'")}
      -- Past events skip the future-start creator registration trigger.
      alter table public.match_events disable trigger match_event_creator_registration;
      ${insertEvent('pastRecent', publicCommunity, "now()-interval '30 minutes'", "now()-interval '2 hours'")}
      ${insertEvent('pastMiddle', publicCommunity, "now()-interval '1 hour'", "now()-interval '3 hours'")}
      ${insertEvent('pastOldest', publicCommunity, "now()-interval '2 hours'", "now()-interval '4 hours'")}
      alter table public.match_events enable trigger match_event_creator_registration;
      insert into public.match_event_invites(match_event_id,invitee_user_id,invited_by,created_at) values
        (${q(events.inviteOnly!)},${q(invitee.id)},${q(creator.id)},now()),
        (${q(events.inviteOnly!)},${q(both.id)},${q(creator.id)},now()),
        (${q(events.pastRecent!)},${q(invitee.id)},${q(creator.id)},now()-interval '1 day');
      -- accepted_order mirrors the accepted_at FIFO so quartet derivation
      -- (accepted_order, id) stays identical to the pre-lifecycle semantics;
      -- the publication trigger already gave each creator order 1.
      insert into public.match_event_registrations(match_event_id,user_id,accepted_at,accepted_order,participation_status,registration_source) values
        (${q(events.full!)},${q(accepted.id)},now()+interval '1 minute',2,'reserve','member'),
        (${q(events.inviteOnly!)},${q(accepted.id)},now()+interval '1 minute',2,'reserve','member'),
        (${q(events.inviteOnly!)},${q(both.id)},now()+interval '2 minutes',3,'reserve','member'),
        (${q(events.pastRecent!)},${q(accepted.id)},now()-interval '2 hours',2,'reserve','member'),
        (${q(events.fourAccepted!)},${q(accepted.id)},now()+interval '1 minute',2,'reserve','member'),
        (${q(events.fourAccepted!)},${q(member.id)},now()+interval '2 minutes',3,'reserve','member'),
        (${q(events.fourAccepted!)},${q(admin2.id)},now()+interval '3 minutes',4,'reserve','member'),
        (${q(events.fiveAccepted!)},${q(accepted.id)},now()+interval '1 minute',2,'reserve','member'),
        (${q(events.fiveAccepted!)},${q(member.id)},now()+interval '2 minutes',3,'reserve','member'),
        (${q(events.fiveAccepted!)},${q(admin2.id)},now()+interval '3 minutes',4,'reserve','member'),
        (${q(events.fiveAccepted!)},${q(fifth.id)},now()+interval '4 minutes',5,'reserve','member');
      alter table public.match_events enable trigger lock_match_photo_publication;
    end $$;`
      );

      const detailOf = async (who: Actor, eventId: string) => {
        const result = await who.client.rpc('get_match_event', { p_event_id: eventId });
        if (result.error)
          throw new Error(`detail ${eventId} for ${who.name}: ${result.error.message}`);
        return isRecord(result.data) ? result.data : null;
      };

      // Unknown and unreadable events return NULL without error.
      expect(await detailOf(creator, crypto.randomUUID())).toBeNull();
      expect(await detailOf(nonmember, events.inviteOnly!)).toBeNull();
      expect(await detailOf(nonmember, events.privateOpen!)).toBeNull();
      expect(await detailOf(member, events.inviteOnly!)).toBeNull();

      // Authorized readers get the projected object and nothing more: no
      // saved_venue_id, no invite roster, no profile internals.
      const detail = await detailOf(creator, events.anchor!);
      expect(detail).not.toBeNull();
      expect(Object.keys(detail!).sort()).toEqual(expectedDetailKeys);
      for (const forbidden of ['saved_venue_id', 'invitee_user_id', 'email', 'mu', 'sigma'])
        expect(Object.keys(detail!)).not.toContain(forbidden);
      expect(detail!['event_id']).toBe(events.anchor);
      expect(detail!['community_id']).toBe(publicCommunity);
      expect(detail!['community_name']).toBe('Discovery public');
      expect(detail!['creator_id']).toBe(creator.id);
      expect(detail!['creator_name']).toBe(creator.name);
      expect(detail!['creator_level']).toBe(3.2);
      expect(detail!['timezone']).toBe('UTC');
      expect(detail!['venue_name']).toBe('Discovery court');
      expect(detail!['maps_url']).toBe('https://maps.google.com/maps/place/discovery');
      expect(detail!['duration_minutes']).toBe(90);
      expect(detail!['court_booked']).toBe(true);
      expect(detail!['notes']).toBe('Discovered notes');
      expect(detail!['price_minor']).toBe(1500);
      expect(detail!['currency']).toBe('BRL');
      expect(detail!['maximum_registrations']).toBeNull();
      expect(detail!['is_past']).toBe(false);
      expect(detail!['registration_open']).toBe(true);
      expect((await detailOf(nonmember, events.anchor!))!['caller_eligibility']).toBe('nonmember');
      expect((await detailOf(nonmember, events.anchor!))!['caller_requires_approval']).toBe(true);
      expect((await detailOf(outOfRange, events.anchor!))!['caller_eligibility']).toBe(
        'out_of_range'
      );
      expect((await detailOf(outOfRange, events.anchor!))!['caller_requires_approval']).toBe(true);
      expect((await detailOf(member, events.anchor!))!['caller_eligibility']).toBe('member');
      expect((await detailOf(accepted, events.anchor!))!['caller_eligibility']).toBe('member');
      expect(
        Math.abs(Date.parse(textOf(detail!['starts_at'])) - (Date.now() + 3 * 86_400_000))
      ).toBeLessThan(300_000);
      expect(
        Math.abs(
          Date.parse(textOf(detail!['registration_cutoff_at'])) - (Date.now() + 2 * 86_400_000)
        )
      ).toBeLessThan(300_000);

      // Visibility matrix: public community_open is readable by any
      // authenticated actor; private community_open only by members; invite_only
      // only by creator, community admin, invitees and registered players.
      expect(await detailOf(nonmember, events.anchor!)).not.toBeNull();
      expect(await detailOf(member, events.privateOpen!)).not.toBeNull();
      for (const who of ['creator', 'admin2', 'invitee', 'accepted', 'both'] as const)
        expect(await detailOf(actors[who]!, events.inviteOnly!)).not.toBeNull();
      for (const who of ['member', 'stranger', 'fifth'] as const)
        expect(await detailOf(actors[who]!, events.inviteOnly!)).toBeNull();

      const list = async (
        who: Actor,
        entry: string,
        communityId: string,
        cursor = '',
        limit = 50
      ) => {
        const result = await who.client.rpc('list_match_events', {
          p_entry: entry,
          p_community_id: communityId,
          p_cursor: cursor,
          p_limit: limit,
          p_as_of: new Date().toISOString()
        });
        if (result.error)
          throw new Error(`${entry} listing for ${who.name}: ${result.error.message}`);
        return listPayload(result.data);
      };
      const asOf = new Date().toISOString();

      // available: only community_open future events before cutoff and not full.
      expect(listedIds(await list(member, 'available', publicCommunity))).toEqual(
        sorted([events.anchor!, events.fourAccepted!, events.fiveAccepted!])
      );
      // A nonmember sees the same public community_open set, and nothing from
      // the private community.
      expect(listedIds(await list(nonmember, 'available', publicCommunity))).toEqual(
        sorted([events.anchor!, events.fourAccepted!, events.fiveAccepted!])
      );
      expect(await list(nonmember, 'available', privateCommunity)).toEqual([]);
      expect(await list(nonmember, 'my', publicCommunity)).toEqual([]);

      // my: future events where the caller is creator, registered or invited.
      expect(listedIds(await list(creator, 'my', publicCommunity))).toEqual(
        sorted([
          events.anchor!,
          events.full!,
          events.inviteOnly!,
          events.cutoffElapsed!,
          events.fourAccepted!,
          events.fiveAccepted!
        ])
      );
      expect(listedIds(await list(accepted, 'my', publicCommunity))).toEqual(
        sorted([events.full!, events.inviteOnly!, events.fourAccepted!, events.fiveAccepted!])
      );
      expect(listedIds(await list(invitee, 'my', publicCommunity))).toEqual([events.inviteOnly]);
      expect(listedIds(await list(member, 'my', publicCommunity))).toEqual(
        sorted([events.fourAccepted!, events.fiveAccepted!])
      );
      expect(await list(member, 'my', privateCommunity)).toEqual([]);

      // past: elapsed events tied to the caller, newest first.
      expect((await list(creator, 'past', publicCommunity)).map(eventIdOf)).toEqual([
        events.pastRecent,
        events.pastMiddle,
        events.pastOldest
      ]);
      expect((await list(creator, 'past', publicCommunity))[0]!['is_past']).toBe(true);
      expect((await list(accepted, 'past', publicCommunity)).map(eventIdOf)).toEqual([
        events.pastRecent
      ]);
      expect((await list(invitee, 'past', publicCommunity)).map(eventIdOf)).toEqual([
        events.pastRecent
      ]);
      expect(await list(member, 'past', publicCommunity)).toEqual([]);
      // Unknown entries list nothing instead of erroring.
      expect(await list(member, 'someday', publicCommunity)).toEqual([]);

      // Counts and badges: accepted != playing; creator-only leaves one reserve.
      const anchor = (await detailOf(creator, events.anchor!))!;
      expect(anchor['accepted_count']).toBe(1);
      expect(anchor['playing_count']).toBe(0);
      expect(anchor['reserve_count']).toBe(1);
      expect(anchor['group_count']).toBe(0);
      expect(anchor['more_needed']).toBe(3);
      expect(anchor['caller_badge']).toBe('creator');

      // Four accepted players: everyone plays, nothing reserved.
      const fourCreator = (await detailOf(creator, events.fourAccepted!))!;
      expect(fourCreator['accepted_count']).toBe(4);
      expect(fourCreator['playing_count']).toBe(4);
      expect(fourCreator['reserve_count']).toBe(0);
      expect(fourCreator['group_count']).toBe(1);
      expect(fourCreator['more_needed']).toBe(4);
      expect(fourCreator['caller_badge']).toBe('creator');
      expect((await detailOf(accepted, events.fourAccepted!))!['caller_badge']).toBe('playing');
      expect((await detailOf(member, events.fourAccepted!))!['caller_badge']).toBe('playing');

      // Five accepted: FIFO fills four playing slots, the last registration reserves.
      const fiveCreator = (await detailOf(creator, events.fiveAccepted!))!;
      expect(fiveCreator['accepted_count']).toBe(5);
      expect(fiveCreator['playing_count']).toBe(4);
      expect(fiveCreator['reserve_count']).toBe(1);
      expect(fiveCreator['group_count']).toBe(1);
      expect(fiveCreator['more_needed']).toBe(3);
      expect((await detailOf(accepted, events.fiveAccepted!))!['caller_badge']).toBe('playing');
      expect((await detailOf(fifth, events.fiveAccepted!))!['caller_badge']).toBe('reserve');

      // invite_only badges: invited only until registered; registration wins;
      // unattached admins see a null badge.
      const inviteOnlyAsInvitee = (await detailOf(invitee, events.inviteOnly!))!;
      expect(inviteOnlyAsInvitee['accepted_count']).toBe(3);
      expect(inviteOnlyAsInvitee['playing_count']).toBe(0);
      expect(inviteOnlyAsInvitee['reserve_count']).toBe(3);
      expect(inviteOnlyAsInvitee['more_needed']).toBe(1);
      expect(inviteOnlyAsInvitee['caller_badge']).toBe('invited');
      expect((await detailOf(accepted, events.inviteOnly!))!['caller_badge']).toBe('reserve');
      expect((await detailOf(both, events.inviteOnly!))!['caller_badge']).toBe('reserve');
      expect((await detailOf(admin2, events.inviteOnly!))!['caller_badge']).toBeNull();

      // Keyset pagination: equal starts_at values page by (starts_at,id) with
      // no duplicates and no gaps.
      const pageRows = await list(member, 'available', pageCommunity);
      expect(pageRows).toHaveLength(3);
      for (const row of pageRows) {
        expect(textOf(row['cursor']).endsWith(`|${eventIdOf(row)}`)).toBe(true);
        expect(textOf(row['cursor'])).toContain('T');
      }
      const firstPage = await list(member, 'available', pageCommunity, '', 2);
      expect(firstPage).toHaveLength(2);
      const secondPage = await list(
        member,
        'available',
        pageCommunity,
        textOf(firstPage[1]!['cursor']),
        2
      );
      expect(secondPage).toHaveLength(1);
      expect(firstPage.map(eventIdOf)).not.toContain(eventIdOf(secondPage[0]!));
      expect(listedIds([...firstPage, ...secondPage])).toEqual(listedIds(pageRows));
      // Malformed cursors degrade to "no cursor" instead of erroring.
      for (const malformed of [
        'garbage-without-pipe',
        `not-a-timestamp|${events.pageA}`,
        `2031-01-01T99:99:99Z|${events.pageA}`,
        `${asOf}|not-a-uuid`
      ]) {
        const rows = await list(member, 'available', pageCommunity, malformed);
        expect(listedIds(rows)).toEqual(listedIds(pageRows));
      }
      // past pages continue descending through the cursor.
      const pastFirstPage = await list(creator, 'past', publicCommunity, '', 2);
      expect(pastFirstPage.map(eventIdOf)).toEqual([events.pastRecent, events.pastMiddle]);
      const pastSecondPage = await list(
        creator,
        'past',
        publicCommunity,
        textOf(pastFirstPage[1]!['cursor']),
        2
      );
      expect(pastSecondPage.map(eventIdOf)).toEqual([events.pastOldest]);

      // Invitee search: active members only, caller excluded, short queries and
      // outsiders get nothing.
      const search = (who: Actor, query: string, limit = 20) =>
        who.client.rpc('search_match_invitees', {
          p_community_id: publicCommunity,
          p_query: query,
          p_limit: limit
        });
      const memberSearch = await search(member, token);
      expect(memberSearch.error).toBeNull();
      expect(memberSearch.data).toEqual([{ user_id: target.id, display_name: target.name }]);
      const creatorSearch = await search(creator, token);
      // The caller-exclusion applies to the searching member only; the creator
      // legitimately sees the caller-matching member too.
      expect(creatorSearch.data).toEqual([
        { user_id: member.id, display_name: member.name },
        { user_id: target.id, display_name: target.name }
      ]);
      // Fewer than three characters returns nothing without error.
      const shortSearch = await search(member, token.slice(0, 2));
      expect(shortSearch.error).toBeNull();
      expect(shortSearch.data).toEqual([]);
      // Non-members are denied results.
      const strangerSearch = await search(stranger, token);
      expect(strangerSearch.error).toBeNull();
      expect(strangerSearch.data).toEqual([]);
      // The limit is clamped to the requested page size.
      const limitedSearch = await search(member, token, 1);
      expect(limitedSearch.data).toEqual([{ user_id: target.id, display_name: target.name }]);

      // Creation options: caller communities plus level defaults and saved venues.
      const creatorOptions = await creator.client.rpc('get_match_creation_options', {
        p_community_id: publicCommunity
      });
      expect(creatorOptions.error).toBeNull();
      const creatorData = recordPayload(creatorOptions.data);
      expect(creatorData['communities']).toEqual([
        {
          id: publicCommunity,
          name: 'Discovery public',
          timezone: 'Europe/Madrid',
          currency: 'EUR'
        }
      ]);
      expect(creatorData['level_defaults']).toEqual({ min: 2.7, max: 4.7, level: 3.2 });
      const venues = listPayload(creatorData['saved_venues']);
      expect(venues).toHaveLength(1);
      expect(recordPayload(venues[0])).toEqual({
        id: venueA,
        name: 'Alpha venue',
        photo_path: null,
        maps_url: 'https://maps.app.goo.gl/alpha'
      });
      expect(Object.keys(recordPayload(venues[0])).sort()).toEqual([
        'id',
        'maps_url',
        'name',
        'photo_path'
      ]);
      const allOptions = await creator.client.rpc('get_match_creation_options', {});
      const allCommunities = listPayload(recordPayload(allOptions.data)['communities']);
      expect(allCommunities.map((community) => textOf(community['id'])).sort()).toEqual(
        sorted([publicCommunity, privateCommunity, pageCommunity])
      );
      const memberOptions = await member.client.rpc('get_match_creation_options', {
        p_community_id: publicCommunity
      });
      expect(recordPayload(memberOptions.data)['communities']).toEqual([
        {
          id: publicCommunity,
          name: 'Discovery public',
          timezone: 'Europe/Madrid',
          currency: 'EUR'
        }
      ]);
      const memberPrivateOptions = await member.client.rpc('get_match_creation_options', {
        p_community_id: privateCommunity
      });
      // member belongs to the private community too, so its saved venue appears.
      expect(recordPayload(memberPrivateOptions.data)['communities']).toEqual([
        {
          id: privateCommunity,
          name: 'Discovery private',
          timezone: 'Europe/Madrid',
          currency: 'EUR'
        }
      ]);
      expect(recordPayload(memberPrivateOptions.data)['saved_venues']).toEqual([
        {
          id: venueC,
          name: 'Private venue',
          photo_path: null,
          maps_url: 'https://maps.app.goo.gl/private'
        }
      ]);
      // A nonmember gets nothing at all.
      const nonmemberOptions = await nonmember.client.rpc('get_match_creation_options', {
        p_community_id: privateCommunity
      });
      expect(recordPayload(nonmemberOptions.data)['communities']).toEqual([]);
      expect(recordPayload(nonmemberOptions.data)['saved_venues']).toEqual([]);
    },
    120000
  );
});
