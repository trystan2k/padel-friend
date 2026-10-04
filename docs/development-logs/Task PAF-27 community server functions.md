---
title: PAF-27 Server functions: community create, settings, initial Admin assignment
type: development-log
permalink: docs/development-logs/task-PAF-27-community-server-functions
---

# Development Log: PAF-27

## Metadata

- Task ID: PAF-27
- Date (UTC): 2026-10-03
- Project: padel-friend
- Branch: `feature/PAF-27-community-server-functions` (stacked on `origin/feature/PAF-33-regenerate-supabase-database-types` @ `3804c29`)
- Commit: `729d082` — `feat: add community creation and admin settings server functions`
- Linear: PAF-27 — "PAF-2.2 — Server functions: community create, settings, initial Admin assignment" (parent PAF-2 / T02)

## Objective

- Deliver the first server boundary for communities: `createCommunity` (Public/Private + join policy, creator becomes sole initial Admin) and `updateCommunitySettings` (Admin-only), authenticated via `getClaims()`, RLS-respecting.
- Plan: `docs/plan/Plan PAF-27 PAF-2.2 — Server functions: community create, settings, initial Admin assignment.md`; findings ledger: `docs/plan/PAF-27-findings.md`; context bundle: `docs/plan/PAF-27-bundle.md`.

## Implementation Summary

- New migration `20261002105936_community_join_policy.sql`:
  - Enum `community_join_policy` (`instant` | `admin_approval`).
  - `communities.join_policy` NOT NULL DEFAULT `admin_approval`; grant `UPDATE(join_policy)`.
  - Drop + recreate `create_community` with a required `p_join_policy` third arg (single signature, no overload).
- Regenerated `src/lib/supabase/database.types.ts` (enum, column, new RPC arg).
- New `src/features/community/community.validators.ts`: strict allowlists, SQL-parity limits, cycle-safe JSON settings check, PostgreSQL-compatible string guard (`pgText`), `INVALID_COMMUNITY_INPUT`.
- New `src/features/community/community.functions.ts`: `createCommunity` (RPC) and `updateCommunitySettings` (direct RLS-guarded UPDATE; zero rows → `NOT_COMMUNITY_ADMIN`).
- Tests: new `test/community.functions.test.ts` (mocked boundary) and updated `test/community.integration.test.ts` (new RPC signature + real-JWT scenarios).
- Related tasks: parent PAF-2; builds on PAF-26 (domain model) and PAF-33 (types regeneration base).

## Files Changed

- `supabase/migrations/20261002105936_community_join_policy.sql` (new — join policy enum, column, RPC signature change)
- `src/lib/supabase/database.types.ts` (regenerated — enum, column, new RPC arg)
- `src/features/community/community.validators.ts` (new — input validation)
- `src/features/community/community.functions.ts` (new — `createCommunity`, `updateCommunitySettings`)
- `test/community.functions.test.ts` (new — mocked boundary tests)
- `test/community.integration.test.ts` (updated — new RPC signature, real-JWT scenarios)
- Plan doc (committed)

## Key Decisions

- Join policy is a typed enum column + extended RPC, not `settings` jsonb — type safety over schemaless blob.
- Settings updates use a direct RLS-guarded UPDATE; zero returned rows → `NOT_COMMUNITY_ADMIN` — same error for non-admin and unknown ID, no existence oracle.
- RPC signature change is breaking for PAF-26's integration calls, which were updated accordingly.
- Stacked PR: PAF-27 targets the PAF-33 branch, not `main`.

## Validation Performed

- `pnpm db:reset` — clean.
- `pnpm db:types` run twice → byte-identical output (SHA-256 `4915f0b3…`).
- `pnpm exec vitest run test/community.functions.test.ts test/community.integration.test.ts` → 19/19 passing (integration ran).
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` (278 tests) — all green.

### Review Findings

- Fixed: F2 (PostgreSQL-invalid strings — NUL/unpaired surrogates — now rejected by `pgText`).
- Deferred: F1 (settings JSON byte cap vs JSONB limit), F3 (JSONB size CHECK error mapping), F4 (handler denial coverage for hidden-private targets and demoted admins).

## Risks and Follow-ups

- F1/F3/F4 deferred — track in a follow-up issue.
- PAF-28 (discovery), PAF-29 (join flows), PAF-31 (admin governance) build on this boundary.
- Mitigation: findings ledger `docs/plan/PAF-27-findings.md` records deferred items with rationale.
