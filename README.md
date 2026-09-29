# Padel Friend

Padel Friend — SSR app for Cloudflare **Workers**. Includes React 19, Base UI, StyleX + design tokens, light/dark themes, en/pt-BR/es, Workbox PWA, Supabase email/password and Google OAuth, app-wide player onboarding/profile, Vitest, Playwright and release-gated CI/CD.

**First deployment:** follow [INITIAL_SETUP.md](./INITIAL_SETUP.md) for the Supabase project, Google OAuth client, callback URLs, GitHub secrets/variables and Cloudflare configuration.

## Create a project

1. Copy this folder (or publish it as a GitHub template). Rename `name` in `package.json`, `name` and `env.preview.name` in `wrangler.jsonc`, Supabase `project_id`, app title, icon, and release version. Do not copy `node_modules`, build output or local secrets.
2. Set up your own Linear workspace, team and project. Copy `.linear.toml.example` to `.linear.toml` and set the workspace and team key; create issues there and update `AGENTS.md` with the project URL.
3. Install Node 24+, pnpm 11+, Docker (for local Supabase); run `pnpm install` and `pnpm db:start`. Copy `.env.example` to `.env.local` and `.dev.vars.example` to `.dev.vars`, replacing the key with the **publishable/anon** key from `pnpm exec supabase status`. Use the remote Supabase URL and publishable key in CI/deployment.
4. Run `pnpm db:reset`, `pnpm db:types`, `pnpm dev`. Sign up and complete your player profile. Local Supabase disables email confirmation for fast development; configure production Auth settings in the Supabase dashboard. `pnpm complete-check` runs all checks. Install Chromium once with `pnpm exec playwright install chromium`.
5. In GitHub set `RELEASE_PLEASE_TOKEN` (PAT permitting release PR creation), `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` secrets and `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` repository variables (configure preview environment variables separately if appropriate). Enable Actions on template-created repositories and branch protection requiring **CI / checks**. Create a Cloudflare account/workers.dev subdomain and review preview/production environment permissions.

## Scripts

`pnpm dev` starts SSR dev server; `pnpm build` builds Worker/assets and generates a static-only service worker; `pnpm preview` runs the built Worker locally; `pnpm deploy` deploys production; `pnpm complete-check` verifies unused code, types, lint, format, unit/E2E tests and build. `pnpm db:reset` recreates local schema; `pnpm db:types` regenerates database types after migrations.

Full-stack end-to-end tests require `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` **exported in the test process** and local Supabase running. Use the local publishable key shown by `pnpm exec supabase status`. `.env.local` alone provides Vite build variables but does not populate Playwright's test-process environment.

## Deployment

Release Please PR CI must pass before preview Worker deployment (other PRs receive checks only). Main CI must pass before Release Please updates or creates a release; a published release tag is rebuilt and deployed to production. Workers are named in `wrangler.jsonc`. Never use a preview Worker against production data unless intended. `VITE_` values are public in client bundles; never put a Supabase service-role key there. Changes to published tokens require `pnpm tokens:build`.

See `ARCHITECTURE.md` and `AGENTS.md` for layout, naming, security and development rules.
