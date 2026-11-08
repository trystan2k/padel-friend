---
title: PAF-157 Speed up test suite timing (unit / integration / e2e)
type: development-log
permalink: docs/development-logs/task-PAF-157-speed-up-test-suite-timing-unit-integration-e2e
---

# Development Log: PAF-157

## Metadata

- Task ID: PAF-157 — "Speed up test suite timing (unit / integration / e2e)" (epic)
- Date (UTC): 2026-11-08
- Project: padel-friend
- Branch: `feature/PAF-157-speed-up-test-suite-timing-unit-integration-e2e` (base `main`)
- Commits (4, chronological):
  - `0333486` — `chore: speed up CI test phases with integration parallelism, e2e workers and balanced shards` (2026-11-06; PAF-158 unit, 20 files)
  - `6464c6f` — `chore: share one db:reset and build across gate stages, add fast e2e lane` (2026-11-06; PAF-159 unit, 8 files)
  - `264b8b5` — `fix: harden integration isolation with scoped assertions and DDL-free parallel partition` (2026-11-07; fix loop, 4 files)
  - `f48a08c` — `fix: harden test gates with keyed builds, serial lanes and consistent waits` (2026-11-08; review/QA fix loop, 21 files)
- Related Linear: PAF-157 (epic) with sub-issues PAF-158 (CI speedups) and PAF-159 (local speedups); team PadelFriend
- Findings ledger: `docs/plan/PAF-157-findings.md` (review + QA findings F1–F28)
- Baselines targeted: CI critical path ~17–22 min; local `pnpm complete-check` ~35 min. Constraint: no weakening of coverage or assertions.

## Objective

- Cut the CI critical path (~17–22 min) and the local `pnpm complete-check` runtime (~35 min) without weakening coverage thresholds, test counts, or assertion strength.
- Delivered in two units plus two hardening loops: PAF-158 (CI phases: integration parallelism, e2e workers/shards, artifact sharing, docker cache), PAF-159 (local gate: fast e2e lane, shared build, per-phase fresh resets), a review/QA fix loop (integration isolation hardening), and a final review/QA fix batch (keyed builds, serial lanes, consistent waits).

## Implementation Summary

- Unit 1 — PAF-158, CI (`0333486`):
  - Integration tests run in two phases via `scripts/run-integration.mjs`: an audited parallel-safe partition first, then the serial remainder. Phase selector `INTEGRATION_PHASE=parallel|serial`; rollback switch `INTEGRATION_SERIAL=1` restores fully-serial execution.
  - Perf fixture batched via promise pool: 118 s → ~62–88 s (statistics.performance isolated run 88.36 s vs 118 s CI baseline).
  - E2E lanes rebalanced by measured runtime with a dedicated visual lane; lane planner `scripts/e2e-shards.mjs`.
  - CI e2e workers `process.env.CI ? 4 : undefined` (local default preserved).
  - Populated-upgrade job gated by a `--no-renames` path diff (rename-safe).
  - Supabase docker image cache via composite action `.github/actions/supabase-start`.
  - One shared build artifact across stages (dist + manifest SHA) with fail-closed verification and `E2E_GATE_PREBUILT` skip-build support for the Playwright webServer.
- Unit 2 — PAF-159, local (`6464c6f`):
  - New fast lane `pnpm test:e2e:fast`: same fresh reset + preview as `pnpm test:e2e`, visual specs excluded via the shared `VISUAL_GREP` constant (from `scripts/e2e-shards.mjs`); caller `--grep`/`--grep-invert` flags rejected so the visual filter cannot be cancelled.
  - `pnpm complete-check` restructured: per-phase fresh DB resets (`test:unit → db:reset → db:types:check → test:integration → db:reset:e2e → e2e`) and ONE shared build reused across the gate via `E2E_GATE_PREBUILT`.
  - Standalone `pnpm test` / `pnpm test:e2e` keep their own resets + fresh builds.
  - Workers stay local-safe (defaults preserved); AGENTS.md toolchain notes updated to document the new topology.
- Fix loop 1 (`264b8b5`, integration isolation hardening):
  - Integration global assertions scoped to owning proposals, with leftover-proposal regression tests.
  - Statistics publish realignment fixed in the bounded-history suite.
  - Parallel partition pruned 22 → 8 provably trigger-DDL-free files; a transitive import-scan contract guards it (hazard found: trigger DDL reachable through imports can deadlock or bleed disabled-trigger state into parallel runs).
  - Runner honors the phase selector and fails on zero-test filtered runs.
- Fix loop 2 (`f48a08c`, review/QA findings F1–F28, 21 files):
  - Lane planner fails closed (temp-file exit-code propagation); recursive e2e spec discovery; populated-upgrade gate rename-safe (`--no-renames`).
  - `E2E_GATE_PREBUILT` renamed from the legacy name (legacy value ignored; standalone `pnpm test:e2e` cannot inherit a gate build); build fingerprint covers Vite env files including `.env.production.local` (now gitignored).
  - Serial lane extended to 7 revision/lock-sensitive specs (`statistics`, `level-reviews` ×3, `notifications`, `result-corrections-visual`, `result-repairs`) with local `--workers=1` and serial-wins-over-visual precedence.
  - THREE-LAYER service-role-key fix via shared `scripts/e2e-build-env.mjs`: (1) Playwright webServer + gate build keyed, (2) the integration test's own build keyed, (3) reuse-time `.dev.vars` key check; fail-closed `requireServiceRoleKey`; CI e2e job appends the live key to the extracted `.dev.vars`. Root cause of the deterministic add-player e2e failures identified as a keyless `.dev.vars` clobbered mid-gate by the integration test's own build.
  - Poll-based eventual-consistency waits replace raced DB reads in matches-ranked (`:417` + siblings `:304-310`, `:320`).
  - Bounded visibility assertion in player-ratings (fixes the CI 180 s timeout context-leak: bounded failure instead of hang; root-cause evidence from CI run 41939337035 artifacts).

## Files Changed

Unit 1 — PAF-158 (`0333486`, 20 files):

- `.github/workflows/ci.yml` (two-phase integration, e2e workers/matrix, artifact sharing, populated-upgrade path gate, e2e `.dev.vars` key append)
- `.github/actions/supabase-start/` (new composite action — Supabase docker image cache)
- `scripts/run-integration.mjs` (new — two-phase integration runner, `INTEGRATION_PHASE` selector, zero-test filtered-run failure)
- `scripts/e2e-shards.mjs` (new — runtime-balanced lane planner + shared `VISUAL_GREP` constant)
- `scripts/complete-check.mjs` (per-phase fresh resets, shared build wiring, `E2E_GATE_PREBUILT`)
- `scripts/e2e-build-env.mjs` (new — shared keyed build-env builder for playwright webServer + gate build)
- Integration parallel partition definition (audited parallel-safe partition, later pruned 22 → 8)
- `test/fixtures/**` perf fixture (promise-pool batching)
- `package.json` (phase selectors, fast lane, gate stage scripts)

Unit 2 — PAF-159 (`6464c6f`, 8 files):

- `scripts/complete-check.mjs`, `package.json` (`test:e2e:fast`), `scripts/e2e-shards.mjs` / e2e fast-lane script, `AGENTS.md` (toolchain notes), vitest/playwright config wiring for `E2E_GATE_PREBUILT` and workers

Fix loop 1 (`264b8b5`, 4 files):

- Integration suites with global assertions (scoped to owning proposals + leftover-proposal regressions)
- Bounded-history statistics suite (publish realignment)
- Parallel partition + transitive import-scan contract (22 → 8 trigger-DDL-free files)
- `scripts/run-integration.mjs` (phase-selector + filtered-run behavior)

Fix loop 2 (`f48a08c`, 21 files):

- `scripts/e2e-shards.mjs` (fail-closed planner), `scripts/e2e-build-env.mjs` (three-layer key fix, `requireServiceRoleKey`), `scripts/complete-check.mjs` (keyed build fingerprint incl. Vite env files), `scripts/run-integration.mjs`
- `.github/workflows/ci.yml` (rename-safe gate, extracted `.dev.vars` key append)
- `.gitignore` (`.env.production.local`), `knip.json`, `package.json`
- Serial-lane specs: `statistics`, `level-reviews` (×3), `notifications`, `result-corrections-visual`, `result-repairs`
- E2E specs: matches-ranked (poll-based waits `:417`, `:304-310`, `:320`), player-ratings (bounded visibility assertion), provisional fixture family, community-admin tags
- Contract + regression tests for the isolation and partition changes

Explicitly untouched: `scripts/free-port` (left as-is by design); coverage thresholds (unchanged); no test removed or skipped.

## Key Decisions

- Two-phase integration instead of blanket parallelism: only an audited, provably trigger-DDL-free partition (22 → 8 files after the import-scan contract) runs in parallel; everything else stays serial. Rationale: trigger DDL reachable through transitive imports deadlocks or bleeds disabled-trigger state across parallel workers. Rollback is one env switch (`INTEGRATION_SERIAL=1`).
- E2E lanes balanced by measured runtime, not file count, with a dedicated visual lane and the `VISUAL_GREP` constant shared between planner and fast lane; the fast lane rejects caller grep flags so the visual exclusion cannot be silently cancelled.
- One shared gate build, keyed by a fingerprint covering Vite env files (including the newly-gitignored `.env.production.local`) with fail-closed verification; the `E2E_GATE_PREBUILT` rename is intentional — legacy values are ignored so a standalone `pnpm test:e2e` can never inherit a stale/inherited gate build.
- Per-phase fresh DB resets inside complete-check (integration residue classes are not prunable by e2e global-setup — evidence: 10/450 e2e failures on an integration-dirtied DB vs 450/450 from a fresh reset); standalone commands keep their own resets.
- Service-role-key handling made three-layer and fail-closed after root-causing deterministic add-player e2e failures to a keyless `.dev.vars` clobbered mid-gate by the integration test's own build.
- Serial lane extended deliberately to 7 revision/lock-sensitive specs with serial-wins-over-visual precedence — correctness over maximal parallelism; flaky-wait races replaced with poll-based eventual-consistency checks, and the player-ratings timeout context-leak converted into a bounded assertion failure.
- Visual specs stay on PRs in a dedicated lane (explicit user decision).
- CI-only items (docker cache, artifact sharing, lane matrix, path gate) verified structurally now; real timing proof deferred to the PR's CI run via existing `artifacts/*-timing.json` evidence rather than claimed prematurely.

## Validation Performed

- Local full gate `pnpm complete-check` GREEN on the final state (gate #8):
  - Build, knip, typecheck, lint, format ✓
  - Unit: 2992/2992, coverage 100%, thresholds unchanged
  - Integration: parallel partition 43/43 (13–24 s) + serial 991/991 (~600 s vs 764 s all-serial CI baseline ≈ 20% faster)
  - E2E: 450/450 — main sweep 344 @ 5 workers (6.3 min) + serial 106 @ 1 worker (3.0 min); e2e total 9.3 min vs ~8–11 min CI shards at 2 workers
- E2E evidence: multiple standalone 450/450 runs green; statistics.performance isolated 88.36 s vs 118 s CI baseline.
- Review + QA findings F1–F28 tracked in `docs/plan/PAF-157-findings.md` and addressed in fix commits `264b8b5` + `f48a08c`; regression tests added fail-before/passing-after (scoped assertions, zero-test filtered runs, left-over proposals).
- Root-cause evidence taken from CI run 41939337035 artifacts (player-ratings 180 s timeout context-leak; keyless `.dev.vars` mid-gate clobber).
- CI-only items verified structurally (actionlint clean) + fail-closed checks; actual CI timings to be confirmed by the PR's CI run via `artifacts/*-timing.json`.

## Risks and Follow-ups

- AC6 (player-ratings 180 s CI timeout): context-leak confirmed via foreign-page snapshot and bounded-failure hardening applied, but the full root cause is unverified until the PR CI runs show no recurrence.
- CI timing claims (~9–12 min projected) require the PR's CI run to confirm; only the local ≈20% integration win is directly measured so far.
- Findings ledger observations recorded, not fixed: F8/F22 (dirty-DB-alone failures of `result-replay.races` / `result-corrections.statistics`) and a provisional-cluster failure that was unexplained-but-unreproduced — watch for recurrence on CI.
- User decision embedded in delivery: visual specs remain on PRs in a dedicated lane; revisit only if PR pipeline time becomes a problem.
- Pooler/imgproxy services do not start locally (no config section, zero consumers) — documented quirk, not a defect.

## Relations

- Linear: PAF-157 (epic) → PAF-158 (CI), PAF-159 (local); team PadelFriend
- Related docs: `docs/plan/PAF-157-findings.md` (F1–F28 ledger), `AGENTS.md` (toolchain notes)
- Related prior work: PAF-109 (test-runtime investigation + transport), PAF-110 (delivery harness) — this epic builds on their CI topology and gate structure
