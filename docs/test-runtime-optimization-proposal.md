# PAF-109: Test Runtime Optimization Proposal

## Executive summary

This delivery is investigation-only. No application, test, configuration, or CI code changed. Seven future implementation issues, PAF-111 through PAF-117, were created as Linear children in Backlog and linked in a sequential blocked-by chain. All implementation remains pending explicit user approval.

The measured local unit and integration phases completed in **541.22 seconds (9m01s)**: unit **30.06s** and integration **511.16s**. The CI reference reports `pnpm test` at **23m07s**, including **88.55s** unit and **1,292.99s** integration; E2E took **11m40s** and the full job **39m33s**. Local counts total **1,599 cases** across 149 files, with no failures or skips. The local integration phase is about **2.5× faster** than CI, making repeatable measurement and transport overhead the first priorities—not assumed speedups.

The proposal preserves every current regression guard. It recommends bounded SQL transport, fixture batching, phase separation, deterministic cleanup, carefully proven parallelism, and isolated CI jobs. The proposed five-minute local and eight-minute CI `pnpm test` budgets remain unvalidated targets, not commitments.

## Measurement provenance

- **Measured revision:** `1d6c5d1f4a50747ff5f0447184accc2291a5c67a` (the `origin/main` tip used for the baseline).
- **Environment:** Node v26.11.1; pnpm 12.13.0; macOS 27.0.1 (Darwin arm64).
- **Capture time:** 2026-10-28T01:45:57+01:00.
- **Evidence:** raw `unit.json`, `integration.json`, `analysis.json`, `provenance.json`, and reporter/stdout/stderr logs were captured in an ephemeral directory outside the repository. Artifacts are machine-local and intentionally not committed.

The Vitest JSON outputs can be reproduced by substituting an absolute, out-of-repository path for `<evidence-dir>` in these commands:

```sh
pnpm exec vitest run --config vitest.unit.config.ts --coverage --reporter=default --reporter=json --outputFile=<evidence-dir>/unit.json
pnpm exec vitest run --config vitest.integration.config.ts --reporter=default --reporter=json --outputFile=<evidence-dir>/integration.json
```

The first command includes the existing unit coverage collection. The second uses the integration configuration and existing serial scheduling. Captured JSON and logs are evidence from this revision and environment; they are not a committed benchmark fixture.

## Baseline results (local, this revision)

| Phase        |           Wall time |   Files |     Tests | Failures | Skips |
| ------------ | ------------------: | ------: | --------: | -------: | ----: |
| Unit         |              30.06s |     111 |     1,324 |        0 |     0 |
| Integration  |             511.16s |      38 |       275 |        0 |     0 |
| **Combined** | **541.22s (9m01s)** | **149** | **1,599** |    **0** | **0** |

The local case total reconciles exactly with the 1,599-case CI baseline (1,324 unit + 275 integration). E2E cases are outside this count and outside the `pnpm test` budget discussed below.

**Slowest unit files** (Vitest-reported duration; milliseconds):

| Rank | File                           | Duration (ms) |
| ---: | ------------------------------ | ------------: |
|    1 | `matches.registration.model`   |      26,931.9 |
|    2 | `matches.create`               |      14,691.9 |
|    3 | `community.admin-ui`           |      14,238.7 |
|    4 | `lint-staged`                  |       7,847.2 |
|    5 | `community.onboarding`         |       5,273.7 |
|    6 | `matches.management.organizer` |       3,402.3 |
|    7 | `matches.results.page`         |       3,172.1 |
|    8 | `matches.management.edit`      |       3,147.5 |
|    9 | `auth.account-signup`          |       1,816.4 |
|   10 | `matches.detail`               |       1,802.8 |

**Slowest integration files** (Vitest-reported duration; milliseconds):

| Rank | File                              | Duration (ms) |
| ---: | --------------------------------- | ------------: |
|    1 | `matches.registration.cutoff`     |      59,947.4 |
|    2 | `matches.results.submission`      |      42,957.1 |
|    3 | `matches.management.protection`   |      42,332.9 |
|    4 | `matches.registration.fifo`       |      39,378.8 |
|    5 | `matches.management.edits`        |      38,772.8 |
|    6 | `matches.invitations`             |      36,915.7 |
|    7 | `matches.reconfirmation`          |    33,036.978 |
|    8 | `community`                       |      32,332.9 |
|    9 | `matches.registration.actions`    |      21,200.0 |
|   10 | `matches.management.cancellation` |      20,567.0 |

**Slowest individual tests** (Vitest-reported duration; milliseconds):

| Rank | Phase       | Test / case                                                               | Duration (ms) |
| ---: | ----------- | ------------------------------------------------------------------------- | ------------: |
|    1 | Unit        | `matches.registration.model` — “splits roster across N=0..13 like oracle” |      22,080.3 |
|    2 | Integration | `results.submission` — timezone boundary                                  |      11,555.8 |
|    3 | Integration | FIFO acceptance-time ordering                                             |      11,018.7 |
|    4 | Integration | Cutoff seeds actors                                                       |      10,073.6 |
|    5 | Integration | Cutoff overdue batch                                                      |       8,716.4 |
|    6 | Integration | Community 4,097-byte RPC                                                  |       8,433.7 |
|    7 | Integration | Community JSONB oracle                                                    |       7,071.5 |
|    8 | Integration | Edits atomic rejection                                                    |       7,035.0 |
|    9 | Integration | Protection cancellation race                                              |     6,735.991 |
|   10 | Integration | Discovery badge classification                                            |       6,211.9 |

File and test rankings identify measurement hotspots, not safe deletion candidates. Their assertions and case identities remain in scope.

## CI comparison

CI run **40183330593** reports `pnpm test` at **23m07s** (unit **88.55s**, integration **1,292.99s**), E2E at **11m40s**, and full job duration **39m33s**. Earlier references: run **40175101447** reports unit **72.78s** and integration **1,216.62s**; run **39952746319** reports **19m14s** total.

CI integration per-file leaders:

| Rank | Suite              | Duration (s) |
| ---: | ------------------ | -----------: |
|    1 | Cutoff             |       164.48 |
|    2 | Results submission |       123.14 |
|    3 | Protection         |       121.84 |
|    4 | Edits              |        98.88 |
|    5 | Invitations        |        97.86 |
|    6 | FIFO               |        96.74 |
|    7 | Reconfirmation     |        88.89 |

The top ten CI integration files account for **75.7%** of integration duration. The local integration phase takes 511.16s versus 1,292.99s in CI: CI is about **2.53× slower** on this comparison. Local-only tuning would therefore understate CI gains, especially for per-call transport costs that consume a larger share on slower runners.

A transport microbenchmark measured roughly **275–282ms median** for a trivial `SELECT` through a per-call `pnpm exec supabase db query` process, versus **0.57ms** over a warm persistent connection. This is an isolated microbenchmark, not a whole-suite estimate or a directly additive saving. The local/CI variance itself supports making repeatable baselines and inventory the first implementation step (PAF-111), before setting budgets.

## Findings

1. **F1 — Routine trusted SQL repeatedly starts CLI processes.** `test/helpers/match-registration-sql.ts` and duplicated test wrappers spawn `pnpm exec supabase db query` for ordinary trusted SQL. The microbenchmark shows substantial per-call setup cost. **Evidence:** helper and wrapper process-spawn paths; transport probe above. **Addresses:** PAF-112.
2. **F2 — Integration file parallelism is globally disabled for real shared-state hazards.** `vitest.integration.config.ts` sets `fileParallelism: false` because suites share PostgreSQL and can deadlock. Global due queues, relation locks, and fixed-name SQL objects also make unconstrained parallelism unsafe. **Evidence:** integration config and lock/queue/fixed-object suites. **Addresses:** PAF-116.
3. **F3 — The unit phase contains two non-unit costs.** `matches.registration.model.test.ts` uses real signup and SQL (66.12s in CI); `community.admin-extraction.test.ts` runs `pnpm build` in `beforeAll` (13.89s in CI). These are phase-placement or artifact-sharing candidates, not contracts to remove. **Evidence:** those tests and CI timings. **Addresses:** PAF-114.
4. **F4 — Local fixture residue is material.** The measured local database contained approximately 11,400 auth users and 4,363 communities; `community.integration.test.ts` cleanup clears only its mock client. Local residue differs from a fresh CI database and can affect repeatability. **Evidence:** local fixture counts and suite cleanup path. **Addresses:** PAF-115.
5. **F5 — Trigger-changing DDL emits `pgrst_ddl_watch` notifications.** Local statistics showed 8,762 schema-introspection executions, about 214s cumulative. The isolated wall-time delta attributable to this work is unmeasured; cumulative execution time is not removable wall time. **Evidence:** local query statistics and trigger-changing DDL paths. **Addresses:** PAF-115.
6. **F6 — Failure tails can amplify wait and teardown costs.** Existing timeout overrides reach 120s/240s, helper deadlines reach 30s, and a timed-out HTTP `Promise.race` does not itself cancel the underlying request. `pg_sleep(900)` appears in intentional retained-lock barriers that are terminated early; it is not an unconditional 900-second sleep. Successful CI teardown adds about 4s only. **Evidence:** helper deadlines, HTTP timeout paths, and retained-lock barrier tests. **Addresses:** PAF-112 and PAF-116.
7. **F7 — A monolithic CI job delays phase-level feedback.** Unit, integration, E2E, and build/artifact work are not independently surfaced as isolated required jobs. **Evidence:** `.github/workflows/ci.yml` job structure and the phase timings above. **Addresses:** PAF-117.

## Proposed implementation roadmap

The seven Linear children are ordered sequentially by their blocked-by links. Each is future implementation work and remains approval-gated.

### PAF-111 — Capture reproducible runtime baselines and test inventory

**Scope:** Establish repeatable local and CI measurements, provenance, per-file/per-test timing, and a stable inventory before tuning. **Acceptance:** Capture exact revision, environment, command, coverage, DB state, outcome and duration; reconcile collected file and expanded-case identities against the 149-file/1,599-case baseline, explain every delta, and compare repeated runs on equivalent conditions. **Preserved guards:** No test removal, skip, threshold change, or change to assertion scope; distinguish wall time from summed case/file time. **Dependency:** none.

### PAF-112 — Replace routine trusted-SQL CLI spawning with bounded persistent transport

**Scope:** Replace per-call CLI startup for routine trusted SQL with the simplest safe persistent transport, while keeping CLI use where the CLI itself is under test. **Acceptance:** Prove result/error framing, session-state reset, failed-connection discard, bounded timeout, cancellation, rollback, and no leaked process/connection; compare like-for-like transport measurements. **Preserved guards:** Keep migration CLI and process-tree contract tests; retain independent sessions for lock holders, contenders, and probes; add fault injection for rollback and timeout. **Dependency:** PAF-111.

### PAF-113 — Batch fixtures and snapshots without weakening assertion boundaries

**Scope:** Batch setup and read snapshots only within equivalent fixture and transaction boundaries; reuse immutable actor identities only when mutable auth/session/RLS state remains isolated. **Acceptance:** Produce a case-identity relocation map against the 1,599-case inventory before moving or batching any cases; show unchanged outcomes and preserve intermediate-state, commit-visibility, lock, FIFO, and notification assertions. **Preserved guards:** Keep real signup/auth lifecycle coverage and authenticated API/RLS checks; do not batch across an assertion boundary or infer safe shared actors from UUID uniqueness. **Dependency:** PAF-112.

### PAF-114 — Separate unit, integration, and fresh-build artifact contracts

**Scope:** Move real signup/SQL tests to the appropriate mandatory phase and make production build/extraction checks explicit; share a build only when freshness is proven. **Acceptance:** Every phase remains mandatory in `pnpm test`, `pnpm complete-check`, and CI; any shared artifact carries revision/input/environment provenance, rejects stale output, and demonstrates fresh-build equivalence. **Preserved guards:** Retain signup behavior, SQL assertions, coverage scope and thresholds, server/client extraction checks, and fresh-artifact/stale-artifact negatives. **Dependency:** PAF-113.

### PAF-115 — Make fixture cleanup deterministic and reduce avoidable trigger DDL safely

**Scope:** Add per-run namespaced deterministic cleanup, including failure paths and residue checks; reduce trigger-changing DDL only where equivalent invariants are proved. **Acceptance:** Verify cleanup order/FK handling, restoration in `finally`, residue and leaked-session assertions after success and failure, and measured isolated DDL impact before changing DDL frequency. **Preserved guards:** Keep DDL fault-injection, rollback, and notification behavior. Never reset a developer database without explicit permission; any reset requires a disposable, explicitly owned stack. **Dependency:** PAF-114.

### PAF-116 — Parallelize only proven-isolated integration workloads

**Scope:** Parallelize only suites with demonstrated data, lock, and ordering isolation; retain serial scheduling for global queues, trigger/DDL-sensitive work, and fixed-name objects. **Acceptance:** Repeated overlap and ordering proofs show unchanged outcomes, no cross-suite interference, and complete cleanup. Use disposable Supabase stacks or CI shards if shared-stack isolation cannot be proved. **Preserved guards:** Keep actual independent-session concurrency, cancellation, FIFO, and overlap assertions; do not assume UUIDs alone establish isolation. Serial execution remains the rollback baseline. **Dependency:** PAF-115.

### PAF-117 — Split CI into isolated mandatory test jobs with aggregate gate

**Scope:** Separate unit, integration, E2E, and artifact ownership into isolated required jobs while retaining one aggregate required gate. **Acceptance:** The aggregate fails on any required-job failure, cancellation, or unexpected skip; prove service/build/port isolation and verify required-check branch protection before replacing the existing gate. **Preserved guards:** Keep all test phases, coverage, migration/type checks, artifact evidence, and fresh-preview E2E assertions. Do not run mutation-heavy suites concurrently with unrelated E2E against shared DB or `dist`. **Dependency:** PAF-116.

## Budget assessment

The initial proposed target—`pnpm test` at **≤5 minutes locally** and **≤8 minutes in CI**—is assessed against the measured baseline, not promised.

- **Local:** 541.22s (9m01s) to 300s requires about a **45%** reduction. Unit already takes 30.06s; integration must fall from 511.16s to roughly **270s**. That appears plausible only if transport replacement, boundary-safe fixture batching, and targeted proven parallelism materially reduce integration time. PAF-114 may remove duplicate build work only with fresh-artifact proof.
- **CI:** 23m07s to 8m requires about a **65%** reduction. Integration takes 1,292.99s and would need to reach roughly **380s** (or lower, depending on command overhead and the unit phase). Per-call transport overhead and slower CI runners make transport replacement the dominant proposed lever, but its end-to-end effect is unmeasured.
- **Measurement gate:** Tune budgets from repeated comparable runs through PAF-111 before adopting thresholds. A single local or CI run does not establish a stable budget.
- **Scope:** E2E's 11m40s CI duration is outside the `pnpm test` budget. PAF-117's parallel jobs can improve wall-clock feedback without reducing total compute.

## Guard-preservation matrix

| Guard                      | Step that could threaten it        | Preserved how                                                                                                                 |
| -------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Authenticated API behavior | PAF-113, PAF-114, PAF-116          | Keep real authenticated API calls and existing behavior assertions; phase moves do not replace calls with mocks.              |
| RLS/permission checks      | PAF-112, PAF-113, PAF-115, PAF-116 | Keep policy-backed requests under distinct actor/role state; do not substitute direct SQL for API authorization assertions.   |
| Real signup paths          | PAF-113, PAF-114                   | Keep real signup/auth lifecycle contracts mandatory; move phase only, never mock or skip the path.                            |
| Migration CLI contracts    | PAF-112, PAF-114                   | Retain CLI-specific migration invocation, exit/error, and output contracts even when routine SQL uses persistent transport.   |
| CLI process-tree contracts | PAF-112, PAF-116                   | Keep spawned-process/process-group, termination, and teardown tests for concurrency and cancellation scenarios.               |
| Concurrency overlap proofs | PAF-112, PAF-116                   | Use genuinely independent sessions for holder, contender, and probe; assert observed overlap/order, not just task scheduling. |
| Explicit cancellation      | PAF-112, PAF-116                   | Bound queries and HTTP with real cancellation; assert request/process termination, rollback, and cleanup after timeout.       |
| Backend leak assertions    | PAF-112, PAF-115, PAF-116          | Check sessions, child processes, fixture residue, and cleanup on both success and injected failure.                           |
| Coverage thresholds        | PAF-114, PAF-117                   | Preserve existing coverage scope and thresholds in each required phase/job; make no threshold reductions.                     |
| E2E assertions             | PAF-117                            | Keep E2E cases and fresh-preview validation unchanged; isolate scheduling rather than weakening assertions.                   |
| Build-extraction contracts | PAF-114                            | Keep server/client extraction and stale-artifact negatives; shared output requires provenance and freshness validation.       |
| Local-only DB safety       | PAF-112, PAF-115, PAF-116          | Retain local-target safeguards, use scoped namespaces, and never reset a developer DB without explicit permission.            |

## Non-goals / invariants for this delivery

- No repository code changed; this proposal is the only new repository file in this delivery.
- No test was removed, skipped, or modified. No coverage threshold or CI behavior changed.
- The PAF-111–PAF-117 children remain in Backlog pending user approval; no child status moved to active or complete.
- Case relocation/split mapping for the 1,599 tests belongs in PAF-114, against the PAF-111 inventory snapshot—not in this investigation document.
- No developer database reset, source instrumentation, benchmark harness, dependency, or committed machine-local evidence was added.

## Risks & open questions

- **Local/CI variance:** The 2.5× integration gap makes one-run targets unreliable. PAF-111 must define repeated, comparable measurements before budgets are accepted.
- **Trigger DDL attribution:** The 8,762 introspection executions and ~214s cumulative time do not establish removable wall time. Measure isolated deltas before reducing DDL.
- **Persistent transport:** Confirm safe session reset, cancellation, rollback, and discard of failed connections; independent concurrent sessions must remain available for overlap proofs.
- **Parallelization cost:** Proven isolation may require disposable Supabase stacks or CI shards, increasing CI resource cost. Retain serial scheduling as rollback.
- **Fixture differences:** Local residue (about 11,400 auth users and 4,363 communities) differs from a fresh CI stack; do not compare runs as clean baselines without recording DB state.
- **Open Vite handles:** Both phase runs showed non-failing Vitest 2s close-timeout warnings. Treat as cosmetic evidence for now; PAF-114 should verify server lifecycle and artifact freshness.

## Approval gate

Implementation starts only after explicit user approval of this proposal. Execute PAF-111 through PAF-117 sequentially according to the Linear blocked-by chain; do not start a downstream child before its dependency is complete and reviewed. The current delivery establishes findings and guard-preserving scope only.
