import { spawn } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import {
  assertLocalSupabaseEnvInCi,
  dotEnvPathFromImportMetaUrl,
  localSupabaseEnv
} from './helpers/local-supabase-env';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
type Env = NonNullable<typeof environment.env>;
type Actor = { id: string; client: SupabaseClient };
const password = 'Password123!';

async function fixtureSql(env: Env, statement: string): Promise<void> {
  const child = spawn(
    'pnpm',
    ['exec', 'supabase', 'db', 'query', '--local', '--output-format', 'json', statement],
    { cwd: process.cwd() }
  );
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk;
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  if (code !== 0) throw new Error(`Trusted fixture SQL failed (${code}): ${stdout}\n${stderr}`);
  void env;
}

const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
const dateInDays = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

describe('match notification integration', () => {
  it('requires local Supabase in CI', () => {
    expect(() => assertLocalSupabaseEnvInCi(environment.env, process.env.CI)).not.toThrow();
  });

  it.skipIf(!environment.env)(
    'verifies transactional producers, authorization, enrichment, idempotency, and v1 compatibility with publishable JWT actors',
    async () => {
      const { url, key } = environment.env!;
      async function actor(label: string, displayName = label): Promise<Actor> {
        const signup = await createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false }
        }).auth.signUp({
          email: `${label}-${crypto.randomUUID()}@test.local`,
          password
        });
        expect(signup.error).toBeNull();
        expect(signup.data.session, 'local email confirmations must be disabled').not.toBeNull();
        const client = createClient(url, key, {
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
      const [
        creator,
        active,
        invitee,
        pending,
        inactive,
        outsider,
        privateCreator,
        privateMember,
        privateOutsider
      ] = await Promise.all([
        actor('notif-creator', 'Notification Creator'),
        actor('notif-active'),
        actor('notif-invitee'),
        actor('notif-pending'),
        actor('notif-inactive'),
        actor('notif-outsider'),
        actor('notif-private-creator'),
        actor('notif-private-member'),
        actor('notif-private-outsider')
      ]);
      const community = crypto.randomUUID();
      const privateCommunity = crypto.randomUUID();
      await fixtureSql(
        environment.env!,
        `do $$ begin
      insert into public.communities(id,name,visibility,created_by,settings) values
      (${q(community)},'Notification public','public',${q(creator.id)},'{}'),
      (${q(privateCommunity)},'Notification private','private',${q(privateCreator.id)},'{}');
    insert into public.community_members(community_id,user_id,role,status,valid_from,activated_at) values
      (${q(community)},${q(creator.id)},'admin','active',now()-interval '1 minute',now()-interval '1 minute'),
      (${q(community)},${q(active.id)},'member','active',now()-interval '1 minute',now()-interval '1 minute'),
      (${q(community)},${q(invitee.id)},'member','active',now()-interval '1 minute',now()-interval '1 minute'),
      (${q(community)},${q(pending.id)},'member','pending',now()-interval '1 minute',null);
    insert into public.community_members(community_id,user_id,role,status,valid_from,valid_until,activated_at)
      values (${q(community)},${q(inactive.id)},'member','inactive',now()-interval '2 minutes',now()-interval '1 minute',now()-interval '2 minutes');
    insert into public.community_members(community_id,user_id,role,status,valid_from,activated_at) values
      (${q(privateCommunity)},${q(privateCreator.id)},'admin','active',now()-interval '1 minute',now()-interval '1 minute'),
      (${q(privateCommunity)},${q(privateMember.id)},'member','active',now()-interval '1 minute',now()-interval '1 minute');
    insert into public.notification_preferences(user_id,push_enabled,push_community,push_matches,push_results,push_rankings,push_leagues)
      values (${q(active.id)},false,false,false,false,false,false),(${q(invitee.id)},false,false,false,false,false,false);
    end $$;`
      );

      const stagePhoto = async (who: Actor, communityId: string, eventId: string) => {
        const path = `${communityId}/${eventId}/${who.id}/${crypto.randomUUID()}.png`;
        const uploaded = await who.client.storage.from('match-event-photos').upload(
          path,
          new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])], {
            type: 'image/png'
          }),
          { contentType: 'image/png' }
        );
        expect(uploaded.error, 'photo upload fixture').toBeNull();
        return path;
      };
      const createEvent = async (
        who: Actor,
        communityId: string,
        visibility: 'community_open' | 'invite_only',
        invitees: string[] = [],
        details: Record<string, unknown> = {}
      ) => {
        const eventId = crypto.randomUUID();
        const photo_path = await stagePhoto(who, communityId, eventId);
        const input = {
          community_id: communityId,
          date: dateInDays(4),
          start_time: '14:30',
          event_type: 'friendly',
          visibility,
          team_assignment_mode: 'POST_MATCH_TEAMS',
          venue_name: 'Notification Court',
          maps_url: 'https://maps.google.com/maps/place/notification-fixture',
          photo_path,
          ...details
        };
        const result = await who.client.rpc('publish_match_event', {
          p_event_id: eventId,
          p_input: input,
          p_invitee_ids: invitees
        });
        expect(result.error, `publish ${visibility}`).toBeNull();
        return { eventId, input, photo_path, invitees };
      };
      const notificationsFor = async (who: Actor, eventId: string) => {
        const result = await who.client
          .from('notifications')
          .select('id,recipient_user_id,event_key,kind,category,target_type,target_id,community_id')
          .eq('target_id', eventId)
          .order('event_key');
        expect(result.error).toBeNull();
        return result.data ?? [];
      };
      const published = await createEvent(creator, community, 'community_open');
      const expectedRecipients = new Set([active.id, invitee.id]);
      for (const person of [creator, active, invitee, pending, inactive, outsider]) {
        const rows = await notificationsFor(person, published.eventId);
        expect(
          rows.map((row) => row.recipient_user_id),
          `recipient rows for ${person.id}`
        ).toEqual(expectedRecipients.has(person.id) ? [person.id] : []);
      }
      expect((await notificationsFor(active, published.eventId))[0]).toMatchObject({
        event_key: `match.event_published:${published.eventId}`,
        kind: 'match_event_published',
        category: 'matches',
        target_type: 'match_event',
        community_id: community
      });
      expect(
        (
          await active.client
            .from('notifications')
            .select('id')
            .eq('event_key', `match.event_published:${published.eventId}`)
        ).data
      ).toHaveLength(1);

      const privateOpen = await createEvent(privateCreator, privateCommunity, 'community_open');
      expect(await notificationsFor(privateMember, privateOpen.eventId)).toHaveLength(1);
      expect(await notificationsFor(privateCreator, privateOpen.eventId)).toEqual([]);
      expect(await notificationsFor(privateOutsider, privateOpen.eventId)).toHaveLength(0);

      const inviteOnlyPublic = await createEvent(creator, community, 'invite_only', [active.id]);
      const inviteOnlyPublicRows = await notificationsFor(active, inviteOnlyPublic.eventId);
      expect(inviteOnlyPublicRows).toHaveLength(1);
      expect(inviteOnlyPublicRows[0]).toMatchObject({
        kind: 'match_event_invitation',
        event_key: expect.stringMatching(/^match\.invitation:/)
      });
      expect(inviteOnlyPublicRows.some((row) => row.kind === 'match_event_published')).toBe(false);
      const inviteOnlyPrivate = await createEvent(privateCreator, privateCommunity, 'invite_only', [
        privateMember.id
      ]);
      const inviteOnlyPrivateRows = await notificationsFor(
        privateMember,
        inviteOnlyPrivate.eventId
      );
      expect(inviteOnlyPrivateRows).toHaveLength(1);
      expect(inviteOnlyPrivateRows[0]?.kind).toBe('match_event_invitation');
      expect(inviteOnlyPrivateRows.some((row) => row.kind === 'match_event_published')).toBe(false);
      // Invite-only invitation producer targets direct invitee even when invitee cannot read a private event.
      const privateInviteId = crypto.randomUUID();
      await fixtureSql(
        environment.env!,
        `insert into public.match_event_invites(id,match_event_id,invitee_user_id,invited_by)
      values (${q(privateInviteId)},${q(inviteOnlyPrivate.eventId)},${q(privateOutsider.id)},${q(privateCreator.id)});`
      );
      const privateInvitation = await notificationsFor(privateOutsider, inviteOnlyPrivate.eventId);
      expect(privateInvitation).toHaveLength(1);
      expect(privateInvitation[0]).toMatchObject({
        event_key: `match.invitation:${privateInviteId}`,
        kind: 'match_event_invitation'
      });

      const both = await createEvent(creator, community, 'community_open', [active.id]);
      const bothRows = await notificationsFor(active, both.eventId);
      expect(bothRows).toHaveLength(2);
      expect(new Set(bothRows.map((row) => row.event_key))).toEqual(
        new Set([
          `match.event_published:${both.eventId}`,
          `match.invitation:${(await active.client.from('match_event_invites').select('id').eq('match_event_id', both.eventId).single()).data!.id}`
        ])
      );
      expect(
        bothRows.map((row) => row.kind).sort((left, right) => left.localeCompare(right))
      ).toEqual(['match_event_invitation', 'match_event_published']);
      expect(await notificationsFor(active, published.eventId)).toHaveLength(1); // preferences OFF do not suppress.

      const retry = await creator.client.rpc('publish_match_event', {
        p_event_id: published.eventId,
        p_input: published.input,
        p_invitee_ids: published.invitees
      });
      expect(retry.error).toBeNull();
      expect(await notificationsFor(active, published.eventId)).toHaveLength(1);
      const inviteRow = (
        await creator.client
          .from('match_event_invites')
          .select('id')
          .eq('match_event_id', both.eventId)
          .single()
      ).data!;
      const duplicate = await fixtureSqlError(
        environment.env!,
        `insert into public.match_event_invites(id,match_event_id,invitee_user_id,invited_by)
      values (${q(crypto.randomUUID())},${q(both.eventId)},${q(active.id)},${q(creator.id)});`
      );
      expect(duplicate).toContain('match_event_invites_match_event_id_invitee_user_id_key');
      expect(
        (await notificationsFor(active, both.eventId)).filter(
          (n) => n.event_key === `match.invitation:${inviteRow.id}`
        )
      ).toHaveLength(1);

      const concurrent = crypto.randomUUID();
      const concurrentPhoto = await stagePhoto(creator, community, concurrent);
      const concurrentInput = {
        ...published.input,
        date: dateInDays(5),
        photo_path: concurrentPhoto
      };
      const concurrentResults = await Promise.all(
        Array.from({ length: 4 }, () =>
          creator.client.rpc('publish_match_event', {
            p_event_id: concurrent,
            p_input: concurrentInput,
            p_invitee_ids: []
          })
        )
      );
      expect(concurrentResults.map((r) => r.error)).toEqual([null, null, null, null]);
      expect(await notificationsFor(active, concurrent)).toHaveLength(1);

      const inaccessibleId = crypto.randomUUID();
      await fixtureSql(
        environment.env!,
        `insert into public.match_event_invites(id,match_event_id,invitee_user_id,invited_by)
      values (${q(inaccessibleId)},${q(privateOpen.eventId)},${q(privateOutsider.id)},${q(privateCreator.id)});`
      );
      const inaccessibleNotification = await privateOutsider.client
        .from('notifications')
        .select('id')
        .eq('event_key', `match.invitation:${inaccessibleId}`)
        .single();
      expect(inaccessibleNotification.error).toBeNull();
      const inaccessibleTarget = await privateOutsider.client
        .rpc('get_my_notification_target_v2', {
          p_notification_id: inaccessibleNotification.data!.id
        })
        .single();
      expect(inaccessibleTarget.error).toBeNull();
      expect(inaccessibleTarget.data).toMatchObject({
        target_status: 'unavailable',
        match_event_id: null,
        match_available: false
      });
      const deniedContext = await privateOutsider.client.rpc('get_my_match_notification_contexts', {
        p_notification_ids: [inaccessibleNotification.data!.id]
      });
      expect(deniedContext.error).toBeNull();
      expect(deniedContext.data).toEqual([]);
      const foreignTarget = await outsider.client.rpc('get_my_notification_target_v2', {
        p_notification_id: inaccessibleNotification.data!.id
      });
      expect(foreignTarget.error?.code).toBe('42501');
      const foreignContext = await outsider.client.rpc('get_my_match_notification_contexts', {
        p_notification_ids: [inaccessibleNotification.data!.id]
      });
      expect(foreignContext.error).toBeNull();
      expect(foreignContext.data).toEqual([]);
      const publishedNotificationId = (
        await active.client
          .from('notifications')
          .select('id')
          .eq('event_key', `match.event_published:${published.eventId}`)
          .single()
      ).data!.id;
      const availableTarget = await active.client
        .rpc('get_my_notification_target_v2', { p_notification_id: publishedNotificationId })
        .single();
      expect(availableTarget.data).toMatchObject({
        match_event_id: published.eventId,
        match_available: true
      });
      const details = await active.client.rpc('get_my_match_notification_contexts', {
        p_notification_ids: [
          (
            await active.client
              .from('notifications')
              .select('id')
              .eq('event_key', `match.event_published:${published.eventId}`)
              .single()
          ).data!.id
        ]
      });
      expect(details.error).toBeNull();
      expect(details.data?.[0]).toMatchObject({
        match_event_id: published.eventId,
        creator_display_name: 'Notification Creator',
        venue: 'Notification Court',
        event_type: 'friendly',
        playing_count: 0,
        reserve_count: 1,
        timezone: 'Europe/Madrid'
      });
      expect(details.data?.[0]?.scheduled_at).toBeTruthy();
      expect(details.data?.[0]?.price_minor).toBeNull();
      const priced = await createEvent(creator, community, 'community_open', [], {
        price: '12.50',
        currency: 'EUR'
      });
      const pricedId = (
        await active.client
          .from('notifications')
          .select('id')
          .eq('event_key', `match.event_published:${priced.eventId}`)
          .single()
      ).data!.id;
      const priceContext = await active.client.rpc('get_my_match_notification_contexts', {
        p_notification_ids: [pricedId]
      });
      expect(priceContext.data?.[0]).toMatchObject({ price_minor: 1250, currency: 'EUR' });
      expect(
        (
          await active.client.rpc('get_my_match_notification_contexts', {
            p_notification_ids: Array.from({ length: 51 }, () => pricedId)
          })
        ).error?.code
      ).toBe('22023');

      // A pre-existing event has no retroactive producer delivery.
      const historicId = crypto.randomUUID();
      await fixtureSql(
        environment.env!,
        `do $$ begin
      alter table public.match_events disable trigger match_event_published_notification;
      alter table public.match_events disable trigger lock_match_photo_publication;
      insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,registration_cutoff_at)
      values (${q(historicId)},${q(community)},${q(creator.id)},now()+interval '10 days','UTC','friendly','community_open','POST_MATCH_TEAMS','Historic fixture','https://maps.google.com/maps/place/historic','${published.photo_path}',now()+interval '9 days');
      alter table public.match_events enable trigger lock_match_photo_publication;
      alter table public.match_events enable trigger match_event_published_notification;
    end $$;`
      );
      expect(await notificationsFor(active, historicId)).toEqual([]);

      // Trigger-level fault proves event, creator registration, invite and
      // notification all roll back. The blocker is scoped to THIS test's
      // fixture event (`when (new.target_id = failedId)`) because vitest runs
      // suites in parallel against one shared local database: an unscoped
      // blocker raises on every notifications insert with category 'matches'
      // and poisons every suite running concurrently — F12: exactly that
      // forced four registration-suite failures in a single full-gate run,
      // and even with reliable cleanup the install window alone poisoned the
      // cutoff suite in a full run. Scoping closes the poisoning window; the
      // drop additionally lives in a `finally` that runs even when the
      // assertions above throw (with `if exists`, so a partially-installed
      // blocker still cleans up), and the residue probe after the `finally`
      // fails loudly if anything survived.
      const failedId = crypto.randomUUID();
      await fixtureSql(
        environment.env!,
        `create or replace function public.fail_match_notification_insert() returns trigger language plpgsql set search_path='' as $$ begin
      raise exception 'FORCED_MATCH_NOTIFICATION_FAILURE'; end $$;`
      );
      await fixtureSql(
        environment.env!,
        `create trigger fail_match_notification_insert before insert on public.notifications for each row when (new.target_id = '${failedId}') execute function public.fail_match_notification_insert();`
      );
      try {
        const failedPhoto = await stagePhoto(creator, community, failedId);
        const fail = await creator.client.rpc('publish_match_event', {
          p_event_id: failedId,
          p_input: { ...published.input, date: dateInDays(7), photo_path: failedPhoto },
          p_invitee_ids: [active.id]
        });
        expect(fail.error?.message).toContain('FORCED_MATCH_NOTIFICATION_FAILURE');
      } finally {
        await fixtureSql(
          environment.env!,
          'drop trigger if exists fail_match_notification_insert on public.notifications;'
        );
        await fixtureSql(
          environment.env!,
          'drop function if exists public.fail_match_notification_insert();'
        );
      }
      // Residue probe: the shared database must be verifiably clean before
      // any later assertion (or any later suite) runs against it.
      await fixtureSql(
        environment.env!,
        `do $$ begin
      if exists (select 1 from pg_catalog.pg_trigger where tgname = 'fail_match_notification_insert' and not tgisinternal)
         or exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname = 'fail_match_notification_insert') then
        raise exception 'fail_match_notification_insert leaked into the shared local database';
      end if;
    end $$;`
      );
      expect(
        (await creator.client.from('match_events').select('id').eq('id', failedId)).data
      ).toEqual([]);
      expect(
        (
          await creator.client
            .from('match_event_registrations')
            .select('id')
            .eq('match_event_id', failedId)
        ).data
      ).toEqual([]);
      expect(
        (
          await creator.client
            .from('match_event_invites')
            .select('id')
            .eq('match_event_id', failedId)
        ).data
      ).toEqual([]);
      expect(await notificationsFor(active, failedId)).toEqual([]);

      // v1 community target remains the original community invitation contract.
      const communityInvite = crypto.randomUUID();
      const inviteKey = crypto.randomUUID().replaceAll('-', '').padEnd(64, '0');
      await fixtureSql(
        environment.env!,
        `insert into public.community_invitations(id,community_id,invitee_user_id,issued_by,token_hash,expires_at)
      values (${q(communityInvite)},${q(privateCommunity)},${q(outsider.id)},${q(privateCreator.id)},${q(inviteKey)},now()+interval '1 day');`
      );
      const communityNotification = await outsider.client
        .from('notifications')
        .select('id')
        .eq('event_key', `community.invitation:${communityInvite}`)
        .single();
      const v1 = await outsider.client
        .rpc('get_my_notification_target', { p_notification_id: communityNotification.data!.id })
        .single();
      expect(v1.error).toBeNull();
      expect(v1.data).toMatchObject({
        target_status: 'invitation_available',
        community_id: privateCommunity
      });
    },
    90000
  );
});

async function fixtureSqlError(env: Env, statement: string): Promise<string> {
  const child = spawn(
    'pnpm',
    ['exec', 'supabase', 'db', 'query', '--local', '--output-format', 'json', statement],
    { cwd: process.cwd() }
  );
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk;
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  void env;
  return `${code}:${stdout}${stderr}`;
}
