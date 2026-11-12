## Task Analysis

- Main objective: Deliver PAF-25 approved Units 1–2: optional onboarding avatar, then optional weekday/time-bucket availability in onboarding and profile editing. Unit 3 private contact is explicitly SKIPPED / decision-out (product-owner decision, 2026-11-12), not unfinished implementation scope.
- Identified dependencies:
  - Existing `player-avatars` private bucket, avatar object-key constraints, `completeAvatarUpload`, `verifiedAvatarKey`, `playerInitials`, signed avatar projection, authenticated server-function pattern.
  - Existing direct onboarding and provisional claim RPCs; preserve password continuity, rated-history level locks, invitation return paths, audit, and rating initialization.
  - Local Supabase with current migrations, configured loopback credentials, and browser/test prerequisites for migration application, generated types, integration and E2E. Runtime availability not tested by planner; implementation must verify before DB work.
  - ~~Unresolved prerequisite: Unit 2 AC5 contradicts repository access policy and “no RLS change” constraint.~~ **RESOLVED (orchestrator, 2026-11-12): option (a) selected — AC5 revised to owner-only visibility.** PAF-25 item 2 requests format + onboarding/profile-edit experience only; visibility rules belonged to item 3 (skipped by product owner). No RLS/policy changes; community exposure of availability stays out of scope. See findings ledger `docs/plan/PAF-25-findings.md` F0.
- System impact: Player feature UI/contracts, additive availability migration, generated DB types, three locale catalogs, focused fixtures/tests and onboarding visual gate, explicitly requested design-field documentation. No dependency installation expected. Branch already prepared by caller: `feature/PAF-25-phase-2-player-profile-extras`, base `origin/main` `7ddd72a` (caller-provided; planner made no Git changes).

### Verified repository evidence

- `PlayerOnboarding.tsx`: display name precedes level/side; primary CTA precedes precise-level input and bio. Direct path calls `onboardPlayer`, then `/onboarding/community`; claim path calls `claimProvisionalPlayer`, checks password state, then password step or normalized return path.
- `AvatarUpload.tsx`: browser storage upload followed by `completeAvatarUpload`; currently requires existing profile. `player.functions.ts`: finalize uses verified owner key and compare-and-set previous avatar; never deletes objects because deletion cannot be atomic with profile writes.
- `20261031090000_provisional_player_identity.sql:184–205`: restrictive provisional-actor policies cover public tables **and storage.objects**. A claim session cannot upload before successful claim. This independently rules out upload-before-claim without security-policy expansion.
- `player.server.ts`: `PROFILE_FIELDS` and `sportingProfile` explicitly project fields; both need availability additions. Avatar is returned as signed URL, not object key.
- `20260928000000_player_profiles_and_ratings.sql:53–61`: table SELECT granted to authenticated, but permissive profile SELECT policy is **owner-only**, `auth.uid() = user_id`. Repository-wide policy/profile search found no community-member permissive SELECT policy. Community/security-definer readers expose selected sporting projections, not unrestricted profile rows; table SELECT grant alone does not bypass RLS.
- Latest original onboarding/claim bodies originate in `20261101100000_global_rating_ledger.sql`; `20261101120000_rating_projection.sql` subsequently patches claim lock ordering (`FOR NO KEY UPDATE`, event/community key-share before rating lock). Do not copy the earlier claim body and accidentally undo these fixes.
- Existing unit/server-function harness: `test/player.onboarding-status.test.ts`; validators: `test/player.validators.test.ts`; real backend: `test/player.integration.test.ts`, `test/player.provisional.schema.integration.test.ts`, provisional fixture helpers. UI: `test/player.provisional-claim.test.tsx`, profile fixture consumers including `test/player.profile.rating.test.tsx`.
- E2E: `e2e/onboarding.spec.ts` includes profile edit/avatar regression and locale copy types; `e2e/matches-provisional.spec.ts` covers claim. `e2e/auth-visual.spec.ts` pins player-setup geometry, immutable PAF-1 references/digests, screenshot provenance and nonzero budgets. `test/e2e-png-mask.test.ts` depends on original provenance assets: keep those assets intact.

### Missing Inputs / Assumptions Made / Targeted Clarifications

- Missing Inputs: approved reconciliation of Unit 2 AC5 with owner-only RLS. Issue dependency: [PAF-25](https://linear.app/trystanworkspace2/issue/PAF-25). No separate upstream issue established; do not invent one.
- Assumptions Made: availability consists of two independent preference sets, **not** weekday-specific schedules, exact hours, timezone ranges, or a promise to attend. Partial input (days only / buckets only) is valid. These are implementation semantics for approved format, not additional product features.
- Targeted Clarification to caller: choose either (a) explicitly revise AC5 to retain existing owner-only table access, documenting availability as sporting rather than contact data, or (b) explicitly authorize a bounded community-member sporting read contract/policy plus its privacy tests. Current approved constraints cannot simultaneously promise community visibility and prohibit access-rule changes. Neither choice is silently assumed. If (b), add exact selected read surface, allowed membership states and negative-access cases to this plan before implementation; do not broadly expose all profile/provenance columns.
- Unit 1 can proceed independently. Unit 2 AC5 remains blocked until resolution; neither a report, issue comment nor follow-up ticket satisfies it. All other required/related work stays in this delivery. Unrelated issues and optional enhancements are observations only, not scheduled follow-ups.

## Chosen Approach

- Proposed solution:
  1. **Avatar: select locally; create/claim profile first; upload and finalize second; navigate last.** Lightweight onboarding-only file picker retains a validated `File` and object-URL preview in memory. Submission invokes existing direct/claim function. On success, upload owner-scoped immutable object, call existing authenticated `completeAvatarUpload`, then run unchanged continuation/password logic. No avatar migration, pre-profile upload endpoint, or change to profile-screen upload contract.
  2. **Availability: two nullable `text[]` columns**, `preferred_playing_days` and `preferred_playing_times`. Allowed values `MON,TUE,WED,THU,FRI,SAT,SUN` and `MORNING,AFTERNOON,EVENING`. SQL CHECKs enforce subsets, reject null elements and non-1D arrays, and bound cardinality to 7/3; empty array and NULL mean not provided. Validator deduplicates and canonicalizes to fixed order; writes normalize empty arrays to NULL. Omitted update fields remain unchanged; explicit null/empty clears. No requirement to select both sets.
  3. **Atomic availability onboarding via two thin transactional SQL wrappers**, `onboard_player_with_availability` and `claim_provisional_player_with_availability`, retaining original five arguments and adding two optional `text[]` arguments. SECURITY INVOKER, empty search path, explicit execute grants to authenticated only; wrappers call original authoritative RPC and update only availability for `auth.uid()` in the same transaction. Existing RPCs remain unchanged and callable for compatibility. Server functions switch RPC names and pass availability. This avoids duplicating patched claim/rating logic and avoids partially committed availability on a successful claim.
  4. **Shared small `AvailabilityFields` component** for onboarding extras and profile edit: two labeled fieldsets, weekday and bucket checkbox choices, Base UI Checkbox primitives / existing wrapper conventions, wrapping token-based layout, no custom dropdown. Display selections in profile read mode using translated full weekday/bucket labels in canonical order.
- Justification for simplicity:
  - Avatar alternatives: immediate upload/key staging requires a new finalize contract, creates abandoned-onboarding objects, and fails provisional storage RLS. Sending image bytes in creation RPC/server payload complicates transport/storage rollback. Deferred upload reuses proven verified/CAS finalize and creates no storage objects merely from choosing a file.
  - Avatar UI: directly mounting `AvatarUpload` before profile exists fails; heavily parameterizing that profile-specific widget risks existing behavior. Reuse `playerInitials`, `validateAvatarFile`, styles/copy where appropriate; new local picker plus a narrow storage-upload helper is enough. Keep profile widget unchanged unless extracting a genuinely shared upload-only helper materially avoids duplication.
  - Schema alternatives: composite list loses dimensional separation; JSONB needs more complex shape/value checks and weaker generated types; SQL enums/join tables add migration/type machinery without benefit for two fixed optional sets. Two arrays are typed, compact, independently clearable, CHECK-enforceable.
  - Persistence alternatives: server-side RPC then separate UPDATE cannot roll back a completed claim when availability fails. Replacing RPC signatures/bodies risks rating locks, grants and old callers. Two narrow invoker wrappers retain current behavior and one-transaction guarantees without copying hundreds of lines.
- Components to be modified/created: exact per-unit expected lists below. Prefer roughly 25–35 touched files / ~1,000–1,500 lines; count snapshot binaries separately. These are soft review guidelines, never reasons to drop required tests or blocked criteria.

### Avatar lifecycle and recovery contract

- Selecting/replacing/skipping: validate MIME and 2 MiB limit using existing validator; selection never uploads. Show current-name initials when empty; explicit translated “skip photo” clears selected file, native input value and preview. Revoke object URLs on replacement, skip, unmount. File-picker cancellation does not create an error or lose previously valid choice unnecessarily.
- Submit once: prevent overlapping submissions; freeze profile/availability inputs while saving. Track profile-commit stage independently from avatar stage. Successful claim is never replayed merely because image upload/finalization failed. Preserve existing fail-closed password-state lookup.
- After profile success, upload with `getClaims` owner UUID, random UUID filename and existing MIME extension mapping, `upsert:false`; finalize through `completeAvatarUpload`. Keep returned storage key through finalize retries so one retry does not upload duplicates. Success means finalized key persisted and signed image is visible after navigation/reload.
- Upload/finalize failure: localized alert and two explicit actions, retry photo / continue without photo. Retry resumes only incomplete stage; continue runs original password/community/return continuation without resubmitting profile or claim. Do not silently claim upload success or discard a chosen photo after a failed request. Invalid file never blocks core submit after clearing/skipping it.
- Unknown finalize outcome: re-read authoritative profile before retry; if a signed avatar is already present, use authoritative state and do not overwrite a different concurrent avatar blindly. Preserve CAS conflict behavior, show recoverable error rather than unbounded retry. If key identity is needed, expose a minimal authenticated reconciliation result rather than raw storage listing to UI; tests must prove same-key success versus competing-key conflict. Existing signed URL can be parsed only if stable documented SDK contract exists; otherwise use server-side reconciliation.
- Orphans: no objects created on abandoned pre-submit forms. After upload begins, closed tab/network ambiguity can still orphan an object. Preserve existing no-delete rule; never delete a potentially referenced object on ambiguous failure or skip. Do not introduce GC jobs or promise automatic cleanup in this delivery. This is existing storage-lifecycle policy, not a newly deferred acceptance criterion. All new deterministic failure/retry handling is required now.
- Reload after profile commitment follows existing onboarding route guards; draft File is intentionally memory-only. Do not weaken guards to retain drafts, persist image bytes in localStorage, or replay claim. Profile upload remains available for recovery.

## Implementation Steps

1. **Checkpoint 0 — establish executable baseline and resolve blocking visibility contract.**
   - Confirm caller branch/base and clean/unrelated working changes through Git specialist, not planner. No new branch required.
   - Inspect existing component wrappers and Pencil frame `PdRtP` through Pencil MCP (never native read on `.pen`). Preserve existing visual language; approved new section placement overrides missing Phase-2 elements in historical frame. No `.pen` edit requested.
   - Implementation agent loads relevant React/TypeScript/StyleX/Base UI/Supabase/Playwright skills and modern-web-guidance for file-input previews and grouped checkboxes before UI work. Planner cannot run its shell search under planning-only contract.
   - Verify local Supabase/test environment without recording secrets; reset commands erase shared local dev data and must run serially. Missing runtime prerequisites require concrete diagnostic evidence and unblocking condition, not skipped tests reported as green.
   - **RESOLVED 2026-11-12: option (a) — owner-only access retained, no RLS change; AC5 revised to “availability readable only by owner via existing owner SELECT policy; documented as sporting data whose community exposure is out of PAF-25 scope.”** Recorded in findings ledger F0; Unit 2 unblocked.
   - Expected files: no product changes. Plan/findings artifacts only if orchestrator needs to record resolution.

2. **Unit 1 / A1 — add local avatar selection near identity.**
   - Create `src/features/player/OnboardingAvatar.tsx`: controlled selected-file state or `onFileChange`, `name`, disabled state; local preview and initials; labeled native file input, descriptive help, alert error, keyboard-accessible skip. Avoid nested forms and duplicate IDs; use per-instance IDs where appropriate.
   - Mount immediately after display-name `TextField`, before level card and primary CTA. Name edits update initials/accessible image description. Keep optional bio/precise-level placement and dominant-hand/level semantics untouched.
   - Add narrowly scoped styles to `player-ui.styles.ts` using existing semantic/primitive variables; no arbitrary colors/spacing. File actions/targets >=44px; long translations wrap; no horizontal overflow at 320px or enlarged text.
   - Add `onboarding.avatar*` copy in `src/locales/{en,pt-BR,es}/translation.json`, reusing profile file help/error strings only where accurate. Every status/action/alt/helper is translated.
   - Expected create: `OnboardingAvatar.tsx`; modify: `PlayerOnboarding.tsx`, `player-ui.styles.ts`, three locale JSON files.

3. **Unit 1 / A2 — sequence post-create upload and bounded recovery.**
   - Extract original successful continuation into one local function so normal submit, photo retry success and skip-after-failure share password/community/return behavior exactly.
   - After either server creation path succeeds, call narrow browser upload helper, then `completeAvatarUpload`; no File is passed into existing JSON onboarding validators. Keep `onboardPlayer` / `claimProvisionalPlayer` input unchanged for Unit 1.
   - Create `src/features/player/avatar-upload.ts` only for owner-scoped storage upload (validated File -> object key), if needed to test/reuse network logic without copying complete profile widget. Leave `AvatarUpload` public props and existing finalize authorization/CAS unchanged.
   - Implement lifecycle/recovery contract above, including definitive versus unknown outcomes. If server reconciliation change is necessary, keep it in `completeAvatarUpload` or a narrow authenticated server helper with exact owner/key validation and focused tests; never make finalize require less verification.
   - Existing claim-not-pending / unverified errors preserve their current routing. Direct/claim RPC success must precede storage calls, especially under provisional restrictive RLS. No continuation until finalize success or explicit skip.
   - Expected modify: `PlayerOnboarding.tsx`; optional create `avatar-upload.ts`; optional targeted modify `player.functions.ts` for reconciliation only. Existing `AvatarUpload.tsx` changes only if harmless helper extraction is justified by tests.

4. **Unit 1 / A3 — prove avatar delivery, adapt affected visual gate, commit Unit 1.**
   - Add `test/player.onboarding-avatar.test.tsx` for initials, skip, file validation, object-URL cleanup, selection cancellation, and accessible labeling. Extend `test/player.provisional-claim.test.tsx` (or focused shared onboarding UI tests) for both paths, create-before-upload order, no-upload skip, error retry/continue, single profile/claim commit, password continuation and double-submit suppression.
   - Add helper unit tests if extracted; extend `test/player.onboarding-status.test.ts` / avatar finalize tests for ownership, missing object, unauthenticated, CAS conflict and reconciliation behavior actually changed. Reuse existing UUID/key fixtures; no mock that bypasses real validators.
   - Extend `e2e/onboarding.spec.ts`: selected valid image survives profile reload as signed image; skip/initials succeeds; invalid file can recover; original profile-screen upload/replacement still works. Extend `e2e/matches-provisional.spec.ts` with verified claim + photo and password continuity. Use small existing binary fixture or committed minimal image fixture, not fabricated non-image content.
   - Audit `e2e/auth-visual.spec.ts` player geometry/provenance. Preserve original PAF-1 immutable reference assets and unrelated screens. Replace only obsolete current-player-layout assertions with Phase-2 structural probes and reviewed current-layout snapshot(s), clearly identifying historical reference versus new expected composition; do not rewrite historical digests to bless output. Add player-layout snapshot coverage under existing visual naming/filter conventions. Record new per-screen nonzero tolerances justified by rendering residuals; never widen existing budgets to mask inserted structure.
   - Check avatar identity position before CTA, required inputs unchanged, visible labeled skip, mobile and translated overflow, keyboard/focus and >=44px target geometry. Review screenshots against Pencil tokens/layout intent; only update new snapshots after inspection.
   - Update `docs/design/onboarding-fields.md` Unit-1 inventory/status and P2/checklist only; P3 remains pending this branch until Unit 2. P4 notes 2026-11-12 decision-out; do not claim private-contact delivery or design edits.
   - Validate using Unit-1 commands below. Git specialist commits exact Unit-1 files at unit end: **`feat: add optional avatar selection during onboarding`**. No issue identifier, push, or PR yet.
   - Expected create/modify tests above, `e2e/auth-visual.spec.ts` and new current-player snapshot(s), design-field doc; modify unrelated fixture consumers only if necessary for type/mock parity. Unit 1 requires no migration/types regeneration.

5. **Unit 2 / B1 — additive schema and atomic persistence contracts (after AC5 resolution).**
   - Create `supabase/migrations/20261112090000_player_availability.sql` (increase timestamp if already occupied). Transactional additive nullable columns, default NULL; existing players need no backfill.
   - Named CHECK per array: NULL or bounded one-dimensional subset of typed allowed `text[]`, `array_position(column,NULL) IS NULL`; explicitly allow empty array despite `array_ndims('{}')` returning NULL. CHECK must not accidentally pass invalid shape through SQL three-valued logic. Constraints cover direct authenticated UPDATE too. Canonical dedup is application normalization; SQL duplicates within bounds may be accepted since allowed-value/shape enforcement is requirement, not SQL set uniqueness.
   - `grant update (preferred_playing_days, preferred_playing_times) on public.player_profiles to authenticated`; preserve all existing grants and policies. Assert rating/provenance/timestamp columns remain non-updatable. Do not grant table-wide UPDATE.
   - Add invoker wrappers described above with default nullable array args and same five existing argument names. Validate auth via original RPC and caller server function; UPDATE `WHERE user_id = auth.uid()` with explicit schema qualification. RLS must permit only own post-claim row; require exactly one target row where a write is expected rather than treating zero rows as success. Invalid-array constraint failure rolls back original create/claim, password/audit changes included.
   - Preserve direct onboarding idempotence: acquire same user advisory transaction lock as original before checking whether profile exists; call original RPC for all original integrity/assertion behavior; only apply initial availability when creating a new profile, not on an already-onboarded replay. Claim wrapper calls original claim once, then applies supplied availability in same transaction. Do not add new rating locks or edit original bodies.
   - Revoke wrapper EXECUTE from PUBLIC/anon/service_role and grant authenticated explicitly, following restricted callable RPC conventions. Original RPC names/signatures remain unchanged. Verify PostgREST resolves defaults unambiguously.
   - Apply selected visibility resolution from step 1: **option (a) approved — unchanged owner-only access**. Test unchanged access (owner reads own availability; other authenticated users still denied by owner-only SELECT policy). No new reader/policy work in this delivery.
   - Run `pnpm db:reset`, then `pnpm db:types`, then `pnpm db:types:check`; include generated `src/lib/supabase/database.types.ts`. Never hand-edit generated types.
   - Expected create: migration; modify: generated types. No original migration edits.

6. **Unit 2 / B2 — validators, mapping, authenticated functions and fixtures.**
   - Define canonical weekday/bucket constants and narrow union types in small `src/features/player/player-availability.ts`; shared normalization validates actual arrays, known strings only, shape/length, rejects nested arrays/null elements/non-array/string payloads. Accept null, empty and omissions per chosen contract; reject oversized raw arrays before normalization to align SQL cardinality limits. Deduplicate/order valid arrays and normalize empty to NULL.
   - Extend `OnboardPlayerInput`, `UpdatePlayerProfileInput`, their allowed keys and validators with both optional fields. Preserve unknown-key rejection and partial-update semantics. Keep avatar File out of JSON input.
   - Switch `onboardPlayer` / `claimProvisionalPlayer` to availability wrapper RPCs; pass arrays only when supplied or explicit null to clear where appropriate. Existing `requireAuthenticatedClient`/`getClaims` pattern remains mandatory. Keep claim error mapping and incomplete-state mapping intact. `updateMyPlayerProfile` accepts new validated columns through existing owner UPDATE.
   - Extend `PROFILE_FIELDS` / `sportingProfile` with arrays normalized to typed canonical values or explicit NULL, so UI consumers never need unsafe casts from generated `string[]`. Preserve all existing rating/identity fields and signed URL behavior.
   - Update typed fixture builders/literal profile objects across unit tests and E2E helpers to include nullable availability. Search all `initialProfile`, sporting profile and server-return mocks; change necessary consumers in same unit rather than weakening production types or casting away errors.
   - Expected create: `player-availability.ts`; modify: `player.validators.ts`, `player.functions.ts`, `player.server.ts`, narrowly affected helpers/profile fixtures.

7. **Unit 2 / B3 — shared optional fields and later editing.**
   - Create `AvailabilityFields.tsx`: controlled nullable canonical arrays or UI array drafts, two fieldsets/legends, translated optional help, checkbox names/values, unique IDs and disabled state. Base UI primitives must expose native form/accessible semantics; no hand-rolled listbox, popover, or mandatory validation.
   - In onboarding append availability in trailing optional section adjacent to bio, **after primary CTA and precise-level input**. Keep name/avatar before CTA and required form validation unchanged. Both direct and claim submission payloads include optional availability; defaults NULL.
   - In profile edit initialize draft arrays from profile, allow individual toggle/clear, send explicit NULL on empty, reset draft values from successful authoritative response. Retain drafts on failed/unknown saves consistent with existing profile behavior. Read mode renders translated weekday/time preference groups, with localized not-provided state or omitted empty details consistently; no contact/email exposure. Keep avatar upload section and rating journey untouched.
   - Add all labels/help/empty status/day/bucket copy in all three locale JSON files. Prefer shared `profile.availability*` keys used by both forms. Labels communicate independent preference groups, not paired day-specific appointments.
   - Extend token-based styles; wrap seven day choices on narrow screens rather than shrinking touch targets. Handle en/pt-BR/es, dark mode and enlarged text. All new controls >=44px target; labeled groups, native keyboard Space toggles, visible focus, no color-only state.
   - Expected create: `AvailabilityFields.tsx`; modify: `PlayerOnboarding.tsx`, `PlayerProfile.tsx`, `player-ui.styles.ts`, three locale catalogs.

8. **Unit 2 / B4 — complete regression, docs and final validation; commit Unit 2.**
   - Unit tests: extend `test/player.validators.test.ts` for valid independent/mixed values, omission/null/empty, normalization, invalid enums, null members, nested arrays, oversized values, unknown keys, clear-vs-omit update. Add `test/player.availability.test.tsx` for both labeled checkbox groups, keyboard multi-select, draft clearing, disabled state and translated labels. Extend onboarding/profile UI tests and server harness with wrapper argument/auth/error mapping/projection cases; add tests for any new normalizer/helper.
   - Integration: extend `test/player.integration.test.ts` or add focused `test/player.availability.integration.test.ts`, reusing local-only clients. Prove migration constraints through raw writes; owner UPDATE granted; another user/anonymous/provisional access denied; original protected columns denied; original RPC backward compatibility; wrappers with/without/partial availability; direct replay does not overwrite saved availability; failed constraints roll back profile/rating/claim state. Reuse `test/helpers/provisional-player-fixtures.ts` for claim parity and rated-history/password/audit regression rather than new insecure fixtures.
   - Visibility test must prove **approved revised AC5 (option a)**: owner reads own availability through unchanged owner-only SELECT policy; a second authenticated player still gets zero rows / denied access on the same table; no RLS or storage-policy diffs appear in the migration. No community-reader work.
   - E2E: extend onboarding spec for multi-day and multi-bucket create -> reload -> edit -> clear, independent sets, and omitted availability success. Extend provisional claim scenario to persist both dimensions and retain locked-level/password behavior. Test localized group labels and no overflow across en/pt-BR/es, mobile/desktop, light/dark. Update affected current-layout structural/visual assertions, not historical source images. Use accessible group/label locators, not brittle nth-input selectors or fixed sleeps.
   - Finish `docs/design/onboarding-fields.md`: top status, inventory columns, current capture/edit sections, P2/P3 DONE with actual values/storage/placement/visibility, grant rule, §7 checklist. Separate design decisions from actual Pen edits; never check off a Pen edit not performed. P4 **SKIPPED / decision-out 2026-11-12**; strike/annotate its old actionable checklist rather than mark contact schema implemented. Orchestrator records decision-out on Linear PAF-25 later; planner/implementation does not change Linear.
   - Run Unit-2/final gate once for final code state as below; fix all required/related failures and re-run only failing suites after corrections. Git specialist commits Unit 2 at its end: **`feat: add optional player availability preferences`**, including migration/types, UI/server/fixtures/tests and final design-field doc. No separate docs commit needed. Unit-2 changes to files already touched in Unit 1 belong in second commit, not amended into first.
   - Expected tests/docs: listed existing/new files, new Phase-2 snapshots as justified, existing fixture files requiring type parity. Do not opportunistically restructure unrelated tests/features.

## Validation

- Success criteria: Every mapped criterion below has implementation and recorded proof; both units committed separately; no private-contact implementation; full final gate green; unresolved visibility prerequisite prevents full-completion claim. Plan creation itself executes no tests and claims no gates passed.
- Checkpoints:
  - **Before implementation:** checkpoint 0 access-policy reconciliation, local services/env, original claim locks, component/design conventions and visual reference strategy verified.
  - **During Unit 1:** file selection causes zero storage calls; both paths commit before upload; finalize enforces auth/owner/existence/CAS; retry never reclaims; skip always provides continuation.
  - **During Unit 2:** migrated columns/grants, generated type parity, transactional rollback, partial-update semantics, fixture completeness, placement and selected visibility contract verified.
  - **After implementation:** final gate, a11y/i18n/visual evidence, docs/commit boundaries and diff review. Missing or skipped required integration/E2E coverage is not success.

### Acceptance-criterion traceability

| Criterion | Steps | Proof of completion |
| --- | --- | --- |
| Avatar AC1 optional near identity, initials + explicit skip | A1–A3 | UI test + DOM order probes + E2E skip/initials; no-file success |
| Avatar AC2 valid persisted key, signed profile image | A2–A3 | Real storage/finalize E2E + profile reload; owner/key/existence validator tests |
| Avatar AC3 direct and claim parity | A2–A3 | Both creation-before-upload UI tests, direct and verified-claim E2E, password continuation |
| Avatar AC4 profile-screen upload unchanged | A2–A3 | Existing profile upload/replacement E2E and CAS regression tests |
| Avatar AC5 locales and accessible file actions | A1, A3 | All three catalogs, label/keyboard/error tests, >=44px geometry, mobile/locale review |
| Avatar AC6 unit + E2E | A3 | Unit-1 suite records and final gate; tests cover new helper/handler behavior |
| Availability AC1 storage/check/grant/types | B1, B4 | db reset/types check + raw-write constraint/grant integration cases |
| Availability AC2 optional trailing onboarding | B3–B4 | DOM order after CTA, omission/empty E2E, no required availability controls |
| Availability AC3 later profile edit | B3–B4 | Multi-select edit/reload/clear E2E + profile draft UI test |
| Availability AC4 auth/validators/mapping | B2, B4 | Real-validator server harness tests, getClaims failure, returned fields, rollback integration |
| Availability AC5 visibility — revised: owner-only per option (a), no RLS change | 0, B1, B4 | Integration proof: owner reads own availability; second authenticated user denied; migration diff contains no policy changes |
| Availability AC6 locales and accessible groups | B3–B4 | en/pt-BR/es group/label assertions, keyboard checkbox operation, >=44px/focus/overflow probes |
| Availability AC7 regression/full gates | B4 | Final complete-check report; affected E2E + full suites run in chosen nonduplicative lane |
| Cross-cutting design doc/P2/P3/§7 + contact decision-out | A3, B4 | Doc diff reflects actual delivered state; orchestrator confirms later Linear decision note |
| Cross-cutting one commit per unit; reasonable diff | A3, B4 | Two conventional commits without identifiers; scoped diff inspection |

### Exact commands and single-run scheduling

All test commands: explicit shell timeout **1800000 ms**; `pnpm complete-check`: **3600000 ms**. DB-touching gates execute serially. Timeout termination is not a failed assertion; rerun with larger ceiling. Never call bare Playwright; paths follow `pnpm test:e2e` **without `--`**. Do not lower coverage thresholds.

**Unit 1 committed state (before starting Unit 2):**

1. `pnpm typecheck`
2. `pnpm lint`
3. `pnpm format:check`
4. `pnpm test` — one full unit-with-coverage + reset/integration run for Unit-1 state; includes new tests. Do not first run targeted unit/integration then repeat green full suites on same state.
5. `pnpm test:e2e e2e/onboarding.spec.ts e2e/matches-provisional.spec.ts e2e/auth-visual.spec.ts` — one affected E2E lane on Unit-1 state, fresh preview/reset. Other affected specs found by actual dependency audit join this single command before running. Full E2E is reserved for different final Unit-2 state.
6. Commit Unit 1. Precommit static checks are hook-owned; do not manually rerun already-green suites as reassurance.

**Unit 2 schema preparation (before final test gate):**

1. `pnpm db:reset` — after local stack readiness; coordinate destructive reset.
2. `pnpm db:types`
3. `pnpm db:types:check`
4. Static iteration if needed: `pnpm typecheck`, `pnpm lint`, `pnpm format:check` (format changed files using repo formatter before verification; no fix flags in gate).

**Final Unit-2/delivery state:**

- `pnpm complete-check` **once**: static + full unit/coverage + integration + full E2E, one build reused according to existing script. Do not run `pnpm test:unit`, `pnpm test`, targeted E2E, or full `pnpm test:e2e` first on the same final state; those phases are already inside complete-check.
- If final gate fails: inspect logs/error contexts before rerun, correct required/related defect, rerun failing suite once for corrected state. If a correction invalidates other phase evidence, run only newly invalidated phases; coordinate gate phase selection with QA specialist rather than repeating already-green suites. Review-only changes to docs do not justify repeating green test suites.
- During earlier genuinely changing iteration states, optional targeted unit lane: `pnpm exec vitest related --run --config vitest.unit.config.ts <touched production paths>` with 1800000ms. Use it **instead of**, not before, full lane on same state. `test:changed` diffs only HEAD and may run zero tests; not standalone proof.
- If diagnosing a specific integration phase on corrected state: `pnpm db:reset` then `INTEGRATION_PHASE=serial pnpm test:integration` (or audited parallel phase as appropriate), serial with all other DB gates. Do not add new destructive fixtures to parallel partition without audit.
- Pre-push unit hook is repository-mandated and distinct from agent scheduling; Git specialist owns it. Push once only after user's explicit push/PR approval; no planner Git/Linear operations.

### Risks, mitigations, rollback

| Risk | Required mitigation / rollback |
| --- | --- |
| False community-visibility premise | Stop Unit 2 at checkpoint 0; obtain explicit revised AC or authorized read contract. No silent privacy expansion and no automatic follow-up. |
| Claim storage denied before claim | Upload only after successful claim, prove with real provisional fixture. Never relax restrictive storage/public policies. |
| Claim success followed by upload failure replays destructive claim | Track committed stage, retry only upload/finalize, explicit skip continuation; password step unchanged. |
| Orphan or concurrent avatar deletion | Defer storage until submit; reuse key on retry; never delete on ambiguous outcome; preserve CAS and reconciliation tests. |
| Wrapper update silently affects zero rows / partial claim | Same transaction, invoker RLS, exact affected-row assertion, rollback integration including password/audit state. |
| Existing direct onboarding idempotence changes | Wrapper takes original user lock, preserves already-onboarded state; test old RPC and new wrapper replay. |
| Claim lock/rating logic regresses | Wrappers delegate to current original RPCs; never rewrite historical function body or move its locks. |
| SQL CHECK accepts invalid arrays through NULL logic | Explicit empty/NULL handling, null-member/shape/cardinality checks, direct SQL negative tests. |
| Grant/types omission | Narrow grant integration and generated-type check against migrated DB before UI finalization. |
| Changed profile shape breaks distant mocks | Search all profile return consumers; update typed fixture builders/literals, no `as any` workaround. |
| Visual baseline hides layout regressions | Structural probes first; preserve historical provenance; review new screenshot evidence and document tolerances, no blanket budget increases. |
| Additive migration deploy compatibility | Apply migration before new app; retain original RPCs. On rollback revert app to prior version, leave harmless nullable columns/wrappers; do not drop data or rewrite migration history. If DB fix needed use forward migration. |

### Explicit non-changes

- No private contact, phone, email/profile contact copying, visibility controls or contact migration. Unit 3 skipped by user, not a deferred implementation obligation.
- No dominant-hand, bio-limit/behavior, required name/side validation, initial-level/rating logic, claim mailbox proof/password security, return-path changes, or service-worker/cache changes.
- No RLS/storage-policy changes under current authorization. AC5 conflict is explicit blocker; only approved reconciliation may change that rule.
- No GC scheduler, avatar cropper/compression dependency, day-specific scheduling, timezones, exact-hour ranges, public profile directory, or unrelated architecture/test cleanup.
- No production edits or tests executed by planner. Sole new artifact: this plan.
