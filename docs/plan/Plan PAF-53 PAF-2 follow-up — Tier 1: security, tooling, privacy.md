## Task Analysis

- Main objective: Deliver PAF-53 — “PAF-2 follow-up — Tier 1: security, tooling, privacy”, sequentially: base-branch docs → dependencies → staged lint coverage → community metadata isolation. Planning only; no commands, installs, database changes or product edits executed.
- Identified dependencies: Supplied branch feature/PAF-53-tier-1-security-tooling-privacy, base origin/main, HEAD f53f58f; Node ≥24.13.0, pnpm 11.0.8, registry/audit access, Docker/local Supabase, loopback .env and installed Playwright browsers. Four units, four atomic commits, one epic PR targeting main.
- System impact: Three documentation files, package resolution, pre-commit matching, communities SELECT ACL and settings access. No UI redesign, applied-migration edits, service-role browser access, coverage changes, CI autofix changes or unrelated refactoring.

### Missing Inputs

Current pnpm audit JSON and Dependabot alert records unavailable to read-only planner. Ten vulnerabilities, two critical and three high are reported intake context, not verified current inventory. Do not infer vulnerable packages from installed versions. Actual enumeration is mandatory Unit 2 checkpoint before dependency edits.

### Assumptions Made

- Supplied branch facts authoritative until executor verifies them. Do not recreate branch or check out main.
- Active Members read settings; active Admins read/write settings. Acceptance wording does not grant Member writes: existing mutation is Admin-only.
- created_by remains internally stored, absent from public/member responses. No production caller identified requiring it. Verify creator bootstrap through local privileged SQL rather than widening production metadata access.
- Supplying settings replaces JSON object; omitting settings preserves it. Do not introduce deep-merge semantics.
- Mandatory planner filename convention overrides requested docs/plan/PAF-53-tier-1-execution-plan.md. This file is canonical; no duplicate artifact created. Keep plan artifact outside three-file docs-chore commit unless invoker separately resolves artifact bookkeeping.

### Targeted Clarifications

No blocking intent questions. Escalate if audit demands unverified major upgrades, caller needs created_by, Members intended to gain write privileges, or deployment cannot coordinate new RPCs/app/grant revocation.

## Chosen Approach

- Proposed solution: Minimal docs corrections; audit-driven patch/minor updates; slash-free lint-staged JSON glob using existing generated-file oxlint ignore; nine safe column grants plus authorized settings reader and atomic Admin settings mutation RPC.
- Justification for simplicity:
  - Dependencies: targeted direct-parent/lock updates preferred; scoped transitive overrides only when necessary. Blanket major upgrades rejected.
  - Tooling: keep JSON; change key to *.{ts,tsx,js,mjs}. JS function filter unnecessary because .oxlintrc.json already ignores exact generated database types path. Verify real hook behavior, not micromatch theory alone.
  - Privacy: metadata-table split requires backfill, constraints/triggers and more caller changes. Safe view alone leaves base-table leakage; view plus revoked grants adds another read surface. Column ACLs with narrow authorized RPCs preserve schema and existing mutation return contract with no data movement.
- Components to be modified/created:
  - Unit 1: AGENTS.md; .opencode/agents/delivery-orchestrator.md; docs/templates/pull-request.md only.
  - Unit 2: package.json; pnpm-lock.yaml; pnpm-workspace.yaml only if scoped overrides required by current pnpm; new docs/security/dependency-remediation.md. Package-specific test changes determined only after audit.
  - Unit 3: .lintstagedrc.json; new test/lint-staged.test.ts. Read .husky/pre-commit, .oxlintrc.json and tsconfig.json without changing them unless probes establish necessity.
  - Unit 4: new CLI-generated supabase/migrations/<timestamp>_community_column_isolation.sql; src/features/community/community.functions.ts; src/features/community/community.validators.ts; generated src/lib/supabase/database.types.ts; test/community.functions.test.ts; test/community.integration.test.ts; test/community.admin.integration.test.ts; new test/community.column-isolation.integration.test.ts; new docs/security/community-column-isolation.md.

### Repository findings

- supabase/migrations/20261002055953_community_domain.sql grants table-wide communities SELECT to authenticated; settings and created_by share table with safe fields. SELECT RLS calls can_read_community; UPDATE RLS calls is_community_admin. Restricted UPDATE grants and audit/timestamp triggers already exist.
- Membership/Admin helpers reject anonymous sign-ins and check active/current membership intervals. Reuse them; no user_metadata authorization.
- 20261002105936_community_join_policy.sql adds join_policy and its UPDATE grant. Include join_policy in read allowlist.
- community.functions.ts list/detail already projects exactly id,name,description,logo_path,city_label,visibility,join_policy,created_at,updated_at. createCommunity uses authorized RPC. updateCommunitySettings currently direct UPDATE → SELECT including settings; sensitive SELECT revocation breaks RETURNING. Replace with atomic RPC, not separate write/read requests.
- community-admin.functions.ts Admin context selects safe fields only; Admin list selects id/name. No UI consumer reads JSON settings or created_by. Do not expand Admin context or redesign UI.
- src/features/auth/auth.server.ts requireAuthenticatedClient calls getClaims and sets Cache-Control private,no-store. Reuse for new/changed server functions; direct RPC still needs DB authorization.
- test/community.integration.test.ts rows helper SELECT * and Admin settings/created_by assertions need adaptation. Preserve row isolation/bootstrap/audit checks; safe columns for ordinary reads, authorized settings reader for settings. Existing test/community.admin.integration.test.ts local SQL CLI helper supports privileged fixture/ACL/bootstrap verification.
- .lintstagedrc.json flagged key contains slash. .husky/pre-commit invokes pnpm exec lint-staged. .oxlintrc.json already ignores exact src/lib/supabase/database.types.ts plus existing generated route tree/build artifacts. Do not remove legitimate existing ignores; no broad ordinary src exclusion.

### Recommended database contract

1. Revoke communities table-level SELECT from PUBLIC, anon, authenticated. Inspect/remove any stale sensitive column SELECT grants/inherited privilege source. Grant authenticated only nine safe columns listed above. Preserve existing RLS, service-role privileges, restricted UPDATE grants and create RPC.
2. Add get_community_settings(p_community_id uuid): SECURITY DEFINER, stable, search_path='', fully qualified names. Explicit auth.uid/non-anonymous guard; authorize current is_community_member (Admins also Members). Return explicit id/settings only; no created_by. Missing/unauthorized IDs use stable member-authorization error. Revoke EXECUTE from PUBLIC/anon/authenticated, then grant authenticated only.
3. Add update_community_settings(p_community_id uuid,p_changes jsonb): SECURITY DEFINER, search_path='', authenticated/non-anonymous guard. Acquire community row lock with existing governance/lifecycle community-first lock ordering; check current Admin under lock. Missing/unauthorized ID raises PG001 mapped to NOT_COMMUNITY_ADMIN. Return exact existing projection id,name,visibility,join_policy,description,city_label,logo_path,settings,updated_at. No whole-row return/created_by.
4. Patch validates object/nonempty, whitelist name/visibility/join_policy/description/city_label/logo_path/settings, strict JSON types, required nonnulls, valid enums/text lengths/settings object and size. Reject unknown keys including id/created_by/updated_at. Use static assignments and key-existence checks: omission preserves value; nullable text null clears; settings replaces when supplied. No dynamic SQL. Table CHECKs remain final defense. Direct RPC cannot rely on TS validation. Existing triggers preserve timestamp/audit; invalid/denied calls mutate nothing.
5. Expose authenticated GET getCommunitySettings with strict community-id validator; change existing POST updateCommunitySettings to typed atomic RPC. Keep validators, return contract, getClaims/no-store and unknown-error propagation. Public discovery allowlist unchanged.
6. Admin direct SELECT * intentionally fails too: column ACLs are role-wide. Members/Admins use authorized RPC for settings; do not grant sensitive SELECT to authenticated to restore legacy Admin queries.

## Implementation Steps

1. **Preflight / baseline.**
   - Verify branch/HEAD/status and inventory parent-session changes. Do not reset/stash/restore others' work or recreate branch.
   - Verify tool versions/.npmrc/lock consistency, loopback backend and browser prerequisites. Inspect current pnpm/Supabase CLI help before unfamiliar flags. Executor consults current Supabase ACL/RPC docs/changelog before implementation.
   - Run pnpm install --frozen-lockfile; pnpm db:start; pnpm complete-check. Capture known baseline failures and tracked-source diff before/after. Build generates artifacts, but quality gate must not leave tracked source mutated; report baseline discrepancy, do not weaken gate.
   - Checkpoint: baseline/branch/backend understood and invoker approves plan before implementation.

2. **Unit 1 — docs chore, isolated first commit.**
   - AGENTS.md Conventions: add base/development branch main; origin/main branch source; PR target main. No unrelated conventions cleanup.
   - .opencode/agents/delivery-orchestrator.md ~71: replace develop and “Never branch from main / production-only” assertion with main convention. ~182: fetch origin main, refresh origin/main; stay on feature branch without checking out local main; remove obsolete local-develop wording.
   - docs/templates/pull-request.md line 4: develop by default → main by default. No other files in this unit.
   - Exact tests: no automated test file. Manually assert three docs agree, quoted obsolete develop/origin-develop base instructions absent, staged diff exactly three specified paths.
   - Fast gates: pnpm exec oxfmt --check AGENTS.md .opencode/agents/delivery-orchestrator.md docs/templates/pull-request.md; git diff --check; git diff --cached --name-only. Inspect targeted docs text/negative grep.
   - AC mapping: main convention → three edits/content assertions; minimal factual scope → exact staged paths; own chore commit → chore: align base branch documentation with main.
   - Risk/rollback: low; revert only this unit if factual mistake. No Linear issue required for user-requested chore.

3. **Unit 2 — PAF-45, inventory BEFORE upgrades.**
   - Actually execute pnpm audit --json and pnpm audit against current lockfile before dependency edits. Preserve raw report outside repo, summarize safely in docs/security/dependency-remediation.md. Nonzero advisory exit differs from registry/network failure; failed retrieval is not zero vulnerabilities.
   - Review default-branch Dependabot alerts when authenticated access available. Reconcile advisory IDs, manifest paths, duplicate dependency paths and alert counts. Alerts may close only after merge/rescan.
   - Enumerate EVERY current vulnerable package: package/resolved version, GHSA/CVE/advisory ID, severity, dependency chain, runtime/dev use, vulnerable range, first fixed version/range, proposed parent update/override and required verification. Record timestamp/counts. This is mandatory stop/go checkpoint; no guessed package list.
   - For each actual package run pnpm why <package>. Prefer resolution refresh when existing range admits patch, then smallest direct-parent patch/minor update. Newly selected manifest versions use ~ per save-prefix; do not mass-rewrite unrelated existing ^ entries. Keep React/React DOM, Vitest/coverage and toolchain peers aligned.
   - Scoped override only if compatible parent upgrade unavailable; confirm current pnpm override location. No blind audit --fix, suppressions, allowBuilds expansion or blanket newest-version updates. For unavoidable major, document APIs/peer/runtime changes and specific migration/test evidence, get approval before applying unverified breakage.
   - After each related cluster rerun audit/fast gates; inspect lock diff for unrelated churn, integrity/registry changes. Final inventory records before/after versions and every remaining advisory.
   - Exact tests: no synthetic version-snapshot test. Existing pnpm test, pnpm build (SSR/Workers), pnpm typecheck and E2E suites prove regression baseline. Add focused test to existing affected module only if verified package/advisory changes behavior; exact path/test name chosen at inventory checkpoint, not fabricated beforehand.
   - Fast gates: pnpm audit; pnpm audit --audit-level=high; pnpm typecheck; pnpm test; pnpm build; pnpm exec oxfmt --check package.json pnpm-workspace.yaml docs/security/dependency-remediation.md; git diff --check. Finish pnpm install --frozen-lockfile and pnpm complete-check.
   - AC mapping: audit + inventory → affected packages identified; manifest/lock minimal updates → nonvulnerable versions/pinning; fresh audit/alerts → critical/high resolved; unresolved advisory → specific justification, exposure, compensating mitigation, owner/review date and explicit acceptance (not false green); complete-check/build/tests → no regressions.
   - Commit fix: remediate vulnerable dependencies, with evidence/tests together. If current audit clean, record verified result/reconcile stale alerts instead of gratuitous upgrades; escalate intake discrepancy.
   - Risk/rollback: coupled Workers/tooling breakage. Revert manifest+lock+override together, reinstall frozen lock. Vulnerable-version rollback needs temporary containment/fix-forward; never present it as permanent remediation.

4. **Unit 3 — PAF-46, reproduce real hook then minimal JSON fix.**
   - Use isolated temporary Git repository, not real index. Copy actual .husky/pre-commit, lint-staged/oxlint config, minimal compatible tsconfig/package context; use installed tools via controlled PATH/node_modules linkage. Clear parent Git environment variables so subprocess cannot alter parent index; explicit scratch author/committer, no signing, pre-commit hook only.
   - Stage src/features/probe/deep/file.ts with deterministic NON-autofixable correctness error (undeclared identifier candidate; first verify actual oxlint diagnostic/rule). Execute copied hook/scratch commit with lint-staged debug. Capture matching, filename, diagnostic and exit. Clean fixture control passes. Formatter/type setup failure alone is not proof of oxlint coverage. Record pre-fix behavior honestly even if probe contradicts reported miss.
   - Change JSON key to *.{ts,tsx,js,mjs}; keep oxlint --fix --deny-warnings, CSS and formatter commands unchanged. Existing exact generated DB types ignore handles exclusion; no new micromatch dependency/JS config needed. No --fix in CI/full gates.
   - Add test/lint-staged.test.ts with Vitest/node subprocess/fs APIs. Exact tests:
     - slash-free extension key; CSS/format tasks unchanged;
     - real copied pre-commit rejects staged nested TS error specifically with oxlint path/diagnostic;
     - table-driven nested TSX/JS/MJS lint errors also rejected; root control included;
     - exact src/lib/supabase/database.types.ts lint-only error ignored by oxlint; same basename under src/features/probe and adjacent ordinary TS NOT ignored;
     - path with spaces works; clean nested file hook succeeds; temporary repository cleaned in finally and parent index/source unchanged.
   - Generated file still formatted; fixture format-valid. lint-staged may schedule generated file, oxlint correctly ignores it: assert actual exclusion, not absence from command args. Retain existing generated route tree/artifact ignores.
   - Fast gates: pnpm exec vitest run test/lint-staged.test.ts; pnpm exec oxlint --deny-warnings test/lint-staged.test.ts; pnpm exec oxfmt --check .lintstagedrc.json test/lint-staged.test.ts; git diff --check; pnpm complete-check.
   - AC mapping: pre-fix hook/debug evidence → verify current behavior; JSON+table probes → nested coverage; exact generated/ordinary controls → exclusion; real hook diagnostic/failed scratch commit → pre-commit catches error; complete-check → full QA.
   - Commit fix: lint nested staged source files. Risk/rollback: accidental parent-index mutation, autorepair masking error, false formatter failure. Isolate processes/Git and use non-autofixable rule. Revert matcher/test together only for confirmed regression; do not knowingly retain nested lint gap.

5. **Unit 4 — PAF-37, forward-only database security change.**
   - Search all migrations/callers for communities grants, settings reads, SELECT *, exposed views and SECURITY DEFINER whole-row returns. Inspect ACL/inherited privileges locally; confirm no alternate export leaks metadata. Read current governance/lifecycle lock ordering and role interval semantics.
   - Add failing test/community.column-isolation.integration.test.ts first. Reuse real JWT actor/client + server-function builder mocks, loopback guard and CI fail-closed backend pattern. Seed public/private communities with distinct creator and recognizable sensitive settings. Privacy assertions ONLY real publishable-key actor clients; privileged SQL solely fixtures/ACL/bootstrap verification.
   - Run pnpm exec supabase migration new community_column_isolation. CLI determines timestamp; new supabase/migrations/<timestamp>_community_column_isolation.sql implements recommended contracts above. Explicit grants/revokes, restricted EXECUTE, one transactional migration. Never edit applied migrations.
   - Implement reader/Admin atomic patch with auth guards, role authorization under community lock, empty search_path, qualified SQL, explicit output fields and SQL-side patch validation. Keep existing RLS/create behavior/triggers/UPDATE grants. Test direct malicious RPC calls; TS validation alone insufficient.
   - Update community.functions.ts mutation to typed RPC; add authenticated getCommunitySettings GET. Strict validator in community.validators.ts; keep update input/return shape, getClaims/no-store, stable missing-ID NOT_COMMUNITY_ADMIN and unknown error propagation. Discovery/Admin context/UI unchanged unless concrete regression proves necessity.
   - Update test/community.functions.test.ts mocks/assertions from direct UPDATE chain to RPC. Add exact tests: validated RPC args contain no caller identity; invalid inputs rejected before auth; GET strict ID check; GET/POST require claims/no-store; known auth/member/Admin errors mapped; missing ID consistent; unexpected DB failures propagated; output projection excludes created_by.
   - Adapt test/community.integration.test.ts rows helper: communities uses safe columns; unrelated tables retain existing projection. Settings assertions use authorized reader. Preserve stored created_by bootstrap check through loopback SQL CLI helper pattern from community.admin.integration.test.ts; do not weaken creator/bootstrap/row isolation/audit assertions. Retain/extend existing Admin settings patch test for omitted fields, nullable clears and JSON replacement.
   - Apply on disposable LOCAL backend. Verify seeded upgrade from current migration baseline AND full migration replay. Reset only confirmed disposable loopback DB; no linked/remote production reset. pnpm db:types regenerates database.types.ts; review new typed RPC signatures/no unrelated drift. Do not cast away errors.
   - docs/security/community-column-isolation.md records ACLs, role matrix, RPC contract, intentional authenticated SELECT * failure and production compatibility/deployment decision.
   - Exact actor matrix, public and private communities:

     | Actor                                  | Public safe direct read | Private safe direct read  | Direct sensitive select/* | Settings RPC/server GET | Settings RPC/server write     |
     | -------------------------------------- | ----------------------- | ------------------------- | ------------------------- | ----------------------- | ----------------------------- |
     | anon unauthenticated                   | no rows or ACL denial   | no rows/denied            | denied                    | denied                  | denied                        |
     | anonymous sign-in authenticated role   | no rows                 | no rows                   | denied                    | denied                  | denied                        |
     | authenticated nonmember/invitee        | nine safe fields        | no rows                   | denied                    | denied                  | denied                        |
     | pending/inactive/expired/future Member | nine safe fields        | no rows                   | denied                    | denied                  | denied                        |
     | active Member                          | nine safe fields        | own community safe row    | denied                    | id/settings only        | denied/no mutation            |
     | active Admin                           | nine safe fields        | own community safe row    | denied                    | id/settings only        | success/existing return shape |
     | Admin of different community           | nine safe fields        | target private row hidden | denied                    | denied                  | denied                        |

   - Matrix assertions:
     - SELECT settings, created_by, id/settings, *, sensitive aliases denied (normally 42501), not merely empty payload; safe fields filtered/ordered by sensitive columns cannot infer protected values. Complement real PostgREST probes with ACL introspection.
     - Public list/detail server functions return exact nine keys for allowed actors; no settings/created_by. Private rows absent from public discovery even for own Member/Admin. Unauthenticated server requests UNAUTHENTICATED; anonymous sign-in denied at DB helpers.
     - Member/Admin settings reads; Admin writes preserve omitted settings/text, clear nullable fields, replace supplied JSON, update timestamp/audit; unauthorized/missing IDs mutate/audit nothing. Demoted/removed Admin immediately loses sensitive access/write authority.
     - Direct RPC rejects unknown keys, wrong JSON types, nonobject/empty patch, required nulls, invalid enums/text/oversized settings; invalid patch transaction rolls back. Direct Admin table UPDATE returning safe fields retains RLS; sensitive RETURNING fails. createCommunity still atomically bootstraps Admin and stored creator.
   - Fast gates: pnpm exec vitest run test/community.functions.test.ts test/community.discovery.functions.test.ts test/community.admin.functions.test.ts; CI=1 pnpm exec vitest run test/community.column-isolation.integration.test.ts test/community.integration.test.ts test/community.admin.integration.test.ts; pnpm typecheck; pnpm lint; pnpm format:check; git diff --check. Discover/run local Supabase advisors through CLI help. pnpm complete-check includes community Admin/onboarding/lifecycle E2E; mandatory DB suites must execute, not skip.
   - AC mapping: direct sensitive/ACL probes → nonmember column isolation; Member reader/Admin atomic mutation + server tests → retained settings path; new + adapted integration suites → direct/server actor matrix; full QA → complete-check; migration history/diff → forward-only.
   - Commit fix: isolate sensitive community metadata, including migration/functions/types/tests/docs.
   - Elevated risks: SECURITY DEFINER omission, inherited grants, role-change race, schema-cache lag, older app RETURNING settings breakage. Check authorization under existing lock order, SQL transaction rollback, explicit projection and real direct RPC access. Coordinate production migration/app deployment; single atomic migration acceptable only with agreed maintenance/coordinated rollout. Zero-downtime alternative: forward-only additive RPC migration → compatible app → forward-only revoke/grant migration; decide before creating release migration files. Do not edit applied files.
   - Rollback: retain restrictive grants and compatible RPC app, fix-forward new migration. Do not deploy old direct-RETURNING implementation after revocation. Prefer temporarily disable settings writes over restoring broad SELECT; restoration reopens vulnerability, requires explicit security approval.

6. **Epic final gate / delivery handoff.**
   - Fresh final audit and pnpm complete-check with backend/browsers ready. Capture test counts and non-skipped DB suites; compare tracked-source diff before/after gate.
   - Verify four ordered atomic commits, no issue IDs in messages, no probes/secrets/temp artifacts, no unauthorized docs-chore paths, no lowered coverage/no source-modifying CI commands.
   - One main-targeted PR; semantic title/body without issue identifiers per intake. Associate Linear externally, not by inserting IDs in PR body. Include audit and deployment/compatibility notes; request Copilot review using established workflow. Planning agent performs no delivery actions.

## Validation

- Success criteria:
  - Three specified docs agree on main; separate chore commit.
  - Verified package inventory/remediation evidence; critical/high resolved or explicit accepted exceptions; coherent manifest/lock/pinning; build/tests pass.
  - Actual hook catches nested TS/TSX/JS/MJS errors; exact generated DB types ignored by oxlint, ordinary source not broadly excluded.
  - Safe direct/public reads work; sensitive direct projections denied regardless of server-function bypass; private rows isolated; active Members read settings, Admins alone write; auth/no-store/audit unchanged.
  - New migrations pass seeded upgrade/replay; generated types match; full QA passes without tracked-source mutation or mandatory DB test skips.
- Checkpoints:
  - Step 1: branch/backend/toolchain and baseline proof, approval before product changes.
  - Step 2: three-path staged diff/content checks/format gate before isolated chore commit.
  - Step 3: current advisory enumeration before upgrade choice; per-cluster audit/fast gates; frozen lock/full QA before dependency commit.
  - Step 4: pre-fix debug probe and post-fix real-hook red/green controls; generated-only exclusion evidence/full QA before tooling commit.
  - Step 5: failing actor regression first; SQL/security review; seeded upgrade/replay; non-skipped actor/server matrix; types/audit/E2E/full QA before privacy commit. Production deployment compatibility decision blocks rollout.
  - Step 6: fresh audit, clean-source full gate, four units in order, one main PR and Copilot review. This artifact records planned work, not completed implementation.
