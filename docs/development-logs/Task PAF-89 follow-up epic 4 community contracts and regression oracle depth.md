---
title: PAF-89 Follow-up Epic 4 Community Contracts and Regression Oracle Depth
type: development-log
permalink: docs/development-logs/task-PAF-89-follow-up-epic-4-community-contracts-and-regression-oracle-depth
---

# Development Log: PAF-89

## Metadata

- Task ID: PAF-89 (epic "Follow-up epic 4 — Community contracts and regression-oracle depth"; three scoped units delivered as units within the same PR, plus review fixes)
- Date (UTC): 2026-10-21
- Project: padel-friend
- Branch: feature/PAF-89-follow-up-epic-4-community-contracts-and-regression-oracle-depth (base `5c283b3b` = `origin/main`, 4 commits ahead)
- Commits (4, oldest first): `af7f561` (Unit 1 "test: verify community JSONB boundaries against PostgreSQL"), `9036e66` (Unit 2 "test: strengthen community admin production-path oracles"), `f36a41d` (Unit 3 "fix: type community settings responses and review dependency risk"), `66b1542` (review fixes "fix: address review findings", HEAD)
- Artifacts: plan `docs/plan/Plan PAF-89 follow-up-epic-4-community-contracts-and-regression-oracle-depth.md`, findings ledger `docs/plan/PAF-89-findings.md`

## Objective

- Close follow-up epic 4 — community contracts and regression-oracle depth: pin the community JSONB size boundary to PostgreSQL's actual `jsonb::text` byte serialization with an independent byte oracle, convert community admin UI tests to production-path oracles (real route tree, real navigation, real accessible names) and break the admin-shell circular import, type the community RPC boundary without regenerating Supabase types, re-evaluate the accepted `braces` advisory, and fix all review findings raised against the delivery itself (commit `66b1542`).

## Implementation Summary

- **Unit 1, commit `af7f561` — JSONB byte-oracle boundary coverage.**
  - New `test/helpers/community-jsonb-fixtures.ts`: independent exact-byte descriptor catalog covering nested objects/arrays, empty containers, escaped keys/values, Cyrillic + astral text, `1e21`, `1e-7`, `5e-324`, `-0`, and mixed nesting; a builder pads to exactly 4095/4096/4097 PostgreSQL `jsonb::text` bytes using hand-written canonical text — never the production counter.
  - `test/community.functions.test.ts`: per-descriptor accept/reject cases plus a compact-JSON negative control (`{x:'a'.repeat(4088)}` = 4096 compact bytes, 4097 `jsonb::text` bytes) proving the oracle rejects on PostgreSQL's serialization, not on compact JSON length.
  - `test/community.integration.test.ts`: DB-backed parity against `octet_length(convert_from(decode(<hex>,'hex'),'UTF8')::jsonb::text)`, persisted-size re-measurement, and per-descriptor atomic `22023 / Invalid community patch` rejection with complete row + settings + audit snapshots unchanged. SQL batches kept under a 64 KiB argv budget (Linux `ARG_MAX` 131072 limit) after a review finding.
- **Unit 2, commit `9036e66` — community admin oracles + module ownership.**
  - `test/community.admin-routes.test.ts`: real route-tree loading (deep link) and real history-driven index→detail navigation, asserting the active-roster loader is never invoked.
  - `e2e/community-onboarding.spec.ts`: `visualDiff`'s inline comparator extracted to one top-level serializable `comparePngImages`; synthetic PNG tests now drive the real decoding/counting loop (mutation check kills a broken loop).
  - New `src/features/community/community-admin.helpers.ts` plus `CommunityAdmin.tsx` / `CommunityAdminViews.tsx`: four formatting helpers moved out of the shell to break the circular import; direction is now shell → views → helpers → settings. The 1.2k-line view split was explicitly excluded by user decision.
  - `e2e/community-admin.spec.ts`: 320px × 6 screens × 3 locales sequential Tab traversal — every enabled admin control asserted focused, `:focus-visible`, ≥44px, in-viewport, and unobscured by the bottom nav via hit test, with DOM-identity set comparison and real `toHaveAccessibleName`, including the settings `summary` collapsed and expanded.
  - New `test/community.admin-helpers.test.ts`.
- **Unit 3, commit `f36a41d` — RPC boundary typing + advisory re-evaluation.**
  - New `src/features/community/community-rpc.types.ts` with `CommunitySettingsUpdateResult` / `CommunitySettingsReadResult` derived from the table Row; applied via `overrideTypes` in `community.functions.ts`; generated Supabase types untouched.
  - Tests: nullable-field and reader-projection unit tests with `expectTypeOf`, plus a live DB column-isolation test.
  - `docs/security/dependency-remediation.md`: `braces` GHSA-vfj7-8cjw-p6xm re-checked 2026-10-21 (latest 3.0.3, `patched_versions: null`, dev-only stylelint path) → accepted exception re-documented with a 2026-10-28 re-check cadence.
- **Review fixes, commit `66b1542`.** Round-1 review (code, architecture, UX/UI) raised 5 required findings: SQL argv limit, per-descriptor atomic proof, DOM-identity traversal, real accessible names, name-marker length. All fixed in-delivery; dispositions recorded in `docs/plan/PAF-89-findings.md`.

## Files Changed

- JSONB byte oracle (Unit 1): `test/helpers/community-jsonb-fixtures.ts` (new: exact-byte descriptor catalog + 4095/4096/4097 padding builder), `test/community.functions.test.ts` (per-descriptor accept/reject + compact-JSON negative control), `test/community.integration.test.ts` (DB byte parity, persisted-size re-measurement, per-descriptor atomic `22023` rejection, SQL batches under 64 KiB argv)
- Admin production-path oracles (Unit 2): `test/community.admin-routes.test.ts` (real route-tree load + real history navigation; active-roster loader never invoked), `e2e/community-onboarding.spec.ts` (comparator extracted to top-level serializable `comparePngImages`), `e2e/community-admin.spec.ts` (320px × 6 screens × 3 locales Tab traversal matrix)
- Module ownership (Unit 2): `src/features/community/community-admin.helpers.ts` (new: four formatting helpers), `src/features/community/CommunityAdmin.tsx` and `src/features/community/CommunityAdminViews.tsx` (helpers moved out of shell; shell → views → helpers → settings)
- Unit 2 tests: `test/community.admin-helpers.test.ts` (new)
- RPC boundary typing (Unit 3): `src/features/community/community-rpc.types.ts` (new: `CommunitySettingsUpdateResult` / `CommunitySettingsReadResult`), `src/features/community/community.functions.ts` (`overrideTypes` applied); nullable-field + reader-projection unit tests (`expectTypeOf`) and live DB column-isolation test
- Dependency re-evaluation (Unit 3): `docs/security/dependency-remediation.md` (`braces` re-check 2026-10-21, accepted exception with 2026-10-28 cadence)
- Review fixes (Unit 4, commit `66b1542`): SQL argv batching, per-descriptor atomic-proof assertions, DOM-identity traversal, real accessible names, name-marker length fixes across the above test files
- Findings ledger: `docs/plan/PAF-89-findings.md`

## Key Decisions

- Independent byte oracle: fixtures use hand-written canonical text for exact PostgreSQL `jsonb::text` byte targets and never the production counter, so the test cannot pass by circular reasoning; the compact-JSON negative control (`{x:'a'.repeat(4088)}`) proves rejection keys on PostgreSQL serialization, not compact length.
- DB-backed parity in integration tests (`octet_length(... ::jsonb::text)` on the decoded payload) plus per-descriptor atomic rejection with complete row + settings + audit snapshots, so a partial write can never masquerade as a clean reject.
- Review-driven argv discipline: SQL batches capped under 64 KiB because Linux `ARG_MAX` (131072) made the original large batch fragile — the limit is respected, not assumed away.
- Production-path oracles over mocks: admin route tests load the real route tree via deep link and navigate via real history, and the traversal matrix uses DOM-identity set comparison with real `toHaveAccessibleName` so a stubbed or duplicated control set cannot satisfy the oracle.
- Comparator honesty: `visualDiff`'s inline comparator extracted to a top-level serializable `comparePngImages` so synthetic-PNG tests exercise the real decode/count loop (mutation-proved), rather than a test-only copy.
- Circular import broken at the smallest seam: a `community-admin.helpers.ts` module for four formatting helpers (shell → views → helpers → settings) instead of the 1.2k-line view split — **the large view-module split was explicitly excluded by user decision**.
- RPC boundary typing via `overrideTypes` on the community functions instead of regenerating Supabase types: generated artifacts stay untouched while the settings update/read responses are correctly typed (nullable fields, reader projection), enforced with `expectTypeOf` and a live DB column-isolation test.
- `braces` GHSA-vfj7-8cjw-p6xm stays an accepted exception (latest 3.0.3, no patched version, dev-only stylelint path), re-documented with an explicit 2026-10-28 re-check cadence.
- No test thresholds, coverage gates, or screenshot budgets were changed in this delivery.

## Validation Performed

- Fast gates after each unit: typecheck, lint, and scoped unit/integration/E2E runs — all green.
- `pnpm test:e2e e2e/community-onboarding.spec.ts`: 18/18 with unchanged reference hashes (visual evidence preserved).
- `pnpm test:e2e e2e/community-admin.spec.ts`: 20/20 (18 matrix cells of the 320px traversal).
- Mutation checks: comparator mutation check and traversal mutation checks both killed the tests, then were restored.
- Review: round 1 (code, architecture, UX/UI reviewers) → 5 required findings, all fixed in-delivery (`66b1542`); ledger `docs/plan/PAF-89-findings.md` records every disposition.
- Final gate: `pnpm complete-check` on the final state — PASS — db types check, build, knip, typecheck, lint, format check, unit 837 tests / 80 files, integration 165 tests / 25 files, E2E 142 tests.

## Risks and Follow-ups

- **Accepted advisory (tracked):** `braces` GHSA-vfj7-8cjw-p6xm remains open upstream (`patched_versions: null`); dev-only via stylelint. Re-check cadence documented in `docs/security/dependency-remediation.md` — next check due 2026-10-28.
- **No other follow-ups** from this epic; nothing was deferred.
- Known notes (not defects): Vitest prints a benign "close timed out after 2000ms" teardown warning on integration runs (pre-existing, exit code 0); a single transient failure of an unrelated pre-existing JWT test was observed once during fix iteration and did not reproduce in 4 subsequent runs or in the final `complete-check`.

## Commits

- `af7f561` — test: verify community JSONB boundaries against PostgreSQL (Unit 1)
- `9036e66` — test: strengthen community admin production-path oracles (Unit 2)
- `f36a41d` — fix: type community settings responses and review dependency risk (Unit 3)
- `66b1542` — fix: address review findings (review fixes, HEAD)
