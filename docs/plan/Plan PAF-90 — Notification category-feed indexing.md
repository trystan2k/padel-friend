## Task Analysis

- Main objective: Deliver PAF-90, “Follow-up epic 5 — Notification category-feed indexing”, through its single unit PAF-70, “T03 follow-up — notification category-feed composite index”. Add category-feed index, prove filtered-query benefit and behavior, regenerate/check database types, pass full gate. One focused PR; exactly one commit.
- Identified dependencies:
  - No blocking issue dependency. PAF-3 supplies origin context, not prerequisite work.
  - Runtime verification requires Docker daemon, installed repo dependencies, local Supabase, current migrations, loopback API credentials, and local SQL access. Planning session inspected files only; Docker/database availability NOT verified. No claimed EXPLAIN, test, or generation result.
  - Implementation must check these prerequisites before changes. Missing Docker/local DB blocks types generation and required runtime validation; capture command/error evidence, report caller immediately, unblock by starting/provisioning local Docker Supabase. No automatic follow-up or completion claim for blocked criteria.
  - PAF-91 invitee fixture work explicitly OUT OF SCOPE. No invitation-fixture extraction, broad test-reliability changes, or separate reliability PR mixed into this delivery.
- System impact:
  - One additional B-tree on public.notifications; no data rewrite, RPC/API/schema-contract/auth/RLS/UI behavior change. Additional storage and insert/delete maintenance; existing unread and unfiltered-feed indexes retained.
  - Branch supplied: feature/PAF-90-follow-up-epic-5-notification-category-feed-indexing; base origin/main at 6a2aaa1132c7fbaf4a8f2f7cc8c9faef33941d8b. Verify branch and worktree before implementation; do not recreate branch.
  - Research: notifications.functions.ts selects id,kind,category,target_type,target_id,community_id,created_at,read_at; created_at <= database asOf; optional category equality; optional cursor OR(created_at < cursor time, created_at = cursor time AND id < cursor id); ORDER BY created_at DESC, id DESC; LIMIT requested limit + 1. Recipient equality is supplied by notifications_read RLS: recipient_user_id = (select auth.uid()), authenticated nonanonymous user. Feed includes read AND unread rows.
  - count_my_unread_notifications() remains original definition in 20261015180000_notifications_store.sql: security-definer, authenticated/nonanonymous guard, count(*) WHERE recipient_user_id = (select auth.uid()) AND read_at IS NULL. NO category predicate, cutoff, cursor, or ORDER BY. Both listMyNotifications and getMyUnreadNotificationCount call this whole-store RPC without arguments.

## Chosen Approach

- Proposed solution: Add supabase/migrations/20261021180000_notifications_category_feed_index.sql, preserve historical migrations and production source, extend existing focused tests, validate real DB plans and behavior.
- Justification for simplicity:
  - Option A selected: one complete category-feed index. Equality prefix scopes recipient/category before ordered timestamp/UUID scan; page limit can stop within category rather than discard recipient history.
  - Option B rejected: add unread-category partial index too. Existing notifications_recipient_unread_idx already has recipient equality prefix and WHERE read_at IS NULL. Actual count has no category restriction; wider category-bearing unread index offers no additional selectivity or count coverage and adds storage/write costs. This is predicate-based evidence, not invented benchmark results. Compare actual existing count plan in step 4; do not add partial variant speculatively.
  - Option C rejected: feed/RPC rewrite, explicit recipient API parameter, covering INCLUDE index, or replacement of existing indexes. Existing query and RLS already match; no supporting production change necessary. Keep all-category feed optimized by its current index.
  - Equality keys use default ASC; direction irrelevant for equality matching. created_at DESC, id DESC exactly match ordering and stable descending keyset tie-break. Both columns NOT NULL, so NULL ordering introduces no mismatch. UUID id prevents duplicate/omitted equal-timestamp rows across pages.
- Components to be modified/created:
  - New migration above. Fourteen-digit UTC-style timestamp + snake_case name matches repository; no 20261021 migration found during planning. Recheck filename collision/later migrations before implementation.
  - test/notifications.functions.test.ts: add focused query-contract assertion, reusing current fluent mock.
  - test/notifications.store.integration.test.ts: add real authenticated category/ordering/cursor regression and catalog assertion, reusing actor/sql/literal helpers.
  - This plan and existing delivery findings record hold validation evidence; no new permanent benchmark subsystem/document needed.
  - src/lib/supabase/database.types.ts: regenerate, expect NO content change. Indexes are not generated TS contracts. Commit only genuine explained schema-related differences, never manufacture a types diff.
  - No src/features, src/routes, locales, tokens, UI, package or lockfile changes expected.

## Implementation Steps

1. Establish preconditions and baseline.
   - Confirm supplied branch/base and scoped clean state; preserve unrelated work. Read AGENTS.md and Completion-First Policy; required/related findings stay in this delivery. Report unrelated pre-existing failures separately, never schedule automatic issues.
   - Check installed Supabase CLI version/help for local status, migration up, db query, and migration list commands; use repo-pinned CLI through pnpm exec. Check Docker daemon, run pnpm db:start if needed, verify local API port 55321 / DB 55322 per supabase/config.toml, populate loopback VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY from local status without committing secrets.
   - Apply existing migrations locally using verified local migration-up command. Prefer non-destructive upgrade; pnpm db:reset only on disposable local data with explicit acknowledgement of data loss. Never reset/push a remote database.
   - Record baseline targeted tests and plans before new index (step 4 describes identical dataset/probes). Discover any drift or skipped real-DB tests now. No environment skips count as verification.

2. Add exactly this migration; no historical edits or partial unread variant.

   File: supabase/migrations/20261021180000_notifications_category_feed_index.sql

   Full SQL:

   ~~~sql
   begin;

   -- Scope category feeds before scanning their descending cursor order.
   create index notifications_recipient_category_created_idx
     on public.notifications (recipient_user_id, category, created_at desc, id desc);

   -- Whole-store unread counts already use notifications_recipient_unread_idx.

   commit;
   ~~~

   - Follow lowercase SQL, short -- rationale comments, explicit transaction used by recent additive migrations 20261017210000_match_registration_cutoff.sql and 20261020220000_match_registration_internal_rls.sql. The scheduler migration uses IF NOT EXISTS for conditional extension setup; existing index declarations do NOT use IF NOT EXISTS. Follow plain CREATE INDEX: migration history ensures one application and a duplicate name must expose drift rather than silently accept wrong definition.
   - Default B-tree; no CONCURRENTLY inside transaction. Check production table size/write traffic and deploy window first: ordinary CREATE INDEX blocks writes while building. If measured size/traffic makes lock unacceptable, stop and return deployment-strategy decision to caller; concurrent build needs different nontransactional migration/error-recovery handling, not an unreviewed SQL substitution.
   - Apply additive migration to local pre-existing database, inspect pg_index validity and pg_indexes definition; confirm old indexes remain. Also exercise fresh local migration replay on disposable DB if available, with data-loss acknowledgement.

3. Fill focused regression gaps without unrelated reliability work.
   - Unit contract test: invoke listMyNotifications with category community and cursor; assert .eq('category','community'), database-clock .lte, both descending .order calls in sequence, exact cursor OR, limit + 1, whole-store count RPC with no category arguments. Assert all-category call omits category equality. Reuse current mock; mocked rows are NOT proof of SQL filtering or index use.
   - Real local DB test in notification store suite: reuse actor() for recipient and outsider; privileged SQL inserts only notification fixtures, with unique event keys and tracked IDs, valid categories and arbitrary target UUIDs. No invitation/community-membership setup needed. Keep fixture builder local; do not extract invitee fixtures or change shared harness.
   - Seed recipient community rows: newer timestamp, two equal-timestamp UUIDs with known descending order, older timestamp; mix read/unread. Add recipient matches row, outsider community row, and future recipient community row beyond fixed asOf. Set timestamps explicitly in SQL; no sleeps, locale-based sorting, or clock races.
   - Query authenticated recipient using production selected columns, category equality, fixed .lte(asOf), descending timestamp/id order, limit + 1. Verify exact expected IDs, only selected category and recipient, both read/unread present, outsider and future rows absent. For continuation use production OR cursor; verify equal-timestamp boundary yields next UUID in descending order with no duplicates/missing rows. Empty category returns []; all-category query retains expected rows.
   - Assert unread RPC includes unread items from OTHER categories, excludes read/outsider rows, preserving whole-store semantics. Existing read/mark-all/idempotency tests remain unchanged.
   - Add small catalog assertion through existing SQL helper: index exists on public.notifications, valid/nonpartial, exact four-key ordering; old unread index remains. Assert structure rather than brittle full SQL formatting or elapsed time. No forced optimizer-node assertion in small-fixture CI tests.
   - Cleanup fixture notifications and auth users in finally, reusing current suite ownership patterns. Avoid SQL changes to unrelated rows. Performance bulk fixture is separate from regular regression suite.

4. Prove representative query plans; document evidence and limitations.
   - On disposable local DB, create two test actors using existing suite's signup/onboard pattern, record recipient UUIDs. Seed approximately 100,000 notifications for first recipient plus 10,000 outsider rows via generate_series and privileged SQL. Use unique event keys, valid kind/target_type, UUID targets, explicit created_at descending across history; make community sparse (about 0.1%, skewed toward older history), matches common, rankings empty. Mix read/unread independently. Record exact distribution/row counts; use same rows, cutoffs, JWT and session settings before/after index.
   - ANALYZE public.notifications after bulk insertion; capture baseline before applying step 2 and repeat after. Do not benchmark production or run concurrent bulk fixtures against normal test suites.
   - Execute as authenticated with transaction-local request.jwt.claims containing sub=fixture recipient, role=authenticated, is_anonymous=false; SET LOCAL ROLE authenticated. Verify auth.uid() is correct. Use literal fixture timestamps and UUIDs below in actual evidence. First-page production-shaped SQL (no extra recipient equality: exercise RLS):

     ~~~sql
     explain (analyze, buffers)
     select id, kind, category, target_type, target_id, community_id, created_at, read_at
     from public.notifications
     where category = 'community'
       and created_at <= '2026-10-21T12:00:00Z'::timestamptz
     order by created_at desc, id desc
     limit 21;
     ~~~

   - Repeat with rankings for empty category, common matches, and all-category query without category predicate. Repeat sparse category with exact production cursor disjunction below, substituting a real first-page boundary:

     ~~~sql
     and (
       created_at < '<cursor-created-at>'::timestamptz
       or (created_at = '<cursor-created-at>'::timestamptz and id < '<cursor-id>'::uuid)
     )
     ~~~

   - Compare Index Cond, Filter, Rows Removed by Filter, Sort nodes, actual rows, buffer hits/reads, execution time and plan shape. Expected selective/empty feed uses notifications_recipient_category_created_idx with recipient/category in index conditions, ordered scan without broad history filtering or explicit sort; returned IDs identical before/after. Cursor OR can remain residual filter: report actual behavior, do not claim tuple-seek efficiency not demonstrated. Inspect deeper-page case for regressions.
   - Planner may choose seq scan for tiny tables/common categories. This is not failure by itself. Use realistic analyzed selective fixture to show natural index selection; never present enable_seqscan=off or a tiny-fixture assertion as proof of actual benefit. If sparse/empty fixture still scans broad history, inspect stats/RLS/casts and resolve within scope before declaring success.
   - Count evaluation: under same JWT, EXPLAIN the RPC's underlying SELECT count(*) FROM public.notifications n WHERE n.recipient_user_id = (select auth.uid()) AND n.read_at IS NULL, plus invoke actual count_my_unread_notifications() for result correctness. Explain count body under local privileged role with same claims to reflect security-definer execution; explaining only outer function call hides internal plan. Record whether existing unread index is chosen and buffers/rows. No category predicate exists; no category-partial index added. Do not promise index-only scans: visibility map/heap fetches and statistics affect plan choice.
   - Record index size with pg_relation_size/pg_size_pretty and row distribution; distinguish cold/warm cache, avoid fixed latency assertions. Remove only tracked performance fixtures, ANALYZE again.
   - If local DB unavailable: static predicate/index comparison, catalog migration review, unit tests and CI DB execution are alternative interim evidence only. Record missing EXPLAIN as unverified, not index-use proof; types/integration/full-gate criteria remain blocked until functioning local Supabase or equivalent approved CI runner executes required commands. Surface exact failure and Docker/local-service unblocking condition to caller; no automatic deferral.

5. Regenerate types and run scoped correctness checks.
   - Run pnpm db:types AFTER applying migration. scripts/db-types.mjs runs pnpm exec supabase gen types typescript --local --schema public,storage,graphql_public, formats scratch output with generated-file override, then atomically replaces database.types.ts. Requires local Docker Supabase, not hosted credentials.
   - Inspect generated-file diff: expected empty because only index metadata changed. If unexpected diff occurs, diagnose CLI/schema baseline drift; do not hide it or commit unrelated contract changes without explanation. Then pnpm db:types:check; its generated candidate must byte-match tracked file.
   - Run pnpm exec vitest run --config vitest.unit.config.ts test/notifications.functions.test.ts.
   - Run pnpm exec vitest run --config vitest.integration.config.ts test/notifications.store.integration.test.ts. Require actual executed tests, not describe.skipIf caused by absent loopback credentials. Integration file parallelism remains disabled per existing config.
   - Run pnpm typecheck and pnpm lint; fix required/related defects. No new packages or threshold changes.

6. Complete final gate, review, and single-commit handoff.
   - Run pnpm complete-check on final state. It executes db:types:check, build, knip, typecheck, lint, format:check, unit+integration test, and test:e2e and reports every stage; capture all results. E2E always through pnpm test:e2e (also inside full gate), never bare playwright test, ensuring fresh preview port 4173. Existing e2e/notifications.spec.ts remains regression coverage; no new screenshot baselines or tolerances.
   - Index-only change needs no new accessibility/i18n implementation; no visible copy or UI changed. Existing notification UI/locale/accessibility/visual checks must remain green, with unchanged coverage thresholds and screenshot budgets.
   - Code + architecture review required for migration; UX review unnecessary unless unexpected UI changes enter scope. Fix required/related review findings here, rerun affected checks and final full gate after edits. Capture AC evidence and unrelated observations separately in delivery record.
   - Exactly ONE commit for this unit, including migration, focused tests, requested plan and applicable durable review record. No separate documentation/test commit. Commit message: perf: index notification category feeds. No Linear identifier anywhere in subject OR body; omit body unless needed. Amend that single commit for corrections instead of introducing extra unit/review commits; caller must reconcile any orchestration default that would add commits. Inspect final staged scope; never include secrets, bundle/exported diff, or unrelated files.
   - One focused PR targeting main, after caller obtains required push/PR approval. Suggested title: perf: index notification category feeds. Link issues in PR description per explicit intake/repository convention, not title/commit. Request Copilot review; report pending review honestly. No merge without explicit user request.

## Validation

- Success criteria:

  | Criterion | Implementation | Proof of completion |
  | --- | --- | --- |
  | PAF-70 additive recipient/category ordered index | Step 2 | New timestamped migration only; applied catalog shows valid nonpartial B-tree (recipient_user_id, category, created_at DESC, id DESC); old migration/indexes unchanged |
  | Evaluate unread partial index only for actual RPC benefit | Research + steps 2, 4 | Actual RPC WHERE recipient equality AND read_at IS NULL documented; no category/order; existing matching unread index and representative count-body plan recorded; category-partial variant deliberately skipped |
  | Representative filtered query plan validated | Steps 1, 4 | Before/after EXPLAIN ANALYZE BUFFERS for sparse/empty authenticated-RLS feed, cutoff and cursor; natural category-index use on selective dataset; identical result IDs; count/all-category regression observations |
  | Existing notification behavior preserved | Steps 3, 5, 6 | Unit query-contract assertions + real recipient/category/order/cursor/read-state tests execute successfully; existing notification store/other integration/E2E suites pass |
  | db:types and db:types:check pass | Step 5 | Both zero exit; generation follows applied migration; expected empty database.types.ts diff explained |
  | complete-check passes, no weakened gates | Step 6 | All eight stages green on final code; coverage thresholds, screenshot budgets and baselines unchanged |
  | PAF-90 one focused PR and scoped delivery | Step 6 | Exactly one commit; one PR containing only PAF-70 delivery/supporting tests/docs; no PAF-91 or unrelated reliability work |

- Checkpoints:
  - Before implementation (step 1): caller has branch/precondition status and any blocker evidence. Approval needed only for genuine scope/deployment ambiguity, destructive reset, or push/PR; planning does not implement or certify runtime availability.
  - During implementation (steps 2–4): verify catalog before behavior tests; tests prove semantics, EXPLAIN proves performance separately. No mocked/query-string assertion substitutes for real query-plan benefit.
  - Post-implementation (steps 5–6): attach command statuses, executed/skipped counts, index definition/size, fixture distribution, before/after plans, unchanged-type evidence, final gate and review disposition to delivery record. Required blocked criteria remain incomplete absent explicitly approved revised scope.
  - Risks/mitigation: additional index consumes disk/cache/WAL and increases insertion/deletion work; read_at updates still maintain existing partial unread index, with no additional partial index introduced here. Measure size, inspect write traffic, deploy during acceptable lock window. No speculative performance percentage promised.
  - Rollback: failed transactional CREATE INDEX leaves no partial migration state. Before release, revert unapplied migration/test additions normally. After release, do not edit applied history; approved compensating additive migration can DROP INDEX public.notifications_recipient_category_created_idx, preserving all original indexes and behavior. Schedule drop lock safely; application rollback not required. Concurrent build/drop strategy, if needed by measured production scale, requires explicit operational review before execution.
