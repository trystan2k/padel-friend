---
title: PAF-8 T08 Review Dispute and Auto-Confirm Result Proposals
type: development-log
permalink: docs/development-logs/task-PAF-8-t08-review-dispute-and-auto-confirm-result-proposals
---

# Development Log: PAF-8

## Metadata

- Task ID: PAF-8 (T08 — Review, dispute, and auto-confirm result proposals; Linear sub-issues PAF-118…PAF-123 delivered as one commit each, plus 2 review-fix commits and post-review Copilot/CI/test-performance hardening)
- Date (UTC): 2026-10-30 (delivery spanned multiple sessions, 2026-10-28 → 2026-10-30; post-review work Oct 29–30)
- Project: padel-friend
- Branch: `feature/PAF-8-review-dispute-auto-confirm` (from `origin/main` `2540766`; base for PR: `main`)
- Commits (8 delivery, oldest first): `ba73da7` (PAF-118 T08.1 result review + confirmation contract), `f175660` (PAF-119 T08.2 atomic review/correction RPCs), `0bc4134` (PAF-120 T08.3 trusted auto-confirm scheduler), `a608140` (PAF-121 T08.4 lifecycle projections + TS contracts), `294ca68` (PAF-122 T08.5 review UI + E2E + visual certification), `439de9c` (PAF-123 T08.6 notifications + deep links + cross-feature certification), `e23a6b8` (fix: address review findings F1–F8), `0f84f58` (fix: bound alert scheduling fairness). Post-review (Oct 29–30): `cf25736` (fix: Copilot review findings — notification outcome context + agent-doc wording), `ad70940` (fix: races test oracle — filter reminders by transition timestamp), test-performance round culminating at branch HEAD `293c4f2`
- Diff: 104 files, +14811/−572 vs `origin/main` at PR open; post-review commits (`cf25736`, `ad70940`, HEAD `293c4f2`) added further hardening on top
- Artifacts: plan `docs/plan/Plan PAF-8 T08 — Review, dispute, and auto-confirm result proposals.md` (authoritative, committed in final sweep), delivery bundle `docs/plan/PAF-8-bundle.md` and findings ledger `docs/plan/PAF-8-findings.md` (session artifacts — never committed; deleted after PR opens)
- Related Linear: PAF-8 (epic), PAF-118, PAF-119, PAF-120, PAF-121, PAF-122, PAF-123 (all In Review under PAF-8); follow-up PAF-124 (dedicated test Supabase stack, Backlog); PR #35 In Review awaiting human merge

## Objective

- Close T08: submitted teams/scores are not official until eligible players confirm or a trusted 48h deadline passes. Deliver the full review → dispute → correction → auto-confirm lifecycle so each Game Group reaches an auditable confirmed/disputed state exactly once, with one idempotent confirmation identity consumable downstream by T10/T12/T13 — across schema/contract, atomic RPCs, trusted scheduler, projections/TS contracts, review UI, and notifications/deep links — in one branch/PR with review findings resolved and no coverage or budget relaxations.

## Implementation Summary

- **Unit 1 — PAF-118 T08.1, commit `ba73da7` (18 files) — result review + confirmation contract.**
  - Migration `20261028180302_result_review_confirmation_contract.sql`: pointer transition guard, version provenance backfill, review/confirmation/processing-state tables, revoked shared finalizer, official-read seam, command/audit contract extension, RLS/ACLs.
  - `.pen` + both visual manifests updated with the approved frame digest; fixture/cleanup and schema/confirmation integration tests; generated db types.
- **Unit 2 — PAF-119 T08.2, commit `f175660` (7 files) — atomic review/correction RPCs.**
  - Migration `20261028191205_match_result_review_commands.sql`: review + correct RPCs with replay/expected-version contracts, eligibility matrix, PRD reason tokens, same-transaction manual confirmation; deterministic separate-connection race suites.
- **Unit 3 — PAF-120 T08.3, commit `0bc4134` (7 files) — trusted auto-confirm scheduler.**
  - Migrations `20261028193703_match_result_auto_confirm_processing.sql` + `20261028194235_match_result_auto_confirm_scheduler.sql`: bounded fair processor, named minute pg_cron job `padel-friend-match-result-auto-confirm`, version-scoped retry state, trusted DB-clock fixtures, INITIAL_SETUP runbook. Live local pg_cron proof: jobid=2 active, runid=6 succeeded.
- **Unit 4 — PAF-121 T08.4, commit `a608140` (27 files) — lifecycle projections + TS contracts.**
  - Migration `20261028200000_match_result_lifecycle_projections.sql`: SQL capabilities/coverage/dispute-evidence/timeline reads, `result_resolution` summary, official reader keyed by `confirmation_id`; TS decoders/validators/server functions; en/pt-BR/es copy; loader; knip fix (removed unconsumed conflict-code alias).
- **Unit 5 — PAF-122 T08.5, commit `294ca68` (36 paths) — review UI.**
  - `MatchResultReview`/`RejectDialog`/freshness + review hooks; capability-driven actions, rejection reason dialog, corrections with fresh timers, mixed-group cards, parent badge, countdown seeded from SSR `as_of`.
  - 6 real-actor E2E journeys (`e2e/matches-results-review.spec.ts`); PAF-8 visual suite `e2e/matches-results-paf8-visual.spec.ts` + `e2e/references/paf-8/` (8 frames, structural probes + documented nonzero budgets); fixture cleanup learns result-review children.
- **Unit 6 — PAF-123 T08.6, commit `439de9c` (31 paths) — alerts / deep links / cross-feature certification.**
  - Migration `20261029100000_match_result_notifications.sql`: transactional `persist_notification` triggers, 5 event keys (result.submitted/disputed/confirmed/deadline/entry_ready), `notification_result_links`, entry-ready dispatch dedupe, bounded reminder + entry-ready producers, pending-only backfill.
  - Validated target RPC v3 (superseded dead V2 wrapper removed); deep links with stale-version handling; notification E2E journeys; cleanup linkage rows.
- **Review fix 1 — commit `e23a6b8` — findings F1–F8 from `docs/plan/PAF-8-findings.md`, all fixed (ledger CLOSED: 8 findings, 14 rounds, both review lenses).**
  - F1 (major) replay identity: proposal-scoped replay identity on both RPCs + legacy payload comparison minus `proposal_id`, receipt identity retained.
  - F2 (major) entry-ready readiness: readiness derived from post-cutoff playable roster (submission parity), roster-fingerprint terminal ineligibility with reactivation, partial active-queue pre-filter.
  - F3 (minor) countdown: monotonic `performance.now()` seeding keyed to proposal+version+asOf, reseed on all three.
  - F4 (minor) reminder fanout: defer-on-canonical-lock-failure 120–180s (> 60s cadence, deterministic jitter) with scan-continue; dual-budget resume/head claims; exhaustion-resume cursor; `p_max_examined` safety valve; documented SLA.
  - F5 (major) retry/starvation: nonblocking NOWAIT bookkeeping with nested isolation, quarantine exponential recovery backoff (1h→24h cap, same-identity recovery), hard-reserved head-phase examination capacity, bounded fingerprint (78.4× measured, asserted ≥10×).
  - F6 (major) freshness: focus/visibility/online listeners active for all lifecycle states; polling + deadline pending-only; cleanup on unmount/version change.
  - F7 (major) visual probes: exact geometry probes — GMcbD group cards (order/dimensions/no-overlap/containment 1–2px), H6VcqC dialog rows/note/footer, BcpYH confirmed-card containment + section ordering + non-overlap + conditional timeline; budgets unchanged with measured rationale.
  - F8 (minor) announcements: terminal announcement independent of proposal version; survives terminal transitions and correction refresh; replaced only by next action.
- **Review fix 2 — commit `0f84f58` — alert scheduling fairness redesign (F4/F5 hardening).**
  - 14-iteration fairness redesign: defer-on-canonical-lock-miss 120–180s > 60s cadence; dual-budget resume/head claims; exhaustion-resume cursor + `p_max_examined` safety valve (default 1000, clamp 1–10000); quarantine recovery backoff 1h→24h; hard-reserved head examination capacity; bounded fingerprint (≤4 playing ids + roster revision); documented SLA T+(D/C)×interval+defer_max with capacity/arrival/lock-lifetime assumptions.
- **Post-review 1 — commit `cf25736` — Copilot review resolution (PR #35), 4 findings (2 low + 2 medium), all fixed.**
  - Low: stale pre-push wording in `.opencode` agent instructions (`delivery-orchestrator.md`, `git-specialist.md`) — corrected to unit-only pre-push.
  - Medium: notification outcome labels rendered broken "TEAM A WINS · –" because `winnerSets`/`loserSets` params were never passed. Fixed via SQL `notification_result_links` context `winner_sets`/`loser_sets` derived from immutable version facts with classifier parity, new `NotificationResultOutcome.tsx` component (consumed by notifications center + detail pages), decoder validation, and 3 classifier-boundary regression tests.
  - Copilot re-review: verdict softened to "needs a closer look"; zero new inline findings.
- **Post-review 2 — commit `ad70940` — CI race flake fixed.**
  - Races test counted pre-transition reminders as stale (test-oracle ambiguity exposed by CI timing); oracle now filters by transition timestamp.
- **Post-review 3 — test performance round (user-requested).**
  - Test-time clock seam hardened in scheduler SQL: `match_result_alert_clock()` + `match_result_alert_test_clock` fixture table kept private — all privileges revoked from every role (public/anon/authenticated/service_role), RLS enforced; function falls back to `clock_timestamp()` (fixture table empty in production).
  - Notifications integration 618s → ~67s (~88%) via 25ms lock-barrier polling; full `pnpm test` ~12.5min → ~3.6min.
  - Pre-push hook re-scoped to unit-only (`pnpm test:unit`, ~11s) per user decision; unit timeout 15s (load-heavy jsdom mounts).
  - `pnpm test`/`pnpm test:e2e` now run `pnpm db:reset` first — shared dev/test DB pollution eliminated (root cause of intermittent failures).
  - Sharding ruled out with evidence (45/50 files need primary Auth/PostgREST); recorded as follow-up PAF-124.

## Files Changed

- 104 files total (+14811/−572). Per-unit file lists are recorded in the delivery bundle table `docs/plan/PAF-8-bundle.md` ("Units of work — commits, file scope, gates") and are not duplicated here. Anchor artifacts per unit:
  - T08.1 (`ba73da7`, 18 files): `supabase/migrations/20261028180302_result_review_confirmation_contract.sql`, `.pen` + both visual manifests, schema/confirmation integration tests, db types.
  - T08.2 (`f175660`, 7 files): `supabase/migrations/20261028191205_match_result_review_commands.sql`, RPC command contracts, deterministic race suites.
  - T08.3 (`0bc4134`, 7 files): `supabase/migrations/20261028193703_match_result_auto_confirm_processing.sql`, `supabase/migrations/20261028194235_match_result_auto_confirm_scheduler.sql`, `INITIAL_SETUP.md` runbook.
  - T08.4 (`a608140`, 27 files): `supabase/migrations/20261028200000_match_result_lifecycle_projections.sql`, `src/features` decoders/validators/server functions, `src/lib/supabase/database.types.ts`, en/pt-BR/es locales.
  - T08.5 (`294ca68`, 36 paths): `src/features` review UI components/hooks/styles, `e2e/matches-results-review.spec.ts`, `e2e/matches-results-paf8-visual.spec.ts`, `e2e/references/paf-8/` (8 frames).
  - T08.6 (`439de9c`, 31 paths): `supabase/migrations/20261029100000_match_result_notifications.sql`, notification triggers/producers/backfill, deep-link handling, notification E2E journeys.
  - Review fixes (`e23a6b8`, `0f84f58`): migrations `20261029110000…` scan-core rework, `use-match-result-freshness.ts`, `MatchResultReview.tsx`, `MatchResultPending.tsx`, `e2e/matches-results-paf8-visual.spec.ts` geometry probes, scheduler/producer tests.
- Findings ledger: `docs/plan/PAF-8-findings.md` (F1–F8, all rows fixed with evidence; ledger CLOSED).
- Post-review (`cf25736`, `ad70940`, HEAD `293c4f2`): `.opencode/agents/delivery-orchestrator.md` + `.opencode/agents/subagents/git-specialist.md` (pre-push wording), `src/features/notifications/NotificationResultOutcome.tsx` (+ notifications center/detail page wiring), `supabase/migrations/20261029100000_match_result_notifications.sql` (`winner_sets`/`loser_sets` link context), `supabase/migrations/20261029110000_match_result_notification_review_fixes.sql` (clock seam privilege revocation + `clock_timestamp()` fallback), `test/matches.results.notifications.integration.test.ts` (classifier-boundary + privilege/RLS + real-clock regressions), `test/notifications.center.test.tsx` + `test/notifications.detail.test.tsx` (outcome interpolation), `test/match-alert-queue-clock.test.ts`, `test/helpers/match-result-processing-fixtures.ts`, races E2E oracle, `package.json` scripts (pre-push unit-only, `db:reset`-first, timeouts).

## Key Decisions

- **Rejection pool (user-approved)**: all 4 actual players except submitter (including submitter's teammate); approvals per PRD — opposing team if submitter played, one per team if not; admin gets no vote.
- **Corrections unconfirmed-only (user-approved)**: Pending/Disputed proposals can be corrected to a new version with a fresh 48h window; Confirmed is terminal; post-confirmation amendments are PAF-14, out of scope.
- **Alert defaults (user-approved)**: rejection reason token (PRD §23.7 set) + optional note ≤500 chars (mandatory for `other`); deadline reminder at 6h remaining once/version/reviewer; entry-ready once/event/creator when playable group frozen + scheduled finish reached.
- **Missing Pencil frames (user-approved)**: rejection dialog and partial-resolution frames were created by the design owner via pen.dev prompts and APPROVED by the orchestrator after frame review (`H6VcqC`, `GMcbD`); `.pen` digest `5bc71d38…52ac4d` pinned in both visual manifests — recorded approval, not tolerance widening.
- **Single idempotent confirmation identity**: pointer transition guard + version provenance backfill + revoked shared finalizer + official read keyed by `confirmation_id`, so T10/T12/T13 consume the same identity and no group can confirm twice.
- **Atomic RPC contracts**: expected-version + replay-identity checks inside the same transaction as manual confirmation; race behavior proven with deterministic separate-connection suites instead of timing-dependent tests.
- **Trusted scheduler, bounded fairness**: named minute pg_cron job with version-scoped retry state; after F4/F5, scan core bounded by dual budgets, exhaustion-resume cursor, `p_max_examined` safety valve, quarantine backoff, and a documented SLA — no unbounded scans or starvation.
- **One PR despite size**: the six units form one inseparable schema→RPC→scheduler→projection→UI→alerts chain; per-unit commits preserve review granularity inside the PR (diff exceeds the soft ~1500-line/40-file guideline deliberately).
- **Outcome labels from immutable facts (Copilot medium)**: winner/loser set counts derived in SQL from immutable version facts with classifier parity — labels cannot drift from stored results; decoder validation + 3 boundary regressions lock the contract.
- **Pre-push unit-only (user decision)**: pre-push runs `pnpm test:unit` (~11s); `pnpm complete-check` remains the local final delivery gate and CI still runs all suites.
- **Shared dev/test DB, reset-first**: `pnpm test`/`test:e2e` reset the local DB first (~25s) so tests always start from migrated seed state — eliminates cross-run pollution, the root cause of intermittent failures.
- **Clock seam private, not removed**: scheduler SQL keeps one clock entry point (`match_result_alert_clock()`) with production fallback `clock_timestamp()`; every client role revoked, RLS on the fixture table, regression tests assert both the privilege boundary and real-clock behavior.
- **Sharding rejected with evidence**: 45/50 unit files require primary Auth/PostgREST, so sharding cannot pay off without a dedicated test Supabase stack — recorded as PAF-124 instead of weakening isolation.

## Validation Performed

- Static gates — pass at every commit via hooks; final state `0f84f58`: build, knip, typecheck, lint, format:check all PASS.
- Full `pnpm test` — pass: 50 files / 363 unit+integration tests green on final state.
- E2E `pnpm test:e2e` (serial) — pass on final state: notifications 36/36 + result review 7/7 + PAF-8 visual suites green; earlier full-series runs 249 and 153 green across 8 suites.
- Visual certification — 8/8 PAF-8 frames within documented budgets: H6VcqC .1402/.15, GMcbD .2203/.23, sLXK7 .1662/.18, CWJkF .1538/.17, JXjNs .1463/.16, ausNa .1395/.15, BcpYH .2727/.28, alZmm .1148/.12; PAF-6/PAF-7 references unchanged and passing; exact structural/geometry probes added per F7.
- `pnpm db:types:check` — green at every schema unit.
- pg_cron — local live proof: jobid=2 active, runid=6 succeeded; production provisioning is NOT locally verifiable and is recorded as a deployment-time runbook step (INITIAL_SETUP.md) per plan checkpoint 7.
- Review loop — `docs/plan/PAF-8-findings.md`: 8 findings (F1–F8), 14 verification rounds, both review lenses (code/architecture + UX) closed; ledger CLOSED.

Post-review final state (HEAD `293c4f2`):

- Copilot resolution — 4/4 findings fixed in `cf25736` (2 low + 2 medium); re-review verdict "needs a closer look" with zero new inline findings; threads resolved.
- CI — all 9 checks green on `293c4f2`; PR #35 In Review awaiting human merge.
- `pnpm complete-check` — all 8 stages green: unit 1,400 tests, integration 370 (incl. classifier-boundary regressions), E2E 270/270.
- Performance — notifications integration 618s → ~67s (~88%); full `pnpm test` ~12.5min → ~3.6min; pre-push `pnpm test:unit` ~11s.

## Risks and Follow-ups

- **Production pg_cron provisioning**: auto-confirm does not run in production until the INITIAL_SETUP.md runbook step is executed at deploy time; must be completed before the first real 48h deadline elapses, else results stay pending past their window.
- **Deploy ordering**: migrations (schema → RPCs → scheduler → projections → notifications) must deploy before UI consumers; forward-only migrations; never edit applied history or relax ACLs.
- **Scheduler SLA assumptions**: the documented SLA T+(D/C)×interval+defer_max holds under stated capacity/arrival/lock-lifetime assumptions; monitor first production days (quarantine rate, `p_max_examined` valve hits, reminder/entry-ready fanout timeliness).
- **PR size**: 104 files / +14811−572 exceeds the soft guideline; accepted deliberately (inseparable chain). Reviewers should use the bundle table + per-unit commits.
- **Environment incidents during delivery and review (context, no residual repo impact; all user/restart-resolved)**: Docker/Rancher socket mount failure; macOS TCC revoked `~/.gitconfig` access for shells; transient Supabase service collapse mid-E2E (pooler/edge_runtime).
- **Test flake root cause closed**: intermittent delivery failures traced to shared dev/test DB pollution — eliminated by `db:reset`-first runs; the one CI race flake (`ad70940`) was test-oracle ambiguity, now filtering by transition timestamp. Keep E2E serial via `pnpm test:e2e`; watch for recurrence.
- **Session artifacts**: `docs/plan/PAF-8-bundle.md` deleted after PR open; `docs/plan/PAF-8-findings.md` still present and must be deleted before merge (plan file itself is committed).
- **PR #35 awaiting human merge**: Copilot verdict "needs a closer look", threads resolved, CI green on `293c4f2` — merge is a human decision; no further agent work pending.
- **PAF-124 (Backlog)**: dedicated test Supabase stack — prerequisite for any future sharding/parallelization of unit+integration tests.
- **Out of scope**: post-confirmation amendments (PAF-14); confirmed results are terminal by design.
