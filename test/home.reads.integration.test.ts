import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { readHome } from '../src/features/home/home.server';
import type { Database } from '../src/lib/supabase/database.types';
import { matchPhotoFixture } from './helpers/match-photo-fixtures';
import { executeTrustedSql } from './helpers/sql-transport';
import {
  assertLocalSupabaseEnvInCi,
  dotEnvPathFromImportMetaUrl,
  localSupabaseEnv
} from './helpers/local-supabase-env';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
type Actor = { id: string; client: SupabaseClient<Database>; name: string };
type HomeClient = Parameters<typeof readHome>[0];

async function actor(label: string, displayName: string): Promise<Actor> {
  const { url, key } = environment.env!;
  const signup = await createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  }).auth.signUp({ email: `${label}-${crypto.randomUUID()}@test.local`, password: 'Password123!' });
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
  return { id: signup.data.user!.id, client, name: displayName };
}

/** Fails one named RPC while every other call reaches the real, RLS-protected client. */
function failing(client: SupabaseClient<Database>, ...names: string[]): SupabaseClient<Database> {
  return new Proxy(client, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (property === 'rpc')
        return (name: string, args?: Record<string, unknown>) =>
          names.includes(name)
            ? Promise.resolve({ data: null, error: { message: 'injected failure', code: 'XX000' } })
            : Reflect.apply(value, target, [name, args]);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
const home = (who: Actor, communityId: string | null, client: HomeClient = who.client) =>
  readHome(client, who.id, { community_id: communityId });

describe('home reads integration', () => {
  it('requires local Supabase in CI', () => {
    expect(() => assertLocalSupabaseEnvInCi(environment.env, process.env.CI)).not.toThrow();
  });

  it.skipIf(!environment.env)(
    'scopes Home to the caller memberships, orders the nearest match by instant and isolates failures',
    async () => {
      const token = crypto.randomUUID().replaceAll('-', '').slice(0, 8);
      const [creator, member, adminOnly, outsider] = await Promise.all([
        actor('home-creator', 'Home Creator'),
        actor('home-member', 'Home Member'),
        actor('home-admin', 'Home Admin'),
        actor('home-outsider', 'Home Outsider')
      ]);
      const alpha = crypto.randomUUID();
      const beta = crypto.randomUUID();
      const names = { alpha: `Home Alpha ${token}`, beta: `Home Beta ${token}` };
      const ids = {
        // Local wall clocks disagree with instant order: Kiritimati is UTC+14, Sao Paulo UTC-3.
        kiritimati: crypto.randomUUID(),
        saoPaulo: crypto.randomUUID(),
        cancelled: crypto.randomUUID(),
        past: crypto.randomUUID(),
        // Exact instant tie in the second community: the lower id wins.
        tieHigh: '00000000-0000-4000-8000-0000000000f2',
        tieLow: '00000000-0000-4000-8000-0000000000f1'
      };
      const event = (
        key: keyof typeof ids,
        communityId: string,
        startsAt: string,
        timezone: string,
        venue: string,
        extra = ''
      ) => {
        const photo = matchPhotoFixture(communityId, ids[key], creator.id);
        return `${photo.sql}
          insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,registration_cutoff_at${extra ? ',status,cancelled_at,cancelled_by,cancel_reason' : ''})
          values (${q(ids[key])},${q(communityId)},${q(creator.id)},${startsAt},${q(timezone)},'friendly','community_open','POST_MATCH_TEAMS',${q(venue)},'https://maps.google.com/maps/place/home',${q(photo.path)},${startsAt === "now()-interval '1 hour'" ? "now()-interval '3 hours'" : "now()+interval '1 hour'"}${extra});`;
      };
      await executeTrustedSql(`do $$ begin
        insert into public.communities(id,name,visibility,created_by,settings) values
          (${q(alpha)},${q(names.alpha)},'private',${q(creator.id)},'{}'::jsonb),
          (${q(beta)},${q(names.beta)},'private',${q(creator.id)},'{}'::jsonb);
        insert into public.community_members(community_id,user_id,role,status,valid_from,activated_at) values
          (${q(alpha)},${q(creator.id)},'admin','active',now()-interval '1 minute',now()-interval '1 minute'),
          (${q(beta)},${q(creator.id)},'admin','active',now()-interval '1 minute',now()-interval '1 minute'),
          (${q(alpha)},${q(member.id)},'member','active',now()-interval '1 minute',now()-interval '1 minute'),
          (${q(beta)},${q(member.id)},'member','active',now()-interval '1 minute',now()-interval '1 minute'),
          (${q(alpha)},${q(adminOnly.id)},'admin','active',now()-interval '1 minute',now()-interval '1 minute');
        ${event('kiritimati', alpha, "now()+interval '3 hours'", 'Pacific/Kiritimati', 'Kiritimati court')}
        ${event('saoPaulo', alpha, "now()+interval '5 hours'", 'America/Sao_Paulo', 'Sao Paulo court')}
        ${event('cancelled', alpha, "now()+interval '1 hour'", 'UTC', 'Cancelled court', ",'cancelled',now(),${q(creator.id)},'Rain'")}
        ${event('tieHigh', beta, "now()+interval '1 day'", 'UTC', 'Tie high court')}
        ${event('tieLow', beta, "now()+interval '1 day'", 'UTC', 'Tie low court')}
        alter table public.match_events disable trigger match_event_creator_registration;
        ${event('past', alpha, "now()-interval '1 hour'", 'UTC', 'Past court')}
        alter table public.match_events enable trigger match_event_creator_registration;
        insert into public.match_event_invites(match_event_id,invitee_user_id,invited_by,created_at)
        select id,${q(member.id)},${q(creator.id)},now() from public.match_events
         where community_id in (${q(alpha)},${q(beta)});
      end $$;`);

      // Default membership is deterministic (name order); nearest is by instant, not local clock.
      const first = await home(member, null);
      expect(first.communities).toMatchObject({ status: 'ok' });
      expect(
        first.communities.status === 'ok' && first.communities.value.map(({ name }) => name)
      ).toEqual([names.alpha, names.beta]);
      expect(first.selection).toEqual({ selectedId: alpha, requestedUnavailable: false });
      expect(first.matches).toMatchObject({
        status: 'ok',
        value: { next: { event_id: ids.kiritimati, venue_name: 'Kiritimati court' } }
      });
      expect(typeof first.unread).toBe('number');

      // Selecting the second community re-scopes every section and never mixes in the first.
      const second = await home(member, beta);
      expect(second.selection.selectedId).toBe(beta);
      expect(second.matches).toMatchObject({
        status: 'ok',
        value: { next: { event_id: ids.tieLow } }
      });
      expect(JSON.stringify(second.matches)).not.toContain(ids.kiritimati);
      expect(JSON.stringify(second.matches)).not.toContain(ids.cancelled);
      expect(JSON.stringify(first.matches)).not.toContain(ids.past);
      expect(
        JSON.stringify(first.matches.status === 'ok' ? first.matches.value.next : null)
      ).not.toContain(ids.cancelled);

      // Admin of only one community: the other is neither selectable nor leaked.
      const admin = await home(adminOnly, beta);
      expect(admin.selection).toEqual({ selectedId: alpha, requestedUnavailable: true });
      expect(JSON.stringify(admin)).not.toContain(names.beta);
      expect(JSON.stringify(admin)).not.toContain(ids.tieLow);

      // Zero memberships: discovery state, no private names, community sections unavailable.
      const none = await home(outsider, alpha);
      expect(none.communities).toEqual({ status: 'empty' });
      expect(none.selection).toEqual({ selectedId: null, requestedUnavailable: true });
      expect(none.matches).toEqual({ status: 'unavailable' });
      expect(none.actions).toEqual({ status: 'unavailable' });
      expect(none.ranking).toEqual({ status: 'unavailable' });
      for (const secret of [names.alpha, names.beta, ids.kiritimati, ids.tieLow])
        expect(JSON.stringify(none)).not.toContain(secret);

      // An optional read failure stays an explicit error beside sections that still load.
      const partial = await home(member, alpha, failing(member.client, 'list_leagues'));
      expect(partial.ranking).toMatchObject({
        status: 'ok',
        value: { league: { status: 'error' } }
      });
      expect(partial.matches.status).toBe('ok');

      // An unread-count failure is unknown, never zero, and never fails the page.
      const unknown = await home(
        member,
        alpha,
        failing(member.client, 'count_my_unread_notifications')
      );
      expect(unknown.unread).toBeNull();
      expect(unknown.matches.status).toBe('ok');
    },
    120_000
  );
});
