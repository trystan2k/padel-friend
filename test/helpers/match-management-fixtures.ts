import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/lib/supabase/database.types';
import { matchPhotoFixture } from './match-photo-fixtures';
import {
  createMatchFixtureCleanupRegistry,
  fixtureSql,
  makeRawRpc,
  registerMatchActorFixtureRows,
  registerMatchCommunityFixtureRows,
  registerMatchEventFixtureRows,
  sqlRows
} from './match-registration-sql';

export type ManagementActor = { id: string; token: string; client: SupabaseClient<Database> };

/** Local-only real actors and FK-safe trusted fixtures; no production time seam. */
export async function createMatchManagementFixtures(env: { url: string; key: string }) {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(env.url).hostname))
    throw new Error('LOCAL_SUPABASE_REQUIRED');
  const actors: ManagementActor[] = [];
  const events: string[] = [];
  const communityId = crypto.randomUUID();
  const cleanupRegistry = createMatchFixtureCleanupRegistry('match-management');
  registerMatchCommunityFixtureRows(cleanupRegistry, communityId);

  async function actor() {
    const email = `invitation-${cleanupRegistry.namespace}-${crypto.randomUUID()}@test.local`;
    registerMatchActorFixtureRows(cleanupRegistry, { email });
    const { data, error } = await createClient(env.url, env.key, {
      auth: { persistSession: false, autoRefreshToken: false }
    }).auth.signUp({
      email,
      password: 'Password123!'
    });
    if (error || !data.session || !data.user)
      throw new Error(`Fixture signup failed: ${error?.message ?? 'no session'}`);
    registerMatchActorFixtureRows(cleanupRegistry, { id: data.user.id });
    const token = data.session.access_token;
    const result = {
      id: data.user.id,
      token,
      client: createClient<Database>(env.url, env.key, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } }
      })
    };
    actors.push(result);
    return result;
  }
  const creator = await actor();
  await fixtureSql(`do $$ begin insert into public.communities(id,name,visibility,created_by) values ('${communityId}','Invitation fixture','public','${creator.id}');
    insert into public.community_members(community_id,user_id,role,status,valid_from,activated_at) values ('${communityId}','${creator.id}','admin','active',now()-interval '1 minute',now()-interval '1 minute'); end $$;`);
  async function member() {
    const result = await actor();
    await fixtureSql(
      `insert into public.community_members(community_id,user_id,role,status,valid_from,activated_at) values ('${communityId}','${result.id}','member','active',now()-interval '1 minute',now()-interval '1 minute');`
    );
    return result;
  }
  async function event(
    options: {
      accepted?: ManagementActor[];
      capacity?: number;
      cutoff?: string;
      invites?: ManagementActor[];
      inviteOnly?: boolean;
      restricted?: boolean;
    } = {}
  ) {
    const id = crypto.randomUUID();
    events.push(id);
    const photo = matchPhotoFixture(communityId, id, creator.id);
    registerMatchEventFixtureRows(cleanupRegistry, id, photo.path);
    await fixtureSql(`do $$ begin ${photo.sql}
      insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,restriction_enabled,min_level,max_level,maximum_registrations,registration_cutoff_at)
      values ('${id}','${communityId}','${creator.id}',now()+interval '10 days','UTC','friendly','${options.inviteOnly ? 'invite_only' : 'community_open'}','POST_MATCH_TEAMS','Invitation court','https://maps.google.com/maps/place/invitation','${photo.path}',${options.restricted ?? false},${options.restricted ? '6,7' : 'null,null'},${options.capacity ?? 'null'},${options.cutoff ?? "now()+interval '9 days'"});
      ${(options.accepted ?? []).map((a) => `perform set_config('request.jwt.claim.sub','${a.id}',true); perform public.submit_match_registration('${id}');`).join('\n')}
      ${(options.invites ?? []).map((a) => `insert into public.match_event_invites(match_event_id,invitee_user_id,invited_by) values ('${id}','${a.id}','${creator.id}');`).join('\n')} end $$;`);
    const invites = await sqlRows(
      `select id::text, invitee_user_id::text from public.match_event_invites where match_event_id='${id}'`
    );
    return { id, invites: new Map(invites.map((i) => [String(i.invitee_user_id), String(i.id)])) };
  }
  async function setCutoff(eventId: string, expression: string) {
    await fixtureSql(`do $$ begin alter table public.match_events disable trigger match_event_immutable;
      update public.match_events set registration_cutoff_at=${expression} where id='${eventId}';
      alter table public.match_events enable trigger match_event_immutable; end $$;`);
  }
  async function latestAttemptId(eventId: string, userId: string) {
    const rows = await sqlRows(
      `select id::text from public.match_event_registration_attempts where match_event_id='${eventId}' and user_id='${userId}' order by requested_at desc,id desc limit 1`
    );
    return rows[0] ? String(rows[0].id) : null;
  }
  async function protectResults(eventId: string) {
    await fixtureSql(`select public.protect_match_event_results('${eventId}');`);
  }
  async function setStarted(eventId: string) {
    await fixtureSql(`do $$ begin alter table public.match_events disable trigger match_event_immutable;
      update public.match_events set registration_cutoff_at=now()-interval '2 minutes',starts_at=now()-interval '1 minute' where id='${eventId}';
      alter table public.match_events enable trigger match_event_immutable; end $$;`);
  }
  /**
   * PAF-7 fixture: eight accepted players in two full playing quartets with
   * result protection applied. The creator is players[0]; acceptance order
   * follows the array, so accepted_order 1..4 derive group one and 5..8 derive
   * group two (group numbers are derived from the roster, never stored). The
   * overdue cutoff is finalized by the protection hook itself, freezing the
   * roster exactly as a real first result submission would.
   */
  async function protectedEightPlayerEvent() {
    const players = [creator, ...(await Promise.all(Array.from({ length: 7 }, () => member())))];
    const e = await event({ accepted: players.slice(1) });
    await setCutoff(e.id, "now()-interval '1 minute'");
    await protectResults(e.id);
    const roster = await sqlRows(
      `select participation_status::text as participation from public.match_event_registrations where match_event_id='${e.id}'`
    );
    if (
      roster.length !== players.length ||
      roster.some((row) => row['participation'] !== 'playing')
    )
      throw new Error('protected eight-player event did not yield two full playing quartets');
    return { id: e.id, players };
  }
  async function cleanup() {
    await cleanupRegistry.cleanup();
  }
  return {
    creator,
    communityId,
    events,
    actor,
    member,
    event,
    setCutoff,
    latestAttemptId,
    protectResults,
    setStarted,
    protectedEightPlayerEvent,
    cleanup,
    rpc: makeRawRpc(env.url, env.key)
  };
}
