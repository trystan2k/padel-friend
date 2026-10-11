# Context Bundle — PAF-53 (Tier 1: security, tooling, privacy)

Single shared context artifact for all reviewers/fixers. Do not re-derive context; read this file.

- Repository: `padel-friend`
- Branch: `feature/PAF-53-tier-1-security-tooling-privacy`
- Base: `origin/main` (this repo has no `develop`)
- Plan file (design of record): `docs/plan/Plan PAF-53 PAF-2 follow-up — Tier 1: security, tooling, privacy.md`
- Range under review: `git diff origin/main..HEAD`
- Size: 20 files changed, +911 / −175 (within the soft 1500-line / 40-file guideline)
- Review scope: code-review (always) + architecture-review (src/features, src/lib, supabase/migrations, dependency/config changed). UX/UI review SKIPPED (no UI files changed).

## Epic scope (PAF-53 — "Tier 1: security, tooling, privacy")

Grouping epic; acceptance criteria live on the children. Deliver 3 children sequentially plus a user-requested docs chore and a user-approved tooling config fix.

## Units of work

### Unit 0 — docs chore (user-requested, not in Linear) — commit `17ca47c`

"chore: align base branch docs with main"

- Acceptance: this repo has no `develop`; base/development branch is `main`. Fix the docs that asserted `develop`.
- Files: `AGENTS.md`, `.opencode/agents/delivery-orchestrator.md`, `docs/templates/pull-request.md`

### Unit 0b — tooling config fix (user-approved, not in Linear) — commits `b1b5724`, `2948c7f`

"chore: allow dependency-audit commands for specialist agents"; "chore: allow corepack pnpm for registry operations"

- Why: specialist agents' bash allowlists blocked the registry commands PAF-45 needs. The mise standalone `pnpm` also cannot reach the npm registry in this environment, so `corepack pnpm` (system Node, pinned pnpm 11.0.8) was allowlisted.
- Files: `.opencode/agents/subagents/{implementation,bug-fixer,testing-automation,qa-gate}-specialist.md` (first commit); `{implementation,bug-fixer,testing-automation}-specialist.md` (second commit)

### Unit 1 — PAF-45: Fix Dependabot vulnerabilities on the default branch — commit `00d14b6`

"fix: remediate vulnerable transitive dependencies"
Acceptance criteria (verbatim):

- [ ] Run `pnpm audit` / review the Dependabot alerts; identify affected packages.
- [ ] Upgrade or patch to non-vulnerable versions (respect `.npmrc` save-prefix and pinning rules; no breaking major upgrades without verification).
- [ ] Critical/High advisories resolved or explicitly documented with justification.
- [ ] `pnpm complete-check` passes.
- [ ] No regressions in build/tests.

Outcome: 10 Dependabot alerts (2 critical, 3 high) over `undici`×6, `tinypool`×2, `sharp`×1, `source-map-js`×1 resolved via `overrides` in `pnpm-workspace.yaml` (sharp 0.35.5, tinypool 2.1.2, undici 7.29.1, source-map-js 1.2.2). One additional high (`braces` GHSA-vfj7-8cjw-p6xm) found by `pnpm audit` is UNFIXABLE (newest published `braces` is 3.0.3; advisory fix `>=3.0.4` does not exist) and is documented as an accepted exception. Post-remediation audit: 0 critical, 0 moderate, 0 low, 1 high (braces).

- Files: `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `docs/security/dependency-remediation.md`
- Note: `package.json` was explicitly left unchanged.

### Unit 2 — PAF-46: Fix lint-staged oxlint glob so nested src files are linted — commit `0a9efd6`

"fix: use slash-free lint-staged glob for nested source files"
Acceptance criteria (verbatim):

- [ ] Reproduce/verify whether nested `src/**` files are currently linted by lint-staged.
- [ ] Fix the config (e.g. slash-free glob + function filter, or a JS config) so oxlint runs on nested files and excludes only the generated file.
- [ ] A probe test proves a nested `src/**` file with a lint error is caught by the pre-commit hook.
- [ ] `pnpm complete-check` passes.

Outcome: key changed from `!(src/lib/supabase/database.types.ts)*.{ts,tsx,js,mjs}` to the slash-free `*.{ts,tsx,js,mjs}`; exclusion of the generated `src/lib/supabase/database.types.ts` now relies on `.oxlintrc.json` `ignorePatterns`.
**Honest finding:** a clean A/B run showed the LEGACY glob already matched/linted nested files, so the reported bug was NOT reproducible; the change is a hardening/clarification. Documented in the dev log and PR body.

- Files: `.lintstagedrc.json`, `test/lint-staged.test.ts` (new, isolated temp-git-repo probe)

### Unit 3 — PAF-37: direct-client public-community column isolation — commit `af01c33`

"fix: isolate sensitive community metadata from direct client reads"
Acceptance criteria (verbatim):

- [ ] An authenticated nonmember direct client `SELECT` on a public community cannot read `settings` or `created_by`.
- [ ] Members/Admins retain the settings read/write path used by the server-functions unit.
- [ ] Actor-matrix tests cover direct-client and server-function reads.
- [ ] `pnpm complete-check` passes.

Outcome: new forward-only migration revokes table-wide `SELECT` on `public.communities` and grants only the 9 safe columns to `authenticated`; adds SECURITY DEFINER `get_community_settings(uuid)` (member-only, returns `id`+`settings`) and `update_community_settings(uuid, jsonb)` (admin-only under community-first row lock, SQL-side patch validation, explicit projection without `created_by`). Server functions `updateCommunitySettings` now call the RPC (PG001→NOT_COMMUNITY_ADMIN, 28000→UNAUTHENTICATED); new `getCommunitySettings` (PG001→NOT_COMMUNITY_MEMBER). Public discovery uses the authenticated client, so the 9-column grant is sufficient (no `anon` grant).

- Files: `supabase/migrations/20261010145459_community_column_isolation.sql` (new), `src/features/community/community.functions.ts`, `src/features/community/community.validators.ts`, `src/lib/supabase/database.types.ts`, `test/community.functions.test.ts`, `test/community.integration.test.ts`, `test/community.column-isolation.integration.test.ts` (new), `docs/security/community-column-isolation.md` (new)

## Full diff

Run `git diff origin/main..HEAD` (20 files, +911/−175). Per-file change summary:

- `.lintstagedrc.json` — slash-free oxlint glob.
- `.opencode/agents/delivery-orchestrator.md` — base branch `develop`→`main`.
- `.opencode/agents/subagents/{implementation,bug-fixer,testing-automation,qa-gate}-specialist.md` — bash allowlist: `pnpm audit/install/why/outdated/dedupe`, `corepack pnpm`, qa `complete-check`.
- `AGENTS.md` — Conventions: add Base branch `main`.
- `docs/security/community-column-isolation.md` (new) — ACLs, RPC contracts, role matrix, rollout note.
- `docs/security/dependency-remediation.md` (new) — audit before/after + braces exception.
- `docs/templates/pull-request.md` — base default `develop`→`main`.
- `pnpm-lock.yaml`, `pnpm-workspace.yaml` — 4 dependency overrides applied.
- `src/features/community/community.functions.ts` — settings RPC wiring + error mapping.
- `src/features/community/community.validators.ts` — `validateGetCommunitySettings`, `validateCommunitySettingsPatch`.
- `src/lib/supabase/database.types.ts` — regenerated; new RPC signatures.
- `supabase/migrations/20261010145459_community_column_isolation.sql` (new) — column ACLs + 2 RPCs.
- `test/community.column-isolation.integration.test.ts` (new) — direct-client ACL + actor-matrix (loopback-guarded, CI fail-closed).
- `test/community.functions.test.ts` — RPC mocks/assertions.
- `test/community.integration.test.ts` — safe-columns reads + settings via RPC.
- `test/lint-staged.test.ts` (new) — isolated hook probe (7 cases).

## Fast gate (per unit) — all pass

- Per unit: `pnpm typecheck`, `pnpm lint`, affected `test/**/*.test.ts`.

## QA / full gate result — `pnpm complete-check`

Run once via qa-gate-specialist on HEAD `af01c33`:

- build: pass · knip: pass · typecheck: pass · lint: pass
- test: **40 files / 382 tests passed, 0 failed, 0 skipped** (coverage 100% lines/funcs/statements/branches)
- DB integration suites **executed, not skipped** (local Supabase up): `community.column-isolation.integration.test.ts` (2), `player.integration.test.ts` (14), `community.integration.test.ts` (13), `community.admin.integration.test.ts` (14)
- test:e2e: **53 passed**
- format:check: initially FAIL on the untracked plan artifact only; re-formatted; `pnpm format:check` now exit 0.

QA-result line: PASS (only non-code artifact formatting was fixed after the first run).
