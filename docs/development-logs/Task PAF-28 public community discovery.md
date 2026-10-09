---
title: PAF-28 Public community discovery + privacy isolation
type: development-log
permalink: docs/development-logs/task-PAF-28-public-community-discovery
---

# Development Log: PAF-28

## Metadata

- Task ID: PAF-28
- Date (UTC): 2026-10-04
- Project: padel-friend
- Branch: `feature/PAF-28-public-community-discovery` (stacked on `origin/feature/PAF-27-community-server-functions` @ `fde1f03`)
- Commit: `39a7efe` — `feat: add public community discovery with privacy-safe responses`
- Linear: PAF-28 — "PAF-2.3 — Public community discovery + privacy isolation" (parent PAF-2 / T02)

## Objective

- Public community discovery: authenticated users list/search Public communities and fetch public detail with only public-safe fields; nonmembers cannot enumerate or fetch private communities. Privacy via RLS (rows) + server-side column projection (payload).
- Plan: `docs/plan/Plan PAF-28 PAF-2.3 — Public community discovery + privacy isolation.md`; findings ledger: `docs/plan/PAF-28-findings.md`; context bundle: `docs/plan/PAF-28-bundle.md`.

## Implementation Summary

- Added `listPublicCommunities` (search + pagination) and `getPublicCommunity` to `src/features/community/community.functions.ts`:
  - Both `createServerFn({ method: 'GET' })`, authenticated via `requireAuthenticatedClient()`.
  - One explicit 9-column projection (`id, name, description, logo_path, city_label, visibility, join_policy, created_at, updated_at`) with `visibility = 'public'`.
- Added `validateListPublicCommunities` / `validateGetPublicCommunity` to `community.validators.ts`.
- New `test/community.discovery.functions.test.ts`; extended `test/community.integration.test.ts` with a real-JWT actor matrix and direct-client private-row leakage probes.
- Private and missing IDs both return `null` (no existence oracle).
- Related tasks: parent PAF-2; builds on PAF-27 (server functions boundary); PAF-29 (join flows) and PAF-30 (onboarding step 3) build on this discovery.

## Files Changed

- `src/features/community/community.functions.ts` (added `listPublicCommunities`, `getPublicCommunity`)
- `src/features/community/community.validators.ts` (added `validateListPublicCommunities`, `validateGetPublicCommunity`)
- `test/community.discovery.functions.test.ts` (new — discovery function tests)
- `test/community.integration.test.ts` (extended — real-JWT actor matrix, direct-client private-row leakage probes)
- Plan doc (committed)

## Key Decisions

- Public-safe fields = 9 community basics; exclude `settings` and `created_by`.
- AC4 scoped to server-function payloads; direct-client `SELECT *` on public communities may still expose `settings`/`created_by` under PAF-26 grants (documented limitation, not claimed fixed).
- Matches-specific RLS/test deferred to PAF-4.

## Validation Performed

- `pnpm db:reset` — clean (no schema change).
- Focused: `test/community.discovery.functions.test.ts` + `test/community.integration.test.ts` → 19/19 passing (integration ran).
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` (287 tests) — all green.

### Review Findings

- Fixed: F1 (PostgREST `*` treated as a wildcard — confirmed empirically and fixed by switching search to regex-escaped `imatch`).
- Fixed: F2 (cap-crossing `next_offset` rejected by the validator — now `null` beyond the offset cap).

## Risks and Follow-ups

- Direct-client public-column isolation (`settings`/`created_by`) is a known limitation — candidate follow-up issue.
- PAF-29 (join flows), PAF-30 (onboarding step 3) build on this discovery.
- Mitigation: findings ledger `docs/plan/PAF-28-findings.md` records items with rationale.
