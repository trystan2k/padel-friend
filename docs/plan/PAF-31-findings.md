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

## Follow-up resolution evidence — PAF-42 (2026-10-11)

- F5: extracted the loopback-only environment-first loader into `test/helpers/local-supabase-env.ts`; both integration suites use it. `test/local-supabase-env.test.ts` covers environment-only selection, quoted URL, file fallback/missing file, invalid/remote URL, remote-pair no-fallback, missing/placeholder credentials, and CI fail-closed behavior. Admin actor setup now resides inside its skipped-on-missing-backend suite.
- F6: forward migration `20261011171955_community_venue_archive_audit.sql` replaces only `audit_community_change`, retains its security definer/search_path and revoke, and adds only `{archived: boolean}` for venues. Venue integration assertions distinguish insert/edit from archive and check persisted archive state, hidden listing, denied-write audit stability, and other audit entities.
- F7: feature DTO `src/features/community/community-admin.types.ts` widens only SQL-nullable roster fields; server and UI use it without editing generated types. Null ratings render localized unavailable copy; valid values remain formatted. Unit server/UI fixtures cover null and valid ratings.
- F8: already fixed; preserved without a duplicate migration. `supabase/migrations/20261009061318_community_reactivation_interval_order.sql:18-27,45-57` takes community then membership locks and uses `greatest(clock_timestamp(), max(closed valid_until))`; existing microsecond chronology assertions remain.
- F9: documented canonical order and direct-write reverse-lock risk in `docs/security/community-governance-lock-order.md`; governance helper links to it. SQLSTATE `40P01`/`40001` map to `COMMUNITY_GOVERNANCE_CONFLICT_RETRYABLE`; unit tests exercise both through all six actions, preserve unknown errors, and verify one RPC call.
