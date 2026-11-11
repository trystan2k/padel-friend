---
title: PAF-175 Stabilize the four documented e2e flake classes fenced only by CI retries
type: development-log
permalink: docs/development-logs/task-PAF-175-stabilize-the-four-documented-e2e-flake-classes-fenced-only-by-ci-retries
---

# Development Log: PAF-175

## Metadata

- Task ID: PAF-175 — "Stabilize the four documented e2e flake classes fenced only by CI retries"
- Date (UTC): 2026-11-11
- Project: padel-friend
- Branch: `feature/PAF-175-stabilize-the-four-documented-e2e-flake-classes-fenced-only-by-ci` (base `origin/main` `8ed74aa`)
- Commits (11 on the branch, chronological):
  - `845558b` — `test: gate service-worker readiness and cut install churn in pwa and push specs` (U1)
  - `a5183d1` — `fix: pin stylex dev injection to dev server and guard built artifacts` (U2)
  - `c4652b1` — `test: pin mark-all-read cutoff boundary with explicit notification timestamps` (U3)
  - `eca9992` — `test: gate diagnostics geometry assertions on render settle readiness` (U4)
  - `0ac9633` — review round-1 fixes (F1–F4)
  - `c912071` — review round-2 fixes (F5–F7)
  - `7c0c74b` — review round-3 fix (F8; orchestrator-direct single-file edit, gate-verified by the testing specialist)
  - `392accb` — user-owned: permission widen for agents tooling
  - `9ef3029` — AC1 attempt-1 fix (F9 — storage-clear race vs SW teardown navigation)
  - `43d86ff` — AC1 attempt-2 fix (F10 — hydration readiness + full-frame visual wall-clock headroom)
  - `4aa7170` — AC1 attempt-3 fix (F11 — integration `afterAll` hook ceiling); AC1 satisfied at this commit
- Branch composition note: user-owned commit `f10f938` (PAF-52 development log) sits below the branch start — composition decision pending user at the push gate.
- Related Linear: PAF-175; team PadelFriend (<https://linear.app/trystanworkspace2/issue/PAF-175>)
- Plan: `docs/plan/Plan PAF-175 Stabilize the four documented e2e flake classes fenced only by CI retries.md`
- Findings ledger: `docs/plan/PAF-175-findings.md` (review + campaign findings F1–F11, all fixed; observations O1–O3)
- Bundle: `docs/plan/PAF-175-bundle.md` (discarded post-PR)
- Fences targeted: `SERIAL_SPECS` serial lane + CI `retries=2` (intentionally left untouched — scope-exact)

## Objective

- Stabilize the four documented e2e flake classes that are fenced only by CI retries (`SERIAL_SPECS` serial lane + CI `retries=2`): root-cause each class and add deterministic, signal-based gating so the fences become unnecessary — without removing the fences (issue scope is stabilization, not fence removal).
- Delivered as four units (U1–U4, one commit each), then a three-round code/architecture review loop (findings F1–F8) with one fix commit per review round.
- Closed by a four-attempt AC1 acceptance campaign (failure counter restarts per protocol): three campaign fixes (F9–F11, one per failing attempt) followed by three consecutive loaded green runs with retries=0 at `4aa7170`.

## Implementation Summary

- U1 — service-worker readiness gating (`845558b`):
  - New `e2e/service-worker-helpers.ts`: `installBuiltWorker` subscribes worker events before navigate, verifies activation + controlled page, reloads only conditionally; `assertBuiltRegistration` verifies the `/sw.js` script at `/` scope.
  - New `test/e2e-service-worker-helpers.test.ts` (6 tests).
  - `e2e/pwa.spec.ts`: helpers adopted; manifest test moved to `serviceWorkers: 'block'`; `e2e/push-deep-links.spec.ts` verifies `builtWorker()` inside `tap()` with the focus patch restored in `finally`; `e2e/push-preferences.spec.ts` uses `controlledByBuiltWorker`; additive shard-comment mechanism note in `scripts/e2e-shards.mjs`.
  - Mechanism hypothesis (UNCONFIRMED): per-context full SW install churn saturates workers under load; waits were already signal-based.
- U2 — StyleX dev-injection root cause (`a5183d1`):
  - ROOT CAUSE (proven at artifact level): Vite derives `import.meta.env.DEV` from ambient `NODE_ENV` at build time; a build under `NODE_ENV=development` baked dev StyleX virtual modules into the SSR head (`<link href="/virtual:stylex.css">`) and client chunks (`virtual_stylex_runtime-*.js`, `import "virtual:stylex:runtime"`); the preview server 404s them (the plugin serves virtual modules only via its dev-server hook).
  - FIX: `vite.config.ts` → `defineConfig(({ command }) => …)`; non-serve commands get `define` `DEV: 'false'` paired with `PROD: 'true'`; StyleX plugin `dev: command === 'serve' && NODE_ENV === 'development'`.
  - New `test/build.dev-style-artifact.test.ts`: fresh-build artifact contract — no dev-URL references in client + SSR executables/HTML, sourcemaps excluded; hashed stylesheet assets exist and contain `@layer` priority-1 + token-consuming StyleX rules; SSR route-manifest CSS hrefs resolvable.
  - Dev mode live-verified: `/virtual:stylex.css` returns 200 with real CSS under `pnpm dev`. `statistics.spec.ts` 11/11.
- U3 — mark-all-read cutoff determinism (`c4652b1`):
  - `page.route('**/_serverFn/**')` holds the REAL mark-all POST and reads the real cutoff `C` (microsecond `+00:00` form) from the request payload; a third invitation is inserted during the hold (concurrent by construction).
  - SQL sets the 3 rows to `C−1ms` / `C` / `C+1ms` (`timestamptz ± interval '1 millisecond'` preserving precision); preconditions polled (`clock_timestamp() >= C + 1ms`) plus per-row `created_at <= C` asserted (older → true, equal → true, newer → false); the request is forwarded unmodified to the real RPC.
  - Assertions unchanged (chip 2→1 via real UI, 1 unread card, 3 cards, `read_at` [set, set, null]); `releaseRequest()` in `finally`. The equal-row `read_at = SET` result is the `<` vs `<=` boundary proof. `notifications.spec.ts` 36/36.
- U4 — render-settle gating for visual geometry (`eca9992`):
  - New `waitForRenderSettled(page)` in `e2e/result-corrections-visual.ts`: `document.fonts.load` for all visible-text faces → `fonts.ready` (throws on check failure) → image decode (throws on broken) → identical layout across 3 consecutive animation frames (throws after 600; no fixed sleeps).
  - `openDiagnostics` asserts the 4 seeded job cards visible (data readiness) then gates; empty-queue + `confirmationStructure` gated.
  - Mechanism hypothesis (UNCONFIRMED): @fontsource Inter/Manrope lazy per-subset fetch with `font-display: swap` sampled fallback metrics under load (~22px rewrap). Baselines unchanged; every budgeted region difference 0 (24/24).
- Review loop (3 rounds; ledger `docs/plan/PAF-175-findings.md`):
  - Round 1 (code + architecture review):
    - F1 (major): a build under ambient `NODE_ENV=development` forces `DEV=false` but leaves `PROD=false` → `src/features/pwa/update-store.ts:16` gates SW registration on `PROD` → PWA silently disabled in such builds (half-covered fragility class).
    - F2 (major): the artifact contract never built under the triggering env → guard removal undetectable.
    - F3 (major): `waitForRenderSettled` ≠ atomic sampling — independent `box()` evaluates → torn comparisons.
    - F4 (minor): hypotheses documented as proven causes (violates the plan rule "hypotheses cannot be presented as confirmed").
  - Fix round 1 (`0ac9633`):
    - F1: full `src/` flag audit (3 runtime sites; no other `DEV`/`PROD`/`MODE`/`NODE_ENV` branches), `define` pairs `DEV: 'false'` + `PROD: 'true'` for non-serve commands, dist-verified both flags fold + SW markers present under a `NODE_ENV=development` build, dev serving untouched.
    - F2: hostile-env lane — real `vite build --outDir <mkdtemp>` with `NODE_ENV=development` inside vitest (`dist/` untouched, `.wrangler/deploy/config.json` snapshot/restore), shared `checkArtifact`, PWA registration markers (3, chunk-name-independent: `/sw.js` reference + `.register(<id>, { scope: '/' })` + `container: navigator.serviceWorker`; capability probe deliberately excluded since push code shares it), folded-guard diagnostic, negative controls. RED-FIRST proof: a probe build from the pre-F1 config → 0 files reference `/sw.js` → contract fails.
    - F3 (core): `captureGeometry`/`captureBoxes` single-evaluate batch capture; diagnostics/confirmation/empty-queue/request/review/resolve converted.
    - F4: comments marked "Hypothesised mechanism (UNCONFIRMED)" with named confirmation evidence.
  - Round 2 delta: F5 (major) — handle resolution still pre-evaluate (detach → stale/zero rects) + request/review `innerBox(root)`/card-heading sites still multi-evaluate; F6 (minor) — hostile build leaves `.wrangler/deploy/config.json` pointing at the deleted temp dir when the file is absent pre-test; F7 (minor) — vite.config comment overclaimed (dependency bundles still diverge: React dev build in SSR 1161 kB vs 952 kB; no evidenced defect).
  - Fix round 2 (`c912071`):
    - F5: connectivity check + all rect reads in ONE evaluate; detached element → whole snapshot discarded, handles disposed, fresh resolve, bounded 5 attempts, throws on exhaustion; every mutually-compared set one capture; 3 in-spec probe tests (scroll coordinates; Proxy replacement → retake new generation; perpetual replacement → throws).
    - F6: `finally` restores absence or contents; residual concurrent-invocation repoint documented.
    - F7: comment scoped to flag consistency + StyleX exclusion; divergence recorded as known/accepted.
  - Round 3 delta: F8 (minor) — resolve-action assertions compared post-submit action boxes vs PRE-submit `dialogInner` (validation reflow could tear). Fix `7c0c74b`: post-submit `captureGeometry({ dialog, field, submit, cancel })`, `assertStacked` on `.box`, edge asserts on the same snapshot's `dialog.inner.x`/`.right`.
  - Observed, no action: O1 dependency-bundle NODE_ENV divergence (broader hammer out of scope); O2 CWJkF fullFrame 0.1784 informational unmasked (no budget, pre-existing, stable); O3 `result-amendments-chronology` has 2 `assertStacked` sites sharing the old pattern (outside delivery files).
- AC1 acceptance campaign (4 attempts; the 3-run green counter restarts after each fix, per protocol):
  - Attempt 1, run 1 — F9: `e2e/pwa.spec.ts` storage-clear evaluate raced SW teardown navigation ("Execution context was destroyed" at `:216`; retries=0 fatal). All four documented classes CLEAN that run. Fix `9ef3029`: `clearBrowserStorage` gained `waitForLoadState` + bounded context-destroyed retry (3 attempts, no sleeps); delta-reviewed releasable.
  - Attempt 2, run 1 — F10: hydration attribute gate starved past 15 s (`waitForHydratedPage`; 3 failures incl. a `matches-results-visual` 120 s test timeout). Fix `43d86ff`: 45 s readiness headroom; 180 s full-frame visual wall-clock; comments document oracle-preserving headroom.
  - Attempt 3, run 1 — F11: integration `afterAll` fixture teardown starved past its explicit suite-local 120_000 ms hook ceiling (all 33 tests PASSED; 536/536 e2e GREEN that run). Fix `4aa7170`: 300_000 ms suite-local hook ceiling + headroom comment.
  - Attempt 4 — 3/3 GREEN, **AC1 SATISFIED** at `4aa7170`: 132.7 min total (2611 s / 2676 s / 2677 s); 536/536 e2e ×3 (1608 executions — 395 main + 141 serial each; serial phase confirmed executed every run); unit 3678/3678; integration green ×3 (hook timeouts 0); zero flake signatures in any run; F9's pwa test 3.4 s green; cutoff 2.0 s; geometry budgets green every run.

## Files Changed

Implementation (14 files changed + 1 oracle-context):

- `e2e/service-worker-helpers.ts` (new) — `installBuiltWorker` / `assertBuiltRegistration` (`845558b`)
- `test/e2e-service-worker-helpers.test.ts` (new) — 6 helper tests (`845558b`)
- `test/build.dev-style-artifact.test.ts` (new) — fresh-build artifact contract incl. hostile-env lane (`a5183d1`; F2/F5/F6 fixes `0ac9633`, `c912071`)
- `e2e/pwa.spec.ts` — SW helpers + manifest test under `serviceWorkers: 'block'` (`845558b`); F9 storage-clear call site (`9ef3029`)
- `e2e/push-deep-links.spec.ts` — built-worker verification inside `tap()`; focus patch restored in `finally` (`845558b`)
- `e2e/push-preferences.spec.ts` — `controlledByBuiltWorker` (`845558b`)
- `e2e/statistics.spec.ts` — oracle context only (unchanged by this delivery)
- `e2e/notifications.spec.ts` — held-request cutoff determinism (`c4652b1`)
- `e2e/result-corrections-visual.ts` — `waitForRenderSettled` + single-evaluate `captureGeometry`/`captureBoxes` (U4 + F3/F5/F8 fixes) (`eca9992`, `0ac9633`, `c912071`, `7c0c74b`)
- `e2e/result-corrections-visual.spec.ts` — gated assertions (`eca9992`, `0ac9633`, `c912071`, `7c0c74b`)
- `e2e/auth-helpers.ts` — F9: `clearBrowserStorage` load-state wait + bounded context-destroyed retry (`9ef3029`)
- `e2e/matches-results-visual.spec.ts` — F10: 45 s hydration readiness headroom + 180 s full-frame visual wall-clock (`43d86ff`)
- `vite.config.ts` — command-based `define` (DEV/PROD pairing) + StyleX plugin dev pinning (`a5183d1`, `0ac9633`, comment scoped `c912071`)
- `scripts/e2e-shards.mjs` — additive shard-comment mechanism note (`845558b`)
- `test/matches.results.notifications.integration.test.ts` — F11: 300_000 ms suite-local `afterAll` hook ceiling (`4aa7170`)

Workflow artifacts:

- `docs/plan/Plan PAF-175 Stabilize the four documented e2e flake classes fenced only by CI retries.md` — committed in sweep
- `docs/plan/PAF-175-findings.md` — F1–F11 ledger + O1–O3 observations — kept
- `docs/plan/PAF-175-bundle.md` — discarded post-PR

Explicitly untouched: `SERIAL_SPECS` fence, CI `retries=2`, screenshot budgets/assertion tolerances, visual baselines, vitest coverage thresholds, `src/**` (flag audit was read-only; the F1 fix landed in `vite.config.ts`, not src). The F10/F11 ceiling raises are readiness/wall-clock headroom, not assertion or budget changes.

## Key Decisions

- Fences stay — issue scope is root-cause stabilization, not fence removal (`SERIAL_SPECS` + CI retries=2 untouched).
- Command-based `define` over an ambient-NODE_ENV guard — a superset that also pins the artifact contract.
- `PROD` paired with `DEV` (one-line consistency fix) over `process.env.NODE_ENV` pinning (broader side effects on build-child scripts) or a StyleX-only flag (bigger src change).
- U2 commit gated on review satisfaction via review-before-push ordering.
- Cutoff determinism via held-request payload + explicit SQL timestamps over wall-clock arithmetic.
- Integration equal-case extension skipped — the e2e cutoff test covers the equal case against the real RPC.
- Capability probe deliberately excluded from the PWA registration markers — push code shares it, so it cannot discriminate PWA registration health.
- Vitest coverage thresholds untouched.
- AC1 protocol: failure counter restarts after each fix — each attempt starts at run 1; three consecutive loaded green runs required.
- AC3 boundary held under pressure: the campaign's ceiling raises (hydration 15 s → 45 s, full-frame visual wall-clock 120 s → 180 s, integration `afterAll` hook 120_000 → 300_000 ms, F9 bounded retry) are readiness/wall-clock headroom documented in-site — no screenshot budget, assertion tolerance, or coverage threshold touched.
- Fences left untouched through AC1: the serial phase executed in every green run, confirming the lane remains load-bearing.

## Validation Performed

- Per-unit fast gates: typecheck/lint/oxfmt green per commit.
- Unit tests: 6 SW-helper + 13 artifact-contract (incl. hostile-env lane, ~2–4 s) + 54 shard tests.
- Affected e2e run ONCE per code state: pwa+push 30/30; statistics 11/11; notifications 36/36 (after 2 diagnosed regex failures); result-corrections-visual 27/27 final (every budgeted region difference 0).
- RED-FIRST proof for the artifact contract: probe build from the pre-F1 config fails with 0 files referencing `/sw.js`.
- Hostile-env build inside vitest verified: `DEV`/`PROD` fold correctly and SW markers present in dist under `NODE_ENV=development`; `dist/` untouched; `.wrangler/deploy/config.json` snapshot/restore verified including absence restoration (F6).
- Dev mode live check: `/virtual:stylex.css` 200 with real CSS under `pnpm dev`.
- Every pre-commit hook chain green (lint-staged + `complete-check --only=static`).
- Review loop closed: F1–F8 all fixed with ledger evidence; round-3 fix `7c0c74b` gate-verified by the testing specialist.
- AC1 SATISFIED — attempt 4 at `4aa7170` produced 3/3 green loaded `pnpm complete-check` runs, retries=0: 132.7 min total (2611 s / 2676 s / 2677 s); 536/536 e2e ×3 (1608 executions — 395 main + 141 serial each; serial phase confirmed executed every run); unit 3678/3678; integration green ×3 (hook timeouts 0); zero flake signatures in any run; F9's pwa test 3.4 s green; cutoff 2.0 s; geometry budgets green every run.
- Campaign path (counter restarts per protocol): attempt 1 run 1 → F9 fixed `9ef3029` (all four documented classes CLEAN that run); attempt 2 run 1 → F10 fixed `43d86ff`; attempt 3 run 1 → F11 fixed `4aa7170` (536/536 e2e GREEN that run; integration teardown ceiling hit with all 33 tests passed); attempt 4 → 3/3 green.
- AC2 ✓ — mechanisms documented; unconfirmed hypotheses explicitly qualified.
- AC3 ✓ — no screenshot budgets, assertion tolerances, or coverage thresholds touched; the four ceiling raises are readiness/wall-clock headroom, documented in-site.
- AC4 — local evidence complete (the AC1 runs); CI evidence pending push.

## Risks and Follow-ups

- AC4 CI evidence pending push (the AC1 runs are the local half).
- `f10f938` (PAF-52 dev-log, below the branch start) composition decision pending user at the push gate.
- O1: dependency-bundle NODE_ENV divergence (React dev build SSR 1161 kB vs 952 kB) — unpinned, accepted; broader hammer out of scope; no evidenced defect.
- O2: CWJkF fullFrame 0.1784 informational — no budget attached; pre-existing, stable.
- O3: `result-amendments-chronology` has 2 `assertStacked` sites outside delivery files sharing the old multi-evaluate pattern — candidate follow-up if the pattern proves deficient under load.
- Saturation-headroom pattern: AC1 load (NCPU−2) surfaced three headroom ceilings beyond the four documented classes — hydration gate (15 s → 45 s), per-test wall-clock (120 s → 180 s for full-frame visuals), integration `afterAll` hook (120_000 → 300_000 ms) — all raised as oracle-preserving headroom, not assertion loosening; a future heavier saturation run may surface further ceilings of the same kind.
- U1/U4 mechanism hypotheses remain UNCONFIRMED: the campaign produced zero flake signatures, so no refuting (or confirming) evidence was generated; the Class-4 secondary-mechanism candidate (diagnostics 10 s polling + 600 s lease expiry) stays on record for any future failing run.
- Serial-lane removal explicitly out of scope; fences (`SERIAL_SPECS` + CI retries) intentionally untouched.

## Relations

- Linear issue: PAF-175 (PadelFriend team)
- Related docs: `docs/plan/PAF-175-findings.md` (F1–F11 + O1–O3), `docs/plan/Plan PAF-175 Stabilize the four documented e2e flake classes fenced only by CI retries.md`
- Related prior work: PAF-157 (test-suite timing / shard topology), PAF-174 (integration runtime harness), PAF-15 (PWA + Web Push origin)
