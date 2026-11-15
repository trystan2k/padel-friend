import { describe, expect, it } from 'vitest';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import { matchPhotoFixture } from './helpers/match-photo-fixtures';
import { signUpFixtureActor } from './helpers/provisional-player-fixtures';
import { queryTrustedSql, sqlErrorMessage } from './helpers/sql-transport';

const environment = localSupabaseEnv();
if (!environment.env)
  throw new Error(
    `published_by invariant suite requires live local Supabase: ${environment.reason}`
  );
const env = environment.env;

// The match-publication quota (rate_limits migration) counts match_events.published_by. That only
// holds while (a) the BEFORE INSERT trigger stamps it and (b) guard_match_event_mutation's local
// "allowed" array (the columns that may change on UPDATE) never lists it.
describe(
  'match_events.published_by immutability invariant (PAF-182 F22)',
  { timeout: 120_000 },
  () => {
    it('attaches initialize_match_event_publisher as a BEFORE INSERT row trigger on match_events', async () => {
      const { rows } = await queryTrustedSql(`
      select t.tgname, p.proname, (t.tgtype & 1) = 1 as is_row, (t.tgtype & 2) = 2 as is_before,
             (t.tgtype & 4) = 4 as on_insert, (t.tgtype & 16) = 16 as on_update, t.tgenabled
        from pg_catalog.pg_trigger t
        join pg_catalog.pg_proc p on p.oid = t.tgfoid
       where t.tgrelid = 'public.match_events'::regclass and not t.tgisinternal
         and p.proname = 'initialize_match_event_publisher'`);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        is_row: true,
        is_before: true,
        on_insert: true,
        on_update: false,
        tgenabled: 'O'
      });
    });

    it('keeps guard_match_event_mutation attached to UPDATE and DELETE with published_by outside its allowlist', async () => {
      const trigger = await queryTrustedSql(`
      select (t.tgtype & 2) = 2 as is_before, (t.tgtype & 8) = 8 as on_delete,
             (t.tgtype & 16) = 16 as on_update, t.tgenabled
        from pg_catalog.pg_trigger t
        join pg_catalog.pg_proc p on p.oid = t.tgfoid
       where t.tgrelid = 'public.match_events'::regclass and not t.tgisinternal
         and p.proname = 'guard_match_event_mutation'`);
      expect(trigger.rows).toHaveLength(1);
      expect(trigger.rows[0]).toMatchObject({
        is_before: true,
        on_update: true,
        on_delete: true,
        tgenabled: 'O'
      });

      const fn = await queryTrustedSql(
        "select pg_get_functiondef('public.guard_match_event_mutation()'::regprocedure) as def"
      );
      const def = String(fn.rows[0]?.def);
      // The allowlist is the local `allowed text[] := array[...]` literal (plus the gated league_id
      // extension); every column outside it must be byte-identical between OLD and NEW.
      const allowlist = /allowed\s+text\[\]\s*:=\s*array\[([^\]]*)\]/i.exec(def);
      expect(
        allowlist,
        'allowed text[] array literal missing from guard_match_event_mutation'
      ).not.toBeNull();
      expect(allowlist![1]).toContain("'status'");
      expect(allowlist![1]).not.toContain('published_by');
      expect(def).toMatch(/to_jsonb\(new\)\s*-\s*allowed/);
      // Anything appended to the allowlist at runtime must not name published_by either.
      expect(def.replace(allowlist![0], '')).not.toMatch(/published_by/);
    });

    it('stamps published_by with the creator at insert and rejects every later change at runtime', async () => {
      const [creator, other] = await Promise.all([
        signUpFixtureActor(env, 'pubby-creator', { displayName: 'Pub creator', level: 3.2 }),
        signUpFixtureActor(env, 'pubby-other', { displayName: 'Pub other', level: 3.2 })
      ]);
      const communityId = crypto.randomUUID();
      const eventId = crypto.randomUUID();
      const photo = matchPhotoFixture(communityId, eventId, creator.id);
      // One atomic probe rolled back by an intentional exception, so no fixture rows persist; the
      // report travels in the exception message.
      const probe = `do $$
declare
  v_published_by uuid;
  v_report jsonb := '{}'::jsonb;
  v_caught text;
begin
  insert into public.communities(id,name,visibility,created_by) values ('${communityId}','Publisher invariant','public','${creator.id}');
  ${photo.sql}
  insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,registration_cutoff_at)
    values('${eventId}','${communityId}','${creator.id}',now()+interval '2 days','UTC','friendly','community_open','POST_MATCH_TEAMS','Court','https://maps.google.com/maps/x','${photo.path}',now()+interval '1 day');
  select published_by into v_published_by from public.match_events where id='${eventId}';
  v_report := v_report || jsonb_build_object('stamped', v_published_by = '${creator.id}');

  -- Version bump satisfies the floor, so only published_by can be the rejected delta.
  begin
    update public.match_events set published_by='${other.id}', version=version+1 where id='${eventId}';
    v_report := v_report || jsonb_build_object('update_rejected', false);
  exception when others then
    get stacked diagnostics v_caught = message_text;
    v_report := v_report || jsonb_build_object('update_rejected', true, 'update_message', v_caught, 'update_state', sqlstate);
  end;
  begin
    update public.match_events set published_by='${other.id}', created_by='${other.id}', version=version+1 where id='${eventId}';
    v_report := v_report || jsonb_build_object('transfer_rejected', false);
  exception when others then
    v_report := v_report || jsonb_build_object('transfer_rejected', true);
  end;
  select published_by into v_published_by from public.match_events where id='${eventId}';
  v_report := v_report || jsonb_build_object('unchanged', v_published_by = '${creator.id}');
  raise exception 'REPORT:%', v_report::text;
end $$`;
      let message = '';
      try {
        await queryTrustedSql(probe);
      } catch (error) {
        message = sqlErrorMessage(error);
      }
      const reportJson = /REPORT:(\{.*\})/s.exec(message)?.[1];
      if (!reportJson) throw new Error(`Probe report missing: ${message}`);
      expect(JSON.parse(reportJson)).toMatchObject({
        stamped: true,
        update_rejected: true,
        update_message: 'Invalid match event mutation',
        update_state: '23514',
        transfer_rejected: true,
        unchanged: true
      });
    });
  }
);
