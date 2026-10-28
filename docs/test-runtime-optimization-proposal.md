# PAF-109: Test Runtime Optimization Proposal

## Executive summary

This delivery is investigation-only. No application, test, configuration, or CI code changed. Seven future implementation issues, PAF-111 through PAF-117, were created as Linear children in Backlog and linked in the approved dependency DAG, not a sequential chain: PAF-114 depends only on PAF-111, while PAF-116 joins PAF-114 and PAF-115. All implementation remains pending explicit user approval.

The measured local unit and integration phases completed in **541.22 seconds (9m01s)**: unit **30.06s** and integration **511.16s**. The CI reference reports `pnpm test` at **23m07s**, including **88.55s** unit and **1,292.99s** integration; E2E took **11m40s** and the full job **39m33s**. Local counts total **1,599 cases** across 149 files, with no failures or skips. The local integration phase is about **2.5× faster** than CI, making repeatable measurement and transport overhead the first priorities—not assumed speedups.

The proposal preserves every current regression guard. It recommends bounded SQL transport, fixture batching, phase separation, deterministic cleanup, carefully proven parallelism, and isolated CI jobs. The proposed five-minute local and eight-minute CI `pnpm test` budgets remain unvalidated targets, not commitments.

## Measurement provenance

- **Measured revision:** `1d6c5d1f4a50747ff5f0447184accc2291a5c67a` (the `origin/main` tip used for the baseline).
- **Environment:** Node v26.11.1; pnpm 12.13.0; macOS 27.0.1 (Darwin arm64).
- **Capture time:** 2026-10-28T01:45:57+01:00.
- **Durable evidence:** Curated provenance and analysis are committed at [`docs/plan/PAF-109-evidence/provenance.json`](plan/PAF-109-evidence/provenance.json) and [`docs/plan/PAF-109-evidence/analysis.json`](plan/PAF-109-evidence/analysis.json). Complete case-level records for all **1,599 cases** are preserved in [`unit-cases.jsonl`](plan/PAF-109-evidence/unit-cases.jsonl) (1,324 cases) and [`integration-cases.jsonl`](plan/PAF-109-evidence/integration-cases.jsonl) (275 cases), including file, full test name, outcome, and duration. Raw `unit.json`, `integration.json`, and reporter/stdout/stderr logs remain ephemeral outside the repository; regeneration commands follow.

Regenerate the full raw Vitest JSON evidence by substituting an absolute, out-of-repository path for `<evidence-dir>` in these commands:

```sh
pnpm exec vitest run --config vitest.unit.config.ts --coverage --reporter=default --reporter=json --outputFile=<evidence-dir>/unit.json
pnpm exec vitest run --config vitest.integration.config.ts --reporter=default --reporter=json --outputFile=<evidence-dir>/integration.json
```

The first command includes existing unit coverage collection. The second uses the integration configuration and existing serial scheduling. Each run writes raw reporter JSON to `<evidence-dir>`; capture stdout/stderr logs outside the repository as needed. Raw run outputs and console logs remain ephemeral; the JSONL files preserve the complete derived case-level baseline, while analysis.json remains the curated summary, not a benchmark fixture.

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

The seven Linear children follow the approved dependency DAG, not a linear chain: PAF-112 depends on PAF-111; PAF-113 depends on PAF-112; PAF-114 independently depends only on PAF-111; PAF-115 depends on PAF-113; PAF-116 depends on both PAF-114 and PAF-115; and PAF-117 depends on PAF-116. Each is future implementation work and remains approval-gated.

### PAF-111 — Capture reproducible runtime baselines and test inventory

**Scope:** Establish repeatable local and CI measurements, provenance, per-file/per-test timing, and a stable inventory before tuning. **Acceptance:** Capture exact revision, environment, command, coverage, DB state, outcome and duration; reconcile collected file and expanded-case identities against the 149-file/1,599-case baseline, explain every delta, and compare repeated runs on equivalent conditions. **Preserved guards:** No test removal, skip, threshold change, or change to assertion scope; distinguish wall time from summed case/file time. **Dependency:** none.

### PAF-112 — Replace routine trusted-SQL CLI spawning with bounded persistent transport

**Scope:** Replace per-call CLI startup for routine trusted SQL with the simplest safe persistent transport, while keeping CLI use where the CLI itself is under test. **Acceptance:** Prove result/error framing, session-state reset, failed-connection discard, bounded timeout, cancellation, rollback, and no leaked process/connection; compare like-for-like transport measurements. **Preserved guards:** Keep migration CLI and process-tree contract tests; retain independent sessions for lock holders, contenders, and probes; add fault injection for rollback and timeout. **Dependency:** PAF-111.

### PAF-113 — Batch fixtures and snapshots without weakening assertion boundaries

**Scope:** Batch setup and read snapshots only within equivalent fixture and transaction boundaries; reuse immutable actor identities only when mutable auth/session/RLS state remains isolated. **Acceptance:** Capture unbatched case identities and outcomes as the pre-batch oracle, then prove each batched statement preserves identical case identities and outcomes before or during batching; preserve intermediate-state, commit-visibility, lock, FIFO, and notification assertions. **Preserved guards:** Keep real signup/auth lifecycle coverage and authenticated API/RLS checks; do not batch across an assertion boundary or infer safe shared actors from UUID uniqueness. PAF-113 owns this pre-batch identity proof, not phase relocation. **Dependency:** PAF-112.

### PAF-114 — Separate unit, integration, and fresh-build artifact contracts

**Scope:** Move real signup/SQL tests to the appropriate mandatory phase and make production build/extraction checks explicit; share a build only when freshness is proven. **Acceptance:** Map every original case identity in the 1,599-case inventory to its destination phase, including unit-to-integration moves, with no unexplained loss or duplication. Every phase remains mandatory in `pnpm test`, `pnpm complete-check`, and CI; any shared artifact carries revision/input/environment provenance, rejects stale output, and demonstrates fresh-build equivalence. **Preserved guards:** Retain signup behavior, SQL assertions, coverage scope and thresholds, server/client extraction checks, and fresh-artifact/stale-artifact negatives. PAF-114 owns this phase-relocation map, independent of PAF-112 and PAF-113. **Dependency:** PAF-111.

### PAF-115 — Make fixture cleanup deterministic and reduce avoidable trigger DDL safely

**Scope:** Add per-run namespaced deterministic cleanup, including failure paths and residue checks; reduce trigger-changing DDL only where equivalent invariants are proved. **Acceptance:** Verify cleanup order/FK handling, restoration in `finally`, residue and leaked-session assertions after success and failure, and measured isolated DDL impact before changing DDL frequency. **Preserved guards:** Keep DDL fault-injection, rollback, and notification behavior. Never reset a developer database without explicit permission; any reset requires a disposable, explicitly owned stack. **Dependency:** PAF-113.

### PAF-116 — Parallelize only proven-isolated integration workloads

**Scope:** Parallelize only suites with demonstrated data, lock, and ordering isolation; retain serial scheduling for global queues, trigger/DDL-sensitive work, and fixed-name objects. **Acceptance:** Repeated overlap and ordering proofs show unchanged outcomes, no cross-suite interference, and complete cleanup. Use disposable Supabase stacks or CI shards if shared-stack isolation cannot be proved. **Preserved guards:** Keep actual independent-session concurrency, cancellation, FIFO, and overlap assertions; do not assume UUIDs alone establish isolation. Serial execution remains the rollback baseline. **Dependency:** PAF-114 and PAF-115.

### PAF-117 — Split CI into isolated mandatory test jobs with aggregate gate

**Scope:** Separate unit, integration, E2E, and artifact ownership into isolated required jobs while retaining one aggregate required gate. **Acceptance:** The aggregate fails on any required-job failure, cancellation, or unexpected skip; prove service/build/port isolation and verify required-check branch protection before replacing the existing gate. **Preserved guards:** Keep all test phases, coverage, migration/type checks, artifact evidence, and fresh-preview E2E assertions. Do not run mutation-heavy suites concurrently with unrelated E2E against shared DB or `dist`. **Dependency:** PAF-116.

## Budget assessment

The initial proposed target—`pnpm test` at **≤5 minutes locally** and **≤8 minutes in CI**—is assessed against the measured baseline, not promised.

- **Local:** 541.22s (9m01s) to 300s requires about a **45%** reduction. Unit already takes 30.06s; integration must fall from 511.16s to roughly **270s**. That appears plausible only if transport replacement, boundary-safe fixture batching, and targeted proven parallelism materially reduce integration time. PAF-114 may remove duplicate build work only with fresh-artifact proof.
- **CI:** 23m07s to 8m requires about a **65%** reduction. Integration takes 1,292.99s and would need to reach roughly **380s** (or lower, depending on command overhead and the unit phase). Per-call transport overhead and slower CI runners make transport replacement the dominant proposed lever, but its end-to-end effect is unmeasured.
- **Measurement gate:** Tune budgets from repeated comparable runs through PAF-111 before adopting thresholds. A single local or CI run does not establish a stable budget.
- **Scope:** E2E's 11m40s CI duration is outside the `pnpm test` budget. PAF-117's parallel jobs can improve wall-clock feedback without reducing total compute.

## Guard-preservation matrix

| Guard                                              | Current guard source (verified repository paths)                                                                                                                                                                                           | Responsible child         | Proof mechanism                                                                                                                                                                                                                                                       | Rollback mechanism                                                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Authenticated API and RLS behavior                 | `test/matches.registration.actions.integration.test.ts`; `test/matches.registration.visibility.integration.test.ts`                                                                                                                        | PAF-113, PAF-114, PAF-116 | Keep authenticated RPC/API outcomes and role/JWT policy assertions mandatory. PAF-113 proves pre-batch case identities/outcomes; PAF-114 reconciles every moved identity against the 1,599-case inventory; PAF-116 requires overlap proof for any parallel candidate. | Unbatch the changed setup or restore original phase placement; return unproven candidates to serial scheduling.            |
| Real signup and auth lifecycle                     | `test/auth.account-signup.test.ts`; `test/matches.registration.model.test.ts`                                                                                                                                                              | PAF-113, PAF-114          | Keep lifecycle and model-oracle assertions mandatory; compare batched identities/outcomes with the captured pre-batch oracle and map phase moves.                                                                                                                     | Revert shared-actor/batching changes and restore signup/SQL cases to their prior phase.                                    |
| Trusted SQL transport and migration CLI safety     | `test/helpers/match-registration-sql.ts`; `test/matches.migration-up-harness.test.ts`; `test/matches.registration.domain-migration.integration.test.ts`; `test/fixtures/matches-upgrade-assertions.sql`; `test/local-supabase-env.test.ts` | PAF-112                   | Preserve migration invocation/assertions and explicit-opt-in, loopback, refuse-before-subprocess checks. Add framing, session-reset, timeout, cancellation, rollback, and failed-connection fault-injection assertions per PAF-112 acceptance.                        | Revert persistent transport patch; restore existing CLI helper/wrapper path and independent sessions.                      |
| CLI process-tree cleanup                           | `test/community.admin.integration.test.ts`; `test/matches.registration.actions.integration.test.ts`; `test/helpers/match-registration-sql.ts`                                                                                              | PAF-112                   | Keep existing SIGTERM-to-SIGKILL process-group cleanup and empty-group/orphan-holder assertions; add leak assertions for new transport failure paths per PAF-112 acceptance.                                                                                          | Revert transport patch to restore CLI helper; keep child-process teardown checks.                                          |
| Lock overlap, FIFO ordering, and race outcomes     | `test/helpers/match-registration-sql.ts`; `test/matches.registration.fifo.integration.test.ts`; `test/matches.management.protection.integration.test.ts`; `test/matches.management.cancellation.integration.test.ts`                       | PAF-112, PAF-116          | Preserve independent-session barrier proofs, FIFO ordinal assertions, and protection/cancellation winner assertions. PAF-116 adds repeated overlap/no-interference proof for each parallel candidate.                                                                 | Revert PAF-116 scheduling change; retain `fileParallelism: false` and existing serial baseline.                            |
| DDL notification rollback                          | `test/matches.management.protection.integration.test.ts`                                                                                                                                                                                   | PAF-115                   | Keep injected notification-failure assertion that state is unchanged and `finally` removes trigger/function; measure isolated DDL effect before reducing DDL frequency.                                                                                               | Revert reduced-DDL change and retain current trigger-changing DDL behavior.                                                |
| Fixture cleanup, residue, and backend leaks        | `test/community.integration.test.ts`; `test/helpers/match-registration-sql.ts`                                                                                                                                                             | PAF-115, PAF-116          | Preserve existing cleanup/finally paths. Current community cleanup is not a complete residue proof; add residue and leaked-session assertions after success and failure per PAF-115 acceptance.                                                                       | Revert namespaced-cleanup change; restore serial scheduling; never reset a developer database.                             |
| Coverage scope and thresholds                      | `vitest.config.ts`; `vitest.unit.config.ts`                                                                                                                                                                                                | PAF-114, PAF-117          | Keep the current unit coverage collection, `src/i18n/config.ts` scope, and all four 80% thresholds; compare required-job coverage reports after any move/split.                                                                                                       | Restore existing unit-phase coverage configuration and required CI job if split changes coverage or threshold enforcement. |
| Production build/extraction and artifact freshness | `test/community.admin-extraction.test.ts`                                                                                                                                                                                                  | PAF-114                   | Preserve fresh-build extraction checks, six distinct transport identities, and the stale-artifact negative assertion; require revision/input/environment provenance for any shared artifact.                                                                          | Revert artifact sharing and restore independent fresh builds before consuming tests.                                       |
| E2E behavior and fresh preview                     | `playwright.config.ts`; `e2e/matches-registration.spec.ts`; `e2e/community-lifecycle.spec.ts`                                                                                                                                              | PAF-117                   | Run unchanged E2E suites through `pnpm test:e2e` against a fresh preview with `reuseExistingServer: false`; aggregate gate must fail on required failure, cancellation, or unexpected skip.                                                                           | Revert CI job split to the existing single required job and retain fresh-preview E2E execution.                            |
| Local database target safety                       | `test/local-supabase-env.test.ts`; `test/matches.migration-up-harness.test.ts`                                                                                                                                                             | PAF-112, PAF-115, PAF-116 | Keep loopback/explicit-opt-in checks and refusal before unsafe subprocess/reset; verify scoped cleanup only on disposable, explicitly owned stacks.                                                                                                                   | Revert reset/cleanup optimization; retain local-target guard and serial execution.                                         |

## Non-goals / invariants for this delivery

- No application, test, configuration, or CI code changed; this proposal and curated evidence JSONs are documentation deliverables.
- No test was removed, skipped, or modified. No coverage threshold or CI behavior changed.
- The PAF-111–PAF-117 children remain in Backlog pending user approval; no child status moved to active or complete.
- PAF-113 owns the pre-batch identity/outcome proof; PAF-114 owns the phase-relocation map (including unit-to-integration moves) against the PAF-111 1,599-case inventory. Both implementation artifacts are outside this investigation document.
- No developer database reset, source instrumentation, benchmark harness, or dependency was added. Raw Vitest JSONs and console logs remain ephemeral; only curated provenance and analysis are committed under `docs/plan/PAF-109-evidence/`.

## Risks & open questions

- **Local/CI variance:** The 2.5× integration gap makes one-run targets unreliable. PAF-111 must define repeated, comparable measurements before budgets are accepted.
- **Trigger DDL attribution:** The 8,762 introspection executions and ~214s cumulative time do not establish removable wall time. Measure isolated deltas before reducing DDL.
- **Persistent transport:** Confirm safe session reset, cancellation, rollback, and discard of failed connections; independent concurrent sessions must remain available for overlap proofs.
- **Parallelization cost:** Proven isolation may require disposable Supabase stacks or CI shards, increasing CI resource cost. Retain serial scheduling as rollback.
- **Fixture differences:** Local residue (about 11,400 auth users and 4,363 communities) differs from a fresh CI stack; do not compare runs as clean baselines without recording DB state.
- **Open Vite handles:** Both phase runs showed non-failing Vitest 2s close-timeout warnings. Treat as cosmetic evidence for now; PAF-114 should verify server lifecycle and artifact freshness.

## Approval gate

Implementation starts only after explicit user approval of this proposal. Execute each PAF-111 through PAF-117 child according to the approved dependency DAG; do not start a child before all its dependencies are complete and reviewed. PAF-114 depends only on PAF-111, and PAF-116 depends on both PAF-114 and PAF-115. The current delivery establishes findings and guard-preserving scope only.
