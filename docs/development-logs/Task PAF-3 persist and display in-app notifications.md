---
title: PAF-3 Persist and Display In-App Notifications
type: development-log
permalink: docs/development-logs/task-PAF-3-persist-and-display-in-app-notifications
---

# Development Log: PAF-3

## Metadata

- Task ID: PAF-3 (T03 — Persist and display in-app notifications); deliberated into sub-issues PAF-63…PAF-69
- Date (UTC): 2026-10-16
- Project: padel-friend
- Branch: feature/PAF-3-persist-and-display-in-app-notifications (base `origin/main` @ `a706f9c6`)
- Commits (10, delivery order): `586bfb1` (PAF-63), `849a5c4` (PAF-64), `79576a3` (PAF-65), `a105f2e` (PAF-66), `b34550a` (PAF-67), `f79bf12` (PAF-68), `a2b79ed` (PAF-69), `9096159` (review fixes), `e41f54d` (delta review fixes), `7eba242` (QA-gate fixes, head)
- Linear: PAF-3 with children PAF-63…PAF-69; one branch, one pull request

## Objective

- An authorized user can inspect and act on durable, correctly scoped in-app notifications: recipient-private persistence keyed by a stable domain event, community membership events as the first producer, a notification center with an unread badge, mark-one/mark-all read, safe deep links, an initial preferences model, and a recipient/privacy boundary — without Push or Realtime.

## Implementation Summary

- **Unit 1 — PAF-63, commit `586bfb1` — durable notification store.**
  - New generic `public.notifications` table (unique `(recipient_user_id, event_key)` for idempotency, recipient+created index, partial unread index, select-only recipient RLS, no write grants), private `persist_notification()` helper with `ON CONFLICT DO NOTHING` plus exact-match replay returning the original id and a `23505` `NOTIFICATION_EVENT_CONFLICT` on payload mismatch, and the authenticated entrypoints `mark_notification_read`, `mark_all_notifications_read(p_before)`, `count_my_unread_notifications`. Migration `20261015180000_notifications_store.sql`.
- **Unit 2 — PAF-64, commit `849a5c4` — preferences model.**
  - `notification_preferences` (six push-intent booleans; `critical_in_app_enabled` forced true by CHECK and by the RPC, no toggle argument) + `set_my_notification_preferences`. Migration `20261015180100_notification_preferences.sql`.
- **Unit 3 — PAF-65, commit `79576a3` — community producers.**
  - Private AFTER triggers producing alerts atomically with the domain mutation: invitation insert, membership `pending→active` approval, `pending→inactive` denial, and `active→inactive` removal performed by someone other than the member (self-leave and role-only changes are suppressed). Migration `20261015180200_community_notification_producers.sql`.
- **Unit 4 — PAF-66, commit `a105f2e` — server contract and detail page.**
  - Full authenticated server contract (`listMyNotifications` with keyset cursor + `asOf` snapshot + whole-store unread count, `getMyUnreadNotificationCount`, `markNotificationRead`, `markAllNotificationsRead`, get/save preferences, `getMyNotificationTarget`, `acceptMyNotificationInvitation`), hand-rolled sibling validators, strict model types, target resolution that degrades to exactly one `unavailable` row instead of throwing (no token/name leakage), and notification-id-bound invitation acceptance mirroring the token path's eligibility and lock semantics. Migration `20261015180300_notification_targets.sql`. Plus the detail page and its route adapters.
- **Unit 5 — PAF-67, commit `b34550a` — notification center, badge and freshness.**
  - `/notifications` center (Pencil-faithful header with mark-all action, segmented filters, Today/Earlier grouping with a green-soft unread summary, compact cards, load-more), a dashboard unread badge loaded independently so a notification failure cannot fail profile loading, and the freshness hook: focus + visible-only `visibilitychange` + `online` coalesced to one in-flight plus one trailing refresh, generation-guarded stale-response rejection, optimistic mark-one/mark-all with scoped rollback and authoritative count reconciliation, and distinct empty / initial-error / background-stale / offline states.
- **Unit 6 — PAF-68, commit `f79bf12` — preferences screen.**
  - `/notifications/preferences` (Base UI switches, five push categories retained while the master switch is off, immutable ALWAYS-ON critical panel, honest "delivery not available yet" copy, save/saving/saved/error/offline states) plus the center entry link.
- **Unit 7 — PAF-69, commit `a2b79ed` — end-to-end journeys.**
  - `e2e/notifications.spec.ts`: 8 real-actor journeys (invitation → badge → center → detail → accept → read state persists after reload; Push permission denied; anonymous deep link through login; revoke between view and action; removal-alert privacy; cross-account isolation; mark-all with a concurrently arriving event; offline recovery + preferences persistence) plus structural/visual probes with documented non-zero tolerances.
- **Review-fix commit `9096159` (`fix: address notification review findings`).**
  - 16 blocking/triaging findings: Postgres-format cursor timestamps (pagination was broken past page 1), filter-change staleness, badge refresh lifecycle, Pencil hierarchy restoration in the center and preferences, route load-error retries, detail offline gating, post-acceptance reconciliation with a polite announcement, polite count announcements, label-in-name badge naming, stronger visual probes (applied computed typography/token styles/geometry/dark theme/pt-BR+es narrow width), undefined CSS variables, an undefined `sr-only` class, read-retry, mutation-vs-fetch error separation, and a genuinely concurrent store test.
- **Review-fix commit `e41f54d` (`fix: keep notification feed consistent across filter changes`).**
  - The single new major from the delta re-review: a filter change during an in-flight read mutation could leave the selected feed permanently empty (mutation completion refreshed with the stale category and swallowed the queued trailing refresh), plus a swallowed mark-all failure during a category change and a missing `notifications.mutationError` translation.
- **QA-gate fix commit `7eba242` (`fix: derive notification cutoff from the database clock`).**
  - The mark-all cutoff came from the app host clock while the server rejects cutoffs later than Postgres `transaction_timestamp()`, so clock skew made mark-all fail and roll back. Added the authenticated `get_my_notifications_as_of()` RPC (Postgres `statement_timestamp()`; migration `20261016100000_notifications_database_cutoff.sql`) so the list snapshot and the mark-all cutoff share one clock, plus formatter fixes for two integration test files.

## Files Changed

- Migrations (5 new): `supabase/migrations/20261015180000_notifications_store.sql`, `20261015180100_notification_preferences.sql`, `20261015180200_community_notification_producers.sql`, `20261015180300_notification_targets.sql`, `20261016100000_notifications_database_cutoff.sql`.
- Generated types: `src/lib/supabase/database.types.ts` (regenerated per migration).
- Notifications feature (`src/features/notifications/`): `notifications.functions.ts`, `notifications.validators.ts`, `notification-model.ts`, `notification-target.ts`, `NotificationsPage.tsx`, `NotificationDetailPage.tsx`, `NotificationPreferencesPage.tsx`, `NotificationBadge.tsx`, `use-notifications.ts`, `notifications.styles.ts`, `notification-preferences.styles.ts`.
- Routes: `src/routes/_protected.notifications.tsx`, `_protected.notifications.index.tsx`, `_protected.notifications.$notificationId.tsx`, `_protected.notifications.preferences.tsx`, and `_protected.dashboard.tsx` (badge entry).
- Locales: `src/locales/{en,pt-BR,es}/translation.json` (notification center, badge, detail and `notificationPreferences.*` copy; en/pt-BR/es parity enforced by `test/i18n.test.ts`).
- Tests — new suites: `test/notifications.store.integration.test.ts`, `test/notifications.preferences.integration.test.ts`, `test/notifications.producers.integration.test.ts`, `test/notifications.targets.integration.test.ts`, `test/notifications.validators.test.ts`, `test/notifications.functions.test.ts`, `test/notifications.detail.test.tsx`, `test/notifications.center.test.tsx`, `test/notifications.badge.test.tsx`, `test/notifications.freshness.test.tsx`, `test/notifications.model.test.ts`, `test/notifications.preferences.test.tsx`.
- E2E: `e2e/notifications.spec.ts` + `e2e/notifications.spec.ts-snapshots/*.png`.

## Key Decisions

- New generic `notifications` store instead of extending the legacy `community_notifications` (which stays untouched for the T02 request-message inbox).
- Triggers as producers so the alert is written in the same transaction as the domain change (insert failure aborts the mutation; no silent gap).
- Fetch on load/focus/visibility/online; no Supabase Realtime (T17) and no Push (T16).
- Preferences persist delivery intent only — no permission prompt, no subscription, no service worker.
- Critical in-app alerts can never be disabled; the model enforces the invariant.
- No global bottom navigation — documented pre-existing infrastructure gap, not filled with inert links.

## Validation Performed

- Fast gate per unit: `pnpm typecheck`, `pnpm lint`, `pnpm knip`, targeted `pnpm exec vitest run` (integration suites executed against local Supabase, never skipped), plus `pnpm db:types:check` (byte-exact) for the DB units and `pnpm build` for route generation.
- Final unit suite: 62 files / 591 tests (with `GIT_CONFIG_GLOBAL=/dev/null`, needed only because the agent sandbox denies reading `~/.gitconfig`).
- E2E: `pnpm test:e2e` → 97 passed, 0 skipped.
- Authoritative `pnpm complete-check` on `7eba242`: `db:types:check`, `build`, `knip`, `typecheck`, `lint`, `format:check` (263 files) and `test:e2e` (97/97) all pass; the `test` stage reports 588 passed / 3 failed ONLY because the sandbox denies `~/.gitconfig` to every git subprocess in `test/lint-staged.test.ts` (that suite passes 7/7 with `GIT_CONFIG_GLOBAL=/dev/null`, so the failure is environmental, not a code regression).
- Review: 2 fix iterations (cap). Code + architecture + UX/UI reviews, then a delta re-review; all blocking findings closed.

## Risks and Follow-ups

- Deferred: a `(recipient_user_id, category, created_at DESC, id DESC)` index for the category feed — handed off to Linear `PAF-70` together with a unique-fixture-name hardening for the pre-existing `test/community.invitee.integration.test.ts` fragility (it accumulates a fixed-name fixture and the invitee-search RPC caps results; the local pollution was repaired without touching the test).
- The `test/lint-staged.test.ts` environment caveat above: run the gate in an unsandboxed shell (or with `GIT_CONFIG_GLOBAL=/dev/null` exported) to see a clean PASS.

## Related

- Linear: PAF-3 (children PAF-63, PAF-64, PAF-65, PAF-66, PAF-67, PAF-68, PAF-69)
- Deferred follow-up: PAF-70 (category-feed index + invitee-integration fixture hardening)
- One memory per task policy: this epic-level log carries the sub-issues' details
