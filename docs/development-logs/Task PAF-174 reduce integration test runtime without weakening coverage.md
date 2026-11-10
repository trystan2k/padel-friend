---
title: PAF-174 Reduce integration test runtime without weakening coverage
type: development-log
permalink: docs/development-logs/task-PAF-174-reduce-integration-test-runtime-without-weakening-coverage
---

# Development Log: PAF-174

## Metadata

- Task ID: PAF-174 — "Reduce integration test runtime without weakening coverage"
- Date (UTC): 2026-11-10
- Project: padel-friend
- Branch: `feature/PAF-174-reduce-integration-runtime` (base `origin/main`)
- Commits (5, chronological):
  - `d41343b` — `test: bulk-prepare statistics performance history via rebuild_statistics` (P1 / U3)
  - `2bc3df3` — `fix: reuse a single dump across restore rehearsal destinations` (P2 / U4)
  - `198e278` — `test: preserve trigger states in fixture setup DDL` (P3 / U5)
  - `0b51ea4` — `test: hand the integration database url to workers once per run` (P4 / U6)
  - `a3c22c7` — `fix: address review findings in integration harness changes` (review fixes R1–R9, fix rounds 1–3)
- Final diff vs `main`: 24 files, ~+1400/−240 across the 5 commits
- Related Linear: PAF-174; team PadelFriend (<https://linear.app/trystanworkspace2/issue/PAF-174>)
- Findings ledger: `docs/plan/PAF-174-findings.md` (review findings R1–R9, all fixed)
- Baselines targeted: CI integration 1,615 s / 1,323 s (same runner class); local `statistics.performance` 67 s (n=1, non-fresh DB), release-integrity 14 s

## Objective

- Reduce integration test runtime and fixture/harness overhead without weakening regression coverage, and validate performance with honest measurements (no unbacked savings claims).
- Delivered as: two investigation/evaluation units (U1: P1–P3, U2: P4–P6 — no code), then implementation of the user-approved canonical proposal set P1–P4 plus a three-round review-fix loop. P5 declined by the user; P6 shortcuts declined with documented, code-cited rationale.

## Implementation Summary

- Investigation/evaluation (no code):
  - U1 evaluated P1–P3. Baselines: `test/statistics.performance.integration.test.ts` 67 s local (n=1, non-fresh DB); release-integrity 14 s. Boundary inventory covering cursor ties, N=50 boundaries, planner checks, trigger semantics, isolation, double-restore.
  - U2 evaluated P4–P6. DB_URL discovery memoized per module ≈0.59 s/file (≈70 s local upper bound; CI unmeasured). Consolidation candidates audited — declined (see Key Decisions).
  - Canonical proposal set P1–P6 taken from the Linear issue body (original numbered proposal text unrecoverable; user-approved as canonical on 2026-11-10).
- P1 — statistics bulk history (`d41343b`):
  - `test/statistics.performance.integration.test.ts`: the 150-iteration real-confirmation loop replaced with atomic bulk inserts performed in real lifecycle order — guard triggers live throughout, no `session_replication_role` bypass — plus one `rebuild_statistics` per kit and `ANALYZE`.
  - Scale kept: 4 kits / 150 groups / same volume distributions; 2 real confirmations per kit retained as the regression anchor.
  - New helper `test/helpers/statistics-bulk-history-fixtures.ts`; golden bulk-vs-real equivalence test; rollback + cleanup tests.
  - Measured: 64.7 s (test 1 alone under baseline conditions) → 18.5 s for the whole file (n=1, non-fresh DB — not like-for-like; honestly labeled).
- P2 — release restore rehearsal single-dump (`2bc3df3`):
  - `scripts/release-backup-restore.mjs`: ONE dump + filtered TOC taken before the destination loop — the code previously performed 2 dumps, correcting the historical "dump + 2 restores" summary; both runs restore identical artifacts; `dumpMs` split from `restoreMs`; `dumpSha256` identical across runs (documented).
  - New flow tests incl. dump-failure (no destination work) and restore-failure (cleanup, run 2 never starts) paths. release-integrity 7/7 pass, 12.6 s vs the 14 s baseline (same conditions class).
- P3 — transactional trigger-state helper (`198e278`):
  - New `test/helpers/trigger-state-sql.ts` `withTriggersDisabled` — one transaction: locks (SHARE ROW EXCLUSIVE, the level `ALTER TABLE … DISABLE TRIGGER` already takes; ACCESS EXCLUSIVE deadlocked M4's event-lock holders — justified deviation), captures `tgenabled`, count-verifies, disables, runs the work, restores the exact original O/A/R/D trigger states; failure rolls back everything.
  - Routed `setCutoff`/`setStarted` (`test/helpers/match-management-fixtures.ts`) and membership history/backdate/`event()` (`test/helpers/ranked-result-fixtures.ts`) through it; `event()` dropped 2→1 DDL transactions. No repo-wide sweep of the ~35 files with inline DDL (scoped application per the U1 verdict).
  - Tests: every trigger state, mixed states, failure rollback, missing trigger, unsafe identifiers.
- P4 — launcher DB-URL handoff (`0b51ea4`):
  - New `scripts/integration-db-url.mjs` (+ `.d.mts`): the launcher resolves the DB URL once per run and hands it to workers via the private `INTEGRATION_SUPABASE_DB_URL` (non-`VITE_`).
  - Strict fail-closed validation: postgres URL, loopback host, port 55322 (tied to `config.toml` by test), database `postgres`, query-string override banned; present-but-empty also fails closed. Secrets redacted from errors — errors name the variable and reason, never the value. Standalone CLI discovery fallback when the variable is absent. `knip.json` +1 ignore line (orchestrator direct fast-path).
- Review fixes R1–R9 (`a3c22c7`):
  - Launcher aborts fail-closed on an invalid resolved URL (exit 2 before children spawn), incl. the empty-string case; CLI-failure keeps the children-discovery fallback behavior.
  - Restore rehearsal artifacts moved to invocation-owned `/tmp/release-rehearsal-<uuid>.*` paths with `finally` cleanup on success AND failure; the original error is preserved; cleanup failures are reported to the visible default sink (`[release-rehearsal]` prefix on `console.error`).
  - Golden bulk-vs-real test captures real-command projections BEFORE `rebuild_statistics` — an independent oracle that cannot be derived from the bulk path it validates.
  - Trigger-state tests use test-owned scratch tables (production trigger states are never mutated); rollback proof for every state O/A/R/D plus a deferred-constraint case (`55006 pending-trigger-events` documented as a helper limitation, not silently swallowed).
  - Savings claims removed from comments — measurements live in the ledger, not in code.
- Review loop: full code review → R1–R6; fix round 1; delta review → R7 (major: empty-string DB_URL slipped to worker discovery) + R8; fix round 2; delta review r2 → R7 verified clean, R8 incomplete → R9 (default logger swallowed cleanup warnings); fix round 3. Final state: R1–R9 all fixed with evidence in `docs/plan/PAF-174-findings.md`.

## Files Changed

Scripts (4 changed + declaration files):

- `scripts/integration-db-url.mjs` + `scripts/integration-db-url.d.mts` (new) — launcher DB-URL resolution, fail-closed validation, secret redaction
- `scripts/run-integration.mjs` + `scripts/run-integration.d.mts` — launcher resolves once, hands URL to workers
- `scripts/release-backup-restore.mjs` — single-dump restore rehearsal
- `scripts/release-rehearsal-lib.mjs` + `scripts/release-rehearsal-lib.d.mts` — invocation-owned artifact paths + cleanup reporting

Test helpers (2 new + 2 changed):

- `test/helpers/statistics-bulk-history-fixtures.ts` (new) — bulk history inserts in real lifecycle order
- `test/helpers/trigger-state-sql.ts` (new) — `withTriggersDisabled` transactional trigger-state helper
- `test/helpers/match-management-fixtures.ts` — `setCutoff`/`setStarted` routed through `withTriggersDisabled`
- `test/helpers/ranked-result-fixtures.ts` — membership history/backdate/`event()` routed through `withTriggersDisabled`; `event()` 2→1 DDL transactions

Tests:

- `test/statistics.performance.integration.test.ts` — bulk-history rewrite + golden equivalence + rollback/cleanup tests (P1)
- `test/integration-execution.test.ts`, `test/result-repair-scheduler-setup.test.ts`, `test/release-rehearsal.scripts.test.ts`, `test/release-rehearsal-retry.test.ts`, `test/sql-transport-database-url.test.ts` — launcher/rehearsal contract tests
- New helper integration test suites — statistics bulk fixtures; trigger-state-sql (states, rollback proofs, scratch tables)
- `release-integrity` and `matches.results.notifications` integration suites — no code change (their savings came from script/helper-level work)

Config:

- `knip.json` — +1 ignore line (orchestrator direct fast-path)

Explicitly untouched: `src/**`, `supabase/migrations`, `package.json`/dependencies, UI files, coverage thresholds.

## Key Decisions

- Canonical proposal set P1–P6 taken from the issue body (original numbered text unrecoverable); user-approved as canonical on 2026-11-10.
- P4 env-var handoff approved (`INTEGRATION_SUPABASE_DB_URL`, non-`VITE_`): strict fail-closed validation with secret redaction — a leaked connection string must never surface in logs or errors (proved live: wrong-password check, password absent from output).
- P5 consolidation declined by the user; recorded in the issue and findings ledger.
- P6 shortcuts declined with verified code citations — they would weaken the regression surface the suites exist to guard.
- Shared-DB resets approved for `complete-check` runs (sanctioned dev-data wipes).
- P1 keeps guard triggers live during bulk inserts and refuses a `session_replication_role` bypass — speed must not change trigger semantics; the golden bulk-vs-real equivalence test is the oracle, and (post-R-fix) captures real-command projections BEFORE `rebuild_statistics` so it stays independent of the code under test.
- P2 correctness first: the rehearsal previously dumped twice, not "dump + 2 restores" as historically summarized — both destinations now restore byte-identical artifacts (`dumpSha256` identical across runs, documented).
- P3 lock level is SHARE ROW EXCLUSIVE — exactly what `ALTER TABLE … DISABLE TRIGGER` takes; ACCESS EXCLUSIVE deadlocked M4's event-lock holders (justified deviation). Exact O/A/R/D restore per trigger; no repo-wide sweep of ~35 inline-DDL files (U1 verdict: scoped application only).
- Trigger-state tests own their scratch tables — production trigger states are never mutated by tests.
- Honesty policy: every measurement claim carries its conditions (n=1, non-fresh DB, not like-for-like where true); savings claims removed from code comments; CI comparisons deferred to the PR's CI run.

## Validation Performed

- Per-unit fast gates green: typecheck/lint/format + affected suites, each run once (single-run policy held throughout).
- Pre-commit hooks green on all 5 commits.
- Measurements (honest conditions attached):
  - statistics.performance: 64.7 s (test 1 alone, baseline conditions) → 18.5 s whole file (n=1, non-fresh DB — not like-for-like).
  - release-integrity: 7/7 pass, 12.6 s vs the 14 s baseline (same conditions class).
  - DB_URL discovery: memoized ≈0.59 s/file, ≈70 s local upper bound; CI unmeasured.
- Secret redaction proved live: wrong-password connection attempt — password absent from all output.
- Review loop R1–R9 all fixed with ledger evidence (`docs/plan/PAF-174-findings.md`); delta r3 for R9 verified directly by the orchestrator (spy test proves no-logger emission + preserved original-error semantics; suite 32/32 green).
- Two sanctioned failure→fix→rerun-once pairs (single-run policy exceptions): U5 lock-level timeout; U4 stale test stubs.
- Full `pnpm complete-check` scheduled post-log on the final state (user-approved shared-DB wipes). Final comparable CI numbers come from the PR's CI run vs the 1,615 s / 1,323 s baseline (same runner class).

## Risks and Follow-ups

- None approved.
- P5/P6 declines recorded in the Linear issue + findings ledger — do not re-lift without a new user decision.
- `withTriggersDisabled` documented limitation: work that leaves deferred trigger events pending (SQLSTATE `55006 pending-trigger-events`) is unsupported — such work needs its own transaction shape.
- Local measurements carry n=1 / non-fresh-DB conditions — the comparable performance proof is the PR's CI run vs the 1,615 s / 1,323 s baseline (same runner class), pending at log time.
- Full `pnpm complete-check` on the final state runs post-log (scheduled; user-approved shared-DB wipes).

## Relations

- Linear issue: PAF-174 (PadelFriend team)
- Related docs: `docs/plan/PAF-174-findings.md` (R1–R9 ledger), `docs/plan/PAF-174-bundle.md`, `docs/plan/Plan PAF-174 Reduce integration test runtime without weakening coverage.md`
- Related prior work: PAF-109 (persistent SQL transport + test-runtime investigation), PAF-157 (CI topology, gate structure, timing-evidence pattern)
