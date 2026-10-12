# Context Bundle — PAF-51 (PAF-2 follow-up — Tier 2: correctness)

Single context source for all reviewers and fixers of this delivery. Read this file first; do not re-derive context.

- Branch: `feature/PAF-51-tier-2-correctness` (base `origin/main` = `3f7bc46`)
- HEAD: `f5ec88e` · Epic scope: one branch, one PR, three unit commits
- Plan file (design of record): `docs/plan/Plan PAF-51 PAF-2 follow-up — Tier 2: correctness.md`
- Full unified diff (no truncation, repo diff + untracked plan file): `/private/var/folders/lp/67ytvn9176l2v17pjy8h2zl00000gn/T/paf51-epic.patch` (99 537 bytes, 1 698 lines)
- Diff stat vs base: **21 files, 934 insertions(+), 166 deletions(-)** (source/test/supabase subset: 17 files, 894+/160-)
- Fast gate: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, affected Vitest files — green per unit
- Full gate (`pnpm complete-check`) on frozen tree `f5ec88e`: **PASS** — build, knip, typecheck, lint, format, Vitest **41 files / 409 tests**, coverage 100% on the gated module, Playwright **53/53**. No skipped suites.

## Epic scope

PAF-51 groups post-PAF-2 hardening follow-ups, Tier 2: correctness fixes, delivered as three child units.

## Unit 1 — PAF-36 "PAF-27 follow-up: settings JSONB size parity and denial coverage"

Commit: `59da644` — `fix: align community settings validation and denials`
Changed files: `docs/plan/PAF-27-findings.md`, `src/features/community/community.validators.ts`, `src/features/community/community.functions.ts`, `test/community.functions.test.ts`, `test/community.integration.test.ts`

Findings in scope:

- F1 (minor) — settings JSON byte cap used compact `JSON.stringify` while PostgreSQL renders JSONB with separator whitespace and normalizes numbers, so validator-accepted input could trip the DB `communities_settings_check` (`octet_length(settings::text) <= 4096`).
- F3 (minor) — a settings size CHECK failure surfaced a raw DB error instead of `INVALID_COMMUNITY_INPUT`.
- F4 (minor) — handler-denial coverage lacked a hidden-private target and a demoted admin.

Acceptance criteria:

- [x] Settings size validation matches PostgreSQL JSONB limits; boundary regression tests added.
- [x] A settings CHECK failure returns `INVALID_COMMUNITY_INPUT`; other DB errors stay unmapped.
- [x] Integration denial coverage includes a hidden-private target and a demoted admin.
- [x] `pnpm complete-check` passes.

## Unit 2 — PAF-42 "PAF-31 PR1 follow-up: deadlock mapping, venue archive audit detail, roster typing, reactivation chronology, test env loader"

Commit: `601a772` — `fix: harden community governance correctness`
Changed files: `src/features/community/community-admin.functions.ts`, new `src/features/community/community-admin.types.ts`, `src/features/community/CommunityAdmin.tsx`, `src/locales/{en,es,pt-BR}/translation.json`, new `supabase/migrations/20261011171955_community_venue_archive_audit.sql`, `test/community.admin.functions.test.ts`, `test/community.admin.integration.test.ts`, `test/community.integration.test.ts`, `test/community.admin-ui.test.tsx`, new `test/helpers/local-supabase-env.ts`, new `test/local-supabase-env.test.ts`, new `docs/security/community-governance-lock-order.md`, `docs/plan/PAF-31-findings.md`

Findings in scope:

- F5 — integration test read `.env` unconditionally.
- F6 — venue archive audit indistinguishable from an ordinary edit (empty details).
- F7 — `search_community_members` generated types claimed non-null `valid_until`/`activated_at`/`display_level`/`reliability_percent` although SQL can return null.
- F8 — queued reactivation could overlap the previous interval (already fixed by migration `20261009061318`; verified and preserved, no redundant migration).
- F9 — reverse lock order on direct membership writes and unmapped `40P01`/`40001`.

Acceptance criteria:

- [x] F5–F9 addressed as described.
- [x] `pnpm complete-check` passes.

## Unit 3 — PAF-44 "PAF-32 follow-up: timeline pagination coverage, truncation indicator, queued-chronology test hardening"

Commit: `f5ec88e` — `fix: expose timeline truncation and harden chronology tests`
Changed files: `src/features/community/community.functions.ts`, `test/community.lifecycle.functions.test.ts`, `test/community.integration.test.ts`, `test/community.admin.integration.test.ts`, `docs/plan/PAF-32-findings.md`

Findings in scope:

- F2 — timeline pagination verified only via mocked query calls.
- F3 — at the offset ceiling, truncation was indistinguishable from exhaustion.
- F4 — queued-chronology test did not deterministically fail the old code.
- F5 — test lock holder could expire across long polling windows (`pg_sleep(30)`).

Acceptance criteria:

- [x] F2–F5 addressed as described.
- [x] `pnpm complete-check` passes.

## Plan summary (implementation steps as executed)

1. Preflight on branch `feature/PAF-51-tier-2-correctness` from `origin/main`, per-unit sequential commits.
2. Unit 1: PostgreSQL-JSONB-faithful byte sizing (separators + exponent expansion), exact known-error mapping (`communities_settings_check` 23514, `22023`/`Invalid community patch`), hidden-private and demoted-admin denial coverage.
3. Unit 2: shared environment-first loader helper with CI fail-closed guard; forward audit migration `20261011171955_community_venue_archive_audit.sql` adding sanitized venue detail `{archived: …}`; feature-owned nullable roster DTO with i18n missing-rating fallbacks in all three locales; F8 chronology verified/preserved; canonical lock order documented + `40P01`/`40001` mapped to `COMMUNITY_GOVERNANCE_CONFLICT_RETRYABLE` with no automatic retries.
4. Unit 3: additive `truncated` flag on the timeline result (`hasLookahead && next_offset === null`); persisted real-JWT multi-community pagination traversal derived from fixture tuples; queued-chronology test rebuilt around a single-statement row-lock holder proven with a `FOR UPDATE NOWAIT` probe, released explicitly via `pg_terminate_backend`, with bounded cleanup; local negative control proved the test fails against the old `valid_from` behavior.
5. Epic handoff: cumulative `pnpm complete-check` green, one PR to `main`.

## Review scope

- `src/features/community/**`, `supabase/migrations/**` changed → code review + architecture review.
- `src/features/community/CommunityAdmin.tsx` + `src/locales/*/translation.json` changed → UX/UI review.
- Generated `src/lib/supabase/database.types.ts` intentionally NOT edited.

## Notes for reviewers

- Deferred findings from the source ledgers are recorded per-unit in `docs/plan/PAF-2{7,31,32}-findings.md`; this bundle lists only what this delivery changed.
- Known non-blocking observation: the implementer and QA agents reported Vitest's existing shutdown "close timed out after 2000ms" notice after a successful run; the gate still exits 0.
- F8 required no new migration (already fixed upstream at `20261009061318_community_reactivation_interval_order.sql`); confirm the current SQL still carries the fix rather than asking for a new migration.
