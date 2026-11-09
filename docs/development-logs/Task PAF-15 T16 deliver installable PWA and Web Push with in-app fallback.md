---
title: PAF-15 T16 Deliver installable PWA and Web Push with in-app fallback
type: development-log
permalink: docs/development-logs/task-PAF-15-t16-deliver-installable-pwa-and-web-push-with-in-app-fallback
---

# Development Log: PAF-15

## Metadata

- Task ID: PAF-15 (T16 — Deliver installable PWA and Web Push with in-app fallback; epic delivered via 5 sub-issues PAF-160/PAF-161/PAF-162/PAF-163/PAF-164)
- Date (UTC): 2026-11-08 → 2026-11-09
- Project: padel-friend
- Branch: `feature/PAF-15-installable-pwa-web-push-in-app-fallback` (base `origin/main` @ `5f5d79b`)
- Scope: installable PWA shell with strict service-worker cache policy and user-controlled updates; permission-aware Web Push device enrollment; durable push delivery pipeline on the existing Workers cron; authorized notification deep links; honest offline/lost-ack mutation semantics; channel-matrix proof ledger and browser evidence.
- Commits (8 on branch, oldest first — 5 delivery commits, one per sub-issue, plus 3 review-fix commits):
  1. `66ff330` (feat: add installable PWA shell with strict service worker cache policy — U1/PAF-160)
  2. `bbe90ac` (feat: add web push device enrollment and permission-aware preferences — U2/PAF-161)
  3. `be77f36` (feat: add durable web push delivery pipeline with producer completion — U3/PAF-162)
  4. `09c31bb` (feat: add authorized notification deep links and honest offline mutations — U4/PAF-163)
  5. `0069841` (test: add channel matrix proof ledger and push browser evidence — U5/PAF-164)
  6. `8cd9820` (fix: address review findings in push delivery and pwa surfaces — review R1, F1–F8)
  7. `fbbc898` (fix: tighten notification proof evidence and pwa focus announcement — review R2)
  8. `923491d` (test: require connected proof evidence and restore update error alert — review R3)
- Artifacts: review-loop findings ledger `docs/plan/PAF-15-findings.md` (F1–F8, 4 delta rounds to zero open), manual-device checklist in `INITIAL_SETUP.md` (rows pending operator), this development log.
- Related Linear: PAF-15 epic + sub-issues PAF-160/PAF-161/PAF-162/PAF-163/PAF-164 (project PadelFriend).
- Operational note: model availability forced routing changes mid-epic — implementation U3+ moved sonnet → sol (user override; sol went usage-limited mid-U5) → sonnet after the 22:00Z weekly reset (user-approved wait); reviewers ran on terra after the overnight reset (user "try again"); two aborted/interrupted sessions recovered by resuming from on-disk handoff briefs (work-state continuity preserved, no re-derivation).

## Objective

- Make padel-friend installable as a PWA with a strict, auditable service-worker cache policy and user-controlled updates; let players enroll devices for Web Push behind permission-aware preferences; deliver notifications durably through a transactional outbox on the existing Workers cron; open authorized, ownership-checked deep links from push clicks; keep every offline or unacknowledged mutation honest (no false success, no silent queues); and prove the whole channel matrix with a generated proof ledger plus browser evidence.

## Implementation Summary

- **U1/PAF-160 — Installable PWA shell (`66ff330`)**: authored service worker via `injectManifest` (`scripts/pwa-build.mjs`, rewritten `generate-sw.mjs`, hand-written `src/features/pwa/service-worker.ts` + `sw-policy.ts`); public-only precache allowlist — the build fails if a non-allowlisted asset tries to precache; zero runtime caching; navigation requests, SSR responses, server functions, and Supabase auth are never cached; localized static offline document (3 locales, deterministic locale selection, contains no account data); token-derived manifest `id`/`scope`/`start_url` plus 192/512 any/maskable PNGs and an apple-touch icon (`scripts/generate-pwa-icons.mjs`, Playwright rasterizer); update-controller/guard/store delivering user-controlled updates — `SKIP_WAITING` fires only on explicit confirm, dirty forms defer the update, exactly one reload; install panel (`PwaInstallPanel`/`install-state`) embedded in notification preferences; `pwa.*` locales ×3; knip and shard registration. 40 files, +2300/−33.
- **U2/PAF-161 — Push device enrollment and permission-aware preferences (`bbe90ac`)**: migration `20261108090000_push_subscriptions.sql` with RLS and owner RPCs (register/reconcile/retire) as SECURITY DEFINER with empty `search_path`, provisional guards, endpoint-theft advisory lock, 25-device cap per user, re-enrollment resetting `created_at`; `push.functions.ts` + `push-config.server.ts` exposing public-key-only config to the client; browser controller and `PushDevicePanel` covering denied/unsupported/iOS-install-required/expired/key-change/failure states; logout cleanup wired in PlayerProfile; preferences page integration — the in-app channel is ALWAYS-ON and immutable, saved intent ≠ enabled state; `push.*` locales ×3; `e2e/push-preferences.spec.ts`. 28 files, +2642/−13.
- **U3/PAF-162 — Durable delivery pipeline + producer completion (`be77f36`)**: gap-producer migration `20261108100000` closing missing notification triggers (community role change, amendment lifecycle, visible rating/reliability publication, level-review submission + reviewer notice, League start/close + standings publication — all with durable identities); outbox migration `20261108110000` adding `notification_push_jobs`/`notification_push_deliveries` with an AFTER INSERT trigger and fenced service-only claim/materialize/settle/retire RPCs — SKIP LOCKED, leases, claim tokens, eligibility gated on `created_at ≤ notification.created_at`, preference rechecked per send and per retry; `web-push` transport verified under the Workers runtime with an encrypted-send checkpoint (independent RFC8291 decrypt + RFC8292 VAPID verification; manual redirect); `push-delivery.ts` with payload v1 `{notificationId, category, title, body}`, `tag = notification:<uuid>`, subscription-locale payload; `push-dispatch.server.ts` with two independent cron sweeps and sanitized counters, `WEB_PUSH_ENABLED=false` kill switch; `push-keyring.server.ts` with key-id rotation + revocation; secret-guard private-key canary; matrix fixture (60 transitions) plus channel-matrix/outbox/delivery/dispatch/worker-adapter integration suites; INITIAL_SETUP.md operator docs. 37 files, +3122/−42.
- **U4/PAF-163 — Authorized deep links and honest offline mutations (`09c31bb`)**: SW push/click handlers (`sw-push.ts`) with payload validation and safe display; click derives the same-origin `/notifications/<uuid>` route and never trusts a payload-supplied href; target-resolver migration `20261108200240` (v4, ownership-first) resolving rating/review/League targets, with revoked/deleted/snapshot cases degrading to a safe "unavailable"; offline/lost-ack guards across join/registration/approval/invitation/reconfirmation/result/review/amendment/level-review entrypoints — drafts preserved, unsent ≠ failed, no auto-replay; `pwa.offline.unconfirmed` + per-kind copy ×3. 40 files, +1262/−131.
- **U5/PAF-164 — Proof ledger and browser evidence (`0069841`)**: generated proof ledger binding all 60 matrix events to named tests and recipient sets; `e2e/push-deep-links.spec.ts` (4 specs) + `e2e/offline-mutations.spec.ts` (3 specs); Pencil structural probes + 4 element-snapshot baselines at a documented 3% budget (frame tzBrY cards Q1sH0/Z4g9l); measured shard weights; manual-device checklist added to INITIAL_SETUP.md (rows pending operator). 19 files, +1105/−18.
- **Review loop (R1 `8cd9820`, R2 `fbbc898`, R3 `923491d`)**: full review (code + architecture + UX/UI) produced 8 required findings in `docs/plan/PAF-15-findings.md`; 4 delta rounds to zero open. R1: F1 auth-callback fails honestly instead of masking offline as success; F2 app-level install-prompt capture; F4 per-delivery retry budget (migration `20261108120000` — claim counter bounds consecutive lease loss only); F5 per-user enrollment serialization (migration `20261108121000`); F6 focus retained/restored through the native prompt; F7 deferred update re-offer; F8 token-based 44px targets; F3 ledger checker v1. R2: cutoff_playing proof rebound to a positive transition + silence; per-event `{kind, command, silence}` evidence; conditional focus restore; persistent initially-empty live region. R3: checker fallback removed — structured-only evidence with 20 bindings upgraded, wrong-attachment regression added; `role=alert` restored on the update error phase (explicitly required by reviewer); idle e2e asserts live-region presence. Architecture verdict moved rework-required → resolved on F4 (per-delivery budget). F3 took 3 rounds (token-match → event-specific → structured-only); F6 took 2; F7 took 3.

## Files Changed

- Grouped by area below; per-commit file-level diffs live in git history on the delivery branch.
- **Build/tooling (`scripts/`, config)**: `pwa-build.mjs`, rewritten `generate-sw.mjs`, `generate-pwa-icons.mjs` (Playwright rasterizer), knip + shard registrations, secret-guard private-key canary.
- **PWA feature (`src/features/pwa/`)**: authored `service-worker.ts` + `sw-policy.ts`, update-controller/guard/store, install panel (`PwaInstallPanel`/`install-state`), `sw-push.ts` (push/click handlers).
- **Push backend (`src/features/`)**: `push.functions.ts`, `push-config.server.ts` (public-key-only), `push-delivery.ts` (payload v1, tag collapse, subscription locale), `push-dispatch.server.ts` (dual cron sweeps, kill switch), `push-keyring.server.ts` (key-id rotation/revocation).
- **Migrations (`supabase/migrations/`, 6 new)**: `20261108090000_push_subscriptions.sql` (RLS + owner RPCs, advisory lock, 25-device cap); `20261108100000` gap producer; `20261108110000` push outbox (jobs/deliveries, trigger, fenced claim/materialize/settle/retire); `20261108120000` per-delivery retry budget (F4); `20261108121000` per-user enrollment serialization (F5); `20261108200240` target resolver v4.
- **UI/features touched**: notification preferences page (install panel + device panel + always-on in-app channel), `PushDevicePanel` state machine, PlayerProfile logout cleanup, offline/lost-ack guards across join/registration/approval/invitation/reconfirmation/result/review/amendment/level-review entrypoints, auth-callback honesty (F1), app-level install-prompt capture (F2), deferred-update re-offer + error alert (F7/R3), token-based 44px targets (F8), focus restore semantics (F6).
- **Copy (`src/locales/{en,pt-BR,es}`)**: `pwa.*` (install, update, offline doc), `push.*` (device states), `pwa.offline.unconfirmed` + notification-kind copy; localized static offline documents ×3.
- **Tests**: matrix fixture (60 transitions); channel-matrix, outbox, delivery, dispatch, worker-adapter integration suites; `e2e/push-preferences.spec.ts` (19), `e2e/push-deep-links.spec.ts` (4), `e2e/offline-mutations.spec.ts` (3); existing notifications specs (36) green; proof-ledger checker + wrong-attachment regression; Pencil structural probes + 4 element-snapshot baselines @3%.
- **Docs**: `INITIAL_SETUP.md` operator docs (VAPID provisioning, cron, kill switch) + manual-device checklist; findings ledger `docs/plan/PAF-15-findings.md`; this development log.

## Key Decisions

- **One notification system, not two**: reuse the existing transactional notification store; push is a delivery channel over it — no parallel notification pipeline.
- **Durable outbox on the existing cron**: `notification_push_jobs`/`deliveries` with fenced claim/lease/settle RPCs run by the existing 5-minute Workers cron — no Edge Functions, no second runtime.
- **Delivery semantics stated honestly**: in-app notifications are authoritative; Web Push is best-effort at-least-once. Duplicate pushes are possible; `tag = notification:<uuid>` collapse mitigates display duplicates.
- **Strict public-only SW cache allowlist**: the build fails unless every precached asset is on the public allowlist; zero runtime caching; navigation/SSR/server-function/Supabase-auth requests never cached. New public assets require an explicit allowlist change — intentional friction.
- **User-controlled updates**: the new SW waits (`SKIP_WAITING` only on confirm); dirty forms defer; one reload; deferred updates are re-offered (F7) and the error phase is a `role=alert` (R3).
- **Ownership-first deep links**: click handlers derive same-origin `/notifications/<uuid>` and ignore payload hrefs; target resolver v4 re-checks ownership and degrades revoked/deleted/snapshot content to a safe unavailable state.
- **Offline honesty**: no false success, no client-side replay queues; drafts preserved; unsent ≠ failed; explicit `pwa.offline.unconfirmed` copy.
- **Hardened enrollment RPCs**: SECURITY DEFINER with empty `search_path`, endpoint-theft advisory lock, 25-device cap, re-enrollment resets `created_at`; per-user enrollment serialization added in review (F5).
- **Verified encryption end-to-end**: encrypted-send checkpoint performs an independent RFC8291 decrypt + RFC8292 VAPID verification rather than trusting the library.
- **Per-delivery retry budget** (F4, architecture-resolution): the claim counter bounds consecutive lease loss only — retries are budgeted per delivery, not per job.
- **Proof evidence is structured-only** (F3, after 3 rounds): ledger bindings must carry per-event `{kind, command, silence}` evidence; token-match and named-test fallbacks were removed, with a wrong-attachment regression locking the checker.

## Validation Performed

- **Static**: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm knip` — PASS. `pnpm db:types:check` — PASS.
- **Full `pnpm test` (serial, fresh reset)**: unit 226 files / 3,283 tests; integration 117 files / 1,115 tests — PASS.
- **Build**: `pnpm build` + secret-guard private-key canary — PASS (SW emit + precache allowlist enforced at build time).
- **Browser lane**: 68/68 — pwa 6, push-preferences 19, push-deep-links 4, offline-mutations 3, notifications 36.
- **Encryption checkpoint**: RFC8291 decrypt + RFC8292 VAPID verification over a real encrypted send under the Workers runtime.
- **Commits**: every pre-commit static gate passed on all 8 commits.
- **Review loop**: full code + architecture + UX/UI review; findings ledger F1–F8; 4 delta rounds to zero open; architecture verdict rework-required → resolved.
- **Pending**: final `pnpm complete-check` NOT yet run (post-review delivery gate); physical-device matrix rows in INITIAL_SETUP.md remain empty (operator evidence); live VAPID secret provisioning pending.

## Risks and Follow-ups

- **Physical-device evidence outstanding**: the INITIAL_SETUP.md manual-device checklist (iOS install/permission paths, vendor push behaviors) has pending rows — the automated lane cannot prove real-device quirks; operator must fill it before treating device coverage as complete.
- **Final gate pending**: `pnpm complete-check` (static + unit + integration + E2E, one build reused for e2e) has not run after the review-fix commits; delivery is incomplete until it passes.
- **VAPID provisioning pending**: live `VAPID` private key + subject must be provisioned as secrets and the key-id registered via the keyring before push is enabled; until then `WEB_PUSH_ENABLED=false` keeps the pipeline dormant by design.
- **QA/user approvals pending**: epic closure awaits approvals; board state should stay open until complete-check, device evidence, and provisioning land.
- **Best-effort push duplicates**: at-least-once delivery means occasional duplicate pushes; tag collapse mitigates but does not eliminate — acceptable per stated semantics, monitor sanitized dispatch counters after enablement.
- **Allowlist friction is intentional**: adding new public assets or routes requires a deliberate SW allowlist update (build fails otherwise); document this in contributor onboarding follow-ups.
- **Model-routing churn cost the schedule**: sol usage-limits mid-U5 and the sonnet weekly-reset wait added idle time; two interrupted sessions were recovered only via on-disk handoff briefs — keep handoff briefs current as a standing practice for multi-day epics.
