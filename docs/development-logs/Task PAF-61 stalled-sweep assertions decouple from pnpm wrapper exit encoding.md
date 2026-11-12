---
title: PAF-61 Stalled-sweep assertions decouple from pnpm wrapper exit encoding
type: development-log
permalink: docs/development-logs/task-PAF-61-stalled-sweep-assertions-decouple-from-pnpm-wrapper-exit-encoding
---

# Development Log: PAF-61

## Metadata

- Task ID: PAF-61 — "Test infra: stalled-sweep assertions couple to the pnpm wrapper's exit encoding"
- Date (UTC): 2026-11-12
- Project: padel-friend
- Branch: `feature/PAF-61-stalled-sweep-assertions` (base `origin/main` `cd1b62d`)
- Commits (2 on the branch, chronological):
  - `bf5a2af` — `test: decouple local SQL spawn and stalled-sweep assertions from pnpm wrapper`
  - `b71a00f` — `fix: address review findings` (F1: `sweepTimedOut` oracle)
- Related Linear: PAF-61; team PadelFriend (<https://linear.app/trystanworkspace2/issue/PAF-61>)
- Single unit of work.

## Objective

- `test/community.admin.integration.test.ts` spawned the Supabase CLI via `pnpm exec supabase db query`, so the stalled-sweep assertions observed the pnpm wrapper's termination, not the CLI child's: under pnpm 11 a signal kill surfaces as `code null`; under pnpm 12 the wrapper translates it to exit 130. The relaxed `[null, 130]` allowlist therefore could not distinguish a signal-kill from a wrapper-translated exit — the assertion coupled to the wrapper's exit encoding rather than to the CLI's real termination.
- Goal: assert on the CLI child's real termination, keep the test green under pnpm 12, and document the pnpm/CLI termination distinction in-site.

## Implementation Summary

- Wrapper-free CLI spawn (`bf5a2af`):
  - `startLocalSql` now spawns `process.execPath` with the Supabase JS entry resolved via `createRequire(import.meta.url).resolve('supabase/dist/supabase.js')` — no more `pnpm exec` wrapper, so the exit observed is the CLI's own.
  - Verified against the installed `supabase@2.121.0`: `bin.supabase = dist/supabase.js`; the JS launcher forwards SIGTERM/SIGINT/SIGHUP and re-signals itself when the native CLI dies by signal.
  - Resolution is lazy inside the helper; a documented comment explains the pnpm 11 (`code null`) vs pnpm 12 (translated exit 130) behavior this removes.
- Direct deadline-expiry oracle (`bf5a2af`):
  - `HolderTeardownResult` gained a required additive `sweepCommand: LocalSqlCommand` (the retained child handle) and `sweepTimedOut: boolean`.
  - `releaseHolderAndSweep` sets `sweepTimedOut = true` as the first statement of the sweep `withDeadline` catch branch — the only branch that invokes `sweepCommand.stop()` — proving deadline expiry plus stop-path invocation directly.
- Stalled-sweep test assertions (`bf5a2af`, tightened by F1 in `b71a00f`):
  - `elapsedMs < TEARDOWN_DEADLINE_MS`, `sweepTimedOut === true`, `sweepCommand.pid` defined, `sweep` defined with an explicit narrowing throw, `sweep.code !== 0` (not-clean-exit contract), `!sweepCommand.isGroupAlive()`.
  - Deleted the `[null, 130]` wrapper-encoding allowlist.
- Unchanged by design: `pg_sleep(4)` sweepSql, completion marker, `it.skipIf(environment.env === null)` guard, 30000 ms test timeout, slice arithmetic (`floor((10000 - 500) / 4) = 2375 ms`). The stale `pnpm → supabase CLI → psql` comment was generalized to match the new spawn path.
- Review loop (1 required finding): round-1 finding F1 (major/required) — the elapsed-floor assertion from round 1 was rejected in delta review because the elapsed window starts before spawn, so a slow early CLI failure could exceed the floor and mask a non-timeout failure. Round 2 replaced it with direct `sweepTimedOut` evidence: an early CLI failure now fails the test. Delta review PASS with zero findings.

## Files Changed

- `test/community.admin.integration.test.ts` (+32/−14 across both commits) — ONLY production-repo file:
  - `startLocalSql`: `process.execPath` + package-resolved Supabase JS entry; pnpm-wrapper removal; explanatory comment (`bf5a2af`)
  - `HolderTeardownResult`: additive required `sweepCommand` + `sweepTimedOut` (`bf5a2af`)
  - `releaseHolderAndSweep`: `sweepTimedOut` set in the sweep `withDeadline` catch branch (`bf5a2af`)
  - Stalled-sweep test: real-termination assertions, allowlist deletion, F1 oracle swap (`bf5a2af`, `b71a00f`)

## Key Decisions

- Shared spawn change (all `startLocalSql` callers) over a sweep-only special case: one helper owns the change, so every SQL child gains wrapper-free process-group ownership; the happy path is unchanged via `runLocalSqlBounded`.
- `process.execPath` + package-resolved JS entry over the `node_modules/.bin/supabase` shim: portable (no POSIX `.bin` / Windows `.cmd` divergence, no shell quoting), and it keeps Supabase's own signal-preserving launcher. Spawning the raw native binary was explicitly rejected in the plan — it would duplicate the optional-package selection logic.
- Not-clean-exit contract (`code !== 0`) over pinning `null`: the launcher may report termination via its own nonzero exit, so the exact status encoding is deliberately not pinned.
- `sweepTimedOut` as the timeout oracle over elapsed-time floors: the elapsed window starts before spawn, so a floor cannot discriminate slow-early-failure from deadline expiry; the flag is set exactly where `sweepCommand.stop()` is invoked.

## Validation Performed

- Preflight: `node_modules/supabase/dist/supabase.js` present; pnpm 12.13.0 confirmed.
- Static: commit-hook `complete-check --only=static` PASS on both commits (build / knip / typecheck / lint / format); after the F1 fix, `pnpm typecheck` + `pnpm lint` exit 0.
- Code review: full review (code-review-specialist) FAIL → F1 fixed in `b71a00f` → delta review PASS with zero findings.
- Test evidence: the single final `pnpm complete-check` on the final reviewed state is the designated run (single-run policy) — pending at log time; the integration suite is DB-reset serial, and the stalled-sweep test is `it.skipIf(environment.env === null)` guarded, so it runs wherever a local Supabase environment exists.

## Risks and Follow-ups

- None known.
- PR review (Copilot) pending — to be requested/verified per the repo's Copilot review protocol at PR time.

## Relations

- Linear issue: PAF-61 (PadelFriend team)
- Related prior work: PAF-174 (integration runtime/runtime reduction), PAF-175 (e2e flake stabilization), PAF-157 (test-suite timing / shard topology)
