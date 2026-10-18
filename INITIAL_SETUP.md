# Initial setup and deployment

Follow this checklist for **each project created from this template**. Replace every example name, URL and project reference with values belonging to that project. The Google OAuth credentials are configured in **Supabase**, not in the Worker or the browser.

## 1. Accounts, tools and repository

- Create accounts/workspaces in [GitHub](https://github.com), [Cloudflare](https://dash.cloudflare.com), [Supabase](https://supabase.com/dashboard), [Google Cloud](https://console.cloud.google.com) and [Linear](https://linear.app). Install Node 26+, pnpm 12+, Docker and (for local E2E) Playwright Chromium.
- Create a GitHub repository from this template. Rename `package.json` (`name`), `wrangler.jsonc` (production Worker `name` and `env.preview.name`), `supabase/config.toml` (`project_id`), the app's title, PWA manifest/icon, and release package/version as appropriate. Worker names must be unique in the Cloudflare account. Push to `main`.
- Copy `.linear.toml.example` to `.linear.toml`, fill in your Linear workspace/team, create the Linear project, and replace the example team/issue prefix in `AGENTS.md`. Track work as Linear issues and use the issue ID in feature branches/PRs.
- In GitHub, enable Actions and protect `main` with the **CI / checks** required status check. The workflows use `main` and the `release-please--branches--main` release PR branch. Review GitHub `production` and `preview` environments (approval rules, branch restrictions, and environment-specific variables).

## 2. Supabase project and database

1. Create a [Supabase project](https://supabase.com/dashboard/projects). Record its **Project URL** (`https://<project-ref>.supabase.co`), **project reference**, and **publishable key** (`sb_publishable_...`) from the dashboard's Connect/API Keys view. The publishable key is safe to expose in client code; **never use a secret/service-role key** in any `VITE_` variable.
2. Apply the checked-in migrations in `supabase/migrations/` before users sign in. For a new project: `pnpm exec supabase login`, `pnpm exec supabase link --project-ref <project-ref>`, `pnpm exec supabase db push`. Inspect player profile/rating tables, their RLS policies, the private avatar bucket and Auth users in the dashboard. Private server functions call `getClaims()` before every query; do not replace those checks with `getSession()`.
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
2. Run `pnpm exec playwright install chromium`, then `pnpm complete-check`. For **full-stack** local Supabase signup/RLS E2E tests, export `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the **test process**; `.env.local` alone is read by Vite but not by Playwright. Check SSR, login, onboarding, locale/theme persistence, and the callback error path. Run `pnpm db:stop` when finished.
3. For hosted Google end-to-end validation, deploy, click **Continue with Google**, confirm the consent screen redirects through Supabase back to `/auth/callback`, and check that `/onboarding` blocks a new player until profile completion, then `/dashboard` loads the profile. Also test a cancelled/denied consent flow: it should return to `/login` with a translated error. This last step requires real Google credentials and cannot be automated from this template alone.

See [Supabase Google OAuth](https://supabase.com/docs/guides/auth/social-login/auth-google), [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls), and [Supabase SSR Auth](https://supabase.com/docs/guides/auth/server-side/creating-a-client) for current provider configuration guidance.

## 6. Match registration cutoff scheduler (pg_cron)

PAF-5.4 processes the match registration cutoff unattended. The job expires still-pending requests, flips only the residual Reserve to Reserve Not Playing (complete quartets stay playable), and writes the cutoff alerts and marker in one transaction. It is the only producer of the two cutoff notification kinds (`match_registration_expired`, `match_registration_not_playing`).

- **Enablement.** `supabase/migrations/20261017220000_match_registration_cutoff_scheduler.sql` provisions the job when pg_cron is available, and is guarded so the rest of the schema still applies when it is not. It creates the extension (`create extension if not exists pg_cron`) and schedules one named job, so re-applying the migration updates that job instead of duplicating it:
  - Job name: `padel-friend-match-registration-cutoff` (singleton identity)
  - Schedule: `* * * * *` (every minute)
  - Command: `select public.process_due_match_event_registration_cutoffs(25)`
- **Availability.** pg_cron (1.6.4) ships preloaded on the local stack (`shared_preload_libraries` includes `pg_cron`, `cron.database_name = postgres`) and is a supported extension on hosted Supabase, so `pnpm db:reset` creates the job. When pg_cron cannot be created or scheduled, the migration only raises a notice and leaves the internal processors callable for controlled operation; verify with:
  ```sql
  select jobid, jobname, schedule, active from cron.job where jobname = 'padel-friend-match-registration-cutoff';
  ```
- **Local determinism.** `supabase/seed.sql` (local-only; never run by `supabase db push`) removes the job so an unattended mutation cannot make the integration/E2E gates flaky. Re-create it on demand for local smoke runs:
  ```sql
  select cron.schedule('padel-friend-match-registration-cutoff', '* * * * *',
    'select public.process_due_match_event_registration_cutoffs(25)');
  ```
- **Latency.** Hard closure is exact at the cutoff instant because joins/approvals evaluate the DB clock under the event lock. The unattended job only persists the transition and alerts, so the worst-case alert delay is about one interval plus processing time (~2 minutes). Overdue events that became due during downtime are caught up by the same unprocessed-marker predicate on the next tick; there is no lateness cutoff.
- **Monitoring.** `cron.job_run_details` records every run's status, but for a `select` command pg_cron only stores the row count (`return_message = '1 row'`), so the batch's per-event errors are NOT visible there. Failures are instead retained durably on the per-event state row: the batch stamps `cutoff_failure_count`, `cutoff_last_failure_at`, `cutoff_last_failure_sqlstate` and `cutoff_last_failure_message`, cleared as soon as the event processes cleanly. An operator queries:
  ```sql
  select s.match_event_id, s.cutoff_failure_count, s.cutoff_last_failure_at,
         s.cutoff_last_failure_sqlstate, s.cutoff_last_failure_message
    from public.match_event_registration_state s
   where s.cutoff_failure_count > 0
   order by s.cutoff_last_failure_at desc;
  ```
  Run-level health is still available from cron:
  ```sql
  select start_time, status, return_message from cron.job_run_details
   where jobid = (select jobid from cron.job where jobname = 'padel-friend-match-registration-cutoff')
   order by start_time desc limit 20;
  ```
  The batch also returns `{"processed","skipped","failed","selected","errors"}` when invoked directly; a non-zero `failed` or non-empty `errors` means an event failed and will be retried next tick.
- **Recovery.** Each event runs in its own exception subtransaction, so a failing event's effects and marker roll back while the rest of the batch completes. Pause the scheduler, repair forward (never reopen the cutoff or erase accepted order), then re-schedule with the same singleton name:
  ```sql
  select cron.unschedule('padel-friend-match-registration-cutoff');
  ```
  Events the batch could not lock immediately are skipped, not blocked, and are retried on the next tick. The internal processors are revoked from `public`, `anon` and `authenticated`; no browser role can run them or control the effective clock.
