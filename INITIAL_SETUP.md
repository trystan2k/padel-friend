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

## 7. Match result auto-confirm scheduler (pg_cron)

T08.3 confirms each still-Pending result proposal at its database deadline (`submitted_at + 48 hours`). The confirmation keeps that exact deadline as `effective_at`; a disputed proposal is excluded. Late runs catch up on the next tick. The browser cannot execute or supply a clock to the processor.

- **Enablement.** `supabase/migrations/20261028194235_match_result_auto_confirm_scheduler.sql` creates or updates the singleton job when pg_cron is available:
  - Job name: `padel-friend-match-result-auto-confirm`
  - Schedule: `* * * * *` (every minute)
  - Command: `select public.process_due_match_event_results(25)`
- **Local smoke proof.** Local `supabase db reset` runs `supabase/seed.sql`, which removes scheduler jobs to keep integration/E2E fixtures deterministic. After tests, re-create the result job and verify both enabled state and successful execution (wait for a new minute tick):
  ```sql
  select cron.schedule('padel-friend-match-result-auto-confirm', '* * * * *',
    'select public.process_due_match_event_results(25)');

  select jobid, jobname, schedule, active
    from cron.job
   where jobname = 'padel-friend-match-result-auto-confirm';

  select start_time, status, return_message
    from cron.job_run_details
   where jobid = (select jobid from cron.job
                   where jobname = 'padel-friend-match-result-auto-confirm')
   order by start_time desc limit 20;
  ```
  Require exactly one `cron.job` row with `active = true` and a `succeeded` row in `cron.job_run_details`; migration notices do not prove provisioning or execution. Remove the local job before running tests with `select cron.unschedule('padel-friend-match-result-auto-confirm');`.
- **Monitoring.** pg_cron records command-level status, not per-proposal outcomes. Inspect version-scoped attempts, sanitized failure code/detail and retry time:
  ```sql
  select proposal_id, proposal_version, attempt_count, failure_count,
         last_failure_at, last_failure_code, last_failure_message, next_attempt_at
    from public.match_event_result_processing_state
   where last_failure_code is not null
   order by last_failure_at desc;
  ```
  The processor returns `attempted`, `skipped`, `failed`, and `confirmed`; each exception subtransaction rolls back that proposal's confirmation/audit effects before recording failure metadata. Exponential retry delay is capped at five minutes; the least-attempted, oldest due versions run first.
- **Recovery.** Pause with `select cron.unschedule('padel-friend-match-result-auto-confirm');`, repair forward, then re-schedule with the same name. Corrections start a fresh 48-hour deadline and version-scoped retry state; no confirmed identity is deleted or replayed.

## 8. Added-player invitations (service-role secret, SMTP, templates)

Organizers and admins can add a not-yet-registered player by name and email. The server creates the Auth identity with Supabase Admin Invite, so this needs a server-only secret, working Auth email delivery and the localized invite template. Apply the migrations first (`pnpm exec supabase db push`).

1. **Service-role secret (server only).** The server reads `SUPABASE_SERVICE_ROLE_KEY` (`src/lib/supabase/admin.server.ts`). Copy the **secret/service-role key** from **Supabase → Project Settings → API Keys** and store it as a Workers **secret**, never as a `VITE_` variable, GitHub variable, `wrangler.jsonc` value or committed file:

   ```sh
   pnpm exec wrangler secret put SUPABASE_SERVICE_ROLE_KEY                  # production
   pnpm exec wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env preview    # preview (use the preview project's key)
   ```

   For local `wrangler dev`/preview put it in the git-ignored `.dev.vars`. `scripts/check-client-secrets.mjs` (run by `pnpm build`) fails the build if the key reaches a client asset. Adding a player fails before any write while the secret is missing.

2. **Custom SMTP (production).** Supabase's built-in mailer is rate limited and only for testing. In **Authentication → Emails → SMTP Settings** enable custom SMTP and set host, port, username, password, and a sender name/address on a domain you control (SPF, DKIM and DMARC records configured with your provider). The SMTP credentials live only in Supabase. Raise **Authentication → Rate Limits → emails sent** above the expected invite volume. This is applied in the hosted dashboard (or `supabase config push`), so it is **not** deployed by this repository: record that it was applied for each environment before enabling the add-player entry point. Locally, Auth sends to Mailpit at `http://127.0.0.1:55324` (`[local_smtp]` in `supabase/config.toml`); no credentials are needed.

3. **Invite template and localization.** One template serves every language. For each send the server renders the subject, heading, body, button and footer in the **adder's locale** (en, pt-BR, es; unknown locales fall back to en) from `auth.invitationEmail.*` in `src/locales/*/translation.json`, naming the inviter and the event, and passes them as invite metadata (`padel_invite_*`, built by `src/features/matches/invitation-email.ts`). The template prints them; Auth HTML-escapes every value. Local Auth loads `supabase/templates/invite.html` and the subject `{{ .Data.padel_invite_subject }}` from `[auth.email.template.invite]` in `supabase/config.toml` (restart with `pnpm db:stop && pnpm db:start` after editing). For hosted Supabase, paste the **same** values in **Authentication → Emails → Templates → Invite user**: subject `{{ .Data.padel_invite_subject }}` and the body of `supabase/templates/invite.html` (or `supabase config push` with the same `[auth.email.template.invite]` block). Keep subject copy free of `'`, `&`, `<`, `>`, `"` because Auth escapes subjects. Auth renders a resent invite from stored metadata, so the server refreshes it right before every send.

4. **Link and redirect allowlist.** The button opens `<app origin>/auth/callback?next=/matches/<event id>&token_hash=…&type=invite`. The app origin is the request origin of the add call and must be in **Authentication → URL Configuration → Redirect URLs** (section 2.3), otherwise Auth rejects the invite. The callback consumes `token_hash` and sends the player to onboarding, then the event. Invitations expire with the Auth OTP lifetime (**Authentication → Providers → Email → Email OTP expiration**); after that, adding the same email again (outside the 15 minute per-recipient throttle) sends a fresh invite to the same identity without creating a second account.

5. **Verified claims.** Email confirmation must be **required** in hosted Supabase (Providers → Email → Confirm email). Local `enable_confirmations = false` only simplifies normal signup tests; an invited player proves the email by opening the invite link.

6. **How a player claims the identity.** The permanent Auth UUID never changes; claiming only clears the provisional marker after the database has verified mailbox ownership. A provisional session can call exactly two RPCs (`get_provisional_claim_context`, `claim_provisional_player`); everything else stays blocked until the claim. Ownership is proven by the session's own authentication method (JWT `amr`, signed by Auth), never by `auth.users.email_confirmed_at` alone, the invited address, or anything the client sends:
   - **Invite link** (primary). `/auth/callback?token_hash=…&type=invite` verifies the single-use hash with Auth (method `otp`), then onboarding shows the form prefilled with the name and level the organizer entered. Mail scanners that open links can spend the hash; the player then uses the recovery path below.
   - **Google** (same email). Auth links a Google sign-in whose email matches the invited address to the **same** user, so no duplicate account appears. The claim accepts it only when every provider identity on the account reports `email_verified = true` for that address (the Auth token names neither the provider nor the identity behind an OAuth session, so an unverified identity can never borrow another identity's verification); the claim also removes any provider identity that does not, and every other session of the identity. Configure Google as in section 3 and keep it the only external provider in hosted environments. Real Google consent still needs your credentials (section 5, step 3); the repository tests drive Auth's real linking code with a controlled stub provider (`[auth.external.keycloak]` in `supabase/config.toml`, local only), which proves linking behavior, not Google itself. Never `supabase config push` that block to a hosted project: keep the stub provider disabled there (it points at `host.docker.internal`), or push only the sections you intend to change. The OAuth integration suite skips itself when Auth cannot reach the stub (for example Docker on Linux without a `host.docker.internal` alias).
   - **Email and password** (documented fallback). Signing up with the invited address never claims it and never creates a second user. The player verifies the address with **Forgot password**: the recovery email (method `otp`) opens the reset page, they choose a password, and onboarding then offers the claim on that same session. The claim resets the identity's password (it cannot tell a password set by a verified session from one an unverified signup session planted), so the player sets the password they want again on that same session after claiming (or through **Forgot password** later). A password sign-in alone is not proof, so a player who only has a password session sees a "confirm your email first" step that signs out and starts that recovery flow.
   - **Local-only caveat.** With `enable_confirmations = false`, Auth hands a session to a plain signup against an invited address and stamps `email_confirmed_at` without any mailbox proof, which is exactly why the claim does not trust that column. Production must keep **Confirm email** required (step 5); do not enable add-player in an environment where it is off.
   - **What claiming does.** One transaction: validates the profile fields, locks and, only when the player has no rated history, applies the edited starting level to the initial rating (a level change is rejected once rated games or rating movement exist), keeps the same memberships and registrations, clears the marker, drops unverified identities, other sessions, the stored password and any pending email change, and writes one `player_claimed` audit row on the originating event. The creator-estimated provenance stays on the profile.

7. **Scheduled invitation retries (Worker cron).** An invitation that Auth could not send is kept in the service-only ledger (`match_player_add_operations`) and re-driven with exponential backoff and a bounded attempt count; a spent budget retires it as `exhausted` (recipient slot released, never shown in any audit). The deadline-driven trigger is a Cloudflare **Cron Trigger** (`triggers.crons` in `wrangler.jsonc`, every 5 minutes, production and `preview`), handled by the Worker's `scheduled` export in the custom entry `src/server.ts` (`wrangler.jsonc` `main`). It runs the same sweep as the traffic-driven path (`claim_match_player_add_redrives` → dispatch → Auth → settle), so an idle installation still recovers. Deploy requirements:
   - **`APP_ORIGIN`** (plain Worker variable or secret, per environment): the public origin of the app, for example `https://padel.example`. A cron has no request, so the invite links take their origin from here; it must be in **Authentication → URL Configuration → Redirect URLs** (step 4). Without a valid value every scheduled run fails with `APP_ORIGIN_UNAVAILABLE` (visible under the Worker's **Cron Triggers → Past events** and in observability logs) instead of mailing bad links. Set it with `pnpm exec wrangler secret put APP_ORIGIN` (and `--env preview`) or as a dashboard variable; for local `wrangler dev` put it in `.dev.vars`.
   - **`SUPABASE_SERVICE_ROLE_KEY`**: the same server-only secret as step 1; the cron reads it from the Worker environment like request handlers do. Nothing about the schedule is exposed over HTTP.
   - **Local check.** The repository tests call the sweep directly (`test/matches.add-player.reconcile.integration.test.ts`); to exercise the handler itself run `pnpm exec wrangler dev --test-scheduled` and `curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=*+*+*+*+*"`.
   - **Limits.** Cloudflare may start a cron run a little late, so retries are at least one backoff interval apart, never exact. Each run drives up to three rounds of five due operations; a larger backlog drains over the following runs.
