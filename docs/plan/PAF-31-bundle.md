# PAF-31 Context Bundle — PR1 (backend)

## Scope

- **Issue:** PAF-31 — PAF-2.6 — Admin governance: requests, membership, roles, settings, venues, audit
- **Parent:** PAF-2 (T02)
- **Branch:** `feature/PAF-31-admin-governance` (STACKED on `origin/feature/PAF-30-onboarding-community-discovery` @ `7bfa8ce`; PR targets the PAF-30 branch). The branch was rebased onto the updated PAF-30 base (which gained `7bfa8ce`, `0fb279a`, `dd865cd`).
- **Delivery:** PAF-31 is split into 2 stacked PRs (user-approved): **PR1 = backend (plan slices A+B)** ← this bundle; PR2 = UI (slices C+D), later.
- **Commit:** `8bdba11` — `feat: add community admin governance backend` (rebased from `3c3b297`; plus `.opencode` config commits `7980674`/`5aec543` on the branch)
- **Plan file:** `docs/plan/Plan PAF-31 PAF-2.6 — Admin governance requests, membership, roles, settings, venues, audit.md`

## Acceptance criteria (all 8, but PR1 covers the backend half; UI ACs verified in PR2)

1. Approve/deny pending request. 2. Invite/remove/reactivate. 3. Promote/demote; final-Admin protected. 4. Settings + venues + audit. 5. Member search scoped + allowed fields. 6. Audit view admin-only. 7. Every admin server function rejects member/nonmember. 8. Concurrent role changes cannot leave zero Admins.

## Approved decisions

- Split: PR1 backend (A+B), PR2 UI (C+D).
- Invitation issuing implemented now (Admin-only, raw token + SHA-256 hash); invite UI deferred.
- Pencil gaps adapted honestly; backend-expansion tracked as a follow-up issue.

## Changed files (7 + pre-existing .opencode commit)

- NEW `supabase/migrations/20261007153621_community_governance_members.sql` — `govern_community_member`, `search_community_members`, venue `archived_at`, `stamp_invitation_revocation` trigger.
- NEW `src/features/community/community-admin.functions.ts`, `community-admin.validators.ts`.
- CHANGED `src/lib/supabase/database.types.ts` (+32).
- NEW `test/community.admin.functions.test.ts`, `test/community.admin.integration.test.ts`.
- Plan doc.

`git diff --shortstat origin/feature/PAF-30-onboarding-community-discovery..HEAD` → `9 files changed, 1165 insertions(+), 4 deletions(-)` (includes the pre-existing `.opencode` commit + plan).

## Full diff

```
git diff origin/feature/PAF-30-onboarding-community-discovery..HEAD
```

### Migration highlights

- `govern_community_member(uuid,uuid,text)`: SECURITY DEFINER, `search_path=''`; auth/anonymous rejection (`28000`); locks the community row `FOR UPDATE` first, verifies active Admin (`PG001`), locks the member row, enforces the six transitions (`PG004`), final-admin guard (`PG002`), maps `community_members_open` (`PG005`) and the PAF-26 last-admin `23514` message (`PG002`); closure uses `greatest(clock_timestamp(), valid_from + 1µs, coalesce(activated_at, valid_from))`; `reactivate` INSERTs a new active row.
- `search_community_members(uuid,text,status,int,int)`: SECURITY DEFINER; active-Admin check; literal `strpos(lower(display_name), lower(query))`; joins `player_profiles`/`global_player_ratings` inside the definer; whitelisted fields only; newest interval per user; bounded pagination.
- `community_venues.archived_at` + UPDATE grant (archive, never DELETE).
- `stamp_invitation_revocation` BEFORE UPDATE trigger uses DB time (`greatest(clock_timestamp(), created_at)`).

### Server functions (`community-admin.functions.ts`)

- Six POST wrappers via a `memberAction(action)` factory calling `govern_community_member`; error map `28000/PG001–PG005` + constraint-specific `23505`.
- `searchCommunityMembers` (RPC), `listCommunityAudit` (admin precheck + audit RLS), `listCommunityVenues` (admin precheck + venue RLS, excludes archived), `addCommunityVenue`/`editCommunityVenue`/`archiveCommunityVenue` (RLS), `issueInvitation` (Web Crypto 32-byte token → SHA-256, inserts hash only, returns raw token once), `revokeInvitation`.

## Fast-gate result (green)

- `pnpm db:reset` ✅; `pnpm db:types` twice byte-identical ✅
- Focused `community.admin.integration` + `community.admin.functions` + `community.integration` + `community.join.functions` → 41/41 (integration ran)
- `pnpm typecheck` ✅, `pnpm lint` ✅, `pnpm format:check` ✅, `pnpm test` ✅ (329 tests)

## Review scope

- `code-review-specialist` — always.
- `architecture-review-specialist` — `src/features` + `supabase/migrations` changed.
- `ux-ui-reviewer-specialist` — skipped (no UI in PR1).

## Notes for reviewers

- `PG*` are custom governance SQLSTATEs.
- `search_community_members` deliberately bypasses owner-only profile RLS inside the definer while restricting to Admin + own community + whitelisted fields.
- `issueInvitation` requires a private community and an invitee UUID; raw tokens are never persisted/logged; the invite UI is deferred to PR2/later.
- The pre-existing `988f9c3` commit only changes `.opencode` agent config files (unrelated to PAF-31); flag if you consider it out of scope.
