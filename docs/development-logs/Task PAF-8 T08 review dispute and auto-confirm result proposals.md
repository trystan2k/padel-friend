---
title: PAF-8 T08 Review Dispute and Auto-Confirm Result Proposals
type: development-log
permalink: docs/development-logs/task-PAF-8-t08-review-dispute-and-auto-confirm-result-proposals
---

# Development Log: PAF-8

## Metadata

- Task ID: PAF-8 (T08 — Review, dispute, and auto-confirm result proposals; Linear sub-issues PAF-118…PAF-123 delivered as one commit each, plus 2 review-fix commits)
- Date (UTC): 2026-10-29 (delivery spanned multiple sessions, 2026-10-28 → 2026-10-29)
- Project: padel-friend
- Branch: `feature/PAF-8-review-dispute-auto-confirm` (from `origin/main` `2540766`; base for PR: `main`)
- Commits (8, oldest first): `ba73da7` (PAF-118 T08.1 result review + confirmation contract), `f175660` (PAF-119 T08.2 atomic review/correction RPCs), `0bc4134` (PAF-120 T08.3 trusted auto-confirm scheduler), `a608140` (PAF-121 T08.4 lifecycle projections + TS contracts), `294ca68` (PAF-122 T08.5 review UI + E2E + visual certification), `439de9c` (PAF-123 T08.6 notifications + deep links + cross-feature certification), `e23a6b8` (fix: address review findings F1–F8), `0f84f58` (fix: bound alert scheduling fairness — HEAD/final state)
- Diff: 104 files, +14811/−572 vs `origin/main`
- Artifacts: plan `docs/plan/Plan PAF-8 T08 — Review, dispute, and auto-confirm result proposals.md` (authoritative, committed in final sweep), delivery bundle `docs/plan/PAF-8-bundle.md` and findings ledger `docs/plan/PAF-8-findings.md` (session artifacts — never committed; deleted after PR opens)
- Related Linear: PAF-8 (epic), PAF-118, PAF-119, PAF-120, PAF-121, PAF-122, PAF-123

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

## Key Decisions

- **Rejection pool (user-approved)**: all 4 actual players except submitter (including submitter's teammate); approvals per PRD — opposing team if submitter played, one per team if not; admin gets no vote.
- **Corrections unconfirmed-only (user-approved)**: Pending/Disputed proposals can be corrected to a new version with a fresh 48h window; Confirmed is terminal; post-confirmation amendments are PAF-14, out of scope.
- **Alert defaults (user-approved)**: rejection reason token (PRD §23.7 set) + optional note ≤500 chars (mandatory for `other`); deadline reminder at 6h remaining once/version/reviewer; entry-ready once/event/creator when playable group frozen + scheduled finish reached.
- **Missing Pencil frames (user-approved)**: rejection dialog and partial-resolution frames were created by the design owner via pen.dev prompts and APPROVED by the orchestrator after frame review (`H6VcqC`, `GMcbD`); `.pen` digest `5bc71d38…52ac4d` pinned in both visual manifests — recorded approval, not tolerance widening.
- **Single idempotent confirmation identity**: pointer transition guard + version provenance backfill + revoked shared finalizer + official read keyed by `confirmation_id`, so T10/T12/T13 consume the same identity and no group can confirm twice.
- **Atomic RPC contracts**: expected-version + replay-identity checks inside the same transaction as manual confirmation; race behavior proven with deterministic separate-connection suites instead of timing-dependent tests.
- **Trusted scheduler, bounded fairness**: named minute pg_cron job with version-scoped retry state; after F4/F5, scan core bounded by dual budgets, exhaustion-resume cursor, `p_max_examined` safety valve, quarantine backoff, and a documented SLA — no unbounded scans or starvation.
- **One PR despite size**: the six units form one inseparable schema→RPC→scheduler→projection→UI→alerts chain; per-unit commits preserve review granularity inside the PR (diff exceeds the soft ~1500-line/40-file guideline deliberately).

## Validation Performed

- Static gates — pass at every commit via hooks; final state `0f84f58`: build, knip, typecheck, lint, format:check all PASS.
- Full `pnpm test` — pass: 50 files / 363 unit+integration tests green on final state.
- E2E `pnpm test:e2e` (serial) — pass on final state: notifications 36/36 + result review 7/7 + PAF-8 visual suites green; earlier full-series runs 249 and 153 green across 8 suites.
- Visual certification — 8/8 PAF-8 frames within documented budgets: H6VcqC .1402/.15, GMcbD .2203/.23, sLXK7 .1662/.18, CWJkF .1538/.17, JXjNs .1463/.16, ausNa .1395/.15, BcpYH .2727/.28, alZmm .1148/.12; PAF-6/PAF-7 references unchanged and passing; exact structural/geometry probes added per F7.
- `pnpm db:types:check` — green at every schema unit.
- pg_cron — local live proof: jobid=2 active, runid=6 succeeded; production provisioning is NOT locally verifiable and is recorded as a deployment-time runbook step (INITIAL_SETUP.md) per plan checkpoint 7.
- Review loop — `docs/plan/PAF-8-findings.md`: 8 findings (F1–F8), 14 verification rounds, both review lenses (code/architecture + UX) closed; ledger CLOSED.

## Risks and Follow-ups

- **Production pg_cron provisioning**: auto-confirm does not run in production until the INITIAL_SETUP.md runbook step is executed at deploy time; must be completed before the first real 48h deadline elapses, else results stay pending past their window.
- **Deploy ordering**: migrations (schema → RPCs → scheduler → projections → notifications) must deploy before UI consumers; forward-only migrations; never edit applied history or relax ACLs.
- **Scheduler SLA assumptions**: the documented SLA T+(D/C)×interval+defer_max holds under stated capacity/arrival/lock-lifetime assumptions; monitor first production days (quarantine rate, `p_max_examined` valve hits, reminder/entry-ready fanout timeliness).
- **PR size**: 104 files / +14811−572 exceeds the soft guideline; accepted deliberately (inseparable chain). Reviewers should use the bundle table + per-unit commits.
- **Environment incidents during delivery (context, no residual repo impact)**: Docker/Rancher socket mount failure mid-delivery (user restarted; recovered); macOS TCC revoked `~/.gitconfig` access for shells (user restored).
- **Test flakes observed (non-reproducing)**: 5 interaction timeouts and parallel E2E fixture conflicts during delivery; all serial runs green — watch for recurrence and keep E2E serial via `pnpm test:e2e`.
- **Session artifacts**: `docs/plan/PAF-8-bundle.md` and `docs/plan/PAF-8-findings.md` are untracked and must be deleted after the PR opens (plan file itself is committed).
- **Out of scope**: post-confirmation amendments (PAF-14); confirmed results are terminal by design.
