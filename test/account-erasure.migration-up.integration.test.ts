import { afterAll, describe, expect, it } from 'vitest';
import { asRecord } from './helpers/match-registration-sql';
import {
  createUpgradeDatabase,
  seedConfirmedHistory,
  type UpgradeDatabase
} from './helpers/statistics-upgrade-fixtures';
import { localSupabaseEnv } from './helpers/local-supabase-env';

const environment = localSupabaseEnv();

/**
 * Populated upgrade: the participant-anchor migrations run over history created by the production
 * commands (email sign-up/onboarding, a Google identity, a pre-profile Auth user, confirmed and
 * unconfirmed invitations, a provisional player, confirmed results) in a scratch database.
 */
describe.skipIf(!environment.env)('account erasure populated upgrade', { timeout: 600_000 }, () => {
  let database: UpgradeDatabase | undefined;
  afterAll(async () => {
    await database?.drop();
  });

  it('backfills identities, re-anchors history without moving rows and then erases on upgraded data', async (context) => {
    const created = await createUpgradeDatabase();
    if ('skipReason' in created) {
      console.warn(
        'SKIP account erasure upgrade proof (not counted as proof): ' + created.skipReason
      );
      context.skip(created.skipReason);
      return;
    }
    database = created.database;
    const { client } = database;
    const rows = async (sql: string, values?: unknown[]) =>
      (await client.query(sql, values)).rows.map(asRecord);
    const scalar = async (sql: string, values?: unknown[]) =>
      Object.values((await rows(sql, values))[0]!)[0];

    await database.applyMigrations('pre-account-erasure');
    expect(await scalar("select to_regclass('public.participant_identities')::text")).toBeNull();
    const seed = await seedConfirmedHistory(client);
    const admin = seed.players[0]!;
    const googleUser = seed.players[1]!;
    const subject = seed.players[3]!;

    // Google sign-in, pre-profile Auth user, confirmed + unconfirmed invitations, provisional player.
    await client.query(
      "insert into auth.identities(user_id, provider, identity_data) values ($1, 'google', '{}'::jsonb)",
      [googleUser]
    );
    const preProfile = crypto.randomUUID();
    const invitedUnconfirmed = crypto.randomUUID();
    const provisionalUser = crypto.randomUUID();
    for (const id of [preProfile, invitedUnconfirmed, provisionalUser])
      await client.query('insert into auth.users(id, email) values ($1, $2)', [
        id,
        id + '@upgrade.test'
      ]);
    const hash = (n: string) => n.repeat(64);
    await client.query(
      "insert into public.community_invitations(community_id, invitee_user_id, issued_by, token_hash, expires_at, redeemed_at) values ($1, $2, $3, $4, now() + interval '1 day', now())",
      [seed.communityId, googleUser, admin, hash('a')]
    );
    await client.query(
      "insert into public.community_invitations(community_id, invitee_user_id, issued_by, token_hash, expires_at) values ($1, $2, $3, $4, now() + interval '1 day')",
      [seed.communityId, invitedUnconfirmed, admin, hash('b')]
    );
    const eventId = String(
      (await rows('select id::text from public.match_events order by id limit 1'))[0]!['id']
    );
    await client.query('select public.provision_provisional_player_locked($1, $2, 4.0, $3, $4)', [
      provisionalUser,
      'Upgrade Provisional',
      subject,
      eventId
    ]);

    const edgeTables = [
      'communities',
      'community_members',
      'community_invitations',
      'match_events',
      'match_event_registrations',
      'match_event_registration_attempts',
      'match_event_result_proposals',
      'match_event_result_proposal_versions',
      'match_event_result_reviews',
      'match_event_result_confirmations',
      'player_rating_events',
      'player_rating_initializations',
      'player_profiles',
      'match_event_audit_log'
    ];
    const countAll = async () => {
      const counts: Record<string, number> = {};
      for (const table of edgeTables)
        counts[table] = Number(await scalar('select count(*)::int from public.' + table));
      return counts;
    };
    const before = await countAll();
    const authUsers = Number(await scalar('select count(*)::int from auth.users'));
    expect(before['match_event_result_confirmations']).toBeGreaterThan(0);

    await database.applyMigrations('account-erasure');
    expect(await countAll()).toEqual(before);
    expect(
      Number(
        await scalar("select count(*)::int from public.participant_identities where state = 'live'")
      )
    ).toBe(authUsers);
    expect(
      Number(
        await scalar(
          'select count(*)::int from auth.users u where not exists (select 1 from public.participant_identities i where i.id = u.id)'
        )
      )
    ).toBe(0);
    expect(
      await scalar(
        "select count(*)::int from pg_constraint k where k.contype = 'f' and k.conrelid = 'public.match_event_registrations'::regclass and k.confrelid = 'public.participant_identities'::regclass"
      )
    ).toBe(3);
    // The provisional provenance still validates against the re-anchored FK.
    expect(
      await scalar('select invited_by::text from public.player_profiles where user_id = $1', [
        provisionalUser
      ])
    ).toBe(subject);

    // Erase a confirmed-history player on the upgraded data.
    const plan = asRecord(
      await scalar("select privacy_internal.account_erasure_plan($1, '{}'::jsonb) as plan", [
        subject
      ])
    );
    expect(plan['blockers']).toEqual([]);
    const { blockers: _blockers, ...approved } = plan;
    const result = asRecord(
      await scalar('select privacy_internal.account_erasure_execute($1, $2::jsonb)', [
        subject,
        JSON.stringify(approved)
      ])
    );
    expect(result['tombstone_created']).toBe(true);
    const residue = await rows(
      "select c.relname::text as t from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' " +
        "and (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I t where t::text like %L', c.relname, '%' || $1 || '%'), false, true, '')))[1]::text::int > 0",
      [subject]
    );
    expect(residue).toEqual([]);
    const inviter = String(
      await scalar('select invited_by::text from public.player_profiles where user_id = $1', [
        provisionalUser
      ])
    );
    expect(inviter).not.toBe(subject);
    expect(
      Number(
        await scalar(
          "select count(*)::int from public.participant_identities where id = $1 and state = 'withdrawn'",
          [inviter]
        )
      )
    ).toBe(1);
  });
});
