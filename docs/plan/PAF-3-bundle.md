# PAF-3 Context Bundle

Single source of context for every reviewer and fixer of this delivery. Do not re-derive context; read this file, the plan, and the diff.

## Scope

- **Linear scope**: `PAF-3` — "T03 — Persist and display in-app notifications" (top-level task in project `PadelFriend`).
- **Sub-issues (created for this delivery)**: `PAF-63` … `PAF-69`, one per unit of work, sequential `blocked-by` chain.
- **Branch**: `feature/PAF-3-persist-and-display-in-app-notifications` (base: `origin/main` @ `a706f9c6`).
- **Plan file (authoritative spec)**: `docs/plan/Plan PAF-3 T03 — Persist and display in-app notifications.md`
- **Diff (authoritative code artifact, not inlined here)**: `git diff origin/main..HEAD`, or per unit `git show <sha>`.

## Scope description (from Linear, condensed)

Goal: an authorized user can inspect and act on durable, correctly scoped in-app notifications.

In scope: notification persistence keyed by a stable domain event + recipient; community membership events as the first producer; center + unread badge; mark-one/mark-all read; safe deep links; initial preferences model; recipient/privacy boundary. Out of scope: Push delivery (T16), Realtime (T17), match/rating/League producers.

## Acceptance criteria of the parent scope

1. A relevant community invitation/approval/removal generates a durable in-app alert for its authorized recipient with a safe destination.
2. Unread badge, mark-one, mark-all and navigation work; users cannot read another user's notifications.
3. A retried domain event or reconnect does not create duplicate recipient notifications.
4. Critical in-app alerts cannot be fully disabled by preferences; Push is not required for center delivery.
5. Center, empty/error/offline states, preferences and all user-visible copy match Pencil and en/pt-BR/es i18n.

## User decisions taken before planning (binding)

1. Break the work into sub-issues; deliver all on ONE branch / ONE PR; one commit per unit.
2. Create a NEW generic `notifications` table keyed by recipient + stable event key; leave `community_notifications` untouched.
3. Fetch on load + refetch on focus/visibility/online; NO Supabase Realtime.
4. Implement BOTH the preferences data model AND the preferences screen; critical in-app alerts cannot be disabled.

## Units of work (ordered)

| # | Linear | Commit | Summary | Files (scope) | Fast gate at commit time |
| - | ------ | ------ | ------- | ------------- | ------------------------ |
| 1 | PAF-63 | `586bfb1` | Recipient-private notification store: `notifications` table, unique `(recipient_user_id, event_key)`, partial unread index, select-only RLS, private `persist_notification`, `mark_notification_read`, `mark_all_notifications_read`, `count_my_unread_notifications` | `supabase/migrations/20261015180000_notifications_store.sql`, `src/lib/supabase/database.types.ts`, `test/notifications.store.integration.test.ts`, plan file | 51 files / 521 tests pass |
| 2 | PAF-64 | `849a5c4` | `notification_preferences` + `set_my_notification_preferences`; critical in-app invariant force-true | `supabase/migrations/20261015180100_notification_preferences.sql`, types, `test/notifications.preferences.integration.test.ts` | 52 files / 522 tests pass |
| 3 | PAF-65 | `79576a3` | Producer triggers: invitation insert, membership approved/denied, admin removal (self-leave suppressed); transactional atomicity | `supabase/migrations/20261015180200_community_notification_producers.sql`, `test/notifications.producers.integration.test.ts` | 53 files / 527 tests pass |
| 4 | PAF-66 | `a105f2e` | Server contract (list/count/mark/mark-all/preferences/target/accept) + validators + model + target resolver migration + detail page + detail route + detail i18n | `supabase/migrations/20261015180300_notification_targets.sql`, types, `src/features/notifications/{notifications.functions.ts,notifications.validators.ts,notification-model.ts,notification-target.ts,NotificationDetailPage.tsx,notifications.styles.ts}`, `src/routes/_protected.notifications.tsx`, `src/routes/_protected.notifications.$notificationId.tsx`, 3 locales, 4 test files | 57 files / 547 tests pass |
| 5 | PAF-67 | `b34550a` | Notification center (`/notifications`), unread dashboard badge, freshness hook (focus/visibility/online coalescing, generation guards, optimistic mark-one/mark-all with rollback + count reconciliation) | `src/features/notifications/{NotificationsPage.tsx,NotificationBadge.tsx,use-notifications.ts,notification-model.ts,notifications.styles.ts}`, `src/routes/_protected.notifications.index.tsx`, `src/routes/_protected.dashboard.tsx`, 3 locales, 4 test files | 61 files / 560 tests pass |
| 6 | PAF-68 | `f79bf12` | Preferences screen (`/notifications/preferences`) + center entry + i18n | `src/features/notifications/{NotificationPreferencesPage.tsx,notification-preferences.styles.ts,NotificationsPage.tsx}`, `src/routes/_protected.notifications.preferences.tsx`, 3 locales, `test/notifications.preferences.test.tsx`, `test/notifications.functions.test.ts` | 62 files / 569 tests pass |
| 7 | PAF-69 | `a2b79ed` | E2E journeys (8 journeys / 13 tests) + visual structural probes with documented tolerances; fixes for 3 defects the E2E found (`use-notifications.ts`, `notifications.styles.ts`, `notification-preferences.styles.ts`) | `e2e/notifications.spec.ts`, `e2e/notifications.spec.ts-snapshots/*.png`, 3 source files | E2E 13/13 pass; unit suite 569/569 |

## Plan → implementation summary

The plan specified: additive migrations only; `security definer set search_path = ''` everywhere; recipient-equality-only RLS (no membership subqueries in policies); a generic `event_key` idempotency key; triggers as the producer so the alert is in the same transaction as the domain change; a target-resolution RPC that degrades to a single `unavailable` row instead of throwing; notification-path invitation acceptance that mirrors the token path's eligibility checks; server-side whole-store unread count; keyset pagination with an `asOf` snapshot; no GET side effects; fetch-on-focus freshness without Realtime; immutable ALWAYS-ON critical in-app setting; and honest "Push not available yet" copy.

## Known, documented deviations (do not re-litigate; verify they are bounded)

- **No global bottom navigation**: the Pencil frames show an app-wide bottom navigation. This is a pre-existing product-infrastructure gap deliberately NOT implemented in PAF-3 (plan defers app-wide shell/nav). Notification screens therefore have no bottom nav. Recorded in `e2e/notifications.spec.ts` and in the plan.
- **No Push/Realtime**: preferences persist *intent* only; no `Notification.requestPermission`, no subscriptions, no service worker push. Deferred to T16/T17.
- **`coverage.include` untouched**: it still covers only `src/i18n/config.ts`; notification code is covered by normal tests under `test/**`. Thresholds were NOT lowered or widened.
- **Legacy `community_notifications` untouched**: the T02 request-message inbox remains as-is; the new generic store is separate.
- **E2E screenshot budgets are non-zero on purpose**: Pencil and Chromium rasterize fonts differently; structural facts are guarded by exact probes (±1px geometry, computed styles, DOM/aria) that are independent of the pixel budgets. Budgets: populated center mobile 4%, empty center mobile 3%, preferences mobile 3%, desktop 2%.

## Fast-gate results (per unit, at commit time)

Every unit was committed only with: `pnpm typecheck`, `pnpm lint`, `pnpm knip` (where applicable), targeted `pnpm exec vitest run <unit files>` (integration suites actually executed — no skips), and a full `pnpm exec vitest run` with zero failures. Units 1–3 also passed `pnpm db:types` + `pnpm db:types:check` (byte-exact); units 4–5 passed `pnpm build` for route generation.

**Note for reviewers**: the repo's pre-commit hook (`oxlint --fix` + `oxfmt`) reformatted several files *during* the commit, after their last test run. Their committed content was therefore verified by the *next* unit's full-suite run, and the final `pnpm complete-check` covers the frozen state.

## QA result (this delivery)

- Full gate `pnpm complete-check`: **see the QA line appended by the orchestrator** (updated once, authoritative).

## Review scope

- `subagent/code-review-specialist`: always.
- `subagent/architecture-review-specialist`: because `src/features/notifications/**`, `src/routes/**` and `supabase/migrations/**` changed.
- `subagent/ux-ui-reviewer-specialist`: because UI/i18n/style files changed.

Findings ledger: `docs/plan/PAF-3-findings.md`.
