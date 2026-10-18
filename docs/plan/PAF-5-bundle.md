# PAF-5 Context Bundle

Single context artifact for every reviewer and fixer of the PAF-5 delivery. Written once; only the gate-result lines get updated.

## Scope

**PAF-5 — T05 — Register players, approve requests, and form FIFO quartets** (Linear PAF-5, epic-scope parent with 6 child units).

**Delivered as 6 units**, each its own commit on `feature/PAF-5-fifo-quartet-registration`:

| Unit | Linear | Commit | Scope |
| ---- | ------ | ------ | ----- |
| PAF-5.1 | PAF-78 | `2c0c0ce` | Registration domain model: lifecycle/participation/source enums, anchor constraints, registration-state + attempt-history tables, identity guard, accepted-only read projections, role-matrix + schema suites |
| PAF-5.2 | PAF-79 | `54ce88c` | Action RPCs (submit / decide / own-state / creator queue), lock order, ordinal allocation, idempotent replay, re-application, pending-row read-policy narrowing, typed model + validators + server functions, kind-aware notification copy |
| PAF-5.3 | PAF-80 | `f9ed22d` | FIFO quartet engine: `match_registration_roster`/`_counts` as single source of truth, single reconcile helper, atomic quartet promotion, revision-keyed notification effects, projection centralisation |
| PAF-5.4 | PAF-81 | `0ebe502` | Cutoff processor + bounded catch-up batch, guarded pg_cron schedule, `reserve_not_playing` state with flat counts/badge, cutoff notification kinds, boundary/concurrency/rollback suites |
| PAF-5.5 | PAF-82 | `6e7668f` | Registration panel + creator request queue + accepted roster, mutation controllers, route wiring, i18n across en/pt-BR/es, component/controller/route suites |
| PAF-5.6 | PAF-83 | `f6f919b` | Functional E2E journeys, visual gate (structural probes + calibrated pixel budgets), exported design references + manifest, reviewed PAF-4 spec/manifest updates |
| Fix loop 1 | — | `2d4495f` | knip dead export, mis-scoped backfill oracle, duplicated invitation copy, detail link-count probe |

**Plan file**: `docs/plan/Plan PAF-5 T05 — Register players, approve requests, and form FIFO quartets.md` (implementation steps 1–6, invariants, per-unit checkpoints).
**Findings ledger**: `docs/plan/PAF-5-findings.md` (19 findings; unit log; full-gate result; design frame registry).
**Base**: `origin/main` @ `44e8197`. **Diff**: `git diff origin/main..HEAD` (7 commits, 4 files excluded from commits: `docs/plan/**`, `docs/design/padel-friend.pen`, `.opencode/**`).

## Binding product decisions (user-approved)

1. **Withdrawal is OUT of scope for all of PAF-5** — T06 owns it. No `withdrawn` lifecycle value anywhere.
2. **Re-application after rejection or expiry is allowed before cutoff**; a new attempt gets a new `requested_at` and, if approved, a new accepted order. Canonical row keeps `UNIQUE (match_event_id, user_id)`; per-attempt history lives in `match_event_registration_attempts`.
3. **Cutoff scheduler = Supabase pg_cron, 1-minute cadence, ~2-minute alert latency budget**; the hard close stays exact at the cutoff instant via the DB clock under lock. Catch-up required.
4. **Design frames are the visual source of truth**; 8 new frames were added and verified (101 top-level frames, existing assets untouched).

## Parent acceptance criteria → responsible units

| AC | Statement | Units | Evidence |
| -- | --------- | ----- | -------- |
| AC1 | Eligible in-range member registers directly; out-of-range member and Public guest request creator approval; Private nonmember cannot request | 5.1, 5.2, 5.5, 5.6 | Role-matrix suite, action integration suite, E2E journeys |
| AC2 | Guest/out-of-range FIFO starts at approval timestamp; request timestamp never holds a place or creates membership | 5.1, 5.2, 5.3, 5.6 | Anchor CHECK, idempotent replay tests, FIFO integration suite, E2E |
| AC3 | Playing count is `floor(N/4)*4`; latest incomplete quartet is Reserve; the fourth acceptance promotes all four atomically | 5.2, 5.3, 5.5, 5.6 | N=0…13 model suite, promotion/rollback integration, concurrency proof, E2E two-quartet journey |
| AC4 | Duplicate registration/request rejected; explicit maximum capacity enforced atomically; four players do not close an unlimited event | 5.1, 5.2, 5.3, 5.6 | Unique identity, capacity race tests, unlimited-event tests, E2E full-capacity journey |
| AC5 | At cutoff new joins stop, pending requests expire, remaining Reserve become Reserve Not Playing, complete quartets remain playable; affected users get in-app alerts | 5.3, 5.4, 5.5, 5.6 | Cutoff boundary/concurrency/rollback suites, effective-status-on-read tests, E2E due-cutoff journey |
| AC6 | Playing/Reserve/guest/request states and counts match approved Pencil designs and translated copy | 5.2–5.6 | Frame-verified references, visual gate structural probes, locale parity tests |

## Fast-gate result per unit

All six units: `pnpm typecheck` PASS, `pnpm lint` PASS, affected suites green at the time of the unit commit (details in the ledger's unit log). Integration suites are run with `--no-file-parallelism` because the local stack flakes under file parallelism.

## Authoritative full-gate result (run once, `pnpm complete-check`)

`db:types:check` PASS · `build` PASS · `knip` FAIL→fixed · `typecheck` PASS · `lint` PASS · `format:check` PASS · `test` FAIL · `test:e2e` FAIL.

Failure classification recorded in the ledger: delivery-caused failures fixed in the fix loop (knip dead export F15-adjacent, mis-scoped oracle F15, duplicated copy F16, intentional link-count contract change); remainder environmental/pre-existing — local GoTrue `AuthRetryableFetchError 500` under 94 parallel workers, Postgres `57014` statement timeouts in community suites, the documented F12 forced-failure trigger leak, and one transient local Postgres connection timeout that aborted a serial E2E block (those three journeys were re-run and pass).

**The full gate has NOT been re-run since the fix loop** — that is a deliberate user decision point.

## Changed-file map (review scope)

- `supabase/migrations/`: 6 new migrations — `20261017173426_match_registration_domain.sql`, `20261017180000_match_registration_projections.sql`, `20261017190000_match_registration_functions.sql`, `20261017200000_match_registration_fifo.sql`, `20261017210000_match_registration_cutoff.sql`, `20261017220000_match_registration_cutoff_scheduler.sql`, `20261018073908_match_registration_not_playing_projection.sql`, `20261018120000_match_registration_accepted_roster.sql`; plus `supabase/seed.sql` (local-only scheduler unscheduling) and `INITIAL_SETUP.md`.
- `src/features/matches/`: `match-registration-model.ts`, `match-registration.validators.ts`, `match-registration.functions.ts`, `match-registration.styles.ts`, `use-match-registration.ts`, `MatchRegistrationPanel.tsx`, `MatchRequestQueue.tsx`, `MatchDetailPage.tsx`, `MatchCard.tsx`, `match-model.ts`.
- `src/features/notifications/`: `NotificationDetailPage.tsx`, `notification-target.ts`, `notifications.functions.ts`.
- `src/routes/_protected.matches.$eventId.tsx`.
- `src/lib/supabase/database.types.ts` (regenerated).
- `src/locales/{en,pt-BR,es}/translation.json`.
- Tests: `test/matches.registration.*` (schema, visibility, validators, functions, actions, model, fifo, notifications, cutoff, panel, queue, controller, route, roster), `test/helpers/match-registration-sql.ts`, plus narrow updates to `matches.discovery`, `matches.model`, `matches.list`, `notifications.detail`, `notifications.center`, `matches.visibility`, `matches.photo`, `matches.prune-scoping`, `db-types`.
- E2E: `e2e/matches-registration.spec.ts`, `e2e/matches-registration-visual.spec.ts`, `e2e/matches-visual.spec.ts` (reviewed update), `e2e/matches.spec.ts` (reviewed update), `e2e/global-setup.ts`, `e2e/references/paf-5/**` + manifest, `e2e/references/paf-4/manifest.json` + one re-derived baseline.

## Known accepted deviations (do not re-report as new)

- F7/F8/F13/F14/F19 in the ledger are deferred by decision (design-library duplication, bottom-nav icon nits, false-positive RLS advisory, local scheduler unscheduled).
- F12 is a documented pre-existing cross-suite leak.
- The visual gate records 5 honest deviations from the frames (CTA width, roster viewer scope, roster row heights, not-playing tail timing, uncropped 872px frames) — they were reported, not absorbed into tolerances.
- F17 (accepted-state "View group" link is a self-link) and F18 (visual-spec fixtures outside the global prune) are open by design, pending review.

## Findings ledger format

Findings must be reported one per line as:
`[severity] file:line | short title | suggested fixer`
with `severity` in `critical|major|minor|nit`.
