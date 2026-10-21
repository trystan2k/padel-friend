## Task Analysis

- Main objective: Deliver Linear PAF-88 “Follow-up epic 3 — Match contracts and presentation hardening”, PAF-96 first and PAF-85 second, one branch/PR, every child acceptance criterion complete. Planning only; no product edits or execution performed by planner.
- Identified dependencies: Supplied branch feature/PAF-88-match-contracts-presentation-hardening; base origin/main @ d4f2c9bba4337aa8be02945bb36306e77b0de1ad. Executor verifies Git state. Local disposable Supabase/Docker, local-only environment credentials, Chromium, Node >=26 and pnpm >=12 required. Availability not tested by this read-only pass. No blocking issue dependency supplied. Caller-badge snapshot decision binding, not reopened.
- System impact: Two forward migrations; internal read-helper overloads; explicit match creation/list/detail contracts and JSON boundary decoding; honest shared test builders; generic badge tones; intrinsic file-input sizing; focused unit/type/integration/browser regressions. No auth/RLS expansion, no dependencies, no coverage/budget changes.

**Repository evidence**

- Completion-First Policy read in .opencode/agents/delivery-orchestrator.md. Required/related corrections stay in delivery; failed attempts, effort and soft PR-size limits never justify deferral. PAF-92 concurrency/deadlock scope excluded; independent pre-existing failures reported separately, not silently fixed or scheduled.
- package.json has NO Zod, Valibot or other schema-validation dependency. matches.validators.ts and match-registration-model.ts use small handwritten decoders. Reuse that pattern; do not install a library or create a generic validation framework.
- match-model.ts lists mostly optional card properties; matches.functions.ts still returns raw Json creation options, broad MatchEventProjection detail records and weak list type predicates. MatchDetailsForm exports Record<string, any>; CreateMatchPage, MatchReview, MatchInviteePicker use any. Existing partial fixtures cannot define real contracts.
- Generated database.types.ts: match_events.Row has required schema properties with explicit nullable values; search_match_invitees.Returns is { user_id: string; display_name: string }[]. No id/name aliases. JSON RPC return types cannot describe their own payload shape; derive field primitives/nullability from table rows/enums, then explicitly model computed JSON projection keys.
- Current flat detail/list SQL is 20261018073908_match_registration_not_playing_projection.sql. Detail has no as_of. List echoes coalesce(p_as_of, now()) but roster/counts use live helpers. 20261017210000_match_registration_cutoff.sql roster compares cutoff to clock_timestamp() OR any nonnull cutoff_processed_at. Historical snapshots must not be overridden by a marker written later.
- One-argument roster/counts also serve reconcile, submit/decide, processors, notifications, own-registration, request queue and accepted-roster RPCs. Preserve these live paths. 20261018120000_match_registration_accepted_roster.sql is current migration tail.
- StatusBadge tones playing/reserve map directly to style keys. Actual tone callers: MatchRegistrationPanel and MatchRequestQueue. MatchCard uses emphasis without tone; MatchDetailPage has no direct StatusBadge, delegates to panel. NotificationBadge uses count and NotificationsPage summary, neither uses tone. Preserve all appearance semantics and translated domain labels.
- create-match.styles.ts fileInput has only minBlockSize. e2e/matches-visual.spec.ts already has assertNoHorizontalOverflow and a touch-label matrix; 320px explicitly sets assertOverflowFree: false, then temporarily hides file input and gates only the remaining page. Replace exemption, not merely add another passing probe.
- test/matches.registration.schema.integration.test.ts already provides trusted CLI SQL and real JWT users. Extend it for RLS, no broad new harness. Discovery suite asserts exact detail key set: adding detail as_of requires that oracle to change explicitly. Populated upgrade harness discovers migrations dynamically; CI runs it before latest-schema reset.
- tsconfig includes test/**/*.ts and test/**/*.tsx; typecheck is tsc --noEmit. Vitest transpilation alone does not prove type-negative assertions.

**Missing Inputs / Assumptions Made / Targeted Clarifications**

- Missing task/scope inputs: none. Intake is authoritative; no redundant interview needed.
- Assumption: as_of is a temporal classification instant over currently readable event/registration data, NOT historical membership, event edits or lifecycle MVCC reconstruction. Document this limitation. Snapshot fixes must not change visibility/authorization or invent history storage.
- Environment prerequisite unverified, not declared unavailable. Before implementation, caller confirms disposable stack/environment and browser availability. Never reset a shared/remote database. Blocked validation remains incomplete until local environment restored.
- Exact original “Supabase local linter” surface is not configured in package.json or CI. Executor captures/re-runs original security-lint/advisor surface if available; ask caller for invocation if unknown. CLI db lint is supplementary SQL-function lint, not equivalent proof of absence of the RLS security-advisor finding. Catalog regression proves underlying fix regardless; do not claim original linter rerun without evidence. Dependency reference: PAF-96, https://linear.app/trystanworkspace2/issue/PAF-96; unblock linter-specific evidence by supplying/locating original invocation/output.

## Chosen Approach

- Proposed solution:
  - PAF-96: one migration with exactly two ENABLE ROW LEVEL SECURITY statements, no policies/grants/FORCE. Extend existing registration schema suite to prove flags, owner bypass and API denial; existing registration behavior suites unchanged.
  - PAF-85: additive two-argument roster/counts overloads for snapshot projections; retain existing one-argument live helper signatures and definitions. Replace list/detail SQL bodies without changing public RPC argument signatures. Detail captures and reports its own one-time as_of. Explicit contracts + complete typed builders + decoder + consumers land together.
  - Generic StatusBadgeTone = positive | neutral | muted | danger | guest, per requested vocabulary. Domain-to-tone mapping owned by matches, not shared UI. CSS values and translation keys unchanged.
  - Local intrinsic sizing fix on file input, adding ancestor grid shrink constraints only where measured necessary. Real 320px document gate across three locales, unchanged screenshot budgets.
- Justification for simplicity:
  - Reject replacing one-argument SQL functions with defaulted second arguments: risks ambiguous overload resolution, mutation semantics and unnecessary drop/recreate dependency cascades. Explicit overloads avoid all three. Small duplicated roster SELECT is preferable to rewriting live reconciliation; keep ordering/projection parity tested.
  - Reject optionalizing contracts or casting fixtures: repeats two failed attempts. Reject generated-schema rewrite/schema library: JSON payloads need bounded explicit decoders, not new infrastructure. Complete builders absorb test verbosity without weakening production types.
  - Reject overflow:hidden, fixed 320px widths or screenshot tolerance increases: hide defect rather than fix intrinsic sizing. Reject renaming translated playing/reserve labels: domain vocabulary belongs in copy, not primitive tone API.
- Components to be modified/created: Per-unit staging scopes below. Only listed scope-related files; expand list explicitly if compiler/reference inventory proves another related consumer. Never sweep other unit files into first commit.

**PAF-96 file scope — commit 1**

- CREATE supabase/migrations/20261020220000_match_registration_internal_rls.sql.
- MODIFY test/matches.registration.schema.integration.test.ts only.
- No database.types.ts diff expected or necessary. Registration SQL/RPC behavior tests remain unchanged.

**PAF-85 file scope — commit 2**

- CREATE supabase/migrations/20261020220100_match_event_snapshot_projections.sql.
- MODIFY src/lib/supabase/database.types.ts through generator only: additive overload signatures are exposed to type generation even though browser EXECUTE revoked.
- MODIFY src/features/matches/match-model.ts, matches.functions.ts, matches.validators.ts, CreateMatchPage.tsx, MatchDetailsForm.tsx, MatchInviteePicker.tsx, MatchReview.tsx, MatchCard.tsx, MatchDetailPage.tsx, MatchRegistrationPanel.tsx, MatchRequestQueue.tsx, create-match.styles.ts.
- CREATE src/features/matches/match-contracts.ts, match-decoders.ts, match-status-tone.ts.
- MODIFY src/components/ui/StatusBadge.tsx and status-badge.styles.ts.
- CREATE test/helpers/match-fixtures.ts, test/fixtures/match-contracts.types.ts, test/matches.contracts.test.ts, test/matches.decoders.test.ts.
- MODIFY test/matches.model.test.ts, matches.functions.test.ts, matches.validators.test.ts, matches.create.test.tsx, matches.detail.test.tsx, matches.list.test.tsx, matches.registration.panel.test.tsx, matches.registration.roster.test.tsx, matches.registration.queue.test.tsx, matches.styles.test.ts, ui.status-badge.test.tsx, matches.discovery.integration.test.ts.
- e2e/matches-visual.spec.ts: replace 320px exemption with structural regression. e2e/matches.spec.ts only if creation-flow fixture/expectations need migration. test/fixtures/matches-upgrade-assertions.sql: extend existing populated-upgrade assertions for RLS and new helper ACLs.
- Conditional directly related files: src/routes/_protected.matches.$eventId.tsx and test/matches.registration.controller.test.tsx if new detail contract requires adapter/mock annotations; test/matches.registration.cutoff.integration.test.ts only if actual assertions must acknowledge additive detail as_of. Do not change existing behavioral expectations to make regression disappear.
- Existing list route aliases and MatchesPage may keep MatchEventListItem alias without edits. Notification components/copy inspected, no change expected. Locales en/pt-BR/es unchanged unless new user-facing copy genuinely needed; then modify all three translation.json files together.
- Safeguards/read-only: applied migrations; package.json/lockfile; thresholds; comparator/masks/budget tables; frozen reference PNGs; generated routes; unrelated concurrency suites.
- Plan is epic-level durable artifact, staged separately/final sweep per orchestration convention, not counted as PAF-96 implementation. Bundle/diff remain disposable; findings owned by caller.

## Implementation Steps

1. **Preflight — settle evidence and baseline before either unit.**
   - Verify supplied branch/base, clean tree or preserve caller edits; inspect last migration timestamp. Proposed 14-digit UTC timestamps follow repository YYYYMMDDHHMMSS_name.sql convention and sort after existing tail. If executor's real creation time or another migration requires different timestamp, use two actual increasing UTC timestamps and record exact paths before staging; do not use issue identifiers in migration names.
   - Confirm local Supabase via pnpm exec supabase status -o env and credentials using test/helpers/local-supabase-env.ts conventions/.github/workflows/ci.yml provisioning. Do not publish keys or commit .env. Start with pnpm db:start if needed. Capture original RLS linter findings and catalog flags before migration. Confirm CLI lint invocation/help, browser installed and frozen screenshot budgets/coverage thresholds.
   - Baseline pnpm typecheck; pnpm lint; affected unit tests using commands under Validation. Planner has not run these. Report independent baseline issues separately; no automatic new issues/follow-ups.

2. **PAF-96 — forward RLS hardening and regression, two files only.**
   - Create 20261020220000_match_registration_internal_rls.sql with ALTER TABLE public.match_event_registration_state ENABLE ROW LEVEL SECURITY and same for match_event_registration_attempts. Transaction wrapper follows migration style. No grants, policies, FORCE or edits to 20261017173426.
   - Extend test/matches.registration.schema.integration.test.ts with test “enables non-forced RLS on internal registration bookkeeping without API privileges”. Reuse trustedRows/fixtureSql. Assert exactly both relations found, relrowsecurity=true, relforcerowsecurity=false; pg_policies has zero policies for them; owner is trusted postgres; has_table_privilege for anon/authenticated and SELECT/INSERT/UPDATE/DELETE individually false.
   - Also execute each direct operation under SET LOCAL ROLE anon/authenticated in isolated transactions/subtransactions, catch only SQLSTATE 42501, and reset role. Use valid SQL (SELECT, INSERT DEFAULT VALUES, UPDATE SET a=a WHERE false using actual columns, DELETE WHERE false) so syntax/constraint failures cannot masquerade as denial. Use existing helpers/JWT actors for REST-level checks if already covered; no service role browser surface.
   - Apply latest migrations on disposable stack; run targeted integration suites unchanged: registration schema, actions (submit/decide), cutoff, FIFO, publication/schema (creator trigger). Confirm trusted fixture SQL still inserts/updates bookkeeping through owner/SECURITY DEFINER paths. Re-run original security linter; no finding naming either table. pnpm db:types:check should remain green without generated changes.
   - Run fast gate; provide test/assertion output and exact two-file list to caller for first unit commit. Elevated-risk mitigation: if registration paths fail, inspect owners/SECURITY DEFINER/role fixtures; do not add permissive policies, grants or FORCE. Applied production migration never edited/reverted; remediate with forward correction if genuinely necessary.

3. **PAF-85 SQL — add explicit snapshot path; keep live writes intact.**
   - Create 20261020220100_match_event_snapshot_projections.sql in one transaction. Exact shape/order:
     1. CREATE FUNCTION public.match_registration_roster(p_match_event_id uuid, p_as_of timestamptz), same RETURNS TABLE columns/types as existing uuid helper, SQL STABLE SECURITY DEFINER SET search_path=''. No default on second argument. Copy deterministic accepted-order/id ranking; closed classification uses cutoff <= coalesce(p_as_of, now()), or cutoff_processed_at <= that same instant, NOT merely marker IS NOT NULL. Single snapshot CTE computes instant once. Never read stored participation_status to override pre-cutoff snapshot; derive from accepted rank. Equality is closed.
     2. CREATE FUNCTION public.match_registration_counts(p_match_event_id uuid, p_as_of timestamptz), same four integer output columns, no default, SQL STABLE SECURITY DEFINER empty search_path. Aggregate only two-argument roster at same instant.
     3. CREATE OR REPLACE get_match_event(uuid), same jsonb return/signature/security. A MATERIALIZED snapshot CTE SELECT now() AS as_of captures detail read's transaction instant once. All temporal fields, counts and badge call two-argument helpers with that value; add flat required as_of timestamp key. Keep creator precedence, invitation fallback, caller eligibility/context, readability, all prior keys and no forbidden/private fields. Detail does not accept client p_as_of and is not a paginated historical reader.
     4. CREATE OR REPLACE list_match_events(text, uuid, text, integer, timestamptz), same defaults/jsonb SETOF/security. MATERIALIZED snapshot CTE SELECT coalesce(p_as_of,now()) AS as_of. Thread it into eligible rows, both helper calls, caller badge, available/my/past filtering, registration_open, is_past and echoed as_of. Preserve keyset comparator/tie order/cursor microseconds, limit clamping, community scoping and visibility rules. Badge accepted classification must come from snapshot roster, not another live-helper EXISTS; accepted lifecycle check can remain for list membership. Counts/groups/more_needed retain established accepted-count formulas.
     5. Explicit REVOKE ALL on new uuid,timestamptz overloads FROM public,anon,authenticated. Reassert existing one-argument internal helper revocations (no grants). REVOKE ALL on get/list FROM public,anon,authenticated, then GRANT EXECUTE only these public reads TO authenticated. Preserve owner postgres and security/search_path attributes.
   - Drop/recreate decision explicit: NO DROP needed; additive overload signatures and unchanged existing return signatures avoid SQL-language dependent invalidation. Existing uuid roster/counts and every writer/notification/request/accepted-roster dependant remain untouched. Never DROP ... CASCADE. If implementation unexpectedly changes an existing RETURNS TABLE shape, stop and revise back to additive overloads; old cutoff migration's get/list -> counts drop order is not sufficient for today's expanded dependency graph. Do not repeat it.
   - Snapshot means temporal classification of current accepted roster, not historical reconstruction. Due-but-unprocessed and already-processed events must both read consistently; marker written after requested snapshot must not close earlier snapshot.
   - Update test/fixtures/matches-upgrade-assertions.sql with latest RLS flags/new overload ACL checks. Run reset and populated upgrade before generator; run pnpm db:types and pnpm db:types:check, review only generator-produced overload changes. Public JSON contracts remain explicitly modeled outside generator.
   - Mitigation/rollback: transactional DDL rolls back if definition/ACL creation fails; validate locally before deployment. Deploy database before consuming required detail as_of. For post-deploy correction use forward migration; never edit applied history or relax ACLs. Existing one-argument live helpers provide containment if new snapshot path needs correction.

4. **PAF-85 snapshot regression — prove clocks disagree, deterministically.**
   - Extend test/matches.discovery.integration.test.ts, reusing real users/photo/trusted SQL fixtures and unique event IDs. New test “classifies badges and reserve counts at echoed snapshot across cutoff boundaries”. Avoid sleeps, system clock mocks and scheduler races: fix SQL timestamps relative to one captured DB instant, keep fixture setup/assertions transactionally controlled where marker matters.
   - Event with five accepted players, caller fifth and not creator: actual cutoff before DB now, start safely future, request p_as_of before cutoff. Assert list row caller_badge=reserve, reserve_count=1, reserve_not_playing_count=0, playing_count=4, accepted_count=5, registration_open=true, is_past=false, echoed instant equal supplied snapshot. Repeat after persisted cutoff marker with marker later than p_as_of; result unchanged. This prevents marker OR-condition regression.
   - Inverse event: actual cutoff after DB now but requested p_as_of at/after cutoff and before start. Assert reserve_not_playing, reserve=0, not-playing=1, registration_open=false, is_past=false. At start equality assert past=true, correct past-entry inclusion. Full quartet caller remains playing on both sides. Creator remains creator; invited-only caller remains invited. Include empty roster counts and cutoff equality.
   - For detail, capture returned as_of, compare its instant to DB before/after query bounds, then call list_match_events with exactly detail.as_of for same event/caller/current data; compare badge, all four counts, group_count/more_needed, registration_open/is_past and caller context. Due-but-unprocessed detail must be closed; read calls must not mutate marker, participation or notifications. get_match_event has no arbitrary client snapshot input.
   - Update exact expectedDetailKeys for additive as_of, retain forbidden keys and all primitive-flat assertions. Cover omitted/null p_as_of, explicit timestamps, equivalent timezone spellings and existing microsecond page-2 tests unchanged. Verify new overloads forbidden to browser roles while get/list remain authenticated-only.

5. **PAF-85 contracts and builders — establish truthful shapes together.**
   - Create match-contracts.ts. Define explicit MatchCreationOptions, MatchDraft, MatchInvitee, MatchPublishInput, MatchEventCard, MatchEventDetail plus raw RPC detail/list row contracts. Use Pick of Database.public.Tables.match_events.Row for all genuinely projected stored fields, rename id -> event_id and created_by -> creator_id; do NOT intersect entire Row (would wrongly require created_at, published_at, saved_venue_id). Include projected community_id/name, creator_id/name/level, all venue/schedule/type/visibility/team/restriction/payment fields, registration_cutoff_at, court_booked and explicit required computed fields. Nullable values stay required properties, not optional keys.
   - MatchEventCard includes required photo_url:string|null and full present projection fields; no optional count/badge/eligibility/time/venue fields. Raw detail adds required as_of:string and photo_path; raw list adds cursor:string. MatchEventDetail is signed detail with as_of. Keep MatchEventListItem as alias to MatchEventCard for established imports; list envelope keeps as_of:string|null only for truly empty list compatibility. Remove fabricated legacy is_creator/is_accepted/is_invited properties from DTO and card fallback; real SQL emits caller_badge/caller_is_invited.
   - Derive MatchInvitee from generated search_match_invitees.Returns[number], canonical user_id/display_name only. Creation options contain communities id/name/timezone/currency; saved_venues id/name/maps_url/photo_path with schema nullability; level_defaults is null or object with required min/max/level:number|null. Do not infer unsupported extra fields.
   - MatchDraft is explicitly enumerated UI editing state: type/visibility/teamMode enums, currency supported UI choice, field strings (including empty numeric inputs), booleans and nullable/default range fields where needed. Initial blank/default state must satisfy contract. Prefer complete defaults for UI-editable fields; no index signature/any. Review adds explicit formatted cutoffInstant field rather than any. MatchPublishInput models exact SQL input keys, schema-derived field primitives where applicable plus date/start_time, decimal price representation and cutoff_at; separate from row Insert. Preserve public validator's supported omitted SQL defaults with enumerated optional input properties only where SQL really permits omission; UI normalization must prove required publication fields after validation.
   - Create test/helpers/match-fixtures.ts in SAME change: complete deterministic makeMatchRpcDetail, makeMatchRpcListRow, makeMatchCard, makeMatchDetail, makeMatchCreationOptions, makeMatchDraft, makeMatchInvitee and makeMatchPublishInput builders. Literal defaults use satisfies contracts plus declared concrete return types. Nullable keys explicit, valid UUIDs/enums/date/timezone/storage paths, coherent accepted/quartet/count fields. Overrides typed Partial<T> at builder boundary only; output T always complete. Provide count scenario helper deriving accepted/playing/reserve/not-playing/groups/more-needed coherently; never silently override explicitly supplied scenario values. Builders do not call production decoder (avoid circular oracle). No as T/as unknown as T, any, index signatures or mass suppressions.
   - Migrate existing valid fixtures/mocks alongside contract definitions: partial detail/list RPC objects, creation options, id/name invitees, registration panel event fixtures and review props. Preserve each test's scenario and expectations; omitted field test becomes deliberate unknown/raw corruption passed to decoder, not production DTO. test/matches.model.test.ts legacy-count fallback can use an explicitly narrow unknown-count compatibility input, separate from required card contract; never widen card just to keep malformed tests compiling.
   - Highest-uncertainty fallback, same delivery: if change is larger than expected, split local working changes into mechanical phases (builders -> valid fixture conversion -> DTO aliases -> boundary -> consumers), run typecheck after each, keep final unit atomic. Enumerate every compiler error and repair truthful fixture/consumer. If partial legacy count helper useful, define only its narrow compatibility input; do not make card Partial, add broad casts or defer creation/detail. Soft PR-size guidance not a stop condition.

6. **PAF-85 RPC boundary and consumer migration.**
   - Create match-decoders.ts using existing handwritten record/primitive/enum guards. Separate raw decoder from photo decoration: decode Json/unknown options, invitees and raw event/list rows; return newly constructed explicit objects. Validate required presence (null != missing), enums, booleans, finite/safe numeric counts and money, nullable fields, usable schedule/zone values and flat scalar field types. Reuse existing badge parser for documented unknown-badge -> null behavior, but missing required badge property is malformed. Strip unrecognized additive keys rather than spreading arbitrary JSON/private fields into UI. Do not rewrite registration decoders.
   - In matches.functions.ts annotate all server results. Decode creation options before return; canonical invitee rows before return; decode whole list before storage signing. Nonarray/malformed required list payload errors generically rather than masquerading as empty. Preserve valid [] envelope. Preserve existing MATCH_LIST_SNAPSHOT_MISMATCH and microsecond-aware snapshotInstant comparison; valid equivalent timestamp spellings remain accepted, actual mismatch fails. Keep batch path validation, deduping, one RPC + one batch signer, signed URL null fallback. No per-card lookups or unvalidated records surviving weak type predicates.
   - Detail null/[] remains unavailable, RPC/decode failure returns {status:'error'} without SQL diagnostics; valid decoded result signs photo and tolerates storage failure with photo_url=null. Preserve known object/array result normalization only where current tests justify it. No invalid JSON reaching Intl/render.
   - Update matches.validators.ts publication validator with explicit MatchPublishInput parsing and exact known key allowlist, preserving SQL-supported defaults/idempotent photo-retry behavior. Validate shape/primitive constraints at boundary without moving database business/auth rules. Serialize typed JSON without broad Record casts or JSON stringify/parse as a type escape.
   - Replace any/broad props in CreateMatchPage, MatchDetailsForm, MatchInviteePicker, MatchReview and MatchDetailPage. Use keyed field updates <K extends keyof MatchDraft>(key:K,value:MatchDraft[K]) or equivalent small typed adapters; text/select conversion handles finite enum choices, no broad keyed assignment escape. FrozenRequest uses explicit typed publish input; validation/normalization checks strings before publishing, retains lock/frozen retry/race protections and all photo cleanup. Picker canonical user_id/display_name only. MatchCard consumes guaranteed fields/badge. MatchRegistrationPanel must not claim full MatchEventCard from checking event_id alone: use required detail prop or narrow explicit Pick for its counts/registration helpers; remove false type guard. Keep live registration refresh/deadline semantics outside paginated snapshot contract.
   - Unit tests in matches.decoders.test.ts cover every contract's valid/nullable/empty variants; missing required fields, wrong primitives/enum, malformed nested arrays/objects, invalid counts, timestamp/zone and extra-key stripping. Function tests cover failure mapping, no signing malformed rows, batch dedupe, empty list, snapshot microseconds and signing failures. Use raw unknown corruption for negative JSON tests, never dishonest typed builders.
   - Create test/fixtures/match-contracts.types.ts, NOT *.test.ts: exported/consumed type assertion expressions with @ts-expect-error immediately on intentionally invalid assignments (missing required card/nullable key, bad badge/event/team enums, string count, id/name invitee, unknown draft/publish property, wrong option shape). Positive assignments use builders/all contract exports. pnpm typecheck must fail TS2578 if directive becomes unused; tsconfig already includes file, no new tooling needed. Do not rely on Vitest transpilation. test/matches.contracts.test.ts verifies builders fresh nested objects and complete nullable defaults/scenarios at runtime.

7. **PAF-85 presentation tones — feature maps state, primitive maps style.**
   - Export StatusBadgeTone with positive/neutral/muted/danger/guest from StatusBadge.tsx; rename style keys playing -> positive, reserve -> neutral in status-badge.styles.ts without changing token values. Remove unused emphasis style only as bounded cleanup of touched style API; strong appearance behavior unchanged.
   - Create match-status-tone.ts exhaustive maps: playing -> positive; reserve -> neutral; reserve_not_playing -> muted; pending -> neutral; rejected/full -> danger; expired/closed -> muted; creator/invited mappings preserve existing visual intent where actually displayed; guest/source badge remains guest. Map participation/status unions with satisfies Record<... , StatusBadgeTone>, not free string dictionary. MatchRegistrationPanel and MatchRequestQueue own feature call sites, replace literal reserve tone with neutral/map. Keep source badges/caller text intact.
   - Audit every StatusBadge import: MatchCard emphasis remains strong/no tone; MatchDetailPage no direct caller; NotificationBadge count and NotificationsPage summary preserve aria/markup. No playing/reserve tone aliases left in shared UI/tests. Domain matches.badges.*, matchRegistration.* i18n keys remain unchanged across en/pt-BR/es. Guest retained because requested tone set explicitly includes it, despite historical finding's broader wording.
   - Expand ui.status-badge.test.tsx for all five tones, default, emphasis/count/summary attributes; map tests in matches.model.test.ts or matches.contracts.test.ts; panel/roster/queue tests prove translated labels/status precedence. Add negative old tone compile assertion in test/fixtures/match-contracts.types.ts via ComponentProps<typeof StatusBadge> (no JSX needed). Existing registration/notification visual suites prove unchanged appearance.

8. **PAF-85 320px fix — constrain native input, replace known-defect escape.**
   - Modify create-match.styles.ts fileInput: minInlineSize:0, maxInlineSize:'100%', inlineSize:'100%' as needed; preserve existing tokenized minBlockSize >=44px. If parent grid's auto minimum still expands, add minInlineSize:0 to demonstrated grid item/container or minmax(0,1fr) track, not arbitrary global clipping. Zero/percent are intrinsic layout constraints, not hardcoded theme values. Keep native labelled file control, keyboard focus and file upload; no hidden proxy/custom widget.
   - Update test/matches.styles.test.ts for required shrink styles. In e2e/matches-visual.spec.ts remove assertOverflowFree:false and entire hide-file workaround/known-defect assertions. Run existing assertNoHorizontalOverflow on untouched DOM at 320px en/pt-BR/es (light and dark where fixture helper supports matrix), assert file input visible, bounding box within viewport and actual height >=44px. Repeat with long selected filename/upload completion and error/helper state using fixture flow; no document or body scrollWidth > viewport. Retain real translated-label wrap/geometry assertions and attachment evidence.
   - Existing 390px/desktop/create step screenshots and structural probes remain green, no frozen image/budget changes. 320px structural gate is sufficient new oracle; no new screenshot budget needed. Check all wizard steps plus long translated copy where existing flow reaches them. Verify focus/error association and upload action still usable, SSR locale cookie/hydration matches requested locale with no hydration errors. No new copy expected.

9. **PAF-85 fast gate, commit scope and final complete delivery.**
   - Run fast gates plus snapshot integrations after latest reset/generation. Inventory all fixture/type-dependent changes; prove no optionalized card fields, fake type guards, broad assertions or new dependencies. Run scoped fresh-preview E2E/visuals, then hand exact PAF-85 file list to caller for second unit commit. Conventional subjects without issue identifiers; no push/PR in planning.
   - Caller review reconciles every acceptance row below and required/related findings. Unrelated observations stay separate; no automatic issue creation. After all fixes, pnpm complete-check against final code state, unchanged coverage thresholds and visual budgets. Environment-blocked check is blocked, not pass; no acceptance criterion closed on skipped integration/browser tests. One focused PR after caller's separate push/PR approval.

## Validation

- Success criteria: Every matrix row has implementation plus actual passing evidence. Both units delivered; generated types current; local RLS findings removed; all existing required tests pass; final pnpm complete-check green. No source implementation performed during planning.
- Checkpoints:
  - Preimplementation step 1: branch/base, local-only credentials, disposable stack, original lint surface, migration ordering, frozen budgets/coverage confirmed.
  - During PAF-96 step 2: two-file diff, RLS flags/ACLs/direct-operation failures plus unchanged trusted registration behavior.
  - During PAF-85 steps 3–4: SQL migration applies on reset AND populated upgrade; ACL/signature diff reviewed; clock-disagreement tests fail old projection and pass new; mutation tests unchanged.
  - During steps 5–6: required contracts and builders compile together; boundary failures tested before signing/render; type-negative file checked by tsc, not Vitest alone.
  - During steps 7–8: shared tone vocabulary references exhaustively audited; existing appearances/i18n preserved; no 320px exemption/clipping; actual document geometry and upload remain correct.
  - Final step 9: scoped tests/review plus complete-check on final reviewed state. Record commands, pass counts, skip counts and artifacts in caller-owned evidence bundle/findings.

**Acceptance-to-proof matrix**

| Criterion | Steps | Required proof |
| --- | --- | --- |
| PAF-96 forward migration / both RLS true | 2 | New forward-only two-ALTER migration; named registration schema regression asserts both pg_class flags |
| PAF-96 no policies/grants / API CRUD denied | 2 | Diff inspection; zero pg_policies; all eight per-table/role privilege combinations for four operations false; direct SET ROLE operations fail 42501 |
| PAF-96 submit/decide/cutoff/creator trigger unchanged | 2,9 | Existing actions/FIFO/cutoff/schema/publication integration suites pass without weakened expectations |
| PAF-96 regression in existing suite | 2 | New test in matches.registration.schema.integration.test.ts, no new harness |
| PAF-96 local linter findings gone | 1,2 | Captured original security-lint/advisor run after migration has neither table; SQL catalog proof + supplementary db lint; unknown invocation remains explicit evidence blocker |
| PAF-96 complete-check / no threshold/budget changes | 9 | Final complete-check all stages green; safeguards diff unchanged |
| PAF-85 presentation tones / feature mapping | 7 | Exhaustive map tests, five-tone primitive tests, no old shared tone strings; panel/queue/notification appearances unchanged |
| PAF-85 honest builders / required card + creation/detail contracts | 5,6 | Complete builder tests + tsc positive/negative assertions; converted component/function fixtures; all named contracts explicit/schema-derived where valid |
| PAF-85 RPC JSON decoder + type-negative tests | 6 | New decoder suite malformed/nullable/enum/count cases; function failure/signing tests; pnpm typecheck checks included .types.ts directives |
| PAF-85 320px document no overflow | 8 | Real untouched-DOM assertNoHorizontalOverflow, visible file input; en/pt-BR/es, filename/error state; existing screenshot budgets unchanged |
| PAF-85 snapshot decision documented/tested | 3,4 | Binding semantics in this plan + migration comments; before/after/inverse/equality/processed-marker regression; detail/list same-instant agreement |
| PAF-85 complete-check | 9 | All stages final gate green, no skipped required backend/browser evidence |

**Exact validation commands — implementation agents execute, planner did not**

Local stack required for migrations, generated types, integrations, authenticated E2E and full gate. Provision .env from local Supabase status exactly as CI; no production/service-role browser credentials.

~~~sh
pnpm db:start
pnpm exec supabase status -o env
pnpm exec supabase db reset --local
pnpm exec supabase db lint --local --schema public
pnpm db:types:check
~~~

No db:lint package script/CI security-advisor command exists. Original RLS security-linter invocation/output must be supplied/discovered and recorded separately; do not mislabel CLI SQL lint as security-advisor run.

PAF-96 fast/scoped gate:

~~~sh
pnpm typecheck
pnpm lint
pnpm exec vitest run --config vitest.unit.config.ts test/matches.registration.functions.test.ts test/matches.registration.model.test.ts
pnpm exec vitest run --config vitest.integration.config.ts test/matches.registration.schema.integration.test.ts test/matches.registration.actions.integration.test.ts test/matches.registration.fifo.integration.test.ts test/matches.registration.cutoff.integration.test.ts test/matches.schema.integration.test.ts test/matches.publication.integration.test.ts
~~~

PAF-85 migration/type gate after adding overloads:

~~~sh
pnpm exec supabase db reset --local
pnpm db:types
pnpm db:types:check
pnpm exec supabase db lint --local --schema public
pnpm exec vitest run --config vitest.integration.config.ts test/matches.discovery.integration.test.ts test/matches.registration.schema.integration.test.ts test/matches.registration.actions.integration.test.ts test/matches.registration.cutoff.integration.test.ts test/matches.registration.visibility.integration.test.ts
~~~

Populated upgrade command from CI: POPULATED_UPGRADE_OPT_IN=1 node scripts/test-populated-migration-up.mjs under genuine CI disposable local environment (script explicitly refuses non-CI). Do not spoof CI to bypass safety on a personal/shared stack. Existing .github/workflows/ci.yml already runs harness, restores pnpm exec supabase db reset --local, then checks generated types. Require its green evidence; if isolated disposable local CI reproduction available, run same command there. Keep finally/reset restoration even on harness failure.

PAF-85 fast unit/type gate (includes TSX tests; no mistaken ts-only glob):

~~~sh
pnpm typecheck
pnpm lint
pnpm exec vitest run --config vitest.unit.config.ts test/matches.contracts.test.ts test/matches.decoders.test.ts test/matches.model.test.ts test/matches.functions.test.ts test/matches.validators.test.ts test/matches.create.test.tsx test/matches.detail.test.tsx test/matches.list.test.tsx test/matches.registration.panel.test.tsx test/matches.registration.roster.test.tsx test/matches.registration.queue.test.tsx test/matches.registration.controller.test.tsx test/matches.styles.test.ts test/ui.status-badge.test.tsx test/notifications.badge.test.tsx test/notifications.center.test.tsx test/i18n.test.ts
pnpm format:check
~~~

Scoped E2E always fresh preview via package script, never bare Playwright:

~~~sh
pnpm build
pnpm test:e2e e2e/matches-visual.spec.ts e2e/matches.spec.ts e2e/matches-registration-visual.spec.ts e2e/matches-registration.spec.ts e2e/notifications.spec.ts
pnpm complete-check
~~~

complete-check runs db:types:check, build, knip, typecheck, lint, format:check, unit coverage + integration tests, fresh-preview E2E; executes every stage and reports failures. It does NOT start/reset Supabase or replace populated-upgrade/security-linter evidence. No --update-snapshots, screenshot budget increases, coverage exclusions or threshold changes. Scoped Vitest without coverage is fast feedback; only final full gate proves coverage.

**Risks / mitigation / completion conditions**

- Highest uncertainty: truthful schema/fixture migration breadth. Mitigate builders and typed contracts together, complete projected Pick rather than full Row, canonical invitee shape, compile at each local phase. Fallback is staged mechanical conversion within same unit/delivery, never optional fields/casts/deferral.
- Temporal semantics: persisted cutoff marker and live helpers can reintroduce wall clock. Use explicit no-default overloads, marker timestamp comparison, fixed opposite-clock regressions and live-writer suites. Preserve current-data-only snapshot scope; no claim of historical reconstruction.
- SQL dependency/ACL mistakes: additive overload creation order avoids drops; transaction and explicit revocations prevent default PUBLIC execute leak. Generated type check and populated upgrade mandatory; no hand-edit generator output.
- Native file input min-content may propagate through grid tracks. Measure actual box/document, fix smallest intrinsic constraint, keep visible native interaction/touch/focus, no overflow clipping. Existing visual outputs/tolerances remain protected.
- Security-linter surface unspecified; local infrastructure status unknown. Surface missing invocation/environment evidence before implementing validation. Real blocker leaves corresponding AC incomplete until invocation/stack restored; no follow-up substitutes for proof.
- Separate observations: unused emphasis style bounded cleanup permitted in touched file; independent historical ledgers/concurrency defects are not scheduled here. No automatic issue creation. This plan authorizes no product edits by planner, commits, push or PR.
