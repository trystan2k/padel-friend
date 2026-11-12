import { createHash, randomUUID } from 'node:crypto';

// Real PRODUCT-table fixtures for the isolation proof: one proof-owned community in the dev database,
// DUE_EVENT_COUNT due match events (each with the valid Storage photo object the publication trigger
// requires), and one pending result proposal with its version. Schedulers scan these tables, so they
// reproduce the real scan pressure that a private proof schema cannot.
//
// Creation reuses the contracts of test/helpers (match-photo-fixtures / statistics-bulk-history-fixtures):
// photo key `<community>/<event>/<creator>/<uuid>.jpg`, a real Storage API upload (owner = creator,
// image/jpeg metadata, pinned venue-court.jpg as in e2e/matches-management-fixtures.ts) so lock_match_photo_publication never has to be bypassed, and events whose
// registration cutoff already passed. Nothing on the creation path disables a trigger.
//
// Cleanup mirrors the pattern of test/helpers/match-registration-sql.ts (immutable match history is
// removed by disabling its guard triggers around the deletes), tightened for a live database:
//   * ONE transaction: ALTER TABLE ... DISABLE TRIGGER is transactional, and the guarded tables are
//     first locked EXCLUSIVE, so no other session can write while a guard is off.
//     Every DELETE is therefore the only DML on those tables, and every DELETE is keyed by the id lists
//     read inside that same transaction from the proof community (never a table-wide statement).
//   * lock_timeout bounds the wait, so a busy dev database makes cleanup fail (and roll back, which
//     restores the triggers) instead of stalling it.
//   * the captured pre-state of each trigger is restored before COMMIT, and the committed state is
//     compared with the state seen before cleanup (also after a failure).
//   * the community must carry the proof marker name and at most DUE_EVENT_COUNT events, else nothing
//     is deleted.
// Short lock window (normally seconds): concurrent dev reads and writes stall until commit/rollback
// because ALTER TABLE ... DISABLE TRIGGER upgrades to ACCESS EXCLUSIVE.
// Storage bytes are deleted through the API AFTER relational cleanup commits; never delete only their
// metadata, which would orphan the bytes. SQL and API absence are then verified separately.
// Rows no proof-owned id points at are never touched.

export const DUE_EVENT_COUNT = 60;
export const PHOTO_BUCKET = 'match-event-photos';
const LOCK_TIMEOUT = '5s';
const REMOVAL_ATTEMPTS = 3;

export class ProductFixtureError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'ProductFixtureError';
  }
}

// [table, trigger] guards and lifecycle markers suppressed during proof-history removal.
// Markers must not enqueue the global deferred drain, which would consume unrelated dirty rows.
export const GUARD_TRIGGERS = [
  ['match_events', 'match_event_immutable'],
  ['match_event_registrations', 'match_registration_identity_guard'],
  ['match_event_registrations', 'match_registration_final_state'],
  ['match_event_registrations', 'match_result_entry_ready_roster_revision'],
  ['match_event_registration_attempts', 'match_attempt_history_guard'],
  ['match_event_registration_attempts', 'match_attempt_final_state'],
  ['match_event_audit_log', 'match_audit_immutable'],
  ['match_event_result_proposals', 'match_result_proposal_transition_guard'],
  ['match_event_result_proposal_versions', 'match_result_proposal_version_immutable'],
  ['match_events', 'statistics_lifecycle_event_mark'],
  ['match_event_registrations', 'statistics_lifecycle_registration_mark'],
  ['match_event_result_proposals', 'statistics_lifecycle_proposal_mark']
];
const GUARDED_TABLES = [...new Set(GUARD_TRIGGERS.map(([table]) => table))];

// Child tables precede parents. scope: which proof-owned id list keys the delete.
const DELETES = [
  ['notification_result_links', 'match_event_id', 'events'],
  ['match_event_result_entry_ready_dispatch', 'match_event_id', 'events'],
  ['match_result_alert_entry_ready_queue', 'match_event_id', 'events'],
  ['match_result_alert_deadline_queue', 'proposal_id', 'proposals'],
  ['match_result_alert_processing_state', 'candidate_id', 'proposals'],
  ['match_result_alert_retry_fallback', 'candidate_id', 'proposals'],
  ['notifications', 'community_id', 'community'],
  ['notifications', 'recipient_user_id', 'users'],
  ['match_event_audit_log', 'match_event_id', 'events'],
  ['match_event_result_processing_state', 'proposal_id', 'proposals'],
  ['match_event_result_proposal_versions', 'proposal_id', 'proposals'],
  ['match_event_result_proposals', 'id', 'proposals'],
  ['match_event_invites', 'match_event_id', 'events'],
  ['match_event_management_commands', 'match_event_id', 'events'],
  ['match_event_registration_attempts', 'match_event_id', 'events'],
  ['match_event_registrations', 'match_event_id', 'events'],
  ['match_event_registration_state', 'match_event_id', 'events'],
  ['match_events', 'id', 'events']
];
const TAIL_DELETES = [
  ['community_audit_log', 'community_id', 'community'],
  ['communities', 'id', 'community'],
  ['statistics_lifecycle_dirty', 'event_id', 'events']
];
// Proof-keyed tables whose scoped emptiness proves no owned relational rows remain.
const RESIDUE_CHECKS = [...DELETES, ...TAIL_DELETES];

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const names = (id) => ({ communityName: 'isolation_proof_' + id });

/**
 * Inserts the community, its due events with photo objects and one pending proposal, inside the
 * caller's open transaction. Resolves to the identity the caller must record once it commits.
 */
export function productOwnership(id, userIds) {
  if (!/^[0-9a-f]{8}$/.test(id)) throw new ProductFixtureError('invalid proof id');
  const communityId = randomUUID();
  const eventIds = Array.from({ length: DUE_EVENT_COUNT }, () => randomUUID());
  return {
    communityId,
    ...names(id),
    userIds,
    eventIds,
    proposalIds: [randomUUID()],
    photoPaths: eventIds.map(
      (eventId) => communityId + '/' + eventId + '/' + userIds[0] + '/' + randomUUID() + '.jpg'
    ),
    uploadedPhotos: [],
    committed: false
  };
}

export async function insertProductFixtures(db, owned, uploadPhoto) {
  const [creatorId, ...playerIds] = owned.userIds;
  if (playerIds.length !== 3) throw new ProductFixtureError('three teammates are required');
  await db.query(
    "insert into public.communities (id, name, visibility, created_by) values ($1::uuid, $2, 'private', $3::uuid)",
    [owned.communityId, owned.communityName, creatorId]
  );
  for (let index = 0; index < owned.eventIds.length; index += 1) {
    const photo = owned.photoPaths[index];
    // Register before HTTP: ambiguous failures can still have created an object.
    owned.uploadedPhotos.push(photo);
    await uploadPhoto(photo);
    // Service-role upload has no user owner. Match the creator-owned publication contract.
    await db.query(
      'update storage.objects set owner_id = $1::text where bucket_id = $2 and name = $3',
      [creatorId, PHOTO_BUCKET, photo]
    );
    await db.query(
      "insert into public.match_events (id, community_id, created_by, starts_at, timezone, event_type, visibility, team_assignment_mode, venue_name, maps_url, photo_path, registration_cutoff_at) values ($1::uuid, $2::uuid, $3::uuid, now() + interval '10 days', 'UTC', 'friendly', 'community_open', 'POST_MATCH_TEAMS', $4, 'https://maps.google.com/maps/place/isolation-proof', $5, now() - interval '1 minute')",
      [owned.eventIds[index], owned.communityId, creatorId, owned.communityName, photo]
    );
  }
  const due = await db.query(
    'select count(*)::int as n from public.match_event_registration_state s join public.match_events e on e.id = s.match_event_id where e.community_id = $1::uuid and e.registration_cutoff_at <= clock_timestamp() and s.cutoff_processed_at is null',
    [owned.communityId]
  );
  if (Number(due.rows[0].n) !== DUE_EVENT_COUNT)
    throw new ProductFixtureError('product due-event count does not match scan-pressure contract');
  await db.query(
    "insert into public.match_event_result_proposals (id, match_event_id, group_number, status, active_version, review_deadline_at, submitted_by) values ($1::uuid, $2::uuid, 1, 'pending', 1, now() + interval '48 hours', $3::uuid)",
    [owned.proposalIds[0], owned.eventIds[0], creatorId]
  );
  const teams = {
    team_a: [creatorId, playerIds[0]],
    team_b: [playerIds[1], playerIds[2]]
  };
  const sets = [
    { position: 1, team_a_games: 6, team_b_games: 4, completed: true },
    { position: 2, team_a_games: 6, team_b_games: 3, completed: true }
  ];
  await db.query(
    "insert into public.match_event_result_proposal_versions (proposal_id, version, teams, sets, classification, played_at_utc, played_at_local, played_at_offset_seconds, court_label, submitted_by, submitted_at, review_deadline_at) values ($1::uuid, 1, $2::jsonb, $3::jsonb, 'team_a', now(), now() at time zone 'UTC', 0, 'Court 1', $4::uuid, now(), now() + interval '48 hours')",
    [owned.proposalIds[0], JSON.stringify(teams), JSON.stringify(sets), creatorId]
  );
  return owned;
}

/** Immutable identity of the proof's product rows: counts and hashes only, never row values. */
export async function snapshotProduct(db, owned) {
  const community = await db.query(
    'select id::text as id, name, created_by::text as created_by from public.communities where id = $1::uuid',
    [owned.communityId]
  );
  const events = await db.query(
    'select id::text as id, created_by::text as created_by, photo_path from public.match_events where community_id = $1::uuid order by id',
    [owned.communityId]
  );
  const photos = await db.query(
    'select name from storage.objects where bucket_id = $1 and starts_with(name, $2) order by name',
    [PHOTO_BUCKET, owned.communityId + '/']
  );
  const proposals = await db.query(
    'select p.id::text as id, p.match_event_id::text as match_event_id from public.match_event_result_proposals p join public.match_events e on e.id = p.match_event_id where e.community_id = $1::uuid order by p.id',
    [owned.communityId]
  );
  const versions = await db.query(
    'select proposal_id::text as proposal_id, version from public.match_event_result_proposal_versions where proposal_id = any($1::uuid[]) order by proposal_id, version',
    [owned.proposalIds]
  );
  return {
    versionCount: versions.rows.length,
    versionHash: sha256(JSON.stringify(versions.rows)),
    communityPresent:
      community.rows.length === 1 &&
      community.rows[0].name === owned.communityName &&
      community.rows[0].created_by === owned.userIds[0],
    eventCount: events.rows.length,
    eventHash: sha256(JSON.stringify(events.rows)),
    photoCount: photos.rows.length,
    photoHash: sha256(JSON.stringify(photos.rows)),
    proposalCount: proposals.rows.length,
    proposalHash: sha256(JSON.stringify(proposals.rows))
  };
}

/** True when none of the proof's community, events, photo objects or proposals exist in this DB. */
export async function productAbsent(db, owned) {
  const result = await db.query(
    'select (select count(*) from public.communities where id = $1::uuid or name = $2)::int as communities, (select count(*) from public.match_events where community_id = $1::uuid or id = any($5::uuid[]))::int as events, (select count(*) from storage.objects where bucket_id = $3 and starts_with(name, $4))::int as photos, (select count(*) from public.match_event_result_proposals where id = any($6::uuid[]))::int as proposals, (select count(*) from public.match_event_result_proposal_versions where proposal_id = any($6::uuid[]))::int as versions',
    [
      owned.communityId,
      owned.communityName,
      PHOTO_BUCKET,
      owned.communityId + '/',
      owned.eventIds,
      owned.proposalIds
    ]
  );
  const row = result.rows[0];
  return {
    communityAbsent: Number(row.communities) === 0,
    eventsAbsent: Number(row.events) === 0,
    photosAbsent: Number(row.photos) === 0,
    proposalsAbsent: Number(row.proposals) === 0,
    versionsAbsent: Number(row.versions) === 0
  };
}

async function guardRows(db) {
  const predicate = GUARD_TRIGGERS.map(
    (_pair, index) =>
      '(c.relname = $' + (index * 2 + 1) + ' and t.tgname = $' + (index * 2 + 2) + ')'
  ).join(' or ');
  const result = await db.query(
    "select c.relname as table_name, t.tgname as trigger_name, t.tgenabled as enabled from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid = t.tgrelid join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal and (" +
      predicate +
      ') order by 1, 2',
    GUARD_TRIGGERS.flat()
  );
  return result.rows;
}

const guardStates = async (db) =>
  (await guardRows(db)).map((row) => row.table_name + '.' + row.trigger_name + '=' + row.enabled);

function restoreStatement(table, trigger, enabled) {
  const verb = { O: 'enable', A: 'enable always', R: 'enable replica' }[enabled] ?? 'disable';
  return 'alter table public.' + table + ' ' + verb + ' trigger ' + trigger;
}

async function removeOnce(db, owned, expected) {
  let failure;
  await db.query('begin');
  try {
    await db.query("set local lock_timeout = '" + LOCK_TIMEOUT + "'");
    await db.query(
      'lock table ' +
        GUARDED_TABLES.map((table) => 'public.' + table).join(', ') +
        ' in exclusive mode'
    );
    const community = await db.query(
      'select name, created_by::text as created_by from public.communities where id = $1::uuid',
      [owned.communityId]
    );
    if (
      community.rows.length > 0 &&
      (community.rows[0].name !== owned.communityName ||
        community.rows[0].created_by !== owned.userIds[0])
    )
      throw new ProductFixtureError('proof community identity mismatch; nothing was deleted');
    const events = (
      await db.query(
        'select id::text as id from public.match_events where community_id = $1::uuid',
        [owned.communityId]
      )
    ).rows.map((row) => row.id);
    if (events.some((id) => !owned.eventIds.includes(id)))
      throw new ProductFixtureError('proof community owns unexpected events; nothing was deleted');
    const proposals = (
      await db.query(
        'select id::text as id from public.match_event_result_proposals where match_event_id = any($1::uuid[])',
        [events]
      )
    ).rows.map((row) => row.id);
    if (proposals.some((id) => !owned.proposalIds.includes(id)))
      throw new ProductFixtureError('unexpected proof proposal identity; nothing was deleted');
    const scopes = {
      events: owned.eventIds,
      proposals: owned.proposalIds,
      community: [owned.communityId],
      users: owned.userIds
    };

    const captured = await guardRows(db);
    if (
      captured.length !== GUARD_TRIGGERS.length ||
      captured.some((row) => !['O', 'A'].includes(row.enabled))
    )
      throw new ProductFixtureError('expected guard triggers are missing; nothing was deleted');

    // A failure anywhere below aborts the transaction; the rollback restores every trigger.
    for (const [table, trigger] of GUARD_TRIGGERS)
      await db.query('alter table public.' + table + ' disable trigger ' + trigger);
    await db.query(
      'update public.match_event_registrations set current_attempt_id = null where match_event_id = any($1::uuid[])',
      [events]
    );
    for (const [table, column, scope] of DELETES)
      await db.query('delete from public.' + table + ' where ' + column + ' = any($1::uuid[])', [
        scopes[scope]
      ]);
    for (const [table, column, scope] of TAIL_DELETES)
      await db.query('delete from public.' + table + ' where ' + column + ' = any($1::uuid[])', [
        scopes[scope]
      ]);
    // Lifecycle markers stay disabled through the deletes, so no global drain is queued.
    // The final scoped DELETE removes only proof-linked dirty rows; unrelated work stays pending.
    await assertRelationalAbsent(db, owned);
    // Deleting versions queues the deferred active-version FK. Once both sides are gone,
    // flush ONLY that FK before ALTER TABLE (pending events otherwise reject DDL with 55006).
    // Do not flush all constraints: unrelated lifecycle drains must remain untouched.
    await db.query('set constraints public.match_result_proposal_active_version_fk immediate');
    // Re-enable every guard to its captured state before the transaction ends.
    for (const row of captured)
      await db.query(restoreStatement(row.table_name, row.trigger_name, row.enabled));
    await db.query('commit');
  } catch (error) {
    await db.query('rollback').catch(() => undefined);
    failure = error;
  }
  // Separate from finally: verify after either COMMIT or ROLLBACK without concealing failure.
  const after = await guardStates(db);
  if (JSON.stringify(after) !== JSON.stringify(expected))
    throw new ProductFixtureError('guard trigger state differs from before cleanup', {
      cause: failure
    });
  if (failure) throw failure;
}

/**
 * Removes the proof's community, events, photo objects, proposal and derived rows, then proves nothing
 * of it is left and every guard trigger is back in its original state. Retries lock/deadlock timeouts.
 */
export async function removeProductFixtures(
  db,
  owned,
  { sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}
) {
  const expected = await guardStates(db);
  if (
    expected.length !== GUARD_TRIGGERS.length ||
    expected.some((state) => !/[=][OA]$/.test(state))
  )
    throw new ProductFixtureError('expected guard triggers are missing; nothing was deleted');
  for (let attempt = 1; ; attempt += 1) {
    try {
      await removeOnce(db, owned, expected);
      break;
    } catch (error) {
      const retryable = ['55P03', '40P01'].includes(error?.code);
      if (!retryable || attempt >= REMOVAL_ATTEMPTS) throw error;
      await sleep(500 * attempt);
    }
  }
  await assertRelationalAbsent(db, owned);
}

async function assertRelationalAbsent(db, owned) {
  const scopes = {
    events: owned.eventIds,
    proposals: owned.proposalIds,
    community: [owned.communityId],
    users: owned.userIds
  };
  for (const [table, column, scope] of RESIDUE_CHECKS) {
    const result = await db.query(
      'select count(*)::int as n from public.' + table + ' where ' + column + ' = any($1::uuid[])',
      [scopes[scope]]
    );
    if (Number(result.rows[0].n) !== 0)
      throw new ProductFixtureError('proof rows remain after cleanup: ' + table);
  }
}
