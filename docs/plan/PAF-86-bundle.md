# PAF-86 — Review Context Bundle

Branch: `feature/PAF-86-follow-up-epic-1-test-reliability-and-ci-evidence`
Base: `origin/main` @ `df48f455e008da77cbcb1c8dacde0b983bd35c24`
HEAD: `7a87c7f7496d6e28abe8c85450bd4cbf7456e4e7`
Diff: 24 files, +545 / −224 (see `docs/plan/PAF-86.diff` for the full patch)
Plan: `docs/plan/Plan PAF-86 Follow-up epic 1 — Test reliability and CI evidence.md`

## Epic scope

**PAF-86 — Follow-up epic 1 — Test reliability and CI evidence**

Goal: PAF-62 actionable test/CI fixes (geometry stability, retained artifacts, production stale-response test); the invitee fixture split from PAF-70; registration concurrency-test hardening split from PAF-85. Preserve visual budgets. Diagnose deadlocks before choosing test isolation or a product fix; never hide failures with retries. Monitor Members-screen variance and document environment-limited coverage rather than forcing impossible fixtures.

Delivery: one focused PR; all scoped child ACs satisfied; `pnpm complete-check` passes without lowering coverage or widening screenshot budgets.

## Unit 1 — PAF-62 (commit `3279a4fd5994df9b96d28e322ad91d14c5d96119`)

Title: Tier 4 follow-ups: deferred review finding and visual-gate hardening

ACs:
- Replace the stand-alone stale-response imitation with a production-component test; removing production protection must fail it.
- Stabilise the `bottomNavGeometry` `boundingBox()` read in `e2e/community-admin.spec.ts` without relying on Playwright retries; keep every ±1px/5-link/≥44px/current-page assertion; a missing nav must still fail.
- Retain visual-diff evidence (per-screen JSON + actual/reference PNGs) for passing runs, downloadable from CI.
- Monitor Members-screen budget without widening any budget/mask/reference.
- Document environment-limited coverage (zero-member community; authenticated anonymous JWT) without fabricating fixtures.

Files:
- `.github/workflows/ci.yml`
- `.gitignore`
- `docs/plan/PAF-49-findings.md`
- `docs/visual/community-admin-residuals.md`
- `e2e/community-admin.spec.ts`
- `test/community.invitee.functions.test.ts`

Validation: typecheck/lint/format green; `vitest run test/community.invitee.functions.test.ts test/community.admin-ui.test.tsx` 46 passed; E2E admin spec green on 3 separate `--retries=0` invocations (one run lost its preview server to SIGTERM 143 — tooling, not an assertion); F23 mutation-proved (guard removed → fail, restored → pass); artifact persistence verified on green and intentional-failure runs.

## Unit 2 — PAF-91 (commit `da6e437f0a1a01d33c50d14d146da16a5a510eeb`)

Title: Make invitee integration fixtures unique and history-independent

ACs:
- Fixture identity unique or cleanup prevents accumulation.
- Repeated full-suite runs against the same local DB remain deterministic.
- Preserve literal wildcard/regex search-escaping coverage.
- `pnpm complete-check` passes.

Files: `test/community.invitee.integration.test.ts`

Validation: per-run UUID marker in both fixture name and query (`100%_.* <uuid>`), negative query `100%_x <uuid>`; 21-candidate collision regression proves the target still resolves despite the RPC's sorted 20-row cap; 5/5 targeted passes on an unreset DB; full-suite failures at that point were the retained PAF-92 deadlocks.

## Unit 3 — PAF-92 (commit `9a9051fe5ce75d3c035fec6889a8e804f0f7c23e`)

Title: Diagnose and harden intermittent registration concurrency-test deadlocks

ACs:
- Diagnose lock ordering, fixture overlap and test isolation under full parallel execution.
- Preserve production concurrency guarantees and proven lock-barrier assertions.
- Add regression coverage for the diagnosed cause; demonstrate stable repeated parallel runs.
- Do not suppress 40P01 or rely on retries/blanket serialization.
- Fix a product defect if found, or explicitly track the blocker.
- `pnpm complete-check` passes.

Cause: fixtures held `SHARE ROW EXCLUSIVE` on `public.match_events` for a whole long transaction via `ALTER TABLE ... DISABLE TRIGGER lock_match_photo_publication`, producing 3-process `40P01` cycles with concurrent writers (`ShareRowExclusiveLock` on the relation vs `ShareLock` on a transaction). An interim "lock table first" fix was tried and rejected: the strong lock is still held for the transaction and full-suite runs still deadlocked.

Fix: `test/helpers/match-photo-fixtures.ts` seeds a valid `storage.objects` photo row and a trigger-valid `photo_path`, so the publication trigger stays enabled and no fixture toggles it. Zero `lock_match_photo_publication` toggles remain in `test/`.

Files: 16 files (14 fixtures + new helper + `docs/plan/PAF-92-lock-diagnosis.md`).

Validation: 5/5 separate paired actions+model runs green; 3/3 separate full `pnpm test` runs green (912/912, coverage 100%); `pnpm complete-check` all 8 stages green including E2E 142/142; zero `40P01` in any run; trigger `tgenabled='O'`.

## Unit 4 — review fixes (commit `7a87c7f7496d6e28abe8c85450bd4cbf7456e4e7`)

Files: `e2e/community-admin.spec.ts`, `test/matches.registration.domain-migration.integration.test.ts`, `docs/plan/PAF-92-lock-diagnosis.md`, `docs/plan/PAF-86-findings.md`.

- **Major (F1):** the domain-migration probe issued `CREATE TRIGGER` / `ALTER TABLE ... DISABLE TRIGGER` *after* writing rows, upgrading to `ACCESS EXCLUSIVE` while holding row locks. Confirmed with `pg_class` (relation 18307 = `public.match_event_registrations`) and a captured `40P01` DETAIL (`RowExclusiveLock` vs `AccessExclusiveLock`). Both DDL statements now run first in the probe transaction; assertions and rollback sentinel unchanged.
- **Minor (F2):** the admin geometry probe now keeps and returns the exact sample that satisfied the bounded poll instead of re-reading `boundingBox()`.
- Findings ledger: `docs/plan/PAF-86-findings.md` (F1/F2 fixed, F3/F4 deferred with rationale).

Verification after these fixes: `pnpm complete-check` **3/3 consecutive runs green** — all 8 stages, 912/912 unit tests, 142/142 E2E, zero `40P01`.

## Fast-gate / full-gate status

- `pnpm typecheck` — pass
- `pnpm lint` — pass
- `pnpm format:check` — pass
- `pnpm complete-check` — pass (all 8 stages; unit 912/912, E2E 142/142)

## Review instructions

Review the whole change set against the plan above. Do not re-run the full gate. Use `docs/plan/PAF-86.diff` or `git diff origin/main...HEAD`. Return machine-readable findings, one per line:

`[severity] file:line | short title | suggested fixer`

with severity in `critical|major|minor|nit`. If there are no findings, say `no findings`.
