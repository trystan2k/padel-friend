# PAF-33 Context Bundle

## Scope

- **Issue:** PAF-33 — Regenerate and normalize Supabase database types (CLI format drift)
- **Branch:** `feature/PAF-33-regenerate-supabase-database-types` (STACKED on `origin/feature/PAF-26-community-domain-model` @ `4e6d77a`; PR targets the PAF-26 branch, not `main`)
- **Unit of work:** PAF-33 itself (single unit)
- **Commit:** `2f2a782` — `chore: normalize generated Supabase database types`
- **Plan file:** `docs/plan/Plan PAF-33 Regenerate and normalize Supabase database types (CLI format drift).md`

## Acceptance criteria

1. `pnpm db:types` uses the pinned CLI (`pnpm exec supabase`) and is reproducible.
2. The generated file is deterministically formatted (or the committed format matches the pinned generator).
3. Regenerating on an unchanged schema produces no diff.
4. `pnpm typecheck` passes.

## Approved approach (Route B — scoped oxfmt override)

Probe measured: Route A (global oxfmt) = 2,956 lines; **Route B = 352 lines**; Route C (dense) = 1,244 lines. Route B chosen.

- `package.json` `db:types` → `pnpm exec supabase gen types ... > src/lib/supabase/database.types.ts && pnpm exec oxfmt --write src/lib/supabase/database.types.ts`
- `.oxfmtrc.json` → removed the generated-file ignore; added a scoped override `{ semi: false, singleQuote: false, trailingComma: "all" }`.
- `.lintstagedrc.json` → oxlint glob excludes the generated file (which `.oxlintrc.json` still ignores) so the pre-commit hook no longer errors on "no files found to lint".
- `src/lib/supabase/database.types.ts` → regenerated (adds 5 community tables, 3 enums, 4 RPCs).

## Changed files (5)

| File                                 | Change                              |
| ------------------------------------ | ----------------------------------- |
| `package.json`                       | `db:types` script                   |
| `.oxfmtrc.json`                      | remove ignore + scoped override     |
| `.lintstagedrc.json`                 | oxlint glob excludes generated file |
| `src/lib/supabase/database.types.ts` | regenerated (+337/−50)              |
| `docs/plan/Plan PAF-33 …md`          | plan doc                            |

`git diff --shortstat origin/feature/PAF-26-community-domain-model..HEAD` → `5 files changed, 327 insertions(+), 53 deletions(-)`

## Full diff

Reproduce with:

```
git diff origin/feature/PAF-26-community-domain-model..HEAD
```

The generated `database.types.ts` is machine output; the meaningful hand-written changes are the three config/script files (shown below).

```diff
--- a/.lintstagedrc.json
+++ b/.lintstagedrc.json
@@
-  "*.{ts,tsx,js,mjs}": "oxlint --fix --deny-warnings",
+  "!(src/lib/supabase/database.types.ts)*.{ts,tsx,js,mjs}": "oxlint --fix --deny-warnings",
--- a/.oxfmtrc.json
+++ b/.oxfmtrc.json
@@
-    "src/lib/supabase/database.types.ts",
     ".agents/**",
     ".opencode/**"
+  ],
+  "overrides": [
+    {
+      "files": ["src/lib/supabase/database.types.ts"],
+      "options": { "semi": false, "singleQuote": false, "trailingComma": "all" }
+    }
   ]
--- a/package.json
+++ b/package.json
@@
-    "db:types": "supabase gen types typescript --local --schema public,storage,graphql_public > src/lib/supabase/database.types.ts"
+    "db:types": "pnpm exec supabase gen types typescript --local --schema public,storage,graphql_public > src/lib/supabase/database.types.ts && pnpm exec oxfmt --write src/lib/supabase/database.types.ts"
```

## Fast-gate result (green)

- `pnpm db:reset` ✅; `pnpm db:types` run twice → byte-identical (SHA-256 `4589cb9b…`) ✅
- `pnpm exec oxfmt --check src/lib/supabase/database.types.ts` ✅
- `pnpm typecheck` ✅, `pnpm lint` ✅, `pnpm format:check` ✅, `pnpm test` ✅ (268 tests)
- Pre-commit hook verified: normal TS files still linted (probe caught), generated file excluded ✅

## Review scope

- `code-review-specialist` — always.
- `architecture-review-specialist` — config + `src/lib` changed.
- `ux-ui-reviewer-specialist` — skipped (no UI).

## Notes for reviewers

- No schema/migration/server-function/UI changes.
- The generated file is machine output; focus on the pipeline/config correctness and reproducibility.
- The `.lintstagedrc.json` negated extglob was empirically verified to still lint normal TS files and exclude only the generated file.
