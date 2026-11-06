---
title: PAF-14 T15 Amend results resolve disputes and replay projections
type: development-log
permalink: docs/development-logs/task-PAF-14-t15-amend-results-resolve-disputes-and-replay-projections
---

# Development Log: PAF-14

## Metadata

- Task ID: PAF-14 (T15 — Amend results, resolve disputes, and replay projections; epic parent delivered via sub-issues PAF-152/PAF-153/PAF-154/PAF-155/PAF-156, all In Progress on the board)
- Date (UTC): 2026-11-06
- Project: padel-friend
- Branch: `feature/PAF-14-amend-results-resolve-disputes-and-replay-projections` (base `main` @ `f2104de`; PR pending — not yet pushed)
- Scope: audited result amendment proposals; Community Admin dispute resolution with audited overrides; safe deterministic replay of corrected global rating history; atomic rebuild of corrected League standings and statistics; correction and repair diagnostics flows exposed in the UI.
- Commits (7 on branch, oldest first — 5 unit commits, one per sub-issue, plus 2 interleaved docs commits):
  1. `18617d6` (feat: add audited result amendment proposals — PAF-152)
  2. `fdd6717` (feat: resolve result disputes with audited overrides — PAF-153)
  3. `a087a1e` (docs: add subagent model routing and session audit — aux, user contribution)
  4. `7e312d1` (feat: replay corrected global rating history safely — PAF-154)
  5. `18d8340` (docs: update subagent model docs and recovery rules — aux, user contribution)
  6. `17c0b4b` (feat: rebuild corrected standings and statistics atomically — PAF-155)
  7. `e341484` (feat: expose result correction and repair diagnostics flows — PAF-156)
- Pending commits at log time: a single `fix: address review findings` commit sweeping the 15 tracked findings (all fixed + closure-verified) — the orchestrator creates it before push; `pnpm complete-check` final gate also pending (orchestrator runs it at final gate).
- Artifacts: review-loop findings ledger `docs/plan/PAF-14-findings.md` (F1–F15, all fixed + closure-verified), this development log.
- Related Linear: PAF-14 epic + sub-issues PAF-152/PAF-153/PAF-154/PAF-155/PAF-156 (project PadelFriend).

## Objective

- Let official match results be amended through an audited proposal lifecycle, let Community Admins resolve disputes with audited uphold/replace/void overrides, replay the corrected global rating history deterministically without backdating, rebuild corrected League standings and statistics atomically, and expose the whole correction + repair pipeline through player/community/platform-admin diagnostics flows — all with audit trails, RLS, guarded RPCs, and no regression to existing confirmation/replay semantics.

## Implementation Summary

- **PAF-152 — Audited result amendment proposals (`18617d6`)**: amendment lifecycle on `result_amendment_requests`/candidates/events; corrected candidates reusing the existing proposal-version pipeline; 48h/no-rejection auto-accept; canonical pointer `match_event_result_official_state` (backfilled); confirmation uniqueness relaxed to `(proposal_id, proposal_version)`; canonical `match_event_official_confirmations()` reader routing; guarded RPCs + RLS.
- **PAF-153 — Dispute resolution with audited overrides (`fdd6717`)**: insert-only `result_dispute_resolutions` (uphold/replace/void); Community Admin RPCs; `ADMIN_OVERRIDE` first-confirm guard branch; `result_repair_jobs`/attempts with exactly-once queueing; typed pending/failed receipts; audit + notification kinds.
- **PAF-154 — Safe global rating replay (`7e312d1`)**: append-only `player_rating_event_sources` (effective confirmation/version/played_at, backfilled); FULL global merged-stream deterministic replay with exact tie/checkpoint semantics — T14 adjustment preservation byte-identical, no backdating; singleton claim/lease/fence/retry processor (`retry_result_repair`, diagnostics RPCs, scheduler health); covered prelocks; 13 real-connection race proofs; default-off determinism seam (`app.test_pause`); cron-isolation helper.
- **PAF-155 — Atomic standings/statistics rebuild (`17c0b4b`)**: correction-aware league snapshots (result_amendment/result_void causes, fingerprints, prior-version links, unique per League+job); atomic derived publication (League + statistics + ranks inside the repair transaction, `committed_revision` once, succeeded path enabled); AC4 amendment-vs-late-first-confirm classification; independent statistics oracle tests; rollback injections.
- **PAF-156 — Correction and repair diagnostics flows (`e341484`)**: amendment request/review UI; dispute resolution UI; selected-job repair diagnostics (queue + detail region per SluH3); community + platform-admin routes; league correction history labels; notification wiring; i18n en/pt-BR/es; E2E (amendments/repairs/chronology/visual specs); Pencil visual gates.
- **User contributions**: opened Pencil and added the 3 diagnostics frames via the Pen.dev agent; two docs commits (`a087a1e` model routing docs, `18d8340` recovery rules + harness README).
- **Review-loop delta (fix commit pending at log time)**: 15 tracked findings (F1–F15 in `docs/plan/PAF-14-findings.md`), all fixed + closure-verified across 3 full reviews (code/architecture/UX-UI) + delta reviews. Fix work spans: migration `20261107091000_result_correction_repair_comparison.sql` (fingerprint-based repair comparison, F1); migration `20261107092000_result_repair_failure_notices.sql` (operator failure notices with re-arm + resolve, F2); notice diagnostics link; retry-dialog a11y (`role="alert"` inside dialog, clear-on-open); selected-job detail region completion (F11); frame-exact typography/metrics across correction surfaces; escaped-interpolation bug fix (F15); visual-gate rework (F4/F13 — frame-reference.json from Pencil-resolved values, ~110 computed-style element contracts, probed/adapted inventory with exact-set enforcement, composition probes per adaptation, per-region fill raster, digest re-pins ×9 after the user added 3 diagnostics frames to the .pen, F3); E2E global-setup cron pause; projector-restore hardening ×2.

## Files Changed

- Grouped scope below (per-commit file-level diffs live in git history on the delivery branch; the review-fix delta is uncommitted in the working tree at log time, awaiting the sweep commit).
- **Migrations (7 new, `supabase/migrations/`)**: PAF-152 amendment schema + canonical pointer/backfill migrations; PAF-153 dispute resolutions + repair jobs/attempts migrations; PAF-154 `player_rating_event_sources` + backfill; PAF-155 correction-aware snapshots/atomic publication; review-fix `20261107091000_result_correction_repair_comparison.sql` and `20261107092000_result_repair_failure_notices.sql`.
- **Database logic**: amendment lifecycle + guarded RPCs + RLS; canonical reader routing (`match_event_official_confirmations()`); `ADMIN_OVERRIDE` confirm branch; exactly-once repair queueing; deterministic replay processor (claim/lease/fence/retry) + diagnostics RPCs + scheduler health; atomic derived publication in the repair transaction; operator failure notices.
- **UI/features**: amendment request/review components; dispute resolution UI; selected-job repair diagnostics (queue + detail region); community + platform-admin routes; league correction history labels; notification wiring; retry dialog a11y; frame-exact typography/metrics across correction surfaces.
- **Copy**: `src/locales/{en,pt-BR,es}` — correction, dispute, repair-diagnostics, notice, and history-label strings.
- **Design**: `docs/design/padel-friend.pen` — user-added 3 diagnostics frames (Pen.dev agent); visual-gate rework artifacts (frame-reference.json from Pencil-resolved values, computed-style element contracts, per-region fill raster).
- **Tests**: amendment lifecycle/RLS/race suites (13 real-connection race proofs); statistics oracle + rollback injections; AC4 classification; E2E amendments/repairs/chronology specs; visual specs reworked to renderer-independent element contracts; E2E global-setup cron pause; projector-restore hardening ×2.
- **Docs**: model routing + session audit (`a087a1e`), recovery rules + harness README (`18d8340`), findings ledger `docs/plan/PAF-14-findings.md`, this development log.

## Key Decisions

- **Canonical official-state pointer**: `match_event_result_official_state` backfilled and used via the canonical `match_event_official_confirmations()` reader so confirmations route consistently after amendment; confirmation uniqueness relaxed to `(proposal_id, proposal_version)` to support versioned candidates.
- **Insert-only dispute resolutions**: uphold/replace/void recorded append-only; Community Admin RPCs guarded; `ADMIN_OVERRIDE` added as a first-confirm guard branch.
- **Exactly-once repair queueing**: `result_repair_jobs`/attempts with typed pending/failed receipts; singleton claim/lease/fence/retry processor prevents concurrent replay.
- **Deterministic FULL replay**: global merged-stream replay with exact tie/checkpoint semantics; T14 adjustments preserved byte-identically; no backdating; default-off determinism seam (`app.test_pause`) + cron-isolation helper make the replay testable without production behavior change.
- **Atomic derived publication**: corrected standings/statistics/ranks publish inside the repair transaction with `committed_revision` set once — no partially corrected derived state.
- **Fingerprint-based repair comparison** (F1): new comparison migration replaces a weaker equivalence check found in review.
- **Operator failure notices** (F2): repair failures surface to operators with re-arm + resolve semantics instead of silent failure states.
- **Renderer-independent visual gates** (F4/F13, after 3 review rounds): frame references resolve Pencil values into frame-reference.json and assert ~110 computed-style element contracts with exact-set enforcement, composition probes per adaptation, and per-region fill raster — instead of brittle full-frame pixel equality; digest re-pins (×9) accepted after the user added 3 diagnostics frames (F3).
- **Selected-job detail region** (F11): diagnostics complete per the SluH3 structure rather than queue-only.
- **Escaped-interpolation bug** (F15): user-visible copy rendered escaped placeholders — fixed and covered.

## Validation Performed

- **Static**: `pnpm typecheck`, `pnpm lint`, `pnpm knip`, `pnpm oxfmt`, `pnpm db:types:check` all pass.
- **Full `pnpm test`**: green — 2,909 unit + 1,032 integration tests, post-migrated-reset, run serially (DB-touching gates never concurrent).
- **E2E**: 46/46 correction specs passing ×2–3 consecutive runs; 115/115 existing regression specs passing.
- **Concurrency**: 13 real-connection race proofs converge; exactly-once repair queueing and replay determinism verified; rollback injections prove atomic publication.
- **Review loop**: 3 full reviews (code + architecture + UX/UI) + delta reviews + closure verification; findings ledger F1–F15 all fixed and closure-verified.
- **Visual/a11y**: Pencil visual gates reworked to frame-exact computed-style element contracts + composition probes + per-region fill raster; retry dialog alert semantics; digests re-pinned after design-frame additions.
- **Pending**: `pnpm complete-check` NOT yet run — orchestrator runs it as the final gate immediately after the review-fix sweep commit and push.

## Risks and Follow-ups

- **PR not yet pushed**: review-fix findings are fixed in the working tree but uncommitted — orchestrator must create the single `fix: address review findings` sweep commit before push; on first push, request Copilot review per protocol and verify via PR timeline.
- **Final gate pending**: `pnpm complete-check` is the delivery gate and has not run yet; treat delivery as incomplete until it passes.
- **Backfills must run in order**: canonical official-state pointer and `player_rating_event_sources` backfills are migration-ordered; a partially applied migration chain would leave reader routing or replay sources inconsistent.
- **Determinism seam stays default-off**: `app.test_pause` must never be enabled in production; replay correctness depends on the singleton lease/fence — do not parallelize repair processing.
- **Visual contracts are renderer-tolerant but strict**: element-contract inventories enforce exact sets; any future design-frame change requires digest re-pins and inventory re-probing (as done ×9 this delivery).
- **Process/model instability during delivery**: multiple rate-limit pauses (sonnet session windows); plugin failover verified (sonnet→terra); user-directed model overrides (terra verification pass, sol rounds); concurrent-specialist DB contention caused transient test flakes — documented, serial DB-gate discipline enforced.
- **Board state**: PAF-14 epic + PAF-152..156 remain In Progress; close them only after push, review, and green CI.
