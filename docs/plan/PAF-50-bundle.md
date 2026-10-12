# PAF-50 — Context Bundle (Tier 3: test and UI polish)

Scope: epic **PAF-50 "PAF-2 follow-up — Tier 3: test and UI polish"** delivered end-to-end.
Repository: `/Users/trystan2k/Documents/Thiago/Repos/padel-friend`
Branch: `feature/PAF-50-tier-3-test-and-ui-polish`
Base: `8c705c2258c2099a8a5ce953e52f119b435d1f14` (origin/main)
Head: `6f8db583a0fbfa4b3ddbe3ccaec53338008a771d`
Plan artifact: `docs/plan/Plan PAF-50 PAF-2 follow-up — Tier 3: test and UI polish.md`

## Epic description (verbatim)

Post-PAF-2 hardening follow-ups, Tier 3: test and UI polish. Child tasks: PAF-34, PAF-38, PAF-40, PAF-43.

## Units of work (one Conventional Commit each)

### Unit 1 — PAF-34 "PAF-26 follow-up: deferred review findings (test fixtures, inactive actor, audit detail)"

Commit: `bf0197e071339dc672a9a499cd6f19d248cba7e8` — `test: isolate community fixtures and enrich safe audit evidence`
Files:

- `test/community.integration.test.ts`
- `test/community.admin.integration.test.ts`
- `supabase/migrations/20261012111727_community_audit_changed_fields.sql` (new)
- `docs/plan/Plan PAF-50 PAF-2 follow-up — Tier 3: test and UI polish.md` (plan artifact)
  AC (verbatim): F7 integration suite can run any test by name filter without undefined actors; mutable scenarios isolated · F8 an inactive-only former member is exercised through the privacy/mutation matrix · F9 audit rows identify which fields changed for community and venue updates, without leaking sensitive data · `pnpm complete-check` passes.
  Notes: F9 implemented as a new forward-only migration using `CREATE OR REPLACE` of `public.audit_community_change()`; deterministic `changed_fields` via `IS DISTINCT FROM` on explicit columns, safe before/after transitions only for community visibility/join_policy and venue archived boolean; settings payloads, token hashes and account data still excluded.
  Fast gate (implementer): `pnpm typecheck` pass; `pnpm lint` pass; `pnpm exec vitest run test/community.integration.test.ts test/community.column-isolation.integration.test.ts test/community.admin.integration.test.ts` → 35 tests pass (after updating the stale archive-details assertion in `test/community.admin.integration.test.ts`).

### Unit 2 — PAF-38 "PAF-29 follow-up: expiry-fixture flakiness, plan-doc drift, edge-case join tests"

Commit: `25f14d0e36378dd6a249cd5fe3f106008c1c7d6b` — `test: harden invitation timing and membership edge coverage`
Files:

- `test/community.integration.test.ts`
- `docs/plan/Plan PAF-29 PAF-2.4 — Join flows: public self-join, private invitations, approval handling, edge cases.md`
  AC (verbatim): expired-token fixture timing-robust (no sub-second margin) · PAF-29 plan reflects deferred issuance scope · closed-history rejoin and visibility-flip rejection covered by integration tests · `pnpm complete-check` passes.
  Notes: expired-token fixture now seeds DB-relative expiry (`clock_timestamp() + interval '5 seconds'`) via `executeLocalFixtureSql` returning the stored row, with bounded polling on the returned `expires_at`; CLI JSON result validated with a zod schema (no unsafe casts). **Policy decision (user-approved):** F4's literal "former member self-rejoins → new interval" predates the current PJ008 policy, so coverage asserts denied self-join/private acceptance (`MEMBERSHIP_INACTIVE`) with byte-identical closed history and unconsumed token, plus authorized admin `reactivateCommunityMember` producing a distinct new interval. Recorded in the PAF-29 plan annotation.
  Fast gate (implementer): typecheck, lint pass; 47 tests pass across community integration + join/lifecycle function tests; expiry test repeated 5× pass; `pnpm complete-check` passed on this state (421 unit tests, 53 e2e).

### Unit 3 — PAF-40 "PAF-30 follow-up: SSR locale assertion, visual comparator, search feedback, persistent labels"

Commit: `a2b29950a60ee2d6c32827b322f884ec22cb901e` — `fix: polish community discovery feedback and visual assertions`
Files:

- `e2e/community-onboarding.spec.ts`
- `src/features/community/CommunityOnboarding.tsx`
- `src/features/community/community-onboarding.styles.ts`
- `src/locales/en/translation.json`, `src/locales/es/translation.json`, `src/locales/pt-BR/translation.json`
- `test/community.onboarding.test.tsx`
  AC (verbatim): F6 SSR locale asserted against raw response HTML independently of hydration · F7 visual comparator validates image dimensions · F8 search/retry expose translated pending status + aria-busy · F9 optional-field labels remain visible after entry · F10 masked card content has exact structural probes · `pnpm complete-check` passes.
  Fast gate (implementer): typecheck/lint pass; `vitest test/community.onboarding.test.tsx test/i18n.test.ts` 22 pass; `playwright e2e/community-onboarding.spec.ts` 18 pass on a fresh preview; observed tolerances under unchanged caps (upper-create 7.218%/0.0866, discovery 3.419%/0.047, full-create custom YIQ diagnostic 14.599%/0.1265 with Playwright's own comparison passing unchanged).
  Note for reviewers: the full-create **custom YIQ diagnostic** ratio and the **cap** are different metrics — Playwright's gated comparison passed and no budget was widened; flagging it so the distinction stays visible.

### Unit 4 — PAF-43 "PAF-31 PR2 follow-up: admin UI polish and test hardening"

Commit: `5dec5d422b561e8b679452af20778619bb905867` — `refactor: isolate admin views and harden accessible recovery tests`
Files:

- `e2e/community-admin.spec.ts`
- `src/features/community/CommunityAdmin.tsx`
- `src/features/community/CommunityAdminViews.tsx` (new)
- `src/features/community/community-admin.functions.ts`
- `src/features/community/community-admin.styles.ts`
- `src/features/community/community-admin.types.ts`
- `src/features/community/community-admin.validators.ts`
- `src/routes/__root.tsx`
- `src/routes/_protected.community.$communityId.admin.{audit,members,members.$membershipId,members.index,requests,settings,venues}.tsx` (`members.index.tsx` new)
- `test/community.admin.{functions,routes,ui}.test.ts(x)`
- `test/community.admin-extraction.test.ts`
- `test/root.locale.test.tsx` (new)
  AC (verbatim): F13–F22 addressed as described · `pnpm complete-check` passes.
  Fast gate (implementer/bug-fixer): typecheck/lint pass; 57 unit tests pass across the admin suites; `playwright e2e/community-admin.spec.ts` **20/20 pass** on a fresh build (`CI=1`), including the 18-case 320px × en/pt-BR/es matrix; six 390px screenshot diffs all under unchanged budgets (14815/18500, 11902/15500, 17397/22000, 18616/22500, 16361/21000, 15459/20000) with no baseline PNG change.
  Notable implementation facts:
- F20: six state-owning view components (Requests/Members/Member/Settings/Venues/Audit) in `CommunityAdminViews.tsx`; `CommunityAdmin.tsx` retains only public shell exports; loader-source/generation guards prevent stale search/audit appends.
- F13: Base UI `AlertDialog` confirmation with Cancel-first focus, trap, Escape/Cancel restore, single mutation call, heading fallback when the trigger disappears.
- F14: `CommunityAdminDenied` consumes the router error-component `reset`; generic errors offer localized Retry + dashboard link; `NOT_COMMUNITY_ADMIN` and missing-member get no retry.
- F15: three narrow-screen defects found and fixed responsively (≥44px hit regions; bottom-nav clearance via scroll padding); budgets untouched.
- F17: documented icon `lineHeight: 1` exception (decorative aria-hidden chevron) plus a browser probe for chevron centering and the 44px hit area.
- F18: confidentiality oracle asserts absent sentinels in raw/serialized/DOM payloads for guest, non-admin, pending and outsider actors, with the owner path proving the fixtures exist.
- **Also fixed (real bug surfaced by F15):** `src/routes/__root.tsx` root-level copy did not re-render on language change (the locale/theme labels stayed in the previous language). Now the language change is awaited before root state/document lang update, with `test/root.locale.test.tsx` regression coverage.
- F21: extraction test now awaits a successful `pnpm build` (120s bounded hook) before enumerating `dist/server/assets`, asserts artifact freshness, and fails on a stale/failed build.
- Deferred (out of scope, logged for a follow-up): the global `#locale` select measures 24px at 320px — pre-existing global header UI outside the admin screens.

### Unit 5 — review-fix loop (all four tasks' findings)

Commit: `6f8db583a0fbfa4b3ddbe3ccaec53338008a771d` — `fix: address review findings and harden invitation fixtures`
Files: `src/features/community/CommunityAdminViews.tsx`, `src/features/community/community-onboarding.styles.ts`, `src/routes/__root.tsx`, `test/community.admin-ui.test.tsx`, `test/community.integration.test.ts`, `test/community.onboarding.test.tsx`, `test/root.locale.test.tsx`, `docs/plan/PAF-50-bundle.md`, `docs/plan/PAF-50-findings.md`.

Findings fixed (one commit for the whole loop, per `docs/plan/PAF-50-findings.md`):

- **F2** loader refresh no longer latches audit/venue paging busy state (generation invalidation now resets the pagination-owned pending state).
- **F3** completion state is scoped to membership identity, so a reactivated/replaced member regains valid actions.
- **F4** locale persistence failures keep i18n copy, root state and `document.documentElement.lang` coherent; overlapping selections serialized.
- **F5** the confirmation captures the initiating control and restores focus to it (stable heading fallback when the trigger is gone).
- **F6** failure alert and retry render inside the open dialog's accessible subtree.
- **F7** mutation failure and post-mutation refresh failure are separated: a committed mutation closes the confirmation and cannot be repeated.
- **F12** floating label now uses the existing `--font-line-height-tight` token.
- **QA failure (not a review finding):** the integration fixture helper modelled a `{"rows": […]}` CLI layout while `supabase` CLI v2 prints a top-level JSON array (and psql command tags such as `INSERT 0 9` for statements without `RETURNING`); the helper now normalizes the real shapes with diagnostics that include raw CLI output (never a raw token).

Verification after the loop: 83 vitest tests across the admin/root/onboarding suites; 38 Playwright tests across `community-admin` + `community-onboarding` on a fresh `CI=1` build (18-case 320px matrix, six 390px visual comparisons under unchanged budgets, F17 probe, venue geometry, F18 confidentiality oracle); integration file run 4× deterministic plus the 3-file integration combo 38/38; `pnpm typecheck`, `pnpm lint`, `oxfmt` clean.
Delta re-review (`5dec5d4..6f8db58`) by `code-review-specialist` and `ux-ui-reviewer-specialist`: every fixed row confirmed fixed, no regressions, no new critical/major findings.

## Fast-gate summary

| Unit | Gate                                                                                      |
| ---- | ----------------------------------------------------------------------------------------- |
| 1    | typecheck, lint, 35 integration tests pass                                                |
| 2    | typecheck, lint, 47 tests pass, expiry ×5, `pnpm complete-check` pass (421 unit / 53 e2e) |
| 3    | typecheck, lint, 22 vitest, 18 Playwright pass                                            |
| 4    | typecheck, lint, 57 vitest, 20 Playwright pass (fresh build)                              |

## Full-gate (pnpm complete-check) result

**Run 3 — authoritative, PASS** on head `6f8db58` (`EXIT_CODE=0`, ~3.5 min): build pass · knip pass · typecheck pass · lint pass (`0 warnings, 0 errors`) · format:check pass · **Vitest 42 files / 460 tests pass with coverage 100% statements / 100% branches / 100% functions / 100% lines (thresholds met)** · **Playwright 78 passed, 0 failed / 0 skipped**. `git status --porcelain` empty before and after — the gate modified no tracked file.

Earlier runs (recorded for transparency, both superseded):

- Run 1 — **invalid/short-circuited**: every step through `lint` passed; `format:check` failed only because the two untracked planning docs (this bundle and the findings ledger) were not oxfmt-formatted, so the chain never reached Vitest/Playwright. Both docs were formatted.
- Run 2 — **fail**: build, knip, typecheck, lint and format:check passed; `test` (vitest --coverage) failed with `Test Files 1 failed | 41 passed (42); Tests 2 failed | 451 passed (453)` — both failures were `test/community.integration.test.ts` fixture-shape guards rejecting the local Supabase CLI JSON; `test:e2e` was skipped as a consequence. Root cause and fix are described under Unit 5.

The pre-push hook and CI run this same command, so the push re-validates the identical gate.

## PR size (recommendation)

`git diff --shortstat 8c705c2..6f8db58` → **34 files changed, 10,841 insertions(+), 1,281 deletions(-)**, of which the planning/development-log artifacts are ~6,550 lines (this bundle embeds the diff). Excluding `docs/plan` and `docs/development-logs`: **30 files changed, 4,284 insertions(+), 1,270 deletions(-)**.

This exceeds the ~1500-changed-line soft guideline (file count is within the ~40-file guidance). The four units are logically separable (test hardening / onboarding UI / admin UI+test hardening), so an optional split is possible — reported to the user as a recommendation, not a gate.

## Diff stat (base..head)

```
 docs/plan/PAF-50-bundle.md                         | 6364 ++++++++++++++++++++
 docs/plan/PAF-50-findings.md                       |   26 +
 ... invitations, approval handling, edge cases.md" |   24 +-
 ...-up \342\200\224 Tier 3: test and UI polish.md" |  154 +
 e2e/community-admin.spec.ts                        |  319 +
 e2e/community-onboarding.spec.ts                   |  505 +-
 src/features/community/CommunityAdmin.tsx          | 1015 +---
 src/features/community/CommunityAdminViews.tsx     | 1291 ++++
 src/features/community/CommunityOnboarding.tsx     |  162 +-
 .../community/community-admin.functions.ts         |   14 +-
 src/features/community/community-admin.styles.ts   |   80 +-
 src/features/community/community-admin.types.ts    |   36 +
 .../community/community-admin.validators.ts        |    4 +
 .../community/community-onboarding.styles.ts       |   13 +
 src/locales/en/translation.json                    |    1 +
 src/locales/es/translation.json                    |    1 +
 src/locales/pt-BR/translation.json                 |    1 +
 src/routes/__root.tsx                              |   38 +-
 ...rotected.community.$communityId.admin.audit.tsx |    5 +-
 ...ty.$communityId.admin.members.$membershipId.tsx |   14 +-
 ....community.$communityId.admin.members.index.tsx |   32 +
 ...tected.community.$communityId.admin.members.tsx |   34 +-
 ...ected.community.$communityId.admin.requests.tsx |    4 +-
 ...ected.community.$communityId.admin.settings.tsx |    5 +-
 ...otected.community.$communityId.admin.venues.tsx |    5 +-
 ...261012111727_community_audit_changed_fields.sql |   60 +
 test/community.admin-extraction.test.ts            |   60 +-
 test/community.admin-routes.test.ts                |  351 +-
 test/community.admin-ui.test.tsx                   |  521 +-
 test/community.admin.functions.test.ts             |  107 +-
 test/community.admin.integration.test.ts           |   13 +-
 test/community.integration.test.ts                 |  621 +-
 test/community.onboarding.test.tsx                 |  131 +-
 test/root.locale.test.tsx                          |  111 +
 34 files changed, 10841 insertions(+), 1281 deletions(-)
```

## Full diff (base..head)

````diff
diff --git a/docs/plan/PAF-50-bundle.md b/docs/plan/PAF-50-bundle.md
new file mode 100644
index 0000000..840950c
--- /dev/null
+++ b/docs/plan/PAF-50-bundle.md
@@ -0,0 +1,6364 @@
+# PAF-50 — Context Bundle (Tier 3: test and UI polish)
+
+Scope: epic **PAF-50 "PAF-2 follow-up — Tier 3: test and UI polish"** delivered end-to-end.
+Repository: `/Users/trystan2k/Documents/Thiago/Repos/padel-friend`
+Branch: `feature/PAF-50-tier-3-test-and-ui-polish`
+Base: `8c705c2258c2099a8a5ce953e52f119b435d1f14` (origin/main)
+Head: `5dec5d422b561e8b679452af20778619bb905867`
+Plan artifact: `docs/plan/Plan PAF-50 PAF-2 follow-up — Tier 3: test and UI polish.md`
+
+## Epic description (verbatim)
+
+Post-PAF-2 hardening follow-ups, Tier 3: test and UI polish. Child tasks: PAF-34, PAF-38, PAF-40, PAF-43.
+
+## Units of work (one Conventional Commit each)
+
+### Unit 1 — PAF-34 "PAF-26 follow-up: deferred review findings (test fixtures, inactive actor, audit detail)"
+
+Commit: `bf0197e071339dc672a9a499cd6f19d248cba7e8` — `test: isolate community fixtures and enrich safe audit evidence`
+Files:
+
+- `test/community.integration.test.ts`
+- `test/community.admin.integration.test.ts`
+- `supabase/migrations/20261012111727_community_audit_changed_fields.sql` (new)
+- `docs/plan/Plan PAF-50 PAF-2 follow-up — Tier 3: test and UI polish.md` (plan artifact)
+  AC (verbatim): F7 integration suite can run any test by name filter without undefined actors; mutable scenarios isolated · F8 an inactive-only former member is exercised through the privacy/mutation matrix · F9 audit rows identify which fields changed for community and venue updates, without leaking sensitive data · `pnpm complete-check` passes.
+  Notes: F9 implemented as a new forward-only migration using `CREATE OR REPLACE` of `public.audit_community_change()`; deterministic `changed_fields` via `IS DISTINCT FROM` on explicit columns, safe before/after transitions only for community visibility/join_policy and venue archived boolean; settings payloads, token hashes and account data still excluded.
+  Fast gate (implementer): `pnpm typecheck` pass; `pnpm lint` pass; `pnpm exec vitest run test/community.integration.test.ts test/community.column-isolation.integration.test.ts test/community.admin.integration.test.ts` → 35 tests pass (after updating the stale archive-details assertion in `test/community.admin.integration.test.ts`).
+
+### Unit 2 — PAF-38 "PAF-29 follow-up: expiry-fixture flakiness, plan-doc drift, edge-case join tests"
+
+Commit: `25f14d0e36378dd6a249cd5fe3f106008c1c7d6b` — `test: harden invitation timing and membership edge coverage`
+Files:
+
+- `test/community.integration.test.ts`
+- `docs/plan/Plan PAF-29 PAF-2.4 — Join flows: public self-join, private invitations, approval handling, edge cases.md`
+  AC (verbatim): expired-token fixture timing-robust (no sub-second margin) · PAF-29 plan reflects deferred issuance scope · closed-history rejoin and visibility-flip rejection covered by integration tests · `pnpm complete-check` passes.
+  Notes: expired-token fixture now seeds DB-relative expiry (`clock_timestamp() + interval '5 seconds'`) via `executeLocalFixtureSql` returning the stored row, with bounded polling on the returned `expires_at`; CLI JSON result validated with a zod schema (no unsafe casts). **Policy decision (user-approved):** F4's literal "former member self-rejoins → new interval" predates the current PJ008 policy, so coverage asserts denied self-join/private acceptance (`MEMBERSHIP_INACTIVE`) with byte-identical closed history and unconsumed token, plus authorized admin `reactivateCommunityMember` producing a distinct new interval. Recorded in the PAF-29 plan annotation.
+  Fast gate (implementer): typecheck, lint pass; 47 tests pass across community integration + join/lifecycle function tests; expiry test repeated 5× pass; `pnpm complete-check` passed on this state (421 unit tests, 53 e2e).
+
+### Unit 3 — PAF-40 "PAF-30 follow-up: SSR locale assertion, visual comparator, search feedback, persistent labels"
+
+Commit: `a2b29950a60ee2d6c32827b322f884ec22cb901e` — `fix: polish community discovery feedback and visual assertions`
+Files:
+
+- `e2e/community-onboarding.spec.ts`
+- `src/features/community/CommunityOnboarding.tsx`
+- `src/features/community/community-onboarding.styles.ts`
+- `src/locales/en/translation.json`, `src/locales/es/translation.json`, `src/locales/pt-BR/translation.json`
+- `test/community.onboarding.test.tsx`
+  AC (verbatim): F6 SSR locale asserted against raw response HTML independently of hydration · F7 visual comparator validates image dimensions · F8 search/retry expose translated pending status + aria-busy · F9 optional-field labels remain visible after entry · F10 masked card content has exact structural probes · `pnpm complete-check` passes.
+  Fast gate (implementer): typecheck/lint pass; `vitest test/community.onboarding.test.tsx test/i18n.test.ts` 22 pass; `playwright e2e/community-onboarding.spec.ts` 18 pass on a fresh preview; observed tolerances under unchanged caps (upper-create 7.218%/0.0866, discovery 3.419%/0.047, full-create custom YIQ diagnostic 14.599%/0.1265 with Playwright's own comparison passing unchanged).
+  Note for reviewers: the full-create **custom YIQ diagnostic** ratio and the **cap** are different metrics — Playwright's gated comparison passed and no budget was widened; flagging it so the distinction stays visible.
+
+### Unit 4 — PAF-43 "PAF-31 PR2 follow-up: admin UI polish and test hardening"
+
+Commit: `5dec5d422b561e8b679452af20778619bb905867` — `refactor: isolate admin views and harden accessible recovery tests`
+Files:
+
+- `e2e/community-admin.spec.ts`
+- `src/features/community/CommunityAdmin.tsx`
+- `src/features/community/CommunityAdminViews.tsx` (new)
+- `src/features/community/community-admin.functions.ts`
+- `src/features/community/community-admin.styles.ts`
+- `src/features/community/community-admin.types.ts`
+- `src/features/community/community-admin.validators.ts`
+- `src/routes/__root.tsx`
+- `src/routes/_protected.community.$communityId.admin.{audit,members,members.$membershipId,members.index,requests,settings,venues}.tsx` (`members.index.tsx` new)
+- `test/community.admin.{functions,routes,ui}.test.ts(x)`
+- `test/community.admin-extraction.test.ts`
+- `test/root.locale.test.tsx` (new)
+  AC (verbatim): F13–F22 addressed as described · `pnpm complete-check` passes.
+  Fast gate (implementer/bug-fixer): typecheck/lint pass; 57 unit tests pass across the admin suites; `playwright e2e/community-admin.spec.ts` **20/20 pass** on a fresh build (`CI=1`), including the 18-case 320px × en/pt-BR/es matrix; six 390px screenshot diffs all under unchanged budgets (14815/18500, 11902/15500, 17397/22000, 18616/22500, 16361/21000, 15459/20000) with no baseline PNG change.
+  Notable implementation facts:
+- F20: six state-owning view components (Requests/Members/Member/Settings/Venues/Audit) in `CommunityAdminViews.tsx`; `CommunityAdmin.tsx` retains only public shell exports; loader-source/generation guards prevent stale search/audit appends.
+- F13: Base UI `AlertDialog` confirmation with Cancel-first focus, trap, Escape/Cancel restore, single mutation call, heading fallback when the trigger disappears.
+- F14: `CommunityAdminDenied` consumes the router error-component `reset`; generic errors offer localized Retry + dashboard link; `NOT_COMMUNITY_ADMIN` and missing-member get no retry.
+- F15: three narrow-screen defects found and fixed responsively (≥44px hit regions; bottom-nav clearance via scroll padding); budgets untouched.
+- F17: documented icon `lineHeight: 1` exception (decorative aria-hidden chevron) plus a browser probe for chevron centering and the 44px hit area.
+- F18: confidentiality oracle asserts absent sentinels in raw/serialized/DOM payloads for guest, non-admin, pending and outsider actors, with the owner path proving the fixtures exist.
+- **Also fixed (real bug surfaced by F15):** `src/routes/__root.tsx` root-level copy did not re-render on language change (the locale/theme labels stayed in the previous language). Now the language change is awaited before root state/document lang update, with `test/root.locale.test.tsx` regression coverage.
+- F21: extraction test now awaits a successful `pnpm build` (120s bounded hook) before enumerating `dist/server/assets`, asserts artifact freshness, and fails on a stale/failed build.
+- Deferred (out of scope, logged for a follow-up): the global `#locale` select measures 24px at 320px — pre-existing global header UI outside the admin screens.
+
+## Fast-gate summary
+
+| Unit | Gate                                                                                      |
+| ---- | ----------------------------------------------------------------------------------------- |
+| 1    | typecheck, lint, 35 integration tests pass                                                |
+| 2    | typecheck, lint, 47 tests pass, expiry ×5, `pnpm complete-check` pass (421 unit / 53 e2e) |
+| 3    | typecheck, lint, 22 vitest, 18 Playwright pass                                            |
+| 4    | typecheck, lint, 57 vitest, 20 Playwright pass (fresh build)                              |
+
+## Full-gate (pnpm complete-check) result
+
+PENDING — recorded once the QA gate run for head `5dec5d4` completes; this is the authoritative pre-push gate (the pre-push hook and CI run the same command).
+
+## PR size (recommendation)
+
+`git diff --shortstat 8c705c2..5dec5d4` → **32 files changed, 4031 insertions(+), 1278 deletions(-)**. This exceeds the ~1500-changed-line soft guideline (files count is within the ~40-file guidance). The four units are logically separable (test-hardening, onboarding UI, admin UI/test hardening), so an optional split is possible — noted to the user as a recommendation, not a gate.
+
+## Diff stat (base..head)
+
+```
+ ... invitations, approval handling, edge cases.md" |   24 +-
+ ...-up \342\200\224 Tier 3: test and UI polish.md" |  154 +++
+ e2e/community-admin.spec.ts                        |  319 +++++
+ e2e/community-onboarding.spec.ts                   |  505 +++++++-
+ src/features/community/CommunityAdmin.tsx          | 1015 +---------------
+ src/features/community/CommunityAdminViews.tsx     | 1224 ++++++++++++++++++++
+ src/features/community/CommunityOnboarding.tsx     |  162 +--
+ .../community/community-admin.functions.ts         |   14 +-
+ src/features/community/community-admin.styles.ts   |   80 +-
+ src/features/community/community-admin.types.ts    |   36 +
+ .../community/community-admin.validators.ts        |    4 +
+ .../community/community-onboarding.styles.ts       |   13 +
+ src/locales/en/translation.json                    |    1 +
+ src/locales/es/translation.json                    |    1 +
+ src/locales/pt-BR/translation.json                 |    1 +
+ src/routes/__root.tsx                              |    6 +-
+ ...rotected.community.$communityId.admin.audit.tsx |    5 +-
+ ...ty.$communityId.admin.members.$membershipId.tsx |   14 +-
+ ....community.$communityId.admin.members.index.tsx |   32 +
+ ...tected.community.$communityId.admin.members.tsx |   34 +-
+ ...ected.community.$communityId.admin.requests.tsx |    4 +-
+ ...ected.community.$communityId.admin.settings.tsx |    5 +-
+ ...otected.community.$communityId.admin.venues.tsx |    5 +-
+ ...261012111727_community_audit_changed_fields.sql |   60 +
+ test/community.admin-extraction.test.ts            |   60 +-
+ test/community.admin-routes.test.ts                |  351 +++++-
+ test/community.admin-ui.test.tsx                   |  288 ++++-
+ test/community.admin.functions.test.ts             |  107 +-
+ test/community.admin.integration.test.ts           |   13 +-
+ test/community.integration.test.ts                 |  598 +++++++++-
+ test/community.onboarding.test.tsx                 |  121 +-
+ test/root.locale.test.tsx                          |   53 +
+ 32 files changed, 4031 insertions(+), 1278 deletions(-)
+```
+
+## Full diff (base..head)
+
+```diff
+diff --git "a/docs/plan/Plan PAF-29 PAF-2.4 \342\200\224 Join flows: public self-join, private invitations, approval handling, edge cases.md" "b/docs/plan/Plan PAF-29 PAF-2.4 \342\200\224 Join flows: public self-join, private invitations, approval handling, edge cases.md"
+index 00d9159..461dc76 100644
+--- "a/docs/plan/Plan PAF-29 PAF-2.4 \342\200\224 Join flows: public self-join, private invitations, approval handling, edge cases.md"
++++ "b/docs/plan/Plan PAF-29 PAF-2.4 \342\200\224 Join flows: public self-join, private invitations, approval handling, edge cases.md"
+@@ -1,19 +1,21 @@
+ ## Task Analysis
+
+-- Main objective: Plan **PAF-29 — PAF-2.4 — Join flows: public self-join, private invitations, approval handling, edge cases**. Public authenticated self-join creates active or pending membership according to `join_policy`; private acceptance requires **both** authenticated `invitee_user_id` match and possession of a valid, unexpired, unused raw token, then consumes it. Reject duplicate, unknown, expired, redeemed, revoked, wrong-invitee and guest attempts with stable states. Planning only; one final commit on `feature/PAF-29-join-flows`, stacked on `origin/feature/PAF-28-public-community-discovery` at `db0078e`; PR targets **PAF-28, not main**. No issue identifier in commit/PR text.
++> **Delivery-scope reconciliation (historical plan):** Invitation issuance was deferred from PAF-29 to PAF-31 and delivered in `community-admin.functions.ts`, not `community.functions.ts`. PAF-29 delivered join/accept flows, validators, RPCs, and tests; issuance requirements below are historical scope, not outstanding implementation instructions. The original self-rejoin expectation is superseded by the membership lifecycle policy: self-join and private acceptance for a former member are denied (`MEMBERSHIP_INACTIVE`) without changing closed history or consuming an invitation; authorized admin reactivation creates a new interval. No automatic reactivation or policy/migration change is intended.
++
++- Main objective: Plan **PAF-29 — PAF-2.4 — Join flows: public self-join, private invitations, approval handling, edge cases**. Public authenticated self-join creates active or pending membership according to `join_policy`; private acceptance requires **both** authenticated `invitee_user_id` match and possession of a valid, unexpired, unused raw token, then consumes it. Reject duplicate, unknown, expired, redeemed, revoked, wrong-invitee and guest attempts with stable states. Planning only; one final commit on `feature/PAF-29-join-flows`, stacked on `origin/feature/PAF-28-public-community-discovery` at `db0078e`; PR targets **PAF-28, not main**. No issue identifier in commit/PR text. Historical successful self-rejoin prose is superseded by denied rejoin plus authorized reactivation under current lifecycle policy.
+ - Identified dependencies: PAF-26's `supabase/migrations/20261002055953_community_domain.sql` defines `community_members` (active/pending/inactive, activation/history trigger, `community_members_open` partial unique index), `community_invitations` (`token_hash` 64 lowercase hex, expiry/redeem/revoke, `community_invitations_open`), invitation guard permitting **first** NULL→timestamp redemption but preventing reopening, audit triggers, `is_community_member`/`is_community_admin` requiring active status, RLS/grants. Non-admin INSERT into members fails `membership admin insert`; authenticated clients cannot UPDATE `redeemed_at`. PAF-27's `20261002105936_community_join_policy.sql` supplies `instant|admin_approval`; PAF-28 discovery remains public-only. `src/features/community/{community.functions,community.validators}.ts` uses TanStack `createServerFn`, strict validator, `requireAuthenticatedClient()` (`getClaims()`, `UNAUTHENTICATED`, private/no-store), typed Supabase RPC; `src/lib/supabase/database.types.ts` is PAF-33-generated. Tests: `test/community.functions.test.ts`, `test/community.discovery.functions.test.ts`, `test/community.integration.test.ts` with real-JWT actors, loopback-only env, CI fail-closed guard. `package.json` owns DB/type/QA scripts. No separate join-request table exists or is needed: **pending `community_members` rows are admin-visible requests** through `membership read` RLS.
+-- System impact: One additive imperative migration with two narrow privileged join RPCs, admin invitation issuance through existing RLS, two POST server functions plus issuance function, validators, generated RPC types, mocked and local real-JWT tests. No route/UI/email delivery, new package, schema-table change, approval/denial, member removal/reactivation, match access, coverage-threshold change, or modification to applied migrations. A reusable invitee-bound authorized link carries the same single-use token; **not** an unrestricted anyone-with-link invite. Existing `community_invitations_open` still treats expired/unrevoked invitations as open; explicit admin revocation precedes reissue (automatic cleanup out of scope). No direct public SELECT privacy claim beyond PAF-28's server payload contract.
++- System impact (historical plan; issuance deferred to PAF-31): One additive imperative migration with two narrow privileged join RPCs, join/accept server functions, validators, generated RPC types, mocked and local real-JWT tests. Invitation issuance was delivered under PAF-31 in `src/features/community/community-admin.functions.ts`, not `community.functions.ts`; issuance is not outstanding PAF-29 scope. No route/UI/email delivery, new package, schema-table change, match access, coverage-threshold change, or modification to applied migrations. The historical invitee-bound token was not an unrestricted anyone-with-link invite. No direct public SELECT privacy claim beyond PAF-28's server payload contract.
+
+ ## Chosen Approach
+
+-- Proposed solution: **A (chosen)**: two `SECURITY DEFINER` SQL RPCs only for operations blocked by RLS; keep Admin invitation creation as an ordinary RLS-protected INSERT from a small server function. `join_public_community(p_community_id uuid)` derives identity solely from `auth.uid()`, rejects null or JWT `is_anonymous=true` (`28000`), locks/selects existing public community, resolves `join_policy`, inserts `role='member'` and `status='active'|'pending'`, returns only `{ community_id, status }`; both active and pending open rows are duplicates. `accept_community_invitation(p_token text)` performs the same auth check, validates canonical raw format, computes **`encode(extensions.digest(p_token, 'sha256'), 'hex')`** (fully qualify `pg_catalog.encode` in SQL), looks up `token_hash` under `FOR UPDATE`, requires `invitee_user_id=auth.uid()`, then checks redeemed/revoked/expiry, confirms target remains private, inserts active/pending membership, updates `redeemed_at` exactly once and returns `{ community_id, status }`; all in the _one RPC transaction_. Hash the ASCII bytes of a lowercase **64-hex-character 32-byte random token**, not the decoded hex bytes; issuance uses Worker-compatible `crypto.getRandomValues(new Uint8Array(32))`, lowercase hex encoding and `crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawToken))` to INSERT only 64-hex `token_hash`. Return raw token to authorized Admin once, never persist/log it or send it in query parameters from server code. Issue function accepts `{ community_id, invitee_user_id }`, verifies Admin/private community and inserts `{ community_id, invitee_user_id, token_hash, expires_at }` through existing invitation RLS, with a server-selected seven-day expiry; `issued_by` comes from DB default. Actual link composition/delivery is PAF-2.5 UI scope. Use no service role.
++- Proposed solution: **A (chosen; issuance details are historical/deferred to PAF-31)**: two `SECURITY DEFINER` SQL RPCs only for operations blocked by RLS; historical Admin invitation creation used ordinary RLS-protected INSERT, delivered under PAF-31 in `community-admin.functions.ts`. Join and acceptance behavior remains as described below. Historical issuance generated/hash-stored a random token and returned it once to authorized Admin; it is not active PAF-29 work. Actual link composition/delivery is PAF-2.5 UI scope. Use no service role.
+ - Justification for simplicity: **B** adding new self-insert/RLS and invitation UPDATE policies permits forged status or redemption and does not make membership + token consumption atomic; reject. **C** generic invitation service/table or all-in-one RPC for issuing, joining and approving grows privilege surface and conflates PAF-2.6; reject. Two targeted definer functions + existing Admin grants isolate exactly the forbidden operations. Existing pending row, admin read policy and audit triggers already provide request visibility and transition history; no queue/table needed. Brainstormed threats: stolen raw token without invitee JWT, signed-in anonymous role, invalid/oversize input, leaked private ID, expiry while waiting on lock, concurrent redemption, duplicate membership race, community visibility/policy flip, inactive history, reissue after expiration, trigger rollback and plaintext token exposure.
+ - Components to be modified/created (**exact seven-file implementation delta including this plan**):
+   - **NEW** `supabase/migrations/<CLI-generated-timestamp>_community_join_flows.sql` — two auth-checked definer RPCs, atomic row lock/member INSERT/redemption, custom SQLSTATEs, explicit EXECUTE revokes/grants; check/enable `pgcrypto` in `extensions` only if absent on clean local schema. Never edit PAF-26/27 migrations.
+   - **CHANGED/generated** `src/lib/supabase/database.types.ts` — `pnpm db:types` adds signatures/results of both RPCs; no hand edits, retain PAF-33 scoped oxfmt convention.
+-  - **CHANGED** `src/features/community/community.validators.ts` — strict UUID and canonical raw-token validation, issue-invite input, exported typed result shape as needed; reuse `INVALID_COMMUNITY_INPUT`, `objectWithKeys`/`pgText` semantics, never accept caller-supplied user ID on join/accept.
+-  - **CHANGED** `src/features/community/community.functions.ts` — POST `joinCommunity`, `acceptInvitation`, `issueInvitation`, `requireAuthenticatedClient()`, typed RPC calls, Admin RLS insertion/one-time raw-token response, only exact DB-error mappings; leave discovery/create/settings intact.
+-  - **NEW** `test/community.join.functions.test.ts` — existing mocked TanStack builder/real-validator/claims/client style, stable-code/auth/argument/issuer hashing tests.
++  - **CHANGED** `src/features/community/community.validators.ts` — historical PAF-29 scope: strict UUID and canonical raw-token validation for join/accept; issuance validator was delivered under PAF-31.
++  - **CHANGED** `src/features/community/community.functions.ts` — historical PAF-29 scope: POST `joinCommunity`, `acceptInvitation`, typed RPC calls and exact DB-error mappings; leave discovery/create/settings intact. Issuance is not in this module: PAF-31 delivered it in `src/features/community/community-admin.functions.ts`.
++  - **NEW** `test/community.join.functions.test.ts` — existing mocked TanStack builder/real-validator/claims/client style and join/accept tests; issuance/hash tests named in the original PAF-29 file list were deferred to and delivered under PAF-31.
+   - **CHANGED** `test/community.integration.test.ts` — independent local real-JWT join fixtures/tests; retain current suite and loopback/CI guard; avoid relying on later admin-demotion/invitation-revocation fixtures.
+   - **NEW** `docs/plan/Plan PAF-29 PAF-2.4 — Join flows: public self-join, private invitations, approval handling, edge cases.md` — this plan. No CI/package/config/route/locales files expected.
+
+@@ -21,13 +23,13 @@
+
+ 1. **Preflight and migration dependency check.** Confirm checked-out stack/clean tree, PAF-28 base `db0078e`, seven-file gate and local-only Supabase. Inspect current `pg_extension` namespace and `pg_proc` for `digest(bytea,text)` / `digest(text,text)` on a fresh local `pnpm db:start`/`pnpm db:reset`; repo migrations/config do **not** establish `pgcrypto` availability, so do not claim it already exists. Prefer `extensions.digest(text,text)` if present. If absent, add `CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions` to the **new** migration and verify `extensions.digest` actually resolves after fresh reset; if installed in another schema, do not silently move it—use its observed qualified schema or pause if environments differ. Confirm direct nonadmin member INSERT and redeem UPDATE remain denied, Admin can SELECT pending rows, and trigger accepts first redemption. Read CLI `migration new --help`, create CLI-timestamped migration; never guess filename or run hosted `db push`. Check upstream current Supabase/CLI docs/changelog before implementation if external research is permitted; this planning pass did not run SQL or web research.
+ 2. **Specify database contract and errors.** Both `public.*` functions: `LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''`, fully qualify `auth.uid`, `auth.jwt`, `pg_catalog.*`, `public.*`, `extensions.digest`; `REVOKE ALL ... FROM PUBLIC, anon, authenticated`, `GRANT EXECUTE ... TO authenticated` with exact signatures. Explicit null/signed-in-anonymous rejection in function (`28000`). `join_public_community(uuid)` checks public visibility **without exposing private vs nonexistent** (`PJ007` → `COMMUNITY_NOT_PUBLIC`), reads join policy under `FOR SHARE` to serialize policy/visibility changes, checks existing open member, inserts fixed `member` role and mapped status, returns single row `RETURNS TABLE(community_id uuid,status public.community_membership_status)`; admin never becomes duplicate member. `accept_community_invitation(text)` validates canonical 64 lower-hex raw token (otherwise `PJ001`), queries unique hash `FOR UPDATE`, checks **wrong invitee before lifecycle** (`PJ005`), then already redeemed (`PJ003`), revoked (`PJ004`), expiry `expires_at <= clock_timestamp()` (`PJ002`), target private (`PJ007`, same public/missing classification), and existing open membership (`PJ006`). Use a captured `clock_timestamp()` **after lock acquisition** as validity/redemption time; compare strictly (`expires_at > captured time`); verify CHECK `redeemed_at <= expires_at` and PAF-26 guard. Acquire invitation lock before community `FOR SHARE`, then membership INSERT, then UPDATE invitation `redeemed_at`; failed member INSERT rolls back entire transaction and leaves token unconsumed. Explicit duplicate precheck gives `PJ006`; wrap only member INSERT in SQL `unique_violation` handler, inspect `GET STACKED DIAGNOSTICS ... CONSTRAINT_NAME`, translate **only** `community_members_open` (`23505`) to `PJ006` for concurrent attempts; rethrow unrelated unique errors. Return one row only, no token/hash or private metadata on failure. Preserve `is_community_member`/admin active-only helpers and invitation column grants; do **not** add self INSERT or client redemption UPDATE policy. Database can still allow Admin membership inserts by design. If desired, deny direct RPC calls by anonymous signed-in role via the explicit JWT check even though it uses Postgres `authenticated` role.
+-3. **Build validated server boundary.** `validateJoinCommunity({community_id})`, `validateAcceptInvitation({token})`, `validateIssueInvitation({community_id,invitee_user_id})`: exact allowlists, string UUID format reused from existing validator, raw token `^[0-9a-f]{64}$`, no null/unknown keys/identity override; invalid input yields `INVALID_COMMUNITY_INPUT` before DB. For acceptance, preserve DB's `INVITATION_INVALID` for _unknown but well-formed_ tokens; malformed tokens are input errors at server boundary and `PJ001` in direct RPC. POST handlers call `requireAuthenticatedClient()` before RPC/insert and return `{community_id,status}` for join/accept from typed `.rpc(...).single()` (assert shape/one row; unexpected empty result is DB failure, not success). Map only exact codes: `28000`→`UNAUTHENTICATED`; `PJ001`→`INVITATION_INVALID`; `PJ002`→`INVITATION_EXPIRED`; `PJ003`→`INVITATION_USED`; `PJ004`→`INVITATION_REVOKED`; `PJ005`→`INVITATION_NOT_FOR_USER`; `PJ006`→`ALREADY_MEMBER_OR_PENDING`; `PJ007`→`COMMUNITY_NOT_ELIGIBLE` (public join: non-public/absent; accept: non-private/absent). Preserve unexpected DB failures, never map all `23505` or `42501` to duplicate/auth. Issue handler checks private/Admin with existing `is_community_admin` plus community visibility read; Admin INSERT RLS is final authority, return `{token,expires_at}` once, never hash in response or raw in DB; map only the known invitation-open unique constraint to `INVITATION_ALREADY_OPEN`, otherwise propagate. Expired-but-open reissue requires Admin revoke first under existing grants (UI deferred); no broad RLS relaxation.
++3. **Build validated server boundary.** `validateJoinCommunity({community_id})`, `validateAcceptInvitation({token})`: exact allowlists, string UUID format reused from existing validator, raw token `^[0-9a-f]{64}$`, no null/unknown keys/identity override; invalid input yields `INVALID_COMMUNITY_INPUT` before DB. For acceptance, preserve DB's `INVITATION_INVALID` for _unknown but well-formed_ tokens; malformed tokens are input errors at server boundary and `PJ001` in direct RPC. POST handlers call `requireAuthenticatedClient()` before RPC and return `{community_id,status}` from typed `.rpc(...).single()` (assert shape/one row; unexpected empty result is DB failure, not success). Map only exact codes: `28000`→`UNAUTHENTICATED`; `PJ001`→`INVITATION_INVALID`; `PJ002`→`INVITATION_EXPIRED`; `PJ003`→`INVITATION_USED`; `PJ004`→`INVITATION_REVOKED`; `PJ005`→`INVITATION_NOT_FOR_USER`; `PJ006`→`ALREADY_MEMBER_OR_PENDING`; `PJ007`→`COMMUNITY_NOT_ELIGIBLE` (public join: non-public/absent; accept: non-private/absent). Preserve unexpected DB failures, never map all `23505` or `42501` to duplicate/auth. **Historical/deferred issuance clause (delivered by PAF-31 in `community-admin.functions.ts`):** original issue handler checked private/Admin access, inserted only token hashes under RLS, returned raw token once, and mapped duplicate-open errors; this is not active PAF-29 implementation work.
+ 4. **Replay migration and regenerate types.** Reset disposable local DB, assert extension function resolves with explicit schema, SQLSTATEs/EXECUTE grants via JWT RPC probes, first redemption and audit triggers. Run `pnpm db:types` **after** successful reset; inspect the two `public.Functions` Args/Returns, confirm `.single()` shape is typed and output remains PAF-33-formatted. Regenerate twice without further schema changes; compare byte-for-byte. Its shell redirection may truncate generated file if generation fails: restore that file to branch version and retry only after local DB is healthy. No manual edits or drift in unrelated generated types. If SQL return-shape generation differs, adjust `RETURNS TABLE`/consumer based on actual generated types, not unsafe casts.
+-5. **Mocked boundary tests.** Use existing Vitest builder + `getServerClient`/`setResponseHeader` mocks in new `test/community.join.functions.test.ts`. Check validator rejection before auth/client; missing/expired claims → `UNAUTHENTICATED` and no RPC; exact POST RPC names/arguments with no caller-supplied role/user; status/result of both policies; table-driven precise error mapping including distinct invalid/expired/used/revoked/wrong-invitee/duplicate and unknown-code passthrough. Test issue function generates 32-byte nonconstant raw hex, inserts only matching WebCrypto SHA-256 hash as Admin, uses server expiry, never sends raw to table, handles nonadmin/duplicate-open/private check; no service-role calls. Check private/no-store headers. No test logs raw tokens.
+-6. **Real-JWT integration and RLS matrix.** Extend existing loopback-only `test/community.integration.test.ts` with _independent_ Admin, two invitees and outsider plus anon (fresh communities or tests before fixture mutation). Seed public instant/public admin-approval/private instant/private admin-approval through existing creator RPC; issue bound invitations through new server function; use its raw token for accepting user. For every flow run server function with `serverClient.current` set to actor JWT and assert own membership and Admin roster: role member, active `activated_at` set vs pending `activated_at=null`, `valid_until=null`; pending visible to Admin as join request, not a separate table. Probe pending private member for zero `communities`, `community_venues`, admin audit, `is_community_member=false`, `can_read_community=false`, `is_community_admin=false`; own pending row visible. For public pending, public basic discovery may remain visible, but member-only venue/admin rights stay denied. Assert wrong invitee with stolen valid raw token (`INVITATION_NOT_FOR_USER`) leaves unconsumed; correct invitee then accepts; reused token → `INVITATION_USED`, newly generated valid token with expired timestamp (seed hash via Admin RLS INSERT or controlled short expiry + bounded wait; no future-clock trick) → `INVITATION_EXPIRED`; unknown well-formed token → `INVITATION_INVALID`; revoked → `INVITATION_REVOKED`; duplicate active/pending join/accept → `ALREADY_MEMBER_OR_PENDING` with invitation still unconsumed; public join on private/missing → same non-eligible code; private invite becomes ineligible if visibility flips. Prove simultaneous same-token accepts yield exactly one success, one `INVITATION_USED`, one membership, one redemption/audit; simultaneous public joins yield one success and one duplicate, no second open row. Direct nonadmin INSERT into members and direct redeemed_at UPDATE remain denied; anonymous server join/accept/issue throws `UNAUTHENTICATED`, anon direct RPC gets `42501`, anon owns no new member row. Signed-in Supabase anonymous-user JWT (if enabled in a separate local fixture) must fail SQL `28000`; do not weaken DB check because current `supabase/config.toml` does not enable anonymous sign-ins. Inactive history stays immutable and may receive a _new_ join interval when no open row; do not implement removal/reactivation transitions. Preserve existing integration suite ordering and CI fail-closed guard; no service-role fixtures.
++5. **Mocked boundary tests.** Use existing Vitest builder + `getServerClient`/`setResponseHeader` mocks in new `test/community.join.functions.test.ts`. Check validator rejection before auth/client; missing/expired claims → `UNAUTHENTICATED` and no RPC; exact POST RPC names/arguments with no caller-supplied role/user; status/result of both policies; table-driven precise error mapping including distinct invalid/expired/used/revoked/wrong-invitee/duplicate and unknown-code passthrough. **Historical/deferred issuance tests (delivered under PAF-31 in `community-admin.functions.ts`):** token generation/hash-only insertion/expiry/admin checks are not active PAF-29 requirements. Check private/no-store headers. No test logs raw tokens.
++6. **Real-JWT integration and RLS matrix.** Extend existing loopback-only `test/community.integration.test.ts` with _independent_ Admin, two invitees and outsider plus anon (fresh communities or tests before fixture mutation). Seed public instant/public admin-approval/private instant/private admin-approval through existing creator RPC. Historical issuance through a new server function was deferred to PAF-31 and delivered in community-admin.functions.ts; use valid bound tokens when testing acceptance. For every flow run server function with `serverClient.current` set to actor JWT and assert own membership and Admin roster: role member, active `activated_at` set vs pending `activated_at=null`, `valid_until=null`; pending visible to Admin as join request, not a separate table. Probe pending private member for zero `communities`, `community_venues`, admin audit, `is_community_member=false`, `can_read_community=false`, `is_community_admin=false`; own pending row visible. For public pending, public basic discovery may remain visible, but member-only venue/admin rights stay denied. Assert wrong invitee with stolen valid raw token (`INVITATION_NOT_FOR_USER`) leaves unconsumed; correct invitee then accepts; reused token → `INVITATION_USED`, newly generated valid token with expired timestamp (seed hash via Admin RLS INSERT or controlled short expiry + bounded wait; no future-clock trick) → `INVITATION_EXPIRED`; unknown well-formed token → `INVITATION_INVALID`; revoked → `INVITATION_REVOKED`; duplicate active/pending join/accept → `ALREADY_MEMBER_OR_PENDING` with invitation still unconsumed; public join on private/missing → same non-eligible code; private invite becomes ineligible if visibility flips. Prove simultaneous same-token accepts yield exactly one success, one `INVITATION_USED`, one membership, one redemption/audit; simultaneous public joins yield one success and one duplicate, no second open row. Direct nonadmin INSERT into members and direct redeemed_at UPDATE remain denied; anonymous server join/accept throws `UNAUTHENTICATED` (historical issuance auth test was delivered under PAF-31), anon direct RPC gets `42501`, anon owns no new member row. Signed-in Supabase anonymous-user JWT (if enabled in a separate local fixture) must fail SQL `28000`; do not weaken DB check because current `supabase/config.toml` does not enable anonymous sign-ins. Inactive history stays immutable and may receive a _new_ join interval when no open row; do not implement removal/reactivation transitions. Preserve existing integration suite ordering and CI fail-closed guard; no service-role fixtures.
+ 7. **Run gates, measure, hand off.** Set local loopback API URL/publishable key using `.github/workflows/ci.yml` pattern; confirm integration **ran**, not skipped. Run `pnpm db:start`, `pnpm db:reset`, `pnpm db:types` as above, focused `pnpm exec vitest run test/community.join.functions.test.ts test/community.integration.test.ts`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, then `pnpm complete-check` (build, knip, typecheck, lint, format, coverage and E2E). Do not change thresholds, auto-fix in CI, package versions, or hosted data. Estimate **~600–790 added/deleted lines, seven files**: migration ~105–145, generated types ~8–20, validators ~25–40, functions ~65–90, mocked tests ~100–125, integration ~230–290, plan ~60–80; **unmeasured**, upper edge close to 800. Inspect actual `added + deleted` and file count against **PAF-28 branch**, including plan and generated file; if >800/20, consolidate independent fixture/test repetition, never drop security probes; request gate exception or split only with user approval. One final Conventional Commit, no issue identifier in commit/PR text; PR base PAF-28. Rollback: before merge fix only new migration and rerun clean reset/types/tests; after deploy use corrective forward migration, never rewrite historical migrations. If extension namespace differs or atomic/RLS probes fail, stop release and repair boundary, not test expectations.
+
+ ## Validation
+
+-- Success criteria (1:1 issue ACs): **AC1** real-JWT public instant actor gets exactly one active member row; second attempt returns `ALREADY_MEMBER_OR_PENDING` (steps 2, 5–6). **AC2** approval-required public actor gets pending row visible to Admin; activation null, member-only rights false; no approve action (steps 2, 6). **AC3** invitee-bound valid/unexpired/unredeemed private token accepted once, status follows each private join policy, token atomically redeemed; stolen token without invitee identity fails without consumption (steps 2–3, 6). **AC4** consumed vs expired yield distinct `INVITATION_USED`/`INVITATION_EXPIRED`; revoked has separate state (steps 2, 5–6). **AC5** unknown canonical token rejected `INVITATION_INVALID`, malformed input rejected pre-RPC and malformed direct RPC rejected `PJ001` (steps 2–3, 5–6). **AC6** absent claims, anon SQL role, and any signed-in-anonymous JWT cannot join; guest/public discovery does not create membership (steps 2, 5–6). **AC7** focused mocked server tests plus executed local real-JWT instant/approval/invited/duplicate/expired/used/invalid paths and pending-private RLS assertions pass; existing suite stays green (steps 5–7).
+-- Checkpoints: **Pre-implementation (step 1):** approved invitee-bound decision preserved; correct stacked base/local-only DB, `pgcrypto` schema and first-redemption guard confirmed. **During implementation (steps 2–4):** narrow grant/RLS/SQLSTATE map, strict token-hash parity, conditional extension, fresh reset, typed RPC results, repeatable generated output; failed duplicate/expired/wrong-invitee paths leave token/member unchanged. **Integration (steps 5–6):** tests execute with real JWTs, pending rights denied, independent invitation-state errors, concurrent consume/duplicate races, anonymous direct RPC rejected. **Post-implementation (step 7):** all specified gates green; ≤800 changed lines/≤20 files measured against PAF-28 or explicit approval; exactly one final commit and PR base verified. Out of scope remains PAF-2.5 onboarding/link UI and delivery, PAF-2.6 admin approve/deny/removal, PAF-2.7 reactivation semantics, PAF-4 match authorization.
++- Success criteria (1:1 issue ACs): **AC1** real-JWT public instant actor gets exactly one active member row; second attempt returns `ALREADY_MEMBER_OR_PENDING` (steps 2, 5–6). **AC2** approval-required public actor gets pending row visible to Admin; activation null, member-only rights false; no approve action (steps 2, 6). **AC3** invitee-bound valid/unexpired/unredeemed private token accepted once and atomically redeemed; stolen token without invitee identity fails without consumption. Invitation issuance was deferred to PAF-31 and delivered in community-admin.functions.ts. (steps 2–3, 6). **AC4** consumed vs expired yield distinct `INVITATION_USED`/`INVITATION_EXPIRED`; revoked has separate state (steps 2, 5–6). **AC5** unknown canonical token rejected `INVITATION_INVALID`, malformed input rejected pre-RPC and malformed direct RPC rejected `PJ001` (steps 2–3, 5–6). **AC6** absent claims, anon SQL role, and any signed-in-anonymous JWT cannot join; guest/public discovery does not create membership (steps 2, 5–6). **AC7** focused mocked server tests plus executed local real-JWT instant/approval/invited/duplicate/expired/used/invalid paths and pending-private RLS assertions pass; existing suite stays green (steps 5–7).
++- Checkpoints: **Pre-implementation (step 1):** approved invitee-bound decision preserved; correct stacked base/local-only DB, `pgcrypto` schema and first-redemption guard confirmed. **During implementation (steps 2–4):** narrow grant/RLS/SQLSTATE map, strict token-hash parity, conditional extension, fresh reset, typed RPC results, repeatable generated output; failed duplicate/expired/wrong-invitee paths leave token/member unchanged. **Integration (steps 5–6):** tests execute with real JWTs, pending rights denied, independent invitation-state errors, concurrent consume/duplicate races, anonymous direct RPC rejected. **Post-implementation (step 7):** all specified gates green; ≤800 changed lines/≤20 files measured against PAF-28 or explicit approval; exactly one final commit and PR base verified. Out of scope remains PAF-2.5 onboarding/link UI and delivery, PAF-2.6 admin approve/deny/removal, PAF-4 match authorization. Former-member success-self-rejoin is superseded by denial plus authorized reactivation.
+diff --git "a/docs/plan/Plan PAF-50 PAF-2 follow-up \342\200\224 Tier 3: test and UI polish.md" "b/docs/plan/Plan PAF-50 PAF-2 follow-up \342\200\224 Tier 3: test and UI polish.md"
+new file mode 100644
+index 0000000..4002395
+--- /dev/null
++++ "b/docs/plan/Plan PAF-50 PAF-2 follow-up \342\200\224 Tier 3: test and UI polish.md"
+@@ -0,0 +1,154 @@
++## Task Analysis
++
++- Main objective: Deliver **PAF-50 — "PAF-2 follow-up — Tier 3: test and UI polish"** as four ordered units: **PAF-34 → PAF-38 → PAF-40 → PAF-43**. One branch, four Conventional Commits, one PR targeting main. Planning only in this session; sole writable artifact is this document.
++- Identified dependencies: Existing domain/RLS/join/lifecycle migrations; current audit replacement; TanStack route loaders; StyleX/tokenized UI; Base UI 1.7; per-request i18n; real-JWT local integration helpers; Vitest/Playwright. Intake branch: feature/PAF-50-tier-3-test-and-ui-polish, base/tip 8c705c2258c2099a8a5ce953e52f119b435d1f14. Branch state supplied by parent, not independently verified through commands. Ledgers read: docs/plan/PAF-26-findings.md, PAF-29-findings.md, PAF-30-findings.md, PAF-31-PR2-findings.md. Their line locations are historical; anchors below refer to current source, 1-based unless stated otherwise.
++- System impact: One forward-only trigger-function migration; integration-fixture/test hardening; onboarding pending/label accessibility; admin route/layout/view isolation; stronger locale, confidentiality, geometry and compiled-transport tests. No new dependencies, services, global state/store, hosted DB operations, blanket RLS changes, invitation-delivery feature, coverage changes, or screenshot-budget widening.
++
++## Chosen Approach
++
++- Proposed solution: Surgical changes on established seams. Share immutable actor authentication setup, recreate mutable community fixtures per test. Extend current audit trigger with explicit changed-field allowlists and narrowly safe transitions. Keep onboarding mounted during navigation; derive pending from router state. Preserve existing exported admin entry components; move six state-owning typed views behind a discriminated dispatcher. Use explicit members index/Outlet. Replace source-string assertions with executable route tests and bind extraction assertions to a successful fresh build.
++- Justification for simplicity: Brainstormed three approaches: (A) local fixes plus typed view separation, chosen; (B) generic fixture engine/query cache/admin state machine, rejected as extra ownership and lifecycle complexity; (C) rewrite all tests/UI or replace Pencil baselines with browser screenshots, rejected as loss of provenance and large regression surface. Important edges: filtered test execution, demotion races, stale loader/search responses, pending retries without URL changes, history navigation, focus target disappearance after mutation, renderer residuals, confidential serialized payloads, clock skew and slow INSERTs.
++- Components to be modified/created: Exact per-unit lists below. Common plan artifact belongs in first unit's commit. Existing schema types need no change: trigger signature/schema/RPC contract unchanged. New migration filename necessarily receives implementation-time CLI timestamp; only unresolved filename, not unresolved design.
++- Current-code conflict / smallest alternative: **PAF-38 F4 cannot mean successful former-member self-rejoin anymore.** 20261008184607_community_membership_lifecycle.sql explicitly raises PJ008 for inactive history in both join_public_community and accept_community_invitation; 20261009061318_community_reactivation_interval_order.sql makes govern_community_member(..., 'reactivate') append a new interval. Preserve current security/product policy. Add rejected self-join/private acceptance with unchanged history and unconsumed token, then authorized admin reactivation proving a new interval and unchanged old interval. Do not weaken PJ008 merely to satisfy obsolete finding prose. Record this interpretation in PAF-29 plan annotation and obtain parent acceptance before treating original F4 acceptance criterion as fully satisfied.
++- Constraints: 2-space indentation; PascalCase React components, kebab-case modules, established domain-prefixed tests. Tokens first, all visible/accessible text translated. ≥44px controls, fluid/wrapping layouts, Base UI interactive primitives. Keep requireAuthenticatedClient/getClaims, no-store, RLS and scoped membership lookup. Review docs/design/padel-friend.pen through Pencil tools during implementation; encrypted .pen was not read as text in planning. No design-file modification planned.
++
++## Implementation Steps
++
++1. **Preflight / establish red evidence.** Implementation agent verifies branch/base/clean-tree and local-only backend before edits; do not recreate branch. Read this plan and accept F4 policy alternative. Confirm local backend available and migrations applied through archive-audit replacement; integration skip is not a pass. Record current source PNG hashes and per-screen caps. Capture focused failures before each fix where behavior is defective. For pure refactors/test-oracle improvements, keep behavior characterization green and demonstrate new oracle detects injected incorrect input/route/build state; do not pretend unchanged behavior should fail. No installs or production mutations. Planning session ran no commands/tests/DB operations.
++
++2. **Unit 1 — PAF-34: isolate fixtures, preserve inactive-only actor, add safe audit detail.**
++
++   **Exact change list:**
++   - test/community.integration.test.ts
++   - supabase/migrations/<CLI-generated-timestamp>_community_audit_changed_fields.sql (new; create with pnpm exec supabase migration new community_audit_changed_fields)
++   - docs/plan/Plan PAF-50 PAF-2 follow-up — Tier 3: test and UI polish.md (this artifact)
++
++   **Anchors:** integration actor()/rows()/serverClient at lines 66–108 and 10; mutable declarations 130–143; first it initializes everything at 144–204; AC3 rejoins inactive actor at 585–653; privacy/mutation matrices 655–713/715–861; final-admin race and inherited audit assertions 886–940; later activation tests choose surviving admin at 942–1036. Original SQL audit_community_change at 248–278 is superseded by 20261011171955_community_venue_archive_audit.sql, which adds archived boolean evidence and revokes direct execution.
++
++   **Ordered work:**
++   1. Add beforeAll for actors only, beforeEach for fresh private/public communities, role rows, invitation and venue, afterEach clearing serverClient.current. Keep suite sequential: hoisted client is shared, so no concurrent tests using it. Local helpers remain in this test file; avoid global fixture framework. Hook initialization must run for every selected test independently; reduce actor churn by reusing only authentication identities, not mutable community state.
++   2. Move creator/bootstrap assertions out of setup; test checks its hook-created fixtures. Each mutable test seeds its own prerequisites. In AC7 explicitly create venue/settings/member audit events before count/entity assertions; no inherited revocation/promotion/settings assumption. Later activation tests use their fixture admin, not outcome of preceding race. Discovery checks use UUID-specific search/explicit IDs rather than assuming default first page always includes newest fixture amid accumulating local data. Keep loopback and CI fail-closed guard.
++   3. AC3 rejoin uses its fresh per-test inactive fixture. AC4/AC5 assert inactive actor has exactly one closed row, non-null activation, zero open rows before and after matrix. Strongest no-regression probe runs AC3 and AC4/5 together: rejoin in one test must not affect matrix fixture. Assert denied UPDATEs leave settings, venue, membership and invitation unchanged, not only error shape.
++   4. Create new CLI migration; never edit 20261002055953_community_domain.sql or archive-audit migration. CREATE OR REPLACE latest public.audit_community_change(), preserving SECURITY DEFINER, empty search_path, fully qualified calls, auth.uid actor, append-only insertion, existing member role/status and invitation revoked evidence, and venue archived boolean. Existing triggers remain attached; no new trigger duplication.
++   5. On UPDATE compute deterministic changed_fields using explicit columns and IS DISTINCT FROM: communities name, description, logo_path, city_label, visibility, join_policy, settings; venues name, address, maps_url, photo_path, archived_at. Exclude mechanical updated_at, IDs, creator/account columns. Emit before/after objects only for changed safe transitions: community visibility/join_policy enums and venue archived boolean (derived from archived_at). Settings name may appear in changed_fields, but never settings contents. Text/URL/path values intentionally omitted: names of changed columns give utility without arbitrary user payload leakage. Retain top-level visibility/archived fields for compatibility; INSERT behavior stays compatible, with no OLD access. No whole-row to_jsonb dump into details. No-op update has empty changed_fields and empty transitions; existing audit emission remains, avoiding unrelated behavior change.
++   6. Add standalone audit integration test: change settings only, scalar metadata only, enums, venue metadata, archive, null→value/value→null, multi-field update and no-op. Check exact changed_fields/safe transitions; unchanged enum absent from transitions. Seed distinctive secret settings/token/account/text sentinels; recursively verify details contain none. Check members/invitations still have existing evidence, archive still archived=true; nonadmins/anon cannot read or write audits and cannot invoke trigger function. Add explicit before-update baseline and assert historical audit rows unchanged.
++   7. Implementation only: apply migration to disposable local DB; test upgrade path from prior migration plus fresh replay. No hosted db push. No generated type update expected. Record actual CLI filename in unit report.
++
++   **Red→green checks:** isolated AC4 name-filter fails before hooks; AC3→AC4 actor-state check fails before per-test isolation; detailed audit assertions fail before replacement. Existing AC1–AC7 and creator/discovery tests stay green after isolation. Run each state-dependent test separately by its full exact name, not only one broad filter.
++
++   **Fast gate:** pnpm typecheck && pnpm lint && pnpm exec vitest run test/community.integration.test.ts test/community.column-isolation.integration.test.ts test/community.admin.integration.test.ts. Also pnpm exec vitest run test/community.integration.test.ts -t 'AC4:' and -t 'AC5:' independently, then -t 'AC3:|AC4:|AC5:'. Integration must run against migrated loopback DB.
++
++   **Risk/mitigation:** actor setup plus fresh DB fixtures raises hook cost; retain 30s configuration only if measured adequate, adjust local test/hook timeout with evidence rather than disabling assertions. Fresh fixtures may reveal prior implicit audit counts. Migration rollback before deploy: correct new migration and replay; after deploy: corrective forward migration restoring prior trigger body, never delete/rewrite applied history. Audit DDL must not alter RLS/grants/lock ordering. Intended commit: test: isolate community fixtures and enrich safe audit evidence.
++
++3. **Unit 2 — PAF-38: robust expiry and current-policy join edges; reconcile old plan.** Start only after Unit 1 commit; same integration file changes serially.
++
++   **Exact change list:**
++   - test/community.integration.test.ts
++   - docs/plan/Plan PAF-29 PAF-2.4 — Join flows: public self-join, private invitations, approval handling, edge cases.md
++
++   **Anchors:** join matrix 1038 onward; invitation helper 1059–1078 currently selects id/created_at; fixed 1200ms expiry plus 1500ms sleep at 1260–1261. PAF-29 plan still promises issuance in analysis, approach, file list, steps 3/5/6/validation. Delivered issueInvitation lives in community-admin.functions.ts, not community.functions.ts. Original lifecycle CHECK requires expires_at > created_at and invitation trigger prohibits editing expiry.
++
++   **Ordered work:**
++   1. Extract invitation/membership/join-community helpers within test suite so expiry, visibility flip and history scenarios become individually filterable tests with independent data. Preserve original successful/race/error matrix; no broad rewrite of production functions.
++   2. Expired fixture: seed with several seconds of validity, preferably DB-relative expiry through existing executeLocalFixtureSql so process/SQL-start delays cannot invalidate INSERT. Extend that helper to return parsed CLI JSON result for INSERT RETURNING id, created_at, expires_at (validate exact CLI result shape). Use generated safe UUID/hex values only in local SQL; no untrusted interpolation. Compute expires_at from DB clock at INSERT, e.g. 5 seconds after clock_timestamp(), and read stored timestamps. This test-only local SQL privilege follows existing fixture precedent; production acceptance still uses real invitee JWT.
++   3. Wait based on returned expires_at, with bounded polling/deadline (e.g. maximum 15s, 100ms poll; finite timestamp required). Add small post-expiry boundary cushion, not sub-second INSERT validity margin. Never sleep blindly for a hardcoded 1500ms, backdate expiry, loosen CHECK, or mutate immutable expiry. Timeout produces clear diagnostics without raw token. No fake timers around real DB expiration. Test normal helper and deliberately delayed seed execution (>1.2s) still returns expiry after creation; test wait helper expired-now and deadline failure with controlled clock in a local isolated test, then real acceptance rejects INVITATION_EXPIRED and leaves token/membership unchanged.
++   4. Add former-member history scenario for public and private paths: join/accept, close through leaveCommunity, snapshot complete closed row; self-join and fresh private token acceptance reject MEMBERSHIP_INACTIVE; no new row, old interval identical, redeemed_at/revoked_at unchanged. Set admin client and call existing reactivateCommunityMember endpoint; assert distinct replacement ID, role member/status active, old row unchanged, exactly one open interval, valid_from ≥ greatest closed valid_until, activated_at ≥ valid_from. No auto-reactivation, no migration changing PJ008. Use separate actors/communities for public/private variants.
++   5. Visibility flip: seed unconsumed private invitation, flip to public as admin, invitee acceptance rejects COMMUNITY_NOT_ELIGIBLE. Query invitation with .single(), error null, redeemed_at/revoked_at null; membership empty, audit shows no redemption/member insert. Flip back private and accept same token successfully to prove rejection did not consume it. Cover both join policies with parameterized fresh fixtures when practical.
++   6. Add prominent Delivered-scope reconciliation note to PAF-29 plan: historical issuance requirements deferred to PAF-31 and delivered in community-admin.functions.ts; PAF-29 delivered only join/accept plus validators, RPCs and tests. Mark issuance clauses in implementation/file/test/AC sections as historical/deferred rather than leaving contradictory imperative instructions active. Annotate self-rejoin expectations as superseded by lifecycle policy and current reactivation alternative. Preserve historical stack/base information as history, not current execution directions.
++
++   **Red→green checks:** delayed DB-relative fixture test exercises old timing flaw; stored-expiry/wait checks fail old helper. New lifecycle tests characterize current rejection, not demand obsolete success; history preservation verifies new-interval path. Visibility rejection oracle additionally injects consumed-token result to prove non-consumption assertion is strict. Documentation review searches every issuance mention and verifies attribution; no fake production test for prose edits.
++
++   **Fast gate:** pnpm typecheck && pnpm lint && pnpm exec vitest run test/community.integration.test.ts test/community.join.functions.test.ts test/community.lifecycle.functions.test.ts. Then filtered expiry/history/visibility tests individually; repeat expiry test 5 times on slow/local CI-equivalent resources. No extra migration or production behavior change.
++
++   **Risk/mitigation:** DB/process clocks differ; DB-relative seed eliminates INSERT race, bounded wait prevents hangs, local-only backend limits skew; fail clearly if expiry cannot be observed within deadline. Do not hide timing failures with Playwright/Vitest retries. F4 alternative needs parent acceptance; exact original success wording cannot honestly be marked implemented. Intended commit: test: harden invitation timing and membership edge coverage.
++
++4. **Unit 3 — PAF-40: independent SSR oracle, safe visual comparator, pending UX and durable labels.**
++
++   **Exact change list:**
++   - e2e/community-onboarding.spec.ts
++   - src/features/community/CommunityOnboarding.tsx
++   - src/features/community/community-onboarding.styles.ts
++   - src/locales/en/translation.json
++   - src/locales/pt-BR/translation.json
++   - src/locales/es/translation.json
++   - test/community.onboarding.test.tsx
++
++   **Anchors:** visualDiff e2e lines 124–179 uses fixed 390 stride with pixel arrays only; discovery cards/action probes/masks 297–337; current raw-vs-hydrated locale test 431–456 only inspects DOM. Current caps are upper-create 0.0866, full-create 0.1265, discovery 0.047; older ledger percentages are not current caps. Component has router.invalidate retry, current/draft/source keyed pagination, existing 300ms debounce/history protection; CreateCommunityView labels use ui.hidden. Styles ui.optional 140–159 provides 44px inputs; cardTitle/meta 73–85 define real typography.
++
++   **Ordered work:**
++   1. SSR locale test: after locale cookie and authenticated page.goto(), retain navigation response, require successful HTML response, read response.text(). Parse inert detached HTML (DOMParser in browser evaluate is sufficient; never query live document for this assertion) and assert documentElement.lang plus h1 text equals locale's dictionary entry. This tests response HTML even if page has hydrated. Then waitForHydratedPage and independently assert live html lang/heading; cover both views × en/pt-BR/es at 320px. Add synthetic raw-English HTML with Portuguese hydrated DOM negative oracle so helper rejects SSR mismatch; hydration must not rescue SSR failure.
++   2. visualDiff returns decoded width/height/pixels; validate expected and actual are exactly 390×844, equal, positive and buffer length width×height×4. Validate endY within image and mask bounds before any indexing. Derive stride from decoded width; explicitly reject dimensions before returning numeric count. Keep same color-distance formula and masks. Return diff PNG data plus count; use TestInfo attachments for expected, actual and diff with per-reference/region names. Attach expected/actual even when dimensions mismatch; diff unavailable must be explicit, not NaN. Keep source/baseline hash checks and byte equality before/after tests. Synthetic canvas PNG tests cover identical, mismatched width, mismatched height, invalid region and known changed pixel; add within this spec rather than new codec dependency/shared comparator project.
++   3. Subscribe via useRouterState to relevant onboarding route match pending/isFetching state, covering same-URL router.invalidate as well as navigation. Inspect installed router typings for match semantics; do not use only pathname comparison or mutation flag. Combine pending with unsent draft mismatch for immediate search feedback; exclude create view and unrelated route activity. Add stable results container aria-busy=true while pending and translated role=status outside busy subtree so announcements are not suppressed. Suppress empty-result message during pending; keep search enabled/focused and pagination/source guards unchanged. Retry button uses busy state to prevent duplicate invalidate. Reuse generic loading key or add communityOnboarding.searchLoading consistently in all three locale dictionaries (chosen: specific key).
++   4. Optional description/city labels become permanently visible compact/floating labels inside each existing 44px field row. Keep real htmlFor/id, input hit area ≥44px, tokenized label/text sizing, no overlapping values. Prefer labeled relative wrapper + label with pointer interaction transferred to input; remove duplicate field names from placeholder examples if needed in all locales. Fit existing row geometry where possible; translation must wrap without clipping at 320px. No hidden-only label, placeholder-only identity, or shrinking touch target to recover visual fit.
++   5. Close mask blind spots: assert each h3/metadata exact x/y/width/height for deterministic fixture, plus font-family, font-size, font-weight, line-height/color from computed styles and tokens. Probe action x/y/width/height, not current x/height only; title and metadata placement remain frame/card relative. Use existing card boxes (18/240/354/142 and 18/392/354/142) and padding 14 to derive expected content placement; measure height/line metrics against actual Pencil source before pinning, never invent font pixel geometry. Assert approved omission of member-count/skill rows remains. If pending wrapper changes CSS selectors, update locators semantically without relaxing geometry.
++   6. Add component tests with controllable router-state mock: draft→debounce→loader pending→settled, first-page same-query retry pending/success/failure, loadMore busy, no spurious empty status, translations per locale, preserved keyboard focus/current join result/history behavior. Filled optional fields retain visible associated labels; jsdom accessibility assertions plus browser visibility/hit-area/overlap assertions at 320px. Existing mocked hooks need useRouterState mock; do not derive production pending solely from test mocks.
++   7. Browser test delays relevant loader response to observe pending, then releases deterministically; test retry after controlled failure. No fixed sleep as pending oracle. Verify real TanStack request shape before intercepting; use specific endpoint only, never blanket fake auth/data. Review dSEX3/JO4DC via Pencil tools and attach visual artifacts.
++
++   **Red→green checks:** bad raw SSR fixture fails new oracle independent of correct live DOM; mismatched PNG fails dimensions instead of NaN; pending and filled-label tests fail current UI; intentionally displaced masked title/metadata/action fails new probes. Existing keyboard/history/create reset/pagination/join cases must remain green.
++
++   **Fast gate:** pnpm typecheck && pnpm lint && pnpm exec vitest run test/community.onboarding.test.tsx test/i18n.test.ts && pnpm exec playwright test e2e/community-onboarding.spec.ts. Fresh preview required, do not reuse server running stale source.
++
++   **Risk/mitigation:** all three translation files get identical key structure; assert nonempty localized pending strings. Do not update PNG baselines from browser or use --update-snapshots. Cross-renderer glyph residuals allowed only within existing documented caps; structural defects are blockers. Persistent-label layout may alter lower-create region: preserve compact field-row geometry first. If current unchanged budget cannot accommodate a legitimate accessibility improvement, stop and report exact residual/probes for design review; do not silently widen budgets/masks. Rollback only affected UI/test changes if focus/history/geometry regress; retain original source PNGs. Intended commit: fix: polish community discovery feedback and visual assertions.
++
++5. **Unit 4 — PAF-43: admin confirmation/recovery, route split, typed view state, stronger executable tests.**
++
++   **Exact change list:**
++   - src/features/community/CommunityAdmin.tsx
++   - src/features/community/CommunityAdminViews.tsx (new; typed dispatcher plus six private state-owning view components and shared frame/mutation helpers)
++   - src/features/community/community-admin.types.ts
++   - src/features/community/community-admin.functions.ts
++   - src/features/community/community-admin.validators.ts
++   - src/features/community/community-admin.styles.ts
++   - src/routes/_protected.community.$communityId.admin.members.tsx
++   - src/routes/_protected.community.$communityId.admin.members.index.tsx (new)
++   - src/routeTree.gen.ts (generator output only)
++   - test/community.admin-ui.test.tsx
++   - test/community.admin.functions.test.ts
++   - test/community.admin-routes.test.ts
++   - test/community.admin-extraction.test.ts
++   - e2e/community-admin.spec.ts
++
++   Existing communityAdmin.retry/backToDashboard/confirm/cancel/error/loading keys already exist in en, pt-BR, es; no Unit 4 locale file edits expected. If error/reset API forces additional user copy, add keys across all three files and explicitly extend unit change list before editing. No admin endpoint transport rewrite, new RPC or migration.
++
++   **Anchors:** CommunityAdminDenied 144–172 lacks recovery; CommunityAdminScreen/View 210–307 holds all screen state and keys only by community.id; requestMemberAction/confirmedAction/actions 366–446 renders confirmation before trigger; fetchMembers 475–524 and audit paging 567–580 lack loader-source identity. Existing request/venue state reset at 297–306 and mutation invalidation 313–338 must survive. getCommunityAdminContext inline validator follows requireAdmin in functions module; record()/uuid() already exist in validators. styles.backLink lineHeight:1 at 50; only available primitive line-height tokens tight=1.1/body=1.5. MembersRoute currently loads roster and pathname.endsWith('/members') (members.tsx 13–36), even for detail; detail uses scoped getCommunityMemberById. Extraction test reads arbitrary existing dist assets at 15 onward. Route tests are readFileSync/toContain assertions throughout. Admin E2E denial only guest redirect/member heading at 435–442/521–529, narrow locale coverage settings-only at 545–562, six 390px screens have fixed provenance/caps.
++
++   **Ordered work (one unit commit; internal checkpoints before proceeding):**
++   1. Establish behavioral characterization of six screens: existing search clearing/filter paging, loader-backed first page, request/venue appended-page reset on mutation, replacement membership navigation, cross-community draft reset, UTC dates, rating nullability, neutral audit actor and strict authorization. Add deferred-response tests for loader refresh while member search/audit loadMore is in flight; old source data must not overwrite new loader result. Add search→settings and audit→other-screen rerenders proving unrelated state does not persist or fire queries.
++   2. **F16:** export validateCommunityId from existing validators using record(value, ['community_id']) and uuid(). Wire getCommunityAdminContext.validator(validateCommunityId). Test null/array/missing/bad UUID/extra keys rejection before client access; inherited-only community_id rejected through record's own-entry copy; valid uppercase UUID accepted. Verify getClaims/no-store + live is_community_admin denial prevents communities SELECT, and exact safe SELECT on success. Existing inline behavior mostly correct; direct validator export/own-property regression provides meaningful refactor oracle.
++   3. **F19/F22:** members.tsx becomes Outlet-only layout with no roster loader/pathname branching. New members.index.tsx owns current active roster loader (getCommunityAdminContext first, then search status active offset0 limit50) and CommunityAdminScreen screen=members. Parent admin guard and leaf guards remain; detail still fetches scoped membership ID only. Generate routeTree via normal build, never hand edit generated tree. Test actual imported Route.options.loader with mocked server boundaries for each data leaf; denied getCommunityAdminContext rejects before roster/venues/audit/member reads, success receives correct params/order and counts. Add in-memory TanStack router built from imported generated route tree to assert actual protected/admin/members/index/detail parent relationships, root admin redirect, member-detail navigation not invoking roster, trailing-slash index handling, guest/incomplete guard redirects, nonadmin failure. Mock unrelated root/auth rendering only, not createFileRoute into source-text facsimiles. Keep test file .test.ts; use createElement if rendering required, avoiding extension churn. No source-string substitute.
++   4. **F20:** use discriminated screen props requiring members for requests/members, scoped member + membershipId for detail, venues for venues, audit for audit, community for settings. Move DTOs to existing admin.types.ts using generated Database and nullable member contract. CommunityAdmin.tsx keeps public shell/loading/denied/entries/screen exports for routes/dashboard/test compatibility. CommunityAdminViews.tsx exports dispatcher and owns separate RequestsView/MembersView/MemberView/SettingsView/VenuesView/AuditView functions; no hooks shared across unrelated screens. Common frame/mutation helpers remain feature-local in same module, no store/barrel. Community identity changes remount view; screen changes select distinct component type. Update test mount helper to supply only screen-appropriate required fixtures.
++   5. Search results carry loader source reference plus query/status; pending requests carry generation/source tokens. When members loader source changes, discard appended results, invalidate old request generation, preserve same-community search/filter input and refetch current filter if needed; never overwrite a newer filter. Audit append state similarly tied to audit loader source, paging starts from fresh rows, old completions ignored, hasMore recalculated. Request/venue appended-state reset and mutation invalidation retained from current implementation. Settings draft should remain stable for same-community invalidation unless explicit successful save, while community identity change resets it. Avoid keying whole screen on every loader object: would lose search focus/drafts and successful status. No unsafe casts masking invalid screen props.
++   6. **F13:** replace inline demote/remove confirmation with feature-local Base UI AlertDialog flow. Existing Button supports ref/render props through Base Button. Trigger is correctly wired to dialog; accessible title/description use existing confirm translation; opening moves focus to safe Cancel action; focus trapped, Escape/Cancel restores trigger, Confirm closes once and calls mutation once. Trigger absent/disabled after successful removal/demotion or permission loss: focus stable screen heading/dashboard exit, not disconnected element. Failure permits retry with focus restoration. Tokenized dialog/backdrop/controls styles, ≥44px hit targets, 320px translated text wrap. No modal opened in static visual baseline screenshots. Keyboard tests: Enter open, Tab/Shift-Tab containment, Escape/Cancel restore, confirm-only mutation, detached-trigger fallback, error/final-admin path. Update existing status-based confirmation test to assert alertdialog semantics.
++   7. **F14:** extend CommunityAdminDenied to accept router error-component reset callback. Generic transient loader error renders localized Retry plus dashboard link; NOT_COMMUNITY_ADMIN has dashboard exit but no retry; definitive missing member likewise no pointless retry. Retry awaits router.invalidate then reset/remount error boundary according to installed TanStack API; guard busy/double click, retain generic error on failed retry. Do not auto-retry write RPCs, permission denials, or refresh secrets from unauthorized loaders. Component tests cover all three locales and exact retry call; executable route/browser test temporarily fails initial loader then recovers on retry. Do not show previous authorized roster while denied.
++   8. **F17:** retain lineHeight:1 only with explicit adjacent documented exception: decorative aria-hidden chevron, unitless single-em glyph centering, 44px hit box independent of line-height, existing tight 1.1/body 1.5 are text-leading tokens not equivalent icon metric. Smallest acceptable finding resolution permits documented exception; no new token needed for one icon. Browser probe verifies chevron centering and back-link 44px hit area unchanged. If review insists no exception, use existing tight token and remeasure geometry before acceptance; never invent token literal silently.
++   9. **F15:** separate stable 320px locale matrix from long mutation journey. Parameterize six destinations × three locales (18 identifiable cases), fixtures created independently or scoped read-only per test worker. Include member detail populated by scoped ID, requests with pending row, venues and audit populated, settings details expanded where relevant. Assert locale heading, no document or inner-main horizontal overflow, visible labels, all active interactive controls ≥44px hit region, nav/action nonoverlap, keyboard reachable actions. Scroll long content to assert bottom nav never permanently obscures actions. Keep existing 390px six-source comparison suite and budgets unchanged. Any narrow-screen CSS repair must be responsive only; do not alter measured 390px structure without review.
++   10. **F18:** create private community with unique confidential sentinels: roster display names/IDs, community description/settings sentinel, private venue name/address, audit/entity IDs. Guest, active nonadmin, pending/inactive member and outsider directly visit all admin destinations, including scoped detail. Collect initial HTML via response.text and actual relevant loader/server-function response bodies during navigation/retry; assert sentinel absence in raw response including serialized/dehydrated payload and DOM. Exclude fixture-setup RPC traffic from collection. Requested community/membership IDs appear legitimately in URL/router params: do not claim their URL occurrence alone leaks payload; choose additional confidential IDs/fields not in requested path. Successful owner path must see sentinels, proving fixture exists. Keep direct-RLS security tests as backend complement; redirect/heading alone is not confidentiality evidence.
++   11. **F21:** extraction test beforeAll executes and awaits pnpm build successfully with bounded hook timeout (e.g. 120s) before enumerating dist/server/assets. Inspect build artifacts only after that hook; nonzero build status fails suite, no stale fallback. Assert fresh artifact mtime consistent with hook start (filesystem timestamp precision considered) plus existing one-module/six-distinct-transport-ID contract. Standalone test must succeed with dist absent and replace stale output; add negative fixture/mocked build-failure check showing stale artifact cannot produce a passing extraction assertion. Keep build stdout/stderr available on failure, no secret env logging. Simplest self-contained build hook may duplicate top-level complete-check build: accepted correctness cost, no separate manifest/timestamp service. Prevent parallel production-build consumers in focused execution; do not run Playwright build concurrently with extraction. No package script changes needed.
++   12. Run Unit 4 gate, six-screen visual suite and 18-case matrix, then compare refactor characterization tests. Only after all are green mark F13–F22 addressed. Keep all six module-level createServerFn action exports unchanged so extraction and browser RPC routing remain stable.
++
++   **Red→green checks:** focus transfer/restore and recovery fail old UI; deferred old-source search/audit tests fail current source-unbound state; detail no-roster count fails old members layout; inherited-ID validator test fails inline convention; raw confidential-sentinel oracle rejects supplied leaked body; stale/failed-build oracle cannot pass. All screen/locale permutations add coverage, not fabricated baseline failures. Document-only icon exception validated by geometry rather than source-string tests.
++
++   **Fast gate:** pnpm typecheck && pnpm lint && pnpm exec vitest run test/community.admin.functions.test.ts test/community.admin-ui.test.tsx test/community.admin-routes.test.ts test/community.admin-extraction.test.ts && pnpm exec playwright test e2e/community-admin.spec.ts. Build first during route addition to generate routeTree before typecheck; extraction hook still independently builds. Re-run existing test/community.admin.integration.test.ts and community.column-isolation.integration.test.ts against loopback DB to catch security drift.
++
++   **Risk/mitigation:** F20 highest-risk unit: staged internal checkpoints, no server transport/domain behavior change, preserve public entry exports, run existing UI tests after each moved view before introducing source reset logic. New required props may expose tests passing meaningless fixtures; fix fixtures rather than weakening discriminated types. Same-community source refresh must invalidate stale async work without resetting search focus. Recovery must reset correct router boundary; verify installed API in real router test. No screenshot baseline regeneration. Rollback refactor locally to last unit commit if characterization fails; isolate and reapply smallest view split, not expanded generic state abstraction. Intended commit: refactor: isolate admin views and harden accessible recovery tests.
++
++6. **Epic final gate / delivery handoff.** No commands performed by planner. Implementation parent, after four ordered units, runs affected fast gates and format:check; final full pnpm complete-check must pass with unchanged coverage thresholds and no source changes caused by gate. User requests full gate once before push through pre-push hook: do not additionally run complete-check after every unit; per-unit AC is satisfied by final full gate plus recorded focused gates. Current complete-check runs build → knip → typecheck → lint → format:check → covered Vitest → Playwright; extraction's fresh build hook and Playwright's own build may run again inside that one invocation. Treat those as internal build work, not duplicate full gates. Ensure generators already stable and fresh preview used before gate; inspect working tree afterward. Parent handles authorized commits/push/one PR to main, Copilot review request and Linear tracking. No Linear identifiers in commit messages or PR title/body; internal issue references remain in this plan. Plan included with Unit 1; exactly four commits, not separate planning commit. Commit examples above convey intent without identifiers.
++
++## Validation
++
++- Success criteria:
++  - **PAF-34 AC (verbatim):** F7 integration suite can run any test by name filter without undefined actors, mutable scenarios isolated · F8 an inactive-only former member is exercised through the privacy/mutation matrix · F9 audit rows identify which fields changed for community and venue updates without leaking sensitive data · pnpm complete-check passes.
++  - **PAF-38 AC (verbatim):** expired-token fixture timing-robust (no sub-second margin) · PAF-29 plan reflects deferred issuance scope · closed-history rejoin and visibility-flip rejection covered by integration tests · pnpm complete-check passes. Qualification: closed-history coverage follows current denied-self-rejoin + authorized-reactivation policy; original successful self-rejoin interpretation requires parent acceptance of alternative, not silent completion.
++  - **PAF-40 AC (verbatim):** F6 SSR locale asserted against raw response HTML independently of hydration · F7 visual comparator validates image dimensions · F8 search/retry expose translated pending status + aria-busy · F9 optional-field labels remain visible after entry · F10 masked card content has exact structural probes · pnpm complete-check passes.
++  - **PAF-43 AC (verbatim):** F13–F22 addressed as described · pnpm complete-check passes.
++  - Four ordered unit commits, one branch/PR, main base; only approved source/test/docs changes, no secrets/service-role browser code, no RLS widening, no lowered coverage or expanded screenshot budgets. Gate itself does not modify tracked source.
++- Checkpoints:
++  - **Step 1 / before implementation:** parent accepts F4 alternative; branch/base/backend/migration prerequisites verified; record unchanged PNG hashes/caps; source read-only planning complete. Modern-web-guidance skill loaded, but network/package execution prohibited in planning; implementation may consult guidance under its own permissions.
++  - **Step 2 / after fixtures:** every state-dependent integration test selected alone executes successfully; AC3 then matrix proves closed actor isolation; fixture-local audit assertions no inherited count. After migration: forward upgrade and fresh replay emit exactly safe details; archive/member/invitation evidence and RLS/ACL denial retained.
++  - **Step 3 / expiry/history:** delayed seed >1.2s never violates lifecycle CHECK; returned expiry drives bounded wait; repeated real-JWT expiry and policy/visibility tests pass, tokens unconsumed on rejection; old plan reconciled in every active issuance clause.
++  - **Step 4 / onboarding:** negative SSR/dimension/geometry oracles detect defects; real browser search/retry pending status + aria-busy observed, clears on settle; filled labels visible at 320px all locales; original focus/history/state tests and pinned-reference caps pass.
++  - **Step 5 / admin internal gates:** validator boundary green before route changes; executable route tests prove parent/leaf/denial ordering and no detail roster read; typed-view move retains existing behavior before source-epoch fixes; keyboard confirmation and retry recover correctly; all 18 locale/screens pass without horizontal overflow; confidential sentinels absent from unauthorized raw/serialized/browser payloads; extraction freshly compiles six unique identities.
++  - **Step 6 / release:** final hook complete-check passes and leaves tracked source unchanged; source hashes/baseline bytes unchanged; review all elevated-risk deltas. No hosted deployment/migration performed by this planning session.
++  - **Open question / approval item:** Accept PAF-38 F4 alternative aligned with current PJ008/admin reactivation policy? Code resolves behavior, but only parent can accept revised historical AC interpretation. No other requirements questions unresolved; actual CLI migration timestamp and renderer measurements are execution facts to record, not guessed inputs.
++
++Plan absolute path: /Users/trystan2k/Documents/Thiago/Repos/padel-friend/docs/plan/Plan PAF-50 PAF-2 follow-up — Tier 3: test and UI polish.md
+diff --git a/e2e/community-admin.spec.ts b/e2e/community-admin.spec.ts
+index 7eccaec..205ea22 100644
+--- a/e2e/community-admin.spec.ts
++++ b/e2e/community-admin.spec.ts
+@@ -6,6 +6,7 @@ import { expect, test, type Locator, type Page } from '@playwright/test';
+ import { waitForHydratedPage } from './auth-helpers';
+
+ type Copy = {
++  language: string;
+   auth: { loginEmailLabel: string; loginPasswordLabel: string; loginSubmit: string };
+   onboarding: {
+     name: string;
+@@ -15,6 +16,7 @@ type Copy = {
+     save: string;
+   };
+   communityAdmin: {
++    backToDashboard: string;
+     title: Record<string, string>;
+     navigation: string;
+     accessDeniedTitle: string;
+@@ -127,6 +129,30 @@ async function signIn(page: Page, actor: Actor) {
+   await waitForHydratedPage(page);
+ }
+
++async function assertNoConfidentialPayload(page: Page, paths: string[], sentinels: string[]) {
++  const observed: string[] = [];
++  const collect = async (response: import('@playwright/test').Response) => {
++    try {
++      observed.push(await response.text());
++    } catch {
++      // Browser may cancel a response while navigating; successful payloads remain collected.
++    }
++  };
++  page.on('response', collect);
++  for (const path of paths) {
++    const documentResponse = await page.goto(path);
++    if (documentResponse) observed.push(await documentResponse.text());
++    await page.waitForLoadState('networkidle');
++    await waitForHydratedPage(page);
++    observed.push(await page.locator('body').innerText());
++  }
++  page.off('response', collect);
++  const payload = observed.join('\n');
++  for (const sentinel of sentinels) {
++    expect(payload, `confidential sentinel leaked: ${sentinel}`).not.toContain(sentinel);
++  }
++}
++
+ async function visualDiff(
+   page: Page,
+   file: keyof typeof references,
+@@ -313,6 +339,23 @@ async function memberControlsGeometry(page: Page) {
+   expect(actions!.height).toBeGreaterThanOrEqual(44);
+ }
+
++async function backLinkGeometry(page: Page) {
++  const link = page.getByRole('link', { name: en.communityAdmin.backToDashboard });
++  const linkBox = await link.boundingBox();
++  expect(linkBox).not.toBeNull();
++  expect(linkBox!.width).toBeGreaterThanOrEqual(44);
++  expect(linkBox!.height).toBeGreaterThanOrEqual(44);
++  const icon = link.locator('[aria-hidden="true"]');
++  const iconBox = await icon.boundingBox();
++  expect(iconBox).not.toBeNull();
++  expect(
++    Math.abs(iconBox!.x + iconBox!.width / 2 - (linkBox!.x + linkBox!.width / 2))
++  ).toBeLessThanOrEqual(1);
++  expect(
++    Math.abs(iconBox!.y + iconBox!.height / 2 - (linkBox!.y + linkBox!.height / 2))
++  ).toBeLessThanOrEqual(1);
++}
++
+ async function settingsGeometry(page: Page) {
+   // N18Mu4 settings rows: visibility y72, public control y126, join control y180, each 354×44.
+   const offset = await mainOffset(page);
+@@ -478,6 +521,7 @@ test('real admin requests, membership, settings, venues and audit stay protected
+   await waitForHydratedPage(page);
+   await page.getByRole('heading', { name: en.communityAdmin.title.members }).waitFor();
+   await geometry(page);
++  await backLinkGeometry(page);
+   await memberCardGeometry(page);
+   await assertLinkHitArea(page.getByRole('link', { name: 'Backup Admin' }));
+   // Mask fixture identity/metrics, role badges, avatars and the unsupported invitation copy only;
+@@ -631,3 +675,278 @@ test('real admin requests, membership, settings, venues and audit stay protected
+   ).toBeVisible();
+   expect(requestRow.status).toBe('active');
+ });
++
++test('unauthorized community admin routes never disclose confidential fixture payloads', async ({
++  browser
++}) => {
++  test.setTimeout(120_000);
++  const suffix = crypto.randomUUID();
++  const ownerName = `Private Owner ${suffix.slice(0, 8)}`;
++  const activeName = `Private Active ${suffix.slice(0, 8)}`;
++  const pendingName = `Private Pending ${suffix.slice(0, 8)}`;
++  const owner = await createActor(ownerName);
++  const active = await createActor(activeName);
++  const pending = await createActor(pendingName);
++  const outsider = await createActor(`Private Outsider ${suffix.slice(0, 8)}`);
++  const confidential = {
++    description: `PRIVATE_DESCRIPTION_${suffix}`,
++    setting: `PRIVATE_SETTING_${suffix}`,
++    venue: `PRIVATE_VENUE_${suffix}`,
++    address: `PRIVATE_ADDRESS_${suffix}`,
++    audit: `PRIVATE_AUDIT_${suffix}`
++  };
++  const community = await owner.client.rpc('create_community', {
++    p_name: `Private ${suffix.slice(0, 8)}`,
++    p_visibility: 'private',
++    p_description: confidential.description,
++    p_join_policy: 'admin_approval'
++  });
++  if (community.error || typeof community.data !== 'string')
++    throw community.error ?? new Error('Private community fixture creation failed');
++  const communityId = community.data;
++  const ownerCommunity = await owner.client
++    .from('communities')
++    .update({ settings: { confidential: confidential.setting } })
++    .eq('id', communityId);
++  if (ownerCommunity.error) throw ownerCommunity.error;
++  const activeMembership = await owner.client
++    .from('community_members')
++    .insert({ community_id: communityId, user_id: active.id, role: 'member', status: 'active' })
++    .select('id')
++    .single();
++  if (activeMembership.error) throw activeMembership.error;
++  const pendingMembership = await owner.client
++    .from('community_members')
++    .insert({ community_id: communityId, user_id: pending.id, role: 'member', status: 'pending' })
++    .select('id')
++    .single();
++  if (pendingMembership.error) throw pendingMembership.error;
++  const venue = await owner.client
++    .from('community_venues')
++    .insert({
++      community_id: communityId,
++      name: confidential.venue,
++      address: confidential.address,
++      maps_url: 'https://maps.example.test/private'
++    })
++    .select('id')
++    .single();
++  if (venue.error) throw venue.error;
++  const auditRows = await owner.client
++    .from('community_audit_log')
++    .select('id, entity_id')
++    .eq('community_id', communityId);
++  if (auditRows.error || !auditRows.data?.length)
++    throw auditRows.error ?? new Error('Expected private community audit fixture');
++  const ownerRoster = await owner.client.rpc('search_community_members', {
++    p_community_id: communityId,
++    p_query: '',
++    p_offset: 0,
++    p_limit: 50
++  });
++  if (
++    ownerRoster.error ||
++    !ownerRoster.data?.some((row: { user_id: string }) => row.user_id === active.id)
++  )
++    throw ownerRoster.error ?? new Error('Owner could not observe confidential roster fixture');
++
++  const base = `/community/${communityId}/admin`;
++  const destinations = [
++    `${base}/requests`,
++    `${base}/members`,
++    `${base}/members/${activeMembership.data.id}`,
++    `${base}/settings`,
++    `${base}/venues`,
++    `${base}/audit`
++  ];
++  const sentinels = [
++    activeName,
++    pendingName,
++    confidential.description,
++    confidential.setting,
++    confidential.venue,
++    confidential.address,
++    pendingMembership.data.id,
++    venue.data.id,
++    ...auditRows.data
++      .flatMap((row: { id: string; entity_id: string }) => [row.id, row.entity_id])
++      .filter((id: string) => id !== communityId && id !== activeMembership.data.id)
++  ];
++
++  // Owner must be able to observe fixture values before the same payloads are tested against denials.
++  const ownerContext = await browser.newContext();
++  const ownerPage = await ownerContext.newPage();
++  await signIn(ownerPage, owner);
++  await ownerPage.goto(`${base}/venues`);
++  await waitForHydratedPage(ownerPage);
++  await expect(ownerPage.getByRole('heading', { name: confidential.venue })).toBeVisible();
++  await ownerPage.goto(`${base}/members`);
++  await waitForHydratedPage(ownerPage);
++  await expect(ownerPage.getByText(activeName)).toBeVisible();
++  await ownerPage.goto(`${base}/settings`);
++  await waitForHydratedPage(ownerPage);
++  await ownerPage.getByText(en.communityAdmin.settings.details).click();
++  await expect(ownerPage.locator('#community-admin-description')).toHaveValue(
++    confidential.description
++  );
++  await ownerContext.close();
++
++  const guestContext = await browser.newContext();
++  const guestPage = await guestContext.newPage();
++  await assertNoConfidentialPayload(guestPage, destinations, sentinels);
++  await guestContext.close();
++  for (const actor of [active, pending, outsider]) {
++    const context = await browser.newContext();
++    const page = await context.newPage();
++    await signIn(page, actor);
++    await assertNoConfidentialPayload(page, destinations, sentinels);
++    await context.close();
++  }
++});
++
++const narrowDestinations = [
++  'requests',
++  'members',
++  'member',
++  'settings',
++  'venues',
++  'audit'
++] as const;
++const narrowLocales = [
++  ['en', en],
++  ['pt-BR', pt],
++  ['es', es]
++] as const;
++
++test.describe('community admin 320px locale matrix', () => {
++  test.use({ viewport: { width: 320, height: 844 } });
++
++  for (const destination of narrowDestinations) {
++    for (const [locale] of narrowLocales) {
++      test(`${destination} heading and controls fit at 320px (${locale})`, async ({ page }) => {
++        test.setTimeout(120_000);
++        const owner = await createActor(`Narrow ${destination} ${locale}`);
++        const applicant = await createActor(`Narrow applicant ${destination} ${locale}`);
++        const requester = await createActor(`Narrow requester ${destination} ${locale}`);
++        const created = await owner.client.rpc('create_community', {
++          p_name: `Narrow ${crypto.randomUUID().slice(0, 6)}`,
++          p_visibility: 'public',
++          p_join_policy: 'admin_approval'
++        });
++        if (created.error || typeof created.data !== 'string')
++          throw created.error ?? new Error('Narrow-screen community fixture creation failed');
++        const communityId = created.data;
++        const base = `/community/${communityId}/admin`;
++        const active = await owner.client
++          .from('community_members')
++          .insert({
++            community_id: communityId,
++            user_id: applicant.id,
++            role: 'member',
++            status: 'active'
++          })
++          .select('id')
++          .single();
++        if (active.error) throw active.error;
++        const pending = await owner.client
++          .from('community_members')
++          .insert({
++            community_id: communityId,
++            user_id: requester.id,
++            role: 'member',
++            status: 'pending'
++          })
++          .select('id')
++          .single();
++        if (pending.error) throw pending.error;
++        const venue = await owner.client.from('community_venues').insert({
++          community_id: communityId,
++          name: 'Narrow court',
++          address: 'Madrid',
++          maps_url: 'https://maps.example.test/narrow'
++        });
++        if (venue.error) throw venue.error;
++
++        await signIn(page, owner);
++        await page.locator('#locale').selectOption(locale);
++        await expect(page.locator('html')).toHaveAttribute('lang', locale);
++        const path =
++          destination === 'member' ? `${base}/members/${active.data.id}` : `${base}/${destination}`;
++        await page.goto(path);
++        await waitForHydratedPage(page);
++        const localeCopy = locale === 'pt-BR' ? pt : locale === 'es' ? es : en;
++        const localeControl = page.locator('#locale');
++        await expect(localeControl).toBeVisible();
++        await expect(localeControl).toHaveAccessibleName(localeCopy.language);
++        const titleKey = destination === 'member' ? 'member' : destination;
++        const screenHeading = page.getByRole('heading', {
++          name: localeCopy.communityAdmin.title[titleKey],
++          exact: true
++        });
++        await expect(screenHeading).toHaveCount(1);
++        await expect(screenHeading).toBeVisible();
++        if (destination === 'settings') {
++          await page.getByText(localeCopy.communityAdmin.settings.details).click();
++          await expect(page.locator('#community-admin-description')).toBeVisible();
++        }
++        if (destination === 'requests')
++          await expect(
++            page.getByText(`Narrow requester ${destination} ${locale}`, { exact: true })
++          ).toBeVisible();
++        if (destination === 'venues')
++          await expect(page.getByRole('heading', { name: 'Narrow court' })).toBeVisible();
++        if (destination === 'audit')
++          await expect(page.getByTestId('community-audit-event').first()).toBeVisible();
++
++        const dimensions = await page.evaluate(() => ({
++          document: document.documentElement.scrollWidth,
++          main: document.querySelector('main')?.scrollWidth ?? 0,
++          viewport: document.documentElement.clientWidth
++        }));
++        expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
++        expect(dimensions.main).toBeLessThanOrEqual(dimensions.viewport);
++        const adminNavigation = page.getByRole('navigation', {
++          name: localeCopy.communityAdmin.navigation
++        });
++        const contentControls = page.locator(
++          'main button:visible:not(nav button), main a:visible:not(nav a), main input:visible:not(nav input), main select:visible:not(nav select), main textarea:visible:not(nav textarea)'
++        );
++        const navigationControls = adminNavigation.locator(
++          'button:visible, a:visible, input:visible, select:visible, textarea:visible'
++        );
++        const controls = contentControls.or(navigationControls);
++        for (const control of await controls.all()) {
++          const box = await control.boundingBox();
++          expect(box, 'visible interactive control must have a hit region').not.toBeNull();
++          const accessibleName =
++            (await control.getAttribute('aria-label')) ?? (await control.innerText());
++          expect(box!.width, `interactive control ${accessibleName}`).toBeGreaterThanOrEqual(44);
++          expect(box!.height, `interactive control ${accessibleName}`).toBeGreaterThanOrEqual(44);
++        }
++        const nav = adminNavigation;
++        const navBox = await nav.boundingBox();
++        expect(navBox).not.toBeNull();
++        for (const control of await contentControls.all()) {
++          await control.scrollIntoViewIfNeeded();
++          const box = await control.boundingBox();
++          expect(box, 'scrolled interactive control must have a hit region').not.toBeNull();
++          const overlapsBottomNav =
++            box!.y < navBox!.y + navBox!.height && box!.y + box!.height > navBox!.y;
++          expect(
++            overlapsBottomNav,
++            'scrolled interactive control must not be obscured by bottom navigation'
++          ).toBe(false);
++        }
++        await page.keyboard.press('Tab');
++        await expect(page.locator(':focus')).toHaveCount(1);
++        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
++        await expect(nav).toBeVisible();
++        const lastControl = contentControls.last();
++        await lastControl.scrollIntoViewIfNeeded();
++        const finalControl = await lastControl.boundingBox();
++        expect(finalControl, 'last interactive action must remain visible').not.toBeNull();
++        expect(finalControl!.y + finalControl!.height).toBeLessThanOrEqual(navBox!.y);
++      });
++    }
++  }
++});
+diff --git a/e2e/community-onboarding.spec.ts b/e2e/community-onboarding.spec.ts
+index 12e7e35..8dc3ee3 100644
+--- a/e2e/community-onboarding.spec.ts
++++ b/e2e/community-onboarding.spec.ts
+@@ -1,6 +1,6 @@
+ import { createHash } from 'node:crypto';
+ import { readFileSync } from 'node:fs';
+-import { expect, test, type Locator, type Page } from '@playwright/test';
++import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
+ import { createClient } from '@supabase/supabase-js';
+ import { submitAndWaitForAuthDestination, waitForHydratedPage } from './auth-helpers';
+
+@@ -33,7 +33,10 @@ type LocaleCopy = {
+     created: string;
+     finish: string;
+     emptySearch: string;
++    searchLoading: string;
++    loadFailed: string;
+     searchLabel: string;
++    descriptionLabel: string;
+     openJoin: string;
+     join: string;
+     requestToJoin: string;
+@@ -118,6 +121,77 @@ async function geometry(
+   }
+ }
+
++function assertDecodedImage(
++  expected: { width: number; height: number; bytes: number },
++  actual: { width: number; height: number; bytes: number },
++  endY: number,
++  masks: [number, number, number, number][]
++) {
++  expect(expected.width).toBe(390);
++  expect(expected.height).toBe(844);
++  expect(actual.width).toBe(390);
++  expect(actual.height).toBe(844);
++  expect(expected).toEqual(actual);
++  expect(expected.bytes).toBe(expected.width * expected.height * 4);
++  expect(actual.bytes).toBe(actual.width * actual.height * 4);
++  expect(endY).toBeGreaterThanOrEqual(0);
++  expect(endY).toBeLessThanOrEqual(expected.height);
++  for (const [left, top, width, height] of masks) {
++    expect([left, top, width, height].every(Number.isInteger)).toBe(true);
++    expect(left).toBeGreaterThanOrEqual(0);
++    expect(top).toBeGreaterThanOrEqual(0);
++    expect(width).toBeGreaterThan(0);
++    expect(height).toBeGreaterThan(0);
++    expect(left + width).toBeLessThanOrEqual(expected.width);
++    expect(top + height).toBeLessThanOrEqual(endY);
++  }
++}
++
++async function assertRawLocale(
++  page: Page,
++  response: Awaited<ReturnType<Page['goto']>>,
++  locale: string,
++  title: string
++) {
++  expect(response, 'navigation must return an HTML response').not.toBeNull();
++  expect(response!.ok()).toBeTruthy();
++  expect(response!.headers()['content-type']).toContain('text/html');
++  await assertRawMarkupLocale(page, await response!.text(), locale, title);
++}
++
++async function assertRawMarkupLocale(page: Page, markup: string, locale: string, title: string) {
++  const actual = await page.evaluate((source) => {
++    const detached = new DOMParser().parseFromString(source, 'text/html');
++    return {
++      lang: detached.documentElement.lang,
++      heading: detached.querySelector('h1')?.textContent?.trim()
++    };
++  }, markup);
++  expect(actual.lang).toBe(locale);
++  expect(actual.heading).toBe(title);
++}
++
++async function typography(
++  locator: Locator,
++  expected: { family: string; size: string; weight: string; lineHeight: string; color: string }
++) {
++  const styles = await locator.evaluate((element) => {
++    const style = getComputedStyle(element);
++    return {
++      family: style.fontFamily,
++      size: style.fontSize,
++      weight: style.fontWeight,
++      lineHeight: style.lineHeight,
++      color: style.color
++    };
++  });
++  expect(styles.family).toContain(expected.family);
++  expect(styles.size).toBe(expected.size);
++  expect(styles.weight).toBe(expected.weight);
++  expect(styles.lineHeight).toBe(expected.lineHeight);
++  expect(styles.color).toBe(expected.color);
++}
++
+ // Only fixture-dependent glyphs are excluded: search text, two names, city/policy
+ // metadata and Pencil's unavailable member/level examples. Card edges and both
+ // card action labels remain compared. Source PNG and baseline bytes stay untouched.
+@@ -125,7 +199,9 @@ async function visualDiff(
+   page: Page,
+   name: keyof typeof references,
+   masks: [number, number, number, number][],
+-  endY = 844
++  endY = 844,
++  testInfo?: TestInfo,
++  region = 'full'
+ ) {
+   const source = readFileSync(new URL(`./references/paf-30/${name}`, import.meta.url));
+   const baseline = readFileSync(
+@@ -134,7 +210,7 @@ async function visualDiff(
+   expect(createHash('sha256').update(source).digest('hex')).toBe(references[name]);
+   expect(baseline).toEqual(source);
+   const actual = await page.screenshot({ animations: 'disabled', caret: 'hide' });
+-  const different = await page.evaluate(
++  const comparison = await page.evaluate(
+     async ({ expected, received, masks: maskAreas, endY: lastRow }) => {
+       const decode = async (base64: string) => {
+         const image = new Image();
+@@ -145,12 +221,74 @@ async function visualDiff(
+         canvas.height = image.height;
+         const context = canvas.getContext('2d')!;
+         context.drawImage(image, 0, 0);
+-        return context.getImageData(0, 0, image.width, image.height).data;
++        return {
++          width: image.width,
++          height: image.height,
++          pixels: context.getImageData(0, 0, image.width, image.height).data
++        };
+       };
+       const [a, b] = await Promise.all([decode(expected), decode(received)]);
++      const dimensionsMatch = a.width === b.width && a.height === b.height;
++      if (
++        !dimensionsMatch ||
++        a.width <= 0 ||
++        a.height <= 0 ||
++        b.width <= 0 ||
++        b.height <= 0 ||
++        a.pixels.length !== a.width * a.height * 4 ||
++        b.pixels.length !== b.width * b.height * 4
++      )
++        return {
++          expected: { width: a.width, height: a.height, bytes: a.pixels.length },
++          actual: { width: b.width, height: b.height, bytes: b.pixels.length },
++          count: null,
++          diff: null,
++          error: 'PNG dimensions or RGBA buffer length mismatch'
++        };
++      if (a.width !== 390 || a.height !== 844 || b.width !== 390 || b.height !== 844)
++        return {
++          expected: { width: a.width, height: a.height, bytes: a.pixels.length },
++          actual: { width: b.width, height: b.height, bytes: b.pixels.length },
++          count: null,
++          diff: null,
++          error: 'PNG must be exactly 390×844'
++        };
++      if (!Number.isInteger(lastRow) || lastRow < 0 || lastRow > a.height)
++        return {
++          expected: { width: a.width, height: a.height, bytes: a.pixels.length },
++          actual: { width: b.width, height: b.height, bytes: b.pixels.length },
++          count: null,
++          diff: null,
++          error: 'endY outside decoded image'
++        };
++      for (const [left, top, width, height] of maskAreas) {
++        if (
++          ![left, top, width, height].every(Number.isInteger) ||
++          left < 0 ||
++          top < 0 ||
++          width <= 0 ||
++          height <= 0 ||
++          left + width > a.width ||
++          top + height > a.height ||
++          top + height > lastRow
++        )
++          return {
++            expected: { width: a.width, height: a.height, bytes: a.pixels.length },
++            actual: { width: b.width, height: b.height, bytes: b.pixels.length },
++            count: null,
++            diff: null,
++            error: 'Mask region outside compared image bounds'
++          };
++      }
++      const canvas = document.createElement('canvas');
++      canvas.width = a.width;
++      canvas.height = a.height;
++      const context = canvas.getContext('2d')!;
++      const output = context.createImageData(a.width, a.height);
++      output.data.set(b.pixels);
+       let count = 0;
+       for (let y = 0; y < lastRow; y++)
+-        for (let x = 0; x < 390; x++) {
++        for (let x = 0; x < a.width; x++) {
+           if (
+             maskAreas.some(
+               ([left, top, width, height]) =>
+@@ -158,27 +296,56 @@ async function visualDiff(
+             )
+           )
+             continue;
+-          const i = (y * 390 + x) * 4;
+-          const r = a[i]! - b[i]!,
+-            g = a[i + 1]! - b[i + 1]!,
+-            blue = a[i + 2]! - b[i + 2]!;
++          const i = (y * a.width + x) * 4;
++          const r = a.pixels[i]! - b.pixels[i]!,
++            g = a.pixels[i + 1]! - b.pixels[i + 1]!,
++            blue = a.pixels[i + 2]! - b.pixels[i + 2]!;
+           const deltaY = 0.29889531 * r + 0.58662247 * g + 0.11448223 * blue;
+           const deltaI = 0.59597799 * r - 0.2741761 * g - 0.32180178 * blue;
+           const deltaQ = 0.21147017 * r - 0.52261711 * g + 0.31114694 * blue;
+-          if (0.5053 * deltaY ** 2 + 0.299 * deltaI ** 2 + 0.1957 * deltaQ ** 2 > 35215 * 0.1 ** 2)
+-            count++;
++          const different =
++            0.5053 * deltaY ** 2 + 0.299 * deltaI ** 2 + 0.1957 * deltaQ ** 2 > 35215 * 0.1 ** 2;
++          if (different) count++;
++          output.data[i] = different ? 255 : b.pixels[i]!;
++          output.data[i + 1] = different ? 0 : b.pixels[i + 1]!;
++          output.data[i + 2] = different ? 0 : b.pixels[i + 2]!;
++          output.data[i + 3] = 255;
+         }
+-      return count;
++      context.putImageData(output, 0, 0);
++      return {
++        expected: { width: a.width, height: a.height, bytes: a.pixels.length },
++        actual: { width: b.width, height: b.height, bytes: b.pixels.length },
++        count,
++        diff: canvas.toDataURL('image/png').split(',')[1]!,
++        error: null
++      };
+     },
+     { expected: source.toString('base64'), received: actual.toString('base64'), masks, endY }
+   );
++  await testInfo?.attach(`${name}-${region}-expected`, { body: source, contentType: 'image/png' });
++  await testInfo?.attach(`${name}-${region}-actual`, { body: actual, contentType: 'image/png' });
++  if (comparison.diff)
++    await testInfo?.attach(`${name}-${region}-diff`, {
++      body: Buffer.from(comparison.diff, 'base64'),
++      contentType: 'image/png'
++    });
++  else
++    await testInfo?.attach(`${name}-${region}-diff-unavailable`, {
++      body: comparison.error ?? 'Diff unavailable',
++      contentType: 'text/plain'
++    });
++  if (!comparison.error) assertDecodedImage(comparison.expected, comparison.actual, endY, masks);
++  expect(comparison.error, `visual comparator rejected ${name}: ${comparison.error}`).toBeNull();
++  expect(comparison.count).not.toBeNull();
+   expect(
+     readFileSync(new URL(`./community-onboarding.spec.ts-snapshots/${name}`, import.meta.url))
+   ).toEqual(source);
+-  return different;
++  return comparison.count!;
+ }
+
+-test('Pencil structure: discovery and create preserve exact CSS boxes', async ({ page }) => {
++test('Pencil structure: discovery and create preserve exact CSS boxes', async ({
++  page
++}, testInfo) => {
+   await player(page);
+   await page.evaluate(() => document.fonts.ready);
+   await geometry(page.locator('main > div').first().locator('span').first(), {
+@@ -230,7 +397,7 @@ test('Pencil structure: discovery and create preserve exact CSS boxes', async ({
+     width: 354,
+     height: 44
+   });
+-  const upper = await visualDiff(page, 'community-create.png', [], 448);
++  const upper = await visualDiff(page, 'community-create.png', [], 448, testInfo, 'upper-create');
+   console.log(`JO4DC unaffected region: ${upper}/174720 (${((upper / 174720) * 100).toFixed(3)}%)`);
+   // Cross-platform cap: macOS 12,611/174,720 = 7.218%; Linux CI 14,863/174,720 = 8.507%;
+   // worse (Linux) residual + 0.15pp headroom. Residual is Pencil/Chromium glyph
+@@ -238,7 +405,7 @@ test('Pencil structure: discovery and create preserve exact CSS boxes', async ({
+   expect(upper / 174720).toBeLessThanOrEqual(0.0866);
+ });
+
+-test('create view compares against JO4DC Pencil reference', async ({ page }) => {
++test('create view compares against JO4DC Pencil reference', async ({ page }, testInfo) => {
+   await player(page);
+   await page.goto('/onboarding/community?view=create');
+   await waitForHydratedPage(page);
+@@ -258,7 +425,14 @@ test('create view compares against JO4DC Pencil reference', async ({ page }) =>
+       animations: 'disabled',
+       caret: 'hide'
+     });
+-    const different = await visualDiff(page, 'community-create.png', []);
++    const different = await visualDiff(
++      page,
++      'community-create.png',
++      [],
++      844,
++      testInfo,
++      'full-create'
++    );
+     console.log(
+       `JO4DC visual residual: ${different}/329160 (${((different / 329160) * 100).toFixed(3)}%)`
+     );
+@@ -273,7 +447,7 @@ test('create view compares against JO4DC Pencil reference', async ({ page }) =>
+
+ test('discovery view compares card structure and actions against dSEX3 Pencil reference', async ({
+   page
+-}) => {
++}, testInfo) => {
+   const email = await player(page);
+   const city = `Visual${crypto.randomUUID().slice(0, 8)}`;
+   const client = localClient();
+@@ -295,7 +469,7 @@ test('discovery view compares card structure and actions against dSEX3 Pencil re
+   await page.getByRole('searchbox', { name: en.communityOnboarding.searchLabel }).fill(city);
+   await expect(page).toHaveURL(/q=Visual/);
+   const cards = page
+-    .locator('main > div:last-child > div')
++    .locator('main > div:last-child [aria-busy="false"] > div')
+     .filter({ has: page.getByRole('heading', { level: 3 }) });
+   await expect(cards).toHaveCount(2);
+   await expect(
+@@ -304,12 +478,42 @@ test('discovery view compares card structure and actions against dSEX3 Pencil re
+   await page.evaluate(() => document.fonts.ready);
+   await geometry(cards.nth(0), { x: 18, y: 240, width: 354, height: 142 });
+   await geometry(cards.nth(1), { x: 18, y: 392, width: 354, height: 142 });
++  const firstTitle = cards.nth(0).getByRole('heading', { level: 3 });
++  const secondTitle = cards.nth(1).getByRole('heading', { level: 3 });
++  const firstMeta = cards.nth(0).locator('p');
++  const secondMeta = cards.nth(1).locator('p');
++  // Pencil dSEX3 source: content inset 14; name box 19px high; 7px vertical gap;
++  // metadata box 15px high. Current text block fills the 326px card content column.
++  await geometry(firstTitle, { x: 32, y: 254, width: 326, height: 19 });
++  await geometry(firstMeta, { x: 32, y: 280, width: 326, height: 15 });
++  await geometry(secondTitle, { x: 32, y: 406, width: 326, height: 19 });
++  await geometry(secondMeta, { x: 32, y: 432, width: 326, height: 15 });
++  for (const title of [firstTitle, secondTitle])
++    await typography(title, {
++      family: 'Manrope',
++      size: '14px',
++      weight: '700',
++      lineHeight: 'normal',
++      color: 'rgb(18, 37, 29)'
++    });
++  for (const meta of [firstMeta, secondMeta])
++    await typography(meta, {
++      family: 'Inter',
++      size: '12px',
++      weight: '400',
++      lineHeight: 'normal',
++      color: 'rgb(92, 107, 98)'
++    });
+   await geometry(cards.nth(0).getByRole('button', { name: en.communityOnboarding.join }), {
+     x: 32,
++    y: 324,
++    width: 326,
+     height: 44
+   });
+   await geometry(cards.nth(1).getByRole('button', { name: en.communityOnboarding.requestToJoin }), {
+     x: 32,
++    y: 476,
++    width: 326,
+     height: 44
+   });
+   await geometry(page.getByRole('button', { name: en.communityOnboarding.createEntry }), {
+@@ -324,11 +528,18 @@ test('discovery view compares card structure and actions against dSEX3 Pencil re
+     width: 354,
+     height: 44
+   });
+-  const different = await visualDiff(page, 'community-discovery.png', [
+-    [30, 198, 310, 23],
+-    [31, 252, 308, 65],
+-    [31, 404, 308, 65]
+-  ]);
++  const different = await visualDiff(
++    page,
++    'community-discovery.png',
++    [
++      [30, 198, 310, 23],
++      [31, 252, 308, 65],
++      [31, 404, 308, 65]
++    ],
++    844,
++    testInfo,
++    'discovery'
++  );
+   console.log(
+     `dSEX3 visual residual: ${different}/329160 (${((different / 329160) * 100).toFixed(3)}%)`
+   );
+@@ -351,6 +562,75 @@ test('live search keeps keyboard focus across debounce and server results', asyn
+   await expect(input).toBeFocused();
+ });
+
++test('search announces pending loader and settles after deterministic response release', async ({
++  page
++}) => {
++  await player(page);
++  let release!: () => void;
++  let signalRequest!: () => void;
++  const responseGate = new Promise<void>((resolve) => (release = resolve));
++  const requestSeen = new Promise<void>((resolve) => (signalRequest = resolve));
++  await page.route(
++    /\/_serverFn\/6cf6671334014b970362dc54c0cce26a91d4da36e41403af07a6c0cf2750fa7d(?:\?.*)?$/,
++    async (route) => {
++      signalRequest();
++      await responseGate;
++      await route.continue();
++    }
++  );
++  const input = page.getByRole('searchbox', { name: en.communityOnboarding.searchLabel });
++  await input.fill(`Pending${crypto.randomUUID().slice(0, 6)}`);
++  await requestSeen;
++  await expect(page.getByRole('status')).toHaveText(en.communityOnboarding.searchLoading);
++  await expect(page.locator('div[aria-busy="true"]')).toHaveCount(1);
++  expect(
++    await page.getByRole('status').evaluate((status) => status.closest('[aria-busy="true"]'))
++  ).toBeNull();
++  await expect(page.getByText(en.communityOnboarding.emptySearch)).toHaveCount(0);
++  await expect(input).toBeEnabled();
++  await expect(input).toBeFocused();
++  release();
++  await expect(page.locator('[aria-busy="false"]')).toHaveCount(1);
++  await expect(page.getByRole('status')).not.toHaveText(en.communityOnboarding.searchLoading);
++});
++
++test('retry reports pending, blocks duplicate invalidation, and recovers from one controlled failure', async ({
++  page
++}) => {
++  await player(page);
++  let calls = 0;
++  let release!: () => void;
++  let signalRetry!: () => void;
++  const retryGate = new Promise<void>((resolve) => (release = resolve));
++  const retrySeen = new Promise<void>((resolve) => (signalRetry = resolve));
++  await page.route(
++    /\/_serverFn\/6cf6671334014b970362dc54c0cce26a91d4da36e41403af07a6c0cf2750fa7d(?:\?.*)?$/,
++    async (route) => {
++      calls++;
++      if (calls === 1) {
++        await route.fulfill({ status: 500, body: 'controlled loader failure' });
++        return;
++      }
++      signalRetry();
++      await retryGate;
++      await route.continue();
++    }
++  );
++  const input = page.getByRole('searchbox', { name: en.communityOnboarding.searchLabel });
++  await input.fill(`Retry${crypto.randomUUID().slice(0, 6)}`);
++  await expect(page.getByRole('alert')).toHaveText(en.communityOnboarding.loadFailed);
++  const retry = page.getByRole('button', { name: en.communityOnboarding.retry });
++  await retry.click();
++  await retrySeen;
++  await expect(page.getByRole('status')).toHaveText(en.communityOnboarding.searchLoading);
++  await expect(page.locator('div[aria-busy="true"]')).toHaveCount(1);
++  await expect(retry).toBeDisabled();
++  release();
++  await expect(page.locator('[aria-busy="false"]')).toHaveCount(1);
++  await expect(page.getByRole('alert')).toHaveCount(0);
++  expect(calls).toBe(2);
++});
++
+ test('successful create resets after browser Back and create re-entry', async ({ page }) => {
+   await player(page);
+   const search = page.getByRole('searchbox', { name: en.communityOnboarding.searchLabel });
+@@ -440,13 +720,12 @@ test('SSR and hydration preserve locale across both views at 320px', async ({ pa
+       .addCookies([{ name: 'locale', value: locale, url: 'http://127.0.0.1:4173' }]);
+     for (const path of ['/onboarding/community', '/onboarding/community?view=create']) {
+       const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
+-      expect(response?.status()).toBeLessThan(400);
+       const title = path.includes('create')
+         ? copy.communityOnboarding.createTitle
+         : copy.communityOnboarding.title;
+-      await expect(page.locator('html')).toHaveAttribute('lang', locale);
+-      await expect(page.getByRole('heading', { name: title })).toBeVisible();
++      await assertRawLocale(page, response, locale, title);
+       await waitForHydratedPage(page);
++      await expect(page.locator('html')).toHaveAttribute('lang', locale);
+       await expect(page.getByRole('heading', { name: title })).toBeVisible();
+       expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
+         320
+@@ -455,6 +734,62 @@ test('SSR and hydration preserve locale across both views at 320px', async ({ pa
+   }
+ });
+
++test('raw locale oracle rejects English SSR even when live DOM is Portuguese', async ({ page }) => {
++  await page.setContent('<html lang="pt-BR"><body><h1>Comunidades</h1></body></html>');
++  await expect(
++    assertRawMarkupLocale(
++      page,
++      '<html lang="en"><body><h1>Communities</h1></body></html>',
++      'pt-BR',
++      'Comunidades'
++    )
++  ).rejects.toThrow();
++  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
++  await expect(page.locator('h1')).toHaveText('Comunidades');
++});
++
++test('optional labels stay visible and inputs remain usable at 320px in every locale', async ({
++  page
++}) => {
++  await player(page);
++  await page.setViewportSize({ width: 320, height: 844 });
++  for (const locale of ['en', 'pt-BR', 'es'] as const) {
++    const copy: LocaleCopy = JSON.parse(
++      readFileSync(new URL(`../src/locales/${locale}/translation.json`, import.meta.url), 'utf8')
++    );
++    await page
++      .context()
++      .addCookies([{ name: 'locale', value: locale, url: 'http://127.0.0.1:4173' }]);
++    await page.goto('/onboarding/community?view=create');
++    await waitForHydratedPage(page);
++    for (const [id, label] of [
++      ['community-description', copy.communityOnboarding.descriptionLabel],
++      ['community-city', copy.communityOnboarding.cityLabel]
++    ] as const) {
++      const input = page.locator(`#${id}`);
++      const associated = page.getByText(label, { exact: true });
++      await input.fill('Entered value');
++      await expect(associated).toBeVisible();
++      await expect(input).toHaveAttribute('id', id);
++      await expect(associated).toHaveAttribute('for', id);
++      const measured = await input.evaluate((node) => {
++        const inputRect = node.getBoundingClientRect();
++        const fieldLabel = document.querySelector(`label[for="${node.id}"]`)!;
++        const labelRect = fieldLabel.getBoundingClientRect();
++        return {
++          inputHeight: inputRect.height,
++          overlap: labelRect.bottom > inputRect.top + inputRect.height / 2
++        };
++      });
++      expect(measured.inputHeight).toBeGreaterThanOrEqual(44);
++      expect(measured.overlap).toBe(false);
++    }
++    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
++      320
++    );
++  }
++});
++
+ test('create path validates then creates real public and private communities', async ({ page }) => {
+   await player(page);
+   await page.getByRole('button', { name: en.communityOnboarding.createEntry }).click();
+@@ -509,7 +844,7 @@ test('city search finds real public community; join follows instant vs approval
+     await expect(joiner).toHaveURL(/q=City/);
+     await expect(joiner.getByText(`${city} · ${en.communityOnboarding.openJoin}`)).toBeVisible();
+     const cards = joiner
+-      .locator('main > div:last-child > div')
++      .locator('main > div:last-child [aria-busy="false"] > div')
+       .filter({ has: joiner.getByRole('heading', { level: 3 }) });
+     await geometry(cards.nth(0), { x: 18, y: 240, width: 354, height: 142 });
+     await geometry(cards.nth(1), { x: 18, y: 392, width: 354, height: 142 });
+@@ -570,3 +905,117 @@ test('Pencil references and baselines retain provenance', () => {
+     expect(baseline).toEqual(source);
+   }
+ });
++
++test('visual comparator synthetic canvas PNGs validate dimensions, regions and changed pixels', async ({
++  page
++}) => {
++  const result = await page.evaluate(async () => {
++    const png = (width: number, height: number, changed = false) => {
++      const canvas = document.createElement('canvas');
++      canvas.width = width;
++      canvas.height = height;
++      const context = canvas.getContext('2d')!;
++      context.fillStyle = '#fff';
++      context.fillRect(0, 0, width, height);
++      if (changed) {
++        context.fillStyle = '#000';
++        context.fillRect(7, 8, 1, 1);
++      }
++      return canvas.toDataURL('image/png');
++    };
++    const decode = async (source: string) => {
++      const image = new Image();
++      image.src = source;
++      await image.decode();
++      const canvas = document.createElement('canvas');
++      canvas.width = image.width;
++      canvas.height = image.height;
++      const context = canvas.getContext('2d')!;
++      context.drawImage(image, 0, 0);
++      const pixels = context.getImageData(0, 0, image.width, image.height).data;
++      const offset = (8 * image.width + 7) * 4;
++      return {
++        width: image.width,
++        height: image.height,
++        bytes: pixels.length,
++        sample: [...pixels.slice(offset, offset + 4)]
++      };
++    };
++    const baseline = await decode(png(390, 844));
++    const identical = await decode(png(390, 844));
++    const changed = await decode(png(390, 844, true));
++    const widthMismatch = await decode(png(389, 844));
++    const heightMismatch = await decode(png(390, 843));
++    const color = (a: number[], b: number[]) => {
++      const r = a[0]! - b[0]!;
++      const g = a[1]! - b[1]!;
++      const blue = a[2]! - b[2]!;
++      const y = 0.29889531 * r + 0.58662247 * g + 0.11448223 * blue;
++      const i = 0.59597799 * r - 0.2741761 * g - 0.32180178 * blue;
++      const q = 0.21147017 * r - 0.52261711 * g + 0.31114694 * blue;
++      return 0.5053 * y ** 2 + 0.299 * i ** 2 + 0.1957 * q ** 2 > 35215 * 0.1 ** 2;
++    };
++    return {
++      baseline,
++      identical,
++      changed,
++      widthMismatch,
++      heightMismatch,
++      changedPixel: color(baseline.sample, changed.sample),
++      identicalPixel: color(baseline.sample, identical.sample)
++    };
++  });
++  expect(() => assertDecodedImage(result.baseline, result.identical, 844, [])).not.toThrow();
++  expect(() => assertDecodedImage(result.baseline, result.widthMismatch, 844, [])).toThrow();
++  expect(() => assertDecodedImage(result.baseline, result.heightMismatch, 844, [])).toThrow();
++  expect(() =>
++    assertDecodedImage(result.baseline, result.baseline, 844, [[389, 0, 2, 1]])
++  ).toThrow();
++  expect(result.changedPixel).toBe(true);
++  expect(result.identicalPixel).toBe(false);
++  expect(result.baseline.bytes).toBe(390 * 844 * 4);
++});
++
++test('masked title, metadata and action geometry probes reject displaced fixture nodes', async ({
++  page
++}) => {
++  await page.setContent(
++    '<h3 id="title">Fixture title</h3><p id="metadata">Fixture metadata</p><button id="action">Fixture action</button>'
++  );
++  await page.locator('#title').evaluate((element) =>
++    Object.assign(element.style, {
++      position: 'absolute',
++      left: '40px',
++      top: '260px',
++      width: '326px',
++      height: '19px'
++    })
++  );
++  await page.locator('#metadata').evaluate((element) =>
++    Object.assign(element.style, {
++      position: 'absolute',
++      left: '40px',
++      top: '286px',
++      width: '326px',
++      height: '15px'
++    })
++  );
++  await page.locator('#action').evaluate((element) =>
++    Object.assign(element.style, {
++      position: 'absolute',
++      left: '40px',
++      top: '324px',
++      width: '326px',
++      height: '44px'
++    })
++  );
++  await expect(
++    geometry(page.locator('#title'), { x: 32, y: 254, width: 326, height: 19 })
++  ).rejects.toThrow();
++  await expect(
++    geometry(page.locator('#metadata'), { x: 32, y: 280, width: 326, height: 15 })
++  ).rejects.toThrow();
++  await expect(
++    geometry(page.locator('#action'), { x: 32, y: 324, width: 326, height: 44 })
++  ).rejects.toThrow();
++});
+diff --git a/src/features/community/CommunityAdmin.tsx b/src/features/community/CommunityAdmin.tsx
+index 0be09e0..f137e97 100644
+--- a/src/features/community/CommunityAdmin.tsx
++++ b/src/features/community/CommunityAdmin.tsx
+@@ -1,123 +1,20 @@
+ import * as stylex from '@stylexjs/stylex';
+-import { Link, Outlet, useParams, useRouter } from '@tanstack/react-router';
+-import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
++import { Link, Outlet, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
++import { useState } from 'react';
+ import { useTranslation } from 'react-i18next';
+-import { Button } from '../../components/ui/Button';
+ import { SurfaceCard } from '../../components/ui/SurfaceCard';
+-import { TextField } from '../../components/ui/TextField';
+-import {
+-  approveCommunityMember,
+-  archiveCommunityVenue,
+-  addCommunityVenue,
+-  demoteCommunityMember,
+-  denyCommunityMember,
+-  editCommunityVenue,
+-  listCommunityAudit,
+-  listCommunityVenues,
+-  promoteCommunityMember,
+-  reactivateCommunityMember,
+-  removeCommunityMember,
+-  searchCommunityMembers
+-} from './community-admin.functions';
+-import { updateCommunitySettings } from './community.functions';
+-import type { Database } from '../../lib/supabase/database.types';
+-import type { CommunityMemberSearchResult } from './community-admin.types';
++import type { CommunityAdminScreenProps } from './community-admin.types';
+ import { styles } from './community-admin.styles';
++import { CommunityAdminDispatcher } from './CommunityAdminViews';
+
+-type Context = {
+-  id: string;
+-  name: string;
+-  city_label: string | null;
+-  description: string | null;
+-  visibility: Database['public']['Enums']['community_visibility'];
+-  join_policy: Database['public']['Enums']['community_join_policy'];
+-};
+-type Member = CommunityMemberSearchResult;
+-type Venue = Pick<
+-  Database['public']['Tables']['community_venues']['Row'],
+-  | 'id'
+-  | 'community_id'
+-  | 'name'
+-  | 'address'
+-  | 'maps_url'
+-  | 'photo_path'
+-  | 'created_at'
+-  | 'updated_at'
+-  | 'archived_at'
+->;
+-type Audit = Pick<
+-  Database['public']['Tables']['community_audit_log']['Row'],
+-  'id' | 'actor_user_id' | 'entity' | 'entity_id' | 'action' | 'details' | 'occurred_at'
+->;
+-const EMPTY_MEMBERS: Member[] = [];
+-const EMPTY_VENUES: Venue[] = [];
+-type Screen = 'requests' | 'members' | 'member' | 'settings' | 'venues' | 'audit';
++type Props = CommunityAdminScreenProps;
+
+-type Props = {
+-  screen: Screen;
+-  community: Context;
+-  members?: Member[];
+-  venues?: Venue[];
+-  audit?: Audit[];
+-  membershipId?: string;
+-};
+-
+-function dateLabel(value: string, locale: string) {
++export function dateLabel(value: string, locale: string) {
+   return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
+     new Date(value)
+   );
+ }
+-function auditDateLabel(value: string, locale: string) {
+-  return new Intl.DateTimeFormat(locale, {
+-    dateStyle: 'medium',
+-    timeStyle: 'short',
+-    timeZone: 'UTC'
+-  }).format(new Date(value));
+-}
+-function auditEventKey(event: Audit) {
+-  const action = event.action.toLowerCase();
+-  const details = event.details;
+-  if (
+-    event.entity === 'community_members' &&
+-    action === 'insert' &&
+-    typeof details === 'object' &&
+-    details !== null &&
+-    'status' in details &&
+-    details.status === 'pending'
+-  )
+-    return 'communityAdmin.audit.requestCreated';
+-  if (event.entity === 'community_venues')
+-    return action === 'insert'
+-      ? 'communityAdmin.audit.venueAdded'
+-      : 'communityAdmin.audit.venueUpdated';
+-  if (event.entity === 'community_members')
+-    return action === 'insert'
+-      ? 'communityAdmin.audit.memberAdded'
+-      : 'communityAdmin.audit.memberUpdated';
+-  if (event.entity === 'communities') return 'communityAdmin.audit.settingsUpdated';
+-  if (event.entity === 'community_invitations')
+-    return action === 'insert'
+-      ? 'communityAdmin.audit.invitationAdded'
+-      : 'communityAdmin.audit.invitationUpdated';
+-  return 'communityAdmin.audit.unknown';
+-}
+-function auditMemberDetails(event: Audit) {
+-  if (event.entity !== 'community_members' || typeof event.details !== 'object' || !event.details)
+-    return null;
+-  const role =
+-    'role' in event.details && (event.details.role === 'admin' || event.details.role === 'member')
+-      ? event.details.role
+-      : null;
+-  const status =
+-    'status' in event.details &&
+-    (event.details.status === 'active' ||
+-      event.details.status === 'pending' ||
+-      event.details.status === 'inactive')
+-      ? event.details.status
+-      : null;
+-  return role && status ? { role, status } : null;
+-}
+-function initials(name: string) {
++export function initials(name: string) {
+   return name
+     .trim()
+     .split(/\s+/)
+@@ -125,7 +22,7 @@ function initials(name: string) {
+     .map((part) => part.charAt(0).toLocaleUpperCase())
+     .join('');
+ }
+-function failed(error: unknown) {
++export function failed(error: unknown) {
+   if (!(error instanceof Error)) return 'generic';
+   if (error.message === 'UNAUTHENTICATED') return 'session';
+   if (error.message === 'FINAL_COMMUNITY_ADMIN') return 'finalAdmin';
+@@ -141,10 +38,24 @@ export function CommunityAdminShell() {
+   );
+ }
+
+-export function CommunityAdminDenied({ error }: { error?: unknown }) {
++export function CommunityAdminDenied({ error, reset }: ErrorComponentProps) {
+   const { t } = useTranslation();
++  const router = useRouter();
++  const [busy, setBusy] = useState(false);
+   const denied = error instanceof Error && error.message === 'NOT_COMMUNITY_ADMIN';
+   const missing = error instanceof Error && error.message === 'COMMUNITY_MEMBER_NOT_FOUND';
++  const retry = async () => {
++    if (busy) return;
++    setBusy(true);
++    try {
++      await router.invalidate();
++      reset();
++    } catch {
++      // Keep the error boundary visible when refresh fails.
++    } finally {
++      setBusy(false);
++    }
++  };
+   return (
+     <section {...stylex.props(styles.page)}>
+       <SurfaceCard role="alert" xstyle={styles.card}>
+@@ -166,6 +77,21 @@ export function CommunityAdminDenied({ error }: { error?: unknown }) {
+                 : 'communityAdmin.error.generic'
+           )}
+         </p>
++        <div {...stylex.props(styles.errorActions)}>
++          {!denied && !missing && (
++            <button
++              type="button"
++              disabled={busy}
++              onClick={retry}
++              {...stylex.props(styles.errorAction)}
++            >
++              {t('communityAdmin.retry')}
++            </button>
++          )}
++          <Link to="/dashboard" {...stylex.props(styles.errorAction)}>
++            {t('communityAdmin.backToDashboard')}
++          </Link>
++        </div>
+       </SurfaceCard>
+     </section>
+   );
+@@ -208,868 +134,5 @@ export function CommunityAdminEntries({
+ }
+
+ export function CommunityAdminScreen(props: Props) {
+-  return <CommunityAdminView key={props.community.id} {...props} />;
+-}
+-
+-function CommunityAdminView({
+-  screen,
+-  community,
+-  members = EMPTY_MEMBERS,
+-  venues = EMPTY_VENUES,
+-  audit = [],
+-  membershipId
+-}: Props) {
+-  const { t, i18n } = useTranslation();
+-  const router = useRouter();
+-  const params = useParams({ strict: false });
+-  const communityId = params.communityId ?? '';
+-  const [query, setQuery] = useState('');
+-  const [searchResults, setSearchResults] = useState<{
+-    query: string;
+-    status: Member['status'];
+-    rows: Member[];
+-    hasMore: boolean;
+-  } | null>(null);
+-  const [additionalRequests, setAdditionalRequests] = useState<Member[]>([]);
+-  const [hasLoadedMoreRequests, setHasLoadedMoreRequests] = useState(false);
+-  const [hasMoreRequests, setHasMoreRequests] = useState(members.length === 50);
+-  const [additionalVenues, setAdditionalVenues] = useState<Venue[]>([]);
+-  const [hasLoadedMoreVenues, setHasLoadedMoreVenues] = useState(false);
+-  const [hasMoreVenues, setHasMoreVenues] = useState(venues.length === 50);
+-  const [searchLoading, setSearchLoading] = useState(false);
+-  const [hasLoadedMoreMembers, setHasLoadedMoreMembers] = useState(false);
+-  const searchRequest = useRef(0);
+-  const hasSearchedMembers = useRef(false);
+-  const [additionalAudit, setAdditionalAudit] = useState<Audit[] | null>(null);
+-  const [hasMoreAudit, setHasMoreAudit] = useState(audit.length === 3);
+-  const [memberFilter, setMemberFilter] = useState<Member['status']>('active');
+-  const [busy, setBusy] = useState(false);
+-  const [confirmation, setConfirmation] = useState<{
+-    action: 'demote' | 'remove';
+-    id: string;
+-  } | null>(null);
+-  const [message, setMessage] = useState('');
+-  const [errorKey, setErrorKey] = useState('');
+-  const [settings, setSettings] = useState({
+-    name: community.name,
+-    description: community.description ?? '',
+-    city_label: community.city_label ?? '',
+-    visibility: community.visibility,
+-    join_policy: community.join_policy
+-  });
+-  const [venueDraft, setVenueDraft] = useState({ id: '', name: '', address: '', maps_url: '' });
+-  const [venueFormOpen, setVenueFormOpen] = useState(false);
+-  const locale = i18n.resolvedLanguage || i18n.language;
+-  const memberRatingLabel = (person: Member) => {
+-    if (person.display_level === null || person.reliability_percent === null)
+-      return t('communityAdmin.ratingsUnavailable');
+-    return t('communityAdmin.levelLabel', {
+-      level: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
+-        person.display_level
+-      ),
+-      reliability: new Intl.NumberFormat(locale).format(person.reliability_percent)
+-    });
+-  };
+-  const heading = t(`communityAdmin.title.${screen}`);
+-  const auditRows = additionalAudit === null ? audit : [...audit, ...additionalAudit];
+-  const navItems = [
+-    { key: 'requests', to: '/community/$communityId/admin/requests' },
+-    { key: 'members', to: '/community/$communityId/admin/members' },
+-    { key: 'settings', to: '/community/$communityId/admin/settings' },
+-    { key: 'venues', to: '/community/$communityId/admin/venues' },
+-    { key: 'audit', to: '/community/$communityId/admin/audit' }
+-  ] as const;
+-  const member = members.find((item) => item.membership_id === membershipId);
+-  const submittedQuery = query.trim();
+-  const currentSearch =
+-    searchResults?.query === submittedQuery && searchResults.status === memberFilter
+-      ? searchResults
+-      : null;
+-  const initialActiveResults = submittedQuery === '' && memberFilter === 'active' && !searchResults;
+-  const visibleMembers = currentSearch?.rows ?? (initialActiveResults ? members : []);
+-  const hasMoreMembers = currentSearch?.hasMore ?? (initialActiveResults && members.length === 50);
+-  const searchingMembers =
+-    searchLoading ||
+-    (!initialActiveResults && !currentSearch && searchResults !== null) ||
+-    (submittedQuery !== '' && !currentSearch) ||
+-    (memberFilter !== 'active' && !currentSearch);
+-
+-  useEffect(() => {
+-    setAdditionalRequests([]);
+-    setHasLoadedMoreRequests(false);
+-    setHasMoreRequests(members.length === 50);
+-  }, [members]);
+-  useEffect(() => {
+-    setAdditionalVenues([]);
+-    setHasLoadedMoreVenues(false);
+-    setHasMoreVenues(venues.length === 50);
+-  }, [venues]);
+-
+-  async function refresh() {
+-    setMessage('');
+-    setErrorKey('');
+-    await router.invalidate();
+-  }
+-  async function run(action: () => Promise<unknown>, success: string): Promise<unknown> {
+-    if (busy) return null;
+-    setBusy(true);
+-    setErrorKey('');
+-    setMessage('');
+-    try {
+-      const result = await action();
+-      setAdditionalRequests([]);
+-      setHasLoadedMoreRequests(false);
+-      setHasMoreRequests(members.length === 50);
+-      setAdditionalVenues([]);
+-      setHasLoadedMoreVenues(false);
+-      setHasMoreVenues(venues.length === 50);
+-      setMessage(success);
+-      try {
+-        await router.invalidate();
+-      } catch {
+-        setErrorKey('generic');
+-      }
+-      return result;
+-    } catch (error) {
+-      setErrorKey(failed(error));
+-      return null;
+-    } finally {
+-      setBusy(false);
+-    }
+-  }
+-  async function memberAction(
+-    action: 'approve' | 'deny' | 'remove' | 'reactivate' | 'promote' | 'demote',
+-    id: string
+-  ) {
+-    const data = { community_id: community.id, membership_id: id };
+-    const actions = {
+-      approve: approveCommunityMember,
+-      deny: denyCommunityMember,
+-      remove: removeCommunityMember,
+-      reactivate: reactivateCommunityMember,
+-      promote: promoteCommunityMember,
+-      demote: demoteCommunityMember
+-    };
+-    const result = await run(() => actions[action]({ data }), t(`communityAdmin.result.${action}`));
+-    if (
+-      action === 'reactivate' &&
+-      typeof result === 'object' &&
+-      result !== null &&
+-      'membership_id' in result &&
+-      typeof result.membership_id === 'string'
+-    )
+-      await router.navigate({
+-        to: '/community/$communityId/admin/members/$membershipId',
+-        params: { communityId: community.id, membershipId: result.membership_id }
+-      });
+-  }
+-  function requestMemberAction(
+-    action: 'approve' | 'deny' | 'remove' | 'reactivate' | 'promote' | 'demote',
+-    id: string
+-  ) {
+-    if (action === 'remove' || action === 'demote') setConfirmation({ action, id });
+-    else void memberAction(action, id);
+-  }
+-  function confirmedAction(action: 'demote' | 'remove', id: string) {
+-    setConfirmation(null);
+-    void memberAction(action, id);
+-  }
+-  const actions = (person: Member, requestCard = false): ReactNode => (
+-    <div {...stylex.props(styles.actions, requestCard && styles.requestActions)}>
+-      {confirmation?.id === person.membership_id && (
+-        <>
+-          <output {...stylex.props(styles.copy)}>
+-            {t('communityAdmin.confirm', {
+-              action: t(`communityAdmin.action.${confirmation.action}`),
+-              name: person.display_name
+-            })}
+-          </output>
+-          <Button
+-            busy={busy}
+-            onClick={() => confirmedAction(confirmation.action, person.membership_id)}
+-          >
+-            {t('communityAdmin.confirmAction')}
+-          </Button>
+-          <Button variant="secondary" onClick={() => setConfirmation(null)}>
+-            {t('communityAdmin.cancel')}
+-          </Button>
+-        </>
+-      )}
+-      {person.status === 'pending' && (
+-        <>
+-          <Button busy={busy} onClick={() => requestMemberAction('approve', person.membership_id)}>
+-            {t('communityAdmin.action.approve')}
+-          </Button>
+-          <Button
+-            variant="secondary"
+-            busy={busy}
+-            onClick={() => requestMemberAction('deny', person.membership_id)}
+-          >
+-            {t('communityAdmin.action.deny')}
+-          </Button>
+-        </>
+-      )}
+-      {person.status === 'inactive' && (
+-        <Button busy={busy} onClick={() => requestMemberAction('reactivate', person.membership_id)}>
+-          {t('communityAdmin.action.reactivate')}
+-        </Button>
+-      )}
+-      {person.status === 'active' && person.role === 'member' && (
+-        <Button
+-          variant="secondary"
+-          busy={busy}
+-          xstyle={styles.softAction}
+-          onClick={() => requestMemberAction('promote', person.membership_id)}
+-        >
+-          {t('communityAdmin.action.promote')}
+-        </Button>
+-      )}
+-      {person.status === 'active' && person.role === 'admin' && (
+-        <Button
+-          variant="secondary"
+-          busy={busy}
+-          onClick={() => requestMemberAction('demote', person.membership_id)}
+-        >
+-          {t('communityAdmin.action.demote')}
+-        </Button>
+-      )}
+-      {person.status === 'active' && (
+-        <Button
+-          variant="secondary"
+-          busy={busy}
+-          onClick={() => requestMemberAction('remove', person.membership_id)}
+-        >
+-          {t('communityAdmin.action.remove')}
+-        </Button>
+-      )}
+-    </div>
+-  );
+-  const memberStatus = (person: Member) => t(`communityAdmin.status.${person.status}`);
+-
+-  async function saveSettings(event: FormEvent<HTMLFormElement>) {
+-    event.preventDefault();
+-    await run(
+-      () => updateCommunitySettings({ data: { community_id: community.id, ...settings } }),
+-      t('communityAdmin.result.settings')
+-    );
+-  }
+-  async function saveVenue(event: FormEvent<HTMLFormElement>) {
+-    event.preventDefault();
+-    const data = {
+-      community_id: community.id,
+-      name: venueDraft.name,
+-      address: venueDraft.address || null,
+-      maps_url: venueDraft.maps_url || null
+-    };
+-    const saved = await run(
+-      () =>
+-        venueDraft.id
+-          ? editCommunityVenue({ data: { ...data, venue_id: venueDraft.id } })
+-          : addCommunityVenue({ data }),
+-      t(venueDraft.id ? 'communityAdmin.result.venueUpdated' : 'communityAdmin.result.venueAdded')
+-    );
+-    if (!saved) return;
+-    setVenueFormOpen(false);
+-    setVenueDraft({ id: '', name: '', address: '', maps_url: '' });
+-  }
+-  const fetchMembers = useCallback(
+-    async (filterQuery: string, filterStatus: Member['status'], offset = 0) => {
+-      const requestId = ++searchRequest.current;
+-      hasSearchedMembers.current = true;
+-      setSearchLoading(true);
+-      setErrorKey('');
+-      try {
+-        const results = await searchCommunityMembers({
+-          data: {
+-            community_id: community.id,
+-            query: filterQuery,
+-            status: filterStatus,
+-            offset,
+-            limit: 50
+-          }
+-        });
+-        if (requestId !== searchRequest.current) return;
+-        setSearchResults((previous) => ({
+-          query: filterQuery,
+-          status: filterStatus,
+-          rows:
+-            offset > 0 && previous?.query === filterQuery && previous.status === filterStatus
+-              ? [...previous.rows, ...results]
+-              : results,
+-          hasMore: results.length === 50
+-        }));
+-      } catch (error) {
+-        if (requestId === searchRequest.current) setErrorKey(failed(error));
+-      } finally {
+-        if (requestId === searchRequest.current) setSearchLoading(false);
+-      }
+-    },
+-    [community.id]
+-  );
+-  useEffect(() => {
+-    if (submittedQuery === '' && memberFilter === 'active' && !hasSearchedMembers.current)
+-      return undefined;
+-    const timer = setTimeout(() => void fetchMembers(submittedQuery, memberFilter), 250);
+-    return () => clearTimeout(timer);
+-  }, [fetchMembers, submittedQuery, memberFilter]);
+-  async function loadMoreMembers() {
+-    if (searchLoading || !hasMoreMembers) return;
+-    setHasLoadedMoreMembers(true);
+-    if (currentSearch) {
+-      await fetchMembers(currentSearch.query, currentSearch.status, currentSearch.rows.length);
+-      return;
+-    }
+-    setSearchResults({ query: '', status: 'active', rows: members, hasMore: true });
+-    await fetchMembers('', 'active', members.length);
+-  }
+-  async function loadMoreRequests() {
+-    if (busy || !hasMoreRequests) return;
+-    setBusy(true);
+-    setHasLoadedMoreRequests(true);
+-    try {
+-      const page = await searchCommunityMembers({
+-        data: {
+-          community_id: community.id,
+-          query: '',
+-          status: 'pending',
+-          offset: members.length + additionalRequests.length,
+-          limit: 50
+-        }
+-      });
+-      setAdditionalRequests((previous) => [...previous, ...page]);
+-      setHasMoreRequests(page.length === 50);
+-    } catch (error) {
+-      setErrorKey(failed(error));
+-    } finally {
+-      setBusy(false);
+-    }
+-  }
+-  async function loadMoreVenues() {
+-    if (busy || !hasMoreVenues) return;
+-    setBusy(true);
+-    setHasLoadedMoreVenues(true);
+-    try {
+-      const page = await listCommunityVenues({
+-        data: {
+-          community_id: community.id,
+-          offset: venues.length + additionalVenues.length,
+-          limit: 50
+-        }
+-      });
+-      setAdditionalVenues((previous) => [...previous, ...page]);
+-      setHasMoreVenues(page.length === 50);
+-    } catch (error) {
+-      setErrorKey(failed(error));
+-    } finally {
+-      setBusy(false);
+-    }
+-  }
+-  async function loadMoreAudit() {
+-    if (busy || !hasMoreAudit) return;
+-    setBusy(true);
+-    try {
+-      const page = await listCommunityAudit({
+-        data: { community_id: community.id, offset: auditRows.length, limit: 3 }
+-      });
+-      setAdditionalAudit([...(additionalAudit ?? []), ...page]);
+-      setHasMoreAudit(page.length === 3);
+-    } catch (error) {
+-      setErrorKey(failed(error));
+-    } finally {
+-      setBusy(false);
+-    }
+-  }
+-
+-  async function retry() {
+-    if (screen === 'members') await fetchMembers(submittedQuery, memberFilter);
+-    else await refresh();
+-  }
+-
+-  return (
+-    <section
+-      aria-labelledby="admin-screen-title"
+-      {...stylex.props(styles.content, screen === 'venues' && styles.venueContent)}
+-    >
+-      <header {...stylex.props(styles.header)}>
+-        <div {...stylex.props(styles.screenHeading)}>
+-          <Link
+-            to="/dashboard"
+-            aria-label={t('communityAdmin.backToDashboard')}
+-            {...stylex.props(styles.backLink)}
+-          >
+-            <span aria-hidden="true">‹</span>
+-          </Link>
+-          <div {...stylex.props(styles.titleGroup)}>
+-            <h1 id="admin-screen-title" {...stylex.props(styles.title)}>
+-              {heading}
+-            </h1>
+-            <p {...stylex.props(styles.subtitle)}>
+-              {t('communityAdmin.communityAdminSubtitle', { community: community.name })}
+-            </p>
+-          </div>
+-        </div>
+-      </header>
+-      {screen === 'requests' && (
+-        <>
+-          <p {...stylex.props(styles.banner)}>{t('communityAdmin.requestBanner')}</p>
+-          <div {...stylex.props(styles.list)}>
+-            {[...members, ...additionalRequests].map((person) => (
+-              <SurfaceCard key={person.membership_id} xstyle={[styles.card, styles.requestCard]}>
+-                <h3 {...stylex.props(styles.cardCompactTitle)}>{person.display_name}</h3>
+-                <p {...stylex.props(styles.copy)}>{memberRatingLabel(person)}</p>
+-                <p {...stylex.props(styles.copy, styles.requestMeta)}>
+-                  {t('communityAdmin.requestMeta', {
+-                    date: dateLabel(person.valid_from, locale),
+-                    privacy: t('communityAdmin.requestPrivacy')
+-                  })}
+-                </p>
+-                {actions(person, true)}
+-              </SurfaceCard>
+-            ))}
+-            {!members.length && !additionalRequests.length && (
+-              <p>{t('communityAdmin.empty.requests')}</p>
+-            )}
+-            {hasMoreRequests ? (
+-              <Button variant="secondary" busy={busy} onClick={() => void loadMoreRequests()}>
+-                {t('communityAdmin.loadMore')}
+-              </Button>
+-            ) : (
+-              hasLoadedMoreRequests && (
+-                <p {...stylex.props(styles.copy)}>{t('communityAdmin.endOfList')}</p>
+-              )
+-            )}
+-            <p {...stylex.props(styles.note)}>{t('communityAdmin.requestHistoryUnavailable')}</p>
+-          </div>
+-        </>
+-      )}
+-      {screen === 'members' && (
+-        <>
+-          <Button disabled xstyle={styles.unavailableInvite}>
+-            {t('communityAdmin.inviteUnavailable')}
+-          </Button>
+-          <form
+-            onSubmit={(event) => {
+-              event.preventDefault();
+-            }}
+-            {...stylex.props(styles.searchForm)}
+-          >
+-            <div {...stylex.props(styles.searchField)}>
+-              <TextField
+-                id="admin-member-search"
+-                label={
+-                  <span {...stylex.props(styles.visuallyHidden)}>
+-                    {t('communityAdmin.searchLabel')}
+-                  </span>
+-                }
+-                type="search"
+-                value={query}
+-                placeholder={t('communityAdmin.searchPlaceholder')}
+-                onChange={(event) => setQuery(event.target.value)}
+-              />
+-            </div>
+-          </form>
+-          <fieldset
+-            aria-label={t('communityAdmin.memberFilters')}
+-            {...stylex.props(styles.filterTabs)}
+-          >
+-            {(['active', 'pending', 'inactive'] as const).map((status) => (
+-              <button
+-                key={status}
+-                type="button"
+-                aria-pressed={memberFilter === status}
+-                onClick={() => {
+-                  setMemberFilter(status);
+-                }}
+-                {...stylex.props(
+-                  styles.filterTab,
+-                  memberFilter === status && styles.filterTabSelected
+-                )}
+-              >
+-                {t(`communityAdmin.status.${status}`)}
+-              </button>
+-            ))}
+-          </fieldset>
+-          {searchingMembers && (
+-            <output aria-live="polite" {...stylex.props(styles.copy)}>
+-              {t('communityAdmin.searchLoading')}
+-            </output>
+-          )}
+-          <div {...stylex.props(styles.list, styles.memberList)}>
+-            {visibleMembers.map((person) => (
+-              <SurfaceCard
+-                key={person.membership_id}
+-                data-testid="community-member-card"
+-                xstyle={[styles.card, styles.memberCard]}
+-              >
+-                <span aria-hidden="true" {...stylex.props(styles.avatar)}>
+-                  {initials(person.display_name)}
+-                </span>
+-                <div {...stylex.props(styles.memberDetails)}>
+-                  <div {...stylex.props(styles.memberRowHeader)}>
+-                    <Link
+-                      to="/community/$communityId/admin/members/$membershipId"
+-                      params={{ communityId, membershipId: person.membership_id }}
+-                      {...stylex.props(styles.memberLink)}
+-                    >
+-                      <h3 {...stylex.props(styles.cardCompactTitle)}>{person.display_name}</h3>
+-                    </Link>
+-                    <span {...stylex.props(styles.roleBadge)}>
+-                      {t(`communityAdmin.role.${person.role}`)}
+-                    </span>
+-                  </div>
+-                  <p {...stylex.props(styles.copy)}>
+-                    {t('communityAdmin.memberJoined', {
+-                      date: dateLabel(person.valid_from, locale)
+-                    })}
+-                  </p>
+-                  <p {...stylex.props(styles.copy)}>{memberRatingLabel(person)}</p>
+-                </div>
+-              </SurfaceCard>
+-            ))}
+-            {!visibleMembers.length && !searchingMembers && (
+-              <p>{t('communityAdmin.empty.members')}</p>
+-            )}
+-          </div>
+-          {hasMoreMembers ? (
+-            <Button variant="secondary" busy={searchLoading} onClick={() => void loadMoreMembers()}>
+-              {t('communityAdmin.loadMore')}
+-            </Button>
+-          ) : (
+-            hasLoadedMoreMembers && (
+-              <p {...stylex.props(styles.copy)}>{t('communityAdmin.endOfList')}</p>
+-            )
+-          )}
+-          <p {...stylex.props(styles.note)}>{t('communityAdmin.levelReadOnly')}</p>
+-        </>
+-      )}
+-      {screen === 'member' && (
+-        <>
+-          {member?.status === 'active' && (
+-            <p {...stylex.props(styles.banner)}>{t('communityAdmin.memberActiveBanner')}</p>
+-          )}
+-          {member ? (
+-            <>
+-              <SurfaceCard
+-                data-testid="community-member-profile"
+-                xstyle={[styles.card, styles.memberProfileCard]}
+-              >
+-                <h3 {...stylex.props(styles.memberProfileTitle)}>
+-                  {member.display_level === null || member.reliability_percent === null
+-                    ? t('communityAdmin.memberAdminProfileMissing', { name: member.display_name })
+-                    : t('communityAdmin.memberAdminProfile', {
+-                        name: member.display_name,
+-                        level: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
+-                          member.display_level
+-                        ),
+-                        reliability: new Intl.NumberFormat(locale).format(
+-                          member.reliability_percent
+-                        )
+-                      })}
+-                </h3>
+-                <p {...stylex.props(styles.copy)}>
+-                  {t('communityAdmin.memberMeta', {
+-                    status: memberStatus(member),
+-                    role: t(`communityAdmin.role.${member.role}`),
+-                    date: dateLabel(member.valid_from, locale)
+-                  })}
+-                </p>
+-              </SurfaceCard>
+-              <SurfaceCard data-testid="community-member-role-panel" xstyle={styles.rolePanel}>
+-                <p {...stylex.props(styles.rolePanelTitle)}>{t('communityAdmin.rolePanelTitle')}</p>
+-                <p {...stylex.props(styles.rolePanelCopy)}>
+-                  {t('communityAdmin.rolePanelActive', {
+-                    role: t(`communityAdmin.role.${member.role}`)
+-                  })}
+-                </p>
+-                <p {...stylex.props(styles.rolePanelCopy)}>
+-                  {t('communityAdmin.rolePanelInactive')}
+-                </p>
+-              </SurfaceCard>
+-              <div {...stylex.props(styles.form)}>{actions(member)}</div>
+-            </>
+-          ) : (
+-            <SurfaceCard xstyle={styles.card}>
+-              <p>{t('communityAdmin.empty.member')}</p>
+-            </SurfaceCard>
+-          )}
+-          <p {...stylex.props(styles.note)}>{t('communityAdmin.levelReadOnly')}</p>
+-        </>
+-      )}
+-      {screen === 'settings' && (
+-        <form
+-          onSubmit={(event) => void saveSettings(event)}
+-          {...stylex.props(styles.form, styles.settingsForm)}
+-        >
+-          <SurfaceCard data-testid="settings-visibility-label" xstyle={styles.settingsCard}>
+-            <span {...stylex.props(styles.fieldLabel)}>
+-              {t('communityAdmin.settings.visibility')}
+-            </span>
+-          </SurfaceCard>
+-          <select
+-            id="community-visibility"
+-            data-testid="settings-visibility-control"
+-            value={settings.visibility}
+-            aria-label={t('communityAdmin.settings.visibility')}
+-            onChange={(event) =>
+-              setSettings({
+-                ...settings,
+-                visibility: event.target.value === 'public' ? 'public' : 'private'
+-              })
+-            }
+-            {...stylex.props(styles.settingChoice)}
+-          >
+-            <option value="public">{t('communityAdmin.visibility.public')}</option>
+-            <option value="private">{t('communityAdmin.visibility.private')}</option>
+-          </select>
+-          <select
+-            id="community-join-policy"
+-            data-testid="settings-join-policy-control"
+-            value={settings.join_policy}
+-            aria-label={t('communityAdmin.settings.joinPolicy')}
+-            onChange={(event) =>
+-              setSettings({
+-                ...settings,
+-                join_policy: event.target.value === 'instant' ? 'instant' : 'admin_approval'
+-              })
+-            }
+-            {...stylex.props(styles.settingChoice)}
+-          >
+-            <option value="instant">{t('communityAdmin.joinPolicy.instant')}</option>
+-            <option value="admin_approval">{t('communityAdmin.joinPolicy.adminApproval')}</option>
+-          </select>
+-          <SurfaceCard xstyle={styles.settingsUnavailableCard}>
+-            <p {...stylex.props(styles.copy)}>{t('communityAdmin.settingsUnavailable')}</p>
+-            <details {...stylex.props(styles.details)}>
+-              <summary {...stylex.props(styles.detailsSummary)}>
+-                {t('communityAdmin.settings.details')}
+-              </summary>
+-              <div {...stylex.props(styles.form)}>
+-                <TextField
+-                  id="community-admin-name"
+-                  label={t('communityAdmin.settings.name')}
+-                  value={settings.name}
+-                  maxLength={80}
+-                  onChange={(event) => setSettings({ ...settings, name: event.target.value })}
+-                  required
+-                />
+-                <TextField
+-                  id="community-admin-city"
+-                  label={t('communityAdmin.settings.city')}
+-                  value={settings.city_label}
+-                  maxLength={120}
+-                  onChange={(event) => setSettings({ ...settings, city_label: event.target.value })}
+-                />
+-                <TextField
+-                  id="community-admin-description"
+-                  label={t('communityAdmin.settings.description')}
+-                  value={settings.description}
+-                  maxLength={500}
+-                  onChange={(event) =>
+-                    setSettings({ ...settings, description: event.target.value })
+-                  }
+-                />
+-              </div>
+-            </details>
+-          </SurfaceCard>
+-          <Button type="submit" busy={busy}>
+-            {t('communityAdmin.save')}
+-          </Button>
+-          <p {...stylex.props(styles.note)}>{t('communityAdmin.settingsAdminNote')}</p>
+-        </form>
+-      )}
+-      {screen === 'venues' && (
+-        <>
+-          {!venueFormOpen && (
+-            <>
+-              <Button onClick={() => setVenueFormOpen(true)}>
+-                {t('communityAdmin.venue.add')}
+-              </Button>
+-            </>
+-          )}
+-          {venueFormOpen && (
+-            <SurfaceCard xstyle={styles.card}>
+-              <h3 {...stylex.props(styles.cardTitle)}>
+-                {t(venueDraft.id ? 'communityAdmin.venue.edit' : 'communityAdmin.venue.add')}
+-              </h3>
+-              <form onSubmit={(event) => void saveVenue(event)} {...stylex.props(styles.form)}>
+-                <TextField
+-                  id="venue-name"
+-                  label={t('communityAdmin.venue.name')}
+-                  value={venueDraft.name}
+-                  maxLength={120}
+-                  required
+-                  onChange={(event) => setVenueDraft({ ...venueDraft, name: event.target.value })}
+-                />
+-                <TextField
+-                  id="venue-address"
+-                  label={t('communityAdmin.venue.address')}
+-                  value={venueDraft.address}
+-                  maxLength={300}
+-                  onChange={(event) =>
+-                    setVenueDraft({ ...venueDraft, address: event.target.value })
+-                  }
+-                />
+-                <TextField
+-                  id="venue-map"
+-                  label={t('communityAdmin.venue.mapsUrl')}
+-                  value={venueDraft.maps_url}
+-                  maxLength={2048}
+-                  type="url"
+-                  onChange={(event) =>
+-                    setVenueDraft({ ...venueDraft, maps_url: event.target.value })
+-                  }
+-                />
+-                <p {...stylex.props(styles.note)}>{t('communityAdmin.photoUnavailable')}</p>
+-                <Button type="submit" busy={busy}>
+-                  {t('communityAdmin.save')}
+-                </Button>
+-              </form>
+-              <Button
+-                variant="secondary"
+-                onClick={() => {
+-                  setVenueFormOpen(false);
+-                  setVenueDraft({ id: '', name: '', address: '', maps_url: '' });
+-                }}
+-              >
+-                {t('communityAdmin.cancel')}
+-              </Button>
+-            </SurfaceCard>
+-          )}
+-          <div {...stylex.props(styles.list)}>
+-            {[...venues, ...additionalVenues].map((venue) => (
+-              <SurfaceCard
+-                key={venue.id}
+-                data-testid="community-venue-card"
+-                xstyle={[styles.card, styles.venueCard]}
+-              >
+-                <h3 {...stylex.props(styles.cardCompactTitle)}>{venue.name}</h3>
+-                <div {...stylex.props(styles.venueMeta)}>
+-                  <p {...stylex.props(styles.copy)}>
+-                    {venue.address || community.city_label || t('communityAdmin.cityUnavailable')}
+-                  </p>
+-                  {venue.maps_url && (
+-                    <a
+-                      href={venue.maps_url}
+-                      target="_blank"
+-                      rel="noreferrer"
+-                      {...stylex.props(styles.memberLink, styles.venueMapLink)}
+-                    >
+-                      {t('communityAdmin.venue.openMap')}
+-                    </a>
+-                  )}
+-                </div>
+-                <div {...stylex.props(styles.venueActions)}>
+-                  <Button
+-                    variant="secondary"
+-                    xstyle={styles.venueAction}
+-                    onClick={() => {
+-                      setVenueDraft({
+-                        id: venue.id,
+-                        name: venue.name,
+-                        address: venue.address ?? '',
+-                        maps_url: venue.maps_url ?? ''
+-                      });
+-                      setVenueFormOpen(true);
+-                    }}
+-                  >
+-                    {t('communityAdmin.venue.edit')}
+-                  </Button>
+-                  <Button
+-                    variant="secondary"
+-                    xstyle={styles.venueAction}
+-                    busy={busy}
+-                    onClick={() =>
+-                      void run(
+-                        () =>
+-                          archiveCommunityVenue({
+-                            data: { community_id: community.id, venue_id: venue.id }
+-                          }),
+-                        t('communityAdmin.result.venueArchived')
+-                      )
+-                    }
+-                  >
+-                    {t('communityAdmin.venue.archive')}
+-                  </Button>
+-                </div>
+-              </SurfaceCard>
+-            ))}
+-            {!venues.length && !additionalVenues.length && (
+-              <p>{t('communityAdmin.empty.venues')}</p>
+-            )}
+-          </div>
+-          {hasMoreVenues ? (
+-            <Button variant="secondary" busy={busy} onClick={() => void loadMoreVenues()}>
+-              {t('communityAdmin.loadMore')}
+-            </Button>
+-          ) : (
+-            hasLoadedMoreVenues && (
+-              <p {...stylex.props(styles.copy)}>{t('communityAdmin.endOfList')}</p>
+-            )
+-          )}
+-          <p {...stylex.props(styles.note)}>{t('communityAdmin.venue.historyNote')}</p>
+-        </>
+-      )}
+-      {screen === 'audit' && (
+-        <div {...stylex.props(styles.list)}>
+-          <p {...stylex.props(styles.banner)}>{t('communityAdmin.audit.recentChanges')}</p>
+-          {auditRows.map((event) => (
+-            <SurfaceCard
+-              key={event.id}
+-              data-testid="community-audit-event"
+-              xstyle={[styles.card, styles.auditCard]}
+-            >
+-              <p {...stylex.props(styles.auditAction)}>
+-                {t(auditEventKey(event), { defaultValue: t('communityAdmin.audit.unknown') })}
+-                {auditMemberDetails(event) &&
+-                  ` · ${t(`communityAdmin.role.${auditMemberDetails(event)?.role}`)} · ${t(`communityAdmin.status.${auditMemberDetails(event)?.status}`)}`}
+-              </p>
+-              <p {...stylex.props(styles.copy)}>
+-                {t('communityAdmin.audit.unknownActor')} ·{' '}
+-                {auditDateLabel(event.occurred_at, locale)}
+-              </p>
+-              {event.entity === 'community_members' && (
+-                <Link
+-                  to="/community/$communityId/admin/members/$membershipId"
+-                  params={{ communityId, membershipId: event.entity_id }}
+-                  {...stylex.props(styles.memberLink)}
+-                >
+-                  {t('communityAdmin.audit.openMember')}
+-                </Link>
+-              )}
+-            </SurfaceCard>
+-          ))}
+-          {!auditRows.length && <p>{t('communityAdmin.empty.audit')}</p>}
+-          {hasMoreAudit && (
+-            <Button variant="secondary" busy={busy} onClick={() => void loadMoreAudit()}>
+-              {t('communityAdmin.loadMore')}
+-            </Button>
+-          )}
+-        </div>
+-      )}
+-      {message && <output {...stylex.props(styles.status)}>{message}</output>}
+-      {errorKey && (
+-        <p role="alert" {...stylex.props(styles.error)}>
+-          {t(`communityAdmin.error.${errorKey}`)}
+-        </p>
+-      )}
+-      {errorKey && (
+-        <Button variant="secondary" onClick={() => void retry()}>
+-          {t('communityAdmin.retry')}
+-        </Button>
+-      )}
+-      <nav aria-label={t('communityAdmin.navigation')} {...stylex.props(styles.bottomNav)}>
+-        {navItems.map((item) => (
+-          <Link
+-            key={item.key}
+-            to={item.to}
+-            params={{ communityId }}
+-            aria-current={screen === item.key ? 'page' : undefined}
+-            {...stylex.props(styles.bottomNavLink)}
+-          >
+-            {t(`communityAdmin.nav.${item.key}`)}
+-          </Link>
+-        ))}
+-      </nav>
+-    </section>
+-  );
++  return <CommunityAdminDispatcher key={props.community.id} {...props} />;
+ }
+diff --git a/src/features/community/CommunityAdminViews.tsx b/src/features/community/CommunityAdminViews.tsx
+new file mode 100644
+index 0000000..468f681
+--- /dev/null
++++ b/src/features/community/CommunityAdminViews.tsx
+@@ -0,0 +1,1224 @@
++import * as stylex from '@stylexjs/stylex';
++import { AlertDialog } from '@base-ui/react/alert-dialog';
++import { Link, useParams, useRouter } from '@tanstack/react-router';
++import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
++import { useTranslation } from 'react-i18next';
++import { Button } from '../../components/ui/Button';
++import { SurfaceCard } from '../../components/ui/SurfaceCard';
++import { TextField } from '../../components/ui/TextField';
++import {
++  addCommunityVenue,
++  archiveCommunityVenue,
++  demoteCommunityMember,
++  promoteCommunityMember,
++  reactivateCommunityMember,
++  removeCommunityMember,
++  approveCommunityMember,
++  denyCommunityMember,
++  searchCommunityMembers,
++  editCommunityVenue,
++  listCommunityVenues,
++  listCommunityAudit
++} from './community-admin.functions';
++import { dateLabel, failed, initials } from './CommunityAdmin';
++import { updateCommunitySettings } from './community.functions';
++import type {
++  CommunityAdminMember,
++  CommunityAdminAudit,
++  CommunityAdminScreenProps,
++  CommunityAdminVenue
++} from './community-admin.types';
++import { styles } from './community-admin.styles';
++
++type ScreenName = CommunityAdminScreenProps['screen'];
++type ViewProps<Screen extends ScreenName> = Extract<CommunityAdminScreenProps, { screen: Screen }>;
++
++function MembersView({ community, members }: ViewProps<'members'>) {
++  const { t, i18n } = useTranslation();
++  const params = useParams({ strict: false });
++  const communityId = params.communityId ?? '';
++  const [query, setQuery] = useState('');
++  const [memberFilter, setMemberFilter] = useState<CommunityAdminMember['status']>('active');
++  const [searchResults, setSearchResults] = useState<{
++    source: CommunityAdminMember[];
++    query: string;
++    status: CommunityAdminMember['status'];
++    rows: CommunityAdminMember[];
++    hasMore: boolean;
++  } | null>(null);
++  const [searchLoading, setSearchLoading] = useState(false);
++  const [hasLoadedMoreMembers, setHasLoadedMoreMembers] = useState(false);
++  const searchRequest = useRef(0);
++  const membersSourceRef = useRef(members);
++  const hasSearchedMembers = useRef(false);
++  const { busy, message, errorKey, setErrorKey } = useAdminMutationState();
++  const locale = i18n.resolvedLanguage || i18n.language;
++  const submittedQuery = query.trim();
++  const currentSearch =
++    searchResults?.source === members &&
++    searchResults.query === submittedQuery &&
++    searchResults.status === memberFilter
++      ? searchResults
++      : null;
++  const initialActiveResults = submittedQuery === '' && memberFilter === 'active' && !searchResults;
++  const visibleMembers = currentSearch?.rows ?? (initialActiveResults ? members : []);
++  const canLoadMore = currentSearch?.hasMore ?? (initialActiveResults && members.length === 50);
++  const searchingMembers =
++    searchLoading ||
++    (!initialActiveResults && !currentSearch && searchResults !== null) ||
++    (submittedQuery !== '' && !currentSearch) ||
++    (memberFilter !== 'active' && !currentSearch);
++
++  useEffect(() => {
++    if (membersSourceRef.current === members) return;
++    membersSourceRef.current = members;
++    searchRequest.current += 1;
++    setSearchResults(null);
++    setSearchLoading(false);
++    setHasLoadedMoreMembers(false);
++  }, [members]);
++
++  const fetchMembers = useCallback(
++    async (filterQuery: string, filterStatus: CommunityAdminMember['status'], offset = 0) => {
++      const requestId = ++searchRequest.current;
++      const source = members;
++      hasSearchedMembers.current = true;
++      setSearchLoading(true);
++      setErrorKey('');
++      try {
++        const results = await searchCommunityMembers({
++          data: {
++            community_id: community.id,
++            query: filterQuery,
++            status: filterStatus,
++            offset,
++            limit: 50
++          }
++        });
++        if (requestId !== searchRequest.current || source !== membersSourceRef.current) return;
++        setSearchResults((previous) => ({
++          source,
++          query: filterQuery,
++          status: filterStatus,
++          rows:
++            offset > 0 &&
++            previous?.source === source &&
++            previous.query === filterQuery &&
++            previous.status === filterStatus
++              ? [...previous.rows, ...results]
++              : results,
++          hasMore: results.length === 50
++        }));
++      } catch (error) {
++        if (requestId === searchRequest.current && source === membersSourceRef.current)
++          setErrorKey(failed(error));
++      } finally {
++        if (requestId === searchRequest.current && source === membersSourceRef.current)
++          setSearchLoading(false);
++      }
++    },
++    [community.id, members, setErrorKey]
++  );
++
++  useEffect(() => {
++    if (submittedQuery === '' && memberFilter === 'active' && !hasSearchedMembers.current)
++      return undefined;
++    const timer = setTimeout(() => void fetchMembers(submittedQuery, memberFilter), 250);
++    return () => clearTimeout(timer);
++  }, [fetchMembers, submittedQuery, memberFilter, members]);
++
++  async function loadMoreMembers() {
++    if (searchLoading || !canLoadMore) return;
++    setHasLoadedMoreMembers(true);
++    if (currentSearch) {
++      await fetchMembers(currentSearch.query, currentSearch.status, currentSearch.rows.length);
++      return;
++    }
++    setSearchResults({
++      source: members,
++      query: '',
++      status: 'active',
++      rows: members,
++      hasMore: true
++    });
++    await fetchMembers('', 'active', members.length);
++  }
++
++  return (
++    <AdminViewFrame communityId={communityId} communityName={community.name} screen="members">
++      <Button disabled xstyle={styles.unavailableInvite}>
++        {t('communityAdmin.inviteUnavailable')}
++      </Button>
++      <form onSubmit={(event) => event.preventDefault()} {...stylex.props(styles.searchForm)}>
++        <div {...stylex.props(styles.searchField)}>
++          <TextField
++            id="admin-member-search"
++            label={
++              <span {...stylex.props(styles.visuallyHidden)}>
++                {t('communityAdmin.searchLabel')}
++              </span>
++            }
++            type="search"
++            value={query}
++            placeholder={t('communityAdmin.searchPlaceholder')}
++            onChange={(event) => setQuery(event.target.value)}
++          />
++        </div>
++      </form>
++      <fieldset aria-label={t('communityAdmin.memberFilters')} {...stylex.props(styles.filterTabs)}>
++        {(['active', 'pending', 'inactive'] as const).map((status) => (
++          <button
++            key={status}
++            type="button"
++            aria-pressed={memberFilter === status}
++            onClick={() => setMemberFilter(status)}
++            {...stylex.props(styles.filterTab, memberFilter === status && styles.filterTabSelected)}
++          >
++            {t(`communityAdmin.status.${status}`)}
++          </button>
++        ))}
++      </fieldset>
++      {searchingMembers && (
++        <output aria-live="polite" {...stylex.props(styles.copy)}>
++          {t('communityAdmin.searchLoading')}
++        </output>
++      )}
++      <div {...stylex.props(styles.list, styles.memberList)}>
++        {visibleMembers.map((person) => (
++          <SurfaceCard
++            key={person.membership_id}
++            data-testid="community-member-card"
++            xstyle={[styles.card, styles.memberCard]}
++          >
++            <span aria-hidden="true" {...stylex.props(styles.avatar)}>
++              {initials(person.display_name)}
++            </span>
++            <div {...stylex.props(styles.memberDetails)}>
++              <div {...stylex.props(styles.memberRowHeader)}>
++                <Link
++                  to="/community/$communityId/admin/members/$membershipId"
++                  params={{ communityId, membershipId: person.membership_id }}
++                  {...stylex.props(styles.memberLink)}
++                >
++                  <h3 {...stylex.props(styles.cardCompactTitle)}>{person.display_name}</h3>
++                </Link>
++                <span {...stylex.props(styles.roleBadge)}>
++                  {t(`communityAdmin.role.${person.role}`)}
++                </span>
++              </div>
++              <p {...stylex.props(styles.copy)}>
++                {t('communityAdmin.memberJoined', { date: dateLabel(person.valid_from, locale) })}
++              </p>
++              <p {...stylex.props(styles.copy)}>{ratingLabel(person, t, locale)}</p>
++            </div>
++          </SurfaceCard>
++        ))}
++        {!visibleMembers.length && !searchingMembers && <p>{t('communityAdmin.empty.members')}</p>}
++      </div>
++      {canLoadMore ? (
++        <Button
++          variant="secondary"
++          busy={searchLoading || busy}
++          onClick={() => void loadMoreMembers()}
++        >
++          {t('communityAdmin.loadMore')}
++        </Button>
++      ) : (
++        hasLoadedMoreMembers && (
++          <p {...stylex.props(styles.copy)}>{t('communityAdmin.endOfList')}</p>
++        )
++      )}
++      <p {...stylex.props(styles.note)}>{t('communityAdmin.levelReadOnly')}</p>
++      {message && <output {...stylex.props(styles.status)}>{message}</output>}
++      {errorKey && (
++        <p role="alert" {...stylex.props(styles.error)}>
++          {t(`communityAdmin.error.${errorKey}`)}
++        </p>
++      )}
++      {errorKey && (
++        <Button variant="secondary" onClick={() => void fetchMembers(submittedQuery, memberFilter)}>
++          {t('communityAdmin.retry')}
++        </Button>
++      )}
++    </AdminViewFrame>
++  );
++}
++
++function RequestsView(props: ViewProps<'requests'>) {
++  const { community, members } = props;
++  const { t, i18n } = useTranslation();
++  const router = useRouter();
++  const params = useParams({ strict: false });
++  const communityId = params.communityId ?? '';
++  const [additionalRequests, setAdditionalRequests] = useState<CommunityAdminMember[]>([]);
++  const [hasLoadedMoreRequests, setHasLoadedMoreRequests] = useState(false);
++  const [hasMoreRequests, setHasMoreRequests] = useState(members.length === 50);
++  const { busy, setBusy, message, setMessage, errorKey, setErrorKey } = useAdminMutationState();
++  const locale = i18n.resolvedLanguage || i18n.language;
++
++  useEffect(() => {
++    setAdditionalRequests([]);
++    setHasLoadedMoreRequests(false);
++    setHasMoreRequests(members.length === 50);
++  }, [members]);
++
++  async function loadMoreRequests() {
++    if (busy || !hasMoreRequests) return;
++    setBusy(true);
++    setHasLoadedMoreRequests(true);
++    try {
++      const page = await searchCommunityMembers({
++        data: {
++          community_id: community.id,
++          query: '',
++          status: 'pending',
++          offset: members.length + additionalRequests.length,
++          limit: 50
++        }
++      });
++      setAdditionalRequests((previous) => [...previous, ...page]);
++      setHasMoreRequests(page.length === 50);
++    } catch (error) {
++      setErrorKey(failed(error));
++    } finally {
++      setBusy(false);
++    }
++  }
++
++  async function memberAction(person: CommunityAdminMember, action: 'approve' | 'deny') {
++    if (busy) return;
++    setBusy(true);
++    setErrorKey('');
++    setMessage('');
++    try {
++      await (action === 'approve' ? approveCommunityMember : denyCommunityMember)({
++        data: { community_id: community.id, membership_id: person.membership_id }
++      });
++      setAdditionalRequests([]);
++      setHasLoadedMoreRequests(false);
++      setHasMoreRequests(members.length === 50);
++      setMessage(t(`communityAdmin.result.${action}`));
++      await router.invalidate();
++    } catch (error) {
++      setErrorKey(failed(error));
++    } finally {
++      setBusy(false);
++    }
++  }
++
++  return (
++    <AdminViewFrame communityId={communityId} communityName={community.name} screen="requests">
++      <p {...stylex.props(styles.banner)}>{t('communityAdmin.requestBanner')}</p>
++      <div {...stylex.props(styles.list)}>
++        {[...members, ...additionalRequests].map((person) => (
++          <SurfaceCard key={person.membership_id} xstyle={[styles.card, styles.requestCard]}>
++            <h3 {...stylex.props(styles.cardCompactTitle)}>{person.display_name}</h3>
++            <p {...stylex.props(styles.copy)}>{ratingLabel(person, t, locale)}</p>
++            <p {...stylex.props(styles.copy, styles.requestMeta)}>
++              {t('communityAdmin.requestMeta', {
++                date: dateLabel(person.valid_from, locale),
++                privacy: t('communityAdmin.requestPrivacy')
++              })}
++            </p>
++            <div {...stylex.props(styles.actions, styles.requestActions)}>
++              <Button busy={busy} onClick={() => void memberAction(person, 'approve')}>
++                {t('communityAdmin.action.approve')}
++              </Button>
++              <Button
++                variant="secondary"
++                busy={busy}
++                onClick={() => void memberAction(person, 'deny')}
++              >
++                {t('communityAdmin.action.deny')}
++              </Button>
++            </div>
++          </SurfaceCard>
++        ))}
++        {!members.length && !additionalRequests.length && (
++          <p>{t('communityAdmin.empty.requests')}</p>
++        )}
++        {hasMoreRequests ? (
++          <Button variant="secondary" busy={busy} onClick={() => void loadMoreRequests()}>
++            {t('communityAdmin.loadMore')}
++          </Button>
++        ) : (
++          hasLoadedMoreRequests && (
++            <p {...stylex.props(styles.copy)}>{t('communityAdmin.endOfList')}</p>
++          )
++        )}
++        <p {...stylex.props(styles.note)}>{t('communityAdmin.requestHistoryUnavailable')}</p>
++      </div>
++      {message && <output {...stylex.props(styles.status)}>{message}</output>}
++      {errorKey && (
++        <p role="alert" {...stylex.props(styles.error)}>
++          {t(`communityAdmin.error.${errorKey}`)}
++        </p>
++      )}
++    </AdminViewFrame>
++  );
++}
++
++function useAdminMutationState() {
++  const [busy, setBusy] = useState(false);
++  const [message, setMessage] = useState('');
++  const [errorKey, setErrorKey] = useState('');
++  return { busy, setBusy, message, setMessage, errorKey, setErrorKey };
++}
++
++function ratingLabel(
++  person: CommunityAdminMember,
++  t: ReturnType<typeof useTranslation>['t'],
++  locale: string
++) {
++  if (person.display_level === null || person.reliability_percent === null)
++    return t('communityAdmin.ratingsUnavailable');
++  return t('communityAdmin.levelLabel', {
++    level: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(person.display_level),
++    reliability: new Intl.NumberFormat(locale).format(person.reliability_percent)
++  });
++}
++
++function AdminViewFrame({
++  communityId,
++  communityName,
++  screen,
++  children,
++  headingRef
++}: {
++  communityId: string;
++  communityName: string;
++  screen: 'requests' | 'members' | 'member' | 'settings' | 'venues' | 'audit';
++  children: ReactNode;
++  headingRef?: React.RefObject<HTMLHeadingElement | null>;
++}) {
++  const { t } = useTranslation();
++  const items = [
++    { key: 'requests', to: '/community/$communityId/admin/requests' },
++    { key: 'members', to: '/community/$communityId/admin/members' },
++    { key: 'settings', to: '/community/$communityId/admin/settings' },
++    { key: 'venues', to: '/community/$communityId/admin/venues' },
++    { key: 'audit', to: '/community/$communityId/admin/audit' }
++  ] as const;
++  return (
++    <section
++      aria-labelledby="admin-screen-title"
++      {...stylex.props(styles.content, screen === 'venues' && styles.venueContent)}
++    >
++      <header {...stylex.props(styles.header)}>
++        <div {...stylex.props(styles.screenHeading)}>
++          <Link
++            to="/dashboard"
++            aria-label={t('communityAdmin.backToDashboard')}
++            {...stylex.props(styles.backLink)}
++          >
++            <span aria-hidden="true">‹</span>
++          </Link>
++          <div {...stylex.props(styles.titleGroup)}>
++            <h1
++              ref={headingRef}
++              tabIndex={-1}
++              id="admin-screen-title"
++              {...stylex.props(styles.title)}
++            >
++              {t(`communityAdmin.title.${screen}`)}
++            </h1>
++            <p {...stylex.props(styles.subtitle)}>
++              {t('communityAdmin.communityAdminSubtitle', { community: communityName })}
++            </p>
++          </div>
++        </div>
++      </header>
++      {children}
++      <nav aria-label={t('communityAdmin.navigation')} {...stylex.props(styles.bottomNav)}>
++        {items.map((item) => (
++          <Link
++            key={item.key}
++            to={item.to}
++            params={{ communityId }}
++            aria-current={item.key === screen ? 'page' : undefined}
++            {...stylex.props(styles.bottomNavLink)}
++          >
++            {t(`communityAdmin.nav.${item.key}`)}
++          </Link>
++        ))}
++      </nav>
++    </section>
++  );
++}
++
++function MemberView(props: ViewProps<'member'>) {
++  const { community, member, membershipId } = props;
++  const { t, i18n } = useTranslation();
++  const router = useRouter();
++  const params = useParams({ strict: false });
++  const communityId = params.communityId ?? '';
++  const { busy, setBusy, message, setMessage, errorKey, setErrorKey } = useAdminMutationState();
++  const [confirmation, setConfirmation] = useState<'demote' | 'remove' | null>(null);
++  const [completedConfirmation, setCompletedConfirmation] = useState<'demote' | 'remove' | null>(
++    null
++  );
++  const headingRef = useRef<HTMLHeadingElement>(null);
++  const cancelRef = useRef<HTMLElement>(null);
++  const triggerRef = useRef<HTMLButtonElement>(null);
++  const locale = i18n.resolvedLanguage || i18n.language;
++
++  async function memberAction(
++    action: 'approve' | 'deny' | 'remove' | 'reactivate' | 'promote' | 'demote'
++  ): Promise<boolean> {
++    if (busy) return false;
++    setBusy(true);
++    setErrorKey('');
++    setMessage('');
++    const actions = {
++      approve: approveCommunityMember,
++      deny: denyCommunityMember,
++      remove: removeCommunityMember,
++      reactivate: reactivateCommunityMember,
++      promote: promoteCommunityMember,
++      demote: demoteCommunityMember
++    };
++    try {
++      const result = await actions[action]({
++        data: { community_id: community.id, membership_id: membershipId }
++      });
++      setMessage(t(`communityAdmin.result.${action}`));
++      await router.invalidate();
++      if (action === 'reactivate' && 'membership_id' in result) {
++        await router.navigate({
++          to: '/community/$communityId/admin/members/$membershipId',
++          params: { communityId: community.id, membershipId: result.membership_id }
++        });
++      }
++      return true;
++    } catch (error) {
++      setErrorKey(failed(error));
++      return false;
++    } finally {
++      setBusy(false);
++    }
++  }
++
++  function requestMemberAction(
++    action: 'approve' | 'deny' | 'remove' | 'reactivate' | 'promote' | 'demote'
++  ) {
++    if (action === 'remove' || action === 'demote') setConfirmation(action);
++    else void memberAction(action);
++  }
++
++  return (
++    <AdminViewFrame
++      communityId={communityId}
++      communityName={community.name}
++      screen="member"
++      headingRef={headingRef}
++    >
++      {member.status === 'active' && (
++        <p {...stylex.props(styles.banner)}>{t('communityAdmin.memberActiveBanner')}</p>
++      )}
++      <SurfaceCard
++        data-testid="community-member-profile"
++        xstyle={[styles.card, styles.memberProfileCard]}
++      >
++        <h3 {...stylex.props(styles.memberProfileTitle)}>
++          {member.display_level === null || member.reliability_percent === null
++            ? t('communityAdmin.memberAdminProfileMissing', { name: member.display_name })
++            : t('communityAdmin.memberAdminProfile', {
++                name: member.display_name,
++                level: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
++                  member.display_level
++                ),
++                reliability: new Intl.NumberFormat(locale).format(member.reliability_percent)
++              })}
++        </h3>
++        <p {...stylex.props(styles.copy)}>
++          {t('communityAdmin.memberMeta', {
++            status: t(`communityAdmin.status.${member.status}`),
++            role: t(`communityAdmin.role.${member.role}`),
++            date: dateLabel(member.valid_from, locale)
++          })}
++        </p>
++      </SurfaceCard>
++      <SurfaceCard data-testid="community-member-role-panel" xstyle={styles.rolePanel}>
++        <p {...stylex.props(styles.rolePanelTitle)}>{t('communityAdmin.rolePanelTitle')}</p>
++        <p {...stylex.props(styles.rolePanelCopy)}>
++          {t('communityAdmin.rolePanelActive', { role: t(`communityAdmin.role.${member.role}`) })}
++        </p>
++        <p {...stylex.props(styles.rolePanelCopy)}>{t('communityAdmin.rolePanelInactive')}</p>
++      </SurfaceCard>
++      <div {...stylex.props(styles.form, styles.actions)}>
++        {member.status === 'pending' && (
++          <>
++            <Button busy={busy} onClick={() => requestMemberAction('approve')}>
++              {t('communityAdmin.action.approve')}
++            </Button>
++            <Button variant="secondary" busy={busy} onClick={() => requestMemberAction('deny')}>
++              {t('communityAdmin.action.deny')}
++            </Button>
++          </>
++        )}
++        {member.status === 'inactive' && (
++          <Button busy={busy} onClick={() => requestMemberAction('reactivate')}>
++            {t('communityAdmin.action.reactivate')}
++          </Button>
++        )}
++        {member.status === 'active' && member.role === 'member' && (
++          <Button
++            variant="secondary"
++            busy={busy}
++            xstyle={styles.softAction}
++            onClick={() => requestMemberAction('promote')}
++          >
++            {t('communityAdmin.action.promote')}
++          </Button>
++        )}
++        {member.status === 'active' &&
++          member.role === 'admin' &&
++          completedConfirmation !== 'demote' && (
++            <Button
++              ref={triggerRef}
++              variant="secondary"
++              busy={busy}
++              onClick={() => requestMemberAction('demote')}
++            >
++              {t('communityAdmin.action.demote')}
++            </Button>
++          )}
++        {member.status === 'active' && completedConfirmation !== 'remove' && (
++          <Button
++            ref={triggerRef}
++            variant="secondary"
++            busy={busy}
++            onClick={() => requestMemberAction('remove')}
++          >
++            {t('communityAdmin.action.remove')}
++          </Button>
++        )}
++      </div>
++      <AlertDialog.Root
++        open={confirmation !== null}
++        onOpenChange={(open) => {
++          if (!open && !busy) setConfirmation(null);
++        }}
++      >
++        <AlertDialog.Portal>
++          <AlertDialog.Backdrop {...stylex.props(styles.confirmBackdrop)} />
++          <AlertDialog.Viewport {...stylex.props(styles.confirmViewport)}>
++            <AlertDialog.Popup
++              initialFocus={() => cancelRef.current}
++              finalFocus={() =>
++                triggerRef.current?.isConnected ? triggerRef.current : headingRef.current
++              }
++              onKeyDown={(event) => {
++                if (event.key !== 'Tab') return;
++                const controls = event.currentTarget.querySelectorAll<HTMLElement>(
++                  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
++                );
++                const first = controls.item(0);
++                const last = controls.item(controls.length - 1);
++                if (event.shiftKey && document.activeElement === first) {
++                  event.preventDefault();
++                  last?.focus();
++                } else if (!event.shiftKey && document.activeElement === last) {
++                  event.preventDefault();
++                  first?.focus();
++                }
++              }}
++              {...stylex.props(styles.confirmDialog)}
++            >
++              <AlertDialog.Title {...stylex.props(styles.confirmTitle)}>
++                {t('communityAdmin.confirm', {
++                  action: confirmation ? t(`communityAdmin.action.${confirmation}`) : '',
++                  name: member.display_name
++                })}
++              </AlertDialog.Title>
++              <div {...stylex.props(styles.actions)}>
++                <Button
++                  busy={busy}
++                  onClick={async () => {
++                    if (!confirmation || busy) return;
++                    if (await memberAction(confirmation)) {
++                      setCompletedConfirmation(confirmation);
++                      setConfirmation(null);
++                    }
++                  }}
++                >
++                  {t('communityAdmin.confirmAction')}
++                </Button>
++                <AlertDialog.Close
++                  render={
++                    <Button
++                      ref={(node) => {
++                        cancelRef.current = node;
++                        if (node && confirmation) node.focus();
++                      }}
++                      variant="secondary"
++                      disabled={busy}
++                      onClick={() => setConfirmation(null)}
++                    />
++                  }
++                >
++                  {t('communityAdmin.cancel')}
++                </AlertDialog.Close>
++              </div>
++            </AlertDialog.Popup>
++          </AlertDialog.Viewport>
++        </AlertDialog.Portal>
++      </AlertDialog.Root>
++      <p {...stylex.props(styles.note)}>{t('communityAdmin.levelReadOnly')}</p>
++      {message && <output {...stylex.props(styles.status)}>{message}</output>}
++      {errorKey && (
++        <p role="alert" {...stylex.props(styles.error)}>
++          {t(`communityAdmin.error.${errorKey}`)}
++        </p>
++      )}
++      {errorKey && (
++        <Button variant="secondary" onClick={() => void router.invalidate()}>
++          {t('communityAdmin.retry')}
++        </Button>
++      )}
++    </AdminViewFrame>
++  );
++}
++
++function SettingsView(props: ViewProps<'settings'>) {
++  const { community } = props;
++  const { t } = useTranslation();
++  const router = useRouter();
++  const params = useParams({ strict: false });
++  const communityId = params.communityId ?? '';
++  const [settings, setSettings] = useState({
++    name: community.name,
++    description: community.description ?? '',
++    city_label: community.city_label ?? '',
++    visibility: community.visibility,
++    join_policy: community.join_policy
++  });
++  const { busy, setBusy, message, setMessage, errorKey, setErrorKey } = useAdminMutationState();
++
++  async function saveSettings(event: FormEvent<HTMLFormElement>) {
++    event.preventDefault();
++    if (busy) return;
++    setBusy(true);
++    setErrorKey('');
++    setMessage('');
++    try {
++      await updateCommunitySettings({ data: { community_id: community.id, ...settings } });
++      setSettings({ ...settings });
++      setMessage(t('communityAdmin.result.settings'));
++      try {
++        await router.invalidate();
++      } catch {
++        setErrorKey('generic');
++      }
++    } catch (error) {
++      setErrorKey(failed(error));
++    } finally {
++      setBusy(false);
++    }
++  }
++
++  return (
++    <AdminViewFrame communityId={communityId} communityName={community.name} screen="settings">
++      <form
++        onSubmit={(event) => void saveSettings(event)}
++        {...stylex.props(styles.form, styles.settingsForm)}
++      >
++        <SurfaceCard data-testid="settings-visibility-label" xstyle={styles.settingsCard}>
++          <span {...stylex.props(styles.fieldLabel)}>
++            {t('communityAdmin.settings.visibility')}
++          </span>
++        </SurfaceCard>
++        <select
++          id="community-visibility"
++          data-testid="settings-visibility-control"
++          value={settings.visibility}
++          aria-label={t('communityAdmin.settings.visibility')}
++          onChange={(event) =>
++            setSettings({
++              ...settings,
++              visibility: event.target.value === 'public' ? 'public' : 'private'
++            })
++          }
++          {...stylex.props(styles.settingChoice)}
++        >
++          <option value="public">{t('communityAdmin.visibility.public')}</option>
++          <option value="private">{t('communityAdmin.visibility.private')}</option>
++        </select>
++        <select
++          id="community-join-policy"
++          data-testid="settings-join-policy-control"
++          value={settings.join_policy}
++          aria-label={t('communityAdmin.settings.joinPolicy')}
++          onChange={(event) =>
++            setSettings({
++              ...settings,
++              join_policy: event.target.value === 'instant' ? 'instant' : 'admin_approval'
++            })
++          }
++          {...stylex.props(styles.settingChoice)}
++        >
++          <option value="instant">{t('communityAdmin.joinPolicy.instant')}</option>
++          <option value="admin_approval">{t('communityAdmin.joinPolicy.adminApproval')}</option>
++        </select>
++        <SurfaceCard xstyle={styles.settingsUnavailableCard}>
++          <p {...stylex.props(styles.copy)}>{t('communityAdmin.settingsUnavailable')}</p>
++          <details {...stylex.props(styles.details)}>
++            <summary {...stylex.props(styles.detailsSummary)}>
++              {t('communityAdmin.settings.details')}
++            </summary>
++            <div {...stylex.props(styles.form)}>
++              <TextField
++                id="community-admin-name"
++                label={t('communityAdmin.settings.name')}
++                value={settings.name}
++                maxLength={80}
++                onChange={(event) => setSettings({ ...settings, name: event.target.value })}
++                required
++              />
++              <TextField
++                id="community-admin-city"
++                label={t('communityAdmin.settings.city')}
++                value={settings.city_label}
++                maxLength={120}
++                onChange={(event) => setSettings({ ...settings, city_label: event.target.value })}
++              />
++              <TextField
++                id="community-admin-description"
++                label={t('communityAdmin.settings.description')}
++                value={settings.description}
++                maxLength={500}
++                onChange={(event) => setSettings({ ...settings, description: event.target.value })}
++              />
++            </div>
++          </details>
++        </SurfaceCard>
++        <Button type="submit" busy={busy}>
++          {t('communityAdmin.save')}
++        </Button>
++        <p {...stylex.props(styles.note)}>{t('communityAdmin.settingsAdminNote')}</p>
++      </form>
++      {message && <output {...stylex.props(styles.status)}>{message}</output>}
++      {errorKey && (
++        <p role="alert" {...stylex.props(styles.error)}>
++          {t(`communityAdmin.error.${errorKey}`)}
++        </p>
++      )}
++      {errorKey && (
++        <Button variant="secondary" onClick={() => void router.invalidate()}>
++          {t('communityAdmin.retry')}
++        </Button>
++      )}
++    </AdminViewFrame>
++  );
++}
++
++function VenuesView({ community, venues }: ViewProps<'venues'>) {
++  const { t } = useTranslation();
++  const router = useRouter();
++  const params = useParams({ strict: false });
++  const communityId = params.communityId ?? '';
++  const [additionalVenues, setAdditionalVenues] = useState<CommunityAdminVenue[]>([]);
++  const [hasLoadedMoreVenues, setHasLoadedMoreVenues] = useState(false);
++  const [hasMoreVenues, setHasMoreVenues] = useState(venues.length === 50);
++  const [venueDraft, setVenueDraft] = useState({ id: '', name: '', address: '', maps_url: '' });
++  const [venueFormOpen, setVenueFormOpen] = useState(false);
++  const sourceRef = useRef(venues);
++  const requestGeneration = useRef(0);
++  const { busy, setBusy, message, setMessage, errorKey, setErrorKey } = useAdminMutationState();
++
++  useEffect(() => {
++    if (sourceRef.current === venues) return;
++    sourceRef.current = venues;
++    requestGeneration.current += 1;
++    setAdditionalVenues([]);
++    setHasLoadedMoreVenues(false);
++    setHasMoreVenues(venues.length === 50);
++  }, [venues]);
++
++  async function run(action: () => Promise<unknown>, success: string) {
++    if (busy) return false;
++    setBusy(true);
++    setErrorKey('');
++    setMessage('');
++    try {
++      await action();
++      setAdditionalVenues([]);
++      setHasLoadedMoreVenues(false);
++      setHasMoreVenues(venues.length === 50);
++      setMessage(success);
++      try {
++        await router.invalidate();
++      } catch {
++        setErrorKey('generic');
++      }
++      return true;
++    } catch (error) {
++      setErrorKey(failed(error));
++      return false;
++    } finally {
++      setBusy(false);
++    }
++  }
++
++  async function saveVenue(event: FormEvent<HTMLFormElement>) {
++    event.preventDefault();
++    const data = {
++      community_id: community.id,
++      name: venueDraft.name,
++      address: venueDraft.address || null,
++      maps_url: venueDraft.maps_url || null
++    };
++    const saved = await run(
++      () =>
++        venueDraft.id
++          ? editCommunityVenue({ data: { ...data, venue_id: venueDraft.id } })
++          : addCommunityVenue({ data }),
++      t(venueDraft.id ? 'communityAdmin.result.venueUpdated' : 'communityAdmin.result.venueAdded')
++    );
++    if (saved) {
++      setVenueFormOpen(false);
++      setVenueDraft({ id: '', name: '', address: '', maps_url: '' });
++    }
++  }
++
++  async function loadMoreVenues() {
++    if (busy || !hasMoreVenues) return;
++    setBusy(true);
++    setHasLoadedMoreVenues(true);
++    const source = venues;
++    const generation = ++requestGeneration.current;
++    try {
++      const page = await listCommunityVenues({
++        data: {
++          community_id: community.id,
++          offset: venues.length + additionalVenues.length,
++          limit: 50
++        }
++      });
++      if (sourceRef.current !== source || requestGeneration.current !== generation) return;
++      setAdditionalVenues((previous) => [...previous, ...page]);
++      setHasMoreVenues(page.length === 50);
++    } catch (error) {
++      if (sourceRef.current === source && requestGeneration.current === generation)
++        setErrorKey(failed(error));
++    } finally {
++      if (requestGeneration.current === generation) setBusy(false);
++    }
++  }
++
++  return (
++    <AdminViewFrame communityId={communityId} communityName={community.name} screen="venues">
++      {!venueFormOpen && (
++        <Button onClick={() => setVenueFormOpen(true)}>{t('communityAdmin.venue.add')}</Button>
++      )}
++      {venueFormOpen && (
++        <SurfaceCard xstyle={styles.card}>
++          <h3 {...stylex.props(styles.cardTitle)}>
++            {t(venueDraft.id ? 'communityAdmin.venue.edit' : 'communityAdmin.venue.add')}
++          </h3>
++          <form onSubmit={(event) => void saveVenue(event)} {...stylex.props(styles.form)}>
++            <TextField
++              id="venue-name"
++              label={t('communityAdmin.venue.name')}
++              value={venueDraft.name}
++              maxLength={120}
++              required
++              onChange={(event) => setVenueDraft({ ...venueDraft, name: event.target.value })}
++            />
++            <TextField
++              id="venue-address"
++              label={t('communityAdmin.venue.address')}
++              value={venueDraft.address}
++              maxLength={300}
++              onChange={(event) => setVenueDraft({ ...venueDraft, address: event.target.value })}
++            />
++            <TextField
++              id="venue-map"
++              label={t('communityAdmin.venue.mapsUrl')}
++              value={venueDraft.maps_url}
++              maxLength={2048}
++              type="url"
++              onChange={(event) => setVenueDraft({ ...venueDraft, maps_url: event.target.value })}
++            />
++            <p {...stylex.props(styles.note)}>{t('communityAdmin.photoUnavailable')}</p>
++            <Button type="submit" busy={busy}>
++              {t('communityAdmin.save')}
++            </Button>
++          </form>
++          <Button
++            variant="secondary"
++            onClick={() => {
++              setVenueFormOpen(false);
++              setVenueDraft({ id: '', name: '', address: '', maps_url: '' });
++            }}
++          >
++            {t('communityAdmin.cancel')}
++          </Button>
++        </SurfaceCard>
++      )}
++      <div {...stylex.props(styles.list)}>
++        {[...venues, ...additionalVenues].map((venue) => (
++          <SurfaceCard
++            key={venue.id}
++            data-testid="community-venue-card"
++            xstyle={[styles.card, styles.venueCard]}
++          >
++            <h3 {...stylex.props(styles.cardCompactTitle)}>{venue.name}</h3>
++            <div {...stylex.props(styles.venueMeta)}>
++              <p {...stylex.props(styles.copy)}>
++                {venue.address || community.city_label || t('communityAdmin.cityUnavailable')}
++              </p>
++              {venue.maps_url && (
++                <a
++                  href={venue.maps_url}
++                  target="_blank"
++                  rel="noreferrer"
++                  {...stylex.props(styles.memberLink, styles.venueMapLink)}
++                >
++                  {t('communityAdmin.venue.openMap')}
++                </a>
++              )}
++            </div>
++            <div {...stylex.props(styles.venueActions)}>
++              <Button
++                variant="secondary"
++                xstyle={styles.venueAction}
++                onClick={() => {
++                  setVenueDraft({
++                    id: venue.id,
++                    name: venue.name,
++                    address: venue.address ?? '',
++                    maps_url: venue.maps_url ?? ''
++                  });
++                  setVenueFormOpen(true);
++                }}
++              >
++                {t('communityAdmin.venue.edit')}
++              </Button>
++              <Button
++                variant="secondary"
++                xstyle={styles.venueAction}
++                busy={busy}
++                onClick={() =>
++                  void run(
++                    () =>
++                      archiveCommunityVenue({
++                        data: { community_id: community.id, venue_id: venue.id }
++                      }),
++                    t('communityAdmin.result.venueArchived')
++                  )
++                }
++              >
++                {t('communityAdmin.venue.archive')}
++              </Button>
++            </div>
++          </SurfaceCard>
++        ))}
++        {!venues.length && !additionalVenues.length && <p>{t('communityAdmin.empty.venues')}</p>}
++      </div>
++      {hasMoreVenues ? (
++        <Button variant="secondary" busy={busy} onClick={() => void loadMoreVenues()}>
++          {t('communityAdmin.loadMore')}
++        </Button>
++      ) : (
++        hasLoadedMoreVenues && <p {...stylex.props(styles.copy)}>{t('communityAdmin.endOfList')}</p>
++      )}
++      <p {...stylex.props(styles.note)}>{t('communityAdmin.venue.historyNote')}</p>
++      {message && <output {...stylex.props(styles.status)}>{message}</output>}
++      {errorKey && (
++        <p role="alert" {...stylex.props(styles.error)}>
++          {t(`communityAdmin.error.${errorKey}`)}
++        </p>
++      )}
++      {errorKey && (
++        <Button variant="secondary" onClick={() => void router.invalidate()}>
++          {t('communityAdmin.retry')}
++        </Button>
++      )}
++    </AdminViewFrame>
++  );
++}
++
++function AuditView(props: ViewProps<'audit'>) {
++  const { community, audit } = props;
++  const { t, i18n } = useTranslation();
++  const router = useRouter();
++  const params = useParams({ strict: false });
++  const communityId = params.communityId ?? '';
++  const [additionalAudit, setAdditionalAudit] = useState<{
++    source: CommunityAdminAudit[];
++    rows: CommunityAdminAudit[];
++  }>({ source: audit, rows: [] });
++  const auditSourceRef = useRef(audit);
++  const auditGeneration = useRef(0);
++  const [hasMoreAudit, setHasMoreAudit] = useState(audit.length === 3);
++  const [hasLoadedMoreAudit, setHasLoadedMoreAudit] = useState(false);
++  const { busy, setBusy, message, setMessage, errorKey, setErrorKey } = useAdminMutationState();
++  const locale = i18n.resolvedLanguage || i18n.language;
++  const auditRows = additionalAudit.source === audit ? [...audit, ...additionalAudit.rows] : audit;
++
++  useEffect(() => {
++    if (auditSourceRef.current === audit) return;
++    auditSourceRef.current = audit;
++    auditGeneration.current += 1;
++    setAdditionalAudit({ source: audit, rows: [] });
++    setHasMoreAudit(audit.length === 3);
++    setHasLoadedMoreAudit(false);
++  }, [audit]);
++
++  async function loadMoreAudit() {
++    if (busy || !hasMoreAudit) return;
++    setBusy(true);
++    setHasLoadedMoreAudit(true);
++    const source = audit;
++    const generation = ++auditGeneration.current;
++    try {
++      const page = await listCommunityAudit({
++        data: { community_id: community.id, offset: auditRows.length, limit: 3 }
++      });
++      if (auditSourceRef.current !== source || auditGeneration.current !== generation) return;
++      setAdditionalAudit((previous) => ({
++        source,
++        rows: previous.source === source ? [...previous.rows, ...page] : page
++      }));
++      setHasMoreAudit(page.length === 3);
++    } catch (error) {
++      if (auditSourceRef.current === source && auditGeneration.current === generation)
++        setErrorKey(failed(error));
++    } finally {
++      if (auditGeneration.current === generation) setBusy(false);
++    }
++  }
++
++  return (
++    <AdminViewFrame communityId={communityId} communityName={community.name} screen="audit">
++      <div {...stylex.props(styles.list)}>
++        <p {...stylex.props(styles.banner)}>{t('communityAdmin.audit.recentChanges')}</p>
++        {auditRows.map((event) => (
++          <SurfaceCard
++            key={event.id}
++            data-testid="community-audit-event"
++            xstyle={[styles.card, styles.auditCard]}
++          >
++            <p {...stylex.props(styles.auditAction)}>
++              {t(auditEventKey(event), { defaultValue: t('communityAdmin.audit.unknown') })}
++              {auditMemberDetails(event) &&
++                ` · ${t(`communityAdmin.role.${auditMemberDetails(event)?.role}`)} · ${t(`communityAdmin.status.${auditMemberDetails(event)?.status}`)}`}
++            </p>
++            <p {...stylex.props(styles.copy)}>
++              {t('communityAdmin.audit.unknownActor')} · {auditDateLabel(event.occurred_at, locale)}
++            </p>
++            {event.entity === 'community_members' && (
++              <Link
++                to="/community/$communityId/admin/members/$membershipId"
++                params={{ communityId, membershipId: event.entity_id }}
++                {...stylex.props(styles.memberLink)}
++              >
++                {t('communityAdmin.audit.openMember')}
++              </Link>
++            )}
++          </SurfaceCard>
++        ))}
++        {!auditRows.length && <p>{t('communityAdmin.empty.audit')}</p>}
++        {hasMoreAudit ? (
++          <Button variant="secondary" busy={busy} onClick={() => void loadMoreAudit()}>
++            {t('communityAdmin.loadMore')}
++          </Button>
++        ) : (
++          hasLoadedMoreAudit && (
++            <p {...stylex.props(styles.copy)}>{t('communityAdmin.endOfList')}</p>
++          )
++        )}
++      </div>
++      {message && <output {...stylex.props(styles.status)}>{message}</output>}
++      {errorKey && (
++        <p role="alert" {...stylex.props(styles.error)}>
++          {t(`communityAdmin.error.${errorKey}`)}
++        </p>
++      )}
++      {errorKey && (
++        <Button
++          variant="secondary"
++          onClick={() => {
++            setMessage('');
++            setErrorKey('');
++            void router.invalidate();
++          }}
++        >
++          {t('communityAdmin.retry')}
++        </Button>
++      )}
++    </AdminViewFrame>
++  );
++}
++
++function auditDateLabel(value: string, locale: string) {
++  return new Intl.DateTimeFormat(locale, {
++    dateStyle: 'medium',
++    timeStyle: 'short',
++    timeZone: 'UTC'
++  }).format(new Date(value));
++}
++
++function auditEventKey(event: CommunityAdminAudit) {
++  const action = event.action.toLowerCase();
++  const details = event.details;
++  if (
++    event.entity === 'community_members' &&
++    action === 'insert' &&
++    typeof details === 'object' &&
++    details !== null &&
++    'status' in details &&
++    details.status === 'pending'
++  )
++    return 'communityAdmin.audit.requestCreated';
++  if (event.entity === 'community_venues')
++    return action === 'insert'
++      ? 'communityAdmin.audit.venueAdded'
++      : 'communityAdmin.audit.venueUpdated';
++  if (event.entity === 'community_members')
++    return action === 'insert'
++      ? 'communityAdmin.audit.memberAdded'
++      : 'communityAdmin.audit.memberUpdated';
++  if (event.entity === 'communities') return 'communityAdmin.audit.settingsUpdated';
++  if (event.entity === 'community_invitations')
++    return action === 'insert'
++      ? 'communityAdmin.audit.invitationAdded'
++      : 'communityAdmin.audit.invitationUpdated';
++  return 'communityAdmin.audit.unknown';
++}
++
++function auditMemberDetails(event: CommunityAdminAudit) {
++  if (event.entity !== 'community_members' || typeof event.details !== 'object' || !event.details)
++    return null;
++  const role =
++    'role' in event.details && (event.details.role === 'admin' || event.details.role === 'member')
++      ? event.details.role
++      : null;
++  const status =
++    'status' in event.details &&
++    (event.details.status === 'active' ||
++      event.details.status === 'pending' ||
++      event.details.status === 'inactive')
++      ? event.details.status
++      : null;
++  return role && status ? { role, status } : null;
++}
++
++export function CommunityAdminDispatcher(props: CommunityAdminScreenProps) {
++  switch (props.screen) {
++    case 'requests':
++      return <RequestsView {...props} />;
++    case 'members':
++      return <MembersView {...props} />;
++    case 'member':
++      return <MemberView {...props} />;
++    case 'settings':
++      return <SettingsView {...props} />;
++    case 'venues':
++      return <VenuesView {...props} />;
++    case 'audit':
++      return <AuditView {...props} />;
++  }
++  return null;
++}
+diff --git a/src/features/community/CommunityOnboarding.tsx b/src/features/community/CommunityOnboarding.tsx
+index f37932b..eee9a37 100644
+--- a/src/features/community/CommunityOnboarding.tsx
++++ b/src/features/community/CommunityOnboarding.tsx
+@@ -3,7 +3,7 @@ import { RadioGroup } from '@base-ui/react/radio-group';
+ import * as stylex from '@stylexjs/stylex';
+ import { useEffect, useRef, useState, type FormEvent } from 'react';
+ import { useTranslation } from 'react-i18next';
+-import { useNavigate, useRouter } from '@tanstack/react-router';
++import { useNavigate, useRouter, useRouterState } from '@tanstack/react-router';
+ import { Button } from '../../components/ui/Button';
+ import { StepBadge } from '../../components/ui/StepBadge';
+ import { SurfaceCard } from '../../components/ui/SurfaceCard';
+@@ -24,6 +24,14 @@ export function CommunityOnboarding({ search, data }: { search: Search; data: Pa
+   const { t } = useTranslation();
+   const navigate = useNavigate();
+   const router = useRouter();
++  const routePending = useRouterState({
++    select: (state) =>
++      state.matches.some(
++        (match) =>
++          match.routeId === '/onboarding_/community' &&
++          (match.status === 'pending' || match.isFetching)
++      )
++  });
+   const [draft, setDraft] = useState(search.q ?? '');
+   const [more, setMore] = useState<{ query: string; source: Page; page: Page } | null>(null);
+   const [loadingMore, setLoadingMore] = useState(false);
+@@ -212,59 +220,71 @@ export function CommunityOnboarding({ search, data }: { search: Search; data: Pa
+             </p>
+           )}
+           {listError && (
+-            <Button variant="secondary" onClick={() => void router.invalidate()}>
++            <Button
++              variant="secondary"
++              busy={routePending}
++              disabled={routePending}
++              onClick={() => void router.invalidate()}
++            >
+               {t('communityOnboarding.retry')}
+             </Button>
+           )}
+-          {current && !listError && !rows.length && (
+-            <output {...stylex.props(ui.help)}>
+-              {t(
+-                search.q ? 'communityOnboarding.emptySearch' : 'communityOnboarding.noCommunities'
+-              )}
+-            </output>
++          {(routePending || (!current && search.view !== 'create')) && (
++            <output {...stylex.props(ui.status)}>{t('communityOnboarding.searchLoading')}</output>
+           )}
+-          {rows.map((community) => (
+-            <SurfaceCard key={community.id} xstyle={ui.card}>
+-              <h3 {...stylex.props(ui.cardTitle)}>{community.name}</h3>
+-              <p {...stylex.props(ui.meta)}>
+-                {t('communityOnboarding.cityPolicy', {
+-                  city: community.city_label || t('communityOnboarding.cityUnknown'),
+-                  policy: t(
+-                    community.join_policy === 'instant'
+-                      ? 'communityOnboarding.openJoin'
+-                      : 'communityOnboarding.approvalRequired'
+-                  )
+-                })}
+-              </p>
+-              {results[community.id] && (
+-                <output
+-                  {...stylex.props(results[community.id] === 'joinFailed' ? ui.error : ui.status)}
+-                >
+-                  {t(`communityOnboarding.${results[community.id]}`)}
+-                </output>
+-              )}
+-              <Button
+-                variant="secondary"
+-                xstyle={[
+-                  ui.cardAction,
+-                  community.join_policy === 'admin_approval' && ui.requestAction
+-                ]}
+-                busy={joining === community.id}
+-                disabled={Boolean(results[community.id]) && results[community.id] !== 'joinFailed'}
+-                onClick={() => void join(community)}
+-              >
++          <div aria-busy={routePending || !current} {...stylex.props(ui.results)}>
++            {current && !routePending && !listError && !rows.length && (
++              <output {...stylex.props(ui.help)}>
+                 {t(
+-                  joining === community.id
+-                    ? community.join_policy === 'instant'
+-                      ? 'communityOnboarding.joining'
+-                      : 'communityOnboarding.requesting'
+-                    : community.join_policy === 'instant'
+-                      ? 'communityOnboarding.join'
+-                      : 'communityOnboarding.requestToJoin'
++                  search.q ? 'communityOnboarding.emptySearch' : 'communityOnboarding.noCommunities'
++                )}
++              </output>
++            )}
++            {rows.map((community) => (
++              <SurfaceCard key={community.id} xstyle={ui.card}>
++                <h3 {...stylex.props(ui.cardTitle)}>{community.name}</h3>
++                <p {...stylex.props(ui.meta)}>
++                  {t('communityOnboarding.cityPolicy', {
++                    city: community.city_label || t('communityOnboarding.cityUnknown'),
++                    policy: t(
++                      community.join_policy === 'instant'
++                        ? 'communityOnboarding.openJoin'
++                        : 'communityOnboarding.approvalRequired'
++                    )
++                  })}
++                </p>
++                {results[community.id] && (
++                  <output
++                    {...stylex.props(results[community.id] === 'joinFailed' ? ui.error : ui.status)}
++                  >
++                    {t(`communityOnboarding.${results[community.id]}`)}
++                  </output>
+                 )}
+-              </Button>
+-            </SurfaceCard>
+-          ))}
++                <Button
++                  variant="secondary"
++                  xstyle={[
++                    ui.cardAction,
++                    community.join_policy === 'admin_approval' && ui.requestAction
++                  ]}
++                  busy={joining === community.id}
++                  disabled={
++                    Boolean(results[community.id]) && results[community.id] !== 'joinFailed'
++                  }
++                  onClick={() => void join(community)}
++                >
++                  {t(
++                    joining === community.id
++                      ? community.join_policy === 'instant'
++                        ? 'communityOnboarding.joining'
++                        : 'communityOnboarding.requesting'
++                      : community.join_policy === 'instant'
++                        ? 'communityOnboarding.join'
++                        : 'communityOnboarding.requestToJoin'
++                  )}
++                </Button>
++              </SurfaceCard>
++            ))}
++          </div>
+           {nextOffset !== null && (
+             <Button variant="secondary" busy={loadingMore} onClick={() => void loadMore()}>
+               {t('communityOnboarding.loadMore')}
+@@ -407,28 +427,30 @@ function CreateCommunityView({ onBack }: { onBack: () => void }) {
+             <span {...stylex.props(ui.label, ui.optionalHeading)}>
+               {t('communityOnboarding.optionalDetails')}
+             </span>
+-            <label {...stylex.props(ui.hidden)} htmlFor="community-description">
+-              {t('communityOnboarding.descriptionLabel')}
+-            </label>
+-            <input
+-              id="community-description"
+-              {...stylex.props(ui.optionalInput)}
+-              placeholder={t('communityOnboarding.descriptionExample')}
+-              value={description}
+-              onChange={(event) => setDescription(event.target.value)}
+-              maxLength={500}
+-            />
+-            <label {...stylex.props(ui.hidden)} htmlFor="community-city">
+-              {t('communityOnboarding.cityLabel')}
+-            </label>
+-            <input
+-              id="community-city"
+-              {...stylex.props(ui.optionalInput, ui.divider)}
+-              placeholder={t('communityOnboarding.cityExample')}
+-              value={city}
+-              onChange={(event) => setCity(event.target.value)}
+-              maxLength={120}
+-            />
++            <div {...stylex.props(ui.optionalField)}>
++              <label {...stylex.props(ui.floatingLabel)} htmlFor="community-description">
++                {t('communityOnboarding.descriptionLabel')}
++              </label>
++              <input
++                id="community-description"
++                {...stylex.props(ui.optionalInput, ui.labeledInput)}
++                value={description}
++                onChange={(event) => setDescription(event.target.value)}
++                maxLength={500}
++              />
++            </div>
++            <div {...stylex.props(ui.optionalField, ui.divider)}>
++              <label {...stylex.props(ui.floatingLabel)} htmlFor="community-city">
++                {t('communityOnboarding.cityLabel')}
++              </label>
++              <input
++                id="community-city"
++                {...stylex.props(ui.optionalInput, ui.labeledInput)}
++                value={city}
++                onChange={(event) => setCity(event.target.value)}
++                maxLength={120}
++              />
++            </div>
+           </SurfaceCard>
+           <p {...stylex.props(ui.help)}>{t('communityOnboarding.adminNote')}</p>
+           {createError && (
+diff --git a/src/features/community/community-admin.functions.ts b/src/features/community/community-admin.functions.ts
+index f5b281a..3f2cad3 100644
+--- a/src/features/community/community-admin.functions.ts
++++ b/src/features/community/community-admin.functions.ts
+@@ -3,6 +3,7 @@ import { requireAuthenticatedClient } from '../auth/auth.server';
+ import type { CommunityMemberSearchResult } from './community-admin.types';
+ import {
+   validateInvitation,
++  validateCommunityId,
+   validateMemberAction,
+   validatePage,
+   validateRevokeInvitation,
+@@ -99,18 +100,7 @@ async function requireAdmin(communityId: string) {
+ }
+
+ export const getCommunityAdminContext = createServerFn({ method: 'GET' })
+-  .validator((value: unknown) => {
+-    if (!value || typeof value !== 'object' || Array.isArray(value))
+-      throw new Error('INVALID_COMMUNITY_INPUT');
+-    if (
+-      !('community_id' in value) ||
+-      Object.keys(value).length !== 1 ||
+-      typeof value.community_id !== 'string' ||
+-      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.community_id)
+-    )
+-      throw new Error('INVALID_COMMUNITY_INPUT');
+-    return { community_id: value.community_id };
+-  })
++  .validator(validateCommunityId)
+   .handler(async ({ data }) => {
+     const client = await requireAdmin(data.community_id);
+     const { data: community, error } = await client
+diff --git a/src/features/community/community-admin.styles.ts b/src/features/community/community-admin.styles.ts
+index 1636d9c..ec3e54f 100644
+--- a/src/features/community/community-admin.styles.ts
++++ b/src/features/community/community-admin.styles.ts
+@@ -15,7 +15,9 @@ export const styles = stylex.create({
+     backgroundColor: 'var(--color-bg)',
+     color: 'var(--color-text)',
+     fontFamily: 'var(--font-family-body)',
+-    overflowY: 'auto'
++    overflowY: 'auto',
++    scrollPaddingBottom:
++      'calc(var(--space-14) + var(--space-40) + var(--space-16) + var(--space-4))'
+   },
+   header: { display: 'flex', flexDirection: 'column', gap: 0 },
+   title: {
+@@ -32,6 +34,41 @@ export const styles = stylex.create({
+     overflowWrap: 'anywhere'
+   },
+   content: { display: 'flex', flexDirection: 'column', gap: 'var(--space-8)', minWidth: 0 },
++  confirmBackdrop: {
++    position: 'fixed',
++    inset: 0,
++    backgroundColor: 'var(--color-text)',
++    opacity: 0.6
++  },
++  confirmViewport: {
++    position: 'fixed',
++    inset: 0,
++    display: 'flex',
++    alignItems: 'center',
++    justifyContent: 'center',
++    padding: 'var(--space-8)',
++    overflowY: 'auto'
++  },
++  confirmDialog: {
++    boxSizing: 'border-box',
++    display: 'flex',
++    flexDirection: 'column',
++    gap: 'var(--space-8)',
++    width: 'min(100%, calc(var(--space-40) * 9))',
++    padding: 'var(--space-12)',
++    borderRadius: 'var(--radius-12)',
++    backgroundColor: 'var(--color-surface)',
++    color: 'var(--color-text)',
++    border: 'var(--border-width-sm) solid var(--color-line)',
++    overflowWrap: 'anywhere'
++  },
++  confirmTitle: {
++    margin: 0,
++    fontSize: 'var(--font-size-14)',
++    lineHeight: 'var(--font-size-20)',
++    fontWeight: 'var(--font-weight-semibold)',
++    overflowWrap: 'anywhere'
++  },
+   venueContent: { gap: 'var(--space-10)' },
+   screenHeading: { display: 'flex', alignItems: 'center', gap: 'var(--space-6)' },
+   titleGroup: { display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', minWidth: 0 },
+@@ -47,6 +84,7 @@ export const styles = stylex.create({
+     fontFamily: 'var(--font-family-heading)',
+     fontSize: 'var(--font-size-20)',
+     fontWeight: 'var(--font-weight-bold)',
++    // Decorative aria-hidden chevron uses a unitless single-em line box for glyph centering; its 44px hit box is independent of line-height. The tight (1.1) and body (1.5) tokens are text-leading metrics, not equivalent icon metrics.
+     lineHeight: 1,
+     textDecoration: 'none',
+     ':focus-visible': {
+@@ -86,6 +124,29 @@ export const styles = stylex.create({
+     gap: 'var(--space-6)',
+     padding: 'var(--space-14)'
+   },
++  errorActions: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-4)' },
++  errorAction: {
++    boxSizing: 'border-box',
++    minHeight: 'calc(var(--space-40) + var(--space-4))',
++    display: 'inline-flex',
++    alignItems: 'center',
++    justifyContent: 'center',
++    paddingInline: 'var(--space-10)',
++    border: 0,
++    borderRadius: 'var(--radius-10)',
++    backgroundColor: 'var(--color-green-soft)',
++    color: 'var(--color-green)',
++    font: 'inherit',
++    fontSize: 'var(--font-size-12)',
++    fontWeight: 'var(--font-weight-semibold)',
++    textDecoration: 'none',
++    overflowWrap: 'anywhere',
++    ':focus-visible': {
++      outline: 'var(--border-width-lg) solid var(--color-green)',
++      outlineOffset: 'var(--space-2)'
++    },
++    ':disabled': { opacity: 0.6 }
++  },
+   requestCard: {
+     minHeight: 'calc(var(--space-40) * 5)',
+     boxSizing: 'border-box'
+@@ -241,6 +302,14 @@ export const styles = stylex.create({
+     ':focus-visible': {
+       outline: 'var(--border-width-lg) solid var(--color-green)',
+       outlineOffset: 'var(--space-2)'
++    },
++    '@media (max-width: 360px)': {
++      display: 'inline-flex',
++      alignItems: 'center',
++      boxSizing: 'border-box',
++      minWidth: 'calc(var(--space-40) + var(--space-4))',
++      minHeight: 'calc(var(--space-40) + var(--space-4))',
++      paddingInline: 'var(--space-4)'
+     }
+   },
+   venueActions: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' },
+@@ -250,7 +319,14 @@ export const styles = stylex.create({
+     gap: 'var(--space-6)',
+     padding: 'var(--space-14)'
+   },
+-  venueAction: { backgroundColor: 'var(--color-surface-2)', borderWidth: 0 },
++  venueAction: {
++    backgroundColor: 'var(--color-surface-2)',
++    borderWidth: 0,
++    '@media (max-width: 360px)': {
++      minWidth: 'calc(var(--space-40) + var(--space-4))',
++      minHeight: 'calc(var(--space-40) + var(--space-4))'
++    }
++  },
+   venueMeta: {
+     display: 'flex',
+     alignItems: 'center',
+diff --git a/src/features/community/community-admin.types.ts b/src/features/community/community-admin.types.ts
+index 9c98cc9..92df322 100644
+--- a/src/features/community/community-admin.types.ts
++++ b/src/features/community/community-admin.types.ts
+@@ -12,3 +12,39 @@ export type CommunityMemberSearchResult = Omit<
+   display_level: number | null;
+   reliability_percent: number | null;
+ };
++
++export type CommunityAdminCommunity = Pick<
++  Database['public']['Tables']['communities']['Row'],
++  'id' | 'name' | 'city_label' | 'description' | 'visibility' | 'join_policy'
++>;
++export type CommunityAdminMember = CommunityMemberSearchResult;
++export type CommunityAdminVenue = Pick<
++  Database['public']['Tables']['community_venues']['Row'],
++  | 'id'
++  | 'community_id'
++  | 'name'
++  | 'address'
++  | 'maps_url'
++  | 'photo_path'
++  | 'created_at'
++  | 'updated_at'
++  | 'archived_at'
++>;
++export type CommunityAdminAudit = Pick<
++  Database['public']['Tables']['community_audit_log']['Row'],
++  'id' | 'actor_user_id' | 'entity' | 'entity_id' | 'action' | 'details' | 'occurred_at'
++>;
++
++type CommunityProps = { community: CommunityAdminCommunity };
++type MemberCollectionProps = CommunityProps & { members: CommunityAdminMember[] };
++export type CommunityAdminScreenProps =
++  | (MemberCollectionProps & { screen: 'requests' })
++  | (MemberCollectionProps & { screen: 'members' })
++  | (CommunityProps & {
++      screen: 'member';
++      member: CommunityAdminMember;
++      membershipId: string;
++    })
++  | (CommunityProps & { screen: 'settings' })
++  | (CommunityProps & { screen: 'venues'; venues: CommunityAdminVenue[] })
++  | (CommunityProps & { screen: 'audit'; audit: CommunityAdminAudit[] });
+diff --git a/src/features/community/community-admin.validators.ts b/src/features/community/community-admin.validators.ts
+index 12790da..063ea14 100644
+--- a/src/features/community/community-admin.validators.ts
++++ b/src/features/community/community-admin.validators.ts
+@@ -50,6 +50,10 @@ export function validateMemberAction(value: unknown): MemberActionInput {
+   const input = record(value, ['community_id', 'membership_id']);
+   return { community_id: uuid(input.community_id), membership_id: uuid(input.membership_id) };
+ }
++export function validateCommunityId(value: unknown): { community_id: string } {
++  const input = record(value, ['community_id']);
++  return { community_id: uuid(input.community_id) };
++}
+ export function validatePage(value: unknown): PageInput {
+   const input = record(value, ['community_id', 'offset', 'limit']);
+   return page(input);
+diff --git a/src/features/community/community-onboarding.styles.ts b/src/features/community/community-onboarding.styles.ts
+index dcf8cd9..e9821f5 100644
+--- a/src/features/community/community-onboarding.styles.ts
++++ b/src/features/community/community-onboarding.styles.ts
+@@ -29,6 +29,7 @@ export const ui = stylex.create({
+   },
+   subtitle: { margin: 0, fontSize: 'var(--font-size-12)', color: 'var(--color-muted)' },
+   content: { display: 'flex', flexDirection: 'column', gap: 'var(--space-10)', minWidth: 0 },
++  results: { display: 'flex', flexDirection: 'column', gap: 'var(--space-10)', minWidth: 0 },
+   intro: { display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' },
+   createIntro: { gap: 'var(--space-4)' },
+   lead: {
+@@ -139,6 +140,18 @@ export const ui = stylex.create({
+   },
+   optional: { gap: 0, padding: 'var(--space-12)', borderRadius: 'var(--radius-14)' },
+   optionalHeading: { marginBottom: 'var(--space-7)' },
++  optionalField: { position: 'relative', minHeight: 'calc(var(--space-40) + var(--space-4))' },
++  floatingLabel: {
++    position: 'absolute',
++    top: 'var(--space-3)',
++    left: 'var(--space-8)',
++    zIndex: 1,
++    color: 'var(--color-muted)',
++    fontSize: 'var(--font-size-10)',
++    lineHeight: 'var(--line-height-tight)',
++    pointerEvents: 'none'
++  },
++  labeledInput: { paddingTop: 'var(--space-16)' },
+   optionalInput: {
+     width: '100%',
+     minHeight: 'calc(var(--space-40) + var(--space-4))',
+diff --git a/src/locales/en/translation.json b/src/locales/en/translation.json
+index 166912a..85ec3af 100644
+--- a/src/locales/en/translation.json
++++ b/src/locales/en/translation.json
+@@ -23,6 +23,7 @@
+     "lead": "Play with people nearby",
+     "help": "Public communities are visible to everyone. You can join more communities later.",
+     "searchLabel": "Search community",
++    "searchLoading": "Searching communities…",
+     "searchPlaceholder": "Search by name or city",
+     "join": "JOIN COMMUNITY",
+     "requestToJoin": "REQUEST TO JOIN",
+diff --git a/src/locales/es/translation.json b/src/locales/es/translation.json
+index 3aa3939..d098f66 100644
+--- a/src/locales/es/translation.json
++++ b/src/locales/es/translation.json
+@@ -23,6 +23,7 @@
+     "lead": "Juega con gente cercana",
+     "help": "Las comunidades públicas son visibles para todos. Puedes unirte a otras más adelante.",
+     "searchLabel": "Buscar comunidad",
++    "searchLoading": "Buscando comunidades…",
+     "searchPlaceholder": "Busca por nombre o ciudad",
+     "join": "UNIRME A LA COMUNIDAD",
+     "requestToJoin": "SOLICITAR ACCESO",
+diff --git a/src/locales/pt-BR/translation.json b/src/locales/pt-BR/translation.json
+index db2cf50..766d60c 100644
+--- a/src/locales/pt-BR/translation.json
++++ b/src/locales/pt-BR/translation.json
+@@ -23,6 +23,7 @@
+     "lead": "Jogue com pessoas por perto",
+     "help": "Comunidades públicas são visíveis para todos. Você pode entrar em outras depois.",
+     "searchLabel": "Buscar comunidade",
++    "searchLoading": "Buscando comunidades…",
+     "searchPlaceholder": "Busque por nome ou cidade",
+     "join": "ENTRAR NA COMUNIDADE",
+     "requestToJoin": "PEDIR PARA ENTRAR",
+diff --git a/src/routes/__root.tsx b/src/routes/__root.tsx
+index 52c3adf..0ee73a1 100644
+--- a/src/routes/__root.tsx
++++ b/src/routes/__root.tsx
+@@ -67,12 +67,12 @@ function Root() {
+               <select
+                 id="locale"
+                 value={locale}
+-                onChange={(event) => {
++                onChange={async (event) => {
+                   const next = resolveLocale(event.target.value);
++                  await i18n.changeLanguage(next);
++                  await saveLocale({ data: next });
+                   setLocale(next);
+-                  void i18n.changeLanguage(next);
+                   document.documentElement.lang = next;
+-                  void saveLocale({ data: next });
+                 }}
+               >
+                 <option value="en">English</option>
+diff --git a/src/routes/_protected.community.$communityId.admin.audit.tsx b/src/routes/_protected.community.$communityId.admin.audit.tsx
+index 84d8f0b..9f8166c 100644
+--- a/src/routes/_protected.community.$communityId.admin.audit.tsx
++++ b/src/routes/_protected.community.$communityId.admin.audit.tsx
+@@ -21,5 +21,8 @@ export const Route = createFileRoute('/_protected/community/$communityId/admin/a
+   },
+   pendingComponent: CommunityAdminLoading,
+   errorComponent: CommunityAdminDenied,
+-  component: () => <CommunityAdminScreen {...Route.useLoaderData()} screen="audit" />
++  component: () => {
++    const data = Route.useLoaderData();
++    return <CommunityAdminScreen screen="audit" community={data.community} audit={data.audit} />;
++  }
+ });
+diff --git a/src/routes/_protected.community.$communityId.admin.members.$membershipId.tsx b/src/routes/_protected.community.$communityId.admin.members.$membershipId.tsx
+index fc101e5..123947d 100644
+--- a/src/routes/_protected.community.$communityId.admin.members.$membershipId.tsx
++++ b/src/routes/_protected.community.$communityId.admin.members.$membershipId.tsx
+@@ -19,9 +19,19 @@ export const Route = createFileRoute(
+     const member = await getCommunityMemberById({
+       data: { community_id: params.communityId, membership_id: params.membershipId }
+     });
+-    return { community, members: [member], membershipId: params.membershipId };
++    return { community, member, membershipId: params.membershipId };
+   },
+   pendingComponent: CommunityAdminLoading,
+   errorComponent: CommunityAdminDenied,
+-  component: () => <CommunityAdminScreen {...Route.useLoaderData()} screen="member" />
++  component: () => {
++    const data = Route.useLoaderData();
++    return (
++      <CommunityAdminScreen
++        screen="member"
++        community={data.community}
++        member={data.member}
++        membershipId={data.membershipId}
++      />
++    );
++  }
+ });
+diff --git a/src/routes/_protected.community.$communityId.admin.members.index.tsx b/src/routes/_protected.community.$communityId.admin.members.index.tsx
+new file mode 100644
+index 0000000..4914eaf
+--- /dev/null
++++ b/src/routes/_protected.community.$communityId.admin.members.index.tsx
+@@ -0,0 +1,32 @@
++import { createFileRoute } from '@tanstack/react-router';
++import {
++  CommunityAdminDenied,
++  CommunityAdminLoading,
++  CommunityAdminScreen
++} from '../features/community/CommunityAdmin';
++import {
++  getCommunityAdminContext,
++  searchCommunityMembers
++} from '../features/community/community-admin.functions';
++
++export const Route = createFileRoute('/_protected/community/$communityId/admin/members/')({
++  loader: async ({ params }) => {
++    const community = await getCommunityAdminContext({
++      data: { community_id: params.communityId }
++    });
++    const members = await searchCommunityMembers({
++      data: { community_id: params.communityId, query: '', status: 'active', offset: 0, limit: 50 }
++    });
++    return { community, members };
++  },
++  pendingComponent: CommunityAdminLoading,
++  errorComponent: CommunityAdminDenied,
++  component: MembersIndexRoute
++});
++
++function MembersIndexRoute() {
++  const data = Route.useLoaderData();
++  return (
++    <CommunityAdminScreen screen="members" community={data.community} members={data.members} />
++  );
++}
+diff --git a/src/routes/_protected.community.$communityId.admin.members.tsx b/src/routes/_protected.community.$communityId.admin.members.tsx
+index baf0a10..1a6d7fa 100644
+--- a/src/routes/_protected.community.$communityId.admin.members.tsx
++++ b/src/routes/_protected.community.$communityId.admin.members.tsx
+@@ -1,35 +1,5 @@
+-import { createFileRoute, Outlet, useRouterState } from '@tanstack/react-router';
+-import {
+-  CommunityAdminDenied,
+-  CommunityAdminLoading,
+-  CommunityAdminScreen
+-} from '../features/community/CommunityAdmin';
+-import {
+-  getCommunityAdminContext,
+-  searchCommunityMembers
+-} from '../features/community/community-admin.functions';
++import { createFileRoute, Outlet } from '@tanstack/react-router';
+
+ export const Route = createFileRoute('/_protected/community/$communityId/admin/members')({
+-  loader: async ({ params }) => {
+-    const community = await getCommunityAdminContext({
+-      data: { community_id: params.communityId }
+-    });
+-    const members = await searchCommunityMembers({
+-      data: { community_id: params.communityId, query: '', status: 'active', offset: 0, limit: 50 }
+-    });
+-    return { community, members };
+-  },
+-  pendingComponent: CommunityAdminLoading,
+-  errorComponent: CommunityAdminDenied,
+-  component: MembersRoute
++  component: () => <Outlet />
+ });
+-
+-function MembersRoute() {
+-  const data = Route.useLoaderData();
+-  const pathname = useRouterState({ select: (state) => state.location.pathname });
+-  return pathname.endsWith('/members') ? (
+-    <CommunityAdminScreen {...data} screen="members" />
+-  ) : (
+-    <Outlet />
+-  );
+-}
+diff --git a/src/routes/_protected.community.$communityId.admin.requests.tsx b/src/routes/_protected.community.$communityId.admin.requests.tsx
+index 26fd7b7..80f284b 100644
+--- a/src/routes/_protected.community.$communityId.admin.requests.tsx
++++ b/src/routes/_protected.community.$communityId.admin.requests.tsx
+@@ -23,6 +23,8 @@ export const Route = createFileRoute('/_protected/community/$communityId/admin/r
+   errorComponent: CommunityAdminDenied,
+   component: () => {
+     const data = Route.useLoaderData();
+-    return <CommunityAdminScreen screen="requests" {...data} />;
++    return (
++      <CommunityAdminScreen screen="requests" community={data.community} members={data.members} />
++    );
+   }
+ });
+diff --git a/src/routes/_protected.community.$communityId.admin.settings.tsx b/src/routes/_protected.community.$communityId.admin.settings.tsx
+index add75fb..b803de6 100644
+--- a/src/routes/_protected.community.$communityId.admin.settings.tsx
++++ b/src/routes/_protected.community.$communityId.admin.settings.tsx
+@@ -10,5 +10,8 @@ export const Route = createFileRoute('/_protected/community/$communityId/admin/s
+   loader: ({ params }) => getCommunityAdminContext({ data: { community_id: params.communityId } }),
+   pendingComponent: CommunityAdminLoading,
+   errorComponent: CommunityAdminDenied,
+-  component: () => <CommunityAdminScreen screen="settings" community={Route.useLoaderData()} />
++  component: () => {
++    const community = Route.useLoaderData();
++    return <CommunityAdminScreen screen="settings" community={community} />;
++  }
+ });
+diff --git a/src/routes/_protected.community.$communityId.admin.venues.tsx b/src/routes/_protected.community.$communityId.admin.venues.tsx
+index 10f3034..a4e77e7 100644
+--- a/src/routes/_protected.community.$communityId.admin.venues.tsx
++++ b/src/routes/_protected.community.$communityId.admin.venues.tsx
+@@ -21,5 +21,8 @@ export const Route = createFileRoute('/_protected/community/$communityId/admin/v
+   },
+   pendingComponent: CommunityAdminLoading,
+   errorComponent: CommunityAdminDenied,
+-  component: () => <CommunityAdminScreen {...Route.useLoaderData()} screen="venues" />
++  component: () => {
++    const data = Route.useLoaderData();
++    return <CommunityAdminScreen screen="venues" community={data.community} venues={data.venues} />;
++  }
+ });
+diff --git a/supabase/migrations/20261012111727_community_audit_changed_fields.sql b/supabase/migrations/20261012111727_community_audit_changed_fields.sql
+new file mode 100644
+index 0000000..8c19f85
+--- /dev/null
++++ b/supabase/migrations/20261012111727_community_audit_changed_fields.sql
+@@ -0,0 +1,60 @@
++create or replace function public.audit_community_change() returns trigger
++language plpgsql security definer set search_path = '' as $$
++declare
++  v_details jsonb := '{}'::jsonb;
++  v_changed_fields jsonb := '[]'::jsonb;
++  v_transitions jsonb := '{}'::jsonb;
++  v_community_id uuid;
++begin
++  if tg_table_name = 'communities' then
++    v_community_id := new.id;
++  else
++    v_community_id := new.community_id;
++  end if;
++
++  if tg_table_name = 'community_members' then
++    v_details := pg_catalog.jsonb_build_object('role', new.role, 'status', new.status);
++  elsif tg_table_name = 'communities' then
++    v_details := pg_catalog.jsonb_build_object('visibility', new.visibility);
++  elsif tg_table_name = 'community_invitations' then
++    v_details := pg_catalog.jsonb_build_object('revoked', new.revoked_at is not null);
++  elsif tg_table_name = 'community_venues' then
++    v_details := pg_catalog.jsonb_build_object('archived', new.archived_at is not null);
++  end if;
++
++  if tg_op = 'UPDATE' then
++    if tg_table_name = 'communities' then
++      if old.name is distinct from new.name then v_changed_fields := v_changed_fields || pg_catalog.jsonb_build_array('name'); end if;
++      if old.description is distinct from new.description then v_changed_fields := v_changed_fields || pg_catalog.jsonb_build_array('description'); end if;
++      if old.logo_path is distinct from new.logo_path then v_changed_fields := v_changed_fields || pg_catalog.jsonb_build_array('logo_path'); end if;
++      if old.city_label is distinct from new.city_label then v_changed_fields := v_changed_fields || pg_catalog.jsonb_build_array('city_label'); end if;
++      if old.visibility is distinct from new.visibility then
++        v_changed_fields := v_changed_fields || pg_catalog.jsonb_build_array('visibility');
++        v_transitions := v_transitions || pg_catalog.jsonb_build_object('visibility', pg_catalog.jsonb_build_object('before', old.visibility, 'after', new.visibility));
++      end if;
++      if old.join_policy is distinct from new.join_policy then
++        v_changed_fields := v_changed_fields || pg_catalog.jsonb_build_array('join_policy');
++        v_transitions := v_transitions || pg_catalog.jsonb_build_object('join_policy', pg_catalog.jsonb_build_object('before', old.join_policy, 'after', new.join_policy));
++      end if;
++      if old.settings is distinct from new.settings then v_changed_fields := v_changed_fields || pg_catalog.jsonb_build_array('settings'); end if;
++    elsif tg_table_name = 'community_venues' then
++      if old.name is distinct from new.name then v_changed_fields := v_changed_fields || pg_catalog.jsonb_build_array('name'); end if;
++      if old.address is distinct from new.address then v_changed_fields := v_changed_fields || pg_catalog.jsonb_build_array('address'); end if;
++      if old.maps_url is distinct from new.maps_url then v_changed_fields := v_changed_fields || pg_catalog.jsonb_build_array('maps_url'); end if;
++      if old.photo_path is distinct from new.photo_path then v_changed_fields := v_changed_fields || pg_catalog.jsonb_build_array('photo_path'); end if;
++      if old.archived_at is distinct from new.archived_at then
++        v_changed_fields := v_changed_fields || pg_catalog.jsonb_build_array('archived_at');
++        v_transitions := v_transitions || pg_catalog.jsonb_build_object('archived', pg_catalog.jsonb_build_object('before', old.archived_at is not null, 'after', new.archived_at is not null));
++      end if;
++    end if;
++    if tg_table_name in ('communities', 'community_venues') then
++      v_details := v_details || pg_catalog.jsonb_build_object('changed_fields', v_changed_fields, 'transitions', v_transitions);
++    end if;
++  end if;
++
++  insert into public.community_audit_log (community_id, actor_user_id, entity, entity_id, action, details)
++    values (v_community_id, (select auth.uid()), tg_table_name, new.id, tg_op, v_details);
++  return new;
++end;
++$$;
++revoke all on function public.audit_community_change() from public, anon, authenticated;
+diff --git a/test/community.admin-extraction.test.ts b/test/community.admin-extraction.test.ts
+index b5a743a..cf691e0 100644
+--- a/test/community.admin-extraction.test.ts
++++ b/test/community.admin-extraction.test.ts
+@@ -1,5 +1,15 @@
+-import { readdirSync, readFileSync } from 'node:fs';
+-import { describe, expect, it } from 'vitest';
++import { execFile } from 'node:child_process';
++import { readdirSync, readFileSync, statSync } from 'node:fs';
++import { promisify } from 'node:util';
++import { beforeAll, describe, expect, it } from 'vitest';
++
++const execFileAsync = promisify(execFile);
++const buildTimeoutMs = 120_000;
++const filesystemTimestampToleranceMs = 2_000;
++
++function isFreshArtifact(mtimeMs: number, buildStartedAtMs: number): boolean {
++  return mtimeMs >= buildStartedAtMs - filesystemTimestampToleranceMs;
++}
+
+ const endpointNames = [
+   'approveCommunityMember',
+@@ -11,12 +21,45 @@ const endpointNames = [
+ ] as const;
+
+ describe('admin server-function extraction (production build)', () => {
++  let buildStartedAtMs: number;
++
++  beforeAll(async () => {
++    // Never run this production build concurrently with Playwright: both use dist.
++    buildStartedAtMs = Date.now();
++    try {
++      const { stdout, stderr } = await execFileAsync('pnpm', ['build'], {
++        timeout: buildTimeoutMs,
++        maxBuffer: 10 * 1024 * 1024
++      });
++      // Keep output available for diagnostics while avoiding environment values.
++      if (stdout) process.stdout.write(stdout);
++      if (stderr) process.stderr.write(stderr);
++    } catch (error) {
++      const output = (key: 'stdout' | 'stderr') =>
++        error &&
++        typeof error === 'object' &&
++        typeof Object.getOwnPropertyDescriptor(error, key)?.value === 'string'
++          ? Object.getOwnPropertyDescriptor(error, key)?.value
++          : '';
++      throw new Error(
++        `pnpm build failed; stdout:\n${output('stdout')}\nstderr:\n${output('stderr')}`,
++        { cause: error }
++      );
++    }
++  }, buildTimeoutMs);
++
+   it('emits six distinct transport identities for module-level membership actions', () => {
+-    const assets = readdirSync(new URL('../dist/server/assets/', import.meta.url))
++    const assetDirectory = new URL('../dist/server/assets/', import.meta.url);
++    const assets = readdirSync(assetDirectory)
+       .filter((file) => /^community-admin\.functions-.*\.js$/.test(file))
+-      .map((file) =>
+-        readFileSync(new URL(`../dist/server/assets/${file}`, import.meta.url), 'utf8')
+-      )
++      .map((file) => {
++        const path = new URL(`../dist/server/assets/${file}`, import.meta.url);
++        expect(
++          isFreshArtifact(statSync(path).mtimeMs, buildStartedAtMs),
++          `${file} must have been emitted by this build`
++        ).toBe(true);
++        return readFileSync(path, 'utf8');
++      })
+       .filter((content) => content.includes('createServerRpc({'));
+     expect(assets).toHaveLength(1);
+     const compiled = assets[0]!;
+@@ -32,4 +75,9 @@ describe('admin server-function extraction (production build)', () => {
+     });
+     expect(new Set(ids).size).toBe(endpointNames.length);
+   });
++
++  it('rejects an artifact older than the current build start', () => {
++    const staleMtimeMs = Date.now() - filesystemTimestampToleranceMs - 1;
++    expect(isFreshArtifact(staleMtimeMs, Date.now())).toBe(false);
++  });
+ });
+diff --git a/test/community.admin-routes.test.ts b/test/community.admin-routes.test.ts
+index d84d9f3..7f0137f 100644
+--- a/test/community.admin-routes.test.ts
++++ b/test/community.admin-routes.test.ts
+@@ -1,73 +1,302 @@
+-import { readFileSync } from 'node:fs';
+-import { describe, expect, it } from 'vitest';
+-
+-const routeFiles = [
+-  '../src/routes/_protected.community.$communityId.admin.tsx',
+-  '../src/routes/_protected.community.$communityId.admin.requests.tsx',
+-  '../src/routes/_protected.community.$communityId.admin.members.tsx',
+-  '../src/routes/_protected.community.$communityId.admin.members.$membershipId.tsx',
+-  '../src/routes/_protected.community.$communityId.admin.settings.tsx',
+-  '../src/routes/_protected.community.$communityId.admin.venues.tsx',
+-  '../src/routes/_protected.community.$communityId.admin.audit.tsx'
+-];
+-
+-function source(path: string) {
+-  return readFileSync(new URL(path, import.meta.url), 'utf8');
++import { createMemoryHistory, createRouter } from '@tanstack/react-router';
++import { beforeEach, describe, expect, it, vi } from 'vitest';
++
++const calls = vi.hoisted(() => ({
++  context: vi.fn<(input: { data: unknown }) => Promise<unknown>>(),
++  members: vi.fn<(input: { data: unknown }) => Promise<unknown>>(),
++  member: vi.fn<(input: { data: unknown }) => Promise<unknown>>(),
++  venues: vi.fn<(input: { data: unknown }) => Promise<unknown>>(),
++  audit: vi.fn<(input: { data: unknown }) => Promise<unknown>>(),
++  onboarding: vi.fn<() => Promise<unknown>>(),
++  locale: vi.fn<() => Promise<unknown>>(),
++  theme: vi.fn<() => Promise<unknown>>()
++}));
++
++vi.mock('../src/features/community/community-admin.functions', () => ({
++  getCommunityAdminContext: calls.context,
++  searchCommunityMembers: calls.members,
++  getCommunityMemberById: calls.member,
++  listCommunityVenues: calls.venues,
++  listCommunityAudit: calls.audit
++}));
++vi.mock('../src/features/player/player.functions', () => ({
++  getOnboardingStatus: calls.onboarding
++}));
++vi.mock('../src/i18n/locale.functions', () => ({
++  getInitialLocale: calls.locale,
++  saveLocale: vi.fn<(input: unknown) => Promise<void>>()
++}));
++vi.mock('../src/features/theme/theme.functions', () => ({
++  getInitialTheme: calls.theme,
++  saveTheme: vi.fn<(input: unknown) => Promise<void>>()
++}));
++
++import { Route as AdminRoute } from '../src/routes/_protected.community.$communityId.admin';
++import { Route as AdminIndexRoute } from '../src/routes/_protected.community.$communityId.admin.index';
++import { Route as AuditRoute } from '../src/routes/_protected.community.$communityId.admin.audit';
++import { Route as MembersRoute } from '../src/routes/_protected.community.$communityId.admin.members';
++import { Route as MemberDetailRoute } from '../src/routes/_protected.community.$communityId.admin.members.$membershipId';
++import { Route as MembersIndexRoute } from '../src/routes/_protected.community.$communityId.admin.members.index';
++import { Route as ProtectedRoute } from '../src/routes/_protected';
++import { Route as RequestsRoute } from '../src/routes/_protected.community.$communityId.admin.requests';
++import { Route as SettingsRoute } from '../src/routes/_protected.community.$communityId.admin.settings';
++import { Route as VenuesRoute } from '../src/routes/_protected.community.$communityId.admin.venues';
++import { routeTree } from '../src/routeTree.gen';
++
++const communityId = '11111111-1111-4111-8111-111111111111';
++const membershipId = '22222222-2222-4222-8222-222222222222';
++const community = { id: communityId, name: 'Test community' };
++const routeParams = { communityId, membershipId };
++
++function hasLoader(
++  route: unknown
++): route is { options: { loader: (context: { params: typeof routeParams }) => Promise<unknown> } } {
++  return (
++    typeof route === 'object' &&
++    route !== null &&
++    typeof Reflect.get(route, 'options') === 'object' &&
++    typeof Reflect.get(Reflect.get(route, 'options'), 'loader') === 'function'
++  );
++}
++
++function loader(route: unknown) {
++  if (!hasLoader(route)) throw new Error('Route has no loader');
++  return route.options.loader;
++}
++
++type RouteNode = {
++  options: { id: string; getParentRoute?: () => RouteNode };
++  children?: RouteNode[];
++};
++
++function routeNodes(parent: unknown): RouteNode[] {
++  if (typeof parent !== 'object' || parent === null) return [];
++  const children = Reflect.get(parent, 'children');
++  if (typeof children !== 'object' || children === null) return [];
++  return Object.values(children).filter(isRouteNode);
+ }
+
+-describe('community admin routes', () => {
+-  it('attaches each admin view to the authenticated protected route tree', () => {
+-    const tree = source('../src/routeTree.gen.ts');
+-    expect(tree).toContain('getParentRoute: () => ProtectedRoute');
+-    for (const route of [
+-      '/community/$communityId/admin',
+-      '/community/$communityId/admin/requests',
+-      '/community/$communityId/admin/members',
+-      '/community/$communityId/admin/members/$membershipId',
+-      '/community/$communityId/admin/settings',
+-      '/community/$communityId/admin/venues',
+-      '/community/$communityId/admin/audit'
+-    ])
+-      expect(tree).toContain(route);
++function isRouteNode(value: unknown): value is RouteNode {
++  const options =
++    typeof value === 'object' && value !== null ? Reflect.get(value, 'options') : null;
++  return (
++    typeof value === 'object' &&
++    value !== null &&
++    typeof options === 'object' &&
++    options !== null &&
++    typeof Reflect.get(options, 'id') === 'string' &&
++    typeof Reflect.get(value, 'update') === 'function'
++  );
++}
++
++function makeRouter(path: string) {
++  return createRouter({
++    routeTree,
++    history: createMemoryHistory({ initialEntries: [path] })
++  });
++}
++
++function invokeBeforeLoad(route: unknown, context: unknown): unknown {
++  if (typeof route !== 'object' || route === null) throw new Error('Invalid route');
++  const options = Reflect.get(route, 'options');
++  const beforeLoad =
++    typeof options === 'object' && options !== null ? Reflect.get(options, 'beforeLoad') : null;
++  if (typeof beforeLoad !== 'function') throw new Error('Route has no beforeLoad');
++  return Reflect.apply(beforeLoad, route, [context]);
++}
++
++beforeEach(() => {
++  vi.clearAllMocks();
++  calls.context.mockResolvedValue(community);
++  calls.members.mockResolvedValue([{ membership_id: membershipId }]);
++  calls.member.mockResolvedValue({ membership_id: membershipId });
++  calls.venues.mockResolvedValue([{ id: 'venue' }]);
++  calls.audit.mockResolvedValue([{ id: 'audit' }]);
++  calls.onboarding.mockResolvedValue({ authenticated: true, complete: true });
++  calls.locale.mockResolvedValue('en');
++  calls.theme.mockResolvedValue('light');
++});
++
++describe('community admin executable routes', () => {
++  it('runs each data leaf loader with authorization first and correct params/counts', async () => {
++    const cases = [
++      {
++        route: RequestsRoute,
++        reader: calls.members,
++        resultKey: 'members',
++        expected: { community_id: communityId, query: '', status: 'pending', offset: 0, limit: 50 }
++      },
++      {
++        route: MembersIndexRoute,
++        reader: calls.members,
++        resultKey: 'members',
++        expected: { community_id: communityId, query: '', status: 'active', offset: 0, limit: 50 }
++      },
++      {
++        route: VenuesRoute,
++        reader: calls.venues,
++        resultKey: 'venues',
++        expected: { community_id: communityId, offset: 0, limit: 50 }
++      },
++      {
++        route: AuditRoute,
++        reader: calls.audit,
++        resultKey: 'audit',
++        expected: { community_id: communityId, offset: 0, limit: 3 }
++      },
++      {
++        route: MemberDetailRoute,
++        reader: calls.member,
++        resultKey: 'member',
++        expected: { community_id: communityId, membership_id: membershipId }
++      }
++    ] as const;
++
++    for (const { route, reader, resultKey, expected } of cases) {
++      vi.clearAllMocks();
++      calls.context.mockResolvedValue(community);
++      calls.members.mockResolvedValue([{ membership_id: membershipId }]);
++      calls.member.mockResolvedValue({ membership_id: membershipId });
++      calls.venues.mockResolvedValue([{ id: 'venue' }]);
++      calls.audit.mockResolvedValue([{ id: 'audit' }]);
++      const result = await loader(route)({ params: routeParams });
++      expect(calls.context).toHaveBeenCalledExactlyOnceWith({
++        data: { community_id: communityId }
++      });
++      expect(reader).toHaveBeenCalledExactlyOnceWith({ data: expected });
++      const contextOrder = calls.context.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER;
++      const readerOrder = reader.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER;
++      expect(contextOrder).toBeLessThan(readerOrder);
++      expect(typeof result).toBe('object');
++      if (typeof result !== 'object' || result === null || !(resultKey in result))
++        throw new Error(`Loader result is missing ${resultKey}`);
++      const value: unknown = Reflect.get(result, resultKey);
++      const observed =
++        resultKey === 'member' && typeof value === 'object' && value !== null
++          ? Reflect.get(value, 'membership_id')
++          : Array.isArray(value)
++            ? value.length
++            : null;
++      expect(observed).toEqual(resultKey === 'member' ? membershipId : 1);
++    }
++
++    for (const { route, reader } of cases) {
++      vi.clearAllMocks();
++      calls.context.mockRejectedValue(new Error('NOT_COMMUNITY_ADMIN'));
++      await expect(loader(route)({ params: routeParams })).rejects.toThrow('NOT_COMMUNITY_ADMIN');
++      expect(calls.context).toHaveBeenCalledExactlyOnceWith({
++        data: { community_id: communityId }
++      });
++      expect(calls.members).not.toHaveBeenCalled();
++      expect(calls.member).not.toHaveBeenCalled();
++      expect(calls.venues).not.toHaveBeenCalled();
++      expect(calls.audit).not.toHaveBeenCalled();
++      expect(reader).not.toHaveBeenCalled();
++    }
++  });
++
++  it('runs admin and settings context loaders with their route params', async () => {
++    await expect(loader(AdminRoute)({ params: routeParams })).resolves.toEqual(community);
++    expect(calls.context).toHaveBeenCalledExactlyOnceWith({ data: { community_id: communityId } });
++    calls.context.mockClear();
++    await expect(loader(SettingsRoute)({ params: routeParams })).resolves.toEqual(community);
++    expect(calls.context).toHaveBeenCalledExactlyOnceWith({ data: { community_id: communityId } });
++    expect(calls.members).not.toHaveBeenCalled();
++    expect(calls.venues).not.toHaveBeenCalled();
++    expect(calls.audit).not.toHaveBeenCalled();
+   });
+
+-  it('runs the explicit live-admin guard before each route reads private data', () => {
+-    for (const path of routeFiles) {
+-      const route = source(path);
+-      expect(route.includes('getCommunityAdminContext')).toBe(true);
+-      expect(route.includes('errorComponent: CommunityAdminDenied')).toBe(true);
++  it('executes the actual generated protected/admin/members/index/detail hierarchy', () => {
++    const protectedRoute = routeNodes(routeTree).find(
++      (route) => route.options.id === '/_protected'
++    );
++    const adminRoute = protectedRoute?.children?.find(
++      (route) => route.options.id === '/community/$communityId/admin'
++    );
++    const membersRoute = adminRoute?.children?.find((route) => route.options.id === '/members');
++    expect(adminRoute?.options.getParentRoute?.()).toBe(protectedRoute);
++    expect(membersRoute?.options.getParentRoute?.()).toBe(adminRoute);
++    expect(membersRoute?.children?.find((route) => route.options.id === '/')).toBeDefined();
++    expect(
++      membersRoute?.children
++        ?.find((route) => route.options.id === '/$membershipId')
++        ?.options.getParentRoute?.()
++    ).toBe(membersRoute);
++  });
++
++  it('redirects admin root to requests and resolves members trailing slash to its index leaf', async () => {
++    let redirect: unknown;
++    try {
++      invokeBeforeLoad(AdminIndexRoute, { params: { communityId } });
++    } catch (error) {
++      redirect = error;
+     }
+-    const functions = source('../src/features/community/community-admin.functions.ts');
+-    expect(functions).toContain("client.rpc('is_community_admin'");
+-    expect(functions).toContain("if (!data) throw new Error('NOT_COMMUNITY_ADMIN')");
++    expect(redirect).toBeDefined();
++    if (typeof redirect !== 'object' || redirect === null) throw new Error('Expected redirect');
++    expect(Reflect.get(Reflect.get(redirect, 'options'), 'to')).toBe(
++      '/community/$communityId/admin/requests'
++    );
++
++    const membersRouter = makeRouter(`/community/${communityId}/admin/members/`);
++    const matches = membersRouter.matchRoutes(`/community/${communityId}/admin/members/`);
++    expect(matches.map((match) => match.routeId)).toContain(
++      '/_protected/community/$communityId/admin/members/'
++    );
++  });
++
++  it('navigates to detail without invoking the active-roster loader', async () => {
++    const router = makeRouter(`/community/${communityId}/admin/members/${membershipId}`);
++    const matches = router.matchRoutes(`/community/${communityId}/admin/members/${membershipId}`);
++    expect(matches.map((match) => match.routeId)).toContain(
++      '/_protected/community/$communityId/admin/members/$membershipId'
++    );
++    await loader(MemberDetailRoute)({ params: routeParams });
++    expect(calls.member).toHaveBeenCalledExactlyOnceWith({
++      data: { community_id: communityId, membership_id: membershipId }
++    });
++    expect(calls.members).not.toHaveBeenCalled();
++  });
++
++  it.each([
++    [{ authenticated: false, complete: false }, '/login'],
++    [{ authenticated: true, complete: false }, '/onboarding']
++  ])('redirects protected admin navigation for status %j', async (status, destination) => {
++    calls.onboarding.mockResolvedValue(status);
++    await expect(
++      Promise.resolve().then(() =>
++        invokeBeforeLoad(ProtectedRoute, {
++          location: { href: `/community/${communityId}/admin/members` }
++        })
++      )
++    ).rejects.toMatchObject({ options: { to: destination } });
++    expect(calls.onboarding).toHaveBeenCalledOnce();
++    expect(calls.context).not.toHaveBeenCalled();
++    expect(calls.members).not.toHaveBeenCalled();
++  });
++
++  it('surfaces a live non-admin failure without reading private route data', async () => {
++    calls.context.mockRejectedValue(new Error('NOT_COMMUNITY_ADMIN'));
++    await expect(loader(VenuesRoute)({ params: routeParams })).rejects.toThrow(
++      'NOT_COMMUNITY_ADMIN'
++    );
++    expect(calls.context).toHaveBeenCalled();
++    expect(calls.venues).not.toHaveBeenCalled();
+   });
+
+-  it('loads member detail by scoped membership ID and keeps roster pages status-scoped', () => {
+-    const detail = source(
+-      '../src/routes/_protected.community.$communityId.admin.members.$membershipId.tsx'
++  it('recovers the admin loader after a transient first failure', async () => {
++    calls.context.mockRejectedValueOnce(new Error('temporary loader failure'));
++    calls.context.mockResolvedValueOnce(community);
++    await expect(loader(AdminRoute)({ params: routeParams })).rejects.toThrow(
++      'temporary loader failure'
+     );
+-    expect(detail).toContain('getCommunityMemberById');
+-    expect(detail).not.toContain('searchCommunityMembers');
+-    const members = source('../src/routes/_protected.community.$communityId.admin.members.tsx');
+-    expect(members).toContain("status: 'active'");
+-    expect(members).toContain('limit: 50');
+-    const requests = source('../src/routes/_protected.community.$communityId.admin.requests.tsx');
+-    expect(requests).toContain("status: 'pending'");
+-    const screen = source('../src/features/community/CommunityAdmin.tsx');
+-    expect(screen).toContain('status: filterStatus');
+-    expect(screen).toContain('offset,');
++    await expect(loader(AdminRoute)({ params: routeParams })).resolves.toEqual(community);
++    expect(calls.context).toHaveBeenCalledTimes(2);
+   });
+
+-  it('imports explicit module-level membership endpoints into the route-owned UI', () => {
+-    const ui = source('../src/features/community/CommunityAdmin.tsx');
+-    for (const endpoint of [
+-      'approveCommunityMember',
+-      'denyCommunityMember',
+-      'removeCommunityMember',
+-      'reactivateCommunityMember',
+-      'promoteCommunityMember',
+-      'demoteCommunityMember'
+-    ])
+-      expect(ui).toContain(endpoint);
++  it('keeps route-level redirect and loader exports bound to the actual route definitions', () => {
++    expect(AdminRoute.options.loader).toBeDefined();
++    expect(AdminIndexRoute.options.beforeLoad).toBeDefined();
++    expect(MembersRoute.options.component).toBeDefined();
++    expect(SettingsRoute.options.loader).toBeDefined();
+   });
+ });
+diff --git a/test/community.admin-ui.test.tsx b/test/community.admin-ui.test.tsx
+index aeb4c65..0b90b1f 100644
+--- a/test/community.admin-ui.test.tsx
++++ b/test/community.admin-ui.test.tsx
+@@ -1,5 +1,5 @@
+ /** @vitest-environment jsdom */
+-import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
++import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
+ import userEvent from '@testing-library/user-event';
+ import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
+ import { I18nextProvider } from 'react-i18next';
+@@ -8,6 +8,7 @@ const mocks = vi.hoisted(() => ({
+   invalidate: vi.fn<() => Promise<void>>(),
+   navigate: vi.fn<() => Promise<void>>(),
+   listVenues: vi.fn<() => Promise<unknown>>(),
++  listAudit: vi.fn<() => Promise<unknown>>(),
+   approve: vi.fn<() => Promise<unknown>>(),
+   deny: vi.fn<() => Promise<unknown>>(),
+   remove: vi.fn<() => Promise<unknown>>(),
+@@ -51,6 +52,7 @@ vi.mock('../src/features/community/community-admin.functions', () => ({
+   promoteCommunityMember: mocks.promote,
+   demoteCommunityMember: mocks.demote,
+   searchCommunityMembers: mocks.search,
++  listCommunityAudit: mocks.listAudit,
+   listCommunityVenues: mocks.listVenues,
+   addCommunityVenue: mocks.addVenue,
+   editCommunityVenue: mocks.editVenue,
+@@ -93,14 +95,19 @@ function mount(
+   screenName: 'requests' | 'members' | 'member' | 'settings' | 'venues' | 'audit',
+   locale: 'en' | 'es' | 'pt-BR' = 'en'
+ ) {
++  const props =
++    screenName === 'requests' || screenName === 'members'
++      ? { screen: screenName, community, members: [member] }
++      : screenName === 'member'
++        ? { screen: screenName, community, member, membershipId: member.membership_id }
++        : screenName === 'venues'
++          ? { screen: screenName, community, venues: [] }
++          : screenName === 'audit'
++            ? { screen: screenName, community, audit: [] }
++            : { screen: screenName, community };
+   return render(
+     <I18nextProvider i18n={createI18n(locale)}>
+-      <CommunityAdminScreen
+-        screen={screenName}
+-        community={community}
+-        members={[member]}
+-        membershipId={member.membership_id}
+-      />
++      <CommunityAdminScreen {...props} />
+     </I18nextProvider>
+   );
+ }
+@@ -113,6 +120,7 @@ beforeEach(() => {
+   mocks.reactivate.mockResolvedValue({ membership_id: '44444444-4444-4444-8444-444444444444' });
+   mocks.search.mockResolvedValue([member]);
+   mocks.listVenues.mockResolvedValue([]);
++  mocks.listAudit.mockResolvedValue([]);
+ });
+ afterEach(cleanup);
+
+@@ -183,17 +191,77 @@ describe('community admin UI', () => {
+         <CommunityAdminScreen
+           screen="member"
+           community={community}
+-          members={[active]}
++          member={active}
+           membershipId={active.membership_id}
+         />
+       </I18nextProvider>
+     );
+-    await user.click(screen.getByRole('button', { name: 'Remove from community' }));
+-    expect(screen.getByRole('status').textContent).toContain(
+-      'Confirm Remove from community for Alicia Ramos?'
++    const trigger = screen.getByRole('button', { name: 'Remove from community' });
++    trigger.focus();
++    await user.keyboard('{Enter}');
++    const dialog = await screen.findByRole('alertdialog');
++    expect(
++      within(dialog).getByText('Confirm Remove from community for Alicia Ramos?')
++    ).toBeTruthy();
++    const cancel = within(dialog).getByRole('button', { name: 'CANCEL' });
++    const dialogPortal = dialog.closest('[data-base-ui-portal]');
++    expect(document.activeElement).toBe(cancel);
++    await user.tab();
++    expect(dialogPortal?.contains(document.activeElement)).toBe(true);
++    await user.tab();
++    expect(dialogPortal?.contains(document.activeElement)).toBe(true);
++    await user.tab({ shift: true });
++    expect(document.activeElement).toBe(
++      within(dialog).getByRole('button', { name: 'CONFIRM CHANGE' })
++    );
++    await user.keyboard('{Escape}');
++    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
++    expect(document.activeElement).toBe(trigger);
++    await user.keyboard('{Enter}');
++    await screen.findByRole('alertdialog');
++    await user.click(
++      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'CANCEL' })
++    );
++    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
++    expect(document.activeElement).toBe(trigger);
++    await user.keyboard('{Enter}');
++    await screen.findByRole('alertdialog');
++    await user.click(
++      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'CONFIRM CHANGE' })
++    );
++    await waitFor(() => expect(mocks.remove).toHaveBeenCalledTimes(1));
++    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
++    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Member controls' }));
++  });
++
++  it('keeps failed confirmation open for retry and restores focus after cancel', async () => {
++    const user = userEvent.setup();
++    const active = { ...member, status: 'active' as const };
++    mocks.remove.mockRejectedValueOnce(new Error('temporary failure'));
++    render(
++      <I18nextProvider i18n={createI18n('en')}>
++        <CommunityAdminScreen
++          screen="member"
++          community={community}
++          member={active}
++          membershipId={active.membership_id}
++        />
++      </I18nextProvider>
++    );
++    const trigger = screen.getByRole('button', { name: 'Remove from community' });
++    await user.click(trigger);
++    const dialog = await screen.findByRole('alertdialog');
++    const confirm = within(dialog).getByRole('button', { name: 'CONFIRM CHANGE' });
++    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'CANCEL' }));
++    await user.click(confirm);
++    expect(await waitFor(() => document.querySelector('[role="alert"]'))).toBeTruthy();
++    expect(screen.getByRole('alertdialog')).toBeTruthy();
++    expect(mocks.remove).toHaveBeenCalledTimes(1);
++    await user.click(
++      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'CANCEL' })
+     );
+-    await user.click(screen.getByRole('button', { name: 'CONFIRM CHANGE' }));
+-    await waitFor(() => expect(mocks.remove).toHaveBeenCalledOnce());
++    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
++    expect(document.activeElement).toBe(trigger);
+   });
+
+   it('shows unavailable nullable ratings on requests, roster, and detail without changing valid ratings', () => {
+@@ -211,12 +279,16 @@ describe('community admin UI', () => {
+         view === 'members' ? { ...noRatings, status: 'active' as const } : noRatings;
+       render(
+         <I18nextProvider i18n={createI18n('en')}>
+-          <CommunityAdminScreen
+-            screen={view}
+-            community={community}
+-            members={[displayed]}
+-            membershipId={displayed.membership_id}
+-          />
++          {view === 'member' ? (
++            <CommunityAdminScreen
++              screen="member"
++              community={community}
++              member={displayed}
++              membershipId={displayed.membership_id}
++            />
++          ) : (
++            <CommunityAdminScreen screen={view} community={community} members={[displayed]} />
++          )}
+         </I18nextProvider>
+       );
+       expect(screen.getByText(/ratings unavailable/i)).toBeTruthy();
+@@ -430,7 +502,7 @@ describe('community admin UI', () => {
+         <CommunityAdminScreen
+           screen="member"
+           community={community}
+-          members={[inactive]}
++          member={inactive}
+           membershipId={inactive.membership_id}
+         />
+       </I18nextProvider>
+@@ -502,12 +574,180 @@ describe('community admin UI', () => {
+     expect(screen.queryByText('Community admin')).toBeNull();
+   });
+
+-  it('localizes denied access and keeps unsupported audit events generic', () => {
++  it('characterizes a pending member load-more response crossing a loader refresh', async () => {
++    let resolvePage!: (rows: Member[]) => void;
++    const page = new Promise<Member[]>((resolve) => (resolvePage = resolve));
++    const firstPage = Array.from({ length: 50 }, (_, index) => ({
++      ...member,
++      membership_id: `00000000-0000-4000-8000-${String(index + 601).padStart(12, '0')}`,
++      display_name: `Pending source A ${index}`,
++      status: 'pending' as const
++    }));
++    const freshLoader = { ...member, display_name: 'Fresh loader row', status: 'active' as const };
++    mocks.search.mockResolvedValueOnce(firstPage).mockReturnValueOnce(page);
++    const view = render(
++      <I18nextProvider i18n={createI18n('en')}>
++        <CommunityAdminScreen screen="members" community={community} members={[member]} />
++      </I18nextProvider>
++    );
++    await userEvent.click(screen.getByRole('button', { name: 'Pending' }));
++    await screen.findByText('Pending source A 0');
++    await userEvent.click(screen.getByRole('button', { name: 'LOAD MORE CHANGES' }));
++    view.rerender(
++      <I18nextProvider i18n={createI18n('en')}>
++        <CommunityAdminScreen screen="members" community={community} members={[freshLoader]} />
++      </I18nextProvider>
++    );
++    await act(async () =>
++      resolvePage([{ ...member, display_name: 'Old source appended row', status: 'pending' }])
++    );
++    await waitFor(() => expect(screen.queryByText('Old source appended row')).toBeNull());
++  });
++
++  it('characterizes a pending audit page completion crossing a loader refresh', async () => {
++    const auditEvent = (id: string, action = 'INSERT') => ({
++      id,
++      actor_user_id: null,
++      entity: 'community_members',
++      entity_id: member.membership_id,
++      action,
++      details: { role: 'member', status: 'pending' },
++      occurred_at: '2026-10-01T10:30:00Z'
++    });
++    let resolvePage!: (rows: ReturnType<typeof auditEvent>[]) => void;
++    const page = new Promise<ReturnType<typeof auditEvent>[]>((resolve) => (resolvePage = resolve));
++    const initial = [auditEvent('audit-a'), auditEvent('audit-b'), auditEvent('audit-c')];
++    const refreshed = [
++      auditEvent('audit-new-a'),
++      auditEvent('audit-new-b'),
++      auditEvent('audit-new-c')
++    ];
++    mocks.listAudit.mockReturnValueOnce(page);
++    const view = render(
++      <I18nextProvider i18n={createI18n('en')}>
++        <CommunityAdminScreen screen="audit" community={community} audit={initial} />
++      </I18nextProvider>
++    );
++    await userEvent.click(screen.getByRole('button', { name: 'LOAD MORE CHANGES' }));
++    view.rerender(
++      <I18nextProvider i18n={createI18n('en')}>
++        <CommunityAdminScreen screen="audit" community={community} audit={refreshed} />
++      </I18nextProvider>
++    );
++    await act(async () =>
++      resolvePage([{ ...auditEvent('audit-old-page'), entity: 'community_venues' }])
++    );
++    await waitFor(() => expect(screen.getAllByTestId('community-audit-event')).toHaveLength(3));
++    expect(screen.queryByText('Venue added')).toBeNull();
++  });
++
++  it('isolates member search state when switching to settings and back', async () => {
++    const view = render(
++      <I18nextProvider i18n={createI18n('en')}>
++        <CommunityAdminScreen screen="members" community={community} members={[member]} />
++      </I18nextProvider>
++    );
++    const input = screen.getByRole('searchbox', { name: 'Search members' });
++    fireEvent.change(input, { target: { value: 'Private query' } });
++    await waitFor(() => expect(mocks.search).toHaveBeenCalled());
++    const searchCount = mocks.search.mock.calls.length;
++    view.rerender(
++      <I18nextProvider i18n={createI18n('en')}>
++        <CommunityAdminScreen screen="settings" community={community} />
++      </I18nextProvider>
++    );
++    expect(mocks.search).toHaveBeenCalledTimes(searchCount);
++    view.rerender(
++      <I18nextProvider i18n={createI18n('en')}>
++        <CommunityAdminScreen screen="members" community={community} members={[member]} />
++      </I18nextProvider>
++    );
++    expect(screen.getByRole('searchbox', { name: 'Search members' }).value).toBe('');
++  });
++
++  it('isolates audit paging state when switching to another screen and back', async () => {
++    const event = (id: string) =>
++      ({
++        id,
++        actor_user_id: null,
++        entity: 'community_members',
++        entity_id: member.membership_id,
++        action: 'INSERT',
++        details: { role: 'member', status: 'pending' },
++        occurred_at: '2026-10-01T10:30:00Z'
++      }) as const;
++    const firstEvents = [event('audit-first'), event('audit-second'), event('audit-third')];
++    const nextEvent = { ...event('audit-appended'), entity: 'community_venues' };
++    mocks.listAudit.mockResolvedValueOnce([nextEvent]);
++    const view = render(
++      <I18nextProvider i18n={createI18n('en')}>
++        <CommunityAdminScreen screen="audit" community={community} audit={firstEvents} />
++      </I18nextProvider>
++    );
++    await userEvent.click(screen.getByRole('button', { name: 'LOAD MORE CHANGES' }));
++    await screen.findByText('Venue added');
++    const auditCalls = mocks.listAudit.mock.calls.length;
++    view.rerender(
++      <I18nextProvider i18n={createI18n('en')}>
++        <CommunityAdminScreen screen="venues" community={community} venues={[]} />
++      </I18nextProvider>
++    );
++    expect(mocks.listAudit).toHaveBeenCalledTimes(auditCalls);
++    view.rerender(
++      <I18nextProvider i18n={createI18n('en')}>
++        <CommunityAdminScreen screen="audit" community={community} audit={firstEvents} />
++      </I18nextProvider>
++    );
++    expect(screen.queryByText('Venue added')).toBeNull();
++    expect(screen.getAllByTestId('community-audit-event')).toHaveLength(3);
++  });
++
++  it.each(['en', 'es', 'pt-BR'] as const)(
++    'provides localized recoverable error controls (%s)',
++    async (locale) => {
++      const reset = vi.fn<() => void>();
++      let release!: () => void;
++      mocks.invalidate.mockReturnValueOnce(new Promise<void>((resolve) => (release = resolve)));
++      const user = userEvent.setup();
++      const show = (error: Error) =>
++        render(
++          <I18nextProvider i18n={createI18n(locale)}>
++            <CommunityAdminDenied error={error} reset={reset} />
++          </I18nextProvider>
++        );
++      show(new Error('temporary failure'));
++      expect(screen.getByRole('button')).toBeTruthy();
++      expect(
++        screen.getByRole('link', { name: /dashboard|painel|panel/i }).getAttribute('href')
++      ).toBe('/dashboard');
++      const retry = screen.getByRole('button');
++      await user.click(retry);
++      await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(true));
++      await user.click(retry);
++      expect(mocks.invalidate).toHaveBeenCalledOnce();
++      expect(reset).not.toHaveBeenCalled();
++      await act(async () => release());
++      await waitFor(() => expect(reset).toHaveBeenCalledOnce());
++
++      cleanup();
++      show(new Error('NOT_COMMUNITY_ADMIN'));
++      expect(screen.queryByRole('button')).toBeNull();
++      expect(screen.getByRole('link', { name: /dashboard|painel|panel/i })).toBeTruthy();
++      cleanup();
++      show(new Error('COMMUNITY_MEMBER_NOT_FOUND'));
++      expect(screen.queryByRole('button')).toBeNull();
++    }
++  );
++
++  it('keeps generic loader error visible when retry invalidation fails', async () => {
++    mocks.invalidate.mockRejectedValueOnce(new Error('offline'));
+     render(
+-      <I18nextProvider i18n={createI18n('es')}>
+-        <CommunityAdminDenied error={new Error('NOT_COMMUNITY_ADMIN')} />
++      <I18nextProvider i18n={createI18n('en')}>
++        <CommunityAdminDenied error={new Error('temporary failure')} reset={vi.fn<() => void>()} />
+       </I18nextProvider>
+     );
+-    expect(screen.getByRole('alert').textContent).toContain('acceso activo de administración');
++    await userEvent.click(screen.getByRole('button'));
++    expect(await screen.findByRole('alert')).toBeTruthy();
++    expect(screen.getByRole('button')).toBeTruthy();
+   });
+ });
+diff --git a/test/community.admin.functions.test.ts b/test/community.admin.functions.test.ts
+index 7ef7436..803fb4d 100644
+--- a/test/community.admin.functions.test.ts
++++ b/test/community.admin.functions.test.ts
+@@ -30,7 +30,8 @@ import {
+   demoteCommunityMember,
+   issueInvitation,
+   listMyAdminCommunities,
+-  searchCommunityMembers
++  searchCommunityMembers,
++  getCommunityAdminContext
+ } from '../src/features/community/community-admin.functions';
+ import { validateVenue } from '../src/features/community/community-admin.validators';
+
+@@ -77,6 +78,110 @@ beforeEach(() => {
+   mocks.header.mockReset();
+ });
+ describe('admin function boundary', () => {
++  it.each([null, [], {}, { community_id: 'not-a-uuid' }, { community_id, extra: true }])(
++    'rejects invalid admin-context payload before client access: %j',
++    (data) => {
++      expect(() => getCommunityAdminContext({ data })).toThrow('INVALID_COMMUNITY_INPUT');
++      expect(mocks.client).not.toHaveBeenCalled();
++    }
++  );
++  it('rejects inherited-only community IDs and accepts uppercase UUIDs', async () => {
++    const inherited = Object.create({ community_id });
++    expect(() => getCommunityAdminContext({ data: inherited })).toThrow('INVALID_COMMUNITY_INPUT');
++    expect(mocks.client).not.toHaveBeenCalled();
++
++    const uppercaseId = community_id.toUpperCase();
++    const communityQuery = {
++      select: vi.fn<(columns: string) => unknown>(),
++      eq: vi.fn<(column: string, value: string) => unknown>(),
++      single: vi.fn<() => Promise<{ data: { id: string }; error: null }>>().mockResolvedValue({
++        data: { id: uppercaseId },
++        error: null
++      })
++    };
++    communityQuery.select.mockImplementation(() => communityQuery);
++    communityQuery.eq.mockImplementation(() => communityQuery);
++    const client = {
++      auth: {
++        getClaims: vi
++          .fn<() => Promise<{ data: { claims: { sub: string } }; error: null }>>()
++          .mockResolvedValue({ data: { claims: { sub: membership_id } }, error: null })
++      },
++      rpc: vi.fn<() => Promise<{ data: boolean; error: null }>>().mockResolvedValue({
++        data: true,
++        error: null
++      }),
++      from: vi.fn<(table: string) => typeof communityQuery>().mockReturnValue(communityQuery)
++    };
++    mocks.client.mockReturnValue(client);
++    await expect(
++      getCommunityAdminContext({ data: { community_id: uppercaseId } })
++    ).resolves.toEqual({ id: uppercaseId });
++    expect(client.auth.getClaims).toHaveBeenCalledOnce();
++    expect(mocks.header).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
++  });
++  it('does not read communities or admin data when live admin authorization denies access', async () => {
++    const rpc = vi.fn<() => Promise<{ data: boolean; error: null }>>().mockResolvedValue({
++      data: false,
++      error: null
++    });
++    const from = vi.fn<(table: string) => never>();
++    const client = {
++      auth: {
++        getClaims: vi
++          .fn<() => Promise<{ data: { claims: { sub: string } }; error: null }>>()
++          .mockResolvedValue({ data: { claims: { sub: membership_id } }, error: null })
++      },
++      rpc,
++      from
++    };
++    mocks.client.mockReturnValue(client);
++    await expect(getCommunityAdminContext({ data: { community_id } })).rejects.toThrow(
++      'NOT_COMMUNITY_ADMIN'
++    );
++    expect(client.auth.getClaims).toHaveBeenCalledOnce();
++    expect(mocks.header).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
++    expect(rpc).toHaveBeenCalledWith('is_community_admin', { p_community_id: community_id });
++    expect(from).not.toHaveBeenCalled();
++  });
++  it('reads only the safe community context fields after live authorization', async () => {
++    const communityQuery = {
++      select: vi.fn<(columns: string) => unknown>(),
++      eq: vi.fn<(column: string, value: string) => unknown>(),
++      single: vi
++        .fn<() => Promise<{ data: { id: string; name: string }; error: null }>>()
++        .mockResolvedValue({
++          data: { id: community_id, name: 'Safe' },
++          error: null
++        })
++    };
++    communityQuery.select.mockImplementation(() => communityQuery);
++    communityQuery.eq.mockImplementation(() => communityQuery);
++    const client = {
++      auth: {
++        getClaims: vi
++          .fn<() => Promise<{ data: { claims: { sub: string } }; error: null }>>()
++          .mockResolvedValue({ data: { claims: { sub: membership_id } }, error: null })
++      },
++      rpc: vi.fn<() => Promise<{ data: boolean; error: null }>>().mockResolvedValue({
++        data: true,
++        error: null
++      }),
++      from: vi.fn<(table: string) => typeof communityQuery>().mockReturnValue(communityQuery)
++    };
++    mocks.client.mockReturnValue(client);
++    await expect(getCommunityAdminContext({ data: { community_id } })).resolves.toEqual({
++      id: community_id,
++      name: 'Safe'
++    });
++    expect(client.from).toHaveBeenCalledOnce();
++    expect(client.from).toHaveBeenCalledWith('communities');
++    expect(communityQuery.select).toHaveBeenCalledWith(
++      'id,name,city_label,description,visibility,join_policy'
++    );
++    expect(communityQuery.eq).toHaveBeenCalledWith('id', community_id);
++    expect(communityQuery.single).toHaveBeenCalledOnce();
++  });
+   it('filters future-valid admin memberships in one server query without per-row RPCs', async () => {
+     const futureCommunityId = '44444444-4444-4444-8444-444444444444';
+     const memberships = [
+diff --git a/test/community.admin.integration.test.ts b/test/community.admin.integration.test.ts
+index d39618b..23839e4 100644
+--- a/test/community.admin.integration.test.ts
++++ b/test/community.admin.integration.test.ts
+@@ -1107,6 +1107,13 @@ describe.skipIf(environment.env === null)('community governance with real JWTs',
+     await expect(
+       issueInvitation({ data: { community_id: id, invitee_user_id: crypto.randomUUID() } })
+     ).rejects.toThrow('INVITEE_NOT_FOUND');
++    const unarchivedVenue = await admin.client
++      .from('community_venues')
++      .select('archived_at')
++      .eq('id', venue.id)
++      .single();
++    expect(unarchivedVenue.error).toBeNull();
++    expect(unarchivedVenue.data?.archived_at).toBeNull();
+     const archived = await archiveCommunityVenue({
+       data: { community_id: id, venue_id: venue.id }
+     });
+@@ -1123,7 +1130,11 @@ describe.skipIf(environment.env === null)('community governance with real JWTs',
+       action: 'UPDATE',
+       details: { archived: true }
+     });
+-    expect(archiveEvent?.details).toEqual({ archived: true });
++    expect(archiveEvent?.details).toEqual({
++      archived: true,
++      changed_fields: ['archived_at'],
++      transitions: { archived: { before: false, after: true } }
++    });
+     expect(archiveEvent?.details).not.toEqual(
+       editedAudit.find((row) => row.action === 'UPDATE')?.details
+     );
+diff --git a/test/community.integration.test.ts b/test/community.integration.test.ts
+index 5971f8c..7e6cf7a 100644
+--- a/test/community.integration.test.ts
++++ b/test/community.integration.test.ts
+@@ -1,6 +1,6 @@
+ import { spawn } from 'node:child_process';
+ import { createClient, type SupabaseClient } from '@supabase/supabase-js';
+-import { describe, expect, it, vi } from 'vitest';
++import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
+ import {
+   assertLocalSupabaseEnvInCi,
+   dotEnvPathFromImportMetaUrl,
+@@ -42,6 +42,7 @@ import {
+   listPublicCommunities,
+   updateCommunitySettings
+ } from '../src/features/community/community.functions';
++import { reactivateCommunityMember } from '../src/features/community/community-admin.functions';
+
+ vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });
+ type LocalEnv = NonNullable<ReturnType<typeof localSupabaseEnv>['env']>;
+@@ -63,11 +64,12 @@ describe.skipIf(environment.env === null)('community domain (local Supabase inte
+     const { url, key } = env();
+     return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
+   }
+-  type Actor = { client: SupabaseClient; id: string };
++  type Actor = { client: SupabaseClient; email: string; id: string };
+   async function actor(label: string): Promise<Actor> {
+     const { url, key } = env();
++    const email = `${label}-${crypto.randomUUID()}@test.local`;
+     const signup = await anon().auth.signUp({
+-      email: `${label}-${crypto.randomUUID()}@test.local`,
++      email,
+       password: 'Password123!'
+     });
+     expect(signup.error).toBeNull();
+@@ -82,7 +84,7 @@ describe.skipIf(environment.env === null)('community domain (local Supabase inte
+       refresh_token: signup.data.session!.refresh_token
+     });
+     expect(session.error).toBeNull();
+-    return { id: signup.data.user!.id, client };
++    return { id: signup.data.user!.id, email, client };
+   }
+   async function rows(
+     client: SupabaseClient,
+@@ -99,14 +101,41 @@ describe.skipIf(environment.env === null)('community domain (local Supabase inte
+       expectNoError(result);
+       return result.data ?? [];
+     }
+-    const result = await client.from(table).select('*').eq('community_id', communityId);
++    let query = client.from(table).select('*').eq('community_id', communityId);
++    if (table === 'community_audit_log') query = query.order('occurred_at', { ascending: true });
++    const result = await query;
+     expectNoError(result);
+     return result.data ?? [];
+   }
+   function expectNoError(result: { error: unknown }) {
+     expect(result.error).toBeNull();
+   }
+-  async function executeLocalFixtureSql(sql: string) {
++  function isExpiredInvitationResult(
++    value: unknown
++  ): value is { rows: Array<{ id: string; created_at: string; expires_at: string }> } {
++    if (typeof value !== 'object' || value === null || !('rows' in value)) return false;
++    const { rows: resultRows } = value;
++    if (!Array.isArray(resultRows) || resultRows.length !== 1) return false;
++    const row: unknown = resultRows[0];
++    return (
++      typeof row === 'object' &&
++      row !== null &&
++      'id' in row &&
++      typeof row.id === 'string' &&
++      'created_at' in row &&
++      typeof row.created_at === 'string' &&
++      'expires_at' in row &&
++      typeof row.expires_at === 'string'
++    );
++  }
++  function isSqlRowsWithId(value: unknown): value is { rows: Array<{ id: string }> } {
++    if (typeof value !== 'object' || value === null || !('rows' in value)) return false;
++    const { rows: resultRows } = value;
++    if (!Array.isArray(resultRows) || resultRows.length !== 1) return false;
++    const row: unknown = resultRows[0];
++    return typeof row === 'object' && row !== null && 'id' in row && typeof row.id === 'string';
++  }
++  async function executeLocalFixtureSql(sql: string): Promise<unknown> {
+     const child = spawn(
+       'pnpm',
+       ['exec', 'supabase', 'db', 'query', '--local', '--output-format', 'json', sql],
+@@ -124,6 +153,34 @@ describe.skipIf(environment.env === null)('community domain (local Supabase inte
+       throw new Error(
+         `Local timeline fixture SQL failed: ${result.error ?? `${stdout}\n${stderr}`}`
+       );
++    try {
++      for (let start = stdout.indexOf('{'); start >= 0; start = stdout.indexOf('{', start + 1)) {
++        let depth = 0;
++        let quoted = false;
++        let escaped = false;
++        for (let index = start; index < stdout.length; index += 1) {
++          const character = stdout[index];
++          if (quoted) {
++            if (escaped) escaped = false;
++            else if (character === '\\') escaped = true;
++            else if (character === '"') quoted = false;
++            continue;
++          }
++          if (character === '"') quoted = true;
++          else if (character === '{') depth += 1;
++          else if (character === '}' && --depth === 0) {
++            try {
++              return JSON.parse(stdout.slice(start, index + 1));
++            } catch {
++              break;
++            }
++          }
++        }
++      }
++      return stdout.trim();
++    } catch {
++      return stdout.trim();
++    }
+   }
+   const invitationColumns =
+     'id,community_id,invitee_user_id,issued_by,expires_at,redeemed_at,revoked_at,created_at';
+@@ -140,8 +197,9 @@ describe.skipIf(environment.env === null)('community domain (local Supabase inte
+     pendingRow: string,
+     inactiveRow: string,
+     inviteId: string,
+-    venueId: string;
+-  it('AC1/2: creator bootstrap and enum values are enforced by real SQL', async () => {
++    venueId: string,
++    fixtureTokenHash: string;
++  beforeAll(async () => {
+     [admin, member, invited, pending, inactive, outsider, publicActor] = await Promise.all([
+       actor('admin'),
+       actor('member'),
+@@ -151,13 +209,16 @@ describe.skipIf(environment.env === null)('community domain (local Supabase inte
+       actor('outsider'),
+       actor('public')
+     ]);
++  });
++
++  beforeEach(async () => {
+     async function create(name: string, visibility: 'private' | 'public') {
+       const result = await admin.client.rpc('create_community', {
+         p_name: name,
+         p_visibility: visibility,
+         p_join_policy: visibility === 'private' ? 'admin_approval' : 'instant'
+       });
+-      expect(result.error).toBeNull();
++      if (result.error) throw result.error;
+       if (typeof result.data !== 'string') throw new Error('create_community returned no ID');
+       return result.data;
+     }
+@@ -173,35 +234,42 @@ describe.skipIf(environment.env === null)('community domain (local Supabase inte
+         .insert({ community_id: privateId, user_id: user.id, status })
+         .select('id')
+         .single();
+-      expect(result.error).toBeNull();
+-      if (user === member) memberRow = result.data!.id;
+-      if (user === pending) pendingRow = result.data!.id;
+-      if (user === inactive) inactiveRow = result.data!.id;
++      if (result.error) throw result.error;
++      if (user === member) memberRow = result.data.id;
++      if (user === pending) pendingRow = result.data.id;
++      if (user === inactive) inactiveRow = result.data.id;
+     }
+     const closed = await admin.client
+       .from('community_members')
+-      .update({ status: 'inactive', valid_until: new Date(Date.now() + 1000).toISOString() })
++      .update({ status: 'inactive', valid_until: new Date(Date.now() + 5000).toISOString() })
+       .eq('id', inactiveRow);
+-    expect(closed.error).toBeNull();
++    if (closed.error) throw closed.error;
+     const invitation = await admin.client
+       .from('community_invitations')
+       .insert({
+         community_id: privateId,
+         invitee_user_id: invited.id,
+-        token_hash: crypto.randomUUID().replaceAll('-', '').padEnd(64, '0'),
++        token_hash: (fixtureTokenHash = crypto.randomUUID().replaceAll('-', '').padEnd(64, '0')),
+         expires_at: new Date(Date.now() + 86400000).toISOString()
+       })
+       .select('id')
+       .single();
+-    expect(invitation.error).toBeNull();
+-    inviteId = invitation.data!.id;
++    if (invitation.error) throw invitation.error;
++    inviteId = invitation.data.id;
+     const venue = await admin.client
+       .from('community_venues')
+       .insert({ community_id: privateId, name: 'Court' })
+       .select('id')
+       .single();
+-    expect(venue.error).toBeNull();
+-    venueId = venue.data!.id;
++    if (venue.error) throw venue.error;
++    venueId = venue.data.id;
++  });
++
++  afterEach(() => {
++    serverClient.current = null;
++  });
++
++  it('AC1/2: creator bootstrap and enum values are enforced by real SQL', async () => {
+     expect((await rows(admin.client, 'communities', privateId))[0].join_policy).toBe(
+       'admin_approval'
+     );
+@@ -653,6 +721,17 @@ describe.skipIf(environment.env === null)('community domain (local Supabase inte
+   });
+
+   it('AC4: private rows hidden filtered and unfiltered; only own invitation is exposed', async () => {
++    const assertInactiveOnly = async () => {
++      const history = (await rows(admin.client, 'community_members', privateId)).filter(
++        (row) => row.user_id === inactive.id
++      );
++      expect(history).toHaveLength(1);
++      expect(history[0]).toMatchObject({ status: 'inactive', valid_until: expect.any(String) });
++      expect(history[0].activated_at).not.toBeNull();
++      expect(history[0].valid_until).not.toBeNull();
++      expect(history.filter((row) => row.valid_until === null)).toHaveLength(0);
++    };
++    await assertInactiveOnly();
+     for (const user of [outsider, publicActor, invited, pending, inactive]) {
+       expect(await rows(user.client, 'communities', privateId)).toEqual([]);
+       expect(
+@@ -710,9 +789,21 @@ describe.skipIf(environment.env === null)('community domain (local Supabase inte
+     expect((await invited.client.from('community_invitations').select('*')).error?.code).toBe(
+       '42501'
+     );
++    await assertInactiveOnly();
+   });
+
+   it('AC5: admin alone mutates rows/settings; member sees own interval, not roster', async () => {
++    const assertInactiveOnly = async () => {
++      const history = (await rows(admin.client, 'community_members', privateId)).filter(
++        (row) => row.user_id === inactive.id
++      );
++      expect(history).toHaveLength(1);
++      expect(history[0]).toMatchObject({ status: 'inactive' });
++      expect(history[0].activated_at).not.toBeNull();
++      expect(history[0].valid_until).not.toBeNull();
++      expect(history.filter((row) => row.valid_until === null)).toHaveLength(0);
++    };
++    await assertInactiveOnly();
+     expect((await rows(member.client, 'community_members', privateId)).map((m) => m.id)).toEqual([
+       memberRow
+     ]);
+@@ -773,6 +864,7 @@ describe.skipIf(environment.env === null)('community domain (local Supabase inte
+       .single();
+     expect(openAfterForgedRevoke.error).toBeNull();
+     expect(openAfterForgedRevoke.data).toMatchObject({ revoked_at: null, redeemed_at: null });
++    const deniedInvitationId = openInvitation.data!.id;
+     for (const user of [outsider, invited, pending, inactive, member]) {
+       expect(
+         (
+@@ -858,6 +950,143 @@ describe.skipIf(environment.env === null)('community domain (local Supabase inte
+           .eq('id', privateId)
+       ).error?.code
+     ).toBe('42501');
++    const unchanged = await admin.client
++      .from('community_invitations')
++      .select('id,revoked_at,redeemed_at')
++      .eq('id', deniedInvitationId)
++      .single();
++    expect(unchanged.error).toBeNull();
++    expect(unchanged.data).toMatchObject({ revoked_at: null, redeemed_at: null });
++    expect(unchanged.data?.id).toBe(deniedInvitationId);
++    await assertInactiveOnly();
++  });
++
++  it('audit UPDATE details list changed fields and only safe transitions', async () => {
++    const secretSettings = 'settings-secret-' + crypto.randomUUID();
++    const secretText = 'private-text-' + crypto.randomUUID();
++    const before = await rows(admin.client, 'community_audit_log', privateId);
++
++    const settingsChange = await admin.client
++      .from('communities')
++      .update({ settings: { private_marker: secretSettings } })
++      .eq('id', privateId);
++    expect(settingsChange.error).toBeNull();
++    const settingsAudit = (await rows(admin.client, 'community_audit_log', privateId)).at(-1)!;
++    expect(settingsAudit.details).toMatchObject({ changed_fields: ['settings'], transitions: {} });
++
++    const scalarChange = await admin.client
++      .from('communities')
++      .update({ name: `Changed ${crypto.randomUUID()}`, description: secretText })
++      .eq('id', privateId);
++    expect(scalarChange.error).toBeNull();
++    const scalarAudit = (await rows(admin.client, 'community_audit_log', privateId)).at(-1)!;
++    expect(scalarAudit.details.changed_fields).toEqual(['name', 'description']);
++
++    const enumChange = await admin.client
++      .from('communities')
++      .update({ visibility: 'public', join_policy: 'instant' })
++      .eq('id', privateId);
++    expect(enumChange.error).toBeNull();
++    const enumAudit = (await rows(admin.client, 'community_audit_log', privateId)).at(-1)!;
++    expect(enumAudit.details).toMatchObject({
++      visibility: 'public',
++      changed_fields: ['visibility', 'join_policy'],
++      transitions: {
++        visibility: { before: 'private', after: 'public' },
++        join_policy: { before: 'admin_approval', after: 'instant' }
++      }
++    });
++
++    const venueChange = await admin.client
++      .from('community_venues')
++      .update({ name: `Court ${crypto.randomUUID()}`, address: secretText })
++      .eq('id', venueId);
++    expect(venueChange.error).toBeNull();
++    const venueAudit = (await rows(admin.client, 'community_audit_log', privateId)).at(-1)!;
++    expect(venueAudit.details).toMatchObject({
++      changed_fields: ['name', 'address'],
++      transitions: {}
++    });
++
++    const archive = await admin.client
++      .from('community_venues')
++      .update({ archived_at: new Date().toISOString() })
++      .eq('id', venueId);
++    expect(archive.error).toBeNull();
++    const archiveAudit = (await rows(admin.client, 'community_audit_log', privateId)).at(-1)!;
++    expect(archiveAudit.details).toMatchObject({
++      archived: true,
++      changed_fields: ['archived_at'],
++      transitions: { archived: { before: false, after: true } }
++    });
++
++    const nullableChange = await admin.client
++      .from('communities')
++      .update({ city_label: secretText })
++      .eq('id', privateId);
++    expect(nullableChange.error).toBeNull();
++    expect(
++      (await rows(admin.client, 'community_audit_log', privateId)).at(-1)!.details.changed_fields
++    ).toEqual(['city_label']);
++    const clearNullable = await admin.client
++      .from('communities')
++      .update({ city_label: null })
++      .eq('id', privateId);
++    expect(clearNullable.error).toBeNull();
++    expect(
++      (await rows(admin.client, 'community_audit_log', privateId)).at(-1)!.details.changed_fields
++    ).toEqual(['city_label']);
++
++    const multiple = await admin.client
++      .from('communities')
++      .update({ logo_path: 'logos/safe.svg', settings: { replacement: true } })
++      .eq('id', privateId);
++    expect(multiple.error).toBeNull();
++    expect(
++      (await rows(admin.client, 'community_audit_log', privateId)).at(-1)!.details.changed_fields
++    ).toEqual(['logo_path', 'settings']);
++    const noOp = await admin.client
++      .from('communities')
++      .update({ logo_path: 'logos/safe.svg', settings: { replacement: true } })
++      .eq('id', privateId);
++    expect(noOp.error).toBeNull();
++    expect(
++      (await rows(admin.client, 'community_audit_log', privateId)).at(-1)!.details
++    ).toMatchObject({
++      changed_fields: [],
++      transitions: {}
++    });
++
++    const after = await rows(admin.client, 'community_audit_log', privateId);
++    const oldIds = new Set(before.map((event) => event.id));
++    expect(
++      after.filter((event) => oldIds.has(event.id)).sort((a, b) => a.id.localeCompare(b.id))
++    ).toEqual(before.sort((a, b) => a.id.localeCompare(b.id)));
++    const serializedDetails = JSON.stringify(after.map((event) => event.details));
++    for (const secret of [secretSettings, secretText, fixtureTokenHash, admin.email])
++      expect(serializedDetails).not.toContain(secret);
++    const forbiddenRead = await outsider.client
++      .from('community_audit_log')
++      .select('*')
++      .eq('community_id', privateId);
++    expect(forbiddenRead.data).toEqual([]);
++    expect(
++      (await anon().from('community_audit_log').select('*').eq('community_id', privateId)).error
++        ?.code
++    ).toBe('42501');
++    for (const client of [outsider.client, anon()])
++      expect(
++        (
++          await client.from('community_audit_log').insert({
++            community_id: privateId,
++            entity: 'communities',
++            entity_id: privateId,
++            action: 'UPDATE'
++          })
++        ).error?.code
++      ).toBe('42501');
++    for (const client of [outsider.client, anon()])
++      expect((await client.rpc('audit_community_change')).error).not.toBeNull();
+   });
+
+   it('AC6: signed-out guest cannot access tables or call privileged functions', async () => {
+@@ -896,6 +1125,16 @@ describe.skipIf(environment.env === null)('community domain (local Supabase inte
+       .update({ role: 'admin' })
+       .eq('id', memberRow);
+     expect(promoted.error).toBeNull();
++    const seededSettings = await admin.client
++      .from('communities')
++      .update({ settings: { ac7: true } })
++      .eq('id', privateId);
++    expect(seededSettings.error).toBeNull();
++    const seededVenue = await admin.client
++      .from('community_venues')
++      .update({ name: 'AC7 court' })
++      .eq('id', venueId);
++    expect(seededVenue.error).toBeNull();
+     const [a, b] = await Promise.all([
+       admin.client.from('community_members').update({ role: 'member' }).eq('id', only.id),
+       member.client.from('community_members').update({ role: 'member' }).eq('id', memberRow)
+@@ -1072,10 +1311,15 @@ describe.skipIf(environment.env === null)('community domain (local Supabase inte
+           token_hash: tokenHash,
+           expires_at: new Date(expiry).toISOString()
+         })
+-        .select('id, created_at')
++        .select('id, created_at, expires_at')
+         .single();
+       expect(seeded.error).toBeNull();
+-      return { raw, id: seeded.data!.id, createdAt: seeded.data!.created_at };
++      return {
++        raw,
++        id: seeded.data!.id,
++        createdAt: seeded.data!.created_at,
++        expiresAt: seeded.data!.expires_at
++      };
+     }
+     async function membership(communityId: string, user: Actor) {
+       const found = await owner.client
+@@ -1257,20 +1501,6 @@ describe.skipIf(environment.env === null)('community domain (local Supabase inte
+     expect(
+       (await thief.client.rpc('accept_community_invitation', { p_token: 'bad' })).error?.code
+     ).toBe('PJ001');
+-    const expired = await invitation(privateInstant, thief, Date.now() + 1200);
+-    await new Promise((resolve) => setTimeout(resolve, 1500));
+-    await expect(acceptInvitation({ data: { token: expired.raw } })).rejects.toThrow(
+-      'INVITATION_EXPIRED'
+-    );
+-    expect(
+-      (
+-        await owner.client
+-          .from('community_invitations')
+-          .select('redeemed_at')
+-          .eq('id', expired.id)
+-          .single()
+-      ).data?.redeemed_at
+-    ).toBeNull();
+     const revoked = await invitation(privateApproval, thief);
+     expect(
+       (
+@@ -1325,6 +1555,57 @@ describe.skipIf(environment.env === null)('community domain (local Supabase inte
+     serverClient.current = null;
+   }, 90000);
+
++  it('seeds expired invitation from database clock and waits for stored expiry', async () => {
++    const [owner, invitee] = await Promise.all([actor('expiry-owner'), actor('expiry-invitee')]);
++    const created = await owner.client.rpc('create_community', {
++      p_name: `Expiry fixture ${crypto.randomUUID()}`,
++      p_visibility: 'private',
++      p_join_policy: 'instant'
++    });
++    expect(created.error).toBeNull();
++    if (typeof created.data !== 'string') throw new Error('Community fixture creation failed');
++    const raw = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
++      byte.toString(16).padStart(2, '0')
++    ).join('');
++    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
++    const hash = Array.from(new Uint8Array(digest), (byte) =>
++      byte.toString(16).padStart(2, '0')
++    ).join('');
++    const seeded: unknown = await executeLocalFixtureSql(`
++      insert into public.community_invitations
++        (community_id, invitee_user_id, issued_by, token_hash, expires_at)
++      values ('${created.data}'::uuid, '${invitee.id}'::uuid, '${owner.id}'::uuid, '${hash}', clock_timestamp() + interval '5 seconds')
++      returning id, created_at, expires_at;
++    `);
++    if (!isExpiredInvitationResult(seeded))
++      throw new Error('Expired invitation fixture returned an unexpected CLI JSON result');
++    const row = seeded.rows[0];
++    if (!row) throw new Error('Expired invitation fixture returned no row');
++    expect(Date.parse(row.expires_at)).toBeGreaterThan(Date.parse(row.created_at));
++    const expiry = Date.parse(row.expires_at);
++    if (!Number.isFinite(expiry)) throw new Error('Expired invitation fixture has invalid expiry');
++    const deadline = Date.now() + 15000;
++    while (Date.now() < expiry + 250 && Date.now() < deadline)
++      await new Promise((resolve) => setTimeout(resolve, 100));
++    if (Date.now() < expiry + 250)
++      throw new Error('Invitation did not reach expiry before bounded wait deadline');
++    serverClient.current = invitee.client;
++    await expect(acceptInvitation({ data: { token: raw } })).rejects.toThrow('INVITATION_EXPIRED');
++    const unchanged = await owner.client
++      .from('community_invitations')
++      .select('id,redeemed_at,revoked_at')
++      .eq('id', row.id)
++      .single();
++    expect(unchanged.error).toBeNull();
++    expect(unchanged.data?.redeemed_at).toBeNull();
++    expect(unchanged.data?.revoked_at).toBeNull();
++    expect(
++      (await rows(owner.client, 'community_members', created.data)).filter(
++        (membership) => membership.user_id === invitee.id
++      )
++    ).toEqual([]);
++  }, 30000);
++
+   it('closes self-leave and removal intervals, blocks inactive re-entry, and exposes only owned timeline rows', async () => {
+     const [owner, leaver, invitee, lifecycleOutsider] = await Promise.all([
+       actor('lifecycle-owner'),
+@@ -1577,6 +1858,8 @@ describe.skipIf(environment.env === null)('community domain (local Supabase inte
+
+     const blockedInvitation = await invite(lifecyclePrivateId, invitee);
+     serverClient.current = invitee.client;
++    serverClient.current = invitee.client;
++    serverClient.current = invitee.client;
+     await expect(acceptInvitation({ data: { token: blockedInvitation.raw } })).rejects.toThrow(
+       'MEMBERSHIP_INACTIVE'
+     );
+@@ -1600,13 +1883,11 @@ describe.skipIf(environment.env === null)('community domain (local Supabase inte
+       )
+     ).toHaveLength(1);
+
+-    const reactivated = await owner.client.rpc('govern_community_member', {
+-      p_community_id: lifecyclePrivateId,
+-      p_membership_id: removed.id,
+-      p_action: 'reactivate'
++    serverClient.current = owner.client;
++    const reactivated = await reactivateCommunityMember({
++      data: { community_id: lifecyclePrivateId, membership_id: removed.id }
+     });
+-    expect(reactivated.error).toBeNull();
+-    const replacementId = reactivated.data?.[0]?.membership_id;
++    const replacementId = reactivated.membership_id;
+     expect(replacementId).toBeTruthy();
+     expect(replacementId).not.toBe(removed.id);
+     expect(
+@@ -1631,6 +1912,7 @@ describe.skipIf(environment.env === null)('community domain (local Supabase inte
+       (await owner.client.from('community_venues').select('id,name').eq('id', venueSnapshot!.id))
+         .data
+     ).toEqual([venueSnapshot]);
++    serverClient.current = invitee.client;
+     await expect(acceptInvitation({ data: { token: blockedInvitation.raw } })).rejects.toThrow(
+       'ALREADY_MEMBER_OR_PENDING'
+     );
+@@ -1667,6 +1949,238 @@ describe.skipIf(environment.env === null)('community domain (local Supabase inte
+     serverClient.current = null;
+   }, 90000);
+
++  it('closed membership history rejects public and private rejoin until admin reactivation', async () => {
++    async function createHistoryCommunity(owner: Actor, visibility: 'public' | 'private') {
++      const created = await owner.client.rpc('create_community', {
++        p_name: `Closed history ${crypto.randomUUID()}`,
++        p_visibility: visibility,
++        p_join_policy: visibility === 'public' ? 'instant' : 'admin_approval'
++      });
++      expect(created.error).toBeNull();
++      if (typeof created.data !== 'string') throw new Error('Community fixture creation failed');
++      return created.data;
++    }
++    async function addInvitation(owner: Actor, communityId: string, invitee: Actor) {
++      const raw = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
++        byte.toString(16).padStart(2, '0')
++      ).join('');
++      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
++      const hash = Array.from(new Uint8Array(digest), (byte) =>
++        byte.toString(16).padStart(2, '0')
++      ).join('');
++      const seeded: unknown = await executeLocalFixtureSql(`
++        insert into public.community_invitations
++          (community_id, invitee_user_id, issued_by, token_hash, expires_at)
++        values ('${communityId}'::uuid, '${invitee.id}'::uuid, '${owner.id}'::uuid, '${hash}', clock_timestamp() + interval '1 day')
++        returning id;
++      `);
++      if (!isSqlRowsWithId(seeded))
++        throw new Error('Invitation fixture returned an unexpected CLI result');
++      const inserted = seeded.rows[0];
++      if (!inserted) throw new Error('Invitation fixture returned no inserted row');
++      return { id: inserted.id, raw };
++    }
++    async function seedAndClose(owner: Actor, former: Actor, communityId: string) {
++      serverClient.current = former.client;
++      await expect(joinCommunity({ data: { community_id: communityId } })).resolves.toMatchObject({
++        status: 'active'
++      });
++      const initial = (await rows(owner.client, 'community_members', communityId)).find(
++        (row) => row.user_id === former.id
++      )!;
++      serverClient.current = former.client;
++      await leaveCommunity({ data: { community_id: communityId } });
++      return (await rows(owner.client, 'community_members', communityId)).find(
++        (row) => row.id === initial.id
++      )!;
++    }
++    const [publicOwner, publicFormer, privateOwner, privateFormer] = await Promise.all([
++      actor('history-public-owner'),
++      actor('history-public-former'),
++      actor('history-private-owner'),
++      actor('history-private-former')
++    ]);
++    const historyPublicId = await createHistoryCommunity(publicOwner, 'public');
++    const publicOld = await seedAndClose(publicOwner, publicFormer, historyPublicId);
++    const publicClosed = { ...publicOld };
++    const tokenBucketId = await createHistoryCommunity(publicOwner, 'private');
++    const publicInvitation = await addInvitation(publicOwner, tokenBucketId, publicFormer);
++    serverClient.current = publicFormer.client;
++    await expect(joinCommunity({ data: { community_id: historyPublicId } })).rejects.toThrow(
++      'MEMBERSHIP_INACTIVE'
++    );
++    expect(
++      (await rows(publicOwner.client, 'community_members', historyPublicId)).filter(
++        (row) => row.user_id === publicFormer.id
++      )
++    ).toEqual([publicClosed]);
++    const publicTokenState = await publicOwner.client
++      .from('community_invitations')
++      .select('id,redeemed_at,revoked_at')
++      .eq('id', publicInvitation.id)
++      .single();
++    expect(publicTokenState.error).toBeNull();
++    expect(publicTokenState.data).toMatchObject({ redeemed_at: null, revoked_at: null });
++    serverClient.current = publicOwner.client;
++    const publicReactivation = await reactivateCommunityMember({
++      data: { community_id: historyPublicId, membership_id: publicOld.id }
++    });
++    const publicHistory = (
++      await rows(publicOwner.client, 'community_members', historyPublicId)
++    ).filter((row) => row.user_id === publicFormer.id);
++    expect(publicHistory.find((row) => row.id === publicOld.id)).toEqual(publicClosed);
++    const publicActive = publicHistory.find((row) => row.id === publicReactivation.membership_id)!;
++    expect(publicActive).toMatchObject({ role: 'member', status: 'active', valid_until: null });
++    expect(publicActive.id).not.toBe(publicOld.id);
++    expect(publicHistory.filter((row) => row.valid_until === null)).toHaveLength(1);
++    expect(publicOld.valid_until).toBeTruthy();
++    expect(Date.parse(publicActive.valid_from)).toBeGreaterThanOrEqual(
++      Date.parse(publicOld.valid_until)
++    );
++    expect(Date.parse(publicActive.activated_at)).toBeGreaterThanOrEqual(
++      Date.parse(publicActive.valid_from)
++    );
++
++    const historyPrivateId = await createHistoryCommunity(privateOwner, 'private');
++    serverClient.current = privateOwner.client;
++    const seededMembership = await privateOwner.client
++      .from('community_members')
++      .insert({ community_id: historyPrivateId, user_id: privateFormer.id, status: 'active' })
++      .select('id')
++      .single();
++    expect(seededMembership.error).toBeNull();
++    const freshToken = await addInvitation(privateOwner, historyPrivateId, privateFormer);
++    const closedResult = await privateOwner.client
++      .from('community_members')
++      .update({ status: 'inactive', valid_until: new Date(Date.now() + 5000).toISOString() })
++      .eq('id', seededMembership.data!.id);
++    expect(closedResult.error).toBeNull();
++    const privateClosedRow = (
++      await rows(privateOwner.client, 'community_members', historyPrivateId)
++    ).find((row) => row.id === seededMembership.data!.id)!;
++    const privateSnapshot = { ...privateClosedRow };
++    serverClient.current = privateFormer.client;
++    await expect(acceptInvitation({ data: { token: freshToken.raw } })).rejects.toThrow(
++      'MEMBERSHIP_INACTIVE'
++    );
++    const privateHistory = (
++      await rows(privateOwner.client, 'community_members', historyPrivateId)
++    ).filter((row) => row.user_id === privateFormer.id);
++    expect(privateHistory).toEqual([privateSnapshot]);
++    const tokenState = await privateOwner.client
++      .from('community_invitations')
++      .select('id,redeemed_at,revoked_at')
++      .eq('id', freshToken.id)
++      .single();
++    expect(tokenState.error).toBeNull();
++    expect(tokenState.data).toMatchObject({ redeemed_at: null, revoked_at: null });
++    serverClient.current = privateOwner.client;
++    const privateReactivation = await reactivateCommunityMember({
++      data: { community_id: historyPrivateId, membership_id: privateClosedRow.id }
++    });
++    const reactivatedRows = (
++      await rows(privateOwner.client, 'community_members', historyPrivateId)
++    ).filter((row) => row.user_id === privateFormer.id);
++    expect(reactivatedRows.find((row) => row.id === privateClosedRow.id)).toEqual(privateSnapshot);
++    const privateActive = reactivatedRows.find(
++      (row) => row.id === privateReactivation.membership_id
++    )!;
++    expect(privateActive).toMatchObject({ role: 'member', status: 'active', valid_until: null });
++    expect(privateActive.id).not.toBe(privateClosedRow.id);
++    expect(reactivatedRows.filter((row) => row.valid_until === null)).toHaveLength(1);
++    expect(privateClosedRow.valid_until).toBeTruthy();
++    expect(Date.parse(privateActive.valid_from)).toBeGreaterThanOrEqual(
++      Date.parse(privateClosedRow.valid_until)
++    );
++    expect(Date.parse(privateActive.activated_at)).toBeGreaterThanOrEqual(
++      Date.parse(privateActive.valid_from)
++    );
++  }, 90000);
++
++  it('visibility flip rejects acceptance without consuming invitation or creating membership', async () => {
++    const [owner, invitee] = await Promise.all([
++      actor('visibility-flip-owner'),
++      actor('visibility-flip-invitee')
++    ]);
++    const created = await owner.client.rpc('create_community', {
++      p_name: `Visibility flip ${crypto.randomUUID()}`,
++      p_visibility: 'private',
++      p_join_policy: 'instant'
++    });
++    expect(created.error).toBeNull();
++    if (typeof created.data !== 'string') throw new Error('Community fixture creation failed');
++    const communityId = created.data;
++    const raw = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
++      byte.toString(16).padStart(2, '0')
++    ).join('');
++    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
++    const tokenHash = Array.from(new Uint8Array(digest), (byte) =>
++      byte.toString(16).padStart(2, '0')
++    ).join('');
++    const invitation = await owner.client
++      .from('community_invitations')
++      .insert({
++        community_id: communityId,
++        invitee_user_id: invitee.id,
++        token_hash: tokenHash,
++        expires_at: new Date(Date.now() + 86400000).toISOString()
++      })
++      .select('id')
++      .single();
++    expect(invitation.error).toBeNull();
++    const auditBefore = await rows(owner.client, 'community_audit_log', communityId);
++    const flipped = await owner.client
++      .from('communities')
++      .update({ visibility: 'public' })
++      .eq('id', communityId);
++    expect(flipped.error).toBeNull();
++    serverClient.current = invitee.client;
++    await expect(acceptInvitation({ data: { token: raw } })).rejects.toThrow(
++      'COMMUNITY_NOT_ELIGIBLE'
++    );
++    const invitationAfterReject = await owner.client
++      .from('community_invitations')
++      .select('id,redeemed_at,revoked_at')
++      .eq('id', invitation.data!.id)
++      .single();
++    expect(invitationAfterReject.error).toBeNull();
++    expect(invitationAfterReject.data?.redeemed_at).toBeNull();
++    expect(invitationAfterReject.data?.revoked_at).toBeNull();
++    expect(
++      (await rows(owner.client, 'community_members', communityId)).filter(
++        (row) => row.user_id === invitee.id
++      )
++    ).toEqual([]);
++    const auditsAfterReject = await rows(owner.client, 'community_audit_log', communityId);
++    expect(
++      auditsAfterReject
++        .filter((event) => !auditBefore.some((old) => old.id === event.id))
++        .filter(
++          (event) =>
++            (event.entity === 'community_invitations' && event.action === 'UPDATE') ||
++            (event.entity === 'community_members' && event.action === 'INSERT')
++        )
++    ).toEqual([]);
++    const flippedBack = await owner.client
++      .from('communities')
++      .update({ visibility: 'private' })
++      .eq('id', communityId);
++    expect(flippedBack.error).toBeNull();
++    await expect(acceptInvitation({ data: { token: raw } })).resolves.toMatchObject({
++      community_id: communityId,
++      status: 'active'
++    });
++    expect(
++      (
++        await owner.client
++          .from('community_invitations')
++          .select('id,redeemed_at,revoked_at')
++          .eq('id', invitation.data!.id)
++          .single()
++      ).data?.redeemed_at
++    ).toBeTruthy();
++  }, 90000);
++
+   it('paginates persisted timeline history completely and deterministically', async () => {
+     const [owner, timelineActor, decoy, emptyActor] = await Promise.all([
+       actor('timeline-page-owner'),
+diff --git a/test/community.onboarding.test.tsx b/test/community.onboarding.test.tsx
+index 0eca352..898f55b 100644
+--- a/test/community.onboarding.test.tsx
++++ b/test/community.onboarding.test.tsx
+@@ -12,11 +12,24 @@ const mocks = vi.hoisted(() => ({
+   invalidate: vi.fn<() => void>(),
+   join: vi.fn<() => Promise<unknown>>(),
+   create: vi.fn<() => Promise<unknown>>(),
+-  list: vi.fn<() => Promise<unknown>>()
++  list: vi.fn<() => Promise<unknown>>(),
++  routerState: { pending: false }
+ }));
+ vi.mock('@tanstack/react-router', () => ({
+   useNavigate: () => mocks.navigate,
+-  useRouter: () => ({ invalidate: mocks.invalidate })
++  useRouter: () => ({ invalidate: mocks.invalidate }),
++  useRouterState: ({
++    select
++  }: {
++    select: (state: {
++      matches: { routeId: string; status: string; isFetching: boolean }[];
++    }) => unknown;
++  }) =>
++    select({
++      matches: mocks.routerState.pending
++        ? [{ routeId: '/onboarding_/community', status: 'pending', isFetching: true }]
++        : []
++    })
+ }));
+ vi.mock('../src/features/community/community.functions', () => ({
+   joinCommunity: mocks.join,
+@@ -61,11 +74,113 @@ function mount(
+ }
+
+ beforeEach(() => {
+-  for (const mock of Object.values(mocks)) mock.mockReset();
++  mocks.navigate.mockReset();
++  mocks.invalidate.mockReset();
++  mocks.join.mockReset();
++  mocks.create.mockReset();
++  mocks.list.mockReset();
++  mocks.routerState.pending = false;
+ });
+ afterEach(cleanup);
+
+ describe('community onboarding', () => {
++  it.each(['en', 'pt-BR', 'es'] as const)(
++    'announces draft and route pending state in %s, keeps search focused and suppresses empty results',
++    async (locale) => {
++      const i18n = createI18n(locale);
++      const data = { communities: [], next_offset: null, failed: false };
++      const view = (q?: string) => (
++        <I18nextProvider i18n={i18n}>
++          <CommunityOnboarding search={q ? { q } : {}} data={data} />
++        </I18nextProvider>
++      );
++      const mounted = render(view());
++      const input = screen.getByRole('searchbox', {
++        name: i18n.t('communityOnboarding.searchLabel')
++      });
++      await userEvent.type(input, 'No match');
++      expect(screen.getByRole('status').textContent).toBe(
++        i18n.t('communityOnboarding.searchLoading')
++      );
++      expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
++      expect(input.hasAttribute('disabled')).toBe(false);
++      expect(document.activeElement).toBe(input);
++      mocks.routerState.pending = true;
++      mounted.rerender(view('No match'));
++      expect(screen.getByRole('status').textContent).toBe(
++        i18n.t('communityOnboarding.searchLoading')
++      );
++      expect(screen.queryByText(i18n.t('communityOnboarding.emptySearch'))).toBeNull();
++      expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
++      expect(screen.getByRole('status').closest('[aria-busy="true"]')).toBeNull();
++      mocks.routerState.pending = false;
++      mounted.rerender(view('No match'));
++      expect(screen.queryByText(i18n.t('communityOnboarding.searchLoading'))).toBeNull();
++      expect(document.activeElement).toBe(input);
++    }
++  );
++
++  it.each(['en', 'pt-BR', 'es'] as const)(
++    'keeps filled optional labels visible in %s',
++    async (locale) => {
++      const i18n = createI18n(locale);
++      render(
++        <I18nextProvider i18n={i18n}>
++          <CommunityOnboarding
++            search={{ view: 'create' }}
++            data={{ communities: [], next_offset: null, failed: false }}
++          />
++        </I18nextProvider>
++      );
++      const description = screen.getByLabelText(i18n.t('communityOnboarding.descriptionLabel'));
++      const city = screen.getByLabelText(i18n.t('communityOnboarding.cityLabel'));
++      await userEvent.type(description, 'Description');
++      await userEvent.type(city, 'Lisbon');
++      expect(description.id).toBe('community-description');
++      expect(city.id).toBe('community-city');
++      expect(description.value).toBe('Description');
++      expect(city.value).toBe('Lisbon');
++      expect(description.labels?.[0]?.htmlFor).toBe(description.id);
++      expect(city.labels?.[0]?.htmlFor).toBe(city.id);
++    }
++  );
++
++  it('blocks duplicate retry while same-route invalidation is fetching and retains load-more busy state', async () => {
++    const i18n = createI18n('en');
++    const failed = { communities: [], next_offset: null, failed: true };
++    const view = () => (
++      <I18nextProvider i18n={i18n}>
++        <CommunityOnboarding search={{}} data={failed} />
++      </I18nextProvider>
++    );
++    const mounted = render(view());
++    mocks.routerState.pending = true;
++    mounted.rerender(view());
++    const retry = screen.getByRole('button', { name: i18n.t('communityOnboarding.retry') });
++    expect(retry.hasAttribute('disabled')).toBe(true);
++    expect(screen.getByRole('status')).toBeTruthy();
++    mocks.routerState.pending = false;
++    mounted.rerender(view());
++    expect(
++      screen
++        .getByRole('button', { name: i18n.t('communityOnboarding.retry') })
++        .hasAttribute('disabled')
++    ).toBe(false);
++    expect(mocks.invalidate).not.toHaveBeenCalled();
++  });
++
++  it('keeps load more busy until its page promise settles', async () => {
++    let finish!: (value: { communities: PublicCommunity[]; next_offset: null }) => void;
++    mocks.list.mockReturnValue(new Promise((resolve) => (finish = resolve)));
++    mount(undefined, { communities: [row], next_offset: 20, failed: false });
++    const button = screen.getByRole('button', { name: 'LOAD MORE' });
++    await userEvent.click(button);
++    expect(button.getAttribute('aria-busy')).toBe('true');
++    expect(button.hasAttribute('disabled')).toBe(true);
++    finish({ communities: [], next_offset: null });
++    await waitFor(() => expect(screen.queryByRole('button', { name: 'LOAD MORE' })).toBeNull());
++  });
++
+   it('shows real city and policy only, joins with server-authoritative outcomes and supports skip', async () => {
+     mocks.join
+       .mockResolvedValueOnce({ status: 'active' })
+diff --git a/test/root.locale.test.tsx b/test/root.locale.test.tsx
+new file mode 100644
+index 0000000..177cf5d
+--- /dev/null
++++ b/test/root.locale.test.tsx
+@@ -0,0 +1,53 @@
++/** @vitest-environment jsdom */
++import { cleanup, render, screen, waitFor } from '@testing-library/react';
++import userEvent from '@testing-library/user-event';
++import { createElement } from 'react';
++import { afterEach, expect, it, vi } from 'vitest';
++
++vi.mock('@tanstack/react-router', () => ({
++  createRootRoute: (options: unknown) => ({
++    options,
++    useRouteContext: () => ({ locale: 'en', theme: 'light' })
++  }),
++  HeadContent: () => null,
++  Outlet: () => null,
++  Scripts: () => null,
++  useRouterState: () => false
++}));
++vi.mock('../src/components/PwaRegistration', () => ({ PwaRegistration: () => null }));
++vi.mock('../src/components/DevStyleXInject', () => ({ DevStyleXInject: () => null }));
++vi.mock('../src/i18n/locale.functions', () => ({
++  getInitialLocale: async () => 'en',
++  saveLocale: async () => undefined
++}));
++vi.mock('../src/features/theme/theme.functions', () => ({
++  getInitialTheme: async () => 'light',
++  saveTheme: async () => undefined
++}));
++
++import { Route } from '../src/routes/__root';
++
++afterEach(cleanup);
++
++it('updates root preference labels after changing locale', async () => {
++  const user = userEvent.setup();
++  const RootComponent = Route.options.component;
++  if (!RootComponent) throw new Error('Root route component is missing');
++
++  render(createElement(RootComponent), { container: document });
++  const localeSelect = screen.getByRole('combobox', { name: 'Language' });
++  await user.selectOptions(localeSelect, 'pt-BR');
++  await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Idioma' })).not.toBeNull());
++  expect(screen.getByRole('combobox', { name: 'Tema' })).toBeTruthy();
++  expect(screen.getByRole('option', { name: 'Escuro' })).toBeTruthy();
++
++  await user.selectOptions(localeSelect, 'es');
++  await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Idioma' })).not.toBeNull());
++  expect(screen.getByRole('combobox', { name: 'Tema' })).toBeTruthy();
++  expect(screen.getByRole('option', { name: 'Oscuro' })).toBeTruthy();
++
++  await user.selectOptions(localeSelect, 'en');
++  await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Language' })).not.toBeNull());
++  expect(screen.getByRole('combobox', { name: 'Theme' })).toBeTruthy();
++  expect(screen.getByRole('option', { name: 'Dark' })).toBeTruthy();
++});
+```
diff --git a/docs/plan/PAF-50-findings.md b/docs/plan/PAF-50-findings.md
new file mode 100644
index 0000000..61aeb2e
--- /dev/null
+++ b/docs/plan/PAF-50-findings.md
@@ -0,0 +1,26 @@
+# PAF-50 — Findings Ledger
+
+Single source of truth for the fix loop. Rows are appended, never rewritten, and a row already present is never re-added.
+`status`: `open` | `fixed` | `deferred`. `owner`: the agent that fixes it, or `deferred`.
+Sources: full review of `8c705c2..5dec5d4` by `code-review-specialist`, `architecture-review-specialist`, `ux-ui-reviewer-specialist`.
+
+| id  | severity | location                                                  | title                                                                                                             | status   | owner                | iteration |
+| --- | -------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------- | -------------------- | --------- |
+| F1  | minor    | src/components/ui                                         | Global `#locale` select measures 24px at 320px (pre-existing global header UI, outside this epic's admin screens) | deferred | deferred             | 1         |
+| F2  | major    | src/features/community/CommunityAdminViews.tsx:1089       | Loader refresh permanently latches audit/venue paging busy state                                                  | fixed    | bug-fixer-specialist | 1         |
+| F3  | major    | src/features/community/CommunityAdminViews.tsx:586        | Completed confirmations suppress later valid member actions after reactivation                                    | fixed    | bug-fixer-specialist | 1         |
+| F4  | major    | src/routes/__root.tsx:73                                  | Failed locale persistence leaves UI copy and document lang mismatched                                             | fixed    | bug-fixer-specialist | 1         |
+| F5  | major    | src/features/community/CommunityAdminViews.tsx:608        | Confirmation restores focus to the wrong trigger (shared ref)                                                     | fixed    | bug-fixer-specialist | 1         |
+| F6  | major    | src/features/community/CommunityAdminViews.tsx:669        | Failed-confirmation error rendered outside the open modal subtree                                                 | fixed    | bug-fixer-specialist | 1         |
+| F7  | major    | src/features/community/CommunityAdminViews.tsx:485        | Refresh failure after committed mutation allows repeating that mutation                                           | fixed    | bug-fixer-specialist | 1         |
+| F8  | minor    | test/community.admin-routes.test.ts:242                   | Route oracle invokes the leaf loader manually instead of navigating                                               | deferred | deferred             | 1         |
+| F9  | minor    | e2e/community-onboarding.spec.ts:964                      | Synthetic pixel oracle duplicates comparator math instead of using it                                             | deferred | deferred             | 1         |
+| F10 | minor    | src/features/community/CommunityAdminViews.tsx:23         | Views import the shell module, creating circular module ownership                                                 | deferred | deferred             | 1         |
+| F11 | minor    | e2e/community-admin.spec.ts:940                           | Locale matrix does not prove admin keyboard reachability                                                          | deferred | deferred             | 1         |
+| F12 | minor    | src/features/community/community-onboarding.styles.ts:151 | Floating label references nonexistent token `--line-height-tight`                                                 | fixed    | bug-fixer-specialist | 1         |
+
+## Iteration 1 outcome
+
+- **Fixed (7):** F2, F3, F4, F5, F6, F7, F12 — every one landed with a regression test that failed before the fix and passed after.
+- **Deferred (5):** F1, F8, F9, F10, F11 — not fixed in this delivery; handed off as a follow-up issue.
+- **Separate QA failure also fixed in this iteration (not a review finding):** `test/community.integration.test.ts` fixture helper modelled an imagined `{"rows": […]}` CLI layout while `supabase` CLI v2 prints a top-level JSON array (and psql command tags for no-row statements); the two guarded tests now pass deterministically (file run ×4, plus the 3-file integration combo = 38/38).
diff --git "a/docs/plan/Plan PAF-29 PAF-2.4 \342\200\224 Join flows: public self-join, private invitations, approval handling, edge cases.md" "b/docs/plan/Plan PAF-29 PAF-2.4 \342\200\224 Join flows: public self-join, private invitations, approval handling, edge cases.md"
index 00d9159..461dc76 100644
--- "a/docs/plan/Plan PAF-29 PAF-2.4 \342\200\224 Join flows: public self-join, private invitations, approval handling, edge cases.md"
+++ "b/docs/plan/Plan PAF-29 PAF-2.4 \342\200\224 Join flows: public self-join, private invitations, approval handling, edge cases.md"
@@ -1,19 +1,21 @@
 ## Task Analysis

-- Main objective: Plan **PAF-29 — PAF-2.4 — Join flows: public self-join, private invitations, approval handling, edge cases**. Public authenticated self-join creates active or pending membership according to `join_policy`; private acceptance requires **both** authenticated `invitee_user_id` match and possession of a valid, unexpired, unused raw token, then consumes it. Reject duplicate, unknown, expired, redeemed, revoked, wrong-invitee and guest attempts with stable states. Planning only; one final commit on `feature/PAF-29-join-flows`, stacked on `origin/feature/PAF-28-public-community-discovery` at `db0078e`; PR targets **PAF-28, not main**. No issue identifier in commit/PR text.
+> **Delivery-scope reconciliation (historical plan):** Invitation issuance was deferred from PAF-29 to PAF-31 and delivered in `community-admin.functions.ts`, not `community.functions.ts`. PAF-29 delivered join/accept flows, validators, RPCs, and tests; issuance requirements below are historical scope, not outstanding implementation instructions. The original self-rejoin expectation is superseded by the membership lifecycle policy: self-join and private acceptance for a former member are denied (`MEMBERSHIP_INACTIVE`) without changing closed history or consuming an invitation; authorized admin reactivation creates a new interval. No automatic reactivation or policy/migration change is intended.
+
+- Main objective: Plan **PAF-29 — PAF-2.4 — Join flows: public self-join, private invitations, approval handling, edge cases**. Public authenticated self-join creates active or pending membership according to `join_policy`; private acceptance requires **both** authenticated `invitee_user_id` match and possession of a valid, unexpired, unused raw token, then consumes it. Reject duplicate, unknown, expired, redeemed, revoked, wrong-invitee and guest attempts with stable states. Planning only; one final commit on `feature/PAF-29-join-flows`, stacked on `origin/feature/PAF-28-public-community-discovery` at `db0078e`; PR targets **PAF-28, not main**. No issue identifier in commit/PR text. Historical successful self-rejoin prose is superseded by denied rejoin plus authorized reactivation under current lifecycle policy.
 - Identified dependencies: PAF-26's `supabase/migrations/20261002055953_community_domain.sql` defines `community_members` (active/pending/inactive, activation/history trigger, `community_members_open` partial unique index), `community_invitations` (`token_hash` 64 lowercase hex, expiry/redeem/revoke, `community_invitations_open`), invitation guard permitting **first** NULL→timestamp redemption but preventing reopening, audit triggers, `is_community_member`/`is_community_admin` requiring active status, RLS/grants. Non-admin INSERT into members fails `membership admin insert`; authenticated clients cannot UPDATE `redeemed_at`. PAF-27's `20261002105936_community_join_policy.sql` supplies `instant|admin_approval`; PAF-28 discovery remains public-only. `src/features/community/{community.functions,community.validators}.ts` uses TanStack `createServerFn`, strict validator, `requireAuthenticatedClient()` (`getClaims()`, `UNAUTHENTICATED`, private/no-store), typed Supabase RPC; `src/lib/supabase/database.types.ts` is PAF-33-generated. Tests: `test/community.functions.test.ts`, `test/community.discovery.functions.test.ts`, `test/community.integration.test.ts` with real-JWT actors, loopback-only env, CI fail-closed guard. `package.json` owns DB/type/QA scripts. No separate join-request table exists or is needed: **pending `community_members` rows are admin-visible requests** through `membership read` RLS.
-- System impact: One additive imperative migration with two narrow privileged join RPCs, admin invitation issuance through existing RLS, two POST server functions plus issuance function, validators, generated RPC types, mocked and local real-JWT tests. No route/UI/email delivery, new package, schema-table change, approval/denial, member removal/reactivation, match access, coverage-threshold change, or modification to applied migrations. A reusable invitee-bound authorized link carries the same single-use token; **not** an unrestricted anyone-with-link invite. Existing `community_invitations_open` still treats expired/unrevoked invitations as open; explicit admin revocation precedes reissue (automatic cleanup out of scope). No direct public SELECT privacy claim beyond PAF-28's server payload contract.
+- System impact (historical plan; issuance deferred to PAF-31): One additive imperative migration with two narrow privileged join RPCs, join/accept server functions, validators, generated RPC types, mocked and local real-JWT tests. Invitation issuance was delivered under PAF-31 in `src/features/community/community-admin.functions.ts`, not `community.functions.ts`; issuance is not outstanding PAF-29 scope. No route/UI/email delivery, new package, schema-table change, match access, coverage-threshold change, or modification to applied migrations. The historical invitee-bound token was not an unrestricted anyone-with-link invite. No direct public SELECT privacy claim beyond PAF-28's server payload contract.

 ## Chosen Approach

-- Proposed solution: **A (chosen)**: two `SECURITY DEFINER` SQL RPCs only for operations blocked by RLS; keep Admin invitation creation as an ordinary RLS-protected INSERT from a small server function. `join_public_community(p_community_id uuid)` derives identity solely from `auth.uid()`, rejects null or JWT `is_anonymous=true` (`28000`), locks/selects existing public community, resolves `join_policy`, inserts `role='member'` and `status='active'|'pending'`, returns only `{ community_id, status }`; both active and pending open rows are duplicates. `accept_community_invitation(p_token text)` performs the same auth check, validates canonical raw format, computes **`encode(extensions.digest(p_token, 'sha256'), 'hex')`** (fully qualify `pg_catalog.encode` in SQL), looks up `token_hash` under `FOR UPDATE`, requires `invitee_user_id=auth.uid()`, then checks redeemed/revoked/expiry, confirms target remains private, inserts active/pending membership, updates `redeemed_at` exactly once and returns `{ community_id, status }`; all in the _one RPC transaction_. Hash the ASCII bytes of a lowercase **64-hex-character 32-byte random token**, not the decoded hex bytes; issuance uses Worker-compatible `crypto.getRandomValues(new Uint8Array(32))`, lowercase hex encoding and `crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawToken))` to INSERT only 64-hex `token_hash`. Return raw token to authorized Admin once, never persist/log it or send it in query parameters from server code. Issue function accepts `{ community_id, invitee_user_id }`, verifies Admin/private community and inserts `{ community_id, invitee_user_id, token_hash, expires_at }` through existing invitation RLS, with a server-selected seven-day expiry; `issued_by` comes from DB default. Actual link composition/delivery is PAF-2.5 UI scope. Use no service role.
+- Proposed solution: **A (chosen; issuance details are historical/deferred to PAF-31)**: two `SECURITY DEFINER` SQL RPCs only for operations blocked by RLS; historical Admin invitation creation used ordinary RLS-protected INSERT, delivered under PAF-31 in `community-admin.functions.ts`. Join and acceptance behavior remains as described below. Historical issuance generated/hash-stored a random token and returned it once to authorized Admin; it is not active PAF-29 work. Actual link composition/delivery is PAF-2.5 UI scope. Use no service role.
 - Justification for simplicity: **B** adding new self-insert/RLS and invitation UPDATE policies permits forged status or redemption and does not make membership + token consumption atomic; reject. **C** generic invitation service/table or all-in-one RPC for issuing, joining and approving grows privilege surface and conflates PAF-2.6; reject. Two targeted definer functions + existing Admin grants isolate exactly the forbidden operations. Existing pending row, admin read policy and audit triggers already provide request visibility and transition history; no queue/table needed. Brainstormed threats: stolen raw token without invitee JWT, signed-in anonymous role, invalid/oversize input, leaked private ID, expiry while waiting on lock, concurrent redemption, duplicate membership race, community visibility/policy flip, inactive history, reissue after expiration, trigger rollback and plaintext token exposure.
 - Components to be modified/created (**exact seven-file implementation delta including this plan**):
   - **NEW** `supabase/migrations/<CLI-generated-timestamp>_community_join_flows.sql` — two auth-checked definer RPCs, atomic row lock/member INSERT/redemption, custom SQLSTATEs, explicit EXECUTE revokes/grants; check/enable `pgcrypto` in `extensions` only if absent on clean local schema. Never edit PAF-26/27 migrations.
   - **CHANGED/generated** `src/lib/supabase/database.types.ts` — `pnpm db:types` adds signatures/results of both RPCs; no hand edits, retain PAF-33 scoped oxfmt convention.
-  - **CHANGED** `src/features/community/community.validators.ts` — strict UUID and canonical raw-token validation, issue-invite input, exported typed result shape as needed; reuse `INVALID_COMMUNITY_INPUT`, `objectWithKeys`/`pgText` semantics, never accept caller-supplied user ID on join/accept.
-  - **CHANGED** `src/features/community/community.functions.ts` — POST `joinCommunity`, `acceptInvitation`, `issueInvitation`, `requireAuthenticatedClient()`, typed RPC calls, Admin RLS insertion/one-time raw-token response, only exact DB-error mappings; leave discovery/create/settings intact.
-  - **NEW** `test/community.join.functions.test.ts` — existing mocked TanStack builder/real-validator/claims/client style, stable-code/auth/argument/issuer hashing tests.
+  - **CHANGED** `src/features/community/community.validators.ts` — historical PAF-29 scope: strict UUID and canonical raw-token validation for join/accept; issuance validator was delivered under PAF-31.
+  - **CHANGED** `src/features/community/community.functions.ts` — historical PAF-29 scope: POST `joinCommunity`, `acceptInvitation`, typed RPC calls and exact DB-error mappings; leave discovery/create/settings intact. Issuance is not in this module: PAF-31 delivered it in `src/features/community/community-admin.functions.ts`.
+  - **NEW** `test/community.join.functions.test.ts` — existing mocked TanStack builder/real-validator/claims/client style and join/accept tests; issuance/hash tests named in the original PAF-29 file list were deferred to and delivered under PAF-31.
   - **CHANGED** `test/community.integration.test.ts` — independent local real-JWT join fixtures/tests; retain current suite and loopback/CI guard; avoid relying on later admin-demotion/invitation-revocation fixtures.
   - **NEW** `docs/plan/Plan PAF-29 PAF-2.4 — Join flows: public self-join, private invitations, approval handling, edge cases.md` — this plan. No CI/package/config/route/locales files expected.

@@ -21,13 +23,13 @@

 1. **Preflight and migration dependency check.** Confirm checked-out stack/clean tree, PAF-28 base `db0078e`, seven-file gate and local-only Supabase. Inspect current `pg_extension` namespace and `pg_proc` for `digest(bytea,text)` / `digest(text,text)` on a fresh local `pnpm db:start`/`pnpm db:reset`; repo migrations/config do **not** establish `pgcrypto` availability, so do not claim it already exists. Prefer `extensions.digest(text,text)` if present. If absent, add `CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions` to the **new** migration and verify `extensions.digest` actually resolves after fresh reset; if installed in another schema, do not silently move it—use its observed qualified schema or pause if environments differ. Confirm direct nonadmin member INSERT and redeem UPDATE remain denied, Admin can SELECT pending rows, and trigger accepts first redemption. Read CLI `migration new --help`, create CLI-timestamped migration; never guess filename or run hosted `db push`. Check upstream current Supabase/CLI docs/changelog before implementation if external research is permitted; this planning pass did not run SQL or web research.
 2. **Specify database contract and errors.** Both `public.*` functions: `LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''`, fully qualify `auth.uid`, `auth.jwt`, `pg_catalog.*`, `public.*`, `extensions.digest`; `REVOKE ALL ... FROM PUBLIC, anon, authenticated`, `GRANT EXECUTE ... TO authenticated` with exact signatures. Explicit null/signed-in-anonymous rejection in function (`28000`). `join_public_community(uuid)` checks public visibility **without exposing private vs nonexistent** (`PJ007` → `COMMUNITY_NOT_PUBLIC`), reads join policy under `FOR SHARE` to serialize policy/visibility changes, checks existing open member, inserts fixed `member` role and mapped status, returns single row `RETURNS TABLE(community_id uuid,status public.community_membership_status)`; admin never becomes duplicate member. `accept_community_invitation(text)` validates canonical 64 lower-hex raw token (otherwise `PJ001`), queries unique hash `FOR UPDATE`, checks **wrong invitee before lifecycle** (`PJ005`), then already redeemed (`PJ003`), revoked (`PJ004`), expiry `expires_at <= clock_timestamp()` (`PJ002`), target private (`PJ007`, same public/missing classification), and existing open membership (`PJ006`). Use a captured `clock_timestamp()` **after lock acquisition** as validity/redemption time; compare strictly (`expires_at > captured time`); verify CHECK `redeemed_at <= expires_at` and PAF-26 guard. Acquire invitation lock before community `FOR SHARE`, then membership INSERT, then UPDATE invitation `redeemed_at`; failed member INSERT rolls back entire transaction and leaves token unconsumed. Explicit duplicate precheck gives `PJ006`; wrap only member INSERT in SQL `unique_violation` handler, inspect `GET STACKED DIAGNOSTICS ... CONSTRAINT_NAME`, translate **only** `community_members_open` (`23505`) to `PJ006` for concurrent attempts; rethrow unrelated unique errors. Return one row only, no token/hash or private metadata on failure. Preserve `is_community_member`/admin active-only helpers and invitation column grants; do **not** add self INSERT or client redemption UPDATE policy. Database can still allow Admin membership inserts by design. If desired, deny direct RPC calls by anonymous signed-in role via the explicit JWT check even though it uses Postgres `authenticated` role.
-3. **Build validated server boundary.** `validateJoinCommunity({community_id})`, `validateAcceptInvitation({token})`, `validateIssueInvitation({community_id,invitee_user_id})`: exact allowlists, string UUID format reused from existing validator, raw token `^[0-9a-f]{64}$`, no null/unknown keys/identity override; invalid input yields `INVALID_COMMUNITY_INPUT` before DB. For acceptance, preserve DB's `INVITATION_INVALID` for _unknown but well-formed_ tokens; malformed tokens are input errors at server boundary and `PJ001` in direct RPC. POST handlers call `requireAuthenticatedClient()` before RPC/insert and return `{community_id,status}` for join/accept from typed `.rpc(...).single()` (assert shape/one row; unexpected empty result is DB failure, not success). Map only exact codes: `28000`→`UNAUTHENTICATED`; `PJ001`→`INVITATION_INVALID`; `PJ002`→`INVITATION_EXPIRED`; `PJ003`→`INVITATION_USED`; `PJ004`→`INVITATION_REVOKED`; `PJ005`→`INVITATION_NOT_FOR_USER`; `PJ006`→`ALREADY_MEMBER_OR_PENDING`; `PJ007`→`COMMUNITY_NOT_ELIGIBLE` (public join: non-public/absent; accept: non-private/absent). Preserve unexpected DB failures, never map all `23505` or `42501` to duplicate/auth. Issue handler checks private/Admin with existing `is_community_admin` plus community visibility read; Admin INSERT RLS is final authority, return `{token,expires_at}` once, never hash in response or raw in DB; map only the known invitation-open unique constraint to `INVITATION_ALREADY_OPEN`, otherwise propagate. Expired-but-open reissue requires Admin revoke first under existing grants (UI deferred); no broad RLS relaxation.
+3. **Build validated server boundary.** `validateJoinCommunity({community_id})`, `validateAcceptInvitation({token})`: exact allowlists, string UUID format reused from existing validator, raw token `^[0-9a-f]{64}$`, no null/unknown keys/identity override; invalid input yields `INVALID_COMMUNITY_INPUT` before DB. For acceptance, preserve DB's `INVITATION_INVALID` for _unknown but well-formed_ tokens; malformed tokens are input errors at server boundary and `PJ001` in direct RPC. POST handlers call `requireAuthenticatedClient()` before RPC and return `{community_id,status}` from typed `.rpc(...).single()` (assert shape/one row; unexpected empty result is DB failure, not success). Map only exact codes: `28000`→`UNAUTHENTICATED`; `PJ001`→`INVITATION_INVALID`; `PJ002`→`INVITATION_EXPIRED`; `PJ003`→`INVITATION_USED`; `PJ004`→`INVITATION_REVOKED`; `PJ005`→`INVITATION_NOT_FOR_USER`; `PJ006`→`ALREADY_MEMBER_OR_PENDING`; `PJ007`→`COMMUNITY_NOT_ELIGIBLE` (public join: non-public/absent; accept: non-private/absent). Preserve unexpected DB failures, never map all `23505` or `42501` to duplicate/auth. **Historical/deferred issuance clause (delivered by PAF-31 in `community-admin.functions.ts`):** original issue handler checked private/Admin access, inserted only token hashes under RLS, returned raw token once, and mapped duplicate-open errors; this is not active PAF-29 implementation work.
 4. **Replay migration and regenerate types.** Reset disposable local DB, assert extension function resolves with explicit schema, SQLSTATEs/EXECUTE grants via JWT RPC probes, first redemption and audit triggers. Run `pnpm db:types` **after** successful reset; inspect the two `public.Functions` Args/Returns, confirm `.single()` shape is typed and output remains PAF-33-formatted. Regenerate twice without further schema changes; compare byte-for-byte. Its shell redirection may truncate generated file if generation fails: restore that file to branch version and retry only after local DB is healthy. No manual edits or drift in unrelated generated types. If SQL return-shape generation differs, adjust `RETURNS TABLE`/consumer based on actual generated types, not unsafe casts.
-5. **Mocked boundary tests.** Use existing Vitest builder + `getServerClient`/`setResponseHeader` mocks in new `test/community.join.functions.test.ts`. Check validator rejection before auth/client; missing/expired claims → `UNAUTHENTICATED` and no RPC; exact POST RPC names/arguments with no caller-supplied role/user; status/result of both policies; table-driven precise error mapping including distinct invalid/expired/used/revoked/wrong-invitee/duplicate and unknown-code passthrough. Test issue function generates 32-byte nonconstant raw hex, inserts only matching WebCrypto SHA-256 hash as Admin, uses server expiry, never sends raw to table, handles nonadmin/duplicate-open/private check; no service-role calls. Check private/no-store headers. No test logs raw tokens.
-6. **Real-JWT integration and RLS matrix.** Extend existing loopback-only `test/community.integration.test.ts` with _independent_ Admin, two invitees and outsider plus anon (fresh communities or tests before fixture mutation). Seed public instant/public admin-approval/private instant/private admin-approval through existing creator RPC; issue bound invitations through new server function; use its raw token for accepting user. For every flow run server function with `serverClient.current` set to actor JWT and assert own membership and Admin roster: role member, active `activated_at` set vs pending `activated_at=null`, `valid_until=null`; pending visible to Admin as join request, not a separate table. Probe pending private member for zero `communities`, `community_venues`, admin audit, `is_community_member=false`, `can_read_community=false`, `is_community_admin=false`; own pending row visible. For public pending, public basic discovery may remain visible, but member-only venue/admin rights stay denied. Assert wrong invitee with stolen valid raw token (`INVITATION_NOT_FOR_USER`) leaves unconsumed; correct invitee then accepts; reused token → `INVITATION_USED`, newly generated valid token with expired timestamp (seed hash via Admin RLS INSERT or controlled short expiry + bounded wait; no future-clock trick) → `INVITATION_EXPIRED`; unknown well-formed token → `INVITATION_INVALID`; revoked → `INVITATION_REVOKED`; duplicate active/pending join/accept → `ALREADY_MEMBER_OR_PENDING` with invitation still unconsumed; public join on private/missing → same non-eligible code; private invite becomes ineligible if visibility flips. Prove simultaneous same-token accepts yield exactly one success, one `INVITATION_USED`, one membership, one redemption/audit; simultaneous public joins yield one success and one duplicate, no second open row. Direct nonadmin INSERT into members and direct redeemed_at UPDATE remain denied; anonymous server join/accept/issue throws `UNAUTHENTICATED`, anon direct RPC gets `42501`, anon owns no new member row. Signed-in Supabase anonymous-user JWT (if enabled in a separate local fixture) must fail SQL `28000`; do not weaken DB check because current `supabase/config.toml` does not enable anonymous sign-ins. Inactive history stays immutable and may receive a _new_ join interval when no open row; do not implement removal/reactivation transitions. Preserve existing integration suite ordering and CI fail-closed guard; no service-role fixtures.
+5. **Mocked boundary tests.** Use existing Vitest builder + `getServerClient`/`setResponseHeader` mocks in new `test/community.join.functions.test.ts`. Check validator rejection before auth/client; missing/expired claims → `UNAUTHENTICATED` and no RPC; exact POST RPC names/arguments with no caller-supplied role/user; status/result of both policies; table-driven precise error mapping including distinct invalid/expired/used/revoked/wrong-invitee/duplicate and unknown-code passthrough. **Historical/deferred issuance tests (delivered under PAF-31 in `community-admin.functions.ts`):** token generation/hash-only insertion/expiry/admin checks are not active PAF-29 requirements. Check private/no-store headers. No test logs raw tokens.
+6. **Real-JWT integration and RLS matrix.** Extend existing loopback-only `test/community.integration.test.ts` with _independent_ Admin, two invitees and outsider plus anon (fresh communities or tests before fixture mutation). Seed public instant/public admin-approval/private instant/private admin-approval through existing creator RPC. Historical issuance through a new server function was deferred to PAF-31 and delivered in community-admin.functions.ts; use valid bound tokens when testing acceptance. For every flow run server function with `serverClient.current` set to actor JWT and assert own membership and Admin roster: role member, active `activated_at` set vs pending `activated_at=null`, `valid_until=null`; pending visible to Admin as join request, not a separate table. Probe pending private member for zero `communities`, `community_venues`, admin audit, `is_community_member=false`, `can_read_community=false`, `is_community_admin=false`; own pending row visible. For public pending, public basic discovery may remain visible, but member-only venue/admin rights stay denied. Assert wrong invitee with stolen valid raw token (`INVITATION_NOT_FOR_USER`) leaves unconsumed; correct invitee then accepts; reused token → `INVITATION_USED`, newly generated valid token with expired timestamp (seed hash via Admin RLS INSERT or controlled short expiry + bounded wait; no future-clock trick) → `INVITATION_EXPIRED`; unknown well-formed token → `INVITATION_INVALID`; revoked → `INVITATION_REVOKED`; duplicate active/pending join/accept → `ALREADY_MEMBER_OR_PENDING` with invitation still unconsumed; public join on private/missing → same non-eligible code; private invite becomes ineligible if visibility flips. Prove simultaneous same-token accepts yield exactly one success, one `INVITATION_USED`, one membership, one redemption/audit; simultaneous public joins yield one success and one duplicate, no second open row. Direct nonadmin INSERT into members and direct redeemed_at UPDATE remain denied; anonymous server join/accept throws `UNAUTHENTICATED` (historical issuance auth test was delivered under PAF-31), anon direct RPC gets `42501`, anon owns no new member row. Signed-in Supabase anonymous-user JWT (if enabled in a separate local fixture) must fail SQL `28000`; do not weaken DB check because current `supabase/config.toml` does not enable anonymous sign-ins. Inactive history stays immutable and may receive a _new_ join interval when no open row; do not implement removal/reactivation transitions. Preserve existing integration suite ordering and CI fail-closed guard; no service-role fixtures.
 7. **Run gates, measure, hand off.** Set local loopback API URL/publishable key using `.github/workflows/ci.yml` pattern; confirm integration **ran**, not skipped. Run `pnpm db:start`, `pnpm db:reset`, `pnpm db:types` as above, focused `pnpm exec vitest run test/community.join.functions.test.ts test/community.integration.test.ts`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, then `pnpm complete-check` (build, knip, typecheck, lint, format, coverage and E2E). Do not change thresholds, auto-fix in CI, package versions, or hosted data. Estimate **~600–790 added/deleted lines, seven files**: migration ~105–145, generated types ~8–20, validators ~25–40, functions ~65–90, mocked tests ~100–125, integration ~230–290, plan ~60–80; **unmeasured**, upper edge close to 800. Inspect actual `added + deleted` and file count against **PAF-28 branch**, including plan and generated file; if >800/20, consolidate independent fixture/test repetition, never drop security probes; request gate exception or split only with user approval. One final Conventional Commit, no issue identifier in commit/PR text; PR base PAF-28. Rollback: before merge fix only new migration and rerun clean reset/types/tests; after deploy use corrective forward migration, never rewrite historical migrations. If extension namespace differs or atomic/RLS probes fail, stop release and repair boundary, not test expectations.

 ## Validation

-- Success criteria (1:1 issue ACs): **AC1** real-JWT public instant actor gets exactly one active member row; second attempt returns `ALREADY_MEMBER_OR_PENDING` (steps 2, 5–6). **AC2** approval-required public actor gets pending row visible to Admin; activation null, member-only rights false; no approve action (steps 2, 6). **AC3** invitee-bound valid/unexpired/unredeemed private token accepted once, status follows each private join policy, token atomically redeemed; stolen token without invitee identity fails without consumption (steps 2–3, 6). **AC4** consumed vs expired yield distinct `INVITATION_USED`/`INVITATION_EXPIRED`; revoked has separate state (steps 2, 5–6). **AC5** unknown canonical token rejected `INVITATION_INVALID`, malformed input rejected pre-RPC and malformed direct RPC rejected `PJ001` (steps 2–3, 5–6). **AC6** absent claims, anon SQL role, and any signed-in-anonymous JWT cannot join; guest/public discovery does not create membership (steps 2, 5–6). **AC7** focused mocked server tests plus executed local real-JWT instant/approval/invited/duplicate/expired/used/invalid paths and pending-private RLS assertions pass; existing suite stays green (steps 5–7).
-- Checkpoints: **Pre-implementation (step 1):** approved invitee-bound decision preserved; correct stacked base/local-only DB, `pgcrypto` schema and first-redemption guard confirmed. **During implementation (steps 2–4):** narrow grant/RLS/SQLSTATE map, strict token-hash parity, conditional extension, fresh reset, typed RPC results, repeatable generated output; failed duplicate/expired/wrong-invitee paths leave token/member unchanged. **Integration (steps 5–6):** tests execute with real JWTs, pending rights denied, independent invitation-state errors, concurrent consume/duplicate races, anonymous direct RPC rejected. **Post-implementation (step 7):** all specified gates green; ≤800 changed lines/≤20 files measured against PAF-28 or explicit approval; exactly one final commit and PR base verified. Out of scope remains PAF-2.5 onboarding/link UI and delivery, PAF-2.6 admin approve/deny/removal, PAF-2.7 reactivation semantics, PAF-4 match authorization.
+- Success criteria (1:1 issue ACs): **AC1** real-JWT public instant actor gets exactly one active member row; second attempt returns `ALREADY_MEMBER_OR_PENDING` (steps 2, 5–6). **AC2** approval-required public actor gets pending row visible to Admin; activation null, member-only rights false; no approve action (steps 2, 6). **AC3** invitee-bound valid/unexpired/unredeemed private token accepted once and atomically redeemed; stolen token without invitee identity fails without consumption. Invitation issuance was deferred to PAF-31 and delivered in community-admin.functions.ts. (steps 2–3, 6). **AC4** consumed vs expired yield distinct `INVITATION_USED`/`INVITATION_EXPIRED`; revoked has separate state (steps 2, 5–6). **AC5** unknown canonical token rejected `INVITATION_INVALID`, malformed input rejected pre-RPC and malformed direct RPC rejected `PJ001` (steps 2–3, 5–6). **AC6** absent claims, anon SQL role, and any signed-in-anonymous JWT cannot join; guest/public discovery does not create membership (steps 2, 5–6). **AC7** focused mocked server tests plus executed local real-JWT instant/approval/invited/duplicate/expired/used/invalid paths and pending-private RLS assertions pass; existing suite stays green (steps 5–7).
+- Checkpoints: **Pre-implementation (step 1):** approved invitee-bound decision preserved; correct stacked base/local-only DB, `pgcrypto` schema and first-redemption guard confirmed. **During implementation (steps 2–4):** narrow grant/RLS/SQLSTATE map, strict token-hash parity, conditional extension, fresh reset, typed RPC results, repeatable generated output; failed duplicate/expired/wrong-invitee paths leave token/member unchanged. **Integration (steps 5–6):** tests execute with real JWTs, pending rights denied, independent invitation-state errors, concurrent consume/duplicate races, anonymous direct RPC rejected. **Post-implementation (step 7):** all specified gates green; ≤800 changed lines/≤20 files measured against PAF-28 or explicit approval; exactly one final commit and PR base verified. Out of scope remains PAF-2.5 onboarding/link UI and delivery, PAF-2.6 admin approve/deny/removal, PAF-4 match authorization. Former-member success-self-rejoin is superseded by denial plus authorized reactivation.
diff --git "a/docs/plan/Plan PAF-50 PAF-2 follow-up \342\200\224 Tier 3: test and UI polish.md" "b/docs/plan/Plan PAF-50 PAF-2 follow-up \342\200\224 Tier 3: test and UI polish.md"
new file mode 100644
index 0000000..4002395
--- /dev/null
+++ "b/docs/plan/Plan PAF-50 PAF-2 follow-up \342\200\224 Tier 3: test and UI polish.md"
@@ -0,0 +1,154 @@
+## Task Analysis
+
+- Main objective: Deliver **PAF-50 — "PAF-2 follow-up — Tier 3: test and UI polish"** as four ordered units: **PAF-34 → PAF-38 → PAF-40 → PAF-43**. One branch, four Conventional Commits, one PR targeting main. Planning only in this session; sole writable artifact is this document.
+- Identified dependencies: Existing domain/RLS/join/lifecycle migrations; current audit replacement; TanStack route loaders; StyleX/tokenized UI; Base UI 1.7; per-request i18n; real-JWT local integration helpers; Vitest/Playwright. Intake branch: feature/PAF-50-tier-3-test-and-ui-polish, base/tip 8c705c2258c2099a8a5ce953e52f119b435d1f14. Branch state supplied by parent, not independently verified through commands. Ledgers read: docs/plan/PAF-26-findings.md, PAF-29-findings.md, PAF-30-findings.md, PAF-31-PR2-findings.md. Their line locations are historical; anchors below refer to current source, 1-based unless stated otherwise.
+- System impact: One forward-only trigger-function migration; integration-fixture/test hardening; onboarding pending/label accessibility; admin route/layout/view isolation; stronger locale, confidentiality, geometry and compiled-transport tests. No new dependencies, services, global state/store, hosted DB operations, blanket RLS changes, invitation-delivery feature, coverage changes, or screenshot-budget widening.
+
+## Chosen Approach
+
+- Proposed solution: Surgical changes on established seams. Share immutable actor authentication setup, recreate mutable community fixtures per test. Extend current audit trigger with explicit changed-field allowlists and narrowly safe transitions. Keep onboarding mounted during navigation; derive pending from router state. Preserve existing exported admin entry components; move six state-owning typed views behind a discriminated dispatcher. Use explicit members index/Outlet. Replace source-string assertions with executable route tests and bind extraction assertions to a successful fresh build.
+- Justification for simplicity: Brainstormed three approaches: (A) local fixes plus typed view separation, chosen; (B) generic fixture engine/query cache/admin state machine, rejected as extra ownership and lifecycle complexity; (C) rewrite all tests/UI or replace Pencil baselines with browser screenshots, rejected as loss of provenance and large regression surface. Important edges: filtered test execution, demotion races, stale loader/search responses, pending retries without URL changes, history navigation, focus target disappearance after mutation, renderer residuals, confidential serialized payloads, clock skew and slow INSERTs.
+- Components to be modified/created: Exact per-unit lists below. Common plan artifact belongs in first unit's commit. Existing schema types need no change: trigger signature/schema/RPC contract unchanged. New migration filename necessarily receives implementation-time CLI timestamp; only unresolved filename, not unresolved design.
+- Current-code conflict / smallest alternative: **PAF-38 F4 cannot mean successful former-member self-rejoin anymore.** 20261008184607_community_membership_lifecycle.sql explicitly raises PJ008 for inactive history in both join_public_community and accept_community_invitation; 20261009061318_community_reactivation_interval_order.sql makes govern_community_member(..., 'reactivate') append a new interval. Preserve current security/product policy. Add rejected self-join/private acceptance with unchanged history and unconsumed token, then authorized admin reactivation proving a new interval and unchanged old interval. Do not weaken PJ008 merely to satisfy obsolete finding prose. Record this interpretation in PAF-29 plan annotation and obtain parent acceptance before treating original F4 acceptance criterion as fully satisfied.
+- Constraints: 2-space indentation; PascalCase React components, kebab-case modules, established domain-prefixed tests. Tokens first, all visible/accessible text translated. ≥44px controls, fluid/wrapping layouts, Base UI interactive primitives. Keep requireAuthenticatedClient/getClaims, no-store, RLS and scoped membership lookup. Review docs/design/padel-friend.pen through Pencil tools during implementation; encrypted .pen was not read as text in planning. No design-file modification planned.
+
+## Implementation Steps
+
+1. **Preflight / establish red evidence.** Implementation agent verifies branch/base/clean-tree and local-only backend before edits; do not recreate branch. Read this plan and accept F4 policy alternative. Confirm local backend available and migrations applied through archive-audit replacement; integration skip is not a pass. Record current source PNG hashes and per-screen caps. Capture focused failures before each fix where behavior is defective. For pure refactors/test-oracle improvements, keep behavior characterization green and demonstrate new oracle detects injected incorrect input/route/build state; do not pretend unchanged behavior should fail. No installs or production mutations. Planning session ran no commands/tests/DB operations.
+
+2. **Unit 1 — PAF-34: isolate fixtures, preserve inactive-only actor, add safe audit detail.**
+
+   **Exact change list:**
+   - test/community.integration.test.ts
+   - supabase/migrations/<CLI-generated-timestamp>_community_audit_changed_fields.sql (new; create with pnpm exec supabase migration new community_audit_changed_fields)
+   - docs/plan/Plan PAF-50 PAF-2 follow-up — Tier 3: test and UI polish.md (this artifact)
+
+   **Anchors:** integration actor()/rows()/serverClient at lines 66–108 and 10; mutable declarations 130–143; first it initializes everything at 144–204; AC3 rejoins inactive actor at 585–653; privacy/mutation matrices 655–713/715–861; final-admin race and inherited audit assertions 886–940; later activation tests choose surviving admin at 942–1036. Original SQL audit_community_change at 248–278 is superseded by 20261011171955_community_venue_archive_audit.sql, which adds archived boolean evidence and revokes direct execution.
+
+   **Ordered work:**
+   1. Add beforeAll for actors only, beforeEach for fresh private/public communities, role rows, invitation and venue, afterEach clearing serverClient.current. Keep suite sequential: hoisted client is shared, so no concurrent tests using it. Local helpers remain in this test file; avoid global fixture framework. Hook initialization must run for every selected test independently; reduce actor churn by reusing only authentication identities, not mutable community state.
+   2. Move creator/bootstrap assertions out of setup; test checks its hook-created fixtures. Each mutable test seeds its own prerequisites. In AC7 explicitly create venue/settings/member audit events before count/entity assertions; no inherited revocation/promotion/settings assumption. Later activation tests use their fixture admin, not outcome of preceding race. Discovery checks use UUID-specific search/explicit IDs rather than assuming default first page always includes newest fixture amid accumulating local data. Keep loopback and CI fail-closed guard.
+   3. AC3 rejoin uses its fresh per-test inactive fixture. AC4/AC5 assert inactive actor has exactly one closed row, non-null activation, zero open rows before and after matrix. Strongest no-regression probe runs AC3 and AC4/5 together: rejoin in one test must not affect matrix fixture. Assert denied UPDATEs leave settings, venue, membership and invitation unchanged, not only error shape.
+   4. Create new CLI migration; never edit 20261002055953_community_domain.sql or archive-audit migration. CREATE OR REPLACE latest public.audit_community_change(), preserving SECURITY DEFINER, empty search_path, fully qualified calls, auth.uid actor, append-only insertion, existing member role/status and invitation revoked evidence, and venue archived boolean. Existing triggers remain attached; no new trigger duplication.
+   5. On UPDATE compute deterministic changed_fields using explicit columns and IS DISTINCT FROM: communities name, description, logo_path, city_label, visibility, join_policy, settings; venues name, address, maps_url, photo_path, archived_at. Exclude mechanical updated_at, IDs, creator/account columns. Emit before/after objects only for changed safe transitions: community visibility/join_policy enums and venue archived boolean (derived from archived_at). Settings name may appear in changed_fields, but never settings contents. Text/URL/path values intentionally omitted: names of changed columns give utility without arbitrary user payload leakage. Retain top-level visibility/archived fields for compatibility; INSERT behavior stays compatible, with no OLD access. No whole-row to_jsonb dump into details. No-op update has empty changed_fields and empty transitions; existing audit emission remains, avoiding unrelated behavior change.
+   6. Add standalone audit integration test: change settings only, scalar metadata only, enums, venue metadata, archive, null→value/value→null, multi-field update and no-op. Check exact changed_fields/safe transitions; unchanged enum absent from transitions. Seed distinctive secret settings/token/account/text sentinels; recursively verify details contain none. Check members/invitations still have existing evidence, archive still archived=true; nonadmins/anon cannot read or write audits and cannot invoke trigger function. Add explicit before-update baseline and assert historical audit rows unchanged.
+   7. Implementation only: apply migration to disposable local DB; test upgrade path from prior migration plus fresh replay. No hosted db push. No generated type update expected. Record actual CLI filename in unit report.
+
+   **Red→green checks:** isolated AC4 name-filter fails before hooks; AC3→AC4 actor-state check fails before per-test isolation; detailed audit assertions fail before replacement. Existing AC1–AC7 and creator/discovery tests stay green after isolation. Run each state-dependent test separately by its full exact name, not only one broad filter.
+
+   **Fast gate:** pnpm typecheck && pnpm lint && pnpm exec vitest run test/community.integration.test.ts test/community.column-isolation.integration.test.ts test/community.admin.integration.test.ts. Also pnpm exec vitest run test/community.integration.test.ts -t 'AC4:' and -t 'AC5:' independently, then -t 'AC3:|AC4:|AC5:'. Integration must run against migrated loopback DB.
+
+   **Risk/mitigation:** actor setup plus fresh DB fixtures raises hook cost; retain 30s configuration only if measured adequate, adjust local test/hook timeout with evidence rather than disabling assertions. Fresh fixtures may reveal prior implicit audit counts. Migration rollback before deploy: correct new migration and replay; after deploy: corrective forward migration restoring prior trigger body, never delete/rewrite applied history. Audit DDL must not alter RLS/grants/lock ordering. Intended commit: test: isolate community fixtures and enrich safe audit evidence.
+
+3. **Unit 2 — PAF-38: robust expiry and current-policy join edges; reconcile old plan.** Start only after Unit 1 commit; same integration file changes serially.
+
+   **Exact change list:**
+   - test/community.integration.test.ts
+   - docs/plan/Plan PAF-29 PAF-2.4 — Join flows: public self-join, private invitations, approval handling, edge cases.md
+
+   **Anchors:** join matrix 1038 onward; invitation helper 1059–1078 currently selects id/created_at; fixed 1200ms expiry plus 1500ms sleep at 1260–1261. PAF-29 plan still promises issuance in analysis, approach, file list, steps 3/5/6/validation. Delivered issueInvitation lives in community-admin.functions.ts, not community.functions.ts. Original lifecycle CHECK requires expires_at > created_at and invitation trigger prohibits editing expiry.
+
+   **Ordered work:**
+   1. Extract invitation/membership/join-community helpers within test suite so expiry, visibility flip and history scenarios become individually filterable tests with independent data. Preserve original successful/race/error matrix; no broad rewrite of production functions.
+   2. Expired fixture: seed with several seconds of validity, preferably DB-relative expiry through existing executeLocalFixtureSql so process/SQL-start delays cannot invalidate INSERT. Extend that helper to return parsed CLI JSON result for INSERT RETURNING id, created_at, expires_at (validate exact CLI result shape). Use generated safe UUID/hex values only in local SQL; no untrusted interpolation. Compute expires_at from DB clock at INSERT, e.g. 5 seconds after clock_timestamp(), and read stored timestamps. This test-only local SQL privilege follows existing fixture precedent; production acceptance still uses real invitee JWT.
+   3. Wait based on returned expires_at, with bounded polling/deadline (e.g. maximum 15s, 100ms poll; finite timestamp required). Add small post-expiry boundary cushion, not sub-second INSERT validity margin. Never sleep blindly for a hardcoded 1500ms, backdate expiry, loosen CHECK, or mutate immutable expiry. Timeout produces clear diagnostics without raw token. No fake timers around real DB expiration. Test normal helper and deliberately delayed seed execution (>1.2s) still returns expiry after creation; test wait helper expired-now and deadline failure with controlled clock in a local isolated test, then real acceptance rejects INVITATION_EXPIRED and leaves token/membership unchanged.
+   4. Add former-member history scenario for public and private paths: join/accept, close through leaveCommunity, snapshot complete closed row; self-join and fresh private token acceptance reject MEMBERSHIP_INACTIVE; no new row, old interval identical, redeemed_at/revoked_at unchanged. Set admin client and call existing reactivateCommunityMember endpoint; assert distinct replacement ID, role member/status active, old row unchanged, exactly one open interval, valid_from ≥ greatest closed valid_until, activated_at ≥ valid_from. No auto-reactivation, no migration changing PJ008. Use separate actors/communities for public/private variants.
+   5. Visibility flip: seed unconsumed private invitation, flip to public as admin, invitee acceptance rejects COMMUNITY_NOT_ELIGIBLE. Query invitation with .single(), error null, redeemed_at/revoked_at null; membership empty, audit shows no redemption/member insert. Flip back private and accept same token successfully to prove rejection did not consume it. Cover both join policies with parameterized fresh fixtures when practical.
+   6. Add prominent Delivered-scope reconciliation note to PAF-29 plan: historical issuance requirements deferred to PAF-31 and delivered in community-admin.functions.ts; PAF-29 delivered only join/accept plus validators, RPCs and tests. Mark issuance clauses in implementation/file/test/AC sections as historical/deferred rather than leaving contradictory imperative instructions active. Annotate self-rejoin expectations as superseded by lifecycle policy and current reactivation alternative. Preserve historical stack/base information as history, not current execution directions.
+
+   **Red→green checks:** delayed DB-relative fixture test exercises old timing flaw; stored-expiry/wait checks fail old helper. New lifecycle tests characterize current rejection, not demand obsolete success; history preservation verifies new-interval path. Visibility rejection oracle additionally injects consumed-token result to prove non-consumption assertion is strict. Documentation review searches every issuance mention and verifies attribution; no fake production test for prose edits.
+
+   **Fast gate:** pnpm typecheck && pnpm lint && pnpm exec vitest run test/community.integration.test.ts test/community.join.functions.test.ts test/community.lifecycle.functions.test.ts. Then filtered expiry/history/visibility tests individually; repeat expiry test 5 times on slow/local CI-equivalent resources. No extra migration or production behavior change.
+
+   **Risk/mitigation:** DB/process clocks differ; DB-relative seed eliminates INSERT race, bounded wait prevents hangs, local-only backend limits skew; fail clearly if expiry cannot be observed within deadline. Do not hide timing failures with Playwright/Vitest retries. F4 alternative needs parent acceptance; exact original success wording cannot honestly be marked implemented. Intended commit: test: harden invitation timing and membership edge coverage.
+
+4. **Unit 3 — PAF-40: independent SSR oracle, safe visual comparator, pending UX and durable labels.**
+
+   **Exact change list:**
+   - e2e/community-onboarding.spec.ts
+   - src/features/community/CommunityOnboarding.tsx
+   - src/features/community/community-onboarding.styles.ts
+   - src/locales/en/translation.json
+   - src/locales/pt-BR/translation.json
+   - src/locales/es/translation.json
+   - test/community.onboarding.test.tsx
+
+   **Anchors:** visualDiff e2e lines 124–179 uses fixed 390 stride with pixel arrays only; discovery cards/action probes/masks 297–337; current raw-vs-hydrated locale test 431–456 only inspects DOM. Current caps are upper-create 0.0866, full-create 0.1265, discovery 0.047; older ledger percentages are not current caps. Component has router.invalidate retry, current/draft/source keyed pagination, existing 300ms debounce/history protection; CreateCommunityView labels use ui.hidden. Styles ui.optional 140–159 provides 44px inputs; cardTitle/meta 73–85 define real typography.
+
+   **Ordered work:**
+   1. SSR locale test: after locale cookie and authenticated page.goto(), retain navigation response, require successful HTML response, read response.text(). Parse inert detached HTML (DOMParser in browser evaluate is sufficient; never query live document for this assertion) and assert documentElement.lang plus h1 text equals locale's dictionary entry. This tests response HTML even if page has hydrated. Then waitForHydratedPage and independently assert live html lang/heading; cover both views × en/pt-BR/es at 320px. Add synthetic raw-English HTML with Portuguese hydrated DOM negative oracle so helper rejects SSR mismatch; hydration must not rescue SSR failure.
+   2. visualDiff returns decoded width/height/pixels; validate expected and actual are exactly 390×844, equal, positive and buffer length width×height×4. Validate endY within image and mask bounds before any indexing. Derive stride from decoded width; explicitly reject dimensions before returning numeric count. Keep same color-distance formula and masks. Return diff PNG data plus count; use TestInfo attachments for expected, actual and diff with per-reference/region names. Attach expected/actual even when dimensions mismatch; diff unavailable must be explicit, not NaN. Keep source/baseline hash checks and byte equality before/after tests. Synthetic canvas PNG tests cover identical, mismatched width, mismatched height, invalid region and known changed pixel; add within this spec rather than new codec dependency/shared comparator project.
+   3. Subscribe via useRouterState to relevant onboarding route match pending/isFetching state, covering same-URL router.invalidate as well as navigation. Inspect installed router typings for match semantics; do not use only pathname comparison or mutation flag. Combine pending with unsent draft mismatch for immediate search feedback; exclude create view and unrelated route activity. Add stable results container aria-busy=true while pending and translated role=status outside busy subtree so announcements are not suppressed. Suppress empty-result message during pending; keep search enabled/focused and pagination/source guards unchanged. Retry button uses busy state to prevent duplicate invalidate. Reuse generic loading key or add communityOnboarding.searchLoading consistently in all three locale dictionaries (chosen: specific key).
+   4. Optional description/city labels become permanently visible compact/floating labels inside each existing 44px field row. Keep real htmlFor/id, input hit area ≥44px, tokenized label/text sizing, no overlapping values. Prefer labeled relative wrapper + label with pointer interaction transferred to input; remove duplicate field names from placeholder examples if needed in all locales. Fit existing row geometry where possible; translation must wrap without clipping at 320px. No hidden-only label, placeholder-only identity, or shrinking touch target to recover visual fit.
+   5. Close mask blind spots: assert each h3/metadata exact x/y/width/height for deterministic fixture, plus font-family, font-size, font-weight, line-height/color from computed styles and tokens. Probe action x/y/width/height, not current x/height only; title and metadata placement remain frame/card relative. Use existing card boxes (18/240/354/142 and 18/392/354/142) and padding 14 to derive expected content placement; measure height/line metrics against actual Pencil source before pinning, never invent font pixel geometry. Assert approved omission of member-count/skill rows remains. If pending wrapper changes CSS selectors, update locators semantically without relaxing geometry.
+   6. Add component tests with controllable router-state mock: draft→debounce→loader pending→settled, first-page same-query retry pending/success/failure, loadMore busy, no spurious empty status, translations per locale, preserved keyboard focus/current join result/history behavior. Filled optional fields retain visible associated labels; jsdom accessibility assertions plus browser visibility/hit-area/overlap assertions at 320px. Existing mocked hooks need useRouterState mock; do not derive production pending solely from test mocks.
+   7. Browser test delays relevant loader response to observe pending, then releases deterministically; test retry after controlled failure. No fixed sleep as pending oracle. Verify real TanStack request shape before intercepting; use specific endpoint only, never blanket fake auth/data. Review dSEX3/JO4DC via Pencil tools and attach visual artifacts.
+
+   **Red→green checks:** bad raw SSR fixture fails new oracle independent of correct live DOM; mismatched PNG fails dimensions instead of NaN; pending and filled-label tests fail current UI; intentionally displaced masked title/metadata/action fails new probes. Existing keyboard/history/create reset/pagination/join cases must remain green.
+
+   **Fast gate:** pnpm typecheck && pnpm lint && pnpm exec vitest run test/community.onboarding.test.tsx test/i18n.test.ts && pnpm exec playwright test e2e/community-onboarding.spec.ts. Fresh preview required, do not reuse server running stale source.
+
+   **Risk/mitigation:** all three translation files get identical key structure; assert nonempty localized pending strings. Do not update PNG baselines from browser or use --update-snapshots. Cross-renderer glyph residuals allowed only within existing documented caps; structural defects are blockers. Persistent-label layout may alter lower-create region: preserve compact field-row geometry first. If current unchanged budget cannot accommodate a legitimate accessibility improvement, stop and report exact residual/probes for design review; do not silently widen budgets/masks. Rollback only affected UI/test changes if focus/history/geometry regress; retain original source PNGs. Intended commit: fix: polish community discovery feedback and visual assertions.
+
+5. **Unit 4 — PAF-43: admin confirmation/recovery, route split, typed view state, stronger executable tests.**
+
+   **Exact change list:**
+   - src/features/community/CommunityAdmin.tsx
+   - src/features/community/CommunityAdminViews.tsx (new; typed dispatcher plus six private state-owning view components and shared frame/mutation helpers)
+   - src/features/community/community-admin.types.ts
+   - src/features/community/community-admin.functions.ts
+   - src/features/community/community-admin.validators.ts
+   - src/features/community/community-admin.styles.ts
+   - src/routes/_protected.community.$communityId.admin.members.tsx
+   - src/routes/_protected.community.$communityId.admin.members.index.tsx (new)
+   - src/routeTree.gen.ts (generator output only)
+   - test/community.admin-ui.test.tsx
+   - test/community.admin.functions.test.ts
+   - test/community.admin-routes.test.ts
+   - test/community.admin-extraction.test.ts
+   - e2e/community-admin.spec.ts
+
+   Existing communityAdmin.retry/backToDashboard/confirm/cancel/error/loading keys already exist in en, pt-BR, es; no Unit 4 locale file edits expected. If error/reset API forces additional user copy, add keys across all three files and explicitly extend unit change list before editing. No admin endpoint transport rewrite, new RPC or migration.
+
+   **Anchors:** CommunityAdminDenied 144–172 lacks recovery; CommunityAdminScreen/View 210–307 holds all screen state and keys only by community.id; requestMemberAction/confirmedAction/actions 366–446 renders confirmation before trigger; fetchMembers 475–524 and audit paging 567–580 lack loader-source identity. Existing request/venue state reset at 297–306 and mutation invalidation 313–338 must survive. getCommunityAdminContext inline validator follows requireAdmin in functions module; record()/uuid() already exist in validators. styles.backLink lineHeight:1 at 50; only available primitive line-height tokens tight=1.1/body=1.5. MembersRoute currently loads roster and pathname.endsWith('/members') (members.tsx 13–36), even for detail; detail uses scoped getCommunityMemberById. Extraction test reads arbitrary existing dist assets at 15 onward. Route tests are readFileSync/toContain assertions throughout. Admin E2E denial only guest redirect/member heading at 435–442/521–529, narrow locale coverage settings-only at 545–562, six 390px screens have fixed provenance/caps.
+
+   **Ordered work (one unit commit; internal checkpoints before proceeding):**
+   1. Establish behavioral characterization of six screens: existing search clearing/filter paging, loader-backed first page, request/venue appended-page reset on mutation, replacement membership navigation, cross-community draft reset, UTC dates, rating nullability, neutral audit actor and strict authorization. Add deferred-response tests for loader refresh while member search/audit loadMore is in flight; old source data must not overwrite new loader result. Add search→settings and audit→other-screen rerenders proving unrelated state does not persist or fire queries.
+   2. **F16:** export validateCommunityId from existing validators using record(value, ['community_id']) and uuid(). Wire getCommunityAdminContext.validator(validateCommunityId). Test null/array/missing/bad UUID/extra keys rejection before client access; inherited-only community_id rejected through record's own-entry copy; valid uppercase UUID accepted. Verify getClaims/no-store + live is_community_admin denial prevents communities SELECT, and exact safe SELECT on success. Existing inline behavior mostly correct; direct validator export/own-property regression provides meaningful refactor oracle.
+   3. **F19/F22:** members.tsx becomes Outlet-only layout with no roster loader/pathname branching. New members.index.tsx owns current active roster loader (getCommunityAdminContext first, then search status active offset0 limit50) and CommunityAdminScreen screen=members. Parent admin guard and leaf guards remain; detail still fetches scoped membership ID only. Generate routeTree via normal build, never hand edit generated tree. Test actual imported Route.options.loader with mocked server boundaries for each data leaf; denied getCommunityAdminContext rejects before roster/venues/audit/member reads, success receives correct params/order and counts. Add in-memory TanStack router built from imported generated route tree to assert actual protected/admin/members/index/detail parent relationships, root admin redirect, member-detail navigation not invoking roster, trailing-slash index handling, guest/incomplete guard redirects, nonadmin failure. Mock unrelated root/auth rendering only, not createFileRoute into source-text facsimiles. Keep test file .test.ts; use createElement if rendering required, avoiding extension churn. No source-string substitute.
+   4. **F20:** use discriminated screen props requiring members for requests/members, scoped member + membershipId for detail, venues for venues, audit for audit, community for settings. Move DTOs to existing admin.types.ts using generated Database and nullable member contract. CommunityAdmin.tsx keeps public shell/loading/denied/entries/screen exports for routes/dashboard/test compatibility. CommunityAdminViews.tsx exports dispatcher and owns separate RequestsView/MembersView/MemberView/SettingsView/VenuesView/AuditView functions; no hooks shared across unrelated screens. Common frame/mutation helpers remain feature-local in same module, no store/barrel. Community identity changes remount view; screen changes select distinct component type. Update test mount helper to supply only screen-appropriate required fixtures.
+   5. Search results carry loader source reference plus query/status; pending requests carry generation/source tokens. When members loader source changes, discard appended results, invalidate old request generation, preserve same-community search/filter input and refetch current filter if needed; never overwrite a newer filter. Audit append state similarly tied to audit loader source, paging starts from fresh rows, old completions ignored, hasMore recalculated. Request/venue appended-state reset and mutation invalidation retained from current implementation. Settings draft should remain stable for same-community invalidation unless explicit successful save, while community identity change resets it. Avoid keying whole screen on every loader object: would lose search focus/drafts and successful status. No unsafe casts masking invalid screen props.
+   6. **F13:** replace inline demote/remove confirmation with feature-local Base UI AlertDialog flow. Existing Button supports ref/render props through Base Button. Trigger is correctly wired to dialog; accessible title/description use existing confirm translation; opening moves focus to safe Cancel action; focus trapped, Escape/Cancel restores trigger, Confirm closes once and calls mutation once. Trigger absent/disabled after successful removal/demotion or permission loss: focus stable screen heading/dashboard exit, not disconnected element. Failure permits retry with focus restoration. Tokenized dialog/backdrop/controls styles, ≥44px hit targets, 320px translated text wrap. No modal opened in static visual baseline screenshots. Keyboard tests: Enter open, Tab/Shift-Tab containment, Escape/Cancel restore, confirm-only mutation, detached-trigger fallback, error/final-admin path. Update existing status-based confirmation test to assert alertdialog semantics.
+   7. **F14:** extend CommunityAdminDenied to accept router error-component reset callback. Generic transient loader error renders localized Retry plus dashboard link; NOT_COMMUNITY_ADMIN has dashboard exit but no retry; definitive missing member likewise no pointless retry. Retry awaits router.invalidate then reset/remount error boundary according to installed TanStack API; guard busy/double click, retain generic error on failed retry. Do not auto-retry write RPCs, permission denials, or refresh secrets from unauthorized loaders. Component tests cover all three locales and exact retry call; executable route/browser test temporarily fails initial loader then recovers on retry. Do not show previous authorized roster while denied.
+   8. **F17:** retain lineHeight:1 only with explicit adjacent documented exception: decorative aria-hidden chevron, unitless single-em glyph centering, 44px hit box independent of line-height, existing tight 1.1/body 1.5 are text-leading tokens not equivalent icon metric. Smallest acceptable finding resolution permits documented exception; no new token needed for one icon. Browser probe verifies chevron centering and back-link 44px hit area unchanged. If review insists no exception, use existing tight token and remeasure geometry before acceptance; never invent token literal silently.
+   9. **F15:** separate stable 320px locale matrix from long mutation journey. Parameterize six destinations × three locales (18 identifiable cases), fixtures created independently or scoped read-only per test worker. Include member detail populated by scoped ID, requests with pending row, venues and audit populated, settings details expanded where relevant. Assert locale heading, no document or inner-main horizontal overflow, visible labels, all active interactive controls ≥44px hit region, nav/action nonoverlap, keyboard reachable actions. Scroll long content to assert bottom nav never permanently obscures actions. Keep existing 390px six-source comparison suite and budgets unchanged. Any narrow-screen CSS repair must be responsive only; do not alter measured 390px structure without review.
+   10. **F18:** create private community with unique confidential sentinels: roster display names/IDs, community description/settings sentinel, private venue name/address, audit/entity IDs. Guest, active nonadmin, pending/inactive member and outsider directly visit all admin destinations, including scoped detail. Collect initial HTML via response.text and actual relevant loader/server-function response bodies during navigation/retry; assert sentinel absence in raw response including serialized/dehydrated payload and DOM. Exclude fixture-setup RPC traffic from collection. Requested community/membership IDs appear legitimately in URL/router params: do not claim their URL occurrence alone leaks payload; choose additional confidential IDs/fields not in requested path. Successful owner path must see sentinels, proving fixture exists. Keep direct-RLS security tests as backend complement; redirect/heading alone is not confidentiality evidence.
+   11. **F21:** extraction test beforeAll executes and awaits pnpm build successfully with bounded hook timeout (e.g. 120s) before enumerating dist/server/assets. Inspect build artifacts only after that hook; nonzero build status fails suite, no stale fallback. Assert fresh artifact mtime consistent with hook start (filesystem timestamp precision considered) plus existing one-module/six-distinct-transport-ID contract. Standalone test must succeed with dist absent and replace stale output; add negative fixture/mocked build-failure check showing stale artifact cannot produce a passing extraction assertion. Keep build stdout/stderr available on failure, no secret env logging. Simplest self-contained build hook may duplicate top-level complete-check build: accepted correctness cost, no separate manifest/timestamp service. Prevent parallel production-build consumers in focused execution; do not run Playwright build concurrently with extraction. No package script changes needed.
+   12. Run Unit 4 gate, six-screen visual suite and 18-case matrix, then compare refactor characterization tests. Only after all are green mark F13–F22 addressed. Keep all six module-level createServerFn action exports unchanged so extraction and browser RPC routing remain stable.
+
+   **Red→green checks:** focus transfer/restore and recovery fail old UI; deferred old-source search/audit tests fail current source-unbound state; detail no-roster count fails old members layout; inherited-ID validator test fails inline convention; raw confidential-sentinel oracle rejects supplied leaked body; stale/failed-build oracle cannot pass. All screen/locale permutations add coverage, not fabricated baseline failures. Document-only icon exception validated by geometry rather than source-string tests.
+
+   **Fast gate:** pnpm typecheck && pnpm lint && pnpm exec vitest run test/community.admin.functions.test.ts test/community.admin-ui.test.tsx test/community.admin-routes.test.ts test/community.admin-extraction.test.ts && pnpm exec playwright test e2e/community-admin.spec.ts. Build first during route addition to generate routeTree before typecheck; extraction hook still independently builds. Re-run existing test/community.admin.integration.test.ts and community.column-isolation.integration.test.ts against loopback DB to catch security drift.
+
+   **Risk/mitigation:** F20 highest-risk unit: staged internal checkpoints, no server transport/domain behavior change, preserve public entry exports, run existing UI tests after each moved view before introducing source reset logic. New required props may expose tests passing meaningless fixtures; fix fixtures rather than weakening discriminated types. Same-community source refresh must invalidate stale async work without resetting search focus. Recovery must reset correct router boundary; verify installed API in real router test. No screenshot baseline regeneration. Rollback refactor locally to last unit commit if characterization fails; isolate and reapply smallest view split, not expanded generic state abstraction. Intended commit: refactor: isolate admin views and harden accessible recovery tests.
+
+6. **Epic final gate / delivery handoff.** No commands performed by planner. Implementation parent, after four ordered units, runs affected fast gates and format:check; final full pnpm complete-check must pass with unchanged coverage thresholds and no source changes caused by gate. User requests full gate once before push through pre-push hook: do not additionally run complete-check after every unit; per-unit AC is satisfied by final full gate plus recorded focused gates. Current complete-check runs build → knip → typecheck → lint → format:check → covered Vitest → Playwright; extraction's fresh build hook and Playwright's own build may run again inside that one invocation. Treat those as internal build work, not duplicate full gates. Ensure generators already stable and fresh preview used before gate; inspect working tree afterward. Parent handles authorized commits/push/one PR to main, Copilot review request and Linear tracking. No Linear identifiers in commit messages or PR title/body; internal issue references remain in this plan. Plan included with Unit 1; exactly four commits, not separate planning commit. Commit examples above convey intent without identifiers.
+
+## Validation
+
+- Success criteria:
+  - **PAF-34 AC (verbatim):** F7 integration suite can run any test by name filter without undefined actors, mutable scenarios isolated · F8 an inactive-only former member is exercised through the privacy/mutation matrix · F9 audit rows identify which fields changed for community and venue updates without leaking sensitive data · pnpm complete-check passes.
+  - **PAF-38 AC (verbatim):** expired-token fixture timing-robust (no sub-second margin) · PAF-29 plan reflects deferred issuance scope · closed-history rejoin and visibility-flip rejection covered by integration tests · pnpm complete-check passes. Qualification: closed-history coverage follows current denied-self-rejoin + authorized-reactivation policy; original successful self-rejoin interpretation requires parent acceptance of alternative, not silent completion.
+  - **PAF-40 AC (verbatim):** F6 SSR locale asserted against raw response HTML independently of hydration · F7 visual comparator validates image dimensions · F8 search/retry expose translated pending status + aria-busy · F9 optional-field labels remain visible after entry · F10 masked card content has exact structural probes · pnpm complete-check passes.
+  - **PAF-43 AC (verbatim):** F13–F22 addressed as described · pnpm complete-check passes.
+  - Four ordered unit commits, one branch/PR, main base; only approved source/test/docs changes, no secrets/service-role browser code, no RLS widening, no lowered coverage or expanded screenshot budgets. Gate itself does not modify tracked source.
+- Checkpoints:
+  - **Step 1 / before implementation:** parent accepts F4 alternative; branch/base/backend/migration prerequisites verified; record unchanged PNG hashes/caps; source read-only planning complete. Modern-web-guidance skill loaded, but network/package execution prohibited in planning; implementation may consult guidance under its own permissions.
+  - **Step 2 / after fixtures:** every state-dependent integration test selected alone executes successfully; AC3 then matrix proves closed actor isolation; fixture-local audit assertions no inherited count. After migration: forward upgrade and fresh replay emit exactly safe details; archive/member/invitation evidence and RLS/ACL denial retained.
+  - **Step 3 / expiry/history:** delayed seed >1.2s never violates lifecycle CHECK; returned expiry drives bounded wait; repeated real-JWT expiry and policy/visibility tests pass, tokens unconsumed on rejection; old plan reconciled in every active issuance clause.
+  - **Step 4 / onboarding:** negative SSR/dimension/geometry oracles detect defects; real browser search/retry pending status + aria-busy observed, clears on settle; filled labels visible at 320px all locales; original focus/history/state tests and pinned-reference caps pass.
+  - **Step 5 / admin internal gates:** validator boundary green before route changes; executable route tests prove parent/leaf/denial ordering and no detail roster read; typed-view move retains existing behavior before source-epoch fixes; keyboard confirmation and retry recover correctly; all 18 locale/screens pass without horizontal overflow; confidential sentinels absent from unauthorized raw/serialized/browser payloads; extraction freshly compiles six unique identities.
+  - **Step 6 / release:** final hook complete-check passes and leaves tracked source unchanged; source hashes/baseline bytes unchanged; review all elevated-risk deltas. No hosted deployment/migration performed by this planning session.
+  - **Open question / approval item:** Accept PAF-38 F4 alternative aligned with current PJ008/admin reactivation policy? Code resolves behavior, but only parent can accept revised historical AC interpretation. No other requirements questions unresolved; actual CLI migration timestamp and renderer measurements are execution facts to record, not guessed inputs.
+
+Plan absolute path: /Users/trystan2k/Documents/Thiago/Repos/padel-friend/docs/plan/Plan PAF-50 PAF-2 follow-up — Tier 3: test and UI polish.md
diff --git a/e2e/community-admin.spec.ts b/e2e/community-admin.spec.ts
index 7eccaec..205ea22 100644
--- a/e2e/community-admin.spec.ts
+++ b/e2e/community-admin.spec.ts
@@ -6,6 +6,7 @@ import { expect, test, type Locator, type Page } from '@playwright/test';
 import { waitForHydratedPage } from './auth-helpers';

 type Copy = {
+  language: string;
   auth: { loginEmailLabel: string; loginPasswordLabel: string; loginSubmit: string };
   onboarding: {
     name: string;
@@ -15,6 +16,7 @@ type Copy = {
     save: string;
   };
   communityAdmin: {
+    backToDashboard: string;
     title: Record<string, string>;
     navigation: string;
     accessDeniedTitle: string;
@@ -127,6 +129,30 @@ async function signIn(page: Page, actor: Actor) {
   await waitForHydratedPage(page);
 }

+async function assertNoConfidentialPayload(page: Page, paths: string[], sentinels: string[]) {
+  const observed: string[] = [];
+  const collect = async (response: import('@playwright/test').Response) => {
+    try {
+      observed.push(await response.text());
+    } catch {
+      // Browser may cancel a response while navigating; successful payloads remain collected.
+    }
+  };
+  page.on('response', collect);
+  for (const path of paths) {
+    const documentResponse = await page.goto(path);
+    if (documentResponse) observed.push(await documentResponse.text());
+    await page.waitForLoadState('networkidle');
+    await waitForHydratedPage(page);
+    observed.push(await page.locator('body').innerText());
+  }
+  page.off('response', collect);
+  const payload = observed.join('\n');
+  for (const sentinel of sentinels) {
+    expect(payload, `confidential sentinel leaked: ${sentinel}`).not.toContain(sentinel);
+  }
+}
+
 async function visualDiff(
   page: Page,
   file: keyof typeof references,
@@ -313,6 +339,23 @@ async function memberControlsGeometry(page: Page) {
   expect(actions!.height).toBeGreaterThanOrEqual(44);
 }

+async function backLinkGeometry(page: Page) {
+  const link = page.getByRole('link', { name: en.communityAdmin.backToDashboard });
+  const linkBox = await link.boundingBox();
+  expect(linkBox).not.toBeNull();
+  expect(linkBox!.width).toBeGreaterThanOrEqual(44);
+  expect(linkBox!.height).toBeGreaterThanOrEqual(44);
+  const icon = link.locator('[aria-hidden="true"]');
+  const iconBox = await icon.boundingBox();
+  expect(iconBox).not.toBeNull();
+  expect(
+    Math.abs(iconBox!.x + iconBox!.width / 2 - (linkBox!.x + linkBox!.width / 2))
+  ).toBeLessThanOrEqual(1);
+  expect(
+    Math.abs(iconBox!.y + iconBox!.height / 2 - (linkBox!.y + linkBox!.height / 2))
+  ).toBeLessThanOrEqual(1);
+}
+
 async function settingsGeometry(page: Page) {
   // N18Mu4 settings rows: visibility y72, public control y126, join control y180, each 354×44.
   const offset = await mainOffset(page);
@@ -478,6 +521,7 @@ test('real admin requests, membership, settings, venues and audit stay protected
   await waitForHydratedPage(page);
   await page.getByRole('heading', { name: en.communityAdmin.title.members }).waitFor();
   await geometry(page);
+  await backLinkGeometry(page);
   await memberCardGeometry(page);
   await assertLinkHitArea(page.getByRole('link', { name: 'Backup Admin' }));
   // Mask fixture identity/metrics, role badges, avatars and the unsupported invitation copy only;
@@ -631,3 +675,278 @@ test('real admin requests, membership, settings, venues and audit stay protected
   ).toBeVisible();
   expect(requestRow.status).toBe('active');
 });
+
+test('unauthorized community admin routes never disclose confidential fixture payloads', async ({
+  browser
+}) => {
+  test.setTimeout(120_000);
+  const suffix = crypto.randomUUID();
+  const ownerName = `Private Owner ${suffix.slice(0, 8)}`;
+  const activeName = `Private Active ${suffix.slice(0, 8)}`;
+  const pendingName = `Private Pending ${suffix.slice(0, 8)}`;
+  const owner = await createActor(ownerName);
+  const active = await createActor(activeName);
+  const pending = await createActor(pendingName);
+  const outsider = await createActor(`Private Outsider ${suffix.slice(0, 8)}`);
+  const confidential = {
+    description: `PRIVATE_DESCRIPTION_${suffix}`,
+    setting: `PRIVATE_SETTING_${suffix}`,
+    venue: `PRIVATE_VENUE_${suffix}`,
+    address: `PRIVATE_ADDRESS_${suffix}`,
+    audit: `PRIVATE_AUDIT_${suffix}`
+  };
+  const community = await owner.client.rpc('create_community', {
+    p_name: `Private ${suffix.slice(0, 8)}`,
+    p_visibility: 'private',
+    p_description: confidential.description,
+    p_join_policy: 'admin_approval'
+  });
+  if (community.error || typeof community.data !== 'string')
+    throw community.error ?? new Error('Private community fixture creation failed');
+  const communityId = community.data;
+  const ownerCommunity = await owner.client
+    .from('communities')
+    .update({ settings: { confidential: confidential.setting } })
+    .eq('id', communityId);
+  if (ownerCommunity.error) throw ownerCommunity.error;
+  const activeMembership = await owner.client
+    .from('community_members')
+    .insert({ community_id: communityId, user_id: active.id, role: 'member', status: 'active' })
+    .select('id')
+    .single();
+  if (activeMembership.error) throw activeMembership.error;
+  const pendingMembership = await owner.client
+    .from('community_members')
+    .insert({ community_id: communityId, user_id: pending.id, role: 'member', status: 'pending' })
+    .select('id')
+    .single();
+  if (pendingMembership.error) throw pendingMembership.error;
+  const venue = await owner.client
+    .from('community_venues')
+    .insert({
+      community_id: communityId,
+      name: confidential.venue,
+      address: confidential.address,
+      maps_url: 'https://maps.example.test/private'
+    })
+    .select('id')
+    .single();
+  if (venue.error) throw venue.error;
+  const auditRows = await owner.client
+    .from('community_audit_log')
+    .select('id, entity_id')
+    .eq('community_id', communityId);
+  if (auditRows.error || !auditRows.data?.length)
+    throw auditRows.error ?? new Error('Expected private community audit fixture');
+  const ownerRoster = await owner.client.rpc('search_community_members', {
+    p_community_id: communityId,
+    p_query: '',
+    p_offset: 0,
+    p_limit: 50
+  });
+  if (
+    ownerRoster.error ||
+    !ownerRoster.data?.some((row: { user_id: string }) => row.user_id === active.id)
+  )
+    throw ownerRoster.error ?? new Error('Owner could not observe confidential roster fixture');
+
+  const base = `/community/${communityId}/admin`;
+  const destinations = [
+    `${base}/requests`,
+    `${base}/members`,
+    `${base}/members/${activeMembership.data.id}`,
+    `${base}/settings`,
+    `${base}/venues`,
+    `${base}/audit`
+  ];
+  const sentinels = [
+    activeName,
+    pendingName,
+    confidential.description,
+    confidential.setting,
+    confidential.venue,
+    confidential.address,
+    pendingMembership.data.id,
+    venue.data.id,
+    ...auditRows.data
+      .flatMap((row: { id: string; entity_id: string }) => [row.id, row.entity_id])
+      .filter((id: string) => id !== communityId && id !== activeMembership.data.id)
+  ];
+
+  // Owner must be able to observe fixture values before the same payloads are tested against denials.
+  const ownerContext = await browser.newContext();
+  const ownerPage = await ownerContext.newPage();
+  await signIn(ownerPage, owner);
+  await ownerPage.goto(`${base}/venues`);
+  await waitForHydratedPage(ownerPage);
+  await expect(ownerPage.getByRole('heading', { name: confidential.venue })).toBeVisible();
+  await ownerPage.goto(`${base}/members`);
+  await waitForHydratedPage(ownerPage);
+  await expect(ownerPage.getByText(activeName)).toBeVisible();
+  await ownerPage.goto(`${base}/settings`);
+  await waitForHydratedPage(ownerPage);
+  await ownerPage.getByText(en.communityAdmin.settings.details).click();
+  await expect(ownerPage.locator('#community-admin-description')).toHaveValue(
+    confidential.description
+  );
+  await ownerContext.close();
+
+  const guestContext = await browser.newContext();
+  const guestPage = await guestContext.newPage();
+  await assertNoConfidentialPayload(guestPage, destinations, sentinels);
+  await guestContext.close();
+  for (const actor of [active, pending, outsider]) {
+    const context = await browser.newContext();
+    const page = await context.newPage();
+    await signIn(page, actor);
+    await assertNoConfidentialPayload(page, destinations, sentinels);
+    await context.close();
+  }
+});
+
+const narrowDestinations = [
+  'requests',
+  'members',
+  'member',
+  'settings',
+  'venues',
+  'audit'
+] as const;
+const narrowLocales = [
+  ['en', en],
+  ['pt-BR', pt],
+  ['es', es]
+] as const;
+
+test.describe('community admin 320px locale matrix', () => {
+  test.use({ viewport: { width: 320, height: 844 } });
+
+  for (const destination of narrowDestinations) {
+    for (const [locale] of narrowLocales) {
+      test(`${destination} heading and controls fit at 320px (${locale})`, async ({ page }) => {
+        test.setTimeout(120_000);
+        const owner = await createActor(`Narrow ${destination} ${locale}`);
+        const applicant = await createActor(`Narrow applicant ${destination} ${locale}`);
+        const requester = await createActor(`Narrow requester ${destination} ${locale}`);
+        const created = await owner.client.rpc('create_community', {
+          p_name: `Narrow ${crypto.randomUUID().slice(0, 6)}`,
+          p_visibility: 'public',
+          p_join_policy: 'admin_approval'
+        });
+        if (created.error || typeof created.data !== 'string')
+          throw created.error ?? new Error('Narrow-screen community fixture creation failed');
+        const communityId = created.data;
+        const base = `/community/${communityId}/admin`;
+        const active = await owner.client
+          .from('community_members')
+          .insert({
+            community_id: communityId,
+            user_id: applicant.id,
+            role: 'member',
+            status: 'active'
+          })
+          .select('id')
+          .single();
+        if (active.error) throw active.error;
+        const pending = await owner.client
+          .from('community_members')
+          .insert({
+            community_id: communityId,
+            user_id: requester.id,
+            role: 'member',
+            status: 'pending'
+          })
+          .select('id')
+          .single();
+        if (pending.error) throw pending.error;
+        const venue = await owner.client.from('community_venues').insert({
+          community_id: communityId,
+          name: 'Narrow court',
+          address: 'Madrid',
+          maps_url: 'https://maps.example.test/narrow'
+        });
+        if (venue.error) throw venue.error;
+
+        await signIn(page, owner);
+        await page.locator('#locale').selectOption(locale);
+        await expect(page.locator('html')).toHaveAttribute('lang', locale);
+        const path =
+          destination === 'member' ? `${base}/members/${active.data.id}` : `${base}/${destination}`;
+        await page.goto(path);
+        await waitForHydratedPage(page);
+        const localeCopy = locale === 'pt-BR' ? pt : locale === 'es' ? es : en;
+        const localeControl = page.locator('#locale');
+        await expect(localeControl).toBeVisible();
+        await expect(localeControl).toHaveAccessibleName(localeCopy.language);
+        const titleKey = destination === 'member' ? 'member' : destination;
+        const screenHeading = page.getByRole('heading', {
+          name: localeCopy.communityAdmin.title[titleKey],
+          exact: true
+        });
+        await expect(screenHeading).toHaveCount(1);
+        await expect(screenHeading).toBeVisible();
+        if (destination === 'settings') {
+          await page.getByText(localeCopy.communityAdmin.settings.details).click();
+          await expect(page.locator('#community-admin-description')).toBeVisible();
+        }
+        if (destination === 'requests')
+          await expect(
+            page.getByText(`Narrow requester ${destination} ${locale}`, { exact: true })
+          ).toBeVisible();
+        if (destination === 'venues')
+          await expect(page.getByRole('heading', { name: 'Narrow court' })).toBeVisible();
+        if (destination === 'audit')
+          await expect(page.getByTestId('community-audit-event').first()).toBeVisible();
+
+        const dimensions = await page.evaluate(() => ({
+          document: document.documentElement.scrollWidth,
+          main: document.querySelector('main')?.scrollWidth ?? 0,
+          viewport: document.documentElement.clientWidth
+        }));
+        expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
+        expect(dimensions.main).toBeLessThanOrEqual(dimensions.viewport);
+        const adminNavigation = page.getByRole('navigation', {
+          name: localeCopy.communityAdmin.navigation
+        });
+        const contentControls = page.locator(
+          'main button:visible:not(nav button), main a:visible:not(nav a), main input:visible:not(nav input), main select:visible:not(nav select), main textarea:visible:not(nav textarea)'
+        );
+        const navigationControls = adminNavigation.locator(
+          'button:visible, a:visible, input:visible, select:visible, textarea:visible'
+        );
+        const controls = contentControls.or(navigationControls);
+        for (const control of await controls.all()) {
+          const box = await control.boundingBox();
+          expect(box, 'visible interactive control must have a hit region').not.toBeNull();
+          const accessibleName =
+            (await control.getAttribute('aria-label')) ?? (await control.innerText());
+          expect(box!.width, `interactive control ${accessibleName}`).toBeGreaterThanOrEqual(44);
+          expect(box!.height, `interactive control ${accessibleName}`).toBeGreaterThanOrEqual(44);
+        }
+        const nav = adminNavigation;
+        const navBox = await nav.boundingBox();
+        expect(navBox).not.toBeNull();
+        for (const control of await contentControls.all()) {
+          await control.scrollIntoViewIfNeeded();
+          const box = await control.boundingBox();
+          expect(box, 'scrolled interactive control must have a hit region').not.toBeNull();
+          const overlapsBottomNav =
+            box!.y < navBox!.y + navBox!.height && box!.y + box!.height > navBox!.y;
+          expect(
+            overlapsBottomNav,
+            'scrolled interactive control must not be obscured by bottom navigation'
+          ).toBe(false);
+        }
+        await page.keyboard.press('Tab');
+        await expect(page.locator(':focus')).toHaveCount(1);
+        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
+        await expect(nav).toBeVisible();
+        const lastControl = contentControls.last();
+        await lastControl.scrollIntoViewIfNeeded();
+        const finalControl = await lastControl.boundingBox();
+        expect(finalControl, 'last interactive action must remain visible').not.toBeNull();
+        expect(finalControl!.y + finalControl!.height).toBeLessThanOrEqual(navBox!.y);
+      });
+    }
+  }
+});
diff --git a/e2e/community-onboarding.spec.ts b/e2e/community-onboarding.spec.ts
index 12e7e35..8dc3ee3 100644
--- a/e2e/community-onboarding.spec.ts
+++ b/e2e/community-onboarding.spec.ts
@@ -1,6 +1,6 @@
 import { createHash } from 'node:crypto';
 import { readFileSync } from 'node:fs';
-import { expect, test, type Locator, type Page } from '@playwright/test';
+import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
 import { createClient } from '@supabase/supabase-js';
 import { submitAndWaitForAuthDestination, waitForHydratedPage } from './auth-helpers';

@@ -33,7 +33,10 @@ type LocaleCopy = {
     created: string;
     finish: string;
     emptySearch: string;
+    searchLoading: string;
+    loadFailed: string;
     searchLabel: string;
+    descriptionLabel: string;
     openJoin: string;
     join: string;
     requestToJoin: string;
@@ -118,6 +121,77 @@ async function geometry(
   }
 }

+function assertDecodedImage(
+  expected: { width: number; height: number; bytes: number },
+  actual: { width: number; height: number; bytes: number },
+  endY: number,
+  masks: [number, number, number, number][]
+) {
+  expect(expected.width).toBe(390);
+  expect(expected.height).toBe(844);
+  expect(actual.width).toBe(390);
+  expect(actual.height).toBe(844);
+  expect(expected).toEqual(actual);
+  expect(expected.bytes).toBe(expected.width * expected.height * 4);
+  expect(actual.bytes).toBe(actual.width * actual.height * 4);
+  expect(endY).toBeGreaterThanOrEqual(0);
+  expect(endY).toBeLessThanOrEqual(expected.height);
+  for (const [left, top, width, height] of masks) {
+    expect([left, top, width, height].every(Number.isInteger)).toBe(true);
+    expect(left).toBeGreaterThanOrEqual(0);
+    expect(top).toBeGreaterThanOrEqual(0);
+    expect(width).toBeGreaterThan(0);
+    expect(height).toBeGreaterThan(0);
+    expect(left + width).toBeLessThanOrEqual(expected.width);
+    expect(top + height).toBeLessThanOrEqual(endY);
+  }
+}
+
+async function assertRawLocale(
+  page: Page,
+  response: Awaited<ReturnType<Page['goto']>>,
+  locale: string,
+  title: string
+) {
+  expect(response, 'navigation must return an HTML response').not.toBeNull();
+  expect(response!.ok()).toBeTruthy();
+  expect(response!.headers()['content-type']).toContain('text/html');
+  await assertRawMarkupLocale(page, await response!.text(), locale, title);
+}
+
+async function assertRawMarkupLocale(page: Page, markup: string, locale: string, title: string) {
+  const actual = await page.evaluate((source) => {
+    const detached = new DOMParser().parseFromString(source, 'text/html');
+    return {
+      lang: detached.documentElement.lang,
+      heading: detached.querySelector('h1')?.textContent?.trim()
+    };
+  }, markup);
+  expect(actual.lang).toBe(locale);
+  expect(actual.heading).toBe(title);
+}
+
+async function typography(
+  locator: Locator,
+  expected: { family: string; size: string; weight: string; lineHeight: string; color: string }
+) {
+  const styles = await locator.evaluate((element) => {
+    const style = getComputedStyle(element);
+    return {
+      family: style.fontFamily,
+      size: style.fontSize,
+      weight: style.fontWeight,
+      lineHeight: style.lineHeight,
+      color: style.color
+    };
+  });
+  expect(styles.family).toContain(expected.family);
+  expect(styles.size).toBe(expected.size);
+  expect(styles.weight).toBe(expected.weight);
+  expect(styles.lineHeight).toBe(expected.lineHeight);
+  expect(styles.color).toBe(expected.color);
+}
+
 // Only fixture-dependent glyphs are excluded: search text, two names, city/policy
 // metadata and Pencil's unavailable member/level examples. Card edges and both
 // card action labels remain compared. Source PNG and baseline bytes stay untouched.
@@ -125,7 +199,9 @@ async function visualDiff(
   page: Page,
   name: keyof typeof references,
   masks: [number, number, number, number][],
-  endY = 844
+  endY = 844,
+  testInfo?: TestInfo,
+  region = 'full'
 ) {
   const source = readFileSync(new URL(`./references/paf-30/${name}`, import.meta.url));
   const baseline = readFileSync(
@@ -134,7 +210,7 @@ async function visualDiff(
   expect(createHash('sha256').update(source).digest('hex')).toBe(references[name]);
   expect(baseline).toEqual(source);
   const actual = await page.screenshot({ animations: 'disabled', caret: 'hide' });
-  const different = await page.evaluate(
+  const comparison = await page.evaluate(
     async ({ expected, received, masks: maskAreas, endY: lastRow }) => {
       const decode = async (base64: string) => {
         const image = new Image();
@@ -145,12 +221,74 @@ async function visualDiff(
         canvas.height = image.height;
         const context = canvas.getContext('2d')!;
         context.drawImage(image, 0, 0);
-        return context.getImageData(0, 0, image.width, image.height).data;
+        return {
+          width: image.width,
+          height: image.height,
+          pixels: context.getImageData(0, 0, image.width, image.height).data
+        };
       };
       const [a, b] = await Promise.all([decode(expected), decode(received)]);
+      const dimensionsMatch = a.width === b.width && a.height === b.height;
+      if (
+        !dimensionsMatch ||
+        a.width <= 0 ||
+        a.height <= 0 ||
+        b.width <= 0 ||
+        b.height <= 0 ||
+        a.pixels.length !== a.width * a.height * 4 ||
+        b.pixels.length !== b.width * b.height * 4
+      )
+        return {
+          expected: { width: a.width, height: a.height, bytes: a.pixels.length },
+          actual: { width: b.width, height: b.height, bytes: b.pixels.length },
+          count: null,
+          diff: null,
+          error: 'PNG dimensions or RGBA buffer length mismatch'
+        };
+      if (a.width !== 390 || a.height !== 844 || b.width !== 390 || b.height !== 844)
+        return {
+          expected: { width: a.width, height: a.height, bytes: a.pixels.length },
+          actual: { width: b.width, height: b.height, bytes: b.pixels.length },
+          count: null,
+          diff: null,
+          error: 'PNG must be exactly 390×844'
+        };
+      if (!Number.isInteger(lastRow) || lastRow < 0 || lastRow > a.height)
+        return {
+          expected: { width: a.width, height: a.height, bytes: a.pixels.length },
+          actual: { width: b.width, height: b.height, bytes: b.pixels.length },
+          count: null,
+          diff: null,
+          error: 'endY outside decoded image'
+        };
+      for (const [left, top, width, height] of maskAreas) {
+        if (
+          ![left, top, width, height].every(Number.isInteger) ||
+          left < 0 ||
+          top < 0 ||
+          width <= 0 ||
+          height <= 0 ||
+          left + width > a.width ||
+          top + height > a.height ||
+          top + height > lastRow
+        )
+          return {
+            expected: { width: a.width, height: a.height, bytes: a.pixels.length },
+            actual: { width: b.width, height: b.height, bytes: b.pixels.length },
+            count: null,
+            diff: null,
+            error: 'Mask region outside compared image bounds'
+          };
+      }
+      const canvas = document.createElement('canvas');
+      canvas.width = a.width;
+      canvas.height = a.height;
+      const context = canvas.getContext('2d')!;
+      const output = context.createImageData(a.width, a.height);
+      output.data.set(b.pixels);
       let count = 0;
       for (let y = 0; y < lastRow; y++)
-        for (let x = 0; x < 390; x++) {
+        for (let x = 0; x < a.width; x++) {
           if (
             maskAreas.some(
               ([left, top, width, height]) =>
@@ -158,27 +296,56 @@ async function visualDiff(
             )
           )
             continue;
-          const i = (y * 390 + x) * 4;
-          const r = a[i]! - b[i]!,
-            g = a[i + 1]! - b[i + 1]!,
-            blue = a[i + 2]! - b[i + 2]!;
+          const i = (y * a.width + x) * 4;
+          const r = a.pixels[i]! - b.pixels[i]!,
+            g = a.pixels[i + 1]! - b.pixels[i + 1]!,
+            blue = a.pixels[i + 2]! - b.pixels[i + 2]!;
           const deltaY = 0.29889531 * r + 0.58662247 * g + 0.11448223 * blue;
           const deltaI = 0.59597799 * r - 0.2741761 * g - 0.32180178 * blue;
           const deltaQ = 0.21147017 * r - 0.52261711 * g + 0.31114694 * blue;
-          if (0.5053 * deltaY ** 2 + 0.299 * deltaI ** 2 + 0.1957 * deltaQ ** 2 > 35215 * 0.1 ** 2)
-            count++;
+          const different =
+            0.5053 * deltaY ** 2 + 0.299 * deltaI ** 2 + 0.1957 * deltaQ ** 2 > 35215 * 0.1 ** 2;
+          if (different) count++;
+          output.data[i] = different ? 255 : b.pixels[i]!;
+          output.data[i + 1] = different ? 0 : b.pixels[i + 1]!;
+          output.data[i + 2] = different ? 0 : b.pixels[i + 2]!;
+          output.data[i + 3] = 255;
         }
-      return count;
+      context.putImageData(output, 0, 0);
+      return {
+        expected: { width: a.width, height: a.height, bytes: a.pixels.length },
+        actual: { width: b.width, height: b.height, bytes: b.pixels.length },
+        count,
+        diff: canvas.toDataURL('image/png').split(',')[1]!,
+        error: null
+      };
     },
     { expected: source.toString('base64'), received: actual.toString('base64'), masks, endY }
   );
+  await testInfo?.attach(`${name}-${region}-expected`, { body: source, contentType: 'image/png' });
+  await testInfo?.attach(`${name}-${region}-actual`, { body: actual, contentType: 'image/png' });
+  if (comparison.diff)
+    await testInfo?.attach(`${name}-${region}-diff`, {
+      body: Buffer.from(comparison.diff, 'base64'),
+      contentType: 'image/png'
+    });
+  else
+    await testInfo?.attach(`${name}-${region}-diff-unavailable`, {
+      body: comparison.error ?? 'Diff unavailable',
+      contentType: 'text/plain'
+    });
+  if (!comparison.error) assertDecodedImage(comparison.expected, comparison.actual, endY, masks);
+  expect(comparison.error, `visual comparator rejected ${name}: ${comparison.error}`).toBeNull();
+  expect(comparison.count).not.toBeNull();
   expect(
     readFileSync(new URL(`./community-onboarding.spec.ts-snapshots/${name}`, import.meta.url))
   ).toEqual(source);
-  return different;
+  return comparison.count!;
 }

-test('Pencil structure: discovery and create preserve exact CSS boxes', async ({ page }) => {
+test('Pencil structure: discovery and create preserve exact CSS boxes', async ({
+  page
+}, testInfo) => {
   await player(page);
   await page.evaluate(() => document.fonts.ready);
   await geometry(page.locator('main > div').first().locator('span').first(), {
@@ -230,7 +397,7 @@ test('Pencil structure: discovery and create preserve exact CSS boxes', async ({
     width: 354,
     height: 44
   });
-  const upper = await visualDiff(page, 'community-create.png', [], 448);
+  const upper = await visualDiff(page, 'community-create.png', [], 448, testInfo, 'upper-create');
   console.log(`JO4DC unaffected region: ${upper}/174720 (${((upper / 174720) * 100).toFixed(3)}%)`);
   // Cross-platform cap: macOS 12,611/174,720 = 7.218%; Linux CI 14,863/174,720 = 8.507%;
   // worse (Linux) residual + 0.15pp headroom. Residual is Pencil/Chromium glyph
@@ -238,7 +405,7 @@ test('Pencil structure: discovery and create preserve exact CSS boxes', async ({
   expect(upper / 174720).toBeLessThanOrEqual(0.0866);
 });

-test('create view compares against JO4DC Pencil reference', async ({ page }) => {
+test('create view compares against JO4DC Pencil reference', async ({ page }, testInfo) => {
   await player(page);
   await page.goto('/onboarding/community?view=create');
   await waitForHydratedPage(page);
@@ -258,7 +425,14 @@ test('create view compares against JO4DC Pencil reference', async ({ page }) =>
       animations: 'disabled',
       caret: 'hide'
     });
-    const different = await visualDiff(page, 'community-create.png', []);
+    const different = await visualDiff(
+      page,
+      'community-create.png',
+      [],
+      844,
+      testInfo,
+      'full-create'
+    );
     console.log(
       `JO4DC visual residual: ${different}/329160 (${((different / 329160) * 100).toFixed(3)}%)`
     );
@@ -273,7 +447,7 @@ test('create view compares against JO4DC Pencil reference', async ({ page }) =>

 test('discovery view compares card structure and actions against dSEX3 Pencil reference', async ({
   page
-}) => {
+}, testInfo) => {
   const email = await player(page);
   const city = `Visual${crypto.randomUUID().slice(0, 8)}`;
   const client = localClient();
@@ -295,7 +469,7 @@ test('discovery view compares card structure and actions against dSEX3 Pencil re
   await page.getByRole('searchbox', { name: en.communityOnboarding.searchLabel }).fill(city);
   await expect(page).toHaveURL(/q=Visual/);
   const cards = page
-    .locator('main > div:last-child > div')
+    .locator('main > div:last-child [aria-busy="false"] > div')
     .filter({ has: page.getByRole('heading', { level: 3 }) });
   await expect(cards).toHaveCount(2);
   await expect(
@@ -304,12 +478,42 @@ test('discovery view compares card structure and actions against dSEX3 Pencil re
   await page.evaluate(() => document.fonts.ready);
   await geometry(cards.nth(0), { x: 18, y: 240, width: 354, height: 142 });
   await geometry(cards.nth(1), { x: 18, y: 392, width: 354, height: 142 });
+  const firstTitle = cards.nth(0).getByRole('heading', { level: 3 });
+  const secondTitle = cards.nth(1).getByRole('heading', { level: 3 });
+  const firstMeta = cards.nth(0).locator('p');
+  const secondMeta = cards.nth(1).locator('p');
+  // Pencil dSEX3 source: content inset 14; name box 19px high; 7px vertical gap;
+  // metadata box 15px high. Current text block fills the 326px card content column.
+  await geometry(firstTitle, { x: 32, y: 254, width: 326, height: 19 });
+  await geometry(firstMeta, { x: 32, y: 280, width: 326, height: 15 });
+  await geometry(secondTitle, { x: 32, y: 406, width: 326, height: 19 });
+  await geometry(secondMeta, { x: 32, y: 432, width: 326, height: 15 });
+  for (const title of [firstTitle, secondTitle])
+    await typography(title, {
+      family: 'Manrope',
+      size: '14px',
+      weight: '700',
+      lineHeight: 'normal',
+      color: 'rgb(18, 37, 29)'
+    });
+  for (const meta of [firstMeta, secondMeta])
+    await typography(meta, {
+      family: 'Inter',
+      size: '12px',
+      weight: '400',
+      lineHeight: 'normal',
+      color: 'rgb(92, 107, 98)'
+    });
   await geometry(cards.nth(0).getByRole('button', { name: en.communityOnboarding.join }), {
     x: 32,
+    y: 324,
+    width: 326,
     height: 44
   });
   await geometry(cards.nth(1).getByRole('button', { name: en.communityOnboarding.requestToJoin }), {
     x: 32,
+    y: 476,
+    width: 326,
     height: 44
   });
   await geometry(page.getByRole('button', { name: en.communityOnboarding.createEntry }), {
@@ -324,11 +528,18 @@ test('discovery view compares card structure and actions against dSEX3 Pencil re
     width: 354,
     height: 44
   });
-  const different = await visualDiff(page, 'community-discovery.png', [
-    [30, 198, 310, 23],
-    [31, 252, 308, 65],
-    [31, 404, 308, 65]
-  ]);
+  const different = await visualDiff(
+    page,
+    'community-discovery.png',
+    [
+      [30, 198, 310, 23],
+      [31, 252, 308, 65],
+      [31, 404, 308, 65]
+    ],
+    844,
+    testInfo,
+    'discovery'
+  );
   console.log(
     `dSEX3 visual residual: ${different}/329160 (${((different / 329160) * 100).toFixed(3)}%)`
   );
@@ -351,6 +562,75 @@ test('live search keeps keyboard focus across debounce and server results', asyn
   await expect(input).toBeFocused();
 });

+test('search announces pending loader and settles after deterministic response release', async ({
+  page
+}) => {
+  await player(page);
+  let release!: () => void;
+  let signalRequest!: () => void;
+  const responseGate = new Promise<void>((resolve) => (release = resolve));
+  const requestSeen = new Promise<void>((resolve) => (signalRequest = resolve));
+  await page.route(
+    /\/_serverFn\/6cf6671334014b970362dc54c0cce26a91d4da36e41403af07a6c0cf2750fa7d(?:\?.*)?$/,
+    async (route) => {
+      signalRequest();
+      await responseGate;
+      await route.continue();
+    }
+  );
+  const input = page.getByRole('searchbox', { name: en.communityOnboarding.searchLabel });
+  await input.fill(`Pending${crypto.randomUUID().slice(0, 6)}`);
+  await requestSeen;
+  await expect(page.getByRole('status')).toHaveText(en.communityOnboarding.searchLoading);
+  await expect(page.locator('div[aria-busy="true"]')).toHaveCount(1);
+  expect(
+    await page.getByRole('status').evaluate((status) => status.closest('[aria-busy="true"]'))
+  ).toBeNull();
+  await expect(page.getByText(en.communityOnboarding.emptySearch)).toHaveCount(0);
+  await expect(input).toBeEnabled();
+  await expect(input).toBeFocused();
+  release();
+  await expect(page.locator('[aria-busy="false"]')).toHaveCount(1);
+  await expect(page.getByRole('status')).not.toHaveText(en.communityOnboarding.searchLoading);
+});
+
+test('retry reports pending, blocks duplicate invalidation, and recovers from one controlled failure', async ({
+  page
+}) => {
+  await player(page);
+  let calls = 0;
+  let release!: () => void;
+  let signalRetry!: () => void;
+  const retryGate = new Promise<void>((resolve) => (release = resolve));
+  const retrySeen = new Promise<void>((resolve) => (signalRetry = resolve));
+  await page.route(
+    /\/_serverFn\/6cf6671334014b970362dc54c0cce26a91d4da36e41403af07a6c0cf2750fa7d(?:\?.*)?$/,
+    async (route) => {
+      calls++;
+      if (calls === 1) {
+        await route.fulfill({ status: 500, body: 'controlled loader failure' });
+        return;
+      }
+      signalRetry();
+      await retryGate;
+      await route.continue();
+    }
+  );
+  const input = page.getByRole('searchbox', { name: en.communityOnboarding.searchLabel });
+  await input.fill(`Retry${crypto.randomUUID().slice(0, 6)}`);
+  await expect(page.getByRole('alert')).toHaveText(en.communityOnboarding.loadFailed);
+  const retry = page.getByRole('button', { name: en.communityOnboarding.retry });
+  await retry.click();
+  await retrySeen;
+  await expect(page.getByRole('status')).toHaveText(en.communityOnboarding.searchLoading);
+  await expect(page.locator('div[aria-busy="true"]')).toHaveCount(1);
+  await expect(retry).toBeDisabled();
+  release();
+  await expect(page.locator('[aria-busy="false"]')).toHaveCount(1);
+  await expect(page.getByRole('alert')).toHaveCount(0);
+  expect(calls).toBe(2);
+});
+
 test('successful create resets after browser Back and create re-entry', async ({ page }) => {
   await player(page);
   const search = page.getByRole('searchbox', { name: en.communityOnboarding.searchLabel });
@@ -440,13 +720,12 @@ test('SSR and hydration preserve locale across both views at 320px', async ({ pa
       .addCookies([{ name: 'locale', value: locale, url: 'http://127.0.0.1:4173' }]);
     for (const path of ['/onboarding/community', '/onboarding/community?view=create']) {
       const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
-      expect(response?.status()).toBeLessThan(400);
       const title = path.includes('create')
         ? copy.communityOnboarding.createTitle
         : copy.communityOnboarding.title;
-      await expect(page.locator('html')).toHaveAttribute('lang', locale);
-      await expect(page.getByRole('heading', { name: title })).toBeVisible();
+      await assertRawLocale(page, response, locale, title);
       await waitForHydratedPage(page);
+      await expect(page.locator('html')).toHaveAttribute('lang', locale);
       await expect(page.getByRole('heading', { name: title })).toBeVisible();
       expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
         320
@@ -455,6 +734,62 @@ test('SSR and hydration preserve locale across both views at 320px', async ({ pa
   }
 });

+test('raw locale oracle rejects English SSR even when live DOM is Portuguese', async ({ page }) => {
+  await page.setContent('<html lang="pt-BR"><body><h1>Comunidades</h1></body></html>');
+  await expect(
+    assertRawMarkupLocale(
+      page,
+      '<html lang="en"><body><h1>Communities</h1></body></html>',
+      'pt-BR',
+      'Comunidades'
+    )
+  ).rejects.toThrow();
+  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
+  await expect(page.locator('h1')).toHaveText('Comunidades');
+});
+
+test('optional labels stay visible and inputs remain usable at 320px in every locale', async ({
+  page
+}) => {
+  await player(page);
+  await page.setViewportSize({ width: 320, height: 844 });
+  for (const locale of ['en', 'pt-BR', 'es'] as const) {
+    const copy: LocaleCopy = JSON.parse(
+      readFileSync(new URL(`../src/locales/${locale}/translation.json`, import.meta.url), 'utf8')
+    );
+    await page
+      .context()
+      .addCookies([{ name: 'locale', value: locale, url: 'http://127.0.0.1:4173' }]);
+    await page.goto('/onboarding/community?view=create');
+    await waitForHydratedPage(page);
+    for (const [id, label] of [
+      ['community-description', copy.communityOnboarding.descriptionLabel],
+      ['community-city', copy.communityOnboarding.cityLabel]
+    ] as const) {
+      const input = page.locator(`#${id}`);
+      const associated = page.getByText(label, { exact: true });
+      await input.fill('Entered value');
+      await expect(associated).toBeVisible();
+      await expect(input).toHaveAttribute('id', id);
+      await expect(associated).toHaveAttribute('for', id);
+      const measured = await input.evaluate((node) => {
+        const inputRect = node.getBoundingClientRect();
+        const fieldLabel = document.querySelector(`label[for="${node.id}"]`)!;
+        const labelRect = fieldLabel.getBoundingClientRect();
+        return {
+          inputHeight: inputRect.height,
+          overlap: labelRect.bottom > inputRect.top + inputRect.height / 2
+        };
+      });
+      expect(measured.inputHeight).toBeGreaterThanOrEqual(44);
+      expect(measured.overlap).toBe(false);
+    }
+    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
+      320
+    );
+  }
+});
+
 test('create path validates then creates real public and private communities', async ({ page }) => {
   await player(page);
   await page.getByRole('button', { name: en.communityOnboarding.createEntry }).click();
@@ -509,7 +844,7 @@ test('city search finds real public community; join follows instant vs approval
     await expect(joiner).toHaveURL(/q=City/);
     await expect(joiner.getByText(`${city} · ${en.communityOnboarding.openJoin}`)).toBeVisible();
     const cards = joiner
-      .locator('main > div:last-child > div')
+      .locator('main > div:last-child [aria-busy="false"] > div')
       .filter({ has: joiner.getByRole('heading', { level: 3 }) });
     await geometry(cards.nth(0), { x: 18, y: 240, width: 354, height: 142 });
     await geometry(cards.nth(1), { x: 18, y: 392, width: 354, height: 142 });
@@ -570,3 +905,117 @@ test('Pencil references and baselines retain provenance', () => {
     expect(baseline).toEqual(source);
   }
 });
+
+test('visual comparator synthetic canvas PNGs validate dimensions, regions and changed pixels', async ({
+  page
+}) => {
+  const result = await page.evaluate(async () => {
+    const png = (width: number, height: number, changed = false) => {
+      const canvas = document.createElement('canvas');
+      canvas.width = width;
+      canvas.height = height;
+      const context = canvas.getContext('2d')!;
+      context.fillStyle = '#fff';
+      context.fillRect(0, 0, width, height);
+      if (changed) {
+        context.fillStyle = '#000';
+        context.fillRect(7, 8, 1, 1);
+      }
+      return canvas.toDataURL('image/png');
+    };
+    const decode = async (source: string) => {
+      const image = new Image();
+      image.src = source;
+      await image.decode();
+      const canvas = document.createElement('canvas');
+      canvas.width = image.width;
+      canvas.height = image.height;
+      const context = canvas.getContext('2d')!;
+      context.drawImage(image, 0, 0);
+      const pixels = context.getImageData(0, 0, image.width, image.height).data;
+      const offset = (8 * image.width + 7) * 4;
+      return {
+        width: image.width,
+        height: image.height,
+        bytes: pixels.length,
+        sample: [...pixels.slice(offset, offset + 4)]
+      };
+    };
+    const baseline = await decode(png(390, 844));
+    const identical = await decode(png(390, 844));
+    const changed = await decode(png(390, 844, true));
+    const widthMismatch = await decode(png(389, 844));
+    const heightMismatch = await decode(png(390, 843));
+    const color = (a: number[], b: number[]) => {
+      const r = a[0]! - b[0]!;
+      const g = a[1]! - b[1]!;
+      const blue = a[2]! - b[2]!;
+      const y = 0.29889531 * r + 0.58662247 * g + 0.11448223 * blue;
+      const i = 0.59597799 * r - 0.2741761 * g - 0.32180178 * blue;
+      const q = 0.21147017 * r - 0.52261711 * g + 0.31114694 * blue;
+      return 0.5053 * y ** 2 + 0.299 * i ** 2 + 0.1957 * q ** 2 > 35215 * 0.1 ** 2;
+    };
+    return {
+      baseline,
+      identical,
+      changed,
+      widthMismatch,
+      heightMismatch,
+      changedPixel: color(baseline.sample, changed.sample),
+      identicalPixel: color(baseline.sample, identical.sample)
+    };
+  });
+  expect(() => assertDecodedImage(result.baseline, result.identical, 844, [])).not.toThrow();
+  expect(() => assertDecodedImage(result.baseline, result.widthMismatch, 844, [])).toThrow();
+  expect(() => assertDecodedImage(result.baseline, result.heightMismatch, 844, [])).toThrow();
+  expect(() =>
+    assertDecodedImage(result.baseline, result.baseline, 844, [[389, 0, 2, 1]])
+  ).toThrow();
+  expect(result.changedPixel).toBe(true);
+  expect(result.identicalPixel).toBe(false);
+  expect(result.baseline.bytes).toBe(390 * 844 * 4);
+});
+
+test('masked title, metadata and action geometry probes reject displaced fixture nodes', async ({
+  page
+}) => {
+  await page.setContent(
+    '<h3 id="title">Fixture title</h3><p id="metadata">Fixture metadata</p><button id="action">Fixture action</button>'
+  );
+  await page.locator('#title').evaluate((element) =>
+    Object.assign(element.style, {
+      position: 'absolute',
+      left: '40px',
+      top: '260px',
+      width: '326px',
+      height: '19px'
+    })
+  );
+  await page.locator('#metadata').evaluate((element) =>
+    Object.assign(element.style, {
+      position: 'absolute',
+      left: '40px',
+      top: '286px',
+      width: '326px',
+      height: '15px'
+    })
+  );
+  await page.locator('#action').evaluate((element) =>
+    Object.assign(element.style, {
+      position: 'absolute',
+      left: '40px',
+      top: '324px',
+      width: '326px',
+      height: '44px'
+    })
+  );
+  await expect(
+    geometry(page.locator('#title'), { x: 32, y: 254, width: 326, height: 19 })
+  ).rejects.toThrow();
+  await expect(
+    geometry(page.locator('#metadata'), { x: 32, y: 280, width: 326, height: 15 })
+  ).rejects.toThrow();
+  await expect(
+    geometry(page.locator('#action'), { x: 32, y: 324, width: 326, height: 44 })
+  ).rejects.toThrow();
+});
diff --git a/src/features/community/CommunityAdmin.tsx b/src/features/community/CommunityAdmin.tsx
index 0be09e0..f137e97 100644
--- a/src/features/community/CommunityAdmin.tsx
+++ b/src/features/community/CommunityAdmin.tsx
@@ -1,123 +1,20 @@
 import * as stylex from '@stylexjs/stylex';
-import { Link, Outlet, useParams, useRouter } from '@tanstack/react-router';
-import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
+import { Link, Outlet, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
+import { useState } from 'react';
 import { useTranslation } from 'react-i18next';
-import { Button } from '../../components/ui/Button';
 import { SurfaceCard } from '../../components/ui/SurfaceCard';
-import { TextField } from '../../components/ui/TextField';
-import {
-  approveCommunityMember,
-  archiveCommunityVenue,
-  addCommunityVenue,
-  demoteCommunityMember,
-  denyCommunityMember,
-  editCommunityVenue,
-  listCommunityAudit,
-  listCommunityVenues,
-  promoteCommunityMember,
-  reactivateCommunityMember,
-  removeCommunityMember,
-  searchCommunityMembers
-} from './community-admin.functions';
-import { updateCommunitySettings } from './community.functions';
-import type { Database } from '../../lib/supabase/database.types';
-import type { CommunityMemberSearchResult } from './community-admin.types';
+import type { CommunityAdminScreenProps } from './community-admin.types';
 import { styles } from './community-admin.styles';
+import { CommunityAdminDispatcher } from './CommunityAdminViews';

-type Context = {
-  id: string;
-  name: string;
-  city_label: string | null;
-  description: string | null;
-  visibility: Database['public']['Enums']['community_visibility'];
-  join_policy: Database['public']['Enums']['community_join_policy'];
-};
-type Member = CommunityMemberSearchResult;
-type Venue = Pick<
-  Database['public']['Tables']['community_venues']['Row'],
-  | 'id'
-  | 'community_id'
-  | 'name'
-  | 'address'
-  | 'maps_url'
-  | 'photo_path'
-  | 'created_at'
-  | 'updated_at'
-  | 'archived_at'
->;
-type Audit = Pick<
-  Database['public']['Tables']['community_audit_log']['Row'],
-  'id' | 'actor_user_id' | 'entity' | 'entity_id' | 'action' | 'details' | 'occurred_at'
->;
-const EMPTY_MEMBERS: Member[] = [];
-const EMPTY_VENUES: Venue[] = [];
-type Screen = 'requests' | 'members' | 'member' | 'settings' | 'venues' | 'audit';
+type Props = CommunityAdminScreenProps;

-type Props = {
-  screen: Screen;
-  community: Context;
-  members?: Member[];
-  venues?: Venue[];
-  audit?: Audit[];
-  membershipId?: string;
-};
-
-function dateLabel(value: string, locale: string) {
+export function dateLabel(value: string, locale: string) {
   return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
     new Date(value)
   );
 }
-function auditDateLabel(value: string, locale: string) {
-  return new Intl.DateTimeFormat(locale, {
-    dateStyle: 'medium',
-    timeStyle: 'short',
-    timeZone: 'UTC'
-  }).format(new Date(value));
-}
-function auditEventKey(event: Audit) {
-  const action = event.action.toLowerCase();
-  const details = event.details;
-  if (
-    event.entity === 'community_members' &&
-    action === 'insert' &&
-    typeof details === 'object' &&
-    details !== null &&
-    'status' in details &&
-    details.status === 'pending'
-  )
-    return 'communityAdmin.audit.requestCreated';
-  if (event.entity === 'community_venues')
-    return action === 'insert'
-      ? 'communityAdmin.audit.venueAdded'
-      : 'communityAdmin.audit.venueUpdated';
-  if (event.entity === 'community_members')
-    return action === 'insert'
-      ? 'communityAdmin.audit.memberAdded'
-      : 'communityAdmin.audit.memberUpdated';
-  if (event.entity === 'communities') return 'communityAdmin.audit.settingsUpdated';
-  if (event.entity === 'community_invitations')
-    return action === 'insert'
-      ? 'communityAdmin.audit.invitationAdded'
-      : 'communityAdmin.audit.invitationUpdated';
-  return 'communityAdmin.audit.unknown';
-}
-function auditMemberDetails(event: Audit) {
-  if (event.entity !== 'community_members' || typeof event.details !== 'object' || !event.details)
-    return null;
-  const role =
-    'role' in event.details && (event.details.role === 'admin' || event.details.role === 'member')
-      ? event.details.role
-      : null;
-  const status =
-    'status' in event.details &&
-    (event.details.status === 'active' ||
-      event.details.status === 'pending' ||
-      event.details.status === 'inactive')
-      ? event.details.status
-      : null;
-  return role && status ? { role, status } : null;
-}
-function initials(name: string) {
+export function initials(name: string) {
   return name
     .trim()
     .split(/\s+/)
@@ -125,7 +22,7 @@ function initials(name: string) {
     .map((part) => part.charAt(0).toLocaleUpperCase())
     .join('');
 }
-function failed(error: unknown) {
+export function failed(error: unknown) {
   if (!(error instanceof Error)) return 'generic';
   if (error.message === 'UNAUTHENTICATED') return 'session';
   if (error.message === 'FINAL_COMMUNITY_ADMIN') return 'finalAdmin';
@@ -141,10 +38,24 @@ export function CommunityAdminShell() {
   );
 }

-export function CommunityAdminDenied({ error }: { error?: unknown }) {
+export function CommunityAdminDenied({ error, reset }: ErrorComponentProps) {
   const { t } = useTranslation();
+  const router = useRouter();
+  const [busy, setBusy] = useState(false);
   const denied = error instanceof Error && error.message === 'NOT_COMMUNITY_ADMIN';
   const missing = error instanceof Error && error.message === 'COMMUNITY_MEMBER_NOT_FOUND';
+  const retry = async () => {
+    if (busy) return;
+    setBusy(true);
+    try {
+      await router.invalidate();
+      reset();
+    } catch {
+      // Keep the error boundary visible when refresh fails.
+    } finally {
+      setBusy(false);
+    }
+  };
   return (
     <section {...stylex.props(styles.page)}>
       <SurfaceCard role="alert" xstyle={styles.card}>
@@ -166,6 +77,21 @@ export function CommunityAdminDenied({ error }: { error?: unknown }) {
                 : 'communityAdmin.error.generic'
           )}
         </p>
+        <div {...stylex.props(styles.errorActions)}>
+          {!denied && !missing && (
+            <button
+              type="button"
+              disabled={busy}
+              onClick={retry}
+              {...stylex.props(styles.errorAction)}
+            >
+              {t('communityAdmin.retry')}
+            </button>
+          )}
+          <Link to="/dashboard" {...stylex.props(styles.errorAction)}>
+            {t('communityAdmin.backToDashboard')}
+          </Link>
+        </div>
       </SurfaceCard>
     </section>
   );
@@ -208,868 +134,5 @@ export function CommunityAdminEntries({
 }

 export function CommunityAdminScreen(props: Props) {
-  return <CommunityAdminView key={props.community.id} {...props} />;
-}
-
-function CommunityAdminView({
-  screen,
-  community,
-  members = EMPTY_MEMBERS,
-  venues = EMPTY_VENUES,
-  audit = [],
-  membershipId
-}: Props) {
-  const { t, i18n } = useTranslation();
-  const router = useRouter();
-  const params = useParams({ strict: false });
-  const communityId = params.communityId ?? '';
-  const [query, setQuery] = useState('');
-  const [searchResults, setSearchResults] = useState<{
-    query: string;
-    status: Member['status'];
-    rows: Member[];
-    hasMore: boolean;
-  } | null>(null);
-  const [additionalRequests, setAdditionalRequests] = useState<Member[]>([]);
-  const [hasLoadedMoreRequests, setHasLoadedMoreRequests] = useState(false);
-  const [hasMoreRequests, setHasMoreRequests] = useState(members.length === 50);
-  const [additionalVenues, setAdditionalVenues] = useState<Venue[]>([]);
-  const [hasLoadedMoreVenues, setHasLoadedMoreVenues] = useState(false);
-  const [hasMoreVenues, setHasMoreVenues] = useState(venues.length === 50);
-  const [searchLoading, setSearchLoading] = useState(false);
-  const [hasLoadedMoreMembers, setHasLoadedMoreMembers] = useState(false);
-  const searchRequest = useRef(0);
-  const hasSearchedMembers = useRef(false);
-  const [additionalAudit, setAdditionalAudit] = useState<Audit[] | null>(null);
-  const [hasMoreAudit, setHasMoreAudit] = useState(audit.length === 3);
-  const [memberFilter, setMemberFilter] = useState<Member['status']>('active');
-  const [busy, setBusy] = useState(false);
-  const [confirmation, setConfirmation] = useState<{
-    action: 'demote' | 'remove';
-    id: string;
-  } | null>(null);
-  const [message, setMessage] = useState('');
-  const [errorKey, setErrorKey] = useState('');
-  const [settings, setSettings] = useState({
-    name: community.name,
-    description: community.description ?? '',
-    city_label: community.city_label ?? '',
-    visibility: community.visibility,
-    join_policy: community.join_policy
-  });
-  const [venueDraft, setVenueDraft] = useState({ id: '', name: '', address: '', maps_url: '' });
-  const [venueFormOpen, setVenueFormOpen] = useState(false);
-  const locale = i18n.resolvedLanguage || i18n.language;
-  const memberRatingLabel = (person: Member) => {
-    if (person.display_level === null || person.reliability_percent === null)
-      return t('communityAdmin.ratingsUnavailable');
-    return t('communityAdmin.levelLabel', {
-      level: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
-        person.display_level
-      ),
-      reliability: new Intl.NumberFormat(locale).format(person.reliability_percent)
-    });
-  };
-  const heading = t(`communityAdmin.title.${screen}`);
-  const auditRows = additionalAudit === null ? audit : [...audit, ...additionalAudit];
-  const navItems = [
-    { key: 'requests', to: '/community/$communityId/admin/requests' },
-    { key: 'members', to: '/community/$communityId/admin/members' },
-    { key: 'settings', to: '/community/$communityId/admin/settings' },
-    { key: 'venues', to: '/community/$communityId/admin/venues' },
-    { key: 'audit', to: '/community/$communityId/admin/audit' }
-  ] as const;
-  const member = members.find((item) => item.membership_id === membershipId);
-  const submittedQuery = query.trim();
-  const currentSearch =
-    searchResults?.query === submittedQuery && searchResults.status === memberFilter
-      ? searchResults
-      : null;
-  const initialActiveResults = submittedQuery === '' && memberFilter === 'active' && !searchResults;
-  const visibleMembers = currentSearch?.rows ?? (initialActiveResults ? members : []);
-  const hasMoreMembers = currentSearch?.hasMore ?? (initialActiveResults && members.length === 50);
-  const searchingMembers =
-    searchLoading ||
-    (!initialActiveResults && !currentSearch && searchResults !== null) ||
-    (submittedQuery !== '' && !currentSearch) ||
-    (memberFilter !== 'active' && !currentSearch);
-
-  useEffect(() => {
-    setAdditionalRequests([]);
-    setHasLoadedMoreRequests(false);
-    setHasMoreRequests(members.length === 50);
-  }, [members]);
-  useEffect(() => {
-    setAdditionalVenues([]);
-    setHasLoadedMoreVenues(false);
-    setHasMoreVenues(venues.length === 50);
-  }, [venues]);
-
-  async function refresh() {
-    setMessage('');
-    setErrorKey('');
-    await router.invalidate();
-  }
-  async function run(action: () => Promise<unknown>, success: string): Promise<unknown> {
-    if (busy) return null;
-    setBusy(true);
-    setErrorKey('');
-    setMessage('');
-    try {
-      const result = await action();
-      setAdditionalRequests([]);
-      setHasLoadedMoreRequests(false);
-      setHasMoreRequests(members.length === 50);
-      setAdditionalVenues([]);
-      setHasLoadedMoreVenues(false);
-      setHasMoreVenues(venues.length === 50);
-      setMessage(success);
-      try {
-        await router.invalidate();
-      } catch {
-        setErrorKey('generic');
-      }
-      return result;
-    } catch (error) {
-      setErrorKey(failed(error));
-      return null;
-    } finally {
-      setBusy(false);
-    }
-  }
-  async function memberAction(
-    action: 'approve' | 'deny' | 'remove' | 'reactivate' | 'promote' | 'demote',
-    id: string
-  ) {
-    const data = { community_id: community.id, membership_id: id };
-    const actions = {
-      approve: approveCommunityMember,
-      deny: denyCommunityMember,
-      remove: removeCommunityMember,
-      reactivate: reactivateCommunityMember,
-      promote: promoteCommunityMember,
-      demote: demoteCommunityMember
-    };
-    const result = await run(() => actions[action]({ data }), t(`communityAdmin.result.${action}`));
-    if (
-      action === 'reactivate' &&
-      typeof result === 'object' &&
-      result !== null &&
-      'membership_id' in result &&
-      typeof result.membership_id === 'string'
-    )
-      await router.navigate({
-        to: '/community/$communityId/admin/members/$membershipId',
-        params: { communityId: community.id, membershipId: result.membership_id }
-      });
-  }
-  function requestMemberAction(
-    action: 'approve' | 'deny' | 'remove' | 'reactivate' | 'promote' | 'demote',
-    id: string
-  ) {
-    if (action === 'remove' || action === 'demote') setConfirmation({ action, id });
-    else void memberAction(action, id);
-  }
-  function confirmedAction(action: 'demote' | 'remove', id: string) {
-    setConfirmation(null);
-    void memberAction(action, id);
-  }
-  const actions = (person: Member, requestCard = false): ReactNode => (
-    <div {...stylex.props(styles.actions, requestCard && styles.requestActions)}>
-      {confirmation?.id === person.membership_id && (
-        <>
-          <output {...stylex.props(styles.copy)}>
-            {t('communityAdmin.confirm', {
-              action: t(`communityAdmin.action.${confirmation.action}`),
-              name: person.display_name
-            })}
-          </output>
-          <Button
-            busy={busy}
-            onClick={() => confirmedAction(confirmation.action, person.membership_id)}
-          >
-            {t('communityAdmin.confirmAction')}
-          </Button>
-          <Button variant="secondary" onClick={() => setConfirmation(null)}>
-            {t('communityAdmin.cancel')}
-          </Button>
-        </>
-      )}
-      {person.status === 'pending' && (
-        <>
-          <Button busy={busy} onClick={() => requestMemberAction('approve', person.membership_id)}>
-            {t('communityAdmin.action.approve')}
-          </Button>
-          <Button
-            variant="secondary"
-            busy={busy}
-            onClick={() => requestMemberAction('deny', person.membership_id)}
-          >
-            {t('communityAdmin.action.deny')}
-          </Button>
-        </>
-      )}
-      {person.status === 'inactive' && (
-        <Button busy={busy} onClick={() => requestMemberAction('reactivate', person.membership_id)}>
-          {t('communityAdmin.action.reactivate')}
-        </Button>
-      )}
-      {person.status === 'active' && person.role === 'member' && (
-        <Button
-          variant="secondary"
-          busy={busy}
-          xstyle={styles.softAction}
-          onClick={() => requestMemberAction('promote', person.membership_id)}
-        >
-          {t('communityAdmin.action.promote')}
-        </Button>
-      )}
-      {person.status === 'active' && person.role === 'admin' && (
-        <Button
-          variant="secondary"
-          busy={busy}
-          onClick={() => requestMemberAction('demote', person.membership_id)}
-        >
-          {t('communityAdmin.action.demote')}
-        </Button>
-      )}
-      {person.status === 'active' && (
-        <Button
-          variant="secondary"
-          busy={busy}
-          onClick={() => requestMemberAction('remove', person.membership_id)}
-        >
-          {t('communityAdmin.action.remove')}
-        </Button>
-      )}
-    </div>
-  );
-  const memberStatus = (person: Member) => t(`communityAdmin.status.${person.status}`);
-
-  async function saveSettings(event: FormEvent<HTMLFormElement>) {
-    event.preventDefault();
-    await run(
-      () => updateCommunitySettings({ data: { community_id: community.id, ...settings } }),
-      t('communityAdmin.result.settings')
-    );
-  }
-  async function saveVenue(event: FormEvent<HTMLFormElement>) {
-    event.preventDefault();
-    const data = {
-      community_id: community.id,
-      name: venueDraft.name,
-      address: venueDraft.address || null,
-      maps_url: venueDraft.maps_url || null
-    };
-    const saved = await run(
-      () =>
-        venueDraft.id
-          ? editCommunityVenue({ data: { ...data, venue_id: venueDraft.id } })
-          : addCommunityVenue({ data }),
-      t(venueDraft.id ? 'communityAdmin.result.venueUpdated' : 'communityAdmin.result.venueAdded')
-    );
-    if (!saved) return;
-    setVenueFormOpen(false);
-    setVenueDraft({ id: '', name: '', address: '', maps_url: '' });
-  }
-  const fetchMembers = useCallback(
-    async (filterQuery: string, filterStatus: Member['status'], offset = 0) => {
-      const requestId = ++searchRequest.current;
-      hasSearchedMembers.current = true;
-      setSearchLoading(true);
-      setErrorKey('');
-      try {
-        const results = await searchCommunityMembers({
-          data: {
-            community_id: community.id,
-            query: filterQuery,
-            status: filterStatus,
-            offset,
-            limit: 50
-          }
-        });
-        if (requestId !== searchRequest.current) return;
-        setSearchResults((previous) => ({
-          query: filterQuery,
-          status: filterStatus,
-          rows:
-            offset > 0 && previous?.query === filterQuery && previous.status === filterStatus
-              ? [...previous.rows, ...results]
-              : results,
-          hasMore: results.length === 50
-        }));
-      } catch (error) {
-        if (requestId === searchRequest.current) setErrorKey(failed(error));
-      } finally {
-        if (requestId === searchRequest.current) setSearchLoading(false);
-      }
-    },
-    [community.id]
-  );
-  useEffect(() => {
-    if (submittedQuery === '' && memberFilter === 'active' && !hasSearchedMembers.current)
-      return undefined;
-    const timer = setTimeout(() => void fetchMembers(submittedQuery, memberFilter), 250);
-    return () => clearTimeout(timer);
-  }, [fetchMembers, submittedQuery, memberFilter]);
-  async function loadMoreMembers() {
-    if (searchLoading || !hasMoreMembers) return;
-    setHasLoadedMoreMembers(true);
-    if (currentSearch) {
-      await fetchMembers(currentSearch.query, currentSearch.status, currentSearch.rows.length);
-      return;
-    }
-    setSearchResults({ query: '', status: 'active', rows: members, hasMore: true });
-    await fetchMembers('', 'active', members.length);
-  }
-  async function loadMoreRequests() {
-    if (busy || !hasMoreRequests) return;
-    setBusy(true);
-    setHasLoadedMoreRequests(true);
-    try {
-      const page = await searchCommunityMembers({
-        data: {
-          community_id: community.id,
-          query: '',
-          status: 'pending',
-          offset: members.length + additionalRequests.length,
-          limit: 50
-        }
-      });
-      setAdditionalRequests((previous) => [...previous, ...page]);
-      setHasMoreRequests(page.length === 50);
-    } catch (error) {
-      setErrorKey(failed(error));
-    } finally {
-      setBusy(false);
-    }
-  }
-  async function loadMoreVenues() {
-    if (busy || !hasMoreVenues) return;
-    setBusy(true);
-    setHasLoadedMoreVenues(true);
-    try {
-      const page = await listCommunityVenues({
-        data: {
-          community_id: community.id,
-          offset: venues.length + additionalVenues.length,
-          limit: 50
-        }
-      });
-      setAdditionalVenues((previous) => [...previous, ...page]);
-      setHasMoreVenues(page.length === 50);
-    } catch (error) {
-      setErrorKey(failed(error));
-    } finally {
-      setBusy(false);
-    }
-  }
-  async function loadMoreAudit() {
-    if (busy || !hasMoreAudit) return;
-    setBusy(true);
-    try {
-      const page = await listCommunityAudit({
-        data: { community_id: community.id, offset: auditRows.length, limit: 3 }
-      });
-      setAdditionalAudit([...(additionalAudit ?? []), ...page]);
-      setHasMoreAudit(page.length === 3);
-    } catch (error) {
-      setErrorKey(failed(error));
-    } finally {
-      setBusy(false);
-    }
-  }
-
-  async function retry() {
-    if (screen === 'members') await fetchMembers(submittedQuery, memberFilter);
-    else await refresh();
-  }
-
-  return (
-    <section
-      aria-labelledby="admin-screen-title"
-      {...stylex.props(styles.content, screen === 'venues' && styles.venueContent)}
-    >
-      <header {...stylex.props(styles.header)}>
-        <div {...stylex.props(styles.screenHeading)}>
-          <Link
-            to="/dashboard"
-            aria-label={t('communityAdmin.backToDashboard')}
-            {...stylex.props(styles.backLink)}
-          >
-            <span aria-hidden="true">‹</span>
-          </Link>
-          <div {...stylex.props(styles.titleGroup)}>
-            <h1 id="admin-screen-title" {...stylex.props(styles.title)}>
-              {heading}
-            </h1>
-            <p {...stylex.props(styles.subtitle)}>
-              {t('communityAdmin.communityAdminSubtitle', { community: community.name })}
-            </p>
-          </div>
-        </div>
-      </header>
-      {screen === 'requests' && (
-        <>
-          <p {...stylex.props(styles.banner)}>{t('communityAdmin.requestBanner')}</p>
-          <div {...stylex.props(styles.list)}>
-            {[...members, ...additionalRequests].map((person) => (
-              <SurfaceCard key={person.membership_id} xstyle={[styles.card, styles.requestCard]}>
-                <h3 {...stylex.props(styles.cardCompactTitle)}>{person.display_name}</h3>
-                <p {...stylex.props(styles.copy)}>{memberRatingLabel(person)}</p>
-                <p {...stylex.props(styles.copy, styles.requestMeta)}>
-                  {t('communityAdmin.requestMeta', {
-                    date: dateLabel(person.valid_from, locale),
-                    privacy: t('communityAdmin.requestPrivacy')
-                  })}
-                </p>
-                {actions(person, true)}
-              </SurfaceCard>
-            ))}
-            {!members.length && !additionalRequests.length && (
-              <p>{t('communityAdmin.empty.requests')}</p>
-            )}
-            {hasMoreRequests ? (
-              <Button variant="secondary" busy={busy} onClick={() => void loadMoreRequests()}>
-                {t('communityAdmin.loadMore')}
-              </Button>
-            ) : (
-              hasLoadedMoreRequests && (
-                <p {...stylex.props(styles.copy)}>{t('communityAdmin.endOfList')}</p>
-              )
-            )}
-            <p {...stylex.props(styles.note)}>{t('communityAdmin.requestHistoryUnavailable')}</p>
-          </div>
-        </>
-      )}
-      {screen === 'members' && (
-        <>
-          <Button disabled xstyle={styles.unavailableInvite}>
-            {t('communityAdmin.inviteUnavailable')}
-          </Button>
-          <form
-            onSubmit={(event) => {
-              event.preventDefault();
-            }}
-            {...stylex.props(styles.searchForm)}
-          >
-            <div {...stylex.props(styles.searchField)}>
-              <TextField
-                id="admin-member-search"
-                label={
-                  <span {...stylex.props(styles.visuallyHidden)}>
-                    {t('communityAdmin.searchLabel')}
-                  </span>
-                }
-                type="search"
-                value={query}
-                placeholder={t('communityAdmin.searchPlaceholder')}
-                onChange={(event) => setQuery(event.target.value)}
-              />
-            </div>
-          </form>
-          <fieldset
-            aria-label={t('communityAdmin.memberFilters')}
-            {...stylex.props(styles.filterTabs)}
-          >
-            {(['active', 'pending', 'inactive'] as const).map((status) => (
-              <button
-                key={status}
-                type="button"
-                aria-pressed={memberFilter === status}
-                onClick={() => {
-                  setMemberFilter(status);
-                }}
-                {...stylex.props(
-                  styles.filterTab,
-                  memberFilter === status && styles.filterTabSelected
-                )}
-              >
-                {t(`communityAdmin.status.${status}`)}
-              </button>
-            ))}
-          </fieldset>
-          {searchingMembers && (
-            <output aria-live="polite" {...stylex.props(styles.copy)}>
-              {t('communityAdmin.searchLoading')}
-            </output>
-          )}
-          <div {...stylex.props(styles.list, styles.memberList)}>
-            {visibleMembers.map((person) => (
-              <SurfaceCard
-                key={person.membership_id}
-                data-testid="community-member-card"
-                xstyle={[styles.card, styles.memberCard]}
-              >
-                <span aria-hidden="true" {...stylex.props(styles.avatar)}>
-                  {initials(person.display_name)}
-                </span>
-                <div {...stylex.props(styles.memberDetails)}>
-                  <div {...stylex.props(styles.memberRowHeader)}>
-                    <Link
-                      to="/community/$communityId/admin/members/$membershipId"
-                      params={{ communityId, membershipId: person.membership_id }}
-                      {...stylex.props(styles.memberLink)}
-                    >
-                      <h3 {...stylex.props(styles.cardCompactTitle)}>{person.display_name}</h3>
-                    </Link>
-                    <span {...stylex.props(styles.roleBadge)}>
-                      {t(`communityAdmin.role.${person.role}`)}
-                    </span>
-                  </div>
-                  <p {...stylex.props(styles.copy)}>
-                    {t('communityAdmin.memberJoined', {
-                      date: dateLabel(person.valid_from, locale)
-                    })}
-                  </p>
-                  <p {...stylex.props(styles.copy)}>{memberRatingLabel(person)}</p>
-                </div>
-              </SurfaceCard>
-            ))}
-            {!visibleMembers.length && !searchingMembers && (
-              <p>{t('communityAdmin.empty.members')}</p>
-            )}
-          </div>
-          {hasMoreMembers ? (
-            <Button variant="secondary" busy={searchLoading} onClick={() => void loadMoreMembers()}>
-              {t('communityAdmin.loadMore')}
-            </Button>
-          ) : (
-            hasLoadedMoreMembers && (
-              <p {...stylex.props(styles.copy)}>{t('communityAdmin.endOfList')}</p>
-            )
-          )}
-          <p {...stylex.props(styles.note)}>{t('communityAdmin.levelReadOnly')}</p>
-        </>
-      )}
-      {screen === 'member' && (
-        <>
-          {member?.status === 'active' && (
-            <p {...stylex.props(styles.banner)}>{t('communityAdmin.memberActiveBanner')}</p>
-          )}
-          {member ? (
-            <>
-              <SurfaceCard
-                data-testid="community-member-profile"
-                xstyle={[styles.card, styles.memberProfileCard]}
-              >
-                <h3 {...stylex.props(styles.memberProfileTitle)}>
-                  {member.display_level === null || member.reliability_percent === null
-                    ? t('communityAdmin.memberAdminProfileMissing', { name: member.display_name })
-                    : t('communityAdmin.memberAdminProfile', {
-                        name: member.display_name,
-                        level: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
-                          member.display_level
-                        ),
-                        reliability: new Intl.NumberFormat(locale).format(
-                          member.reliability_percent
-                        )
-                      })}
-                </h3>
-                <p {...stylex.props(styles.copy)}>
-                  {t('communityAdmin.memberMeta', {
-                    status: memberStatus(member),
-                    role: t(`communityAdmin.role.${member.role}`),
-                    date: dateLabel(member.valid_from, locale)
-                  })}
-                </p>
-              </SurfaceCard>
-              <SurfaceCard data-testid="community-member-role-panel" xstyle={styles.rolePanel}>
-                <p {...stylex.props(styles.rolePanelTitle)}>{t('communityAdmin.rolePanelTitle')}</p>
-                <p {...stylex.props(styles.rolePanelCopy)}>
-                  {t('communityAdmin.rolePanelActive', {
-                    role: t(`communityAdmin.role.${member.role}`)
-                  })}
-                </p>
-                <p {...stylex.props(styles.rolePanelCopy)}>
-                  {t('communityAdmin.rolePanelInactive')}
-                </p>
-              </SurfaceCard>
-              <div {...stylex.props(styles.form)}>{actions(member)}</div>
-            </>
-          ) : (
-            <SurfaceCard xstyle={styles.card}>
-              <p>{t('communityAdmin.empty.member')}</p>
-            </SurfaceCard>
-          )}
-          <p {...stylex.props(styles.note)}>{t('communityAdmin.levelReadOnly')}</p>
-        </>
-      )}
-      {screen === 'settings' && (
-        <form
-          onSubmit={(event) => void saveSettings(event)}
-          {...stylex.props(styles.form, styles.settingsForm)}
-        >
-          <SurfaceCard data-testid="settings-visibility-label" xstyle={styles.settingsCard}>
-            <span {...stylex.props(styles.fieldLabel)}>
-              {t('communityAdmin.settings.visibility')}
-            </span>
-          </SurfaceCard>
-          <select
-            id="community-visibility"
-            data-testid="settings-visibility-control"
-            value={settings.visibility}
-            aria-label={t('communityAdmin.settings.visibility')}
-            onChange={(event) =>
-              setSettings({
-                ...settings,
-                visibility: event.target.value === 'public' ? 'public' : 'private'
-              })
-            }
-            {...stylex.props(styles.settingChoice)}
-          >
-            <option value="public">{t('communityAdmin.visibility.public')}</option>
-            <option value="private">{t('communityAdmin.visibility.private')}</option>
-          </select>
-          <select
-            id="community-join-policy"
-            data-testid="settings-join-policy-control"
-            value={settings.join_policy}
-            aria-label={t('communityAdmin.settings.joinPolicy')}
-            onChange={(event) =>
-              setSettings({
-                ...settings,
-                join_policy: event.target.value === 'instant' ? 'instant' : 'admin_approval'
-              })
-            }
-            {...stylex.props(styles.settingChoice)}
-          >
-            <option value="instant">{t('communityAdmin.joinPolicy.instant')}</option>
-            <option value="admin_approval">{t('communityAdmin.joinPolicy.adminApproval')}</option>
-          </select>
-          <SurfaceCard xstyle={styles.settingsUnavailableCard}>
-            <p {...stylex.props(styles.copy)}>{t('communityAdmin.settingsUnavailable')}</p>
-            <details {...stylex.props(styles.details)}>
-              <summary {...stylex.props(styles.detailsSummary)}>
-                {t('communityAdmin.settings.details')}
-              </summary>
-              <div {...stylex.props(styles.form)}>
-                <TextField
-                  id="community-admin-name"
-                  label={t('communityAdmin.settings.name')}
-                  value={settings.name}
-                  maxLength={80}
-                  onChange={(event) => setSettings({ ...settings, name: event.target.value })}
-                  required
-                />
-                <TextField
-                  id="community-admin-city"
-                  label={t('communityAdmin.settings.city')}
-                  value={settings.city_label}
-                  maxLength={120}
-                  onChange={(event) => setSettings({ ...settings, city_label: event.target.value })}
-                />
-                <TextField
-                  id="community-admin-description"
-                  label={t('communityAdmin.settings.description')}
-                  value={settings.description}
-                  maxLength={500}
-                  onChange={(event) =>
-                    setSettings({ ...settings, description: event.target.value })
-                  }
-                />
-              </div>
-            </details>
-          </SurfaceCard>
-          <Button type="submit" busy={busy}>
-            {t('communityAdmin.save')}
-          </Button>
-          <p {...stylex.props(styles.note)}>{t('communityAdmin.settingsAdminNote')}</p>
-        </form>
-      )}
-      {screen === 'venues' && (
-        <>
-          {!venueFormOpen && (
-            <>
-              <Button onClick={() => setVenueFormOpen(true)}>
-                {t('communityAdmin.venue.add')}
-              </Button>
-            </>
-          )}
-          {venueFormOpen && (
-            <SurfaceCard xstyle={styles.card}>
-              <h3 {...stylex.props(styles.cardTitle)}>
-                {t(venueDraft.id ? 'communityAdmin.venue.edit' : 'communityAdmin.venue.add')}
-              </h3>
-              <form onSubmit={(event) => void saveVenue(event)} {...stylex.props(styles.form)}>
-                <TextField
-                  id="venue-name"
-                  label={t('communityAdmin.venue.name')}
-                  value={venueDraft.name}
-                  maxLength={120}
-                  required
-                  onChange={(event) => setVenueDraft({ ...venueDraft, name: event.target.value })}
-                />
-                <TextField
-                  id="venue-address"
-                  label={t('communityAdmin.venue.address')}
-                  value={venueDraft.address}
-                  maxLength={300}
-                  onChange={(event) =>
-                    setVenueDraft({ ...venueDraft, address: event.target.value })
-                  }
-                />
-                <TextField
-                  id="venue-map"
-                  label={t('communityAdmin.venue.mapsUrl')}
-                  value={venueDraft.maps_url}
-                  maxLength={2048}
-                  type="url"
-                  onChange={(event) =>
-                    setVenueDraft({ ...venueDraft, maps_url: event.target.value })
-                  }
-                />
-                <p {...stylex.props(styles.note)}>{t('communityAdmin.photoUnavailable')}</p>
-                <Button type="submit" busy={busy}>
-                  {t('communityAdmin.save')}
-                </Button>
-              </form>
-              <Button
-                variant="secondary"
-                onClick={() => {
-                  setVenueFormOpen(false);
-                  setVenueDraft({ id: '', name: '', address: '', maps_url: '' });
-                }}
-              >
-                {t('communityAdmin.cancel')}
-              </Button>
-            </SurfaceCard>
-          )}
-          <div {...stylex.props(styles.list)}>
-            {[...venues, ...additionalVenues].map((venue) => (
-              <SurfaceCard
-                key={venue.id}
-                data-testid="community-venue-card"
-                xstyle={[styles.card, styles.venueCard]}
-              >
-                <h3 {...stylex.props(styles.cardCompactTitle)}>{venue.name}</h3>
-                <div {...stylex.props(styles.venueMeta)}>
-                  <p {...stylex.props(styles.copy)}>
-                    {venue.address || community.city_label || t('communityAdmin.cityUnavailable')}
-                  </p>
-                  {venue.maps_url && (
-                    <a
-                      href={venue.maps_url}
-                      target="_blank"
-                      rel="noreferrer"
-                      {...stylex.props(styles.memberLink, styles.venueMapLink)}
-                    >
-                      {t('communityAdmin.venue.openMap')}
-                    </a>
-                  )}
-                </div>
-                <div {...stylex.props(styles.venueActions)}>
-                  <Button
-                    variant="secondary"
-                    xstyle={styles.venueAction}
-                    onClick={() => {
-                      setVenueDraft({
-                        id: venue.id,
-                        name: venue.name,
-                        address: venue.address ?? '',
-                        maps_url: venue.maps_url ?? ''
-                      });
-                      setVenueFormOpen(true);
-                    }}
-                  >
-                    {t('communityAdmin.venue.edit')}
-                  </Button>
-                  <Button
-                    variant="secondary"
-                    xstyle={styles.venueAction}
-                    busy={busy}
-                    onClick={() =>
-                      void run(
-                        () =>
-                          archiveCommunityVenue({
-                            data: { community_id: community.id, venue_id: venue.id }
-                          }),
-                        t('communityAdmin.result.venueArchived')
-                      )
-                    }
-                  >
-                    {t('communityAdmin.venue.archive')}
-                  </Button>
-                </div>
-              </SurfaceCard>
-            ))}
-            {!venues.length && !additionalVenues.length && (
-              <p>{t('communityAdmin.empty.venues')}</p>
-            )}
-          </div>
-          {hasMoreVenues ? (
-            <Button variant="secondary" busy={busy} onClick={() => void loadMoreVenues()}>
-              {t('communityAdmin.loadMore')}
-            </Button>
-          ) : (
-            hasLoadedMoreVenues && (
-              <p {...stylex.props(styles.copy)}>{t('communityAdmin.endOfList')}</p>
-            )
-          )}
-          <p {...stylex.props(styles.note)}>{t('communityAdmin.venue.historyNote')}</p>
-        </>
-      )}
-      {screen === 'audit' && (
-        <div {...stylex.props(styles.list)}>
-          <p {...stylex.props(styles.banner)}>{t('communityAdmin.audit.recentChanges')}</p>
-          {auditRows.map((event) => (
-            <SurfaceCard
-              key={event.id}
-              data-testid="community-audit-event"
-              xstyle={[styles.card, styles.auditCard]}
-            >
-              <p {...stylex.props(styles.auditAction)}>
-                {t(auditEventKey(event), { defaultValue: t('communityAdmin.audit.unknown') })}
-                {auditMemberDetails(event) &&
-                  ` · ${t(`communityAdmin.role.${auditMemberDetails(event)?.role}`)} · ${t(`communityAdmin.status.${auditMemberDetails(event)?.status}`)}`}
-              </p>
-              <p {...stylex.props(styles.copy)}>
-                {t('communityAdmin.audit.unknownActor')} ·{' '}
-                {auditDateLabel(event.occurred_at, locale)}
-              </p>
-              {event.entity === 'community_members' && (
-                <Link
-                  to="/community/$communityId/admin/members/$membershipId"
-                  params={{ communityId, membershipId: event.entity_id }}
-                  {...stylex.props(styles.memberLink)}
-                >
-                  {t('communityAdmin.audit.openMember')}
-                </Link>
-              )}
-            </SurfaceCard>
-          ))}
-          {!auditRows.length && <p>{t('communityAdmin.empty.audit')}</p>}
-          {hasMoreAudit && (
-            <Button variant="secondary" busy={busy} onClick={() => void loadMoreAudit()}>
-              {t('communityAdmin.loadMore')}
-            </Button>
-          )}
-        </div>
-      )}
-      {message && <output {...stylex.props(styles.status)}>{message}</output>}
-      {errorKey && (
-        <p role="alert" {...stylex.props(styles.error)}>
-          {t(`communityAdmin.error.${errorKey}`)}
-        </p>
-      )}
-      {errorKey && (
-        <Button variant="secondary" onClick={() => void retry()}>
-          {t('communityAdmin.retry')}
-        </Button>
-      )}
-      <nav aria-label={t('communityAdmin.navigation')} {...stylex.props(styles.bottomNav)}>
-        {navItems.map((item) => (
-          <Link
-            key={item.key}
-            to={item.to}
-            params={{ communityId }}
-            aria-current={screen === item.key ? 'page' : undefined}
-            {...stylex.props(styles.bottomNavLink)}
-          >
-            {t(`communityAdmin.nav.${item.key}`)}
-          </Link>
-        ))}
-      </nav>
-    </section>
-  );
+  return <CommunityAdminDispatcher key={props.community.id} {...props} />;
 }
diff --git a/src/features/community/CommunityAdminViews.tsx b/src/features/community/CommunityAdminViews.tsx
new file mode 100644
index 0000000..017820c
--- /dev/null
+++ b/src/features/community/CommunityAdminViews.tsx
@@ -0,0 +1,1291 @@
+import * as stylex from '@stylexjs/stylex';
+import { AlertDialog } from '@base-ui/react/alert-dialog';
+import { Link, useParams, useRouter } from '@tanstack/react-router';
+import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
+import { useTranslation } from 'react-i18next';
+import { Button } from '../../components/ui/Button';
+import { SurfaceCard } from '../../components/ui/SurfaceCard';
+import { TextField } from '../../components/ui/TextField';
+import {
+  addCommunityVenue,
+  archiveCommunityVenue,
+  demoteCommunityMember,
+  promoteCommunityMember,
+  reactivateCommunityMember,
+  removeCommunityMember,
+  approveCommunityMember,
+  denyCommunityMember,
+  searchCommunityMembers,
+  editCommunityVenue,
+  listCommunityVenues,
+  listCommunityAudit
+} from './community-admin.functions';
+import { dateLabel, failed, initials } from './CommunityAdmin';
+import { updateCommunitySettings } from './community.functions';
+import type {
+  CommunityAdminMember,
+  CommunityAdminAudit,
+  CommunityAdminScreenProps,
+  CommunityAdminVenue
+} from './community-admin.types';
+import { styles } from './community-admin.styles';
+
+type ScreenName = CommunityAdminScreenProps['screen'];
+type ViewProps<Screen extends ScreenName> = Extract<CommunityAdminScreenProps, { screen: Screen }>;
+
+function MembersView({ community, members }: ViewProps<'members'>) {
+  const { t, i18n } = useTranslation();
+  const params = useParams({ strict: false });
+  const communityId = params.communityId ?? '';
+  const [query, setQuery] = useState('');
+  const [memberFilter, setMemberFilter] = useState<CommunityAdminMember['status']>('active');
+  const [searchResults, setSearchResults] = useState<{
+    source: CommunityAdminMember[];
+    query: string;
+    status: CommunityAdminMember['status'];
+    rows: CommunityAdminMember[];
+    hasMore: boolean;
+  } | null>(null);
+  const [searchLoading, setSearchLoading] = useState(false);
+  const [hasLoadedMoreMembers, setHasLoadedMoreMembers] = useState(false);
+  const searchRequest = useRef(0);
+  const membersSourceRef = useRef(members);
+  const hasSearchedMembers = useRef(false);
+  const { busy, message, errorKey, setErrorKey } = useAdminMutationState();
+  const locale = i18n.resolvedLanguage || i18n.language;
+  const submittedQuery = query.trim();
+  const currentSearch =
+    searchResults?.source === members &&
+    searchResults.query === submittedQuery &&
+    searchResults.status === memberFilter
+      ? searchResults
+      : null;
+  const initialActiveResults = submittedQuery === '' && memberFilter === 'active' && !searchResults;
+  const visibleMembers = currentSearch?.rows ?? (initialActiveResults ? members : []);
+  const canLoadMore = currentSearch?.hasMore ?? (initialActiveResults && members.length === 50);
+  const searchingMembers =
+    searchLoading ||
+    (!initialActiveResults && !currentSearch && searchResults !== null) ||
+    (submittedQuery !== '' && !currentSearch) ||
+    (memberFilter !== 'active' && !currentSearch);
+
+  useEffect(() => {
+    if (membersSourceRef.current === members) return;
+    membersSourceRef.current = members;
+    searchRequest.current += 1;
+    setSearchResults(null);
+    setSearchLoading(false);
+    setHasLoadedMoreMembers(false);
+  }, [members]);
+
+  const fetchMembers = useCallback(
+    async (filterQuery: string, filterStatus: CommunityAdminMember['status'], offset = 0) => {
+      const requestId = ++searchRequest.current;
+      const source = members;
+      hasSearchedMembers.current = true;
+      setSearchLoading(true);
+      setErrorKey('');
+      try {
+        const results = await searchCommunityMembers({
+          data: {
+            community_id: community.id,
+            query: filterQuery,
+            status: filterStatus,
+            offset,
+            limit: 50
+          }
+        });
+        if (requestId !== searchRequest.current || source !== membersSourceRef.current) return;
+        setSearchResults((previous) => ({
+          source,
+          query: filterQuery,
+          status: filterStatus,
+          rows:
+            offset > 0 &&
+            previous?.source === source &&
+            previous.query === filterQuery &&
+            previous.status === filterStatus
+              ? [...previous.rows, ...results]
+              : results,
+          hasMore: results.length === 50
+        }));
+      } catch (error) {
+        if (requestId === searchRequest.current && source === membersSourceRef.current)
+          setErrorKey(failed(error));
+      } finally {
+        if (requestId === searchRequest.current && source === membersSourceRef.current)
+          setSearchLoading(false);
+      }
+    },
+    [community.id, members, setErrorKey]
+  );
+
+  useEffect(() => {
+    if (submittedQuery === '' && memberFilter === 'active' && !hasSearchedMembers.current)
+      return undefined;
+    const timer = setTimeout(() => void fetchMembers(submittedQuery, memberFilter), 250);
+    return () => clearTimeout(timer);
+  }, [fetchMembers, submittedQuery, memberFilter, members]);
+
+  async function loadMoreMembers() {
+    if (searchLoading || !canLoadMore) return;
+    setHasLoadedMoreMembers(true);
+    if (currentSearch) {
+      await fetchMembers(currentSearch.query, currentSearch.status, currentSearch.rows.length);
+      return;
+    }
+    setSearchResults({
+      source: members,
+      query: '',
+      status: 'active',
+      rows: members,
+      hasMore: true
+    });
+    await fetchMembers('', 'active', members.length);
+  }
+
+  return (
+    <AdminViewFrame communityId={communityId} communityName={community.name} screen="members">
+      <Button disabled xstyle={styles.unavailableInvite}>
+        {t('communityAdmin.inviteUnavailable')}
+      </Button>
+      <form onSubmit={(event) => event.preventDefault()} {...stylex.props(styles.searchForm)}>
+        <div {...stylex.props(styles.searchField)}>
+          <TextField
+            id="admin-member-search"
+            label={
+              <span {...stylex.props(styles.visuallyHidden)}>
+                {t('communityAdmin.searchLabel')}
+              </span>
+            }
+            type="search"
+            value={query}
+            placeholder={t('communityAdmin.searchPlaceholder')}
+            onChange={(event) => setQuery(event.target.value)}
+          />
+        </div>
+      </form>
+      <fieldset aria-label={t('communityAdmin.memberFilters')} {...stylex.props(styles.filterTabs)}>
+        {(['active', 'pending', 'inactive'] as const).map((status) => (
+          <button
+            key={status}
+            type="button"
+            aria-pressed={memberFilter === status}
+            onClick={() => setMemberFilter(status)}
+            {...stylex.props(styles.filterTab, memberFilter === status && styles.filterTabSelected)}
+          >
+            {t(`communityAdmin.status.${status}`)}
+          </button>
+        ))}
+      </fieldset>
+      {searchingMembers && (
+        <output aria-live="polite" {...stylex.props(styles.copy)}>
+          {t('communityAdmin.searchLoading')}
+        </output>
+      )}
+      <div {...stylex.props(styles.list, styles.memberList)}>
+        {visibleMembers.map((person) => (
+          <SurfaceCard
+            key={person.membership_id}
+            data-testid="community-member-card"
+            xstyle={[styles.card, styles.memberCard]}
+          >
+            <span aria-hidden="true" {...stylex.props(styles.avatar)}>
+              {initials(person.display_name)}
+            </span>
+            <div {...stylex.props(styles.memberDetails)}>
+              <div {...stylex.props(styles.memberRowHeader)}>
+                <Link
+                  to="/community/$communityId/admin/members/$membershipId"
+                  params={{ communityId, membershipId: person.membership_id }}
+                  {...stylex.props(styles.memberLink)}
+                >
+                  <h3 {...stylex.props(styles.cardCompactTitle)}>{person.display_name}</h3>
+                </Link>
+                <span {...stylex.props(styles.roleBadge)}>
+                  {t(`communityAdmin.role.${person.role}`)}
+                </span>
+              </div>
+              <p {...stylex.props(styles.copy)}>
+                {t('communityAdmin.memberJoined', { date: dateLabel(person.valid_from, locale) })}
+              </p>
+              <p {...stylex.props(styles.copy)}>{ratingLabel(person, t, locale)}</p>
+            </div>
+          </SurfaceCard>
+        ))}
+        {!visibleMembers.length && !searchingMembers && <p>{t('communityAdmin.empty.members')}</p>}
+      </div>
+      {canLoadMore ? (
+        <Button
+          variant="secondary"
+          busy={searchLoading || busy}
+          onClick={() => void loadMoreMembers()}
+        >
+          {t('communityAdmin.loadMore')}
+        </Button>
+      ) : (
+        hasLoadedMoreMembers && (
+          <p {...stylex.props(styles.copy)}>{t('communityAdmin.endOfList')}</p>
+        )
+      )}
+      <p {...stylex.props(styles.note)}>{t('communityAdmin.levelReadOnly')}</p>
+      {message && <output {...stylex.props(styles.status)}>{message}</output>}
+      {errorKey && (
+        <p role="alert" {...stylex.props(styles.error)}>
+          {t(`communityAdmin.error.${errorKey}`)}
+        </p>
+      )}
+      {errorKey && (
+        <Button variant="secondary" onClick={() => void fetchMembers(submittedQuery, memberFilter)}>
+          {t('communityAdmin.retry')}
+        </Button>
+      )}
+    </AdminViewFrame>
+  );
+}
+
+function RequestsView(props: ViewProps<'requests'>) {
+  const { community, members } = props;
+  const { t, i18n } = useTranslation();
+  const router = useRouter();
+  const params = useParams({ strict: false });
+  const communityId = params.communityId ?? '';
+  const [additionalRequests, setAdditionalRequests] = useState<CommunityAdminMember[]>([]);
+  const [hasLoadedMoreRequests, setHasLoadedMoreRequests] = useState(false);
+  const [hasMoreRequests, setHasMoreRequests] = useState(members.length === 50);
+  const { busy, setBusy, message, setMessage, errorKey, setErrorKey } = useAdminMutationState();
+  const locale = i18n.resolvedLanguage || i18n.language;
+
+  useEffect(() => {
+    setAdditionalRequests([]);
+    setHasLoadedMoreRequests(false);
+    setHasMoreRequests(members.length === 50);
+  }, [members]);
+
+  async function loadMoreRequests() {
+    if (busy || !hasMoreRequests) return;
+    setBusy(true);
+    setHasLoadedMoreRequests(true);
+    try {
+      const page = await searchCommunityMembers({
+        data: {
+          community_id: community.id,
+          query: '',
+          status: 'pending',
+          offset: members.length + additionalRequests.length,
+          limit: 50
+        }
+      });
+      setAdditionalRequests((previous) => [...previous, ...page]);
+      setHasMoreRequests(page.length === 50);
+    } catch (error) {
+      setErrorKey(failed(error));
+    } finally {
+      setBusy(false);
+    }
+  }
+
+  async function memberAction(person: CommunityAdminMember, action: 'approve' | 'deny') {
+    if (busy) return;
+    setBusy(true);
+    setErrorKey('');
+    setMessage('');
+    try {
+      await (action === 'approve' ? approveCommunityMember : denyCommunityMember)({
+        data: { community_id: community.id, membership_id: person.membership_id }
+      });
+      setAdditionalRequests([]);
+      setHasLoadedMoreRequests(false);
+      setHasMoreRequests(members.length === 50);
+      setMessage(t(`communityAdmin.result.${action}`));
+      await router.invalidate();
+    } catch (error) {
+      setErrorKey(failed(error));
+    } finally {
+      setBusy(false);
+    }
+  }
+
+  return (
+    <AdminViewFrame communityId={communityId} communityName={community.name} screen="requests">
+      <p {...stylex.props(styles.banner)}>{t('communityAdmin.requestBanner')}</p>
+      <div {...stylex.props(styles.list)}>
+        {[...members, ...additionalRequests].map((person) => (
+          <SurfaceCard key={person.membership_id} xstyle={[styles.card, styles.requestCard]}>
+            <h3 {...stylex.props(styles.cardCompactTitle)}>{person.display_name}</h3>
+            <p {...stylex.props(styles.copy)}>{ratingLabel(person, t, locale)}</p>
+            <p {...stylex.props(styles.copy, styles.requestMeta)}>
+              {t('communityAdmin.requestMeta', {
+                date: dateLabel(person.valid_from, locale),
+                privacy: t('communityAdmin.requestPrivacy')
+              })}
+            </p>
+            <div {...stylex.props(styles.actions, styles.requestActions)}>
+              <Button busy={busy} onClick={() => void memberAction(person, 'approve')}>
+                {t('communityAdmin.action.approve')}
+              </Button>
+              <Button
+                variant="secondary"
+                busy={busy}
+                onClick={() => void memberAction(person, 'deny')}
+              >
+                {t('communityAdmin.action.deny')}
+              </Button>
+            </div>
+          </SurfaceCard>
+        ))}
+        {!members.length && !additionalRequests.length && (
+          <p>{t('communityAdmin.empty.requests')}</p>
+        )}
+        {hasMoreRequests ? (
+          <Button variant="secondary" busy={busy} onClick={() => void loadMoreRequests()}>
+            {t('communityAdmin.loadMore')}
+          </Button>
+        ) : (
+          hasLoadedMoreRequests && (
+            <p {...stylex.props(styles.copy)}>{t('communityAdmin.endOfList')}</p>
+          )
+        )}
+        <p {...stylex.props(styles.note)}>{t('communityAdmin.requestHistoryUnavailable')}</p>
+      </div>
+      {message && <output {...stylex.props(styles.status)}>{message}</output>}
+      {errorKey && (
+        <p role="alert" {...stylex.props(styles.error)}>
+          {t(`communityAdmin.error.${errorKey}`)}
+        </p>
+      )}
+    </AdminViewFrame>
+  );
+}
+
+function useAdminMutationState() {
+  const [busy, setBusy] = useState(false);
+  const [message, setMessage] = useState('');
+  const [errorKey, setErrorKey] = useState('');
+  return { busy, setBusy, message, setMessage, errorKey, setErrorKey };
+}
+
+function ratingLabel(
+  person: CommunityAdminMember,
+  t: ReturnType<typeof useTranslation>['t'],
+  locale: string
+) {
+  if (person.display_level === null || person.reliability_percent === null)
+    return t('communityAdmin.ratingsUnavailable');
+  return t('communityAdmin.levelLabel', {
+    level: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(person.display_level),
+    reliability: new Intl.NumberFormat(locale).format(person.reliability_percent)
+  });
+}
+
+function AdminViewFrame({
+  communityId,
+  communityName,
+  screen,
+  children,
+  headingRef
+}: {
+  communityId: string;
+  communityName: string;
+  screen: 'requests' | 'members' | 'member' | 'settings' | 'venues' | 'audit';
+  children: ReactNode;
+  headingRef?: React.RefObject<HTMLHeadingElement | null>;
+}) {
+  const { t } = useTranslation();
+  const items = [
+    { key: 'requests', to: '/community/$communityId/admin/requests' },
+    { key: 'members', to: '/community/$communityId/admin/members' },
+    { key: 'settings', to: '/community/$communityId/admin/settings' },
+    { key: 'venues', to: '/community/$communityId/admin/venues' },
+    { key: 'audit', to: '/community/$communityId/admin/audit' }
+  ] as const;
+  return (
+    <section
+      aria-labelledby="admin-screen-title"
+      {...stylex.props(styles.content, screen === 'venues' && styles.venueContent)}
+    >
+      <header {...stylex.props(styles.header)}>
+        <div {...stylex.props(styles.screenHeading)}>
+          <Link
+            to="/dashboard"
+            aria-label={t('communityAdmin.backToDashboard')}
+            {...stylex.props(styles.backLink)}
+          >
+            <span aria-hidden="true">‹</span>
+          </Link>
+          <div {...stylex.props(styles.titleGroup)}>
+            <h1
+              ref={headingRef}
+              tabIndex={-1}
+              id="admin-screen-title"
+              {...stylex.props(styles.title)}
+            >
+              {t(`communityAdmin.title.${screen}`)}
+            </h1>
+            <p {...stylex.props(styles.subtitle)}>
+              {t('communityAdmin.communityAdminSubtitle', { community: communityName })}
+            </p>
+          </div>
+        </div>
+      </header>
+      {children}
+      <nav aria-label={t('communityAdmin.navigation')} {...stylex.props(styles.bottomNav)}>
+        {items.map((item) => (
+          <Link
+            key={item.key}
+            to={item.to}
+            params={{ communityId }}
+            aria-current={item.key === screen ? 'page' : undefined}
+            {...stylex.props(styles.bottomNavLink)}
+          >
+            {t(`communityAdmin.nav.${item.key}`)}
+          </Link>
+        ))}
+      </nav>
+    </section>
+  );
+}
+
+function MemberView(props: ViewProps<'member'>) {
+  const { community, member, membershipId } = props;
+  const { t, i18n } = useTranslation();
+  const router = useRouter();
+  const params = useParams({ strict: false });
+  const communityId = params.communityId ?? '';
+  const { busy, setBusy, message, setMessage, errorKey, setErrorKey } = useAdminMutationState();
+  const [confirmation, setConfirmation] = useState<'demote' | 'remove' | null>(null);
+  const [completedConfirmation, setCompletedConfirmation] = useState<{
+    action: 'demote' | 'remove';
+    membershipId: string;
+  } | null>(null);
+  const [refreshError, setRefreshError] = useState(false);
+  const headingRef = useRef<HTMLHeadingElement>(null);
+  const cancelRef = useRef<HTMLElement>(null);
+  const triggerRef = useRef<HTMLButtonElement>(null);
+  const locale = i18n.resolvedLanguage || i18n.language;
+
+  async function memberAction(
+    action: 'approve' | 'deny' | 'remove' | 'reactivate' | 'promote' | 'demote'
+  ): Promise<boolean> {
+    if (busy) return false;
+    setBusy(true);
+    setErrorKey('');
+    setRefreshError(false);
+    setMessage('');
+    const actions = {
+      approve: approveCommunityMember,
+      deny: denyCommunityMember,
+      remove: removeCommunityMember,
+      reactivate: reactivateCommunityMember,
+      promote: promoteCommunityMember,
+      demote: demoteCommunityMember
+    };
+    let result: unknown;
+    try {
+      result = await actions[action]({
+        data: { community_id: community.id, membership_id: membershipId }
+      });
+    } catch (error) {
+      setErrorKey(failed(error));
+      setBusy(false);
+      return false;
+    }
+
+    setMessage(t(`communityAdmin.result.${action}`));
+    try {
+      await router.invalidate();
+      if (
+        action === 'reactivate' &&
+        typeof result === 'object' &&
+        result !== null &&
+        'membership_id' in result &&
+        typeof result.membership_id === 'string'
+      ) {
+        await router.navigate({
+          to: '/community/$communityId/admin/members/$membershipId',
+          params: { communityId: community.id, membershipId: result.membership_id }
+        });
+      }
+    } catch {
+      setErrorKey('generic');
+      setRefreshError(true);
+    }
+    setBusy(false);
+    return true;
+  }
+
+  function requestMemberAction(
+    action: 'approve' | 'deny' | 'remove' | 'reactivate' | 'promote' | 'demote',
+    trigger?: HTMLButtonElement
+  ) {
+    if (action === 'remove' || action === 'demote') {
+      if (trigger) triggerRef.current = trigger;
+      setConfirmation(action);
+    } else {
+      void memberAction(action).then((succeeded) => {
+        if (succeeded) setCompletedConfirmation(null);
+      });
+    }
+  }
+
+  async function confirmMemberAction() {
+    if (!confirmation || busy) return;
+    if (await memberAction(confirmation)) {
+      setCompletedConfirmation({ action: confirmation, membershipId });
+      setConfirmation(null);
+    }
+  }
+
+  async function retryRefresh() {
+    if (busy) return;
+    setBusy(true);
+    try {
+      await router.invalidate();
+      setErrorKey('');
+      setRefreshError(false);
+    } catch {
+      setErrorKey('generic');
+      setRefreshError(true);
+    } finally {
+      setBusy(false);
+    }
+  }
+
+  return (
+    <AdminViewFrame
+      communityId={communityId}
+      communityName={community.name}
+      screen="member"
+      headingRef={headingRef}
+    >
+      {member.status === 'active' && (
+        <p {...stylex.props(styles.banner)}>{t('communityAdmin.memberActiveBanner')}</p>
+      )}
+      <SurfaceCard
+        data-testid="community-member-profile"
+        xstyle={[styles.card, styles.memberProfileCard]}
+      >
+        <h3 {...stylex.props(styles.memberProfileTitle)}>
+          {member.display_level === null || member.reliability_percent === null
+            ? t('communityAdmin.memberAdminProfileMissing', { name: member.display_name })
+            : t('communityAdmin.memberAdminProfile', {
+                name: member.display_name,
+                level: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
+                  member.display_level
+                ),
+                reliability: new Intl.NumberFormat(locale).format(member.reliability_percent)
+              })}
+        </h3>
+        <p {...stylex.props(styles.copy)}>
+          {t('communityAdmin.memberMeta', {
+            status: t(`communityAdmin.status.${member.status}`),
+            role: t(`communityAdmin.role.${member.role}`),
+            date: dateLabel(member.valid_from, locale)
+          })}
+        </p>
+      </SurfaceCard>
+      <SurfaceCard data-testid="community-member-role-panel" xstyle={styles.rolePanel}>
+        <p {...stylex.props(styles.rolePanelTitle)}>{t('communityAdmin.rolePanelTitle')}</p>
+        <p {...stylex.props(styles.rolePanelCopy)}>
+          {t('communityAdmin.rolePanelActive', { role: t(`communityAdmin.role.${member.role}`) })}
+        </p>
+        <p {...stylex.props(styles.rolePanelCopy)}>{t('communityAdmin.rolePanelInactive')}</p>
+      </SurfaceCard>
+      <div {...stylex.props(styles.form, styles.actions)}>
+        {member.status === 'pending' && (
+          <>
+            <Button busy={busy} onClick={() => requestMemberAction('approve')}>
+              {t('communityAdmin.action.approve')}
+            </Button>
+            <Button variant="secondary" busy={busy} onClick={() => requestMemberAction('deny')}>
+              {t('communityAdmin.action.deny')}
+            </Button>
+          </>
+        )}
+        {member.status === 'inactive' && (
+          <Button busy={busy} onClick={() => requestMemberAction('reactivate')}>
+            {t('communityAdmin.action.reactivate')}
+          </Button>
+        )}
+        {member.status === 'active' && member.role === 'member' && (
+          <Button
+            variant="secondary"
+            busy={busy}
+            xstyle={styles.softAction}
+            onClick={() => requestMemberAction('promote')}
+          >
+            {t('communityAdmin.action.promote')}
+          </Button>
+        )}
+        {member.status === 'active' &&
+          member.role === 'admin' &&
+          !(
+            completedConfirmation?.membershipId === membershipId &&
+            completedConfirmation.action === 'demote'
+          ) && (
+            <Button
+              variant="secondary"
+              busy={busy}
+              onClick={(event) => requestMemberAction('demote', event.currentTarget)}
+            >
+              {t('communityAdmin.action.demote')}
+            </Button>
+          )}
+        {member.status === 'active' &&
+          !(
+            completedConfirmation?.membershipId === membershipId &&
+            completedConfirmation.action === 'remove'
+          ) && (
+            <Button
+              variant="secondary"
+              busy={busy}
+              onClick={(event) => requestMemberAction('remove', event.currentTarget)}
+            >
+              {t('communityAdmin.action.remove')}
+            </Button>
+          )}
+      </div>
+      <AlertDialog.Root
+        open={confirmation !== null}
+        onOpenChange={(open) => {
+          if (!open && !busy) setConfirmation(null);
+        }}
+      >
+        <AlertDialog.Portal>
+          <AlertDialog.Backdrop {...stylex.props(styles.confirmBackdrop)} />
+          <AlertDialog.Viewport {...stylex.props(styles.confirmViewport)}>
+            <AlertDialog.Popup
+              initialFocus={() => cancelRef.current}
+              finalFocus={() =>
+                triggerRef.current?.isConnected ? triggerRef.current : headingRef.current
+              }
+              onKeyDown={(event) => {
+                if (event.key !== 'Tab') return;
+                const controls = event.currentTarget.querySelectorAll<HTMLElement>(
+                  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
+                );
+                const first = controls.item(0);
+                const last = controls.item(controls.length - 1);
+                if (event.shiftKey && document.activeElement === first) {
+                  event.preventDefault();
+                  last?.focus();
+                } else if (!event.shiftKey && document.activeElement === last) {
+                  event.preventDefault();
+                  first?.focus();
+                }
+              }}
+              {...stylex.props(styles.confirmDialog)}
+            >
+              <AlertDialog.Title {...stylex.props(styles.confirmTitle)}>
+                {t('communityAdmin.confirm', {
+                  action: confirmation ? t(`communityAdmin.action.${confirmation}`) : '',
+                  name: member.display_name
+                })}
+              </AlertDialog.Title>
+              <div {...stylex.props(styles.actions)}>
+                <Button busy={busy} onClick={() => void confirmMemberAction()}>
+                  {t('communityAdmin.confirmAction')}
+                </Button>
+                {confirmation && errorKey && !refreshError && (
+                  <>
+                    <p role="alert" {...stylex.props(styles.error)}>
+                      {t(`communityAdmin.error.${errorKey}`)}
+                    </p>
+                    <Button
+                      variant="secondary"
+                      busy={busy}
+                      onClick={() => void confirmMemberAction()}
+                    >
+                      {t('communityAdmin.retry')}
+                    </Button>
+                  </>
+                )}
+                <AlertDialog.Close
+                  render={
+                    <Button
+                      ref={(node) => {
+                        cancelRef.current = node;
+                        if (node && confirmation) node.focus();
+                      }}
+                      variant="secondary"
+                      disabled={busy}
+                      onClick={() => setConfirmation(null)}
+                    />
+                  }
+                >
+                  {t('communityAdmin.cancel')}
+                </AlertDialog.Close>
+              </div>
+            </AlertDialog.Popup>
+          </AlertDialog.Viewport>
+        </AlertDialog.Portal>
+      </AlertDialog.Root>
+      <p {...stylex.props(styles.note)}>{t('communityAdmin.levelReadOnly')}</p>
+      {message && <output {...stylex.props(styles.status)}>{message}</output>}
+      {errorKey && (!confirmation || refreshError) && (
+        <p role="alert" {...stylex.props(styles.error)}>
+          {t(`communityAdmin.error.${errorKey}`)}
+        </p>
+      )}
+      {errorKey && (!confirmation || refreshError) && (
+        <Button variant="secondary" busy={busy} onClick={() => void retryRefresh()}>
+          {t('communityAdmin.retry')}
+        </Button>
+      )}
+    </AdminViewFrame>
+  );
+}
+
+function SettingsView(props: ViewProps<'settings'>) {
+  const { community } = props;
+  const { t } = useTranslation();
+  const router = useRouter();
+  const params = useParams({ strict: false });
+  const communityId = params.communityId ?? '';
+  const [settings, setSettings] = useState({
+    name: community.name,
+    description: community.description ?? '',
+    city_label: community.city_label ?? '',
+    visibility: community.visibility,
+    join_policy: community.join_policy
+  });
+  const { busy, setBusy, message, setMessage, errorKey, setErrorKey } = useAdminMutationState();
+
+  async function saveSettings(event: FormEvent<HTMLFormElement>) {
+    event.preventDefault();
+    if (busy) return;
+    setBusy(true);
+    setErrorKey('');
+    setMessage('');
+    try {
+      await updateCommunitySettings({ data: { community_id: community.id, ...settings } });
+      setSettings({ ...settings });
+      setMessage(t('communityAdmin.result.settings'));
+      try {
+        await router.invalidate();
+      } catch {
+        setErrorKey('generic');
+      }
+    } catch (error) {
+      setErrorKey(failed(error));
+    } finally {
+      setBusy(false);
+    }
+  }
+
+  return (
+    <AdminViewFrame communityId={communityId} communityName={community.name} screen="settings">
+      <form
+        onSubmit={(event) => void saveSettings(event)}
+        {...stylex.props(styles.form, styles.settingsForm)}
+      >
+        <SurfaceCard data-testid="settings-visibility-label" xstyle={styles.settingsCard}>
+          <span {...stylex.props(styles.fieldLabel)}>
+            {t('communityAdmin.settings.visibility')}
+          </span>
+        </SurfaceCard>
+        <select
+          id="community-visibility"
+          data-testid="settings-visibility-control"
+          value={settings.visibility}
+          aria-label={t('communityAdmin.settings.visibility')}
+          onChange={(event) =>
+            setSettings({
+              ...settings,
+              visibility: event.target.value === 'public' ? 'public' : 'private'
+            })
+          }
+          {...stylex.props(styles.settingChoice)}
+        >
+          <option value="public">{t('communityAdmin.visibility.public')}</option>
+          <option value="private">{t('communityAdmin.visibility.private')}</option>
+        </select>
+        <select
+          id="community-join-policy"
+          data-testid="settings-join-policy-control"
+          value={settings.join_policy}
+          aria-label={t('communityAdmin.settings.joinPolicy')}
+          onChange={(event) =>
+            setSettings({
+              ...settings,
+              join_policy: event.target.value === 'instant' ? 'instant' : 'admin_approval'
+            })
+          }
+          {...stylex.props(styles.settingChoice)}
+        >
+          <option value="instant">{t('communityAdmin.joinPolicy.instant')}</option>
+          <option value="admin_approval">{t('communityAdmin.joinPolicy.adminApproval')}</option>
+        </select>
+        <SurfaceCard xstyle={styles.settingsUnavailableCard}>
+          <p {...stylex.props(styles.copy)}>{t('communityAdmin.settingsUnavailable')}</p>
+          <details {...stylex.props(styles.details)}>
+            <summary {...stylex.props(styles.detailsSummary)}>
+              {t('communityAdmin.settings.details')}
+            </summary>
+            <div {...stylex.props(styles.form)}>
+              <TextField
+                id="community-admin-name"
+                label={t('communityAdmin.settings.name')}
+                value={settings.name}
+                maxLength={80}
+                onChange={(event) => setSettings({ ...settings, name: event.target.value })}
+                required
+              />
+              <TextField
+                id="community-admin-city"
+                label={t('communityAdmin.settings.city')}
+                value={settings.city_label}
+                maxLength={120}
+                onChange={(event) => setSettings({ ...settings, city_label: event.target.value })}
+              />
+              <TextField
+                id="community-admin-description"
+                label={t('communityAdmin.settings.description')}
+                value={settings.description}
+                maxLength={500}
+                onChange={(event) => setSettings({ ...settings, description: event.target.value })}
+              />
+            </div>
+          </details>
+        </SurfaceCard>
+        <Button type="submit" busy={busy}>
+          {t('communityAdmin.save')}
+        </Button>
+        <p {...stylex.props(styles.note)}>{t('communityAdmin.settingsAdminNote')}</p>
+      </form>
+      {message && <output {...stylex.props(styles.status)}>{message}</output>}
+      {errorKey && (
+        <p role="alert" {...stylex.props(styles.error)}>
+          {t(`communityAdmin.error.${errorKey}`)}
+        </p>
+      )}
+      {errorKey && (
+        <Button variant="secondary" onClick={() => void router.invalidate()}>
+          {t('communityAdmin.retry')}
+        </Button>
+      )}
+    </AdminViewFrame>
+  );
+}
+
+function VenuesView({ community, venues }: ViewProps<'venues'>) {
+  const { t } = useTranslation();
+  const router = useRouter();
+  const params = useParams({ strict: false });
+  const communityId = params.communityId ?? '';
+  const [additionalVenues, setAdditionalVenues] = useState<CommunityAdminVenue[]>([]);
+  const [hasLoadedMoreVenues, setHasLoadedMoreVenues] = useState(false);
+  const [hasMoreVenues, setHasMoreVenues] = useState(venues.length === 50);
+  const [venueDraft, setVenueDraft] = useState({ id: '', name: '', address: '', maps_url: '' });
+  const [venueFormOpen, setVenueFormOpen] = useState(false);
+  const [paginationPending, setPaginationPending] = useState(false);
+  const sourceRef = useRef(venues);
+  const requestGeneration = useRef(0);
+  const { busy, setBusy, message, setMessage, errorKey, setErrorKey } = useAdminMutationState();
+
+  useEffect(() => {
+    if (sourceRef.current === venues) return;
+    sourceRef.current = venues;
+    requestGeneration.current += 1;
+    setPaginationPending(false);
+    setAdditionalVenues([]);
+    setHasLoadedMoreVenues(false);
+    setHasMoreVenues(venues.length === 50);
+  }, [venues]);
+
+  async function run(action: () => Promise<unknown>, success: string) {
+    if (busy || paginationPending) return false;
+    setBusy(true);
+    setErrorKey('');
+    setMessage('');
+    try {
+      await action();
+      setAdditionalVenues([]);
+      setHasLoadedMoreVenues(false);
+      setHasMoreVenues(venues.length === 50);
+      setMessage(success);
+      try {
+        await router.invalidate();
+      } catch {
+        setErrorKey('generic');
+      }
+      return true;
+    } catch (error) {
+      setErrorKey(failed(error));
+      return false;
+    } finally {
+      setBusy(false);
+    }
+  }
+
+  async function saveVenue(event: FormEvent<HTMLFormElement>) {
+    event.preventDefault();
+    const data = {
+      community_id: community.id,
+      name: venueDraft.name,
+      address: venueDraft.address || null,
+      maps_url: venueDraft.maps_url || null
+    };
+    const saved = await run(
+      () =>
+        venueDraft.id
+          ? editCommunityVenue({ data: { ...data, venue_id: venueDraft.id } })
+          : addCommunityVenue({ data }),
+      t(venueDraft.id ? 'communityAdmin.result.venueUpdated' : 'communityAdmin.result.venueAdded')
+    );
+    if (saved) {
+      setVenueFormOpen(false);
+      setVenueDraft({ id: '', name: '', address: '', maps_url: '' });
+    }
+  }
+
+  async function loadMoreVenues() {
+    if (busy || paginationPending || !hasMoreVenues) return;
+    setPaginationPending(true);
+    setHasLoadedMoreVenues(true);
+    const source = venues;
+    const generation = ++requestGeneration.current;
+    try {
+      const page = await listCommunityVenues({
+        data: {
+          community_id: community.id,
+          offset: venues.length + additionalVenues.length,
+          limit: 50
+        }
+      });
+      if (sourceRef.current !== source || requestGeneration.current !== generation) return;
+      setAdditionalVenues((previous) => [...previous, ...page]);
+      setHasMoreVenues(page.length === 50);
+    } catch (error) {
+      if (sourceRef.current === source && requestGeneration.current === generation)
+        setErrorKey(failed(error));
+    } finally {
+      if (requestGeneration.current === generation) setPaginationPending(false);
+    }
+  }
+
+  return (
+    <AdminViewFrame communityId={communityId} communityName={community.name} screen="venues">
+      {!venueFormOpen && (
+        <Button busy={busy || paginationPending} onClick={() => setVenueFormOpen(true)}>
+          {t('communityAdmin.venue.add')}
+        </Button>
+      )}
+      {venueFormOpen && (
+        <SurfaceCard xstyle={styles.card}>
+          <h3 {...stylex.props(styles.cardTitle)}>
+            {t(venueDraft.id ? 'communityAdmin.venue.edit' : 'communityAdmin.venue.add')}
+          </h3>
+          <form onSubmit={(event) => void saveVenue(event)} {...stylex.props(styles.form)}>
+            <TextField
+              id="venue-name"
+              label={t('communityAdmin.venue.name')}
+              value={venueDraft.name}
+              maxLength={120}
+              required
+              onChange={(event) => setVenueDraft({ ...venueDraft, name: event.target.value })}
+            />
+            <TextField
+              id="venue-address"
+              label={t('communityAdmin.venue.address')}
+              value={venueDraft.address}
+              maxLength={300}
+              onChange={(event) => setVenueDraft({ ...venueDraft, address: event.target.value })}
+            />
+            <TextField
+              id="venue-map"
+              label={t('communityAdmin.venue.mapsUrl')}
+              value={venueDraft.maps_url}
+              maxLength={2048}
+              type="url"
+              onChange={(event) => setVenueDraft({ ...venueDraft, maps_url: event.target.value })}
+            />
+            <p {...stylex.props(styles.note)}>{t('communityAdmin.photoUnavailable')}</p>
+            <Button type="submit" busy={busy || paginationPending}>
+              {t('communityAdmin.save')}
+            </Button>
+          </form>
+          <Button
+            variant="secondary"
+            onClick={() => {
+              setVenueFormOpen(false);
+              setVenueDraft({ id: '', name: '', address: '', maps_url: '' });
+            }}
+          >
+            {t('communityAdmin.cancel')}
+          </Button>
+        </SurfaceCard>
+      )}
+      <div {...stylex.props(styles.list)}>
+        {[...venues, ...additionalVenues].map((venue) => (
+          <SurfaceCard
+            key={venue.id}
+            data-testid="community-venue-card"
+            xstyle={[styles.card, styles.venueCard]}
+          >
+            <h3 {...stylex.props(styles.cardCompactTitle)}>{venue.name}</h3>
+            <div {...stylex.props(styles.venueMeta)}>
+              <p {...stylex.props(styles.copy)}>
+                {venue.address || community.city_label || t('communityAdmin.cityUnavailable')}
+              </p>
+              {venue.maps_url && (
+                <a
+                  href={venue.maps_url}
+                  target="_blank"
+                  rel="noreferrer"
+                  {...stylex.props(styles.memberLink, styles.venueMapLink)}
+                >
+                  {t('communityAdmin.venue.openMap')}
+                </a>
+              )}
+            </div>
+            <div {...stylex.props(styles.venueActions)}>
+              <Button
+                variant="secondary"
+                xstyle={styles.venueAction}
+                busy={busy || paginationPending}
+                onClick={() => {
+                  setVenueDraft({
+                    id: venue.id,
+                    name: venue.name,
+                    address: venue.address ?? '',
+                    maps_url: venue.maps_url ?? ''
+                  });
+                  setVenueFormOpen(true);
+                }}
+              >
+                {t('communityAdmin.venue.edit')}
+              </Button>
+              <Button
+                variant="secondary"
+                xstyle={styles.venueAction}
+                busy={busy || paginationPending}
+                onClick={() =>
+                  void run(
+                    () =>
+                      archiveCommunityVenue({
+                        data: { community_id: community.id, venue_id: venue.id }
+                      }),
+                    t('communityAdmin.result.venueArchived')
+                  )
+                }
+              >
+                {t('communityAdmin.venue.archive')}
+              </Button>
+            </div>
+          </SurfaceCard>
+        ))}
+        {!venues.length && !additionalVenues.length && <p>{t('communityAdmin.empty.venues')}</p>}
+      </div>
+      {hasMoreVenues ? (
+        <Button
+          variant="secondary"
+          busy={busy || paginationPending}
+          onClick={() => void loadMoreVenues()}
+        >
+          {t('communityAdmin.loadMore')}
+        </Button>
+      ) : (
+        hasLoadedMoreVenues && <p {...stylex.props(styles.copy)}>{t('communityAdmin.endOfList')}</p>
+      )}
+      <p {...stylex.props(styles.note)}>{t('communityAdmin.venue.historyNote')}</p>
+      {message && <output {...stylex.props(styles.status)}>{message}</output>}
+      {errorKey && (
+        <p role="alert" {...stylex.props(styles.error)}>
+          {t(`communityAdmin.error.${errorKey}`)}
+        </p>
+      )}
+      {errorKey && (
+        <Button variant="secondary" onClick={() => void router.invalidate()}>
+          {t('communityAdmin.retry')}
+        </Button>
+      )}
+    </AdminViewFrame>
+  );
+}
+
+function AuditView(props: ViewProps<'audit'>) {
+  const { community, audit } = props;
+  const { t, i18n } = useTranslation();
+  const router = useRouter();
+  const params = useParams({ strict: false });
+  const communityId = params.communityId ?? '';
+  const [additionalAudit, setAdditionalAudit] = useState<{
+    source: CommunityAdminAudit[];
+    rows: CommunityAdminAudit[];
+  }>({ source: audit, rows: [] });
+  const auditSourceRef = useRef(audit);
+  const auditGeneration = useRef(0);
+  const [hasMoreAudit, setHasMoreAudit] = useState(audit.length === 3);
+  const [hasLoadedMoreAudit, setHasLoadedMoreAudit] = useState(false);
+  const { message, setMessage, errorKey, setErrorKey } = useAdminMutationState();
+  const [paginationPending, setPaginationPending] = useState(false);
+  const locale = i18n.resolvedLanguage || i18n.language;
+  const auditRows = additionalAudit.source === audit ? [...audit, ...additionalAudit.rows] : audit;
+
+  useEffect(() => {
+    if (auditSourceRef.current === audit) return;
+    auditSourceRef.current = audit;
+    auditGeneration.current += 1;
+    setPaginationPending(false);
+    setAdditionalAudit({ source: audit, rows: [] });
+    setHasMoreAudit(audit.length === 3);
+    setHasLoadedMoreAudit(false);
+  }, [audit]);
+
+  async function loadMoreAudit() {
+    if (paginationPending || !hasMoreAudit) return;
+    setPaginationPending(true);
+    setHasLoadedMoreAudit(true);
+    const source = audit;
+    const generation = ++auditGeneration.current;
+    try {
+      const page = await listCommunityAudit({
+        data: { community_id: community.id, offset: auditRows.length, limit: 3 }
+      });
+      if (auditSourceRef.current !== source || auditGeneration.current !== generation) return;
+      setAdditionalAudit((previous) => ({
+        source,
+        rows: previous.source === source ? [...previous.rows, ...page] : page
+      }));
+      setHasMoreAudit(page.length === 3);
+    } catch (error) {
+      if (auditSourceRef.current === source && auditGeneration.current === generation)
+        setErrorKey(failed(error));
+    } finally {
+      if (auditGeneration.current === generation) setPaginationPending(false);
+    }
+  }
+
+  return (
+    <AdminViewFrame communityId={communityId} communityName={community.name} screen="audit">
+      <div {...stylex.props(styles.list)}>
+        <p {...stylex.props(styles.banner)}>{t('communityAdmin.audit.recentChanges')}</p>
+        {auditRows.map((event) => (
+          <SurfaceCard
+            key={event.id}
+            data-testid="community-audit-event"
+            xstyle={[styles.card, styles.auditCard]}
+          >
+            <p {...stylex.props(styles.auditAction)}>
+              {t(auditEventKey(event), { defaultValue: t('communityAdmin.audit.unknown') })}
+              {auditMemberDetails(event) &&
+                ` · ${t(`communityAdmin.role.${auditMemberDetails(event)?.role}`)} · ${t(`communityAdmin.status.${auditMemberDetails(event)?.status}`)}`}
+            </p>
+            <p {...stylex.props(styles.copy)}>
+              {t('communityAdmin.audit.unknownActor')} · {auditDateLabel(event.occurred_at, locale)}
+            </p>
+            {event.entity === 'community_members' && (
+              <Link
+                to="/community/$communityId/admin/members/$membershipId"
+                params={{ communityId, membershipId: event.entity_id }}
+                {...stylex.props(styles.memberLink)}
+              >
+                {t('communityAdmin.audit.openMember')}
+              </Link>
+            )}
+          </SurfaceCard>
+        ))}
+        {!auditRows.length && <p>{t('communityAdmin.empty.audit')}</p>}
+        {hasMoreAudit ? (
+          <Button variant="secondary" busy={paginationPending} onClick={() => void loadMoreAudit()}>
+            {t('communityAdmin.loadMore')}
+          </Button>
+        ) : (
+          hasLoadedMoreAudit && (
+            <p {...stylex.props(styles.copy)}>{t('communityAdmin.endOfList')}</p>
+          )
+        )}
+      </div>
+      {message && <output {...stylex.props(styles.status)}>{message}</output>}
+      {errorKey && (
+        <p role="alert" {...stylex.props(styles.error)}>
+          {t(`communityAdmin.error.${errorKey}`)}
+        </p>
+      )}
+      {errorKey && (
+        <Button
+          variant="secondary"
+          onClick={() => {
+            setMessage('');
+            setErrorKey('');
+            void router.invalidate();
+          }}
+        >
+          {t('communityAdmin.retry')}
+        </Button>
+      )}
+    </AdminViewFrame>
+  );
+}
+
+function auditDateLabel(value: string, locale: string) {
+  return new Intl.DateTimeFormat(locale, {
+    dateStyle: 'medium',
+    timeStyle: 'short',
+    timeZone: 'UTC'
+  }).format(new Date(value));
+}
+
+function auditEventKey(event: CommunityAdminAudit) {
+  const action = event.action.toLowerCase();
+  const details = event.details;
+  if (
+    event.entity === 'community_members' &&
+    action === 'insert' &&
+    typeof details === 'object' &&
+    details !== null &&
+    'status' in details &&
+    details.status === 'pending'
+  )
+    return 'communityAdmin.audit.requestCreated';
+  if (event.entity === 'community_venues')
+    return action === 'insert'
+      ? 'communityAdmin.audit.venueAdded'
+      : 'communityAdmin.audit.venueUpdated';
+  if (event.entity === 'community_members')
+    return action === 'insert'
+      ? 'communityAdmin.audit.memberAdded'
+      : 'communityAdmin.audit.memberUpdated';
+  if (event.entity === 'communities') return 'communityAdmin.audit.settingsUpdated';
+  if (event.entity === 'community_invitations')
+    return action === 'insert'
+      ? 'communityAdmin.audit.invitationAdded'
+      : 'communityAdmin.audit.invitationUpdated';
+  return 'communityAdmin.audit.unknown';
+}
+
+function auditMemberDetails(event: CommunityAdminAudit) {
+  if (event.entity !== 'community_members' || typeof event.details !== 'object' || !event.details)
+    return null;
+  const role =
+    'role' in event.details && (event.details.role === 'admin' || event.details.role === 'member')
+      ? event.details.role
+      : null;
+  const status =
+    'status' in event.details &&
+    (event.details.status === 'active' ||
+      event.details.status === 'pending' ||
+      event.details.status === 'inactive')
+      ? event.details.status
+      : null;
+  return role && status ? { role, status } : null;
+}
+
+export function CommunityAdminDispatcher(props: CommunityAdminScreenProps) {
+  switch (props.screen) {
+    case 'requests':
+      return <RequestsView {...props} />;
+    case 'members':
+      return <MembersView {...props} />;
+    case 'member':
+      return <MemberView {...props} />;
+    case 'settings':
+      return <SettingsView {...props} />;
+    case 'venues':
+      return <VenuesView {...props} />;
+    case 'audit':
+      return <AuditView {...props} />;
+  }
+  return null;
+}
diff --git a/src/features/community/CommunityOnboarding.tsx b/src/features/community/CommunityOnboarding.tsx
index f37932b..eee9a37 100644
--- a/src/features/community/CommunityOnboarding.tsx
+++ b/src/features/community/CommunityOnboarding.tsx
@@ -3,7 +3,7 @@ import { RadioGroup } from '@base-ui/react/radio-group';
 import * as stylex from '@stylexjs/stylex';
 import { useEffect, useRef, useState, type FormEvent } from 'react';
 import { useTranslation } from 'react-i18next';
-import { useNavigate, useRouter } from '@tanstack/react-router';
+import { useNavigate, useRouter, useRouterState } from '@tanstack/react-router';
 import { Button } from '../../components/ui/Button';
 import { StepBadge } from '../../components/ui/StepBadge';
 import { SurfaceCard } from '../../components/ui/SurfaceCard';
@@ -24,6 +24,14 @@ export function CommunityOnboarding({ search, data }: { search: Search; data: Pa
   const { t } = useTranslation();
   const navigate = useNavigate();
   const router = useRouter();
+  const routePending = useRouterState({
+    select: (state) =>
+      state.matches.some(
+        (match) =>
+          match.routeId === '/onboarding_/community' &&
+          (match.status === 'pending' || match.isFetching)
+      )
+  });
   const [draft, setDraft] = useState(search.q ?? '');
   const [more, setMore] = useState<{ query: string; source: Page; page: Page } | null>(null);
   const [loadingMore, setLoadingMore] = useState(false);
@@ -212,59 +220,71 @@ export function CommunityOnboarding({ search, data }: { search: Search; data: Pa
             </p>
           )}
           {listError && (
-            <Button variant="secondary" onClick={() => void router.invalidate()}>
+            <Button
+              variant="secondary"
+              busy={routePending}
+              disabled={routePending}
+              onClick={() => void router.invalidate()}
+            >
               {t('communityOnboarding.retry')}
             </Button>
           )}
-          {current && !listError && !rows.length && (
-            <output {...stylex.props(ui.help)}>
-              {t(
-                search.q ? 'communityOnboarding.emptySearch' : 'communityOnboarding.noCommunities'
-              )}
-            </output>
+          {(routePending || (!current && search.view !== 'create')) && (
+            <output {...stylex.props(ui.status)}>{t('communityOnboarding.searchLoading')}</output>
           )}
-          {rows.map((community) => (
-            <SurfaceCard key={community.id} xstyle={ui.card}>
-              <h3 {...stylex.props(ui.cardTitle)}>{community.name}</h3>
-              <p {...stylex.props(ui.meta)}>
-                {t('communityOnboarding.cityPolicy', {
-                  city: community.city_label || t('communityOnboarding.cityUnknown'),
-                  policy: t(
-                    community.join_policy === 'instant'
-                      ? 'communityOnboarding.openJoin'
-                      : 'communityOnboarding.approvalRequired'
-                  )
-                })}
-              </p>
-              {results[community.id] && (
-                <output
-                  {...stylex.props(results[community.id] === 'joinFailed' ? ui.error : ui.status)}
-                >
-                  {t(`communityOnboarding.${results[community.id]}`)}
-                </output>
-              )}
-              <Button
-                variant="secondary"
-                xstyle={[
-                  ui.cardAction,
-                  community.join_policy === 'admin_approval' && ui.requestAction
-                ]}
-                busy={joining === community.id}
-                disabled={Boolean(results[community.id]) && results[community.id] !== 'joinFailed'}
-                onClick={() => void join(community)}
-              >
+          <div aria-busy={routePending || !current} {...stylex.props(ui.results)}>
+            {current && !routePending && !listError && !rows.length && (
+              <output {...stylex.props(ui.help)}>
                 {t(
-                  joining === community.id
-                    ? community.join_policy === 'instant'
-                      ? 'communityOnboarding.joining'
-                      : 'communityOnboarding.requesting'
-                    : community.join_policy === 'instant'
-                      ? 'communityOnboarding.join'
-                      : 'communityOnboarding.requestToJoin'
+                  search.q ? 'communityOnboarding.emptySearch' : 'communityOnboarding.noCommunities'
+                )}
+              </output>
+            )}
+            {rows.map((community) => (
+              <SurfaceCard key={community.id} xstyle={ui.card}>
+                <h3 {...stylex.props(ui.cardTitle)}>{community.name}</h3>
+                <p {...stylex.props(ui.meta)}>
+                  {t('communityOnboarding.cityPolicy', {
+                    city: community.city_label || t('communityOnboarding.cityUnknown'),
+                    policy: t(
+                      community.join_policy === 'instant'
+                        ? 'communityOnboarding.openJoin'
+                        : 'communityOnboarding.approvalRequired'
+                    )
+                  })}
+                </p>
+                {results[community.id] && (
+                  <output
+                    {...stylex.props(results[community.id] === 'joinFailed' ? ui.error : ui.status)}
+                  >
+                    {t(`communityOnboarding.${results[community.id]}`)}
+                  </output>
                 )}
-              </Button>
-            </SurfaceCard>
-          ))}
+                <Button
+                  variant="secondary"
+                  xstyle={[
+                    ui.cardAction,
+                    community.join_policy === 'admin_approval' && ui.requestAction
+                  ]}
+                  busy={joining === community.id}
+                  disabled={
+                    Boolean(results[community.id]) && results[community.id] !== 'joinFailed'
+                  }
+                  onClick={() => void join(community)}
+                >
+                  {t(
+                    joining === community.id
+                      ? community.join_policy === 'instant'
+                        ? 'communityOnboarding.joining'
+                        : 'communityOnboarding.requesting'
+                      : community.join_policy === 'instant'
+                        ? 'communityOnboarding.join'
+                        : 'communityOnboarding.requestToJoin'
+                  )}
+                </Button>
+              </SurfaceCard>
+            ))}
+          </div>
           {nextOffset !== null && (
             <Button variant="secondary" busy={loadingMore} onClick={() => void loadMore()}>
               {t('communityOnboarding.loadMore')}
@@ -407,28 +427,30 @@ function CreateCommunityView({ onBack }: { onBack: () => void }) {
             <span {...stylex.props(ui.label, ui.optionalHeading)}>
               {t('communityOnboarding.optionalDetails')}
             </span>
-            <label {...stylex.props(ui.hidden)} htmlFor="community-description">
-              {t('communityOnboarding.descriptionLabel')}
-            </label>
-            <input
-              id="community-description"
-              {...stylex.props(ui.optionalInput)}
-              placeholder={t('communityOnboarding.descriptionExample')}
-              value={description}
-              onChange={(event) => setDescription(event.target.value)}
-              maxLength={500}
-            />
-            <label {...stylex.props(ui.hidden)} htmlFor="community-city">
-              {t('communityOnboarding.cityLabel')}
-            </label>
-            <input
-              id="community-city"
-              {...stylex.props(ui.optionalInput, ui.divider)}
-              placeholder={t('communityOnboarding.cityExample')}
-              value={city}
-              onChange={(event) => setCity(event.target.value)}
-              maxLength={120}
-            />
+            <div {...stylex.props(ui.optionalField)}>
+              <label {...stylex.props(ui.floatingLabel)} htmlFor="community-description">
+                {t('communityOnboarding.descriptionLabel')}
+              </label>
+              <input
+                id="community-description"
+                {...stylex.props(ui.optionalInput, ui.labeledInput)}
+                value={description}
+                onChange={(event) => setDescription(event.target.value)}
+                maxLength={500}
+              />
+            </div>
+            <div {...stylex.props(ui.optionalField, ui.divider)}>
+              <label {...stylex.props(ui.floatingLabel)} htmlFor="community-city">
+                {t('communityOnboarding.cityLabel')}
+              </label>
+              <input
+                id="community-city"
+                {...stylex.props(ui.optionalInput, ui.labeledInput)}
+                value={city}
+                onChange={(event) => setCity(event.target.value)}
+                maxLength={120}
+              />
+            </div>
           </SurfaceCard>
           <p {...stylex.props(ui.help)}>{t('communityOnboarding.adminNote')}</p>
           {createError && (
diff --git a/src/features/community/community-admin.functions.ts b/src/features/community/community-admin.functions.ts
index f5b281a..3f2cad3 100644
--- a/src/features/community/community-admin.functions.ts
+++ b/src/features/community/community-admin.functions.ts
@@ -3,6 +3,7 @@ import { requireAuthenticatedClient } from '../auth/auth.server';
 import type { CommunityMemberSearchResult } from './community-admin.types';
 import {
   validateInvitation,
+  validateCommunityId,
   validateMemberAction,
   validatePage,
   validateRevokeInvitation,
@@ -99,18 +100,7 @@ async function requireAdmin(communityId: string) {
 }

 export const getCommunityAdminContext = createServerFn({ method: 'GET' })
-  .validator((value: unknown) => {
-    if (!value || typeof value !== 'object' || Array.isArray(value))
-      throw new Error('INVALID_COMMUNITY_INPUT');
-    if (
-      !('community_id' in value) ||
-      Object.keys(value).length !== 1 ||
-      typeof value.community_id !== 'string' ||
-      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.community_id)
-    )
-      throw new Error('INVALID_COMMUNITY_INPUT');
-    return { community_id: value.community_id };
-  })
+  .validator(validateCommunityId)
   .handler(async ({ data }) => {
     const client = await requireAdmin(data.community_id);
     const { data: community, error } = await client
diff --git a/src/features/community/community-admin.styles.ts b/src/features/community/community-admin.styles.ts
index 1636d9c..ec3e54f 100644
--- a/src/features/community/community-admin.styles.ts
+++ b/src/features/community/community-admin.styles.ts
@@ -15,7 +15,9 @@ export const styles = stylex.create({
     backgroundColor: 'var(--color-bg)',
     color: 'var(--color-text)',
     fontFamily: 'var(--font-family-body)',
-    overflowY: 'auto'
+    overflowY: 'auto',
+    scrollPaddingBottom:
+      'calc(var(--space-14) + var(--space-40) + var(--space-16) + var(--space-4))'
   },
   header: { display: 'flex', flexDirection: 'column', gap: 0 },
   title: {
@@ -32,6 +34,41 @@ export const styles = stylex.create({
     overflowWrap: 'anywhere'
   },
   content: { display: 'flex', flexDirection: 'column', gap: 'var(--space-8)', minWidth: 0 },
+  confirmBackdrop: {
+    position: 'fixed',
+    inset: 0,
+    backgroundColor: 'var(--color-text)',
+    opacity: 0.6
+  },
+  confirmViewport: {
+    position: 'fixed',
+    inset: 0,
+    display: 'flex',
+    alignItems: 'center',
+    justifyContent: 'center',
+    padding: 'var(--space-8)',
+    overflowY: 'auto'
+  },
+  confirmDialog: {
+    boxSizing: 'border-box',
+    display: 'flex',
+    flexDirection: 'column',
+    gap: 'var(--space-8)',
+    width: 'min(100%, calc(var(--space-40) * 9))',
+    padding: 'var(--space-12)',
+    borderRadius: 'var(--radius-12)',
+    backgroundColor: 'var(--color-surface)',
+    color: 'var(--color-text)',
+    border: 'var(--border-width-sm) solid var(--color-line)',
+    overflowWrap: 'anywhere'
+  },
+  confirmTitle: {
+    margin: 0,
+    fontSize: 'var(--font-size-14)',
+    lineHeight: 'var(--font-size-20)',
+    fontWeight: 'var(--font-weight-semibold)',
+    overflowWrap: 'anywhere'
+  },
   venueContent: { gap: 'var(--space-10)' },
   screenHeading: { display: 'flex', alignItems: 'center', gap: 'var(--space-6)' },
   titleGroup: { display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', minWidth: 0 },
@@ -47,6 +84,7 @@ export const styles = stylex.create({
     fontFamily: 'var(--font-family-heading)',
     fontSize: 'var(--font-size-20)',
     fontWeight: 'var(--font-weight-bold)',
+    // Decorative aria-hidden chevron uses a unitless single-em line box for glyph centering; its 44px hit box is independent of line-height. The tight (1.1) and body (1.5) tokens are text-leading metrics, not equivalent icon metrics.
     lineHeight: 1,
     textDecoration: 'none',
     ':focus-visible': {
@@ -86,6 +124,29 @@ export const styles = stylex.create({
     gap: 'var(--space-6)',
     padding: 'var(--space-14)'
   },
+  errorActions: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-4)' },
+  errorAction: {
+    boxSizing: 'border-box',
+    minHeight: 'calc(var(--space-40) + var(--space-4))',
+    display: 'inline-flex',
+    alignItems: 'center',
+    justifyContent: 'center',
+    paddingInline: 'var(--space-10)',
+    border: 0,
+    borderRadius: 'var(--radius-10)',
+    backgroundColor: 'var(--color-green-soft)',
+    color: 'var(--color-green)',
+    font: 'inherit',
+    fontSize: 'var(--font-size-12)',
+    fontWeight: 'var(--font-weight-semibold)',
+    textDecoration: 'none',
+    overflowWrap: 'anywhere',
+    ':focus-visible': {
+      outline: 'var(--border-width-lg) solid var(--color-green)',
+      outlineOffset: 'var(--space-2)'
+    },
+    ':disabled': { opacity: 0.6 }
+  },
   requestCard: {
     minHeight: 'calc(var(--space-40) * 5)',
     boxSizing: 'border-box'
@@ -241,6 +302,14 @@ export const styles = stylex.create({
     ':focus-visible': {
       outline: 'var(--border-width-lg) solid var(--color-green)',
       outlineOffset: 'var(--space-2)'
+    },
+    '@media (max-width: 360px)': {
+      display: 'inline-flex',
+      alignItems: 'center',
+      boxSizing: 'border-box',
+      minWidth: 'calc(var(--space-40) + var(--space-4))',
+      minHeight: 'calc(var(--space-40) + var(--space-4))',
+      paddingInline: 'var(--space-4)'
     }
   },
   venueActions: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' },
@@ -250,7 +319,14 @@ export const styles = stylex.create({
     gap: 'var(--space-6)',
     padding: 'var(--space-14)'
   },
-  venueAction: { backgroundColor: 'var(--color-surface-2)', borderWidth: 0 },
+  venueAction: {
+    backgroundColor: 'var(--color-surface-2)',
+    borderWidth: 0,
+    '@media (max-width: 360px)': {
+      minWidth: 'calc(var(--space-40) + var(--space-4))',
+      minHeight: 'calc(var(--space-40) + var(--space-4))'
+    }
+  },
   venueMeta: {
     display: 'flex',
     alignItems: 'center',
diff --git a/src/features/community/community-admin.types.ts b/src/features/community/community-admin.types.ts
index 9c98cc9..92df322 100644
--- a/src/features/community/community-admin.types.ts
+++ b/src/features/community/community-admin.types.ts
@@ -12,3 +12,39 @@ export type CommunityMemberSearchResult = Omit<
   display_level: number | null;
   reliability_percent: number | null;
 };
+
+export type CommunityAdminCommunity = Pick<
+  Database['public']['Tables']['communities']['Row'],
+  'id' | 'name' | 'city_label' | 'description' | 'visibility' | 'join_policy'
+>;
+export type CommunityAdminMember = CommunityMemberSearchResult;
+export type CommunityAdminVenue = Pick<
+  Database['public']['Tables']['community_venues']['Row'],
+  | 'id'
+  | 'community_id'
+  | 'name'
+  | 'address'
+  | 'maps_url'
+  | 'photo_path'
+  | 'created_at'
+  | 'updated_at'
+  | 'archived_at'
+>;
+export type CommunityAdminAudit = Pick<
+  Database['public']['Tables']['community_audit_log']['Row'],
+  'id' | 'actor_user_id' | 'entity' | 'entity_id' | 'action' | 'details' | 'occurred_at'
+>;
+
+type CommunityProps = { community: CommunityAdminCommunity };
+type MemberCollectionProps = CommunityProps & { members: CommunityAdminMember[] };
+export type CommunityAdminScreenProps =
+  | (MemberCollectionProps & { screen: 'requests' })
+  | (MemberCollectionProps & { screen: 'members' })
+  | (CommunityProps & {
+      screen: 'member';
+      member: CommunityAdminMember;
+      membershipId: string;
+    })
+  | (CommunityProps & { screen: 'settings' })
+  | (CommunityProps & { screen: 'venues'; venues: CommunityAdminVenue[] })
+  | (CommunityProps & { screen: 'audit'; audit: CommunityAdminAudit[] });
diff --git a/src/features/community/community-admin.validators.ts b/src/features/community/community-admin.validators.ts
index 12790da..063ea14 100644
--- a/src/features/community/community-admin.validators.ts
+++ b/src/features/community/community-admin.validators.ts
@@ -50,6 +50,10 @@ export function validateMemberAction(value: unknown): MemberActionInput {
   const input = record(value, ['community_id', 'membership_id']);
   return { community_id: uuid(input.community_id), membership_id: uuid(input.membership_id) };
 }
+export function validateCommunityId(value: unknown): { community_id: string } {
+  const input = record(value, ['community_id']);
+  return { community_id: uuid(input.community_id) };
+}
 export function validatePage(value: unknown): PageInput {
   const input = record(value, ['community_id', 'offset', 'limit']);
   return page(input);
diff --git a/src/features/community/community-onboarding.styles.ts b/src/features/community/community-onboarding.styles.ts
index dcf8cd9..798fe2a 100644
--- a/src/features/community/community-onboarding.styles.ts
+++ b/src/features/community/community-onboarding.styles.ts
@@ -29,6 +29,7 @@ export const ui = stylex.create({
   },
   subtitle: { margin: 0, fontSize: 'var(--font-size-12)', color: 'var(--color-muted)' },
   content: { display: 'flex', flexDirection: 'column', gap: 'var(--space-10)', minWidth: 0 },
+  results: { display: 'flex', flexDirection: 'column', gap: 'var(--space-10)', minWidth: 0 },
   intro: { display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' },
   createIntro: { gap: 'var(--space-4)' },
   lead: {
@@ -139,6 +140,18 @@ export const ui = stylex.create({
   },
   optional: { gap: 0, padding: 'var(--space-12)', borderRadius: 'var(--radius-14)' },
   optionalHeading: { marginBottom: 'var(--space-7)' },
+  optionalField: { position: 'relative', minHeight: 'calc(var(--space-40) + var(--space-4))' },
+  floatingLabel: {
+    position: 'absolute',
+    top: 'var(--space-3)',
+    left: 'var(--space-8)',
+    zIndex: 1,
+    color: 'var(--color-muted)',
+    fontSize: 'var(--font-size-10)',
+    lineHeight: 'var(--font-line-height-tight)',
+    pointerEvents: 'none'
+  },
+  labeledInput: { paddingTop: 'var(--space-16)' },
   optionalInput: {
     width: '100%',
     minHeight: 'calc(var(--space-40) + var(--space-4))',
diff --git a/src/locales/en/translation.json b/src/locales/en/translation.json
index 166912a..85ec3af 100644
--- a/src/locales/en/translation.json
+++ b/src/locales/en/translation.json
@@ -23,6 +23,7 @@
     "lead": "Play with people nearby",
     "help": "Public communities are visible to everyone. You can join more communities later.",
     "searchLabel": "Search community",
+    "searchLoading": "Searching communities…",
     "searchPlaceholder": "Search by name or city",
     "join": "JOIN COMMUNITY",
     "requestToJoin": "REQUEST TO JOIN",
diff --git a/src/locales/es/translation.json b/src/locales/es/translation.json
index 3aa3939..d098f66 100644
--- a/src/locales/es/translation.json
+++ b/src/locales/es/translation.json
@@ -23,6 +23,7 @@
     "lead": "Juega con gente cercana",
     "help": "Las comunidades públicas son visibles para todos. Puedes unirte a otras más adelante.",
     "searchLabel": "Buscar comunidad",
+    "searchLoading": "Buscando comunidades…",
     "searchPlaceholder": "Busca por nombre o ciudad",
     "join": "UNIRME A LA COMUNIDAD",
     "requestToJoin": "SOLICITAR ACCESO",
diff --git a/src/locales/pt-BR/translation.json b/src/locales/pt-BR/translation.json
index db2cf50..766d60c 100644
--- a/src/locales/pt-BR/translation.json
+++ b/src/locales/pt-BR/translation.json
@@ -23,6 +23,7 @@
     "lead": "Jogue com pessoas por perto",
     "help": "Comunidades públicas são visíveis para todos. Você pode entrar em outras depois.",
     "searchLabel": "Buscar comunidade",
+    "searchLoading": "Buscando comunidades…",
     "searchPlaceholder": "Busque por nome ou cidade",
     "join": "ENTRAR NA COMUNIDADE",
     "requestToJoin": "PEDIR PARA ENTRAR",
diff --git a/src/routes/__root.tsx b/src/routes/__root.tsx
index 52c3adf..c8126cc 100644
--- a/src/routes/__root.tsx
+++ b/src/routes/__root.tsx
@@ -6,7 +6,7 @@ import {
   useRouterState
 } from '@tanstack/react-router';
 import { I18nextProvider } from 'react-i18next';
-import { useEffect, useState } from 'react';
+import { useEffect, useRef, useState } from 'react';
 import { createI18n, resolveLocale } from '../i18n/config';
 import { getInitialLocale, saveLocale } from '../i18n/locale.functions';
 import { PwaRegistration } from '../components/PwaRegistration';
@@ -50,6 +50,9 @@ function Root() {
   const [locale, setLocale] = useState(() => resolveLocale(initialLocale));
   const [theme, setTheme] = useState(initialTheme);
   const [i18n] = useState(() => createI18n(locale));
+  const localeRef = useRef(locale);
+  const localeRequest = useRef(0);
+  const localeQueue = useRef(Promise.resolve());
   useEffect(() => {
     document.documentElement.dataset.appHydrated = 'true';
   }, []);
@@ -69,10 +72,35 @@ function Root() {
                 value={locale}
                 onChange={(event) => {
                   const next = resolveLocale(event.target.value);
-                  setLocale(next);
-                  void i18n.changeLanguage(next);
-                  document.documentElement.lang = next;
-                  void saveLocale({ data: next });
+                  const request = ++localeRequest.current;
+                  localeQueue.current = localeQueue.current
+                    .catch(() => undefined)
+                    .then(async () => {
+                      const previous = localeRef.current;
+                      let persisted = false;
+                      try {
+                        await saveLocale({ data: next });
+                        persisted = true;
+                        if (request !== localeRequest.current) return;
+                        await i18n.changeLanguage(next);
+                        if (request !== localeRequest.current) {
+                          await i18n.changeLanguage(previous);
+                          return;
+                        }
+                        localeRef.current = next;
+                        setLocale(next);
+                        document.documentElement.lang = next;
+                      } catch {
+                        if (persisted && localeRef.current === previous) {
+                          try {
+                            await i18n.changeLanguage(previous);
+                            await saveLocale({ data: previous });
+                          } catch {
+                            // Keep the rendered locale unchanged if preference recovery also fails.
+                          }
+                        }
+                      }
+                    });
                 }}
               >
                 <option value="en">English</option>
diff --git a/src/routes/_protected.community.$communityId.admin.audit.tsx b/src/routes/_protected.community.$communityId.admin.audit.tsx
index 84d8f0b..9f8166c 100644
--- a/src/routes/_protected.community.$communityId.admin.audit.tsx
+++ b/src/routes/_protected.community.$communityId.admin.audit.tsx
@@ -21,5 +21,8 @@ export const Route = createFileRoute('/_protected/community/$communityId/admin/a
   },
   pendingComponent: CommunityAdminLoading,
   errorComponent: CommunityAdminDenied,
-  component: () => <CommunityAdminScreen {...Route.useLoaderData()} screen="audit" />
+  component: () => {
+    const data = Route.useLoaderData();
+    return <CommunityAdminScreen screen="audit" community={data.community} audit={data.audit} />;
+  }
 });
diff --git a/src/routes/_protected.community.$communityId.admin.members.$membershipId.tsx b/src/routes/_protected.community.$communityId.admin.members.$membershipId.tsx
index fc101e5..123947d 100644
--- a/src/routes/_protected.community.$communityId.admin.members.$membershipId.tsx
+++ b/src/routes/_protected.community.$communityId.admin.members.$membershipId.tsx
@@ -19,9 +19,19 @@ export const Route = createFileRoute(
     const member = await getCommunityMemberById({
       data: { community_id: params.communityId, membership_id: params.membershipId }
     });
-    return { community, members: [member], membershipId: params.membershipId };
+    return { community, member, membershipId: params.membershipId };
   },
   pendingComponent: CommunityAdminLoading,
   errorComponent: CommunityAdminDenied,
-  component: () => <CommunityAdminScreen {...Route.useLoaderData()} screen="member" />
+  component: () => {
+    const data = Route.useLoaderData();
+    return (
+      <CommunityAdminScreen
+        screen="member"
+        community={data.community}
+        member={data.member}
+        membershipId={data.membershipId}
+      />
+    );
+  }
 });
diff --git a/src/routes/_protected.community.$communityId.admin.members.index.tsx b/src/routes/_protected.community.$communityId.admin.members.index.tsx
new file mode 100644
index 0000000..4914eaf
--- /dev/null
+++ b/src/routes/_protected.community.$communityId.admin.members.index.tsx
@@ -0,0 +1,32 @@
+import { createFileRoute } from '@tanstack/react-router';
+import {
+  CommunityAdminDenied,
+  CommunityAdminLoading,
+  CommunityAdminScreen
+} from '../features/community/CommunityAdmin';
+import {
+  getCommunityAdminContext,
+  searchCommunityMembers
+} from '../features/community/community-admin.functions';
+
+export const Route = createFileRoute('/_protected/community/$communityId/admin/members/')({
+  loader: async ({ params }) => {
+    const community = await getCommunityAdminContext({
+      data: { community_id: params.communityId }
+    });
+    const members = await searchCommunityMembers({
+      data: { community_id: params.communityId, query: '', status: 'active', offset: 0, limit: 50 }
+    });
+    return { community, members };
+  },
+  pendingComponent: CommunityAdminLoading,
+  errorComponent: CommunityAdminDenied,
+  component: MembersIndexRoute
+});
+
+function MembersIndexRoute() {
+  const data = Route.useLoaderData();
+  return (
+    <CommunityAdminScreen screen="members" community={data.community} members={data.members} />
+  );
+}
diff --git a/src/routes/_protected.community.$communityId.admin.members.tsx b/src/routes/_protected.community.$communityId.admin.members.tsx
index baf0a10..1a6d7fa 100644
--- a/src/routes/_protected.community.$communityId.admin.members.tsx
+++ b/src/routes/_protected.community.$communityId.admin.members.tsx
@@ -1,35 +1,5 @@
-import { createFileRoute, Outlet, useRouterState } from '@tanstack/react-router';
-import {
-  CommunityAdminDenied,
-  CommunityAdminLoading,
-  CommunityAdminScreen
-} from '../features/community/CommunityAdmin';
-import {
-  getCommunityAdminContext,
-  searchCommunityMembers
-} from '../features/community/community-admin.functions';
+import { createFileRoute, Outlet } from '@tanstack/react-router';

 export const Route = createFileRoute('/_protected/community/$communityId/admin/members')({
-  loader: async ({ params }) => {
-    const community = await getCommunityAdminContext({
-      data: { community_id: params.communityId }
-    });
-    const members = await searchCommunityMembers({
-      data: { community_id: params.communityId, query: '', status: 'active', offset: 0, limit: 50 }
-    });
-    return { community, members };
-  },
-  pendingComponent: CommunityAdminLoading,
-  errorComponent: CommunityAdminDenied,
-  component: MembersRoute
+  component: () => <Outlet />
 });
-
-function MembersRoute() {
-  const data = Route.useLoaderData();
-  const pathname = useRouterState({ select: (state) => state.location.pathname });
-  return pathname.endsWith('/members') ? (
-    <CommunityAdminScreen {...data} screen="members" />
-  ) : (
-    <Outlet />
-  );
-}
diff --git a/src/routes/_protected.community.$communityId.admin.requests.tsx b/src/routes/_protected.community.$communityId.admin.requests.tsx
index 26fd7b7..80f284b 100644
--- a/src/routes/_protected.community.$communityId.admin.requests.tsx
+++ b/src/routes/_protected.community.$communityId.admin.requests.tsx
@@ -23,6 +23,8 @@ export const Route = createFileRoute('/_protected/community/$communityId/admin/r
   errorComponent: CommunityAdminDenied,
   component: () => {
     const data = Route.useLoaderData();
-    return <CommunityAdminScreen screen="requests" {...data} />;
+    return (
+      <CommunityAdminScreen screen="requests" community={data.community} members={data.members} />
+    );
   }
 });
diff --git a/src/routes/_protected.community.$communityId.admin.settings.tsx b/src/routes/_protected.community.$communityId.admin.settings.tsx
index add75fb..b803de6 100644
--- a/src/routes/_protected.community.$communityId.admin.settings.tsx
+++ b/src/routes/_protected.community.$communityId.admin.settings.tsx
@@ -10,5 +10,8 @@ export const Route = createFileRoute('/_protected/community/$communityId/admin/s
   loader: ({ params }) => getCommunityAdminContext({ data: { community_id: params.communityId } }),
   pendingComponent: CommunityAdminLoading,
   errorComponent: CommunityAdminDenied,
-  component: () => <CommunityAdminScreen screen="settings" community={Route.useLoaderData()} />
+  component: () => {
+    const community = Route.useLoaderData();
+    return <CommunityAdminScreen screen="settings" community={community} />;
+  }
 });
diff --git a/src/routes/_protected.community.$communityId.admin.venues.tsx b/src/routes/_protected.community.$communityId.admin.venues.tsx
index 10f3034..a4e77e7 100644
--- a/src/routes/_protected.community.$communityId.admin.venues.tsx
+++ b/src/routes/_protected.community.$communityId.admin.venues.tsx
@@ -21,5 +21,8 @@ export const Route = createFileRoute('/_protected/community/$communityId/admin/v
   },
   pendingComponent: CommunityAdminLoading,
   errorComponent: CommunityAdminDenied,
-  component: () => <CommunityAdminScreen {...Route.useLoaderData()} screen="venues" />
+  component: () => {
+    const data = Route.useLoaderData();
+    return <CommunityAdminScreen screen="venues" community={data.community} venues={data.venues} />;
+  }
 });
diff --git a/supabase/migrations/20261012111727_community_audit_changed_fields.sql b/supabase/migrations/20261012111727_community_audit_changed_fields.sql
new file mode 100644
index 0000000..8c19f85
--- /dev/null
+++ b/supabase/migrations/20261012111727_community_audit_changed_fields.sql
@@ -0,0 +1,60 @@
+create or replace function public.audit_community_change() returns trigger
+language plpgsql security definer set search_path = '' as $$
+declare
+  v_details jsonb := '{}'::jsonb;
+  v_changed_fields jsonb := '[]'::jsonb;
+  v_transitions jsonb := '{}'::jsonb;
+  v_community_id uuid;
+begin
+  if tg_table_name = 'communities' then
+    v_community_id := new.id;
+  else
+    v_community_id := new.community_id;
+  end if;
+
+  if tg_table_name = 'community_members' then
+    v_details := pg_catalog.jsonb_build_object('role', new.role, 'status', new.status);
+  elsif tg_table_name = 'communities' then
+    v_details := pg_catalog.jsonb_build_object('visibility', new.visibility);
+  elsif tg_table_name = 'community_invitations' then
+    v_details := pg_catalog.jsonb_build_object('revoked', new.revoked_at is not null);
+  elsif tg_table_name = 'community_venues' then
+    v_details := pg_catalog.jsonb_build_object('archived', new.archived_at is not null);
+  end if;
+
+  if tg_op = 'UPDATE' then
+    if tg_table_name = 'communities' then
+      if old.name is distinct from new.name then v_changed_fields := v_changed_fields || pg_catalog.jsonb_build_array('name'); end if;
+      if old.description is distinct from new.description then v_changed_fields := v_changed_fields || pg_catalog.jsonb_build_array('description'); end if;
+      if old.logo_path is distinct from new.logo_path then v_changed_fields := v_changed_fields || pg_catalog.jsonb_build_array('logo_path'); end if;
+      if old.city_label is distinct from new.city_label then v_changed_fields := v_changed_fields || pg_catalog.jsonb_build_array('city_label'); end if;
+      if old.visibility is distinct from new.visibility then
+        v_changed_fields := v_changed_fields || pg_catalog.jsonb_build_array('visibility');
+        v_transitions := v_transitions || pg_catalog.jsonb_build_object('visibility', pg_catalog.jsonb_build_object('before', old.visibility, 'after', new.visibility));
+      end if;
+      if old.join_policy is distinct from new.join_policy then
+        v_changed_fields := v_changed_fields || pg_catalog.jsonb_build_array('join_policy');
+        v_transitions := v_transitions || pg_catalog.jsonb_build_object('join_policy', pg_catalog.jsonb_build_object('before', old.join_policy, 'after', new.join_policy));
+      end if;
+      if old.settings is distinct from new.settings then v_changed_fields := v_changed_fields || pg_catalog.jsonb_build_array('settings'); end if;
+    elsif tg_table_name = 'community_venues' then
+      if old.name is distinct from new.name then v_changed_fields := v_changed_fields || pg_catalog.jsonb_build_array('name'); end if;
+      if old.address is distinct from new.address then v_changed_fields := v_changed_fields || pg_catalog.jsonb_build_array('address'); end if;
+      if old.maps_url is distinct from new.maps_url then v_changed_fields := v_changed_fields || pg_catalog.jsonb_build_array('maps_url'); end if;
+      if old.photo_path is distinct from new.photo_path then v_changed_fields := v_changed_fields || pg_catalog.jsonb_build_array('photo_path'); end if;
+      if old.archived_at is distinct from new.archived_at then
+        v_changed_fields := v_changed_fields || pg_catalog.jsonb_build_array('archived_at');
+        v_transitions := v_transitions || pg_catalog.jsonb_build_object('archived', pg_catalog.jsonb_build_object('before', old.archived_at is not null, 'after', new.archived_at is not null));
+      end if;
+    end if;
+    if tg_table_name in ('communities', 'community_venues') then
+      v_details := v_details || pg_catalog.jsonb_build_object('changed_fields', v_changed_fields, 'transitions', v_transitions);
+    end if;
+  end if;
+
+  insert into public.community_audit_log (community_id, actor_user_id, entity, entity_id, action, details)
+    values (v_community_id, (select auth.uid()), tg_table_name, new.id, tg_op, v_details);
+  return new;
+end;
+$$;
+revoke all on function public.audit_community_change() from public, anon, authenticated;
diff --git a/test/community.admin-extraction.test.ts b/test/community.admin-extraction.test.ts
index b5a743a..cf691e0 100644
--- a/test/community.admin-extraction.test.ts
+++ b/test/community.admin-extraction.test.ts
@@ -1,5 +1,15 @@
-import { readdirSync, readFileSync } from 'node:fs';
-import { describe, expect, it } from 'vitest';
+import { execFile } from 'node:child_process';
+import { readdirSync, readFileSync, statSync } from 'node:fs';
+import { promisify } from 'node:util';
+import { beforeAll, describe, expect, it } from 'vitest';
+
+const execFileAsync = promisify(execFile);
+const buildTimeoutMs = 120_000;
+const filesystemTimestampToleranceMs = 2_000;
+
+function isFreshArtifact(mtimeMs: number, buildStartedAtMs: number): boolean {
+  return mtimeMs >= buildStartedAtMs - filesystemTimestampToleranceMs;
+}

 const endpointNames = [
   'approveCommunityMember',
@@ -11,12 +21,45 @@ const endpointNames = [
 ] as const;

 describe('admin server-function extraction (production build)', () => {
+  let buildStartedAtMs: number;
+
+  beforeAll(async () => {
+    // Never run this production build concurrently with Playwright: both use dist.
+    buildStartedAtMs = Date.now();
+    try {
+      const { stdout, stderr } = await execFileAsync('pnpm', ['build'], {
+        timeout: buildTimeoutMs,
+        maxBuffer: 10 * 1024 * 1024
+      });
+      // Keep output available for diagnostics while avoiding environment values.
+      if (stdout) process.stdout.write(stdout);
+      if (stderr) process.stderr.write(stderr);
+    } catch (error) {
+      const output = (key: 'stdout' | 'stderr') =>
+        error &&
+        typeof error === 'object' &&
+        typeof Object.getOwnPropertyDescriptor(error, key)?.value === 'string'
+          ? Object.getOwnPropertyDescriptor(error, key)?.value
+          : '';
+      throw new Error(
+        `pnpm build failed; stdout:\n${output('stdout')}\nstderr:\n${output('stderr')}`,
+        { cause: error }
+      );
+    }
+  }, buildTimeoutMs);
+
   it('emits six distinct transport identities for module-level membership actions', () => {
-    const assets = readdirSync(new URL('../dist/server/assets/', import.meta.url))
+    const assetDirectory = new URL('../dist/server/assets/', import.meta.url);
+    const assets = readdirSync(assetDirectory)
       .filter((file) => /^community-admin\.functions-.*\.js$/.test(file))
-      .map((file) =>
-        readFileSync(new URL(`../dist/server/assets/${file}`, import.meta.url), 'utf8')
-      )
+      .map((file) => {
+        const path = new URL(`../dist/server/assets/${file}`, import.meta.url);
+        expect(
+          isFreshArtifact(statSync(path).mtimeMs, buildStartedAtMs),
+          `${file} must have been emitted by this build`
+        ).toBe(true);
+        return readFileSync(path, 'utf8');
+      })
       .filter((content) => content.includes('createServerRpc({'));
     expect(assets).toHaveLength(1);
     const compiled = assets[0]!;
@@ -32,4 +75,9 @@ describe('admin server-function extraction (production build)', () => {
     });
     expect(new Set(ids).size).toBe(endpointNames.length);
   });
+
+  it('rejects an artifact older than the current build start', () => {
+    const staleMtimeMs = Date.now() - filesystemTimestampToleranceMs - 1;
+    expect(isFreshArtifact(staleMtimeMs, Date.now())).toBe(false);
+  });
 });
diff --git a/test/community.admin-routes.test.ts b/test/community.admin-routes.test.ts
index d84d9f3..7f0137f 100644
--- a/test/community.admin-routes.test.ts
+++ b/test/community.admin-routes.test.ts
@@ -1,73 +1,302 @@
-import { readFileSync } from 'node:fs';
-import { describe, expect, it } from 'vitest';
-
-const routeFiles = [
-  '../src/routes/_protected.community.$communityId.admin.tsx',
-  '../src/routes/_protected.community.$communityId.admin.requests.tsx',
-  '../src/routes/_protected.community.$communityId.admin.members.tsx',
-  '../src/routes/_protected.community.$communityId.admin.members.$membershipId.tsx',
-  '../src/routes/_protected.community.$communityId.admin.settings.tsx',
-  '../src/routes/_protected.community.$communityId.admin.venues.tsx',
-  '../src/routes/_protected.community.$communityId.admin.audit.tsx'
-];
-
-function source(path: string) {
-  return readFileSync(new URL(path, import.meta.url), 'utf8');
+import { createMemoryHistory, createRouter } from '@tanstack/react-router';
+import { beforeEach, describe, expect, it, vi } from 'vitest';
+
+const calls = vi.hoisted(() => ({
+  context: vi.fn<(input: { data: unknown }) => Promise<unknown>>(),
+  members: vi.fn<(input: { data: unknown }) => Promise<unknown>>(),
+  member: vi.fn<(input: { data: unknown }) => Promise<unknown>>(),
+  venues: vi.fn<(input: { data: unknown }) => Promise<unknown>>(),
+  audit: vi.fn<(input: { data: unknown }) => Promise<unknown>>(),
+  onboarding: vi.fn<() => Promise<unknown>>(),
+  locale: vi.fn<() => Promise<unknown>>(),
+  theme: vi.fn<() => Promise<unknown>>()
+}));
+
+vi.mock('../src/features/community/community-admin.functions', () => ({
+  getCommunityAdminContext: calls.context,
+  searchCommunityMembers: calls.members,
+  getCommunityMemberById: calls.member,
+  listCommunityVenues: calls.venues,
+  listCommunityAudit: calls.audit
+}));
+vi.mock('../src/features/player/player.functions', () => ({
+  getOnboardingStatus: calls.onboarding
+}));
+vi.mock('../src/i18n/locale.functions', () => ({
+  getInitialLocale: calls.locale,
+  saveLocale: vi.fn<(input: unknown) => Promise<void>>()
+}));
+vi.mock('../src/features/theme/theme.functions', () => ({
+  getInitialTheme: calls.theme,
+  saveTheme: vi.fn<(input: unknown) => Promise<void>>()
+}));
+
+import { Route as AdminRoute } from '../src/routes/_protected.community.$communityId.admin';
+import { Route as AdminIndexRoute } from '../src/routes/_protected.community.$communityId.admin.index';
+import { Route as AuditRoute } from '../src/routes/_protected.community.$communityId.admin.audit';
+import { Route as MembersRoute } from '../src/routes/_protected.community.$communityId.admin.members';
+import { Route as MemberDetailRoute } from '../src/routes/_protected.community.$communityId.admin.members.$membershipId';
+import { Route as MembersIndexRoute } from '../src/routes/_protected.community.$communityId.admin.members.index';
+import { Route as ProtectedRoute } from '../src/routes/_protected';
+import { Route as RequestsRoute } from '../src/routes/_protected.community.$communityId.admin.requests';
+import { Route as SettingsRoute } from '../src/routes/_protected.community.$communityId.admin.settings';
+import { Route as VenuesRoute } from '../src/routes/_protected.community.$communityId.admin.venues';
+import { routeTree } from '../src/routeTree.gen';
+
+const communityId = '11111111-1111-4111-8111-111111111111';
+const membershipId = '22222222-2222-4222-8222-222222222222';
+const community = { id: communityId, name: 'Test community' };
+const routeParams = { communityId, membershipId };
+
+function hasLoader(
+  route: unknown
+): route is { options: { loader: (context: { params: typeof routeParams }) => Promise<unknown> } } {
+  return (
+    typeof route === 'object' &&
+    route !== null &&
+    typeof Reflect.get(route, 'options') === 'object' &&
+    typeof Reflect.get(Reflect.get(route, 'options'), 'loader') === 'function'
+  );
+}
+
+function loader(route: unknown) {
+  if (!hasLoader(route)) throw new Error('Route has no loader');
+  return route.options.loader;
+}
+
+type RouteNode = {
+  options: { id: string; getParentRoute?: () => RouteNode };
+  children?: RouteNode[];
+};
+
+function routeNodes(parent: unknown): RouteNode[] {
+  if (typeof parent !== 'object' || parent === null) return [];
+  const children = Reflect.get(parent, 'children');
+  if (typeof children !== 'object' || children === null) return [];
+  return Object.values(children).filter(isRouteNode);
 }

-describe('community admin routes', () => {
-  it('attaches each admin view to the authenticated protected route tree', () => {
-    const tree = source('../src/routeTree.gen.ts');
-    expect(tree).toContain('getParentRoute: () => ProtectedRoute');
-    for (const route of [
-      '/community/$communityId/admin',
-      '/community/$communityId/admin/requests',
-      '/community/$communityId/admin/members',
-      '/community/$communityId/admin/members/$membershipId',
-      '/community/$communityId/admin/settings',
-      '/community/$communityId/admin/venues',
-      '/community/$communityId/admin/audit'
-    ])
-      expect(tree).toContain(route);
+function isRouteNode(value: unknown): value is RouteNode {
+  const options =
+    typeof value === 'object' && value !== null ? Reflect.get(value, 'options') : null;
+  return (
+    typeof value === 'object' &&
+    value !== null &&
+    typeof options === 'object' &&
+    options !== null &&
+    typeof Reflect.get(options, 'id') === 'string' &&
+    typeof Reflect.get(value, 'update') === 'function'
+  );
+}
+
+function makeRouter(path: string) {
+  return createRouter({
+    routeTree,
+    history: createMemoryHistory({ initialEntries: [path] })
+  });
+}
+
+function invokeBeforeLoad(route: unknown, context: unknown): unknown {
+  if (typeof route !== 'object' || route === null) throw new Error('Invalid route');
+  const options = Reflect.get(route, 'options');
+  const beforeLoad =
+    typeof options === 'object' && options !== null ? Reflect.get(options, 'beforeLoad') : null;
+  if (typeof beforeLoad !== 'function') throw new Error('Route has no beforeLoad');
+  return Reflect.apply(beforeLoad, route, [context]);
+}
+
+beforeEach(() => {
+  vi.clearAllMocks();
+  calls.context.mockResolvedValue(community);
+  calls.members.mockResolvedValue([{ membership_id: membershipId }]);
+  calls.member.mockResolvedValue({ membership_id: membershipId });
+  calls.venues.mockResolvedValue([{ id: 'venue' }]);
+  calls.audit.mockResolvedValue([{ id: 'audit' }]);
+  calls.onboarding.mockResolvedValue({ authenticated: true, complete: true });
+  calls.locale.mockResolvedValue('en');
+  calls.theme.mockResolvedValue('light');
+});
+
+describe('community admin executable routes', () => {
+  it('runs each data leaf loader with authorization first and correct params/counts', async () => {
+    const cases = [
+      {
+        route: RequestsRoute,
+        reader: calls.members,
+        resultKey: 'members',
+        expected: { community_id: communityId, query: '', status: 'pending', offset: 0, limit: 50 }
+      },
+      {
+        route: MembersIndexRoute,
+        reader: calls.members,
+        resultKey: 'members',
+        expected: { community_id: communityId, query: '', status: 'active', offset: 0, limit: 50 }
+      },
+      {
+        route: VenuesRoute,
+        reader: calls.venues,
+        resultKey: 'venues',
+        expected: { community_id: communityId, offset: 0, limit: 50 }
+      },
+      {
+        route: AuditRoute,
+        reader: calls.audit,
+        resultKey: 'audit',
+        expected: { community_id: communityId, offset: 0, limit: 3 }
+      },
+      {
+        route: MemberDetailRoute,
+        reader: calls.member,
+        resultKey: 'member',
+        expected: { community_id: communityId, membership_id: membershipId }
+      }
+    ] as const;
+
+    for (const { route, reader, resultKey, expected } of cases) {
+      vi.clearAllMocks();
+      calls.context.mockResolvedValue(community);
+      calls.members.mockResolvedValue([{ membership_id: membershipId }]);
+      calls.member.mockResolvedValue({ membership_id: membershipId });
+      calls.venues.mockResolvedValue([{ id: 'venue' }]);
+      calls.audit.mockResolvedValue([{ id: 'audit' }]);
+      const result = await loader(route)({ params: routeParams });
+      expect(calls.context).toHaveBeenCalledExactlyOnceWith({
+        data: { community_id: communityId }
+      });
+      expect(reader).toHaveBeenCalledExactlyOnceWith({ data: expected });
+      const contextOrder = calls.context.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER;
+      const readerOrder = reader.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER;
+      expect(contextOrder).toBeLessThan(readerOrder);
+      expect(typeof result).toBe('object');
+      if (typeof result !== 'object' || result === null || !(resultKey in result))
+        throw new Error(`Loader result is missing ${resultKey}`);
+      const value: unknown = Reflect.get(result, resultKey);
+      const observed =
+        resultKey === 'member' && typeof value === 'object' && value !== null
+          ? Reflect.get(value, 'membership_id')
+          : Array.isArray(value)
+            ? value.length
+            : null;
+      expect(observed).toEqual(resultKey === 'member' ? membershipId : 1);
+    }
+
+    for (const { route, reader } of cases) {
+      vi.clearAllMocks();
+      calls.context.mockRejectedValue(new Error('NOT_COMMUNITY_ADMIN'));
+      await expect(loader(route)({ params: routeParams })).rejects.toThrow('NOT_COMMUNITY_ADMIN');
+      expect(calls.context).toHaveBeenCalledExactlyOnceWith({
+        data: { community_id: communityId }
+      });
+      expect(calls.members).not.toHaveBeenCalled();
+      expect(calls.member).not.toHaveBeenCalled();
+      expect(calls.venues).not.toHaveBeenCalled();
+      expect(calls.audit).not.toHaveBeenCalled();
+      expect(reader).not.toHaveBeenCalled();
+    }
+  });
+
+  it('runs admin and settings context loaders with their route params', async () => {
+    await expect(loader(AdminRoute)({ params: routeParams })).resolves.toEqual(community);
+    expect(calls.context).toHaveBeenCalledExactlyOnceWith({ data: { community_id: communityId } });
+    calls.context.mockClear();
+    await expect(loader(SettingsRoute)({ params: routeParams })).resolves.toEqual(community);
+    expect(calls.context).toHaveBeenCalledExactlyOnceWith({ data: { community_id: communityId } });
+    expect(calls.members).not.toHaveBeenCalled();
+    expect(calls.venues).not.toHaveBeenCalled();
+    expect(calls.audit).not.toHaveBeenCalled();
   });

-  it('runs the explicit live-admin guard before each route reads private data', () => {
-    for (const path of routeFiles) {
-      const route = source(path);
-      expect(route.includes('getCommunityAdminContext')).toBe(true);
-      expect(route.includes('errorComponent: CommunityAdminDenied')).toBe(true);
+  it('executes the actual generated protected/admin/members/index/detail hierarchy', () => {
+    const protectedRoute = routeNodes(routeTree).find(
+      (route) => route.options.id === '/_protected'
+    );
+    const adminRoute = protectedRoute?.children?.find(
+      (route) => route.options.id === '/community/$communityId/admin'
+    );
+    const membersRoute = adminRoute?.children?.find((route) => route.options.id === '/members');
+    expect(adminRoute?.options.getParentRoute?.()).toBe(protectedRoute);
+    expect(membersRoute?.options.getParentRoute?.()).toBe(adminRoute);
+    expect(membersRoute?.children?.find((route) => route.options.id === '/')).toBeDefined();
+    expect(
+      membersRoute?.children
+        ?.find((route) => route.options.id === '/$membershipId')
+        ?.options.getParentRoute?.()
+    ).toBe(membersRoute);
+  });
+
+  it('redirects admin root to requests and resolves members trailing slash to its index leaf', async () => {
+    let redirect: unknown;
+    try {
+      invokeBeforeLoad(AdminIndexRoute, { params: { communityId } });
+    } catch (error) {
+      redirect = error;
     }
-    const functions = source('../src/features/community/community-admin.functions.ts');
-    expect(functions).toContain("client.rpc('is_community_admin'");
-    expect(functions).toContain("if (!data) throw new Error('NOT_COMMUNITY_ADMIN')");
+    expect(redirect).toBeDefined();
+    if (typeof redirect !== 'object' || redirect === null) throw new Error('Expected redirect');
+    expect(Reflect.get(Reflect.get(redirect, 'options'), 'to')).toBe(
+      '/community/$communityId/admin/requests'
+    );
+
+    const membersRouter = makeRouter(`/community/${communityId}/admin/members/`);
+    const matches = membersRouter.matchRoutes(`/community/${communityId}/admin/members/`);
+    expect(matches.map((match) => match.routeId)).toContain(
+      '/_protected/community/$communityId/admin/members/'
+    );
+  });
+
+  it('navigates to detail without invoking the active-roster loader', async () => {
+    const router = makeRouter(`/community/${communityId}/admin/members/${membershipId}`);
+    const matches = router.matchRoutes(`/community/${communityId}/admin/members/${membershipId}`);
+    expect(matches.map((match) => match.routeId)).toContain(
+      '/_protected/community/$communityId/admin/members/$membershipId'
+    );
+    await loader(MemberDetailRoute)({ params: routeParams });
+    expect(calls.member).toHaveBeenCalledExactlyOnceWith({
+      data: { community_id: communityId, membership_id: membershipId }
+    });
+    expect(calls.members).not.toHaveBeenCalled();
+  });
+
+  it.each([
+    [{ authenticated: false, complete: false }, '/login'],
+    [{ authenticated: true, complete: false }, '/onboarding']
+  ])('redirects protected admin navigation for status %j', async (status, destination) => {
+    calls.onboarding.mockResolvedValue(status);
+    await expect(
+      Promise.resolve().then(() =>
+        invokeBeforeLoad(ProtectedRoute, {
+          location: { href: `/community/${communityId}/admin/members` }
+        })
+      )
+    ).rejects.toMatchObject({ options: { to: destination } });
+    expect(calls.onboarding).toHaveBeenCalledOnce();
+    expect(calls.context).not.toHaveBeenCalled();
+    expect(calls.members).not.toHaveBeenCalled();
+  });
+
+  it('surfaces a live non-admin failure without reading private route data', async () => {
+    calls.context.mockRejectedValue(new Error('NOT_COMMUNITY_ADMIN'));
+    await expect(loader(VenuesRoute)({ params: routeParams })).rejects.toThrow(
+      'NOT_COMMUNITY_ADMIN'
+    );
+    expect(calls.context).toHaveBeenCalled();
+    expect(calls.venues).not.toHaveBeenCalled();
   });

-  it('loads member detail by scoped membership ID and keeps roster pages status-scoped', () => {
-    const detail = source(
-      '../src/routes/_protected.community.$communityId.admin.members.$membershipId.tsx'
+  it('recovers the admin loader after a transient first failure', async () => {
+    calls.context.mockRejectedValueOnce(new Error('temporary loader failure'));
+    calls.context.mockResolvedValueOnce(community);
+    await expect(loader(AdminRoute)({ params: routeParams })).rejects.toThrow(
+      'temporary loader failure'
     );
-    expect(detail).toContain('getCommunityMemberById');
-    expect(detail).not.toContain('searchCommunityMembers');
-    const members = source('../src/routes/_protected.community.$communityId.admin.members.tsx');
-    expect(members).toContain("status: 'active'");
-    expect(members).toContain('limit: 50');
-    const requests = source('../src/routes/_protected.community.$communityId.admin.requests.tsx');
-    expect(requests).toContain("status: 'pending'");
-    const screen = source('../src/features/community/CommunityAdmin.tsx');
-    expect(screen).toContain('status: filterStatus');
-    expect(screen).toContain('offset,');
+    await expect(loader(AdminRoute)({ params: routeParams })).resolves.toEqual(community);
+    expect(calls.context).toHaveBeenCalledTimes(2);
   });

-  it('imports explicit module-level membership endpoints into the route-owned UI', () => {
-    const ui = source('../src/features/community/CommunityAdmin.tsx');
-    for (const endpoint of [
-      'approveCommunityMember',
-      'denyCommunityMember',
-      'removeCommunityMember',
-      'reactivateCommunityMember',
-      'promoteCommunityMember',
-      'demoteCommunityMember'
-    ])
-      expect(ui).toContain(endpoint);
+  it('keeps route-level redirect and loader exports bound to the actual route definitions', () => {
+    expect(AdminRoute.options.loader).toBeDefined();
+    expect(AdminIndexRoute.options.beforeLoad).toBeDefined();
+    expect(MembersRoute.options.component).toBeDefined();
+    expect(SettingsRoute.options.loader).toBeDefined();
   });
 });
diff --git a/test/community.admin-ui.test.tsx b/test/community.admin-ui.test.tsx
index aeb4c65..003ca94 100644
--- a/test/community.admin-ui.test.tsx
+++ b/test/community.admin-ui.test.tsx
@@ -1,5 +1,5 @@
 /** @vitest-environment jsdom */
-import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
+import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
 import userEvent from '@testing-library/user-event';
 import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
 import { I18nextProvider } from 'react-i18next';
@@ -8,6 +8,7 @@ const mocks = vi.hoisted(() => ({
   invalidate: vi.fn<() => Promise<void>>(),
   navigate: vi.fn<() => Promise<void>>(),
   listVenues: vi.fn<() => Promise<unknown>>(),
+  listAudit: vi.fn<() => Promise<unknown>>(),
   approve: vi.fn<() => Promise<unknown>>(),
   deny: vi.fn<() => Promise<unknown>>(),
   remove: vi.fn<() => Promise<unknown>>(),
@@ -51,6 +52,7 @@ vi.mock('../src/features/community/community-admin.functions', () => ({
   promoteCommunityMember: mocks.promote,
   demoteCommunityMember: mocks.demote,
   searchCommunityMembers: mocks.search,
+  listCommunityAudit: mocks.listAudit,
   listCommunityVenues: mocks.listVenues,
   addCommunityVenue: mocks.addVenue,
   editCommunityVenue: mocks.editVenue,
@@ -93,14 +95,19 @@ function mount(
   screenName: 'requests' | 'members' | 'member' | 'settings' | 'venues' | 'audit',
   locale: 'en' | 'es' | 'pt-BR' = 'en'
 ) {
+  const props =
+    screenName === 'requests' || screenName === 'members'
+      ? { screen: screenName, community, members: [member] }
+      : screenName === 'member'
+        ? { screen: screenName, community, member, membershipId: member.membership_id }
+        : screenName === 'venues'
+          ? { screen: screenName, community, venues: [] }
+          : screenName === 'audit'
+            ? { screen: screenName, community, audit: [] }
+            : { screen: screenName, community };
   return render(
     <I18nextProvider i18n={createI18n(locale)}>
-      <CommunityAdminScreen
-        screen={screenName}
-        community={community}
-        members={[member]}
-        membershipId={member.membership_id}
-      />
+      <CommunityAdminScreen {...props} />
     </I18nextProvider>
   );
 }
@@ -113,6 +120,7 @@ beforeEach(() => {
   mocks.reactivate.mockResolvedValue({ membership_id: '44444444-4444-4444-8444-444444444444' });
   mocks.search.mockResolvedValue([member]);
   mocks.listVenues.mockResolvedValue([]);
+  mocks.listAudit.mockResolvedValue([]);
 });
 afterEach(cleanup);

@@ -183,17 +191,79 @@ describe('community admin UI', () => {
         <CommunityAdminScreen
           screen="member"
           community={community}
-          members={[active]}
+          member={active}
           membershipId={active.membership_id}
         />
       </I18nextProvider>
     );
-    await user.click(screen.getByRole('button', { name: 'Remove from community' }));
-    expect(screen.getByRole('status').textContent).toContain(
-      'Confirm Remove from community for Alicia Ramos?'
+    const trigger = screen.getByRole('button', { name: 'Remove from community' });
+    trigger.focus();
+    await user.keyboard('{Enter}');
+    const dialog = await screen.findByRole('alertdialog');
+    expect(
+      within(dialog).getByText('Confirm Remove from community for Alicia Ramos?')
+    ).toBeTruthy();
+    const cancel = within(dialog).getByRole('button', { name: 'CANCEL' });
+    const dialogPortal = dialog.closest('[data-base-ui-portal]');
+    expect(document.activeElement).toBe(cancel);
+    await user.tab();
+    expect(dialogPortal?.contains(document.activeElement)).toBe(true);
+    await user.tab();
+    expect(dialogPortal?.contains(document.activeElement)).toBe(true);
+    await user.tab({ shift: true });
+    expect(document.activeElement).toBe(
+      within(dialog).getByRole('button', { name: 'CONFIRM CHANGE' })
     );
-    await user.click(screen.getByRole('button', { name: 'CONFIRM CHANGE' }));
-    await waitFor(() => expect(mocks.remove).toHaveBeenCalledOnce());
+    await user.keyboard('{Escape}');
+    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
+    expect(document.activeElement).toBe(trigger);
+    await user.keyboard('{Enter}');
+    await screen.findByRole('alertdialog');
+    await user.click(
+      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'CANCEL' })
+    );
+    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
+    expect(document.activeElement).toBe(trigger);
+    await user.keyboard('{Enter}');
+    await screen.findByRole('alertdialog');
+    await user.click(
+      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'CONFIRM CHANGE' })
+    );
+    await waitFor(() => expect(mocks.remove).toHaveBeenCalledTimes(1));
+    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
+    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Member controls' }));
+  });
+
+  it('keeps failed confirmation open for retry and restores focus after cancel', async () => {
+    const user = userEvent.setup();
+    const active = { ...member, status: 'active' as const };
+    mocks.remove.mockRejectedValueOnce(new Error('temporary failure'));
+    render(
+      <I18nextProvider i18n={createI18n('en')}>
+        <CommunityAdminScreen
+          screen="member"
+          community={community}
+          member={active}
+          membershipId={active.membership_id}
+        />
+      </I18nextProvider>
+    );
+    const trigger = screen.getByRole('button', { name: 'Remove from community' });
+    await user.click(trigger);
+    const dialog = await screen.findByRole('alertdialog');
+    const confirm = within(dialog).getByRole('button', { name: 'CONFIRM CHANGE' });
+    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'CANCEL' }));
+    await user.click(confirm);
+    const error = await within(dialog).findByRole('alert');
+    expect(error.textContent).toContain('Could not complete the change');
+    expect(within(dialog).getByRole('button', { name: 'TRY AGAIN' })).toBeTruthy();
+    expect(screen.getByRole('alertdialog')).toBe(dialog);
+    expect(mocks.remove).toHaveBeenCalledTimes(1);
+    await user.click(
+      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'CANCEL' })
+    );
+    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
+    expect(document.activeElement).toBe(trigger);
   });

   it('shows unavailable nullable ratings on requests, roster, and detail without changing valid ratings', () => {
@@ -211,12 +281,16 @@ describe('community admin UI', () => {
         view === 'members' ? { ...noRatings, status: 'active' as const } : noRatings;
       render(
         <I18nextProvider i18n={createI18n('en')}>
-          <CommunityAdminScreen
-            screen={view}
-            community={community}
-            members={[displayed]}
-            membershipId={displayed.membership_id}
-          />
+          {view === 'member' ? (
+            <CommunityAdminScreen
+              screen="member"
+              community={community}
+              member={displayed}
+              membershipId={displayed.membership_id}
+            />
+          ) : (
+            <CommunityAdminScreen screen={view} community={community} members={[displayed]} />
+          )}
         </I18nextProvider>
       );
       expect(screen.getByText(/ratings unavailable/i)).toBeTruthy();
@@ -430,7 +504,7 @@ describe('community admin UI', () => {
         <CommunityAdminScreen
           screen="member"
           community={community}
-          members={[inactive]}
+          member={inactive}
           membershipId={inactive.membership_id}
         />
       </I18nextProvider>
@@ -502,12 +576,411 @@ describe('community admin UI', () => {
     expect(screen.queryByText('Community admin')).toBeNull();
   });

-  it('localizes denied access and keeps unsupported audit events generic', () => {
+  it('characterizes a pending member load-more response crossing a loader refresh', async () => {
+    let resolvePage!: (rows: Member[]) => void;
+    const page = new Promise<Member[]>((resolve) => (resolvePage = resolve));
+    const firstPage = Array.from({ length: 50 }, (_, index) => ({
+      ...member,
+      membership_id: `00000000-0000-4000-8000-${String(index + 601).padStart(12, '0')}`,
+      display_name: `Pending source A ${index}`,
+      status: 'pending' as const
+    }));
+    const freshLoader = { ...member, display_name: 'Fresh loader row', status: 'active' as const };
+    const refreshedPage = firstPage.map((row) => ({
+      ...row,
+      display_name: `Fresh ${row.display_name}`
+    }));
+    const nextPage = [
+      { ...member, display_name: 'Fresh next-page row', status: 'pending' as const }
+    ];
+    mocks.search
+      .mockResolvedValueOnce(firstPage)
+      .mockReturnValueOnce(page)
+      .mockResolvedValueOnce(refreshedPage)
+      .mockResolvedValueOnce(nextPage);
+    const view = render(
+      <I18nextProvider i18n={createI18n('en')}>
+        <CommunityAdminScreen screen="members" community={community} members={[member]} />
+      </I18nextProvider>
+    );
+    await userEvent.click(screen.getByRole('button', { name: 'Pending' }));
+    await screen.findByText('Pending source A 0');
+    await userEvent.click(screen.getByRole('button', { name: 'LOAD MORE CHANGES' }));
+    view.rerender(
+      <I18nextProvider i18n={createI18n('en')}>
+        <CommunityAdminScreen screen="members" community={community} members={[freshLoader]} />
+      </I18nextProvider>
+    );
+    await screen.findByText('Fresh Pending source A 0');
+    const loadMore = screen.getByRole('button', { name: 'LOAD MORE CHANGES' });
+    await waitFor(() => expect(loadMore.hasAttribute('disabled')).toBe(false));
+    await userEvent.click(loadMore);
+    await screen.findByText('Fresh next-page row');
+    await act(async () =>
+      resolvePage([{ ...member, display_name: 'Old source appended row', status: 'pending' }])
+    );
+    await waitFor(() => expect(screen.queryByText('Old source appended row')).toBeNull());
+    expect(screen.getByText('Fresh next-page row')).toBeTruthy();
+  });
+
+  it('characterizes a pending audit page completion crossing a loader refresh', async () => {
+    const auditEvent = (id: string, action = 'INSERT') => ({
+      id,
+      actor_user_id: null,
+      entity: 'community_members',
+      entity_id: member.membership_id,
+      action,
+      details: { role: 'member', status: 'pending' },
+      occurred_at: '2026-10-01T10:30:00Z'
+    });
+    let resolvePage!: (rows: ReturnType<typeof auditEvent>[]) => void;
+    const page = new Promise<ReturnType<typeof auditEvent>[]>((resolve) => (resolvePage = resolve));
+    const initial = [auditEvent('audit-a'), auditEvent('audit-b'), auditEvent('audit-c')];
+    const refreshed = [
+      auditEvent('audit-new-a'),
+      auditEvent('audit-new-b'),
+      auditEvent('audit-new-c')
+    ];
+    mocks.listAudit.mockReturnValueOnce(page);
+    const view = render(
+      <I18nextProvider i18n={createI18n('en')}>
+        <CommunityAdminScreen screen="audit" community={community} audit={initial} />
+      </I18nextProvider>
+    );
+    await userEvent.click(screen.getByRole('button', { name: 'LOAD MORE CHANGES' }));
+    view.rerender(
+      <I18nextProvider i18n={createI18n('en')}>
+        <CommunityAdminScreen screen="audit" community={community} audit={refreshed} />
+      </I18nextProvider>
+    );
+    const loadMore = screen.getByRole('button', { name: 'LOAD MORE CHANGES' });
+    await waitFor(() => expect(loadMore.hasAttribute('disabled')).toBe(false));
+    const nextPage = [
+      { ...auditEvent('audit-next-page'), details: { role: 'member', status: 'active' } }
+    ];
+    mocks.listAudit.mockResolvedValueOnce(nextPage);
+    await userEvent.click(loadMore);
+    await waitFor(() => expect(screen.getAllByTestId('community-audit-event')).toHaveLength(4));
+    await act(async () =>
+      resolvePage([{ ...auditEvent('audit-old-page'), entity: 'community_venues' }])
+    );
+    await waitFor(() => expect(screen.getAllByTestId('community-audit-event')).toHaveLength(4));
+    expect(screen.queryByText('Venue added')).toBeNull();
+    expect(screen.getAllByTestId('community-audit-event')).toHaveLength(4);
+  });
+
+  it('releases venue pagination after a loader refresh and accepts the next page', async () => {
+    const venue = (id: string, name: string) => ({
+      id,
+      community_id: community.id,
+      name,
+      address: null,
+      maps_url: null,
+      photo_path: null,
+      created_at: '2026-10-01T00:00:00Z',
+      updated_at: '2026-10-01T00:00:00Z',
+      archived_at: null
+    });
+    const firstPage = Array.from({ length: 50 }, (_, index) =>
+      venue(
+        `00000000-0000-4000-8000-${String(index + 701).padStart(12, '0')}`,
+        `Old venue ${index}`
+      )
+    );
+    let resolveOldPage!: (rows: ReturnType<typeof venue>[]) => void;
+    const oldPage = new Promise<ReturnType<typeof venue>[]>(
+      (resolve) => (resolveOldPage = resolve)
+    );
+    mocks.listVenues.mockReturnValueOnce(oldPage);
+    const view = render(
+      <I18nextProvider i18n={createI18n('en')}>
+        <CommunityAdminScreen screen="venues" community={community} venues={firstPage} />
+      </I18nextProvider>
+    );
+    await userEvent.click(screen.getByRole('button', { name: 'LOAD MORE CHANGES' }));
+    const freshPage = Array.from({ length: 50 }, (_, index) =>
+      venue(
+        `00000000-0000-4000-8000-${String(index + 801).padStart(12, '0')}`,
+        `Fresh venue ${index}`
+      )
+    );
+    view.rerender(
+      <I18nextProvider i18n={createI18n('en')}>
+        <CommunityAdminScreen screen="venues" community={community} venues={freshPage} />
+      </I18nextProvider>
+    );
+    const loadMore = screen.getByRole('button', { name: 'LOAD MORE CHANGES' });
+    await waitFor(() => expect(loadMore.hasAttribute('disabled')).toBe(false));
+    const next = venue('00000000-0000-4000-8000-000000000901', 'Fresh page venue');
+    mocks.listVenues.mockResolvedValueOnce([next]);
+    await userEvent.click(loadMore);
+    await screen.findByText('Fresh page venue');
+    await act(async () =>
+      resolveOldPage([venue('00000000-0000-4000-8000-000000000902', 'Stale venue')])
+    );
+    expect(screen.queryByText('Stale venue')).toBeNull();
+    expect(screen.getByText('Fresh page venue')).toBeTruthy();
+    expect(screen.getAllByTestId('community-venue-card')).toHaveLength(51);
+    expect(mocks.listVenues).toHaveBeenCalledTimes(2);
+    expect(
+      screen
+        .getAllByRole('button', { name: 'Archive venue' })
+        .every((button) => !button.hasAttribute('disabled'))
+    ).toBe(true);
+  });
+
+  it('restores demote focus to its own trigger and falls back after successful demotion', async () => {
+    const user = userEvent.setup();
+    const activeAdmin = { ...member, role: 'admin' as const, status: 'active' as const };
+    render(
+      <I18nextProvider i18n={createI18n('en')}>
+        <CommunityAdminScreen
+          screen="member"
+          community={community}
+          member={activeAdmin}
+          membershipId={activeAdmin.membership_id}
+        />
+      </I18nextProvider>
+    );
+    const demote = screen.getByRole('button', { name: 'Demote to member' });
+    const remove = screen.getByRole('button', { name: 'Remove from community' });
+    demote.focus();
+    await user.keyboard('{Enter}');
+    await screen.findByRole('alertdialog');
+    await user.keyboard('{Escape}');
+    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
+    expect(document.activeElement).toBe(demote);
+    demote.focus();
+    await user.keyboard('{Enter}');
+    await screen.findByRole('alertdialog');
+    await user.click(
+      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'CANCEL' })
+    );
+    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
+    expect(document.activeElement).toBe(demote);
+    expect(remove.isConnected).toBe(true);
+    await user.click(demote);
+    await user.click(
+      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'CONFIRM CHANGE' })
+    );
+    await waitFor(() => expect(mocks.demote).toHaveBeenCalledOnce());
+    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
+    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Member controls' }));
+  });
+
+  it('keeps member actions available across demote-promote and remove-reactivate lifecycles', async () => {
+    const user = userEvent.setup();
+    const activeAdmin = { ...member, role: 'admin' as const, status: 'active' as const };
+    const view = render(
+      <I18nextProvider i18n={createI18n('en')}>
+        <CommunityAdminScreen
+          screen="member"
+          community={community}
+          member={activeAdmin}
+          membershipId={activeAdmin.membership_id}
+        />
+      </I18nextProvider>
+    );
+    await user.click(screen.getByRole('button', { name: 'Demote to member' }));
+    await user.click(
+      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'CONFIRM CHANGE' })
+    );
+    await waitFor(() => expect(mocks.demote).toHaveBeenCalledOnce());
+    const demoted = { ...activeAdmin, role: 'member' as const };
+    view.rerender(
+      <I18nextProvider i18n={createI18n('en')}>
+        <CommunityAdminScreen
+          screen="member"
+          community={community}
+          member={demoted}
+          membershipId={demoted.membership_id}
+        />
+      </I18nextProvider>
+    );
+    const promote = screen.getByRole('button', { name: 'Promote to admin' });
+    expect(screen.queryByRole('button', { name: 'Demote to member' })).toBeNull();
+    await user.click(promote);
+    await waitFor(() => expect(mocks.promote).toHaveBeenCalledOnce());
+    const promoted = { ...activeAdmin, role: 'admin' as const };
+    view.rerender(
+      <I18nextProvider i18n={createI18n('en')}>
+        <CommunityAdminScreen
+          screen="member"
+          community={community}
+          member={promoted}
+          membershipId={promoted.membership_id}
+        />
+      </I18nextProvider>
+    );
+    expect(screen.getByRole('button', { name: 'Demote to member' })).toBeTruthy();
+
+    await user.click(screen.getByRole('button', { name: 'Remove from community' }));
+    await user.click(
+      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'CONFIRM CHANGE' })
+    );
+    await waitFor(() => expect(mocks.remove).toHaveBeenCalledOnce());
+    const inactive = { ...promoted, status: 'inactive' as const };
+    view.rerender(
+      <I18nextProvider i18n={createI18n('en')}>
+        <CommunityAdminScreen
+          screen="member"
+          community={community}
+          member={inactive}
+          membershipId={inactive.membership_id}
+        />
+      </I18nextProvider>
+    );
+    expect(screen.getByRole('button', { name: 'Reactivate membership' })).toBeTruthy();
+    expect(screen.queryByRole('button', { name: 'Remove from community' })).toBeNull();
+    await user.click(screen.getByRole('button', { name: 'Reactivate membership' }));
+    await waitFor(() => expect(mocks.reactivate).toHaveBeenCalledOnce());
+    const replacement = { ...member, status: 'active' as const };
+    view.rerender(
+      <I18nextProvider i18n={createI18n('en')}>
+        <CommunityAdminScreen
+          screen="member"
+          community={community}
+          member={replacement}
+          membershipId="44444444-4444-4444-8444-444444444444"
+        />
+      </I18nextProvider>
+    );
+    expect(screen.getByRole('button', { name: 'Remove from community' })).toBeTruthy();
+    expect(screen.getByRole('button', { name: 'Promote to admin' })).toBeTruthy();
+  });
+
+  it('closes a committed removal confirmation when refresh fails and retries refresh only', async () => {
+    const user = userEvent.setup();
+    mocks.invalidate.mockRejectedValueOnce(new Error('offline'));
+    const active = { ...member, status: 'active' as const };
+    render(
+      <I18nextProvider i18n={createI18n('en')}>
+        <CommunityAdminScreen
+          screen="member"
+          community={community}
+          member={active}
+          membershipId={active.membership_id}
+        />
+      </I18nextProvider>
+    );
+    await user.click(screen.getByRole('button', { name: 'Remove from community' }));
+    await user.click(
+      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'CONFIRM CHANGE' })
+    );
+    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
+    expect(mocks.remove).toHaveBeenCalledOnce();
+    await user.click(screen.getByRole('button', { name: 'TRY AGAIN' }));
+    await waitFor(() => expect(mocks.invalidate).toHaveBeenCalledTimes(2));
+    expect(mocks.remove).toHaveBeenCalledOnce();
+  });
+
+  it('isolates member search state when switching to settings and back', async () => {
+    const view = render(
+      <I18nextProvider i18n={createI18n('en')}>
+        <CommunityAdminScreen screen="members" community={community} members={[member]} />
+      </I18nextProvider>
+    );
+    const input = screen.getByRole('searchbox', { name: 'Search members' });
+    fireEvent.change(input, { target: { value: 'Private query' } });
+    await waitFor(() => expect(mocks.search).toHaveBeenCalled());
+    const searchCount = mocks.search.mock.calls.length;
+    view.rerender(
+      <I18nextProvider i18n={createI18n('en')}>
+        <CommunityAdminScreen screen="settings" community={community} />
+      </I18nextProvider>
+    );
+    expect(mocks.search).toHaveBeenCalledTimes(searchCount);
+    view.rerender(
+      <I18nextProvider i18n={createI18n('en')}>
+        <CommunityAdminScreen screen="members" community={community} members={[member]} />
+      </I18nextProvider>
+    );
+    expect(screen.getByRole('searchbox', { name: 'Search members' }).value).toBe('');
+  });
+
+  it('isolates audit paging state when switching to another screen and back', async () => {
+    const event = (id: string) =>
+      ({
+        id,
+        actor_user_id: null,
+        entity: 'community_members',
+        entity_id: member.membership_id,
+        action: 'INSERT',
+        details: { role: 'member', status: 'pending' },
+        occurred_at: '2026-10-01T10:30:00Z'
+      }) as const;
+    const firstEvents = [event('audit-first'), event('audit-second'), event('audit-third')];
+    const nextEvent = { ...event('audit-appended'), entity: 'community_venues' };
+    mocks.listAudit.mockResolvedValueOnce([nextEvent]);
+    const view = render(
+      <I18nextProvider i18n={createI18n('en')}>
+        <CommunityAdminScreen screen="audit" community={community} audit={firstEvents} />
+      </I18nextProvider>
+    );
+    await userEvent.click(screen.getByRole('button', { name: 'LOAD MORE CHANGES' }));
+    await screen.findByText('Venue added');
+    const auditCalls = mocks.listAudit.mock.calls.length;
+    view.rerender(
+      <I18nextProvider i18n={createI18n('en')}>
+        <CommunityAdminScreen screen="venues" community={community} venues={[]} />
+      </I18nextProvider>
+    );
+    expect(mocks.listAudit).toHaveBeenCalledTimes(auditCalls);
+    view.rerender(
+      <I18nextProvider i18n={createI18n('en')}>
+        <CommunityAdminScreen screen="audit" community={community} audit={firstEvents} />
+      </I18nextProvider>
+    );
+    expect(screen.queryByText('Venue added')).toBeNull();
+    expect(screen.getAllByTestId('community-audit-event')).toHaveLength(3);
+  });
+
+  it.each(['en', 'es', 'pt-BR'] as const)(
+    'provides localized recoverable error controls (%s)',
+    async (locale) => {
+      const reset = vi.fn<() => void>();
+      let release!: () => void;
+      mocks.invalidate.mockReturnValueOnce(new Promise<void>((resolve) => (release = resolve)));
+      const user = userEvent.setup();
+      const show = (error: Error) =>
+        render(
+          <I18nextProvider i18n={createI18n(locale)}>
+            <CommunityAdminDenied error={error} reset={reset} />
+          </I18nextProvider>
+        );
+      show(new Error('temporary failure'));
+      expect(screen.getByRole('button')).toBeTruthy();
+      expect(
+        screen.getByRole('link', { name: /dashboard|painel|panel/i }).getAttribute('href')
+      ).toBe('/dashboard');
+      const retry = screen.getByRole('button');
+      await user.click(retry);
+      await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(true));
+      await user.click(retry);
+      expect(mocks.invalidate).toHaveBeenCalledOnce();
+      expect(reset).not.toHaveBeenCalled();
+      await act(async () => release());
+      await waitFor(() => expect(reset).toHaveBeenCalledOnce());
+
+      cleanup();
+      show(new Error('NOT_COMMUNITY_ADMIN'));
+      expect(screen.queryByRole('button')).toBeNull();
+      expect(screen.getByRole('link', { name: /dashboard|painel|panel/i })).toBeTruthy();
+      cleanup();
+      show(new Error('COMMUNITY_MEMBER_NOT_FOUND'));
+      expect(screen.queryByRole('button')).toBeNull();
+    }
+  );
+
+  it('keeps generic loader error visible when retry invalidation fails', async () => {
+    mocks.invalidate.mockRejectedValueOnce(new Error('offline'));
     render(
-      <I18nextProvider i18n={createI18n('es')}>
-        <CommunityAdminDenied error={new Error('NOT_COMMUNITY_ADMIN')} />
+      <I18nextProvider i18n={createI18n('en')}>
+        <CommunityAdminDenied error={new Error('temporary failure')} reset={vi.fn<() => void>()} />
       </I18nextProvider>
     );
-    expect(screen.getByRole('alert').textContent).toContain('acceso activo de administración');
+    await userEvent.click(screen.getByRole('button'));
+    expect(await screen.findByRole('alert')).toBeTruthy();
+    expect(screen.getByRole('button')).toBeTruthy();
   });
 });
diff --git a/test/community.admin.functions.test.ts b/test/community.admin.functions.test.ts
index 7ef7436..803fb4d 100644
--- a/test/community.admin.functions.test.ts
+++ b/test/community.admin.functions.test.ts
@@ -30,7 +30,8 @@ import {
   demoteCommunityMember,
   issueInvitation,
   listMyAdminCommunities,
-  searchCommunityMembers
+  searchCommunityMembers,
+  getCommunityAdminContext
 } from '../src/features/community/community-admin.functions';
 import { validateVenue } from '../src/features/community/community-admin.validators';

@@ -77,6 +78,110 @@ beforeEach(() => {
   mocks.header.mockReset();
 });
 describe('admin function boundary', () => {
+  it.each([null, [], {}, { community_id: 'not-a-uuid' }, { community_id, extra: true }])(
+    'rejects invalid admin-context payload before client access: %j',
+    (data) => {
+      expect(() => getCommunityAdminContext({ data })).toThrow('INVALID_COMMUNITY_INPUT');
+      expect(mocks.client).not.toHaveBeenCalled();
+    }
+  );
+  it('rejects inherited-only community IDs and accepts uppercase UUIDs', async () => {
+    const inherited = Object.create({ community_id });
+    expect(() => getCommunityAdminContext({ data: inherited })).toThrow('INVALID_COMMUNITY_INPUT');
+    expect(mocks.client).not.toHaveBeenCalled();
+
+    const uppercaseId = community_id.toUpperCase();
+    const communityQuery = {
+      select: vi.fn<(columns: string) => unknown>(),
+      eq: vi.fn<(column: string, value: string) => unknown>(),
+      single: vi.fn<() => Promise<{ data: { id: string }; error: null }>>().mockResolvedValue({
+        data: { id: uppercaseId },
+        error: null
+      })
+    };
+    communityQuery.select.mockImplementation(() => communityQuery);
+    communityQuery.eq.mockImplementation(() => communityQuery);
+    const client = {
+      auth: {
+        getClaims: vi
+          .fn<() => Promise<{ data: { claims: { sub: string } }; error: null }>>()
+          .mockResolvedValue({ data: { claims: { sub: membership_id } }, error: null })
+      },
+      rpc: vi.fn<() => Promise<{ data: boolean; error: null }>>().mockResolvedValue({
+        data: true,
+        error: null
+      }),
+      from: vi.fn<(table: string) => typeof communityQuery>().mockReturnValue(communityQuery)
+    };
+    mocks.client.mockReturnValue(client);
+    await expect(
+      getCommunityAdminContext({ data: { community_id: uppercaseId } })
+    ).resolves.toEqual({ id: uppercaseId });
+    expect(client.auth.getClaims).toHaveBeenCalledOnce();
+    expect(mocks.header).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
+  });
+  it('does not read communities or admin data when live admin authorization denies access', async () => {
+    const rpc = vi.fn<() => Promise<{ data: boolean; error: null }>>().mockResolvedValue({
+      data: false,
+      error: null
+    });
+    const from = vi.fn<(table: string) => never>();
+    const client = {
+      auth: {
+        getClaims: vi
+          .fn<() => Promise<{ data: { claims: { sub: string } }; error: null }>>()
+          .mockResolvedValue({ data: { claims: { sub: membership_id } }, error: null })
+      },
+      rpc,
+      from
+    };
+    mocks.client.mockReturnValue(client);
+    await expect(getCommunityAdminContext({ data: { community_id } })).rejects.toThrow(
+      'NOT_COMMUNITY_ADMIN'
+    );
+    expect(client.auth.getClaims).toHaveBeenCalledOnce();
+    expect(mocks.header).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
+    expect(rpc).toHaveBeenCalledWith('is_community_admin', { p_community_id: community_id });
+    expect(from).not.toHaveBeenCalled();
+  });
+  it('reads only the safe community context fields after live authorization', async () => {
+    const communityQuery = {
+      select: vi.fn<(columns: string) => unknown>(),
+      eq: vi.fn<(column: string, value: string) => unknown>(),
+      single: vi
+        .fn<() => Promise<{ data: { id: string; name: string }; error: null }>>()
+        .mockResolvedValue({
+          data: { id: community_id, name: 'Safe' },
+          error: null
+        })
+    };
+    communityQuery.select.mockImplementation(() => communityQuery);
+    communityQuery.eq.mockImplementation(() => communityQuery);
+    const client = {
+      auth: {
+        getClaims: vi
+          .fn<() => Promise<{ data: { claims: { sub: string } }; error: null }>>()
+          .mockResolvedValue({ data: { claims: { sub: membership_id } }, error: null })
+      },
+      rpc: vi.fn<() => Promise<{ data: boolean; error: null }>>().mockResolvedValue({
+        data: true,
+        error: null
+      }),
+      from: vi.fn<(table: string) => typeof communityQuery>().mockReturnValue(communityQuery)
+    };
+    mocks.client.mockReturnValue(client);
+    await expect(getCommunityAdminContext({ data: { community_id } })).resolves.toEqual({
+      id: community_id,
+      name: 'Safe'
+    });
+    expect(client.from).toHaveBeenCalledOnce();
+    expect(client.from).toHaveBeenCalledWith('communities');
+    expect(communityQuery.select).toHaveBeenCalledWith(
+      'id,name,city_label,description,visibility,join_policy'
+    );
+    expect(communityQuery.eq).toHaveBeenCalledWith('id', community_id);
+    expect(communityQuery.single).toHaveBeenCalledOnce();
+  });
   it('filters future-valid admin memberships in one server query without per-row RPCs', async () => {
     const futureCommunityId = '44444444-4444-4444-8444-444444444444';
     const memberships = [
diff --git a/test/community.admin.integration.test.ts b/test/community.admin.integration.test.ts
index d39618b..23839e4 100644
--- a/test/community.admin.integration.test.ts
+++ b/test/community.admin.integration.test.ts
@@ -1107,6 +1107,13 @@ describe.skipIf(environment.env === null)('community governance with real JWTs',
     await expect(
       issueInvitation({ data: { community_id: id, invitee_user_id: crypto.randomUUID() } })
     ).rejects.toThrow('INVITEE_NOT_FOUND');
+    const unarchivedVenue = await admin.client
+      .from('community_venues')
+      .select('archived_at')
+      .eq('id', venue.id)
+      .single();
+    expect(unarchivedVenue.error).toBeNull();
+    expect(unarchivedVenue.data?.archived_at).toBeNull();
     const archived = await archiveCommunityVenue({
       data: { community_id: id, venue_id: venue.id }
     });
@@ -1123,7 +1130,11 @@ describe.skipIf(environment.env === null)('community governance with real JWTs',
       action: 'UPDATE',
       details: { archived: true }
     });
-    expect(archiveEvent?.details).toEqual({ archived: true });
+    expect(archiveEvent?.details).toEqual({
+      archived: true,
+      changed_fields: ['archived_at'],
+      transitions: { archived: { before: false, after: true } }
+    });
     expect(archiveEvent?.details).not.toEqual(
       editedAudit.find((row) => row.action === 'UPDATE')?.details
     );
diff --git a/test/community.integration.test.ts b/test/community.integration.test.ts
index 5971f8c..f35f6c9 100644
--- a/test/community.integration.test.ts
+++ b/test/community.integration.test.ts
@@ -1,6 +1,6 @@
 import { spawn } from 'node:child_process';
 import { createClient, type SupabaseClient } from '@supabase/supabase-js';
-import { describe, expect, it, vi } from 'vitest';
+import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
 import {
   assertLocalSupabaseEnvInCi,
   dotEnvPathFromImportMetaUrl,
@@ -42,6 +42,7 @@ import {
   listPublicCommunities,
   updateCommunitySettings
 } from '../src/features/community/community.functions';
+import { reactivateCommunityMember } from '../src/features/community/community-admin.functions';

 vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });
 type LocalEnv = NonNullable<ReturnType<typeof localSupabaseEnv>['env']>;
@@ -63,11 +64,12 @@ describe.skipIf(environment.env === null)('community domain (local Supabase inte
     const { url, key } = env();
     return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
   }
-  type Actor = { client: SupabaseClient; id: string };
+  type Actor = { client: SupabaseClient; email: string; id: string };
   async function actor(label: string): Promise<Actor> {
     const { url, key } = env();
+    const email = `${label}-${crypto.randomUUID()}@test.local`;
     const signup = await anon().auth.signUp({
-      email: `${label}-${crypto.randomUUID()}@test.local`,
+      email,
       password: 'Password123!'
     });
     expect(signup.error).toBeNull();
@@ -82,7 +84,7 @@ describe.skipIf(environment.env === null)('community domain (local Supabase inte
       refresh_token: signup.data.session!.refresh_token
     });
     expect(session.error).toBeNull();
-    return { id: signup.data.user!.id, client };
+    return { id: signup.data.user!.id, email, client };
   }
   async function rows(
     client: SupabaseClient,
@@ -99,14 +101,65 @@ describe.skipIf(environment.env === null)('community domain (local Supabase inte
       expectNoError(result);
       return result.data ?? [];
     }
-    const result = await client.from(table).select('*').eq('community_id', communityId);
+    let query = client.from(table).select('*').eq('community_id', communityId);
+    if (table === 'community_audit_log') query = query.order('occurred_at', { ascending: true });
+    const result = await query;
     expectNoError(result);
     return result.data ?? [];
   }
   function expectNoError(result: { error: unknown }) {
     expect(result.error).toBeNull();
   }
-  async function executeLocalFixtureSql(sql: string) {
+  function isExpiredInvitationResult(
+    value: unknown
+  ): value is { rows: Array<{ id: string; created_at: string; expires_at: string }> } {
+    if (typeof value !== 'object' || value === null || !('rows' in value)) return false;
+    const { rows: resultRows } = value;
+    if (!Array.isArray(resultRows) || resultRows.length !== 1) return false;
+    const row: unknown = resultRows[0];
+    return (
+      typeof row === 'object' &&
+      row !== null &&
+      'id' in row &&
+      typeof row.id === 'string' &&
+      'created_at' in row &&
+      typeof row.created_at === 'string' &&
+      'expires_at' in row &&
+      typeof row.expires_at === 'string'
+    );
+  }
+  function isSqlRowsWithId(value: unknown): value is { rows: Array<{ id: string }> } {
+    if (typeof value !== 'object' || value === null || !('rows' in value)) return false;
+    const { rows: resultRows } = value;
+    if (!Array.isArray(resultRows) || resultRows.length !== 1) return false;
+    const row: unknown = resultRows[0];
+    return typeof row === 'object' && row !== null && 'id' in row && typeof row.id === 'string';
+  }
+  function isPlainRowObject(value: unknown): value is Record<string, unknown> {
+    return typeof value === 'object' && value !== null && !Array.isArray(value);
+  }
+  // `supabase db query --local --output-format json` (CLI v2.118) prints the
+  // statement's rows as a top-level JSON array of row objects; older CLI
+  // revisions nested them under a `rows` key. Model both, nothing else.
+  function toLocalFixtureResult(value: unknown): { rows: Array<Record<string, unknown>> } | null {
+    const candidate: unknown[] | null = Array.isArray(value)
+      ? value
+      : isPlainRowObject(value) && Array.isArray(value.rows)
+        ? value.rows
+        : null;
+    if (candidate === null) return null;
+    const fixtureRows: Array<Record<string, unknown>> = [];
+    for (const row of candidate) {
+      if (!isPlainRowObject(row)) return null;
+      fixtureRows.push(row);
+    }
+    return { rows: fixtureRows };
+  }
+  // Fixture SQL only ever references the SHA-256 token hash, never the raw
+  // invitation token, so raw CLI output is safe to surface in diagnostics.
+  async function executeLocalFixtureSql(sql: string): Promise<{
+    rows: Array<Record<string, unknown>>;
+  }> {
     const child = spawn(
       'pnpm',
       ['exec', 'supabase', 'db', 'query', '--local', '--output-format', 'json', sql],
@@ -120,10 +173,31 @@ describe.skipIf(environment.env === null)('community domain (local Supabase inte
       child.once('error', (error) => resolve({ code: null, error }));
       child.once('close', (code) => resolve({ code }));
     });
+    const rawOutput = `stdout:\n${stdout}\nstderr:\n${stderr}`;
     if (result.code !== 0)
       throw new Error(
-        `Local timeline fixture SQL failed: ${result.error ?? `${stdout}\n${stderr}`}`
+        `Local fixture SQL failed (exit ${result.code}): ${result.error ?? rawOutput}`
       );
+    const trimmed = stdout.trim();
+    // Row-returning statements print JSON (empty `[]` when zero rows match);
+    // statements without RETURNING print the psql command tag, e.g. `INSERT 0 9`.
+    let parsed: unknown;
+    if (
+      trimmed === '' ||
+      /^(INSERT|UPDATE|DELETE|MERGE|MOVE|FETCH|COPY)\s+\d+(\s+\d+)?$/i.test(trimmed)
+    ) {
+      parsed = [];
+    } else {
+      try {
+        parsed = JSON.parse(trimmed);
+      } catch {
+        throw new Error(`Local fixture SQL returned non-JSON stdout: ${rawOutput}`);
+      }
+    }
+    const fixtureResult = toLocalFixtureResult(parsed);
+    if (!fixtureResult)
+      throw new Error(`Local fixture SQL returned an unexpected JSON shape: ${rawOutput}`);
+    return fixtureResult;
   }
   const invitationColumns =
     'id,community_id,invitee_user_id,issued_by,expires_at,redeemed_at,revoked_at,created_at';
@@ -140,8 +214,9 @@ describe.skipIf(environment.env === null)('community domain (local Supabase inte
     pendingRow: string,
     inactiveRow: string,
     inviteId: string,
-    venueId: string;
-  it('AC1/2: creator bootstrap and enum values are enforced by real SQL', async () => {
+    venueId: string,
+    fixtureTokenHash: string;
+  beforeAll(async () => {
     [admin, member, invited, pending, inactive, outsider, publicActor] = await Promise.all([
       actor('admin'),
       actor('member'),
@@ -151,13 +226,16 @@ describe.skipIf(environment.env === null)('community domain (local Supabase inte
       actor('outsider'),
       actor('public')
     ]);
+  });
+
+  beforeEach(async () => {
     async function create(name: string, visibility: 'private' | 'public') {
       const result = await admin.client.rpc('create_community', {
         p_name: name,
         p_visibility: visibility,
         p_join_policy: visibility === 'private' ? 'admin_approval' : 'instant'
       });
-      expect(result.error).toBeNull();
+      if (result.error) throw result.error;
       if (typeof result.data !== 'string') throw new Error('create_community returned no ID');
       return result.data;
     }
@@ -173,35 +251,42 @@ describe.skipIf(environment.env === null)('community domain (local Supabase inte
         .insert({ community_id: privateId, user_id: user.id, status })
         .select('id')
         .single();
-      expect(result.error).toBeNull();
-      if (user === member) memberRow = result.data!.id;
-      if (user === pending) pendingRow = result.data!.id;
-      if (user === inactive) inactiveRow = result.data!.id;
+      if (result.error) throw result.error;
+      if (user === member) memberRow = result.data.id;
+      if (user === pending) pendingRow = result.data.id;
+      if (user === inactive) inactiveRow = result.data.id;
     }
     const closed = await admin.client
       .from('community_members')
-      .update({ status: 'inactive', valid_until: new Date(Date.now() + 1000).toISOString() })
+      .update({ status: 'inactive', valid_until: new Date(Date.now() + 5000).toISOString() })
       .eq('id', inactiveRow);
-    expect(closed.error).toBeNull();
+    if (closed.error) throw closed.error;
     const invitation = await admin.client
       .from('community_invitations')
       .insert({
         community_id: privateId,
         invitee_user_id: invited.id,
-        token_hash: crypto.randomUUID().replaceAll('-', '').padEnd(64, '0'),
+        token_hash: (fixtureTokenHash = crypto.randomUUID().replaceAll('-', '').padEnd(64, '0')),
         expires_at: new Date(Date.now() + 86400000).toISOString()
       })
       .select('id')
       .single();
-    expect(invitation.error).toBeNull();
-    inviteId = invitation.data!.id;
+    if (invitation.error) throw invitation.error;
+    inviteId = invitation.data.id;
     const venue = await admin.client
       .from('community_venues')
       .insert({ community_id: privateId, name: 'Court' })
       .select('id')
       .single();
-    expect(venue.error).toBeNull();
-    venueId = venue.data!.id;
+    if (venue.error) throw venue.error;
+    venueId = venue.data.id;
+  });
+
+  afterEach(() => {
+    serverClient.current = null;
+  });
+
+  it('AC1/2: creator bootstrap and enum values are enforced by real SQL', async () => {
     expect((await rows(admin.client, 'communities', privateId))[0].join_policy).toBe(
       'admin_approval'
     );
@@ -653,6 +738,17 @@ describe.skipIf(environment.env === null)('community domain (local Supabase inte
   });

   it('AC4: private rows hidden filtered and unfiltered; only own invitation is exposed', async () => {
+    const assertInactiveOnly = async () => {
+      const history = (await rows(admin.client, 'community_members', privateId)).filter(
+        (row) => row.user_id === inactive.id
+      );
+      expect(history).toHaveLength(1);
+      expect(history[0]).toMatchObject({ status: 'inactive', valid_until: expect.any(String) });
+      expect(history[0].activated_at).not.toBeNull();
+      expect(history[0].valid_until).not.toBeNull();
+      expect(history.filter((row) => row.valid_until === null)).toHaveLength(0);
+    };
+    await assertInactiveOnly();
     for (const user of [outsider, publicActor, invited, pending, inactive]) {
       expect(await rows(user.client, 'communities', privateId)).toEqual([]);
       expect(
@@ -710,9 +806,21 @@ describe.skipIf(environment.env === null)('community domain (local Supabase inte
     expect((await invited.client.from('community_invitations').select('*')).error?.code).toBe(
       '42501'
     );
+    await assertInactiveOnly();
   });

   it('AC5: admin alone mutates rows/settings; member sees own interval, not roster', async () => {
+    const assertInactiveOnly = async () => {
+      const history = (await rows(admin.client, 'community_members', privateId)).filter(
+        (row) => row.user_id === inactive.id
+      );
+      expect(history).toHaveLength(1);
+      expect(history[0]).toMatchObject({ status: 'inactive' });
+      expect(history[0].activated_at).not.toBeNull();
+      expect(history[0].valid_until).not.toBeNull();
+      expect(history.filter((row) => row.valid_until === null)).toHaveLength(0);
+    };
+    await assertInactiveOnly();
     expect((await rows(member.client, 'community_members', privateId)).map((m) => m.id)).toEqual([
       memberRow
     ]);
@@ -773,6 +881,7 @@ describe.skipIf(environment.env === null)('community domain (local Supabase inte
       .single();
     expect(openAfterForgedRevoke.error).toBeNull();
     expect(openAfterForgedRevoke.data).toMatchObject({ revoked_at: null, redeemed_at: null });
+    const deniedInvitationId = openInvitation.data!.id;
     for (const user of [outsider, invited, pending, inactive, member]) {
       expect(
         (
@@ -858,6 +967,143 @@ describe.skipIf(environment.env === null)('community domain (local Supabase inte
           .eq('id', privateId)
       ).error?.code
     ).toBe('42501');
+    const unchanged = await admin.client
+      .from('community_invitations')
+      .select('id,revoked_at,redeemed_at')
+      .eq('id', deniedInvitationId)
+      .single();
+    expect(unchanged.error).toBeNull();
+    expect(unchanged.data).toMatchObject({ revoked_at: null, redeemed_at: null });
+    expect(unchanged.data?.id).toBe(deniedInvitationId);
+    await assertInactiveOnly();
+  });
+
+  it('audit UPDATE details list changed fields and only safe transitions', async () => {
+    const secretSettings = 'settings-secret-' + crypto.randomUUID();
+    const secretText = 'private-text-' + crypto.randomUUID();
+    const before = await rows(admin.client, 'community_audit_log', privateId);
+
+    const settingsChange = await admin.client
+      .from('communities')
+      .update({ settings: { private_marker: secretSettings } })
+      .eq('id', privateId);
+    expect(settingsChange.error).toBeNull();
+    const settingsAudit = (await rows(admin.client, 'community_audit_log', privateId)).at(-1)!;
+    expect(settingsAudit.details).toMatchObject({ changed_fields: ['settings'], transitions: {} });
+
+    const scalarChange = await admin.client
+      .from('communities')
+      .update({ name: `Changed ${crypto.randomUUID()}`, description: secretText })
+      .eq('id', privateId);
+    expect(scalarChange.error).toBeNull();
+    const scalarAudit = (await rows(admin.client, 'community_audit_log', privateId)).at(-1)!;
+    expect(scalarAudit.details.changed_fields).toEqual(['name', 'description']);
+
+    const enumChange = await admin.client
+      .from('communities')
+      .update({ visibility: 'public', join_policy: 'instant' })
+      .eq('id', privateId);
+    expect(enumChange.error).toBeNull();
+    const enumAudit = (await rows(admin.client, 'community_audit_log', privateId)).at(-1)!;
+    expect(enumAudit.details).toMatchObject({
+      visibility: 'public',
+      changed_fields: ['visibility', 'join_policy'],
+      transitions: {
+        visibility: { before: 'private', after: 'public' },
+        join_policy: { before: 'admin_approval', after: 'instant' }
+      }
+    });
+
+    const venueChange = await admin.client
+      .from('community_venues')
+      .update({ name: `Court ${crypto.randomUUID()}`, address: secretText })
+      .eq('id', venueId);
+    expect(venueChange.error).toBeNull();
+    const venueAudit = (await rows(admin.client, 'community_audit_log', privateId)).at(-1)!;
+    expect(venueAudit.details).toMatchObject({
+      changed_fields: ['name', 'address'],
+      transitions: {}
+    });
+
+    const archive = await admin.client
+      .from('community_venues')
+      .update({ archived_at: new Date().toISOString() })
+      .eq('id', venueId);
+    expect(archive.error).toBeNull();
+    const archiveAudit = (await rows(admin.client, 'community_audit_log', privateId)).at(-1)!;
+    expect(archiveAudit.details).toMatchObject({
+      archived: true,
+      changed_fields: ['archived_at'],
+      transitions: { archived: { before: false, after: true } }
+    });
+
+    const nullableChange = await admin.client
+      .from('communities')
+      .update({ city_label: secretText })
+      .eq('id', privateId);
+    expect(nullableChange.error).toBeNull();
+    expect(
+      (await rows(admin.client, 'community_audit_log', privateId)).at(-1)!.details.changed_fields
+    ).toEqual(['city_label']);
+    const clearNullable = await admin.client
+      .from('communities')
+      .update({ city_label: null })
+      .eq('id', privateId);
+    expect(clearNullable.error).toBeNull();
+    expect(
+      (await rows(admin.client, 'community_audit_log', privateId)).at(-1)!.details.changed_fields
+    ).toEqual(['city_label']);
+
+    const multiple = await admin.client
+      .from('communities')
+      .update({ logo_path: 'logos/safe.svg', settings: { replacement: true } })
+      .eq('id', privateId);
+    expect(multiple.error).toBeNull();
+    expect(
+      (await rows(admin.client, 'community_audit_log', privateId)).at(-1)!.details.changed_fields
+    ).toEqual(['logo_path', 'settings']);
+    const noOp = await admin.client
+      .from('communities')
+      .update({ logo_path: 'logos/safe.svg', settings: { replacement: true } })
+      .eq('id', privateId);
+    expect(noOp.error).toBeNull();
+    expect(
+      (await rows(admin.client, 'community_audit_log', privateId)).at(-1)!.details
+    ).toMatchObject({
+      changed_fields: [],
+      transitions: {}
+    });
+
+    const after = await rows(admin.client, 'community_audit_log', privateId);
+    const oldIds = new Set(before.map((event) => event.id));
+    expect(
+      after.filter((event) => oldIds.has(event.id)).sort((a, b) => a.id.localeCompare(b.id))
+    ).toEqual(before.sort((a, b) => a.id.localeCompare(b.id)));
+    const serializedDetails = JSON.stringify(after.map((event) => event.details));
+    for (const secret of [secretSettings, secretText, fixtureTokenHash, admin.email])
+      expect(serializedDetails).not.toContain(secret);
+    const forbiddenRead = await outsider.client
+      .from('community_audit_log')
+      .select('*')
+      .eq('community_id', privateId);
+    expect(forbiddenRead.data).toEqual([]);
+    expect(
+      (await anon().from('community_audit_log').select('*').eq('community_id', privateId)).error
+        ?.code
+    ).toBe('42501');
+    for (const client of [outsider.client, anon()])
+      expect(
+        (
+          await client.from('community_audit_log').insert({
+            community_id: privateId,
+            entity: 'communities',
+            entity_id: privateId,
+            action: 'UPDATE'
+          })
+        ).error?.code
+      ).toBe('42501');
+    for (const client of [outsider.client, anon()])
+      expect((await client.rpc('audit_community_change')).error).not.toBeNull();
   });

   it('AC6: signed-out guest cannot access tables or call privileged functions', async () => {
@@ -896,6 +1142,16 @@ describe.skipIf(environment.env === null)('community domain (local Supabase inte
       .update({ role: 'admin' })
       .eq('id', memberRow);
     expect(promoted.error).toBeNull();
+    const seededSettings = await admin.client
+      .from('communities')
+      .update({ settings: { ac7: true } })
+      .eq('id', privateId);
+    expect(seededSettings.error).toBeNull();
+    const seededVenue = await admin.client
+      .from('community_venues')
+      .update({ name: 'AC7 court' })
+      .eq('id', venueId);
+    expect(seededVenue.error).toBeNull();
     const [a, b] = await Promise.all([
       admin.client.from('community_members').update({ role: 'member' }).eq('id', only.id),
       member.client.from('community_members').update({ role: 'member' }).eq('id', memberRow)
@@ -1072,10 +1328,15 @@ describe.skipIf(environment.env === null)('community domain (local Supabase inte
           token_hash: tokenHash,
           expires_at: new Date(expiry).toISOString()
         })
-        .select('id, created_at')
+        .select('id, created_at, expires_at')
         .single();
       expect(seeded.error).toBeNull();
-      return { raw, id: seeded.data!.id, createdAt: seeded.data!.created_at };
+      return {
+        raw,
+        id: seeded.data!.id,
+        createdAt: seeded.data!.created_at,
+        expiresAt: seeded.data!.expires_at
+      };
     }
     async function membership(communityId: string, user: Actor) {
       const found = await owner.client
@@ -1257,20 +1518,6 @@ describe.skipIf(environment.env === null)('community domain (local Supabase inte
     expect(
       (await thief.client.rpc('accept_community_invitation', { p_token: 'bad' })).error?.code
     ).toBe('PJ001');
-    const expired = await invitation(privateInstant, thief, Date.now() + 1200);
-    await new Promise((resolve) => setTimeout(resolve, 1500));
-    await expect(acceptInvitation({ data: { token: expired.raw } })).rejects.toThrow(
-      'INVITATION_EXPIRED'
-    );
-    expect(
-      (
-        await owner.client
-          .from('community_invitations')
-          .select('redeemed_at')
-          .eq('id', expired.id)
-          .single()
-      ).data?.redeemed_at
-    ).toBeNull();
     const revoked = await invitation(privateApproval, thief);
     expect(
       (
@@ -1325,6 +1572,59 @@ describe.skipIf(environment.env === null)('community domain (local Supabase inte
     serverClient.current = null;
   }, 90000);

+  it('seeds expired invitation from database clock and waits for stored expiry', async () => {
+    const [owner, invitee] = await Promise.all([actor('expiry-owner'), actor('expiry-invitee')]);
+    const created = await owner.client.rpc('create_community', {
+      p_name: `Expiry fixture ${crypto.randomUUID()}`,
+      p_visibility: 'private',
+      p_join_policy: 'instant'
+    });
+    expect(created.error).toBeNull();
+    if (typeof created.data !== 'string') throw new Error('Community fixture creation failed');
+    const raw = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
+      byte.toString(16).padStart(2, '0')
+    ).join('');
+    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
+    const hash = Array.from(new Uint8Array(digest), (byte) =>
+      byte.toString(16).padStart(2, '0')
+    ).join('');
+    const seeded = await executeLocalFixtureSql(`
+      insert into public.community_invitations
+        (community_id, invitee_user_id, issued_by, token_hash, expires_at)
+      values ('${created.data}'::uuid, '${invitee.id}'::uuid, '${owner.id}'::uuid, '${hash}', clock_timestamp() + interval '5 seconds')
+      returning id, created_at, expires_at;
+    `);
+    if (!isExpiredInvitationResult(seeded))
+      throw new Error(
+        `Expired invitation fixture returned an unexpected CLI JSON result: ${JSON.stringify(seeded)}`
+      );
+    const row = seeded.rows[0];
+    if (!row) throw new Error('Expired invitation fixture returned no row');
+    expect(Date.parse(row.expires_at)).toBeGreaterThan(Date.parse(row.created_at));
+    const expiry = Date.parse(row.expires_at);
+    if (!Number.isFinite(expiry)) throw new Error('Expired invitation fixture has invalid expiry');
+    const deadline = Date.now() + 15000;
+    while (Date.now() < expiry + 250 && Date.now() < deadline)
+      await new Promise((resolve) => setTimeout(resolve, 100));
+    if (Date.now() < expiry + 250)
+      throw new Error('Invitation did not reach expiry before bounded wait deadline');
+    serverClient.current = invitee.client;
+    await expect(acceptInvitation({ data: { token: raw } })).rejects.toThrow('INVITATION_EXPIRED');
+    const unchanged = await owner.client
+      .from('community_invitations')
+      .select('id,redeemed_at,revoked_at')
+      .eq('id', row.id)
+      .single();
+    expect(unchanged.error).toBeNull();
+    expect(unchanged.data?.redeemed_at).toBeNull();
+    expect(unchanged.data?.revoked_at).toBeNull();
+    expect(
+      (await rows(owner.client, 'community_members', created.data)).filter(
+        (membership) => membership.user_id === invitee.id
+      )
+    ).toEqual([]);
+  }, 30000);
+
   it('closes self-leave and removal intervals, blocks inactive re-entry, and exposes only owned timeline rows', async () => {
     const [owner, leaver, invitee, lifecycleOutsider] = await Promise.all([
       actor('lifecycle-owner'),
@@ -1577,6 +1877,8 @@ describe.skipIf(environment.env === null)('community domain (local Supabase inte

     const blockedInvitation = await invite(lifecyclePrivateId, invitee);
     serverClient.current = invitee.client;
+    serverClient.current = invitee.client;
+    serverClient.current = invitee.client;
     await expect(acceptInvitation({ data: { token: blockedInvitation.raw } })).rejects.toThrow(
       'MEMBERSHIP_INACTIVE'
     );
@@ -1600,13 +1902,11 @@ describe.skipIf(environment.env === null)('community domain (local Supabase inte
       )
     ).toHaveLength(1);

-    const reactivated = await owner.client.rpc('govern_community_member', {
-      p_community_id: lifecyclePrivateId,
-      p_membership_id: removed.id,
-      p_action: 'reactivate'
+    serverClient.current = owner.client;
+    const reactivated = await reactivateCommunityMember({
+      data: { community_id: lifecyclePrivateId, membership_id: removed.id }
     });
-    expect(reactivated.error).toBeNull();
-    const replacementId = reactivated.data?.[0]?.membership_id;
+    const replacementId = reactivated.membership_id;
     expect(replacementId).toBeTruthy();
     expect(replacementId).not.toBe(removed.id);
     expect(
@@ -1631,6 +1931,7 @@ describe.skipIf(environment.env === null)('community domain (local Supabase inte
       (await owner.client.from('community_venues').select('id,name').eq('id', venueSnapshot!.id))
         .data
     ).toEqual([venueSnapshot]);
+    serverClient.current = invitee.client;
     await expect(acceptInvitation({ data: { token: blockedInvitation.raw } })).rejects.toThrow(
       'ALREADY_MEMBER_OR_PENDING'
     );
@@ -1667,6 +1968,240 @@ describe.skipIf(environment.env === null)('community domain (local Supabase inte
     serverClient.current = null;
   }, 90000);

+  it('closed membership history rejects public and private rejoin until admin reactivation', async () => {
+    async function createHistoryCommunity(owner: Actor, visibility: 'public' | 'private') {
+      const created = await owner.client.rpc('create_community', {
+        p_name: `Closed history ${crypto.randomUUID()}`,
+        p_visibility: visibility,
+        p_join_policy: visibility === 'public' ? 'instant' : 'admin_approval'
+      });
+      expect(created.error).toBeNull();
+      if (typeof created.data !== 'string') throw new Error('Community fixture creation failed');
+      return created.data;
+    }
+    async function addInvitation(owner: Actor, communityId: string, invitee: Actor) {
+      const raw = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
+        byte.toString(16).padStart(2, '0')
+      ).join('');
+      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
+      const hash = Array.from(new Uint8Array(digest), (byte) =>
+        byte.toString(16).padStart(2, '0')
+      ).join('');
+      const seeded = await executeLocalFixtureSql(`
+        insert into public.community_invitations
+          (community_id, invitee_user_id, issued_by, token_hash, expires_at)
+        values ('${communityId}'::uuid, '${invitee.id}'::uuid, '${owner.id}'::uuid, '${hash}', clock_timestamp() + interval '1 day')
+        returning id;
+      `);
+      if (!isSqlRowsWithId(seeded))
+        throw new Error(
+          `Invitation fixture returned an unexpected CLI result: ${JSON.stringify(seeded)}`
+        );
+      const inserted = seeded.rows[0];
+      if (!inserted) throw new Error('Invitation fixture returned no inserted row');
+      return { id: inserted.id, raw };
+    }
+    async function seedAndClose(owner: Actor, former: Actor, communityId: string) {
+      serverClient.current = former.client;
+      await expect(joinCommunity({ data: { community_id: communityId } })).resolves.toMatchObject({
+        status: 'active'
+      });
+      const initial = (await rows(owner.client, 'community_members', communityId)).find(
+        (row) => row.user_id === former.id
+      )!;
+      serverClient.current = former.client;
+      await leaveCommunity({ data: { community_id: communityId } });
+      return (await rows(owner.client, 'community_members', communityId)).find(
+        (row) => row.id === initial.id
+      )!;
+    }
+    const [publicOwner, publicFormer, privateOwner, privateFormer] = await Promise.all([
+      actor('history-public-owner'),
+      actor('history-public-former'),
+      actor('history-private-owner'),
+      actor('history-private-former')
+    ]);
+    const historyPublicId = await createHistoryCommunity(publicOwner, 'public');
+    const publicOld = await seedAndClose(publicOwner, publicFormer, historyPublicId);
+    const publicClosed = { ...publicOld };
+    const tokenBucketId = await createHistoryCommunity(publicOwner, 'private');
+    const publicInvitation = await addInvitation(publicOwner, tokenBucketId, publicFormer);
+    serverClient.current = publicFormer.client;
+    await expect(joinCommunity({ data: { community_id: historyPublicId } })).rejects.toThrow(
+      'MEMBERSHIP_INACTIVE'
+    );
+    expect(
+      (await rows(publicOwner.client, 'community_members', historyPublicId)).filter(
+        (row) => row.user_id === publicFormer.id
+      )
+    ).toEqual([publicClosed]);
+    const publicTokenState = await publicOwner.client
+      .from('community_invitations')
+      .select('id,redeemed_at,revoked_at')
+      .eq('id', publicInvitation.id)
+      .single();
+    expect(publicTokenState.error).toBeNull();
+    expect(publicTokenState.data).toMatchObject({ redeemed_at: null, revoked_at: null });
+    serverClient.current = publicOwner.client;
+    const publicReactivation = await reactivateCommunityMember({
+      data: { community_id: historyPublicId, membership_id: publicOld.id }
+    });
+    const publicHistory = (
+      await rows(publicOwner.client, 'community_members', historyPublicId)
+    ).filter((row) => row.user_id === publicFormer.id);
+    expect(publicHistory.find((row) => row.id === publicOld.id)).toEqual(publicClosed);
+    const publicActive = publicHistory.find((row) => row.id === publicReactivation.membership_id)!;
+    expect(publicActive).toMatchObject({ role: 'member', status: 'active', valid_until: null });
+    expect(publicActive.id).not.toBe(publicOld.id);
+    expect(publicHistory.filter((row) => row.valid_until === null)).toHaveLength(1);
+    expect(publicOld.valid_until).toBeTruthy();
+    expect(Date.parse(publicActive.valid_from)).toBeGreaterThanOrEqual(
+      Date.parse(publicOld.valid_until)
+    );
+    expect(Date.parse(publicActive.activated_at)).toBeGreaterThanOrEqual(
+      Date.parse(publicActive.valid_from)
+    );
+
+    const historyPrivateId = await createHistoryCommunity(privateOwner, 'private');
+    serverClient.current = privateOwner.client;
+    const seededMembership = await privateOwner.client
+      .from('community_members')
+      .insert({ community_id: historyPrivateId, user_id: privateFormer.id, status: 'active' })
+      .select('id')
+      .single();
+    expect(seededMembership.error).toBeNull();
+    const freshToken = await addInvitation(privateOwner, historyPrivateId, privateFormer);
+    const closedResult = await privateOwner.client
+      .from('community_members')
+      .update({ status: 'inactive', valid_until: new Date(Date.now() + 5000).toISOString() })
+      .eq('id', seededMembership.data!.id);
+    expect(closedResult.error).toBeNull();
+    const privateClosedRow = (
+      await rows(privateOwner.client, 'community_members', historyPrivateId)
+    ).find((row) => row.id === seededMembership.data!.id)!;
+    const privateSnapshot = { ...privateClosedRow };
+    serverClient.current = privateFormer.client;
+    await expect(acceptInvitation({ data: { token: freshToken.raw } })).rejects.toThrow(
+      'MEMBERSHIP_INACTIVE'
+    );
+    const privateHistory = (
+      await rows(privateOwner.client, 'community_members', historyPrivateId)
+    ).filter((row) => row.user_id === privateFormer.id);
+    expect(privateHistory).toEqual([privateSnapshot]);
+    const tokenState = await privateOwner.client
+      .from('community_invitations')
+      .select('id,redeemed_at,revoked_at')
+      .eq('id', freshToken.id)
+      .single();
+    expect(tokenState.error).toBeNull();
+    expect(tokenState.data).toMatchObject({ redeemed_at: null, revoked_at: null });
+    serverClient.current = privateOwner.client;
+    const privateReactivation = await reactivateCommunityMember({
+      data: { community_id: historyPrivateId, membership_id: privateClosedRow.id }
+    });
+    const reactivatedRows = (
+      await rows(privateOwner.client, 'community_members', historyPrivateId)
+    ).filter((row) => row.user_id === privateFormer.id);
+    expect(reactivatedRows.find((row) => row.id === privateClosedRow.id)).toEqual(privateSnapshot);
+    const privateActive = reactivatedRows.find(
+      (row) => row.id === privateReactivation.membership_id
+    )!;
+    expect(privateActive).toMatchObject({ role: 'member', status: 'active', valid_until: null });
+    expect(privateActive.id).not.toBe(privateClosedRow.id);
+    expect(reactivatedRows.filter((row) => row.valid_until === null)).toHaveLength(1);
+    expect(privateClosedRow.valid_until).toBeTruthy();
+    expect(Date.parse(privateActive.valid_from)).toBeGreaterThanOrEqual(
+      Date.parse(privateClosedRow.valid_until)
+    );
+    expect(Date.parse(privateActive.activated_at)).toBeGreaterThanOrEqual(
+      Date.parse(privateActive.valid_from)
+    );
+  }, 90000);
+
+  it('visibility flip rejects acceptance without consuming invitation or creating membership', async () => {
+    const [owner, invitee] = await Promise.all([
+      actor('visibility-flip-owner'),
+      actor('visibility-flip-invitee')
+    ]);
+    const created = await owner.client.rpc('create_community', {
+      p_name: `Visibility flip ${crypto.randomUUID()}`,
+      p_visibility: 'private',
+      p_join_policy: 'instant'
+    });
+    expect(created.error).toBeNull();
+    if (typeof created.data !== 'string') throw new Error('Community fixture creation failed');
+    const communityId = created.data;
+    const raw = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
+      byte.toString(16).padStart(2, '0')
+    ).join('');
+    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
+    const tokenHash = Array.from(new Uint8Array(digest), (byte) =>
+      byte.toString(16).padStart(2, '0')
+    ).join('');
+    const invitation = await owner.client
+      .from('community_invitations')
+      .insert({
+        community_id: communityId,
+        invitee_user_id: invitee.id,
+        token_hash: tokenHash,
+        expires_at: new Date(Date.now() + 86400000).toISOString()
+      })
+      .select('id')
+      .single();
+    expect(invitation.error).toBeNull();
+    const auditBefore = await rows(owner.client, 'community_audit_log', communityId);
+    const flipped = await owner.client
+      .from('communities')
+      .update({ visibility: 'public' })
+      .eq('id', communityId);
+    expect(flipped.error).toBeNull();
+    serverClient.current = invitee.client;
+    await expect(acceptInvitation({ data: { token: raw } })).rejects.toThrow(
+      'COMMUNITY_NOT_ELIGIBLE'
+    );
+    const invitationAfterReject = await owner.client
+      .from('community_invitations')
+      .select('id,redeemed_at,revoked_at')
+      .eq('id', invitation.data!.id)
+      .single();
+    expect(invitationAfterReject.error).toBeNull();
+    expect(invitationAfterReject.data?.redeemed_at).toBeNull();
+    expect(invitationAfterReject.data?.revoked_at).toBeNull();
+    expect(
+      (await rows(owner.client, 'community_members', communityId)).filter(
+        (row) => row.user_id === invitee.id
+      )
+    ).toEqual([]);
+    const auditsAfterReject = await rows(owner.client, 'community_audit_log', communityId);
+    expect(
+      auditsAfterReject
+        .filter((event) => !auditBefore.some((old) => old.id === event.id))
+        .filter(
+          (event) =>
+            (event.entity === 'community_invitations' && event.action === 'UPDATE') ||
+            (event.entity === 'community_members' && event.action === 'INSERT')
+        )
+    ).toEqual([]);
+    const flippedBack = await owner.client
+      .from('communities')
+      .update({ visibility: 'private' })
+      .eq('id', communityId);
+    expect(flippedBack.error).toBeNull();
+    await expect(acceptInvitation({ data: { token: raw } })).resolves.toMatchObject({
+      community_id: communityId,
+      status: 'active'
+    });
+    expect(
+      (
+        await owner.client
+          .from('community_invitations')
+          .select('id,redeemed_at,revoked_at')
+          .eq('id', invitation.data!.id)
+          .single()
+      ).data?.redeemed_at
+    ).toBeTruthy();
+  }, 90000);
+
   it('paginates persisted timeline history completely and deterministically', async () => {
     const [owner, timelineActor, decoy, emptyActor] = await Promise.all([
       actor('timeline-page-owner'),
diff --git a/test/community.onboarding.test.tsx b/test/community.onboarding.test.tsx
index 0eca352..15a667c 100644
--- a/test/community.onboarding.test.tsx
+++ b/test/community.onboarding.test.tsx
@@ -3,6 +3,7 @@ import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/re
 import userEvent from '@testing-library/user-event';
 import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
 import { I18nextProvider } from 'react-i18next';
+import { readFileSync } from 'node:fs';
 import { createI18n } from '../src/i18n/config';
 import { CommunityOnboarding } from '../src/features/community/CommunityOnboarding';
 import type { PublicCommunity } from '../src/features/community/community.validators';
@@ -12,11 +13,24 @@ const mocks = vi.hoisted(() => ({
   invalidate: vi.fn<() => void>(),
   join: vi.fn<() => Promise<unknown>>(),
   create: vi.fn<() => Promise<unknown>>(),
-  list: vi.fn<() => Promise<unknown>>()
+  list: vi.fn<() => Promise<unknown>>(),
+  routerState: { pending: false }
 }));
 vi.mock('@tanstack/react-router', () => ({
   useNavigate: () => mocks.navigate,
-  useRouter: () => ({ invalidate: mocks.invalidate })
+  useRouter: () => ({ invalidate: mocks.invalidate }),
+  useRouterState: ({
+    select
+  }: {
+    select: (state: {
+      matches: { routeId: string; status: string; isFetching: boolean }[];
+    }) => unknown;
+  }) =>
+    select({
+      matches: mocks.routerState.pending
+        ? [{ routeId: '/onboarding_/community', status: 'pending', isFetching: true }]
+        : []
+    })
 }));
 vi.mock('../src/features/community/community.functions', () => ({
   joinCommunity: mocks.join,
@@ -36,6 +50,15 @@ const row: PublicCommunity = {
   updated_at: '2026-10-01T00:00:00Z'
 };

+it('uses the existing tight line-height token for floating labels', () => {
+  const stylesheet = readFileSync('src/features/community/community-onboarding.styles.ts', 'utf8');
+  const tokenCatalog = readFileSync('design-tokens/primitives.tokens.json', 'utf8');
+
+  expect(stylesheet).toContain("lineHeight: 'var(--font-line-height-tight)'");
+  expect(stylesheet).not.toContain('var(--line-height-tight)');
+  expect(tokenCatalog).toMatch(/"line-height"\s*:\s*{\s*"tight"\s*:/);
+});
+
 function mount(
   view?: 'create',
   data = {
@@ -61,11 +84,113 @@ function mount(
 }

 beforeEach(() => {
-  for (const mock of Object.values(mocks)) mock.mockReset();
+  mocks.navigate.mockReset();
+  mocks.invalidate.mockReset();
+  mocks.join.mockReset();
+  mocks.create.mockReset();
+  mocks.list.mockReset();
+  mocks.routerState.pending = false;
 });
 afterEach(cleanup);

 describe('community onboarding', () => {
+  it.each(['en', 'pt-BR', 'es'] as const)(
+    'announces draft and route pending state in %s, keeps search focused and suppresses empty results',
+    async (locale) => {
+      const i18n = createI18n(locale);
+      const data = { communities: [], next_offset: null, failed: false };
+      const view = (q?: string) => (
+        <I18nextProvider i18n={i18n}>
+          <CommunityOnboarding search={q ? { q } : {}} data={data} />
+        </I18nextProvider>
+      );
+      const mounted = render(view());
+      const input = screen.getByRole('searchbox', {
+        name: i18n.t('communityOnboarding.searchLabel')
+      });
+      await userEvent.type(input, 'No match');
+      expect(screen.getByRole('status').textContent).toBe(
+        i18n.t('communityOnboarding.searchLoading')
+      );
+      expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
+      expect(input.hasAttribute('disabled')).toBe(false);
+      expect(document.activeElement).toBe(input);
+      mocks.routerState.pending = true;
+      mounted.rerender(view('No match'));
+      expect(screen.getByRole('status').textContent).toBe(
+        i18n.t('communityOnboarding.searchLoading')
+      );
+      expect(screen.queryByText(i18n.t('communityOnboarding.emptySearch'))).toBeNull();
+      expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
+      expect(screen.getByRole('status').closest('[aria-busy="true"]')).toBeNull();
+      mocks.routerState.pending = false;
+      mounted.rerender(view('No match'));
+      expect(screen.queryByText(i18n.t('communityOnboarding.searchLoading'))).toBeNull();
+      expect(document.activeElement).toBe(input);
+    }
+  );
+
+  it.each(['en', 'pt-BR', 'es'] as const)(
+    'keeps filled optional labels visible in %s',
+    async (locale) => {
+      const i18n = createI18n(locale);
+      render(
+        <I18nextProvider i18n={i18n}>
+          <CommunityOnboarding
+            search={{ view: 'create' }}
+            data={{ communities: [], next_offset: null, failed: false }}
+          />
+        </I18nextProvider>
+      );
+      const description = screen.getByLabelText(i18n.t('communityOnboarding.descriptionLabel'));
+      const city = screen.getByLabelText(i18n.t('communityOnboarding.cityLabel'));
+      await userEvent.type(description, 'Description');
+      await userEvent.type(city, 'Lisbon');
+      expect(description.id).toBe('community-description');
+      expect(city.id).toBe('community-city');
+      expect(description.value).toBe('Description');
+      expect(city.value).toBe('Lisbon');
+      expect(description.labels?.[0]?.htmlFor).toBe(description.id);
+      expect(city.labels?.[0]?.htmlFor).toBe(city.id);
+    }
+  );
+
+  it('blocks duplicate retry while same-route invalidation is fetching and retains load-more busy state', async () => {
+    const i18n = createI18n('en');
+    const failed = { communities: [], next_offset: null, failed: true };
+    const view = () => (
+      <I18nextProvider i18n={i18n}>
+        <CommunityOnboarding search={{}} data={failed} />
+      </I18nextProvider>
+    );
+    const mounted = render(view());
+    mocks.routerState.pending = true;
+    mounted.rerender(view());
+    const retry = screen.getByRole('button', { name: i18n.t('communityOnboarding.retry') });
+    expect(retry.hasAttribute('disabled')).toBe(true);
+    expect(screen.getByRole('status')).toBeTruthy();
+    mocks.routerState.pending = false;
+    mounted.rerender(view());
+    expect(
+      screen
+        .getByRole('button', { name: i18n.t('communityOnboarding.retry') })
+        .hasAttribute('disabled')
+    ).toBe(false);
+    expect(mocks.invalidate).not.toHaveBeenCalled();
+  });
+
+  it('keeps load more busy until its page promise settles', async () => {
+    let finish!: (value: { communities: PublicCommunity[]; next_offset: null }) => void;
+    mocks.list.mockReturnValue(new Promise((resolve) => (finish = resolve)));
+    mount(undefined, { communities: [row], next_offset: 20, failed: false });
+    const button = screen.getByRole('button', { name: 'LOAD MORE' });
+    await userEvent.click(button);
+    expect(button.getAttribute('aria-busy')).toBe('true');
+    expect(button.hasAttribute('disabled')).toBe(true);
+    finish({ communities: [], next_offset: null });
+    await waitFor(() => expect(screen.queryByRole('button', { name: 'LOAD MORE' })).toBeNull());
+  });
+
   it('shows real city and policy only, joins with server-authoritative outcomes and supports skip', async () => {
     mocks.join
       .mockResolvedValueOnce({ status: 'active' })
diff --git a/test/root.locale.test.tsx b/test/root.locale.test.tsx
new file mode 100644
index 0000000..9ca539a
--- /dev/null
+++ b/test/root.locale.test.tsx
@@ -0,0 +1,111 @@
+/** @vitest-environment jsdom */
+import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
+import userEvent from '@testing-library/user-event';
+import { createElement } from 'react';
+import { afterEach, beforeEach, expect, it, vi } from 'vitest';
+
+const mocks = vi.hoisted(() => ({ saveLocale: vi.fn<() => Promise<void>>() }));
+
+vi.mock('@tanstack/react-router', () => ({
+  createRootRoute: (options: unknown) => ({
+    options,
+    useRouteContext: () => ({ locale: 'en', theme: 'light' })
+  }),
+  HeadContent: () => null,
+  Outlet: () => null,
+  Scripts: () => null,
+  useRouterState: () => false
+}));
+vi.mock('../src/components/PwaRegistration', () => ({ PwaRegistration: () => null }));
+vi.mock('../src/components/DevStyleXInject', () => ({ DevStyleXInject: () => null }));
+vi.mock('../src/i18n/locale.functions', () => ({
+  getInitialLocale: async () => 'en',
+  saveLocale: mocks.saveLocale
+}));
+vi.mock('../src/features/theme/theme.functions', () => ({
+  getInitialTheme: async () => 'light',
+  saveTheme: async () => undefined
+}));
+
+import { Route } from '../src/routes/__root';
+
+afterEach(cleanup);
+
+function renderRoot() {
+  const RootComponent = Route.options.component;
+  if (!RootComponent) throw new Error('Root route component is missing');
+  return render(createElement(RootComponent), { container: document });
+}
+
+function getLocaleSelect() {
+  const control = screen.getByRole('combobox', { name: 'Language' });
+  if (!(control instanceof HTMLSelectElement)) throw new Error('Locale control is not a select');
+  return control;
+}
+
+beforeEach(() => {
+  mocks.saveLocale.mockReset().mockResolvedValue();
+});
+
+it('updates root preference labels after changing locale', async () => {
+  const user = userEvent.setup();
+  renderRoot();
+  const localeSelect = screen.getByRole('combobox', { name: 'Language' });
+  await user.selectOptions(localeSelect, 'pt-BR');
+  await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Idioma' })).not.toBeNull());
+  expect(screen.getByRole('combobox', { name: 'Tema' })).toBeTruthy();
+  expect(screen.getByRole('option', { name: 'Escuro' })).toBeTruthy();
+
+  await user.selectOptions(localeSelect, 'es');
+  await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Idioma' })).not.toBeNull());
+  expect(screen.getByRole('combobox', { name: 'Tema' })).toBeTruthy();
+  expect(screen.getByRole('option', { name: 'Oscuro' })).toBeTruthy();
+
+  await user.selectOptions(localeSelect, 'en');
+  await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Language' })).not.toBeNull());
+  expect(screen.getByRole('combobox', { name: 'Theme' })).toBeTruthy();
+  expect(screen.getByRole('option', { name: 'Dark' })).toBeTruthy();
+  expect(document.documentElement.lang).toBe('en');
+});
+
+it('keeps locale copy, root state, and document language coherent when persistence rejects', async () => {
+  let rejectSave!: (error: Error) => void;
+  mocks.saveLocale.mockReturnValueOnce(
+    new Promise<void>((_resolve, reject) => (rejectSave = reject))
+  );
+  const user = userEvent.setup();
+  renderRoot();
+  const selector = getLocaleSelect();
+  await user.selectOptions(selector, 'es');
+  await waitFor(() => expect(mocks.saveLocale).toHaveBeenCalledWith({ data: 'es' }));
+  await act(async () => rejectSave(new Error('offline')));
+  await waitFor(() => expect(selector.value).toBe('en'));
+  expect(screen.getByRole('combobox', { name: 'Language' })).toBeTruthy();
+  expect(screen.queryByRole('combobox', { name: 'Idioma' })).toBeNull();
+  expect(document.documentElement.lang).toBe('en');
+});
+
+it('serializes overlapping locale selections and commits only the latest selection', async () => {
+  let finishFirst!: () => void;
+  let finishSecond!: () => void;
+  mocks.saveLocale
+    .mockReturnValueOnce(new Promise<void>((resolve) => (finishFirst = resolve)))
+    .mockReturnValueOnce(new Promise<void>((resolve) => (finishSecond = resolve)));
+  renderRoot();
+  const selector = getLocaleSelect();
+  fireEvent.change(selector, { target: { value: 'pt-BR' } });
+  await waitFor(() => expect(mocks.saveLocale).toHaveBeenCalledTimes(1));
+  fireEvent.change(selector, { target: { value: 'es' } });
+  expect(mocks.saveLocale).toHaveBeenCalledTimes(1);
+  await act(async () => finishFirst());
+  await waitFor(() => expect(mocks.saveLocale).toHaveBeenCalledTimes(2));
+  expect(document.documentElement.lang).toBe('en');
+  expect(screen.getByRole('combobox', { name: 'Language' })).toBeTruthy();
+  expect(selector.value).toBe('en');
+  await act(async () => finishSecond());
+  await waitFor(() => expect(document.documentElement.lang).toBe('es'));
+  expect(mocks.saveLocale).toHaveBeenNthCalledWith(1, { data: 'pt-BR' });
+  expect(mocks.saveLocale).toHaveBeenNthCalledWith(2, { data: 'es' });
+  expect(screen.getByRole('combobox', { name: 'Idioma' })).toBeTruthy();
+  expect(selector.value).toBe('es');
+});
````
