# Release integrity — local evidence and operator runbook

> **Current operations:** this document is historical local-rehearsal evidence. The live production flow (single approval, pending-only migrations, freshness guard, Worker deploy, failure handling and rotation) is documented in the [production release runbook](../production-release-runbook.md). The migration rollback notes below describe local rehearsal only; production never rolls the database back automatically.

## Scope and status

U4 local implementation/rehearsals verified. **Not production release approval.** Binding scope leaves production backup configuration and real external alert receipt as operator findings. §57 permits honest unmet/unmeasured performance findings; numbers below are not a benchmark pass.

Operator: implementation agent. Date: 2026-11-09. Base: `18c778c`, uncommitted U4 work. Environment: local Docker Unix socket, `supabase_db_padel-friend`, Supabase CLI 2.121.0, repository local DB port **55322**. Initial handoff incorrectly said no U4 files existed; existing changes were preserved. No commit, push, Linear change, full suite or E2E lane run.

**Data-loss warning:** caller explicitly authorized standard `pnpm db:reset` for stale-schema diagnosis. It was run during migration development/reconciliation and wiped shared local dev data. One initial reset failed on SQL dollar quoting before corrected rerun. Later resets verified final migration/body changes through the normal migration path. Rehearsals themselves never reset or mutate source DB; they create/drop separate disposable databases.

## Backup and restore

```sh
pnpm release:restore --confirm-disposable restore_rehearsal_example --require-representative
RELEASE_REHEARSAL_REPORT=/tmp/paf-168-restore-sealed.json pnpm exec vitest run --config vitest.integration.config.ts test/release-integrity.integration.test.ts
```

Use synthetic local data only. Verify source ownership before reading shared local DB. Script verifies and pins local Docker Unix-socket endpoint, allows only project container/local source, requires explicit disposable-name confirmation, rejects production-like names and refuses existing destinations without deleting them. Source is read-only; dump stays in process memory. No production data, dumps, credentials or endpoint/key material belong in git.

Final pair: **2026-11-09 19:54:23 UTC**, two quartets, 2 group facts, 8 immutable rating events, 1 League snapshot, 78 notifications with read/unread state and Push jobs, 1 repair job. All **86 tables**, content digests/counts, schema/functions/grants/RLS policies and three authorized identities' reader counts matched. Source unchanged. Each restored DB had no cron schema; 78 pending/leased Push jobs retired **after** comparison, before any dispatcher can attach. Both destinations deleted.

| Run |   ms |   Bytes | Dump SHA-256                                                       | Result |
| --- | ---: | ------: | ------------------------------------------------------------------ | ------ |
| 1   | 1313 | 2224025 | `ba8b79aca393ec5a0f7034f43d539cc3439f5919464bb9b1adb36b3e07bf4b53` | pass   |
| 2   | 1272 | 2224025 | `3f3eb3e52484355f95c020e0059fa64308433071642e882e73064b01111dd426` | pass   |

Storage objects, managed Auth/provider secrets, Workers secrets, external Push subscriptions and platform/scheduler configuration require separate encrypted, access-controlled backups and recovery procedures; DB dump is not sufficient. Retain only redacted reports/hashes under incident-owner retention policy; destroy sensitive recovery artifacts when expired.

## Migration diagnosis, verification and recovery

```sh
# Only when authorized: wipes local development data. Never part of restore rehearsal.
pnpm db:reset
pnpm release:migration --confirm-disposable migration_rehearsal_example --check-types
pnpm db:types:check
```

**Root cause of original drift:** shared dev DB contained an earlier definition of the uncommitted `operational_failure_signals()` migration, including seven-day Push filter and 200-signal cap. Repository migration had removed those unsafe truncation semantics. No missing released migration, no covert source-function rewrite. Standard reset rebuilt source from repository migration history.

Final migration rehearsal `migration_rehearsal_u4sealed`: **pass**, **11,789ms**, 123 migrations: 86 to populated predecessor `20261101194000`, committed League upgrade fixture, then 37 remaining migrations. Full-row count/checksum equality across original columns proved source/audit preservation, permitting additive columns. Reader/result/projection fixture assertions passed. Functions, RPC/table grants, policies and schema fingerprints matched live source; **zero drift**. Deliberate failed migration rolled back partial object and left history unchanged; corrected forward migration succeeded. Disposable DB deleted.

`--check-types` generates public application-schema types against live disposable DB and compares with live migrated source. Repository DB port comes from `[db]` configuration, never assumed 54322; `sslmode=disable` applies only to this verified local test URL. Disposable type parity passed. Standard `pnpm db:types:check` passed for repository public/storage/graphql types against live local migrated schema.

Code rollback deploys a compatible earlier application build; it **does not** reverse schema/data. Prefer additive forward migration preserving history/permissions for schema faults. Backup restoration is a separate destructive incident-owner decision: authorize destination/point-in-time, isolate all outbound dispatch, restore DB plus storage/managed configuration, verify identities/history/snapshots/authorization/projections, reconcile external queues, then explicitly reenable dispatch. Never run rollback/reset experiments on production.

## Structured diagnostics — committed outcomes

Workers mint fresh `X-Request-Id`; ignore client-supplied values. AsyncLocalStorage validates/snapshots request/job contexts and isolates concurrent scopes. Framework-thrown errors return empty private/no-store 500 with safe reference header. Responses preserve streaming bodies and every Set-Cookie. Independent player-add, Push, operational-alert and job-diagnostic sweeps use all-settled isolation.

Structured fields are allowlisted, short tokens/IDs/counts only. No cookies, JWTs, email, Push endpoint/key, raw SQL/provider payload or multiline injection. Pending approval is never confirmation; stale replay is neither false failure nor completion.

| §59 flow             | Event / actual-outcome evidence                                                                                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication       | `auth.failure`, rejected claims                                                                                                                                                                                        |
| Match creation       | `match.create`, committed success / failure / conflict                                                                                                                                                                 |
| Join                 | `match.join`, success / rejection / race from command receipt                                                                                                                                                          |
| Result               | `result.submit`, `result.review`, `result.reject` only disputed receipt, `result.confirm` only committed confirmation/deadline receipt                                                                                 |
| Rating failure       | Exact `project_confirmed_rating_group` exception boundary emits safe DB `rating.failure` and rethrows unchanged; failed replay attempt at `replay` stage emits durable `rating.failure` with `rating_projection` stage |
| Replay               | Committed attempt records produce `replay.start`, `replay.complete`, `replay.fail`; publication failure is replay failure, not rating failure                                                                          |
| DB-only auto-confirm | Committed processing failure record emits `result.confirm` failure; committed `AUTO_48H` confirmation emits success                                                                                                    |
| League close / Push  | `league.close` / `push.failure` from actual outcome                                                                                                                                                                    |

Private `operational_job_events` is an operational evidence outbox, **not** another notification store. Triggers derive safe records from existing repair attempts, result-processing state and trusted confirmations inside their transactions: aborted work cannot leave a success event. Bounded service-only drain logs committed records under durable `jobId = reference:attempt`, then acknowledges outside sporting transactions. Failed logging/ack leaves retryable backlog; crash can repeat same job/attempt, never invent success. Logged evidence expires after seven days; original repair/processing ledgers remain durable authority. No browser role can read/ack these records. SQL rating failure logs intentionally survive transaction abort; automatic processing also persists proposal/version/attempt failure state.

Local integration proved failed auto-confirm has **no success event**, retry produces committed success, failed DB-only replay produces start/fail plus rating-stage failure, retry produces completion, collector acknowledges committed records, and ordinary authenticated role cannot read evidence RPC.

## Operational alerts and controlled-fault receipt

Configure only an operator-approved **HTTPS** receiver as server secret `OPS_ALERT_WEBHOOK_URL`; plain HTTP permitted only for loopback rehearsal. URL/credentials never in repository. Redirects rejected. Payload contains opaque source/reference/state only, plus stable delivery identity; no sporting/private payload.

Failure sources: terminal/nonretryable repair or exhausted attempt; sustained auto-confirm failure (five consecutive attempts per proposal/version); exhausted Push job or permanently failed/exhausted delivery; safe persisted Push configuration fault; overdue repair scheduler. Transient retries below budget do not page. Disabled Push does not consume jobs/attempts; approved deployment configuration remains operator responsibility. Alert transport remains best-effort outside sporting transactions.

PostgreSQL atomic token/30s lease fences overlapping sweeps. Sender timeout is 5s. Delivery stamp requires current, unexpired token; failed send releases its own claim, crash expires lease. Stable per-incident/state `Idempotency-Key` covers receiver receipt before DB acknowledgement: approved receiver **must implement deduplication** for crash-safe delivery. Acknowledging an already-resolved in-flight open permits its recovery message rather than silently losing resolution. Resolution/reopening state remains durable.

Final local HTTP test passed, using production sender and actual durable failure readers:

1. Repair publication fault: transient suppression, terminal alert, HTTP 503 without stamp, retry HTTP 204, no duplicate, successful repair resolution.
2. Push TTL exhaustion through real claimant: two sweeps overlap while first delivery is held; competing sweep sends **zero**, receiver gets exactly one open and one recovery after explicit retirement.
3. Malformed enabled Push configuration: scheduled path persists safe fault, receiver gets one open; healthy dispatcher clears fault and sends one recovery.
4. Permanent HTTP **400** through real Push dispatcher: completed parent with failed delivery still alerts; explicit operator retirement (`skipped`, not fabricated successful send) resolves it.

This is **local loopback receipt**, not real production receipt. Production destination approval, provider-side dead-man/heartbeat rules, fault/recovery receipt and operational ownership remain external findings. A dead Worker/DB or missing credentials cannot reliably self-page through the same broken channel.

## §57 bounded performance audit

```sh
pnpm release:perf --report /tmp/paf-168-performance-sealed.json
```

Single-machine local Docker; 20 authenticated RPC clients, read-heavy tight-loop concurrent load plus 55 submits/55 reviews and five two-observer convergence probes. Same measured dataset scale before/after: **71 events, 71 group facts, 16 player profiles, 32 rating events, 2594 notifications**. No network distance/CPU throttling. Final report timestamp **2026-11-09 19:55:41 UTC**, 240 baseline + 7752 loaded = **7992 reads**, **110 critical writes**, **zero measured errors**. Representative fixture creation is outside timed writes.

Bounded changes, no architectural redesign/authenticated caching:

- Removed Home serialization barrier: community readers begin as soon as membership resolves, without waiting for unrelated unread/rating activity. Regression test holds rating activity unresolved and proves scoped reads start.
- Audited `list_match_events`: expensive roster/count/caller projections occurred before final personal-page limit. Materialized authorized/ordered/cursor-filtered candidates now cap personal `my`/`past` pages before lateral projection, preserving reader semantics. Available-capacity filtering still requires accurate roster counts.
- Patch operates on **final installed** function, retaining all later lifecycle/League/result DTO additions and grants. Integration caught unsafe older-definition replacement during development; corrected before final evidence. Home RLS/timezone/tie/cancellation/failure tests passed. Fixed inherited fixture SQL interpolation/cutoff/cancelled-creator errors and added scoped cleanup/randomized tie IDs so repeat runs cannot collide.
- Organizer request fan-out remains bounded to five events; shared upcoming/rank reads reused. No new batched domain API, private response cache, synchronous Home history rebuild or relaxed correctness target.

| Lane                  | Before p95 ms | Final p50 ms | Final p95 ms | Final p99 ms | Result                     |
| --------------------- | ------------: | -----------: | -----------: | -----------: | -------------------------- |
| Baseline reads (240)  |        690.26 |        59.58 |       670.14 |       815.61 | <500ms unmet               |
| Loaded reads (7752)   |        594.75 |        84.91 |   **570.03** |       819.89 | <500ms unmet               |
| Home loaded (2584)    |        766.82 |       321.36 |   **725.78** |       942.53 | <500ms unmet               |
| First-use reads (60)  |        783.98 |       103.16 |       794.84 |       954.17 | first-use, not cold server |
| Warm reads (7932)     |        591.26 |        84.19 |       569.43 |       813.58 | <500ms unmet               |
| Critical writes (110) |       1527.76 |       352.14 |  **1425.07** |      1867.83 | <1000ms unmet              |
| Submit (55)           |        325.83 |        64.61 |       352.14 |       615.64 | met locally                |
| Review (55)           |       1857.42 |      1094.21 |      1779.34 |      2110.64 | <1000ms unmet              |

Measured RPC hotspots within Home: `list_match_events:my` p95 **484.96ms**, available **475.01ms**, past **338.78ms**; rank history **282.80ms**, League list **267.46ms**, unread **267.36ms**, rating history **259.02ms**, organizer requests **250.28ms**, standings **237.65ms**. Measurements include PostgREST/client round trip and contention; they are not isolated server CPU profiles. Home still combines multiple authorized RPCs plus two sequential membership-table round trips; source-derived fan-out and measured match-list latency explain why end-to-end Home can exceed 500ms even when individual RPCs fit.

Write audit: review performs transactional confirmation, rating/League projection and existing synchronous `statistics_publish()`/notification work under canonical locks; submit does not. Actual review distribution is much slower than submit under 20-reader load. That identifies remaining transactional publication/lock contention as an investigation target, **not** a claim that individual SQL CPU/lock wait shares were isolated. No weakening of global projection, immutable-history or confirmation atomicity to obtain benchmark green. Further write optimization would need dedicated projection profiling, beyond bounded reader fixes.

Amplification unchanged: **6.75 RPCs/Home read** in baseline. At 20 clients/3s cadence: extrapolated **6.67 Home reads/s, 45 RPC/s**, excluding non-RPC queries. These are extrapolations, not measured browser traffic. Tight-loop benchmark is intentionally more aggressive than mounted polling. First-use means first request per client/reader, not cold process/cache.

Final two independently authorized RPC observers polled **specific committed proposal facts plus Home** during concurrent writes/reads. Ten observations: **618/1721/1289/2263/2134/2922/2264/3745/1226/3781ms**, max **3781ms** (<5s local engineering budget). This proves RPC convergence under load, not browser rendering or replay convergence.

Source fingerprint: `source-sha256:987419c4c65e8c9521ec0902c948ec54ee551e22467d6bf27c04b1e37b692cda`. No built/deployed artifact measured (`buildArtifact: null`). Before report `/tmp/paf-168-performance-report.json`; final `/tmp/paf-168-performance-sealed.json`. Detailed per-RPC percentiles/errors retained in final report.

### Browser LCP / interaction finding and exact operator procedure

**Not measured here:** authenticated browser LCP <2.5s, local interaction <200ms, true cold/cached public shell, mobile network/CPU, browser/replay convergence and deployed artifact hash. Existing measurement is a DB integration harness, not a self-building/authenticated-browser harness. Adding and validating another browser server/session lifecycle was not a cheap extension; retain explicit finding rather than pretend RPC latency is LCP/interaction or run prohibited E2E lane.

Operator can run independently (no E2E suite; synthetic onboarded local account only):

```sh
# Terminal 1: fresh production bundle, separate preview port; strict port rejects stale server.
pnpm build
pnpm preview --host 127.0.0.1 --port 4174 --strictPort
# Terminal 2: headed mobile browser; sign in to synthetic onboarded account.
pnpm exec playwright open --browser chromium --device 'Pixel 7' http://127.0.0.1:4174/login
```

Open browser DevTools Performance panel, enable Web Vitals, 4x CPU slowdown and explicit Fast-3G network profile; record exact profile throughput/RTT. Record at least five authenticated Home navigations (cold browser cache and warm separately), and five local read-only interactions (e.g. opening community selector, not network mutations). Use LCP and interaction/Event Timing tracks; export sanitized trace and p50/p95/max, errors, timestamps and `shasum -a 256 dist/client/assets/*` bundle hashes. Repeat without throttling and against approved deployed build. Never publish credentials/session cookies/trace private payloads. Chromium/Pencil screenshot budgets are unrelated to these timing targets. Coordinator owns browser/replay convergence validation in its assigned browser lane.

## Final scoped gate ledger

- `pnpm typecheck`, `pnpm lint`: pass.
- Explicit affected unit lane: **9 files / 94 tests passed**, including Home overlap, committed job diagnostics, alert lease loss, Push dispatch, Worker scope/isolation, scripts, result outcomes and repairs. Previous initial unit lane 154 tests also passed; no full suite.
- Final migration/type rehearsal: **pass**, zero schema drift, disposable type parity, full live generated-types check.
- Restore + controlled HTTP alerts + DB-only job diagnostics integration: **3 tests passed**, 7.55s; final fresh restore pair above.
- Home SQL integration: **2 tests passed**, 1.69s, including cleanup.
- Final performance lane: **1 test passed**, 78.73s. Test validates sample production; unmet targets remain findings above.
- All gate/rehearsal shell commands had explicit **1,800,000ms** ceiling. No full suite, E2E or final complete-check run here; coordinator owns final QA.

## External findings / release conditions

1. Production backup entitlement, schedule/retention/encryption, access, recovery owner and actual secured restoration procedure require operator evidence. Local synthetic restores do not prove production backup availability.
2. Approved alert receiver/provider must implement incident/state idempotency; configure actual secret, heartbeat/dead-man rules and demonstrate real redacted fault/recovery receipt. Local loopback receipt is not production receipt.
3. Remaining §57 misses and unmeasured browser/device/deployed-build conditions documented above; do not claim universal performance compliance. No correctness/security scope deferred.
