import { matchRegistrationFixtureHistory } from './helpers/match-registration-fixture-history';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../src/lib/supabase/database.types';
import {
  copySavedVenueMatchPhoto,
  signMatchPhotoBatch
} from '../src/features/matches/match-photo.server';
import {
  assertLocalSupabaseEnvInCi,
  dotEnvPathFromImportMetaUrl,
  localSupabaseEnv
} from './helpers/local-supabase-env';
import { executeTrustedSql, startSql } from './helpers/sql-transport';

// signMatchPhotoBatch sets a response header through the Start server runtime,
// which has no request context under plain vitest; the authorization evidence
// below comes from the real local Supabase storage and Postgres RLS policies.
vi.mock('@tanstack/react-start/server', () => ({
  setResponseHeader: vi.fn<(name: string, value: string) => void>()
}));

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
type Env = NonNullable<typeof environment.env>;
type Actor = { id: string; client: SupabaseClient<Database> };

async function fixtureSql(_env: Env, sql: string): Promise<void> {
  await executeTrustedSql(sql);
}

// list_match_events answers setof jsonb, so row fields are narrowed with `in`
// guards instead of assertions.
function eventIdsOf(rows: unknown): string[] {
  if (!Array.isArray(rows)) return [];
  const ids: string[] = [];
  for (const row of rows) {
    if (
      typeof row === 'object' &&
      row !== null &&
      'event_id' in row &&
      typeof row.event_id === 'string'
    )
      ids.push(row.event_id);
  }
  return ids;
}

function photoPathsOf(rows: unknown, targetEventId: string): string[] {
  if (!Array.isArray(rows)) return [];
  const paths: string[] = [];
  for (const row of rows) {
    if (
      typeof row === 'object' &&
      row !== null &&
      'event_id' in row &&
      row.event_id === targetEventId &&
      'photo_path' in row &&
      typeof row.photo_path === 'string'
    )
      paths.push(row.photo_path);
  }
  return paths;
}

describe('match event photo Storage authorization', () => {
  it('requires local Supabase in CI', () => {
    expect(() => assertLocalSupabaseEnvInCi(environment.env, process.env.CI)).not.toThrow();
  });

  it.skipIf(!environment.env)(
    'enforces staging, exact published visibility, ownership, copy isolation and publish/delete serialization for JWT actors',
    async () => {
      const { url, key } = environment.env!;
      async function actor(label: string): Promise<Actor> {
        const signup = await createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false }
        }).auth.signUp({
          email: `${label}-${crypto.randomUUID()}@test.local`,
          password: 'Password123!'
        });
        expect(signup.error).toBeNull();
        expect(signup.data.session, 'local email confirmations must be disabled').not.toBeNull();
        return {
          id: signup.data.user!.id,
          client: createClient<Database>(url, key, {
            auth: { persistSession: false, autoRefreshToken: false },
            global: { headers: { Authorization: `Bearer ${signup.data.session!.access_token}` } }
          })
        };
      }
      const [creator, member, pending, inactive, stranger, invitee, accepted] = await Promise.all(
        [
          'photo-creator',
          'photo-member',
          'photo-pending',
          'photo-inactive',
          'photo-stranger',
          'photo-invitee',
          'photo-accepted'
        ].map(actor)
      );
      const anonymous = createClient<Database>(url, key, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      const publicCommunity = crypto.randomUUID();
      const privateCommunity = crypto.randomUUID();
      const publicEvent = crypto.randomUUID();
      const privateEvent = crypto.randomUUID();
      const inviteOnlyEvent = crypto.randomUUID();
      const objectId = crypto.randomUUID();
      const publicKey = `${publicCommunity}/${publicEvent}/${creator!.id}/${objectId}.png`;
      const privateKey = `${privateCommunity}/${privateEvent}/${creator!.id}/${crypto.randomUUID()}.png`;
      const inviteKey = `${publicCommunity}/${inviteOnlyEvent}/${creator!.id}/${crypto.randomUUID()}.png`;
      const wrongCommunity = `${crypto.randomUUID()}/${crypto.randomUUID()}/${creator!.id}/${crypto.randomUUID()}.png`;
      const wrongUploader = `${publicCommunity}/${crypto.randomUUID()}/${stranger!.id}/${crypto.randomUUID()}.png`;
      const q = (value: string) => `'${value.replaceAll("'", "''")}'`;

      await fixtureSql(
        environment.env!,
        `do $$ begin
      insert into public.communities(id,name,visibility,created_by) values
        (${q(publicCommunity)},'Photo public','public',${q(creator!.id)}),
        (${q(privateCommunity)},'Photo private','private',${q(creator!.id)});
      insert into public.community_members(community_id,user_id,role,status,valid_from,activated_at) values
        (${q(publicCommunity)},${q(creator!.id)},'admin','active',now()-interval '1 minute',now()-interval '1 minute'),
        (${q(publicCommunity)},${q(member!.id)},'member','active',now()-interval '1 minute',now()-interval '1 minute'),
        (${q(publicCommunity)},${q(pending!.id)},'member','pending',now()-interval '1 minute',null),
        (${q(publicCommunity)},${q(invitee!.id)},'member','active',now()-interval '1 minute',now()-interval '1 minute'),
        (${q(publicCommunity)},${q(accepted!.id)},'member','active',now()-interval '1 minute',now()-interval '1 minute'),
        (${q(privateCommunity)},${q(creator!.id)},'admin','active',now()-interval '1 minute',now()-interval '1 minute');
      insert into public.community_members(community_id,user_id,role,status,valid_from,valid_until,activated_at)
        values (${q(publicCommunity)},${q(inactive!.id)},'member','inactive',now()-interval '2 minutes',now()-interval '1 minute',now()-interval '2 minutes');
    end $$;`
      );

      const png = new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4])], {
        type: 'image/png'
      });
      const upload = async (who: Pick<Actor, 'client'>, path: string, upsert = false) =>
        who.client.storage
          .from('match-event-photos')
          .upload(path, png, { contentType: 'image/png', upsert });
      expect((await upload(creator!, publicKey)).error).toBeNull();
      expect((await upload(creator!, privateKey)).error).toBeNull();
      expect((await upload(creator!, inviteKey)).error).toBeNull();
      expect(
        (
          await upload(
            pending!,
            `${publicCommunity}/${crypto.randomUUID()}/${pending!.id}/${crypto.randomUUID()}.png`
          )
        ).error
      ).not.toBeNull();
      expect(
        (
          await upload(
            inactive!,
            `${publicCommunity}/${crypto.randomUUID()}/${inactive!.id}/${crypto.randomUUID()}.png`
          )
        ).error
      ).not.toBeNull();
      expect(
        (
          await upload(
            stranger!,
            `${publicCommunity}/${crypto.randomUUID()}/${stranger!.id}/${crypto.randomUUID()}.png`
          )
        ).error
      ).not.toBeNull();
      expect(
        (
          await upload(
            { client: anonymous },
            `${publicCommunity}/${crypto.randomUUID()}/00000000-0000-0000-0000-000000000000/${crypto.randomUUID()}.png`
          )
        ).error
      ).not.toBeNull();
      expect((await upload(creator!, wrongCommunity)).error).not.toBeNull();
      expect((await upload(creator!, wrongUploader)).error).not.toBeNull();
      expect((await upload(creator!, publicKey, true)).error).not.toBeNull();

      const stagedList = await creator!.client.storage
        .from('match-event-photos')
        .list(`${publicCommunity}/${publicEvent}/${creator!.id}`);
      expect(stagedList.data?.map((entry) => entry.name)).toContain(`${objectId}.png`);
      expect(
        (await member!.client.storage.from('match-event-photos').download(publicKey)).data
      ).toBeNull();
      expect(
        (
          await stranger!.client.storage
            .from('match-event-photos')
            .list(`${publicCommunity}/${publicEvent}/${creator!.id}`)
        ).data
      ).toHaveLength(0);

      const venueId = crypto.randomUUID();
      const venuePhotoKey = `${publicCommunity}/${venueId}/${creator!.id}/${crypto.randomUUID()}.png`;
      await fixtureSql(
        environment.env!,
        `insert into public.community_venues(id,community_id,name,created_by) values (${q(venueId)},${q(publicCommunity)},'Photo source',${q(creator!.id)});`
      );
      const venueUpload = await creator!.client.storage
        .from('community-venue-photos')
        .upload(venuePhotoKey, png, { contentType: 'image/png' });
      expect(venueUpload.error).toBeNull();
      await fixtureSql(
        environment.env!,
        `do $$ begin
      update public.community_venues set photo_path=${q(venuePhotoKey)} where id=${q(venueId)};
      insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,registration_cutoff_at)
        values (${q(publicEvent)},${q(publicCommunity)},${q(creator!.id)},now()+interval '2 days','UTC','friendly','community_open','POST_MATCH_TEAMS','Court','https://maps.google.com/maps/place/x',${q(publicKey)},now()+interval '1 day'),
          (${q(privateEvent)},${q(privateCommunity)},${q(creator!.id)},now()+interval '2 days','UTC','friendly','community_open','POST_MATCH_TEAMS','Court','https://maps.google.com/maps/place/x',${q(privateKey)},now()+interval '1 day'),
          (${q(inviteOnlyEvent)},${q(publicCommunity)},${q(creator!.id)},now()+interval '2 days','UTC','friendly','invite_only','POST_MATCH_TEAMS','Court','https://maps.google.com/maps/place/x',${q(inviteKey)},now()+interval '1 day');
      insert into public.match_event_invites(match_event_id,invitee_user_id,invited_by) values (${q(inviteOnlyEvent)},${q(invitee!.id)},${q(creator!.id)});
       insert into public.match_event_registrations(match_event_id,user_id,accepted_at,accepted_order,participation_status,registration_source) values (${q(inviteOnlyEvent)},${q(accepted!.id)},now(),2,'reserve','member');
       ${matchRegistrationFixtureHistory([publicEvent, privateEvent, inviteOnlyEvent])}
      end $$;`
      );
      expect(
        (
          await creator!.client.storage
            .from('match-event-photos')
            .upload(
              `${publicCommunity}/${publicEvent}/${creator!.id}/${crypto.randomUUID()}.png`,
              png,
              { contentType: 'image/png' }
            )
        ).error
      ).not.toBeNull();

      for (const [who, canRead] of [
        [creator!, true],
        [member!, true],
        [stranger!, true],
        [pending!, true],
        [inactive!, true]
      ] as const) {
        const result = await who.client.storage.from('match-event-photos').download(publicKey);
        expect(Boolean(result.data), `${who.id} public photo`).toBe(canRead);
      }
      expect(
        (await stranger!.client.storage.from('match-event-photos').download(privateKey)).data
      ).toBeNull();
      expect(
        (await member!.client.storage.from('match-event-photos').download(inviteKey)).data
      ).toBeNull();
      expect(
        (await invitee!.client.storage.from('match-event-photos').download(inviteKey)).data
      ).not.toBeNull();
      expect(
        (await accepted!.client.storage.from('match-event-photos').download(inviteKey)).data
      ).not.toBeNull();
      expect(
        (await stranger!.client.storage.from('match-event-photos').createSignedUrl(privateKey, 60))
          .error
      ).not.toBeNull();
      expect(
        (await member!.client.storage.from('match-event-photos').createSignedUrl(inviteKey, 60))
          .error
      ).not.toBeNull();
      expect(
        (await stranger!.client.storage.from('match-event-photos').createSignedUrl(publicKey, 60))
          .error
      ).toBeNull();
      const rawPublic = await fetch(
        `${url}/storage/v1/object/public/match-event-photos/${publicKey}`
      );
      expect(rawPublic.ok).toBe(false);
      await creator!.client.storage.from('match-event-photos').remove([publicKey]);
      expect(
        (await creator!.client.storage.from('match-event-photos').download(publicKey)).data
      ).not.toBeNull();

      const copiedKey = await copySavedVenueMatchPhoto(
        member!.client,
        member!.id,
        publicCommunity,
        crypto.randomUUID(),
        venueId
      );
      expect(copiedKey).not.toBe(venuePhotoKey);
      expect(copiedKey.split('/').slice(0, 3)).toEqual([
        publicCommunity,
        expect.any(String),
        member!.id
      ]);
      expect(
        (await stranger!.client.storage.from('community-venue-photos').download(venuePhotoKey)).data
      ).toBeNull();
      expect(
        (await member!.client.storage.from('match-event-photos').download(copiedKey)).data
      ).not.toBeNull();
      const removableKey = `${publicCommunity}/${crypto.randomUUID()}/${creator!.id}/${crypto.randomUUID()}.png`;
      expect((await upload(creator!, removableKey)).error).toBeNull();
      expect(
        (await creator!.client.storage.from('match-event-photos').remove([removableKey])).error
      ).toBeNull();

      const raceEvent = crypto.randomUUID();
      const raceKey = `${publicCommunity}/${raceEvent}/${creator!.id}/${crypto.randomUUID()}.png`;
      expect((await upload(creator!, raceKey)).error).toBeNull();
      const publication = startSql(
        `do $$ begin insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,registration_cutoff_at) values (${q(raceEvent)},${q(publicCommunity)},${q(creator!.id)},now()+interval '2 days','UTC','friendly','community_open','POST_MATCH_TEAMS','Race court','https://maps.google.com/maps/place/race',${q(raceKey)},now()+interval '1 day'); perform pg_sleep(1); end $$;`
      );
      const publicationResult = await (async () => {
        try {
          await new Promise((resolve) => setTimeout(resolve, 200));
          await creator!.client.storage.from('match-event-photos').remove([raceKey]);
          return await publication.done;
        } finally {
          await publication.stop();
        }
      })();
      const publicationExit = publicationResult.code;
      expect([0, 1]).toContain(publicationExit);
      const published = await creator!.client
        .from('match_events')
        .select('id,photo_path')
        .eq('id', raceEvent);
      const remainingPhoto = await creator!.client.storage
        .from('match-event-photos')
        .download(raceKey);
      expect(Boolean(published.data?.length)).toBe(Boolean(remainingPhoto.data));
      expect(published.data?.[0]?.photo_path ?? null).toBe(published.data?.length ? raceKey : null);
      expect(
        (publicationResult.stderr + publicationResult.stdout).includes(
          'Match photo object unavailable'
        )
      ).toBe(publicationExit !== 0);
    },
    60000
  );

  it.skipIf(!environment.env)(
    'batch-signs only storage-authorized photos and keeps private events out of listings',
    async () => {
      const { url, key } = environment.env!;
      async function actor(label: string): Promise<Actor> {
        const signup = await createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false }
        }).auth.signUp({
          email: `${label}-${crypto.randomUUID()}@test.local`,
          password: 'Password123!'
        });
        expect(signup.error).toBeNull();
        expect(signup.data.session, 'local email confirmations must be disabled').not.toBeNull();
        return {
          id: signup.data.user!.id,
          client: createClient<Database>(url, key, {
            auth: { persistSession: false, autoRefreshToken: false },
            global: { headers: { Authorization: `Bearer ${signup.data.session!.access_token}` } }
          })
        };
      }
      const [owner, member, stranger] = await Promise.all(
        ['batch-owner', 'batch-member', 'batch-stranger'].map(actor)
      );
      const publicCommunity = crypto.randomUUID();
      const privateCommunity = crypto.randomUUID();
      const publicEvent = crypto.randomUUID();
      const privateEvent = crypto.randomUUID();
      const publicKey = `${publicCommunity}/${publicEvent}/${owner!.id}/${crypto.randomUUID()}.png`;
      const privateKey = `${privateCommunity}/${privateEvent}/${owner!.id}/${crypto.randomUUID()}.png`;
      const q = (value: string) => `'${value.replaceAll("'", "''")}'`;

      const png = new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4])], {
        type: 'image/png'
      });

      await fixtureSql(
        environment.env!,
        `do $$ begin
      insert into public.communities(id,name,visibility,created_by) values
        (${q(publicCommunity)},'Batch public','public',${q(owner!.id)}),
        (${q(privateCommunity)},'Batch private','private',${q(owner!.id)});
      insert into public.community_members(community_id,user_id,role,status,valid_from,activated_at) values
        (${q(publicCommunity)},${q(owner!.id)},'admin','active',now()-interval '1 minute',now()-interval '1 minute'),
        (${q(publicCommunity)},${q(member!.id)},'member','active',now()-interval '1 minute',now()-interval '1 minute'),
        (${q(privateCommunity)},${q(owner!.id)},'admin','active',now()-interval '1 minute',now()-interval '1 minute');
    end $$;`
      );

      expect(
        (
          await owner!.client.storage
            .from('match-event-photos')
            .upload(publicKey, png, { contentType: 'image/png', upsert: false })
        ).error
      ).toBeNull();
      expect(
        (
          await owner!.client.storage
            .from('match-event-photos')
            .upload(privateKey, png, { contentType: 'image/png', upsert: false })
        ).error
      ).toBeNull();

      await fixtureSql(
        environment.env!,
        `do $$ begin
      insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,registration_cutoff_at)
        values (${q(publicEvent)},${q(publicCommunity)},${q(owner!.id)},now()+interval '2 days','UTC','friendly','community_open','POST_MATCH_TEAMS','Court','https://maps.google.com/maps/place/x',${q(publicKey)},now()+interval '1 day'),
          (${q(privateEvent)},${q(privateCommunity)},${q(owner!.id)},now()+interval '2 days','UTC','friendly','community_open','POST_MATCH_TEAMS','Court','https://maps.google.com/maps/place/x',${q(privateKey)},now()+interval '1 day');
    end $$;`
      );

      const listingArgs = {
        p_entry: 'available' as const,
        p_community_id: publicCommunity,
        p_cursor: '',
        p_limit: 50,
        p_as_of: new Date().toISOString()
      };
      const memberRows = await member!.client.rpc('list_match_events', listingArgs);
      expect(memberRows.error).toBeNull();
      const memberIds = eventIdsOf(memberRows.data);
      expect(memberIds).toContain(publicEvent);
      expect(memberIds).not.toContain(privateEvent);
      const memberPhotoPaths = photoPathsOf(memberRows.data, publicEvent);
      expect(memberPhotoPaths).toEqual([publicKey]);

      const strangerRows = await stranger!.client.rpc('list_match_events', listingArgs);
      expect(strangerRows.error).toBeNull();
      expect(eventIdsOf(strangerRows.data)).not.toContain(privateEvent);

      const memberPrivateRows = await member!.client.rpc('list_match_events', {
        ...listingArgs,
        p_community_id: privateCommunity
      });
      expect(memberPrivateRows.error).toBeNull();
      expect(eventIdsOf(memberPrivateRows.data)).not.toContain(privateEvent);

      // One mixed request: the unauthorized key must never yield a URL while
      // the public key still signs for the same caller.
      const strangerSigned = await signMatchPhotoBatch(stranger!.client, [privateKey, publicKey]);
      expect(strangerSigned.has(privateKey)).toBe(false);
      expect(typeof strangerSigned.get(publicKey)).toBe('string');

      const memberSigned = await signMatchPhotoBatch(member!.client, [privateKey]);
      expect(memberSigned.has(privateKey)).toBe(false);

      const ownerSigned = await signMatchPhotoBatch(owner!.client, [privateKey]);
      expect(typeof ownerSigned.get(privateKey)).toBe('string');
      expect(ownerSigned.get(privateKey)).toMatch(/\/object\/sign\//);
    },
    60000
  );
});
