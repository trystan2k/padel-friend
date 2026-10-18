---
title: PAF-5 Register Players, Approve Requests, and Form FIFO Quartets
type: development-log
permalink: docs/development-logs/task-PAF-5-register-players-approve-requests-and-form-FIFO-quartets
---

# Development Log: PAF-5

## Metadata

- Task ID: PAF-5 (T05 — Register players, approve requests, and form FIFO quartets; epic-scope parent) delivered as child units PAF-78…PAF-83 (PAF-5.1…PAF-5.6) plus two fix iterations
- Date (UTC): 2026-10-18
- Project: padel-friend
- Branch: feature/PAF-5-fifo-quartet-registration (base `44e8197` = `origin/main`; delivery complete except the final push and PR, which are pending user approval)
- Commits (8, delivery order): `2c0c0ce` (PAF-78 / 5.1), `54ce88c` (PAF-79 / 5.2), `f9ed22d` (PAF-80 / 5.3), `0ebe502` (PAF-81 / 5.4), `6e7668f` (PAF-82 / 5.5), `f6f919b` (PAF-83 / 5.6), `2d4495f` (fix iteration 1), `7e5ef81` (fix iteration 2, HEAD)
- Working tree at logging time: not independently verified — shell execution was denied in the logging environment; the bundle records `docs/plan/**`, `docs/design/padel-friend.pen` and `.opencode/**` as excluded from commits
- Linear: PAF-5 with children PAF-78…PAF-83; one branch, one pull request (push + PR pending user approval)
- Artifacts: plan `docs/plan/Plan PAF-5 T05 — Register players, approve requests, and form FIFO quartets.md`, bundle `docs/plan/PAF-5-bundle.md`, findings ledger `docs/plan/PAF-5-findings.md` (F1–F34)

## Objective

- A signed-in, eligible in-range member registers directly for a published match event; an out-of-range member or Public-community guest requests creator approval; a Private-community nonmember cannot request. The creator approves/rejects requests, FIFO quartets form atomically (`floor(N/4)*4` playing, latest incomplete quartet in Reserve, fourth acceptance promotes all four), and at cutoff new joins stop, pending requests expire, remaining Reserve become Reserve Not Playing with in-app alerts — with states, counts and translated copy matching the approved Pencil designs (AC1–AC6).

## Implementation Summary

- **Unit 1 — PAF-78 (PAF-5.1), commit `2c0c0ce` — registration domain model and accepted-only projections.**
  - Lifecycle/participation/source enums, anchor constraints, `match_event_registration_state` + `match_event_registration_attempts` tables, identity guard, accepted-only read projections, role-matrix and schema integration suites.
- **Unit 2 — PAF-79 (PAF-5.2), commit `54ce88c` — action RPCs, typed layer, notification copy.**
  - Action RPCs (submit / decide / own-state / creator queue), lock order, ordinal allocation, idempotent replay, re-application, pending-row read-policy narrowing, typed model + validators + server functions, kind-aware notification copy.
- **Unit 3 — PAF-80 (PAF-5.3), commit `f9ed22d` — FIFO reconcile engine with atomic promotion effects.**
  - `match_registration_roster`/`_counts` as single source of truth, one reconcile helper, atomic quartet promotion, revision-keyed notification effects, projection centralisation.
- **Unit 4 — PAF-81 (PAF-5.4), commit `0ebe502` — cutoff processor, scheduler, Reserve Not Playing.**
  - Cutoff processor + bounded catch-up batch, guarded pg_cron schedule, `reserve_not_playing` state with flat counts/badge, cutoff notification kinds, boundary/concurrency/rollback suites.
- **Unit 5 — PAF-82 (PAF-5.5), commit `6e7668f` — registration panel, creator queue, accepted roster.**
  - Registration panel + creator request queue + accepted roster, mutation controllers, route wiring, i18n across en/pt-BR/es, component/controller/route suites.
- **Unit 6 — PAF-83 (PAF-5.6), commit `f6f919b` — E2E journeys, visual gate, references.**
  - Functional E2E journeys, visual gate (structural probes + calibrated pixel budgets), exported design references + manifest, reviewed PAF-4 spec/manifest updates.
- **Fix iteration 1 — commit `2d4495f`.**
  - knip dead export; mis-scoped backfill oracle (F15); duplicated invitation copy (F16 — real UX defect: the panel re-rendered the identical invitation paragraph, product fix + restored strict locator + regression test); detail link-count probe updated for the intentional contract change.
- **Fix iteration 2 — commit `7e5ef81` — review findings F20–F34.**
  - F20 (critical): domain migration dropped the legacy `match_registration_immutable` trigger AFTER its backfill UPDATEs, which would abort with `23514` on any populated database while passing on an empty local reset — trigger now dropped first, abort reproduced on a populated predecessor DB, then fixed order proven.
  - F21: `decide_match_registration` identified the requester by user, not attempt — a stale decision could resolve a re-applied attempt unreviewed; now bound to the immutable attempt id; creator queue exposes `requests[].attempt_id`.
  - F22: unbounded `setTimeout` cutoff countdown overflowed browser timers beyond ~24.8 days, closing registration immediately; now polls in bounded segments and only marks reached after checking the real deadline.
  - F23: own-registration read returned the STORED `pending` lifecycle after cutoff; now projects the DB-time effective expiry, write-free.
  - F24: batch cutoff failures were discarded so cron reported success; now persists per-event failure count/sqlstate/message on the state row; `INITIAL_SETUP.md` updated.
  - F25: oldest-first fixed-LIMIT catch-up let 25 failing/lock-skipped events permanently starve later due events; selection now fair via an attempt cursor, with a poisoned-prefix test.
  - F26: a failed registration read was silently swallowed, removing the panel with no error or retry; now forwarded and rendered as an accessible retry region.
  - F27: direct joins and the creator's own slot rendered the APPROVED badge and "Approved at …" copy with null `approved_at`; now three distinct variants (creator / approved / direct join) that never render a nonexistent timestamp.
  - F28: action error codes were interpolated into camelCase translation keys, rendering raw keys; now one exhaustive code→key map shared by panel and queue, with copy in all three locales.
  - F29: reserve notification always claimed present-tense reserve placement, clamping promoted players to `#1`; now gated on current participation with honest historical wording.
  - F30: blanket `reserve` backfill diverged from the derived roster, emitting false historical promotion/quartet alerts on first reconcile of an upgraded database; backfill now derives playing/reserve cutoff-aware, first reconcile is a verified no-op.
  - F31: every out-of-range request was described as "above your range"; now distinct above-range / below-range / unrated / member contexts.
  - F32: page-wide zero-button assertion collided with the "Load more" pagination control; now scoped by exact localized name.
  - F33 (open): backfill test inserted already-correct ordinals instead of executing the real backfill; a new suite executes the actual migration statements in file order against a rolled-back populated fixture; full `supabase migration up` upgrade coverage in CI still missing.
  - F34: E2E fixtures asserted APPROVED wording for rows seeded as direct joins — the visual gate was validating the very defect F27 describes; fixtures now genuinely seed `approved_at = accepted_at` where frames depict the approved state, and direct joins assert the joined/created copy.

## Files Changed

- Migrations (new): `supabase/migrations/20261017173426_match_registration_domain.sql`, `20261017180000_match_registration_projections.sql`, `20261017190000_match_registration_functions.sql`, `20261017200000_match_registration_fifo.sql`, `20261017210000_match_registration_cutoff.sql`, `20261017220000_match_registration_cutoff_scheduler.sql`, `20261018073908_match_registration_not_playing_projection.sql`, `20261018120000_match_registration_accepted_roster.sql`; plus `supabase/seed.sql` (local-only scheduler unscheduling) and `INITIAL_SETUP.md`.
- Generated types: `src/lib/supabase/database.types.ts` (regenerated).
- Matches feature (`src/features/matches/`): `match-registration-model.ts`, `match-registration.validators.ts`, `match-registration.functions.ts`, `match-registration.styles.ts`, `use-match-registration.ts`, `MatchRegistrationPanel.tsx`, `MatchRequestQueue.tsx`, `MatchDetailPage.tsx`, `MatchCard.tsx`, `match-model.ts`.
- Notifications feature (`src/features/notifications/`): `NotificationDetailPage.tsx`, `notification-target.ts`, `notifications.functions.ts`.
- Route: `src/routes/_protected.matches.$eventId.tsx`.
- Locales: `src/locales/{en,pt-BR,es}/translation.json`.
- Tests — new: `test/matches.registration.*` (schema, visibility, validators, functions, actions, model, fifo, notifications, cutoff, panel, queue, controller, route, roster), `test/helpers/match-registration-sql.ts`; narrow updates to `matches.discovery`, `matches.model`, `matches.list`, `notifications.detail`, `notifications.center`, `matches.visibility`, `matches.photo`, `matches.prune-scoping`, `db-types`.
- E2E: `e2e/matches-registration.spec.ts`, `e2e/matches-registration-visual.spec.ts`, `e2e/matches-visual.spec.ts` (reviewed update), `e2e/matches.spec.ts` (reviewed update), `e2e/global-setup.ts`, `e2e/references/paf-5/**` + manifest, `e2e/references/paf-4/manifest.json` + one re-derived baseline.
- Docs/artifacts: `docs/plan/PAF-5-bundle.md`, `docs/plan/PAF-5-findings.md`, `docs/plan/Plan PAF-5 T05 — Register players, approve requests, and form FIFO quartets.md`.

## Key Decisions

- **Withdrawal is out of scope for all of PAF-5** — T06 owns it. No `withdrawn` lifecycle value anywhere.
- **Re-application after rejection or expiry is allowed before cutoff**; a new attempt gets a new `requested_at` and, if approved, a new accepted order. The canonical row keeps `UNIQUE (match_event_id, user_id)`; per-attempt history lives in `match_event_registration_attempts`.
- **Cutoff scheduler = Supabase pg_cron at 1-minute cadence with a ~2-minute alert latency budget**; the hard close stays exact at the cutoff instant via the DB clock under lock. Catch-up batch required. The local seed deliberately unschedules the job so a live 1-minute job cannot mutate fixtures mid-suite; hosted keeps the migration-created job (F19, accepted).
- **Design frames are the visual source of truth**: 8 new Pencil frames added and verified (101 top-level frames, existing assets untouched), exported as references driving the visual gate's structural probes + calibrated pixel budgets.
- **FIFO correctness concentrated in SQL**: `match_registration_roster`/`_counts` as the single source of truth, one reconcile helper, atomic quartet promotion (fourth acceptance promotes all four in one transaction with rollback proof), revision-keyed notification effects.
- **Findings F7/F8/F12/F13/F14/F19 deliberately deferred** (design-library duplication, bottom-nav icon nits, false-positive RLS advisory, pre-existing F12 cross-suite leak, local scheduler unscheduled); F17 (frame-approved self-link) and F18 (visual fixtures outside the global prune) left open pending review.

## Validation Performed

- Per-unit fast gates: all six units passed `pnpm typecheck` + `pnpm lint` + affected suites at their unit commits (details in the ledger unit log; integration suites run with `--no-file-parallelism` because the local stack flakes under file parallelism). Notables: PAF-79 concurrency deterministic over 10 runs; PAF-80 N=1..13 oracle, 5 proven-overlap races × 10 consecutive runs deterministic, atomic rollback proven; PAF-81 cutoff suite 15/15 across 5 consecutive runs; PAF-83 functional E2E 12/12 twice, visual gate 7/7 + PAF-4 visual 11/11.
- Authoritative full gate, run once (`pnpm complete-check`): `db:types:check`, `build`, `typecheck`, `lint`, `format:check` PASS; `knip`, `test`, `test:e2e` FAIL. Delivery-caused failures fixed in the fix loop; remainder environmental/pre-existing (local GoTrue `AuthRetryableFetchError 500` under 94 parallel workers, Postgres `57014` statement timeouts, the F12 forced-failure trigger leak, one transient Postgres connection timeout that aborted a serial E2E block — those 3 journeys re-run and pass). **The full gate has NOT been re-run since the fix loop — deliberate user decision point.**
- Per-stage re-run: knip PASS; whole vitest suite 844/844 PASS; E2E had one stale test contract (the intentional link-count change; probe updated).
- Review phase: code, architecture and UX/UI reviewers produced findings F20–F33 (1 critical, 9 major, 4 minor) plus F34 found via fixture validation; fix iteration 2 (`7e5ef81`) resolved F20–F32 and F34; F33 partially addressed and open.
- Final verification sweep: 16 registration suites (157 tests), 12 notification suites (85 tests), 6 matches/i18n suites (51 tests), and all three E2E specs passing (12 + 7 + 10).
- Visual gate records 5 honest deviations from the frames (CTA width, roster viewer scope, roster row heights, not-playing tail timing, uncropped 872px frames) — reported, not absorbed into tolerances.

## Risks and Follow-ups

- **Final push and PR are pending user approval** — delivery otherwise complete. PR description should link PAF-5; the identifier must not appear in the PR title or commit subjects/bodies.
- **Full gate not re-run since fix iteration 2** — a second `pnpm complete-check` invocation is a user decision before merge.
- Open findings: F17 (accepted-state "View group" self-link, design-approved in frame Za6r4), F18 (visual-spec fixture events created outside the `global-setup.ts` prune, can leak between runs and trip other suites' whole-DB assertions), F33 (real `supabase migration up` upgrade coverage in CI missing).
- Deferred findings F7/F8/F12/F13/F14/F19 (see `docs/plan/PAF-5-findings.md`).
- The unattended pg_cron cadence is never exercised locally (seed unschedules the job); the processor and batch catch-up are tested by direct invocation.
- Engineering lessons worth remembering: a migration that passes on an empty local reset can still abort on any populated database (F20 — order trigger-drop before backfill); a whole-database test oracle is tripped by directly-inserted fixture rows — scope invariants to the fixture under test (F15); visual fixtures can end up asserting the exact wording of a known defect, so the visual gate validates the bug rather than the design (F34).

## Related

- Linear: PAF-5 (children PAF-78, PAF-79, PAF-80, PAF-81, PAF-82, PAF-83)
- Artifacts: `docs/plan/Plan PAF-5 T05 — Register players, approve requests, and form FIFO quartets.md`, `docs/plan/PAF-5-bundle.md`, `docs/plan/PAF-5-findings.md` (F1–F34)
- Depends/prev: T04/PAF-4 (events, discovery, invitations); next: T06 owns withdrawal
- One memory per task policy: this epic-level log carries the sub-issues' details
