---
title: PAF-11 T11 Create Leagues and select Ranked Match Events
type: development-log
permalink: docs/development-logs/task-PAF-11-t11-create-leagues-and-select-ranked-match-events
---

# Development Log: PAF-11

## Metadata

- Task ID: PAF-11 (T11 — Create Leagues and select Ranked Match Events; epic parent delivered via sub-issues PAF-138/PAF-139/PAF-140/PAF-141/PAF-142 as units U1–U5)
- Date (UTC): 2026-11-02
- Project: padel-friend
- Branch: `feature/PAF-11-create-leagues-and-select-ranked-match-events` (from `origin/main` `2c5f63bb`; base for PR: `main`)
- Commits (12, oldest first, one per unit + review-fix loop):
  1. `5161f72` (feat: league domain, lifecycle, secured commands and UI — U1/PAF-138)
  2. `609a946` (feat: explicit Ranked League binding and members-only admission — U2/PAF-139)
  3. `5fc2ac7` (feat: ranked reconfirmation and League edit enforcement — U3/PAF-140)
  4. `6eb90ed` (feat: result-time ranked eligibility and League counters — U4/PAF-141)
  5. `dea1ee9` (test: E2E and visual coverage for leagues and ranked matches — U5/PAF-142)
  6. `5262f2c` (fix: review round 1 — F1–F10)
  7. `cf64046` (fix: review round 2)
  8. `74e8e71` (fix: review round 3)
  9. `d831436` (fix: review round 4)
  10. `82720aa` (fix: review round 5)
  11. `4c2cf13` (fix: review round 6, part 1)
  12. `efb1899` (fix: review round 6, part 2)
- Artifacts: plan `docs/plan/Plan PAF-11 T11 — Create Leagues and select Ranked Match Events.md` (AC matrix, shared contracts, binding C0 decisions Q1–Q4), context bundle `docs/plan/PAF-11-bundle.md`, findings ledger `docs/plan/PAF-11-findings.md` (7 delta review rounds), this development log
- Related Linear: PAF-11 epic + sub-issues PAF-138–PAF-142 (project PadelFriend)

## Objective

- Community members create period-based Leagues; Match Creators explicitly bind eligible Competitive events to one existing League (Ranked) or opt out (Unranked); members-only ranked admission including provisional members; result-time eligibility revalidated at `played_at`; reconfirmation when Ranked/League keys change; narrow provisional-safe League counters. The approved per-event Ranked policy supersedes contradictory PRD auto-inclusion passages.

## Implementation Summary

- **U1 — League domain/lifecycle/UI (`5161f72`)**: `leagues` table + append-only `league_events` audit with identity-guard trigger; one-Active-per-community partial unique index; Upcoming/Active/Closed lifecycle with blocked-conflict state (Q3 policy) driven by pg_cron `process_due_leagues`; 6 secured SQL commands (SECURITY DEFINER, empty `search_path`, provisional-actor restrictions, RLS); fail-closed TS contracts/decoders/validators/server functions under `src/features/leagues/`; Create/List/Detail/Entries pages + route states; 3 protected community league routes + dashboard entry link; en/pt-BR/es copy; league fixtures.
- **U2 — Ranked binding/admission (`609a946`)**: nullable `match_events.league_id` with composite FK (null = Unranked); publish-time ranked intent with replay equality plus publication-time existence anchor — no retroactive binding; `list_match_league_options` for candidate selection; members-only ranked gate across every admission writer, including provisional add-by-email with blind `ranked_members_only` outcome; `MatchCompetitionField`/`MatchCompetitionBadge` UI.
- **U3 — Reconfirmation (`5fc2ac7`)**: `edit_match_event` accepts ranked/League keys with one-statement merged-state validation (`assert_match_league_window`/impact helpers); typed errors `MATCH_MANAGEMENT_LEAGUE_OUT_OF_PERIOD`, `LEAGUE_UNAVAILABLE`, `LEAGUE_CLOSED`, `LEAGUE_FRIENDLY`, `RANKED_NONMEMBERS_ACCEPTED`; major-consent generation for rank/League/date changes (once per effective edit; registrations + attempts atomic); AC13 provisional system-carry (`reconfirmation_carried` audit, no counterfeit consent); `MatchLeagueImpact` + edit repair panels.
- **U4 — Result eligibility + counters (`6eb90ed`)**: actual-quartet historical membership intervals + League window at `played_at` enforced in shared `validate_match_event_result_facts` AND `finalize_match_event_result_locked` (manual/deadline/scheduler paths); typed rejections; scheduler `ranked_ineligible` blocked receipts; `get_league_counters` (per-UUID Matches/W/L/D/sets, provisional ordinary participants, claim-stable); `MatchResultRankedBlocked` UI.
- **U5 — E2E/visual (`dea1ee9`)**: 22 E2E tests (leagues 6, matches-ranked 7, leagues-visual 9); Pencil-derived references `e2e/references/paf-11/` (ik5JC/MYsDp/wHaAb) + manifest + provenance test; compact result-card blocked-state fix; E2E fixture stability fixes.
- **Review fix loop (7 delta rounds, all findings fixed)**:
  - Round 1 `5262f2c` (F1–F10): immutable `league_event_references` history keeps the period lock alive across event switches; `created_at` after community lock closes the retroactive-binding race; selection intent preserved (no silent candidate substitution); fair scheduler batching; list truncation indicator; edit-dialog save blocking + retry; counters unavailable state; visual-gate column-geometry probes + per-variant MYsDp captures + both-axis touch targets.
  - Round 2 `cf64046`: audit-history backfill for switched-away references; scheduler attempt bounds + rotation; list continuation (Show more); draft-intent radios + empty-response intent preservation + blocked-save messaging.
  - Round 3 `74e8e71`: `pg_input_is_valid`-guarded audit casts (+ amended on-branch round-2 migration); keyset pagination `(created_at, id)` replacing offsets with cross-page dedupe; rotation cleanup; advisory-lock serialization (`pg_try_advisory_xact_lock` busy-exit); Show-more focus management.
  - Round 4 `d831436`: rendered-order focus target; duplicate-only-final-page completion-status focus; first-page total snapshot + reload hint; bounded cleanup (limit×4); keyset index.
  - Round 5 `82720aa`: no focus steal when the user navigates away; indexed bounded examination window (limit×16 examined / ×4 deleted); production-plan EXPLAIN + `plan_cache_mode=force_custom_plan` on `list_leagues`.
  - Round 6 `4c2cf13` + `efb1899`: production-shape plan test (Index Only Scan with both predicates, both cursor shapes, negative check) + non-vacuous Index Cond assertion.

## Files Changed

- 126 files total, +16744/−96 (per-unit: U1 35/+6925, U2 36/+2262, U3 35/+2799, U4 35/+3310, U5 18/+1476). Per-commit file-level diffs live in git history on the delivery branch; grouped scope below.
- **Migrations (9 new, `supabase/migrations/`)**: `20261101160000_league_domain.sql` + `20261101161000_league_commands.sql` (U1), `20261101170000_match_league_binding.sql` (U2), `20261101180000_ranked_event_reconfirmation.sql` (U3), `20261101190000_ranked_result_eligibility.sql` + `20261101191000_league_counters.sql` (U4), review hardening `20261101192000_league_review_hardening.sql` (F1), `20261101193000_league_review_round2.sql` (round-2 backfill incl. `pg_input_is_valid` amendments), `20261101194000_league_review_round3.sql` (keyset index + rotation cleanup + advisory-lock + `plan_cache_mode` pin).
- **New feature module (`src/features/leagues/`, 15 files)**: `league-contracts.ts`, `league-decoders.ts`, `league.validators.ts`, `league.functions.ts`, `league-errors.ts`, `league-form.ts`, `league.styles.ts`, `CreateLeaguePage.tsx`, `LeagueListPage.tsx`, `LeagueDetailPage.tsx`, `LeagueSummary.tsx`, `LeagueEntries.tsx`, `LeagueCounters.tsx`, `LeagueForm.tsx`, `LeagueRouteStates.tsx`.
- **Extended matches feature (`src/features/matches/`)**: server functions/writers (publish intent + replay equality, members-only admission gate, edit ranked/League keys, result-eligibility rechecks), `match-contracts.ts`/`match-decoders.ts`/`match-registration-model.ts`/`match-invitation-model.ts`/`match-status-tone.ts`/`match-registration-error-copy.ts`, UI `MatchCompetitionField.tsx`, `MatchCompetitionBadge.tsx`, `MatchLeagueImpact.tsx`, `MatchResultRankedBlocked.tsx`, plus `MatchDetailsForm`, `MatchDetailPage`, `MatchEditDialog`, `MatchCard`, `MatchResultReview`, `MatchReconfirmationPanel`.
- **Routes**: `src/routes/_protected.community.$communityId.leagues.create.tsx`, `.index.tsx`, `.$leagueId.tsx` + dashboard entry link.
- **Copy**: `src/locales/{en,pt-BR,es}/translation.json`.
- **Unit/integration tests (`test/`)**: 14 league files incl. `leagues.schema.integration.test.ts`, `leagues.lifecycle.integration.test.ts`, `leagues.permissions.integration.test.ts`, `leagues.hardening.integration.test.ts`, `leagues.provisional.integration.test.ts`, `leagues.counters.integration.test.ts`, `leagues.counters.functions.test.ts`, `leagues.functions.test.ts`, `leagues.validators.test.ts`, `leagues.pages.test.tsx`, `leagues.create.test.tsx`, `leagues.visual-references.test.ts`; matches ranked admission/selection/reconfirmation/results suites; helpers `test/helpers/league-fixtures.ts`, `league-dto-fixtures.ts`.
- **E2E (`e2e/`)**: `leagues.spec.ts` (6), `matches-ranked.spec.ts` (7), `leagues-visual.spec.ts` (9), `e2e/references/paf-11/` (manifest + 3 PNGs).
- **Workflow records**: plan file, bundle, findings ledger, this development log.

## Key Decisions

- **User-approved C0 (binding)**: Q1 narrow read-only League counter reader — full standings/awards/snapshots deferred to T12; Q2 invalid Ranked submissions rejected with visible blocked state, resolution via existing authorized workflows, no post-start Unranked conversion; Q3 due-Upcoming conflict with Active stays blocked with visible reason, explicit owner/Admin activation, owner must be active member; Q4 League period immutable once referenced (name/description/minimum editable), enforced via append-only `league_event_references` audit history.
- **AC13**: provisional players cannot reconfirm → automatic system carry with documented `reconfirmation_carried` audit; no counterfeit consent records.
- **Post-plan design decisions (user)**: 6 supplemental UI states ship structural-probes-only (no Pencil frames; adjustment prompts recorded as design debt); `xgKXg` visual budget re-certified to 0.204 (Ranking impact panel required by AC7/8 postdates the approved frame).
- **Publication-time existence anchor + replay equality**: Ranked binding is decided at publish time and never applied retroactively; result-time facts revalidate eligibility at `played_at` instead of re-binding.
- **Members-only ranked gate is total**: every admission writer (register, invitations, FIFO quartets, provisional add-by-email) enforces it; provisional add-by-email returns a blind `ranked_members_only` outcome to avoid an existence oracle.
- **`plan_cache_mode=force_custom_plan` pinned on `list_leagues`**: only cursor-parameterized function; guarantees the production-shape Index Only Scan plan for both cursor shapes.

## Validation Performed

- **Per unit**: fast gates (typecheck, lint deny-warnings, affected vitest) + full `pnpm test`; two knip rejections fixed along the way (`LEAGUE_DATE_ERRORS` removed in U1, `en` re-export removed in U5).
- **Assembled-state QA (green)**: typecheck + lint clean; unit 146 files / 1910 tests; integration 79 files / 693 tests; coverage thresholds 80/80/80/80 intact (config untouched vs main).
- **E2E via `pnpm test:e2e`**: full suite 309/309 at U5 code state (22 new: 6+7+9).
- **Review**: full parallel review (code, architecture, UX/UI) + 7 delta rounds; every finding fixed with failing-first evidence — concurrency races reproduced with real DB connections, ±1µs boundary tests, deadlock proofs (SQLSTATE 40P01), plan-level assertions (Index Only Scan with both predicates, both cursor shapes, negative checks, non-vacuous Index Cond).

## Risks and Follow-ups

- **Design debt**: 6 Pencil supplemental-frame adjustment prompts recorded in the U5 report/PR; supplemental states covered by structural probes only until frames are adjusted.
- **T12 dependency**: full standings, awards, and snapshots are out of scope (Q1); T12 owns them on top of `get_league_counters` foundations.
- **Manual walkthrough checklist** pending user execution (embedded in the parent issue comment to follow).
- **Plan pin**: `plan_cache_mode=force_custom_plan` on `list_leagues` should be revisited if more cursor-parameterized functions appear (keep the pin single-function until then).
- **Gate**: full E2E suite + `pnpm complete-check` re-run pending on the final reviewed state — owned by the orchestrator final gate; log intentionally left uncommitted for the orchestrator sweep.
