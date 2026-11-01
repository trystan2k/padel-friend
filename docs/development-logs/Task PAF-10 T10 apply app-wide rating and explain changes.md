---
title: PAF-10 T10 Apply App-Wide Rating and Explain Changes
type: development-log
permalink: docs/development-logs/task-PAF-10-t10-apply-app-wide-rating-and-explain-changes
---

# Development Log: PAF-10

## Metadata

- Task ID: PAF-10 (T10 — Apply app-wide rating and explain changes; epic parent delivered via sub-issues PAF-132/PAF-133/PAF-134/PAF-135/PAF-136/PAF-137 as units U1–U6)
- Date (UTC): 2026-11-01
- Project: padel-friend
- Branch: `feature/PAF-10-apply-app-wide-rating-and-explain-changes` (from `origin/main` `eb1a94b`; base for PR: `main`)
- Commits (7, oldest first, one per unit + review-fix commit):
  1. `265b753` (feat: add immutable rating ledger and initialization audit — U1/PAF-132)
  2. `afbd703` (feat: implement calibrated team-aware rating calculation — U2/PAF-133)
  3. `6c76128` (feat: project and backfill confirmed ratings atomically — U3/PAF-134)
  4. `8254844` (feat: expose private sporting rating history and explanations — U4/PAF-135)
  5. `eaf6282` (feat: show rating progression and explain player changes — U5/PAF-136)
  6. `93b9492` (test: verify localized rating and provisional journeys — U6/PAF-137)
  7. `3ab8d38` (fix: address review findings — review fix loop, rounds 1–3)
- Artifacts: plan `docs/plan/Plan PAF-10 T10 — Apply app-wide rating and explain changes.md`, findings ledger `docs/plan/PAF-10-findings.md` (per-finding evidence for all review rounds), this development log
- Related Linear: PAF-10 epic + sub-issues PAF-132–PAF-137 (project PadelFriend); implements the human-approved PAF-9 V1 calibration (`docs/rating/v1-calibration.md` + `docs/rating/golden-fixtures.json`) as the production engine

## Objective

- Apply the approved V1 global-rating calibration app-wide and make rating changes explainable: immutable ledger schema, calibrated SQL calculation kernel, atomic projection/backfill wired into the production confirmation seam, private history/explanation APIs, rating-journey UI in three locales, and localized E2E + visual coverage.

## Implementation Summary

- **U1 — Ledger schema (`265b753`)**: `player_rating_events` (unique per group+player, INSERT guard vs eligible confirmation), `player_rating_event_calculations` (immutable revisions, frozen four-player inputs), `player_rating_initializations` (provenance/reason audit incl. `creator_estimated`), `player_rating_projection_control` (singleton, non-decreasing revision); `global_player_ratings` extended (config version, projection revision, V1 consistency checks after upgrade audit); unified init seam for onboarding/provisional/claim; `player_has_rated_history` made ledger-aware; immutability enforced + revoked runtime privileges + provisional/revoked-actor policies.
- **U2 — Calculation kernel (`afbd703`)**: pure SQL V1 kernel per approved PAF-9 calibration (engine app-wide `level/1.0.0`, config 1): exact numeric arithmetic, rational K, half-away-from-zero rounding, 0–7 clamp; fail-closed validation; 31-case golden oracle enumerated per-case + invariants + edge cases.
- **U3 — Atomic projection (`6c76128`)**: idempotent chronological projector wired into `finalize_match_event_result_locked` (manual/auto/retry); app-wide advisory-lock serialization (claim lock-order fix); exactly-once events; tail fast path + full-stream late replay appending calculation revisions; activation/backfill migration (deterministic sort, once, no-op re-run); populated-upgrade harness scenario; real multi-connection race matrix + failure injection.
- **U4 — Private read APIs (`8254844`)**: 5 SECURITY DEFINER DTO RPCs (summary, keyset history with revision cursors, progress points, group explanation, match-event changes); fail-closed TS decoders/validators; request-local authenticated handlers; whitelist serialization; ACL matrix verified (owner cross-community, group-scoped explanations, no inviter/email/claim leakage, no existence oracle).
- **U5 — Rating journey UI (`eaf6282`)**: accessible SVG progression chart with text-equivalent table, keyset history with load-more, explanation dialog built from stored payload only (provisional badges, honest zero/clamp/draw/reliability wording, error surface); result-detail rating changes; profile level card reads the projection; en/pt-BR/es (71 keys × 3).
- **U6 — E2E + visual coverage (`93b9492`)**: journeys through the production confirmation seam (manual/auto equivalence, retry idempotency, six exclusion statuses, cross-community single state, provisional claim journeys, locale loop, keyboard/focus, SSR privacy); Pencil-provenance visual gate with justified budgets + structural probes; locale copy audit hardening.
- **Review fix loop — `3ab8d38` (3 rounds)**: F1 group-scoped explanation access; F2 prelock + bounded re-snapshot retry protocol closing the snapshot-gap deadlock (deterministic 3-connection regression; round-1 implementation proven failing with SQLSTATE 40P01 before the fix); F4 SSR privacy assertions; F5 production-path cancellation regression; F6 journey raster regions + vertical-geometry probes with sensitivity proofs; F7 focus handling on ok/failed reloads + per-error-class announcements; F8 validated sign-in return paths. F3 (scale boundary) observed and plan-sanctioned, not "fixed".

## Files Changed

- **Migrations (8 new, `supabase/migrations/`)**: `20261101100000_global_rating_ledger.sql` (U1), `20261101110000_rating_v1_engine.sql` (U2), `20261101120000_rating_projection.sql` + `20261101130000_rating_activation_backfill.sql` (U3), `20261101140000_rating_read_projections.sql` (U4), review-fix migrations `20261101150000_rating_read_group_scope.sql` (F1) + `20261101151000_rating_projection_source_prelock.sql` + `20261101152000_rating_projection_prelock_coverage.sql` (F2).
- **Server/feature layer (`src/features/player/`)**: `rating.server.ts`, `rating.functions.ts`, `rating-validators.ts`, `rating-view.ts`, `rating-config.ts`, `rating-model.ts`, `rating-contracts.ts`, `rating-format.ts`, `rating.styles.ts`.
- **UI + copy**: rating journey UI (chart, history, explanation dialog, result-detail rating changes, profile level card) and `src/locales/{en,pt-BR,es}/translation.json` (71 keys × 3).
- **E2E (`e2e/`)**: `player-ratings.spec.ts`, `player-ratings-visual.spec.ts`, `player-ratings-fixtures.ts`.
- **Unit/integration tests (`test/`)**: 18 rating test files incl. `player.rating.schema.integration.test.ts`, `player.rating.engine.integration.test.ts`, `player.rating.projection.integration.test.ts`, `player.rating.races.integration.test.ts`, `player.rating.backfill.integration.test.ts`, `player.rating.readers.integration.test.ts`, `player.rating.provisional.integration.test.ts`, `player.rating.initialization.integration.test.ts`, `player.rating.cleanup.integration.test.ts`, `player.rating.explanation.test.ts`, `player.rating.copy.test.ts`, `player.rating.ui.test.tsx`, `player.profile.rating.test.tsx`, `player.rating.functions.test.ts`, `player.rating.model.test.ts`, `player.rating-config.test.ts`, `player.rating.contracts.test.ts`, `player.rating.fixtures.test.ts`.
- **Workflow records**: plan file, findings ledger `docs/plan/PAF-10-findings.md`, this development log. Per-commit file-level diffs live in git history on the delivery branch.

## Key Decisions

- **User-approved**: 6-sub-issue breakdown (epic delivery); chronological replay + append-only calculation-revisions ledger contract (late confirmations replay from ledgered initializations; originals kept as audit).
- **SQL kernel + transactional projector** over app-layer or queue architectures — plan-chosen and justified.
- **Evidence FKs → `player_profiles`**: keeps deletion-simulating tests viable; account deletion is blocked once the audit exists — noted as an operational consideration.
- **Group participants may read their own group explanation only** (event-wide changes need event-reader rights) — fixed in review (F1).
- **`game_group_id = match_event_result_proposals.id`**; `played_at` taken from the confirmed version; initialization audit kept separate from match events.

## Validation Performed

- **Per unit**: typecheck, lint (deny-warnings), oxfmt, `db:types:check`, affected vitest, then full `pnpm test` sequentially (final: unit 136 files / 1679 tests, integration 69 files / 554 tests; coverage thresholds unchanged).
- **E2E via `pnpm test:e2e`**: player-ratings specs 11/11; combined run with existing results/review/provisional/PAF-8 visual specs 55/55; populated migration-up × 2 with independent clean-replay assertions.
- **Review**: full review by 3 reviewers + 3 delta rounds; all required/related findings fixed and delta-verified (findings ledger has per-finding evidence).
- **Pending**: final-state `pnpm complete-check` runs at the orchestrator final gate (after this log).

## Risks and Follow-ups

- **F3 observed (plan-sanctioned)**: late-confirmation full replay ≈1.4 ms/stream-group → PostgREST 8s timeout at ≈5,000+ groups; suffix replay postponed per plan; revisit on stream-growth data.
- **Fresh-deploy window**: activation baked into `20261101130000` runs before the fix migrations patch lock order; a deadlock in that window aborts retryably (deploy retry) — no corruption.
- **Account deletion blocked** once an initialization audit exists — confirm operational deletion requirements before release.
- **Flake watch**: `matches.results.page` flight-timing test flaked once across all runs, did not recur, was untouched.
- **Gate**: `pnpm complete-check` on final state owned by the orchestrator final gate; log intentionally left uncommitted for the orchestrator sweep.
