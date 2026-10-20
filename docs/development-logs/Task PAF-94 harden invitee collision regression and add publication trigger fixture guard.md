---
title: PAF-94 Harden Invitee Collision Regression and Add Publication Trigger Fixture Guard
type: development-log
permalink: docs/development-logs/task-PAF-94-harden-invitee-collision-regression-and-add-publication-trigger-fixture-guard
---

# Development Log: PAF-94

## Metadata

- Task ID: PAF-94 — "Harden invitee collision regression and add publication-trigger fixture guard"
- Date (UTC): 2026-10-20
- Project: padel-friend
- Branch: feature/PAF-94-harden-invitee-collision-regression-and-add-publication-trigger (base `315c6f3` = `origin/main`)
- Commits (4, oldest first): `b61feae` (Unit 1 "test: strengthen capped invitee discovery regression"), `de291de` (Unit 2 "test: guard fixtures against publication trigger toggles"), `05c007a` (Unit 3 "test: address review findings on trigger guard"), `f0475c5` (Unit 4 "test: run integration suites serially against the shared database", HEAD `f0475c5e47a7199e01656ca205413144b31895bc`)

## Objective

- Close the two follow-ups deferred from PAF-86: strengthen the invitee collision regression (Deferred F3 — collisions did not share the target query) and add an automated guard so fixtures cannot regress into toggling the publication trigger (Deferred F4). Additionally eliminate the intermittent `40P01` row-lock/transaction-wait failures between concurrently running integration suites by serializing them against the shared database.

## Implementation Summary

- **Unit 1 — commit `b61feae` — strengthen capped invitee discovery regression.**
  - `test/community.invitee.integration.test.ts`: collision actors renamed with an `A` prefix and the target with `Z`, so collisions sort before the target under the RPC's `display_name, user_id` ordering.
  - Added a broad `100%_.*` query (limit 20) asserting exactly 20 rows and the target absent; the marker-targeted query still returns exactly the target; negative `100%_x` query preserved.
- **Unit 2 — commit `de291de` — guard fixtures against publication trigger toggles.**
  - New `test/fixtures.publication-trigger.test.ts`: recursive, symlink-free scan of `test/` with deterministic ordering; case-insensitive, comment/whitespace-tolerant detection of `ALTER TABLE ... DISABLE|ENABLE [ALWAYS|REPLICA] TRIGGER lock_match_photo_publication`, `TRIGGER ALL/USER`, and `session_replication_role` via `SET`/`set_config`; failure lists offending paths and points at `test/helpers/match-photo-fixtures.ts`.
  - Detector self-tested with synthetic in-memory sources; forbidden tokens assembled from parts to avoid self-match.
- **Unit 3 — commit `05c007a` — address review findings on trigger guard.**
  - Review findings: missed `SET LOCAL`/`SET SESSION`/quoted `session_replication_role` and `set_config`; batched synthetic assertions only proved the first case.
  - Detector extended (optional LOCAL/SESSION, quoted identifiers, `=`/`TO`, `set_config`); each unsafe synthetic record now asserted independently (15 cases).
  - Mutation-proved: removing LOCAL/SESSION fails cases 9–12, removing quoting fails 11, removing `set_config` fails 13–14, removing the comment separator fails case 5.
- **Unit 4 — commit `f0475c5` — run integration suites serially against the shared database.**
  - Root cause: `test/**/*.integration.test.ts` files ran concurrently against one Postgres and intermittently produced `40P01` two-way row-lock/transaction-wait cycles (observed in model/fifo/cutoff), failing `complete-check` twice in a row on code this issue does not touch.
  - New `vitest.unit.config.ts` (parallel + coverage, excludes integration) and `vitest.integration.config.ts` (include overridden exactly, `fileParallelism: false`, no coverage because coverage includes only `src/i18n/config.ts`).
  - `package.json` `test` runs unit then integration. `mergeConfig` concatenates `include` arrays — caught in review; configs now override `include`/`exclude` explicitly.
  - Verified phases are disjoint: `vitest list --filesOnly` → 76 unit files + 25 integration files = 101; `pnpm test` run twice deterministic.

## Files Changed

- Invitee collision regression (Unit 1): `test/community.invitee.integration.test.ts` (collision actors `A`-prefixed, target `Z`-prefixed; broad `100%_.*` limit-20 query added; marker-targeted and negative queries preserved)
- Publication-trigger fixture guard (Units 2–3): `test/fixtures.publication-trigger.test.ts` (new: recursive, symlink-free, deterministic scan of `test/`; comment/whitespace-tolerant, case-insensitive detector for trigger toggles and `session_replication_role` via `SET`/`set_config`; 15 independently asserted synthetic cases)
- Test phase split (Unit 4): `vitest.unit.config.ts` (new: parallel + coverage, excludes integration), `vitest.integration.config.ts` (new: `include` overridden exactly, `fileParallelism: false`, coverage off), `package.json` (`test` runs unit then integration)

## Key Decisions

- Tests only; no production changes, no lowered coverage, no widened visual budgets.
- Prefer explicit config overrides over `mergeConfig` array merging for include/exclude (`mergeConfig` concatenates `include` arrays, which silently breaks the intended phase split).
- Targeted isolation of integration files only; unit tests stay parallel.
- Collision regression is made real by ordering: `A`-prefixed collisions sort before the `Z` target under the RPC's `display_name, user_id` ordering, so the broad limit-20 query proves the cap evicts the target.
- Fixture guard failure message points at `test/helpers/match-photo-fixtures.ts` as the sanctioned alternative to trigger toggles.
- Detector self-tests use synthetic in-memory sources with forbidden tokens assembled from parts to avoid the guard matching itself; each unsafe case asserted independently (a batched assertion only proved the first case).

## Validation Performed

- Final `pnpm complete-check`: all 8 stages pass — unit 76 files/769 tests (20.6s), integration 25 files/160 tests (184.9s), E2E 142/142, coverage 100% with unchanged 80% thresholds.
- `pnpm test` run twice green; deterministic across runs.
- Static gates (typecheck / lint / format:check) green.
- Code review: 2 required issues found and fixed; delta review clean. Follow-up review caught the `mergeConfig` `include` concatenation — fixed and verified via `vitest list --filesOnly` (76 unit + 25 integration = 101 files, phases disjoint).
- Trigger-guard detector mutation-proved: removing LOCAL/SESSION support fails cases 9–12, removing quoted-identifier support fails case 11, removing `set_config` support fails cases 13–14, removing the comment-separator tolerance fails case 5.

## Risks and Follow-ups

- Deferred: None (both PAF-86 deferred items F3 and F4 are closed by this issue).
- Inherent trade-off of Unit 4: integration suites now run serially, trading wall-clock speed for determinism against the shared database — acceptable because the deadlocks were in test scheduling, not product code.
