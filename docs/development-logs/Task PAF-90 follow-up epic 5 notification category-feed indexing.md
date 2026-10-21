---
title: PAF-90 Follow-up Epic 5 Notification Category-feed Indexing
type: development-log
permalink: docs/development-logs/task-PAF-90-follow-up-epic-5-notification-category-feed-indexing
---

# Development Log: PAF-90

## Metadata

- Task ID: PAF-90 (epic "Follow-up epic 5 — Notification category-feed indexing"; only sub-issue PAF-70 "T03 follow-up — notification category-feed composite index", delivered as a single unit of work; PAF-91 invitee fixture hardening explicitly out of scope and not touched)
- Date (UTC): 2026-10-21
- Project: padel-friend
- Branch: feature/PAF-90-follow-up-epic-5-notification-category-feed-indexing (base `6a2aaa1` = `origin/main`)
- Commits: `9cf02d0` — "perf: index notification category feeds" (single commit for the single unit of work; the QA round-1 test-helper fix was amended into it)
- Artifacts: plan `docs/plan/Plan PAF-90 — Notification category-feed indexing.md`, findings ledger `docs/plan/PAF-90-findings.md`

## Objective

- Close follow-up epic 5 via its only sub-issue: add a composite index so notification category feeds stop scanning and sorting a recipient's whole notification history when the feed is sparse or empty, without changing any query result or the unread-count path.

## Implementation Summary

- **Planning.** `docs/plan/Plan PAF-90 — Notification category-feed indexing.md` chose a simple additive-index approach. Rejected a category-partial unread index on evidence that `count_my_unread_notifications()` filters only recipient + `read_at is null` with no category predicate and `notifications_recipient_unread_idx` already matches; rejected feed/RPC rewrites as unnecessary for a pure index win.
- **Implementation (single unit of work, one commit `9cf02d0`).**
  - New migration `supabase/migrations/20261021180000_notifications_category_feed_index.sql`: additive `create index notifications_recipient_category_created_idx on public.notifications (recipient_user_id, category, created_at desc, id desc)` inside an explicit transaction; plain `CREATE INDEX` matching repo convention (no `CONCURRENTLY`); no historical migration edits.
  - `test/notifications.functions.test.ts`: query-contract assertions for category feeds — category equality, database-clock cutoff, descending order calls, keyset cursor OR, limit+1, argument-free unread-count RPC; the all-category path omits the category equality.
  - `test/notifications.store.integration.test.ts`: real local-Supabase regression coverage — recipient/category filtering, read+unread rows returned, ordering by `created_at DESC` then `id DESC`, equal-timestamp cursor continuation, empty category returns none, cutoff/outsider/read-state exclusions, whole-store unread-count semantics, plus an index-catalog assertion (index exists, valid, nonpartial, btree, exact 4-key order with DESC/DESC on the last two, existing unread index retained).
- **QA round 1 failure and fix.** The integration index-catalog assertion failed because the `supabase db query` test helper omitted `--output-format json` (psql box table) and the assertion expected `{ rows: [...] }` while the CLI returns a bare array. Fixed in the test helper/assertion only — migration and SQL intent untouched — and amended into the same single commit.
- **Review.** Code review: no findings. Architecture review: one minor finding — production `CREATE INDEX` lock-window preflight unverifiable in this environment (no hosted link, no access token; hosted migration is a manual `supabase db push` path per `INITIAL_SETUP.md`). Recorded in `docs/plan/PAF-90-findings.md` as an observed environment limitation disclosed for deploy-time verification; local build measured 161 ms on the largest available dataset. No code changes resulted from review.
- **UX/UI review: not applicable** — no UI, CSS, or i18n change in this delivery.

## Files Changed

- Migration (PAF-70): `supabase/migrations/20261021180000_notifications_category_feed_index.sql` (new: additive 4-key composite index in an explicit transaction)
- Query-contract unit tests (PAF-70): `test/notifications.functions.test.ts` (category equality, cutoff, ordering, keyset cursor OR, limit+1, unread RPC; all-category path omits category equality)
- Integration regression tests (PAF-70): `test/notifications.store.integration.test.ts` (filtering, ordering, cursor continuation, exclusions, unread-count semantics, index-catalog assertion; QA round-1 helper/assertion JSON fix landed here)
- Planning: `docs/plan/Plan PAF-90 — Notification category-feed indexing.md` (new, committed)
- Findings ledger: `docs/plan/PAF-90-findings.md` (durable review record, committed with the delivery)
- Not deliverables: `docs/plan/PAF-90-bundle.md` and `docs/plan/PAF-90.diff` were derived orchestration artifacts, discarded after the PR opens

## Key Decisions

- **Additive index over planner rewrites:** a single composite index `(recipient_user_id, category, created_at desc, id desc)` serves category feeds without touching feed/RPC logic; keys mirror the actual query shape (category equality, `created_at DESC` then `id DESC` keyset ordering).
- **Rejected a category-partial unread index with evidence:** `count_my_unread_notifications()` filters only recipient + `read_at is null` (no category predicate) and `notifications_recipient_unread_idx` already matches — a partial-category unread index would be dead weight; the unread path was left on its existing index.
- **Plain `CREATE INDEX`, no `CONCURRENTLY`,** matching repo migration convention; wrapped in an explicit transaction; no historical migration edits.
- **QA fix confined to test infrastructure:** the round-1 failure was a test-helper output-format/assertion-shape mismatch, fixed in helper + assertion only so migration and SQL intent stayed untouched; amended to preserve the one-commit-per-unit history.
- **No thresholds touched:** no coverage gates, screenshot budgets, or CI settings changed; no UI/i18n surface, so UX review was skipped as not applicable.

## Validation Performed

- **Real `EXPLAIN (ANALYZE, BUFFERS)` before/after** on a 110,000-row analyzed fixture under authenticated RLS with no forced planner settings: sparse/empty category feed went from bitmap scan + sort over the recipient's whole history (99,899 rows filtered, 3,058 buffer hits) to an ordered scan on the new index (21 rows, 25 hits, no sort node).
- **Result equivalence:** all six probed result sets byte-identical before/after; unread count unchanged (66,667) on the existing unread index; new index size ~7.67 MB.
- **Type pipeline:** `pnpm db:types` produced no type diff (index-only change); `pnpm db:types:check` passed.
- **Scoped gates (green):** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm db:types:check`; unit tests 8 passed / 0 skipped; integration tests 3 passed / 0 skipped (executed against local Supabase).
- **QA round 1:** index-catalog assertion failed (missing `--output-format json` + bare-array vs `{ rows: [...] }` mismatch); fixed in test helper/assertion only; re-run green; amendment folded into commit `9cf02d0`.
- **Review round:** code review — no findings; architecture review — one minor finding (production lock-window preflight unverifiable in this environment), recorded in `docs/plan/PAF-90-findings.md`; no code changes required.
- **Full gate:** `pnpm complete-check` — pending at log time (running separately as final validation; outcome not yet confirmed, not claimed here).

## Risks and Follow-ups

- **Production lock-window preflight unverified (deploy-time action):** no hosted link or access token exists in this environment, and hosted migration is a manual `supabase db push` per `INITIAL_SETUP.md` — verify the `CREATE INDEX` lock window on production data at deploy time; disclosed in `docs/plan/PAF-90-findings.md`. Local build measured 161 ms on the largest available dataset, but production table size may differ.
- **Full gate confirmation:** `pnpm complete-check` was pending at log time — confirm it is green before merge.
- No other follow-ups from this epic; nothing deferred. PAF-91 (invitee fixture hardening) remains explicitly out of scope for this delivery.

## Commits

- `9cf02d0` — perf: index notification category feeds (single unit of work; includes the amended QA round-1 test-helper fix)
