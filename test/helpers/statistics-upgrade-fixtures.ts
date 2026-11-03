import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { matchPhotoFixture } from './match-photo-fixtures';
import { asRecord } from './match-registration-sql';
import { playedAt } from './ranked-result-fixtures';
import { GOLDEN_SCORES } from './statistics-golden-fixtures';
import { localDatabaseUrl } from './sql-transport';

const DATABASE_NAME = 'statistics_upgrade_test';
const DROP_DATABASE_SQL = 'drop database if exists ' + DATABASE_NAME + ' with (force)';
const MIGRATIONS_DIRECTORY = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));
const FIRST_STATISTICS_MIGRATION = '20261102100000_statistics_domain.sql';
const INSUFFICIENT_PRIVILEGE = '42501';

/** Projection tables compared before/after; updated_at and projected_at are operational bookkeeping. */
export const STATISTICS_PROJECTION_TABLES = [
  'statistics_group_facts',
  'statistics_participant_facts',
  'statistics_pair_facts',
  'statistics_opponent_facts',
  'statistics_scope_summaries',
  'statistics_daily_buckets'
] as const;
const BUSINESS_ROW_SQL = "to_jsonb(t) - 'updated_at' - 'projected_at'";

export type UpgradeSeed = {
  communityId: string;
  players: string[];
  /** One entry per seeded Game Group; the last one is a second quartet of the first event. */
  groups: { proposalId: string; scoreIndex: number }[];
};

export type UpgradeDatabase = {
  client: Client;
  /** Applies the migration files strictly before (or from) the first statistics migration. */
  applyMigrations: (phase: 'pre-statistics' | 'statistics') => Promise<string[]>;
  drop: () => Promise<void>;
};

// The scratch database has no GoTrue/Storage, so only the platform objects the migrations touch exist.
const STUB_PLATFORM_SQL = String.raw`
create schema extensions;
create extension pgcrypto schema extensions;
create schema auth;
create table auth.users(id uuid primary key default gen_random_uuid(), email text, encrypted_password text,
  raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}', email_change text,
  email_change_token_new text, email_change_token_current text, recovery_token text,
  confirmation_token text, created_at timestamptz default now());
create table auth.identities(id uuid primary key default gen_random_uuid(), user_id uuid, provider text, identity_data jsonb);
create table auth.sessions(id uuid primary key default gen_random_uuid(), user_id uuid);
create table auth.one_time_tokens(id uuid primary key default gen_random_uuid(), user_id uuid, token_type text);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), ''))::jsonb $$;
grant usage on schema auth, extensions to anon, authenticated, service_role;
create schema storage;
create table storage.buckets(id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text,
  owner_id text, metadata jsonb, created_at timestamptz default now());
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select string_to_array(name, '/') $$;
grant usage on schema storage to anon, authenticated, service_role;
`;

function migrationFiles(phase: 'pre-statistics' | 'statistics'): string[] {
  return readdirSync(MIGRATIONS_DIRECTORY)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .filter((file) =>
      phase === 'pre-statistics'
        ? file < FIRST_STATISTICS_MIGRATION
        : file >= FIRST_STATISTICS_MIGRATION
    );
}

/**
 * Creates a scratch database on the local Supabase Postgres with minimal auth/storage platform stubs.
 * Returns a skip reason, never a database, when the local instance forbids CREATE DATABASE.
 */
export async function createUpgradeDatabase(): Promise<
  { database: UpgradeDatabase } | { skipReason: string }
> {
  const base = await localDatabaseUrl();
  const scratchUrl = new URL(base);
  scratchUrl.pathname = '/' + DATABASE_NAME;
  const admin = new Client({ connectionString: base });
  await admin.connect();
  try {
    await admin.query(DROP_DATABASE_SQL);
    await admin.query('create database ' + DATABASE_NAME);
  } catch (error) {
    await admin.end();
    if (asRecord(error)['code'] === INSUFFICIENT_PRIVILEGE)
      return { skipReason: 'local Postgres role may not CREATE DATABASE' };
    throw error;
  }
  const client = new Client({ connectionString: scratchUrl.toString() });
  try {
    await client.connect();
    await client.query(STUB_PLATFORM_SQL);
  } catch (error) {
    await client.end().catch(() => undefined);
    await admin.query(DROP_DATABASE_SQL).catch(() => undefined);
    await admin.end();
    throw error;
  }
  return {
    database: {
      client,
      async applyMigrations(phase) {
        const files = migrationFiles(phase);
        for (const file of files) {
          try {
            await client.query(readFileSync(MIGRATIONS_DIRECTORY + file, 'utf8'));
          } catch (error) {
            await client.query('rollback').catch(() => undefined);
            throw new Error('Migration ' + file + ' failed: ' + String(error), { cause: error });
          }
        }
        return files;
      },
      async drop() {
        await client.end().catch(() => undefined);
        try {
          await admin.query(DROP_DATABASE_SQL);
        } finally {
          await admin.end();
        }
      }
    }
  };
}

/**
 * Seeds confirmed history through the PRODUCTION confirmation path: registration, result protection,
 * submit_match_event_result and the opposing-team review_match_event_result approval. Runs against
 * the pre-statistics schema, so no statistics object exists yet. One event per GOLDEN_SCORES entry
 * (Friendly/Competitive, decided/draw/incomplete), plus a second quartet in the first event.
 */
export async function seedConfirmedHistory(client: Client): Promise<UpgradeSeed> {
  const query = (sql: string, values?: unknown[]) => client.query(sql, values);
  const actAs = (userId: string) =>
    query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  const communityId = crypto.randomUUID();
  const players = Array.from({ length: 8 }, () => crypto.randomUUID());
  for (const [index, player] of players.entries()) {
    await query('insert into auth.users(id, email) values ($1, $2)', [
      player,
      'upgrade-' + index + '-' + player + '@test.local'
    ]);
    await query(
      "insert into public.player_profiles(user_id, display_name, preferred_side) values ($1, $2, 'EITHER')",
      [player, 'Upgrade Player ' + (index + 1)]
    );
    await query("select public.initialize_global_player_rating_locked($1, 4.0, 'onboarding')", [
      player
    ]);
  }
  await query(
    "insert into public.communities(id, name, visibility, created_by) values ($1, 'Upgrade', 'public', $2)",
    [communityId, players[0]]
  );
  for (const [index, player] of players.entries())
    await query(
      "insert into public.community_members(community_id, user_id, role, status, valid_from, activated_at) values ($1, $2, $3, 'active', now() - interval '1 day', now() - interval '1 day')",
      [communityId, player, index === 0 ? 'admin' : 'member']
    );

  const groups: UpgradeSeed['groups'] = [];
  const submitAndApprove = async (
    eventId: string,
    groupNumber: number,
    scoreIndex: number,
    secondsAgo: number
  ) => {
    const score = GOLDEN_SCORES[scoreIndex]!;
    const quartet = players.slice((groupNumber - 1) * 4, groupNumber * 4);
    await actAs(players[0]!);
    const submitted = await query(
      "select public.submit_match_event_result($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, 'Court 1', $6) as result",
      [
        eventId,
        groupNumber,
        JSON.stringify({ team_a: quartet.slice(0, 2), team_b: quartet.slice(2) }),
        JSON.stringify(score.sets),
        JSON.stringify(playedAt(secondsAgo).played),
        crypto.randomUUID()
      ]
    );
    const proposalId = String(asRecord(asRecord(submitted.rows[0])['result'])['proposal_id']);
    // The submitter (players[0]) plays group 1, so one opposing approval confirms it. A group the
    // submitter is not part of needs an approval from each team.
    for (const reviewer of groupNumber === 1 ? [quartet[2]!] : [quartet[2]!, quartet[0]!]) {
      await actAs(reviewer);
      await query(
        "select public.review_match_event_result(p_proposal_id => $1, p_expected_version => 1, p_decision => 'approve', p_request_id => $2)",
        [proposalId, crypto.randomUUID()]
      );
    }
    groups.push({ proposalId, scoreIndex });
  };

  for (const [scoreIndex, score] of GOLDEN_SCORES.entries()) {
    const eventId = crypto.randomUUID();
    const photo = matchPhotoFixture(communityId, eventId, players[0]!);
    await query(photo.sql);
    await query(
      "insert into public.match_events(id, community_id, created_by, starts_at, timezone, event_type, visibility, team_assignment_mode, venue_name, maps_url, photo_path, restriction_enabled, min_level, max_level, maximum_registrations, registration_cutoff_at) values ($1, $2, $3, now() + interval '10 days', 'UTC', 'friendly', 'community_open', 'POST_MATCH_TEAMS', 'Upgrade court', 'https://maps.google.com/maps/place/upgrade', $4, false, null, null, null, now() + interval '9 days')",
      [eventId, communityId, players[0], photo.path]
    );
    for (const player of players.slice(1)) {
      await actAs(player);
      await query('select public.submit_match_registration($1)', [eventId]);
    }
    await query('alter table public.match_events disable trigger match_event_immutable');
    await query(
      "update public.match_events set registration_cutoff_at = now() - interval '1 minute', event_type = $2 where id = $1",
      [eventId, score.type]
    );
    await query('alter table public.match_events enable trigger match_event_immutable');
    await query('select public.protect_match_event_results($1)', [eventId]);
    await submitAndApprove(eventId, 1, scoreIndex, 1000 - scoreIndex * 100);
    if (scoreIndex === 0) await submitAndApprove(eventId, 2, scoreIndex, 50);
  }
  return { communityId, players, groups };
}

/** Business projection of every statistics table, ordered and stripped of operational timestamps. */
export async function statisticsSnapshot(client: Client): Promise<Record<string, unknown[]>> {
  const snapshot: Record<string, unknown[]> = {};
  for (const table of STATISTICS_PROJECTION_TABLES) {
    const result = await client.query(
      'select ' +
        BUSINESS_ROW_SQL +
        ' as row from public.' +
        table +
        ' t order by (' +
        BUSINESS_ROW_SQL +
        ')::text'
    );
    snapshot[table] = result.rows.map((row) => row.row as unknown);
  }
  return snapshot;
}
