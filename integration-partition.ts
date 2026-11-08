// Integration files that may run concurrently (2 file workers) against the shared local database.
// notification Push outbox/channel-matrix suites are intentionally NOT parallel: global claimants,
// projection publications and fixture DDL require serial execution. New files auto-discovered below.
// Everything not listed here stays in the serial phase, so new files default to serial until audited.
//
// DDL-free rule: a file may only be listed when it is provably free of table-wide DDL. Neither the file
// nor any test helper it imports (transitively) may disable/enable triggers, set session_replication_role
// or alter tables. Shared fixtures that do (provisional-player, match-management, match-add-player,
// match-registration-sql, fixture-cleanup rating evidence cleanup, ...) take table-level locks that deadlock
// (40P01) concurrent workers and can leave a trigger disabled for the other worker. Anything not provably
// DDL-free defaults to serial. test/integration-execution.test.ts enforces the rule with a static import scan.
//
// Further audit rules for membership: the file must NOT
//  - touch cron jobs, fixed ports (controlled OAuth provider) or table-wide state,
//  - read/assert global rating or statistics projection revisions, or take the global projection locks,
//  - finalize ranked results (every finalization bumps the global revisions other suites assert on),
//  - need more than the reduced SQL transport pool (SQL_TRANSPORT_POOL_MAX) or dedicated race sessions.
// Rating, statistics, result-correction/amendment/replay, league projection, level-review, cutoff
// scheduler, race, schema/DDL and prune-scoping suites are therefore serial by construction.
//
// Rollback: INTEGRATION_SERIAL=1 (scripts/run-integration.mjs) runs every file serially in one phase.
export const PARALLEL_INTEGRATION_FILES: readonly string[] = [
  'test/community.admin.integration.test.ts',
  'test/community.admin-extraction.integration.test.ts',
  'test/community.column-isolation.integration.test.ts',
  'test/community.invitee.integration.test.ts',
  'test/matches.photo.integration.test.ts',
  'test/matches.visibility.integration.test.ts',
  'test/notifications.producers.integration.test.ts',
  'test/notifications.targets.integration.test.ts'
];

export const INTEGRATION_INCLUDE = 'test/**/*.integration.test.ts';
