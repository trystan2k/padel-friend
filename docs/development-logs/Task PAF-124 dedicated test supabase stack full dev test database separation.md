---
title: PAF-124 Dedicated test Supabase stack — full dev/test database separation
type: development-log
permalink: docs/development-logs/task-PAF-124-dedicated-test-supabase-stack-full-dev-test-database-separation
---

# Development Log: PAF-124

## Metadata

- Task ID: PAF-124
- Date (UTC): 2026-11-12T20:57:41Z
- Project: padel-friend
- Branch: feature/PAF-124-dedicated-test-supabase-stack
- Commits:
  - dee8f4d — feat: provision isolated test Supabase stack
  - 4641c24 — feat: route all test tooling through isolated backend
  - 9da3cd2 — docs: document isolated testing and align CI stack startup
  - 388db52 — fix: address review findings (HEAD)
- Linear issue: PAF-124
- Plan: `docs/plan/Plan PAF-124 Dedicated test Supabase stack — full dev-test database separation.md`
- Review record: `docs/plan/PAF-124-findings.md` (24 findings: 23 fixed, 1 observed-optional)

## Objective

- PAF-124 "Dedicated test Supabase stack — full dev/test database separation": provision a second local Supabase CLI project used ONLY by tests, so dev work and tests can run simultaneously without interference.
- Bare `pnpm db:reset` resets the TEST stack (user decision); explicit `db:reset:dev` wipes dev.

## Implementation Summary

Delivery executed in 4 units, one commit per unit (no issue ids in commits per repo convention). Total: 220 files changed, +7252/−1648.

### Unit 1 — `dee8f4d` feat: provision isolated test Supabase stack

- `test/stack/supabase/`: second Supabase CLI project `padel-friend-test`; ports: API 55421, DB 55422, shadow 55420, Studio 55423, Mailpit 55424, analytics 55427, edge inspector 55483, OAuth stub 55499.
- Migrations + seed via symlinks to the dev project; templates tracked COPY — the CLI rejects symlinked template paths; a byte-equality test guards template drift.
- `scripts/test-stack.mjs` (+ `.d.mts`): up/down/reset with override refusal + sanitized output.
- Package scripts: `test:stack:up`, `test:stack:down`, `test:stack:reset`.
- 30 tests. Smoke: both stacks run simultaneously; dev fingerprint unchanged (256 users / 52 objects / 129 migrations); persistence across down/up; deterministic reset; storage isolation.

### Unit 2 — `4641c24` feat: route all test tooling through isolated backend

- `scripts/test-stack-env.mjs` (`ensureTestStackEnv`): validates exact ports 55421/55422/55424, loopback binding, DB `postgres`; maps `VITE_SUPABASE_URL`, publishable key, `DATABASE_URL`, `INTEGRATION_SUPABASE_DB_URL`, `SERVICE_ROLE_KEY`, `MAILPIT_URL`; fails closed with no dev/`.env` fallback; legacy JWT `SERVICE_ROLE_KEY` required — Storage rejects new `sb_*` SECRET_KEY.
- `with-test-stack.mjs` wrapper; rewired: integration-db-url / run-integration / db-types / release-rehearsal / backup / populated-upgrade; sql-transport + CLI fallback; scheduler/match fixtures; local-supabase-env (strict); controlled-oauth-provider 55399→55499; 12 E2E specs + Mailpit literals; `package.json` (`db:reset`→test stack, new `db:reset:dev`); vitest + playwright configs install the env tuple before collection; `e2e-build-env`; `complete-check`; guard test `test-stack-call-sites`; ~130 test files mechanically updated (import updates).
- Guard test forbids: raw `exec supabase` outside central modules, `../.env` reads, dev ports, dev container name.

### Unit 3 — `9da3cd2` docs: document isolated testing and align CI stack startup

- CI: test-stack-only via composite action (`pnpm test:stack:up`; cache v2, images-only).
- Static lane service-free via checked-in public descriptor `test/stack/public-build.json` + `scripts/ci-test-env.mjs` (build-env / manifest / provision-e2e with descriptor→manifest→live-status equality).
- Per-lane service key only into extracted `dist/server/.dev.vars`, masked.
- populated-upgrade job → test stack.
- Docs: `AGENTS.md` + `INITIAL_SETUP.md` (script/port tables, RAM guidance ~14 GB Docker / 16 GB+ host, observed test ~1.7 GiB / dev ~2.4 GiB, ACCESS EXCLUSIVE lock warning reads+writes).
- `test/ci-workflow.test.ts` (15 tests).

### Unit 4 — `388db52` fix: address review findings

- Review loop F1–F24 in `docs/plan/PAF-124-findings.md` + gate remediations:
  - Real product fixtures in isolation proof (community, 60 due events, photos, proposals) with locked-transaction scoped trigger cleanup: EXCLUSIVE lock → named-trigger disable → proof-ID deletes → enable → commit; rollback restores both.
  - Incremental ownership tracking.
  - 404-convention unification: `readDevVarsValue` unwraps `'…'`/`"…"` — the Cloudflare plugin writes single-quoted `.dev.vars`; this is why prebuilt reuse never engaged.
  - Live browser/SSR probe (port 4183): Chromium login → all requests to 55421; SSR invite-token callback.
  - pg crash resilience: error handlers, close-before-command, per-resource cleanup.
  - `test-stack.mjs` readiness retries + volume-preserving recovery.
  - `startLocalSql` workdir pinning (delivery-caused escape: root `--local` hit dev after the split).

## Files Changed

Total: 220 files, +7252/−1648 across 4 commits. Grouped by functionality:

- Test stack provisioning (unit 1): `test/stack/supabase/` (config, migrations+seed symlinks, templates copy), `scripts/test-stack.mjs`, `scripts/test-stack.mjs.d.mts`.
- Test tooling rewiring (unit 2): `scripts/test-stack-env.mjs`, `scripts/with-test-stack.mjs`, `scripts/integration-db-url`, `scripts/run-integration.mjs`, `scripts/db-types`, `scripts/release-rehearsal`, `scripts/backup`, `scripts/populated-upgrade`, sql-transport + CLI fallback, scheduler/match fixtures, `local-supabase-env` (strict), `controlled-oauth-provider` (55399→55499), 12 E2E specs + Mailpit literals, `package.json`, vitest + playwright configs, `e2e-build-env`, `complete-check`, guard test `test-stack-call-sites`, ~130 test files (mechanical import updates).
- CI + docs (unit 3): composite action (test-stack-only, cache v2 images-only), `test/stack/public-build.json`, `scripts/ci-test-env.mjs`, workflow per-lane `dist/server/.dev.vars`, `AGENTS.md`, `INITIAL_SETUP.md`, `test/ci-workflow.test.ts`.
- Review fixes (unit 4): isolation-proof fixtures + locked-transaction trigger cleanup, incremental ownership tracking, `readDevVarsValue` quote unwrapping, live browser/SSR probe (port 4183), pg crash resilience, `test-stack.mjs` readiness retries + volume-preserving recovery, `startLocalSql` workdir pinning.
- Workflow artifacts: `docs/plan/Plan PAF-124 Dedicated test Supabase stack — full dev-test database separation.md`, `docs/plan/PAF-124-findings.md`, `docs/plan/PAF-124-bundle.md`.

## Key Decisions

- Second Supabase CLI project via absolute `--workdir` (not DB-clone): 45/50 integration files need Auth/PostgREST, not just a database copy.
- Templates copied, not symlinked: CLI constraint rejects symlinked template paths; byte-equality test enforces sync instead.
- Bare `pnpm db:reset` targets the TEST stack; dev wipe is explicit `db:reset:dev` (user decision).
- Single source of truth for test coordinates in `scripts/test-stack-env.mjs` (exact ports, keys, URLs).
- CI starts the test stack only (dev stack never runs in CI); static lane service-free via checked-in public descriptor.
- No parallel worktrees / concurrent resets allowed: fixed identity + ports, documented in `AGENTS.md`.

## Validation Performed

- Final gate run 4, HEAD `388db52`, wrapped `node scripts/verify-test-stack-isolation.mjs pnpm complete-check`: 33m27s, exit 0.
- Isolation proof 10/10: distinct clusters; dev fixtures incl. 60 due events survived the full gate; concurrent dev writes 400/400; proof absent from test before+after; test users absent from dev; mail isolated (55424 vs 55324); browser hosts = 55421 only; SSR test token accepted; cleanup restored dev byte-identical (256 users / 52 objects / 3); triggers 17/17 enabled.
- complete-check 11/11: static ✓; unit 4044 ✓; integration 1240 ✓ / 0 failed; e2e 545/545 ✓; two clean test-stack resets; prebuilt reuse ENGAGED; `db:types:check` ✓.
- Earlier gate runs 1–3 documented in `docs/plan/PAF-124-bundle.md` (bucketExists 404-shape tolerance; 57P01 crash resilience; proof-scoped dirty-row flush; quote-stripping; startLocalSql workdir).
- Review loop: F1–F24 recorded in `docs/plan/PAF-124-findings.md` (23 fixed, 1 observed-optional).
- Unit-level: 30 tests (unit 1), guard test `test-stack-call-sites` (unit 2), `test/ci-workflow.test.ts` 15 tests (unit 3).

## Risks and Follow-ups

- F7 observed-optional: call-site guard beyond manual inventory — the `startLocalSql` escape validated the concern; consider extending automated coverage.
- CI-only verifications pending a real CI run: cold/warm image cache behavior, Linux `host.docker.internal` OAuth stub alias, populated-upgrade on real CI.
- Template copy needs manual sync when the root invite template changes (byte-equality test enforces — expect a red test as the reminder).
- Test stack + proof emails remain in test Mailpit until the next reset (accepted residue).
- Docker budget ~14 GB for two stacks; hosts below 16 GB RAM not supported (documented in `INITIAL_SETUP.md`).
