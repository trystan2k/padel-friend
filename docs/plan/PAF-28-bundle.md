# PAF-28 Context Bundle

## Scope

- **Issue:** PAF-28 — PAF-2.3 — Public community discovery + privacy isolation
- **Parent:** PAF-2 (T02)
- **Branch:** `feature/PAF-28-public-community-discovery` (STACKED on `origin/feature/PAF-27-community-server-functions` @ `fde1f03`; PR targets the PAF-27 branch, not `main`)
- **Unit of work:** PAF-28 itself (single unit)
- **Commit:** `39a7efe` — `feat: add public community discovery with privacy-safe responses`
- **Plan file:** `docs/plan/Plan PAF-28 PAF-2.3 — Public community discovery + privacy isolation.md`

## Acceptance criteria

1. An authenticated user can list and search Public communities; results contain only public-safe fields.
2. A nonmember query for private communities returns zero rows — via server function and direct client query (RLS).
3. A nonmember cannot fetch a private community's detail or its matches via any server function or direct client query.
4. Public payloads never expose private account fields.
5. Integration tests cover the actor matrix (anonymous, nonmember, member, Admin) for list, detail, and matches reads.

## Approved decisions

- **Matches-specific RLS/test deferred to PAF-4** (no matches table exists). AC3's matches clause is structurally deferred; PAF-4 owns the match SELECT policy/test reusing `can_read_community`.
- **Public-safe fields = 9 columns:** `id, name, description, logo_path, city_label, visibility, join_policy, created_at, updated_at`. Exclude `settings` and `created_by`.
- **AC4 = server-function payloads only.** Under PAF-26's table-wide `SELECT` grant, a direct client `SELECT *` on a _public_ community can still read `settings`/`created_by`; PAF-28 does NOT claim direct-client public-column isolation. Documented limitation.

## Changed files (5)

| File                                             | Change                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `src/features/community/community.functions.ts`  | +`listPublicCommunities`, +`getPublicCommunity` (+47/−1)                              |
| `src/features/community/community.validators.ts` | +list/detail validators, `PublicCommunity` type, `pgText` surrogate handling (+50/−1) |
| `test/community.discovery.functions.test.ts`     | NEW — mocked boundary tests                                                           |
| `test/community.integration.test.ts`             | +actor matrix + direct-client leakage probes (+82)                                    |
| `docs/plan/Plan PAF-28 …md`                      | plan doc                                                                              |

`git diff --shortstat origin/feature/PAF-27-community-server-functions..HEAD` → `5 files changed, 415 insertions(+), 2 deletions(-)`

## Full diff

```
git diff origin/feature/PAF-27-community-server-functions..HEAD
```

### New server functions

```ts
const publicCommunityColumns =
  'id,name,description,logo_path,city_label,visibility,join_policy,created_at,updated_at' as const;

export const listPublicCommunities = createServerFn({ method: 'GET' })
  .validator(validateListPublicCommunities)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    const { offset, limit, search } = data;
    let query = client
      .from('communities')
      .select(publicCommunityColumns)
      .eq('visibility', 'public');
    if (search) query = query.ilike('name', `%${search.replace(/[%_\\]/g, '\\$&')}%`);
    const { data: rows, error } = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + limit);
    if (error) throw error;
    const communities: PublicCommunity[] = (rows ?? []).slice(0, limit);
    return { communities, next_offset: (rows?.length ?? 0) > limit ? offset + limit : null };
  });

export const getPublicCommunity = createServerFn({ method: 'GET' })
  .validator(validateGetPublicCommunity)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    const { data: community, error } = await client
      .from('communities')
      .select(publicCommunityColumns)
      .eq('id', data.community_id)
      .eq('visibility', 'public')
      .maybeSingle();
    if (error) throw error;
    return community;
  });
```

### New validators

`validateListPublicCommunities` (strict allowlist `search/offset/limit`; offset default 0, 0–10000; limit default 20, 1–50; trimmed `pgText` search ≤ 80 code points; blank → no search) and `validateGetPublicCommunity` (UUID `community_id`). Both use `INVALID_COMMUNITY_INPUT`.

## Fast-gate result (green)

- `pnpm db:reset` ✅ (no schema change)
- `pnpm exec vitest run test/community.discovery.functions.test.ts test/community.integration.test.ts` ✅ 18/18 (integration ran: 10 tests + backend guard)
- `pnpm typecheck` ✅, `pnpm lint` ✅, `pnpm format:check` ✅, `pnpm test` ✅ (286 tests), `knip` ✅

## Review scope

- `code-review-specialist` — always.
- `architecture-review-specialist` — `src/features` changed.
- `ux-ui-reviewer-specialist` — skipped (no UI).

## Notes for reviewers

- Privacy is defense-in-depth: RLS (row-level, from PAF-26) + explicit 9-column server projection + `visibility='public'` filter.
- Private and missing IDs both return `null` (no existence oracle).
- Direct-client public-column isolation is explicitly NOT claimed; do not treat that as a defect of this change.
- Matches probes are out of scope (PAF-4).
