---
title: PAF-171 Stabilize serial-lane e2e specs (push/pwa SW timeouts and legacy rotating flakes)
type: development-log
permalink: docs/development-logs/task-PAF-171-stabilize-serial-lane-e2e-specs-push-pwa-sw-timeouts-and-legacy-rotating-flakes
---

# Development Log: PAF-171

## Metadata

- Task ID: PAF-171
- Date (UTC): 2026-11-11T21:22:19Z
- Project: padel-friend
- Branch: `feature/PAF-171-stabilize-serial-lane-e2e-specs` (base: `origin/main @ 36ee19c`)
- Commits:
  - `4a524ea` — test: bound worker lifecycle waits and isolate push mocks (4 files)
  - `bbf18ed` — test: prove statistics preview assets resolve without console errors (3 files)
  - `5e28fb1` — test: make notification cutoff capture and seeding authoritative (3 files)
  - `92e42c0` — test: sample correction layouts after authoritative render readiness (2 files)
  - `c9a391e` — fix: address review findings (5 files; includes round-1 + round-2 review fixes)
- Linear issue: PAF-171 (PadelFriend team / PadelFriend project)
- Supporting artifacts: `docs/plan/Plan PAF-171 Stabilize serial-lane e2e specs (push-pwa SW timeouts and legacy rotating flakes).md`, findings ledger `docs/plan/PAF-171-findings.md`, context bundle `docs/plan/PAF-171-bundle.md`

## Objective

- Stabilize the serial-lane e2e specs affected by the four documented flake classes: push/PWA service-worker hangs (`push-preferences.spec.ts`, `pwa.spec.ts`), statistics preview 404-console gate (`statistics.spec.ts`), notifications mark-all-read cutoff capture races (`notifications.spec.ts`), and result-corrections-visual stacking/layout probes (`result-corrections-visual.spec.ts`).
- Delivered as a single issue: 4 fix units plus a review fix loop; the AC5 acceptance validation campaign (3 consecutive full local `pnpm complete-check` runs + 1 clean CI run, zero serial-lane flakes) is approved but still pending.
- Diagnosis-first approach due to PAF-175 overlap: PAF-175 stabilizers for all four flake classes were already in baseline, so each unit verified what remained unconfirmed instead of duplicating fixes. Classification: harness/test-infrastructure hardening only — zero product (`src/`) changes.

## Implementation Summary

### Unit 1 — SW hang class (push/pwa)

- Plan's expect.poll-unboundedness claim DENIED: Playwright 1.64.1 races each poll callback against the deadline, so expect.poll is not an unbounded wait.
- The real unbounded waits were the `waitForEvent` return and bare `page.evaluate(() => navigator.serviceWorker.ready)` calls; replaced with bounded `expect.poll` over immediate `getRegistration('/')` observations plus a failure-evidence snapshot (phase, `/sw.js` status/MIME, worker list, hydration marker).
- H3 CONFIRMED: `installMocks` wrote localStorage from the context init script without an origin guard — the source of the `localStorage Access is denied` noise; now origin-guarded and rethrown only on the app origin.
- Teardown errors confirmed secondary (they follow the primary stall). H1 (missing/rejected registration) and H2 (install saturation) NOT reproducible locally — remain unconfirmed; the new snapshot classifies them on the next failure.
- Classification: harness liveness defect + mock isolation; no product change.

### Unit 2 — statistics 404-console gate

- `/virtual:stylex.css` 404 DENIED at current code: PAF-175's fix is complete (verified 11/11 statistics specs with zero console errors and zero HTTP >= 400).
- Hostile-build cleanup verified sound: `.wrangler/deploy/config.json` restored (including the originally-absent case) and the temp outDir removed.
- Gaps closed instead: new `e2e/browser-error-gate.ts` recording response entries as `http <status> <type> <url>` with an `[observed on <url>]` attribution suffix (corrected from `[page <url>]` per review) and `drain()` snapshot-splice semantics; exact outsider-denial oracle (3x http 404 document + console twins with exact URLs — not a generic ignore). Late-error attribution gap confirmed and closed.

### Unit 3 — notifications mark-all-read cutoff

- Replaced broad `includes('before')` + any-ISO regex capture with an exact seroval cross-JSON structured parser (`parseMarkAllCutoff` in new `e2e/notification-cutoff.ts`), matching the `data.before` string node + validator timestamp format; bodies derived from the real `serverFnFetcher.js` seroval serializer.
- Capture promise bounded via expect.poll with data-keys-only diagnostics; first-match-only hold; cleanup via `release()` + `page.unrouteAll({ behavior: 'wait' })` (the default unroute aborts an in-flight handler — "Route is already handled" discovered and fixed).
- Notification <-> invitation identity now via `kind='community_invitation'` + `target_id` (previously list-order dependent; `listNotificationIds` removed).
- Producer-delivery race DENIED: the AFTER INSERT trigger runs in the same transaction (migration `20261015180200`).
- Preserved behavior: three temporal cases (cutoff-1ms / cutoff / cutoff+1ms), real RPC path, chip 2 -> 1, persisted `[read, read, null]`. No production changes.

### Unit 4 — result-corrections-visual stacking probe (harness-only)

- Confirmed: quiet-frames readiness does not prove content arrival — `JobDetail` loads the attempt timeline via `getResultRepairAttempts` after mount, so diagnostics could be sampled before the timeline body existed. `openDiagnostics` now gates on `repairTimelineBody` before settling.
- Converted 5 mixed-snapshot comparison sites (separate `box()`/`innerBox()` evaluates at A5/A6/B3/retry-dialog/E11) to atomic `captureGeometry`/`captureBoxes`.
- No product overlap established (prior ~22px difference insufficient evidence); no layout change.
- Font swap remains UNCONFIRMED (same as PAF-175); 600s repair lease expiry denied locally (seed -> test ~20s).
- Latent risks recorded: 600s seed -> last-diagnostics-test chronology on CI; the held `_serverFn` route blocks all server functions in that one regression; `e2e/result-amendments-chronology.spec.ts` shares the torn pattern (PAF-175 O3, out of scope).

### Review fix loop (7 findings, all fixed, final verdict: approve)

- Round 1 (commit `bf7c179`, later amended):
  - F1 (major): direct `observe(page)` await outside expect.poll was unbounded -> shared shrinking deadline (`deadlineAfter`/`observeWithin`, 15s mirror constant) + never-resolving regressions.
  - F4 (minor): worker evidence leaked URL query strings -> `publicPath()` pathname redaction + secret-query regressions.
  - F5 (minor): `[page <url>]` mislabeled late errors -> honest `[observed on <url>]` observation-time label + delayed-navigation regression.
  - F2 (major): a regression bypassed the gate (called diagnosticsPage manually) -> rewritten to exercise production `openDiagnostics` with the held route via a beforeGoto hook.
  - F3 (major): held route escaped cleanup on setup failure -> try/finally from before `openDiagnostics`, release + await opening.catch + `unrouteAll({ behavior: 'wait' })`, original error propagates.
- Round 2 (amended into `c9a391e`):
  - F6 (major): the 15s control deadline consumed reload/hydration allowances (45s hydration) -> `remaining` re-armed after reload+hydration, allowances preserved; regression with 400ms hydration vs 300ms budget proves it.
  - F7 (minor): 10-rAF-frame pending check was timing-dependent -> deterministic `gateProbe` seam (`reachedGate` before / `crossedGate` after the gate wait, backward-compatible 6th param), Promise.race arrival + evaluate macrotask, both mutation variants fail deterministically, rAF loop removed.
- Delta reviews: round 1 -> 2 new findings (F6/F7) + F3/F4/F5 verified fixed; round 2 -> approve, all 7 fixed, no new defects. F1-F2 superseded residuals are tracked via F6/F7 in the findings ledger.

## Files Changed

12 total, all `e2e/` + `test/` harness; ZERO product `src/` changes. Diff vs `origin/main`: 12 files, +1012/-127 (after fix loop).

Unit 1 (SW hang class):

- `e2e/service-worker-helpers.ts` — bounded worker lifecycle waits, origin-guarded `installMocks`, failure-evidence snapshot, `deadlineAfter`/`observeWithin` deadline helpers, `publicPath()` redaction.
- `e2e/push-preferences.spec.ts` — uses bounded lifecycle waits + mock isolation.
- `e2e/pwa.spec.ts` — uses bounded lifecycle waits + mock isolation.
- `test/e2e-service-worker-helpers.test.ts` — 16 lifecycle/deadline/redaction regressions.

Unit 2 (statistics gate):

- `e2e/browser-error-gate.ts` (new) — response/console error capture with `[observed on <url>]` attribution and `drain()` semantics.
- `e2e/statistics.spec.ts` — exact outsider-denial oracle via the gate.
- `test/e2e-browser-error-gate.test.ts` (new) — 5 gate regressions.

Unit 3 (notifications cutoff):

- `e2e/notification-cutoff.ts` (new) — exact seroval cross-JSON `parseMarkAllCutoff`, first-match hold, `release()` cleanup.
- `e2e/notifications.spec.ts` — authoritative capture/seeding, `kind`+`target_id` identity, `unrouteAll({ behavior: 'wait' })`.
- `test/e2e-notification-cutoff.test.ts` (new) — 5 parser regressions.

Unit 4 (result-corrections-visual):

- `e2e/result-corrections-visual.ts` — `openDiagnostics` gates on `repairTimelineBody`; atomic `captureGeometry`/`captureBoxes`; `gateProbe` seam (F7).
- `e2e/result-corrections-visual.spec.ts` — 5 comparison sites converted to atomic captures; F2/F3/F6 routing and deadline fixes.

## Key Decisions

- Diagnosis-first instead of re-applying PAF-175 stabilizers: each unit denied/confirmed specific hypotheses (plan claims checked against Playwright 1.64.1 semantics, real serializer output, and migration code), so only unconfirmed gaps were closed.
- Bounded everywhere: all previously unbounded waits (waitForEvent return, bare SW-ready evaluate, route-capture promise, direct observe awaits) replaced with `expect.poll` / shared shrinking deadlines; 15s expect.timeout inherited — no budget widening.
- Evidence over guesses for SW hangs: failure snapshot captures phase, `/sw.js` status/MIME, worker list, and hydration marker so the next failure classifies H1/H2 without local reproduction.
- Exact oracles over generic ignores: the statistics gate asserts the exact 3x outsider-denial 404 set (documents + console twins with exact URLs) rather than ignoring errors broadly.
- Authoritative serialization: cutoff parsing matches the real seroval cross-JSON bodies produced by `serverFnFetcher.js`, and invitation identity uses `kind`+`target_id` instead of list order.
- Atomic captures: visual geometry sampled via single `captureGeometry`/`captureBoxes` evaluates and render-readiness gating on the timeline body, eliminating torn/mixed snapshots without touching product layout.
- Review-loop hygiene: held routes cleaned up in try/finally with `unrouteAll({ behavior: 'wait' })`; control deadline re-armed after reload+hydration so allowances are not consumed; deterministic `gateProbe` seam replaces the rAF-frame timing check.
- Constraints honored: no skips/retries/generic ignores; coverage preserved; local serial `--workers=1` vs CI `workers=2` asymmetry untouched.

## Validation Performed

- Per-unit fast gates (typecheck/lint/affected `vitest.unit.config.ts` files) green at every commit.
- Per-unit E2E iterations: U1 push/pwa specs 26/26; U2 statistics 11/11 (zero console errors, zero HTTP >= 400); U3 notifications 29/29 (cutoff capture ~1.5s); U4 result-corrections-visual 28/28 (full visual lane).
- QA scoped E2E at `92e42c0`: 5 affected specs `--workers=1` -> 77/77 passed, 0 flaky/retried.
- Fix-loop gates: 31/31, 26/26, and 28/28 (visual lane) green.
- New unit regressions: 28 total (16 SW helper lifecycle/deadline/redaction + 5 error gate + 5 cutoff parser + 2 F6/F7 additions).
- Review: 7 findings across 2 rounds, all fixed; delta review round 2 verdict approve with no new defects.
- PENDING: AC5 acceptance campaign — 3 consecutive full local `pnpm complete-check` runs + 1 clean CI run with zero serial-lane flakes (user-approved as written; single-run policy exception explicitly authorized by AC5 for these runs only).

## Risks and Follow-ups

- H1 (missing/rejected SW registration) and H2 (install saturation) remain unconfirmed — not reproducible locally; the new failure-evidence snapshot classifies them on the next failing run.
- Font-swap mechanism in the visual lane remains UNCONFIRMED (unchanged from PAF-175).
- 600s repair lease expiry denied locally (seed -> test ~20s), but the seed -> last-diagnostics-test chronology on CI could exceed the lease — verify on CI.
- The held `_serverFn` route blocks all server functions within that single regression — keep the blast radius to that one test.
- `e2e/result-amendments-chronology.spec.ts` shares the torn mixed-snapshot pattern (PAF-175 O3) — separate scope, candidate follow-up.
- AC5 acceptance campaign outstanding: run the approved 3x local `pnpm complete-check` + 1 clean CI and record zero serial-lane flakes before closing the issue.
