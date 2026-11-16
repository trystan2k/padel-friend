## Task Analysis

- Main objective: Deliver repository-side remediation for PAF-198, **Remediate pre-release database security findings**, on `feature/PAF-198-remediate-pre-release-database-security-findings`. Bound player-statistics calendar expansion; reject anonymous onboarding at the database boundary; prepare reviewed first-release recovery without authorizing production access or deployment.
- Identified dependencies:
  - Intake supplies authoritative epic/child criteria and branch baseline `origin/main` commit `f57c687`. PR #65 already delivered version-only release tags. Do not repeat or revert that work.
  - Local database verification needs Docker, dependencies, and isolated test stack `padel-friend-test`, API `55421`, database `55422`. Stack availability was not tested during planning. Missing stack unblocks with `pnpm test:stack:up`; no hosted fallback.
  - Release candidate: https://github.com/trystan2k/padel-friend/pull/66. Public page inspected during planning: open `0.3.0` candidate, head `e4d720b`, generated branch `release-please--branches--main--components--padel-friend`, comparison `v0.2.0...v0.3.0`, duplicated historical entries. Re-read authenticated current state before acting; this is snapshot evidence, not a freshness guarantee.
  - Production preflight, reviewed pending-set marker, final published-tag identity, published notes, environment approval, migration application, deployment, and outcome verification depend on later owner-controlled release lifecycle. No authorization exists for these operations in this session. **PAF-195 and epic cannot be marked fully complete merely because repository work passes.**
- System impact:
  - Forward-only replacements of existing RPC bodies; preserve signatures, security modes, empty search paths, grants, existing provisional/revoked-session restrictions, rating initialization, replay semantics, filters and shared-community authorization.
  - Small additive statistics response contract, decoder/fixture updates, localized activity-window disclosure. No new dependency, architecture layer, policy, role, background job, production configuration change, or historical tag change.
  - Preserve current-main freshness, CI provenance, immutable tag/SHA checks, pending-set binding and production environment gate.

### Repository findings and affected contracts

| Area | Evidence / expected scope |
| --- | --- |
| Statistics authority | `supabase/migrations/20261102105000_statistics_rank_history.sql`, `get_player_statistics` starts around line 606. Authorization precedes projection reads. Activity CTE near lines 806–815 expands requested/observed bounds through `generate_series`, then builds days/weeks/months JSON. |
| Actual product date support | `src/features/statistics/StatisticsFilters.tsx` exposes arbitrary whole-date inputs and reset to both-null. `statistics.validators.ts` checks dates/order, not maximum span; `statistics-search.ts` preserves open-ended URL filters. **No existing numeric product maximum was found.** Lifetime, one-ended and arbitrary ordered ranges are supported contracts; do not invent a one-year input restriction and call it an existing requirement. |
| Statistics request path | `statistics-player.functions.ts#getPlayerStatistics` authenticates and validates; `statistics-player.server.ts#readPlayerStatistics` invokes RPC. Decoder validates returned filters and decodes activity arrays. `statistics-player-contracts.ts#PlayerActivity` holds activity contract. `PlayerStatistics.tsx` renders `activity.months`; records component renders full-scope average/best periods. |
| Statistics tests | `test/statistics.player.reads.integration.test.ts` already checks grants, own-player reads, projection-only behavior, lifetime/daily equality, and gap filling. Reuse `test/helpers/ranked-result-fixtures.ts`, `playedAt`, `fixtureSql`/`sqlRows`, `local-supabase-env`. Existing filter/auth/rank suites remain regression oracles. |
| Onboarding authority | Latest `onboard_player` replacement is in `20261101100000_global_rating_ledger.sql` near line 381, **not just** initial 20260928 migration. It calls `assert_actor_not_provisional`, validates, locks, preserves replay, inserts profile, invokes rating-initialization seam. |
| Availability delegation | `20261112090000_player_availability.sql`: invoker wrapper locks/checks preexistence, calls `onboard_player`, then writes availability only for first onboarding. Base guard therefore protects both entry points before any write, including replay. |
| Application auth | `src/features/auth/auth.server.ts#requireAuthenticatedClient` already rejects `getClaims().claims.is_anonymous === true`. `src/features/player/player.functions.ts#onboardPlayer` invokes availability wrapper. No application auth rewrite needed. |
| Onboarding tests | `test/player.integration.test.ts`, `player.availability.integration.test.ts`, `player.rating.initialization.integration.test.ts`, `provisional.authorization.integration.test.ts`, `auth.provisional-claim.integration.test.ts`, `auth.provisional-oauth.integration.test.ts`, `auth.server.anonymous.test.ts`. |
| SQL claims simulation | `test/statistics.history.bounded.integration.test.ts` and `statistics.lifecycle-projection.integration.test.ts`: `openDedicatedSqlConnection()`, transaction, `SET LOCAL ROLE authenticated`, transaction-local `request.jwt.claims`. Use this pattern, parameterized claims, and explicit accurate simulation labels. |
| Real anonymous-session feasibility | `test/stack/supabase/config.toml:43` disables anonymous sign-ins. `test/community.column-isolation.integration.test.ts` expects `anonymous_provider_disabled`. Existing shared test stack cannot mint a real anonymous session unchanged. Do not silently enable provider, restart shared Auth during suites, or modify production. |
| Release sources/tests | `release-please-config.json` has `include-component-in-tag: false`; `release-please-manifest.json`/package currently 0.2.0. `CHANGELOG.md` currently starts with historical 0.2.0 using actual component-prefixed tag. Release PR owns generated 0.3.0 entry. `docs/production-release-runbook.md`, `.github/workflows/release.yml`, `scripts/production-release-guard.mjs`, `scripts/production-migrations.mjs`; `test/production-release-workflow.test.ts`, `production-release-guard.test.ts`, migration-helper tests. |

### Missing Inputs / Assumptions Made / Targeted Clarifications

- Missing Inputs: current private test-stack availability; actual final release SHA/tag; fresh production migration history; owner authorization. None may be fabricated.
- Assumptions Made: preserve all currently supported date-filter semantics. Proposed **366 inclusive days** is a new engineering bound for returned dense activity series, not an inferred product input maximum. It accommodates a leap-year-sized visualization and leaves all-time totals available.
- Targeted Clarifications: caller must surface any objection to the explicitly bounded activity-series contract before implementation. If product requires complete daily arrays for arbitrary lifetime periods, bounded pagination is required instead; do not silently truncate or reject lifetime. No question/delegation issued by planner.
- Required blocked criteria remain open under Completion-First Policy. Owner-gated lifecycle is an existing explicit scope boundary, not an automatically created follow-up. Conditional real-anonymous-session coverage must be reported honestly as unavailable under current stack configuration; simulated coverage is not equivalent evidence.

## Chosen Approach

- Proposed solution:
  1. Execute **PAF-197 → PAF-196 → PAF-195 repository work**, then shared review/fix sweep/final gate. Smallest, least ambiguous database security repair first establishes fixtures and migration discipline.
  2. PAF-197: replace latest base onboarding body in a new transactional migration; extend existing authentication condition with `coalesce(auth.jwt()->>'is_anonymous', 'false') = 'true'`. Reuse established `28000` / `Authentication required` contract. Guard precedes validation/lock/writes/replay; leave provisional assertion and all subsequent body behavior intact. Wrapper inherits rejection; prove both entry points.
  3. PAF-196: retain full requested/observed statistics scope and metrics. Restrict **only generated visualization series** to latest 366 inclusive UTC dates within that scope. Add explicit activity-window metadata and localized disclosure. Compute full-scope best week/month directly from stored daily buckets, not the bounded visualization. This removes request-controlled calendar amplification without breaking lifetime or open-ended inputs.
  4. PAF-195: one-time reviewed release-notes correction with final regeneration check and temporary main/release-branch write freeze. Keep historical sections; explain cumulative first-production-release history rather than destructively deduplicating previous releases. Correct 0.3.0 baseline to real `padel-friend-v0.2.0` tag. No tag aliases, history edits, permanent bootstrap SHA, or automatic release-body writer.
- Justification for simplicity:
  - Considered rejecting all effective ranges over 366 days. Small SQL change, but breaks default lifetime and open-ended views after one year; rejected.
  - Considered paginated activity endpoint or adaptive series resolution. More RPCs/client state or changed bucket meaning; unnecessary for monthly chart currently rendered.
  - Selected bounded display window with unchanged complete aggregates. Small, explicit additive contract; short ranges remain identical. Work depends on existing authorized projection rows, not arbitrarily many requested empty days.
  - For release recovery, durable custom Release Please postprocessing would add remote-write/security machinery for one historical naming transition. Reviewed final correction plus freeze is sufficient; regeneration invalidates prior review rather than silently overwriting approved text.
- Components to be modified/created:
  - PAF-197: new `supabase/migrations/20261116090000_onboarding_non_anonymous_actor.sql` if version remains unused and sorts after current maximum; otherwise choose next unused 14-digit timestamp. New `test/player.onboarding-authorization.integration.test.ts`; bounded fixture/helper additions only if reused. Existing onboarding/availability/auth tests amended only where necessary.
  - PAF-196: second new migration, e.g. `20261116091000_statistics_activity_window.sql`, with same timestamp checks. `statistics-player-contracts.ts`, `statistics-player.server.ts`, `statistics-config.ts` for documented client bound if needed, `PlayerStatistics.tsx`, existing style tokens/classes, all three locale resources. New `test/statistics.activity-window.integration.test.ts`; extend existing player decoder/functions/UI/copy/a11y fixtures and tests.
  - PAF-195: `docs/production-release-runbook.md`; focused `test/production-release-workflow.test.ts` additions only for actual executable repository invariants. Reviewed generated `CHANGELOG.md` correction and PR body belong to release PR #66 after final regeneration, **not** fabricated 0.3.0 version/changelog changes on epic branch.
  - Generated `src/lib/supabase/database.types.ts` only if generation actually changes it. Body-only RPC changes should retain types. Test-stack migration mirrors follow existing stack tooling; never edit historical mirrored SQL or commit runtime-generated copies without checking repository tracking conventions.

## Implementation Steps

1. **Establish safe local baseline and evidence ledger.**
   - Confirm branch/base, clean or accounted-for working tree, latest migration version, existing stack mirroring/synchronization mechanism, current tests/config, and current release PR state. Record per-unit files and acceptance evidence in orchestrator bundle.
   - Confirm loopback test URLs/ports before fixture creation. Start isolated test stack when needed. No dev reset, hosted reads, production credentials, direct deployment, release merge, or historical workflow rerun.
   - Record selected activity-window contract below. If caller identifies conflicting product requirements, return that unresolved decision before PAF-196 changes.
   - Checkpoint C1: original migrations untouched; planned versions unique/monotonic; required local prerequisites available or explicitly blocked.

2. **PAF-197: implement forward-only authoritative actor rejection.**
   - Copy complete latest `onboard_player` definition, not obsolete initial version, into new `BEGIN`/`COMMIT` migration. Add anonymous check to existing no-UID rejection before any mutation; preserve provisional assertion ordering and revoked pre-claim-session logic.
   - Keep `SECURITY DEFINER`, empty `search_path`, argument defaults, return type, validation, advisory lock, initialization seam and consistent-state replay unchanged. `CREATE OR REPLACE` preserves existing grants; do not add unrelated revoke/grant tightening.
   - Do not duplicate full onboarding implementation in wrapper or add new generic auth helper. Wrapper continues calling guarded base function before availability update.
   - Checkpoint C2: review function diff against latest effective body; only intended actor guard differs. Snapshot privileges/security mode before/after for both entry points.

3. **PAF-197: add behavioral authorization/state regressions and commit unit.**
   - Build disposable non-onboarded actors using `signUpFixtureActor` without profile options. Use real authenticated public-key clients for positive control; no service-role browser path.
   - Parameterize both RPC entry points. In dedicated transaction, set authenticated role and claims containing existing disposable user ID plus JSON boolean `is_anonymous: true`; also exercise text representation if relevant to established SQL convention. Expect SQLSTATE `28000`.
   - Use savepoint around expected SQL failure, recover transaction, then inspect state as trusted fixture connection **before outer rollback**. Compare before/after profile, global rating, `player_rating_initializations`, availability, and any identified initialization/projection side effects. Outer rollback alone is not proof rejection occurred before writes.
   - Also deny anonymous claims for already-onboarded actors: idempotent replay must not return success for forbidden actor. Deny missing UID, actual no-session anon client, provisional actors and revoked pre-claim sessions with existing expected restrictions.
   - Positive controls: base onboarding creates exactly one profile/rating/initialization; wrapper creates valid availability atomically; replay does not reinitialize or overwrite saved availability; invalid availability still rolls entire first onboarding back. Preserve verified OAuth and provisional claim/availability scenarios through existing suites.
   - Real anonymous feasibility: record disabled-provider evidence and test rejection of anonymous sign-in where useful, clearly distinct from RPC simulation. Only add real-session case if a separately authorized, isolated local configuration can mint one without disturbing fixed shared-stack contracts; never enable hosted provider. If unavailable, report exact reason and simulated coverage delivered.
   - Run per-unit fast checks and test lanes using validation policy below. Commit exactly unit files: `fix: reject anonymous onboarding sessions`.
   - Checkpoint C3: both RPCs deny simulated claims, state unchanged before rollback, real authenticated control/replay passes, grants unchanged.

4. **PAF-196: replace activity expansion with bounded display contract.**
   - In second transactional forward migration, preserve latest full RPC body except targeted activity computation and input safety checks. Keep authorization and projection-alignment checks ahead of private reads, all scope/type/date predicates unchanged.
   - Contract:
     - `activity.fromDay` / `throughDay` retain full effective scope: supplied endpoints where matching buckets exist, otherwise observed endpoints for missing sides; both null when no matching activity.
     - New required decoded metadata `activity.window = { fromDay, throughDay, maxDays: 366, truncated }`. Window dates null and `truncated: false` for no activity.
     - Nonempty window ends at full effective `throughDay`; starts at later of full effective `fromDay` and end minus 365 days. Clamp **before** any series generation. Generate at most 366 dates and derive visualization weeks/months from only those dates.
     - Arrays describe window only: `days <= 366`, `weeks <= 54`, `months <= 13`. Week/month values at clipped edges are selected-window portions, not falsely labeled full-calendar totals.
     - Full `matches`, scores, form, rating, relationships, `weeklyAverage`, `mostActiveWeek`, `mostActiveMonth` retain complete selected scope. Compute best periods from grouped stored buckets; preserve earliest-period tie-breaking, including a zero-valued first-period candidate when needed to match original gap-filled semantics.
     - Oversized valid ranges succeed with truthful window metadata, never silently clamp aggregate filters or return empty success. Reversed ranges remain `22023` / `STATISTICS_INVALID_INPUT`, even with no activity. Null-ended and both-null lifetime remain supported.
     - Reject PostgreSQL infinity/nonfinite endpoints before date arithmetic; avoid overflow for direct-RPC dates outside client-supported calendar representation. Document any deliberate finite calendar bounds and align actual client validator behavior; do not rely on JSON decoding to reject after expensive SQL.
   - Use small bounded integer-offset series/date arithmetic where that avoids timestamp-range hazards. No unconditional full-range series hidden in best-period or denominator calculations. Full-scope average uses constant-time calendar arithmetic and full-scope count.
   - Retain public signature/return JSON type, grants and security configuration.
   - Checkpoint C4: SQL review proves every activity-generated list bounded before construction; no post-generation `LIMIT` disguise. Full aggregate semantics and existing filters unchanged.

5. **PAF-196: integrate truthful client contract, fixtures and local tests.**
   - Extend `PlayerActivity` and decoder for window metadata; validate finite calendar dates, ordering, boolean, numeric limit and bounded array lengths/periods. Update every typed/mock fixture, including shared UI fixture builders, rather than optional metadata that silently conceals missing server behavior.
   - Keep filters/search arbitrary ordered ranges; no shared validator one-year limit affecting history/community/relationship APIs. Update validators only for identified calendar compatibility edge cases.
   - Render localized activity-window caption when truncated, including formatted visible dates and clear distinction from full selected-range totals/records. Existing short-range screen remains visually equivalent. Use en/pt-BR/es locale resources, existing StyleX/token classes, semantic caption/description association, responsive wrapping and existing touch targets. Do not expose raw SQL error text.
   - Isolated integration fixtures: at least one matching projected daily bucket with aligned rating/statistics revision. Use normal result fixture for ordinary behavior; for sparse multi-year dates, seed a bounded number of fixture buckets on dedicated transaction or helper, not hundreds of events. Reuse published projections/cleanup patterns; do not mutate global configuration to bypass alignment.
   - Test 1-day and existing 5-/21-day windows; exactly 366 inclusive dates; 367-date oversized range; safe sparse multi-year explicit/lifetime/one-ended ranges; zero-activity for small and oversized requests; reversed and nonfinite endpoints. Ensure oversized test truly has matching activity, so vulnerable branch is exercised.
   - Assert exact first/last dates, every array bound, `truncated`, zero gaps, totals/filter echo unchanged, full denominator, best historical week/month outside displayed window still correct, ties and clipped period semantics. Verify normal own-player and authorized shared-community reads; reject unauthorized cross-player/all-community, no-session, authenticated-role anonymous, provisional and revoked actors.
   - Add decoder malformed-metadata tests, function/error-contract tests where changed, UI truncated/untruncated/empty states, localized copy parity and accessible description checks. Reuse statistics filter integration tests for community/league/type correctness.
   - Apply migration on test stack through normal tooling; verify generated DB types and unchanged thresholds. Commit unit files: `fix: bound statistics activity expansion`.
   - Checkpoint C5: small output unchanged except additive metadata; large output bounded and visibly disclosed; historical totals/records preserved; all security controls still deny.

6. **PAF-195: deliver repository recovery procedure and review candidate without release approval.**
   - Review latest PR #66 package version, manifest, lockfile updates if any, changelog, body, checks and comparison baseline. Confirm proposed version remains 0.3.0 after remediation commits; do not force 0.2.0 or publish an alternative historic tag. Escalate an actual generated-version change rather than silently substituting.
   - Document 0.3.0 as intended first **production deployment**, not first repository tag. Historical component-prefixed releases did not deploy; preserve them as historical/cumulative development history. Duplicated feature history may remain if explicitly labeled cumulative; do not misrepresent all entries as newly introduced after 0.2.0.
   - Document exact one-time correction: 0.3.0 heading/notes comparison uses `https://github.com/trystan2k/padel-friend/compare/padel-friend-v0.2.0...v0.3.0`. Verify both historical baseline existence and candidate head identity with read-only GitHub/Git operations delegated to git specialist.
   - Sequence, not an immediate remote edit: merge approved remediation PR only on explicit merge command; allow resulting CI/Release Please generation to finish; inspect final regenerated release branch; acquire temporary maintainer freeze on `main` and release-branch writers; correct tracked 0.3.0 changelog and PR release-notes section together on generated release branch through reviewed commit/process after separate remote-write authorization.
   - Ensure Release Please cannot overwrite silently: make correction **after last generation**, compare PR head/body after action completion, review exact diff, and retain freeze until explicitly authorized merge. Any additional main commit or generator update invalidates correction review: regenerate, reapply and re-review. Verify persisted correction on current final generated head. Do not claim a manual edit survives arbitrary later generation.
   - Do not add version bump or speculative generated changelog to epic branch. Release-branch correction remains part of release-candidate review; generated commit is separate from epic's per-unit implementation commits.
   - Keep guard/workflow code unchanged unless a proven related defect requires repair and tests. Preserve strict freshness even when it makes existing candidate stale. Retain existing version-only config regression.
   - Expand runbook recovery checklist with withheld-release status, generation/freeze protocol, exact final identity evidence, production-preflight ownership, full pending-SQL review, one exact `Approved-pending:` marker, and distinct migration/Worker outcomes. No fake approved marker or guessed pending set in published body.
   - Commit repository-side unit files: `docs: clarify first production release recovery`.
   - Checkpoint C6: checked-in recovery procedure is executable, historical tags preserved, PR66 issues evidenced, guard protections unweakened. Remote candidate/published-state criteria remain pending until authorized lifecycle.

7. **Review complete delivery, fix required/related findings, run final local gate and hand off.**
   - Independent code and architecture review covers auth ordering, effective latest function definitions, ACL/security preservation, bounded SQL, integer/date corner cases, complete metrics, fixture cleanup, translations/a11y, and release identity/approval rules.
   - Review full SQL of both new migrations and old-Worker/cron compatibility, not only changed lines. If any old served UI would misleadingly present bounded series, document deployment compatibility mitigation before release approval; do not claim additive JSON alone proves semantic compatibility.
   - Finish all required/related findings in this delivery, including supporting fixture/test reliability defects. Optional/unrelated observations stay separate; no automatic issue creation. Genuine unavailable prerequisites remain blocked.
   - One final fix-sweep commit when findings require changes: `fix: address security remediation review findings`; do not create empty sweep commit.
   - Run final local `pnpm complete-check` exactly once on final code state, after review fixes. Preserve coverage thresholds. Record every stage and exact suites run/skipped. Failure diagnosis uses logs first; fix and rerun affected failing suite once, then fulfill outstanding final-gate proof without gratuitous reruns of green suites.
   - Git specialist handles one approved push/epic PR to `main`, Linear link in description, no issue IDs in PR title or commit subjects/bodies, Copilot request verification protocol. Push/PR approval does not authorize merge or production.
   - Checkpoint C7: repository implementation/review/QA evidence complete; report owner-gated remainder explicitly. Do not mark epic/all children Done while required release outcomes remain unverified.

### Elevated-risk mitigation

- New migrations are transactional, forward-only, body replacements; never edit previously applied files or `migration repair` history. Roll back local experiments only on test stack. Any production correction requires a separately approved forward migration; no automatic database rollback.
- Activity cap is applied before expansion; no stress test or intentionally enormous response. Fixtures contain few matching rows; 367-day request proves boundary behavior safely.
- Preserve old-worker compatibility and all existing grants. Do not combine unrelated privilege cleanups with anonymous fix.
- Release corrections never delete/move historical tags, fabricate `v0.2.0`, weaken freshness, run old workflows, or imply published release equals deployment.

## Validation

- Success criteria:
  - Repository delivery: both security fixes, complete relevant regression coverage, documented release recovery, reviewed forward migrations, unchanged thresholds, successful required local QA.
  - Full epic completion: additionally satisfy owner-controlled release evidence below. **Repository-ready is not production-approved, deployed, or full-epic complete.**
- Checkpoints:
  - C1 pre-implementation: correct branch; loopback-only test stack; no production authorization assumed; unique migration timestamps; range contract explicit.
  - C2/C3 onboarding: database denial on both entry points before side effects, unchanged permissions, positive controls and replay/provisional/OAuth regressions.
  - C4/C5 statistics: bounded-before-generation proof plus concrete small/boundary/oversized and lifetime tests; full-scope totals/records unchanged; metadata/copy/a11y validated.
  - C6 release repository: final-generation correction procedure, correct actual baseline, historical/cumulative explanation, unchanged guard tests.
  - C7 delivery: reviews and full gate evidence; precise incomplete owner-controlled criteria.

### Acceptance-criterion proof map

| Criterion | Steps / proof |
| --- | --- |
| Epic: all children completed/reviewed with regressions | Steps 2–7 prove repository child scope; full completion additionally needs O1–O4. Keep PAF-195/epic incomplete until then. |
| Epic: authorized statistics/onboarding correct; release protections intact | C3, C5; existing auth/filter/claim tests and release guard/workflow/migration-helper tests in final gate. |
| Epic: required local gate, thresholds preserved | Step 7; successful complete-check stage report and unchanged threshold diff. |
| Epic: final migrations reviewed; repeat production preflight before approval | Step 7 full SQL review; O2 production comparison, no substitute local proof. |
| Epic: release notes and first outcomes separately after owner authorization | Step 6 preparation; O1 published-note check and O3/O4 distinct outcomes. |
| PAF-196: no unbounded daily expansion/generated activity response | Step 4 pre-generation window; Step 5 exact 366/54/13 caps with matching rows, sparse wide range. No claim that every unrelated existing RPC field is constant size. |
| PAF-196: documented oversized/reversed/null/empty/boundary API behavior | Step 4 explicit contract, SQL comments and client contract; Step 5 parameterized edge-case tests and localized disclosure. |
| PAF-196: own/shared correctness and unauthorized denial | Step 5 real-client authorized controls, existing filters suites and simulated forbidden-claims cases. |
| PAF-196: small, boundary, safely oversized local regression | Step 5 new integration suite; 5/21/366/367-day requests, nonempty projections, no stress load. |
| PAF-196: client/server validation and localized handling where needed | Step 5 decoder/fixtures, finite date parity, en/pt-BR/es caption, accessible description; existing stable errors retained. |
| PAF-196: DB types and full gate; no threshold reduction | Step 5 type check after migration; Step 7 complete-check. |
| PAF-197: both RPCs reject anonymous claims before all writes | Steps 2–3 direct RPC matrix, savepoint-recovered before/after profile/rating/initialization/availability state. |
| PAF-197: unauth/provisional/revoked deny; signup/replay valid | Step 3 forbidden-actor matrix plus real signup and existing claim/OAuth/replay suites. |
| PAF-197: both entry points, side effects, positive control | Step 3 new integration tests with precise SQLSTATE and state assertions. |
| PAF-197: real anonymous where feasible, accurate simulation labels | Step 1/3 feasibility evidence: fixed local provider disabled; conditional isolated real-session test only if available. No fabricated real-session proof. |
| PAF-197: DB types/full gate; thresholds preserved | Steps 3/7 and gate ledger. |
| PAF-195: version-only tags already complete | Retain PR65 configuration and `production-release-workflow.test.ts` regression; no duplicate implementation. |
| PAF-195: first candidate/version and historical treatment reviewed | Step 6 authenticated refreshed PR diff + runbook; revalidate generated version after final main changes. |
| PAF-195: tracked/published comparison corrected and not overwritten | Step 6 final-generated-head correction/freeze proof; O1 verifies actual published notes and tracked tag file. Until actual correction/publication, criterion remains pending. |
| PAF-195: exact final tag equals current main and passed CI | Existing guard tests remain; actual identity O1. A pre-release PR head is not final-tag evidence. |
| PAF-195: true pending set reviewed; matching marker before approval | Step 6 procedure, final SQL review Step 7; O2 actual production history and exact release-body marker. |
| PAF-195: production approval only explicit; distinct outcomes | Hard stop at owner boundary; O3/O4 only. |

### Test execution policy

- Tests execute only during implementation/QA, not planning. Every test command gets shell timeout **1800000 ms**; `pnpm complete-check` gets **3600000 ms**. Timeouts are not product failures; rerun timeout-killed command with larger ceiling.
- Per-unit fast static checks: `pnpm typecheck`, `pnpm lint`. Iteration uses affected tests, not full suite repeatedly. DB-touching commands and resets always serial; never overlap test workers/suites from separate sessions.
- Unit lane: `pnpm exec vitest run --config vitest.unit.config.ts <affected-test-files>` or related-file equivalent. Integration lane through existing `scripts/run-integration.mjs` / `pnpm test:integration` with supported file filters; verify runner argument forwarding before use. Default new DB tests remain serial partition unless specifically audited parallel-safe.
- Single-run policy: do not run a targeted lane and then its full suite on identical code state. Per-unit tests belong to successive implementation states; reserve complete-check for final combined/reviewed state. If last unit is final state, omit redundant targeted suite and let final gate cover it. Keep explicit suite/state ledger; do not call skipped/zero-test runs evidence.
- DB type proof: `pnpm db:types:check` needs live migrated test stack; run once per applicable final migration state or via integration's existing early type check. Body-only replacements should not change generated types. Never run against dev/hosted.
- Final complete-check owns coverage unit run, reset/integration, build, reset/fresh-preview E2E and static checks. No separate full `pnpm test` or full E2E confirmation on same final state. If separate E2E iteration is needed on earlier state, use `pnpm test:e2e <spec paths>` (no `--`), never bare Playwright.

### Owner-action gates — NON-EXECUTABLE IN THIS SESSION

These are withheld required release scope, **not implementation steps**, automatic follow-ups, or authority delegated to implementation agents.

| Gate | Owner action / unblocking condition | Required evidence |
| --- | --- | --- |
| O1: authorize release lifecycle and verify published candidate | Explicit owner command permits release-PR merge/publication at final reviewed head; do not infer from epic push approval. Maintain correction freeze; if main advances, regenerate latest candidate rather than override freshness. | Final package/manifest 0.3.0 if still agreed; actual tag `v0.3.0` peeled SHA = current remote main = successful eligible CI head; corrected published comparison and tracked changelog; no deleted/renamed tags. Publication still does not prove deployment. |
| O2: repeat production preflight and bind reviewed migrations | Owner performs authorized read-only hosted preflight from exact final tag, using runbook §5. Re-read full SQL of every truly pending file, including older unseen-by-tag-diff files and these new fixes; review old Worker/six-cron-job compatibility. | Production history strict prefix; manifest/dry-run exact agreement; sanitized conclusions; exact one `Approved-pending: <versions>` or `Approved-pending: none` in actual release body **before** environment approval. Never guess from tag diff or record fake approval. |
| O3: approve production and observe migration outcome | Separate explicit owner confirmation and actual protected environment approval. Only approved workflow applies migrations/deploys. No production anonymous sign-in. | Migration step applied/no-op status, applied versions/count matching reviewed marker, post-check no pending, or explicit failure/partial result. Retry requires fresh history/marker review; never automatic history repair. |
| O4: separately verify Worker and first deployment | Owner-authorized verification after actual deployment; do not treat migrations or release publication as Worker success. | Actual Cloudflare deployment identity/status, intended release SHA, application smoke checks for authorized onboarding/statistics, separate migration-vs-Worker outcome record and reviewed failure handling. Only then close remaining release/epic criteria. |

Plan file: `/Users/trystan2k/Documents/Thiago/Repos/padel-friend/docs/plan/Plan PAF-198 Remediate pre-release database security findings.md`
