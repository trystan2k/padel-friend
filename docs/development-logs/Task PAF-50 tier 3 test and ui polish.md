---
title: PAF-50 PAF-2 follow-up — Tier 3: test and UI polish
type: development-log
permalink: docs/development-logs/task-paf-50-tier-3-test-and-ui-polish
---

# Development Log: PAF-50

## Metadata

- Task ID: PAF-50 (PAF-2 follow-up epic — Tier 3: test and UI polish. Contains units PAF-34, PAF-38, PAF-40, PAF-43 plus the review-fix loop.)
- Date (UTC): 2026-10-12
- Project: padel-friend
- Branch: feature/PAF-50-tier-3-test-and-ui-polish (based on `origin/main` @ `8c705c2`; this repo has no `develop`, `main` is the integration branch; 5 commits, unpushed at log time)
- Commit: `6f8db58` (HEAD) — `fix: address review findings and harden invitation fixtures`. Per-unit commits, in order: `bf0197e` (PAF-34), `25f14d0` (PAF-38), `a2b2995` (PAF-40), `5dec5d4` (PAF-43), `6f8db58` (review fixes)
- Reviewers: full review by code-review-specialist + architecture-review-specialist + ux-ui-reviewer-specialist; delta re-review by code + UX reviewers

## Objective

- Deliver the Tier 3 follow-up to PAF-2 as one feature branch and one PR: test and UI polish across community audit evidence (PAF-34), invitation timing and membership edge coverage (PAF-38), community discovery feedback and visual assertions (PAF-40), and admin view isolation with accessible recovery tests (PAF-43), closed by a review-fix loop and the authoritative `pnpm complete-check` gate on the head commit.

## Implementation Summary

- **Unit 1 — PAF-34: community fixtures isolation and safe audit evidence** — `bf0197e` `test: isolate community fixtures and enrich safe audit evidence`. Integration fixtures moved to `beforeAll`/`beforeEach`/`afterEach` isolation so any test can run by name filter. Inactive-only former member exercised through the privacy/mutation matrix. New forward-only migration `supabase/migrations/20261012111727_community_audit_changed_fields.sql` recording deterministic `changed_fields` plus safe before/after transitions (community `visibility`/`join_policy`, venue `archived` boolean), while still excluding settings payloads, token hashes and account data.
- **Unit 2 — PAF-38: invitation timing hardening and membership edge coverage** — `25f14d0` `test: harden invitation timing and membership edge coverage`. DB-relative invitation expiry seeding (`clock_timestamp() + 5s`) with bounded polling on the stored expiry (no sub-second margin); CLI JSON validated with a zod schema. PAF-29 plan reconciled: invitation issuance deferred to PAF-31 / delivered in `community-admin.functions.ts`. Membership lifecycle coverage added: denied self-rejoin / private acceptance (PJ008 `MEMBERSHIP_INACTIVE`) with byte-identical closed history and unconsumed token; authorized admin reactivation appending a new interval; visibility-flip rejection with token-non-consumption proof.
- **Unit 3 — PAF-40: community discovery feedback and visual assertions** — `a2b2995` `fix: polish community discovery feedback and visual assertions`. SSR locale oracle asserting raw response HTML independently of hydration; visual comparator validating decoded dimensions with attached expected/actual/diff artifacts; translated pending status + `aria-busy` for search/retry; persistent optional-field labels; exact structural/typography probes for masked card content.
- **Unit 4 — PAF-43: admin view isolation and accessible recovery tests** — `5dec5d4` `refactor: isolate admin views and harden accessible recovery tests`. Six state-owning admin views extracted into `src/features/community/CommunityAdminViews.tsx` (with loader-source/generation guards against stale appends); members route split into an Outlet layout (`src/routes/_protected.community.$communityId.admin.members.tsx`) + `src/routes/_protected.community.$communityId.admin.members.index.tsx`; shared `validateCommunityId` validator extraction; accessible Base UI `AlertDialog` confirmation (focus transfer/restore/fallback); recoverable loader errors (localized Retry + dashboard link; no retry on definitive denial); 320px × en/pt-BR/es 18-case matrix; confidentiality-sentinel oracle; fresh-build extraction binding; and a real root-level i18n bug fix in `src/routes/__root.tsx` (root copy did not re-render on language change).
- **Unit 5 — Review-fix loop** — `6f8db58` `fix: address review findings and harden invitation fixtures`. Fixed 7 review findings (F2–F7, F12 in `docs/plan/PAF-50-findings.md`): pagination busy-state latching after loader refresh, membership-identity scoping of completion state, locale-persistence coherence, focus restoration to the initiating trigger, error rendering inside the open dialog, mutation-vs-refresh failure separation, and a nonexistent token reference. Also fixed the QA gate failure: the integration fixture helper modelled a `{"rows": […]}` CLI layout while `supabase` CLI v2 prints a top-level JSON array (and psql command tags for no-row statements).

## Files Changed

- Unit 1 (PAF-34): `supabase/migrations/20261012111727_community_audit_changed_fields.sql` (new, forward-only); community integration fixtures/tests (beforeAll/beforeEach/afterEach isolation; inactive-only former member in the privacy/mutation matrix).
- Unit 2 (PAF-38): invitation integration specs (DB-relative expiry seeding + bounded polling; zod-validated CLI JSON); membership lifecycle specs (self-rejoin/private-acceptance denial with byte-identical closed history + unconsumed token; admin reactivation interval; visibility-flip token-non-consumption proof). Plan reconciliation references `community-admin.functions.ts` (issuance delivered there via PAF-31).
- Unit 3 (PAF-40): community discovery spec/SSR locale oracle and visual comparator (decoded-dimension validation, expected/actual/diff artifacts); discovery UI feedback strings (translated pending status, `aria-busy` for search/retry, persistent optional-field labels).
- Unit 4 (PAF-43): `src/features/community/CommunityAdminViews.tsx` (new; six extracted admin views with loader-source/generation guards); `src/routes/_protected.community.$communityId.admin.members.tsx` (Outlet layout) + `src/routes/_protected.community.$communityId.admin.members.index.tsx` (split); shared `validateCommunityId` validator extraction; accessible recovery specs (Base UI `AlertDialog`, 320px × 3-locale 18-case matrix, confidentiality-sentinel oracle, fresh-build extraction binding); `src/routes/__root.tsx` (root copy now re-renders on language change).
- Unit 5 (review fixes): integration fixture helper (supabase CLI v2 top-level JSON array + psql command tags instead of `{"rows": […]}`); admin views/dialog and membership spec fixes for F2–F7, F12 (busy-state latch, completion-state scoping, locale persistence, focus restoration to initiating trigger, in-dialog error rendering, mutation-vs-refresh failure separation, removed nonexistent token reference).
- Epic artifacts (docs, untracked planning deliverables): `docs/plan/Plan PAF-50 PAF-2 follow-up — Tier 3: test and UI polish.md` (plan), `docs/plan/PAF-50-bundle.md` (context bundle + authoritative full-gate record), `docs/plan/PAF-50-findings.md` (findings ledger).

## Key Decisions

- Fixture isolation over shared state: `beforeAll`/`beforeEach`/`afterEach` so any integration test runs by name filter (PAF-34).
- Audit evidence stays safe and deterministic: forward-only migration records `changed_fields` plus safe before/after transitions only; settings payloads, token hashes and account data remain excluded.
- Expiry tests seeded DB-relative (`clock_timestamp() + 5s`) and polled against the stored expiry with a bound — no wall-clock or sub-second margins (PAF-38).
- `supabase` CLI JSON output treated as untrusted: validated with zod; fixture helper corrected to the CLI v2 layout (top-level array, psql command tags) after the QA gate caught the mismatch.
- PAF-29 plan reconciled honestly: invitation issuance deferred to PAF-31 and delivered in `community-admin.functions.ts` — no duplicated issuance path in Tier 3.
- SSR locale oracle asserts raw response HTML, independent of hydration — locale correctness verified server-side (PAF-40).
- Visual comparator validates decoded dimensions and attaches expected/actual/diff artifacts; screenshot budgets unchanged (no widening to mask structural defects).
- Admin views extracted into `CommunityAdminViews.tsx` with loader-source/generation guards against stale async appends; members route split into an Outlet layout + index route (PAF-43).
- Confirmation flows use Base UI `AlertDialog` with focus transfer/restore/fallback; after the review loop, focus restores to the initiating trigger and errors render inside the open dialog.
- Loader errors split into recoverable (localized Retry + dashboard link) vs definitive denial (no retry) — mutation failures and refresh failures separated after review.
- Coverage matrices pinned: 320px × en/pt-BR/es 18-case accessibility/labels matrix; six 390px visual comparisons under unchanged budgets.
- Full-gate integrity: two earlier `pnpm complete-check` runs declared invalid/failing (unformatted planning docs; fixture-guard Vitest failure); only the authoritative run on `6f8db58` (pre-push gate) counts, recorded in `docs/plan/PAF-50-bundle.md`.

## Validation Performed

- Per-unit fast gates, all green:
  - Unit 1 (PAF-34): typecheck, lint, 35 integration tests.
  - Unit 2 (PAF-38): typecheck, lint, 47 tests, expiry test ×5 (timing determinism).
  - Unit 3 (PAF-40): typecheck, lint, 22 vitest, 18 Playwright.
  - Unit 4 (PAF-43): typecheck, lint, 57 vitest, 20 Playwright (fresh `CI=1` build) including the 18-case 320px × 3-locale matrix and six 390px visual comparisons under unchanged budgets.
- Post-review-fix validation: 83 vitest tests across the admin/root/onboarding suites; 38 Playwright tests across both community specs (fresh build); integration file run ×4 deterministic; 3-file integration combo 38/38.
- Reviews: full review by code-review-specialist, architecture-review-specialist and ux-ui-reviewer-specialist; delta re-review by code + UX reviewers confirming every fixed row (F2–F7, F12) with no new critical/major findings.
- Full gate `pnpm complete-check`: first run invalid (short-circuited on unformatted planning docs); second run failed the Vitest step on the fixture guard; the authoritative run on `6f8db58` is the pre-push gate and is recorded in `docs/plan/PAF-50-bundle.md`.

## Risks and Follow-ups

- **Branch unpushed:** all 5 commits (`bf0197e`…`6f8db58`) are local on `feature/PAF-50-tier-3-test-and-ui-polish`; PR against `main` (referencing PAF-50) still to be opened.
- **Deferred review findings (6 rows):** F1, F8–F11, F13 in `docs/plan/PAF-50-findings.md` — triage and schedule; 7 rows (F2–F7, F12) were fixed in `6f8db58`.
- **Forward-only migration:** `supabase/migrations/20261012111727_community_audit_changed_fields.sql` requires coordinated production rollout with the app deploy (same pattern as prior community migrations).
- **Visual budgets:** six 390px comparisons pass under unchanged budgets — keep budgets fixed on future UI changes; never widen to mask structural defects (project policy).
- **Gate history:** two invalid earlier `pnpm complete-check` runs (doc formatting; fixture guard) — the authoritative record lives in `docs/plan/PAF-50-bundle.md`; keep single-run authoritative records for future epics to avoid ambiguous gate states.
