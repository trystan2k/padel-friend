# Initial setup and deployment

Follow this checklist for **each project created from this template**. Replace every example name, URL and project reference with values belonging to that project. The Google OAuth credentials are configured in **Supabase**, not in the Worker or the browser.

**Production backups:** Alpha currently has no automated production backups; the owner accepts possible data loss temporarily. See [production backup plan](docs/production-backup-plan.md) and [PAF-177](https://linear.app/trystanworkspace2/issue/PAF-177/implement-automated-production-backups-and-recovery) before users depend on retained data.

## 1. Accounts, tools and repository

- Create accounts/workspaces in [GitHub](https://github.com), [Cloudflare](https://dash.cloudflare.com), [Supabase](https://supabase.com/dashboard), [Google Cloud](https://console.cloud.google.com) and [Linear](https://linear.app). Install Node 26+, pnpm 12+, Docker and (for local E2E) Playwright Chromium.
- Create a GitHub repository from this template. Rename `package.json` (`name`), `wrangler.jsonc` (production Worker `name` and `env.preview.name`), `supabase/config.toml` (`project_id`), the app's title, PWA manifest/icon, and release package/version as appropriate. Worker names must be unique in the Cloudflare account. Push to `main`.
- Copy `.linear.toml.example` to `.linear.toml`, fill in your Linear workspace/team, create the Linear project, and replace the example team/issue prefix in `AGENTS.md`. Track work as Linear issues and use the issue ID in feature branches/PRs.
- In GitHub, enable Actions and protect `main` with the **CI / checks** required status check. The workflows use `main` and the `release-please--branches--main` release PR branch. Configure the GitHub `production` and `preview` environments as described in section 4.5 (the `production` environment gates every release).

## 2. Supabase project and database

1. Create a [Supabase project](https://supabase.com/dashboard/projects). Record its **Project URL** (`https://<project-ref>.supabase.co`), **project reference**, and **publishable key** (`sb_publishable_...`) from the dashboard's Connect/API Keys view. The publishable key is safe to expose in client code; **never use a secret/service-role key** in any `VITE_` variable.
2. Production migrations are applied **only** by the approval-controlled release workflow (section 4 and the [production release runbook](docs/production-release-runbook.md)): after you approve a release, the pending `supabase/migrations/*.sql` of that exact release tag are applied to project `nojecmdknaebczpfnfwa` before the Worker deploys. Do not push migrations to production by hand as a normal path. A manual `pnpm exec supabase login` / `link` / `db push` is an **owner-authorized exception** (initial bootstrap of a brand-new project, or incident recovery with exclusive production ownership and no release running or pending); always pass `--skip-vault`, never pass `--include-all`, `--include-seed` or `--include-roles`, and prefer the dry-run first. Local and preview databases are separate projects and are not touched by the release workflow. Inspect player profile/rating tables, their RLS policies, the private avatar bucket and Auth users in the dashboard. Private server functions call `getClaims()` before every query; do not replace those checks with `getSession()`.
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
2. In the GitHub repository, set the following **Actions secrets** (repository or the indicated environment; see step 5 for the production environment values the release workflow reads):

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

4. Verify the `preview` workflow deploys only successful **Release Please PRs**. A successful push to `main` runs CI, then Release Please creates/updates its release PR. After the release PR is merged, successful main CI publishes a release and tag, and `.github/workflows/release.yml` then waits for **one manual approval** in the `production` environment. After approval it checks out that exact tag, validates identity and freshness, builds, applies the pending Supabase migrations (or a checked no-op) and only then deploys the Worker. Publication can precede approval; production changes cannot. CI checks alone do not deploy ordinary PRs. Operations, reviewer checklist, failure handling and rotation: [production release runbook](docs/production-release-runbook.md).
5. **Production environment secrets and variables.** Besides the table above, the release workflow reads these from the GitHub `production` **environment** (not job-wide; each secret is exposed to a single step):

   | Name                            | Kind     | Scope in workflow                      | Notes                                                                                                                                                                                          |
   | ------------------------------- | -------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `SUPABASE_ACCESS_TOKEN`         | secret   | migration step only                    | Scoped personal access token limited to project `nojecmdknaebczpfnfwa`; permissions Project Settings Read, API Keys Read, API Key Secrets Read (what `supabase link` needs); give it an expiry |
   | `SUPABASE_DB_PASSWORD`          | secret   | migration step only                    | Database password of that project. `db push` uses it with full database authority; the token scopes do **not** limit SQL                                                                       |
   | `CLOUDFLARE_API_TOKEN`          | secret   | Worker deploy step only                | Workers deploy permission as in step 1                                                                                                                                                         |
   | `CLOUDFLARE_ACCOUNT_ID`         | secret   | Worker deploy step only                | Cloudflare account ID                                                                                                                                                                          |
   | `VITE_SUPABASE_URL`             | variable | build and migration steps              | Must equal exactly `https://nojecmdknaebczpfnfwa.supabase.co` or the release fails before any remote call                                                                                      |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | variable | build and migration steps              | Public `sb_publishable_…` key of the same project; never a secret/service key                                                                                                                  |
   | `RELEASE_PLEASE_TOKEN`          | secret   | `release` job only (repository secret) | Not available to the deploy job. Not yet exercised by a successful run                                                                                                                         |

   Preview deployments need their own Cloudflare secrets (repository or `preview` environment); do not rely on the production environment for them. A presence check in the workflow only proves a secret is non-empty, not that it is valid or correctly scoped: the owner must verify values and scopes (never paste them anywhere).

6. **Required GitHub settings (outside the repository, owner-verified).**
   - Environment `production`: required reviewer `trystan2k`; deployment branch rule that allows the workflow ref `main` (the job runs from `main` and checks out a tag, so do not restrict deployments to tags only); no unintended bypass. **Prevent self-review is intentionally left disabled** so the sole maintainer can approve their own deployments. This is weaker separation of duties; the reviewer checklist in the runbook is the compensating control.
   - Branch protection or ruleset on `main`: require **CI / checks**, forbid force pushes and deletion. Release tags (`v*`) must be immutable: forbid tag update and deletion. The freshness guard assumes `main` is never rewritten and tags are never moved.
   - Do not run manual Dashboard, Wrangler or SQL changes against production while a release is pending or running; the workflow lock cannot coordinate them.
   - The first real approved release is the live proof of these settings; until observed, environment protection is unverified. Alpha has no automated production backups (see the backup note at the top).

## 5. Local setup and validation

1. **Dev stack (your own data).** Run `pnpm install` and `pnpm db:start` (CLI project `padel-friend`, API `http://127.0.0.1:55321`). Read its **local** publishable key from the root project's `pnpm exec supabase status`, copy `.env.example` to `.env.local` and `.dev.vars.example` to `.dev.vars`, and replace the placeholders. Both files are gitignored. Run `pnpm dev` at `http://127.0.0.1:3000`. `pnpm db:reset:dev` wipes and re-seeds the dev database; run it only when you intend to lose your dev data. `pnpm db:stop` stops dev (data kept).
2. **Test stack (disposable data, independent of dev).** Run `pnpm exec playwright install chromium`, then `pnpm test:stack:up`, `pnpm db:reset` (bare `db:reset` resets the **test** stack) and `pnpm db:types:check` (types are generated from the test stack; after editing a migration run `pnpm db:reset` before the check). Run `pnpm test`, `pnpm test:e2e` or the full gate `pnpm complete-check`; they read the test stack's own `supabase status` and never use `.env`, `.env.local` or exported dev credentials, so do not export any for tests. A missing test stack fails the command with an instruction to run `pnpm test:stack:up`. Run `pnpm test:stack:down` when finished (volumes, so test data, are kept). Check SSR, login, onboarding, locale/theme persistence, and the callback error path.
3. For hosted Google end-to-end validation, deploy, click **Continue with Google**, confirm the consent screen redirects through Supabase back to `/auth/callback`, and check that `/onboarding` blocks a new player until profile completion, then `/dashboard` loads the profile. Also test a cancelled/denied consent flow: it should return to `/login` with a translated error. This last step requires real Google credentials and cannot be automated from this template alone.

### Local stacks reference

The opt-in isolation proof cleanup takes a short exclusive lock on affected history tables; concurrent dev reads and writes stall briefly (trigger DDL takes ACCESS EXCLUSIVE) until cleanup commits or rolls back.

Two independent Supabase CLI projects run side by side: **dev** (`supabase/`, project `padel-friend`) and **test** (`test/stack/supabase/`, project `padel-friend-test`). Each has its own containers, network and data volumes (`supabase_db_<project>`, `supabase_storage_<project>`, ...), so test runs and resets never touch dev data. Test tooling never falls back to dev.

| Script                                                        | Target | Effect                                                         |
| ------------------------------------------------------------- | ------ | -------------------------------------------------------------- |
| `pnpm db:start` / `pnpm db:stop`                              | dev    | Start / stop the dev stack (data kept)                         |
| `pnpm db:reset:dev`                                           | dev    | **Wipes** the dev database, re-applies migrations and seed     |
| `pnpm test:stack:up` / `down`                                 | test   | Start / stop the test stack (`down` keeps volumes)             |
| `pnpm test:stack:reset`, `pnpm db:reset`                      | test   | Wipe and re-apply migrations and seed on the test stack        |
| `pnpm db:types` / `pnpm db:types:check`                       | test   | Generate / verify `database.types.ts` from the test schema     |
| `pnpm test`, `test:integration`, `test:e2e`, `complete-check` | test   | Resolve the test tuple from the test stack; fail if it is down |

| Service                                 | Dev                      | Test                               |
| --------------------------------------- | ------------------------ | ---------------------------------- |
| API (Auth, REST, Storage)               | `http://127.0.0.1:55321` | `http://127.0.0.1:55421`           |
| Database                                | `127.0.0.1:55322`        | `127.0.0.1:55422` (shadow `55420`) |
| Studio                                  | `http://127.0.0.1:55323` | `http://127.0.0.1:55423`           |
| Mailpit (web + API)                     | `http://127.0.0.1:55324` | `http://127.0.0.1:55424`           |
| Analytics / edge inspector              | `55327` / CLI default    | `55427` / `55483`                  |
| Controlled OAuth stub (host, test only) | n/a                      | `55499`                            |

- `test/stack/supabase/migrations` and `seed.sql` are relative symlinks to the canonical `supabase/` files, so both stacks apply the same schema. `test/stack/supabase/templates` is a tracked **copy** (the CLI rejects symlinked template paths); `test/test-stack.test.ts` keeps it identical to `supabase/templates`.
- The shared seed removes the pg_cron jobs, so unattended jobs cannot make tests flaky; it applies to dev too after `pnpm db:reset:dev`. Fixtures remove their own `storage.objects` rows on cleanup, and `pnpm db:reset` clears whatever remains in the test stack.
- **One test run at a time.** The test stack has a fixed identity and fixed ports: never run two test/reset commands concurrently, and do not run tests from parallel worktrees on the same machine.
- **Port collision.** If `pnpm test:stack:up` reports a port in use, inspect the owner (`lsof -nP -iTCP:<port> -sTCP:LISTEN`, `docker ps`) and stop that service yourself; the scripts never kill other processes and never pick another port.
- **Memory.** Upstream recommends at least 7 GB RAM per full stack. Budget about 14 GB of Docker memory for both, with a host of 16 GB or more preferred (24 GB or more is comfortable once the app, browsers and Playwright run). That is a recommendation, not a measured minimum. Observed on a developer machine (`docker stats --no-stream`, idle): test stack about 1.7 GiB, dev stack about 2.4 GiB. Images are shared; data volumes are separate and disk use grows with database and Storage content. On a constrained machine stop dev (`pnpm db:stop`) while tests run; never point tests at dev.
- **CI** starts only the test stack (`pnpm test:stack:up` through `.github/actions/supabase-start`) on each disposable runner; no dev stack exists there. The static job stays service-free and bakes the public pair from `test/stack/public-build.json`; each E2E lane verifies its live test stack reports exactly that pair.

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

Organizers and admins can add a not-yet-registered player by name and email. The server creates the Auth identity with Supabase Admin Invite, so this needs a server-only secret, working Auth email delivery and the localized invite template. Apply the migrations first (they reach production through the approved release, see section 2).

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

## 9. Web Push delivery operations

Apply subscription, producer and outbox migrations before enabling dispatch. In-app notifications remain authoritative, independent of all Push settings/provider failures. No historical backfill occurs. New devices receive only notifications created after enrollment.

Configure production and preview separately through Workers variables/secrets (local values belong only in ignored `.dev.vars`):

| Binding                       | Purpose                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `WEB_PUSH_ENABLED`            | Literal `true` enables dispatch/enrollment; anything else disables it.                                              |
| `WEB_PUSH_VAPID_KEY_ID`       | Stable current enrollment key identifier (1–64 characters).                                                         |
| `WEB_PUSH_VAPID_PUBLIC_KEY`   | Base64url uncompressed P-256 public key; returned only by authenticated config read.                                |
| `WEB_PUSH_VAPID_PRIVATE_KEY`  | Current base64url private key, Workers **secret**.                                                                  |
| `WEB_PUSH_VAPID_PRIVATE_KEYS` | Optional Workers **secret**, JSON object mapping retained key IDs to private keys. Public keys derived server-side. |
| `WEB_PUSH_VAPID_SUBJECT`      | Operator contact, `mailto:operator@example.com` or HTTPS URL.                                                       |
| `WEB_PUSH_REVOKED_KEY_IDS`    | Emergency comma-separated revoked IDs; matching devices retired on next enabled sweep.                              |
| `SUPABASE_SERVICE_ROLE_KEY`   | Same server-only service key used by existing scheduled invitation recovery.                                        |

Generate keys once in a trusted operator environment (`pnpm exec web-push generate-vapid-keys`), never on builds/deploys. Store private material using `pnpm exec wrangler secret put <BINDING>` (plus `--env preview` for preview). Never prefix any VAPID binding with `VITE_`; never commit values. Browser build guard checks private binding names, configured private values, and `PUSH_PRIVATE_KEY_CANARY` in JS/maps/SW.

**Delivery semantics.** Existing five-minute Cron Trigger runs both invitation recovery and Push independently. Healthy due work normally reaches provider within five minutes; backlog/retry/provider/device conditions can increase latency. HTTP 2xx means **provider accepted**, never proof of OS display or user receipt. External delivery is **at least once**: a worker crash after provider acceptance but before DB acknowledgement can resend. DB event/device identities, fenced leases, and stable browser `notification:<uuid>` tags with `renotify: false` reduce duplicates; never claim exactly once. Lock-screen messages are generic, subscription-locale translated, with no player/community/venue/scores/tokens.

**Health/retry.** Observe `notification_push_sweep` sanitized counters (`pending`, `accepted`, `retried`, `expired`, `failed`, `skipped`, `unavailable`) and queue health (`oldestDue`, `exhausted`). No endpoint, private payload or key appears in logs. 404/410 retires only affected device; other devices and in-app history/read state survive. 429 respects bounded Retry-After; 5xx/network/timeouts use exponential backoff+jitter. Six attempts/24-hour event TTL terminate as durable exhausted. HTTP 400/redirects fail terminally. 401/403 or missing signing keys report configuration faults, never mass-expire endpoints or silently succeed; restore attempts. Fix config/provider issue, then next cron retries pending jobs. Terminal/exhausted rows remain evidence: do not reset/delete them to replay old private alerts. New business transitions produce new notifications normally.

**Kill switch.** Set `WEB_PUSH_ENABLED=false` to stop claiming/sending without deleting queue/subscriptions/in-app rows. Disabled cron reports `PUSH_DISABLED` rather than false success; invitation sweep still runs. Re-enable only after key/config checks pass; event TTL still bounds delayed sends.

**Rotation.** Put old key ID/private pairs in `WEB_PUSH_VAPID_PRIVATE_KEYS`, then deploy new current ID/public/private pair. Keep old keys until devices reconcile and explicitly re-enable with current key. Never sign old subscriptions with a new unrelated key. Emergency: add compromised IDs to `WEB_PUSH_REVOKED_KEY_IDS`; an enabled scheduled sweep retires only those IDs, or an authorized operator calls service-only `revoke_notification_push_keys(text[])` immediately while kill switch remains off. Remove revoked signing material; affected devices must explicitly re-enable. Never retire notifications.

**Verification.** `test/push.worker-adapter.test.ts` starts isolated wrangler/workerd with production compatibility date/`nodejs_compat`, sends encrypted HTTP to local fake provider, independently decrypts RFC8291 payload and verifies RFC8292 signature/audience. Test provider injection is fixture-only, never deployed. Outbound production URLs require supported HTTPS FCM/Firefox/Apple hosts/default port and never follow redirects. Outbox/matrix integration claimant suites run in serial partition; no live OS credentials required for CI. Physical-device receipt/tap verification remains release acceptance work, not implied by mock-provider success.

### Web Push physical-device acceptance (pending operator execution)

CI mocks certify protocol/UI behavior, not OS delivery. Record date, origin/build, OS/browser version,
install state, permission, notification IDs, device outcomes and screenshots for every row below.
Use HTTPS staging with dispatcher enabled and provisioned VAPID secrets. Never record endpoint URLs,
auth keys, private VAPID keys or session tokens. Provider acceptance is not proof of OS display.

- [ ] Chromium desktop: installed app, explicit permission, enabled account/category and device.
- [ ] Chromium Android: installed app and authorized device; verify foreground/background display.
- [ ] Firefox desktop: supported enrollment, delivery and tap; install guidance remains honest.
- [ ] Safari macOS: supported enrollment, delivery and tap; denied permission gives actionable guidance.
- [ ] iOS/iPadOS Home Screen: installed standalone app, explicit permission, delivery and tap.
- [ ] iOS/iPadOS browser tab: install-required guidance; no permission prompt on entry or preference save.
- [ ] Denied/unsupported device: no false enabled state; critical in-app alerts remain available.
- [ ] Same recipient on two devices: enable one, deny the other. Trigger actual match invitation and
      Reserve promotion. Compare exact recipient/event IDs in in-app history, enabled-device display,
      denied-device absence, and authorized tap destinations. Verify stable tag collapses retries.
- [ ] Global off and each of five category toggles: no OS send; same authoritative in-app history.
- [ ] Sign out before tapping private alert: login preserves safe detail; another account sees no target.
- [ ] Retire one endpoint/key: that device stops receiving; second device and read history survive.
      Routine key rotation shows re-enable guidance without silently requesting permission.
- [ ] Deploy SW update with unsent result draft: defer update, preserve fields, explicitly retry later;
      clean page applies update once, without reload loop. Offline reconnect never submits a mutation.

**Evidence status:** all physical-device rows pending operator execution. Browser emulation and mocked
provider sends do not check these boxes. Final complete-check and delivery review remain separate gates.
