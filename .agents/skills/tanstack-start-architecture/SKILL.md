---
name: tanstack-start-architecture
description: Defines Favoritable's TanStack Start architecture rules for feature slicing, route adapters, shared ownership, file naming, and test placement. Use when adding, moving, or refactoring routes, features, shared modules, or app structure in this repo.
---

# TanStack Start Architecture

Use this skill before structural work in Favoritable.

## Canonical shape

```text
src/
  features/
    <feature>/
      components/
      lib/
      routes/
      server/
      views/
  shared/
    <shared-area>/
  routes/
  db/
  router.tsx
```

Keep current FAV-1 slices aligned with this shape:
- `src/features/auth/**` owns auth/login behavior.
- `src/features/app-shell/**` owns protected shell UI.
- `src/shared/theme/**` owns reusable theme runtime.
- `src/routes/**` stays TanStack Start entry layer only.

## Rules

1. **Feature-first ownership**
   - Put code inside `src/features/<feature>/` when one feature owns behavior, UI, loaders, route helpers, or server logic.
   - Typical inner folders:
     - `components/` reusable UI used only by that feature
     - `views/` route-sized screens or shells
     - `routes/` feature-side route helpers, guards, isomorphic route data helpers
     - `server/` server-only auth/data/env modules
     - `lib/` feature-local non-UI helpers, constants, client adapters
   - Do not create folders preemptively. Add only when used.

2. **Shared means reused by multiple features**
   - Put code in `src/shared/<area>/` only when at least two features use it or it is true app-wide runtime.
   - Shared must stay generic. If module starts speaking one feature's language, move it back under that feature.
   - Shared may depend on shared infra. Shared must not depend on a feature slice.

3. **Routes are thin adapters**
   - `src/routes/**` defines URL path, TanStack route config, loader/beforeLoad wiring, API handlers.
   - Move business logic, session logic, provider availability, view composition into feature or shared modules.
   - Route files should mostly import and connect. Keep them boring.
   - Prefer feature-side helpers like `features/auth/routes/*` over embedding auth logic inside route entries.

4. **Import direction**
   - Allowed: `routes -> features/shared`, `features -> shared`, `shared -> shared`.
   - Avoid: `shared -> features`, `feature A -> feature B` unless dependency is deliberate and stable. Extract common code to `shared` instead.
   - Keep adapter boundaries one-way. Route entry files should not become feature implementation homes.

5. **Naming**
   - React components: PascalCase file names matching export, e.g. `LoginPage.tsx`.
   - Component CSS Modules: same basename, e.g. `LoginPage.module.css`.
   - Component browser tests: same basename under mirrored test ownership, e.g. `test/features/auth/components/LoginPage.browser.test.tsx`.
   - Non-component modules and tests: kebab-case, e.g. `route-auth.ts`, `auth-client.test.ts`.
   - TanStack reserved route filenames stay framework-driven: `__root.tsx`, `_protected.tsx`, `$.ts`.

6. **Tests mirror ownership**
   - Mirror `src/` ownership under `test/`.
   - Feature code tests live in `test/features/<feature>/**`.
   - Shared code tests live in `test/shared/**`.
   - Route adapter tests live in `test/routes/**` when they verify route wiring, redirects, or API entry behavior.
   - Prefer testing a module from the same ownership seam that owns it.

7. **No barrels**
   - Do not add barrel files for convenience.
   - Never use `export *`.
   - Prefer direct imports from concrete files so ownership and coupling stay obvious.
   - If an aggregator is unavoidable, use explicit named re-exports only and keep it local to one seam.

## TanStack Start guidance

- Keep file-based route discovery in `src/routes/**`. Do not move route entry files into feature folders.
- Put feature-aware route helpers beside the feature, not beside the route tree.
- Keep server-only code isolated in `server/` or other server-only files and import it only from valid server contexts.
- Keep `db/`, `router.tsx`, global styles, generated route tree, and similar app infrastructure outside feature slices unless ownership becomes feature-specific.

## Review checklist

- Does this file belong to one feature? Put it in that feature.
- Is this reused across features? Put it in shared.
- Is this route file doing too much? Push logic into feature/shared helper.
- Does file name match repo convention?
- Do tests mirror source ownership?
- Did you avoid barrel files and `export *`?
