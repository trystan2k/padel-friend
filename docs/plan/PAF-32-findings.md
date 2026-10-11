# PAF-32 Findings Ledger

| id  | severity | location                                                               | title                                                                                                     | status   | owner                     | iteration |
| --- | -------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------- | ------------------------- | --------- |
| F1  | major    | supabase/migrations/20261007153621_community_governance_members.sql:45 | Queued reactivation can overlap the previous closed membership interval                                   | fixed    | implementation-specialist | 1         |
| F2  | minor    | test/community.lifecycle.functions.test.ts:182                         | Timeline pagination covered by mocks, not persisted page continuity                                       | deferred | deferred                  | 1         |
| F3  | minor    | src/features/community/community.functions.ts:173                      | Timeline `next_offset` ceiling conflates truncation with exhaustion                                       | deferred | deferred                  | 1         |
| F4  | minor    | test/community.admin.integration.test.ts:463                           | Queued-chronology test pauses after the closure cutoff, so it doesn't deterministically fail the old code | deferred | deferred                  | 1         |
| F5  | minor    | test/community.admin.integration.test.ts:482                           | Test lock holder can expire across long polling windows                                                   | deferred | deferred                  | 1         |

## Notes

- F1 fixed via forward migration `20261009061318_community_reactivation_interval_order.sql` (`govern_community_member` reactivate branch sets `valid_from >= max(closed valid_until)`; `guard_community_member` active INSERT stamps `activated_at >= valid_from`). Delta reviews confirm F1 fixed, PAF-31 behavior preserved, no regressions.
- F2–F5 deferred (test hardening / bounded-browsing contract) → follow-up issue.
- AC1–2 match/League-fact deferral is an approved amendment, not a finding.
- UX/UI review: no findings.

## Tier 2 follow-up evidence

- F2: Added `paginates persisted timeline history completely and deterministically` in `test/community.integration.test.ts`. Local real-JWT integration passed (14 tests total); fixture-expected order comes from the persisted fixture tuples sorted by community UUID, canonical PostgreSQL-microsecond UTC `valid_from`, then known membership UUID. Traversals cover limits 1 and 2, all communities, one filtered community, decoy actor, and empty actor.
- F3: Added six table-driven ceiling/exhaustion cases in `test/community.lifecycle.functions.test.ts`; lifecycle unit suite passed (16 tests). Existing `truncated: false` exact assertion remains in `test/community.integration.test.ts`.
- F4/F5: Attempted prescribed single-statement marked holder. Marker backend was observed, but the required `FOR UPDATE NOWAIT` proof unexpectedly succeeded (exit 0 and returned the community row), so the holder did not hold the row lock at probe time. No chronology negative control was run; findings remain unresolved pending safe test-harness diagnosis. Do not count the attempted red rewrite as resolved.

### Follow-up after corrected holder plan

- F2: `paginates persisted timeline history completely and deterministically` passes against local Supabase (14/14 integration tests). Expected membership IDs are computed only from fixture tuples, sorted by community UUID, canonical six-digit UTC `valid_from` (preserving PostgreSQL microseconds), and known UUID ID. Full and filtered walks use limits 1 and 2; empty actor walks return no IDs; decoy actor history is excluded.
- F3: Six truncation cases pass in `test/community.lifecycle.functions.test.ts` (16/16 unit tests); exact timeline payload and query behavior remain asserted.
- F4/F5: The single-statement nested-locking-subquery holder form (`select pg_sleep(900) from (select id ... for update) locked`) passes marker detection and the `FOR UPDATE NOWAIT` gate (probe fails with PostgreSQL lock-not-available, code `55P03`). Removal and reactivation queue assertions pass; explicit termination releases the tagged holder. Three consecutive focused runs passed with 200 ms polling; post-run marker query returned zero rows.
- F4 negative control, verbatim result summary: `old transaction-start valid_from behavior → focused queued test FAILED at expectReactivationChronology (replacement.valid_from >= previous.valid_until); fixed migration function restored → focused queued test PASSED.` The local disposable DB was restored by applying the fixed migration function; temporary SQL fixture files were removed.
