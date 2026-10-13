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
| F13 | minor    | src/routes/__root.tsx:84                                  | Latest failed locale save leaves a superseded cookie; restore the committed preference                            | deferred | deferred             | 1         |
| F14 | minor    | test/community.integration.test.ts:1879                   | Copilot review: three identical consecutive `serverClient.current` assignments (copy/paste artifact)              | fixed    | bug-fixer-specialist | 2         |
| F15 | minor    | src/features/community/community-admin.styles.ts:62       | Copilot review round 2: `border` shorthand instead of longhands (also line 135)                                   | fixed    | bug-fixer-specialist | 3         |

## Iteration 3 (Copilot review round 2)

- Copilot re-reviewed head `44319a9` and confirmed the round-1 finding as resolved; it reported **0 open findings** but flagged one "previously missed" item from unchanged code (`Low`): `src/features/community/community-admin.styles.ts:62` and `:135` use the `border` **shorthand** while the file (five `borderWidth: 0` sites) and the codebase use **longhands**, and StyleX recommends longhands because shorthand/longhand merges can behave unpredictably. Verified accurate by the orchestrator: those two lines were the only remaining `border:` shorthands in `src/**`.
- Recorded as **F15** and fixed in iteration 3: line 62 → `borderWidth`/`borderStyle`/`borderColor` longhands using the existing tokens; line 135 → `borderWidth: 0` matching the file's own convention. The built CSS asset hash is unchanged and the six 390px screenshots stay under their unchanged budgets (Playwright admin suite 20/20). Fast gate: 60 vitest tests, typecheck, lint, `oxfmt` clean.
- Note: this finding exists only in the review body (no inline comment or thread), so there is no GitHub thread to resolve for it.
- Standing Copilot verdict remains "needs a closer look / human review" because of the new SQL audit migration, the locale-persistence concurrency rewrite and the admin refactor size.

## Iteration 2 (Copilot PR review follow-up)

- Copilot reviewed PR #14 and raised exactly one inline finding (`Low`): three identical consecutive `serverClient.current = invitee.client;` assignments at `test/community.integration.test.ts:1879-1881` — a copy/paste artifact introduced by this epic. Recorded as **F14**, fixed in iteration 2 (single assignment kept; no assertion or behaviour changed), fast gate re-run green (`test/community.integration.test.ts` 18/18, typecheck, lint, oxfmt clean).
- Copilot's review overview otherwise reported no other findings; it flagged the PR as warranting human review because of the new SQL audit migration, the concurrency-sensitive locale persistence rewrite and the size of the admin refactor (its diff view was truncated by the large committed planning bundle).
- No human reviews or human comments exist on PR #14.

## Iteration 1 outcome

- **Fixed (7):** F2, F3, F4, F5, F6, F7, F12 — every one landed with a regression test that failed before the fix and passed after.
- **Deferred (6):** F1, F8, F9, F10, F11, F13 — not fixed in this delivery; handed off as a follow-up issue.
- **Delta re-review (5dec5d4..6f8db58):** `code-review-specialist` and `ux-ui-reviewer-specialist` both report every fixed row as actually fixed, **no regressions** and **no new critical/major findings**. `code-review-specialist` raised the single new minor edge case recorded above as F13 (overlapping locale selections before the first save settles). The `architecture-review-specialist` delta was skipped by design: the fix commit is behaviour-only inside existing seams (no structural/architecture change), and the new module boundaries were already verified in the full architecture review.
- **Separate QA failure also fixed in this iteration (not a review finding):** `test/community.integration.test.ts` fixture helper modelled an imagined `{"rows": […]}` CLI layout while `supabase` CLI v2 prints a top-level JSON array (and psql command tags for no-row statements); the two guarded tests now pass deterministically (file run ×4, plus the 3-file integration combo = 38/38).
