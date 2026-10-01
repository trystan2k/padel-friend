# Architecture

TanStack Start renders routes per request in a Cloudflare Worker. Vite uses `@cloudflare/vite-plugin`; Wrangler deploys the server entry plus static assets. Routes are file-based. Base UI provides accessible dialog primitives. StyleX styles components and Style Dictionary compiles primitive and semantic CSS variables for light/dark themes.

Supabase is the backend. `src/lib/supabase/client.ts` is browser-only; `server.ts` creates one cookie-aware client per server request. Email/password and Google OAuth are available on `/login`. Google sign-in uses the browser Supabase PKCE client; the server route `/auth/callback` exchanges the code, forwards each session cookie, and redirects to a validated in-app path. Google credentials live in Supabase Auth, not in the Worker. Protected routes require a completed app-wide player profile; server functions repeat authorization on every read/write. `supabase/migrations` holds schema and RLS. The historical notes table remains in migration history but has no active UI.

`src/i18n` creates one i18next instance per render; JSON translations live in `src/locales`. Workbox precaches static assets but does not cache authenticated documents. Vitest covers localization; Playwright verifies SSR and interactions. GitHub CI gates preview deployment and Release Please gates production.

## Ownership and route/test boundaries

`src/features/<feature>/` owns feature-specific behavior; `src/components/ui/` owns reusable shared UI, and `src/lib/` owns shared infrastructure. `src/routes/` remains the thin TanStack route-entry layer. `src/routes/onboarding_.account.tsx` defines the standalone public `/onboarding/account` route. Its trailing-underscore opt-out parents it to the root instead of the guarded `/onboarding` route; that separation is deliberate. Automated tests live under `test/**` and `e2e/**`; PAF-1 visual reference images live under `e2e/references/paf-1/**`.
