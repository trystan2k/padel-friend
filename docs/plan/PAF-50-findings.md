# PAF-50 — Findings Ledger

Single source of truth for the fix loop. Rows are appended, never rewritten, and a row already present is never re-added.
`status`: `open` | `fixed` | `deferred`. `owner`: the agent that fixes it, or `deferred`.
Sources: full review of `8c705c2..5dec5d4` by `code-review-specialist`, `architecture-review-specialist`, `ux-ui-reviewer-specialist`.

| id  | severity | location                                                  | title                                                                                                             | status   | owner                | iteration |
| --- | -------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------- | -------------------- | --------- |
| F1  | minor    | src/components/ui                                         | Global `#locale` select measures 24px at 320px (pre-existing global header UI, outside this epic's admin screens) | deferred | deferred             | 1         |
| F2  | major    | src/features/community/CommunityAdminViews.tsx:1089       | Loader refresh permanently latches audit/venue paging busy state                                                  | fixed    | bug-fixer-specialist | 1         |
| F3  | major    | src/features/community/CommunityAdminViews.tsx:586        | Completed confirmations suppress later valid member actions after reactivation                                    | fixed    | bug-fixer-specialist | 1         |
| F4  | major    | src/routes/__root.tsx:73                                  | Failed locale persistence leaves UI copy and document lang mismatched                                             | fixed    | bug-fixer-specialist | 1         |
| F5  | major    | src/features/community/CommunityAdminViews.tsx:608        | Confirmation restores focus to the wrong trigger (shared ref)                                                     | fixed    | bug-fixer-specialist | 1         |
| F6  | major    | src/features/community/CommunityAdminViews.tsx:669        | Failed-confirmation error rendered outside the open modal subtree                                                 | fixed    | bug-fixer-specialist | 1         |
| F7  | major    | src/features/community/CommunityAdminViews.tsx:485        | Refresh failure after committed mutation allows repeating that mutation                                           | fixed    | bug-fixer-specialist | 1         |
| F8  | minor    | test/community.admin-routes.test.ts:242                   | Route oracle invokes the leaf loader manually instead of navigating                                               | deferred | deferred             | 1         |
| F9  | minor    | e2e/community-onboarding.spec.ts:964                      | Synthetic pixel oracle duplicates comparator math instead of using it                                             | deferred | deferred             | 1         |
| F10 | minor    | src/features/community/CommunityAdminViews.tsx:23         | Views import the shell module, creating circular module ownership                                                 | deferred | deferred             | 1         |
| F11 | minor    | e2e/community-admin.spec.ts:940                           | Locale matrix does not prove admin keyboard reachability                                                          | deferred | deferred             | 1         |
| F12 | minor    | src/features/community/community-onboarding.styles.ts:151 | Floating label references nonexistent token `--line-height-tight`                                                 | fixed    | bug-fixer-specialist | 1         |

## Iteration 1 outcome

- **Fixed (7):** F2, F3, F4, F5, F6, F7, F12 — every one landed with a regression test that failed before the fix and passed after.
- **Deferred (5):** F1, F8, F9, F10, F11 — not fixed in this delivery; handed off as a follow-up issue.
- **Separate QA failure also fixed in this iteration (not a review finding):** `test/community.integration.test.ts` fixture helper modelled an imagined `{"rows": […]}` CLI layout while `supabase` CLI v2 prints a top-level JSON array (and psql command tags for no-row statements); the two guarded tests now pass deterministically (file run ×4, plus the 3-file integration combo = 38/38).
