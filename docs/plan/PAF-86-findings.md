# PAF-86 — Review Findings Ledger

| id | severity | location | title | status | owner | iteration |
| -- | -------- | -------- | ----- | ------ | ----- | --------- |
| F1 | major | test/matches.registration.domain-migration.integration.test.ts:174 | Heavyweight DDL issued after writes upgraded to ACCESS EXCLUSIVE and cycled with registration RPCs | fixed | bug-fixer-specialist | 2 |
| F2 | minor | e2e/community-admin.spec.ts:286 | Successful polled box discarded; second boundingBox read can return transient null | fixed | bug-fixer-specialist | 1 |
| F3 | minor | test/community.invitee.integration.test.ts:115 | Collision actors do not share the target query, so the capped-window regression is weaker than described | deferred | deferred | 1 |
| F4 | minor | test/helpers/match-photo-fixtures.ts:4 | No automated invariant rejects new fixtures that toggle the publication trigger | deferred | deferred | 1 |

## Resolution notes

- **F1**: root cause proven with `pg_class` (relation 18307 = `public.match_event_registrations`) and captured deadlock DETAIL (`RowExclusiveLock` vs `AccessExclusiveLock`). The migration probe's `CREATE TRIGGER` / `ALTER TABLE ... DISABLE TRIGGER` now run as the first statements of its transaction, before any writes, so no lock upgrade can cycle with an RPC. Verified by 3/3 consecutive `pnpm complete-check` runs (all 8 stages, 912/912 tests, 142/142 E2E) with zero `40P01`.
- **F2**: `acquireBox` now keeps and returns the exact sample that satisfied a bounded poll; no second read. E2E admin spec green with `--retries=0`.
- **F3/F4**: deferred — both are test-strength improvements, not defects; PAF-92's determinism is proven by the stability matrix.
