---
title: PAF-125 T18 Add Not-Yet-Registered Players to Matches by Name and Email
type: development-log
permalink: docs/development-logs/task-PAF-125-add-not-yet-registered-players-to-matches-by-name-and-email
---

# Development Log: PAF-125

## Metadata

- Task ID: PAF-125 — "T18 - Add not-yet-registered players to matches by name and email" (delivered as six user-approved sub-issues: PAF-126, PAF-127, PAF-128, PAF-129, PAF-130, PAF-131)
- Date (UTC): 2026-10-31
- Project: padel-friend
- Branch: `feature/PAF-125-add-not-yet-registered-players-to-matches-by-name-and-email` (13 commits on `origin/main` base)
- Commits (13, oldest first): `16fbd93` (PAF-126 identity foundation), `0552128` (stray, pre-existing .opencode agent model switch — landed during an interrupted session, unrelated to scope, flagged for user), `ca5aa52` (PAF-127 add command), `cc567f6` (PAF-128 invite email), `7649074` (PAF-130 UI), `55f1f7e` (PAF-129 claim flow), `473dee8` (PAF-131 docs), `140bd8a` (QA fixture + design recert), `f43af31` (review r1–r2 fixes F1–F8), `578d9aa` (r3 fixes F9–F12), `7e87602` (r4 fixes F13–F17), `5131575` (r5 fixes F18–F23), `7f1e538` (r5 fixes F24–F25, HEAD)
- Delivery topology: one branch, one commit per approved sub-issue, one PR (pending at log time)
- Supporting artifacts: plan `docs/plan/Plan PAF-125 T18 ....md`, findings ledger `docs/plan/PAF-125-findings.md`, bundle `docs/plan/PAF-125-bundle.md`

## Objective

- Let match organizers add not-yet-registered players to match events by name and email: provision a permanent identity placeholder at add time, send a localized invite email, and let the invitee claim the account later via verified-email proof — without weakening auth, RLS, anti-enumeration, or audit guarantees.

## Implementation Summary

- **PAF-126 — commit `16fbd93` — identity foundation.**
  - Provisional marker/provenance schema, RLS policies, and SQL actor guards applied across ~50 RPCs.
  - `can_read_match_event` extended for participant visibility; badge flags added; provisioning helpers introduced.
- **Commit `0552128` — stray, out of scope.**
  - Pre-existing `.opencode` agent model switch that landed during an interrupted session; unrelated to PAF-125; flagged for user decision (not silently dropped or absorbed into scope).
- **PAF-127 — commit `ca5aa52` — add command.**
  - `add_match_player` RPC plus an auth-bridge trigger; three-way branch (existing user / provisional / collision); advisory-lock ordering; throttles; audit ledger entries.
  - Server-only admin client and a post-build secret guard to keep service-role credentials out of browser code.
- **PAF-128 — commit `cc567f6` — invite email.**
  - Localized invite email (en / pt-BR / es) via the native Supabase template with per-send metadata; resend refreshes metadata; redirect contract defined; `INITIAL_SETUP.md` §8 documents setup.
- **PAF-130 — commit `7649074` — UI.**
  - `AddMatchPlayerDialog` (Base UI) wired into the organizer menu; `ProvisionalBadge` across surfaces; E2E service-role provisioning; design frame `bobgm` updated and reference recertified (`140bd8a`).
- **PAF-129 — commit `55f1f7e` — claim flow.**
  - Verified-email claim using `amr` proof; restricted claim RPCs; prefilled onboarding with level lock; OAuth same-id linking as a controlled stub; recovery fallback; audit entries.
- **PAF-131 — commit `473dee8` — docs.**
  - PRD updated (§18.3, §12.1, §30.4); PAF-9 / PAF-10 / PAF-11 Linear descriptions amended (append-only).
- **QA — commit `140bd8a`.**
  - Fixture cleanup extended to cover add-player tables; design frame + reference recertified (budget 0.106 per policy).
- **Review loop — commits `f43af31`, `578d9aa`, `7e87602`, `5131575`, `7f1e538`.**
  - Five delta rounds across code / architecture / UX reviewers; findings F1–F25 all resolved with per-finding evidence in the findings ledger.
  - r1–r2 (`f43af31`, F1–F8): claim password reset, session-revocation guard actor `session_revoked`, uniform delivery-failure response, waiter re-drive, OAuth identity rule, invited-match notice, code-point limits, post-claim password step.
  - r3 (`578d9aa`, F9–F12): response-first add flow, post-response dispatch via `waitUntil`, durable sweep + redrive, password-continuity flag + onboarding gating.
  - r4 (`7e87602`, F13–F17): attempt fencing via `dispatch_attempt` token, exhaustion + sweep on reads, honest post-response boundary, audit parser full action set.
  - r5 (`5131575`, F18–F23): live-attempt replay guard, blind exhaustion, Worker cron in `src/server.ts` + `APP_ORIGIN`, claim-notice tokens, E2E reload leg.
  - r5 (`7f1e538`, F24–F25): scheduled sweep failure propagation, http(s)-only `APP_ORIGIN`.
  - F16 dismissed with plan-text evidence (accepted narrowly by architecture reviewer in r4); Q3 (`lint-staged.test.ts`) classified environment-only (sandbox git).

## Files Changed

- Per-commit file counts (13 commits, commit order above): 25, 1, 18, 16, 31, 23, 1, 4, 23, 18, 12, 15, 2 — 189 file-change entries total.
- Named artifacts from the delivery record: `INITIAL_SETUP.md` (§8 invite-email setup; §8.7 APP_ORIGIN/cron per-env), `src/server.ts` (Worker custom entry with scheduled cron handler), `match-add-player.functions.ts` (knip ignore removed once UI consumed it), `lint-staged.test.ts` (environment-blocked locally), PRD sections §18.3/§12.1/§30.4, `docs/design/padel-friend.pen` frame `bobgm` (edited via Pencil MCP only — no raw file edits).
- Scope spans SQL migrations/RLS, RPCs, server functions, invite-email templating, UI components, E2E journeys, fixtures, design references, PRD/setup docs.

## Key Decisions

- Permanent auth UUID for provisional players — no re-keying on claim.
- Uniform anti-enumeration responses: identical body and timing, with email delivery off the response path.
- Sweep-from-server (cron) over a queue; Worker custom entry (`src/server.ts`) for the scheduled handler.
- Knip ignore for `match-add-player.functions.ts` removed once the UI consumed it.
- `.pen` design files edited via Pencil MCP only — no raw edits.
- F16 (ms-latency variance) dismissed per plan §70 content-uniformity AC; accepted narrowly by architecture reviewer in r4.
- Commit `0552128` left flagged for the user rather than silently absorbed — it predates and is unrelated to scope.

## Validation Performed

- Fast gate green every round across the five review iterations.
- Full unit + integration suites green, run serially.
- E2E `matches-provisional` 6/6 — add, claim, reload, and password journeys.
- Visual certification 68/68 (budget 0.106 per policy).
- `pnpm complete-check` running at delivery close; result appended by the orchestrator.
- Deploy-time residual documented: real Cloudflare cron execution + per-env `APP_ORIGIN` (`INITIAL_SETUP.md` §8.7).
- Review loop evidence: all F1–F25 findings resolved with per-finding entries in `docs/plan/PAF-125-findings.md`; F16 dismissed with plan-text evidence; Q3 classified environment-only.

## Risks and Follow-ups

- Real cron execution is verified only at deploy time (Worker scheduled handler + `APP_ORIGIN` per environment).
- `lint-staged.test.ts` is environment-blocked locally (sandbox git) — environment-only, not a product defect.
- Stale-original duplicate-email possibility is documented and accepted (preferred over wrong-settlement risk).
- Audit timeline renderer (labels for the new action types) lands with a future UI consuming `listMatchEventAudit`.
- Stray commit `0552128` (`.opencode` agent model switch) awaits user decision — unrelated to scope but present in branch history.
