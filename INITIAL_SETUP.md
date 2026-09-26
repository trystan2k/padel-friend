# Initial setup and deployment

Follow this checklist for **each project created from this template**. Replace every example name, URL and project reference with values belonging to that project. The Google OAuth credentials are configured in **Supabase**, not in the Worker or the browser.

## 1. Accounts, tools and repository

- Create accounts/workspaces in [GitHub](https://github.com), [Cloudflare](https://dash.cloudflare.com), [Supabase](https://supabase.com/dashboard), [Google Cloud](https://console.cloud.google.com) and [Linear](https://linear.app). Install Node 24+, pnpm 11+, Docker and (for local E2E) Playwright Chromium.
- Create a GitHub repository from this template. Rename `package.json` (`name`), `wrangler.jsonc` (production Worker `name` and `env.preview.name`), `supabase/config.toml` (`project_id`), the app's title, PWA manifest/icon, and release package/version as appropriate. Worker names must be unique in the Cloudflare account. Push to `main`.
- Copy `.linear.toml.example` to `.linear.toml`, fill in your Linear workspace/team, create the Linear project, and replace the example team/issue prefix in `AGENTS.md`. Track work as Linear issues and use the issue ID in feature branches/PRs.
- In GitHub, enable Actions and protect `main` with the **CI / checks** required status check. The workflows use `main` and the `release-please--branches--main` release PR branch. Review GitHub `production` and `preview` environments (approval rules, branch restrictions, and environment-specific variables).

## 2. Supabase project and database

1. Create a [Supabase project](https://supabase.com/dashboard/projects). Record its **Project URL** (`https://<project-ref>.supabase.co`), **project reference**, and **publishable key** (`sb_publishable_...`) from the dashboard's Connect/API Keys view. The publishable key is safe to expose in client code; **never use a secret/service-role key** in any `VITE_` variable.
2. Apply the checked-in migration in `supabase/migrations/` before users sign in. For a new project: `pnpm exec supabase login`, `pnpm exec supabase link --project-ref <project-ref>`, `pnpm exec supabase db push`. Inspect the resulting `public.notes` table, its RLS policies, and Auth users in the dashboard. The example server functions call `getClaims()` before every private query; do not replace those checks with `getSession()`.
3. In **Authentication → URL Configuration**, set the Site URL to the canonical production origin, e.g. `https://app.example.com`. Add **Redirect URLs** for the app's callback route (exact URLs):

   ```text
   https://app.example.com/auth/callback
   https://<production-worker>.<your-subdomain>.workers.dev/auth/callback   # if using workers.dev
   https://<preview-worker>.<your-subdomain>.workers.dev/auth/callback      # if preview uses this Supabase project
   http://127.0.0.1:3000/auth/callback                                     # if using hosted Supabase from local dev
   http://127.0.0.1:4173/auth/callback                                     # if testing the production build locally
   ```

   Use only actual origins you intend to allow; do not use broad wildcards for production OAuth redirects. The `redirectTo` passed by the app must match an allowlisted URL. If using a **separate preview Supabase project**, configure its own keys, Google provider and redirect URLs instead of granting preview access to production data.

4. Review **Authentication → Providers → Email** and confirmation behavior for production. Local `supabase/config.toml` disables email confirmation for quick testing; that local setting does **not** configure hosted Supabase.

## 3. Google OAuth (hosted Supabase)

1. In [Google Auth Platform](https://console.cloud.google.com/auth/overview), select/create a Google Cloud project. Set up **Branding** (app name, support email, authorized domain, and, if required, privacy policy/terms), **Audience** (Internal or External; while External is in Testing, add test users), and **Data Access** scopes `openid`, `.../auth/userinfo.email`, and `.../auth/userinfo.profile`. Publish the app/complete verification when required for the intended audience.
2. Under **Clients → Create client**, create an OAuth client of type **Web application**. In **Authorized JavaScript origins**, add only the relevant app origins, e.g. `https://app.example.com`, the Worker preview origin if applicable, and `http://127.0.0.1:3000` for local use. Origins contain no path or trailing slash.
3. In that same Google client, add **Authorized redirect URIs** for **Supabase Auth**, **not** `/auth/callback` on the app:

   ```text
   https://<project-ref>.supabase.co/auth/v1/callback
   http://127.0.0.1:55321/auth/v1/callback  # only if using the local Supabase Google provider
   ```

   Copy the exact hosted callback URL shown under **Supabase → Authentication → Providers → Google**. If preview has a separate Supabase project, add its Supabase Auth callback URI too. Google redirects to Supabase; Supabase then redirects to the application's `/auth/callback` allowlisted in step 2.

4. Copy the Google **Client ID** and **Client Secret** into **Supabase → Authentication → Providers → Google**, enable the provider, and save. Keep the Client Secret only in Google/Supabase secret stores. Google Client ID/Secret are **not** GitHub Actions secrets for this app and are **not** Worker variables. No Google API access/refresh token is required for basic sign-in. Do not enable `skip_nonce_check` for this web flow.
5. To test Google login against **local Supabase**, set `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET` in the shell that starts Supabase; then uncomment `[auth.external.google]` in `supabase/config.toml` and run `pnpm db:start`. Ensure the Google OAuth client includes the local Supabase callback URI above. The commented block keeps default local setup working without Google credentials. Do not commit the secret or paste it into `supabase/config.toml`.

## 4. Cloudflare Workers and GitHub Actions

1. Set up a Cloudflare account and a `workers.dev` subdomain or custom domain. Note the **Account ID** in Cloudflare. Make a scoped **API token** with permission to deploy Workers (Workers Scripts: Edit, and other account permissions your configuration requires). Ensure both Worker names in `wrangler.jsonc` are valid in that account. Configure production and preview domains/DNS as needed before entering URLs in Supabase and Google.
2. In the GitHub repository, set the following **Actions secrets** (repository or the indicated environment):

   | Secret                  | Used by                       | Source                                                                                                  |
   | ----------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------- |
   | `CLOUDFLARE_API_TOKEN`  | Preview and production deploy | Scoped Cloudflare API token                                                                             |
   | `CLOUDFLARE_ACCOUNT_ID` | Preview and production deploy | Cloudflare dashboard Account ID                                                                         |
   | `RELEASE_PLEASE_TOKEN`  | Release Please PR and release | GitHub PAT with repository Contents and Pull requests read/write access; classic PAT needs `repo` scope |

3. Set these **Actions variables** (repository defaults or distinct `preview`/`production` environment values). The workflows pass them to `pnpm build`; `VITE_` variables are compiled into the browser bundle and must contain only public values:

   | Variable                        | Value                                         |
   | ------------------------------- | --------------------------------------------- |
   | `VITE_SUPABASE_URL`             | Supabase Project URL for that environment     |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable key for the same Supabase project |

4. Verify the `preview` workflow deploys only successful **Release Please PRs**. A successful push to `main` runs CI, then Release Please creates/updates its release PR. After the release PR is merged, successful main CI can create a published release; `.github/workflows/release.yml` rebuilds that release tag and deploys the production Worker. CI checks alone do not deploy ordinary PRs. Review/enable `preview` and `production` GitHub environments so deployments do not wait for unconfigured approvals.

## 5. Local setup and validation

1. Run `pnpm install`, `pnpm db:start`, then `pnpm db:reset` and `pnpm db:types`. Use `pnpm exec supabase status` to obtain the **local** publishable key (local API: `http://127.0.0.1:55321`). Copy `.env.example` to `.env.local` and `.dev.vars.example` to `.dev.vars`, replacing the placeholders. Both files are gitignored. Run `pnpm dev` at `http://127.0.0.1:3000`.
2. Run `pnpm exec playwright install chromium`, then `pnpm complete-check`. To include the **full-stack** local Supabase signup/RLS E2E test, export `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the **test process** before running `pnpm complete-check`; `.env.local` alone is read by Vite but not by Playwright's skip condition. Check SSR, login, notes isolation, locale/theme persistence, and the callback error path. Run `pnpm db:stop` when finished.
3. For hosted Google end-to-end validation, deploy, click **Continue with Google**, confirm the consent screen redirects through Supabase back to `/auth/callback`, and check that `/dashboard` loads a session and notes remain private. Also test a cancelled/denied consent flow: it should return to `/login` with a translated error. This last step requires real Google credentials and cannot be automated from this template alone.

See [Supabase Google OAuth](https://supabase.com/docs/guides/auth/social-login/auth-google), [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls), and [Supabase SSR Auth](https://supabase.com/docs/guides/auth/server-side/creating-a-client) for current provider configuration guidance.
