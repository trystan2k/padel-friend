---
title: PAF-51 PAF-2 follow-up — Tier 2: correctness
type: development-log
permalink: docs/development-logs/task-paf-51-tier-2-correctness
---

# Development Log: PAF-51

## Metadata

- Task ID: PAF-51 (PAF-2 follow-up epic — Tier 2: correctness. Contains units PAF-36, PAF-42, PAF-44 plus one review-fix commit covering two fix-loop iterations)
- Date (UTC): 2026-10-11
- Project: padel-friend
- Branch: feature/PAF-51-tier-2-correctness (based on `origin/main` @ `3f7bc46`; this repo has no `develop`)
- Commit: `a9565cd` (HEAD) — `fix: address review findings`. Per-unit commits, in order: `59da644`, `601a772`, `f5ec88e`, `a9565cd`
- Reviewers: code-review-specialist + architecture-review-specialist + ux-ui-reviewer-specialist (UX/UI returned zero actionable findings; architecture recommended rework solely because of the teardown finding)

## Objective

- Deliver the Tier 2 correctness follow-up to PAF-2 as one feature branch and one PR: align community settings JSONB size validation with PostgreSQL and expand denial coverage (PAF-36), harden community governance correctness across five findings (PAF-42), and expose timeline truncation plus harden chronology tests (PAF-44), then close out all blocking review findings.

## Implementation Summary

- **Unit 1 — PAF-36 (PAF-27 follow-up: settings JSONB size parity and denial coverage)** — `59da644` `fix: align community settings validation and denials`. `community.validators.ts`: settings size cap now counts UTF-8 bytes the way PostgreSQL renders JSONB text (`, `/`: ` separators) and expands numeric exponents, instead of compact `JSON.stringify`; exact 4095/4096/4097 boundary tests plus operator/Unicode/escape/number cases. `community.functions.ts`: settings size CHECK failures (`23514` on `communities_settings_check`) and the known `22023` + `Invalid community patch` message map to `INVALID_COMMUNITY_INPUT`; unrelated DB errors stay unmapped; PG001/28000/PG006 behavior preserved. `test/community.integration.test.ts`: handler-denial coverage added for a hidden-private target and a demoted admin, asserting `NOT_COMMUNITY_ADMIN` with unchanged row/audit. Negative control: reverting to compact `JSON.stringify` made the 4097-byte boundary test fail.
- **Unit 2 — PAF-42 (PAF-31 PR1 follow-up: deadlock mapping, venue archive audit detail, roster typing, reactivation chronology, test env loader)** — `601a772` `fix: harden community governance correctness`.
  - F5: extracted the environment-first loader into `test/helpers/local-supabase-env.ts` (loopback validation, optional `.env` fallback, visible skip reason, CI fail-closed guard) and used it from both integration suites; admin actor setup moved inside the skip-guarded suite; new `test/local-supabase-env.test.ts`.
  - F6: new forward migration `supabase/migrations/20261011171955_community_venue_archive_audit.sql` (CLI-generated) extends only the audit trigger function, preserving SECURITY DEFINER, empty `search_path`, grants/revocations and existing allowlists, adding sanitized venue detail `{archived: archived_at is not null}`; integration coverage distinguishes insert/edit (`false`) from archive (`true`).
  - F7: new feature-owned DTO `src/features/community/community-admin.types.ts` (`CommunityMemberSearchResult`) widens `valid_until`/`activated_at` to `string | null` and `display_level`/`reliability_percent` to `number | null`; `community-admin.functions.ts` typed with it; `CommunityAdmin.tsx` uses the DTO and renders a localized missing-rating fallback (null is never `0`, `NaN` or `Invalid Date`); keys added to all three locales.
  - F8: verified the reactivation chronology fix already present in `20261009061318_community_reactivation_interval_order.sql`; no redundant migration; chronology assertions preserved.
  - F9: canonical lock order (community row → membership row(s)), the direct-RLS reverse-order limitation and manual-retry guidance documented in new `docs/security/community-governance-lock-order.md`; `40P01`/`40001` from the governance RPC map to the stable `COMMUNITY_GOVERNANCE_CONFLICT_RETRYABLE`, unrelated errors preserved, no automatic retries.
- **Unit 3 — PAF-44 (PAF-32 follow-up: timeline pagination coverage, truncation indicator, queued-chronology test hardening)** — `f5ec88e` `fix: expose timeline truncation and harden chronology tests`.
  - F3: additive `truncated` flag on the timeline result (`hasLookahead && next_offset === null`), continuation kept only while `offset + limit <= 10000`; intervals/`next_offset`/range/order/filter unchanged; six table-driven unit cases.
  - F2: persisted real-JWT multi-community pagination traversal with fixture-derived expected ordering, same-timestamp UUID ties, decoy actor, limits 1 and 2, filtered and empty cases, bounded iteration.
  - F4/F5: queued-chronology test rebuilt around a single-statement nested-subquery holder that takes the community row lock before the RPCs, proven with a `FOR UPDATE NOWAIT` probe, released explicitly via `pg_terminate_backend`, replacing the old fixed-sleep pause; local negative control (temporarily restored the old transaction-start `valid_from`) made the test fail, and it passes after restoring the fix.
- **Unit 4 — Review follow-up** — `a9565cd` `fix: address review findings` (both fix-loop iterations). Full review of the whole change set by code-review-specialist, architecture-review-specialist and ux-ui-reviewer-specialist. UX/UI returned zero actionable findings; architecture recommended rework solely because of the teardown finding. Ledger `docs/plan/PAF-51-findings.md`: F1 major (unbounded concurrency-test teardown) plus F2–F4 minors, all fixed across two iterations inside commit `a9565cd`; F5 minor deferred (non-blocking test-only byte-oracle fixtures) and handed off to a follow-up issue. Iteration 1 delta review found F1 only partially fixed (handle-discarding sweep helper, leader exit suppressing group `SIGKILL`, no reserved shutdown budget); iteration 2 closed all three gaps with red/green negative controls per gap and a final delta review confirming closure and no regressions.

## Files Changed

- Unit 1 (PAF-36): `docs/plan/PAF-27-findings.md`, `src/features/community/community.validators.ts` (PostgreSQL-parity JSONB byte counting), `src/features/community/community.functions.ts` (settings size error mapping), `test/community.functions.test.ts` (boundary/operator/Unicode/escape/number cases), `test/community.integration.test.ts` (hidden-private + demoted-admin denial coverage).
- Unit 2 (PAF-42): `src/features/community/community-admin.functions.ts` (DTO typing, `40P01`/`40001` → `COMMUNITY_GOVERNANCE_CONFLICT_RETRYABLE`), `src/features/community/community-admin.types.ts` (new; `CommunityMemberSearchResult` nullable DTO), `src/features/community/CommunityAdmin.tsx` (DTO usage + localized missing-rating fallback), `src/locales/en/translation.json`, `src/locales/es/translation.json`, `src/locales/pt-BR/translation.json` (missing-rating keys), `supabase/migrations/20261011171955_community_venue_archive_audit.sql` (new; audit trigger venue detail), `test/community.admin.functions.test.ts`, `test/community.admin.integration.test.ts` (venue archive audit coverage), `test/community.integration.test.ts`, `test/community.admin-ui.test.tsx`, `test/helpers/local-supabase-env.ts` (new; environment-first loader), `test/local-supabase-env.test.ts` (new), `docs/security/community-governance-lock-order.md` (new), `docs/plan/PAF-31-findings.md`.
- Unit 3 (PAF-44): `src/features/community/community.functions.ts` (additive `truncated` flag), `test/community.lifecycle.functions.test.ts` (six table-driven truncation cases), `test/community.integration.test.ts` (persisted pagination traversal + rebuilt queued-chronology test), `test/community.admin.integration.test.ts`, `docs/plan/PAF-32-findings.md`.
- Unit 4 (review follow-up): `test/community.integration.test.ts` and related test teardown (F1 major — bounded concurrency-test teardown; F2–F4 minors), `docs/plan/PAF-51-findings.md` (findings ledger, F5 deferred).

## Key Decisions

- Faithful PostgreSQL JSONB byte counting in the validator rather than a DB round-trip or DB-only validation.
- Feature-owned nullable DTO (`community-admin.types.ts`) instead of hand-editing generated Supabase types.
- Additive `truncated` boolean instead of a cursor rewrite or lifting the offset ceiling.
- Forward-only audit-trigger migration; F8 required no new migration because the fix already existed in `20261009061318_community_reactivation_interval_order.sql`.
- Explicit, bounded test teardown (retained process-group handles, reserved deadline slices) instead of sleep-based lock holders.
- One feature branch off `origin/main`, one PR, one commit per unit of work plus a single review-fix commit.

## Validation Performed

- Per-unit fast gate green after each unit: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, affected Vitest files.
- Final QA gate on the frozen tree: `pnpm complete-check` PASS — build, knip, typecheck, lint, format, Vitest 41 files / 417 tests (coverage 100% on the gated module), Playwright 53/53, no skipped suites.
- Negative controls: compact `JSON.stringify` revert broke the 4097-byte boundary test (Unit 1); restoring the old transaction-start `valid_from` broke the queued-chronology test, which passed again after restoring the fix (Unit 3).
- Concurrency harness exercised 3× with deliberately delayed polling; zero leftover tagged or sleeping DB backends and no leaked processes/process groups.
- Reviews: three-specialist review of the whole change set (code-review, architecture-review, ux-ui-reviewer); two fix-loop iterations with per-gap red/green negative controls and a final delta review confirming closure and no regressions.
- Constraints honored: no vitest coverage thresholds changed, no `--fix` in CI, no new dependencies, generated `src/lib/supabase/database.types.ts` left untouched (feature-owned DTO used instead).

## Risks and Follow-ups

- **Deferred finding F5 (minor):** exponent/container sizing fixtures are not boundary-sized and there is no persisted PostgreSQL byte-oracle test; tracked in `docs/plan/PAF-51-findings.md` and handed to a follow-up issue.
- **Pre-existing environment notice:** the validated Supabase CLI query runner reports a shutdown "close timed out after 2000ms" notice after a successful Vitest run; documented in `vitest.config.ts`, not a failure.
- No UI-actionable findings from UX/UI review; no coverage threshold or CI behavior changes introduced.
