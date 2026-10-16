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

describe('match event visibility integration', () => {
  it('requires local Supabase in CI', () => {
    expect(() => assertLocalSupabaseEnvInCi(environment.env, process.env.CI)).not.toThrow();
  });

  it.skipIf(!environment.env)(
    'enforces direct/list visibility, invite isolation, and immutable writes for real JWT actors',
    async () => {
      const { url, key } = environment.env!;
      const anonClient = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      async function actor(label: string): Promise<Actor> {
        const signupClient = createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false }
        });
        const signup = await signupClient.auth.signUp({
          email: `${label}-${crypto.randomUUID()}@test.local`,
          password: 'Password123!'
        });
        expect(signup.error).toBeNull();
        const session = signup.data.session;
        expect(session, 'local email confirmations must be disabled').not.toBeNull();
        const client = createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { headers: { Authorization: `Bearer ${session!.access_token}` } }
        });
        return { id: signup.data.user!.id, client };
      }
      const [
        creator,
        member,
        admin,
        pending,
        inactive,
        publicNonmember,
        invitee,
        accepted,
        stranger
      ] = await Promise.all(
        [
          'creator',
          'member',
          'admin',
          'pending',
          'inactive',
          'public_nonmember',
          'invitee',
          'accepted',
          'stranger'
        ].map(actor)
      );
      const actors: Record<string, Actor> = {
        creator: creator!,
        member: member!,
        admin: admin!,
        pending: pending!,
        inactive: inactive!,
        public_nonmember: publicNonmember!,
        invitee: invitee!,
        accepted: accepted!,
        stranger: stranger!
      };
      const publicCommunity = crypto.randomUUID();
      const privateCommunity = crypto.randomUUID();
      const events: Record<string, string> = {};
      for (const community of [publicCommunity, privateCommunity]) {
        for (const visibility of ['community_open', 'invite_only'])
          events[`${community}:${visibility}`] = crypto.randomUUID();
      }
      const eventIdFor = (fixtureKey: string): string => {
        const id = events[fixtureKey];
        if (!id) throw new Error(`Missing event fixture ${key}`);
        return id;
      };
      const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
      await fixtureSql(
        environment.env!,
        `do $$ begin
      insert into public.communities(id,name,visibility,created_by) values
        (${q(publicCommunity)},'Match public fixture','public',${q(creator!.id)}),
        (${q(privateCommunity)},'Match private fixture','private',${q(creator!.id)});
      insert into public.community_members(community_id,user_id,role,status,valid_from,activated_at) values
        (${q(publicCommunity)},${q(creator!.id)},'admin','active',now()-interval '1 minute',now()-interval '1 minute'),
        (${q(publicCommunity)},${q(member!.id)},'member','active',now()-interval '1 minute',now()-interval '1 minute'),
        (${q(publicCommunity)},${q(admin!.id)},'admin','active',now()-interval '1 minute',now()-interval '1 minute'),
        (${q(publicCommunity)},${q(pending!.id)},'member','pending',now()-interval '1 minute',null),
        (${q(privateCommunity)},${q(creator!.id)},'admin','active',now()-interval '1 minute',now()-interval '1 minute'),
        (${q(privateCommunity)},${q(member!.id)},'member','active',now()-interval '1 minute',now()-interval '1 minute'),
        (${q(privateCommunity)},${q(admin!.id)},'admin','active',now()-interval '1 minute',now()-interval '1 minute'),
        (${q(privateCommunity)},${q(pending!.id)},'member','pending',now()-interval '1 minute',null);
      insert into public.community_members(community_id,user_id,role,status,valid_from,valid_until,activated_at)
        values (${q(publicCommunity)},${q(inactive!.id)},'member','inactive',now()-interval '2 minutes',now()-interval '1 minute',now()-interval '2 minutes'),
          (${q(privateCommunity)},${q(inactive!.id)},'member','inactive',now()-interval '2 minutes',now()-interval '1 minute',now()-interval '2 minutes');
      insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,registration_cutoff_at)
       select v.id,v.community_id,${q(creator!.id)},now()+interval '2 days','UTC','friendly',v.visibility,'POST_MATCH_TEAMS','Fixture court','https://maps.google.com/maps/place/test','${crypto.randomUUID()}/photo.webp',now()+interval '1 day'
       from (values (${q(eventIdFor(`${publicCommunity}:community_open`))}::uuid,${q(publicCommunity)}::uuid,'community_open'::public.match_event_visibility),
         (${q(eventIdFor(`${publicCommunity}:invite_only`))}::uuid,${q(publicCommunity)}::uuid,'invite_only'::public.match_event_visibility),
         (${q(eventIdFor(`${privateCommunity}:community_open`))}::uuid,${q(privateCommunity)}::uuid,'community_open'::public.match_event_visibility),
         (${q(eventIdFor(`${privateCommunity}:invite_only`))}::uuid,${q(privateCommunity)}::uuid,'invite_only'::public.match_event_visibility)) v(id,community_id,visibility);
      insert into public.match_event_invites(match_event_id,invitee_user_id,invited_by)
         values (${q(eventIdFor(`${publicCommunity}:invite_only`))},${q(invitee!.id)},${q(creator!.id)}),
           (${q(eventIdFor(`${privateCommunity}:invite_only`))},${q(invitee!.id)},${q(creator!.id)});
      insert into public.match_event_registrations(match_event_id,user_id,accepted_at)
         values (${q(eventIdFor(`${publicCommunity}:invite_only`))},${q(accepted!.id)},now());
    end $$;`
      );

      const allowed: Record<string, Set<string>> = {
        creator: new Set(Object.values(events)),
        member: new Set([
          eventIdFor(`${publicCommunity}:community_open`),
          eventIdFor(`${privateCommunity}:community_open`)
        ]),
        admin: new Set(Object.values(events)),
        pending: new Set([eventIdFor(`${publicCommunity}:community_open`)]),
        inactive: new Set([eventIdFor(`${publicCommunity}:community_open`)]),
        public_nonmember: new Set([eventIdFor(`${publicCommunity}:community_open`)]),
        invitee: new Set([
          eventIdFor(`${publicCommunity}:community_open`),
          eventIdFor(`${publicCommunity}:invite_only`),
          eventIdFor(`${privateCommunity}:invite_only`)
        ]),
        accepted: new Set([
          eventIdFor(`${publicCommunity}:community_open`),
          eventIdFor(`${publicCommunity}:invite_only`)
        ]),
        stranger: new Set([eventIdFor(`${publicCommunity}:community_open`)])
      };
      const acceptedRegistration = await actors
        .accepted!.client.from('match_event_registrations')
        .select('match_event_id')
        .eq('match_event_id', eventIdFor(`${publicCommunity}:invite_only`));
      expect(acceptedRegistration.data).toHaveLength(1);
      for (const [name, actorInfo] of Object.entries(actors)) {
        const listed = await actorInfo.client.from('match_events').select('id');
        expect(listed.error, `${name} unfiltered select`).toBeNull();
        const listIds = new Set((listed.data ?? []).map((row) => row.id));
        for (const event of Object.values(events)) {
          const direct = await actorInfo.client.from('match_events').select('id').eq('id', event);
          const helper = await actorInfo.client.rpc('can_read_match_event', { p_event_id: event });
          expect(direct.error, `${name} direct select`).toBeNull();
          expect(
            (direct.data?.length ?? 0) === 1,
            `${name} direct ${event}; expected ${allowed[name]!.has(event)}, helper=${helper.data}, rpcError=${helper.error?.message}`
          ).toBe(allowed[name]!.has(event));
          expect(listIds.has(event), `${name} list ${event}`).toBe(allowed[name]!.has(event));
          expect(helper.error).toBeNull();
          expect(helper.data).toBe(allowed[name]!.has(event));
        }
      }
      for (const name of ['stranger', 'member', 'pending', 'inactive', 'public_nonmember']) {
        const foreign =
          await actors[name]!.client.from('match_event_invites').select('match_event_id');
        expect(foreign.error).toBeNull();
        expect(foreign.data).toHaveLength(0);
      }
      for (const name of ['creator', 'admin']) {
        const visible =
          await actors[name]!.client.from('match_event_invites').select('match_event_id');
        expect(visible.data?.length).toBe(2);
      }
      const inviteeRows = await actors
        .invitee!.client.from('match_event_invites')
        .select('match_event_id');
      expect(inviteeRows.data?.length).toBe(2);
      const anonHelper = await anonClient.rpc('can_read_match_event', {
        p_event_id: eventIdFor(`${publicCommunity}:community_open`)
      });
      expect(anonHelper.error).not.toBeNull();
      const anonSelect = await anonClient.from('match_events').select('id');
      expect(anonSelect.error).not.toBeNull();
      for (const actorInfo of Object.values(actors)) {
        for (const table of [
          'match_events',
          'match_event_registrations',
          'match_event_invites'
        ] as const) {
          expect(
            (await actorInfo.client.from(table).insert({ id: crypto.randomUUID() })).error
          ).not.toBeNull();
          expect(
            (await actorInfo.client.from(table).update({ id: crypto.randomUUID() })).error
          ).not.toBeNull();
          expect((await actorInfo.client.from(table).delete()).error).not.toBeNull();
        }
      }
    },
    60000
  );
});
