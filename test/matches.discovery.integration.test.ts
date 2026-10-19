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
  'caller_is_invited',
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
  'reserve_not_playing_count',
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

// Signs up a throwaway player and onboards them. Shared by both suites in
// this file so every integration test stays on the same harness.
async function actor(label: string, displayName: string, level = 3.2): Promise<Actor> {
  const { url, key } = environment.env!;
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

describe('match event discovery integration', () => {
  it('requires local Supabase in CI', () => {
    expect(() => assertLocalSupabaseEnvInCi(environment.env, process.env.CI)).not.toThrow();
  });

  it.skipIf(!environment.env)(
    'returns readable event details without leakage, filters listings by entry rules, derives counts and FIFO badges, pages keysets and searches invitees',
    async () => {
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
      -- Only outOfRange is invited to the anchor: it has no 'my' listing
      -- expectation, while member/accepted keep registration-only listings.
      -- The invited x membership matrix lives in the caller-context suite.
      insert into public.match_event_invites(match_event_id,invitee_user_id,invited_by,created_at) values
        (${q(events.anchor!)},${q(outOfRange.id)},${q(creator.id)},now()),
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
      expect((await detailOf(nonmember, events.anchor!))!['caller_is_invited']).toBe(false);
      expect((await detailOf(outOfRange, events.anchor!))!['caller_eligibility']).toBe(
        'out_of_range'
      );
      expect((await detailOf(outOfRange, events.anchor!))!['caller_requires_approval']).toBe(true);
      expect((await detailOf(outOfRange, events.anchor!))!['caller_is_invited']).toBe(true);
      expect((await detailOf(member, events.anchor!))!['caller_eligibility']).toBe('member');
      // member/accepted carry no anchor invite (only outOfRange does), so they
      // double as non-invitee controls: membership alone never sets is_invited.
      expect((await detailOf(member, events.anchor!))!['caller_is_invited']).toBe(false);
      expect((await detailOf(member, events.anchor!))!['caller_requires_approval']).toBe(false);
      expect((await detailOf(accepted, events.anchor!))!['caller_eligibility']).toBe('member');
      expect((await detailOf(accepted, events.anchor!))!['caller_is_invited']).toBe(false);
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

describe('match event caller context regression (F24 invited members)', () => {
  it.skipIf(!environment.env)(
    'keeps invite facts beside eligibility and approval identically across get_match_event and list_match_events and rejects direct context calls',
    async () => {
      const { url, key } = environment.env!;
      const [
        creator,
        inRange,
        outOfRange,
        unrated,
        invitedNonmember,
        openVisitor,
        acceptedInvitee,
        adminObserver
      ] = await Promise.all([
        actor('f24-creator', 'F24 Creator'),
        actor('f24-in-range', 'F24 In Range'),
        actor('f24-out-of-range', 'F24 Out Of Range', 5),
        actor('f24-unrated', 'F24 Unrated'),
        actor('f24-invited-nonmember', 'F24 Invited Nonmember'),
        actor('f24-open-visitor', 'F24 Open Visitor'),
        actor('f24-accepted-invitee', 'F24 Accepted Invitee'),
        actor('f24-admin-observer', 'F24 Admin Observer')
      ]);
      const communityId = crypto.randomUUID();
      const events: Record<string, string> = {
        restricted: crypto.randomUUID(),
        inviteOnly: crypto.randomUUID(),
        open: crypto.randomUUID()
      };
      const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
      const photo = () => `'${crypto.randomUUID()}/photo.webp'`;
      // One public community; the restricted event (levels 3-4) carries the
      // invited-member matrix, the invite_only event hosts nonmember invitees,
      // and the unrestricted open event takes plain nonmember visitors. The
      // creator registration trigger stays on: each event opens with the
      // creator registered at accepted_order 1.
      await fixtureSql(
        environment.env!,
        `do $$ begin
      insert into public.communities(id,name,visibility,created_by,settings) values
        (${q(communityId)},'F24 caller context','public',${q(creator.id)},'{}'::jsonb);
      insert into public.community_members(community_id,user_id,role,status,valid_from,activated_at) values
        (${q(communityId)},${q(creator.id)},'admin','active',now()-interval '1 minute',now()-interval '1 minute'),
        (${q(communityId)},${q(inRange.id)},'member','active',now()-interval '1 minute',now()-interval '1 minute'),
        (${q(communityId)},${q(outOfRange.id)},'member','active',now()-interval '1 minute',now()-interval '1 minute'),
        (${q(communityId)},${q(unrated.id)},'member','active',now()-interval '1 minute',now()-interval '1 minute'),
        (${q(communityId)},${q(acceptedInvitee.id)},'member','active',now()-interval '1 minute',now()-interval '1 minute'),
        (${q(communityId)},${q(adminObserver.id)},'admin','active',now()-interval '1 minute',now()-interval '1 minute');
      -- F24 case 3 fixture: onboard_player always seeds a rating row, so drop
      -- it to get an active member with no rating row at all.
      delete from public.global_player_ratings where user_id=${q(unrated.id)};
      alter table public.match_events disable trigger lock_match_photo_publication;
      insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,registration_cutoff_at,maximum_registrations,price_minor,currency,duration_minutes,court_booked,notes,restriction_enabled,min_level,max_level)
        values (${q(events.restricted!)},${q(communityId)},${q(creator.id)},now()+interval '3 days','UTC','friendly','community_open','POST_MATCH_TEAMS','F24 restricted court','https://maps.google.com/maps/place/f24-restricted',${photo()},now()+interval '2 days',null,null,null,null,false,null,true,3,4);
      insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,registration_cutoff_at,maximum_registrations,price_minor,currency,duration_minutes,court_booked,notes,restriction_enabled,min_level,max_level)
        values (${q(events.inviteOnly!)},${q(communityId)},${q(creator.id)},now()+interval '3 days','UTC','friendly','invite_only','POST_MATCH_TEAMS','F24 invite court','https://maps.google.com/maps/place/f24-invite',${photo()},now()+interval '2 days',null,null,null,null,false,null,false,null,null);
      insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,registration_cutoff_at,maximum_registrations,price_minor,currency,duration_minutes,court_booked,notes,restriction_enabled,min_level,max_level)
        values (${q(events.open!)},${q(communityId)},${q(creator.id)},now()+interval '3 days','UTC','friendly','community_open','POST_MATCH_TEAMS','F24 open court','https://maps.google.com/maps/place/f24-open',${photo()},now()+interval '2 days',null,null,null,null,false,null,false,null,null);
      insert into public.match_event_invites(match_event_id,invitee_user_id,invited_by,created_at) values
        (${q(events.restricted!)},${q(outOfRange.id)},${q(creator.id)},now()),
        (${q(events.restricted!)},${q(inRange.id)},${q(creator.id)},now()),
        (${q(events.restricted!)},${q(unrated.id)},${q(creator.id)},now()),
        (${q(events.inviteOnly!)},${q(invitedNonmember.id)},${q(creator.id)},now()),
        (${q(events.inviteOnly!)},${q(acceptedInvitee.id)},${q(creator.id)},now());
      insert into public.match_event_registrations(match_event_id,user_id,accepted_at,accepted_order,participation_status,registration_source) values
        (${q(events.inviteOnly!)},${q(acceptedInvitee.id)},now()+interval '1 minute',2,'reserve','member'),
        (${q(events.open!)},${q(acceptedInvitee.id)},now()+interval '1 minute',2,'reserve','member');
      alter table public.match_events enable trigger lock_match_photo_publication;
    end $$;`
      );

      const detailOf = async (who: Actor, eventId: string) => {
        const result = await who.client.rpc('get_match_event', { p_event_id: eventId });
        if (result.error)
          throw new Error(`detail ${eventId} for ${who.name}: ${result.error.message}`);
        return isRecord(result.data) ? result.data : null;
      };
      const list = async (who: Actor, entry: string) => {
        const result = await who.client.rpc('list_match_events', {
          p_entry: entry,
          p_community_id: communityId,
          p_cursor: '',
          p_limit: 50,
          p_as_of: new Date().toISOString()
        });
        if (result.error)
          throw new Error(`${entry} listing for ${who.name}: ${result.error.message}`);
        return listPayload(result.data);
      };
      // Every asserted list row is queued here and replayed against the detail
      // RPC at the end, proving list/detail parity for every matrix case.
      const parityChecks: { who: Actor; row: ListRow }[] = [];
      const expectCallerFields = (
        who: Actor,
        row: ListRow,
        expected: {
          invited: boolean;
          eligibility: string | null;
          approval: boolean;
          badge: string | null;
        }
      ) => {
        expect(row['caller_is_invited']).toBe(expected.invited);
        expect(row['caller_eligibility']).toBe(expected.eligibility);
        expect(row['caller_requires_approval']).toBe(expected.approval);
        expect(row['caller_badge']).toBe(expected.badge);
        parityChecks.push({ who, row });
      };

      // --- Detail side (get_match_event) ---

      // F24 case 1 (headline): an invited member outside the event's level
      // band keeps the invite fact but reads out_of_range and needs approval.
      const restrictedAsOutOfRange = (await detailOf(outOfRange, events.restricted!))!;
      expect(restrictedAsOutOfRange['caller_is_invited']).toBe(true);
      expect(restrictedAsOutOfRange['caller_eligibility']).toBe('out_of_range');
      expect(restrictedAsOutOfRange['caller_requires_approval']).toBe(true);
      expect(restrictedAsOutOfRange['caller_badge']).toBe('invited');

      // F24 case 2: an invited in-range member stays a plain member without
      // approval while the invite fact is preserved alongside it.
      const restrictedAsInRange = (await detailOf(inRange, events.restricted!))!;
      expect(restrictedAsInRange['caller_is_invited']).toBe(true);
      expect(restrictedAsInRange['caller_eligibility']).toBe('member');
      expect(restrictedAsInRange['caller_requires_approval']).toBe(false);
      expect(restrictedAsInRange['caller_badge']).toBe('invited');

      // F24 case 3: an invited member with NO rating row at all counts as out
      // of range on a restricted event and needs approval.
      const restrictedAsUnrated = (await detailOf(unrated, events.restricted!))!;
      expect(restrictedAsUnrated['caller_is_invited']).toBe(true);
      expect(restrictedAsUnrated['caller_eligibility']).toBe('out_of_range');
      expect(restrictedAsUnrated['caller_requires_approval']).toBe(true);
      expect(restrictedAsUnrated['caller_badge']).toBe('invited');

      // F24 case 4: a nonmember invitee on an invite_only event can read it,
      // is flagged invited, and still needs approval as a nonmember.
      const inviteOnlyAsInvitedNonmember = (await detailOf(invitedNonmember, events.inviteOnly!))!;
      expect(inviteOnlyAsInvitedNonmember['caller_is_invited']).toBe(true);
      expect(inviteOnlyAsInvitedNonmember['caller_eligibility']).toBe('nonmember');
      expect(inviteOnlyAsInvitedNonmember['caller_requires_approval']).toBe(true);
      expect(inviteOnlyAsInvitedNonmember['caller_badge']).toBe('invited');

      // F24 case 5: a plain nonmember on a public-community open event reads
      // as a nonmember with no invite fact.
      const openAsVisitor = (await detailOf(openVisitor, events.open!))!;
      expect(openAsVisitor['caller_is_invited']).toBe(false);
      expect(openAsVisitor['caller_eligibility']).toBe('nonmember');
      expect(openAsVisitor['caller_requires_approval']).toBe(true);
      expect(openAsVisitor['caller_badge']).toBeNull();

      // F24 case 6: the creator is never invited to their own event and never
      // needs approval, on every visibility.
      for (const eventKey of ['restricted', 'inviteOnly', 'open'] as const) {
        const own = (await detailOf(creator, events[eventKey]!))!;
        expect(own['caller_is_invited']).toBe(false);
        expect(own['caller_eligibility']).toBe('creator');
        expect(own['caller_requires_approval']).toBe(false);
        expect(own['caller_badge']).toBe('creator');
      }

      // F24 case 7: an invitee who already registered keeps the reserve badge
      // precedence while caller_is_invited stays true.
      const inviteOnlyAsAccepted = (await detailOf(acceptedInvitee, events.inviteOnly!))!;
      expect(inviteOnlyAsAccepted['caller_is_invited']).toBe(true);
      expect(inviteOnlyAsAccepted['caller_badge']).toBe('reserve');
      expect(inviteOnlyAsAccepted['caller_eligibility']).toBe('member');
      expect(inviteOnlyAsAccepted['caller_requires_approval']).toBe(false);

      // F24 case 8: same event, uninvited admin observer — membership alone
      // never sets the invite fact. Registration without an invitation on the
      // open event leaves it false as well.
      const inviteOnlyAsAdmin = (await detailOf(adminObserver, events.inviteOnly!))!;
      expect(inviteOnlyAsAdmin['caller_is_invited']).toBe(false);
      expect(inviteOnlyAsAdmin['caller_eligibility']).toBe('member');
      expect(inviteOnlyAsAdmin['caller_requires_approval']).toBe(false);
      expect(inviteOnlyAsAdmin['caller_badge']).toBeNull();
      const openAsAccepted = (await detailOf(acceptedInvitee, events.open!))!;
      expect(openAsAccepted['caller_is_invited']).toBe(false);
      expect(openAsAccepted['caller_badge']).toBe('reserve');

      // --- List side (list_match_events) ---

      // Invites pull future events into `my`, and every row carries the same
      // caller fields as the detail RPC.
      expect(listedIds(await list(creator, 'my'))).toEqual(
        sorted([events.restricted!, events.inviteOnly!, events.open!])
      );
      const myOfOutOfRange = await list(outOfRange, 'my');
      expect(listedIds(myOfOutOfRange)).toEqual([events.restricted]);
      expectCallerFields(outOfRange, myOfOutOfRange[0]!, {
        invited: true,
        eligibility: 'out_of_range',
        approval: true,
        badge: 'invited'
      });
      const myOfInRange = await list(inRange, 'my');
      expect(listedIds(myOfInRange)).toEqual([events.restricted]);
      expectCallerFields(inRange, myOfInRange[0]!, {
        invited: true,
        eligibility: 'member',
        approval: false,
        badge: 'invited'
      });
      const myOfUnrated = await list(unrated, 'my');
      expect(listedIds(myOfUnrated)).toEqual([events.restricted]);
      expectCallerFields(unrated, myOfUnrated[0]!, {
        invited: true,
        eligibility: 'out_of_range',
        approval: true,
        badge: 'invited'
      });
      const myOfInvitedNonmember = await list(invitedNonmember, 'my');
      expect(listedIds(myOfInvitedNonmember)).toEqual([events.inviteOnly]);
      expectCallerFields(invitedNonmember, myOfInvitedNonmember[0]!, {
        invited: true,
        eligibility: 'nonmember',
        approval: true,
        badge: 'invited'
      });
      const myOfAccepted = await list(acceptedInvitee, 'my');
      expect(listedIds(myOfAccepted)).toEqual(sorted([events.inviteOnly!, events.open!]));
      expectCallerFields(
        acceptedInvitee,
        myOfAccepted.find((row) => eventIdOf(row) === events.inviteOnly)!,
        {
          invited: true,
          eligibility: 'member',
          approval: false,
          badge: 'reserve'
        }
      );
      expectCallerFields(
        acceptedInvitee,
        myOfAccepted.find((row) => eventIdOf(row) === events.open)!,
        {
          invited: false,
          eligibility: 'member',
          approval: false,
          badge: 'reserve'
        }
      );
      // Controls: uninvited callers reach the open events via `available` with
      // no invite fact, and invite_only never appears there.
      expect(listedIds(await list(adminObserver, 'my'))).toEqual([]);
      expect(listedIds(await list(openVisitor, 'my'))).toEqual([]);
      const availableOfVisitor = await list(openVisitor, 'available');
      expect(listedIds(availableOfVisitor)).toEqual(sorted([events.restricted!, events.open!]));
      for (const row of availableOfVisitor)
        expectCallerFields(openVisitor, row, {
          invited: false,
          eligibility: 'nonmember',
          approval: true,
          badge: null
        });
      const availableOfAdmin = await list(adminObserver, 'available');
      expect(listedIds(availableOfAdmin)).toEqual(sorted([events.restricted!, events.open!]));
      for (const row of availableOfAdmin)
        expectCallerFields(adminObserver, row, {
          invited: false,
          eligibility: 'member',
          approval: false,
          badge: null
        });

      // F24 case 9: list and detail must agree on every shared caller field
      // for every case above.
      for (const { who, row } of parityChecks) {
        const detail = await detailOf(who, eventIdOf(row));
        expect(detail, `list/detail parity for ${who.name}`).not.toBeNull();
        expect(detail!['caller_is_invited']).toBe(row['caller_is_invited']);
        expect(detail!['caller_eligibility']).toBe(row['caller_eligibility']);
        expect(detail!['caller_requires_approval']).toBe(row['caller_requires_approval']);
      }

      // F24 case 10: the raw context helper stays privileged — execute is
      // revoked from anon and authenticated — while both read RPCs keep
      // serving authorized callers.
      const anonClient = createClient<Database>(url, key, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      for (const [label, client] of [
        ['anon', anonClient],
        ['authenticated', inRange.client]
      ] as const) {
        const contextCall = await client.rpc('match_event_caller_context', {
          p_event_id: events.restricted!
        });
        expect(
          contextCall.error,
          `match_event_caller_context must reject ${label} callers`
        ).not.toBeNull();
        expect(contextCall.error!.message).toContain('permission denied');
      }
      expect(await detailOf(creator, events.restricted!)).not.toBeNull();
      expect(listedIds(await list(creator, 'my'))).toEqual(
        sorted([events.restricted!, events.inviteOnly!, events.open!])
      );
    },
    120000
  );

  it.skipIf(!environment.env)(
    'pages available/my/past listings against one fixed supplied snapshot without re-evaluating the boundary',
    async () => {
      const [creator, member] = await Promise.all([
        actor('snap-creator', 'Snapshot Creator'),
        actor('snap-member', 'Snapshot Member')
      ]);
      // One snapshot for the whole scenario: every page below must be
      // evaluated against this exact instant, never a freshly computed one.
      const snapshot = new Date().toISOString();
      const snapshotMs = Date.parse(snapshot);
      const at = (offsetMs: number) => `'${new Date(snapshotMs + offsetMs).toISOString()}'`;
      const communityId = crypto.randomUUID();
      const events: Record<string, string> = {
        boundaryA: crypto.randomUUID(),
        boundaryB: crypto.randomUUID(),
        boundaryLast: crypto.randomUUID(),
        laterFuture: crypto.randomUUID(),
        justPast: crypto.randomUUID()
      };
      const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
      const photo = () => `'${crypto.randomUUID()}/photo.webp'`;
      const insert = (eventKey: string, startsAt: string, cutoffAt: string) =>
        `insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,registration_cutoff_at)
         values (${q(events[eventKey]!)},${q(communityId)},${q(creator.id)},${startsAt},'UTC','friendly','community_open','POST_MATCH_TEAMS','Snapshot court','https://maps.google.com/maps/place/snapshot',${photo()},${cutoffAt});`;
      await fixtureSql(
        environment.env!,
        `do $$ begin
      insert into public.communities(id,name,visibility,created_by,settings) values
        (${q(communityId)},'Snapshot paging','public',${q(creator.id)},'{}'::jsonb);
      insert into public.community_members(community_id,user_id,role,status,valid_from,activated_at) values
        (${q(communityId)},${q(creator.id)},'admin','active',now()-interval '1 minute',now()-interval '1 minute'),
        (${q(communityId)},${q(member.id)},'member','active',now()-interval '1 minute',now()-interval '1 minute');
      alter table public.match_events disable trigger lock_match_photo_publication;
      -- The creator-registration trigger also enforces "starts in the future"
      -- against the wall clock; the whole point here is to pin instants around
      -- the FIXED snapshot, so it stays disabled for every insert. Creator
      -- listing membership comes from created_by, not from a registration.
      alter table public.match_events disable trigger match_event_creator_registration;
      -- Available at the fixed snapshot, but their start and cutoff instants
      -- lie only ~1s after it: a page re-evaluated at a fresh later now()
      -- would drop every one of them. Cutoffs sit strictly before their
      -- start (match_event_cutoff_before_start) yet after the snapshot.
      ${insert('boundaryA', at(1_000), at(900))}
      ${insert('boundaryB', at(1_000), at(900))}
      ${insert('boundaryLast', at(1_500), at(1_400))}
      ${insert('laterFuture', at(86_400_000), at(86_400_000 - 3_600_000))}
      -- Started 2s BEFORE the snapshot: past at the fixed snapshot even though
      -- the wall clock is still behind its start when the fixtures run.
      ${insert('justPast', at(-2_000), at(-3_000))}
      alter table public.match_events enable trigger match_event_creator_registration;
      alter table public.match_events enable trigger lock_match_photo_publication;
      insert into public.match_event_registrations(match_event_id,user_id,accepted_at,accepted_order,participation_status,registration_source) values
        (${q(events.boundaryA!)},${q(member.id)},now()+interval '1 minute',2,'reserve','member');
    end $$;`
      );

      const listAt = async (who: Actor, entry: string, cursor = '', limit = 50) => {
        const result = await who.client.rpc('list_match_events', {
          p_entry: entry,
          p_community_id: communityId,
          p_cursor: cursor,
          p_limit: limit,
          p_as_of: snapshot
        });
        if (result.error)
          throw new Error(`${entry} listing for ${who.name}: ${result.error.message}`);
        return listPayload(result.data);
      };
      // Every row of every page echoes the exact supplied snapshot.
      const expectSnapshot = (rows: ListRow[]) => {
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) expect(Date.parse(textOf(row['as_of']))).toBe(snapshotMs);
      };

      // available/my/past membership at the fixed snapshot.
      const availableFull = await listAt(member, 'available');
      expect(listedIds(availableFull)).toEqual(
        sorted([events.boundaryA!, events.boundaryB!, events.boundaryLast!, events.laterFuture!])
      );
      expectSnapshot(availableFull);
      const myFull = await listAt(creator, 'my');
      expect(listedIds(myFull)).toEqual(
        sorted([events.boundaryA!, events.boundaryB!, events.boundaryLast!, events.laterFuture!])
      );
      expectSnapshot(myFull);
      const pastFull = await listAt(creator, 'past');
      expect(pastFull.map(eventIdOf)).toEqual([events.justPast]);
      expectSnapshot(pastFull);
      expect(pastFull[0]!['is_past']).toBe(true);
      expect(pastFull[0]!['registration_open']).toBe(false);

      // Page 2 continues the SAME snapshot even after the wall clock has moved
      // past the boundary events' start and cutoff instants: with per-request
      // instants the boundaryLast row would vanish from page 2.
      const firstPage = await listAt(member, 'available', '', 2);
      expect(firstPage.map(eventIdOf)).toEqual(sorted([events.boundaryA!, events.boundaryB!]));
      expectSnapshot(firstPage);
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      const secondPage = await listAt(member, 'available', textOf(firstPage[1]!['cursor']), 2);
      expectSnapshot(secondPage);
      expect(secondPage.map(eventIdOf)).toEqual([events.boundaryLast, events.laterFuture]);
      expect(listedIds([...firstPage, ...secondPage])).toEqual(listedIds(availableFull));
      // The wall clock really did cross the boundary instants.
      expect(Date.now()).toBeGreaterThan(snapshotMs + 2_000);

      // A registered member's `my` page follows the same fixed snapshot.
      const memberMy = await listAt(member, 'my');
      expect(memberMy.map(eventIdOf)).toEqual([events.boundaryA]);
      expectSnapshot(memberMy);
      // registration_open is derived from the fixed snapshot: boundaryA's
      // cutoff lies 900ms AFTER it, so the card still reads open even though
      // the wall clock has moved past that cutoff by the time this runs.
      expect(memberMy[0]!['registration_open']).toBe(true);
    },
    120000
  );
});
