# Security review — PadelFriend (2026-11-15)

Scope: whole application at `main` @ `aa2d5ef` — Supabase database (RLS, grants, `SECURITY DEFINER` RPCs, storage), TanStack Start server functions on Cloudflare Workers, React frontend / service worker, CI/CD and dependencies.

Method:

- **Static review** of `src/**`, `supabase/migrations/**`, `supabase/config.toml`, `.github/**`, `scripts/**`.
- **Live introspection** of the local **test** stack (`test/stack/supabase`, ports 5542x) after all migrations: grants, column grants, RLS policies, default ACLs, function privileges, `search_path`, buckets, storage policies, cron jobs.
- **Live pen-test** against the test stack (PostgREST, RPC, Storage, GoTrue) and a local `vite preview` build of the Worker (HTTP headers, CSRF, open redirect, server-function error shape). The scripts used throwaway users and lived outside the repo. The test stack is reset by every `pnpm test` / `pnpm test:e2e` run.
- `pnpm audit` (prod and full).

**Production was not touched.** Hosted Supabase / Cloudflare / GitHub settings can't be seen from the repo, so they are listed as "verify" items.

## Summary

| ID      | Severity | Area    | Title                                                                                              | Verified           |
| ------- | -------- | ------- | -------------------------------------------------------------------------------------------------- | ------------------ |
| M-1     | Medium   | DB      | Any community admin can force-add any user (even as **admin**) via PostgREST, skipping consent     | Live exploit       |
| M-2     | Medium   | Backend | No security response headers (CSP, frame-ancestors, HSTS, nosniff, Referrer-Policy)                | Live               |
| M-3     | Medium   | Auth    | Weak password policy (6 chars, no strength/leak check, signup ≠ reset rules); no captcha           | Live (test stack)  |
| M-4     | Medium   | CI/CD   | Third-party GitHub Actions pinned by tag in jobs that hold production secrets                      | Static             |
| L-1     | Low      | Backend | Raw `PostgrestError` (`code/details/hint/message`) returned to the browser from ~63 call sites     | Live               |
| L-2     | Low      | DB      | No per-user rate limits on community creation, public-discovery spam, request messages, publish    | Live               |
| L-3     | Low      | DB      | Default privileges still grant `ALL` to `anon`/`authenticated` on new tables/functions in `public` | Live               |
| L-4     | Low      | DB      | Leftover starter table `notes` with full `anon` grants (incl. `TRUNCATE`)                          | Live               |
| L-5     | Low      | Backend | Supabase auth cookies set without `Secure` (and must be JS-readable)                               | Static             |
| L-6     | Low      | Auth    | Login CSRF via invite `token_hash` GET link (victim signed into attacker-controlled account)       | Static             |
| L-7     | Low      | Storage | Avatar upload path skips the magic-byte check (HTML bytes stored as `image/png`, no `nosniff`)     | Live               |
| L-8     | Low      | Email   | User-controlled names interpolated with `escapeValue:false` into invite email HTML                 | Needs verification |
| L-9     | Low      | Email   | Invite email links built from the request origin instead of `APP_ORIGIN`                           | Static             |
| L-10    | Low      | Supply  | Dev/tooling dependency advisories (undici ×8 high, others moderate/low); prod deps clean           | `pnpm audit`       |
| L-11    | Low      | CI/CD   | Over-broad `GITHUB_TOKEN` scope in preview; `persist-credentials` left on                          | Static             |
| I-1…I-7 | Info     | various | Defence-in-depth and settings to verify (see below)                                                | —                  |

**No Critical or High findings.** The database layer is well built:

- RLS is enabled on every `public` and `storage` table.
- Table grants are narrow.
- All 374 `SECURITY DEFINER` functions pin `search_path=''`.
- Only one function (a trigger function) is executable by `anon`.
- Service-only RPCs are revoked from `public`, `anon` and `authenticated`.
- `pg_graphql` is not installed.
- Buckets are private, with a MIME allowlist and a 2 MB cap.

---

## Medium

### M-1 — Community admin can force-add any user (as member or admin) without consent

**Evidence**

- Column grants: `supabase/migrations/20261002055953_community_domain.sql:132-133`. They give `authenticated` `INSERT (community_id, user_id, role, status)` and `UPDATE (role, status, valid_until)` on `community_members`.
- Policy `"membership admin insert"` (`…community_domain.sql:145`): `WITH CHECK is_community_admin(community_id)`.
- The trigger `guard_community_member()` does not check consent on `INSERT`. It only stamps `activated_at`.
- No application path inserts into `community_members` directly. Joins go through `join_public_community`, invitation acceptance and approval RPCs, so the grant isn't needed.

**Live proof** (test stack):

1. User A runs `create_community(...)`. Any user can do this, so anyone can be "a community admin".
2. A sends: `POST /rest/v1/community_members {community_id, user_id: C, role: "admin", status: "active"}`. Result: **201**.
3. C runs `is_community_member(cid)` → `true`, and `is_community_admin(cid)` → `true`. C never asked to join and never accepted an invitation.

**Impact**

- Any signed-in user can enrol any other user whose UUID they know into a community they control, as an active member or admin. UUIDs are visible in player and statistics URLs and rosters.
- The victim gets membership and role notifications they never asked for. They appear in the member list and in community statistics, rankings and league eligibility.
- Their profile data becomes visible to that community's members.
- This bypasses the invitation consent flow (`community_invitations` + `accept_community_invitation`) and the private-community model.
- It can be used for harassment, spam and reputation abuse.

**Fix**

1. Revoke the direct DML and keep all membership writes in the existing `SECURITY DEFINER` RPCs:
   ```sql
   revoke insert on public.community_members from authenticated;
   revoke update on public.community_members from authenticated;
   drop policy "membership admin insert" on public.community_members;
   drop policy "membership admin update" on public.community_members;
   ```
   Approve, promote and remove already go through `govern_community_member`. Make sure any server function still using `.from('community_members').update(...)` moves to the RPC first.
2. Apply the same check to the other admin column grants that the RPCs already cover: `community_invitations` INSERT/UPDATE, `community_venues` INSERT/UPDATE and `communities` UPDATE. Direct inserts skip server-side rules. For example, `issueInvitation` only allows `private` communities, but the DB doesn't enforce that.
3. Add an integration test: as admin, `POST /rest/v1/community_members` for a foreign user must fail.

### M-2 — No security response headers

**Evidence:**

- `src/server.ts:46-60` and `src/lib/private-response.ts` set only `Cache-Control`, `Vary` and `X-Request-Id`.
- There is no `public/_headers` file and no `<meta http-equiv>` tag.
- Live: `GET /login` on the preview build returns only `cache-control: private, no-store`.

**Impact:**

- **Clickjacking:** the app can be framed and authenticated one-click actions abused, such as accepting an invitation, leaving a community, cancelling a match or admin governance.
- **No CSP:** there is nothing to limit damage from a future XSS. The Supabase session cookie must be JS-readable (L-5), so an XSS would mean session theft.
- **No HSTS:** a user's first visit can be downgraded to HTTP.

**Fix:** add these headers in the `fetch` wrapper in `src/server.ts`, next to `applyPrivateResponsePolicy`:

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-{per-request}'; style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: https://<project>.supabase.co; connect-src 'self' https://<project>.supabase.co wss://<project>.supabase.co;
  frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

TanStack Start supports a nonce for its inline hydration scripts. Start in `Content-Security-Policy-Report-Only` mode, then enforce. At minimum, ship `frame-ancestors 'none'`, `nosniff`, HSTS and `Referrer-Policy` right away.

### M-3 — Weak password policy; no bot protection

**Evidence**

- `supabase/config.toml` sets no `minimum_password_length`, `password_requirements`, `[auth.captcha]` or `[auth.rate_limit]`.
- Live on the test stack: `POST /auth/v1/signup {password: "123456"}` → **200** with a session.
- The client rules don't match each other:
  - Signup and login accept 6 characters (`src/features/auth/AccountSignup.tsx:33,93`, `LoginWelcome.tsx:124`).
  - Reset and claim require 8 (`ResetPassword.tsx:30`, `ClaimPasswordStep.tsx:42`).
- `INITIAL_SETUP.md` documents email confirmation and SMTP, but not password strength, leaked-password protection or captcha.

**Impact:** credential stuffing and password spraying against weak passwords. The browser talks to GoTrue directly, so the Worker can't rate-limit those calls.

**Fix**

1. In `supabase/config.toml` (and the hosted project, via dashboard or `supabase config push`):
   ```toml
   [auth]
   minimum_password_length = 10
   password_requirements = "lower_upper_letters_digits"
   [auth.email]
   secure_password_change = true
   [auth.captcha] # Turnstile fits a Cloudflare deployment
   enabled = true
   provider = "turnstile"
   secret = "env(SUPABASE_AUTH_CAPTCHA_SECRET)"
   ```
2. Turn on **Leaked password protection** (HIBP) in the hosted project, and review **Auth → Rate limits**.
3. Use one client-side rule everywhere, through a shared validator that matches the server minimum.
4. Record these hosted settings in `INITIAL_SETUP.md`, next to the existing "Confirm email" requirement.

### M-4 — GitHub Actions pinned by mutable tag in secret-bearing jobs

**Evidence:** `.github/workflows/release.yml:19,22,52,57,60`, `preview.yml:15,18,21`, `ci.yml` and `.github/actions/supabase-start/action.yml:15,40` all use `@v4`-style tags.

- `googleapis/release-please-action@v4` receives `RELEASE_PLEASE_TOKEN`.
- `pnpm/action-setup@v4` runs in the production job that later gets `SUPABASE_DB_PASSWORD`, `SUPABASE_ACCESS_TOKEN` and `CLOUDFLARE_API_TOKEN`.

**Impact:** if an upstream action is compromised or its tag is moved (as in the tj-actions incident), the attacker's code runs on the deploy runner. It can steal step-scoped secrets from later steps through PATH or `node_modules` hooks.

**Fix:** pin every `uses:` to a full commit SHA with a `# vX.Y.Z` comment, and let Dependabot (`package-ecosystem: github-actions`) or Renovate keep the pins current. Do `release.yml` and `preview.yml` first.

---

## Low

### L-1 — Raw database errors returned to the client

**Evidence:** about 63 `if (error) throw error;` sites pass a `PostgrestError` straight out of a server function. Examples:

- `src/features/community/community-admin.functions.ts:38,89,118,281,290,319,338`
- `community.functions.ts:35,58,122,202,219`
- `notifications.functions.ts:19,40,92,102`
- `player.functions.ts:20,71,100,136,162`
- `community-venue-photo.functions.ts:37`

**Live proof:** `markNotificationRead` called with a random id through `/_serverFn/<id>` returned a serialized object `{code:"42501", details:null, hint:null, message:"Notification unavailable"}`.

Errors wrapped as `new Error(CODE, {cause})` were also checked live (`claimProvisionalPlayer`). The production build serializes only `message`, with no `cause` or stack. So the leak is limited to Postgres `code/details/hint/message`. That still exposes constraint and table names, RLS violation text, and the values from unique and FK violations (`Key (col)=(value) already exists`).

**Fix:** add one `toClientError(error)` helper, or a TanStack error middleware, that maps known SQLSTATE and app codes to an allowlisted `new Error('UPPER_SNAKE_CODE')`. Log the raw error only through `emitDiagnostic` and `safeErrorCode`. `push.functions.ts` already does this. Add a lint or grep check that bans `throw error` in `*.functions.ts`.

### L-2 — No per-user rate limits on several write RPCs

**Evidence:** only `add_match_player`, `dispatch_match_player_add`, `register_my_push_subscription` and `submit_level_review_request` contain any throttle. Live, one user created **40 public, instant-join communities in 319 ms**. All of them appear in every user's `public_community_discovery`. `send_community_request_message`, `publish_match_event` and `create_league` (for members when allowed) have no limits either.

**Impact:** a single account can spam the public discovery list, flood admins with notifications and request messages, and bloat storage.

**Fix:**

- Add DB-side windows, using the pattern `add_match_player` already uses. For example: max 3 communities per user per day, max N request messages per membership per hour, max M events per user per day.
- Cap the total number of communities a user owns.
- Optionally add Cloudflare WAF rate-limit rules on `/rest/v1/rpc/*` and `/_serverFn/*`.

### L-3 — Default privileges still grant everything to `anon`/`authenticated`

**Evidence:** `pg_default_acl` shows that for the `postgres` role in schema `public`, `r: anon=arwdDxtm, authenticated=arwdDxtm` and `f: anon=X, authenticated=X`. The same applies to `storage`. Today every migration revokes these grants explicitly, and the live check shows only one function executable by `anon`. But a future migration that forgets the `revoke` exposes a new table (if RLS is off) or a new `SECURITY DEFINER` function to the internet.

**Fix:** add a migration:

```sql
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated, public;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
```

Then grant explicitly per object, as the migrations already do. Also add a CI guard (pgTAP or an integration test) that fails if a `public` function runs as `SECURITY DEFINER` and is executable by `anon`, or if a table without RLS is visible to API roles.

### L-4 — Leftover `notes` starter table with full `anon` grants

**Evidence:**

- `supabase/migrations/20260925000000_notes.sql`.
- Live: `anon` has `INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER`, and `authenticated` has the same. RLS blocks rows (`anonNotesInsert` → 401), and PostgREST can't issue `TRUNCATE`.
- `notes` has 0 rows, and no application code references the table.

**Fix:** drop the table (`drop table public.notes;`), or at least `revoke all on public.notes from anon;` and revoke `TRUNCATE, TRIGGER, REFERENCES` from `authenticated`.

### L-5 — Auth cookies without `Secure`

**Evidence:** `src/lib/supabase/server.ts:17` and `src/routes/auth.callback.ts:35` use the `@supabase/ssr` defaults: `sameSite: 'lax'`, `httpOnly: false`, `maxAge` 400 days, and no `secure`. `httpOnly: false` is required by the browser client, which is why M-2's CSP matters.

**Fix:** pass `cookieOptions: { secure: import.meta.env.PROD, sameSite: 'lax' }` to `createServerClient` and `createBrowserClient`. Turn on Cloudflare **Always Use HTTPS**, and add HSTS (M-2). Consider a shorter cookie `maxAge`, since refresh-token rotation keeps sessions alive anyway.

### L-6 — Login CSRF through the invite `token_hash` link

**Evidence:** `src/routes/auth.callback.ts:19,41-42`. A `GET /auth/callback?token_hash=…&type=invite` calls `verifyOtp` and replaces any session already in the browser. Nothing ties the link to the visitor.

**Scenario:**

1. The attacker adds a player whose email the attacker controls, and gets the invite link.
2. The attacker sends that link to a victim, who is then signed in as the attacker-controlled provisional player.
3. Anything the victim enters, such as profile details or a password, ends up in an account the attacker can recover later.

Impact is limited: there is no takeover of an existing account, and adds are throttled.

**Fix:** if a different session is already active, show a confirmation page ("You are signed in as X — continue as the invited player?"). Or make the callback page require a POST, sent by a button press, before calling `verifyOtp` for `token_hash` flows.

### L-7 — Avatar upload skips the content check

**Evidence:** `src/features/player/player.functions.ts:141-168` and `player.server.ts:58-72` only check the key format and that the object exists. Match photos (`match-photo.server.ts:39-41`) and venue photos (`community-venue-photo.server.ts:32-35`) also check magic bytes. Users can also write `player_profiles.avatar_url` directly over PostgREST (column grant). The DB check keeps the key inside the user's own folder.

**Live proof:** `<html><script>…` uploaded as `image/png` to `player-avatars/<uid>/x.png` → **200**. The signed URL serves it as `content-type: image/png` with no `X-Content-Type-Options`.

**Impact:** low. The bucket is private and owner-only, the file is served from the Supabase origin, and browsers don't render `image/png` as HTML. The real issue is inconsistency, plus the possibility of hosting polyglot files.

**Fix:** reuse the magic-byte and size check in `completeAvatarUpload`. Consider revoking the direct `UPDATE (avatar_url)` grant so only the verified server path can set it.

### L-8 — User-controlled names in the invite email HTML (needs verification)

**Evidence:** `src/i18n/config.ts:26` sets `escapeValue: false`. `src/features/matches/invitation-email.ts:55-58` puts `inviterName` and `venueName` into `padel_invite_body`. `supabase/templates/invite.html:5` renders `{{ .Data.padel_invite_body }}`.

**Impact:** if GoTrue renders that field without HTML escaping, a display name like `<a href="https://phish">Confirm</a>` injects markup into email sent from the app's own domain.

**Fix:** HTML-escape user-supplied fields before building the metadata (or pass `interpolation: { escapeValue: true }` for that `t()` call). To verify, set a display name to `<b>x</b>`, add a player, and inspect the result in Mailpit (`http://127.0.0.1:55424`).

### L-9 — Invite links take their origin from the incoming request

**Evidence:**

- `match-add-player.functions.ts:42`, `matches.functions.ts:190` and `match-management.functions.ts:83` pass `getRequestUrl().origin` into `reconcileMatchPlayerAdds` → `invitationRedirectTo(origin, …)` (`invitation-email.ts:65`).
- The cron path correctly uses `APP_ORIGIN`.
- The local redirect allowlist uses `/**` wildcards (`supabase/config.toml:20-27`).

**Fix:** always use the validated `APP_ORIGIN` for links in emails. Keep the hosted Supabase redirect allowlist to exact `https://<prod>/auth/callback` entries.

### L-10 — Dependency advisories (build/test tooling only)

`pnpm audit --prod` reports **no known vulnerabilities**. Full `pnpm audit` reports 24 (8 high, 12 moderate, 4 low).

- **High:** all undici.
  - `>=7.0.0 <7.30.1` via `wrangler>miniflare` and `@cloudflare/vite-plugin`.
  - `>=8.0.0 <8.12.2` via `vitest>jsdom` and `@opencode/plugin`.
  - The existing override `'undici@<7.29.1': '7.29.1'` (`pnpm-workspace.yaml:36`) is now too low.
- **Moderate/low:** `fast-uri`, `glob`, `minimatch` and `serialize-javascript <7.1.3`. `deepmerge` has no fix available.

Wrangler uses undici during `wrangler deploy`, so the TLS-validation advisory matters on the deploy runner.

**Fix:** raise the overrides (`'undici@>=7 <7.30.1': '7.30.1'`, `'undici@>=8 <8.12.2': '8.12.2'`, `'fast-uri@<3.1.9': '3.1.9'`, `'serialize-javascript@<7.1.3': '7.1.3'`), or bump `wrangler`, `@cloudflare/vite-plugin` and `jsdom`. Add `pnpm audit --prod --audit-level=high` to CI.

### L-11 — CI token scope

**Evidence:** `preview.yml:6-8` grants `pull-requests: write` even though the job never touches PRs. Every `actions/checkout` keeps `persist-credentials: true`, so `GITHUB_TOKEN` stays in `.git/config` while `pnpm install` and `pnpm build` run.

**Fix:** set `permissions: contents: read` for preview, and `persist-credentials: false` on checkouts that aren't followed by `git push`.

---

## Info / verify in hosted settings

- **I-1 Push endpoint validation is loose at registration.** `register_my_push_subscription` and `push.validators.ts:21` accept any `https://host`. The send path enforces an allowlist (FCM, Mozilla, Apple), uses `redirect: 'manual'` and a 10 s timeout (`push-transport.server.ts:12-36`), so **SSRF is blocked**. A test registration of `https://169.254.169.254/...` was stored but would never be contacted. For defence in depth, run `validatePushEndpoint` at registration and mirror the host allowlist in SQL. Note that Windows/Edge WNS (`*.notify.windows.com`) is not on the allowlist, which is a functional gap.
- **I-2 PostgREST OpenAPI schema readable with the anon key.** `GET /rest/v1/` lists every exposed RPC name and signature. This is standard for Supabase and every RPC is still authorization-checked. Optionally hide it (`db-root-spec` or a custom `pgrst.openapi_mode = 'disabled'`) to make reconnaissance harder.
- **I-3 Anonymous sign-ins** are disabled locally (verified: `anonymous_provider_disabled`). Confirm they are disabled in the hosted project, or reject `claims.is_anonymous` centrally in `requireAuthenticatedClient` (`src/features/auth/auth.server.ts:8-13`).
- **I-4 Production environment protection:** confirm required reviewers, prevent self-review, and deployment refs restricted to `main`/`v*` for the `production` and `preview` environments. Confirm `RELEASE_PLEASE_TOKEN` is a fine-grained PAT scoped to this repo.
- **I-5 Hosted Auth settings:** "Confirm email" must be ON (already documented in `INITIAL_SETUP.md:220`). Also check the redirect allowlist (exact URLs), SMTP and rate limits, and M-3.
- **I-6 Direct-write grants vs RPC rules:** besides M-1, `community_invitations` INSERT lets an admin issue invitations for public communities (`issueInvitation` rejects that, the DB doesn't), and `community_venues` INSERT/UPDATE skips server validators (the DB `CHECK`s still enforce `https://` maps URLs). These go away with M-1 fix step 2.
- **I-7 Local preview crash on a server-fn request with no `Origin`/`Sec-Fetch-Site`.** Miniflare returned an HTML stack trace with local file paths (`TypeError: fetch failed … undici`). This is a local preview artifact, not reproduced in production. Confirm production returns a generic 4xx/5xx.

## Verified safe (coverage)

**Database**

- RLS is enabled on all 83 `public` and 10 `storage` tables. `anon` has no table grants except `notes` (L-4).
- `authenticated` has table-level `SELECT` only on 17 tables. Writes are column-scoped (`communities`, `community_members`, `community_invitations`, `community_venues`, `player_profiles`, invitee preferences).
- `communities` UPDATE is effectively dormant, because there is no `SELECT` grant. Live, the PATCH returned 403.
- All 374 `SECURITY DEFINER` functions have `search_path=""`. Only one function, `touch_player_updated_at()`, a trigger, is executable by `anon`.
- Platform-admin RPCs (`get_rating_history_audit`, `list_level_review_queue`) → 403 for normal users.
- Editing `user_metadata` (`role`, `is_platform_admin`) has no effect. `get_level_review_access` still returns `false`, and no SQL trusts user metadata except the capability-hash path in `complete_match_player_add_identity`, which is restricted to `supabase_auth_admin` and checks a hashed one-time token.
- Non-members can't read private communities, events, registrations, invitee search, community settings or member lookups. They can't publish into, govern or register in a foreign community (all verified live).
- A non-admin member can't promote themselves (the PATCH matches 0 rows), update settings, search members, or cancel or transfer another user's event.
- Cross-user `player_profiles` reads return `[]`.

**Storage**

- Uploads into another user's folder, path traversal (`..%2F`), nested keys, `text/html` and `image/svg+xml` are all rejected.
- Signed URLs last 60 s.
- Other users get 404 when signing someone else's avatar.

**Auth and server functions**

- Every data-touching server function calls `getClaims()` through `requireAuthenticatedClient()`, and none uses `getSession()` on the server.
- The service-role client is used only after a user-scoped RPC has authorized the actor, or from cron.
- `/_serverFn/*` CSRF protection works. Live: cross-site `Sec-Fetch-Site`, `Origin: https://evil.example`, `Origin: null` and an evil `Referer` → **403**.
- `normalizeReturnPath` blocked every open-redirect payload tried (`//evil.com`, `/\evil.com`, `/%2F%2F…`, `/%5C…`, tab/space tricks, absolute URLs).
- PKCE code exchange works, and the callback response is `no-store`.
- Cache policy: HTML, server functions, `/auth/*` and any request carrying an `sb-` cookie get `private, no-store` (verified on `/dashboard`).

**Frontend**

- No `dangerouslySetInnerHTML`, `innerHTML`, `window.open` or `javascript:` sinks.
- Every `target=_blank` link has `rel=noopener/noreferrer`.
- `maps_url` is restricted to `https://` in the validator and in the DB `CHECK`. Live, a `javascript:` URL was rejected with `23514`.
- Service worker:
  - It precaches an allowlist only, and never serves navigations, `/_serverFn/`, `/auth/` or authorized requests from cache.
  - Notification clicks are built from a UUID on the worker's own origin.
  - The message handler accepts only `SKIP_WAITING`.

**Secrets**

- Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` reach the client. The build guard `check-client-secrets.mjs` enforces this, and `dist/client` contains no secrets.
- No real keys were found in tracked files or git history.

**CI**

- There is no `pull_request_target`.
- Both `workflow_run` workflows require the same repository.
- CI is `contents: read` and has no secrets.
- Artifacts are bound to `GITHUB_SHA`.
- Install scripts are restricted to esbuild and workerd, and every install uses `--frozen-lockfile`.

## Suggested remediation order

1. **M-1** (revoke direct membership DML, plus a regression test).
2. **M-2 + L-5** (headers, CSP and `Secure` cookies).
3. **M-3** (hosted Auth hardening, captcha, one password rule).
4. **M-4 + L-11** (pin actions, reduce token scope).
5. **L-1** (central error mapper).
6. **L-3 + L-4** (default privileges, drop `notes`, CI privilege guard).
7. **L-2** (rate limits).
8. The remaining Low and Info items.
