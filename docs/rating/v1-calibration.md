# V1 Global Rating Calibration

Normative specification of the V1 app-wide rating calculation. Companion oracle:
[`golden-fixtures.json`](./golden-fixtures.json).

## Approval record

| Field                   | Value                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| Status                  | Parameters approved                                                                        |
| Approved by             | Product owner, explicit HITL sign-off during the PAF-9 delivery session                    |
| Date                    | 2026-10-30                                                                                 |
| `rating_engine`         | `app-wide-level`                                                                           |
| `rating_engine_version` | `1.0.0`                                                                                    |
| `rating_config_version` | `1`                                                                                        |
| Supersedes              | Nothing (first approval)                                                                   |
| Fixture review          | Pending product-owner review of `golden-fixtures.json` and this document before T10 starts |

Clarification (no new decision): per the pre-approved PAF-125 addendum, claim preserves all rating
history, clears `is_provisional` (account-status metadata only), and a player with 0 rated groups may
set a new level at claim; after the first rated group, only PAF-17 review can change the level.

The approved decisions are: (1) the model package in [Calculation](#calculation), (2) the version
tuple above, (3) the provisional-player rules in [Initialization](#initialization). Any change to a
parameter, rounding rule or eligibility rule requires a new `rating_config_version`; events already
stamped `1` are never rewritten.

PRD anchors: `docs/prd/padel-friends-prd-v1.md` §§12.3, 25.1–25.10, 26, 27, 82. The PRD
recommends a TrueSkill-style model (§25.2) but explicitly allows a "mathematically equivalent"
expected-outcome model (§25.6); the product owner chose the team-aware expected-outcome model below.

## Calculation

For one Confirmed Competitive Game Group with Team A and Team B, two players each:

```text
S_team      = (mu_partner1 + mu_partner2) / 2
E_team      = 1 / (1 + 10^((S_opponents - S_own) / 2.0))
K(r)        = 0.30 * (1 - 0.75 * r / 100)          r = player's reliability_percent BEFORE the group
raw_delta   = K(r) * (O_team - E_team)
rounded     = round_half_away_from_zero(raw_delta, 2)
mu_after    = clamp(mu_before + rounded, 0.00, 7.00)
applied     = mu_after - mu_before                  (the history "delta")
display_level_after = mu_after
```

### Parameters

| Parameter                     | Value                                                      |
| ----------------------------- | ---------------------------------------------------------- |
| Team strength                 | Arithmetic mean of both partners' current `mu`             |
| Logistic base / divisor       | 10 / 2.0 (a 2.00 strength gap gives E ≈ 0.909)             |
| Base step `K`                 | 0.30                                                       |
| Reliability damping           | `1 − 0.75 × r/100` (×0.925 at 10%, ×0.25 at 100%)          |
| Outcome values `O`            | Win 1.0, Draw 0.5, Loss 0.0 (teammates share `O`)          |
| `E_team`                      | Same value for both partners; `E_A + E_B = 1`              |
| Intermediate rounding         | None                                                       |
| Final rounding                | Per player, once, `raw_delta` to 2 dp, half away from zero |
| Clamping                      | After rounding, to `[0.00, 7.00]`                          |
| `sigma`                       | Stored, stays `1.00`, not used in V1 (dormant)             |
| Display                       | `display_level = mu`, 2 dp                                 |
| Score margin / League metrics | Never inputs                                               |

K by reliability: 10% → 0.2775, 16% → 0.264, 40% → 0.21, 70% → 0.1425, 94% → 0.0885,
100% → 0.075. `K(r)` is exactly `(6000 − 45r) / 20000`.

### Precision and rounding

- All arithmetic is exact (or high precision for `10^x`) until the single rounding step.
- `round_half_away_from_zero(x, 2) = sign(x) × floor(|x| × 100 + 0.5) / 100`; `-0.00` is `0.00`.
- The approved rule rounds the **delta**, not the projected `mu`. They differ on negative
  half-cent ties: in `GF-21-rounding-midpoint` the losers' raw delta is exactly −0.105 → −0.11;
  rounding `4.10 − 0.105 = 3.995` would give 4.00 (−0.10). Delta rounding keeps wins and losses
  symmetric.
- Exact half-cent ties can only occur at equal team strengths (`E = 0.5`), because `10^x` is
  irrational for non-integer `x`. Naive binary floating point fails them: in JavaScript
  `Math.round(-10.5)` is `-10` and `(-0.105).toFixed(2)` is `"-0.10"`. T10 must use decimal or
  exact-integer arithmetic for this path; no epsilon fudge. All non-tie fixture deltas sit at
  least 0.0187 cents away from a rounding boundary, so double-precision `E` is safe there.

### Clamping

At 0.00 a loss (or a negative draw delta) cannot move the player further down; at 7.00 a gain
cannot move further up. The clamped value is the new `mu`; `applied` records the actual movement
(possibly 0.00). The next in-range result moves the player normally from the clamped value
(`GF-07` step 2, `GF-08`). Clamping never blocks reliability or group-count progress.

### Simultaneous update

Read all four pre-group states, compute both strengths and `E` once, then update all four
players. No update inside a group affects another player in the same group. Totals need not be
zero-sum because partners have different `K`.

### Replay order

Game Groups apply in ascending `(played_at, game_group_id)`. `played_at` compares as an instant
(canonical ISO 8601 UTC); `game_group_id` compares as the lowercase canonical UUID string (same as
PostgreSQL `uuid` ordering). Input/ingestion order is irrelevant. Each group uses the rounded,
clamped state left by the previous one. `GF-14-identical-played-at` pins the tie-break and shows
the reverse order would produce different final levels.

### Supporting state fields

| Field                               | After a ratable group                           |
| ----------------------------------- | ----------------------------------------------- |
| `confirmed_competitive_game_groups` | `+1` for all four players, any result           |
| `reliability_percent`               | `min(100, 10 + 6 × groups_after)`               |
| `highest_display_level`             | `max(highest_before, display_level_after)`      |
| `last_rating_at`                    | Group `played_at` (deterministic on replay)     |
| `sigma`                             | Unchanged `1.00`                                |
| Engine stamps                       | `app-wide-level` / `1.0.0` / `1` on every event |

`played_at` is chosen over confirmation time for `last_rating_at` so that replaying the same
groups always yields the same state, independent of when review or auto-confirm happened.

## Reliability schedule

`reliability_percent = min(100, 10 + 6 × confirmed_competitive_game_groups)` (PRD §§12.3, 25.5).

| Confirmed competitive groups | 0   | 1   | 2   | 3   | 4   | 5   | 10  | 14  | 15+ |
| ---------------------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Reliability %                | 10  | 16  | 22  | 28  | 34  | 40  | 70  | 94  | 100 |

All four players get +1 group / +6% for every Confirmed Competitive group, regardless of win,
loss, draw, a 0.00 rounded delta or a clamp. The delta uses the reliability **before** the
group. Pins: `GF-19` (10→16→22→28→34), `GF-20` (94→100 at the 15th group).

## Eligibility and exclusions

A group is ratable only when `match_type = competitive`, `classification ∈ {team_a, team_b, draw}`
and `result_status = confirmed` (auto-confirmed counts identically). Everything else has **zero**
effect: no rating event, and `mu`, `display_level`, `sigma`, reliability, group count, highest and
`last_rating_at` stay unchanged (PRD §§25.1.15–16, 82).

| Situation                    | Fixture            |
| ---------------------------- | ------------------ |
| Friendly (even if Confirmed) | `GF-09-friendly`   |
| Incomplete / Abandoned       | `GF-10-incomplete` |
| Pending                      | `GF-11-pending`    |
| Disputed                     | `GF-12-disputed`   |

- **Score margin** is stored for statistics only and never multiplies the delta (PRD §25.8):
  `GF-01`, `GF-13a` (6-0 6-0) and `GF-13b` (7-6 4-6 7-5) produce identical rating outputs.
- **League independence**: global rating is app-wide. `league_id` / `community_id` are provenance
  fields in history only; League position, points, Wins/Losses or Sets never enter the formula,
  and a global rating change never changes League standings (PRD §82). `GF-23a` (League) and
  `GF-23b` (no League) are identical.

## Initialization

- A self-declared onboarding level (0.0–7.0, step 0.1) and a creator-estimated level for a
  provisional player initialise identically: `mu = display_level = highest_display_level = level`
  (stored 2 dp), `initial_display_level = level` (1 dp), `sigma = 1.00`, reliability 10%,
  groups 0, `last_rating_at = null`.
- Provisional status is not a rating input. Reliability follows the confirmed-group count only;
  there is no provisional penalty (`GF-15` equals `GF-06`).
- The first creator-entered level wins; later adders cannot overwrite it (`GF-26`).
- Account claim keeps the same `user_id` and preserves all rating state and history (`mu`,
  display levels, reliability, groups, events); it creates no rating event (`GF-16a` equals
  `GF-16b`). The only exception is the level rule below.
- A successful claim clears `is_provisional`. This is account-status metadata only, not a
  rating-history change and zero rating effect (`GF-16a`, `GF-24`, `GF-25`).
- At claim, a player with no rated history (0 groups) may set a new level (pre-approved PAF-125
  addendum); this re-initialises as above and is not a rating event (`GF-24`). With rated history the claim succeeds but the level
  change is rejected (`GF-25`); afterwards only a PAF-17 Platform Admin Level Review (forward-only)
  can change it.

## Fairness concerns and resolutions

All concerns below are resolved by the approved parameters; none is left open for T10.

| #   | Concern                                    | Approved resolution                                                                                                                                                                                               | Fixtures                        |
| --- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| a   | Draw near equal strength shows no movement | Correct. Equal draw is exactly 0. A 0.02 gap at 40% yields raw ±0.0012 → 0.00; sub-cent evidence is not displayed. Reliability still advances. A 0.10 gap at 22% already moves ±0.01.                             | `GF-03`, `GF-27`, `GF-19` g3    |
| b   | Very mismatched teams                      | Logistic saturation caps movement. Expected result at gap 6.20 rounds to 0.00; the upset moves ±0.26 at 16%. Worst case for any player in any group: `abs(raw_delta) < K(10%) = 0.2775`, so never more than 0.28. | `GF-17`                         |
| c   | 100% reliability looks "frozen"            | Not frozen: K = 0.075 (×0.25 of base), equal-strength win = +0.04. "100%" means fully established under the V1 rule, not certainty (PRD §25.5); stability = smallest configured movement.                         | `GF-20`, `GF-18`                |
| d   | Blowouts vs narrow wins                    | Score margin deliberately ignored in V1 (PRD §25.8). Identical deltas.                                                                                                                                            | `GF-13a`, `GF-13b`              |
| e   | Provisional players                        | Treated identically to self-declared players. Claim clears `is_provisional` (metadata) and changes no rating history; only a player with 0 groups may set a new level at claim, never after rated history.        | `GF-15`, `GF-16a/b`, `GF-24–26` |
| f   | PRD example numbers                        | §26 `+0.08` / `+0.04` are illustrative wording only, not normative values. No parameter was derived from them; explanations below use real fixture numbers.                                                       | `GF-05`                         |
| g   | Deterministic replay                       | Replay order `(played_at, game_group_id)`; `last_rating_at = played_at`; exact arithmetic with one rounding. Same inputs always give same history.                                                                | `GF-14`, `GF-21`                |
| h   | Partners gain different amounts            | Intended (PRD §25.1.14): same `E` and `O`, different `K`. Group totals may be non-zero-sum (`GF-18`: +0.18 / −0.08).                                                                                              | `GF-05`, `GF-18`                |
| i   | Boundary players                           | Clamp truncates applied movement only; reliability still advances; in-range movement resumes from the boundary.                                                                                                   | `GF-07`, `GF-08`                |

## Player-facing explanation examples

Documentation examples derived from fixture values; not UI copy. T10 owns en/pt-BR/es copy and
must build explanations from the stored history fields (own/opponent strength, expected score,
reliability before, applied delta).

**Same match, different reliabilities** — `GF-05-mixed-reliability`. Team A (strength 3.90) beat
Team B (4.20); Team A's expected score was 0.41 (41%).

- p1 (reliability 16%, 3.80 → 3.95):
  > You gained +0.15. Your team was rated below your opponents (3.90 vs 4.20), so this win was
  > better than expected. Your reliability is still low (16%), so the adjustment was larger.
- p2 (reliability 82%, 4.00 → 4.07):
  > You gained +0.07. Same result and same expectation as your partner, but your reliability is
  > higher (82%), so your rating moved less.
- p4 on the losing team (28%, 4.10 → 3.96): −0.14; p3 (100%, 4.30 → 4.26): −0.04.

**Draw** — `GF-04-weaker-team-draw`. Team A (3.10) drew Team B (4.10); Team A's expected score was
0.24.

- p1 (40%, 3.00 → 3.05):
  > You gained +0.05. A draw against a stronger team (3.10 vs 4.10) is better than expected.
- p3 (40%, 4.00 → 3.95):
  > You lost −0.05. A draw against a weaker team (4.10 vs 3.10) is below expectation.

**Upset** — `GF-02-upset`. Team B (3.50) beat Team A (4.10); Team B's expected score was 0.33.

- p3 (40%, 3.60 → 3.74):
  > You gained +0.14. Your team was rated well below your opponents (3.50 vs 4.10), so this win was
  > a strong result.
- p1 (40%, 4.20 → 4.06):
  > You lost −0.14. Your team was favoured (4.10 vs 3.50), so this loss counted heavily.

**No visible change** — explanations must not promise movement that did not happen:

- `GF-03` (equal Draw): "Your level did not change: the teams were evenly matched and the result
  was a draw. Your reliability increased to 46%."
- `GF-08` p2 (at 7.00): "You won, but your level is already at the maximum 7.00. Your reliability
  increased to 28%."

## Rating history fields

Per player per ratable group (PRD §27); each fixture `player_results` entry carries them:

| PRD §27 field                | Fixture field                                                     |
| ---------------------------- | ----------------------------------------------------------------- |
| rating before / after        | `rating_before` / `rating_after` (`mu`)                           |
| display level before / after | `display_level_before` / `display_level_after`                    |
| reliability before / after   | `reliability_before` / `reliability_after`                        |
| delta                        | `applied_delta` (also `raw_delta`, `rounded_delta`)               |
| own / opponent team strength | `own_team_strength` / `opponent_team_strength`                    |
| expected win probability     | `expected_score` (own team)                                       |
| match ID / League ID         | `match_id` / `league_id` (nullable)                               |
| timestamp                    | `timestamp` (= `played_at`)                                       |
| algorithm version            | `rating_engine`, `rating_engine_version`, `rating_config_version` |

Fixtures also record `game_group_id`, `team`, `outcome_value`, `reliability_factor`, `clamped`,
group counts, `sigma` and highest before/after.

## Golden fixtures

File: `docs/rating/golden-fixtures.json` (`fixture_format_version` `1`). Top level: `model`
(name, engine stamps, parameters, formulas, rules as data), `numeric_policy`, `cases`,
`invariants`.

Each case: `id`, `title`, `requirement_tags`, `description`, `initial_state` keyed by user UUID,
ordered `steps` (`game_group`, `account_claim`, `provisional_level_proposal`), each with `input`
and `expected` (`rating_event`, strengths, `expected_score_team_a/b`, `player_results`,
`state_after`), plus `expected_rating_event_order` and `expected_final_state`. `GF-14` adds
`ingestion_order` and a non-normative `reverse_order_counterfactual`.

Numeric policy: 2-dp values are decimal strings compared exactly; team strengths are exact 3-dp
strings; `expected_score` and `raw_delta` are 20-fractional-digit strings compared with absolute
tolerance `1e-12`; counts and reliability are integers; non-ratable strengths/`E` are `null`
(not calculated, not `E = 0`).

### Inventory

Deltas are rounded per player; "A" / "B" = team.

| Case                                     | Covers                             | Strength A / B | E_A    | Outcome A | Applied deltas                                        |
| ---------------------------------------- | ---------------------------------- | -------------- | ------ | --------- | ----------------------------------------------------- |
| `GF-01-expected-win`                     | expected win/loss                  | 4.100 / 3.500  | 0.6661 | win       | A +0.07 +0.07; B −0.07 −0.07                          |
| `GF-02-upset`                            | upset                              | 4.100 / 3.500  | 0.6661 | loss      | A −0.14 −0.14; B +0.14 +0.14                          |
| `GF-03-equal-draw`                       | equal Draw                         | 4.000 / 4.000  | 0.5    | draw      | all 0.00                                              |
| `GF-04-weaker-team-draw`                 | weaker-team Draw                   | 3.100 / 4.100  | 0.2403 | draw      | A +0.05 +0.05; B −0.05 −0.05                          |
| `GF-05-mixed-reliability`                | different reliabilities            | 3.900 / 4.200  | 0.4145 | win       | A +0.15 (16%) +0.07 (82%); B −0.04 (100%) −0.14 (28%) |
| `GF-06-first-group`                      | first competitive group            | 3.250 / 3.250  | 0.5    | win       | A +0.14 +0.14; B −0.14 −0.14                          |
| `GF-07-boundary-zero` g1                 | 0.00 clamp                         | 0.025 / 0.450  | 0.3801 | loss      | A −0.05 (clamped) 0.00 (clamped); B +0.10 +0.10       |
| `GF-07-boundary-zero` g2                 | move off 0.00                      | 0.000 / 0.550  | 0.3468 | win       | A +0.15 +0.15; B −0.15 −0.15                          |
| `GF-08-boundary-seven`                   | 7.00 clamp                         | 6.975 / 6.450  | 0.6467 | win       | A +0.05 (clamped) 0.00 (clamped); B −0.09 −0.09       |
| `GF-09-friendly`                         | Friendly                           | —              | —      | win       | no event, unchanged                                   |
| `GF-10-incomplete`                       | Incomplete                         | —              | —      | —         | no event, unchanged                                   |
| `GF-11-pending`                          | Pending                            | —              | —      | win       | no event, unchanged                                   |
| `GF-12-disputed`                         | Disputed                           | —              | —      | win       | no event, unchanged                                   |
| `GF-13a-margin-blowout`                  | margin invariance                  | 4.100 / 3.500  | 0.6661 | win       | = `GF-01`                                             |
| `GF-13b-margin-narrow`                   | margin invariance                  | 4.100 / 3.500  | 0.6661 | win       | = `GF-01`                                             |
| `GF-14` g …016                           | identical `played_at`              | 3.800 / 4.000  | 0.4427 | win       | A +0.13 +0.13; B −0.13 −0.15 (10%)                    |
| `GF-14` g …017                           | uses post-…016 state               | 4.265 / 3.785  | 0.6347 | loss      | A −0.14 −0.11; B +0.05 (100%) +0.14                   |
| `GF-15-provisional-first-group`          | provisional equivalence            | 3.250 / 3.250  | 0.5    | win       | = `GF-06`                                             |
| `GF-16a` / `GF-16b` g1                   | claim invariance                   | 3.400 / 3.500  | 0.4712 | win       | A +0.15 +0.15; B −0.15 −0.15                          |
| `GF-16a` / `GF-16b` g2                   | claim invariance                   | 3.300 / 3.600  | 0.4145 | loss      | A −0.11 −0.11; B +0.11 +0.11                          |
| `GF-17-extreme-mismatch` g1              | expected, saturated                | 6.700 / 0.500  | 0.9992 | win       | all 0.00                                              |
| `GF-17-extreme-mismatch` g2              | upset, saturated                   | 6.700 / 0.500  | 0.9992 | loss      | A −0.26 −0.26; B +0.26 +0.26                          |
| `GF-18-low-vs-high-reliability`          | low-reliability partner            | 4.000 / 4.000  | 0.5    | win       | A +0.14 (10%) +0.04 (100%); B −0.04 −0.04             |
| `GF-19` g1                               | reliability 10→16                  | 3.200 / 3.300  | 0.4712 | win       | A +0.15 +0.15; B −0.15 −0.15                          |
| `GF-19` g2                               | reliability 16→22                  | 3.350 / 3.150  | 0.5573 | loss      | A −0.15 −0.15; B +0.15 +0.15                          |
| `GF-19` g3                               | reliability 22→28, near-equal Draw | 3.200 / 3.300  | 0.4712 | draw      | A +0.01 +0.01; B −0.01 −0.01                          |
| `GF-19` g4                               | reliability 28→34                  | 3.050 / 3.450  | 0.3869 | win       | A +0.15 +0.15; B −0.15 −0.15                          |
| `GF-20-full-reliability-moves`           | 100% still moves, 94→100           | 5.100 / 5.100  | 0.5    | win       | A +0.04 (100%) +0.04 (94%); B −0.04 −0.04             |
| `GF-21-rounding-midpoint`                | exact ±0.105 ties                  | 4.100 / 4.100  | 0.5    | win       | A +0.11 +0.11; B −0.11 −0.11                          |
| `GF-22a-strong-partner`                  | partner strength                   | 4.500 / 4.000  | 0.6401 | win       | A +0.08 +0.08; B −0.08 −0.08                          |
| `GF-22b-weak-partner`                    | partner strength                   | 3.500 / 4.000  | 0.3599 | win       | A +0.13 +0.13; B −0.13 −0.13                          |
| `GF-23a-league-context`                  | League independence                | 4.100 / 3.500  | 0.6661 | win       | = `GF-01`                                             |
| `GF-23b-no-league-context`               | League independence                | 4.100 / 3.500  | 0.6661 | win       | = `GF-01`                                             |
| `GF-24-claim-level-change-no-history`    | claim re-initialises 3.0→3.5       | 3.500 / 3.500  | 0.5    | loss      | A −0.14 −0.14; B +0.14 +0.14                          |
| `GF-25-claim-level-change-after-history` | claim cannot change level          | 3.250 / 3.250  | 0.5    | win       | A +0.14 +0.14; B −0.14 −0.14; claim rejected level    |
| `GF-26-first-creator-wins`               | first estimate persists            | 3.250 / 3.250  | 0.5    | win       | A +0.14 +0.14; B −0.14 −0.14                          |
| `GF-27-near-equal-draw`                  | near-equal Draw → 0.00             | 4.000 / 4.020  | 0.4942 | draw      | all 0.00                                              |

Invariants (`invariants` in JSON): `INV-margin`, `INV-league`, `INV-provisional`, `INV-claim`
(identical rating outputs) and `INV-exclusions` (final state equals initial state, no events).

### Acceptance-criteria map

| AC                                                                       | Proof                                                                                                                  |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| AC1 formula, parameters, rounding, clamping, reliability, ties, versions | [Calculation](#calculation), [Approval record](#approval-record), `GF-07`, `GF-08`, `GF-14`, `GF-19`, `GF-20`, `GF-21` |
| AC2 golden before/after cases                                            | `GF-01`–`GF-08`, `GF-17`–`GF-20`                                                                                       |
| AC3 exclusions, margin                                                   | `GF-09`–`GF-13b`, `INV-exclusions`, `INV-margin`                                                                       |
| AC4 explanations, no League metric                                       | [Explanations](#player-facing-explanation-examples), `GF-23a/b`                                                        |
| AC5 fairness resolved, no inferred PRD numbers                           | [Fairness](#fairness-concerns-and-resolutions)                                                                         |
| PAF-125 addendum                                                         | `GF-15`, `GF-16a/b`, `GF-24`–`GF-26`                                                                                   |

## Verification evidence

- Oracle values computed offline with Python 3.13.7 `decimal` (60 significant digits, correctly
  rounded `10^x`, `ROUND_HALF_UP` = half away from zero).
- Independently recomputed by a separately written Node.js v26.11.1 check (IEEE double for `E`,
  exact integer path for `E = 0.5`): all 31 cases, 35 ratable groups, every per-player value,
  every `state_after`, event order, score/classification coherence, reliability/count consistency
  and all invariants matched; 0 discrepancies. The 4 exact half-cent ties are in `GF-21`.
- Scratch scripts were ephemeral and are not part of the repository.

## T10 implementation notes

- Consume `docs/rating/golden-fixtures.json` unchanged as the regression oracle; never edit
  expected values to match an implementation. A wrong value means an engine bug or a new
  `rating_config_version`.
- Stamp every rating event with the three version strings. The current `global_player_ratings`
  table has no `rating_config_version`; T10 adds it to the event ledger.
- Implement exact half-cent handling (decimal or integer arithmetic), simultaneous four-player
  updates, `(played_at, game_group_id)` replay order and the zero-effect exclusions.
- Account claim and creator-level proposals emit no rating events.
- This task delivers documentation and data only; it claims no code coverage.
