---
title: PAF-182 Security hardening — 2026-11-15 security review
type: development-log
permalink: docs/development-logs/task-PAF-182-security-hardening-2026-11-15-security-review
---

# Development Log: PAF-182

## Metadata

- Task ID: PAF-182 — "Security hardening — 2026-11-15 security review" (epic; Linear PadelFriend project; children PAF-183…PAF-194 + user-approved PAF-181 provisional-session reader repair)
- Date (UTC): 2026-11-15
- Project: padel-friend
- Branch: `feature/PAF-182-security-hardening-2026-11-15-security-review` (base `origin/main` @ `b3adf6a`)
- Commits (19 on the branch, chronological; final HEAD `f1d82c1`):
  - `2ff861b` — `fix: revoke direct community DML grants and route admin writes through RPCs` (U1, PAF-183)
  - `228488a` — `fix: add security response headers with CSP nonce and secure auth cookies` (U2, PAF-184)
  - `e440583` — `fix: enforce strong password policy with opt-in captcha and anonymous sign-in guard` (U3, PAF-185)
  - `061139d` — `chore: pin GitHub Actions to commit SHAs and minimize workflow token scope` (U4, PAF-186)
  - `9b02611` — `fix: map server-function errors to allowlisted client codes via central toClientError` (U5, PAF-187)
  - `0b48013` — `test: align workflow and migration assertions with pinned actions and new migration` (U5 companion)
  - `dff5d25` — `fix: lock down database default privileges and drop legacy notes table` (U6, PAF-188)
  - `87f314a` — `fix: add per-user rate limits to community, request, match, and league RPCs` (U7, PAF-189)
  - `a8fda1f` — `fix: require same-origin confirmation before invite token verification` (U8, PAF-190)
  - `4ae6d2d` — `fix: verify avatar upload bytes and restrict avatar_url writes to the verified server path` (U9, PAF-191)
  - `9ba403f` — `fix: derive invitation redirect URLs from validated APP_ORIGIN` (U10, PAF-192)
  - `a5e1593` — `fix: raise dependency overrides to clear high advisories and add prod audit gate` (U11, PAF-193)
  - `904d972` — `fix: allowlist push endpoints at registration and disable public REST OpenAPI root` (U12, PAF-194)
  - `80f92b4` — `fix: isolate provisional and revoked sessions from privileged match readers` (U13, PAF-181)
  - `afbefe4` — `fix: address review findings` (review round 1, 36 files)
  - `b00f653` — `fix: resolve delta review findings` (round 2, 21 files)
  - `3bf7743` — `fix: harden guard boundary and invite session flush` (round 3)
  - `e5063cf` — `fix: invert guard cause detection and hide captcha status` (round 4)
  - `f1d82c1` — `fix: make captcha fallback visible on failure and refine guard masking` (round 5, final HEAD)
- Diff vs base: **172 files changed, +7201/−895** (soft PR-size guideline exceeded by coherent single security scope — accepted, recorded as observation O4)
- Context sources: `docs/plan/PAF-182-bundle.md` (per-unit summary + gate evidence + post-review state), `docs/plan/PAF-182-findings.md` (findings ledger F1–F32 + observations O1–O5)

## Objective

- Remediate the 2026-11-15 whole-application security review (2 Medium + 11 Low + 7 Info findings) spanning Supabase DB (RLS, grants, SECURITY DEFINER RPCs), TanStack Start server functions on Cloudflare Workers, React frontend/service worker, CI/CD, and dependencies — one commit per unit, 13 units.
- Deliver the user-approved PAF-181 repair: production writes user-approved in-session, so provisional and revoked sessions must be isolated from privileged match readers (creation options, amendments, disputes, diagnostics).
- Absorb the post-delivery review loop (code-review + architecture-review + UX/UI-review rounds and deltas) with every finding fixed and regression-proven; leave production database untouched (migrations ship via the release process).

## Implementation Summary

- **U1 / PAF-183 (`2ff861b`) — grant revocation + admin RPCs:** revoked direct community DML grants from app roles; admin writes routed through 5 new SECURITY DEFINER RPCs with `search_path=''`; new `client-error-codes.ts` registry as the allowlist of client-visible error codes; `test/helpers/trusted-client.ts` service-role fixtures; write-boundary integration tests proving clients can no longer DML directly.
- **U2 / PAF-184 (`228488a`) — security headers + secure cookies:** security headers applied in `src/server.ts`: CSP shipped Report-Only with per-request nonce (AsyncLocalStorage / router context), HSTS production-only, `frame-ancestors`, `nosniff`, Referrer-Policy, Permissions-Policy, XFO DENY. `ENFORCE_CSP` switch to flip enforcement later (owner action). Auth cookies made Secure via protocol-aware `authCookieOptions(protocol)`.
- **U3 / PAF-185 (`e440583`) — password policy + captcha + anon guard:** 10-char policy (lower+upper+digit+symbol) in both `supabase/config.toml` and test-stack `config.toml` plus shared `password-policy.ts` wired into 4 forms (login keeps a non-blocking legacy hint); opt-in Turnstile (`VITE_TURNSTILE_SITE_KEY` flag, `captcha.ts`, widget component, CSP extension for the challenge origin); `is_anonymous` rejection in `requireAuthenticatedClient` and anonymous sign-ins disabled; i18n ×3 (en/pt-BR/es); hosted-setup checklist INITIAL_SETUP.md §11.
- **U4 / PAF-186 (`061139d`) — CI supply chain:** all 8 third-party GitHub Actions `uses:` pinned to commit SHAs (peeled SHAs + version comments); dependabot enabled for github-actions ecosystem; preview workflow downgraded to `contents: read`; `persist-credentials: false` everywhere (no checkout pushes); env-protection checklist documented.
- **U5 / PAF-187 (`9b02611` + `0b48013`) — server-error hygiene:** central `toClientError()` in `client-error.server.ts`: registry exact-match passthrough, SQLSTATE→generic map, diagnostics carry only code + source + SQLSTATE token; 44 raw throws in `*.functions.ts` (+4 `.server.ts` helpers) reduced to 0; static guard `scripts/check-server-function-errors.mjs` wired into `complete-check --only=static` and CI so raw throws cannot return; `markNotificationRead` leak regression-proven. Companion commit `0b48013` aligned 5 delivery-introduced workflow/migration assertion failures (52/52 green).
- **U6 / PAF-188 (`dff5d25`) — DB privilege lockdown:** `ALTER DEFAULT PRIVILEGES` revokes for tables/sequences/functions on postgres-owned objects plus global PUBLIC function revoke; dropped legacy `public.notes` table; `privilege-guard.ts` (3 rules, empty allowlists) proven against synthetic violations; `touch_player_updated_at` EXECUTE revoked from clients (trigger still fires on writes).
- **U7 / PAF-189 (`87f314a`) — per-user rate limits:** limits enforced inside RPCs — 3 communities/24h + 10 owned cap, 10 messages/thread/hour, 20 match events/24h, 5 leagues/24h — with advisory-lock serialization against race bypass; new registry codes; i18n ×3; E2E fixtures audited to stay under limits.
- **U8 / PAF-190 (`a8fda1f`) — invite confirmation hardening:** GET `/auth/callback?token_hash` no longer verifies — it renders an i18n confirmation page; verification requires same-origin POST (Origin check + Fetch Metadata + HMAC binding via `__Host-` cookie on HTTPS); active-session warning names the currently signed-in account; PKCE flow untouched; `normalizeReturnPath` kept; cross-site POST → 403. (`src/routeTree.gen.ts` is gitignored; regenerated locally.)
- **U9 / PAF-191 (`4ae6d2d`) — avatar upload verification:** shared `image-verification.ts` (magic-byte + size checks) applied across avatar/match/venue uploads; failed verification deletes the stored object; decision (a): `UPDATE(avatar_url)` column grant revoked — the service-role compare-and-set finalizer is the sole writer of `avatar_url`; codes `INVALID_AVATAR`, `AVATAR_CLEANUP_FAILED`.
- **U10 / PAF-192 (`9ba403f`) — L-8 disproof + origin validation:** L-8 (user-metadata XSS) disproved live in Mailpit — GoTrue already HTML-escapes metadata (evidence: `&lt;img src=x onerror=alert(1)&gt;` rendered inert); kept plain metadata + `escapeValue:false` + live regression (pre-escaping would double-escape). L-9 fixed: strict `app-origin.server.ts` validation of `APP_ORIGIN` used for all invite redirect URLs (cron + 3 call sites); hosted allowlist docs with labeled examples.
- **U11 / PAF-193 (`a5e1593`) — dependency audit:** overrides raised in `pnpm-workspace.yaml` (undici 7.30.1/8.12.2, fast-uri 3.1.9, serialize-javascript 7.1.3); high advisories 8→0; residue documented (deepmerge no-fix upstream; glob/minimatch compat residue); CI step `audit --prod --audit-level=high` with retry/corepack fallback.
- **U12 / PAF-194 (`904d972`) — push endpoint + OpenAPI:** push endpoint allowlist (fcm.googleapis.com, `*.push.services.mozilla.com`, web.push.apple.com + subdomain forms; WNS rejected consistently) enforced at registration in app code and SQL constraint with a shared adversarial corpus; REST OpenAPI root disabled via migration (anon REST root → 404 verified); I-7 verified on the production build (generic 403, no stack leak).
- **U13 / PAF-181 (`80f92b4`) — provisional/revoked reader isolation:** `get_match_creation_options` returns empty for provisional/revoked actors; amendment and dispute readers reject restricted actors; 3 regression tests recreated + 1 new + 4 existing kept (8/8 green). Its bounded audit surfaced 2 observations promoted to review findings F7/F8 and fixed in the review loop (amendment historical-team correlation; diagnostics platform-admin guard).
- **Review loop (5 fix commits):** full review round 1 (`afbefe4`, 36 files) → delta rounds (`b00f653` → `3bf7743` → `e5063cf` → `f1d82c1`). 32 findings (F1–F32, 8 major) all fixed and verified through deltas; zero deferred. Highlights: referrer-policy finalizer leak fix (F1); error-guard boundary hardened across 4 rounds (scope all `.functions`/`.server` files + dynamic-error + promise-reject rules (F2), reject-argument restriction (F15), cause-via-assignment (F24), regex-vs-division lexer (F25), non-leading shorthand inversion (F28), template `${}`-aware masking (F31), string-literal key-position rule (F32), audited `// guard-allow:` tags only (F19)); invite flow rebuilt as request-scoped cookie jar with finally-flush + fail-closed claims handling + cookie rotation on both clients (F10/F11/F21/F27); quota made immutable via trigger-set `published_by` + invariant regression (F9/F22); captcha widget sr-only aria-live status + visible failure fallback (F5/F16/F17/F26/F29/F30); push-endpoint constraint rebuilt as strict superset of the old grammar (F13/F14/F23); password-policy runtime proof against real GoTrue (F4).

## Files Changed

Aggregate overview (172 files, +7201/−895; grouped by area, not enumerated):

- Database (7 new migrations + config): `supabase/migrations/20261115*` — grant revocations + admin RPCs (U1), default-privilege lockdown + `notes` drop (U6), rate limits (U7), push-endpoint allowlist + OpenAPI disable (U12), provisional reader isolation (U13), diagnostics-reader admin guard (F8), plus `CREATE OR REPLACE` amendment-reader correlation (F7); `supabase/config.toml` and `test/stack/supabase/config.toml` (password policy, anon sign-ins off, U3).
- Server/runtime: `src/server.ts` (security headers, CSP nonce, ENFORCE_CSP, U2; referrer-policy finalizer fix F1); `src/lib/` (11 files — `diagnostics.server.ts` mapped rethrow F18, `app-origin.server.ts` new U10, cookie options, image verification support); `src/features/auth/` (invite-confirmation server + page, `password-policy.ts`, `captcha.ts`, ForgotPassword/ResetPassword forms, `client-error.server.ts` mapper); `src/features/{communities,matches,leagues,notifications,push,players}` (RPC-backed admin writes, quota handling, `push.validators.ts`, rate-limit codes); `client-error-codes.ts` registry.
- UI/components: `src/components/ui/TurnstileWidget.tsx` (+ styles) — sr-only aria-live status, reserved/removed height, visible `unavailable` fallback (F5/F16/F17/F26/F29/F30); form updates in 4 auth forms.
- Routing: `src/routes/` (invite confirmation POST route; `src/routeTree.gen.ts` gitignored, regenerated locally).
- i18n: `src/locales/{en,pt-BR,es}` (captcha, rate-limit, confirmation, and error copy ×3).
- CI/CD: `.github/workflows/` ×3 (SHA-pinned actions, preview `contents: read`, `persist-credentials: false`, prod audit gate), dependabot config; `pnpm-workspace.yaml` overrides.
- Scripts/tooling: `scripts/check-server-function-errors.mjs` (new static guard; hardened across review rounds), `scripts/run-integration.mjs` untouched, guard test suite `test/server-function-errors.guard.test.ts`.
- Tests (~40 new/updated): `test/security.*` (rate limits, privileges + privilege guard, published-by invariant, headers), `test/auth.callback.test.ts` (replay fidelity F12), push endpoint corpus/parity/validators, `auth.password-policy.integration.test.ts` (F4 runtime proof), provisional authorization (8/8), server-entry scheduled test, `trusted-client.ts` helper.
- Docs: `INITIAL_SETUP.md` §10/§11 (headers/CSP enforcement switch, hosted auth checklist), `docs/plan/PAF-182-bundle.md`, `docs/plan/PAF-182-findings.md`.

## Key Decisions

- **Direct DML → SECURITY DEFINER RPCs (U1):** revoke table grants, expose only audited RPCs with `search_path=''`; RLS bypass becomes an explicit, reviewable surface instead of ambient grant access.
- **Client-error registry + central mapper (U5):** errors reach clients only as registry codes; SQLSTATE maps to generic codes; diagnostics carry code+source+SQLSTATE token only. Enforced by a static guard in the static gate + CI (guard inversion across review rounds: raw `cause` tokens flagged in any non-member position, template interpolations scanned in-pass, only audited `// guard-allow:` tags honored; static-analysis limits documented in the guard header).
- **CSP Report-Only first (U2):** ship nonce-based CSP without enforcement risk; `ENFORCE_CSP` flip is a deliberate owner action after report monitoring; HSTS production-only so local HTTP flows keep working.
- **Same-origin POST for invite verification (U8):** GET renders a page, never verifies; POST requires Origin + Fetch Metadata + HMAC-bound `__Host-` cookie; claims-read failure fails closed (no silent session replacement); PKCE left untouched.
- **Avatar write-path decision (a) (U9):** revoke the `avatar_url` column grant and make the service-role CAS finalizer the sole writer, instead of trusting client-supplied URLs; uploaded bytes verified by magic bytes + size, object deleted on failed verification.
- **L-8 disproved, not patched (U10):** live Mailpit evidence shows GoTrue escapes user metadata; pre-escaping would double-escape. Behavior locked by a live regression instead of a code change.
- **Immutable quota subject (F9/F22):** rate-limit quota counts trigger-set `published_by`, excluded from the mutation update-allowlist so it cannot be reassigned; `(published_by, published_at)` index; transfer-bypass regression proves the invariant.
- **Constraint superset proof (F13/F14/F23):** rebuilt push-endpoint SQL constraint keeps the exact old grammar as its first alternative (strict superset, proven by a test pulling both migration regexes), so re-add cannot fail on existing rows; JS validator mirrors the SQL grammar.
- **Default-privilege lockdown with proof (U6):** `ALTER DEFAULT PRIVILEGES` + global PUBLIC revoke so future objects are not accidentally exposed; a privilege guard with empty allowlists is proven against synthetic violations in tests, not just asserted.
- **Fail-closed invite session handling (F10/F11/F21/F27):** one request-scoped client + cookie jar through getClaims/verifyOtp with a single `finally` flush, so rotated refresh-token cookies survive success, error, and throw paths and stale chunks never remain.

## Validation Performed

- **Static gate:** green on every commit's pre-commit hook (lint-staged + `complete-check --only=static`: build, knip, typecheck, lint, format:check, and `check:server-errors` from unit 5 onward); final state covered by `f1d82c1`'s hook.
- **Per-unit unit+integration suites** (at each unit's code state; evidence in `docs/plan/PAF-182-bundle.md`): U1 84 unit + 101 integration; U2 43 unit + build + preview header smoke; U3 108 unit + test-stack start PASS with new TOML; U4 actionlint + YAML parse; U5 277-file unit run (52/52 after `0b48013`) + 11 integration files; U6 81 integration + 156 unit incl. synthetic-violation guard proofs; U7 273 unit + 194 integration; U8 134 unit; U9 161 unit + 30 integration; U10 169 unit/integration + live Mailpit regression; U11 163 tests + `wrangler deploy --dry-run` + audit clean (high advisories 0); U12 85 unit + 9 integration + `db:types` + build; U13 25 unit + 34 integration (8/8 provisional green).
- **Findings regressions:** failing-first (red→green) tests for each fix; 32 findings (8 major) all fixed and verified through the review loop's delta rounds; password-policy runtime proof against real test-stack GoTrue (`weak_password` rejections, `anonymous_provider_disabled`) closed the local-TOML silent-ignore caveat (F4).
- **Review:** code-review + architecture-review + UX/UI-review with 3 delta rounds + 2 micro-deltas; observations O1–O5 dispositioned (hosted hostnames = owner data, WAF doc optional-omitted, cron-only `cause`, PR size, prod-apply pending).
- **Process discipline:** DB-touching runs executed serially against the TEST stack only; production database untouched by design.
- **Final gate:** `pnpm complete-check` (static + unit + integration + E2E with fresh per-phase resets) on `f1d82c1` — **pending at log time** (recorded as the outstanding final delivery gate).

## Risks and Follow-ups

- **Owner actions (hosted settings — required for full effect, cannot be done in-repo):** flip `ENFORCE_CSP` after Report-Only monitoring; configure Turnstile site key/secret and enable captcha in hosted Supabase Auth; confirm hosted `password_requirements` and anonymous sign-in stay disabled; complete the env-protection checklist items (INITIAL_SETUP.md §10/§11).
- **Production migration application:** migrations ship via the PR/release process; production DB untouched on this branch — owner applies them through the release pipeline (observation O5; same posture as PAF-176's release gate).
- **Hosted hostname examples (O1):** allowlist entries in INITIAL_SETUP.md are labeled examples; real values are operator data and must be supplied by the owner.
- **WAF doc (O2):** Cloudflare WAF note omitted — optional per the Linear AC; revisit if the WAF is ever configured.
- **Accepted residuals (documented, not defects):** static error-guard limits recorded in its header (runtime-built computed keys, unbraced-`if` ambiguity, `Object.assign`-with-cause indirection); captcha failure box appears once at terminal failure (widget-slot semantics); cron-only `{ cause }` retained in `match-add-player.server.ts` (O3, never client-serialized); PR size exceeds the soft guideline (O4, coherent scope).
- **Full E2E + integration + unit single-run:** owned by the pending step-9 `pnpm complete-check` on this exact state (single-run policy — no parallel duplicate runs).
- **`src/routeTree.gen.ts` gitignored:** regenerated locally/build; any fresh clone must run the dev build once before typecheck-only workflows.
- **Session notes:** repeated provider rate limits during units 7–11, 13 and the fix rounds — failovers to the sonnet→gpt-6.1-sol pair model, one ~1h43m provider-limit wait; two sessions lacked Code Mode `execute` and used native edits (self-reported, accepted). No work lost.
