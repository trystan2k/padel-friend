---
title: PAF-7 T07 assign actual teams and submit scored results
type: development-log
permalink: docs/development-logs/task-PAF-7-t07-assign-actual-teams-and-submit-scored-results
---

# Development Log: PAF-7

## Metadata

- Task ID: PAF-7 (epic T07; sub-issues PAF-104, PAF-105, PAF-106, PAF-107, PAF-108 — created fresh this delivery)
- Date (UTC): 2026-10-24T00:00:00Z
- Project: padel-friend
- Branch: feature/PAF-7-t07-assign-actual-teams-and-submit-scored-results
- Commit: 12 commits on the branch, one per delivered unit (10 named in the delivery bundle):
  - `9ade92f` — feat: add match result proposal domain (T07.1 / PAF-104)
  - `fec8e79` — feat: add result scoring validation and classification (T07.2 / PAF-105)
  - `6470b7b` — feat: add result proposal submission and stale protection (T07.3 / PAF-106)
  - `4261cc2` — feat: add record result flow with preview and pending state (T07.4 / PAF-107)
  - `fb98109` — test: cover result submission journeys and pending states (T07.5 / PAF-108)
  - `f3020d1` — docs: add record result design compositions for missing states (state sheets)
  - `26ffbbc` — docs: add full-route record result design compositions (route frames)
  - `9ed58b1` — docs: correct pending result design sample data (alZmm 48H correction)
  - `c24ac8a` — docs: add started match record entry design composition (iXRPp)
  - `4792d02` — review fixes (F1–F5, red→green)
  - Remaining 2 commits are push-step documentation artifacts (plan document committed at push per `docs/plan/PAF-7-bundle.md`).

## Objective

- Deliver epic PAF-7 — T07 — Assign actual teams and submit scored results: Match Creator (or authorized community Admin) submits a valid, versioned, per-Game-Group result proposal — actual 2+2 teams, normal best-of-three sets, authoritative `played_at` (UTC + local + offset), optional court label — that stays pending with NO rating/League/statistics effects until a later review epic (PAF-8) confirms it.
- Scope broken into five sub-issues (PAF-104..108), one commit each, plus design-owner-directed Pencil compositions and an accumulated review-fix commit.

## Implementation Summary

- **T07.1 — Result proposal domain (PAF-104, `9ade92f`):**
  - Additive Supabase migrations: `match_event_result_proposals` (active pointer row per event+group: status `pending`, `active_version`, `review_deadline_at`, unique (event, group)) + append-only `match_event_result_proposal_versions` (immutable full fact set) with immutable update/delete guard triggers.
  - RLS: proposals SELECT restricted to event creator, event-community admin, and accepted participants; versions table internal-only (RLS enabled, no client policies, all client writes revoked).
  - `played_at` triple-store (UTC instant + entered local timestamp + entered UTC offset) with consistency CHECK; optional court label (trimmed 1..100, no control chars).
  - `match_event_management_commands.action` CHECK additively extended with `'submit_result'` (request_id replay reuse); DB types regenerated.
  - Follow-on migration `20261024071746_match_result_submitter_context.sql` — read-RPC submitter display-name provenance (JSON shape, not signature change; `pnpm db:types:check` green).
- **T07.2 — Scoring engine + classification (PAF-105, `fec8e79`):**
  - Pure scoring engine with SQL+TS parity: completed set legality 6–0…6–4 / 7–5 / 7–6 either orientation (6–5/7–4/7–7/8-x rejected with structured DETAIL `{set_index, side, reason_token}`); third set normal scoring only; sequential sets enforced.
  - Classification: win (majority of completed sets), draw (completed sets tied 1–1 with no completed third; unfinished third set may be stored but cannot decide), incomplete (fewer than 2 completed sets).
- **T07.3 — Submission transaction + stale protection (PAF-106, `6470b7b`):**
  - `submit_match_event_result` (SECURITY DEFINER) reusing the canonical lock chain (PAF-6 reserved contract), invoking `protect_match_event_results` transactionally on first submission, and recording replay via the `match_event_management_commands` ledger (`'submit_result'`).
  - Eligibility: server re-derives the frozen group's playing quartet; submitted teams must equal exactly those four users partitioned 2+2, no duplicates (Reserve Not Playing structurally rejected; cross-group duplicates covered); creator/admin authority independent of group membership.
  - Stale submission: typed `MATCH_RESULT_ACTIVE_PROPOSAL` conflict echoing active version + review deadline — never overwrites, never bumps the version (only v1 created this epic).
  - `review_deadline_at = submitted_at + 48h`; `played_at` validated (offset consistency, DST ambiguity/nonexistent times, future rejection against DB clock) and preserved independently of schedule/submission/confirmation clocks.
  - `get_match_event_result_proposals` read RPC with derived `rating_effective` (competitive AND classification ≠ incomplete); management DTO `correction` descriptor populated for creator/admin.
- **T07.4 — Record-result UI + pending state (PAF-107, `4261cc2`):**
  - Thin route `src/routes/_protected.matches.$eventId.record.tsx`; `RecordMatchResultPage` implementing 3-step PLAYERS → SCORE → REVIEW: suggested order-based pairing with explicit team change, SET 1–3 rows with steppers and COMPLETE/IN PROGRESS toggles, played_at entry in event timezone with offset disambiguation, optional court label, live predicted-outcome preview with rating-effect copy, submit with request_id.
  - `MatchResultPending` / `MatchResultDetail` / `MatchResultFacts` / `MatchResultNavigation` components; pending card (PENDING · NOT CONFIRMED, version + 48h countdown) on match detail; conflict/stale states prompt explicit reload, never silent retry.
  - 320px gutter fix (tokenized translated-title gutter so pt-BR/es headings clear shared locale/theme controls); a11y: label-in-name accessible state names (visible state text composed into aria-labels), focus handoff to the pending receipt on submit, live regions, ≥44px targets.
  - i18n namespace `matches.results.*` complete in en/pt-BR/es; no hardcoded copy.
- **T07.5 — E2E + visual certification + manual evidence (PAF-108, `fb98109`):**
  - `e2e/matches-results.spec.ts` named journeys: two groups + one pending proposal with unchanged rating surfaces; admin recovery submission; invalid score identifies set and team inline; friendly no-rating-effect preview.
  - `e2e/matches-results-visual.spec.ts` structural probes + Pencil-referenced exports under `e2e/references/paf-7` (manifest/README with provenance, source digests, justified per-screen budgets).
  - Fixture deadlock fixed test-only via advisory-guard helper `e2e/match-fixture-sql.ts` (shared transaction advisory guard + parent-first cleanup table locks); no retries or worker reduction needed afterward.
  - Manual walkthrough recorded in `docs/plan/PAF-7-manual-walkthrough.md`.
- **Design work (design-owner directed, authored INTO `docs/design/padel-friend.pen`):**
  - State sheets `Hzcid`, `BnwEB`, `u78yF`, `LD9Jv` (`f3020d1`) — approved after 2 iterations (illegal 6–3 sample scores fixed; INCOMPLETE copy corrected).
  - Full-route frames `XySt5`, `GPo9z`, `c0wbmu`, `NZk5H`, `wsXWA`, `alZmm` (`26ffbbc`) — owner chose full-route certification.
  - `alZmm` sample-data correction (`9ed58b1`): 48H deadline, Community match, submitter Thiago R. — applied after certification honestly blocked on the stale sample.
  - `iXRPp` started-state record entry (`c24ac8a`) — supersedes legacy `tVzco` as the started-unavailable certification target after this delivery legitimately added the record entry to that state.
- **Review round:** 3 reviewers, 5 findings (F1–F5) — all fixed in `4792d02` with red→green tests; delta reviews clean, no regressions (details under Validation).

## Files Changed

- **Database (T07.1/T07.2/T07.3 + review):**
  - `supabase/migrations/20261022090000_match_result_proposal_domain.sql` (proposal pointer + versions tables, RLS, immutable guards, command action CHECK extension)
  - `supabase/migrations/20261022091000_match_result_scoring_functions.sql` (pure scoring/classification engine; F1/F2 fix surface)
  - `supabase/migrations/20261022092000_match_result_submission.sql` (submit/read RPCs, management correction descriptor population)
  - `supabase/migrations/20261024071746_match_result_submitter_context.sql` (submitter display-name provenance)
  - Migration `20261024164851` (score-consistency rejections: terminal-scores-with-unfinished + completed-third-after-decided; F1/F2 forward fix)
  - `src/lib/supabase/database.types.ts` (regenerated per schema unit)
- **Feature modules (T07.2/T07.3/T07.4 + review):**
  - `src/features/matches/match-result.model.ts`, `match-result.validators.ts`, `match-result.functions.ts`, `match-result-error-copy.ts`, `match-result.styles.ts`
  - `src/features/matches/RecordMatchResultPage.tsx` + `MatchResultPending` / `MatchResultDetail` / `MatchResultFacts` / `MatchResultNavigation` components
  - `src/features/matches/match-time.ts` (`localMatchInstant` offset extension for played_at triple-store)
  - Match detail integration (pending summary card + record-result entry via management `correction` descriptor)
- **Routes/i18n (T07.4):**
  - `src/routes/_protected.matches.$eventId.record.tsx`
  - en/pt-BR/es locale catalogs (`matches.results.*`)
- **Tests/E2E (T07.1–T07.5 + review):**
  - `test/matches.results.*` suites (schema/scoring/submission integrations, model/validators/functions/page/copy units), i18n parity suite extension, management capabilities/protection regression extensions
  - `e2e/matches-results.spec.ts`, `e2e/matches-results-visual.spec.ts`, `e2e/match-fixture-sql.ts` (advisory-guard helper), `e2e/references/paf-7/` (manifest + README + reference exports)
- **Design (design-owner directed):**
  - `docs/design/padel-friend.pen` — state sheets Hzcid/BnwEB/u78yF/LD9Jv; route frames XySt5/GPo9z/c0wbmu/NZk5H/wsXWA/alZmm (+ alZmm correction); iXRPp (supersedes tVzco)
- **Documentation/workflow artifacts:**
  - `docs/plan/Plan PAF-7 T07 — Assign actual teams and submit scored results.md` (authoritative plan, committed at push)
  - `docs/plan/PAF-7-bundle.md` (delivery bundle), `docs/plan/PAF-7-findings.md` (review findings ledger), `docs/plan/PAF-7-manual-walkthrough.md` (manual evidence), `docs/plan/PAF-7.diff` (exported diff)

## Key Decisions

- **Text-CHECKs over enums:** proposal status/classification use text CHECK constraints so later status transitions (PAF-8 review flow) stay additive.
- **Append-only versions table:** complete evidence chain; PAF-7 only ever creates version 1; versions >1 exist structurally for later correction/resubmission epics. No generic workflow/event-sourcing framework.
- **Commands-ledger reuse over parallel dedupe:** submission replay rides the existing `match_event_management_commands` request_id ledger via additive `'submit_result'` CHECK extension (approved assumption 7; fallback request_id column NOT built).
- **Predefined teams = presentation concept:** suggested order-based pairing (accepted_order 1&2 vs 3&4) in the UI + explicit 2+2 server requirement; no pre-match pairing stored state.
- **Stale submission = typed conflict, never overwrite:** `MATCH_RESULT_ACTIVE_PROPOSAL` echoes version + 48h deadline; no version bump, no silent retry.
- **Review deadline arithmetic:** `review_deadline_at = submitted_at + 48h`, independent of scheduled/played/confirmation clocks (all clocks stored separately, nothing derives another).
- **No notification fanout:** recorded as a PAF-8 boundary, not deferred work; pending discovery happens through the match detail summary.
- **Reuse of PAF-6 protection contract:** submission runs its own checks (cancelled rejection) rather than routing through `assert_match_management_action_locked`, because protection being set is the _result_ of this feature; `protect_match_event_results` invoked in-transaction exactly once, monotonic.
- **Rating effects remain display copy:** `rating_effective` is proposal metadata, never a mutation; no League/standings/statistics store created; `participation_status` untouched post-freeze.
- **Design authority:** compositions authored INTO `docs/design/padel-friend.pen` following existing patterns per owner direction; honest post-certification `alZmm` correction rather than shipping stale sample data; legacy `tVzco` superseded by `iXRPp` with owner approval.

## Validation Performed

- **Full quality gate:** `pnpm complete-check` green on final HEAD — db types, build, knip, typecheck, lint, formatting, test (**1,320 units**, **275 integrations** serialized, **100% coverage** all metrics, thresholds unchanged), e2e (**242/242**, fresh preview, twice).
- **Visual certification:** 7/7 Pencil references pass with measured, documented budgets (glyph rasterization only; structural probes independent; no budgets widened): XySt5 4.08/4.5, GPo9z 3.24/3.6, c0wbmu 3.20/3.6, NZk5H 3.23/3.6, wsXWA 4.34/4.7, alZmm 4.80/5.2, iXRPp 3.17/3.6.
- **Manual walkthrough (browser-automated, recorded):** 8 accepted Playing participants, two groups with explicit team corrections, Draw with unfinished third set submitted; pending card shows Group 1 / Version 1 with 48-hour countdown and absolute deadline (deadline = submitted + 172,800,000 ms exactly); stale editor rejected with typed conflict; **22 official rating rows (11 profiles + 11 ratings) value-equal before/after**; roster/notifications unchanged. Evidence PNGs + observed-proposal-facts attachment recorded.
- **Review:** 3 reviewers produced 5 findings, **all fixed** in `4792d02` with red→green tests; delta reviews clean, no regressions:
  - F1 (major): terminal scores accepted with completed=false → forward migration + TS reject `MATCH_RESULT_TERMINAL_SCORE_UNFINISHED`; 14 scores covered at set positions 1–3 in both engines.
  - F2 (major): completed third set accepted after 2–0 ("3–0") → same migration + TS reject `MATCH_RESULT_THIRD_SET_AFTER_DECIDED`; AA A/AA B/BB A/BB B covered in both engines; page prevents 3–0 preview.
  - F3 (minor): primitive palette tokens → replaced with existing semantic `--color-hero-copy/on-hero/hero-accent/amber` tokens.
  - F4 (minor): label-in-name (WCAG 2.5.3) → accessible names compose translated visible state text (COMPLETE/IN PROGRESS/INVALID/NOT PLAYED/Add set); aria-pressed preserved.
  - F5 (minor): no focus handoff on success → `focusReceipt` passed to MatchResultPending; effect focuses pending heading (`tabIndex=-1`); ordinary pending cards do not steal focus.
  - Verification changed no inherited source/test/migration files (SHA-256 snapshot comparison of 1,524 non-ignored files).
- **Interim gate states (documented, resolved; original failures never relabeled green):** machine-local `~/.gitconfig` read failure in test stage resolved via process-only `GIT_CONFIG_GLOBAL=/dev/null`; legacy `tVzco` pixel failure resolved by approved `iXRPp` successor composition; unexplained integration timing/expiry failures passed 31/31 on unchanged-source `caffeinate -is` retry; fixture SQL deadlock fixed via advisory-guard helper with retained-backend proof (blocking before relation locks, release on rollback).
- **AC reconciliation:** all eight parent ACs proven (AC1 quartet eligibility; AC2 actual-team authority; AC3 independent played_at; AC4 set legality; AC5 Draw/unfinished-third; AC6 no rating/League effects incl. friendly row-deltas 0; AC7 stale conflict + version/deadline; AC8 inline set/team errors + Pencil states + translations).

## Risks and Follow-ups

- **None open.** PAF-8 (review/confirm flow — notifications, approve/reject/auto-confirm) and PAF-9 consume this foundation: versions table, typed conflict, `review_deadline_at`, `rating_effective`, and management `correction` descriptor are the seams they build on.
- **Watch:** integration suite requires local Supabase up and `caffeinate` on this machine — unexplained sleep artifacts (interruption-suspected timeout/expiry failures with aligned host/DB clocks) were observed twice; both resolved on unchanged-source retry. Re-run on recurrence before diagnosing code.
