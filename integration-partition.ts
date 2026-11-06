// Integration files that may run concurrently (2 file workers) against the shared local database.
// Everything not listed here stays in the serial phase, so new files default to serial until audited.
//
// Audit rule for membership: the file (and the helpers it imports, apart from the shared
// fixture-cleanup registry whose trigger DDL only waits on row-level writers) must NOT
//  - disable/enable triggers or alter schema objects in the test body,
//  - touch cron jobs, fixed ports (controlled OAuth provider) or table-wide state,
//  - read/assert global rating or statistics projection revisions, or take the global projection locks,
//  - finalize ranked results (every finalization bumps the global revisions other suites assert on),
//  - need more than the reduced SQL transport pool (SQL_TRANSPORT_POOL_MAX) or dedicated race sessions.
// Rating, statistics, result-correction/amendment/replay, league projection, level-review, cutoff
// scheduler, race, schema/DDL and prune-scoping suites are therefore serial by construction.
export const PARALLEL_INTEGRATION_FILES: readonly string[] = [
  'test/auth.provisional-email.integration.test.ts',
  'test/community.admin-extraction.integration.test.ts',
  'test/community.admin.integration.test.ts',
  'test/community.column-isolation.integration.test.ts',
  'test/community.invitee.integration.test.ts',
  'test/matches.add-player.integration.test.ts',
  'test/matches.add-player.lifecycle.integration.test.ts',
  'test/matches.management.notifications.integration.test.ts',
  'test/matches.management.ownership.integration.test.ts',
  'test/matches.management.visibility.integration.test.ts',
  'test/matches.photo.integration.test.ts',
  'test/matches.provisional.visibility.integration.test.ts',
  'test/matches.publication.integration.test.ts',
  'test/matches.registration.fifo.integration.test.ts',
  'test/matches.results.scoring.integration.test.ts',
  'test/matches.visibility.integration.test.ts',
  'test/notifications.preferences.integration.test.ts',
  'test/notifications.producers.integration.test.ts',
  'test/notifications.store.integration.test.ts',
  'test/notifications.targets.integration.test.ts',
  'test/player.provisional.schema.integration.test.ts',
  'test/provisional.authorization.integration.test.ts'
];

export const INTEGRATION_INCLUDE = 'test/**/*.integration.test.ts';
