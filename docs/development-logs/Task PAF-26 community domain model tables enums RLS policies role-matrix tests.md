---
title: PAF-26 PAF-2.1 Community domain model tables enums RLS policies role-matrix tests
type: development-log
permalink: docs/development-logs/task-paf-26-community-domain-model-tables-enums-rls-policies-role-matrix-tests
---

# Development Log: PAF-26

## Metadata

- Task ID: PAF-26 (PAF-2.1 — Community domain model: tables, enums, RLS policies, role-matrix tests; parent PAF-2 / T02)
- Date (UTC): 2026-10-02T08:30:29Z
- Project: padel-friend
- Branch: feature/PAF-26-community-domain-model (base origin/main @ `efc83b7`)
- Commits:
  - `c752ad2` (full hash `c752ad28eeb7febe3a46542240b0dcf784fe5cd7`) — `feat: add community domain schema and role-matrix coverage` (2026-10-02T09:13:23+02:00)
  - `5d43011` (full hash `5d43011db6aff2799a9139332b65690311a4ff47`) — `fix: address review findings` (2026-10-02T10:30:29+02:00)
- Plan: `docs/plan/Plan PAF-26 PAF-2.1 — Community domain model: tables, enums, RLS policies, role-matrix tests.md`
- Findings ledger: `docs/plan/PAF-26-findings.md`
- Context bundle: `docs/plan/PAF-26-bundle.md`

## Objective

- Implement the community domain model in Supabase: community visibility/role/membership enums, the five community tables with membership validity intervals, RLS helper functions, an atomic `create_community` RPC, explicit grants with per-command RLS, history/last-admin/invitation guards, `updated_at` touch triggers, and audit triggers — plus a real-JWT integration test role matrix covering the acceptance criteria.

## Implementation Summary

- **Enums (3)**: `community_visibility`, `community_member_role`, `community_membership_status` created in `supabase/migrations/20261002055953_community_domain.sql`.
- **Tables (5)**: `communities`, `community_members`, `community_invitations`, `community_venues`, `community_audit_log`. Membership rows carry validity intervals (`valid_from`/`valid_until`) plus `activated_at`.
- **RLS helpers**: `is_community_member`, `is_community_admin`, `can_read_community` — reusable predicates intended for consumption by later phases.
- **RPC**: `create_community` performs the atomic creator → sole active admin bootstrap in one transaction.
- **Security posture**: explicit grants + per-command RLS; history/last-admin/invitation guards; `updated_at` touch triggers; audit triggers writing `community_audit_log`.
- **Integration tests**: `test/community.integration.test.ts` drives a role matrix of 7 actors + anon with real JWTs, covers AC1–AC7, filtered/unfiltered negative probes, the last-admin race, and activation-interval chronology.
- **Review rounds**: 10 findings raised; fixed F1 (inactive NULL-end CHECK), F2 (invitation first-redemption), F3 (pending/activation model via `activated_at`), F4 (`updated_at` triggers), F5 (pending own-row probe), F6 (open-invitation denial probe), F10 (activation-interval chronology). Deferred: F7 (fixture setup in first test), F8 (inactive actor drift), F9 (audit detail for settings/venue changes) — tracked under Risks and Follow-ups.
- Subtask structure: single-task delivery under parent PAF-2 / T02; no separate subtask issues.

## Files Changed

- **Database migration**: `supabase/migrations/20261002055953_community_domain.sql` (new) — enums, tables, intervals, RLS helpers, `create_community` RPC, grants + per-command RLS, guards, touch/audit triggers.
- **Tests**: `test/community.integration.test.ts` (new) — real-JWT role matrix (7 actors + anon), AC1–AC7, negative probes, last-admin race, activation-interval chronology.
- **Docs**: `docs/plan/Plan PAF-26 PAF-2.1 — Community domain model: tables, enums, RLS policies, role-matrix tests.md` (new, committed).
- **Excluded**: `src/lib/supabase/database.types.ts` regeneration intentionally not committed (see Key Decisions).

## Key Decisions

- Matches schema/RLS deferred to PAF-4; PAF-26 exposes the reusable RLS helpers (`is_community_member`, `is_community_admin`, `can_read_community`) for PAF-4 to consume.
- `src/lib/supabase/database.types.ts` regeneration excluded from this task: pinned Supabase CLI 2.118.0 emits a non-reproducible dense format versus the committed pretty-printed file. Tracked as follow-up PAF-33.
- Base branch is `main` (the repo has no `develop` branch).
- PR size gate exceeded (966 lines) and explicitly accepted by the user.

## Validation Performed

- `pnpm db:reset`: clean.
- `pnpm exec vitest run test/community.integration.test.ts`: 9/9 tests executed (not skipped) against local Supabase.
- `pnpm typecheck`: green.
- `pnpm lint`: green.
- `pnpm format:check`: green.
- `pnpm test`: green (268 tests).

## Risks and Follow-ups

- **PAF-33**: regenerate/normalize Supabase generated types (`src/lib/supabase/database.types.ts`) once a reproducible CLI output format is settled.
- **F7–F9 deferred review findings**: F7 fixture setup in the first test, F8 inactive actor drift, F9 audit detail for settings/venue changes.
- **PAF-4** owns match RLS and must build on `can_read_community`.
- **PAF-27** server functions must verify `getClaims()` and rely on the RLS shipped here.
