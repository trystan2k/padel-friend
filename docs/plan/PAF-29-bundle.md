# PAF-29 Context Bundle

## Scope

- **Issue:** PAF-29 — PAF-2.4 — Join flows: public self-join, private invitations, approval handling, edge cases
- **Parent:** PAF-2 (T02)
- **Branch:** `feature/PAF-29-join-flows` (STACKED on `origin/feature/PAF-28-public-community-discovery` @ `db0078e`; PR targets the PAF-28 branch, not `main`)
- **Unit of work:** PAF-29 itself (single unit)
- **Commit:** `666a175` — `feat: add secure community join and invitation acceptance`
- **Plan file:** `docs/plan/Plan PAF-29 PAF-2.4 — Join flows: public self-join, private invitations, approval handling, edge cases.md`

## Acceptance criteria

1. Public instant join creates an active membership; duplicate rejected.
2. Public approval-required join creates a pending membership; pending member gains no rights.
3. Private join succeeds only with a valid, unexpired, unused invitation; acceptance consumes the token.
4. Reused vs expired tokens fail with distinct explicit errors.
5. Invalid/unknown tokens rejected.
6. Unauthenticated joins rejected; guests imply no membership.
7. Integration tests cover instant, approval, invited, duplicate, expired, reused paths.

## Approved decisions

- **Invitee-bound token:** acceptance requires the caller to be the invitation's `invitee_user_id` AND to present a valid raw token (hashed server-side).
- **Issuance deferred to PAF-31:** PAF-29 implements only join/accept. Tests seed invitations via the existing admin RLS INSERT (raw token SHA-256 computed with WebCrypto).

## Changed files (7)

| File                                                          | Change                                                              |
| ------------------------------------------------------------- | ------------------------------------------------------------------- |
| `supabase/migrations/20261007083756_community_join_flows.sql` | NEW — `join_public_community`, `accept_community_invitation` (+106) |
| `src/lib/supabase/database.types.ts`                          | regenerated (+14)                                                   |
| `src/features/community/community.validators.ts`              | +join/accept validators (+38/−13)                                   |
| `src/features/community/community.functions.ts`               | +`joinCommunity`, +`acceptInvitation`, error map (+42)              |
| `test/community.join.functions.test.ts`                       | NEW — mocked boundary tests (+141)                                  |
| `test/community.integration.test.ts`                          | +join/token-lifecycle matrix (+281)                                 |
| `docs/plan/Plan PAF-29 …md`                                   | plan doc                                                            |

`git diff --shortstat origin/feature/PAF-28-public-community-discovery..HEAD` → `7 files changed, 642 insertions(+), 13 deletions(-)`

## Full diff

```
git diff origin/feature/PAF-28-public-community-discovery..HEAD
```

### Migration (join RPCs)

See the committed file. Key points:

- `join_public_community(p_community_id uuid)`: auth check (`28000`); `SELECT ... FOR SHARE` public community + `join_policy` (`PJ007` if not public/found); duplicate open membership (`PJ006`); insert `member` with `active` (instant) / `pending` (admin_approval); `unique_violation` on `community_members_open` → `PJ006`.
- `accept_community_invitation(p_token text)`: auth check; canonical `^[0-9a-f]{64}$` (`PJ001`); lookup `token_hash = encode(extensions.digest(p_token,'sha256'),'hex')` `FOR UPDATE` (`PJ001` if not found); invitee match (`PJ005`); redeemed (`PJ003`); revoked (`PJ004`); expired vs captured `clock_timestamp()` (`PJ002`); community private (`PJ007`); duplicate (`PJ006`); insert membership; set `redeemed_at` once. Atomic in one transaction.
- Both `SECURITY DEFINER SET search_path = ''`; `REVOKE ALL ... FROM public, anon, authenticated`; `GRANT EXECUTE ... TO authenticated`.

### Server functions

```ts
const joinErrors: Record<string, string> = {
  '28000': 'UNAUTHENTICATED',
  PJ001: 'INVITATION_INVALID',
  PJ002: 'INVITATION_EXPIRED',
  PJ003: 'INVITATION_USED',
  PJ004: 'INVITATION_REVOKED',
  PJ005: 'INVITATION_NOT_FOR_USER',
  PJ006: 'ALREADY_MEMBER_OR_PENDING',
  PJ007: 'COMMUNITY_NOT_ELIGIBLE'
};
function throwJoinError(error: { code: string }): never {
  if (Object.hasOwn(joinErrors, error.code)) throw new Error(joinErrors[error.code]);
  throw error;
}
export const joinCommunity = createServerFn({ method: 'POST' })
  .validator(validateJoinCommunity)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    const { data: joined, error } = await client
      .rpc('join_public_community', { p_community_id: data.community_id })
      .single();
    if (error) throwJoinError(error);
    if (!joined) throw new Error('COMMUNITY_JOIN_FAILED');
    return { community_id: joined.community_id, status: joined.status };
  });
export const acceptInvitation = createServerFn({ method: 'POST' })
  .validator(validateAcceptInvitation)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    const { data: joined, error } = await client
      .rpc('accept_community_invitation', { p_token: data.token })
      .single();
    if (error) throwJoinError(error);
    if (!joined) throw new Error('COMMUNITY_JOIN_FAILED');
    return { community_id: joined.community_id, status: joined.status };
  });
```

### Validators

`validateJoinCommunity({ community_id })` and `validateAcceptInvitation({ token })` (canonical 64 lowercase-hex), plus a shared `communityId` UUID helper refactor. `INVALID_COMMUNITY_INPUT`.

## Fast-gate result (green)

- `pnpm db:reset` ✅; `pnpm db:types` twice → byte-identical ✅
- `pnpm exec vitest run test/community.join.functions.test.ts test/community.integration.test.ts` ✅ 24/24 (integration ran: 12 tests)
- `pnpm typecheck` ✅, `pnpm lint` ✅, `pnpm format:check` ✅, `pnpm test` ✅ (300 tests)

## Review scope

- `code-review-specialist` — always.
- `architecture-review-specialist` — `src/features` + `supabase/migrations` changed.
- `ux-ui-reviewer-specialist` — skipped (no UI).

## Notes for reviewers

- Identity is derived from `auth.uid()` inside the RPCs; no caller-supplied user/role.
- The token is hashed before storage/compare; raw token never persisted.
- Distinct SQLSTATEs (`PJ001`–`PJ007`) map to stable app errors.
- Issuance is deferred to PAF-31; tests seed invitations via admin RLS INSERT.
- Concurrency: invitation `FOR UPDATE` serializes same-token accepts; `unique_violation` on `community_members_open` handles duplicate races.
