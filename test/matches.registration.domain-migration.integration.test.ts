import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { matchPhotoFixture } from './helpers/match-photo-fixtures';
import { startCliSql } from './helpers/match-registration-sql';
import {
  assertLocalSupabaseEnvInCi,
  dotEnvPathFromImportMetaUrl,
  localSupabaseEnv
} from './helpers/local-supabase-env';

// F20/F30 regression guard for the PAF-5 registration domain migration.
//
// The migration must (F20) drop the pre-PAF-5 blanket immutability trigger
// BEFORE any backfill write, otherwise the migration aborts with 23514 on any
// populated database, and (F30) initialise participation from the same derived
// roster rule the rest of the schema uses (first floor(N/4)*4 Playing, cutoff-
// aware residual Reserve / Reserve Not Playing) instead of a blanket 'reserve'.
//
// This suite reads the REAL migration file, executes its legacy-trigger drop and
// participation backfill in FILE ORDER against a populated fixture while the
// legacy trigger is installed, and asserts the stored state matches the derived
// roster. Everything runs in one DO block that raises a sentinel at the end, so
// the whole transaction rolls back and the local database is left untouched.

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
const MIGRATION_PATH = 'supabase/migrations/20261017173426_match_registration_domain.sql';
const LEGACY_TRIGGER =
  'drop trigger match_registration_immutable on public.match_event_registrations;';
const GUARD_TRIGGER = 'create trigger match_registration_identity_guard';
const PROBE_OK = 'PAF5_DOMAIN_PROBE_OK';

type SqlResult = { code: number | null; stdout: string; stderr: string };

function runSql(sql: string): Promise<SqlResult> {
  const handle = startCliSql(sql);
  return handle.done.finally(() => handle.stop());
}

/** Slices the statement whose body contains `needle` (anchored on the assignment). */
function statementAround(file: string, needle: string): string {
  const anchor = file.indexOf(needle);
  expect(anchor, `anchor "${needle}"`).toBeGreaterThanOrEqual(0);
  const updateIndex = file.lastIndexOf('update public.match_event_registrations', anchor);
  const withIndex = file.lastIndexOf('\nwith ', anchor);
  const start = withIndex >= 0 ? Math.min(withIndex + 1, updateIndex) : updateIndex;
  expect(start, `statement start for "${needle}"`).toBeGreaterThanOrEqual(0);
  const end = file.indexOf(';', anchor);
  return file.slice(start, end + 1);
}

describe('match registration domain migration backfill (F20/F30)', () => {
  it('requires local Supabase in CI', () => {
    expect(() => assertLocalSupabaseEnvInCi(environment.env, process.env.CI)).not.toThrow();
  });

  it.skipIf(!environment.env)(
    'drops the legacy immutability trigger before the backfill and derives participation consistently',
    async () => {
      const file = readFileSync(MIGRATION_PATH, 'utf8');
      const participationBackfill = statementAround(file, 'set participation_status =');
      const acceptedOrderBackfill = statementAround(file, 'set accepted_order =');

      // F20 ordering contract: the legacy trigger drop precedes EVERY backfill
      // write, and the replacement identity guard is installed only after them.
      const dropIndex = file.indexOf(LEGACY_TRIGGER);
      const participationIndex = file.indexOf(participationBackfill);
      const acceptedOrderIndex = file.indexOf(acceptedOrderBackfill);
      const guardIndex = file.indexOf(GUARD_TRIGGER);
      expect(dropIndex, 'legacy trigger drop present').toBeGreaterThanOrEqual(0);
      expect(participationIndex, 'participation backfill present').toBeGreaterThan(dropIndex);
      expect(acceptedOrderIndex, 'accepted-order backfill present').toBeGreaterThan(dropIndex);
      expect(guardIndex, 'identity guard installed after the backfills').toBeGreaterThan(
        participationIndex
      );
      expect(guardIndex).toBeGreaterThan(acceptedOrderIndex);

      // F30: the participation backfill derives from the roster rule (window
      // function + cutoff awareness), never a blanket literal.
      expect(participationBackfill).toContain(
        'row_number() over (partition by r.match_event_id order by r.accepted_order, r.id)'
      );
      expect(participationBackfill).toContain("'playing'::public.match_registration_participation");
      expect(participationBackfill).toContain("'reserve'::public.match_registration_participation");
      expect(participationBackfill).toContain(
        "'reserve_not_playing'::public.match_registration_participation"
      );
      expect(participationBackfill).toContain(
        'e.registration_cutoff_at <= pg_catalog.clock_timestamp()'
      );
      expect(participationBackfill).not.toMatch(/set participation_status = 'reserve'/);

      // Behavioral proof: run the extracted statements in FILE ORDER against a
      // populated fixture with the legacy trigger installed. Before the F20
      // fix the backfill would run first and the legacy trigger would abort
      // with 23514; after the fix the drop runs first and the backfill derives
      // the correct Playing/Reserve split. The whole probe (fixture users
      // included) runs in one DO block that raises a sentinel, so it rolls back
      // and leaves no fixture rows behind.
      const creator = '11111111-1111-4111-8111-111111111111';
      const m1 = '22222222-2222-4222-8222-222222222222';
      const m2 = '33333333-3333-4333-8333-333333333333';
      const m3 = '44444444-4444-4444-8444-444444444444';
      const m4 = '55555555-5555-4555-8555-555555555555';
      const communityId = crypto.randomUUID();
      const futureEventId = crypto.randomUUID();
      const pastEventId = crypto.randomUUID();
      const futurePhoto = matchPhotoFixture(communityId, futureEventId, creator);
      const pastPhoto = matchPhotoFixture(communityId, pastEventId, creator);
      const members = [m1, m2, m3, m4];
      const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
      const eventInsert = (eventId: string, cutoff: string, photoPath: string) =>
        `insert into public.match_events(
          id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,
          venue_name,maps_url,photo_path,restriction_enabled,min_level,max_level,maximum_registrations,registration_cutoff_at)
          values (${q(eventId)},${q(communityId)},${q(creator)},now()+interval '10 days','UTC','friendly','community_open','POST_MATCH_TEAMS',
            'Domain migration court','https://maps.google.com/maps/place/domain-migration',${q(photoPath)},
            false,null,null,null,${cutoff});`;
      // Pre-backfill shape: every row is accepted with a sentinel participation
      // so a blanket 'reserve' backfill would be observably wrong.
      const registrationInsert = (eventId: string, userId: string, ordinal: number) =>
        `insert into public.match_event_registrations(
          match_event_id,user_id,lifecycle,accepted_at,accepted_order,participation_status,registration_source,requested_at)
          values (${q(eventId)},${q(userId)},'accepted',now()-interval '1 day' + (${ordinal} * interval '1 minute'),${ordinal},'reserve','member',now()-interval '1 day');`;

      const orderedStatements = [
        { index: dropIndex, sql: LEGACY_TRIGGER },
        { index: participationIndex, sql: participationBackfill }
      ]
        .sort((a, b) => a.index - b.index)
        .map((entry) => `execute $stmt$${entry.sql}$stmt$;`)
        .join('\n');

      const probe = [
        `do $probe$ declare`,
        `  v_event uuid;`,
        `  v_row record;`,
        `  v_playing integer;`,
        `  v_reserve integer;`,
        `  v_not_playing integer;`,
        ` begin`,
        `  execute 'alter table public.match_events disable trigger match_event_published_notification';`,
        `  insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at) values`,
        `    (${q(creator)},'00000000-0000-0000-0000-000000000000','authenticated','authenticated','paf5-domain-migration-creator@test.local','x',now(),now(),now()),`,
        `    (${q(m1)},'00000000-0000-0000-0000-000000000000','authenticated','authenticated','paf5-domain-migration-m1@test.local','x',now(),now(),now()),`,
        `    (${q(m2)},'00000000-0000-0000-0000-000000000000','authenticated','authenticated','paf5-domain-migration-m2@test.local','x',now(),now(),now()),`,
        `    (${q(m3)},'00000000-0000-0000-0000-000000000000','authenticated','authenticated','paf5-domain-migration-m3@test.local','x',now(),now(),now()),`,
        `    (${q(m4)},'00000000-0000-0000-0000-000000000000','authenticated','authenticated','paf5-domain-migration-m4@test.local','x',now(),now(),now());`,
        `  insert into public.communities(id,name,visibility,created_by) values (${q(communityId)},'Domain migration fixture','public',${q(creator)});`,
        `  insert into public.community_members(community_id,user_id,role,status,valid_from,activated_at) values (${q(communityId)},${q(creator)},'admin','active',now()-interval '1 minute',now()-interval '1 minute');`,
        `  ${futurePhoto.sql}`,
        `  ${pastPhoto.sql}`,
        `  ${eventInsert(futureEventId, `now() + interval '5 days'`, futurePhoto.path)}`,
        `  ${eventInsert(pastEventId, `now() - interval '5 days'`, pastPhoto.path)}`,
        // Publication now links its accepted attempt with an UPDATE. Install the
        // historical guard after publication, still before the backfill probe.
        `  execute 'create trigger match_registration_immutable before update or delete on public.match_event_registrations for each row execute function public.guard_match_event_mutation()';`,
        // Creator slots are created by the publication trigger (ordinal 1).
        ...members.map(
          (userId, index) => `  ${registrationInsert(futureEventId, userId, index + 2)}`
        ),
        ...members.map(
          (userId, index) => `  ${registrationInsert(pastEventId, userId, index + 2)}`
        ),
        `  update public.match_event_registration_state set next_accepted_ordinal = 6 where match_event_id in (${q(futureEventId)},${q(pastEventId)});`,
        orderedStatements,
        `  foreach v_event in array array[${q(futureEventId)}::uuid, ${q(pastEventId)}::uuid] loop`,
        `    for v_row in`,
        `      select r.participation_status as stored, q.participation_status as derived`,
        `        from public.match_event_registrations r`,
        `        join public.match_registration_roster(v_event) q on q.registration_id = r.id`,
        `       where r.match_event_id = v_event`,
        `    loop`,
        `      if v_row.stored is distinct from v_row.derived then`,
        `        raise exception 'participation backfill diverged from the derived roster on %', v_event;`,
        `      end if;`,
        `    end loop;`,
        `  end loop;`,
        `  select playing_count, reserve_count, reserve_not_playing_count`,
        `    into v_playing, v_reserve, v_not_playing`,
        `    from public.match_registration_counts(${q(futureEventId)});`,
        `  if v_playing <> 4 or v_reserve <> 1 or v_not_playing <> 0 then`,
        `    raise exception 'future event split wrong: playing=% reserve=% not_playing=%', v_playing, v_reserve, v_not_playing;`,
        `  end if;`,
        `  select playing_count, reserve_count, reserve_not_playing_count`,
        `    into v_playing, v_reserve, v_not_playing`,
        `    from public.match_registration_counts(${q(pastEventId)});`,
        `  if v_playing <> 4 or v_reserve <> 0 or v_not_playing <> 1 then`,
        `    raise exception 'past event split wrong: playing=% reserve=% not_playing=%', v_playing, v_reserve, v_not_playing;`,
        `  end if;`,
        `  raise exception '${PROBE_OK}' using errcode = 'P0001';`,
        `end $probe$;`
      ].join('\n');

      const result = await runSql(probe);
      const output = `${result.stdout}\n${result.stderr}`;
      // The sentinel proves the whole probe ran and rolled back cleanly.
      expect(output, `probe output: ${output}`).toContain(PROBE_OK);
      expect(output, 'the legacy trigger must not reject the backfill').not.toContain('23514');
    },
    120000
  );
});
