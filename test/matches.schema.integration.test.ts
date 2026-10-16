import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import {
  assertLocalSupabaseEnvInCi,
  dotEnvPathFromImportMetaUrl,
  localSupabaseEnv
} from './helpers/local-supabase-env';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
describe('match event schema integration', () => {
  it('requires local Supabase in CI', () => {
    expect(() => assertLocalSupabaseEnvInCi(environment.env, process.env.CI)).not.toThrow();
  });
  it.skipIf(!environment.env)(
    'enforces insert constraints, accepted values, creator atomicity and aging-row schema',
    async () => {
      const { url, key } = environment.env!;
      const auth = await createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false }
      }).auth.signUp({
        email: `match-schema-${crypto.randomUUID()}@test.local`,
        password: 'Password123!'
      });
      expect(auth.error).toBeNull();
      const creatorId = auth.data.user!.id;
      const communityId = crypto.randomUUID();
      const eventId = crypto.randomUUID();
      const sql = `do $$
    declare
      v_creator uuid := '${creatorId}';
      v_community uuid := '${communityId}';
      v_event uuid := '${eventId}';
      v_case record;
      v_url text;
      v_stmt text;
      v_count integer;
      v_accepted timestamptz;
      v_published timestamptz;
      v_failed_event uuid;
      v_failed boolean := false;
     begin
       -- Schema fixture uses placeholder paths; storage attachment is covered by PAF-72 integration tests.
       alter table public.match_events disable trigger lock_match_photo_publication;
       insert into public.communities(id,name,visibility,created_by) values (v_community,'Schema integration fixture','public',v_creator);
      insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,registration_cutoff_at)
        values(v_event,v_community,v_creator,now()+interval '2 days','UTC','friendly','community_open','POST_MATCH_TEAMS','Court','https://maps.google.com/maps/x','${crypto.randomUUID()}/photo.webp',now()+interval '1 day');
      select count(*),min(r.accepted_at),min(e.published_at) into v_count,v_accepted,v_published
        from public.match_event_registrations r join public.match_events e on e.id=r.match_event_id
        where r.match_event_id=v_event and r.user_id=v_creator;
      if v_count <> 1 or v_accepted is distinct from v_published then raise exception 'creator auto-registration mismatch'; end if;

      for v_case in select * from (values
        ('blank venue','venue_name',quote_literal('')),
        ('long venue','venue_name',quote_literal(repeat('x',121))),
        ('blank maps','maps_url',quote_literal('')),
        ('long maps','maps_url',quote_literal(repeat('x',2049))),
        ('long court notes','court_notes',quote_literal(repeat('x',301))),
        ('long notes','notes',quote_literal(repeat('x',2001))),
        ('long payment note','payment_note',quote_literal(repeat('x',301))),
        ('negative price','price_minor,currency','-1,''BRL'''),
        ('GBP currency','price_minor,currency','1,''GBP'''),
        ('XYZ currency','price_minor,currency','1,''XYZ'''),
        ('inverted range','restriction_enabled,min_level,max_level','true,5,4'),
        ('negative level','restriction_enabled,min_level,max_level','true,-0.1,1'),
        ('high level','restriction_enabled,min_level,max_level','true,1,7.1'),
        ('zero capacity','maximum_registrations','0'),
        ('negative capacity','maximum_registrations','-1')
      ) c(label,columns_list,values_list) loop
        if v_case.columns_list = 'venue_name' then
          v_stmt := format('insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,registration_cutoff_at) values(gen_random_uuid(),%L,%L,now()+interval ''2 days'',''UTC'',''friendly'',''community_open'',''POST_MATCH_TEAMS'',%s,''https://maps.google.com/maps/x'',%L,now()+interval ''1 day'')',v_community,v_creator,v_case.values_list,gen_random_uuid()::text||'/photo.webp');
        elsif v_case.columns_list = 'maps_url' then
          v_stmt := format('insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,registration_cutoff_at) values(gen_random_uuid(),%L,%L,now()+interval ''2 days'',''UTC'',''friendly'',''community_open'',''POST_MATCH_TEAMS'',''Court'',%s,%L,now()+interval ''1 day'')',v_community,v_creator,v_case.values_list,gen_random_uuid()::text||'/photo.webp');
        else
          v_stmt := format('insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,registration_cutoff_at,%s) values (gen_random_uuid(),%L,%L,now()+interval ''2 days'',''UTC'',''friendly'',''community_open'',''POST_MATCH_TEAMS'',''Court'',''https://maps.google.com/maps/x'',%L,now()+interval ''1 day'',%s)',
            v_case.columns_list,v_community,v_creator,gen_random_uuid()::text||'/photo.webp',v_case.values_list);
        end if;
        begin
          execute v_stmt;
          raise exception 'constraint failed to reject case: %',v_case.label;
        exception when check_violation or not_null_violation then null;
        end;
      end loop;
      begin
        insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,registration_cutoff_at)
          values(gen_random_uuid(),v_community,v_creator,now()+interval '2 days','UTC','friendly','community_open','POST_MATCH_TEAMS','Court','https://maps.google.com/maps/x',gen_random_uuid()::text||'/p.webp',now()+interval '2 days');
        raise exception 'cutoff equal to start was accepted';
      exception when check_violation then null;
      end;
      begin
        insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,registration_cutoff_at)
          values(gen_random_uuid(),v_community,v_creator,now()+interval '2 days','UTC','friendly','community_open','POST_MATCH_TEAMS','Court','https://maps.google.com/maps/x',gen_random_uuid()::text||'/p.webp',now()+interval '3 days');
        raise exception 'cutoff after start was accepted';
      exception when check_violation then null;
      end;

      for v_url in select url from (values
        ('lookalike','https://www.google.com.evil.com/maps/x'),('javascript','javascript:alert(1)'),
        ('data','data:text/html,x'),('non-https','http://google.com/maps/x'),
        ('credentials','https://user:pass@google.com/maps/x'),('custom port','https://google.com:8443/maps/x'),
        ('control','https://google.com/maps/'||chr(1)),('malformed','https://[broken')
      ) c(label,url) loop
        begin
          insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,registration_cutoff_at)
            values(gen_random_uuid(),v_community,v_creator,now()+interval '2 days','UTC','friendly','community_open','POST_MATCH_TEAMS','Court',v_url,gen_random_uuid()::text||'/photo.webp',now()+interval '1 day');
          raise exception 'Maps predicate accepted invalid URL: %',v_url;
        exception when check_violation then null;
        end;
      end loop;

      insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,registration_cutoff_at,price_minor,currency)
        values(gen_random_uuid(),v_community,v_creator,now()+interval '2 days','UTC','friendly','community_open','POST_MATCH_TEAMS','Court','https://maps.google.com/maps/x',gen_random_uuid()::text||'/p.webp',now()+interval '1 day',0,'BRL'),
          (gen_random_uuid(),v_community,v_creator,now()+interval '2 days','UTC','friendly','community_open','POST_MATCH_TEAMS','Court','https://maps.google.com/maps/x',gen_random_uuid()::text||'/p.webp',now()+interval '1 day',0,'USD'),
          (gen_random_uuid(),v_community,v_creator,now()+interval '2 days','UTC','friendly','community_open','POST_MATCH_TEAMS','Court','https://maps.google.com/maps/x',gen_random_uuid()::text||'/p.webp',now()+interval '1 day',0,'EUR');
      foreach v_url in array array['https://maps.app.goo.gl/abc123','https://www.google.com/maps/place/x','https://maps.google.com/maps/x','https://goo.gl/maps/x'] loop
        insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,registration_cutoff_at)
          values(gen_random_uuid(),v_community,v_creator,now()+interval '2 days','UTC','friendly','community_open','POST_MATCH_TEAMS','Court',v_url,gen_random_uuid()::text||'/p.webp',now()+interval '1 day');
      end loop;
      insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,registration_cutoff_at,restriction_enabled,min_level,max_level)
        values(gen_random_uuid(),v_community,v_creator,now()+interval '2 days','UTC','friendly','community_open','POST_MATCH_TEAMS','Court','https://maps.google.com/maps/x',gen_random_uuid()::text||'/p.webp',now()+interval '1 day',false,null,null);

      -- Inject a failing creator-registration insert and verify the event row is rolled back.
      execute 'create function public.paf71_fail_registration() returns trigger language plpgsql set search_path = '''' as $f$ begin raise exception ''forced creator registration failure''; end $f$';
      execute 'create trigger paf71_fail_registration before insert on public.match_event_registrations for each row execute function public.paf71_fail_registration()';
      v_failed_event := gen_random_uuid();
      begin
        insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,registration_cutoff_at)
          values(v_failed_event,v_community,v_creator,now()+interval '2 days','UTC','friendly','community_open','POST_MATCH_TEAMS','Court','https://maps.google.com/maps/x',gen_random_uuid()::text||'/p.webp',now()+interval '1 day');
      exception when others then v_failed := true;
      end;
      execute 'drop trigger paf71_fail_registration on public.match_event_registrations';
      execute 'drop function public.paf71_fail_registration()';
      if not v_failed or exists(select 1 from public.match_events where id=v_failed_event) then raise exception 'creator registration failure did not atomically roll back event'; end if;

      if exists(select 1 from pg_constraint where conrelid='public.match_events'::regclass and pg_get_constraintdef(oid) ilike '%now()%') then raise exception 'now based CHECK found'; end if;
      -- The future-start trigger is a publication guard; bypass it to prove no schema CHECK rejects aging rows.
      alter table public.match_events disable trigger match_event_creator_registration;
       insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,registration_cutoff_at)
         values(gen_random_uuid(),v_community,v_creator,now()-interval '2 days','UTC','friendly','community_open','POST_MATCH_TEAMS','Past court','https://maps.google.com/maps/x',gen_random_uuid()::text||'/p.webp',now()-interval '3 days');
       alter table public.match_events enable trigger lock_match_photo_publication;
      alter table public.match_events enable trigger match_event_creator_registration;
    end $$`;
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
      if (code !== 0) throw new Error(`Constraint fixture failed (${code}): ${stdout}\n${stderr}`);
      expect(stdout.trim()).toBe('DO');
    },
    60000
  );
});
