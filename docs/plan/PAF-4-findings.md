# PAF-4 Findings Ledger

Source of truth for the fix loop. Append rows; never rewrite history; never re-add a row that already exists.
Severity policy: `critical` + `major` block and MUST be fixed. `minor` is fixed only when trivial, else `deferred`. `nit` never blocks.

| id | severity | location | title | status | owner | iteration |
| -- | -------- | -------- | ----- | ------ | ----- | --------- |
| F1 | critical | e2e/global-setup.ts:35 | E2E prune deletes all local match data, incl. non-fixture developer events; loopback guard alone does not make the DB disposable | fixed | testing-automation-specialist | 1 |
| F2 | critical | src/features/matches/MatchCard.tsx:35 | Event and Maps links are unstyled browser-default blue on dark background (~1.95:1 contrast) | fixed | implementation-specialist | 1 |
| F3 | major | supabase/migrations/20261016120200_match_event_functions.sql:65 | Community timezone read from the wrong settings path; falls back to UTC and schedules events at wrong instants | fixed | bug-fixer-specialist | 1 |
| F4 | major | supabase/migrations/20261016120200_match_event_functions.sql:30 | Publication replay ignores changed optional facts (price/cutoff/capacity/levels/notes) and returns success | fixed | bug-fixer-specialist | 1 |
| F5 | major | src/features/matches/MatchesPage.tsx:54 | Match creation is unreachable through in-app navigation (no create link anywhere) | fixed | implementation-specialist | 1 |
| F6 | major | src/features/matches/CreateMatchPage.tsx:72 | Initial community selection never loads that community's saved venues | fixed | bug-fixer-specialist | 1 |
| F7 | major | src/features/matches/CreateMatchPage.tsx:330 | Failed publication stays frozen after edits; corrected submissions resend the rejected payload | fixed | bug-fixer-specialist | 1 |
| F8 | major | src/features/matches/MatchReview.tsx:20 | Review renders the raw staging storage key as an image URL (broken preview) | fixed | bug-fixer-specialist | 1 |
| F9 | major | src/features/matches/MatchDetailPage.tsx:114 | Detail omits published court notes, payment note, duration, capacity, level range and team mode | fixed | implementation-specialist | 1 |
| F10 | major | src/features/matches/MatchesPage.tsx:24 | Refreshed loader results never replace list state; successful retry still shows an empty list | fixed | bug-fixer-specialist | 1 |
| F11 | major | src/features/matches/MatchesPage.tsx:95 | Offline pagination failure permanently disables pagination; no reconnect recovery | fixed | bug-fixer-specialist | 1 |
| F12 | major | src/features/notifications/NotificationDetailPage.tsx:143 | Reconnect/refresh still calls v1 target resolver, downgrading authorized match targets | fixed | bug-fixer-specialist | 1 |
| F13 | major | src/features/matches/matches.styles.ts:4 | Visual hierarchy materially off the scoped Pencil layouts (gutters, heading type, section grouping, tab selection, primary action color) | fixed | implementation-specialist | 1 |
| F14 | major | src/features/matches/MatchReview.tsx:13 | Final review omits essential event facts (start, venue, type, visibility, level range) before immutable publish | fixed | implementation-specialist | 1 |
| F15 | major | src/features/matches/MatchCard.tsx:57 | Cards/detail omit suitability constraints (level range, team mode, maximum) and ignore `registration_open` | fixed | implementation-specialist | 1 |
| F16 | major | src/features/matches/CreateMatchPage.tsx:96 | Creation-options failure is reported as "no community"; no retryable error state | fixed | bug-fixer-specialist | 1 |
| F17 | major | src/routes/_protected.matches.$eventId.tsx:5 | All detail loader failures become a permanent-looking unavailable state; no retryable error path | fixed | bug-fixer-specialist | 1 |
| F18 | major | e2e/matches-visual.spec.ts:175 | Screenshot budgets (up to 49.5%) absorb structural defects; retained-section geometry is not independently gated | fixed | testing-automation-specialist | 1 |
| F19 | minor | test/matches.publication.integration.test.ts:593 | Claimed post-insert rollback test submits an empty photo path, so it never reaches the intended guard | fixed | testing-automation-specialist | 1 |
| F20 | minor | src/features/notifications/NotificationDetailPage.tsx:147 | Broadcast publication notifications are presented with invitation copy | deferred | deferred | 1 |
| F21 | minor | src/features/matches/MatchesPage.tsx:34 | Pagination omits the original `as_of` and recomputes the snapshot per page | deferred | deferred | 1 |
| F22 | minor | src/features/matches/match-model.ts:1 | Broad record DTOs discard schema guarantees | deferred | deferred | 1 |
| F23 | minor | src/features/matches/matches.functions.ts:59 | Per-card event lookup + signing request fan-out on listings | deferred | deferred | 1 |
| F24 | minor | supabase/migrations/20261016120200_match_event_functions.sql:129 | Invitation-first eligibility masks level approval requirements | deferred | deferred | 1 |
| F25 | minor | src/features/matches/MatchDetailsForm.tsx:99 | Checkbox labels do not guarantee the ≥44px touch area | deferred | deferred | 1 |
| F26 | major | e2e/references/paf-4/manifest.json referenceMeasurements | Screen gutter renders at the 6px/5px token insets instead of the reference's exact 18px shared axis (11/11 frames); no 18px step exists in the space scale | fixed | implementation-specialist | 2 |
| F27 | major | src/features/matches/matches.styles.ts | Vertical rhythm below the reference: list/create grids 5px and detail grid 6px vs reference 8px (list/detail) and 10px (create) between sibling cards | fixed | implementation-specialist | 2 |
| F28 | major | src/features/matches/matches.styles.ts activeLink | Selected-tab treatment is a --color-green-soft pill on a track-less row; the reference renders the active tab as a white pill on the 44px #e9efe8 (surface-2) full-width track | fixed | implementation-specialist | 2 |
| F29 | minor | src/features/matches/matches.styles.ts card | Card corner radius --radius-10 (10px) vs the reference's measured ~12px corner profile | fixed | implementation-specialist | 2 |
| F30 | major | src/features/matches/CreateMatchPage.tsx | Wizard continue action (Details/Players/Teams Next) renders as a white secondary button; the reference renders the continue action as the full-width --color-green 44px primary on every step | fixed | implementation-specialist | 2 |
| F31 | minor | src/features/matches/matches.styles.ts, src/features/matches/create-match.styles.ts | Dead `border:` shorthand declarations (cards/sections/surfaces): StyleX cannot split a shorthand with multiple var() substitutions and drops it at build time, so no border renders — the runtime is borderless exactly like the reference; the declarations are misleading source that would introduce a non-reference border if ever converted to longhands | open | implementation-specialist | 2 |

## Iteration 1 — fix-loop record

Findings fixed by owner in iteration 1: F1–F19.

Fixes delivered as:
- F1 + F19 — scoped the E2E prune to fixture-owned actors (`@test.local`), added a guard test proving non-fixture data survives; repaired the rollback test so it reaches the intended guard.
- F3 + F4 — authoritative community timezone resolution reused from `get_effective_community_admin_defaults`; replay now compares the complete normalised publication payload.
- F12 — all match-target resolution paths use v2; v1 preserved for legacy community consumers.
- F2, F5, F9, F10, F11, F13, F15, F17 — link contrast, discoverable create entry, published detail facts, loader-state reconciliation, reconnect pagination recovery, suitability constraints, retryable detail errors.
- F6, F7, F8, F14, F16 — scoped initial options/venues, publication identity reset on edit, signed review preview, review facts, distinct options-failure state.
- F18 — reference-derived structural gates + exactly-one `aria-current` + recalibrated budgets (worst 49.5% → 41.5%).

F26–F30 were surfaced by the F18 re-gate and are being fixed in the same iteration.

## Iteration 2 — F26–F30 fix round and visual-gate recalibration

F26–F30 fixed by the owning unit (implementation-specialist) and re-gated by testing-automation-specialist: gutter axis `--space-18` on list/detail/create, rhythm `--space-8` (list/detail) and `--space-10` (create), white `--color-surface` pill on the 44px `--color-surface-2` tab track, exact `--radius-12` card corners, full-width `--color-green` 44px continue action on every wizard step. All five are now asserted at their exact reference values by the tightened structural gates (`assertGutterAxis`, `assertRhythm`, `assertTabSet`, `assertCardGrouping`, new `assertFullWidthPrimaryAction`), and every per-screen budget was re-measured honestly (`VISUAL_CALIBRATE=1`) and re-pinned from the corrected UI.

F31 (new, minor, no rendered delta): the styles files still declare `border:` shorthands that StyleX silently drops (un-splittable var() shorthand), so cards render borderless — exactly the reference treatment. Dead source code only; `assertCardGrouping` gates the reference truth (borderless + exact 12px radius), so any future border introduction fails the gate.
