---
title: PAF-4 Create and Discover Match Events
type: development-log
permalink: docs/development-logs/task-PAF-4-create-and-discover-match-events
---

# Development Log: PAF-4

## Metadata

- Task ID: PAF-4 (T04 — Create and discover Match Events; AFK; US-003/US-009/US-011; PRD §§13–16, 43.2, 43.3, 52–53); deliberated into sub-issues PAF-71…PAF-76
- Date (UTC): 2026-10-17
- Project: padel-friend
- Branch: feature/PAF-4-t04-create-and-discover-match-events (base `b24d1b1`, the PAF-3 merge on `main`)
- Commits (10, delivery order): `222671c` (PAF-71), `cbbf30d` (PAF-72), `db9e1dc` (PAF-73), `da47ff0` (PAF-74), `23e1e5f` (PAF-75), `7524f3d` (E2E-runnability fixes), `907a5c0` (PAF-76), `90b0beb` (QA-gate fixes), `96f6aea` (iteration-1 review fixes), `3fa732c` (iteration-2 review fixes, head)
- Working tree at logging time: only `docs/plan/PAF-4-findings.md` modified and uncommitted (post-gate ledger update; the `.gitignore` `.DS_Store` entry and the plan/bundle artifacts were already committed inside `3fa732c` and `96f6aea` respectively — verified via `git status --porcelain`)
- Linear: PAF-4 with children PAF-71…PAF-76; one branch, one pull request (~114 files / ~11k insertions vs `main`)
- Artifacts: plan `docs/plan/Plan PAF-4 T04 — Create and discover Match Events.md`, bundle `docs/plan/PAF-4-bundle.md`, findings ledger `docs/plan/PAF-4-findings.md` (F1–F31; all blocking fixed; F20–F25 deferred)

## Objective

- A signed-in player can create a match event (friendly or ranked context, single or team mode, venue photo), publish it atomically, discover it (community-open or via direct invitation) through an Available/My Matches/Past discovery surface, open it through a shareable `/matches/<uuid>` deep link that survives login/OAuth/onboarding, and see it reflected in the notification center — with visibility, photo privacy, and eligibility enforced end to end (schema → RLS → server functions → UI → E2E).

## Implementation Summary

- **Unit 1 — PAF-71, commit `222671c` — schema, enums, RLS.**
  - `public.match_events`, `public.match_event_registrations` (creator auto-accepted) and `public.match_event_invites`, with exactly two event visibilities (`community_open`, `invite_only`) and no `private` event visibility ("private" is a community type, not an event one). RLS is enforced via a private-event predicate plus the `can_read_match_event(uuid)` helper. Migration `20261016120000_match_event_domain.sql`, regenerated `database.types.ts`, and integration suites for schema and visibility.
- **Unit 2 — PAF-72, commit `cbbf30d` — authorized venue photo storage.**
  - Private `match-event-photos` bucket with canonical `community/event/uploader/object.ext` object keys, staging vs published read isolation, and a shared advisory lock for publish/delete. Browser-direct authorized staging upload with server-side finalization (a POST server function could not carry a `File`). New `match-photo.functions.ts` / `match-photo.server.ts` / `match-photo.ts`, migration `20261016120100_match_event_photos.sql`, photo integration + unit suites.
- **Unit 3 — PAF-73, commit `db9e1dc` — publication, discovery, deep link.**
  - One atomic `publish_match_event` RPC (validation, photo object verification, creator auto-registration, deduplicated invites) that is idempotent on replay compared against the IMMUTABLE persisted snapshot, plus keyset-paginated discovery reads (`matches.functions.ts`, `matches.validators.ts`, `match-model.ts`, `match-time.ts`). The `/matches/<uuid>` deep link is carried through login/OAuth/onboarding via `optionalReturnPath`, which omits the default `/dashboard` so plain logins stay clean. Migration `20261016120200_match_event_functions.sql`; publication + discovery integration suites.
- **Unit 4 — PAF-74, commit `da47ff0` — notifications.**
  - Match-event notifications reuse the PAF-3 store with transactional producers (migration `20261016120300_match_event_notifications.sql`); an additive `get_my_notification_target_v2` preserves v1 community consumers, and a bounded authorized match-context RPC backs the notification detail page. Notification center/detail updates plus a large producer/consumer integration suite.
- **Unit 5 — PAF-75, commit `23e1e5f` — creation, discovery and detail UI.**
  - `CreateMatchPage` (details form, players/invitee picker, photo upload, review), `MatchesPage` discovery with cards, and `MatchDetailPage`; StyleX with design tokens only, Base UI primitives, en/pt-BR/es parity, ≥44px touch targets, exactly one `aria-current`, reference-faithful 18px gutter / 8–10px rhythm / green primary actions. New protected routes (`matches`, `matches.create`, `matches.my`, `matches.past`, `matches.$eventId`) and i18n/list/detail/style test suites.
- **E2E-runnability fix commit `7524f3d` (`fix: correct match event photo preview, discovery, and eligibility states`).**
  - Fixes found while making the E2E suite runnable: photo preview and finalization, discovery states, and eligibility state handling across UI, photo functions/server, the functions migration, and affected tests.
- **Unit 6 — PAF-76, commit `907a5c0` — E2E + visual regression.**
  - `e2e/matches.spec.ts` (functional journeys), `e2e/matches-visual.spec.ts` (visual/structural), Pencil-derived reference images under `e2e/references/paf-4/` with a `manifest.json`, reference-derived structural assertions independent of screenshot tolerance, a scoped E2E prune limited to fixture-owned actors, and a guard test proving non-fixture local data survives. `e2e/global-setup.ts` and `auth-return.spec.ts` extended; `playwright.config.ts` tweak.
- **QA-gate fix commit `90b0beb` (`fix: keep default auth redirects clean while preserving deep links`).**
  - Deep-link preservation through login/OAuth/onboarding hardened (`return-path.ts`, route adapters, onboarding components) while default redirects stay on `/dashboard`.
- **Review-fix commit `96f6aea` (`fix: address review findings`) — iteration 1.**
  - Blocking/triaging findings across UI (`CreateMatchPage`, `MatchDetailPage`, `MatchesPage`, `MatchCard`, `MatchReview`, styles), notification detail, route adapters, the functions migration, E2E visual specs/references, plus the committed plan/bundle/findings artifacts and a new scoped-prune integration suite and functions unit suite.
- **Review-fix commit `3fa732c` (`fix: address iteration two review findings`) — iteration 2, head.**
  - Delta re-review fixes: visual spec and reference refreshes, detail/create page corrections, translation additions, migration tweak, `lint-staged.test.ts` adjustments, and the `.gitignore` `.DS_Store` entry.

## Files Changed

- Migrations (4 new): `supabase/migrations/20261016120000_match_event_domain.sql` (PAF-71), `20261016120100_match_event_photos.sql` (PAF-72), `20261016120200_match_event_functions.sql` (PAF-73; amended in `7524f3d`, `96f6aea`, `3fa732c`), `20261016120300_match_event_notifications.sql` (PAF-74).
- Generated types: `src/lib/supabase/database.types.ts` (regenerated per migration).
- Matches feature (`src/features/matches/`): `matches.functions.ts`, `matches.validators.ts`, `match-model.ts`, `match-time.ts`, `match-photo.ts`, `match-photo.functions.ts`, `match-photo.server.ts`, `CreateMatchPage.tsx`, `MatchDetailsForm.tsx`, `MatchInviteePicker.tsx`, `MatchPhotoUpload.tsx`, `MatchReview.tsx`, `MatchCard.tsx`, `MatchesPage.tsx`, `MatchDetailPage.tsx`, `create-match.styles.ts`, `matches.styles.ts`, `match-detail.styles.ts`.
- Notifications feature (extended): `notifications.functions.ts`, `notification-model.ts`, `notification-target.ts`, `NotificationsPage.tsx`, `NotificationDetailPage.tsx`.
- Auth/deep-link plumbing: `src/features/auth/return-path.ts`, `src/routes/login.tsx`, `_protected.tsx`, `onboarding.tsx`, `onboarding_.account.tsx`, `onboarding_.community.tsx`, `src/features/player/PlayerOnboarding.tsx`, `src/features/community/CommunityOnboarding.tsx`.
- Routes: `src/routes/_protected.matches.tsx`, `_protected.matches.index.tsx`, `_protected.matches.create.tsx`, `_protected.matches.my.tsx`, `_protected.matches.past.tsx`, `_protected.matches.$eventId.tsx`, plus `_protected.dashboard.tsx` entry updates and notification route adapters.
- Locales: `src/locales/{en,pt-BR,es}/translation.json` (match create/discovery/detail + notification copy; parity enforced by `test/i18n.test.ts`).
- Tests — new suites: `test/matches.schema.integration.test.ts`, `matches.visibility.integration.test.ts`, `matches.photo.integration.test.ts`, `matches.photo.functions.test.ts`, `matches.photo.test.ts`, `matches.publication.integration.test.ts`, `matches.discovery.integration.test.ts`, `matches.notifications.integration.test.ts`, `matches.model.test.ts`, `matches.time.test.ts`, `matches.validators.test.ts`, `matches.functions.test.ts`, `matches.create.test.tsx`, `matches.detail.test.tsx`, `matches.list.test.tsx`, `matches.routes.test.ts`, `matches.styles.test.ts`, `matches.prune-scoping.integration.test.ts`; extended: `test/i18n.test.ts`, `test/auth.return-path.test.ts`, `test/auth.routes.test.ts`, `test/community.onboarding.test.tsx`, `test/notifications.detail.test.tsx`, `test/notifications.functions.test.ts`, `test/lint-staged.test.ts`.
- E2E: `e2e/matches.spec.ts`, `e2e/matches-visual.spec.ts`, `e2e/references/paf-4/` (references + `manifest.json` + recorded response), extended `e2e/auth-return.spec.ts`, `e2e/global-setup.ts`, `playwright.config.ts`.
- Docs/artifacts: `docs/plan/PAF-4-bundle.md`, `docs/plan/PAF-4-findings.md`, `docs/plan/Plan PAF-4 T04 — Create and discover Match Events.md`; `.gitignore` (`.DS_Store`).

## Key Decisions

- Exactly two event visibilities (`community_open`, `invite_only`); no `private` event visibility — "private" is a community type. Access control lives in RLS via a private-event predicate + `can_read_match_event(uuid)` rather than ad-hoc query filters.
- Private `match-event-photos` bucket with canonical `community/event/uploader/object.ext` keys and staging vs published read isolation; publish/delete share one advisory lock. Uploads are browser-direct authorized staging uploads finalized server-side, because a POST server function could not carry a `File`.
- One atomic `publish_match_event` RPC performs validation, photo object verification, creator auto-registration and deduplicated invites; replay is idempotent against the IMMUTABLE persisted snapshot; discovery reads use keyset pagination.
- Notifications reuse the PAF-3 store with transactional producers; `get_my_notification_target_v2` is additive so v1 community consumers keep working; match context is exposed through a bounded authorized RPC.
- The `/matches/<uuid>` deep link survives login/OAuth/onboarding via `optionalReturnPath`, which omits the default `/dashboard` so ordinary logins are never redirected into stale paths.
- UI: StyleX with design tokens only, Base UI primitives, en/pt-BR/es parity, ≥44px touch targets, exactly one `aria-current`, reference-faithful 18px gutter / 8–10px rhythm / green primary actions.
- Verification strategy: functional + visual/structural E2E with Pencil-derived references, reference-derived structural assertions independent of screenshot tolerance, an E2E prune scoped strictly to fixture-owned actors, and a guard test proving non-fixture local data survives cleanup.

## Validation Performed

- Final authoritative `pnpm complete-check`: **PASS** at `3fa732c` — all 8 stages green (`db:types:check`, `build`, `knip`, `typecheck`, `lint`, `format:check`, `test`, `test:e2e`), 80 files / 688 unit+integration tests, 120/120 E2E on a fresh preview, coverage thresholds unchanged, no `--fix`.
- Review loop: 2 iterations (code + architecture + UX/UI reviews, then delta re-reviews); 2 critical + 16 major findings fixed across `96f6aea` and `3fa732c`; 6 minor findings deferred (see Risks).
- E2E artifacts validated against Pencil-derived references with documented, justified non-zero screenshot tolerances plus structural assertions that do not depend on those tolerances.

## Risks and Follow-ups

- Deferred findings F20–F25 (minor, tracked in `docs/plan/PAF-4-findings.md`): publication notifications use invitation copy; pagination omits the original `as_of`; broad record DTOs in `match-model.ts`; per-card signing fan-out on listings; invitation-first eligibility can mask level-approval requirements; checkbox labels' ≥44px touch target.
- The PR is large (~114 files / ~11k insertions vs `main`) because the whole breakdown was delivered in one PR by explicit user choice.
- Scope boundaries: T05 owns registrations/withdrawals/approvals/FIFO quartets; T11 owns Leagues/Ranked selection. No result domain exists yet, so `Past` shows scheduled history only.
- At logging time `docs/plan/PAF-4-findings.md` is modified but uncommitted (ledger update after the gate); the orchestrator's final sweep should commit it.

## Related

- Linear: PAF-4 (children PAF-71, PAF-72, PAF-73, PAF-74, PAF-75, PAF-76)
- Artifacts: `docs/plan/Plan PAF-4 T04 — Create and discover Match Events.md`, `docs/plan/PAF-4-bundle.md`, `docs/plan/PAF-4-findings.md` (F1–F31)
- Depends/next: T05 (registrations, withdrawals, approvals, FIFO quartets); T11 (Leagues/Ranked selection)
- One memory per task policy: this epic-level log carries the sub-issues' details
