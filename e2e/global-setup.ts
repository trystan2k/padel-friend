import {
  FIXTURE_EMAIL_LIKE,
  MATCH_FIXTURE_PRUNE_STATEMENTS,
  runMatchFixturePrune
} from './match-fixture-cleanup';

// The match-event suites share one local database with every integration fixture run, and
// Available is a global limit-20 listing ordered by start time. Integration suites run before
// E2E in the same quality gate and leave dozens of future-dated fixture events behind, which
// would push freshly published events past the first page. This setup runs ONCE before any
// worker starts (no test has published anything yet, so the prune is race-free) and only ever
// runs against the loopback local stack.
//
// The prune is scoped to rows the suites own: every integration and E2E suite signs its
// synthetic actors up through the dedicated `@test.local` email domain, so only match rows
// created by those accounts — or pointing at those accounts or their events — are removed.
// A developer's own local data (any other email address) never matches and always survives.

/** The dedicated email domain every test suite uses for its synthetic actors. */
export { FIXTURE_EMAIL_LIKE, MATCH_FIXTURE_PRUNE_STATEMENTS, runMatchFixturePrune };

/**
 * Trusted-SQL statements that delete exactly the match rows the suites own: events created
 * by a fixture account, plus registrations and invites that belong to those events or point
 * at a fixture account in either direction. The registration-state and attempt rows are
 * removed first because both reference the event/registration identity with ON DELETE
 * RESTRICT. The immutable triggers are bypassed only around the deletes. Exported so the
 * prune-scoping guard test can replay these exact statements inside a rolled-back
 * transaction and prove non-fixture rows survive.
 */
import { assertLocalSupabase } from './match-fixture-cleanup';

export default function globalSetup(): Promise<void> {
  assertLocalSupabase();
  return runMatchFixturePrune();
}
