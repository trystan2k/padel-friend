import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect } from 'vitest';
import type { Database } from '../../src/lib/supabase/database.types';
import type { LocalSupabaseEnv } from './local-supabase-env';
import { matchPhotoFixture } from './match-photo-fixtures';
import { executeTrustedSql, queryTrustedSql } from './sql-transport';

export type ProvisionalFixtureActor = {
  id: string;
  email: string;
  client: SupabaseClient<Database>;
};

export const sqlText = (value: string): string => `'${value.replaceAll("'", "''")}'`;

/**
 * Signs up a real local Auth identity and returns a browser-equivalent client
 * carrying its JWT. Regular players onboard; provisional players are created
 * later through the internal provisioning primitive, so their session behaves
 * like a provisional identity that obtained a token before claiming.
 */
export async function signUpFixtureActor(
  env: LocalSupabaseEnv,
  label: string,
  onboard?: { displayName: string; level: number }
): Promise<ProvisionalFixtureActor> {
  const email = `provisional-${label}-${crypto.randomUUID()}@test.local`;
  const signup = await createClient(env.url, env.key, {
    auth: { persistSession: false, autoRefreshToken: false }
  }).auth.signUp({ email, password: 'Password123!' });
  expect(signup.error).toBeNull();
  expect(signup.data.session, 'local email confirmations must be disabled').not.toBeNull();
  const client = createClient<Database>(env.url, env.key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${signup.data.session!.access_token}` } }
  });
  if (onboard) {
    const result = await client.rpc('onboard_player', {
      p_display_name: onboard.displayName,
      p_preferred_side: 'EITHER',
      p_initial_level: onboard.level
    });
    expect(result.error).toBeNull();
  }
  return { id: signup.data.user!.id, email, client };
}

export async function provisionProvisionalPlayer(input: {
  userId: string;
  displayName: string;
  estimatedLevel: number;
  invitedBy: string;
  sourceEventId: string;
}): Promise<boolean> {
  const result = await queryTrustedSql(
    'select public.provision_provisional_player_locked($1, $2, $3, $4, $5) as created',
    {
      values: [
        input.userId,
        input.displayName,
        input.estimatedLevel,
        input.invitedBy,
        input.sourceEventId
      ]
    }
  );
  return result.rows[0]?.created === true;
}

export async function ensureProvisionalMembership(input: {
  communityId: string;
  userId: string;
  addedBy: string;
  sourceEventId: string;
}): Promise<string> {
  const result = await queryTrustedSql(
    'select public.ensure_provisional_community_membership_locked($1, $2, $3, $4) as id',
    { values: [input.communityId, input.userId, input.addedBy, input.sourceEventId] }
  );
  return String(result.rows[0]?.id);
}

/** Community with an active admin creator; additional active members optional. */
export async function insertFixtureCommunity(input: {
  id: string;
  visibility: 'public' | 'private';
  adminId: string;
  memberIds?: string[];
}): Promise<void> {
  const members = [
    `(${sqlText(input.id)},${sqlText(input.adminId)},'admin','active',now()-interval '1 day')`,
    ...(input.memberIds ?? []).map(
      (memberId) =>
        `(${sqlText(input.id)},${sqlText(memberId)},'member','active',now()-interval '1 day')`
    )
  ];
  await executeTrustedSql(`
    insert into public.communities(id,name,visibility,created_by)
      values (${sqlText(input.id)},'Provisional fixture ${input.visibility}',${sqlText(input.visibility)},${sqlText(input.adminId)});
    insert into public.community_members(community_id,user_id,role,status,valid_from) values ${members.join(',')};`);
}

/**
 * Published event owned by creatorId. Future events register the creator via
 * the publication trigger; past events skip it, mirroring finished history.
 */
export async function insertFixtureEvent(input: {
  id: string;
  communityId: string;
  creatorId: string;
  visibility: 'community_open' | 'invite_only';
  past?: boolean;
}): Promise<void> {
  const photo = matchPhotoFixture(input.communityId, input.id, input.creatorId);
  const startsAt = input.past ? "now()-interval '2 hours'" : "now()+interval '3 days'";
  const cutoffAt = input.past ? "now()-interval '3 hours'" : "now()+interval '2 days'";
  const insert = `${photo.sql}
    insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,registration_cutoff_at)
      values (${sqlText(input.id)},${sqlText(input.communityId)},${sqlText(input.creatorId)},${startsAt},'UTC','competitive',${sqlText(input.visibility)},'POST_MATCH_TEAMS','Provisional court','https://maps.google.com/maps/place/provisional','${photo.path}',${cutoffAt});`;
  await executeTrustedSql(
    input.past
      ? `alter table public.match_events disable trigger match_event_creator_registration;
         ${insert}
         alter table public.match_events enable trigger match_event_creator_registration;`
      : insert
  );
}

/** Accepted reserve registration plus its accepted attempt evidence, appended in FIFO order. */
export async function insertAcceptedRegistration(eventId: string, userId: string): Promise<void> {
  const event = sqlText(eventId);
  const user = sqlText(userId);
  await executeTrustedSql(`do $$ begin
    insert into public.match_event_registrations(match_event_id,user_id,accepted_at,accepted_order,participation_status,registration_source)
      select ${event},${user},clock_timestamp(),coalesce(max(accepted_order),0)+1,'reserve','member'
      from public.match_event_registrations where match_event_id=${event};
    insert into public.match_event_registration_attempts(registration_id,match_event_id,user_id,requested_at,decided_at,outcome,actor_id,accepted_at,accepted_order,registration_source)
      select id,match_event_id,user_id,accepted_at,accepted_at,'accepted',user_id,accepted_at,accepted_order,registration_source
      from public.match_event_registrations where match_event_id=${event} and user_id=${user};
    update public.match_event_registrations r set current_attempt_id=a.id
      from public.match_event_registration_attempts a
      where a.registration_id=r.id and r.match_event_id=${event} and r.user_id=${user};
  end $$;`);
}
