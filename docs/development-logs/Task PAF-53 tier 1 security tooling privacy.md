---
title: PAF-53 PAF-2 follow-up — Tier 1: security, tooling, privacy
type: development-log
permalink: docs/development-logs/task-paf-53-tier-1-security-tooling-privacy
---

# Development Log: PAF-53

## Metadata

- Task ID: PAF-53 (PAF-2 follow-up epic — Tier 1: security, tooling, privacy; Urgent. Contains units PAF-45, PAF-46, PAF-37 plus two user-requested chore units)
- Date (UTC): 2026-10-10
- Project: padel-friend
- Branch: feature/PAF-53-tier-1-security-tooling-privacy (based on `main`; this repo has no `develop`)
- Commit: `77dde76` (HEAD) — `fix: address review findings`. Per-unit commits, in order: `17ca47c`, `b1b5724`, `2948c7f`, `00d14b6`, `0a9efd6`, `af01c33`, `77dde76`
- Reviewers: code-review + architecture-review (UX/UI review skipped — no UI files changed in this delivery)

## Objective

- Deliver the Tier 1 follow-up to PAF-2 as one feature branch and one PR: remediate vulnerable dependencies (PAF-45), fix the lint-staged oxlint glob (PAF-46), and isolate sensitive community columns from direct client reads (PAF-37), preceded by two user-approved tooling/docs chores that unblocked the work.

## Implementation Summary

- **Unit 1 — Docs chore (user-requested, not in Linear)** — `17ca47c` `chore: align base branch docs with main`. Base/development branch is `main`; corrected `AGENTS.md`, `.opencode/agents/delivery-orchestrator.md`, `docs/templates/pull-request.md`.
- **Unit 2 — Tooling config fix (user-approved unblock)** — `b1b5724` `chore: allow dependency-audit commands for specialist agents` + `2948c7f` `chore: allow corepack pnpm for registry operations`. Specialist bash allowlists blocked `pnpm audit/install/why`; added those plus `corepack pnpm` (the mise standalone pnpm could not reach the npm registry here — fetch failed ENOTFOUND/error 23; `corepack pnpm` on system Node works). Also added `pnpm complete-check` to the QA agent (`qa-gate-specialist.md`).
- **Unit 3 — PAF-45: Fix Dependabot vulnerabilities** — `00d14b6` `fix: remediate vulnerable transitive dependencies`. 10 Dependabot alerts (2 critical, 3 high): undici ×6, tinypool ×2, sharp ×1, source-map-js ×1. Fixed via `overrides` in `pnpm-workspace.yaml` (sharp 0.35.5, tinypool 2.1.2, undici 7.29.1, source-map-js 1.2.2). One extra high `braces` (GHSA-vfj7-8cjw-p6xm) found by `pnpm audit` is UNFIXABLE (newest published `braces` is 3.0.3; the advisory fix `>=3.0.4` does not exist) and documented as an accepted exception with monitoring. Post-fix audit: 0 critical, 0 moderate, 0 low, 1 high. `package.json` intentionally untouched. New `docs/security/dependency-remediation.md`.
- **Unit 4 — PAF-46: lint-staged oxlint glob** — `0a9efd6` `fix: use slash-free lint-staged glob for nested source files`. Key `!(src/lib/supabase/database.types.ts)*.{ts,tsx,js,mjs}` → `*.{ts,tsx,js,mjs}`; generated-file exclusion is handled via `.oxlintrc.json` `ignorePatterns`. New `test/lint-staged.test.ts` (isolated temp git repo). HONEST FINDING: the legacy glob already matched/linted nested files (verified) — the reported bug was not reproducible; the change is a hardening/clarification, not a bug fix.
- **Unit 5 — PAF-37: community column isolation** — `af01c33` `fix: isolate sensitive community metadata from direct client reads`. New forward-only migration `supabase/migrations/20261010145459_community_column_isolation.sql`: revoke table-wide SELECT on `public.communities`, grant 9 safe columns to `authenticated`; add SECURITY DEFINER `get_community_settings(uuid)` (member-only, returns id + settings) and `update_community_settings(uuid, jsonb)` (admin-only under community-first lock, SQL patch validation, projection without `created_by`); revoke EXECUTE from public/anon. Server functions wired to the RPCs with error mapping (PG001 → NOT_COMMUNITY_ADMIN / NOT_COMMUNITY_MEMBER, 28000 → UNAUTHENTICATED). New `test/community.column-isolation.integration.test.ts` (actor matrix), adapted `test/community.functions.test.ts` + `test/community.integration.test.ts`, regenerated `src/lib/supabase/database.types.ts`, new `docs/security/community-column-isolation.md`.
- **Unit 6 — Review follow-up** — `77dde76` `fix: address review findings`. F1 major (Git-env isolation in `test/lint-staged.test.ts`), F3 minor (session-less anonymous probe + exact 42501 assertion), F4 minor (doc error code). F2 minor DEFERRED (generated types nullable-column typing).

## Files Changed

- Unit 1 (base-branch docs): `AGENTS.md`, `.opencode/agents/delivery-orchestrator.md`, `docs/templates/pull-request.md`.
- Unit 2 (agent allowlists): `.opencode/agents/subagents/bug-fixer-specialist.md`, `.opencode/agents/subagents/implementation-specialist.md`, `.opencode/agents/subagents/testing-automation-specialist.md`, `.opencode/agents/subagents/qa-gate-specialist.md`.
- Unit 3 (PAF-45): `pnpm-workspace.yaml` (dependency `overrides`), `pnpm-lock.yaml` (regenerated), `docs/security/dependency-remediation.md` (new).
- Unit 4 (PAF-46): `.lintstagedrc.json` (slash-free oxlint glob), `test/lint-staged.test.ts` (new; further hardened in Unit 6).
- Unit 5 (PAF-37): `supabase/migrations/20261010145459_community_column_isolation.sql` (new), `src/features/community/community.functions.ts` (RPC wiring + error mapping), `src/features/community/community.validators.ts`, `src/lib/supabase/database.types.ts` (regenerated), `test/community.column-isolation.integration.test.ts` (new), `test/community.functions.test.ts` (adapted), `test/community.integration.test.ts` (adapted), `docs/security/community-column-isolation.md` (new).
- Unit 6 (review follow-up): `test/lint-staged.test.ts` (F1 Git-env isolation), `test/community.column-isolation.integration.test.ts` (F3 anonymous probe + exact 42501), `docs/security/community-column-isolation.md` (F4 error code).
- No UI files were changed in this delivery.

## Key Decisions

- One feature branch off `main`, one PR, one commit per unit of work.
- Transitive-dependency fixes applied via `overrides` in `pnpm-workspace.yaml` instead of touching `package.json` (which was intentionally left untouched).
- `braces` high advisory (GHSA-vfj7-8cjw-p6xm) accepted as unfixable — no patched version exists upstream — and documented as an accepted exception with monitoring.
- PAF-46: keep generated-file exclusion in `.oxlintrc.json` `ignorePatterns` and simplify the lint-staged key to a slash-free glob; change recorded honestly as hardening, not a reproducible-bug fix.
- PAF-37: enforce column isolation in Postgres (revokes + column grants) with SECURITY DEFINER RPCs as the only write/settings path; community-first lock ordering, SQL patch validation, `created_by` excluded from projections; error mapping centralized in server functions (PG001, 28000).
- Migration is forward-only; production rollout coordination documented in `docs/security/community-column-isolation.md`.

## Validation Performed

- Per-unit fast gate green after each unit.
- Full `pnpm complete-check` (run once via QA agent): build / knip / typecheck / lint pass; `pnpm test` 40 files / 382 tests pass (0 skipped); DB integration suites EXECUTED (community.column-isolation 2, player 14, community 13, community.admin 14); `pnpm test:e2e` 53 passed; coverage 100%.
- `pnpm audit` post-fix: 0 critical, 0 moderate, 0 low, 1 high (the accepted-unfixable `braces` advisory).
- `format:check` initially failed only on the untracked plan artifact; artifact re-formatted; now exit 0.
- Reviews: code-review + architecture-review completed; UX/UI review skipped (no UI files). Delta re-review confirmed F1/F3/F4 fixed with no regressions.

## Risks and Follow-ups

- **Environment:** mise standalone pnpm cannot reach the npm registry in this environment; use `corepack pnpm` for registry operations. Agent allowlists updated accordingly (2 chore commits).
- **`braces` high advisory accepted-unfixable** — monitor upstream for a `>=3.0.4` release and bump when published.
- **F2 deferred (minor):** generated RPC result types mark nullable columns as non-null; consider an accurate feature-level response type later.
- **PAF-37 rollout:** migration is forward-only; production rollout must coordinate the revoke/grant + RPC deployment — see `docs/security/community-column-isolation.md`.
- UX/UI review not applicable — no UI files changed.
