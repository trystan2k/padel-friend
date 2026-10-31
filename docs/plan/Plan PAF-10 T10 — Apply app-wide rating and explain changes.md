# PAF-10 — T10 — Apply app-wide rating and explain changes

## Task Analysis

- Main objective: Confirmed ratable Competitive Game Groups update app-wide player ratings exactly once, including provisional players; expose reliable, private, localized progression and explanations. Deliver all 13 acceptance criteria plus amendment on `feature/PAF-10-apply-app-wide-rating-and-explain-changes`, one commit per child issue, one final PR against `main`. Intake baseline: `origin/main` at `eb1a94b`; planner did not run git commands or tests.
- Identified dependencies:
  - PAF-8: Done per intake. Repository evidence: `20261028180302_result_review_confirmation_contract.sql` defines immutable `match_event_result_confirmations`, exact proposal-version references, and `finalize_match_event_result_locked`; manual and scheduled confirmation share this seam.
  - PAF-9: Done; `docs/rating/v1-calibration.md` contains explicit approval, engine `app-wide-level` / `1.0.0`, configuration `1`, 31-case unchanged oracle `docs/rating/golden-fixtures.json`.
  - PAF-125: Done; permanent UUID, creator-estimated provenance, restricted provisional actors, existing claim protections and badge contracts present in `20261031090000`–`20261031160000` migrations.
  - Existing state: `global_player_ratings` already stores initial/current/highest level, mu, sigma, reliability and count. Extend, do not replace it. Existing profile already displays these summaries but history is an empty placeholder.
  - No unavailable product prerequisite found. Runtime Supabase/Docker availability and Pencil access have not been exercised by this read-only planner; verify before implementation/QA. Links: https://linear.app/trystanworkspace2/issue/PAF-8, https://linear.app/trystanworkspace2/issue/PAF-9, https://linear.app/trystanworkspace2/issue/PAF-125.
- System impact: Forward-only schema/functions/RLS changes, shared confirmation transaction, initialization/claim synchronization, populated-data upgrade, typed sporting-data readers, dashboard/result UI and related fixtures/tests. High-risk cross-community state; no browser-authoritative arithmetic, mutable history replacement, queue infrastructure, manual review implementation, League-specific skill, League progression chart, historical import, or new standings/statistics product. Existing future League work is not a blocker.

### Repository findings and scope interpretation

- Current initialization paths are `onboard_player` and `initialize_global_player_rating_locked`; provisional creation calls the latter. Current claim implementation is replaced by later review migrations: preserve latest password/session/identity protections, not merely the first claim migration body.
- `player_has_rated_history` currently checks state only. Extend with ledger/official confirmed-group evidence so claim cannot exploit unprojected predecessor history.
- `src/features/auth/auth.server.ts::requireAuthenticatedClient` calls `getClaims()` and sets `private, no-store`. Reuse for each new server-function handler. RLS/provisional/session checks remain database-enforced.
- `src/routes/_protected.dashboard.tsx` loads `PlayerProfile`; no standalone profile route exists. Prefer extending this existing route plus result-detail entry points.
- Public profile/rating table SELECT policies currently allow owner only. Do not broaden raw profile access: it includes immutable inviter provenance and private fields. Use explicit sporting DTOs.
- No implemented standings/stats screen found in `src`; badge amendment applies to existing result displays and every new rating/stat-summary DTO/view in this delivery. Preserve `is_provisional` in reusable contracts; do not invent future League screens.
- Completion-first policy read: `.opencode/agents/delivery-orchestrator.md` §§Completion-First Policy and Commit Policy. Required/related defects and regression support finish here; unrelated observations are reported only.

## Chosen Approach

- Proposed solution: Postgres owns one pure numeric V1 calculation kernel and one transactionally serialized projector. Shared confirmation finalizer invokes projector after official facts and terminal status are written, before transaction returns. Separate immutable event identity from append-only calculation revisions to preserve chronological replay when older groups confirm late. Reuse existing global-state row as current materialization.
- Justification for simplicity:
  1. **Chosen: SQL kernel + explicit shared finalizer call + database advisory transaction lock.** Existing authoritative commands already live in Postgres; numeric arithmetic, all-four updates, immutable evidence and transaction rollback stay together. No network transaction or extra Worker/service.
  2. **Rejected: application-only TypeScript read/compute/write.** Ordinary Supabase calls cannot hold a transaction/advisory lock across network calls. Correct optimistic snapshot/CAS retries would require a second consistency protocol. A post-confirmation callback can lose updates on crashes and misses scheduler paths.
  3. **Rejected: queue or rating trigger architecture.** Queue adds delivery/reconciliation infrastructure and eventual visibility. Trigger centralizes inserts but hides expensive replay and may run before terminal proposal transition; explicit shared finalizer seam is clearer. Unique constraints alone prevent duplicate identities, not concurrent stale calculations.
- Components to be modified/created: New forward-only rating migrations; existing state and initialization/claim/finalizer functions; `src/lib/supabase/database.types.ts`; new `src/features/player/rating-*` contracts/readers/model and `Rating*.tsx` components; existing player server/profile/dashboard and match result readers/detail UI; locale JSONs; `test/player.rating.*`, fixture builders/populated-upgrade assertions and E2E specs. Exact proposed ownership below. No dependency installation planned.

### Contract decisions implementers must preserve

**Chronological order versus immutability.** T09 lines 94–100 require ascending `(played_at, game_group_id)`, not confirmation order. T08 permits independent confirmation of group versions; older groups can confirm after newer groups. A lock does not solve this. Define `game_group_id = match_event_result_proposals.id` (stable across proposal versions), `played_at = confirmed version.played_at_utc`, `match_id = match_event_id`; record confirmation ID and exact proposal version separately. Do not use random confirmation IDs or group number alone as global identity.

Use three concepts:

- `player_rating_events`: immutable, unique `(game_group_id, user_id)`, durable group/player identity and source pointers. Exactly one logical rating event per eligible participant. No initialization/claim pseudo-group events.
- `player_rating_event_calculations`: immutable revisions keyed `(rating_event_id, projection_revision)`, holding full before/after and explanation payload plus complete frozen four-player calculation inputs and version stamps. First calculation is retained forever. Recomputed calculations are revisions of the same event, never additional group credits.
- One internal projection-control row tracks activation, latest processed chronological key and committed revision. Current-state rows reference their projection revision. Readers select latest calculation at/before a single committed revision; older revisions remain audit evidence. Event detail defaults to current calculation, not stale original values.

For a new chronological tail group, calculate four states and append four event/calculation rows. For an older newly confirmed group, reconstruct the entire currently confirmed eligible stream from ledgered effective starting states in sorted order, append changed calculations against existing event identities, insert new identities only for new groups, and replace materialized state atomically. Start with complete replay for late insertion at expected V1 scale; no transitive dependency graph/checkpoint framework. Cross-community opponents propagate changes beyond the original four players, so a four-player-only repair is incorrect. Identical retry/replay must add no revision and change no state.

This is a proposed supporting ledger contract, not approval to weaken AC4: one logical event, immutable calculation evidence. Caller must surface disagreement with revisioned explanations before implementation. If “one event” is instead intended to forbid all recalculation evidence, chronological replay and immutable before/after cannot both hold for late confirmation; obtain explicit product resolution, never silently switch to confirmation order, reject valid older results, or defer late-order correctness.

**Initialization audit is separate.** `player_rating_initializations` records immutable initial/proposed-effective starting-level evidence, sequence, provenance (`self_declared` / `creator_estimated`), reason (`onboarding`, `creator_estimate`, `claim_before_history`, `migration_snapshot`), before/after where applicable and engine/config stamps. Claim edits before history use the same initialization routine and append initialization audit, not a match rating event. Original creator-estimated provenance on profile remains immutable after claim; an effective claim-start revision does not relabel original provenance. Claim without a level edit creates no initialization or rating event. Migration records known original estimate and current effective initial level without fabricating unavailable historical timestamps.

**Numeric kernel.** SQL immutable function accepts four frozen pre-group states and classification, returns all four calculated outputs without writing. Use `numeric`, `power(numeric,numeric)`, exact rational K `(6000 - 45*r)/20000`, PostgreSQL numeric delta rounding half away from zero, then clamp; no binary intermediate or epsilon. Compute both means and expected outcomes once before any update. Persist raw/rounded/applied delta, expected score, outcome, reliability factor, clamp, mu/display/sigma, group-count/highest before/after, deterministic `last_rating_at`, and engine/configuration tuple. Reliability uses BEFORE count for K and AFTER count for `min(100,10+6*n)`. No scoring margin, provisional flag, community or League metric enters calculation.

**Lock graph.** Preserve canonical community/event/registration/proposal locks. After existing event locks and before any rating-row locks, take one dedicated app-wide advisory transaction lock. All initialization/claim rating writes also take that lock before rating rows; they may already hold existing identity advisory/profile locks. Projector never acquires community/event/identity/profile row locks while holding rating lock: it reads immutable official facts/profile metadata and locks only rating rows in UUID order. This avoids global→event and global→identity reverse edges. Backfill takes rating lock and reads official immutable facts without locking events. Confirmations waiting behind activation subsequently project themselves. Re-read authoritative inputs after obtaining lock under READ COMMITTED; do not reuse pre-lock snapshots. Test this graph with separate database connections and bounded timeouts.

**Privacy.** Owner can see complete own app-wide history. Other authorized sporting viewers receive only group-specific facts they may inspect through existing result-reader permissions; community-scoped history filters events by that scope, never grants all of a player’s private-community history because one group is shared. New rating surface cannot expose inviter/adder UUID, email, bio, claim proof, result rejection notes or raw initialization audit. Safe DTOs include sporting identity/name + current provisional flag, numeric rating explanation and authorized match context only. Raw ledger may remain internal except owner-safe access; use SECURITY DEFINER DTO RPCs with explicit actor/session and scope assertions, fixed empty search_path, narrow grants. Public-community visibility follows existing community/result privacy policy, never a universal sporting-data policy.

## Implementation Steps

1. **Preflight and create child issues before code.** Parent orchestrator/project manager creates six Linear children from U1–U6 below, records Depends On links, maps actual identifiers into delivery bundle. No invented issue IDs. Preserve one existing branch/one final PR. Verify calibration file contains all 31 cases unchanged; inspect latest function definitions/migration order and available migration-up harness; confirm local DB prerequisites. Read relevant profile/rating/result frames through Pencil MCP (`docs/design/padel-friend.pen`, never raw Read/Grep); identify visual references and existing semantic tokens before UI work. No need for routine plan approval; resolve only real contract conflicts described above.

2. **U1 — Add immutable global-rating ledger and initialization provenance.**

   **Description:** Extend existing global state with configuration/projection references and add append-only logical events, calculation revisions, initialization audit and projection control. Unify onboarding/provisional/zero-history claim initialization behind existing internal initialization seam, preserve permanent UUID/provenance and current claim security, and establish restrictive access/immutability before enabling any projection.

   **Dependencies/order:** First child; depends on completed PAF-8/PAF-9/PAF-125. U2 depends on U1.

   **Concrete implementation:**
   - New timestamped migration after `20261031160000`; never edit applied migrations. Extend `global_player_ratings`, do not introduce community-specific state. Add consistency checks for 0–7 two-decimal levels, sigma=1 in V1, reliability/count formula and highest≥current after auditing predecessor rows.
   - Create tables/contracts above with restrictive source FKs, indexes `(user_id, played_at, game_group_id)` and group/player uniqueness. Add immutable UPDATE/DELETE guards and revoke client writes, including RPC helper execution; prevent unauthorized TRUNCATE via grants. Avoid cascade deletion of sporting evidence.
   - Store team member IDs and all numeric input states per calculation without inviter or private account fields. Audit payload contains engine/config, actual rating inputs and source facts sufficient for replay.
   - Add a safe baseline audit for existing initialized ratings. Assert predecessor group counts/last-rating state are unprojected as expected; unexpected nonzero history aborts upgrade for diagnosis rather than treating current ratings as starting inputs. Preserve current effective initial level and original estimate.
   - Route onboarding, provisional initialization and allowed claim edits through same helper; all take rating lock before rating-row writes. Extend `player_has_rated_history` with logical events and eligible confirmation/team membership, so predecessor results lock claim editing even before activation. Do not alter mailbox proof/password continuity/session revocation behavior.
   - New ledger tables explicitly include provisional/revoked-actor restrictions; PAF-125’s one-time policy installation will not automatically cover new tables.
   - Regenerate database types and update fixtures that currently clean profiles/ratings with immutable evidence present. Trusted test cleanup must respect FK order and explicit test-only trigger handling, never production RPC bypasses.

   **Acceptance criteria (testable):** One global state per permanent UUID; duplicate group/player identity fails; rating/calculation/initialization evidence rejects updates/deletes by runtime roles; non-owner/private and provisional/revoked actors cannot read new sensitive data; initial creator estimate persists through re-add; before-history claim edit appends only initialization audit; after-history claim edit is refused and same-level claim still succeeds.

   **Expected file-scope:** `supabase/migrations/*_global_rating_ledger.sql`; `src/lib/supabase/database.types.ts`; `test/player.rating.schema.integration.test.ts`; `test/player.rating.initialization.integration.test.ts`; existing `test/auth.provisional-claim.integration.test.ts`, `test/provisional.authorization.integration.test.ts`, `test/helpers/provisional-*-fixtures.ts` and cleanup helpers only as required. Include this durable plan in U1’s documentation scope.

   **Proof/checkpoint:** Schema/ACL/immutability/claim tests plus existing player/claim regression suites; inspect pg grants and source FK constraints. No projection hook installed yet. Suggested commit: `feat: add immutable rating ledger and initialization audit`.

3. **U2 — Implement approved deterministic V1 rating kernel and golden oracle tests.**

   **Description:** Add pure, versioned team-aware calculation using exact numeric arithmetic; pin every approved golden case and replay invariant before wiring authoritative updates. Keep one production implementation in Postgres rather than divergent SQL and TypeScript engines.

   **Dependencies/order:** Depends On U1; U3 depends on U2.

   **Concrete implementation:**
   - Add immutable SQL calculation/eligibility helpers with explicit input/output schema. Validate distinct four players, two per side, valid levels/counts/reliability and supported version; non-ratable group produces no calculation/event.
   - Implement formulas/precision/simultaneous computation exactly as Chosen Approach. Use fixed versions; unsupported configs fail closed. `last_rating_at=played_at`, never wall clock.
   - Add typed fixture adapter consuming unchanged JSON. Handle `game_group`, `account_claim` and `provisional_level_proposal` steps; compare every expected state/output/event order and listed invariant. Do not skip claim cases because they are non-arithmetic steps.
   - Add parameterized **31-case calculation unit tests of the pure SQL function**, executed by Vitest’s integration runner because Postgres is the runtime. Explicitly label this distinction: `test:unit` must stay DB-free. DB-free Vitest tests cover fixture schema/count, exact string normalization, eligibility/display/explanation models and replay ordering; actual engine correctness is proved by SQL-kernel tests, not only fixture self-consistency. No second production engine merely to call these DB-free tests.
   - Exact two-decimal state/delta and three-decimal team-strength string assertions; expected/raw comparisons use oracle absolute tolerance `1e-12`; version, count, sigma, clamp and highest compare exactly. Extra tests: negative half-cent, zero normalization, cancel, reserve-not-playing, malformed teams, zero rounded delta still increments count, 15+ groups.

   **Acceptance criteria (testable):** All 31 unchanged fixtures and invariants pass production kernel; GF-21 gives symmetric ±0.11; GF-14 ordering/tie-break matches; GF-05/GF-18 partners differ by reliability; clamped outcomes still count; no exclusion changes any rating field.

   **Expected file-scope:** `supabase/migrations/*_rating_v1_engine.sql`; `src/features/player/rating-contracts.ts`, `rating-model.ts` if needed for presentation contracts; `test/helpers/rating-golden-fixtures.ts`; `test/player.rating.engine.integration.test.ts`, `test/player.rating.model.test.ts`, `test/player.rating.fixtures.test.ts`; generated database types. `docs/rating/*` read-only.

   **Proof/checkpoint:** Assert test report enumerates 31 cases, not 31 files or a partial subset; oracle unchanged. Suggested commit: `feat: implement calibrated team-aware rating calculation`.

4. **U3 — Project confirmations atomically and initialize existing confirmed history.**

   **Description:** Connect the tested kernel to shared manual/automatic confirmation, serialize app-wide state across communities, enforce exactly-once event identity, and activate deterministic projection of already-confirmed in-app groups without resubmission. Handle late confirmation through immutable calculation revisions in the same delivery.

   **Dependencies/order:** Depends On U1 and U2; U4 depends on U3.

   **Concrete implementation:**
   - New migration adds internal projector and integrates `finalize_match_event_result_locked` after terminal transition/audit, preserving existing notifications, idempotency and auto-confirm failure handling. Already-confirmed retry branch also invokes idempotent projector before returning existing confirmation. Never grant caller-supplied levels/results to an authoritative write RPC.
   - Eligibility comes from immutable confirmation `event_type`, `ratable_eligible`, exact referenced version/classification/teams and valid non-cancelled confirmation contract. Pending/disputed versions and reserve registrations are not inputs; rate only four played team IDs. Later membership/status changes cannot silently erase official history. Assert canceled ratable predecessor anomalies fail upgrade rather than inventing a rating policy.
   - Under global transaction lock, check logical identities, load four pre-states and compute before any writes. Write all four events/calculations/state rows and projection marker atomically. A duplicate constraint conflict is not successful partial application: verify all-four evidence and roll back inconsistent state.
   - Implement chronological tail fast path and full-stream late-insertion replay. Replay starts from effective ledgered initialization, not current mu. Preserve engine/config recorded per source event and all old calculations; compare candidate outputs and append only changed calculation revisions. Group credits/counts derive from distinct eligible groups, not number of revisions.
   - Separate migration activates/backfills under the same lock: snapshot existing eligible confirmations, sort by UTC instant/proposal UUID, replay once, validate four events per group, commit activation and watermark with state. Re-running activation/projector is no-op. Concurrent confirmations wait; after activation they re-read and append/replay as necessary. No async queue or browser resubmission.
   - Preserve first-rating/claim serialization: after rated group, same-level claim changes account metadata only; after a zero-group level edit, first projection uses effective claim-start audit. Claim must not lock or re-key ledger rows.
   - Extend populated-upgrade harness with predecessor confirmed groups, provisional players, multi-community overlaps and equal timestamps; compare source snapshots and migrated state to clean sorted replay; run migration-up twice.
   - Add fixture builders using existing `test/helpers/sql-transport.ts`, provisional helpers and result commands. New immutability/FKs require explicit teardown support in unit/integration/E2E fixtures; cover that support with cleanup regression tests.

   **Acceptance criteria (testable):** Manual, AUTO_48H and retries yield four logical events and one count per played participant; overlapping cross-community confirmations show no lost updates; rollback leaves no partial confirmation/rating transaction; pre-existing confirmed groups project without resubmission; reverse ingestion and late earlier confirmation converge to chronological oracle; repeated projection appends nothing; claim between groups preserves exact rating sequence with/without claim.

   **Expected file-scope:** `supabase/migrations/*_rating_projection.sql`, `*_rating_activation_backfill.sql`; generated types; `test/player.rating.projection.integration.test.ts`, `player.rating.backfill.integration.test.ts`, `player.rating.races.integration.test.ts`, `player.rating.provisional.integration.test.ts`; existing result confirmation/auto-confirm/race suites; `test/helpers/rating-fixtures.ts`; existing fixture cleanup; `scripts/test-populated-migration-up.mjs` and companion rating predecessor/assertion SQL following current harness convention; harness tests. No application scheduler change unless actual seam inspection proves necessary.

   **Proof/checkpoint:** Real multi-connection races: same confirmation × retries, disjoint communities sharing players, manual vs auto, claim vs first group, backfill vs live confirmation, later group first then older group. Compare full ledger and numeric current state, not only row counts. Test failure injection after calculation/before final state and connection cancellation rollback. Suggested commit: `feat: project and backfill confirmed ratings atomically`.

   **Risk/mitigation:** Rehearse populated upgrade locally before deploy; back up hosted data using existing operator process. Backfill/activation all-or-nothing; monitor duration/lock contention using representative local data. If transaction budget cannot safely cover actual dataset, report evidence as blocker and revise implementation here, not deferred backfill. On production defect disable rating hook/activation via controlled forward migration while preserving confirmed facts and all ledger evidence, then repair/replay through versioned projector. Never drop ledger or reset mu to current values; do not silently restore old code that accepts confirmations without a recorded catch-up path.

5. **U4 — Expose authorized rating summaries, history and explanation contracts.**

   **Description:** Add narrowly scoped sporting-data APIs over committed rating projections, with complete own history and authorized per-group explanations for other players, including provisional identities. Keep all private account/provenance data internal and provide bounded, stable navigation contracts to UI.

   **Dependencies/order:** Depends On U3; U5 depends on U4.

   **Concrete implementation:**
   - Add DTO RPCs for own summary/history, authorized group explanation and community-scoped player sporting view where needed. Owner history crosses communities; non-owner data never exceeds existing result/community rights. Join names/current provisional markers safely without changing owner-only profile table policies.
   - History pagination uses stable `(played_at, game_group_id)` keyset and committed projection revision in cursor. Reject/restart stale-revision pagination rather than mixing old explanations with new summaries. Return explicit empty/unavailable states, never swallow auth errors as empty history.
   - Chart uses server-derived bounded chronological points with explicit range/resolution; recent-event pagination does not pretend to be lifetime progress. Include starting-level baseline and preserve first/last points; disclose an abbreviated range if bounded. No stats/League values are rating inputs.
   - Add typed validators/decoders and handlers in `src/features/player/rating.functions.ts`, reader helpers in `rating.server.ts`; each handler calls `requireAuthenticatedClient`, uses request-local Supabase client and private/no-store. Validate target UUID, group identity, cursor and page bounds.
   - Extend existing player/profile and match result contracts/readers only with safe summary/explanation references. Dashboard initial fetch reads a consistent projection revision; no broad `select *`. Preserve existing profile edit/avatar response contract to avoid losing rating presentation state on saves.

   **Acceptance criteria (testable):** Owner receives own full app-wide history; eligible result viewer receives allowed group explanation for all four players including provisional name/flag; outsider, unrelated community member, anonymous, unclaimed and revoked sessions denied; response/SSR never contains inviter/email/private claim data; page boundaries and concurrent replay cannot mix revisions; empty state distinct from failed load.

   **Expected file-scope:** `supabase/migrations/*_rating_read_projections.sql`; database types; `src/features/player/rating-{contracts,validators,model,server,functions}.ts`; player server/functions where required; matches result decoder/model/functions; `test/player.rating.readers.integration.test.ts`, `player.rating.functions.test.ts`, `player.rating.contracts.test.ts`, dashboard/result fixture updates.

   **Proof/checkpoint:** ACL matrix against both direct SQL/PostgREST and real server handler mocks; deny private cross-community context even with guessed event/player UUID; check response serialized keys and cache headers. Suggested commit: `feat: expose private sporting rating history and explanations`.

6. **U5 — Render rating progression and explainable player changes.**

   **Description:** Replace profile history placeholder with chart/recent events and drill-down explanation, reuse existing current/highest/count/reliability summaries, and add group-specific entry points for authorized result viewers. Match Pencil visual intent while retaining responsive, accessible and translated production behavior.

   **Dependencies/order:** Depends On U4; U6 depends on U5.

   **Concrete implementation:**
   - Inspect Pencil profile/rating/detail frames and token output before styling. Extend dashboard loader/profile; keep route adapter thin. Add focused `RatingProgressChart`, `RatingHistory`, `RatingExplanation` feature components and `rating.styles.ts`, not a charting dependency or generic analytics layer.
   - Use responsive SVG plot with accessible text summary and equivalent event list/table. Include initialized baseline, zero/one-point states, deterministic ordering, visible time range, no fake interpolation promises, 0–7 level axis and localized two-decimal levels/dates/percentages. Meaning must survive color blindness and screen-reader use.
   - Explain stored own/opponent strength, expected outcome, result, reliability BEFORE/AFTER, before/after/delta and versions. Distinguish expected score from guaranteed win chance; include separate zero-rounded, equal draw, boundary clamp and fully established reliability wording. Never recalculate historical explanations from current teammate ratings.
   - Use Base UI for interactive dialog/disclosure if used, ≥44px touch targets, focus restoration, keyboard operation, headings/status/error semantics. Prefer semantic token values then existing primitives; no new hardcoded colors/spacing. Names and translated content may wrap.
   - Results show rating deltas/reliability or accessible explanation action per played participant; provisional name + existing badge pattern everywhere new sporting identity appears. Reserve-not-playing and non-ratable results show no misleading rating change. No adder attribution. Reuse existing result/provisional badges rather than duplicating conventions.
   - Add all U5 copy immediately in en/pt-BR/es (including aria/chart labels, pagination, errors, provenance wording). U6 audits translations and E2E; U5 must not land hardcoded copy or missing locales.
   - Handle retry/load-more/permission loss, dashboard revalidation after rating change, and profile edit/avatar saves without stale rating components. Do not add polling infrastructure absent demonstrated need.

   **Acceptance criteria (testable):** Current/highest/count/reliability agree with one committed projection; chart and history provide accessible progression and explanation; stored numbers match selected event; zero/clamped delta described honestly; all locales render without keys/fallback English; provisional marker visible and no adder identity; mobile/desktop/light/dark match relevant Pencil structure without overflow.

   **Expected file-scope:** `src/features/player/Rating*.tsx`, `rating.styles.ts`, `PlayerProfile.tsx`, `player-ui.styles.ts` as needed; `src/routes/_protected.dashboard.tsx`; `src/features/matches/MatchResultDetail.tsx` and focused result facts/review components/styles; existing `src/components/ui` badge reused; `src/locales/{en,pt-BR,es}/translation.json`; `test/player.rating.ui.test.tsx`, `player.rating.explanation.test.ts`, `player.rating.copy.test.ts`, dashboard/profile/result UI regressions.

   **Proof/checkpoint:** React Testing Library role/name/keyboard assertions; all-locales zero/one/many-point and clamp/draw examples; no design-literal regressions; Pencil structural probes plus screenshots. Suggested commit: `feat: show rating progression and explain player changes`.

7. **U6 — Verify localized rating journeys and complete release gates.**

   **Description:** Complete end-to-end and cross-locale/a11y/visual regression coverage over real confirmation, predecessor projection and provisional claim journeys; reconcile every parent criterion against final evidence. This is required delivery verification, not a future hardening issue.

   **Dependencies/order:** Depends On U1–U5, immediately after U5; final child on same branch.

   **Concrete implementation:**
   - Add E2E fixtures through authoritative initialization/result commands, not UI-only mocked deltas. Reuse existing E2E SQL/cleanup safety conventions; include cleanup for immutable ledgers and retained source rows.
   - Cover manual confirmation → dashboard changed level → history → explanation; automatic confirmation equivalence; refresh/retry no duplicate; friendly/incomplete/pending/disputed/cancelled/reserve exclusions; shared player across communities retains one global state.
   - Provisional participant on either side, creator-estimate initialization visible without adder data, verified claim between two rated groups, zero-history claim edit, rated-history blocked edit, same ID and unchanged past rating evidence; deterministic replay with/without claim.
   - Audit en/pt-BR/es key parity/interpolation/plurals, decimal/date formatting and SSR hydration locale agreement. Check keyboard dialog close/focus, chart text equivalent, mobile touch/overflow, light/dark contrast.
   - Add screenshot references following existing visual tests, using Pencil MCP exports and per-screen justified nonzero tolerances; assert geometry/structure separately. Never widen screenshot budget to hide layout defects.
   - Run full per-unit `pnpm test` as required, E2E exclusively through `pnpm test:e2e` (fresh preview/port cleanup), then final reviewed-state `pnpm complete-check`. Resolve related regressions now; report environment blockers honestly. Do not run DB-resetting suites concurrently against shared local database.

   **Acceptance criteria (testable):** Every AC below has passing named proof; end-to-end new/legacy/provisional journeys pass in required locales; no private fields in browser response/SSR; geometry/accessibility checks and final complete-check pass without threshold changes.

   **Expected file-scope:** `e2e/player-ratings.spec.ts`, `e2e/player-ratings-visual.spec.ts`, narrow existing results/provisional specs and fixture/cleanup helpers; `test/player.rating.copy.test.ts`, locale JSON corrections if audit finds defects; applicable visual references in established repository location. Final findings/log artifacts owned by delivery orchestrator, not this planner.

   **Proof/checkpoint:** Capture actual command/test counts, 31-case kernel report, migration rehearsal output, race evidence, privacy matrix and screenshot tolerances. Suggested commit: `test: verify localized rating and provisional journeys`. Push once only after explicit push/PR approval; no issue IDs in commit subjects/bodies or PR title.

## Validation

- Success criteria: All 13 original/addendum criteria and amendment delivered; deterministic sorted results, one logical group/player event, immutable versioned calculation evidence, correct global state and claim continuity; no required/related open or blocked defect; final-state QA green. No automatic follow-up work.
- Checkpoints:
  - **Step 1 / assumptions:** Verify source fixture count/approval, stable proposal UUID mapping, existing claims/confirmation definitions, real source-data eligibility and token/design availability. If a prerequisite fails, record exact evidence, dependency/unblocking condition and impacted AC; stop affected work and surface caller. Missing runtime tests are not passed tests.
  - **Every U1–U6:** `pnpm typecheck`, `pnpm lint`, explicit affected-file Vitest tests using appropriate unit/integration config during iteration; verify nonzero tests. Regenerate/check DB types after migrations against live local schema. Run full `pnpm test` at each unit completion, sequentially because it resets local development data. Do not weaken coverage thresholds. Commit only that unit’s files after checks.
  - **U3 risk gate:** Populated migration-up twice, separate-connection races and injected rollback; all-four state/event consistency, canonical ordering and full replay equality. No release with only mocked concurrency.
  - **U4/U5 privacy gate:** DTO whitelist and ACL matrix, private/no-store headers, no raw account/adder provenance in API/SSR/HTML, no authorization widening via chart/history.
  - **U5/U6 UI gate:** Correct Pencil structure, responsive/dark/light layout and documented screenshot residuals; keyboard/focus/44px controls, chart textual equivalent; en/pt-BR/es and locale-correct SSR/hydration.
  - **Final:** affected E2E through `pnpm test:e2e`; final reviewed code through `pnpm complete-check`. Record unit/integration/E2E/CI results separately. Preserve six coherent child commits and one PR; related review fixes remain this delivery.

### Acceptance-criterion traceability and required proof

| Criterion | Implementation | Proof of completion |
| --- | --- | --- |
| AC1 First ratable group can change level; team/reliability-specific delta | U2 kernel; U3 transaction; U5 explanation | All 31 fixtures, especially GF-05/06/18/22a/b; first-confirmation DB and browser journey |
| AC2 Reliability formula, 15 groups, 0–7/two decimals | U1 constraints; U2 arithmetic; U5 formatting | GF-07/08/19/20/21/27; count 0/1/14/15/16, clamp and signed-zero tests; locale display assertions |
| AC3 Friendly/incomplete/pending/disputed/cancelled/reserve no effect | U2 eligibility; U3 confirmed source/team mapping; U5 honest status | GF-09–12 plus explicit cancelled/reserve DB regressions; snapshot all state fields and assert zero events |
| AC4 Exactly once, complete explanation and version inputs | U1 unique logical event/immutable calculation; U3 lock/retry; U4 readers | Duplicate and same-group races, rollback, all-four counts, version/frozen-input payload assertions; original revisions unchanged after late replay |
| AC5 Already-confirmed T08 groups initialize deterministically once | U3 activation/backfill | Populated predecessor upgrade, equal timestamp UUID tie, reverse ingestion, second activation no-op, no result resubmission |
| AC6 Authorized chart/history/explanations, Pencil/i18n/privacy | U4 scoped DTO; U5 UI; U6 browser audit | Permission matrix, API/SSR key checks, chart/list/dialog behavior, Pencil structural/screenshot gates, en/pt-BR/es E2E |
| AC7 App-wide state independent of communities/League lifecycle | U1 global UUID key; U2 no League input; U3 cross-community serialization | GF-23a/b; overlapping communities share same row; league metadata absent from formula and schema ownership; no reset hooks introduced |
| AC8 Provisional players rated once normally | U2 no provisional coefficient; U3 group projection | GF-15=GF-06; provisional on either/both teams, once-only count/delta assertions |
| AC9 Creator estimate, creator_estimated provenance, first creator wins | U1 initial audit/provisioning; U3 frozen input | GF-26; repeated add with different estimate no overwrite; original provenance and first-event input asserted |
| AC10 Claim same UUID/ledger and identical rating, no replay solely for claim | U1 claim integration; U3 replay invariant | GF-16a/b; two groups separated by real verified claim, state/event identity/hash unchanged at claim; no added match event/calculation solely for claim |
| AC11 Zero-history claim may ledger initialization edit; later only PAF-17 | U1 common initializer/claim lock/history evidence; U3 concurrency | GF-24/25; initial-audit-only edit, historical confirmed predecessor locks edit, claim-vs-first-group race; normal profile cannot write level; no PAF-17 implementation required |
| AC12 Provisional names/indicator and no adder attribution | U4 DTOs; U5 result/history/explanation/stat-summary display | Badge assertions for all new sporting views, cross-user payload/HTML privacy checks, current marker clears after claim without re-keying history |
| AC13 Either-team provisional, between-group claim, deterministic replay | U2 oracle adapter; U3 fixture/race suites; U6 E2E | Full GF-15/16/24–26, both-side integration cases and exact numeric replay equivalence with/without claim |
| Amendment: creator_estimated, badge results/standings/stats, permanent UUID, edit gate | U1–U6, applied to existing/new sporting surfaces | Provenance/UUID/edit-lock tests plus existing result badge regressions and new rating/stat-summary badges. No standings/stats product currently exists to retrofit; carry safe badge contract without inventing new screens |

### Reporting boundaries

Plan only; no product files changed, no tests executed, no Linear children created by planner. Parent creates proposed six children and owns memory/commit/QA orchestration. No unavailable prerequisite proven; runtime/design access remains preflight verification. Architecture interpretation about immutable calculation revisions is explicit above; any stricter incompatible reading requires caller resolution before code. Unrelated observations and optional optimization ideas are not scheduled and do not become automatic issues.

Plan file: `/Users/trystan2k/Documents/Thiago/Repos/padel-friend/docs/plan/Plan PAF-10 T10 — Apply app-wide rating and explain changes.md`.
