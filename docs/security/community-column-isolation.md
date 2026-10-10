# Community metadata column isolation

## Database access

`public.communities` no longer grants table-wide `SELECT` to `PUBLIC`, `anon`, or
`authenticated`. The migration grants `authenticated` column-level `SELECT` only on
`id`, `name`, `description`, `logo_path`, `city_label`, `visibility`, `join_policy`,
`created_at`, and `updated_at`. Existing row-level policies still limit visible rows.
`settings` and `created_by` remain stored internally and have no direct authenticated
read grant. This is role-wide: an Admin's direct `SELECT *` also fails intentionally.

## Settings RPC contracts

- `public.get_community_settings(p_community_id uuid)` requires a non-anonymous
  authenticated user who is a current active community member. Returns only `id` and
  `settings`. Missing or unauthorized communities raise `PG001`; missing authentication
  raises `28000`.
- `public.update_community_settings(p_community_id uuid, p_changes jsonb)` requires a
  non-anonymous authenticated current Admin. The RPC locks the community row before
  checking current Admin status, validates a non-empty whitelist patch, and applies
  static assignments. Omitted fields remain unchanged; nullable text set to JSON null
  clears the field; supplied settings replace the JSON object. Returns only
  `id,name,visibility,join_policy,description,city_label,logo_path,settings,updated_at`.
  Missing/unauthorized communities raise `PG001`; missing authentication raises `28000`;
  malformed patches raise `22023` (or table constraint errors for invalid database text).

Both functions use `SECURITY DEFINER`, empty `search_path`, and fully-qualified names.
Execution is revoked from `PUBLIC` and `anon`, then granted to `authenticated` only.
The reader uses active-membership authorization; mutation authorization is checked under
the community-first row lock. Existing timestamp and audit triggers continue to apply.

## Role matrix

| Actor                               | Safe direct columns        | `settings` / `created_by` direct or `SELECT *` | Settings reader                         | Settings writer    |
| ----------------------------------- | -------------------------- | ---------------------------------------------- | --------------------------------------- | ------------------ |
| Unauthenticated / `anon`            | No community rows          | Denied                                         | Denied (`28000`)                        | Denied (`28000`)   |
| Anonymous sign-in (`authenticated`) | No community rows          | Denied                                         | Denied (`28000` / membership rejection) | Denied (`28000`)   |
| Authenticated nonmember             | Public rows only           | Denied                                         | Denied (`PG001`)                        | Denied (`PG001`)   |
| Active Member                       | Rows allowed by row policy | Denied                                         | Own membership only                     | Denied (`PG001`)   |
| Active Admin                        | Rows allowed by row policy | Denied                                         | Own membership only                     | Own community only |

Direct authenticated `SELECT *` failure is intentional, including for Admins. Callers
requiring settings must use the narrow RPC/server-function path; never restore broad
table `SELECT` to accommodate legacy queries.

## Production compatibility and rollout

This is a forward-only migration and changes compatibility for deployed clients that
select `settings` or `created_by` directly, including `SELECT *` and sensitive-column
`RETURNING`. Deploy the compatible server-function release and migration as a coordinated
change (or use a separately planned additive-RPC then revoke-grants rollout). Verify
PostgREST schema cache refresh and all database clients before release. Do not roll back
by restoring table-wide `SELECT`; fix forward while retaining restrictive grants.
