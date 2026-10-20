---
title: PAF-86 Follow-up Epic 1 Test Reliability and CI Evidence
type: development-log
permalink: docs/development-logs/task-PAF-86-follow-up-epic-1-test-reliability-and-ci-evidence
---

# Development Log: PAF-86

## Metadata

- Task ID: PAF-86 (epic "Follow-up epic 1 — Test reliability and CI evidence"; sub-issues PAF-62, PAF-91, PAF-92 delivered as units within the same PR, plus review fixes)
- Date (UTC): 2026-10-20
- Project: padel-friend
- Branch: feature/PAF-86-follow-up-epic-1-test-reliability-and-ci-evidence (base `df48f45` = `origin/main`)
- Commits (4, oldest first): `3279a4f` (Unit 1 — PAF-62 "test: stabilize admin geometry and retain visual evidence"), `da6e437` (Unit 2 — PAF-91 "test: isolate invitee discovery fixture identity"), `9a9051f` (Unit 3 — PAF-92 "test: seed match photo fixtures instead of disabling triggers"), `7a87c7f` (Unit 4 — review fixes "test: fix lock-upgrade deadlock and keep polled geometry sample", HEAD)
- Diff: 24 files, +545/−224
- Artifacts: findings ledger `docs/plan/PAF-86-findings.md`, lock diagnosis `docs/plan/PAF-92-lock-diagnosis.md`, updates to `docs/plan/PAF-49-findings.md` and `docs/visual/community-admin-residuals.md`

## Objective

- Close follow-up epic 1 — test reliability and CI evidence: stabilize the admin-geometry E2E flake while retaining visual-diff evidence in CI, isolate the invitee-discovery fixture identity against dirty-database collisions, eliminate intermittent `40P01` deadlocks caused by match-photo fixtures disabling the publication trigger, and resolve the review findings raised against this delivery itself (commit `7a87c7f`).

## Implementation Summary

- **Unit 1 — PAF-62, commit `3279a4f` — admin geometry stabilization and visual evidence retention.**
  - `e2e/community-admin.spec.ts`: bounded positive-size `boundingBox()` acquisition replaced retry-masked geometry flake; visual-diff evidence (per-screen JSON + actual/reference PNGs) persisted to a dedicated `artifacts/community-admin-visual/` directory before the budget assertion, retry/repeat-safe.
  - `.github/workflows/ci.yml` + `.gitignore`: dedicated evidence directory added to the existing always-on artifact upload; generated evidence ignored.
  - `test/community.invitee.functions.test.ts`: removed the stand-alone stale-response imitation; production-component coverage lives in `test/community.admin-ui.test.tsx`.
  - F23 mutation-proved (guard removed → test fails; restored → passes).
  - Docs: F23 resolution, Members-screen variance monitoring directive (no budget widening), and documented environment limits (zero-member community unreachable through API; authenticated anonymous JWT unavailable locally) recorded in `docs/plan/PAF-49-findings.md` and `docs/visual/community-admin-residuals.md`.
  - E2E admin spec green across 3 separate `--retries=0` invocations; one run lost its preview server to SIGTERM 143 (tooling, not an assertion failure).
- **Unit 2 — PAF-91, commit `da6e437` — invitee discovery fixture identity isolation.**
  - `test/community.invitee.integration.test.ts`: per-run UUID marker in both the fixture display name and the positive/negative queries, keeping the fixture inside the RPC's sorted 20-row cap on a dirty database; 21-candidate collision regression added; 5/5 targeted passes on an unreset database.
- **Unit 3 — PAF-92, commit `9a9051f` — seed match photo fixtures instead of disabling triggers.**
  - Diagnosed intermittent `40P01` deadlocks: fixtures held `SHARE ROW EXCLUSIVE` on `public.match_events` for a whole long transaction via `ALTER TABLE ... DISABLE TRIGGER lock_match_photo_publication`.
  - New `test/helpers/match-photo-fixtures.ts` seeds a valid `storage.objects` photo row + trigger-valid `photo_path`, so the trigger stays enabled. Applied across 14 fixtures; zero publication-trigger toggles remain in `test/`.
  - Lock diagnosis written to `docs/plan/PAF-92-lock-diagnosis.md`.
  - An interim "lock table first" preamble and a blanket `session_replication_role` attempt were tried and rejected (still deadlocked / broke fixtures that depend on other triggers); both reverted.
  - Test isolation: visibility suite list query scoped to fixture IDs (local DB exceeded PostgREST's 1,000-row default); leftover local repro table dropped.
- **Unit 4 — review fixes, commit `7a87c7f`.**
  - F1 (major): the domain-migration probe issued `CREATE TRIGGER` / `ALTER TABLE ... DISABLE TRIGGER` after writing rows, upgrading to `ACCESS EXCLUSIVE` on `public.match_event_registrations` while holding row locks → two-way `40P01` cycle with concurrent registration RPCs. Confirmed via `pg_class` (relation 18307) and captured DETAIL (`RowExclusiveLock` vs `AccessExclusiveLock`). Both DDL statements now run first in the probe transaction; assertions/rollback unchanged.
  - F2 (minor): geometry probe now returns the exact sample that satisfied its bounded poll instead of re-reading.
  - Findings ledger `docs/plan/PAF-86-findings.md`: F1/F2 fixed, F3/F4 deferred (test-strength improvements).

## Files Changed

- Admin geometry + evidence (Unit 1 / PAF-62): `e2e/community-admin.spec.ts` (bounded positive-size `boundingBox()` acquisition; evidence persisted to `artifacts/community-admin-visual/` before the budget assertion), `.github/workflows/ci.yml` (evidence directory in always-on artifact upload), `.gitignore` (ignore generated evidence)
- Stale-response coverage relocation (Unit 1): `test/community.invitee.functions.test.ts` (stand-alone imitation removed; production-component coverage lives in `test/community.admin-ui.test.tsx`)
- Unit 1 docs: `docs/plan/PAF-49-findings.md`, `docs/visual/community-admin-residuals.md`
- Invitee fixture identity (Unit 2 / PAF-91): `test/community.invitee.integration.test.ts` (per-run UUID marker, 21-candidate collision regression)
- Match-photo fixtures (Unit 3 / PAF-92): `test/helpers/match-photo-fixtures.ts` (new: valid `storage.objects` row + trigger-valid `photo_path`), applied across 14 fixtures in `test/` (zero publication-trigger toggles remain), visibility-suite list query scoped to fixture IDs
- Unit 3 docs: `docs/plan/PAF-92-lock-diagnosis.md`
- Review fixes (Unit 4, commit `7a87c7f`): domain-migration probe (DDL first in transaction), geometry probe (returns polled sample)
- Findings ledger: `docs/plan/PAF-86-findings.md`
- (Total: 24 files, +545/−224)

## Key Decisions

- No widening of visual budgets/masks, no lowering of coverage thresholds, no retries added, no blanket serialization — flakiness is fixed at the cause, not absorbed.
- Admin geometry: bounded positive-size `boundingBox()` polling acquires real layout instead of relying on retries to mask a geometry race; the exact polled sample is returned (review F2) rather than re-read.
- Visual evidence is persisted to a dedicated `artifacts/community-admin-visual/` directory before the budget assertion and uploaded always-on in CI, so failures carry per-screen JSON + actual/reference PNGs.
- Invitee discovery: per-run UUID markers in fixture identity and queries keep the fixture inside the RPC's sorted 20-row cap on a dirty database — isolation by identity, not by database resets.
- Deadlock root cause: prefer removing the lock hazard entirely (seed a valid `storage.objects` photo row so the publication trigger stays enabled) over reordering locks; trigger-disabling fixtures were migrated, not patched.
- DDL on a table other suites write must be the first statement of its transaction (review F1): writing rows first upgrades the probe to `ACCESS EXCLUSIVE` while holding row locks, forming a two-way `40P01` cycle with concurrent registration RPCs.
- Interim attempts rejected and reverted: "lock table first" preamble (still deadlocked) and blanket `session_replication_role` (broke fixtures that depend on other triggers).
- F23 resolved by removing the stand-alone stale-response imitation in favor of existing production-component coverage in `test/community.admin-ui.test.tsx`; mutation-proved both ways.

## Validation Performed

- `pnpm complete-check`: 3/3 consecutive green runs after Unit 4 — all 8 stages, 912/912 unit tests, 142/142 E2E, coverage 100%, zero `40P01`.
- Earlier states: standalone full suite 3/3 green; `complete-check` 1/2 green before the final lock-order fix (context for the review fix's impact).
- Static gates (typecheck / lint / format:check) green throughout.
- E2E admin spec green across 3 separate `--retries=0` invocations; one run lost its preview server to SIGTERM 143 (tooling kill, not an assertion failure).
- Unit 2: 5/5 targeted passes on an unreset database (dirty-DB condition reproduced deliberately).
- F23 mutation-proved: guard removed → test fails; guard restored → test passes.

## Risks and Follow-ups

- **Deferred F3**: invitee collision regression is weaker than described (collisions do not share the target query) — strengthen in a follow-up.
- **Deferred F4**: no automated invariant rejects new fixtures that toggle the publication trigger — add an invariant/guard so trigger-disabling fixtures cannot regress.
- **Local advisory only**: RLS disabled on `public.match_event_registration_attempts` and `public.match_event_registration_state` (pre-existing, out of scope, needs security-owner review).
- **Monitoring directive**: Members-screen visual variance is under monitoring, not budget widening — watch for drift before considering any threshold change.
- **Environment limits documented**: zero-member community unreachable through API; authenticated anonymous JWT unavailable locally — constrain future test designs in this area.
