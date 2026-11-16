---
title: PAF-198 Remediate pre-release database security findings
type: development-log
permalink: docs/development-logs/task-PAF-198-remediate-pre-release-database-security-findings
---

# Development Log: PAF-198

## Metadata

- Task ID: PAF-198 — "Remediate pre-release database security findings" (epic; Linear PadelFriend project; children PAF-195 repo-side, PAF-196, PAF-197)
- Date (UTC): 2026-11-16
- Project: padel-friend
- Branch: `feature/PAF-198-remediate-pre-release-database-security-findings` (base `main` @ `f57c687`)
- Commits (4, conventional, no Linear IDs in subjects/bodies):
  - `5b63f6c` — `fix: reject anonymous onboarding sessions` (PAF-197; unit 1)
  - `fa7a7ea` — `fix: bound statistics activity expansion` (PAF-196; unit 2)
  - `1b07005` — `docs: clarify first production release recovery` (PAF-195 repo-side; unit 3; review baseline)
  - `6cbdf45` — `fix: address security remediation review findings` (fix sweep for review findings F1–F4)
- Release posture: production release PR #66 stays on hold; owner-gated release actions out of scope (plan gates O1–O4)
- Context sources: `docs/plan/Plan PAF-198 Remediate pre-release database security findings.md` (deepthink plan, checkpoints C1–C7), `docs/plan/PAF-198-bundle.md` (working bundle), `docs/plan/PAF-198-findings.md` (review findings ledger, F1–F4, with evidence)
- File-access protocol: all delegated specialists mutated files via Serena MCP only; one self-reported transient debug mutation in `statistics-player.server.ts` during unit 2 was restored and fully re-validated by the final gates before review

## Objective

- Remediate the pre-release database security findings on the repository side: reject anonymous actors at the onboarding boundary (PAF-197) and bound the statistics activity expansion so an oversized activity history can no longer blow the RPC's series generation (PAF-196).
- Clarify the first-production-release recovery path in the runbook (PAF-195 repo-side) without performing any owner-gated release action.
- Absorb the full review loop (code + architecture + UX/UI) with every finding fixed and regression-proven; leave the production release PR #66 and all environment-approval gates untouched (plan gates O1–O4).

## Implementation Summary

- **Unit 1 / PAF-197 (`5b63f6c`) — reject anonymous onboarding sessions:** new forward-only migration `supabase/migrations/20261116090000_onboarding_non_anonymous_actor.sql` — body-only `CREATE OR REPLACE` of the latest `onboard_player` (from `20261101100000`); adds `coalesce(auth.jwt()->>'is_anonymous','false') = 'true'` to the existing no-UID rejection → `28000 'Authentication required'`; guard ordered after `assert_actor_not_provisional()` and before validation/lock/writes/replay; wrapper `onboard_player_with_availability` inherits the guard; SECURITY DEFINER / empty `search_path` / grants preserved (proacl snapshot verified). New `test/player.onboarding-authorization.integration.test.ts` (22 tests): simulated authenticated-role anonymous claims (JSON boolean + text forms) rejected on BOTH entry points; rejection-before-writes proven via `pg_current_xact_id_if_assigned() is null` (no xid = no write even in rolled-back subtransactions; DO-block exception recovery instead of client savepoints — `statement_timeout` made failed transactions unrecoverable client-side); missing-UID / no-session (42501) / provisional (42501 `PROVISIONAL_PLAYER_RESTRICTED`) denials; real-auth positive controls (single profile/rating/initialization, availability atomic, replay no-overwrite, invalid availability full rollback). Real anonymous-session coverage is infeasible: `test/stack/supabase/config.toml` disables the provider (`anonymous_provider_disabled` recorded in a test); simulated claims are labeled accurately as such.
- **Unit 2 / PAF-196 (`fa7a7ea`) — bound statistics activity expansion:** new migration `supabase/migrations/20261116091000_statistics_activity_window.sql` — body-only `CREATE OR REPLACE` of `get_player_statistics` (from `20261102105000`); ONLY the activity block + finite-date input bounds changed. Activity window = latest ≤366 inclusive days of scope, clamped `greatest(first_day, last_day - 365)` BEFORE `generate_series` (single series over integer offsets; days ≤366 / weeks ≤54 / months ≤13 by construction, no post-generation LIMIT). New required `activity.window {fromDay, throughDay, maxDays:366, truncated}` metadata; full effective scope kept in `fromDay`/`throughDay`. ALL aggregates remain full-scope (matches/scores/form/rating/relationships); `weeklyAverage` constant-time `(last_day - first_day + 1) / 7`; best week/month computed from grouped STORED buckets + zero-valued first period reproducing gap-filled ordering. Reversed ranges → `22023 STATISTICS_INVALID_INPUT` even with no activity; infinite/nonfinite/year-0000 endpoints rejected before reads; contract documented in the SQL header. Client: `PlayerActivityWindow` contract + required decoder validation (`statistics-player.server.ts`); constants 366/54/13 (`statistics-config.ts`); shared `isStatisticsCalendarDate` validator with year ≥ 0001 (`statistics.validators.ts`; no span limit — history/community/relationship APIs unaffected); truncated-only localized note (`PlayerStatistics.tsx` + `StatisticsChart.tsx` via `descriptionId`/`aria-describedby`); `statistics.player.activity.windowNote` added in en/es/pt-BR. New `test/statistics.activity-window.integration.test.ts` (35 tests): 1/5/21-day, exactly-366 (not truncated), 367 (truncated), best periods outside the window, ties, zero-valued first period, sparse multi-year, lifetime/one-ended, zero-activity small + oversized, reversed, infinite endpoints, calendar extremes; JS reference-model cross-check; full security matrix (own/shared OK; cross-player/non-member/revoked `P0002`; no-user + anonymous `28000`; anon role `42501`; provisional `42501`). Synthetic bucket seeding inside rolled-back transactions is a justified deviation (backdating real events would require membership rewrites).
- **Unit 3 / PAF-195 repo-side (`1b07005`) — first production release recovery runbook:** `docs/production-release-runbook.md` §1 pointer + new §12 "First production release recovery (0.3.0)": PR #66 withheld; 0.3.0 is the first production DEPLOYMENT, not the first repo tag; historical `padel-friend-v0.1.0`/`padel-friend-v0.2.0` preserved; escalate if the regenerated version ≠ 0.3.0. Evidenced defect recorded: broken `v0.2.0...v0.3.0` compare (only `padel-friend-v0.2.0` @ `7de183d` exists; ~41 duplicated entries vs the true delta of one commit `f57c687`). One-time correction target: `padel-friend-v0.2.0...v0.3.0` compare link + cumulative labeling, no destructive dedup. Final-generation correction + freeze protocol: correction happens after the last generation; any new `main` commit invalidates it → regenerate/reapply/re-review. Owner-owned preflight + true pending set derived from production history + exactly one `Approved-pending:` marker before environment approval. Identity/freshness/approval gates unchanged; migration vs Worker outcomes recorded separately.
- **Review loop (`6cbdf45`):** full review (code + architecture + UX/UI, run in parallel) at baseline `1b07005` produced 4 findings, all minor/required (evidence in `docs/plan/PAF-198-findings.md`):
  - **F1 — bucket-period validation missing:** per-list decoder validation added + 14 malformed cases.
  - **F2 — deployment compatibility assessment missing:** new runbook §12 subsection — old-Worker + new-DB accepted-with-evidence, bounded to the same-job window + retry case; new-Worker + old-DB fail-closed via the decoder; cron verified non-consumer (six pg_cron jobs enumerated; sole RPC caller `readPlayerStatistics`).
  - **F3 — inexact truncated windows accepted:** exact window + `assertDaysCoverWindow` (exact length / ascending / gap-free / endpoints) + 10 cases (file failed first → 17 passed after).
  - **F4 — window note conflicted with chart sampling (plot shows latest 12 months):** note reworded ×3 locales + UI assertions.
  - Delta reviews (code + architecture + UX/UI) against `git diff 1b07005`: all findings verified fixed, NO new findings, no regressions.

## Files Changed

- Database (2 new forward-only migrations): `supabase/migrations/20261116090000_onboarding_non_anonymous_actor.sql` (PAF-197 anonymous-actor guard); `supabase/migrations/20261116091000_statistics_activity_window.sql` (PAF-196 bounded activity window + `activity.window` metadata).
- Statistics feature: `src/features/statistics/statistics-config.ts` (366/54/13 constants); `src/features/statistics/statistics-player-contracts.ts` (`PlayerActivityWindow` contract); `src/features/statistics/statistics-player.server.ts` (required decoder validation + per-list bucket-period validation F1); `src/features/statistics/statistics.validators.ts` (`isStatisticsCalendarDate`, year ≥ 0001); `src/features/statistics/PlayerStatistics.tsx` + `src/features/statistics/StatisticsChart.tsx` (truncated note, `descriptionId`/`aria-describedby`, F4 assertions).
- i18n: `src/locales/{en,es,pt-BR}/translation.json` — `statistics.player.activity.windowNote` (reworded in the F4 fix round).
- Docs: `docs/production-release-runbook.md` (§1 pointer + new §12 first-production-release recovery incl. F2 deployment-compatibility subsection).
- Tests: `test/player.onboarding-authorization.integration.test.ts` (new, 22 tests); `test/statistics.activity-window.integration.test.ts` (new, 35 tests); `test/helpers/player-statistics-fixtures.ts`; `test/statistics.player.functions.test.ts`; `test/statistics.player.ui.test.tsx`; `test/statistics.validators.test.ts` (decoder/validator hardening + F1/F3 cases).

## Key Decisions

- **Bounded visualization + truthful metadata** over range rejection or pagination: preserves the lifetime/open-ended API contracts while making the generated series finite by construction; the response now carries `activity.window` so clients can disclose truncation honestly.
- **Body-only `CREATE OR REPLACE` migrations** (forward-only): existing grants/proacl are preserved and no destructive DDL ships; both migrations re-emit only the function body of the latest prior definition.
- **Database-boundary enforcement for both security fixes:** the anonymous-actor rejection and the window bound live in the RPCs, so every caller path (app, wrapper, future clients) is covered; the wrapper inherits the guard without its own migration.
- **Decoder strictness as a fail-closed contract pin:** the client decoder requires `activity.window` and validates it (exact length/ascending/gap-free after F3), so a new-Worker + old-DB combination fails closed instead of rendering an unbounded or unlabeled series.
- **Rejection-before-writes proven by transaction xid:** `pg_current_xact_id_if_assigned() is null` proves no write happened even inside rolled-back subtransactions; DO-block exception recovery replaced client savepoints after `statement_timeout` made failed transactions unrecoverable client-side.
- **Simulated anonymous claims, labeled accurately:** the test stack disables the anonymous provider, so real anonymous-session coverage is impossible locally; simulated authenticated-role claims are used and explicitly labeled, with the `anonymous_provider_disabled` fact recorded in a test.
- **Synthetic bucket seeding inside rolled-back transactions (justified deviation):** backdating real events would require membership rewrites; seeded buckets inside rolled-back transactions exercise the SQL aggregation without polluting state.
- **Correction-after-last-generation protocol for Release Please:** the published-notes correction is defined to run after the final generation, with any new `main` commit invalidating and forcing regenerate/reapply/re-review — avoids fighting the release automation mid-flight.

## Validation Performed

- **Fast gates green on every unit:** typecheck, lint `--deny-warnings`, oxfmt, `db:types:check` — all exit 0 at each unit's code state.
- **Per-unit integration on the isolated test stack** (serial, exactly one `db:reset` per code state; single-run policy respected):
  - PAF-197: 22/22 onboarding-authorization suite + 71 tests across 7 existing suites (regression).
  - PAF-196: 35/35 activity-window suite; 41/41 with `player.reads`; 64/64 statistics integration regression; 150 + 541 unit tests (`test/statistics` + locale suites); 70/70 validators.
  - Fix round (`6cbdf45`): 32 decoder/validator tests + 69 with UI + 25 i18n tests (incl. F1's 14 malformed cases and F3's 10 exact-window cases — file failed first, then 17/17 passed).
- **Review:** full parallel review (code + architecture + UX/UI) at baseline `1b07005` → 4 findings, all minor/required, all fixed in `6cbdf45`; delta reviews (all three disciplines) against `git diff 1b07005` → verified-fixed, no new findings, no regressions.
- **Pending at log time:** full `pnpm complete-check` is reserved for the final delivery state per the single-run policy (each per-unit gate ran once per code state; the combined gate runs once on the final state).

## Risks and Follow-ups

- **Owner-gated remainder (plan gates O1–O4 — release actions, NOT follow-up issues):** release PR #66 merge/publication; published-notes correction under the freeze protocol; production preflight + true pending set + exactly one `Approved-pending:` marker before environment approval; environment approval; deployment; migration vs Worker outcome verification (per runbook §12).
- **Real anonymous-session coverage gap:** unavailable under the current test-stack config (anonymous provider disabled by design); simulated-claims coverage delivered and accurately labeled — revisit only if the test stack ever enables the provider.
- **Old-Worker + new-DB disclosure window:** for the minutes between migration apply and Worker deploy inside one gated job (plus the retry case), the old Worker renders the bounded series without the truncation disclosure — accepted-with-evidence, documented in runbook §12; new-Worker + old-DB fails closed via the decoder.
- **Full `pnpm complete-check` pending at log time** on the final state (single-run policy); per-unit gates all green as recorded above.
