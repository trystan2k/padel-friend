import { describe, expect, it } from 'vitest';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import { erasurePlan, scalar } from './helpers/account-erasure-fixtures';
import { fixtureSql, sqlRows } from './helpers/match-registration-sql';
import { signUpFixtureActor, sqlText } from './helpers/provisional-player-fixtures';

const environment = localSupabaseEnv();
const L = sqlText;

type Edge = { table: string; column: string; target: string };

/** Every single-column FK from a public table to Auth, the profile or the participant anchor. */
async function liveEdges(): Promise<Edge[]> {
  const rows = await sqlRows(
    'select t.relname::text as t, a.attname::text as c, r.relname::text as target ' +
      'from pg_constraint k join pg_class t on t.oid = k.conrelid join pg_class r on r.oid = k.confrelid ' +
      'join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1] ' +
      "where k.contype = 'f' and k.connamespace = 'public'::regnamespace and array_length(k.conkey, 1) = 1 " +
      "and k.confrelid in ('auth.users'::regclass, 'public.player_profiles'::regclass, 'public.participant_identities'::regclass) " +
      'order by 1, 2'
  );
  return rows.map((row) => ({
    table: String(row['t']),
    column: String(row['c']),
    target: String(row['target'])
  }));
}

async function registry() {
  const rows = await sqlRows(
    'select table_name::text as t, column_name::text as c, disposition::text as d from privacy_internal.erasure_dispositions order by 1, 2'
  );
  return rows.map((row) => ({
    table: String(row['t']),
    column: String(row['c']),
    disposition: String(row['d'])
  }));
}

const key = (edge: { table: string; column: string }) => edge.table + '.' + edge.column;
const GUARDED_TRIGGER_FUNCTIONS = [
  'guard_player_profile_provenance',
  'guard_community_member',
  'guard_community_invitation',
  'audit_community_change',
  'notify_community_membership',
  'notify_community_role_change',
  'guard_match_event_mutation',
  'guard_match_event_league_binding',
  'guard_match_registration_identity',
  'guard_match_invitation_mutation',
  'guard_match_registration_attempt',
  'guard_match_event_audit',
  'guard_match_result_proposal_transition',
  'guard_match_result_proposal_version_immutable',
  'guard_match_result_review_immutable',
  'guard_match_event_result_confirmation_insert',
  'guard_player_rating_evidence_immutable',
  'guard_league_identity',
  'guard_league_events_immutable',
  'guard_league_standings_snapshots_immutable',
  'guard_level_review_request',
  'guard_level_review_no_delete',
  'guard_result_amendment_request',
  'guard_result_amendment_insert_only',
  'guard_result_repair_job',
  'guard_result_repair_attempt',
  'notify_league_lifecycle',
  'notify_level_review_resolution'
];

describe.skipIf(!environment.env)(
  'Account erasure disposition contract (live catalog)',
  { timeout: 300_000 },
  () => {
    it('classifies every FK edge to Auth, the profile or the anchor', async () => {
      const classified = new Set((await registry()).map(key));
      const unclassified = (await liveEdges())
        .filter((edge) => !classified.has(key(edge)))
        .map(key);
      expect(unclassified).toEqual([]);
    });

    it('keeps the classification and the physical edge in agreement', async () => {
      const edges = new Map((await liveEdges()).map((edge) => [key(edge), edge.target]));
      const expectedTargets: Record<string, string[] | undefined> = {
        anchor_rekey: ['participant_identities'],
        account_owned: ['users', 'player_profiles'],
        delete_rows: ['users'],
        operator_blocker: ['users']
      };
      const mismatches: string[] = [];
      for (const entry of await registry()) {
        const target = edges.get(key(entry));
        // Composite and non-FK locations carry no single-column Auth/profile/anchor FK.
        const allowed = expectedTargets[entry.disposition];
        if (allowed ? !target || !allowed.includes(target) : target !== undefined)
          mismatches.push(key(entry) + ' -> ' + String(target));
        const [column] = await sqlRows(
          "select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = " +
            L(entry.table) +
            ' and column_name = ' +
            L(entry.column)
        );
        if (column?.['n'] !== 1) mismatches.push(key(entry) + ' missing column');
      }
      expect(mismatches).toEqual([]);
    });

    it('leaves no history-preserving edge on Auth or the profile', async () => {
      const allowedOnAuth = new Set(
        (await registry())
          .filter((entry) =>
            ['account_owned', 'delete_rows', 'operator_blocker'].includes(entry.disposition)
          )
          .map(key)
      );
      const stray = (await liveEdges()).filter(
        (edge) => edge.target !== 'participant_identities' && !allowedOnAuth.has(key(edge))
      );
      expect(stray.map(key)).toEqual([]);
    });

    it('flags a person-named location that is neither a foreign key nor classified', async () => {
      const classified = new Set((await registry()).map(key));
      const rows = await sqlRows(
        'select c.relname::text as t, a.attname::text as c from pg_attribute a join pg_class c on c.oid = a.attrelid ' +
          "where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped " +
          "and format_type(a.atttypid, a.atttypmod) in ('uuid', 'uuid[]') " +
          "and a.attname ~ '(user_id|actor|player|owner|creator|invitee|reviewer|requester|sender|recipient|subject|partner|submitted_by|invited_by|granted_by)' " +
          "and not exists (select 1 from pg_constraint k where k.conrelid = c.oid and k.contype = 'f' and a.attnum = any (k.conkey))"
      );
      const unclassified = rows
        .map((row) => String(row['t']) + '.' + String(row['c']))
        .filter((name) => !classified.has(name));
      expect(unclassified).toEqual([]);
    });

    it('fails closed on a newly added, unclassified FK edge to Auth', async () => {
      const lone = await signUpFixtureActor(environment.env!, 'edge-probe', {
        displayName: 'Edge Probe',
        level: 3
      });
      const probe = fixtureSql(
        'do $probe$ declare v_blockers jsonb; begin ' +
          'create table public.zz_unclassified_edge(owner_id uuid references auth.users(id)); ' +
          'v_blockers := privacy_internal.account_erasure_plan(' +
          L(lone.id) +
          ", '{}'::jsonb) -> 'blockers'; " +
          "raise exception 'PROBE:%', v_blockers::text; end $probe$;"
      );
      await expect(probe).rejects.toThrow(/PROBE:.*unclassified_dependency/);
      expect(
        await scalar("select count(*)::int from pg_class where relname = 'zz_unclassified_edge'")
      ).toBe(0);
      expect((await erasurePlan(lone.id)).blockers).toEqual([]);
    });

    it('fails closed on a composite FK to an identity-bearing table', async () => {
      const lone = await signUpFixtureActor(environment.env!, 'composite-probe', {
        displayName: 'Composite Probe',
        level: 3
      });
      const probe = fixtureSql(
        'do $probe$ declare v_blockers jsonb; begin ' +
          'alter table public.player_profiles add constraint zz_profile_key unique (user_id, display_name); ' +
          'create table public.zz_composite_edge(a uuid, b text, foreign key (a, b) references public.player_profiles(user_id, display_name)); ' +
          'v_blockers := privacy_internal.account_erasure_plan(' +
          L(lone.id) +
          ", '{}'::jsonb) -> 'blockers'; " +
          "raise exception 'PROBE:%', v_blockers::text; end $probe$;"
      );
      await expect(probe).rejects.toThrow(/PROBE:.*unclassified_dependency/);
      expect(
        await scalar("select count(*)::int from pg_class where relname = 'zz_composite_edge'")
      ).toBe(0);
      expect((await erasurePlan(lone.id)).blockers).toEqual([]);
    });

    it('opens the guard exemption only inside the private window', async () => {
      const rows = await sqlRows(
        "select count(*)::int as n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any (array[" +
          GUARDED_TRIGGER_FUNCTIONS.map(L).join(',') +
          "]) and pg_get_functiondef(p.oid) like '%privacy_internal.erasure_active()%'"
      );
      expect(rows[0]?.['n']).toBe(GUARDED_TRIGGER_FUNCTIONS.length);
      expect(await scalar('select privacy_internal.erasure_active()')).toBe(false);
      const clientCanRead = await sqlRows(
        "select has_table_privilege('authenticated', 'privacy_internal.erasure_windows', 'INSERT') as w, " +
          "has_table_privilege('service_role', 'privacy_internal.erasure_windows', 'INSERT') as s, " +
          "has_table_privilege('authenticated', 'privacy_internal.erasure_dispositions', 'UPDATE') as d"
      );
      expect(clientCanRead[0]).toEqual({ w: false, s: false, d: false });
    });
  }
);

describe.skipIf(!environment.env)('Participant anchor', { timeout: 300_000 }, () => {
  it('backfills a live identity for every Auth user and keeps new sign-ups in step', async () => {
    expect(
      await scalar(
        // An erased account keeps its Auth row until the privileged Auth delete (unit C): it has no profile and no anchor.
        "select count(*)::int from auth.users u join public.player_profiles p on p.user_id = u.id where not exists (select 1 from public.participant_identities i where i.id = u.id and i.state = 'live')"
      )
    ).toBe(0);
    const created = await signUpFixtureActor(environment.env!, 'anchor-signup');
    expect(
      await scalar(
        "select count(*)::int from public.participant_identities where state = 'live' and id = " +
          L(created.id)
      )
    ).toBe(1);
  });

  it('only lets a live Auth holder have a live identity and never a normal withdrawn one', async () => {
    await expect(
      fixtureSql(
        "insert into public.participant_identities(id, state) values (gen_random_uuid(), 'live')"
      )
    ).rejects.toThrow(/PARTICIPANT_IDENTITY_REQUIRES_AUTH_USER/);
    await expect(
      fixtureSql(
        "insert into public.participant_identities(id, state) values (gen_random_uuid(), 'withdrawn')"
      )
    ).rejects.toThrow(/PARTICIPANT_WITHDRAWN_ONLY_BY_ERASURE/);
    const created = await signUpFixtureActor(environment.env!, 'anchor-immutable');
    await expect(
      fixtureSql(
        "update public.participant_identities set state = 'withdrawn' where id = " + L(created.id)
      )
    ).rejects.toThrow(/PARTICIPANT_IDENTITY_IMMUTABLE/);
    await expect(
      fixtureSql('delete from public.participant_identities where id = ' + L(created.id))
    ).rejects.toThrow(/PARTICIPANT_IDENTITY_LIVE_ACCOUNT/);
  });

  it('keeps a plain Auth delete restricted by retained history, as before', async () => {
    const actor = await signUpFixtureActor(environment.env!, 'anchor-delete', {
      displayName: 'Anchor Delete',
      level: 3
    });
    // The onboarding rating initialization is retained history: the anchor delete (and so the Auth delete) is restricted.
    await expect(fixtureSql('delete from auth.users where id = ' + L(actor.id))).rejects.toThrow(
      /violates foreign key/
    );
    expect(await scalar('select count(*)::int from auth.users where id = ' + L(actor.id))).toBe(1);
  });
});
