-- PAF-188 (L-3, L-4): stop future objects from inheriting open grants and drop the
-- unused legacy notes starter table. Existing explicit grants are NOT touched; only
-- default privileges for objects created later by the migration owner change.

-- L-4: public.notes is the unused starter table (0 rows, no application references).
-- Dropped without CASCADE so any unexpected dependent object aborts the migration.
-- Irreversible: export schema/data before applying to a production database.
drop table public.notes;

-- L-3: future tables/sequences in public get no direct anon/authenticated access.
-- Each new table must grant explicitly (and enable RLS). service_role keeps its defaults.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
-- Future functions: drop the schema-level anon/authenticated EXECUTE defaults and the
-- global PUBLIC EXECUTE default (a schema-scoped revoke cannot undo a global grant).
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;
alter default privileges for role postgres
  revoke execute on functions from public;

-- Existing trigger function: invoked only by triggers, which do not check EXECUTE
-- against the updating role, so no client role needs it. Not SECURITY DEFINER.
revoke all on function public.touch_player_updated_at() from public, anon, authenticated;
