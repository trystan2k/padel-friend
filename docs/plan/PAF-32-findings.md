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
