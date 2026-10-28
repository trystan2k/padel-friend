---
title: PAF-109 Reduce test runtime without weakening regression guards
type: development-log
permalink: docs/development-logs/task-PAF-109-reduce-test-runtime-without-weakening-regression-guards
---

# Development Log: PAF-109

## Metadata

- Task ID: PAF-109 — "Reduce test runtime without weakening regression guards"
- Date (UTC): 2026-10-28
- Project: padel-friend
- Branch: `feature/PAF-109-reduce-test-runtime` (from `origin/main` @ `1d6c5d1`)
- Commits:
  - `064a939` — `docs: add test runtime optimization investigation proposal` (proposal doc only)
  - `9db5b6f` — `docs: address review findings` (durable evidence, DAG-consistent dependencies, traceable guard matrix, case-mapping ownership clarification)
  - `bc58108` — `test: replace per-call SQL CLI spawning with persistent PostgreSQL transport` (PAF-112 delivery; 24 files, +1064/−745; new `test/helpers/sql-transport.ts` + `test/helpers/sql-transport.integration.test.ts`; migrated 20+ suites)
  - `bdc45b2` — `fix: harden test SQL transport connection guards` (PAF-112 review-round fixes F6–F9)
  - `4928fcd` — PAF-113 delivery: `executeTrustedSqlBatch` transport API (ordered, per-statement checks, indexed errors) + snapshot reads + community membership batching (wall-time neutral, honestly reported)
  - `a4b95c6` — PAF-114 delivery: 6 cases relocated unit→integration with byte-identical assertions; coverage thresholds untouched
  - `e2fb458` — PAF-115 delivery: `fixture-cleanup.ts` deterministic cleanup + residue/leak assertions; DDL reduction declined
  - `66da7b2` — PAF-116 delivery: 42-file isolation audit (41 serial-mandatory); serial retained via one-line rollback switch + `SQL_TRANSPORT_POOL_MAX` env
  - `f9f05db` — PAF-117 delivery: CI split into isolated checks/unit/integration/e2e jobs + aggregate `gate` job
  - `0342d73` — `fix: harden cleanup trigger restoration and CI cutover` (units 113–117 review rounds 5–7, fixes F13–F19)
  - `16c1ed8` — `chore: split complete-check stages across pre-commit and pre-push hooks` (DX delivery: complete-check `--only` stage flags, static checks → pre-commit, tests-only pre-push, E2E in final gate/CI, `test:changed`; orchestrator/gate docs corrected F20)
  - Pending final sweep (uncommitted at log time): `docs/plan/Plan PAF-109 …md` (plan file), `docs/plan/PAF-109-findings.md` (findings ledger), `docs/plan/PAF-109-bundle.md` (bundle), `docs/plan/PAF-109-evidence/**` (durable evidence), this development log — per workflow policy. Do not commit the log inside the delivery; final sweep commits it.
- Related Linear: PAF-109 (In Progress, comment `comment-66858ef7`) with child sub-issues PAF-111…PAF-117 (project PadelFriend); PAF-111 + PAF-112 moved In Progress (statuses → In Review at PR); PAF-113…PAF-117 delivered and moved In Progress (statuses → In Review at PR)
- Scope decision (PAF-109 investigation): investigation + proposed implementation ONLY — no repository product/test/CI code changed (explicit user decision). PR pending (docs-only).
- Scope update (PAF-111/PAF-112 delivery): after explicit user approval of the proposal, roadmap step 2 was implemented — bounded persistent PostgreSQL transport replacing per-call `pnpm exec supabase db query` spawning for routine trusted SQL in tests. User-approved scope expansion (investigation was docs-only).

## Objective

- Reduce the `pnpm test` runtime without weakening regression guards. Delivered in this task as: (1) a Linear breakdown into 7 executable child sub-issues with a dependency DAG, (2) a machine-readable local baseline measurement at the delivery revision, (3) an evidence-backed optimization proposal document, and (4) a Linear issue update. The investigation delivery itself was docs-only — implementation awaited explicit user approval of the proposal (approval gate section in the doc).
- PAF-112 implementation delivery (added after user approval of the proposal — approved scope expansion beyond the docs-only investigation): roadmap step 2 implemented — per-call `pnpm exec supabase db query` spawning replaced with a bounded persistent PostgreSQL transport for routine trusted SQL in tests (commits `bc58108`, `bdc45b2`), cutting the combined local `pnpm test` runtime from 541.22s to ≈121.6s (−78%) with zero tests removed or skipped.

## Implementation Summary

- Linear breakdown (children PAF-111…PAF-117), each with objective, guards, acceptance criteria, dependency footer, and rollback line:
  - PAF-111 baseline measurement (repeated runs, statistical grounding)
  - PAF-112 persistent PostgreSQL transport for routine trusted SQL (replaces per-call CLI spawn)
  - PAF-113 fixture batching
  - PAF-114 phase separation (unit/integration isolation)
  - PAF-115 deterministic cleanup + fixture-residue assertions
  - PAF-116 proven-isolated parallelization (joins 114+115)
  - PAF-117 CI job split
  - Dependency DAG (8 edges, verified by read-back): 112←111, 113←112, 114←111 (independent of 112/113), 115←113, 116←{114,115}, 117←116.
- Baseline measurement (local, revision `1d6c5d1`, Node v26.11.1, pnpm 12.13.0, macOS arm64, 2026-10-28T01:45:57+01:00):
  - Unit: 30.06s / 111 files / 1324 tests
  - Integration: 511.16s / 38 files / 275 tests
  - Combined: 541.22s (~9m01s), 0 fail / 0 skip
  - Counts reconcile exactly with the CI 1599-case baseline (1324 + 275)
  - CI comparison (run 40183330593): `pnpm test` 23m07s (unit 88.55s, integration 1292.99s) → local integration ~2.53× faster than CI
  - Slowest local integration files: cutoff 59.9s, results.submission 43.0s, protection 42.3s, fifo 39.4s
  - Slowest single test: matches.registration.model oracle 22.08s (unit phase)
  - Raw vitest reporter JSONs kept ephemeral; curated durable evidence committed instead.
- Proposal document `docs/test-runtime-optimization-proposal.md` — 11 sections: executive summary, measurement provenance, baseline results (top-10 tables), CI comparison, findings F1–F7, roadmap PAF-111…117 with guard matrix, budget assessment, non-goals/invariants, risks, approval gate.
  - Findings F1–F7: (F1) CLI spawn per SQL call; (F2) global file parallelism disabled; (F3) unit-phase violations — real signup+SQL 66.12s CI and `pnpm build` 13.89s CI executing in the unit phase; (F4) fixture residue ~11,400 auth users / 4,363 communities; (F5) `pgrst_ddl_watch` NOTIFY amplification unmeasured; (F6) failure-tail amplifiers; (F7) monolithic CI test job.
  - Guard matrix: source path + owner + proof + rollback per roadmap row, traceable to the DAG.
  - Budget assessment (hypotheses to validate, not promises): ≤5min local needs ~45% cut; ≤8min CI needs ~65%.
- Linear issue update: comment on PAF-109 with proposal summary + roadmap (`comment-66858ef7`); state set to In Progress.
- PAF-112 delivery (roadmap step 2 — persistent PostgreSQL transport, commits `bc58108` + `bdc45b2`):
  - Transport module `test/helpers/sql-transport.ts`: bounded Pool (max + acquire timeout), per-query statement timeout (30s default), loopback-only guard via effective-host parse (pg-connection-string) at a single choke point, session hygiene on pooled reuse, CLI-compatible error contract (SQLSTATE/message/detail; temporal precision without JS Date microsecond loss), explicit cancellation, pool error containment, dedicated never-pooled clients for the concurrency holder/probe/contender with distinct `pg_backend_pid()`.
  - Migrated 20+ suites from per-call CLI spawning. Preserved CLI contracts where the CLI process itself is under test: CLI process-tree tests (community.admin) and migration CLI harnesses (matches.registration.domain-migration, matches.results.schema migration calls) stay on the CLI.
  - New integration suite `test/helpers/sql-transport.integration.test.ts`: 4 fault-injection tests (timeout→discard, cancellation, failed-connection self-heal, session hygiene) plus temporal-format, error-contract, termination-regression, loopback-override negative, timeout-reset sequential, and connection-failure/unhandled-rejection regression tests. Integration tests 275→282 (additions only; none removed or skipped).
  - Measured (verified green at the pre-hardening commit; final gate re-verifies): unit 30.06s→14.44s (111 files/1324 tests); integration 511.16s→107.12s (39 files/282 tests); combined `pnpm test` ≈121.6s vs 541.22s baseline (−78%). Top files: cutoff 59.9→2.96s, results.submission 43.0→3.47s, protection 42.3→3.32s, fifo 39.4→2.55s, edits 38.8→7.1s, invitations 36.9→10.4s.
  - Fix iterations during implementation: (1) completed the migration sweep after partial legs; (2) pool error containment for intentional backend termination; (3) temporal precision (microsecond loss made an invalid cutoff valid) + fresh `pg_stat_activity` sampling (stale snapshot hid blocked contenders; proof now requires two distinct blocked backends); (4) review-round fixes F6–F9.
  - Review record: round 3 full parallel review (code + architecture) — request-changes with 4 findings: F6 loopback bypass via `?host=` query param (major, both reviewers), F7 unhandled backendPid rejection (major), F8 timeout persistence (minor), F9 caret-vs-tilde ranges (minor) — all fixed with fail-before/passing-after tests. Round 4 delta review: both reviewers APPROVE, no new findings. F10/F11 recorded as optional observations for PAF-116 planning. (F6–F11 use the PAF-112 delivery findings numbering, distinct from the proposal's investigation findings F1–F7 above.)
  - Final grep: zero (a)-class per-call SQL spawns remain.
  - Linear: PAF-111 + PAF-112 moved In Progress (statuses → In Review at PR).
- PAF-113…PAF-117 delivery (baseline `ca0c277` → `0342d73`):
  - PAF-113 batch API: `executeTrustedSqlBatch` transport API — honest wall-time-neutral (reported as neutral, no claimed speedup).
  - PAF-114 relocation: 6/6 cases relocated unit→integration; unit phase free of signup/SQL/build work; coverage 100% / thresholds 80% untouched.
  - PAF-115 cleanup: namespaced `fixture-cleanup.ts` deterministic cleanup + residue/leak assertions; DDL reduction declined (rationale in Key Decisions).
  - PAF-116 isolation audit: 41/42 files serial-mandatory; parallel proof failed 3/3 runs; serial retained via one-line rollback switch + `SQL_TRANSPORT_POOL_MAX` env knob.
  - PAF-117 CI split: gated CI jobs + aggregate `gate` job; single `CI / gate` swap on the required-check side.
  - Review rounds 5–7: F13–F19 raised and fixed; fix commit `0342d73`. Ledger: F1–F9/F12–F19 fixed; F10/F11/F16 observed.
- DX delivery (`16c1ed8`): complete-check stage flags; static checks → pre-commit, tests-only pre-push, E2E in final gate/CI; `test:changed` tooling; verification ladder documented in AGENTS.md; orchestrator/gate docs corrected (F20).

## Files Changed

Created (committed):

- `docs/test-runtime-optimization-proposal.md`
- `docs/plan/PAF-109-evidence/provenance.json` (measurement provenance)
- `docs/plan/PAF-109-evidence/analysis.json` (analysis/metrics)
- `docs/plan/PAF-109-evidence/unit-cases.jsonl` (complete derived case-level unit data, 1324 lines)
- `docs/plan/PAF-109-evidence/integration-cases.jsonl` (complete derived case-level integration data, 275 lines)

Changed (PAF-112 delivery, committed):

- `test/helpers/sql-transport.ts` (new — bounded persistent PostgreSQL transport for routine trusted SQL)
- `test/helpers/sql-transport.integration.test.ts` (new — fault-injection + contract regression suite)
- 20+ migrated test suites: per-call `pnpm exec supabase db query` spawning → transport (CLI process-tree tests and migration CLI harnesses intentionally untouched)
- Manifest/lockfile — dev dependencies added with `~` ranges per `.npmrc`: `pg@~8.23.1`, `@types/pg@~8.23.1`, `pg-connection-string@~2.14.1` (pg's own parser, same resolved version as pg's transitive dep)
- Totals: `bc58108` = 24 files, +1064/−745; `bdc45b2` = connection-guard hardening fixes

Changed (PAF-113…PAF-117 delivery, committed):

- `4928fcd` — 8 files changed, 289 insertions(+), 30 deletions(-) — PAF-113 delivery: `executeTrustedSqlBatch` transport API (ordered, per-statement checks, indexed errors) + snapshot reads + community membership batching (wall-time neutral, honestly reported)
- `a4b95c6` — 3 files changed, 49 insertions(+) — PAF-114 delivery: 6 cases relocated unit→integration with byte-identical assertions; coverage thresholds untouched
- `e2fb458` — 8 files changed, 734 insertions(+), 51 deletions(-) — PAF-115 delivery: `fixture-cleanup.ts` deterministic cleanup + residue/leak assertions; DDL reduction declined
- `66da7b2` — 3 files changed, 148 insertions(+), 6 deletions(-) — PAF-116 delivery: 42-file isolation audit (41 serial-mandatory); serial retained via one-line rollback switch + `SQL_TRANSPORT_POOL_MAX` env
- `f9f05db` — 1 file changed, 242 insertions(+), 5 deletions(-) — `.github/workflows/ci.yml` — PAF-117 delivery: CI split into isolated checks/unit/integration/e2e jobs + aggregate `gate` job
- `0342d73` — 6 files changed, 180 insertions(+), 32 deletions(-) — `.github/workflows/ci.yml`, `docs/plan/PAF-109-evidence/case-relocation-map.md`, `test/helpers/fixture-cleanup.ts`, `test/helpers/match-registration-sql.ts`, `test/helpers/fixture-cleanup.integration.test.ts`, NEW `test/helpers/match-registration-sql.test.ts` — review rounds 5–7 fixes F13–F19 (`fix: harden cleanup trigger restoration and CI cutover`)

Changed (DX delivery, committed):

- `16c1ed8` — 8 files changed, 190 insertions(+), 11 deletions(-) — `scripts/complete-check.mjs` (`--only=static|test|e2e` + comma groups; no args = all 8 stages, backward compat), `.husky/pre-commit` (lint-staged + static stages, ~12s), `.husky/pre-push` (test stage only, ~3min; E2E removed from local hooks), `package.json` (`test:changed` = vitest `--changed HEAD --passWithNoTests`), NEW `test/complete-check.test.ts` (selection/comma/failure-aggregation/invalid-flag/hook-order), `AGENTS.md` (verification ladder + `test:changed` HEAD anchor caveat), `.opencode/agents/delivery-orchestrator.md`, `.opencode/agents/subagents/git-specialist.md` (pre-push is test-only — full-gate evidence from explicit complete-check or CI, never the hook)

Created (pending final sweep, uncommitted):

- `docs/plan/Plan PAF-109 Reduce test runtime without weakening regression guards.md`
- `docs/plan/PAF-109-findings.md` (review findings ledger: 5/5 fixed)
- `docs/plan/PAF-109-bundle.md`
- `docs/development-logs/Task PAF-109 reduce test runtime without weakening regression guards.md` (this log)

Linear (repo-external):

- Created sub-issues PAF-111…PAF-117 with dependencies; commented and re-state PAF-109

Untouched (by the original docs-only scope; test files later changed by the PAF-112 delivery above):

- Product `src/**`, `supabase/**`, vitest config, coverage config, CI workflows, hooks, scripts — zero code changes in the investigation delivery

## Key Decisions

- Docs-only scope honored (explicit user decision): investigation + proposal only; no repository code changed. Implementation starts only after the user approves the proposal's approval gate.
- Evidence durability: raw vitest reporter JSONs stay ephemeral (with regeneration commands documented); durable evidence = curated `provenance.json` + `analysis.json` plus complete derived case-level JSONL (`unit-cases.jsonl` 1324 lines, `integration-cases.jsonl` 275 lines) with documented derivation and metric notes. Resolved review finding F1 (ephemeral evidence) and later F5 (missing complete case-level data).
- Dependency DAG follows the approved plan, not a naive linear chain: child 4 (PAF-114) is independent of children 2/3; child 6 (PAF-116) joins 4+5. Corrected after review flagged the linear-chain deviation vs plan line 49.
- Budget targets framed as hypotheses to be validated by PAF-111 repeated measurements — explicitly not promised in the proposal.
- E2E runtime (11m40s CI) is explicitly out of the `pnpm test` budget scope.
- PAF-112 scope expansion was explicit and user-approved: the investigation delivery was docs-only; implementation of roadmap step 2 started only after the user approved the proposal.
- Single choke point for the loopback-only guard: effective host parsed with pg-connection-string so all URL forms — including the `?host=` query-param bypass found in review F6 — resolve through one guard.
- Pooled vs dedicated clients: routine trusted SQL uses a bounded Pool; the concurrency holder/probe/contender use dedicated never-pooled clients with distinct `pg_backend_pid()` so blocked-backend proofs stay deterministic.
- CLI-compatible error contract preserved: SQLSTATE/message/detail surfaced identically to the CLI, and timestamps keep microsecond precision (JS Date microsecond loss made an invalid cutoff valid — caught and fixed in iteration 3).
- Intentional backend termination is contained at the pool level so fault-injection tests cannot poison unrelated pooled connections (iteration 2).
- Per-query statement timeout (30s default) applied per query and reset between sequential uses (review F8); timed-out clients are discarded.
- Dependency choice: `pg` + its own parser `pg-connection-string` (same resolved version as pg's transitive dependency) with `~` ranges per `.npmrc` (review F9: caret→tilde).
- Batching reported honestly (PAF-113): the batch API removes per-call overhead but is wall-time-neutral end-to-end — shipped and reported as neutral, not claimed as a speedup.
- DDL reduction declined (PAF-115): reducing schema DDL would weaken the regression surface the suite exists to guard; deterministic cleanup + residue/leak assertions deliver the guarantee without touching the schema.
- Parallelization declined (PAF-116): the parallel proof failed 3/3 runs and 41/42 files proved serial-mandatory — serial execution retained with a one-line rollback switch and `SQL_TRANSPORT_POOL_MAX` as the tunable lever.
- Transition-safe CI cutover (PAF-117, F13/F17): the aggregate `gate` job keeps a single required check across the job split, so the branch-protection cutover (`CI / gate` swap) cannot silently drop a coverage dimension mid-transition.
- Hook rebalance (user-directed): local pre-push no longer runs E2E — compensated by step-9 full gate and CI complete-check; orchestrator contract updated so test-only pre-push never counts as full-gate evidence.

## Validation Performed

- `pnpm typecheck` + `pnpm lint` green at every unit and fix iteration (fast gate).
- Scoped QA pass:
  - Changed-set scope clean vs `origin/main` (docs-only confirmed)
  - Document accuracy audit vs evidence JSONs — zero numeric mismatches
  - Guard invariants verified: no vitest config / coverage threshold / CI workflow / test behavior drift
- Evidence integrity: JSONL line counts + status tallies verified (1324 + 275 lines, all `passed`).
- Review record:
  - Round 1 (full code review): request-changes with 4 required findings — F1 ephemeral evidence, F2 dependency DAG conflict vs approved plan, F3 guard matrix traceability, F4 case-mapping ownership conflict.
  - Fix iteration 1: F2–F4 fixed. Round 2 (delta review): F2–F4 confirmed FIXED; F5 raised (durable evidence lacked complete case-level data).
  - Fix iteration 2: complete derived case-level JSONL added with documented derivation. Findings ledger `docs/plan/PAF-109-findings.md`: 5/5 fixed, zero open/blocked/deferred.
- NOT run in this delivery: full test suite / E2E (docs-only; no test behavior changed). Final `pnpm complete-check` on the reviewed state happens at the pre-push gate.
- PAF-112 delivery validation:
  - `pnpm typecheck` + `pnpm lint` green at every step (implementation and fix iterations).
  - Targeted suites green throughout; full unit + integration run green with exit 0.
  - Final grep confirmed zero (a)-class per-call SQL spawns remain.
  - Integration suite growth 275→282 verified strictly additive (no removals, no skips).
  - Measured timings verified green at the pre-hardening commit; the final `pnpm complete-check` at delivery close re-verifies the hardened state.
- PAF-113…PAF-117 delivery validation:
  - Unit: 110 files / 1319 tests, green.
  - Integration: 42 files / 302 tests, ~141s, green.
  - E2E: 242 passed, green.
  - Additive vs the 1599-case CI baseline: 20 new, 6 relocated, 0 removed.
  - Review fixes F13–F19 verified fail-before/passing-after.
  - Final `pnpm complete-check` ALL GREEN at delivery close.
- DX delivery (`16c1ed8`) validation:
  - Full no-args complete-check ALL GREEN on the DX worktree (8/8 stages, 242 E2E).
  - New pre-commit hook exercised live during commit (static PASS); test counts unit 112/1328, integration 42/302.
  - Review round 8 (code + architecture): request-changes ×2 → F20 (orchestrator docs treated test-only pre-push as full-gate evidence) fixed.

## Risks and Follow-ups

- Implementation NOT started — blocked on explicit user approval of the proposal (approval gate section in `docs/test-runtime-optimization-proposal.md`).
- Budget targets (≤5min local ~45% cut; ≤8min CI ~65%) are hypotheses pending PAF-111 repeated measurements; do not treat as commitments.
- Local-vs-CI 2.53× integration variance means local-only gains understate CI needs; PAF-117 CI work must be sized from CI numbers.
- E2E runtime (11m40s CI) is out of scope for the `pnpm test` budget — a separate follow-up if pursued.
- PR pending (docs-only); final sweep must commit plan file, findings ledger, bundle, evidence dir, and this log.
- F5 (`pgrst_ddl_watch` NOTIFY amplification) remains unmeasured — deferred to baseline/implementation children.
- PAF-112 delivery: local gains do not translate 1:1 to CI — per-call transport overhead hits CI harder, so CI impact measurement is pending the PAF-117 job split or the next CI run.
- F10/F11 recorded as optional observations for PAF-116 planning (non-blocking).
- PAF-113…PAF-117 delivered (fixture batching, phase separation, cleanup, parallelization audit, CI split) — all units delivered, statuses → In Review at PR.
- First PR CI run validates the split workflow and measures the actual CI integration gain from the transport work.
- F10/F11/F16 feed future shard planning.
- DX unit follow-up: post-cutover simplification of the checks job (remove test aggregation) is a deliberate follow-up after branch protection swaps to `CI / gate`.
- Final `pnpm complete-check` runs at delivery close; this log left uncommitted for the final sweep per workflow policy.

## Relations

- Linear issue: PAF-109 (PadelFriend team, In Progress, `comment-66858ef7`)
- Children: PAF-111…PAF-117 (all delivered; In Progress → In Review at PR)
- Related docs: `docs/test-runtime-optimization-proposal.md`, `docs/plan/PAF-109-evidence/**`, `docs/plan/PAF-109-findings.md`
