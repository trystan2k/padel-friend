# PAF-26 Context Bundle

## Scope

- **Issue:** PAF-26 — PAF-2.1 — Community domain model: tables, enums, RLS policies, role-matrix tests
- **Parent:** PAF-2 (T02 — Create, discover, join, and administer communities)
- **Branch:** `feature/PAF-26-community-domain-model` (base `origin/main` @ `efc83b7`)
- **Unit of work:** PAF-26 itself (single unit)
- **Commit:** `c752ad2` — `feat: add community domain schema and role-matrix coverage`
- **Plan file:** `docs/plan/Plan PAF-26 PAF-2.1 — Community domain model: tables, enums, RLS policies, role-matrix tests.md`

## Acceptance criteria (from PAF-26)

1. Migrations apply cleanly to a fresh Supabase project (`supabase db reset` succeeds).
2. Enums exist for community visibility (`public`/`private`), member role (`admin`/`member`), membership status (`active`/`pending`/`inactive`).
3. `community_members` rows carry a validity interval (start/end) and are never deleted when a membership ends.
4. RLS: authenticated nonmember SELECT on a private community returns zero rows; a private community's matches are not listable by nonmembers.
5. RLS: a member can read own membership rows; insert/update on membership, invitation, venue, and settings rows is admin-only.
6. Guest/unauthenticated access grants no membership-derived rows.
7. Role-matrix integration test suite covers public, private, invited, pending, inactive, member, Admin actors and passes in CI.

## Approved decisions / deferrals

- **Matches deferred to PAF-4.** No matches table or match RLS policy in this unit. PAF-26 proves no unsolicited nonmember can enumerate any private-community resource and exposes reusable helpers (`is_community_member`, `is_community_admin`, `can_read_community`) for PAF-4's match policy. AC4's matches clause is satisfied structurally, not literally.
- **`src/lib/supabase/database.types.ts` intentionally excluded.** The pinned generator (`pnpm exec supabase` 2.118.0) emits a dense format that is not reproducible against the committed pretty-printed file (~470+/768− churn). No PAF-26 code consumes community types. Tracked as follow-up **PAF-33**.
- **Base branch is `main`** (repo has no `develop`; PR #1/#2 merged into main).

## Changed files (3 new, 0 modified, 0 deleted)

| File                                                                                                        | Change          |
| ----------------------------------------------------------------------------------------------------------- | --------------- |
| `supabase/migrations/20261002055953_community_domain.sql`                                                   | NEW — 246 lines |
| `test/community.integration.test.ts`                                                                        | NEW — 495 lines |
| `docs/plan/Plan PAF-26 PAF-2.1 — Community domain model: tables, enums, RLS policies, role-matrix tests.md` | NEW — 31 lines  |

`git diff --shortstat origin/main..HEAD` → `3 files changed, 772 insertions(+)`

## Full diff

All three files are new, so the full diff equals their full contents. Reproduce exactly with:

```
git diff origin/main..HEAD
```

The migration and test are also readable at the paths above. Reviewers should run the command rather than rely on a pasted copy.

## Fast-gate result (green)

- `pnpm typecheck` ✅
- `pnpm lint` ✅
- `pnpm format:check` ✅ (154 files)
- `pnpm test` ✅ (27 files, 266 tests)
- `pnpm exec vitest run test/community.integration.test.ts` ✅ (7 tests executed, 0 skipped) against local Supabase
- `pnpm db:reset` ✅ (migration applies cleanly)

## Implementation-step summary (from plan)

1. One CLI-timestamped migration: 3 enums, 5 tables, indexes, interval constraints.
2. RLS helpers (`is_community_member`, `is_community_admin`, `can_read_community`), `create_community` RPC (atomic creator→sole active admin), explicit grants + per-command policies, history/last-admin/invitation guards, audit triggers.
3. Real-JWT role-matrix integration suite (7 actors + anon), filtered and unfiltered negative probes.
4. Types regeneration deferred (PAF-33).

## Review scope

- `code-review-specialist` — always.
- `architecture-review-specialist` — `supabase/migrations` changed.
- `ux-ui-reviewer-specialist` — skipped (no UI files changed).

## Notes for reviewers

- Security boundary is the DB (RLS + column grants + SECURITY DEFINER helpers), not navigation.
- `community_audit_log` is written only by SECURITY DEFINER triggers; no client INSERT/UPDATE/DELETE grants.
- Membership rows are never deleted (BEFORE DELETE trigger + no DELETE grant); rejoin inserts a new interval.
- Last-admin demotion is serialized by `SELECT ... FOR UPDATE` on the parent community row.
- Invitation `token_hash` is never granted to clients; `select('*')` on invitations is expected to fail with 42501.
