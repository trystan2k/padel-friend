## Task Analysis

- Main objective: Deliver PAF-87 “Follow-up epic 2 — Community pagination and locale correctness”, scoped children PAF-60 and PAF-56, in one focused PR. All scoped ACs, unchanged quality gates, QA approval, and user review required; no automatic follow-ups.
- Identified dependencies: No hard issue prerequisites, per intake. Supplied branch: feature/PAF-87-community-pagination-and-locale-correctness; base origin/main @ 3d6a39c. Planner inspected working tree read-only, did not verify Git state or run checks. Executor verifies these first. Local Supabase, test credentials, Chromium, Node >=26, pnpm >=12 needed by existing full gate; availability not established here.
- System impact: Requests pagination lifecycle and route-to-feature contract; root locale persistence and select sizing; focused Vitest/Playwright regressions. No SQL, RLS, dependency, or authentication changes anticipated.

**Evidence**

- Read AGENTS.md and Completion-First Policy, .opencode/agents/delivery-orchestrator.md:126–149. Required/related work remains in delivery regardless of severity; genuine blockers remain incomplete unless user explicitly revises criteria.
- src/features/community/CommunityAdminViews.tsx: RequestsView resets during render on pagedMembers !== members; page success/catch/finally lack freshness guards. MembersView already uses membersSourceRef plus increasing searchRequest and guards all completion paths.
- src/routes/_protected.community.$communityId.admin.requests.tsx: loader returns { community, members, timezone }; component forwards no revision. community-admin.types.ts owns screen contracts. CommunityAdmin.tsx already keys dispatcher by community ID.
- test/community.admin-ui.test.tsx provides typed Member fixture, mocked search, provider/render/rerender, deferred promises settled in act. Reuse request mutation reconciliation (~936), request paging/end-of-list (~1006), member refresh race (~1146), audit/venue races (~1193 onward). Request paging button currently reads “LOAD MORE CHANGES”, not “Load more”.
- src/routes/__root.tsx owns locale select; issue’s src/components/ui location is stale. Queue and latest-selection tokens already serialize saves. Recovery runs only when CURRENT job reached persisted = true.
- **PAF-56(b) genuinely incomplete:** hold pt-BR save; select es before first settles; first succeeds, writing pt-BR cookie without UI commit; second rejects before persisted becomes true; catch skips recovery. Committed UI remains en, cookie remains pt-BR. test/root.locale.test.tsx already covers overlap before first settlement when BOTH saves succeed, and separate single-save rejection; neither covers combined failure.
- src/i18n/locale.functions.ts writes locale cookie, path /, sameSite lax. vitest.config.ts uses V8, includes src/i18n/config.ts, thresholds 80% EACH lines/functions/statements/branches. vitest.unit.config.ts inherits thresholds. Keep coverage configuration untouched.

**Scope decision / assumptions**

- Surface before styling: “unchanged 390px layout” needs precision. Frozen admin screenshots capture main, not root header; structural probes mostly compare main-relative geometry. Root native select has no sizing styles at any width. Measure 390px first. If also <44px, unchanged native select box and >=44px at all widths cannot both be literal requirements. Recommended interpretation: allow required locale-control resizing; preserve protected 390px admin layout, exact probes and frozen budgets. Obtain caller/user confirmation. If literal unchanged header geometry required, return measured conflict for explicit criteria/design decision; do not silently fix only 320px or fake wrapper hit regions.
- No other missing task inputs. Supplied title/IDs authoritative. Only this plan plus caller’s existing approved findings ledger permitted as documentation artifacts. Second artifact filename not supplied: caller owns it; create no third document, spec, report, or residuals file.
- PAF-93’s transferred route/comparator oracles, circular ownership, and admin keyboard-matrix findings excluded, not delivery gates.

## Chosen Approach

- Proposed solution:
  - PAF-60: explicit requests dataset token { communityId, generation }, generation local and monotonically increasing at requests route’s complete loader-result boundary. Pass required datasetGeneration number through requests-only screen props. RequestsView resets on token change and compares captured token plus increasing page-request ID before changing rows, hasMore, error or page-loading state. Invalidate ownership on unmount.
  - Route adapter: named component; guarded React state snapshot { loaderData, generation }; advance generation on a newly published complete loader result, not array contents/reference, merged rows, page arrivals or unrelated rerenders. Complete loader-result publication is only refresh notification, not members identity. Verify router publication/structural-sharing semantics in step 1. Deterministic initial generation supports SSR/hydration; route remount establishes new owner and invalidates previous requests. No process-global counter, timestamp, random/content key or JSON serialization.
  - Leave MembersView implementation intact: existing search/filter/debounce workflow already guarded and regression-tested. Share ownership principle (dataset owner + monotonic request guard; protect success/catch/finally), not new generalized pagination hook. Unification adds unrelated contract/fixture churn.
  - PAF-56: retain locale queue, committed locale ref and latest tokens. Track known persisted preference separately. After latest save failure, restore committed preference when persistence differs or is uncertain, with corrective save INSIDE same serialized queue job before subsequent selections. Skip redundant recovery when known preferences agree. Preserve existing changeLanguage-failure recovery; obsolete work never commits UI.
  - Style actual native locale select through StyleX; preserve native semantics and label association. Existing native select needs no custom widget/Base UI migration; existing app primitives remain Base UI. Use fluid width and actual >=44px box. Existing tokens support calc(var(--space-40) + var(--space-4)), matching community sizing conventions. No new token needed. No transparent clones, overlays, wrapper-only click forwarding, or overlapping negative margins.
- Justification for simplicity:
  - Reject array comparison alone: misses explicit-generation requirement. Reject generalized paging/cache/cancellation subsystem: unnecessary refactor. Select small route/feature contract plus existing guarded-completion pattern.
  - Reject parallel locale writes/latest-response checks: cookies can still settle out of order. Reject locale state-machine rewrite: existing queue already handles success; persisted-vs-committed distinction repairs demonstrated gap.
  - Reject 320px-only sizing: acceptance requires accessible control beyond one viewport. Resolve 390px interpretation explicitly rather than weaken requirement.
- Components to be modified/created:
  - PAF-60: src/routes/_protected.community.$communityId.admin.requests.tsx; src/features/community/community-admin.types.ts; src/features/community/CommunityAdminViews.tsx; test/community.admin-ui.test.tsx; new test/community.requests-route.test.tsx for focused real-memory-router publication/invalidation contract. Update directly affected request fixtures/type assertions only; test/community.admin-routes.test.ts only if changed contract requires it.
  - PAF-56: src/routes/__root.tsx; new src/root.styles.ts for StyleX sizing; test/root.locale.test.tsx; e2e/community-admin.spec.ts for scoped locale sizing/cookie checks. No component rules in src/styles.css.
  - Read-only safeguards: snapshots/references, masks/budgets/comparator, Playwright config, token sources, visual residual docs, coverage config. No new production copy anticipated; any necessary new labels/status require en/pt-BR/es keys, never literals.

## Implementation Steps

1. **Verify baseline, generation boundary and sizing interpretation.**
   - Verify supplied branch/base, existing changes, scoped issue status with caller; preserve unrelated work. No new issue creation.
   - Verify requests route publishes a distinct complete loader result on successful invalidation, including unchanged contents/reused members reference; unrelated component rerender must not publish new dataset. Step 2’s real-router regression proves this. If structural sharing suppresses publication, use installed router’s supported requests-route configuration to preserve loader publication and cover it. If reliable publication unavailable, return concrete evidence before changing contract; never fall back to array/content identity.
   - Measure locale select at 320/390/desktop, wrapping, main top/geometry. Resolve scope decision above before styles; record evidence only in approved ledger.
   - Baseline: pnpm typecheck; pnpm lint; pnpm exec vitest run --config vitest.unit.config.ts test/community.admin-ui.test.tsx test/community.admin-routes.test.ts test/root.locale.test.tsx.
   - Check full-gate prerequisites against INITIAL_SETUP.md, e2e/global-setup.ts and integration setup; never print secrets. Report exact unavailable prerequisite and external unblocking condition; original AC stays incomplete. Modern-web-guidance skill loaded; planner cannot execute its network CLI under read-only permissions. Executor may retrieve applicable guidance under normal permissions before implementation; no product dependency needed.

2. **PAF-60: add failing regressions plus explicit generation contract.**
   - Reuse typed local Member fixture builder for 50 unique pending memberships. Stable i18n instance across rerenders. Add required generation to requests fixtures (initial 1, refresh 2); no fallback derived from members.
   - Primary behavioral red test: render generation 1 with 50 rows, start deferred page at offset 50, publish generation 2 fresh first page, settle old page; stale row absent, fresh rows retained. Establish red behavior before fix, not merely TypeScript failure from new prop.
   - Race variant: refresh, start held generation-2 page, settle old page first; current page remains busy, end/error state unchanged; resolve current page and assert correct append/offset. Stale rejection likewise cannot show alert or release current loading.
   - Test reused members reference + new explicit generation resets accumulated rows; new array + unchanged generation does not reset them. Preserve ordinary rerenders, continuation after full page, short/empty-page end state, error/retry, approve/deny reset/invalidation.
   - New test/community.requests-route.test.tsx mounts real memory router with actual requests route/loader and mocked server functions: invalidation advances revision even with identical rows; unrelated rerender preserves revision; community switch cannot inherit rows. Keep auth/parent harness minimal. Do not rewrite PAF-93’s old route-oracle tests.

3. **PAF-60: implement generation-scoped pagination.**
   - Add required datasetGeneration number to requests-only props; named route adapter publishes local revision from complete loader results. Preserve loader server-function calls, auth ownership, timezone and data payload.
   - RequestsView tracks community+generation snapshot and paginated state; reset before displaying old appended rows under new token. Synchronize active ownership at commit before promise microtasks can modify refreshed state (layout-effect setup/cleanup appropriate); do not rely only on passive effects or mutate shared refs during speculative render.
   - Capture token and increasing request ID before fetch. Guard success, hasMore, catch and finally. Functional state updater must respect generation when applied, not only before scheduling. Unmount cleanup invalidates ownership; page arrivals never advance generation.
   - Separate pagination-loading ownership from mutation busy, retaining aggregate busy behavior for buttons/actions. Refresh releases obsolete PAGE busy, not active approve/deny mutation; old page finally cannot release newer page/mutation.
   - Preserve offset members.length + additionalRequests.length, pending filter, empty query, limit 50, mutation notifications and router.invalidate.
   - Fast gate: pnpm typecheck; pnpm lint; pnpm exec vitest run --config vitest.unit.config.ts test/community.admin-ui.test.tsx test/community.admin-routes.test.ts test/community.requests-route.test.tsx.
   - Checkpoint: red-to-green stale append, guarded stale error/finally, existing member/search/mutation tests green. Suggested commit: **fix: guard request pagination across loader refreshes**.
   - Risk/mitigation: busy-state coupling and lifecycle timing. Prefer one generation-scoped page-state record plus independent mutation state if separate setters prove fragile. Atomic unit rollback if needed; retain regression proof, do not alter server behavior.

4. **PAF-56(b): prove and repair latest-save failure.**
   - Extend existing deferred-promise overlap setup, no sleeps. Persistence mock must model actual side effect: successful save updates persisted preference/cookie using locale name/path; rejected save leaves it unchanged. Reset cookie/mock state between tests.
   - Red regression: committed en; select pt-BR; first save invoked/pending; select es; verify second not invoked; complete first (cookie pt-BR), reject second; require awaited compensating save en. Assert cookie en, selector en, English labels, html lang en. Current implementation must fail before fix.
   - Add non-en committed preference and ordering case: commit pt-BR, overlap en/es, latest rejects, restore pt-BR, next selection succeeds. Assert recovery settles before next queued write. Retain existing successful overlap-before-first-settlement test, single-save rejection test and translated labels.
   - Add known-persisted preference tracking alongside localeRef, initialized from initial committed locale, updated on save success. Latest failure restores committed preference when needed within serialized job; obsolete work cannot commit UI. Preserve recovery after successful persistence followed by language-change failure.
   - Recovery-failure regression: no unhandled rejection, committed UI unchanged, later successful selection restores consistency. Permanent unavailable persistence cannot guarantee a corrective write; report failure honestly, do not claim cookie repaired. No retry/backoff subsystem. Treat ambiguous write-after-response-loss conservatively when choosing whether recovery needed.
   - Fast gate: pnpm typecheck; pnpm lint; pnpm exec vitest run --config vitest.unit.config.ts test/root.locale.test.tsx.
   - Checkpoint: combined race red/green and exact save sequence plus persisted state, not call count alone. Existing real server cookie handler unchanged; browser transport round-trip covered next.

5. **PAF-56(a): enlarge real locale hit region; preserve protected layout.**
   - Proceed after step-1 interpretation approved. Add src/root.styles.ts, apply StyleX sizing to #locale itself. Token-derived min block size; fluid width tolerates names. Keep htmlFor/id, accessible name, native keyboard behavior, existing options/handler. Do not restyle theme select unless needed to prevent directly introduced overlap.
   - Extend existing “community admin 320px locale matrix” in e2e/community-admin.spec.ts: explicitly probe root locale select (existing main/nav locator excludes it). Actual box width/height >=44, translated accessible name, no document/main overflow, no overlap with theme control, visible keyboard focus and operable native selection. Add focused 390px/desktop sizing check; cover en/pt-BR/es. Do not implement transferred admin keyboard-matrix finding.
   - After successful selection inspect real browser locale cookie, reload and assert selector/copy/html lang agreement. Reuse signed-in fixture/hydration/cleanup; no bespoke backend fixtures needed for race proof.
   - Frozen admin visual caps in e2e/community-admin.spec.ts visualDiff call sites stay: RgqPq 18,500; wFqGR 15,500; jQDkx 22,000; N18Mu4 22,500; A5Vio 21,000; E5CS5K 20,000. e2e/references/paf-31/*.png, matching e2e/community-admin.spec.ts-snapshots/*.png, SHA checks, masks, comparator and docs/visual/community-admin-residuals.md unchanged. No other screenshots/tolerances refreshed.
   - Structural gates unchanged: main-relative cards/actions/search/settings/venues ±1px; 18px margins/354px content; nav x18/y774/354x56, five links/current item; existing >=44 action/control checks. Header change must not resize cropped main, hide content behind fixed nav or alter masks. Review screenshot diff AND geometry.
   - Fast gate: pnpm typecheck; pnpm lint; pnpm exec vitest run --config vitest.unit.config.ts test/root.locale.test.tsx; pnpm test:e2e e2e/community-admin.spec.ts. Always package E2E wrapper (fresh preview/free 4173, reuseExistingServer false), never bare Playwright or concurrent build-owning suites.
   - Checkpoint: measured 320/390/desktop boxes, no overflow/overlap, cookie reload integration, unchanged existing visual gates. Combined unit commit after steps 4–5: **fix: recover locale preferences and enlarge language controls**.
   - Risk/mitigation: header flow affects viewport-relative content despite cropped screenshots. Rework sizing within approved interpretation, never widen budgets or hide geometry changes. Literal header-freeze conflict requires explicit decision; PAF-56 remains incomplete meanwhile.

6. **Verify complete epic; QA/review; one PR.**
   - Run pnpm complete-check sequentially after unit gates. It reports every stage; do not weaken thresholds, coverage inclusion, screenshot budgets, assertions or CI. Build extraction test and Playwright both own dist: do not run concurrently.
   - Review entire diff against supplied base: scoped product/tests plus two allowed workflow artifacts only. No dependency churn, generated snapshots, machine-local files or unrelated cleanup. Required/related findings fixed now; unrelated/optional observations reported separately without scheduling/automatic issue creation.
   - Require QA gate and user review approval. Push/PR follows caller’s approval process. One PR targets main, title contains no issue IDs, description links epic/children, request Copilot review. Resolve scoped review findings; repeat affected/full checks as needed. No commit subject/body contains issue identifiers.
   - Record test names/red-green evidence, token contract proof, cookie sequence, viewport measurements, unchanged caps, complete-check result and approvals in existing ledger/PR. Create no extra evidence document. Planning has not run tests or obtained approvals.

## Validation

- Success criteria:

  | Acceptance criterion | Steps | Proof |
  | --- | --- | --- |
  | PAF-60 no stale append after refresh | 2–3 | Old deferred page resolves after explicit generation change; absent stale rows; fresh rows/page preserved, including reused members reference |
  | PAF-60 unchanged pagination/reset otherwise | 2–3 | Existing offset/end/mutation tests; same-generation rerender; next-page-after-refresh; stale catch/finally tests; unchanged MembersView refresh regression green |
  | PAF-60 new regression | 2–3 | Behavioral red-before/green-after plus real-router revision publication/stability proof |
  | PAF-56 >=44px including 320; frozen budgets unchanged | 1, 5 | Actual >=44x44 boxes at 320/390/desktop and all locales; no overlap/overflow; exact existing probes/six visual gates; explicit layout interpretation approval |
  | PAF-56 overlapping saves/latest failure leave cookie committed | 4–5 | Successful obsolete write + latest rejection + awaited committed-locale restoration; cookie/select/copy/lang agree, non-en case included; browser successful reload |
  | PAF-56 overlap before first settlement regression | 4 | Existing success scenario retained; new failure scenario starts second selection with first pending; verifies serialized corrective write |
  | Both units complete-check passes | 6 | All stages green, V8 thresholds remain 80/80/80/80, no budgets relaxed |
  | Epic focused PR, QA/user approved | 6 | One main-targeting PR linking three issues, QA/user approval evidence, scoped findings reconciled |

- Checkpoints:
  - Before edits (1): supplied branch/base verified, prerequisites checked, loader publication established, 390px interpretation resolved. No concealed scope decisions.
  - During work (2–4): deterministic red/green for each behavior; guards cover success/error/finally; page/mutation ownership independent; corrective locale writes stay serialized.
  - After work (5–6): real-browser sizing, focus, i18n/cookie checks, exact structure, immutable visual budgets/assets, full gate, QA and user review. Persistent unavailable recovery endpoint or unresolved geometry requirement remains blocker, not planned follow-up completion.

Plan artifact: /Users/trystan2k/Documents/Thiago/Repos/padel-friend/docs/plan/Plan PAF-87 Follow-up epic 2 — Community pagination and locale correctness.md
