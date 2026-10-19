---
title: PAF-84 and PAF-77 Combined Review Follow-ups Delivery
type: development-log
permalink: docs/development-logs/task-PAF-84-PAF-77-combined-review-follow-ups-delivery
---

# Development Log: PAF-84 + PAF-77

## Metadata

- Task ID: PAF-84 + PAF-77 (two Linear follow-up issues delivered together as one combined delivery in a single PR)
- Date (UTC): 2026-10-19
- Project: padel-friend
- Branch: feature/PAF-84-PAF-77-review-followups (base `ba8ef88` = `origin/main`)
- Commits (3, oldest first): `b5125aa` (Unit A — PAF-84, 25 files, +1204/−202), `91bf7ba` (Unit B — PAF-77, 36 files, +1913/−148), `831c641` (review fixes, 11 files, +373/−25, HEAD)
- Linear: PAF-84 "PAF-5 follow-up — deferred review findings and design-library polish"; PAF-77 "PAF-4 follow-up — deferred minor findings from the match events review"
- Artifacts: findings ledger `docs/plan/PAF-84-PAF-77-findings.md`, context bundle `docs/plan/PAF-84-PAF-77-bundle.md`, plan `docs/plan/Plan PAF-84-PAF-77 …md`

## Objective

- Close the review findings deferred from the PAF-5 registration delivery (PAF-84) and the PAF-4 match-events delivery (PAF-77) in one combined PR: extract shared presentation primitives app-wide, harden E2E fixture isolation and CI migration guarding, fix notification copy, snapshot/eligibility semantics, photo-signing fan-out, invitation-context SQL, and touch-target geometry — then resolve the review findings raised against this delivery itself (commit `831c641`).

## Implementation Summary

- **Unit A — PAF-84, commit `b5125aa` — shared status surfaces and registration test isolation.**
  - App-wide extraction of shared presentation primitives `src/components/ui/StatusBadge.tsx` + `RosterRow.tsx` (with StyleX style modules); migrated every consumer: `MatchRegistrationPanel`, `MatchRequestQueue`, `MatchCard`, `NotificationsPage`, `NotificationBadge`; duplicated badge/roster/summary styling removed from the feature style modules. Tests `test/ui.status-badge.test.tsx`, `test/ui.roster-row.test.tsx`.
  - E2E fixture isolation: new `e2e/match-fixture-cleanup.ts` with ownership-scoped prune, notification-before-event deletion, atomic trigger disable/restore, stale-family invalidation, and a loopback guard in the runner; wired into `e2e/global-setup.ts` and `e2e/matches-registration-visual.spec.ts`. New `test/matches.fixture-cleanup.test.ts`; extended `test/matches.prune-scoping.integration.test.ts`.
  - CI populated-migration upgrade guard: new `scripts/test-populated-migration-up.mjs` (+ `.d.mts`), `test/fixtures/matches-predecessor-upgrade.sql`, `test/fixtures/matches-upgrade-assertions.sql`, `test/matches.migration-up-harness.test.ts`, and sequential CI steps in `.github/workflows/ci.yml` (guarded opt-in upgrade → failure-aware restore of the latest schema → enforcement).
  - Ledger closure: F17 (accepted-state "View group" self-link) resolved-by-design; four `.pen`/advisory items documented as non-defects; ledger rows F12 and F35 verified already fixed.
- **Unit B — PAF-77, commit `91bf7ba` — match discovery context and eligibility semantics.**
  - F20: publication notifications no longer use invitation copy; new `notifications.match.publishedBy` key in en/pt-BR/es; unknown kinds degrade to generic copy.
  - F21: one database-issued `as_of` snapshot emitted by all five `list_match_events` definitions, propagated through validators, the list server function, route loaders, and `MatchesPage` pagination state with a refresh/generation guard; JS clock default removed; cards no longer carry `as_of`/`cursor`.
  - F22 (narrow): `match-model.ts` broad `Record` intersection replaced with an explicit property list; wider contract/decoder work remains a follow-up.
  - F23: `signMatchPhotoBatch` in `match-photo.server.ts` — one `createSignedUrls` call per page over already-authorized projected keys, path-based mapping, no per-card event lookup or signing fan-out.
  - F24: new `public.match_event_caller_context(uuid)` (security definer, empty search_path, execute revoked from public/anon/authenticated) with invitation as an independent boolean, separate from eligibility and approval; wired into `get_match_event`/`list_match_events` across ALL FIVE migration overrides; invitation displayed independently in card/detail, request CTA selected before the invitation-only fallback when approval is required.
  - F25: both match-details checkbox labels guarantee ≥44px in both dimensions via token-based minimums, measured on the label element across 12 viewport×theme×locale combinations.
- **Review fixes — commit `831c641` — findings raised against this delivery.**
  - F1 (major): invite-only callers requiring approval were shown a request CTA that the server always rejects → now falls back to the invitation state.
  - F3 (major): snapshot agreement compared timestamp spelling, not instant; PostgreSQL echoes `+00:00` while the client sends `Z`, so a valid page-2 request would throw `MATCH_LIST_SNAPSHOT_MISMATCH` → comparison normalised to the instant.
  - F6 (minor): accepted invitees also saw approval-required wording → suppressed for accepted callers.
  - F2 (minor): visual fixture photo removal raced event deletion and could silently leave attached photos → ordering enforced and removed paths verified.
  - Deferred: F4 (shared tones still use match-domain vocabulary), F5 (card contract optionality remains incomplete).

## Files Changed

- Shared UI extraction (Unit A / PAF-84): `src/components/ui/StatusBadge.tsx`, `src/components/ui/RosterRow.tsx` (+ StyleX style modules) — new shared primitives; consumers migrated: `MatchRegistrationPanel`, `MatchRequestQueue`, `MatchCard`, `NotificationsPage`, `NotificationBadge`; tests `test/ui.status-badge.test.tsx`, `test/ui.roster-row.test.tsx` (part of 25 files, +1204/−202)
- E2E fixture isolation (Unit A): `e2e/match-fixture-cleanup.ts` (new), `e2e/global-setup.ts`, `e2e/matches-registration-visual.spec.ts`, `test/matches.fixture-cleanup.test.ts` (new), `test/matches.prune-scoping.integration.test.ts` (extended)
- CI migration guard (Unit A): `scripts/test-populated-migration-up.mjs` (+ `.d.mts`), `test/fixtures/matches-predecessor-upgrade.sql`, `test/fixtures/matches-upgrade-assertions.sql`, `test/matches.migration-up-harness.test.ts`, `.github/workflows/ci.yml`
- Notification copy (Unit B / F20): `notifications.match.publishedBy` added to en/pt-BR/es locales; notification suites
- Snapshot semantics (Unit B / F21): `list_match_events` definitions ×5, validators, list server function, route loaders, `MatchesPage`; `match-model.ts` (also F22)
- Photo signing (Unit B / F23): `match-photo.server.ts` (`signMatchPhotoBatch`)
- Invitation context (Unit B / F24): `public.match_event_caller_context(uuid)` in `get_match_event`/`list_match_events` across all five migration overrides; card/detail UI (part of 36 files, +1913/−148)
- Touch targets (Unit B / F25): match-details checkbox labels, token-based minimums
- Review fixes (commit `831c641`): invitation-state fallback, snapshot instant comparison, accepted-caller wording suppression, visual fixture cleanup ordering (part of 11 files, +373/−25)
- Planning artifacts: `docs/plan/PAF-84-PAF-77-findings.md`, `docs/plan/PAF-84-PAF-77-bundle.md`, `docs/plan/Plan PAF-84-PAF-77 …md`

## Key Decisions

- One app-wide extraction of `StatusBadge`/`RosterRow` instead of per-feature cleanup — every consumer migrated in the same commit so duplicated styling is removed once, with dedicated unit tests for the primitives.
- E2E fixture cleanup is ownership-scoped with notification-before-event deletion, atomic trigger disable/restore, stale-family invalidation, and a loopback guard in the runner — prevents cross-run leakage without letting the harness touch foreign data.
- Populated-migration upgrade guard runs as sequential, guarded opt-in CI steps with failure-aware restore of the latest schema, then enforcement — an upgrade failure cannot leave CI on a broken schema.
- F17 closed resolved-by-design; four `.pen`/advisory items documented as non-defects; F12/F35 verified already fixed — ledger records the rationale instead of code churn.
- F21: `as_of` is issued once by the database and threaded through all five `list_match_events` definitions; the JS clock default was removed and cards no longer carry `as_of`/`cursor`, with a refresh/generation guard on `MatchesPage`.
- F24: invitation modeled as an independent boolean in a security-definer RPC (empty search_path, execute revoked from public/anon/authenticated), separate from eligibility and approval, replicated across all five migration overrides; UI shows invitation independently and selects the request CTA before the invitation-only fallback when approval is required.
- F23: batch photo signing per page over already-authorized projected keys (path-based mapping) — no per-card event lookup or signing fan-out.
- F25: 44px minimums implemented as token-based constraints on the label element, not hardcoded pixel values, per project token rules.
- Review F1: when approval is required for an invite-only caller, the UI falls back to the invitation state rather than offering a request CTA the server always rejects.
- Review F3: snapshot agreement compares instants (normalising `+00:00` vs `Z` spelling), not timestamp strings.
- Deferrals accepted with rationale in the ledger: F4 (shared tones still use match-domain vocabulary), F5 (card contract optionality incomplete), F22 wider contract/decoder work.

## Validation Performed

- Unit A fast gate: typecheck 0 errors, lint 0, 11 files / 102 tests green.
- Unit A E2E: `matches-registration-visual` 7 passed twice (non-leak confirmed); `matches-registration` 12 passed; zero owned fixture residue after teardown.
- Unit B / F20: notification suites green with fail-before proof.
- Unit B / F21: 5 files / 47 tests.
- Unit B / F23: 3 files / 20 tests with call-count fail-before proof.
- Unit B / F24: 10 integration tests (invited+out-of-range proven in list AND detail; old-vs-new behavior empirically compared) plus 46 collateral tests.
- Unit B / F25: full geometry matrix with 44.00px measurements and proven wrap across 12 viewport×theme×locale combinations.
- Unit B / F22: typecheck 0, lint 0, 56 tests.
- E2E regression fixed mid-delivery: `matches-visual` 12 passed with zero skipped after the invitee JOIN-button regression was corrected; `matches-registration-visual` 9 passed twice after the F2 cleanup fix.
- Pending: final full gate `pnpm complete-check` result to be appended by the orchestrator.

## Risks and Follow-ups

- **Deferred F4**: shared tone tokens still use match-domain vocabulary — rename/generalise in a follow-up so non-match consumers are not semantically coupled.
- **Deferred F5**: card contract optionality remains incomplete — tighten the shared card contract in a follow-up.
- **F22 follow-up**: wider contract/decoder work beyond the narrow `Record`-intersection replacement remains open.
- **Final gate**: `pnpm complete-check` result not yet recorded in this log; orchestrator to append it before merge.
- **Migration surface**: `match_event_caller_context` exists in five migration overrides — any future migration touching `get_match_event`/`list_match_events` must keep all five in sync.
