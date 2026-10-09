---
title: PAF-31 Admin governance backend PR1 requests membership roles venues audit
type: development-log
permalink: docs/development-logs/task-PAF-31-admin-governance-backend
---

# Development Log: PAF-31

## Metadata

- Task ID: PAF-31
- Date (UTC): 2026-10-07
- Project: padel-friend
- Branch: `feature/PAF-31-admin-governance` (STACKED on `origin/feature/PAF-30-onboarding-community-discovery`; rebased onto the updated base `7bfa8ce`)
- Commit: `8bdba11` — `feat: add community admin governance backend` (rebased from `3c3b297`)
- Linear: PAF-31 — "PAF-2.6 — Admin governance: requests, membership, roles, settings, venues, audit" (parent PAF-2 / T02). Delivered as **PR1 (backend, plan slices A+B)**; PR2 (UI, slices C+D) follows.

## Objective

- Backend half of admin governance: a transactional membership-transition RPC, an admin-scoped member read model, and the governance server functions (requests, membership, roles, invitation issuing, venue management, audit read) — enforced server-side so members/nonmembers are blocked.
- Plan: `docs/plan/Plan PAF-31 PAF-2.6 — Admin governance requests, membership, roles, settings, venues, audit.md`; findings ledger: `docs/plan/PAF-31-findings.md`; context bundle: `docs/plan/PAF-31-bundle.md`.

## Implementation Summary

- New migration `20261007153621_community_governance_members.sql`:
  - `govern_community_member(uuid, uuid, text)` — SECURITY DEFINER; community-row lock first, active-Admin check, member-row lock; actions approve/deny/remove/reactivate/promote/demote; final-Admin guard; interval closure via `greatest(clock_timestamp(), …)`; custom `PG001`–`PG005` SQLSTATEs.
  - `search_community_members(...)` — SECURITY DEFINER; active-Admin check; literal case-insensitive search; whitelisted fields; newest interval per user; bounded pagination.
  - `community_venues.archived_at` column + grant.
  - `stamp_invitation_revocation` DB-time trigger.
- New `src/features/community/community-admin.functions.ts` — six module-level membership endpoints sharing a `runMemberAction` helper; `searchCommunityMembers`; `listCommunityAudit`; `listCommunityVenues`; venue add/edit/archive; `issueInvitation` (Web Crypto token + SHA-256, hash-only persistence); `revokeInvitation`.
- New `src/features/community/community-admin.validators.ts` — request validators for the endpoints.
- Regenerated `src/lib/supabase/database.types.ts`.
- Tests: new `test/community.admin.functions.test.ts` + `test/community.admin.integration.test.ts` (role matrix, concurrency/final-admin, audit, cross-community isolation, token lifecycle, venue archive).
- Related tasks: parent PAF-2; builds on PAF-30 (onboarding community discovery); PR2 (UI, slices C+D) pending.

## Files Changed

- `supabase/migrations/20261007153621_community_governance_members.sql` (new — governance RPC, member search RPC, venue archive column/grant, invitation revocation trigger)
- `src/features/community/community-admin.functions.ts` (new — governance server functions)
- `src/features/community/community-admin.validators.ts` (new — endpoint validators)
- `src/lib/supabase/database.types.ts` (regenerated)
- `test/community.admin.functions.test.ts` (new)
- `test/community.admin.integration.test.ts` (new)
- `docs/plan/Plan PAF-31 PAF-2.6 — Admin governance requests, membership, roles, settings, venues, audit.md` (plan doc)

## Key Decisions

- Split PAF-31 into 2 stacked PRs: PR1 backend (slices A+B), PR2 UI (slices C+D).
- One transactional membership RPC with six fixed actions (not arbitrary patches); RLS-guarded direct writes for settings/venues/invitations.
- Admin roster read via a narrow SECURITY DEFINER RPC (owner-only profile RLS otherwise blocks cross-user names/levels).
- Venue archive via `archived_at` (no DELETE, preserves history/audit).
- Invitation issuing implemented now (invitee-bound); invite UI deferred.

## Validation Performed

- Review findings fixed: F1 (factory-returned `createServerFn` chains bypassed TanStack endpoint extraction → six explicit module-level chains + shared helper), F2 (over-broad `42501` mapping), F3 (validator edge-whitespace parity), F4 (integration assertions now check persisted rows/intervals).
- `pnpm db:reset` — passed.
- `pnpm db:types` — regenerated types byte-identical.
- `pnpm build` — passed.
- Focused admin + community integration suites ran (not skipped); full `pnpm test` — 332 tests.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check` — green.

## Risks and Follow-ups

- F10 (compiled-endpoint extraction verification) MUST be completed in PR2 — routes will import the six endpoints; deferred until then.
- F5 (.env loader in tests), F6 (venue archive audit detail), F7 (roster DTO nullable typing), F8 (reactivation interval chronology), F9 (direct-write lock order) deferred to a follow-up issue.
- Backend-expansion items from Pencil gaps tracked separately.
