# Registration fixture deadlock diagnosis

## Observed failure

Full parallel test runs intermittently reported PostgreSQL `40P01 deadlock detected` in:

- `test/matches.registration.fifo.integration.test.ts`
- Actions/model concurrency tests
- `matches.registration.schema`
- `matches.discovery`

Isolated runs passed. A captured cycle had one backend waiting for
`ShareRowExclusiveLock` on `public.match_events`, while another waited for a
transaction `ShareLock`; a three-process cycle was observed.

## Cause

Fixtures used one long transaction: insert communities and members, disable
`lock_match_photo_publication`, insert match events, then re-enable the trigger.

`ALTER TABLE ... DISABLE/ENABLE TRIGGER` needs `SHARE ROW EXCLUSIVE` on
`public.match_events` and holds it until commit. Concurrent writers can hold
`ROW EXCLUSIVE`/wait on transaction locks on that table, forming a cycle with
the fixture's strong relation lock. The longer fixture transaction widened
the window.

The trigger was toggled only because fixtures supplied fake `photo_path`
values. A real storage object satisfies the publication trigger.

## Abandoned interim approach

An initial fix put `LOCK TABLE public.match_events IN SHARE ROW EXCLUSIVE MODE`
at the start of each fixture transaction. It did not solve the problem: that
strong lock remained held for the entire transaction, and full-suite runs
still deadlocked. The preamble was reverted; it is not the shipped fix.

## Final fix shipped

Added `test/helpers/match-photo-fixtures.ts` with `matchPhotoFixture` and
`matchPhotoPath`. It generates `<community>/<event>/<creator>/<uuid>.webp` and
creates the required `storage.objects` row: bucket `match-event-photos`,
`owner_id` set to the creator, and matching size/MIME-type metadata.

Every fixture that previously toggled the trigger now seeds that valid storage
object before inserting its `match_events` row and uses the generated path.
All `lock_match_photo_publication` disable/enable statements were removed
from `test/` (grep-verified zero remaining). The trigger stays enabled
(`tgenabled = 'O'`).

Two incidental isolation fixes surfaced during the refactor:

- The visibility suite scopes its list query to fixture IDs; the local
  database exceeded PostgREST's 1,000-row default.
- A leftover local reproduction table was dropped from the local database;
  this was not a repository change.

No retries, sleeps, global serialization, worker reduction, `40P01`
suppression, or production SQL changes were made.

## Verification

- Before the fix, 2 of 3 full runs failed: FIFO `40P01`, then actions seed
  cascade.
- 5 of 5 separate paired actions+model runs passed.
- 3 of 3 separate full `pnpm test` runs passed: 912/912 each, 100% coverage,
  and zero `40P01`.
- `pnpm complete-check` passed all 8 stages, including E2E 142/142.

## Rules for future fixtures

- Never toggle `lock_match_photo_publication`; seed a valid storage object
  with `matchPhotoFixture` instead.
- Other `match_events` trigger toggles (creator registration, immutable, or
  notification) require the same strong relation lock and carry the same
  hazard. Prefer avoiding toggles; if unavoidable, keep the transaction as
  short as possible.

## Residual risks

- Some suites still log `close timed out after 2000ms`. This is pre-existing,
  not a retained-backend leak; residue check was clean.
- Local advisory, out of scope: RLS is disabled on
  `public.match_event_registration_attempts` and
  `public.match_event_registration_state`; request security-owner review.

## Residual class: DDL issued after writes (fixed)

After the photo-fixture fix, `pnpm complete-check` was intermittently 1/2–1/3
green. Captured DETAIL:

```text
Process 58644 waits for RowExclusiveLock on relation 18307 of database 5; blocked by process 58694.
Process 58694 waits for AccessExclusiveLock on relation 18307 of database 5; blocked by process 58644.
```

`pg_class` lookup confirmed relation 18307 = `public.match_event_registrations`
and 18266 = `public.match_events`.

Cause: `test/matches.registration.domain-migration.integration.test.ts` issued
`CREATE TRIGGER match_registration_immutable ...` and
`ALTER TABLE ... DISABLE TRIGGER match_event_published_notification` after
inserting `auth.users`, `communities`, `community_members`, and
`match_events`. Upgrading to `ACCESS EXCLUSIVE` while holding row locks formed
the two-way cycle with a concurrent registration RPC.

Fix: both DDL statements are now the first statements of the probe transaction,
before any write. F20/F30 assertions, fixture rows, ordered drop+backfill, and
rollback sentinel are unchanged. Later `DROP TRIGGER` reuses the lock already
held, so it cannot upgrade.

Rule: DDL on a table other suites write must be the FIRST statement of its
transaction; never upgrade a lock mid-transaction after writes.

Verification: 3/3 consecutive `pnpm complete-check` runs passed (all 8 stages,
912/912 unit, 142/142 E2E), with zero `40P01`.

Residual: remaining `ALTER TABLE ... DISABLE/ENABLE TRIGGER` statements
(creator registration, immutable, published notification) still take
`SHARE ROW EXCLUSIVE`. They are short and did not reproduce a deadlock; new
fixtures should prefer avoiding them.
