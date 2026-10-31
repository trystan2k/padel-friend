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
- Commits (2, oldest first): `7a13d87` (docs: approve v1 global rating calibration and golden fixtures — adds `docs/rating/v1-calibration.md` +331 and `docs/rating/golden-fixtures.json` +13511), `b7ce323` (fix: address review findings — spec claim-rule alignment with PAF-125 addendum, INV-claim comparison fields made explicit, AC-map clamp citations, approval-record clarification; +18/−15 md, +3/−2 json)
- Diff: 2 delivered files, net new (+13,842/−17 across both commits)
- Artifacts: plan `docs/plan/Plan PAF-9 T09 — Approve V1 global-rating calibration and golden outcomes.md`, findings ledger `docs/plan/PAF-9-findings.md`, context bundle (workflow artifacts — not part of delivery commits)
- Phase time tracking: Prep 5m08s · Planning 4m21s · Implementation 8m17s · QA 25m26s · Review 5m59s (accrued across full review + fix loop + delta review)
- Related Linear: PAF-9 (T09, project PadelFriend); consumed by PAF-10 (T10 implements the oracle as regression tests); League-side §82 invariants belong to PAF-11 (T11); references the pre-approved PAF-125 provisional-rating addendum

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

## Files Changed

- `docs/rating/v1-calibration.md` (new) — V1 calibration approval record and spec of record for T10.
- `docs/rating/golden-fixtures.json` (new) — machine-readable golden oracle (31 cases / 35 groups / 5 invariants).
- Workflow artifacts (not part of delivery commits): plan file, findings ledger, context bundle.

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
- No product code changed by design; no runtime/test suites affected.

## Risks and Follow-ups

- **R1 (open)**: product-owner artifact-level sign-off pending — scheduled HITL gate before push/PR completion claim; approval evidence must be recorded.
- **T10 arithmetic**: must use exact decimal/integer arithmetic — JS `Math.round` fails negative ties (`Math.round(-10.5)` → −10); guidance documented in the spec.
- **League-side scope**: §82 league-standings invariants are League-engine (T11/PAF-11) test obligations — out of this rating oracle's scope.
