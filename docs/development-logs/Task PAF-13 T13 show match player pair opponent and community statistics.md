---
title: PAF-13 T13 Show match, player, pair, opponent, and community statistics
type: development-log
permalink: docs/development-logs/task-PAF-13-t13-show-match-player-pair-opponent-and-community-statistics
---

# Development Log: PAF-13

## Metadata

- Task ID: PAF-13 (T13 — Show match, player, pair, opponent, and community statistics)
- Date (UTC): 2026-11-03
- Project: padel-friend
- Branch: `feature/PAF-13-match-player-pair-community-stats` (PR base: `main`)
- Commits (13 delivery commits, oldest first; excludes the user's separate `docs(agents)` commit `3d8c6ce`):
  1. `2325f99` (feat: add rebuildable statistics projections — migrations `20261102100000`/`20261102101000`: `statistics_official_confirmations`/groups resolver seam, fact/participant/pair/opponent tables, scope summaries + daily buckets, derive-sets rules, `rebuild_statistics`, finalizer hooks (lock order community→event→League→rating→statistics), RLS/grants; TS contracts/decoders/validators/model/config; fixtures + schema/projection tests)
  2. `7470269` (feat: expose complete match history and group details — history readers migration, bounded merge pagination on `(effective_time, stable_id)`, lifecycle/type badges, §37 detail incl. pre-match team strengths/expected outcome/upset badge (0.35 config threshold), `MatchHistory`/`ConfirmedGroupDetail`, `groups.$groupId` route)
  3. `79ce8da` (feat: add player core and advanced statistics — player readers + rank-history migrations (established-first ordering, membership intervals, immutable standings versions, provenance + coverage boundaries), §§33–34 catalog, `MetricState` thresholds via `statistics_config`, `PlayerStatistics`(+Records)/`PlayerMetric`, players route)
  4. `76ae6b8` (feat: add pair partner and opponent statistics — relationship readers, canonical pair/matchup identity (order- and side-independent), oriented H2H (focal reversal), partner/opponent records with 5-match thresholds, pair/opponent routes)
  5. `3b65f7f` (feat: add scoped community statistics and filters — community readers, §38 all insights, filter matrix (all-communities=subject-scoped; active/historical League eligibility; type/date on played-day UTC), `StatisticsFilters`/search, community statistics route, authorization + EXPLAIN plan-shape tests)
  6. `7694bac` (test: prove statistics scoring and rebuild invariants — golden fixtures (hand-calculated oracle), all §83 bullets + AC5 (incomplete third `6-4,3-6,2-1` → 11-11 games, 1-1 sets, draw), rebuild/replay/races/migration-up proofs; FIX migration `20261102115000`: rating activation replay now publishes statistics before rank refresh — production defect found by U6)
  7. `433d220` (feat: finish accessible localized statistics views — `StatisticsChart`/`DataTable`/`States`/`Breadcrumb`; chart contract (disclosure + full numeric table incl. zeros, focus stability); 85 metric helps; navigation keys; Pencil manifest `e2e/references/paf-13` (9 PNGs, frame provenance RN0yw/GrkSH/khmeK/o9iaC1/BcpYH))
  8. `e2f8c24` (test: cover statistics navigation filters and accessible charts — e2e fixtures + 11 journeys + visual spec (geometry + measured residuals); browser-found fixes: raw form-help keys, 320px overflow (minmax grid), 44px community links + dark contrast; paf-8 budget 0.285)
  9. `15fb743` (fix: address review findings — review round 1, 11 findings: League-filter-before-limit, bounded history lifecycle (first pass), all-versions League positions, abs closest-win, player/pair/detail Pencil restructure, filter bars, upgrade-proof scaffolding)
  10. `c6d30e0` (fix: address remaining review findings — delta round 2: `statistics_participant_lifecycle` entry-keyed projection (deferred marker/drain triggers, rebuild integration, keyset reader), community selector, subject-scoped history reader + recent-matches card, relationship offset paging, closed-League snapshot-first, filter error state, geometry probes)
  11. `e92eebe` (fix: resolve remaining delta findings — delta round 3: recent-card stacked layout, See-all own-scope, skip-guard for other-player+no-community, 44px geometry probes)
  12. `4b08378` (docs: add statistics delivery plan and review findings)
  13. `f24c160` + `5371e62` (fix: resolve copilot review advisories + `import.meta.url` paths — sampled-count raw formatting, `recentOffset` string coercion, path-UUID→`notFound` on partner/opponent routes, migration chain consolidated (`114000` deleted), `__dirname`→`import.meta.url` in guard tests)
- Artifacts: statistics delivery plan + findings ledger `docs/plan/PAF-13-findings.md` (27 findings: F1–F14, G1–G2, U1–U3, C1–C8, H1 dismissed-with-evidence, O1–O3/N1/N2 optional observations — all required/related resolved), this development log
- Final delivery (2026-11-02/03): PR #41 <https://github.com/trystan2k/padel-friend/pull/41> → `main`, linked to PAF-13; PAF-13 In Review; CI on final head `5371e62` 9/9 checks pass, mergeState CLEAN
- Related Linear: PAF-13 (project PadelFriend)

## Objective

- Complete V1 statistics per US-021/PRD §§32–40,48–49,83: rebuildable SQL projections; match history + §37 group detail; player core+advanced metrics (§§33–34) with insufficient-data thresholds + historical rank provenance; unordered-pair/partner/opponent records with oriented H2H; community insights (§38) with community/League/type/date filter matrix; accessible localized UI (chart numeric tables, en/pt-BR/es, Pencil-aligned).

## Implementation Summary

- **Rebuildable statistics projections (`2325f99`)**: migrations `20261102100000`/`20261102101000` — `statistics_official_confirmations` + groups resolver seam, fact/participant/pair/opponent tables, scope summaries + daily buckets, derive-sets rules, `rebuild_statistics`, finalizer hooks under lock order community→event→League→rating→statistics, RLS/grants. TS contracts, strict decoders, validators, model, `statistics_config`; fixtures + schema/projection tests.
- **Match history + §37 group detail (`7470269`)**: history readers migration with bounded merge pagination on `(effective_time, stable_id)`; lifecycle/type badges; §37 detail with pre-match team strengths, expected outcome, and upset badge (0.35 config threshold); `MatchHistory`/`ConfirmedGroupDetail`; `groups.$groupId` route.
- **Player core + advanced statistics (`79ce8da`)**: player readers + rank-history migrations — established-first ordering, membership intervals, immutable standings versions, provenance + coverage boundaries. §§33–34 metric catalog; `MetricState` insufficient-data thresholds driven by `statistics_config`; `PlayerStatistics`(+Records)/`PlayerMetric`; players route.
- **Pair partner + opponent statistics (`76ae6b8`)**: relationship readers; canonical pair/matchup identity independent of player order and court side; oriented H2H with focal reversal; partner/opponent records gated by 5-match thresholds; pair/opponent routes.
- **Scoped community statistics + filters (`3b65f7f`)**: community readers covering all §38 insights; filter matrix — all-communities=subject-scoped, active/historical League eligibility, type/date on played-day UTC; `StatisticsFilters`/search; community statistics route; authorization + EXPLAIN plan-shape tests.
- **Scoring/rebuild invariant proofs (`7694bac`)**: golden fixtures as hand-calculated oracle; all §83 bullets + AC5 (incomplete third set `6-4,3-6,2-1` → 11-11 games, 1-1 sets, draw); rebuild/replay/races/migration-up proofs. Found and fixed a production defect via U6: migration `20261102115000` makes rating activation replay publish statistics before rank refresh.
- **Accessible localized views (`433d220`)**: `StatisticsChart`/`DataTable`/`States`/`Breadcrumb`; chart contract — disclosure + full numeric table including zeros, focus stability; 85 metric helps; navigation keys; Pencil manifest `e2e/references/paf-13` (9 PNGs; frame provenance RN0yw/GrkSH/khmeK/o9iaC1/BcpYH).
- **E2E navigation/filters/charts (`e2f8c24`)**: e2e fixtures + 11 journeys + visual spec (geometry probes + measured residuals). Browser-found fixes: raw form-help keys, 320px overflow (minmax grid), 44px community links + dark contrast; paf-8 budget 0.285.
- **Review fix loop (3 rounds + Copilot, 27-findings ledger)**:
  - Round 1 `15fb743` (11 findings): League-filter-before-limit, bounded history lifecycle (first pass), all-versions League positions, abs closest-win, player/pair/detail Pencil restructure, filter bars, upgrade-proof scaffolding.
  - Round 2 `c6d30e0`: `statistics_participant_lifecycle` entry-keyed projection (deferred marker/drain triggers, rebuild integration, keyset reader), community selector, subject-scoped history reader + recent-matches card, relationship offset paging, closed-League snapshot-first, filter error state, geometry probes.
  - Round 3 `e92eebe`: recent-card stacked layout, See-all own-scope, skip-guard for other-player+no-community, 44px geometry probes.
  - Copilot advisories `f24c160` + `5371e62`: sampled-count raw formatting, `recentOffset` string coercion, path-UUID→`notFound` on partner/opponent routes, migration chain consolidated (`114000` deleted), `__dirname`→`import.meta.url` in guard tests.
- **Docs (`4b08378`)**: statistics delivery plan + review findings ledger.

## Files Changed

- ~150 files across the delivery branch (per git history; per-commit file-level diffs live there). Grouped scope below.
- **Migrations (`supabase/migrations/`)**: `20261102100000`, `20261102101000` (projections), `20261102115000` (rating activation replay publishes statistics before rank refresh — U6 production-defect fix); `20261102114000` deleted in chain consolidation (`f24c160`/`5371e62`).
- **Statistics feature (`src/features/statistics/`)**: TS contracts, strict decoders, validators, model, `statistics_config`; server functions; `StatisticsChart`, `DataTable`, `States`, `Breadcrumb`; `StatisticsFilters`/search; `MatchHistory`, `ConfirmedGroupDetail`; `PlayerStatistics`(+Records)/`PlayerMetric`; partner/opponent relationship views; §38 community insights.
- **Routes (`src/routes/`)**: `groups.$groupId`, players, pair, opponent, community statistics routes.
- **Copy (`src/locales/{en,pt-BR,es}/`)**: UI strings + 85 metric helps across en/pt-BR/es.
- **Supabase lib (`src/lib/supabase/`)**: client/reader support for new statistics readers.
- **Tests (`test/`)**: schema/projection suites, golden hand-calculated fixtures, rebuild/replay/race invariants, migration-up proof (scratch-DB phased upgrade: 91 pre-migrations → production-path seeding → statistics migrations → oracle + schema-md5 comparison), authorization + EXPLAIN plan-shape tests.
- **E2E (`e2e/`)**: fixtures + 11 journey specs + visual spec (geometry probes + measured residuals); `e2e/references/paf-13/` manifest + 9 PNGs + budgets.
- **Workflow records (`docs/plan/`)**: statistics delivery plan, `PAF-13-findings.md` ledger, this development log.

## Key Decisions

- **All-communities = subject-scoped semantics**: community insights are always community-scoped; the "all communities" filter scopes to the subject's communities rather than global aggregation.
- **Entry-keyed lifecycle projection**: cursor-identical stable ids (proposal id) after the event-keyed design was proven unsound by test; paired with deferred marker/drain triggers and a keyset reader.
- **Lock order finalized community→event→League→rating→statistics**: the plan's original stats-before-rating ordering broke rating race tests; finalizer hooks follow the corrected order.
- **Matchup index restored in new shape** (`matchup_id`-leading) with a plan-node assertion; the U5 drop recommendation was based on the old index shape.
- **Deferred marker/drain triggers** for membership/rank/lifecycle hooks; provisional guard test narrowed with recorded justification.
- **Migration-up proof**: scratch-DB phased upgrade — 91 pre-migrations → production-path seeding → statistics migrations → oracle + schema-md5 comparison.

## Validation Performed

- **Local final gate (green)**: `pnpm complete-check` at `e92eebe` — 2540 unit / 868 integration / 359 E2E, 6 static stages, ~18 min.
- **CI on final head `5371e62`**: 9/9 checks pass — static (45s), unit (2m26s), integration (18m53s), e2e shards (13m/10m/9m), e2e-report, aggregate `checks`, GitGuardian; mergeState CLEAN.
- **Copilot reviews**: round 1 (`4b08378`) 5 advisories → fixed; round 2 (`f24c160`) 3 `__dirname` findings → fixed; round 3 (`5371e62`) no open issues.
- **Measured Pencil residuals** (all within budgets): player 0.1550/0.19, pair 0.1782/0.21, opponent 0.1747/0.21, community 0.1546/0.19, group detail 0.1539/0.19.
- **Invariant proofs**: golden hand-calculated fixtures cover all §83 bullets + AC5; rebuild/replay/race/migration-up proofs green.

## Risks and Follow-ups

- **Optional observations NOT scheduled**: Showing-X-of-Y pluralization; OFFSET (not keyset) paging unstable under concurrent inserts; `rebuild_statistics` string-replace patch fail-loud; `readOffset` non-canonical strings.
- **Known caveat**: player-ratings E2E flake observed once in parallel full runs (shared-DB worker race); passes isolated + serial; U6 race tests prove lock coherence.
- **Pre-existing, out of scope**: `/matches/past` legacy shell overflows 54px at 320px.
