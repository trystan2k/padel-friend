# PAF-32 Context Bundle

## Scope

- **Issue:** PAF-32 — PAF-2.7 — Membership lifecycle: leave/removal/reactivation, history preservation, final E2E (final PAF-2 sub-issue)
- **Branch:** `feature/PAF-32-membership-lifecycle` (STACKED on `origin/feature/PAF-31-admin-governance-ui` @ `6c854bb`; PR targets the PAF-31 PR2 branch)
- **Commit:** `a7c119f` — `feat: complete community membership lifecycle`
- **Plan:** `docs/plan/Plan PAF-32 PAF-2.7 — Membership lifecycle - leave-removal-reactivation, history preservation, final E2E.md`

## Acceptance criteria

1. Leave/removal sets membership inactive with interval end; no match/League rows deleted/mutated. 2. Historical matches/League facts queryable after end. 3. Inactive user cannot join/accept invitations for that community until reactivated. 4. Reactivation restores rights with a new interval; prior interval intact. 5. Membership timeline API returns intervals + community IDs. 6. Sporting profile has no private account fields. 7. Final E2E lifecycle + unauthorized deep-links. 8. `pnpm complete-check` unchanged thresholds.

## Approved decisions

- **One large PR** (overage accepted).
- **AC1–2 amendment:** certify the membership-history portion; match/League-fact preservation deferred (no match/League tables exist). Recorded as a comment on PAF-32.
- **Hybrid final E2E:** shipped UI for create/discover/join/approve/remove/reactivate; real-JWT RPC for invitation issuance/accept and member leave.
- **Leave AND removal → inactive; inactive blocks self-rejoin/invitation acceptance until admin reactivation.**

## Changed files (16)

- NEW `supabase/migrations/20261008184607_community_membership_lifecycle.sql` — `leave_community` + `CREATE OR REPLACE` join/accept with `PJ008`.
- `src/features/community/community.functions.ts` (+`leaveCommunity`, +`getMyMembershipTimeline`, `PJ008`/`PL001`/`PL002` maps), `community.validators.ts`, `CommunityOnboarding.tsx` (inactive message), `src/locales/{en,es,pt-BR}/translation.json`, `database.types.ts`.
- Tests: NEW `test/community.lifecycle.functions.test.ts`; extended `community.integration.test.ts`, `community.admin.integration.test.ts`, `community.join.functions.test.ts`, `community.onboarding.test.tsx`, `player.integration.test.ts`.
- NEW `e2e/community-lifecycle.spec.ts`; plan doc.

`git diff --shortstat origin/feature/PAF-31-admin-governance-ui..HEAD` → `16 files changed, 1648 insertions(+), 4 deletions(-)`.

## Full diff

```
git diff origin/feature/PAF-31-admin-governance-ui..HEAD
```

### Migration highlights

- `leave_community(uuid)`: SECURITY DEFINER, `search_path=''`; community `FOR UPDATE` then caller's open membership `FOR UPDATE`; `PL001` (not-open/unknown/outsider/repeat); `PL002` final-admin; UPDATE only `status='inactive'` + `valid_until = greatest(clock_timestamp(), valid_from + 1µs, coalesce(activated_at, valid_from))`; never DELETE; grants authenticated-only.
- `join_public_community` / `accept_community_invitation` (`CREATE OR REPLACE`): add `PJ008` (MEMBERSHIP_INACTIVE) **after** the open-row `PJ006` check; all existing PJ001–PJ007 conditions/order preserved; grants unchanged.

### Server functions

- `leaveCommunity` (POST) + `getMyMembershipTimeline` (GET, `.eq('user_id', userId)` + own-row RLS, DTO `{membership_id, community_id, role, status, valid_from, valid_until, activated_at}`, ascending order, `{intervals, next_offset}`).

## Fast-gate result (green)

- `pnpm db:reset` ✅; `pnpm db:types` twice byte-identical ✅
- Focused 5 suites → 62 tests (integration ran)
- `pnpm test` ✅ 369; `pnpm test:e2e` ✅ 53/53 (new lifecycle E2E 3/3); typecheck/lint/format green.

## Review scope

- `code-review-specialist` — always.
- `architecture-review-specialist` — `src/features` + `supabase/migrations` changed.
- `ux-ui-reviewer-specialist` — `CommunityOnboarding.tsx` + locales changed (small error-message delta).

## Notes for reviewers

- The inactive-block is community-local and applies to both leave and removal; reactivated users get `PJ006` (not `PJ008`).
- Match/League-fact preservation is **explicitly deferred** (no such tables) — do not treat as a defect; it's an approved amendment.
- The final E2E is hybrid (documented); invitation issuance uses a real-JWT RLS insert (no issuance RPC/UI).
- Timeline is owner-scoped and paginated; no service-role/definer view.
