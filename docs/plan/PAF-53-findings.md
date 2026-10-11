# Findings Ledger — PAF-53 (Tier 1)

Single source of truth for the review fix loop. Append-only.

| id  | severity | location                                                | title                                                                                                    | status   | owner                         | iteration |
| --- | -------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------- | ----------------------------- | --------- |
| F1  | major    | test/lint-staged.test.ts:26                             | Scratch subprocesses inherit Git-local env (GIT_DIR/GIT_INDEX_FILE) and can mutate the parent repo       | fixed    | testing-automation-specialist | 1         |
| F2  | minor    | src/lib/supabase/database.types.ts:456                  | Settings RPC result types nullable columns (city_label/description/logo_path) as non-null                | deferred | deferred                      | 1         |
| F3  | minor    | test/community.column-isolation.integration.test.ts:139 | Anonymous-denial probe reuses a signup client that already holds an authenticated session                | fixed    | testing-automation-specialist | 1         |
| F4  | minor    | docs/security/community-column-isolation.md:36          | Role matrix promises 28000 for unauthenticated direct RPC; anon is rejected with 42501 (EXECUTE revoked) | fixed    | bug-fixer-specialist          | 1         |

## Notes

- F1 raised by BOTH code-review and architecture-review (blocking major).
- F2 deferred: `database.types.ts` is generated; an accurate nullable response type would require a feature-level type without editing generated output — not a trivial fix, no functional impact.
- Baseline reviewed: `af01c33`.
