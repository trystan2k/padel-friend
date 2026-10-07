# PAF-31 Findings Ledger (PR1 backend)

| id  | severity | location                                                                | title                                                                                                                     | status   | owner                     | iteration |
| --- | -------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------- | --------- |
| F1  | major    | src/features/community/community-admin.functions.ts:29                  | Factory-returned `createServerFn` chains bypass TanStack module-level endpoint extraction                                 | open     | implementation-specialist | 1         |
| F2  | minor    | src/features/community/community-admin.functions.ts:195                 | All `42501` errors become `NOT_COMMUNITY_ADMIN`, masking infrastructure permission failures                               | open     | implementation-specialist | 1         |
| F3  | minor    | src/features/community/community-admin.validators.ts:40                 | `trim()` rejects SQL-valid venue names with edge NBSP/Unicode whitespace                                                  | open     | implementation-specialist | 1         |
| F4  | minor    | test/community.admin.integration.test.ts:179                            | Constant-valued assertions skip persisted status/activation checks                                                        | open     | implementation-specialist | 1         |
| F5  | minor    | test/community.admin.integration.test.ts:45                             | Unconditional `.env` read breaks environment-configured runs                                                              | deferred | deferred                  | 1         |
| F6  | minor    | supabase/migrations/20261007153621_community_governance_members.sql:114 | Venue archive audit indistinguishable from ordinary edit                                                                  | deferred | deferred                  | 1         |
| F7  | minor    | src/lib/supabase/database.types.ts:410                                  | Roster RPC types claim non-null timestamps/ratings despite nullable SQL results                                           | deferred | deferred                  | 1         |
| F8  | minor    | supabase/migrations/20261007153621_community_governance_members.sql:45  | Queued reactivation can overlap the previous membership interval                                                          | deferred | deferred                  | 1         |
| F9  | minor    | src/features/community/community-admin.functions.ts:22                  | Direct membership writes retain reverse lock order; deadlock errors unmapped                                              | deferred | deferred                  | 1         |
| F10 | major    | test/community.admin.functions.test.ts:76                               | Compiled endpoint extraction for the six membership actions remains unverified (deferred to PR2 where routes import them) | deferred | deferred                  | 2         |

## Notes

- F1 is a blocking major (both reviewers): declare six explicit module-level `createServerFn` chains and share an ordinary RPC execution helper; add compiled transport coverage.
- F2–F4 are small fixes applied now (error-mapping precision, validator parity, test assertion strength).
- F5–F9 deferred (test env loader, archive audit detail, roster DTO typing, reactivation chronology, lock-order documentation) → follow-up issue.
- The `.opencode` config commits on the branch (7980674/5aec543) are outside PAF-31 scope.
