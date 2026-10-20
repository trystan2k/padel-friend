# PAF-27 Context Bundle

## Scope

- **Issue:** PAF-27 — PAF-2.2 — Server functions: community create, settings, initial Admin assignment
- **Parent:** PAF-2 (T02)
- **Branch:** `feature/PAF-27-community-server-functions` (STACKED on `origin/feature/PAF-33-regenerate-supabase-database-types` @ `3804c29`; PR targets the PAF-33 branch, not `main`)
- **Unit of work:** PAF-27 itself (single unit)
- **Commit:** `729d082` — `feat: add community creation and admin settings server functions`
- **Plan file:** `docs/plan/Plan PAF-27 PAF-2.2 — Server functions: community create, settings, initial Admin assignment.md`

## Acceptance criteria

1. An authenticated player can create multiple communities via the server function; each creation makes the creator the sole initial Admin with an active membership row.
2. Create accepts Public/Private visibility and instant-vs-admin-approval join policy; invalid values are rejected.
3. Unauthenticated calls are rejected by the `getClaims()` check inside each server function.
4. Settings updates succeed only for Admins; a member attempt returns an explicit error.
5. All writes respect RLS; no service-role secrets are exposed to browser code.
6. Integration tests cover create and settings success and failure paths, including member attempting a settings change.

## Approved decisions

- Community types available via PAF-33 (stacked below).
- Join policy = typed `community_join_policy` enum column + extended `create_community` RPC (NOT in `settings` jsonb).

## Changed files (7)

| File                                                           | Change                                             |
| -------------------------------------------------------------- | -------------------------------------------------- |
| `supabase/migrations/20261002105936_community_join_policy.sql` | NEW — enum + column + grant + drop/recreate RPC    |
| `src/lib/supabase/database.types.ts`                           | regenerated (+6)                                   |
| `src/features/community/community.validators.ts`               | NEW — create/settings validators                   |
| `src/features/community/community.functions.ts`                | NEW — `createCommunity`, `updateCommunitySettings` |
| `test/community.functions.test.ts`                             | NEW — mocked boundary tests                        |
| `test/community.integration.test.ts`                           | updated RPC calls + real-JWT scenarios (+201/−16)  |
| `docs/plan/Plan PAF-27 …md`                                    | plan doc                                           |

`git diff --shortstat origin/feature/PAF-33-regenerate-supabase-database-types..HEAD` → `7 files changed, 623 insertions(+), 16 deletions(-)`

## Full diff

Reproduce with:

```
git diff origin/feature/PAF-33-regenerate-supabase-database-types..HEAD
```

The migration, validators, and functions are reproduced below; the test diff is large and should be read from the command.

### Migration

```sql
create type public.community_join_policy as enum ('instant', 'admin_approval');
alter table public.communities
  add column join_policy public.community_join_policy not null
  default 'admin_approval'::public.community_join_policy;
grant update (join_policy) on public.communities to authenticated;
drop function public.create_community(text, public.community_visibility, text, text);
create function public.create_community(p_name text, p_visibility public.community_visibility,
  p_join_policy public.community_join_policy, p_description text default null,
  p_city_label text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_actor uuid := (select auth.uid());
begin
  if v_actor is null or coalesce((select auth.jwt()->>'is_anonymous'), 'false') = 'true' then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  insert into public.communities (name, visibility, join_policy, description, city_label, created_by)
    values (p_name, p_visibility, p_join_policy, p_description, p_city_label, v_actor)
    returning id into v_id;
  insert into public.community_members (community_id, user_id, role, status)
    values (v_id, v_actor, 'admin', 'active');
  return v_id;
end;
$$;
revoke all on function public.create_community(text, public.community_visibility,
  public.community_join_policy, text, text) from public, anon, authenticated;
grant execute on function public.create_community(text, public.community_visibility,
  public.community_join_policy, text, text) to authenticated;
```

### Server functions

```ts
export const createCommunity = createServerFn({ method: 'POST' })
  .validator(validateCreateCommunity)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    const { data: id, error } = await client.rpc('create_community', {
      p_name: data.name,
      p_visibility: data.visibility,
      p_join_policy: data.join_policy,
      ...(data.description != null ? { p_description: data.description } : {}),
      ...(data.city_label != null ? { p_city_label: data.city_label } : {})
    });
    if (error) throw error;
    return { id };
  });

export const updateCommunitySettings = createServerFn({ method: 'POST' })
  .validator(validateUpdateCommunitySettings)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    const { community_id, ...changes } = data;
    const { data: updated, error } = await client
      .from('communities')
      .update(changes)
      .eq('id', community_id)
      .select('id,name,visibility,join_policy,description,city_label,logo_path,settings,updated_at')
      .maybeSingle();
    if (error) throw error;
    if (!updated) throw new Error('NOT_COMMUNITY_ADMIN');
    return updated;
  });
```

### Validators

`community.validators.ts` — strict allowlists (`objectWithKeys`), SQL-parity `name` (1–80 code points, no edge whitespace), enum checks, optional text limits (description 500, city_label 120, logo_path 256), a cycle-safe JSON check for `settings` with a 4096-byte cap, and `INVALID_COMMUNITY_INPUT`. `validateUpdateCommunitySettings` requires a UUID `community_id` plus at least one mutable field.

## Fast-gate result (green)

- `pnpm db:reset` ✅; `pnpm db:types` twice → byte-identical (SHA-256 `4915f0b3…`) ✅
- `pnpm exec vitest run test/community.functions.test.ts test/community.integration.test.ts` ✅ 17/17 (integration ran, 10 tests incl. backend guard)
- `pnpm typecheck` ✅, `pnpm lint` ✅, `pnpm format:check` ✅, `pnpm test` ✅ (276 tests)

## Review scope

- `code-review-specialist` — always.
- `architecture-review-specialist` — `src/features` + `supabase/migrations` changed.
- `ux-ui-reviewer-specialist` — skipped (no UI).

## Notes for reviewers

- `updateCommunitySettings` relies on the existing admin RLS UPDATE policy; zero returned rows → `NOT_COMMUNITY_ADMIN` (same for non-admin and unknown ID, no existence oracle).
- The RPC signature change is a breaking change to PAF-26's integration test calls, which were updated.
- No service-role secrets; no new dependencies; no UI.
