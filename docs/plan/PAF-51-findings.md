# Findings Ledger — PAF-51 (PAF-2 follow-up — Tier 2: correctness)

Single source of truth for the fix loop. Append rows; never rewrite history; never re-add an existing row.
Reviewed baseline: `f5ec88e` (base `origin/main` = `3f7bc46`). Reviewers: code-review-specialist, architecture-review-specialist, ux-ui-reviewer-specialist (UX/UI returned no findings).
Fix loop: 2 iterations (cap 2). All fixes landed in one commit, `a9565cd` (`fix: address review findings`).

| id  | severity | location                                     | title                                                                                                                                                                                                        | status   | owner                         | iteration |
| --- | -------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ----------------------------- | --------- |
| F1  | major    | test/community.admin.integration.test.ts:569 | Queued-test teardown unbounded: retained SQL child cannot be killed and pending RPCs/SQL settle without deadlines; failed termination can leave the 900s holder backend running with its row lock            | fixed    | testing-automation-specialist | 2         |
| F2  | minor    | test/community.admin.integration.test.ts:508 | Queue probes pass `200` as the timeout argument instead of the polling interval, contradicting the ledger's 200ms-poll claim and risking load-dependent false failures                                       | fixed    | testing-automation-specialist | 1         |
| F3  | minor    | test/helpers/local-supabase-env.ts:24        | Quoted `.env` publishable keys retain their surrounding quotes (previous loader stripped them), producing an invalid credential; quoted placeholders also dodge placeholder detection                        | fixed    | testing-automation-specialist | 1         |
| F4  | minor    | test/community.admin.integration.test.ts:50  | `new URL(...).pathname` is percent-encoded, so checkouts with spaces/Unicode cannot load `.env`; same pattern in the sibling integration suite's loader callsite                                             | fixed    | testing-automation-specialist | 1         |
| F5  | minor    | test/community.functions.test.ts:123         | Exponent/container/string sizing fixtures are not boundary-sized, so a broken exponent expansion or nested-separator count would still pass; no persisted PostgreSQL `octet_length(...::jsonb::text)` oracle | deferred | deferred                      | 1         |

Notes:

- F1 was raised independently by both code-review-specialist and architecture-review-specialist (architecture recommended `rework-required` solely because of it).
- F5 is recorded `deferred`: it is a non-blocking, nontrivial test-only addition that the reviewers explicitly did not treat as blocking; it is handed off to a follow-up issue.
- UX/UI review (`CommunityAdmin.tsx` nullable-rating fallback + three locales) returned zero actionable findings.

### Iteration 1 evidence (merged into `a9565cd`)

- F1 (partial) — `startLocalProcess` retained the child (detached process group) with a bounded, idempotent `stop()`; `releaseHolderAndSweep()` bounded teardown inside a 10s deadline, aborted pending RPCs via `AbortController`, and never threw. Failure-path test `bounds teardown and leaves no tagged backend or child when holder release fails` (release deliberately failed with an out-of-range pid): teardown elapsed < deadline, marker sweep empty, `FOR UPDATE NOWAIT` probe proved the row lock released, second pass bounded and still empty.
- F2 — `QUEUE_PROBE_TIMEOUT_MS = 20000` / `QUEUE_PROBE_POLL_MS = 200` passed explicitly at both queue probes. Deterministic red/green negative control (forced first-poll miss plus 250ms poll delay) failed with the old single-argument call and passed after.
- F3 — matching surrounding quotes stripped from both url and key before placeholder detection and before returning; three new tests failed against the unfixed helper and pass after.
- F4 — `dotEnvPathFromImportMetaUrl()` (`fileURLToPath`) used at both loader callsites; two tests failed with the old `.pathname` form and pass after, one permanently locking the regression.
- Delta re-review at `2d722c8` returned F1 **not fixed**: three residual gaps (handle-discarding sweep helper, leader exit suppressing group `SIGKILL`, no reserved per-stage shutdown budget, and failure-path coverage that only failed the initial release).

### Iteration 2 evidence (final, commit `a9565cd`)

- Gap 1 — every SQL child now goes through `runLocalSqlBounded()`, which retains the handle and bounds every spawn; the marker sweep retains and stops its own child inside a reserved slice. Negative control: with the catch branch emptied (old semantics), `stops a stalled cleanup command within its deadline slice` failed (`expected undefined to be defined`), then passed with `sweep.code === null` (signalled) in 2.45s.
- Gap 2 — `isGroupAlive()` probes the process group tolerating `ESRCH`/`EPERM`; `stop()` no longer early-returns on leader exit and escalates `SIGKILL` to the group with a bounded drain loop. Negative control: with the old early-return restored, `reaps descendants that outlive their process-group leader` failed (`expected true to be false`), then passed in 36ms.
- Gap 3 — shutdown split into four reserved slices (~2.4s each, `TEARDOWN_MARGIN_MS = 500`), so no stage can starve the others and worst case stays inside the 10s deadline.
- Gap 4 — new failure-path coverage for the stalled sweep and the orphaned descendant; the existing failed-release test now also asserts the sweep result and that the holder's process group is dead.
- Post-fix gates: `test/community.admin.integration.test.ts` 18 tests passed; queued-chronology test passed 3× with deliberately delayed polling (7.81s / 6.63s / 6.13s) with zero leftover tagged or sleeping backends after each run; `pnpm complete-check` green (build, knip, typecheck, lint, format, Vitest 41 files / 417 tests, Playwright 53).
- Final delta re-review at `a9565cd`: all three gaps **closed**, F2–F4 still fixed, no regression, **no blocking `critical`/`major` finding remains**.
- Lock discipline preserved throughout: single-statement nested-subquery holder, `FOR UPDATE NOWAIT` proof-of-lock gate, both transactions queued before the closure evaluation, explicit `pg_terminate_backend(holderPid)` release, and every original chronology/audit assertion. No production code was touched by the fix loop.
