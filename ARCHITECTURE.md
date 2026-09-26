# Architecture

TanStack Start renders routes per request in a Cloudflare Worker. Vite uses `@cloudflare/vite-plugin`; Wrangler deploys the server entry plus static assets. Routes are file-based. Base UI provides accessible dialog primitives. StyleX styles components and Style Dictionary compiles primitive and semantic CSS variables for light/dark themes.

Supabase is the backend. `src/lib/supabase/client.ts` is browser-only; `server.ts` creates one cookie-aware client per server request. Email/password and Google OAuth are available on `/login`. Google sign-in uses the browser Supabase PKCE client; the server route `/auth/callback` exchanges the code, forwards each session cookie, and redirects to the protected dashboard. Google credentials live in Supabase Auth, not in the Worker. Protected routes check identity; server functions repeat authorization on every read/write. `supabase/migrations` holds schema and RLS. The notes feature is a replaceable example.

`src/i18n` creates one i18next instance per render; JSON translations live in `src/locales`. Workbox precaches static assets but does not cache authenticated documents. Vitest covers localization; Playwright verifies SSR and interactions. GitHub CI gates preview deployment and Release Please gates production.
