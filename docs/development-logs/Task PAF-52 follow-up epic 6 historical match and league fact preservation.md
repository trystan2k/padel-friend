---
title: PAF-52 Follow-up epic 6 — Historical match and League fact preservation
type: development-log
permalink: docs/development-logs/task-paf-52-follow-up-epic-6-historical-match-and-league-fact-preservation
---

# Development Log: PAF-52

## Metadata

- Task ID: PAF-52 (Follow-up epic 6 — Historical match and League fact preservation; closes the confirmed former-participant League-read access gap tracked as PAF-173 and certifies match/League fact preservation after membership ends per PAF-47)
- Date (UTC): 2026-11-10 (updated 2026-11-11: appended commits 5–6 and final full-gate validation evidence)
- Project: padel-friend
- Branch: feature/PAF-52-follow-up-epic-6-historical-match-and-league-fact-preservation (based on `origin/main` @ `4038b47`; this repo has no `develop`)
- Commits (6, oldest first): `b0522b2` — `feat: allow former participants to read leagues they played`; `440510d` — `test: certify match and league fact preservation after membership ends`; `5cabe1c` — `fix: address review findings`; `083eb8c` — `test: address delta review findings`; `c5a3526` — `test: align shard weights and rehearsal migration baseline`; `dd8f0f8` — `test: capture console error resource urls in statistics journeys` (final HEAD)
- Plan: `docs/plan/Plan PAF-52 Follow-up epic 6 — Historical match and League fact preservation.md`; findings ledger: `docs/plan/PAF-52-findings.md`; bundle: `docs/plan/PAF-52-bundle.md`
- Reviewers: code-review-specialist + architecture-review-specialist + ux-ui-reviewer-specialist (full round 1: F1–F6 required; delta round 2: F7–F11 residuals incl. CI-visual-lane seed gap and snapshot tie nondeterminism; delta round 3: all verified addressed, zero new findings, no blockers — ledger final: all 11 findings fixed, none deferred; full-gate flake observations F12–F15 recorded as unrelated, pre-existing, not scope)

## Objective

- Close the former-participant League-read access gap (PAF-173): a player who earned facts in a League but has since left (or been removed from) the community must still be able to read that League's detail, counters, standings and standings versions, derived only from immutable earned facts.
- Certify (PAF-47) that match and League historical facts survive membership end byte-for-byte across both endings (voluntary leave and admin removal), with a perturbation oracle proving the preservation tests actually detect any mutation.

## Implementation Summary

- **Commit 1 — `b0522b2` `feat: allow former participants to read leagues they played`** (17 files, +1329/−25).
  - Additive forward migration `supabase/migrations/20261111090000_league_former_participant_reads.sql` introduces `league_actor_has_participation(uuid)` — STABLE, SECURITY DEFINER, `search_path=''`, EXECUTE revoked — whose predicate reads immutable facts only: an earned `league_player_counters` row with `matches > 0` OR confirmed-group participation. Grant wiring adds a member-OR-participation gate to `get_league`, `get_league_counters`, `get_league_standings` and `list_league_standings_versions`.
  - `get_league` detail now returns `access_mode` plus a minimal community shape `{id, name, timezone}` (dropped `creation_enabled`/`can_create`); Supabase DB types regenerated; contracts updated with a strict detail decoder (making DB and app deploy-coupled).
  - UI: `LeagueDetailPage` gained a former-participant state; MatchHistory links back to the League; en/pt-BR/es copy added. Tests written red-first — 6 of 11 failed before the migration — plus an E2E spec `e2e/leagues-former-participant.spec.ts`.
- **Commit 2 — `440510d` `test: certify match and league fact preservation after membership ends`** (+535).
  - New certification suite `test/historical-facts.preservation.integration.test.ts` covering both endings (leave AND admin removal): full-row `to_jsonb` captures across 17 tables are byte-identical after membership ends; former participant and retained Admin parity through production history plus League readers (standings versions 1 and 2); earned rows survive in open and closed counters/standings; denial matrix for non-earned access.
  - In-memory perturbation proof (5 tests): the identical case passes, while row removed, row added, value changed, and table dropped all throw — proving the byte-identity oracle is not vacuous.
- **Commit 3 — `5cabe1c` `fix: address review findings`** (9 files, +545/−17; full review round 1 findings F1–F6).
  - Former-participant notice restyled to the approved Pencil frame `YYMpT`: green-soft token surface, eye icon, compact horizontal layout, muted body — tokens only, dark-mode safe, wrap-tolerant (F5).
  - `minWidth: TOUCH` on the history League link so short labels still meet the 44px touch target (F6).
  - Private-community denial matrix seeded with join request + invitation plus a retained-Admin positive control (F1); ex-privileged and provisional/rejected denials added (F4); open-League browser journey asserting the earned standings row (F2); 3 focused visual baselines with documented nonzero budgets and pt-BR/es 320px coverage (F3).
- **Commit 4 — `083eb8c` `test: address delta review findings`** (3 files, +188/−78; delta round 2 residuals F7–F11).
  - Lane-agnostic seeding moved to a top-level `beforeAll` so the CI visual lane reproduces and passes locally (F7); deterministic standings for the snapshot baseline via distinct seeded records, baseline re-blessed (F8); admin-removal variant of the privileged-actor loss joined to the existing matrix via `['leave','remove']` through `govern_community_member` (F9); effective `minWidth` oracle rebuilt on the real anchor (computed min-width equals resolved TOUCH px, plus a bare-"Q" collapse probe that fails without the fix) (F10); notice geometry pinned to resolved tokens `--space-12`/`--space-17`/`--space-9` (12/17/9px per frame `YYMpT`) (F11).
- **Commit 5 — `c5a3526` `test: align shard weights and rehearsal migration baseline`** (+2/−1). Fixes two stale unit assertions found by the first full-gate run: `scripts/e2e-shards.mjs` registers `e2e/leagues-former-participant.spec.ts` in the shard weight table (~40s measured); `test/release-rehearsal.scripts.test.ts` points the migration-order expectation at the new latest migration `20261111090000`.
- **Commit 6 — `dd8f0f8` `test: capture console error resource urls in statistics journeys`** (+4/−1, final HEAD). The statistics journeys console watcher now records the resource URL next to each console error; denial journeys keep their 4xx-log semantics (verified 11/11 standalone). This oracle later proved the full-gate statistics 404s are `/virtual:stylex.css` dev-module requests, not league-route failures (see Validation).

## Files Changed

- Commit 1 (`b0522b2`, 17 files): `supabase/migrations/20261111090000_league_former_participant_reads.sql` (new; `league_actor_has_participation` + member-OR-participation gates on the four League readers), `src/lib/supabase/database.types.ts` (regenerated), League contracts + strict detail decoder, `src/features/leagues/LeagueDetailPage.tsx` (former-participant state), MatchHistory League link, `src/locales/en/translation.json`, `src/locales/pt-BR/translation.json`, `src/locales/es/translation.json`, unit + integration tests (`test/leagues.former-participant.integration.test.ts`), `e2e/leagues-former-participant.spec.ts` (new).
- Commit 2 (`440510d`): `test/historical-facts.preservation.integration.test.ts` (new; 17-table `to_jsonb` byte-identity captures, both endings, parity and denial matrix, 5 perturbation tests).
- Commit 3 (`5cabe1c`, 9 files): `src/features/leagues/LeagueDetailPage.tsx` (Pencil frame `YYMpT` notice restyle, tokens only), `src/features/statistics/statistics-history.styles.ts` (`minWidth: TOUCH`), `test/leagues.former-participant.integration.test.ts` (join request + invitation + retained-Admin positive control; ex-privileged, provisional/rejected denials), `e2e/leagues-former-participant.spec.ts` (open-League journey with earned row; 3 visual baselines with documented nonzero budgets; pt-BR/es 320px coverage).
- Commit 4 (`083eb8c`, 3 files): `e2e/leagues-former-participant.spec.ts` (top-level `beforeAll` seeding, deterministic standings + re-blessed baseline, effective minWidth oracle, token-pinned notice geometry), `test/leagues.former-participant.integration.test.ts` (`['leave','remove']` admin-removal variant), `docs/plan/PAF-52-findings.md` (ledger updates through delta round 3).
- Commit 5 (`c5a3526`, +2/−1): `scripts/e2e-shards.mjs` (shard weight table entry `e2e/leagues-former-participant.spec.ts: 40`), `test/release-rehearsal.scripts.test.ts` (latest-migration expectation → `20261111090000`).
- Commit 6 (`dd8f0f8`, +4/−1): `e2e/statistics.spec.ts` (console watcher records resource URL per console error; denial journeys keep 4xx-log semantics).
- Planning artifacts: `docs/plan/Plan PAF-52 Follow-up epic 6 — Historical match and League fact preservation.md`, `docs/plan/PAF-52-findings.md`, `docs/plan/PAF-52-bundle.md`.

## Key Decisions

- Former-participant predicate derived from immutable facts only (earned `league_player_counters` row with `matches > 0` OR confirmed-group participation) — never from mutable membership or role state.
- Active membership wins `access_mode`; the participation gate only supplements access once membership is gone.
- Strict detail decoder on the changed `get_league` shape ⇒ DB and app must deploy together (accepted coupling; additive migration keeps order safe).
- Open-League live standings compared without the derived `position` column (roster overlay, plan-legitimate) while closed-League standings are compared in full.
- Ex-privileged-actor loss exercised via both endings — voluntary leave and admin removal through `govern_community_member`.
- Notice icon implemented as inline SVG (repo pattern; no icon library added).
- One feature branch off `origin/main`, one PR, one commit per unit of work plus two review-fix commits.

## Validation Performed

- Per-unit fast gates green throughout: typecheck, lint, related unit tests, related integration tests.
- E2E spec 12/12 including the `@visual` lane (CI visual lane reproduced locally via the exact `VISUAL_GREP` grep after F7).
- Integration suite 15/15; certification suite 27/27 (22 preservation + 5 perturbation).
- Perturbation negative controls: identical captures pass; row removed, row added, value changed, and table dropped each throw — oracle proven non-vacuous.
- F10 oracle negative control: the effective-minWidth probe fails without the style fix and is stable with it.
- Pre-commit static gate green on every commit.
- Review loop: full round 1 (code + architecture + UX/UI) produced 6 required findings (F1–F6); fix round 1 delta review produced 5 residuals (F7–F11); fix round 2 delta round 3 verified all addressed with zero new findings and no blockers. Ledger final state: all 11 findings fixed, none deferred, no approved exceptions, no follow-up issues.
- Constraints honored: no vitest coverage threshold changes, no new dependencies, tokens-only styling (no hardcoded colors/spacing), all new copy through i18n in en/pt-BR/es.
- Full-gate runs at final HEAD `dd8f0f8` and predecessor `c5a3526`: static (build/knip/typecheck/lint/format) green on every commit via pre-commit hooks; unit 3659/3659 green; integration 1227 green (1 skipped); e2e diagnostic at `dd8f0f8` (visual shard + functional serial): 533/533 green, zero retries.
- Full-gate e2e instability: exclusively four documented pre-existing flake classes (ledger F12–F15), all unrelated to this branch: statistics lifecycle 3×404 console errors — the URL-capture oracle (commit `dd8f0f8`) proved they are `/virtual:stylex.css` dev-module requests 404ing against the preview server, not league-route failures (route probe 200/200 for a member on world-fixture leagues); pwa/push/preferences worker-saturation timeouts (standalone green); notifications mark-all-read cutoff race; result-corrections geometry drift. All documented in `scripts/e2e-shards.mjs` comments as known races fenced by CI's serial lane + retries (CI retries=2, local 0); CI on main green including every affected spec; the branch touches no SW/push/PWA/notification code.
- Delivery verdict: all scope-owned validation green at final HEAD `dd8f0f8`. The local `pnpm complete-check` full gate is NOT claimed as passed: its e2e stage instability is exactly the four pre-existing, CI-fenced flake classes above; CI arbitrates at push.

## Risks and Follow-ups

- Scope findings: none open — all 11 findings fixed and verified, no deferred items, no follow-up issues.
- Pre-existing flake classes F12–F15 (statistics stylex-404 console errors, pwa/push worker-saturation timeouts, notifications cutoff race, result-corrections geometry drift) are recorded in the ledger as unrelated full-gate load races, not scope defects; fenced by CI's serial e2e lane + retries (CI retries=2, local 0) and green on main — left to their existing documentation in `scripts/e2e-shards.mjs`, no action in this branch.
- Deploy coupling: the strict detail decoder means the migration/DB change and the app change must ship together; a DB-only or app-only deploy fails the decoder.
- Snapshot baselines: if the former-participant notice restyles again, the 3 visual baselines require a deliberate re-bless (documented nonzero budgets must not be widened to mask regressions).
