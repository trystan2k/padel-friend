---
title: PAF-9 T09 Approve V1 Global-Rating Calibration and Golden Outcomes
type: development-log
permalink: docs/development-logs/task-PAF-9-t09-approve-v1-global-rating-calibration-and-golden-outcomes
---

# Development Log: PAF-9

## Metadata

- Task ID: PAF-9 (T09 — Approve V1 global-rating calibration and golden outcomes; HITL approval task — no product code by design)
- Date (UTC): 2026-10-31
- Project: padel-friend
- Branch: `feature/PAF-9-approve-v1-global-rating-calibration` (from `origin/main` `a3a20f8`; base for PR: `main`)
- Commits (4, oldest first): `7a13d87` (docs: approve v1 global rating calibration and golden fixtures — adds `docs/rating/v1-calibration.md` +331 and `docs/rating/golden-fixtures.json` +13511), `b7ce323` (fix: address review findings — spec claim-rule alignment with PAF-125 addendum, INV-claim comparison fields made explicit, AC-map clamp citations, approval-record clarification; +18/−15 md, +3/−2 json), `aa4dadd` (test: re-certify design source digest in reference manifests — 3 manifests, paf-6/7/8; inherited .pen provenance break fixed via user-approved re-certification; 40 frames re-exported, committed PNGs unchanged), `b66efce` (docs: record fixture sign-off, planning, findings and development log — spec sign-off row, findings ledger, plan, this log)
- Diff: docs deliverables 2 files net new (+13,842/−17, `7a13d87` + `b7ce323`); `aa4dadd` re-certifies 3 reference manifests (committed PNGs unchanged); `b66efce` records sign-off + workflow docs
- Artifacts: plan `docs/plan/Plan PAF-9 T09 — Approve V1 global-rating calibration and golden outcomes.md`, findings ledger `docs/plan/PAF-9-findings.md`, fixture sign-off row + this development log (all committed via `b66efce`); context bundle remains a session artifact (not committed)
- Phase time tracking: Preparation 6m · Planning 4m21s · Implementation 14m17s (incl. approved re-cert scope addition) · QA 55m26s (incl. two full complete-check runs) · Review 5m59s · Development Logging 3m · Commit/Push 5m · PR Creation 4m13s
- Related Linear: PAF-9 (T09, project PadelFriend) — In Review, PR #36 attached (https://github.com/trystan2k/padel-friend/pull/36 → main); consumed by PAF-10 (T10 implements the oracle as regression tests); League-side §82 invariants belong to PAF-11 (T11); references the pre-approved PAF-125 provisional-rating addendum

## Objective

- Human-approved deterministic V1 global-rating calibration plus a machine-readable golden fixture oracle that T10 (PAF-10) implements as regression tests. Documentation/approval deliverable only — no product code by design.

## Implementation Summary

- **HITL sign-off captured** for the full V1 model package:
  - Team strength = mean of partners' mu; expected score E = 1/(1+10^((S_opp−S_own)/2.0)); outcome score win 1.0 / draw 0.5 / loss 0.0.
  - Per-player delta = 0.30 × (1 − 0.75×rel/100) × (O − E_team), using the player's PRE-group reliability; sigma dormant at 1.00.
  - Single half-away-from-zero 2dp round of delta, then clamp to [0,7]; replay order (played_at, group_id).
  - Reliability = min(100, 10+6n); +6 for all four players on confirmed competitive groups.
  - Versioning stamped per event at app-wide `level/1.0.0`, config 1.
  - Provisional players treated identically: creator-estimated level initializes like self-declared; claim preserves rating history; a 0-rated-history player may set level at claim; first creator-entered level wins.
- **Deliverable 1 — `docs/rating/v1-calibration.md`**: approval record; formula + parameter table with K(r)=(6000−45r)/20000; precision/rounding/clamp/simultaneous-update/replay rules; reliability milestones; exclusions; margin rule; League independence; initialization + PAF-125 rules; fairness table a–i; fixture-backed explanation examples; PRD §27 field map; fixture contract + inventory; AC map; verification evidence; T10 notes.
- **Deliverable 2 — `docs/rating/golden-fixtures.json`**: 31 cases, 35 ratable groups, 5 invariants (margin, league, provisional, claim, exclusions); numeric policy encoded as data; engine/config stamps throughout.
- **Review fix — commit `b7ce323`**: spec claim-rule alignment with the pre-approved PAF-125 addendum; INV-claim comparison fields made explicit; AC-map clamp citations; approval-record clarification.
- **Post-review re-certification — commit `aa4dadd`**: inherited .pen provenance break fixed via user-approved re-certification — design source digest re-certified in 3 reference manifests (paf-6/7/8), 40 frames re-exported; committed PNGs unchanged.
- **Sign-off + records — commit `b66efce`**: product-owner artifact-level fixture sign-off recorded 2026-10-31 (spec sign-off row); plan, findings ledger, and this development log committed.

## Files Changed

- `docs/rating/v1-calibration.md` (new) — V1 calibration approval record and spec of record for T10.
- `docs/rating/golden-fixtures.json` (new) — machine-readable golden oracle (31 cases / 35 groups / 5 invariants).
- Reference manifests (`aa4dadd`): 3 visual reference manifests (paf-6/7/8) — digests re-certified, 40 frames re-exported; committed PNGs unchanged.
- Workflow records (`b66efce`): plan file, findings ledger `docs/plan/PAF-9-findings.md`, fixture sign-off row in `docs/rating/v1-calibration.md`, this development log. Context bundle remains a session artifact (not committed).

## Key Decisions

- **Delta-rounding (approved)** instead of the plan's final-mu rounding — differs only on negative half-cent ties (GF-21); spec documents T10 decimal/integer arithmetic guidance.
- **Reliability factor uses pre-group reliability**; the reliability schedule uses the post-increment count.
- **`last_rating_at` = group `played_at`** for determinism.
- **Claim clears `is_provisional` as metadata only**; a no-rated-history claim may set level (pre-approved PAF-125 addendum, clarified in the approval record after review).
- **Fairness resolutions recorded**: near-equal draw → 0.00 is correct; mismatch capped by logistic saturation (max one-group movement < 0.2775, ≤ 0.28 applied); 100% reliability = ×0.25 stability, not frozen; margin ignored in V1; PRD §26 numbers demoted to illustrative.

## Validation Performed

- **Implementation oracle**: Python decimal @ 60 digits + independent Node cross-check — 0 discrepancies; oxfmt/lint/typecheck green.
- **QA gate (independent)**: exact-integer-cents re-derivation — 31/31 cases, 35/35 groups, 140/140 player-results × ~31 fields, 0 mismatches; 4 exact half-cent ties (GF-21, r=40, K=0.21, win/loss raw ±0.105) verified correct; AC coverage matrix complete; contract soundness + internal consistency pass.
- **Review loop**: full review (3 findings) + delta review (1 finding, iteration 2) — all fixed in `b7ce323` and re-verified; findings ledger reconciled.
- **Final gate — `pnpm complete-check` ALL STAGES PASSED on final state `b66efce`**: static; unit 1400/1400 at 100% coverage thresholds intact; integration; e2e 269 incl. the `notifications.spec.ts:843` flake passing in-run — flake classified observe-only per user decision.
- **Delivery checks (at PR open)**: pushed once; CI static+unit green, integration/e2e shards in flight at last check; Copilot review requested (pending at time of writing).
- Rating/product source code unchanged by design — `aa4dadd` touches only visual reference manifests; no runtime behavior affected.

## Risks and Follow-ups

- **R1 (resolved)**: product-owner artifact-level fixture sign-off recorded 2026-10-31 — approval evidence committed via `b66efce` (spec sign-off row); resolves the previously pending HITL gate.
- **T10 arithmetic**: must use exact decimal/integer arithmetic — JS `Math.round` fails negative ties (`Math.round(-10.5)` → −10); guidance documented in the spec.
- **League-side scope**: §82 league-standings invariants are League-engine (T11/PAF-11) test obligations — out of this rating oracle's scope.
- **In flight at PR open**: Copilot review pending; CI integration/e2e shards running at last check (static+unit green); merge is a human decision.
- **E2E flake watch**: `notifications.spec.ts:843` flake passed in-run during final complete-check; classified observe-only per user decision — watch for recurrence.
