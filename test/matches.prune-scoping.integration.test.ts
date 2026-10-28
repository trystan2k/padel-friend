import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { FIXTURE_EMAIL_LIKE, MATCH_FIXTURE_PRUNE_STATEMENTS } from '../e2e/global-setup';
import { matchPhotoFixture } from './helpers/match-photo-fixtures';
import { queryTrustedSql, sqlErrorMessage } from './helpers/sql-transport';
import {
  assertLocalSupabaseEnvInCi,
  dotEnvPathFromImportMetaUrl,
  localSupabaseEnv
} from './helpers/local-supabase-env';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

async function trustedSqlOutput(sql: string): Promise<string> {
  try {
    await queryTrustedSql(sql);
    return '';
  } catch (error) {
    // Match the CLI's JSON-quoted error envelope; the intentional exception
    // carries the transaction's rollback-safe report in its message.
    return JSON.stringify(sqlErrorMessage(error));
  }
}

describe('e2e match fixture prune scoping', () => {
  it('requires local Supabase in CI', () => {
    expect(() => assertLocalSupabaseEnvInCi(environment.env, process.env.CI)).not.toThrow();
  });

  it.skipIf(!environment.env)(
    'prunes only fixture-owned rows and never touches a normal local developer\u2019s match data',
    async () => {
      const { url, key } = environment.env!;
      const fixtureDomain = FIXTURE_EMAIL_LIKE.replace('%', '');
      const signUp = async (email: string): Promise<string> => {
        const signup = await createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false }
        }).auth.signUp({ email, password: 'Password123!' });
        expect(signup.error, `signUp failed for ${email}`).toBeNull();
        expect(signup.data.session, 'local email confirmations must be disabled').not.toBeNull();
        return signup.data.user!.id;
      };

      // Three real local actors: two suite-style fixture accounts created through the
      // dedicated marker domain, and one ordinary developer account whose email can
      // never match the marker — exactly what a human's local account looks like.
      const [fixtureOwner, fixtureInvitee, developer] = await Promise.all([
        signUp(`prune-guard-owner-${crypto.randomUUID()}${fixtureDomain}`),
        signUp(`prune-guard-invitee-${crypto.randomUUID()}${fixtureDomain}`),
        signUp(`prune-guard-developer-${crypto.randomUUID()}@example.com`)
      ]);
      expect(fixtureDomain).toBe('@test.local');
      expect('@example.com'.endsWith(fixtureDomain)).toBe(false);

      const fixtureEvent = crypto.randomUUID();
      const developerEvent = crypto.randomUUID();
      const fixtureCommunity = crypto.randomUUID();
      const developerCommunity = crypto.randomUUID();
      const fixturePhoto = matchPhotoFixture(fixtureCommunity, fixtureEvent, fixtureOwner);
      const developerPhoto = matchPhotoFixture(developerCommunity, developerEvent, developer);

      // One atomic probe: build the fixture and developer rows, run the exact production
      // prune statements, capture the post-prune row counts, then fail on purpose — the
      // exception rolls the whole block back, so the shared database stays byte-identical
      // while the report escapes through the error message. The table locks serialize the
      // destructive window against concurrently running fixture suites.
      const probe = `do $$
declare
  v_report jsonb;
begin
  alter table public.match_events disable trigger match_event_creator_registration;
  ${fixturePhoto.sql}
  ${developerPhoto.sql}
  insert into public.communities(id,name,visibility,created_by,settings) values
    ('${fixtureCommunity}','Prune guard fixture community','public','${fixtureOwner}','{}'::jsonb),
    ('${developerCommunity}','Prune guard developer community','public','${developer}','{}'::jsonb);
  insert into public.community_members(community_id,user_id,role,status,valid_from,activated_at)
    select c.id, c.created_by, 'admin', 'active', now(), now()
      from public.communities c
      where c.created_by in ('${fixtureOwner}','${developer}');
  insert into public.community_members(community_id,user_id,role,status,valid_from,activated_at) values
    ((select id from public.communities where name='Prune guard fixture community'),'${fixtureInvitee}','member','active',now(),now());
  insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,registration_cutoff_at) values
    ('${fixtureEvent}',(select id from public.communities where name='Prune guard fixture community'),'${fixtureOwner}', now()+interval '3 days','UTC','friendly','community_open','POST_MATCH_TEAMS','Prune guard fixture court','https://maps.google.com/maps/place/prune-guard-fixture','${fixturePhoto.path}', now()+interval '2 days'),
    ('${developerEvent}',(select id from public.communities where name='Prune guard developer community'),'${developer}', now()-interval '26 hours','UTC','friendly','community_open','POST_MATCH_TEAMS','Prune guard developer court','https://maps.google.com/maps/place/prune-guard-developer','${developerPhoto.path}', now()-interval '27 hours');
      insert into public.match_event_registrations(match_event_id,user_id,accepted_at,accepted_order,participation_status,registration_source) values
        ('${fixtureEvent}','${fixtureOwner}',now(),1,'reserve','creator'),
        ('${developerEvent}','${developer}',now(),1,'reserve','creator');
      insert into public.match_event_registration_state(match_event_id,next_accepted_ordinal) values
        ('${fixtureEvent}',2),('${developerEvent}',2);
      -- Departures/reconfirmation history must agree with each accepted registration.
      insert into public.match_event_registration_attempts(registration_id,match_event_id,user_id,registration_source,requested_at,outcome,actor_id,decided_at,accepted_at,accepted_order)
        select id,match_event_id,user_id,registration_source,accepted_at,'accepted',user_id,accepted_at,accepted_at,accepted_order
          from public.match_event_registrations where match_event_id in ('${fixtureEvent}','${developerEvent}');
      update public.match_event_registrations r set current_attempt_id=a.id
        from public.match_event_registration_attempts a where a.registration_id=r.id
          and r.match_event_id in ('${fixtureEvent}','${developerEvent}');
      insert into public.match_event_invites(match_event_id,invitee_user_id,invited_by) values
        ('${fixtureEvent}','${fixtureInvitee}','${fixtureOwner}'),
        ('${developerEvent}','${developer}','${developer}');
      insert into public.notifications(recipient_user_id,event_key,kind,category,target_type,target_id,community_id) values
        ('${fixtureOwner}','fixture-match-${fixtureEvent}','match_event_invitation','matches','match_event','${fixtureEvent}','${crypto.randomUUID()}'),
        ('${developer}','developer-match-${developerEvent}','match_event_invitation','matches','match_event','${developerEvent}','${crypto.randomUUID()}'),
        ('${fixtureOwner}','fixture-community-${fixtureEvent}','community_invitation','community','community_invitation','${crypto.randomUUID()}','${crypto.randomUUID()}');
  lock table public.match_event_invites in share row exclusive mode;
  lock table public.match_event_registrations in share row exclusive mode;
  lock table public.match_events in share row exclusive mode;
      -- Validate staged history and drain deferred events before prune ALTER TABLEs.
      set constraints all immediate;
      set constraints all deferred;
      ${MATCH_FIXTURE_PRUNE_STATEMENTS};
      ${MATCH_FIXTURE_PRUNE_STATEMENTS};
      begin
        alter table public.match_events disable trigger match_event_immutable;
        raise exception 'intentional cleanup rollback probe';
      exception when others then null;
      end;
      v_report := jsonb_build_object(
    'fixture_event',(select count(*) from public.match_events where id='${fixtureEvent}'),
    'fixture_registration',(select count(*) from public.match_event_registrations where match_event_id='${fixtureEvent}'),
        'fixture_invite',(select count(*) from public.match_event_invites where match_event_id='${fixtureEvent}'),
        'fixture_notification',(select count(*) from public.notifications where event_key='fixture-match-${fixtureEvent}'),
        'fixture_state',(select count(*) from public.match_event_registration_state where match_event_id='${fixtureEvent}'),
        'fixture_attempt',(select count(*) from public.match_event_registration_attempts where match_event_id='${fixtureEvent}'),
        'developer_notification',(select count(*) from public.notifications where event_key='developer-match-${developerEvent}'),
        'unrelated_notification',(select count(*) from public.notifications where recipient_user_id='${fixtureOwner}' and category='community'),
        'event_trigger_enabled',(select tgenabled='O' from pg_trigger where tgname='match_event_immutable'),
    'developer_event',(select count(*) from public.match_events where id='${developerEvent}'),
    'developer_registration',(select count(*) from public.match_event_registrations where match_event_id='${developerEvent}'),
    'developer_invite',(select count(*) from public.match_event_invites where match_event_id='${developerEvent}'),
    'fixture_community',(select count(*) from public.communities where name='Prune guard fixture community'),
    'developer_community',(select count(*) from public.communities where name='Prune guard developer community'));
  raise exception 'PRUNE_GUARD_REPORT %', v_report::text;
end $$;`;

      const output = await trustedSqlOutput(probe);
      // The CLI embeds the raised message as a JSON string, so the report's own quotes
      // arrive escaped; capture up to the first unescaped quote, then unescape.
      const reportMatch = output.match(/PRUNE_GUARD_REPORT ((?:[^"\\]|\\.)*)/);
      expect(
        reportMatch,
        `Prune guard probe did not report: ${output.slice(0, 2000)}`
      ).not.toBeNull();
      const isRecord = (value: unknown): value is Record<string, unknown> =>
        typeof value === 'object' && value !== null && !Array.isArray(value);
      const parsed: unknown = JSON.parse(reportMatch![1]!.replace(/\\"/g, '"'));
      const report = isRecord(parsed) ? parsed : {};
      // Fixture-owned rows are gone: the event, its creator registration and its invitation.
      expect(report['fixture_event']).toBe(0);
      expect(report['fixture_registration']).toBe(0);
      expect(report['fixture_invite']).toBe(0);
      expect(report['fixture_notification']).toBe(0);
      expect(report['fixture_state']).toBe(0);
      expect(report['fixture_attempt']).toBe(0);
      // Every row of a normal local developer survives untouched — event, registration
      // and invitation — and the prune never leaves the match tables' scope.
      expect(report['developer_event']).toBe(1);
      expect(report['developer_registration']).toBe(1);
      expect(report['developer_invite']).toBe(1);
      expect(report['developer_notification']).toBe(1);
      expect(report['unrelated_notification']).toBe(1);
      expect(report['event_trigger_enabled']).toBe(true);
      expect(report['fixture_community']).toBe(1);
      expect(report['developer_community']).toBe(1);
    },
    60_000
  );
});
