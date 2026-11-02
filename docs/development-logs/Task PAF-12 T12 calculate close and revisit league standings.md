---
title: PAF-12 T12 Calculate, close, and revisit League standings
type: development-log
permalink: docs/development-logs/task-PAF-12-t12-calculate-close-and-revisit-league-standings
---

# Development Log: PAF-12

## Metadata

- Task ID: PAF-12 (T12 — Calculate, close, and revisit League standings; epic parent delivered via sub-issues PAF-143/PAF-144/PAF-145/PAF-146 as units U1–U4)
- Date (UTC): 2026-11-02
- Project: padel-friend
- Branch: `feature/PAF-12-league-standings` (from `origin/main` `ff10817`; base for PR: `main`)
- Commits (8, oldest first, one per unit + QA fix + review-fix loop):
  1. `765272f` (feat: materialize rebuildable league counters from confirmed ranked facts — U1/PAF-143)
  2. `4de0102` (feat: rank league standings with shared places and award eligibility — U2/PAF-144)
  3. `e2156bb` (feat: version and audit final league standings across close and late confirmations — U3/PAF-145)
  4. `e2ae725` (feat: display live and historical league standings with translated accessible states — U4/PAF-146)
  5. `3c3660f` (test: include league standings tables in e2e schema inventory — QA regression fix)
  6. `7a73dbc` (fix: review round 1 — F1–F10, F12, F13)
  7. `9e8a50c` (fix: review round 2 — F15–F22)
  8. `84abb8c` (fix: review round 3 — F23–F25)
- Artifacts: plan `docs/plan/Plan PAF-12 T12 — Calculate, close, and revisit League standings.md`, findings ledger `docs/plan/PAF-12-findings.md` (25 findings: 22 fixed, 1 blocked-ops, 1 observed-unrelated flake, 1 split), this development log
- Related Linear: PAF-12 epic + sub-issues PAF-143–PAF-146 (project PadelFriend)

## Objective

- Calculate live League standings from confirmed ranked match facts; close Leagues producing versioned, immutable final standings with a full audit trail; revisit historical standings versions across late confirmations and repairs; display live and historical standings with translated, accessible UI states.

## Implementation Summary

- **U1 — Rebuildable league counters (`765272f`, PAF-143)**: migration `20261101195000` — `league_player_counters` earned-only columns + generated differential + check constraint; `league_projection_confirmations` immutable receipts; internal SECURITY DEFINER functions `league_confirmed_groups`/`league_counter_rows`/`rebuild_league_counters`/`project_league_confirmation`; result finalizer calls the League projector before the rating projector; rerunnable backfill; index on `confirmations(match_event_id)`. 15 integration tests including rollback atomicity (receipt + rating variants), skill independence, and pre-migration upgrade rehearsal via `scripts/test-populated-migration-up.mjs` scenario `league-projection`.
- **U2 — Ranking with shared places (`4de0102`, PAF-144)**: migration `20261101196000` — internal STABLE `league_standings_entries`: `rank()` over wins desc / losses asc / set diff / sets won → competition ranking 1,1,3; zero overlay of active members while the League is open; award flags `award_eligible`/`matches_remaining`; public reader `get_league_standings` authenticated-only. TS contracts/strict decoders and the `getLeagueStandings` server function. 23 function + 11 integration tests (isolated ordering criteria, shared places, draw-with-unfinished-set, threshold matrix 1/3/100, role matrix).
- **U3 — Versioned final standings + audit (`e2156bb`, PAF-145)**: migration `20261101197000` — `league_standings_snapshots` immutable, keyed league+version with cause/basis/frozen threshold+period+labels; `league_events` standings_revised + system reasons; `league_counter_rows_through` canonical aggregation with confirmation cutoff; single `league_rank_counters` shared by live + final standings; publish/late-confirmation/repair/reconstruct functions; idempotent `close_league` (owner/Admin) stamping the cutoff under lock with v1 published in the same transaction; readers `get_league_standings(league, version?)`, keyset-paginated `list_league_standings_versions`, owner/Admin `get_league_standings_audit`; 2 new error codes with locale-parity strings. 19 integration tests including the Fixed boundary via real `process_due_leagues` ±1µs, late first confirmation → v2 + audit with v1 fingerprint unchanged, post-close out-of-period confirmation rejected `RANKED_OUT_OF_PERIOD`, and two-connection races (close vs confirm in both orders converge, simultaneous closes yield one version, close vs leave, one-active-league).
- **U4 — Standings UI (`e2ae725`, PAF-146)**: route `_protected.community.$communityId.leagues.$leagueId` with `?version=`; `LeagueStandings.tsx` (live/final badge, personal summary, award callout, empty states); `LeagueStandingsHistory.tsx` (version select, load-earlier, truthful late-first-confirmation copy — no T15 correction wording, owner/Admin audit view); StyleX token-only styles; visibility refresh hook; `getLeagueViewer`; close dialog (Base UI alertdialog with play-cutoff + audited-late-inclusion copy); post-close "Updating standings…" state; list "No Active League" guidance card; removed `LeagueCounters.tsx`; i18n en/pt-BR/es; a11y: semantic table, hidden shared-place announcement, `aria-current`, labelled select, focus restore, ≥44px touch targets. E2E `league-standings.spec.ts` (5 tests): real Win group → live counters + shared places 1,1,3,3,5 vs stored counters; close denial + owner close → final v1 vs snapshot; post-close confirm → v2 + audit + `?version=1` + unknown-version safe error + member sees no audit/close; archived league reachable with successor; 320px pt-BR dark no overflow.
- **QA regression fix (`3c3660f`)**: `matches-results.spec.ts` expected public-table list extended with `league_player_counters`/`league_projection_confirmations`/`league_standings_snapshots`; full E2E 314 green.
- **Review fix loop (3 delta rounds, findings F1–F25 dispositioned per ledger)**:
  - Round 1 `7a73dbc` (F1–F10, F12, F13): F1 visible-page 60s interval + Fixed-cutoff refresh + overlap guard; F2 closed-rebuild snapshot repair (migration `20261101199000`: `league_rebuild_counters_core` + `league_publish_repair_if_needed` + `repaired_standings_version`); F3 audit error retry (`auditFailed`); F4 post-close reload recovery; F5 compact 5-column primary table + All-statistics details disclosure; F6 audit details allowlist (migration `20261101198000`, 6 safe keys); F7 truthful actor attribution; F8 focus transfer on final page; F9 history retry; F10 Pencil references `e2e/references/paf-12/` + manifest + budgets; F12 knip unused export; F13 `matches-ranked` locator updated for disclosure.
  - Round 2 `9e8a50c` (F15–F22): F15 recovered state keyed to league + loader generation; F16 refresh rejection no longer swallowed; F17 `loadedAll` → derived continuation state; F18 migration rerunnability (guarded rename + `create or replace`, rerun test md5-verified failing-first, migration edited in place pre-push); F19 initial-viewport probes (scrollY 0 + viewport rects 390/320px); F20 masked scoped budgets + exact geometry probes + compositionDeltas documentation; F21 retry-success focus transfer; F22 pluralized spoken record ×3 locales.
  - Round 3 `84abb8c` (F23–F25): F23 `maskedContentCoverage` token/style/palette/literal assertions per masked region (no regression found); F24 generation-gated focus after stale retry; F25 `_zero` plural forms (i18next 26.4.5 `zeroSuffix`) ×3 locales.

## Files Changed

- 43+ files, ~8.8k insertions (per git history on the delivery branch; per-commit file-level diffs live there). Grouped scope below.
- **Migrations (5 new, `supabase/migrations/`)**: `20261101195000` (U1 counters materialization + receipts + projector), `20261101196000` (U2 standings entries + reader), `20261101197000` (U3 snapshots/audit/close + readers), `20261101198000` (round-1 F6 audit details allowlist), `20261101199000` (round-1 F2 closed-rebuild snapshot repair).
- **League feature (`src/features/leagues/`)**: `LeagueStandings.tsx`, `LeagueStandingsHistory.tsx` (new UI); standings contracts, strict decoders, and server functions `getLeagueStandings`/`getLeagueViewer`; removed `LeagueCounters.tsx`.
- **Routes**: `src/routes/_protected.community.$communityId.leagues.$leagueId` with `?version=` support.
- **Copy**: `src/locales/{en,pt-BR,es}/translation.json` (standings/history/close/error strings incl. `_zero` plural forms).
- **Unit/integration tests (`test/`)**: league counter projection (15), standings ranking (23 function + 11 integration), versioning/audit/close (19) suites; migration rehearsal scenario `league-projection` in `scripts/test-populated-migration-up.mjs`.
- **E2E (`e2e/`)**: `league-standings.spec.ts` (5); `e2e/references/paf-12/` (manifest + PNGs + budgets); `matches-results.spec.ts` schema inventory + `matches-ranked.spec.ts` locator updates.
- **Workflow records**: plan file, findings ledger, this development log.

## Key Decisions

- **League projection independent of global rating (AC4)**: counters derive only from confirmed ranked facts; tested alongside rating changes with no rating-table references in the projection path.
- **Competition ranking 1,1,3**: PRD is silent on tie handling; standard shared-position semantics adopted (wins desc / losses asc / set diff / sets won), surfaced with a hidden shared-place announcement for screen readers.
- **Single rank path shared by live + final standings**: one `league_rank_counters` store and one ranking function feed both, eliminating divergence between the live table and published snapshots.
- **Immutable projection receipts**: `league_projection_confirmations` enable idempotent replay, rollback-atomic projection, and post-close snapshot repair (`league_publish_repair_if_needed`).
- **Truthful late-first-confirmation copy**: history UI describes the audited late confirmation factually instead of the Pencil T15 "correction" depiction; deviation documented as design debt (d6ANDN close frame also structural-only: production modal vs full-screen Pencil frame).
- **Production cron verification blocked (F11)**: ops prerequisite owned by the user — verify the `cron.job` row `padel-friend-league-lifecycle` and recent `cron.job_run_details` in production before relying on scheduler-driven closes.

## Validation Performed

- **Per unit**: fast gates green — typecheck, lint (deny-warnings), affected vitest, full `pnpm test` (unit + integration); coverage thresholds unchanged.
- **Per commit**: pre-commit static gates green (lint-staged + `complete-check --only=static`).
- **Consolidated post-fix gate (green)**: unit 1980 tests with coverage; integration 738 tests; E2E full suite 314 tests via `pnpm test:e2e` after fixes; `db:types:check`; knip.
- **Delta reviews rounds 1–3**: every behavior fix delivered with failing-first tests, including migration rerun verified failing-first (md5-checked) and two-connection race reproductions.
- **Pending**: final `pnpm complete-check` on the final state runs at push approval (orchestrator-owned at log time).

## Risks and Follow-ups

- **F11 — production cron verification (blocked, ops)**: confirm `cron.job` `padel-friend-league-lifecycle` exists and `cron.job_run_details` shows recent successful runs in production; without it, scheduler-driven closes are unverified in prod.
- **F14 — transient fixture deadlock flake**: observed once, classified unrelated to League changes; monitor for recurrence.
- **d6ANDN — close frame structural-only**: production ships a modal rather than the full-screen Pencil frame; documented as accepted deviation.
- **PR size**: 43+ files / ~8.8k insertions exceeds the soft size guideline; accepted as one coherent feature (counters → ranking → versioning → UI) that cannot be split without shipping dead layers.
