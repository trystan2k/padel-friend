---
title: PAF-29 Join flows public self-join private invitations approval handling edge cases
type: development-log
permalink: docs/development-logs/task-PAF-29-join-flows
---

# Development Log: PAF-29

## Metadata

- Task ID: PAF-29
- Date (UTC): 2026-10-07
- Project: padel-friend
- Branch: `feature/PAF-29-join-flows` (stacked on `origin/feature/PAF-28-public-community-discovery` @ `db0078e`)
- Commit: `666a175` — `feat: add secure community join and invitation acceptance`
- Linear: PAF-29 — "PAF-2.4 — Join flows: public self-join, private invitations, approval handling, edge cases" (parent PAF-2 / T02)

## Objective

- Join flows for both visibilities: public self-join (instant → active, admin-approval → pending) and invitee-bound private invitation acceptance with atomic token consumption, plus duplicate/expired/reused/invalid handling and guest rejection.
- Plan: `docs/plan/Plan PAF-29 PAF-2.4 — Join flows: public self-join, private invitations, approval handling, edge cases.md`; findings ledger: `docs/plan/PAF-29-findings.md`; context bundle: `docs/plan/PAF-29-bundle.md`.

## Implementation Summary

- New migration `supabase/migrations/20261007083756_community_join_flows.sql` with two `SECURITY DEFINER` RPCs:
  - `join_public_community(uuid)` — public self-join: instant policy → active membership, admin-approval policy → pending membership.
  - `accept_community_invitation(text)` — invitee-bound acceptance: hashes the raw token via `extensions.digest(p_token,'sha256')`, locks the invitation `FOR UPDATE`, enforces invitee-bound match + unexpired/unredeemed/unrevoked, inserts the membership, and consumes the token atomically.
  - Both RPCs: `set search_path = ''`, identity from `auth.uid()`, distinct SQLSTATEs (`PJ001`–`PJ007`), explicit EXECUTE revokes/grants.
- Regenerated `src/lib/supabase/database.types.ts` for the new RPCs.
- Added `validateJoinCommunity` / `validateAcceptInvitation` (and a shared `communityId` UUID helper) to `src/features/community/community.validators.ts`.
- Added POST `joinCommunity` / `acceptInvitation` server functions to `src/features/community/community.functions.ts` with exact error-code mapping.
- New `test/community.join.functions.test.ts`; extended `test/community.integration.test.ts` with instant, approval, invited, duplicate, expired, reused, invalid, and guest cases; pending-member RLS; concurrency races.
- Related tasks: parent PAF-2; builds on PAF-28 (discovery); PAF-31 (invitation issuance + admin approve/deny) builds on this.

## Files Changed

- `supabase/migrations/20261007083756_community_join_flows.sql` (new — two SECURITY DEFINER RPCs, SQLSTATEs, grants)
- `src/lib/supabase/database.types.ts` (regenerated)
- `src/features/community/community.validators.ts` (added `validateJoinCommunity`, `validateAcceptInvitation`, shared `communityId` UUID helper)
- `src/features/community/community.functions.ts` (added POST `joinCommunity`, `acceptInvitation` with exact error-code mapping)
- `test/community.join.functions.test.ts` (new — join/accept function tests)
- `test/community.integration.test.ts` (extended — instant, approval, invited, duplicate, expired, reused, invalid, guest; pending-member RLS; concurrency races)
- Plan doc (committed)

## Key Decisions

- Invitee-bound token: acceptance requires `invitee_user_id = auth.uid()` AND a valid raw token.
- Invitation issuance deferred to PAF-31; tests seed invitations via the admin RLS INSERT.
- Two narrow SECURITY DEFINER RPCs instead of broad new RLS policies (minimal privilege, atomic membership + redemption).

## Validation Performed

- `pnpm db:reset` — clean; `pnpm db:types` twice byte-identical.
- Focused: `test/community.join.functions.test.ts` + `test/community.integration.test.ts` → 24/24 passing (integration ran).
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` (300 tests) — all green.

### Review Findings

- Fixed: F1 (redemption assertion now fails on a failed lookup and proves the timestamp unchanged after reuse).
- Deferred: F2 (flaky 1.2s expiry fixture), F3 (plan-doc scope drift after the PAF-31 issuance deferral), F4 (missing closed-history rejoin / visibility-flip tests).

## Risks and Follow-ups

- F2/F3/F4 deferred (follow-up issue).
- PAF-31 owns invitation issuance and admin approve/deny; must preserve the `PJ***` error meanings and the ASCII-hex token hashing contract.
