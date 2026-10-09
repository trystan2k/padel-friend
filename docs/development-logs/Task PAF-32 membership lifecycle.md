---
title: PAF-32 Membership Lifecycle
type: development-log
permalink: docs/development-logs/task-PAF-32-membership-lifecycle
---

# Development Log: PAF-32

## Metadata

- Task ID: PAF-32 (PAF-2.7 — membership lifecycle; parent PAF-2/T02, final PAF-2 sub-issue)
- Date (UTC): 2026-10-08T19:08:15Z
- Updated (UTC): 2026-10-09 — F1 corrective migration and final delivery verification
- Project: padel-friend
- Branch: `feature/PAF-32-membership-lifecycle` (stacked on `origin/feature/PAF-31-admin-governance-ui` @ `6c854bb`)
- Commit: `a7c119f` — `feat: complete community membership lifecycle`; F1 corrective migration pending commit
- Plan: `docs/plan/Plan PAF-32 PAF-2.7 — Membership lifecycle - leave-removal-reactivation, history preservation, final E2E.md`
- Findings ledger: `docs/plan/PAF-32-findings.md`
- Context bundle: `docs/plan/PAF-32-bundle.md`

## Objective

- Deliver the final PAF-2 lifecycle slice in one PR: member leave, inactive re-entry blocks, owner-scoped membership history, sporting-profile DTO privacy assertion, localized onboarding feedback and a real-backend lifecycle E2E journey.

## Implementation Summary

- Added a SECURITY DEFINER `leave_community` RPC with authenticated identity checks, community-before-membership lock order, safe PL001/PL002 errors, last-admin protection and interval-closing UPDATE only.
- Replaced the public-join and invitation-acceptance RPC bodies while preserving PJ001–PJ007 ordering; PJ008 now blocks users with prior inactive membership after checking open memberships.
- F1 review fix: added `20261009061318_community_reactivation_interval_order.sql`, `CREATE OR REPLACE` of `govern_community_member` (reactivate branch sets `valid_from = greatest(clock_timestamp(), max(closed valid_until))`) and `guard_community_member` (active INSERT stamps `activated_at = greatest(valid_from, clock_timestamp())`), guaranteeing interval chronology on reactivation; covered by the updated admin integration test.
- Added validated `leaveCommunity` POST and owner-scoped `getMyMembershipTimeline` GET server functions. Timeline returns a narrow seven-field interval DTO, deterministic ordering and limit+1 pagination.
- Mapped inactive joins to terminal translated feedback in community onboarding for en, pt-BR and es. Added exact 11-key sporting profile DTO privacy coverage.
- Added real-JWT integration coverage for active/pending leave, leave/removal blocks, unredeemed invitations, reactivation intervals, final-admin/concurrent admin leave, timeline ownership, venue access restoration and unchanged player profile/rating rows.
- Added `e2e/community-lifecycle.spec.ts`: shipped UI covers create/discover/join/approve/remove/reactivate; direct JWT calls cover invitation redemption and member leave. The existing invitation-issuance implementation writes via the authenticated owner client/RLS, so test setup uses the same real-JWT INSERT contract; no database issuance RPC or invitation UI exists.
- Formatted the supplied plan document without changing its content so repository-wide `pnpm format:check` passes.

## Files Changed

- Database: `supabase/migrations/20261008184607_community_membership_lifecycle.sql`; `supabase/migrations/20261009061318_community_reactivation_interval_order.sql` (F1 corrective, pending commit); generated `src/lib/supabase/database.types.ts`.
- Community feature: `src/features/community/community.functions.ts`, `src/features/community/community.validators.ts`, `src/features/community/CommunityOnboarding.tsx`.
- Localization: `src/locales/en/translation.json`, `src/locales/pt-BR/translation.json`, `src/locales/es/translation.json`.
- Tests: `test/community.lifecycle.functions.test.ts`, `test/community.join.functions.test.ts`, `test/community.integration.test.ts`, `test/community.admin.integration.test.ts`, `test/community.onboarding.test.tsx`, `test/player.integration.test.ts`.
- Browser verification: `e2e/community-lifecycle.spec.ts`.
- Task documentation: this log and formatting-only normalization of the supplied PAF-32 plan.

## Key Decisions

- One large PR accepted by the user; no split.
- Leave and Admin removal both produce inactive intervals. Inactive memberships block public join and valid private invitation acceptance until Admin reactivation. Reactivation inserts a new row; the old inactive interval remains unchanged. Existing open-row PJ006 precedence remains ahead of PJ008.
- AC1–2 amendment certifies membership-history preservation only, recorded as a PAF-32 Linear comment. No match or League tables/history queries exist in this stack. Match/League fact preservation/queryability is deferred; no substitute tables were fabricated and AC2 is not claimed passed.
- No leave/timeline screens, additional Admin actions, dependencies, service-role client or coverage-threshold changes.
- Final E2E is hybrid and uses isolated local actors, publishable-key JWTs, no mocks and no committed auth state. Invitation accept and member leave use real database RPCs. Issuance setup follows current real-JWT RLS insert contract because existing `issueInvitation` has no database RPC.

## Validation Performed

- `pnpm db:start` — local stack already running.
- `pnpm db:reset` — passed; applied new migration. CLI warned that optional `supabase/seed.sql` was absent.
- `pnpm db:types` — run twice; both generated file hashes matched: `17ae89c5448e32b2f4a3c49a9ac216b48e96d0204f5a4469fcdec2fb1bf32d99`.
- `pnpm exec vitest run test/community.lifecycle.functions.test.ts test/community.join.functions.test.ts test/community.integration.test.ts test/community.admin.integration.test.ts test/player.integration.test.ts` — 5 files, 62 tests passed; all real-backend suites ran against loopback Supabase, no skips. Re-run after the F1 fix: all 5 integration suites executed.
- `pnpm typecheck` — passed.
- `pnpm lint` — passed.
- `pnpm format:check` — passed.
- `pnpm test` — 371 tests passed on the final post-F1 run (38 files, 369 tests at the pre-fix run). Existing jsdom `scrollTo` and Vitest process-close warnings were non-fatal; coverage thresholds remained unchanged.
- `pnpm exec playwright test e2e/community-lifecycle.spec.ts --repeat-each=3 --reporter=list` — 3/3 passed.
- `pnpm test:e2e` — 53/53 passed, including the new lifecycle flow and existing onboarding/admin visual gates; no screenshot budget changed.
- `git diff --numstat origin/feature/PAF-31-admin-governance-ui` — 13 tracked files; 553 insertions, 5 deletions. Includes a pre-existing `.opencode/agents/subagents/implementation-specialist.md` change; Git omits the untracked plan, migration, lifecycle tests and E2E file.
- `git diff --shortstat origin/feature/PAF-31-admin-governance-ui` — 13 files changed, 553 insertions(+), 5 deletions(-); same tracked/untracked caveat.

## Risks and Follow-ups

- Actual historical match and League facts remain unverified and deferred until those schemas and authorized history paths exist. Green membership tests cannot satisfy that missing data acceptance.
- Browser invitation issuance remains unsupported; E2E uses owner-JWT RLS persistence and existing server issuance integration coverage, while acceptance is exercised through the real database RPC.
- Vitest prints a non-fatal server-close timeout warning after otherwise successful test shutdown; tests report clean completion.
- Review findings: F1 (reactivation interval chronology) fixed via `20261009061318_community_reactivation_interval_order.sql` plus the updated admin integration test. Deferred to a follow-up issue: F2 (timeline pagination real-JWT coverage), F3 (timeline truncation-vs-exhaustion indicator), F4/F5 (queued-chronology test determinism and lock-holder hardening). UX/UI review: no findings.
- Delivery: `a7c119f` committed on `feature/PAF-32-membership-lifecycle` (`feat: complete community membership lifecycle`); F1 corrective migration, its test update and plan docs pending commit.
