---
name: tanstack-start-architecture
description: Defines PadelFriend's TanStack Start architecture rules for feature slicing, route adapters, shared UI and infrastructure ownership, file naming, and test placement. Use when adding, moving, or refactoring routes, features, shared components, or app structure in this repo.
---

# TanStack Start Architecture

Use this skill before structural work in PadelFriend.

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
  components/
    ui/
  lib/
  routes/
  router.tsx
```

Current PadelFriend ownership follows this shape:
- `src/features/auth/**`, `src/features/player/**`, and `src/features/theme/**` own their domain behavior.
- `src/components/ui/**` owns reusable shared UI.
- `src/lib/**` owns shared infrastructure and app-wide helpers.
- `src/routes/**` stays the TanStack Start entry layer only.

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
   - Put reusable shared UI in `src/components/`; put shared infrastructure and app-wide helpers in `src/lib/`.
   - Keep both layers generic. If a module starts speaking one feature's language, move its ownership back under that feature.
   - Shared components may depend on shared infrastructure. Neither shared layer may depend on a feature slice.

3. **Routes are thin adapters**
   - `src/routes/**` defines URL path, TanStack route config, loader/beforeLoad wiring, API handlers.
   - Move business logic, session logic, provider availability, and view composition into feature, component, or library modules.
   - Route files should mostly import and connect. Keep them boring.
   - Prefer feature-side helpers like `features/auth/routes/*` over embedding auth logic inside route entries.

4. **Import direction**
   - Allowed: `routes -> features/components/lib`, `features -> components/lib`, `components -> lib`, and dependencies within one feature.
   - Avoid: `components/lib -> features` and `feature A -> feature B` unless dependency is deliberate and stable. Extract common code to `components` or `lib` instead.
   - Keep adapter boundaries one-way. Route entry files should not become feature implementation homes.

5. **Naming**
   - React components: PascalCase file names matching export, e.g. `LoginPage.tsx`.
   - StyleX styles use matching `.styles.ts` modules, e.g. `login-welcome.styles.ts`.
   - Tests use the repository's domain-prefixed naming under `test/`, e.g. `test/ui.password-field.test.ts`.
   - Non-component modules use kebab-case; tests use domain-prefixed names, e.g. `display-name.ts` and `player.display-name.test.ts`.
   - TanStack reserved route filenames stay framework-driven: `__root.tsx`, `_protected.tsx`, `$.ts`.

6. **Tests mirror ownership**
   - Keep automated tests under `test/`, grouped by domain using the repository's established prefixes.
   - Feature tests use prefixes such as `test/auth.*` and `test/player.*`; shared UI tests use `test/ui.*`.
   - Route adapter tests stay with their domain, e.g. `test/auth.routes.test.ts`, when verifying route wiring, redirects, or API entry behavior.
   - E2E journeys live under `e2e/`; prefer testing a module from the same ownership seam that owns it.

7. **No barrels**
   - Do not add barrel files for convenience.
   - Never use `export *`.
   - Prefer direct imports from concrete files so ownership and coupling stay obvious.
   - If an aggregator is unavoidable, use explicit named re-exports only and keep it local to one seam.

## TanStack Start guidance

- Keep file-based route discovery in `src/routes/**`. Do not move route entry files into feature folders.
- Put feature-aware route helpers beside the feature, not beside the route tree.
- Keep server-only code isolated in `server/` or other server-only files and import it only from valid server contexts.
- Keep `src/lib/`, `src/router.tsx`, global styles, generated route tree, and similar app infrastructure outside feature slices unless ownership becomes feature-specific.

## Review checklist

- Does this file belong to one feature? Put it in that feature.
- Is this reused across features? Put UI in `src/components/` and shared infrastructure in `src/lib/`.
- Is this route file doing too much? Push logic into a feature, component, or library helper.
- Does file name match repo convention?
- Do tests mirror source ownership?
- Did you avoid barrel files and `export *`?
