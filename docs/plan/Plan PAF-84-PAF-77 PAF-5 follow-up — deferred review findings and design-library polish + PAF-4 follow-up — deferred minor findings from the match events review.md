## Task Analysis

- Main objective: Deliver combined review follow-up on existing branch `feature/PAF-84-PAF-77-review-followups`: Unit A / PAF-84, then Unit B / PAF-77; exactly two implementation commits, one PR targeting main. Planning only here; no implementation, tests, or commits executed.
- Identified dependencies: AGENTS.md; brainstorming and tanstack-start-architecture skills; PAF-5 and PAF-4 findings ledgers; existing StyleX components, generated database schema, local Supabase CLI/Docker, Vitest and Playwright harnesses, approved Pencil exports/manifests. Unit B depends on Unit A's shared UI and green commit. Baseline supplied: origin/main @ ba8ef880b385d8997e89a61eee71f2ef3ac3234f.
- System impact: Shared presentation across matches and notifications; E2E fixture lifecycle; CI predecessor-upgrade proof; match DTOs, pagination snapshot, photo signing, SQL eligibility, notification wording, checkbox targets. No new packages, routes, storage policies, registration algorithms, or design edits intended.

### Inputs, assumptions, clarifications

- Missing Inputs: Linear AC and Task Master combined-task record/title not supplied. Derive AC below directly from supplied issue bodies; use both complete supplied issue titles as combined title. No blocking product clarification.
- Assumptions Made: All migrations unreleased, as user explicitly confirmed. Existing migration edits permitted; local development uses db reset. No hosted migration repair needed. Branch/worktree state supplied, not independently checked with git by planner.
- Targeted Clarifications: None needed for implementation scope. Filename conflict: planner contract requires `docs/plan/Plan [ID] [Full Task Title From Task Master].md`; therefore this sole artifact uses combined ID and both full supplied titles, rather than requested `docs/plan/PAF-84-PAF-77-plan.md`. Do not create a second copy.
- Preserve pre-existing dirty files: `.opencode/agents/delivery-orchestrator.md` and `docs/plan/PAF-5-findings.md`. Never stage their existing unrelated changes. Ledger append, if needed, requires selective hunk staging; safer default is record resolution/evidence in this plan only.

### In scope

- A1 / PAF-5 F8: app-wide implementation extraction of roster/request identity rows and status badges, including every actual consumer inventoried below. No Pencil component/library editing.
- A2 / PAF-5 F18: deterministic global prune plus suite-owned cleanup, covering direct-seeded events, registration state/attempts, invites, notifications and partial setup/retry residue.
- A3 / PAF-5 F33: real CLI migration-up against genuinely populated predecessor schema in CI; retain existing rolled-back statement-order test.
- A4 / PAF-5 F17: resolved-by-design. Keep accepted-state View group self-link unchanged; approved frame Za6r4.
- B1–B6 / PAF-4 F20–F25: publication wording, stable database-issued pagination as_of, explicit DTOs, batch photo signing, separate invitation/eligibility projection, both checkbox label dimensions >=44px.
- Verify PAF-5 F12 and F35; fix only if still real. Current code inspection finds both already addressed; runtime verification remains execution work.

### Explicit out of scope

- Do not modify `docs/design/padel-friend.pen`, approved exports, screenshot baseline images, or source-design digests.
- Four PAF-5 nits are documentation-only, not defects to fix: F13 qNVpA/Cpd7L bottom-nav icon drift; F14 internal state/attempt tables' rls_disabled advisory (privileges revoked; client operations fail 42501); F19 seed intentionally unschedules local cutoff cron; F7 rating content in frames intentionally mirrors brief. Record dispositions, no product/config/design changes.
- No F17 link rewrite, new migration file for B5, broad architecture cleanup, dependency additions, lowered coverage, expanded screenshot budgets, generic badge redesign, or changes to unrelated wizard StepBadge.
- No production/developer data destruction; no all-database cleanup during parallel tests; no issue identifiers in commit subjects/bodies or PR title.

## Chosen Approach

- Proposed solution: Small presentational shared primitives with explicit visual variants; ownership-scoped atomic fixture deletion; one sequential disposable-CI upgrade harness; typed JSON-boundary contracts; one database snapshot propagated through loader/state; RLS-authorized projected photo keys signed in one batch; one shared SQL caller-context helper reused by list/detail at every overriding migration stage.
- Justification for simplicity: Reuse existing StyleX/i18n/routes and trusted CLI SQL harnesses. Avoid new UI framework, generic registry/schema system, persistent test databases, MVCC snapshot infrastructure, or storage authorization bypass. Keep business decisions feature-owned.
- Components to be modified/created: Detailed manifests below. Shared components may import React/StyleX/shared infrastructure only, never match/notification feature models or translations.

### Alternatives considered

1. Registration-only extraction: smaller diff but explicitly rejected by user; leaves card/notification duplication.
2. Selected approach: two shared presentation primitives, retaining existing exact visual treatments through named variants and feature-owned copy/decisions. Slightly larger diff, smallest approach satisfying app-wide/no-regression scope.
3. Universal schema-driven row/badge registry plus generalized fixture orchestration framework: unnecessary indirection and higher blast radius; reject.

Migration coverage alternatives: extending existing regex/extracted-statement test cannot test real migration history/DDL order. Running destructive resets from Vitest would race shared integration suites. Choose CLI upgrade in existing CI provisioning sequence before final fresh reset; no new parallel DB project/ports needed.

### Unit boundaries and expected files

**Unit A — PAF-84: PAF-5 follow-up — deferred review findings and design-library polish.** Commit only after A fast + affected integration/E2E gates pass, before any B edits. Suggested subject: `refactor: share status surfaces and harden registration test isolation`.

A new files:
- `src/components/ui/StatusBadge.tsx`, `src/components/ui/status-badge.styles.ts`.
- `src/components/ui/RosterRow.tsx`, `src/components/ui/roster-row.styles.ts`.
- `test/ui.status-badge.test.tsx`, `test/ui.roster-row.test.tsx`.
- `e2e/match-fixture-cleanup.ts`: small trusted, scoped cleanup builder/runner shared by setup and visual teardown; `test/matches.fixture-cleanup.test.ts` covers construction/guards/partial cleanup.
- `scripts/test-populated-migration-up.mjs`; `test/fixtures/matches-predecessor-upgrade.sql`; `test/fixtures/matches-upgrade-assertions.sql`; `test/matches.migration-up-harness.test.ts`.

A existing files:
- `src/features/matches/MatchRegistrationPanel.tsx`, `MatchRequestQueue.tsx`, `match-registration.styles.ts`, `MatchCard.tsx` (all under same matches directory).
- `src/features/notifications/NotificationBadge.tsx`, `NotificationsPage.tsx`, `notifications.styles.ts`.
- `e2e/global-setup.ts`, `e2e/matches-registration-visual.spec.ts`, `e2e/matches-visual.spec.ts` (structural probes only if card wrapper affects selectors).
- `test/matches.prune-scoping.integration.test.ts`; registration `panel` / `roster` / `queue` tests; `test/matches.list.test.tsx`; `test/notifications.badge.test.tsx`, `test/notifications.center.test.tsx`; `.github/workflows/ci.yml`.
- This plan: append A execution evidence. PAF-5 ledger append optional, only new owned hunks; never sweep pre-existing content.
- F12 tests unchanged unless verification exposes defect. F35 seed unchanged unless execution reinspection contradicts current evidence.

**Unit B — PAF-77: PAF-4 follow-up — deferred minor findings from the match events review.** Start only after A committed. Suggested subject: `fix: preserve match discovery context and eligibility semantics`.

B source files:
- `src/features/notifications/NotificationDetailPage.tsx`; optionally `NotificationsPage.tsx` to use same publication attribution on feed (existing identical miswording found); keep registration feed copy otherwise unchanged.
- `src/features/matches/match-model.ts`, new `match-projection.ts` (JSON decoding/contract validation only), `matches.functions.ts`, `matches.validators.ts`, `match-photo.server.ts`, `MatchesPage.tsx`, `MatchCard.tsx`, `MatchDetailPage.tsx`, `MatchRegistrationPanel.tsx`, `MatchDetailsForm.tsx`, `CreateMatchPage.tsx`, `MatchReview.tsx`, `MatchInviteePicker.tsx`, `create-match.styles.ts`.
- `src/routes/_protected.matches.index.tsx`, `_protected.matches.my.tsx`, `_protected.matches.past.tsx`, and `_protected.matches.$eventId.tsx` only for typed loader wiring; no business logic there.
- `src/locales/en/translation.json`, `src/locales/pt-BR/translation.json`, `src/locales/es/translation.json`.
- Existing migration files: `20261016120200_match_event_functions.sql`; `20261017180000_match_registration_projections.sql`; `20261017200000_match_registration_fifo.sql`; `20261017210000_match_registration_cutoff.sql`; `20261018073908_match_registration_not_playing_projection.sql`, all under `supabase/migrations/`.
- `src/lib/supabase/database.types.ts` only if regeneration changes generated helper signatures.

B tests:
- `test/notifications.detail.test.tsx`, `test/notifications.functions.test.ts`, `test/notifications.center.test.tsx` if feed attribution changed.
- `test/matches.model.test.ts`, new `test/matches.projection.test.ts` and `test/matches.contracts.test.ts` (type assertions included in typecheck); `test/matches.functions.test.ts`, `test/matches.validators.test.ts`, `test/matches.list.test.tsx`, `test/matches.routes.test.ts`, `test/matches.photo.functions.test.ts`, `test/matches.photo.integration.test.ts`, `test/matches.discovery.integration.test.ts`, `test/matches.detail.test.tsx`, `test/matches.registration.panel.test.tsx`, `test/matches.create.test.tsx`, `test/matches.styles.test.ts`.
- `e2e/matches.spec.ts` and `e2e/matches-visual.spec.ts` for notification/publication or touch-target flows and exact target geometry; no approved image updates.
- `docs/plan/PAF-4-findings.md` append follow-up closure; this plan append B evidence.

Some paths intentionally touched in both commits (MatchCard, panel, list tests, notification feed, visual probes): A commits presentation-only delta first; B commits only subsequent behavioral/type delta. No future B SQL/i18n/logic enters A. Explicit path/hunk staging, never `git add .`. Do not amend A to absorb B; final full-gate follow-up belongs to responsible unit and preserves two-commit delivery by coordinating before finalizing B.

### A1: exhaustive current consumer inventory and extraction contract

| Existing file / site | Actual duplication or status surface | Target / migration |
| --- | --- | --- |
| `src/features/matches/MatchRegistrationPanel.tsx` local Badge | Same span + base and five tone styles repeated across accepted/pending/rejected/expired/full/closed panels and roster | StatusBadge with positive, neutral, muted, danger, guest tones; feature maps participation/source to tones and supplies translated children |
| Same file, `renderEntry` | Playing quartets, reserve rows, reserve-not-playing rows, guest/member/creator tags; name/level/status/source/position flex row | RosterRow visual variant roster; retain children order, accepted_order key, caller stripe and name fallback |
| Same file, fallback own-placement row | Duplicate name/status/source/position structure and self stripe | Same RosterRow, same DOM semantics; no fake full roster |
| `src/features/matches/MatchRequestQueue.tsx` count + guest/out-of-range/unrated spans | Duplicates badge base/tone composition from panel | StatusBadge; no change to localized context or approval/decline behavior |
| Same file, `requestHeader` + `requestName` | Same identity-and-tags concept but space-between header inside li request card | RosterRow visual variant request-header; preserve li/card/actions as feature-owned outer structure and request-header exact geometry |
| `src/features/matches/MatchCard.tsx` caller status strong | Bare status label for playing/reserve/reserve_not_playing/invited/legacy accepted | StatusBadge plain/emphasis variant retaining strong presentation; do not restyle it into pill and cause visual regression |
| `src/features/notifications/NotificationsPage.tsx` unreadSummary (two branches) | Duplicated unread count pill and styles | StatusBadge summary variant matching current padding/radius/type/color exactly |
| `src/features/notifications/NotificationBadge.tsx` inline visual count | App-wide nav count status span inside labeled Link | StatusBadge count/plain variant with aria-hidden forwarded; retain link, unknown-count behavior, live announcement and 99+ semantics |
| `src/features/matches/match-registration.styles.ts` | Badge base/five tones; rosterRow/self/name and requestHeader/name duplication | Move presentation to shared style modules; retain panel, sections, badges container, request card and actions in feature |
| `src/features/notifications/notifications.styles.ts` | unreadSummary presentation duplicated at two sites | Move to shared summary style; badgeLink remains notification navigation chrome |

Search evidence: `MatchDetailPage.tsx` has text-only creatorAccepted/invitation/status paragraphs, not a separate badge or roster implementation; `NotificationDetailPage.tsx` has kind headings/context paragraphs, no badge/roster markup; `MatchInviteePicker.tsx` has selected-player list with remove buttons, not participation/request roster rows. Do not misclassify/restructure these unrelated layouts. `src/components/ui/StepBadge.tsx` is wizard step-number primitive, not a status badge; retain. No other row/badge consumers found by src search; implementer repeat search before closure and account for new findings within same app-wide scope.

Shared API stays small: StatusBadge accepts translated ReactNode children, explicit tone/appearance, optional emphasis and normal span/strong accessibility attributes. RosterRow accepts translated name and composable metadata/status children, highlighted flag, roster/request-header appearance. Use exact root/child semantics necessary to preserve layout; no arbitrary feature data, i18n key knowledge, business callbacks, registry, or generic styling escape hatch. Request-header variant has no forced roster background/min-height if old header did not. Shared roster name styling removes duplicate margins/weight. Plain/count/summary variants do not inherit pill uppercase/spacing.

Tests: shared primitives cover each visual variant, name/metadata order, highlight, translated long children, aria forwarding. Existing registration panel/roster/queue tests prove all states still render same text, source, FIFO position and action callbacks. Notification badge/center tests preserve counts, hidden semantics and announcements; list tests preserve card status. Refactoring need not invent behavior failure: characterization tests precede extraction; new ownership/import/no-duplicate assertions may fail before it. Every actual behavioral fix below must have failing-before/passing-after regression.

### A1 visual regression strategy

- Reuse `e2e/matches-registration-visual.spec.ts` and `e2e/references/paf-5/manifest.json`, plus PAF-4 `matches-visual.spec.ts` and corresponding manifest. References remain immutable.
- Compare fo8Zn / SYMLa / tYXlh full detail screenshots at 390x872; qNVpA / Z0gRd notification screens at 390x844. Za6r4 requester states, xC04T participation roster and Cpd7L quartet board require structural/content assertions, not invented screenshots of impossible combined screens. Retain CLn9x organizer queue/guest and JLqMT/eYIgj/nNzWb detail reference coverage; retain existing PAF-4 listing/card frame mappings. Existing t1ywa/uiRqp/dmvWu/ausNa/n6zFq state references remain unchanged.
- Exact probes independent of pixels: existing gutter axis (--space-18), real sibling distances, tab geometry, section boundaries/radius, zero UA margins, CTA geometry; add retained roster row flex/order/wrapping, minimum block size, gap/padding, caller border; badge padding/radius/font/foreground/background by variant; queue name/tag placement; notification summary/count DOM/a11y semantics. Measure reference-derived assertions, not new component self-snapshots. Accessible action target width AND height >=44px.
- Preserve pinned nonzero registration budgets: direct join .415, full .365, closed .375, quartet/playing notifications .365, registration/cutoff notifications .455. They are existing cross-renderer plus documented adaptation envelopes, NOT permission for structural drift. Keep per-screen rationale/manifests and dynamic masks unchanged; append observed before/after residuals/evidence to plan or test attachments. Preserve existing PAF-4 budgets exactly. Do not widen, rebaseline, or add masks for extraction defects; fix geometry first. A frame with no approved variant gets invariants only.
- Exercise 320px/mobile, 1280px desktop, dark, pt-BR, es using existing invariant matrix: no horizontal overflow, wrap translated text, theme-aware colors, target bounds, stable ordering. No .pen editing required for implementation extraction.

### A2: fixture isolation mechanism

Verified nuance: visual actors already use `match-reg-visual-...@test.local`; global prune's event selection by created_by already includes their events. Defect is not failure to match venue names. Notifications are absent from MATCH_FIXTURE_PRUNE_STATEMENTS, visual afterAll closes contexts only, and cached family restoration can reuse old identities. Fix ownership/lifecycle rather than broaden deletion by venue name.

- Extract cleanup SQL construction/runner into `e2e/match-fixture-cleanup.ts`. Keep existing global exports compatible if tests import them, or update test import in same commit. Global setup uses fixture-owned event/user selectors; per-visual teardown passes only recorded event/actor identities for its family. Assert loopback in actual runner entry, not just default setup.
- Delete match-target notifications BEFORE events using target_type='match_event' and target_id in owned events; also match-category notifications to suite-owned recipients where appropriate. Never delete unrelated developer notifications/community notifications. Snapshot/select target IDs before event deletion. Then attempts/state/invites/registrations/events in existing FK-safe order. Disable/enable only relevant immutability triggers inside one atomic transaction/DO block, so failure rolls everything back including trigger state. Avoid new blanket trigger bypass.
- Track event IDs before attempting creation; track actual successful owned actors/events/photos incrementally. Remove only visual-owned uploaded photos via actor storage client where supported; no global storage wipe. Partial setup failure and closed contexts must not skip DB cleanup. Cleanup errors surface even if context close fails; nested try/finally or allSettled collecting failures, no swallowed failures.
- Existing visual family cache is runtime output, not committed identity truth. Invalidate/delete cached file after final cleanup; on restore verify all event identities exist, otherwise clear entire in-memory family before rebuild. Retries within same run may restore only verified current family; after interrupted previous run global prune recovers residual events + notifications deterministically.
- Extend `test/matches.prune-scoping.integration.test.ts` rolled-back probe: direct-seeded visual-style event and target notifications removed; second prune idempotent; developer event/notification and non-match notifications survive; registration state/attempt FKs clean; cleanup SQL failure rolls back disabled triggers. Add tests of scoped cleanup SQL/ownership guard in `test/matches.fixture-cleanup.test.ts`. Never perform committed global deletes from parallel Vitest.
- E2E run twice and alternate visual + functional specs; after teardown query exact recorded event IDs, their notifications, state, attempts: zero. Simulate stale cache/partial fixture setup; no reused residue or duplicate unread counts. No global cleanup from per-test/worker teardown, since other suites share DB.

### A3: real populated predecessor upgrade guard

Existing `test/matches.registration.domain-migration.integration.test.ts` slices real statements and executes a rollback sentinel in current schema. Keep it: fast order/backfill proof, but not CLI/history/complete-DDL proof.

Create `scripts/test-populated-migration-up.mjs` plus two SQL fixtures named in A manifest:
1. Require explicit disposable-backend opt-in, CI runner context, and CLI status resolving loopback database. Refuse by default locally and refuse remote URLs. No reset against ordinary developer stack. Script commands use pinned `pnpm exec supabase` from repo root; no migration-file copying, truncation, manual history repair, or source mutation.
2. On fresh CI backend run `supabase db reset --local --version 20261016120300 --no-seed`. This is last predecessor migration before `20261017173426_match_registration_domain.sql`. Verify actual pinned CLI flag support from --help during implementation, failing closed if unsupported. Assert history ends at predecessor and legacy match_registration_immutable is installed. Assert new accepted_order/lifecycle columns absent (non-vacuity).
3. Commit `test/fixtures/matches-predecessor-upgrade.sql` with deterministic isolated auth users, community/members, future-start events with future/past cutoffs, legacy accepted rows only (id/event/user/accepted_at), and invite. Include five accepted users/event, creator-first ordering trap (creator timestamp later than a member), tied member timestamps with known UUID ordering. Use predecessor-only columns. Keep legacy immutability trigger ENABLED; bypass only photo-publication and publication-notification fixture triggers transactionally, restore immediately; creator registration may run normally. Capture expected identities/order/counts before upgrade.
4. Run real `pnpm exec supabase migration up --local`. Require exit 0; inspect history contains every remaining repository migration including final roster migration. Do NOT substitute db reset/latest, extracted SQL, or repaired migration history for this step.
5. Execute `test/fixtures/matches-upgrade-assertions.sql`: same events/registration IDs/invites survive; lifecycle accepted; creator source creator/others member; ordinals deterministic creator-first then accepted_at/id; next_accepted_ordinal=6; future event split 4 playing/1 reserve, cutoff event 4 playing/1 not-playing; counts/roster agree. Snapshot notification counts, reconcile, require no synthetic historical promotion/quartet alert. Assert identity guard installed and rejects identity mutation, obsolete blanket trigger gone, internal grants remain revoked. Test state/cutoff expectations in scheduler-safe way: migration schedules cron, so disable the local test job immediately after upgrade as harness setup (not product/seed change); assertions must tolerate legitimate already-processed cutoff markers, never phantom transition alerts. Print explicit assertion result/nonzero on error.
6. Run migration up again, assert no pending migrations/data changes. Always restore final clean backend with existing `supabase db reset` before ordinary CI checks, even when upgrade fails; preserve original failure status and useful logs. If restore fails, stop backend-backed checks loudly.
7. Wire existing `.github/workflows/ci.yml` Provision local Supabase step: start -> guarded populated-upgrade script -> existing final reset -> status/env provisioning. Prefer a separately named sequential upgrade step for readable logs, followed by final-reset step with failure-aware cleanup. No overlap with pnpm test/E2E and no Vitest subprocess resetting shared DB. Existing full gate stays source-nonmutating and unchanged; this is additional CI backend provisioning guard.
8. `test/matches.migration-up-harness.test.ts` mocks subprocesses: remote/default-local refusal, exact predecessor/no-seed command, committed seed before up, assertions after up, failure propagation/restoration, no source writes. CI actual upgrade is behavioral regression: temporarily move trigger drop after backfill in disposable trial, require CLI fail 23514, restore file before recording passing run. Never commit negative mutation.

### A4 / leftovers: disposition evidence

- F17 resolved-by-design: retain existing `MatchRegistrationPanel.tsx` Link to /matches/$eventId in accepted state and localized View group. Existing panel/link tests and Za6r4 probe must remain green. Documentation only.
- F12 verified in current code: actual injector is `test/matches.notifications.integration.test.ts:400–455`, not stale publication ledger line. Trigger has WHEN (new.target_id = failedId), cleanup in finally with IF EXISTS, then pg_trigger/pg_proc residue probe. Do not churn passing fix. Run notifications + publication + discovery + registration.visibility together against shared backend; probe no leftover trigger/function. If defect reproduced, narrow any change to injector setup/cleanup scope and add non-target concurrent insert regression in Unit A.
- F35 verified already corrected: `supabase/seed.sql:25` reads `raise notice 'PAF-5.4 scheduler: local cutoff job removal skipped (%).', sqlerrm;`. No semicolon inside placeholder; no code edit warranted. Record verified-already-fixed in Unit A (coherent with F19/CI fixture notes), not Unit B. If actual execution checkout differs, only this log string changes in A; no scheduler behavior change.
- F7/F13/F14/F19 dispositions above are documentation-only, not silent unresolved blockers.

### B1 / F20: publication notification copy

Exact files: NotificationDetailPage, three locale translation files, notifications.detail/functions tests; NotificationsPage + notifications.center test for identical publication attribution if changed.

Current `getMyNotificationTargetV2` already fetches recipient-scoped kind/created_at and route/refresh carries them. No extra notification lookup/RPC needed. Detail's registrationHeading(null) and registrationKind===null body currently force invitation. Distinguish target.kind==='match_event_published' from match_event_invitation; reuse existing `notifications.kinds.match_event_published` heading and add `notifications.match.publishedBy` body. Keep registration allowlist/placement rules intact. Unknown/missing kinds degrade to generic notification copy, not fabricated invitation. Refresh/reconnect must keep publication heading/body.

Regression first: publication non-invitee sees published heading/attribution, no invitation text/accept affordance; invitation keeps existing copy; reconnect/retry does not downgrade; registration kinds unchanged. Functions test confirms kind survives recipient lookup (existing seam, avoid unnecessary production edit). Feed's publication context uses same publishedBy key, not invitedBy; other feed wording unchanged to prevent unrelated redesign.

### B2 / F21: database-issued time snapshot

Exact files: matches.validators.ts, matches.functions.ts, match-model.ts, MatchesPage.tsx, all three listing route adapters; five SQL projection migrations listed below, tests validators/functions/list/routes/discovery/model.

Current validator injects `new Date().toISOString()`; merely forwarding that would preserve a client/server JS clock, not required database-issued as_of. Remove JS default; omitted as_of stays null/undefined until SQL establishes coalesce(p_as_of,now()). Add a flat `as_of` metadata field to SQL list rows using that same expression, not browser time. Result contract becomes {items,next_cursor,as_of:string|null}; read metadata from first row and strip row-only cursor/as_of from card DTO. Empty result => as_of null and no cursor (no further page exists), so no extra clock RPC/envelope redesign needed. For incoming subsequent-page as_of preserve it exactly; validate every returned row agrees. All five list redefinitions must emit metadata so predecessor and final schema behave consistently.

MatchesPage receives initialAsOf from loader, tracks it with sourceItems/sourceCursor/sourceError/generation, sends same value on every loadMore/retry. A loader refresh replaces items/cursor/snapshot atomically and increments generation; old in-flight page cannot append or overwrite snapshot. Never compute Date.now for snapshot. Existing cursor ordering remains unchanged.

Regression: validator no clock default; DB first page yields server as_of; page 2/retry carries identical instant even across start/cutoff boundary; available/my/past integrate against fixed supplied snapshot; refresh creates new DB snapshot and rejects stale response. Include empty/exact-limit pages. Snapshot means consistent time boundary, not MVCC freeze: new registrations/capacity/membership can still change; do not promise frozen database contents.

### B3 / F22: explicit schema-aligned contracts

Exact files: match-model.ts, new match-projection.ts, matches.functions.ts, CreateMatchPage, MatchDetailsForm, MatchReview, MatchInviteePicker, MatchCard, MatchDetailPage, MatchRegistrationPanel; route detail wiring and named tests.

- Define explicit MatchCreationOptions (communities, saved venues, level defaults), MatchDraft, MatchInvitee, MatchPublishInput, MatchEventCard, MatchEventDetail, MatchEventListResult. Keep MatchEventListItem alias if needed to reduce churn, but alias explicit contract, not Record intersection.
- Derive persisted scalar fields/enums with Pick/indexed access from `Database['public']['Tables'][...]['Row']` / generated Enums in `src/lib/supabase/database.types.ts`; explicitly add SQL projection counts/creator fields/caller state/photo_url. List/detail currently project same facts: reuse explicit common shape, distinguish boundary/use types without duplicate giant field lists. Separate draft text/numeric input types from persisted DB values.
- RPCs return Json, so validate actual JSON shape in small decoder module at server boundary; type assertion alone is not a schema guarantee. Enumerate required primitive/nullable/enum fields, reject malformed required fields to existing error channel. Preserve deliberate optional backwards-compatible fields (reserve_not_playing_count fallback) and exact-key tests where relevant; no unrestricted index signature, Record<string,any>, any[] or blanket as unknown as DTO escape hatch in affected contracts.
- Replace creation options any, dynamic draft change signature with typed keys/value union or keyed helper, frozen publication Record, review/invitee any. Defensive feature presentation helpers may narrow optional fields, but no new broad exported EventRecord/Projection replacing explicit detail type. Error dictionaries remain legitimate Record<string,string>; raw input/object guard Record<string,unknown> is acceptable before decoding.
- Type tests with @ts-expect-error for wrong enums/IDs/property access; runtime decoder tests reject missing/invalid fields, accept nullables/valid payload; update fixtures to honest typed builders, not optionalizing every field to avoid test work. Existing creation/replay/photo-copy/list/detail/panel tests prove behavior preserved.

### B4 / F23: batch listing photo authorization/signing

Exact files: match-photo.server.ts, matches.functions.ts, matches.functions/photo.functions/photo.integration tests. Reuse projected photo_path plus already authenticated, readability-gated list RPC; do not call signMatchPhoto(event_id) for each card.

Add server-only `signMatchPhotoBatch(client, authorizedRows)`: accept only internal decoded projection rows from listMatchEvents, validate photo keys, deduplicate keys, call `storage.from(MATCH_PHOTO_BUCKET).createSignedUrls(keys,60)` once per nonempty page, map by returned path (not array index), emit URL or null per item. The readability-gated projection is authorization source once; signing still uses caller Supabase client/RLS, never service-role key. Do not expose helper as arbitrary browser key signing endpoint. Preserve Cache-Control private,no-store, expiry and detail/staged upload functions. Empty page/zero valid paths => zero signing calls. Individual returned error/missing object => only corresponding photo_url null; batch failure => all photo_url null, never drop otherwise readable cards.

Tests fail-before on call counts: one list RPC, zero per-card match_events lookups, one batch signing call for N cards; dedupe/order mapping, malformed keys, mixed per-key failures, empty page, total failure. Integration proves unauthorized private event/photo cannot be signed or included and authorized photos render. Keep storage RLS tests; no policy loosening.

### B5 / F24: invitation separate from eligibility, shared projection

IMPORTANT inspected dependency: get_match_event/list_match_events are redefined by four later migrations. Editing only original file leaves final DB buggy. Edit original IN PLACE, no new migration, and update all later redefinitions to reuse same helper. Files:
- `supabase/migrations/20261016120200_match_event_functions.sql` (define helper before read RPCs).
- `supabase/migrations/20261017180000_match_registration_projections.sql`.
- `supabase/migrations/20261017200000_match_registration_fifo.sql`.
- `supabase/migrations/20261017210000_match_registration_cutoff.sql` (uses CREATE FUNCTION after DROP, not just CREATE OR REPLACE).
- `supabase/migrations/20261018073908_match_registration_not_playing_projection.sql` (final read RPC definitions).

Define one stable internal `public.match_event_caller_context(p_event_id uuid)`, security definer / set search_path='', returning `caller_is_invited boolean, caller_eligibility text, caller_requires_approval boolean`. Derive auth.uid internally; never accept arbitrary caller ID. Guard readable event; revoke execute from public/anon/authenticated, invoked only inside definer read RPCs. Explicitly schema-qualify tables/functions. Add dependency/grant tests and regenerate DB types normally.

Projection rules, shared by both reads via lateral helper:
- Invitation existence independent boolean, regardless of accepted badge precedence.
- Eligibility creator first; active member => member when unrestricted or within range; otherwise out_of_range (including unrated restricted member, preserving existing approval semantics).
- Readable authenticated nonmember => nonmember when public open OR explicitly invited, including private/invite-only invitation access. Invitation grants visibility, not automatic level/guest approval bypass.
- requires_approval true only for out_of_range/nonmember, false for creator/member/none.
- Preserve caller_badge's current creator/accepted participation/invited priority and all FIFO/cutoff/count logic. No invitation-first branch in caller_eligibility. Add caller_is_invited to detail/list JSON, not only a badge inference.

UI: MatchCard/MatchDetailPage display invitation fact from caller_is_invited independently of out-of-range/guest approval text. MatchRegistrationPanel selects request when approval true BEFORE invitation-only fallback; in-range invited caller with no registration keeps intentional invitation-only behavior, avoiding duplicate invitation paragraphs. Keep F17 self-link unchanged. Use existing localized invitation/approval strings; no new eligibility marketing text.

Regression in `test/matches.discovery.integration.test.ts` (plus visibility if fixture belongs there): active member invited out-of-range => caller_is_invited true, caller_badge invited when not accepted, caller_eligibility out_of_range, caller_requires_approval true in BOTH get/list. Also invited in-range, unrated, nonmember on invite-only/private readable event, creator, non-invitee control, accepted invitee whose badge is playing/reserve. Compare shared fields list/detail exactly. Component tests show invitation fact AND correct request approval CTA, never silent bypass. Update exact-key contracts for caller_is_invited and list as_of metadata deliberately. Run reset and A upgrade harness with B migrations; no follow-on migration file.

### B6 / F25: touch labels

Exact files: MatchDetailsForm.tsx, create-match.styles.ts, matches.create/styles tests, e2e/matches-visual.spec.ts (and matches.spec.ts if flow needed).

Apply existing s.touchLabel to BOTH levelRestriction and courtBooked labels; court label switches from grid field treatment where needed to preserve natural input/text alignment. Guarantee minInlineSize and minBlockSize from `calc(var(--space-40) + var(--space-4))`; retain flex/wrap/token spacing and semantic label-input association. Native checkbox semantics retained; no unrelated widget migration needed.

Unit tests click label text and toggle checkbox, verify label styling class/association and keyboard behavior. Browser test measures label getBoundingClientRect().width AND height >=44 for both controls at mobile/desktop, light/dark, en/pt-BR/es; clicking label edge toggles associated control. Existing hit-target helper measures only height and skips checkboxes: add explicit checkbox-label selectors/assertions; do not claim input size or CSS declarations prove rendered area. Preserve create screen geometry/reference probes; no budget widening.

### i18n checklist (Unit B)

- New key in all three `src/locales/{en,pt-BR,es}/translation.json`: `notifications.match.publishedBy`, with identical {{name}} interpolation. Suggested reviewed meanings: en “Published by {{name}}”; pt-BR “Publicado por {{name}}”; es “Publicado por {{name}}”.
- Reuse existing `notifications.kinds.match_event_published` vs `notifications.kinds.match_event_invitation`; retain `notifications.match.invitedBy` exclusively for actual invitation detail. Unknown kind uses existing notifications.generic.
- Reuse existing `matches.detail.invitationInfo` / `guestApprovalRequired` / `outOfRangeApprovalRequired` and matchRegistration.join.requestButton; no new key needed for SQL separation or extraction.
- Shared UI takes localized children/labels from feature; no hardcoded user copy/default labels. New aria text, helper/error/status, if implementation requires any, gets identical key sets and interpolation parity across en/pt-BR/es before commit.
- Run locale key parity/interpolation tests already in repo plus new copy tests; SSR locale/hydration agreement unchanged.

### Design-token checklist

- Move existing StyleX token declarations, preserve semantic tokens first. Badge visual variants retain existing --color-green-soft/green/surface-2/text/muted/red/amber/bg; spacing --space-1/2/3/4; radius --radius-8/12; existing typography variables. Do not unify distinct current visual appearances.
- Roster self stripe uses existing border-width-lg and color-green; no literal colors, spacing, radius, typography values. Zero reset/layout ratios not design literals; browser-test numeric 44px threshold is accessibility assertion, not hardcoded product styling.
- B6 44px target uses existing token calculation and min inline/block constraints. Build tokens via pnpm tokens:build when needed; no new token anticipated. Do not edit generated CSS manually or add unrelated token definitions.

### Risks / mitigations / rollback

- App-wide extraction blast radius: characterize before move; preserve named appearances, accessible semantics and DOM order; run all matching component and both visual suites. If wrong, revert extraction hunks within A before commit, not retain half-migrated consumers or enlarge budgets. Shared layer imports no features.
- Editing unreleased migration history: update every overriding definition, reset from zero AND populated predecessor. If any environment already applied these migrations outside disposable dev, stop and ask for release strategy; do not silently repair history or add unauthorized migration. Preserve FIFO/cutoff count logic and grants.
- Destructive upgrade harness: explicit CI/disposable/loopback guards, sequential provisioning only; no destructive reset from pnpm test or complete-check; always restore latest schema before normal checks; nonzero failure retained. Never run against shared developer backend.
- Fixture cleanup: ownership predicates and rolled-back prune tests protect real data. Per-suite cleanup scope never broad @test.local predicate while workers run. Atomic trigger restoration; stale-cache recovery and two-run residue probes. Interrupted runs recovered by pre-worker global prune.
- Snapshot semantics: stable time boundary only, not transaction snapshot or frozen capacity. No stale page appends after refresh; empty list metadata null is intentional.
- Batch signing: use only trusted projected paths plus caller RLS, map responses by path, preserve partial failures/private no-store. No arbitrary-key server endpoint.
- PR size: expect roughly 40–55 unique files / 1,500–2,500 changed lines including tests, five SQL projections, harness, and planning evidence; estimate, not measured diff. Flag likely breach of soft ~1,500-line/40-file guideline in PR. A extraction+all consumers+visual tests inseparable; fixture/harness tests must accompany fixes; B typed contracts+all adapters and shared SQL+all overrides+tests inseparable. User explicitly chose combined branch/two commits/one PR; do not split delivery without approval. Avoid formatting unrelated files to control size.
- Pre-existing dirty ledger/workflow: never overwrite, restore, or commit unrelated work. Record closure in this plan; selective ledger append only if ownership can be proven.

## Implementation Steps

1. **Preflight / 20 minutes maximum.** Implementer inspect branch/base/dirty diff without altering unrelated files; save baseline test/reference measurements and pre-existing ledger hunks. Confirm local backend disposable status and CI CLI flags. Read supplied ledgers, component inventory, final SQL overrides. Derive AC below; no hidden Linear AC assumed. Stop if migration-release assumption false.
2. **A1 characterization / 45 minutes.** Add shared UI characterization tests and affected consumer assertions in listed `test/ui.*` / registration / list / notification tests. Capture existing visual/structural measurements with fresh build and pnpm test:e2e. Tests pin appearance and accessibility, not implementation hashes.
3. **A1 extraction / 2 hours.** Create StatusBadge/RosterRow + matching StyleX modules; migrate every inventory site including fallback roster, request header, card emphasis, summary and nav count. Remove now-unused feature styles/local Badge. Keep feature translations and business logic local; preserve F17. Run shared/consumer tests and repeat src duplication search. No B DTO/copy/SQL changes yet.
4. **A2 isolation / 90 minutes.** Add scoped cleanup builder/runner, update global setup and visual teardown/cache. Write failing prune notification/partial-cleanup tests first; implement FK-safe notification-first cleanup and ownership guards. Extend rolled-back integration probe. Re-run registration visual suite twice and combined functional/visual specs, inspect zero owned residue plus developer sentinel survival.
5. **A3 upgrade harness / 2 hours.** Add disposable CLI runner, committed predecessor seed and post-upgrade SQL oracle, mocked runner tests, sequential CI wiring. Prove actual CLI negative 23514 with temporarily regressed ordering on disposable backend, then positive real migration-up; restore file and final DB. Keep existing domain-migration test. No product migrations change in A.
6. **A4/F12/F35/nits evidence / 30 minutes.** Record F17 resolved-by-design, four nits documentation-only, F12 scoped/finally/residue proof and F35 already-correct notice. Run F12 related suites concurrently. Only implement leftover fix if reproduction contradicts read evidence, with failing regression first. Record exact commands/results, no claims of unrun tests.
7. **A gate and commit / 60 minutes.** Run A fast gate and affected E2E below; inspect no missing consumers/new literals/source-mutating gate changes. Stage only A paths/owned hunks and plan; verify staged diff excludes pre-existing files/B work. Commit A with Conventional Commit subject, no issue identifier. Record commit hash before starting B.
8. **B regression-first contracts + SQL / 2 hours.** Write list/detail invited/out-of-range and database as_of integration regressions, decoder/type tests. Define explicit contracts/decoders. Edit original and four overriding migration files in place with shared caller helper, separate invitation boolean, list as_of metadata. Regenerate database types and reset local disposable dev DB; run zero-reset and populated upgrade proof. Preserve old migration grants/count semantics; inspect every overriding function.
9. **B adapter behavior / 2 hours.** Wire SQL contracts into matches.functions, validators, listing routes/page atomic snapshot state, card/detail/panel independent invitation/approval behavior. Replace broad creation/detail contract usages across named components with typed forms/options/review/invitees; update honest fixtures. Prove pagination boundary/retry/refresh race regression and type negative cases.
10. **B photo batch / 60 minutes.** Add call-count/security/partial-error tests, implement server-only batch signing over decoded authorized keys, preserve detail/upload behavior/private no-store. Run server/unit and storage integration tests.
11. **B wording + targets / 60 minutes.** Write failing publication/reconnect tests and both checkbox geometry/toggle assertions; fix detail/feed attribution with publishedBy in all locales; apply token touchLabel min dimensions to both controls. No new screenshot baselines.
12. **B fast gate and combined full gate / reserve 90 minutes plus actual suite runtime.** Run B fast/integration/E2E checks, review exact SQL contract keys/types/translations/tokens. Run single authoritative `pnpm complete-check` once on final combined tree before push. Report every stage honestly. If red, fix owned cause and seek authorization for repeat authoritative gate rather than pretending affected reruns equal full success. No commit until green required checkpoints; record full-gate outcome in B evidence.
13. **B commit / 20 minutes.** Stage B-only delta from A baseline, owned plan/PAF-4 ledger append, no unrelated dirty hunks. Commit second Conventional Commit, no identifier. Exactly two implementation commits. Prepare one PR to main, link both Linear issues in description (not title), explain size exception and inseparable seams, request Copilot review. Do not push/create PR without invoking session's normal approval policy.

Timeboxes are investigation/escalation checkpoints, not permission to omit tests or silently defer scope. At overrun or new blocker, report evidence/remaining work to orchestrator; preserve unit boundary.

## Validation

- Success criteria: All derived AC below satisfied with evidence, both unit checkpoints green, real populated CLI-upgrade CI guard active, no unrelated file changes, exactly two implementation commits, single PR, final authoritative complete-check green before push. Planning artifact itself does not assert execution happened.
- Checkpoints: Map step numbers to commands/oracles below; each behavioral fix must show failing-before and passing-after test output. Characterization-only refactors must show preserved behavior and structural geometry.

### Unit A derived AC / time-boxed definition of done

Linear AC absent; derived from PAF-84 body:
1. Shared roster-row/status-badge implementation exists in src/components/ui; every inventory consumer migrated; duplicate feature badge/identity styling removed; no shared->feature imports. Visual, a11y, translated/responsive output preserved.
2. Direct visual fixtures/notifications cleaned deterministically before run and at scoped teardown; retries/stale caches/partial setup leave no event/notification/state/attempt residue; developer data survives; no cross-worker global prune.
3. CI actually runs migration up from committed populated predecessor, proves expected backfill/guards/no false notifications, and restores latest DB before remaining suites. Existing statement-order regression retained.
4. F17 link unchanged/resolved-by-design; F7/F13/F14/F19 documentation-only; F12 verified existing fix with concurrent suite evidence; F35 verified already corrected, no seed edit unless actual checkout differs.
5. Within A's roughly 6–8 hour working box plus suite runtime, fast + focused integration/E2E green, scope inspected, A commit recorded before B begins. Overrun escalated, not converted to incomplete AC.

A fast gate (steps 2–7):
- `pnpm typecheck`; `pnpm lint`.
- `pnpm exec vitest run test/ui.status-badge.test.tsx test/ui.roster-row.test.tsx test/matches.fixture-cleanup.test.ts test/matches.migration-up-harness.test.ts test/matches.list.test.tsx test/matches.registration.panel.test.tsx test/matches.registration.roster.test.tsx test/matches.registration.queue.test.tsx test/notifications.badge.test.tsx test/notifications.center.test.tsx`.
- Backend-backed: `pnpm exec vitest run test/matches.prune-scoping.integration.test.ts test/matches.registration.domain-migration.integration.test.ts test/matches.registration.schema.integration.test.ts test/matches.notifications.integration.test.ts test/matches.publication.integration.test.ts test/matches.discovery.integration.test.ts test/matches.registration.visibility.integration.test.ts`. Must not skip local backend tests in CI; inspect forced-failure residue catalog probe.
- Fresh `pnpm build` then `pnpm test:e2e e2e/matches-registration-visual.spec.ts e2e/matches-visual.spec.ts e2e/matches-registration.spec.ts`. Repeat registration visual spec once separately to prove non-leak. Run actual upgrade harness only on disposable CI backend with explicit guard opt-in, never normal shared local test DB.

### Unit B derived AC / time-boxed definition of done

Linear AC absent; derived from PAF-77 body:
1. Publication recipient never described as invited merely because event available; invitation/registration copy correct across load/retry/reconnect, all locales.
2. First DB-issued as_of propagated unchanged through every page/retry; refresh resets snapshot atomically; crossing time boundaries does not move pages relative to that time anchor.
3. Explicit schema-aligned creation/card/detail contracts replace broad DTO records/any at affected seams, with decoder + type-negative tests and generated types in sync.
4. N-card listing performs no per-event lookup/signing fan-out; one caller-authorized batch signing request; private no-store, missing-photo/null fallback and storage access controls preserved.
5. Invitation boolean/status independent of out-of-range eligibility/approval in BOTH list/detail; active invited out-of-range caller gets approval-required UI. Original migration edited in place, all overrides consistent, no new migration.
6. Both checkbox label targets >=44px in width AND height; label click and keyboard toggles work; translations wrap without overflow.
7. Within B's roughly 6–8 hour working box plus suite runtime, B focused gates and final single combined full gate green; second commit isolated; exceptions reported rather than silently deferred.

B fast gate (steps 8–12):
- `pnpm typecheck`; `pnpm lint`; `pnpm db:types:check` after normal regeneration/reset.
- `pnpm exec vitest run test/matches.model.test.ts test/matches.projection.test.ts test/matches.contracts.test.ts test/matches.validators.test.ts test/matches.functions.test.ts test/matches.photo.functions.test.ts test/matches.list.test.tsx test/matches.routes.test.ts test/matches.detail.test.tsx test/matches.registration.panel.test.tsx test/matches.create.test.tsx test/matches.styles.test.ts test/notifications.detail.test.tsx test/notifications.functions.test.ts test/notifications.center.test.tsx`.
- Backend-backed: `pnpm exec vitest run test/matches.discovery.integration.test.ts test/matches.visibility.integration.test.ts test/matches.photo.integration.test.ts test/matches.publication.integration.test.ts test/matches.registration.visibility.integration.test.ts test/matches.registration.schema.integration.test.ts`; plus existing domain-migration test and actual populated CLI-upgrade CI guard rerun with B SQL. Type/decoder changes may require test fixture updates elsewhere: run all test/matches.* and touched notifications suites before full gate.
- Fresh `pnpm build` then `pnpm test:e2e e2e/matches.spec.ts e2e/matches-visual.spec.ts e2e/matches-registration.spec.ts e2e/matches-registration-visual.spec.ts`; include relevant existing notification E2E if direct detail wording covered there. Never bare playwright test.

### Final checkpoint / evidence table to append during execution

- Preflight: branch/base, pre-existing dirty hunks excluded, migrations unreleased, backend guard verified.
- A: characterization before/after, inventory search closure, per-frame structural + screenshot residuals within unchanged limits, prune two-run residue oracle, CLI negative/positive upgrade evidence, F12/F35 verification, fast gate outputs, A commit hash.
- B: each six regressions red->green, all locale keys/interpolation parity, SQL list/detail shared projection assertions, stable time snapshot proof, photo request counts/security, both target dimensions, type generation parity, fast gate outputs.
- Final: one `pnpm complete-check` report for all eight existing stages; CI populated-upgrade step report separately; no thresholds changed, no --fix in gate, no source mutations hidden by checks; final diff/stat and owned staging review; B commit hash and two-commit sequence.
- No implementation or validation execution performed by planner. This file is executable handoff, not approval to ignore failing gates.
