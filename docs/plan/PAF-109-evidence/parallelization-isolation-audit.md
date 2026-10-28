# PAF-116 Integration parallelization isolation audit

## Scope and decision

Inspected all 42 `test/**/*.integration.test.ts` files plus the shared SQL transport, match fixture, and cleanup helpers. Classification: **1 parallel candidate / 41 serial-mandatory**. The candidate is read-only scoring parity; it creates no fixtures, SQL objects, or persistent state. No suite was admitted based on random UUIDs alone.

Evidence checks covered trigger/function DDL, relation-lock barriers, cutoff/notification queues, fixed SQL object names, catalog/global-object assertions, `pg_stat_activity` probes, auth/community fixture identities, cleanup registration, cleanup SQL predicates, and cleanup residue assertions. Hazard categories overlap; a file with multiple hazards appears once below.

## Per-file classification

| Integration file | Group | Inspected isolation evidence / hazard |
| --- | --- | --- |
| `test/community.column-isolation.integration.test.ts` | SERIAL-MANDATORY | Creates real auth users and a community, mutates membership/settings, and has no registered cleanup or residue assertion. Random emails/community IDs do not prove cleanup isolation. |
| `test/matches.schema.integration.test.ts` | SERIAL-MANDATORY | Creates/drops fixed `paf71_fail_registration` function/trigger and disables `match_event_immutable`; relation DDL and shared names. |
| `test/matches.results.schema.integration.test.ts` | SERIAL-MANDATORY | Checks `pg_class`/`pg_trigger` definitions and disables `match_event_immutable`; its management-fixture teardown also performs trigger DDL. |
| `test/matches.results.submission.integration.test.ts` | SERIAL-MANDATORY | Disables/enables `community_member_guard`; management-fixture teardown alters shared trigger state. |
| `test/matches.registration.cutoff.integration.test.ts` | SERIAL-MANDATORY | Uses retained-lock/`pg_stat_activity` barriers, fixed blocker function/trigger names, global trigger/function probes, and the named pg_cron cutoff job/global due-queue behavior. |
| `test/notifications.store.integration.test.ts` | SERIAL-MANDATORY | Uses a `pg_sleep` contention gate and `pg_stat_activity` probes. Cleanup deletes selected IDs but has no namespace-wide residue assertion. |
| `test/community.venue-photo.integration.test.ts` | SERIAL-MANDATORY | Creates auth/storage fixtures and removes storage rows in `finally`; no fixture registry or cleanup residue check. Storage is shared. |
| `test/community.integration.test.ts` | SERIAL-MANDATORY | Uses per-registry namespace tokens and scoped cleanup assertions, but cleanup disables/enables `community_member_guard` on a shared relation. |
| `test/matches.results.scoring.integration.test.ts` | PARALLEL-CANDIDATE | SQL `DO` blocks exercise the pure scoring/validation functions without persistent writes or fixture creation. Catalog check filters to the two exact stable function names; no trigger DDL, queue, barrier, global trigger count, or cleanup dependency. Isolation does not rely on UUIDs. |
| `test/player.integration.test.ts` | SERIAL-MANDATORY | Creates local auth users and exercises concurrent duplicate submits under a per-user advisory lock; no registered namespace cleanup/residue proof. |
| `test/community.invitee.integration.test.ts` | SERIAL-MANDATORY | Creates real actors and community membership fixtures for directory scans; no registered cleanup or residue assertion. |
| `test/matches.prune-scoping.integration.test.ts` | SERIAL-MANDATORY | Alters `match_event_immutable`, inspects trigger state, and tests pruning against shared local data plus developer-data sentinel. |
| `test/matches.invitations.integration.test.ts` | SERIAL-MANDATORY | Uses retained-lock barriers and management fixtures; shared cleanup alters triggers, and the suite installs/drops fixed blocker SQL objects. |
| `test/matches.management.visibility.integration.test.ts` | SERIAL-MANDATORY | Uses `createMatchManagementFixtures`; teardown disables/enables shared match/community triggers despite its row-scoped assertions. |
| `test/matches.registration.fifo.integration.test.ts` | SERIAL-MANDATORY | Proves concurrent RPC blocking through shared `pg_stat_activity`/lock-chain probes; the SQL match token can match contenders from multiple suites. |
| `test/matches.notifications.integration.test.ts` | SERIAL-MANDATORY | Alters match trigger state; creates/drops fixed `fail_match_notification_insert` function/trigger and checks global `pg_trigger`/`pg_proc` residue. |
| `test/matches.registration.domain-migration.integration.test.ts` | SERIAL-MANDATORY | Drops/recreates fixed registration triggers and uses fixed `paf5-domain-migration-*` auth emails; shared schema objects and identities. |
| `test/notifications.producers.integration.test.ts` | SERIAL-MANDATORY | Creates real auth/community fixtures using random email suffixes but has no scoped fixture cleanup/residue assertion; no UUID-only isolation assumption accepted. |
| `test/matches.management.edits.integration.test.ts` | SERIAL-MANDATORY | Uses management-fixture cleanup that alters triggers; directly disables/enables `community_member_guard`. |
| `test/matches.management.cancellation.integration.test.ts` | SERIAL-MANDATORY | Uses trigger-altering management cleanup and installs fixed `paf99_block_cancel` function/trigger for fault injection. |
| `test/community.admin.integration.test.ts` | SERIAL-MANDATORY | Uses process-group fault injection plus long-running lock holders and `pg_stat_activity`/blocking-pid probes against shared communities. |
| `test/matches.management.departures.integration.test.ts` | SERIAL-MANDATORY | Uses trigger-altering management cleanup and fixed `paf98_block_departure` function/trigger for fault injection. |
| `test/matches.management.notifications.integration.test.ts` | SERIAL-MANDATORY | Uses management fixtures whose cleanup alters shared triggers; also reads shared `pg_proc` definitions. |
| `test/notifications.targets.integration.test.ts` | SERIAL-MANDATORY | Creates auth users, communities, invitations, and notifications and tests concurrent acceptance; no registered cleanup or residue assertion. |
| `test/matches.visibility.integration.test.ts` | SERIAL-MANDATORY | Creates real auth users and match/community fixtures with random IDs; no registered cleanup/residue proof. |
| `test/matches.publication.integration.test.ts` | SERIAL-MANDATORY | Creates auth/match fixtures and mutates `global_player_ratings` by fixture user ID; no namespace-scoped cleanup/residue assertion. |
| `test/community.request.integration.test.ts` | SERIAL-MANDATORY | Installs/drops fixed `test_reject_community_notification` function/trigger and probes global catalogs for leaked objects. |
| `test/matches.reconfirmation.integration.test.ts` | SERIAL-MANDATORY | Uses trigger-altering management cleanup and fixed `paf101_fail_notice` function/trigger for fault injection. |
| `test/matches.fixture-sql.integration.test.ts` | SERIAL-MANDATORY | Starts `pg_sleep(60)` and probes/sweeps other `pg_stat_activity` sessions; timeout/backend state is shared. |
| `test/matches.management.ownership.integration.test.ts` | SERIAL-MANDATORY | Uses management-fixture cleanup that disables/enables shared match/community triggers. |
| `test/matches.discovery.integration.test.ts` | SERIAL-MANDATORY | Alters `match_event_immutable`, removes named pg_cron jobs, and performs scheduler/due-notification probes against global database state. |
| `test/community.admin-extraction.integration.test.ts` | SERIAL-MANDATORY | Runs `pnpm build` and writes/reads shared `dist`; source explicitly forbids concurrent Playwright use of that artifact. Kept out of parallel workers to avoid build/resource overlap with DB suites. |
| `test/notifications.preferences.integration.test.ts` | SERIAL-MANDATORY | Creates real auth users and deletes their IDs in `finally`, but has no namespace registry or residue assertion. |
| `test/matches.registration.schema.integration.test.ts` | SERIAL-MANDATORY | Uses shared trigger/function catalog checks and disables `match_event_immutable`; registration fixtures share schema-level DDL state. |
| `test/matches.registration.notifications.integration.test.ts` | SERIAL-MANDATORY | Uses FIFO barriers plus fixed `paf54_block_fifo_alert` function/trigger and global trigger/function count probes. |
| `test/matches.photo.integration.test.ts` | SERIAL-MANDATORY | Creates real auth users, match events, and storage objects; cleanup is local `finally` logic without registry-scoped residue verification. |
| `test/matches.registration.visibility.integration.test.ts` | SERIAL-MANDATORY | Disables/enables `match_event_immutable`; relation-level DDL conflicts with other match suites. |
| `test/matches.management.protection.integration.test.ts` | SERIAL-MANDATORY | Uses management-fixture cleanup and fixed `paf102_fail_protection_effect` function/trigger for injected failures. |
| `test/matches.registration.actions.integration.test.ts` | SERIAL-MANDATORY | Uses retained-lock barriers with `pg_stat_activity`/blocking-pid closure probes and disables `match_event_immutable`. |
| `test/matches.registration.model.integration.test.ts` | SERIAL-MANDATORY | Disables/enables `match_event_immutable` for fixture updates; relation-lock-sensitive match setup. |
| `test/helpers/sql-transport.integration.test.ts` | SERIAL-MANDATORY | Exercises statement timeout, `pg_sleep`, cancellation/termination, and dedicated backend lifecycle; parallel DB load would change timeout behavior. |
| `test/helpers/fixture-cleanup.integration.test.ts` | SERIAL-MANDATORY | Directly disables/enables `community_member_guard`; its registry tests are scoped, but trigger DDL locks the shared relation. |

## Cleanup and namespace evidence

- `FixtureCleanupRegistry` builds a per-run namespace from normalized scope, `process.pid`, and a random token. Entries are explicit table/identity pairs; `assertNoResidue()` counts only rows matching each registered identity. It does not query global fixture counts.
- `createMatchFixtureCleanupRegistry()` discovers child rows only within registered community/event IDs, registers exact child identities, checks expected named trigger states, and verifies registered identities are empty. Its cleanup intentionally uses `ALTER TABLE ... DISABLE/ENABLE TRIGGER`; therefore every suite using `createMatchManagementFixtures()` stays serial even when its behavior assertions are row-scoped.
- `sql-transport.ts` uses a process-specific `application_name` for owned pooled/dedicated backends. Backend leak assertions count only that name, not all `pg_stat_activity` rows.
- Some suites use direct `finally` deletes or no teardown. Those suites remain serial until they have explicit namespace-scoped residue proof. Per-row UUID generation alone is not isolation evidence.
- The parallel candidate performs no persistent DB mutation, so it requires no fixture cleanup. Its narrow catalog query is read-only and filters the two application function names; no concurrently scheduled suite mutates either function.

## Vitest groups, connection budget, and rollback

`vitest.integration.config.ts` defines one integration invocation with two inline projects. `integration-serial` includes the full integration glob except the one candidate, uses `fileParallelism: false` and one worker. `integration-parallel` includes only the candidate and caps workers at two. Root defaults and both groups set `retry: 0` and `repeats: 0`; no retries can mask a flake.

The project injects `SQL_TRANSPORT_POOL_MAX` into worker processes. Defaults preserve a pool max of 10 for the serial worker and cap parallel workers at 2. Thus the conservative maximum pooled-client budget is `(1 serial worker × 10) + (2 parallel workers × 2) = 14` connections. An explicit environment override is validated by the helper to `1..10`; worst configured pool budget is `(1 × 10) + (2 × 10) = 30`. The local PostgreSQL `max_connections` is not configured in `supabase/config.toml`; PostgreSQL's default is 100 unless the provisioned stack overrides it. The 14 default pooled connections leave 86 slots before accounting for Supabase services, dedicated barrier connections, or operator sessions. Dedicated sessions are not counted against the pool cap; all suites that open them remain serial and close/sweep them in cleanup. Verify the actual local server value with `SHOW max_connections` when recording proof runs.

Rollback is one line: change `parallelIntegrationEnabled` to `false`. The root integration include and `fileParallelism: false` then run all 42 files in one serial project; no package script or file reorganization changes.

## Proof protocol

Run `pnpm exec vitest run --config vitest.integration.config.ts` three consecutive times, with zero retries/repeats. Record wall durations and compare to the supplied serial baseline of 153.04 seconds. Verify transport fault-injection/timeout suites and review every failing run. A failed run or negligible speedup requires rollback; do not add retries or raise budgets to mask instability.

| Run | Integration tests / files | Integration wall time | Vitest duration | Result |
| --- | ---: | ---: | ---: | --- |
| 1 | 593 / 83 (592 passed, 1 failed) | 245.59s | 243.18s | FAIL: cutoff barrier SQL pool connection timeout; failure reported under `integration-parallel` |
| 2 | 593 / 83 (592 passed, 1 failed) | 230.03s | 227.63s | FAIL: same cutoff barrier SQL pool connection timeout under `integration-parallel` |
| 3 | 593 / 83 (591 passed, 2 failed) | 234.11s | 231.68s | FAIL: cutoff barrier SQL pool connection timeout and submission snapshot changed by concurrently-created profiles, both reported under `integration-parallel` |

The supplied serial baseline is 153.04 seconds. Proof-run times were 90.14s (58.9%), 74.59s (48.7%), and 78.64s (51.4%) slower than baseline; none reached the required 300 tests / 42 files. `sql-transport.integration.test.ts` had no failure in the three captured outputs, but the cutoff timeout fault exposed a flake in every run; the submission snapshot failure in run 3 also demonstrates concurrent DB interference. Rollback switch `parallelIntegrationEnabled` is **false**. The single-project serial confirmation passed: 300 tests / 42 files. Decision: retain serial execution; two-project parallel config fails isolation proof, independent of its timing.
