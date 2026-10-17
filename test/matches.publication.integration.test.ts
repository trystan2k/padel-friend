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
type Actor = { id: string; client: SupabaseClient<Database> };

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

const isoDate = (offsetDays: number): string =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const recordPayload = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error('Expected a JSON object payload');
  return value;
};
const listPayload = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const textOf = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('Expected a string field');
  return value;
};

describe('match event publication integration', () => {
  it('requires local Supabase in CI', () => {
    expect(() => assertLocalSupabaseEnvInCi(environment.env, process.env.CI)).not.toThrow();
  });

  it.skipIf(!environment.env)(
    'publishes valid events, rejects malformed inputs, auto-registers the creator, invites deduplicated members, retries idempotently and rolls back atomically',
    async () => {
      const { url, key } = environment.env!;
      async function actor(label: string, displayName = label): Promise<Actor> {
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
              p_initial_level: 3.2
            })
          ).error
        ).toBeNull();
        return { id: signup.data.user!.id, client };
      }
      const [creator, alice, bob, carol, foreign, pending, inactive, stranger] = await Promise.all([
        actor('pub-creator'),
        actor('pub-alice'),
        actor('pub-bob'),
        actor('pub-carol'),
        actor('pub-foreign'),
        actor('pub-pending'),
        actor('pub-inactive'),
        actor('pub-stranger')
      ]);
      const publicCommunity = crypto.randomUUID();
      const madridCommunity = crypto.randomUUID();
      const venueId = crypto.randomUUID();
      const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
      await fixtureSql(
        environment.env!,
        `do $$ begin
      insert into public.communities(id,name,visibility,created_by,settings) values
        (${q(publicCommunity)},'Publication fixture','public',${q(creator.id)},'{"admin_defaults":{"timezone":"UTC","currency":"EUR","member_created_leagues_enabled":true}}'::jsonb),
        (${q(madridCommunity)},'Madrid timezone fixture','public',${q(creator.id)},'{"admin_defaults":{"timezone":"Europe/Madrid","currency":"EUR","member_created_leagues_enabled":true}}'::jsonb);
      insert into public.community_members(community_id,user_id,role,status,valid_from,activated_at) values
        (${q(publicCommunity)},${q(creator.id)},'admin','active',now()-interval '1 minute',now()-interval '1 minute'),
        (${q(publicCommunity)},${q(alice.id)},'member','active',now()-interval '1 minute',now()-interval '1 minute'),
        (${q(publicCommunity)},${q(bob.id)},'member','active',now()-interval '1 minute',now()-interval '1 minute'),
        (${q(publicCommunity)},${q(carol.id)},'member','active',now()-interval '1 minute',now()-interval '1 minute'),
        (${q(publicCommunity)},${q(foreign.id)},'member','active',now()-interval '1 minute',now()-interval '1 minute'),
        (${q(publicCommunity)},${q(pending.id)},'member','pending',now()-interval '1 minute',null),
        (${q(madridCommunity)},${q(creator.id)},'admin','active',now()-interval '1 minute',now()-interval '1 minute');
      insert into public.community_members(community_id,user_id,role,status,valid_from,valid_until,activated_at)
        values (${q(publicCommunity)},${q(inactive.id)},'member','inactive',now()-interval '2 minutes',now()-interval '1 minute',now()-interval '2 minutes');
      insert into public.community_venues(id,community_id,name,created_by,maps_url)
        values (${q(venueId)},${q(publicCommunity)},'Publication venue',${q(creator.id)},'https://maps.app.goo.gl/venue');
      delete from public.global_player_ratings where user_id=${q(carol.id)};
    end $$;`
      );

      const png = new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4])], {
        type: 'image/png'
      });
      const uploadedKeys: string[] = [];
      // PAF-72 photo-lock trigger: publication only succeeds when photo_path
      // references an already uploaded, owned storage object under
      // {community}/{event}/{creator}/{object}.(jpg|jpeg|png|webp), so every
      // payload that reaches the INSERT stage gets a real object uploaded by
      // the creator first.
      const stagePhoto = async (
        eventId: string,
        communityId = publicCommunity
      ): Promise<string> => {
        const path = `${communityId}/${eventId}/${creator.id}/${crypto.randomUUID()}.png`;
        const upload = await creator.client.storage
          .from('match-event-photos')
          .upload(path, png, { contentType: 'image/png' });
        expect(upload.error, `staging photo for ${eventId}`).toBeNull();
        uploadedKeys.push(path);
        return path;
      };
      const fakePhoto = (eventId: string) =>
        `${publicCommunity}/${eventId}/${creator.id}/${crypto.randomUUID()}.png`;

      const baseInput = (communityId = publicCommunity) => ({
        community_id: communityId,
        date: isoDate(3),
        start_time: '10:00',
        event_type: 'friendly',
        visibility: 'community_open',
        team_assignment_mode: 'POST_MATCH_TEAMS',
        venue_name: 'Publication court',
        maps_url: 'https://maps.google.com/maps/place/publish-fixture',
        photo_path: ''
      });
      const publish = (
        who: Actor,
        eventId: string,
        overrides: Record<string, unknown> = {},
        inviteeIds: string[] = []
      ) =>
        who.client.rpc('publish_match_event', {
          p_event_id: eventId,
          p_input: { ...baseInput(), photo_path: fakePhoto(eventId), ...overrides },
          p_invitee_ids: inviteeIds
        });
      // Payloads that reach the INSERT stage (validations passed) need a staged
      // photo so a later failure is attributable to the rule under test.
      const publishWithPhoto = async (
        overrides: Record<string, unknown> = {},
        inviteeIds: string[] = [],
        communityId = publicCommunity
      ) => {
        const eventId = crypto.randomUUID();
        const photo = await stagePhoto(eventId, communityId);
        return {
          eventId,
          result: await creator.client.rpc('publish_match_event', {
            p_event_id: eventId,
            p_input: { ...baseInput(communityId), photo_path: photo, ...overrides },
            p_invitee_ids: inviteeIds
          })
        };
      };

      // A unknown JSON key is rejected by the RPC allowlist.
      expect(
        (await publish(creator, crypto.randomUUID(), { payment_link: 'https://evil.test' })).error
          ?.code
      ).toBe('22023');
      // A non-member cannot publish at all.
      expect((await publish(stranger, crypto.randomUUID())).error?.code).toBe('42501');
      // Pending/inactive community states are not memberships.
      expect((await publish(pending, crypto.randomUUID())).error?.code).toBe('42501');
      expect((await publish(inactive, crypto.randomUUID())).error?.code).toBe('42501');

      // Rejections that fail before the INSERT stage surface the RPC's own
      // SQLSTATE; rejections at INSERT (blank venue, level range) need a staged
      // photo, because the photo-lock trigger fires before CHECK constraints
      // and would otherwise mask the rule under test.
      const rejected = async (
        overrides: Record<string, unknown>,
        code?: string,
        inviteeIds: string[] = [],
        staged = false
      ) => {
        const eventId = crypto.randomUUID();
        const photo_path = staged ? await stagePhoto(eventId) : fakePhoto(eventId);
        const result = await creator.client.rpc('publish_match_event', {
          p_event_id: eventId,
          p_input: { ...baseInput(), photo_path, ...overrides },
          p_invitee_ids: inviteeIds
        });
        const context = `${JSON.stringify(overrides)} invitees=${JSON.stringify(inviteeIds)} staged=${staged}`;
        if (result.error === null || result.data !== null)
          throw new Error(`Expected publish rejection: ${context}`);
        if (code !== undefined && result.error.code !== code)
          throw new Error(`Expected code ${code}, got ${result.error.code}: ${context}`);
      };
      await rejected({ maps_url: 'https://maps.google.com.evil.test/maps/place/x' }, '22023');
      await rejected({ maps_url: 'http://maps.google.com/maps/place/x' }, '22023');
      await rejected({ maps_url: 'https://google.com/search?q=x' }, '22023');
      await rejected({ venue_name: '   ' }, '23514', [], true);
      await rejected({ venue_name: '' }, '23514', [], true);
      await rejected({ event_type: 'tournament' });
      await rejected({ visibility: 'public' });
      await rejected({ team_assignment_mode: 'RANDOM_TEAMS' });
      await rejected({ cutoff_at: `${isoDate(3)}T10:00:00Z` }, '22023');
      await rejected({ cutoff_at: `${isoDate(3)}T11:00:00Z` }, '22023');
      await rejected({ duration_minutes: '0' }, '22023');
      await rejected({ duration_minutes: 'ninety' }, '22023');
      await rejected({ currency: 'GBP', price: '10' }, '22023');
      await rejected({ price: '10.999' }, '22023');
      await rejected({ price: '-5' }, '22023');
      await rejected({ price: '10,50' }, '22023');
      await rejected({ price: '90071992547409.92' }, '22023');
      await rejected({ saved_venue_id: crypto.randomUUID() }, '23514');
      await rejected(
        { restriction_enabled: 'true', min_level: '5', max_level: '2' },
        '23514',
        [],
        true
      );
      await rejected(
        { restriction_enabled: 'true', min_level: '8', max_level: '8' },
        '23514',
        [],
        true
      );
      await rejected(
        { restriction_enabled: 'true', min_level: '-1', max_level: '7' },
        '23514',
        [],
        true
      );
      await rejected({ restriction_enabled: 'true', min_level: '2' }, '23514', [], true);
      await rejected({ restriction_enabled: 'true', max_level: '5' }, '23514', [], true);
      await rejected(
        { restriction_enabled: 'false', min_level: '2', max_level: '5' },
        '23514',
        [],
        true
      );
      await rejected({}, '23514', [creator.id]);
      await rejected({}, '23514', [stranger.id]);
      await rejected({}, '23514', [pending.id]);
      await rejected({}, '23514', [inactive.id]);
      // Photo publication lock: missing/unowned objects are refused at INSERT.
      await rejected({});
      await rejected({
        photo_path: `${publicCommunity}/${crypto.randomUUID()}/${creator.id}/${crypto.randomUUID()}.png`
      });
      await rejected({
        photo_path: `${publicCommunity}/${crypto.randomUUID()}/${stranger.id}/${crypto.randomUUID()}.png`
      });
      await rejected({ photo_path: 'not-a-photo-key.png' });

      // Competitive matches require a global rating for the creator.
      const competitive = await publish(carol, crypto.randomUUID(), { event_type: 'competitive' });
      expect(competitive.error?.code).toBe('23514');
      const restrictedWithoutRating = await carol.client.rpc('publish_match_event', {
        p_event_id: crypto.randomUUID(),
        p_input: { ...baseInput(), restriction_enabled: 'true' },
        p_invitee_ids: []
      });
      expect(restrictedWithoutRating.error?.code).toBe('23514');

      // The canonical valid publish succeeds and stores every derived value.
      const base = await publishWithPhoto({
        price: '12.50',
        currency: 'BRL',
        duration_minutes: '90',
        court_booked: 'true',
        notes: 'Bring water',
        court_notes: 'Gate B'
      });
      expect(base.result.error).toBeNull();
      expect(base.result.data).toBe(base.eventId);
      const detail = await creator.client.rpc('get_match_event', {
        p_event_id: base.eventId
      });
      expect(detail.error).toBeNull();
      const event = recordPayload(detail.data ?? {});
      expect(event['event_id']).toBe(base.eventId);
      expect(event['community_id']).toBe(publicCommunity);
      expect(event['creator_id']).toBe(creator.id);
      expect(event['event_type']).toBe('friendly');
      expect(event['visibility']).toBe('community_open');
      expect(event['team_assignment_mode']).toBe('POST_MATCH_TEAMS');
      expect(event['venue_name']).toBe('Publication court');
      expect(event['maps_url']).toBe('https://maps.google.com/maps/place/publish-fixture');
      expect(event['duration_minutes']).toBe(90);
      expect(event['court_booked']).toBe(true);
      expect(event['restriction_enabled']).toBe(false);
      expect(event['min_level']).toBeNull();
      expect(event['max_level']).toBeNull();
      expect(event['price_minor']).toBe(1250);
      expect(event['currency']).toBe('BRL');
      expect(event['notes']).toBe('Bring water');
      expect(event['court_notes']).toBe('Gate B');
      expect(event['payment_note']).toBeNull();
      expect(event['maximum_registrations']).toBeNull();
      expect(event['accepted_count']).toBe(1);
      expect(event['playing_count']).toBe(0);
      expect(event['reserve_count']).toBe(1);
      expect(event['group_count']).toBe(0);
      expect(event['more_needed']).toBe(3);
      expect(event['caller_badge']).toBe('creator');
      expect(Object.keys(event)).not.toContain('saved_venue_id');
      const startsAtMs = Date.parse(textOf(event['starts_at']));
      expect(startsAtMs).toBe(Date.parse(`${isoDate(3)}T10:00:00Z`));
      expect(Date.parse(textOf(event['registration_cutoff_at']))).toBe(startsAtMs - 3_600_000);

      // Effective community admin defaults drive both the stored timezone snapshot and local start conversion.
      const madridEvent = await publishWithPhoto(
        { date: '2030-01-15', start_time: '10:00' },
        [],
        madridCommunity
      );
      expect(madridEvent.result.error).toBeNull();
      const madridDetail = await creator.client.rpc('get_match_event', {
        p_event_id: madridEvent.eventId
      });
      const madridPayload = recordPayload(madridDetail.data);
      expect(madridPayload['timezone']).toBe('Europe/Madrid');
      expect(Date.parse(textOf(madridPayload['starts_at']))).toBe(
        Date.parse('2030-01-15T09:00:00Z')
      );
      const creationOptions = await creator.client.rpc('get_match_creation_options', {
        p_community_id: madridCommunity
      });
      expect(creationOptions.error).toBeNull();
      const madridOption = listPayload(recordPayload(creationOptions.data)['communities'])
        .map(recordPayload)
        .find((community) => community['id'] === madridCommunity);
      expect(madridOption?.['timezone']).toBe('Europe/Madrid');

      // Replays resolve local wall time using the timezone snapshot stored on
      // the event, even after the community default changes.
      const timezoneReplayEvent = crypto.randomUUID();
      const timezoneReplayPhoto = await stagePhoto(timezoneReplayEvent, madridCommunity);
      const timezoneReplayInput = {
        ...baseInput(madridCommunity),
        date: '2030-01-15',
        start_time: '10:00',
        photo_path: timezoneReplayPhoto
      };
      const timezoneFirst = await creator.client.rpc('publish_match_event', {
        p_event_id: timezoneReplayEvent,
        p_input: timezoneReplayInput,
        p_invitee_ids: []
      });
      expect(timezoneFirst.error).toBeNull();
      await fixtureSql(
        environment.env!,
        `update public.communities set settings=jsonb_set(settings,'{admin_defaults,timezone}','"UTC"'::jsonb) where id=${q(madridCommunity)};`
      );
      const timezoneRetry = await creator.client.rpc('publish_match_event', {
        p_event_id: timezoneReplayEvent,
        p_input: timezoneReplayInput,
        p_invitee_ids: []
      });
      expect(timezoneRetry.error).toBeNull();
      expect(timezoneRetry.data).toBe(timezoneReplayEvent);
      const timezoneReplayRows = await creator.client
        .from('match_events')
        .select('id, match_event_registrations(user_id), match_event_invites(invitee_user_id)')
        .eq('id', timezoneReplayEvent);
      expect(timezoneReplayRows.error).toBeNull();
      expect(timezoneReplayRows.data).toHaveLength(1);
      expect(timezoneReplayRows.data![0]!.match_event_registrations).toHaveLength(1);
      expect(timezoneReplayRows.data![0]!.match_event_invites).toHaveLength(0);

      // Creator auto-registration: exactly one accepted registration whose
      // accepted_at equals published_at.
      const registrations = await creator.client
        .from('match_event_registrations')
        .select('user_id,accepted_at')
        .eq('match_event_id', base.eventId);
      expect(registrations.error).toBeNull();
      expect(registrations.data).toHaveLength(1);
      expect(registrations.data![0]!.user_id).toBe(creator.id);
      const publishedRow = await creator.client
        .from('match_events')
        .select('published_at')
        .eq('id', base.eventId);
      expect(publishedRow.data![0]!.published_at).toBe(registrations.data![0]!.accepted_at);

      // Supported currencies are accepted; 0 is stored and distinct from absent.
      for (const [currency, price, expectedMinor] of [
        ['USD', '9.99', 999],
        ['EUR', '0', 0]
      ] as const) {
        const priced = await publishWithPhoto({ price, currency });
        if (priced.result.error)
          throw new Error(`${currency} publish failed: ${priced.result.error.message}`);
        const pricedDetail = await creator.client.rpc('get_match_event', {
          p_event_id: priced.eventId
        });
        expect(recordPayload(pricedDetail.data)['price_minor']).toBe(expectedMinor);
        expect(recordPayload(pricedDetail.data)['currency']).toBe(currency);
      }
      // Price without currency defaults to BRL.
      const defaultCurrency = await publishWithPhoto({ price: '7' });
      expect(defaultCurrency.result.error).toBeNull();
      const defaultCurrencyDetail = await creator.client.rpc('get_match_event', {
        p_event_id: defaultCurrency.eventId
      });
      expect(recordPayload(defaultCurrencyDetail.data)['price_minor']).toBe(700);
      expect(recordPayload(defaultCurrencyDetail.data)['currency']).toBe('BRL');
      // No price at all stores NULL price and NULL currency.
      const unpriced = await publishWithPhoto();
      expect(unpriced.result.error).toBeNull();
      const unpricedDetail = await creator.client.rpc('get_match_event', {
        p_event_id: unpriced.eventId
      });
      expect(recordPayload(unpricedDetail.data)['price_minor']).toBeNull();
      expect(recordPayload(unpricedDetail.data)['currency']).toBeNull();

      // Restriction level range within 0..7 is stored verbatim.
      const leveled = await publishWithPhoto({
        restriction_enabled: 'true',
        min_level: '1.5',
        max_level: '7'
      });
      expect(leveled.result.error).toBeNull();
      const leveledDetail = await creator.client.rpc('get_match_event', {
        p_event_id: leveled.eventId
      });
      const leveledEvent = recordPayload(leveledDetail.data);
      expect(leveledEvent['restriction_enabled']).toBe(true);
      expect(leveledEvent['min_level']).toBe(1.5);
      expect(leveledEvent['max_level']).toBe(7);
      // Enabled restrictions without explicit bounds derive defaults from
      // the creator's global rating.
      const enabledNoBounds = await publishWithPhoto({ restriction_enabled: 'true' });
      expect(enabledNoBounds.result.error).toBeNull();
      const enabledNoBoundsDetail = await creator.client.rpc('get_match_event', {
        p_event_id: enabledNoBounds.eventId
      });
      const enabledNoBoundsEvent = recordPayload(enabledNoBoundsDetail.data);
      expect(enabledNoBoundsEvent['restriction_enabled']).toBe(true);
      expect(enabledNoBoundsEvent['min_level']).toBe(2.7);
      expect(enabledNoBoundsEvent['max_level']).toBe(4.7);

      // An implicit Competitive restriction is a publication-time snapshot;
      // changing the creator's rating must not alter replay identity.
      const ratingReplayEvent = crypto.randomUUID();
      const ratingReplayPhoto = await stagePhoto(ratingReplayEvent);
      const ratingReplayInput = {
        ...baseInput(),
        date: isoDate(3),
        event_type: 'competitive',
        restriction_enabled: 'true',
        photo_path: ratingReplayPhoto
      };
      const ratingFirst = await creator.client.rpc('publish_match_event', {
        p_event_id: ratingReplayEvent,
        p_input: ratingReplayInput,
        p_invitee_ids: []
      });
      expect(ratingFirst.error).toBeNull();
      await fixtureSql(
        environment.env!,
        `update public.global_player_ratings set display_level=4.8, highest_display_level=4.8 where user_id=${q(creator.id)};`
      );
      const ratingRetry = await creator.client.rpc('publish_match_event', {
        p_event_id: ratingReplayEvent,
        p_input: ratingReplayInput,
        p_invitee_ids: []
      });
      expect(ratingRetry.error).toBeNull();
      expect(ratingRetry.data).toBe(ratingReplayEvent);
      const ratingReplayRows = await creator.client
        .from('match_events')
        .select(
          'id, min_level, max_level, match_event_registrations(user_id), match_event_invites(invitee_user_id)'
        )
        .eq('id', ratingReplayEvent);
      expect(ratingReplayRows.error).toBeNull();
      expect(ratingReplayRows.data).toHaveLength(1);
      expect(ratingReplayRows.data![0]!.min_level).toBe(2.7);
      expect(ratingReplayRows.data![0]!.max_level).toBe(4.7);
      expect(ratingReplayRows.data![0]!.match_event_registrations).toHaveLength(1);
      expect(ratingReplayRows.data![0]!.match_event_invites).toHaveLength(0);
      await fixtureSql(
        environment.env!,
        `update public.global_player_ratings set display_level=3.2 where user_id=${q(creator.id)};`
      );

      // A saved venue of the community is accepted when referenced.
      const withVenue = await publishWithPhoto({ saved_venue_id: venueId });
      expect(withVenue.result.error).toBeNull();

      // A custom cutoff strictly before start is honored.
      const customCutoff = new Date(
        Date.parse(`${isoDate(4)}T10:00:00Z`) - 2 * 3_600_000
      ).toISOString();
      const cutoffEvent = await publishWithPhoto({
        date: isoDate(4),
        cutoff_at: customCutoff
      });
      expect(cutoffEvent.result.error).toBeNull();
      const cutoffDetail = await creator.client.rpc('get_match_event', {
        p_event_id: cutoffEvent.eventId
      });
      expect(Date.parse(textOf(recordPayload(cutoffDetail.data)['registration_cutoff_at']))).toBe(
        Date.parse(customCutoff)
      );

      // An event starting within one hour publishes (future start) but its
      // default cutoff (start - 1h) already elapsed, so `available` skips it.
      const soon = new Date(Date.now() + 30 * 60_000);
      const soonEvent = await publishWithPhoto({
        date: soon.toISOString().slice(0, 10),
        start_time: soon.toISOString().slice(11, 16)
      });
      expect(soonEvent.result.error).toBeNull();
      const soonInAvailable = await creator.client.rpc('list_match_events', {
        p_entry: 'available',
        p_community_id: publicCommunity,
        p_cursor: '',
        p_limit: 50,
        p_as_of: new Date().toISOString()
      });
      expect(soonInAvailable.error).toBeNull();
      expect(
        listPayload(soonInAvailable.data).some(
          (row) => recordPayload(row)['event_id'] === soonEvent.eventId
        )
      ).toBe(false);
      const soonInMy = await creator.client.rpc('list_match_events', {
        p_entry: 'my',
        p_community_id: publicCommunity,
        p_cursor: '',
        p_limit: 50,
        p_as_of: new Date().toISOString()
      });
      expect(
        listPayload(soonInMy.data).some(
          (row) => recordPayload(row)['event_id'] === soonEvent.eventId
        )
      ).toBe(true);

      // Valid invites deduplicate; invitees gain visibility on invite_only
      // events but neither a registration nor community membership.
      const inviteOnlyEvent = crypto.randomUUID();
      const invitePhoto = await stagePhoto(inviteOnlyEvent);
      const invitePublish = await creator.client.rpc('publish_match_event', {
        p_event_id: inviteOnlyEvent,
        p_input: {
          ...baseInput(),
          photo_path: invitePhoto,
          visibility: 'invite_only'
        },
        p_invitee_ids: [alice.id, alice.id, bob.id]
      });
      expect(invitePublish.error).toBeNull();
      expect(invitePublish.data).toBe(inviteOnlyEvent);
      const inviteRows = await creator.client
        .from('match_event_invites')
        .select('invitee_user_id')
        .eq('match_event_id', inviteOnlyEvent);
      expect(inviteRows.error).toBeNull();
      expect(inviteRows.data?.map((row) => row.invitee_user_id).sort()).toEqual(
        [alice.id, bob.id].sort()
      );
      for (const invitee of [alice, bob]) {
        const seen = await invitee.client.rpc('get_match_event', { p_event_id: inviteOnlyEvent });
        expect(seen.error).toBeNull();
        expect(recordPayload(seen.data)['caller_badge']).toBe('invited');
        const ownRegistrations = await invitee.client
          .from('match_event_registrations')
          .select('match_event_id')
          .eq('match_event_id', inviteOnlyEvent);
        expect(ownRegistrations.error).toBeNull();
        expect(ownRegistrations.data).toHaveLength(0);
        // The invitation must not create a community membership either: the
        // invitee keeps exactly the one membership she already had.
        const options = await invitee.client.rpc('get_match_creation_options', {});
        expect(options.error).toBeNull();
        expect(listPayload(recordPayload(options.data)['communities'])).toHaveLength(1);
      }
      // A member without an invite cannot even see the invite_only event.
      const carolSees = await carol.client.rpc('get_match_event', {
        p_event_id: inviteOnlyEvent
      });
      expect(carolSees.error).toBeNull();
      expect(carolSees.data).toBeNull();

      // Idempotency: exact retry returns the same id and creates nothing new.
      const idemEvent = crypto.randomUUID();
      const idemPhoto = await stagePhoto(idemEvent);
      const idemDate = isoDate(3);
      const idemCutoff = new Date(
        Date.parse(idemDate + 'T10:00:00Z') - 2 * 3_600_000
      ).toISOString();
      const idemInput = {
        ...baseInput(),
        date: idemDate,
        photo_path: idemPhoto,
        price: '12.50',
        currency: 'EUR',
        cutoff_at: idemCutoff,
        maximum_registrations: '8',
        restriction_enabled: 'true',
        min_level: '2',
        max_level: '5',
        notes: 'Bring water',
        court_notes: 'Gate A',
        duration_minutes: '90',
        payment_note: 'Pay organizer',
        court_booked: 'true'
      };
      const idemFirst = await creator.client.rpc('publish_match_event', {
        p_event_id: idemEvent,
        p_input: idemInput,
        p_invitee_ids: [alice.id]
      });
      expect(idemFirst.error).toBeNull();
      expect(idemFirst.data).toBe(idemEvent);
      const idemRetry = await creator.client.rpc('publish_match_event', {
        p_event_id: idemEvent,
        p_input: idemInput,
        p_invitee_ids: [alice.id]
      });
      expect(idemRetry.error).toBeNull();
      expect(idemRetry.data).toBe(idemEvent);
      const idemCounts = await creator.client
        .from('match_events')
        .select('id, match_event_registrations(user_id), match_event_invites(invitee_user_id)')
        .eq('id', idemEvent);
      expect(idemCounts.error).toBeNull();
      expect(idemCounts.data).toHaveLength(1);
      expect(idemCounts.data![0]!.match_event_registrations).toHaveLength(1);
      expect(idemCounts.data![0]!.match_event_invites).toHaveLength(1);
      // Every normalized optional publication fact participates in replay identity.
      const changedOptionalFacts: Array<{ field: string; override: Record<string, unknown> }> = [
        { field: 'price', override: { price: '13.50' } },
        { field: 'currency', override: { currency: 'USD' } },
        {
          field: 'cutoff',
          override: { cutoff_at: new Date(Date.parse(idemCutoff) - 3_600_000).toISOString() }
        },
        { field: 'maximum', override: { maximum_registrations: '9' } },
        { field: 'minimum restriction bound', override: { min_level: '2.5' } },
        { field: 'maximum restriction bound', override: { max_level: '5.5' } },
        { field: 'notes', override: { notes: 'Bring extra water' } },
        { field: 'court notes', override: { court_notes: 'Gate B' } },
        { field: 'duration', override: { duration_minutes: '120' } },
        { field: 'payment note', override: { payment_note: 'Pay at venue' } },
        { field: 'booked flag', override: { court_booked: 'false' } }
      ];
      for (const { field, override } of changedOptionalFacts) {
        const conflict = await creator.client.rpc('publish_match_event', {
          p_event_id: idemEvent,
          p_input: { ...idemInput, ...override },
          p_invitee_ids: [alice.id]
        });
        expect(conflict.error?.code, `${field} should conflict`).toBe('P0001');
        expect(conflict.error?.message).toContain('MATCH_CONFLICT');
      }
      // Any payload or invite-set divergence conflicts.
      const venueConflict = await creator.client.rpc('publish_match_event', {
        p_event_id: idemEvent,
        p_input: { ...idemInput, venue_name: 'Renamed court' },
        p_invitee_ids: [alice.id]
      });
      expect(venueConflict.error).not.toBeNull();
      expect(venueConflict.error?.message).toContain('MATCH_CONFLICT');
      const inviteConflict = await creator.client.rpc('publish_match_event', {
        p_event_id: idemEvent,
        p_input: idemInput,
        p_invitee_ids: [alice.id, bob.id]
      });
      expect(inviteConflict.error?.message).toContain('MATCH_CONFLICT');
      // A foreign actor reusing someone else's event id is forbidden.
      const foreignPublish = await foreign.client.rpc('publish_match_event', {
        p_event_id: idemEvent,
        p_input: { ...idemInput },
        p_invitee_ids: []
      });
      expect(foreignPublish.error?.code).toBe('42501');

      // Concurrency: two simultaneous publishes of one event id yield one event.
      const raceEvent = crypto.randomUUID();
      const racePhoto = await stagePhoto(raceEvent);
      const raceInput = { ...baseInput(), photo_path: racePhoto };
      const [raceOne, raceTwo] = await Promise.all([
        creator.client.rpc('publish_match_event', {
          p_event_id: raceEvent,
          p_input: raceInput,
          p_invitee_ids: []
        }),
        creator.client.rpc('publish_match_event', {
          p_event_id: raceEvent,
          p_input: raceInput,
          p_invitee_ids: []
        })
      ]);
      expect(raceOne.error).toBeNull();
      expect(raceTwo.error).toBeNull();
      expect(raceOne.data).toBe(raceEvent);
      expect(raceTwo.data).toBe(raceEvent);
      const raceCounts = await creator.client
        .from('match_events')
        .select('id, match_event_registrations(user_id)')
        .eq('id', raceEvent);
      expect(raceCounts.data).toHaveLength(1);
      expect(raceCounts.data![0]!.match_event_registrations).toHaveLength(1);

      // Rollback: an invalid invitee leaves no partial event, registration or
      // invite behind.
      const rollbackEvent = crypto.randomUUID();
      const rollbackPublish = await creator.client.rpc('publish_match_event', {
        p_event_id: rollbackEvent,
        p_input: { ...baseInput(), photo_path: fakePhoto(rollbackEvent) },
        p_invitee_ids: [stranger.id]
      });
      expect(rollbackPublish.error?.code).toBe('23514');
      const rollbackRows = await creator.client
        .from('match_events')
        .select('id, match_event_registrations(user_id), match_event_invites(invitee_user_id)')
        .eq('id', rollbackEvent);
      expect(rollbackRows.error).toBeNull();
      expect(rollbackRows.data).toHaveLength(0);
      // Rollback after the row was built: with a genuinely staged photo a past
      // start passes every RPC validation and the photo lock, then fails on the
      // creator-registration trigger, so the whole statement rolls back. An
      // empty or fake photo would be rejected by the photo lock before the
      // trigger ever runs, hiding whether the future-start guard is enforced.
      const pastPhotoEvent = crypto.randomUUID();
      const pastPhoto = await stagePhoto(pastPhotoEvent);
      const pastPublish = await creator.client.rpc('publish_match_event', {
        p_event_id: pastPhotoEvent,
        p_input: { ...baseInput(), date: isoDate(-2), photo_path: pastPhoto },
        p_invitee_ids: [alice.id]
      });
      expect(pastPublish.error?.code).toBe('23514');
      expect(pastPublish.error?.message).toContain('Match must start in the future');
      const pastRows = await creator.client
        .from('match_events')
        .select('id, match_event_registrations(user_id), match_event_invites(invitee_user_id)')
        .eq('id', pastPhotoEvent);
      expect(pastRows.error).toBeNull();
      expect(pastRows.data).toHaveLength(0);
    },
    120000
  );
});
