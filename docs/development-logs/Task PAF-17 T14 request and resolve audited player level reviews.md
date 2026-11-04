---
title: PAF-17 T14 Request and resolve audited player level reviews
type: development-log
permalink: docs/development-logs/task-PAF-17-t14-request-and-resolve-audited-player-level-reviews
---

# Development Log: PAF-17

## Metadata

- Task ID: PAF-17 (T14 — Request and resolve audited player level reviews; epic parent delivered via sub-issues PAF-147/PAF-148/PAF-149/PAF-150/PAF-151)
- Date (UTC): 2026-11-04
- Project: padel-friend
- Branch: `feature/PAF-17-request-and-resolve-audited-player-level-reviews` (base for PR: `main`)
- Scope: player requests a level review; only Platform Admin resolves; approval appends an immutable `ADMIN_REVIEW_ADJUSTMENT` affecting future rating only; reliability preserved unless an explicitly justified exception; historical results and League standings never replayed.
- Binding scope decisions (user-approved): B1 five-state lifecycle (pending → under_review → approved/rejected + owner canceled; PRD §12.6 + Pencil won over Linear intake's 4 states); B2 reliability: preserve default, reset → 10%, reduce → explicit whole percent 0..before−1, +6/group afterwards capped 100, real group count never resets, versioned exception kernel 1.1.0, V1 1.0.0 untouched; evidence bounded plain text ≤4000 (no uploads).
- Commits (9, oldest first, one per unit of work + aux):
  1. `2d7cde2` (feat: add secure player level review requests — PAF-147)
  2. `f08b3fb` (feat: apply immutable forward-only rating adjustments — PAF-148)
  3. `bad4acc` (feat: add player level review request and history views — PAF-149)
  4. `2239fe3` (docs: add calibrated gate timeouts and rate-limit session handoff — aux)
  5. `0b489b0` (test: fix ranked eligibility scheduler confirmation assertions — aux U4 test-oracle fix)
  6. `c93a7bb` (feat: add platform admin level review decisions — PAF-150)
  7. `113af9b` (docs(delivery-orchestrator): update rate-limit fallback recovery logic — aux)
  8. `d96ba91` (feat: notify and audit player level review outcomes — PAF-151)
  9. `c6dd090` (fix: address review findings — review-loop delta)
  - Interleaved aux on the branch (harness housekeeping, not part of the delivery list): `143e0bc` (chore: remove hardcoded step counts from subagent configs).
- Artifacts: review-loop findings ledger (22 findings: all fixed or observed), this development log.
- Related Linear: PAF-17 epic + sub-issues PAF-147/PAF-148/PAF-149/PAF-150/PAF-151 (project PadelFriend).
- Final gate: `pnpm complete-check` runs as delivery step 9 immediately after this log.

## Objective

- Let a player request a player level review with bounded evidence, track it through an audited five-state lifecycle, and let a Platform Admin resolve it with an audited, immutable, forward-only rating adjustment — without ever replaying historical results or League standings and without weakening rating reliability except through an explicitly justified, kernel-versioned exception.

## Implementation Summary

- **PAF-147 — Secure request backend (`2d7cde2`)**: migration `20261103090000` — level review requests table + state enum + `platform_admins` + 9 SECURITY DEFINER RPCs + RLS + rate limit 3 requests/24h + idempotent command UUIDs + keyset pagination. Feature slice `src/features/level-reviews/` (contracts, strict decoders, validators, server functions). Integration suites cover RLS, role denial, schema, and transitions with real authenticated clients.
- **PAF-148 — Immutable forward-only rating adjustments (`f08b3fb`)**: migrations `20261103091000`–`20261103094000` — exception kernel 1.1.0 with version dispatch (V1 1.0.0 untouched), immutable `player_rating_admin_adjustments` + replay-state table, checkpoint-aware projection/replay/tail/consistency rewrite, one-transaction atomic resolve with plan lock order, discriminated timeline readers, statistics/rank publication. Bounded `docs/rating/v1-calibration.md` update. Race suites run with dedicated connections (approval-first / confirmation-first schedules).
- **PAF-149 — Player request and history views (`bad4acc`)**: player routes + request/status/history components; StyleX + design tokens; i18n ×3 (en, pt-BR, es); discriminated adjustment timeline surfaced in rating history/chart; E2E player spec + fixtures; visual references (qWosG/OKYtp) + provenance test.
- **Aux — gate calibration and oracle fix (`2239fe3`, `0b489b0`)**: calibrated gate timeouts + rate-limit session handoff baked into agent instructions (2× measured gate durations, floors 3600s full unit / 1800s E2E; resume-session/handoff-brief continuity). U4 test-oracle fix: ranked eligibility scheduler `confirmed` counts globally across the due queue.
- **PAF-150 — Platform admin decisions (`c93a7bb`)**: app-wide platform-admin parent guard route (community role does NOT grant platform admin); queue + decision UI — approve exact-target-in-range / reject with notes; reliability preserve / reset / reduce with required justification; under_review transition; stale-preview reconfirm; idempotent resolve. Migration `20261103095000` (admin detail internal preview). Admin E2E.
- **PAF-151 — Notifications and audit (`d96ba91`)**: resolution notification trigger in the same transaction as resolve (`persist_notification`, key `level-review:<id>:resolved`); recreated `get_my_notification_target_v3` with level-review context; notification UI + locales; audit chain integration tests; E2E full-flow spec; visual suite finalized with calibrated per-screen budgets.
- **Aux — orchestrator docs (`113af9b`)**: rate-limit fallback rework (paired-model probing removed → single-sleep same-model wait + work-state continuity).
- **Review-loop delta (`c6dd090`)**: migration `20261104090000` — revision-bound server-computed approval preview RPC + shared projection arithmetic; before_mu/after_mu in audit DTO; plan boundary representation restored with tie rules + typed-event-ID cursor tuple. Timeline consistency (effective vs decision-time semantics). `PlatformAdminEntry.tsx` server-driven admin entry; loader-sync refactor; in-page audit link; recent-history render; preview-to-command race fix (inputs locked incl. decision note, fail-first proven); locale-aware μ precision formatting; forward-only titled card; `--color-line` contrast borders + focus rings (fixed real WCAG 1.4.11 violations found by new probes); full-viewport raster + ±0.5px geometry probes + sensitivity injections; zoom/contrast/keyboard/reduced-motion coverage; U4 dirty-DB clock-race root-cause fix.

## Files Changed

- Grouped scope below (per-commit file-level diffs live in git history on the delivery branch; migration and slice inventories verified against the working tree).
- **Migrations (8 new, `supabase/migrations/`)**: `20261103090000_level_review_requests.sql` (PAF-147), `20261103091000_rating_exception_kernel.sql`, `20261103092000_rating_admin_adjustments.sql`, `20261103093000_rating_projection_checkpoints.sql`, `20261103094000_level_review_adjustment_approval.sql` (PAF-148), `20261103095000_level_review_admin_internal_preview.sql` (PAF-150), `20261103100000_level_review_resolution_notifications.sql` (PAF-151), `20261104090000_level_review_forward_boundary_preview.sql` (review fix).
- **Level-review feature slice (`src/features/level-reviews/`, 17 files)**: `level-review-contracts.ts`, `level-review-decoders.ts`, `level-review-validators.ts`, `level-review-errors.ts`, `level-review.server.ts`, `level-review.functions.ts`, `level-review-view.ts`, `level-review-form.ts`, `level-review-format.ts`, `level-review.styles.ts`, `PlayerLevelReviewRequest.tsx`, `PlayerLevelReviewStatus.tsx`, `PlayerLevelReviewHistory.tsx`, `LevelReviewStates.tsx`, `PlatformLevelReviewQueue.tsx`, `PlatformLevelReviewDetail.tsx`, `PlatformAdminEntry.tsx`.
- **Routes**: player — `_protected.level-reviews.index.tsx`, `_protected.level-reviews.new.tsx`, `_protected.level-reviews.$requestId.tsx`; platform admin — `_protected.platform-admin.tsx` (app-wide guard parent), `_protected.platform-admin.level-reviews.index.tsx`, `_protected.platform-admin.level-reviews.$requestId.tsx`.
- **Copy**: `src/locales/{en,pt-BR,es}/translation.json` (request/status/history, admin decision, notification, audit strings).
- **Docs**: `docs/rating/v1-calibration.md` (bounded exception-kernel update).
- **Tests (`test/`)**: RLS/role-denial/schema/transition integration suites (real authenticated clients); race suites with dedicated connections (approval-first/confirmation-first); audit chain integration tests; scheduler oracle fix (`0b489b0`); dirty-DB clock-race root-cause fix (`c6dd090`).
- **E2E (`e2e/`)**: `level-reviews-player.spec.ts`, `level-reviews-admin.spec.ts`, `level-reviews.spec.ts` (full flow), `level-reviews-visual.spec.ts`, `level-reviews-fixtures.ts`; visual references `e2e/references/paf-17/` (manifest + qWosG/OKYtp/gGNxk PNGs) with calibrated per-screen budgets + provenance test.
- **Workflow records**: review-loop findings ledger + this development log.

## Key Decisions

- **B1 — Five-state lifecycle** (pending → under_review → approved/rejected + owner canceled) per PRD §12.6 + Pencil design; won over the Linear intake's 4-state proposal.
- **B2 — Reliability exception semantics**: preserve is the default; reset → 10%; reduce → explicit whole percent 0..before−1; +6/group progression afterwards capped at 100; a player's real group count never resets. Exception arithmetic ships as versioned kernel 1.1.0 with version dispatch; V1 1.0.0 engine untouched.
- **Forward-only adjustment**: approval appends an immutable `ADMIN_REVIEW_ADJUSTMENT` affecting future rating only; historical results and League standings are never replayed. Replay-state table + checkpoint-aware projection keep consistency without replay.
- **Evidence bound**: plain text ≤4000 chars, no uploads — keeps the audit surface text-only and bounded.
- **Only Platform Admin resolves**: app-wide platform-admin parent guard route; community admin role deliberately does NOT grant platform admin.
- **`platform_admins` provisioning is a trusted operator action**: table empty by default; tests provision via trusted SQL.
- **Server-computed approval preview** (review fix): the revision-bound preview RPC + shared projection arithmetic remove client-side preview drift; preview-to-command race closed by locking inputs (incl. decision note), proven fail-first.
- **Boundary chronology restored to plan**: plan boundary representation with tie rules + typed-event-ID cursor tuple (migration `20261104090000`).
- **Timeline consistency**: discriminated timeline readers distinguish effective vs decision-time semantics so summary/history/chart agree.
- **No `level_review_request_events` table**: the request row carries per-transition actor/time — documented judgment call avoiding an extra audit table.
- **Accessibility by probe, not assumption**: new contrast probes caught real WCAG 1.4.11 violations; fixed with `--color-line` borders + focus rings (no budget widening to mask them).

## Validation Performed

- **Full `pnpm test`**: 2,810 unit + 942 integration tests all pass; coverage thresholds unchanged.
- **E2E**: level-review specs + visual + admin 27/27; full E2E suite 395 passed.
- **Static**: typecheck + lint strict clean; `pnpm db:types:check` green.
- **Concurrency**: race suites with dedicated connections (approval-first / confirmation-first schedules) converge; idempotent resolve verified.
- **Audit chain**: integration tests cover notification trigger same-transaction atomicity and audit DTO contents (incl. before_mu/after_mu).
- **Visual/a11y**: full-viewport raster + ±0.5px geometry probes + sensitivity injections; zoom/contrast/keyboard/reduced-motion coverage; calibrated per-screen budgets documented (not widened to mask defects).
- **Review loop**: 3 full reviews (code + architecture + UX/UI) + 2 delta passes + closure verification; 22 findings total, all fixed or observed (F4 note placement documented in manifest rationale; F5 environment-only collapse resolved by infra restart).
- **Final gate**: `pnpm complete-check` scheduled as delivery step 9 immediately after this log (not yet run at time of writing).

## Risks and Follow-ups

- **Production Platform Admin provisioning** is a trusted operator action: `platform_admins` is empty by default (tests provision via trusted SQL); live admin flow verification needs a provisioned UUID.
- **Visual budgets are nonzero** and documented per-screen: live screens render controls the static frames don't draw; budgets must not be widened further without justification.
- **No `level_review_request_events` table**: request row carries per-transition actor/time — acceptable now, revisit if per-event querying or retention requirements emerge.
