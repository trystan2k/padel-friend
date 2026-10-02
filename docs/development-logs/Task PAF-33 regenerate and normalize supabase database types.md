---
title: PAF-33 Regenerate and normalize Supabase database types
type: development-log
permalink: docs/development-logs/task-paf-33-regenerate-and-normalize-supabase-database-types
---

# Development Log: PAF-33

## Metadata

- Task ID: PAF-33 (Regenerate and normalize Supabase database types (CLI format drift); related to PAF-2 / T02)
- Date (UTC): 2026-10-02
- Project: padel-friend
- Branch: feature/PAF-33-regenerate-supabase-database-types (STACKED on origin/feature/PAF-26-community-domain-model @ `4e6d77a`)
- Commit: `2f2a782` — `chore: normalize generated Supabase database types`
- Plan: `docs/plan/Plan PAF-33 Regenerate and normalize Supabase database types (CLI format drift).md`
- Findings ledger: `docs/plan/PAF-33-findings.md`
- Context bundle: `docs/plan/PAF-33-bundle.md`

## Objective

- Make `src/lib/supabase/database.types.ts` reproducible and stable: use the pinned Supabase CLI, add a deterministic formatting step, and regenerate so future schema PRs show only real type additions. This unblocks PAF-27 (server functions needing community types).

## Implementation Summary

- **Route B (scoped oxfmt override)** chosen after a measured probe: Route A (global oxfmt) = 2,956 changed lines; Route B = 352; Route C (raw dense generator) = 1,244.
- `package.json` `db:types` now runs `pnpm exec supabase gen types typescript --local --schema public,storage,graphql_public > src/lib/supabase/database.types.ts && pnpm exec oxfmt --write src/lib/supabase/database.types.ts`.
- `.oxfmtrc.json`: removed the generated-file ignore and added a scoped override `{ semi: false, singleQuote: false, trailingComma: "all" }` matching the committed style; global options unchanged.
- `.lintstagedrc.json`: oxlint glob changed to `!(src/lib/supabase/database.types.ts)*.{ts,tsx,js,mjs}` so the pre-commit hook no longer errors on the oxlint-ignored generated file; verified normal TS files are still linted.
- `src/lib/supabase/database.types.ts` regenerated: adds 5 community tables, 3 enums, 4 RPCs; existing public/storage/graphql_public types retained.

## Files Changed

- `package.json` — `db:types` script.
- `.oxfmtrc.json` — remove ignore + scoped override.
- `.lintstagedrc.json` — oxlint glob excludes the generated file.
- `src/lib/supabase/database.types.ts` — regenerated (+337/−50).
- `docs/plan/Plan PAF-33 Regenerate and normalize Supabase database types (CLI format drift).md` — plan (committed).

## Key Decisions

- Standardize on the pinned CLI plus a file-scoped oxfmt override rather than accepting the generator's dense output or reformatting the whole file with global options.
- Keep `.oxlintrc.json` ignoring the generated file (removing it exposed a `typescript(no-redundant-type-constituents)` finding); exclude it at the lint-staged layer instead.
- Stacked PR: PAF-33 targets the PAF-26 branch, not `main`.

## Validation Performed

- `pnpm db:reset` clean; `pnpm db:types` run twice → byte-identical (SHA-256 `4589cb9bb8ac4891ef0da8c04b9c13684dd32641a4c6ada9f3ec246f076b24c0`).
- `pnpm exec oxfmt --check src/lib/supabase/database.types.ts` green.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` (268 tests) green.
- Pre-commit hook verified: normal TS files still linted (probe caught), generated file excluded.

## Review

- Code review and architecture review completed on commit `2f2a782`; no critical or major findings.
- Two minor findings deferred (F1: CI does not verify generated types match the schema; F2: a failed generation can truncate the tracked types file) — tracked in `docs/plan/PAF-33-findings.md`.

## Risks and Follow-ups

- **F1 (deferred):** CI resets the schema but never verifies the committed generated types match it; a future non-mutating drift check could catch stale types.
- **F2 (deferred):** a failed generation can truncate the tracked types file before the command succeeds; a future wrapper could write to a temp file and replace only on success.
- PAF-27 (server functions) is now unblocked and can consume the community types.
