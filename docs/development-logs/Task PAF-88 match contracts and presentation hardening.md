---
title: PAF-88 Follow-up Epic 3 Match Contracts and Presentation Hardening
type: development-log
permalink: docs/development-logs/task-PAF-88-match-contracts-and-presentation-hardening
---

# Development Log: PAF-88

## Metadata

- Task ID: PAF-88 (epic "Follow-up epic 3 — Match contracts and presentation hardening"; sub-issues PAF-96 and PAF-85 delivered as units within the same PR, plus review fixes)
- Date (UTC): 2026-10-21
- Project: padel-friend
- Branch: feature/PAF-88-match-contracts-presentation-hardening (base `d4f2c9b` = `origin/main` @ `d4f2c9bba4337aa8be02945bb36306e77b0de1ad`)
- Commits (3, oldest first): `da77fb5` (Unit 1 — PAF-96 "fix: enable row level security on internal registration tables"), `4e0fe4c` (Unit 2 — PAF-85 "feat: harden match contracts, snapshot reads, and presentation tones"), `f74eeb4` (Unit 3 — review fixes "fix: address review findings", HEAD; amended — supersedes `d1d2e82`)
- Diff: 47 unique files (+82 PAF-96; +2460/−719 PAF-85 across 37 files; +359/−114 review fixes across 21 files)
- Artifacts: plan `docs/plan/Plan PAF-88 Follow-up epic 3 — Match contracts and presentation hardening.md`, delivery bundle `docs/plan/PAF-88-bundle.md`, findings ledger `docs/plan/PAF-88-findings.md`
- Related Linear: PAF-88 (epic), PAF-96, PAF-85; blocks PAF-6 (must finish before PAF-6 starts)

## Objective

- Close follow-up epic 3: enable RLS on the internal match registration state/attempts tables (PAF-96) and deliver the remaining PAF-85 scope — explicit match creation/list/detail contracts, honest typed fixture builders, a runtime RPC JSON decoder with type-negative tests, shared presentation badge tones, the 320px create-screen overflow fix, and explicit snapshot caller-badge semantics — as one focused branch/PR, with every child acceptance criterion satisfied and review findings resolved, without lowering coverage thresholds or widening screenshot budgets.

## Implementation Summary

- **Unit 1 — PAF-96, commit `da77fb5` — RLS on internal registration tables.**
  - New forward migration `supabase/migrations/20261020220000_match_registration_internal_rls.sql`: exactly two `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` statements on `match_event_registration_state` and `match_event_registration_attempts`. No policies, no grants, no `FORCE ROW LEVEL SECURITY`, preserving the `SECURITY DEFINER` owner bypass.
  - `test/matches.registration.schema.integration.test.ts` extended with regression `enables non-forced RLS on internal registration bookkeeping without API privileges`: asserts both relations exist with `relrowsecurity=true`, `relforcerowsecurity=false`, zero `pg_policies`, owner `postgres`, all four privileges false for `anon`/`authenticated`, and direct operations under `SET LOCAL ROLE` failing SQLSTATE 42501. Existing registration behavior suites (schema, actions, fifo, cutoff, publication) passed unchanged: 52 tests / 6 files.
- **Unit 2 — PAF-85, commit `4e0fe4c` — contracts, snapshot reads, presentation tones, mobile overflow (37 files).**
  - **Snapshot SQL**: new migration `supabase/migrations/20261020220100_match_event_snapshot_projections.sql` — additive `(uuid, timestamptz)` `match_registration_roster`/`match_registration_counts` overloads; `get_match_event` materializes a single `as_of` instant and classifies all temporal fields, counts and caller badge at that instant; `list_match_events` threads `coalesce(p_as_of, now())` into rows, filtering, `registration_open`, `is_past` and the echoed `as_of`. Explicit REVOKE/GRANT keeps new overloads internal and public reads authenticated-only. Generated `database.types.ts` updated through the generator (overload signatures only).
  - **Contracts + builders**: new `match-contracts.ts` with schema-derived `Pick`-based creation/list/detail contracts (identity renamed `event_id`/`creator_id`, nullable-but-required properties, required `as_of` on raw detail, `cursor`+`as_of` on raw list, `MatchEventListItem` alias kept) and new `test/helpers/match-fixtures.ts` with complete typed builders plus `matchCountScenario`.
  - **Decoder + type-negatives**: new `match-decoders.ts` — handwritten runtime RPC JSON decoders (no new dependency) with enum/primitive/required-null checks, extra-key stripping, unknown badge → null, malformed list → `MATCH_LIST_UNAVAILABLE`, malformed detail → `{status:'error'}`; consumed by typed `matches.functions.ts` (decode before photo signing/render). New `test/fixtures/match-contracts.types.ts` with 13 `@ts-expect-error` assertions checked by `pnpm typecheck`; suites `test/matches.contracts.test.ts` and `test/matches.decoders.test.ts`.
  - **Presentation tones**: `StatusBadgeTone = positive | neutral | muted | danger | guest` (style keys renamed `playing→positive`, `reserve→neutral`, token values unchanged); new `match-status-tone.ts` owns exhaustive `satisfies Record<...>` domain→tone maps consumed by `MatchRegistrationPanel`/`MatchRequestQueue`; all StatusBadge callers audited.
  - **320px overflow**: `create-match.styles.ts` file input gets intrinsic sizing constraints (`minInlineSize:0`, `maxInlineSize/inlineSize:100%`); measured document width 362px → 320px, input ≥44px tall; `e2e/matches-visual.spec.ts` known-defect exemption and hide-input workaround removed, replaced with untouched-DOM overflow gates across en/pt-BR/es × light/dark plus long-filename and error states.
  - **Snapshot regression**: `test/matches.discovery.integration.test.ts` gained the "match event snapshot badge regression (PAF-85)" suite — pre-cutoff snapshot stays open when a cutoff marker is written later, inverse/equality cases, quartet/creator/invited/empty rosters, detail↔list same-instant agreement, omitted/null `p_as_of`, overload ACLs; `test/fixtures/matches-upgrade-assertions.sql` extended for populated-upgrade CI. Typed UI consumers migrated (Create/Details/InviteePicker/Review/Card/DetailPage/RegistrationPanel/RequestQueue, `MatchDetailsForm` no longer `Record<string, any>`).
- **Unit 3 — review fixes, commit `f74eeb4` — findings F1–F5 from `docs/plan/PAF-88-findings.md`, all fixed, plus the dead-code clean-up required to make the `knip` stage pass.**
  - F1 (major): `MatchCurrency = BRL|USD|EUR` at the RPC boundary — decoder rejects unsupported non-null currencies before signing/render; null stays valid; regressions prove the signer is never called for malformed currency.
  - F2/F5: coherent `matchCountScenario` partition (playing=floor(accepted/4)*4, reserve=(accepted%4)−notPlaying, not-playing=tail) with `assertNonnegativeSafeInteger` guards; impossible inputs throw; invariants assert accepted-partition coherence.
  - F3: valid default fixture photo storage key (`communityId/eventId/creatorId/objectUuid.jpg`) and real maps URL, validated against production `validateMatchPhotoKey`/`validatePublishMatch`.
  - F4: `test/**/*.tsx` added to `tsconfig.json` include (67 errors → 0) and 14 test files repaired against real contracts without `any`/casts/suppressions.
  - Knip dead-code clean-up (same commit): `test/fixtures/match-contracts.types.ts` now has a real consumer — positive contract values are imported and asserted in `test/matches.contracts.test.ts` while all `@ts-expect-error` negatives remain compiler-checked; the orphaned `MatchEventListResult` re-export was removed from `src/features/matches/match-model.ts` and the unused `Draft` export was removed from `src/features/matches/MatchDetailsForm.tsx`.

## Files Changed

- PAF-96 (commit `da77fb5`, 2 files): `supabase/migrations/20261020220000_match_registration_internal_rls.sql` (new), `test/matches.registration.schema.integration.test.ts` (RLS regression)
- PAF-85 SQL/types (commit `4e0fe4c`): `supabase/migrations/20261020220100_match_event_snapshot_projections.sql` (new), `src/lib/supabase/database.types.ts`, `test/fixtures/matches-upgrade-assertions.sql`
- PAF-85 contracts/boundary: `src/features/matches/match-contracts.ts` (new), `match-decoders.ts` (new), `matches.functions.ts`, `matches.validators.ts`, `match-model.ts`, `match-registration-model.ts`
- PAF-85 presentation: `src/features/matches/match-status-tone.ts` (new), `src/components/ui/StatusBadge.tsx`, `src/components/ui/status-badge.styles.ts`
- PAF-85 typed consumers: `src/features/matches/CreateMatchPage.tsx`, `MatchDetailsForm.tsx`, `MatchInviteePicker.tsx`, `MatchReview.tsx`, `MatchCard.tsx`, `MatchDetailPage.tsx`, `MatchRegistrationPanel.tsx`, `MatchRequestQueue.tsx`, `create-match.styles.ts`
- PAF-85 tests: `test/helpers/match-fixtures.ts` (new), `test/fixtures/match-contracts.types.ts` (new), `test/matches.contracts.test.ts` (new), `test/matches.decoders.test.ts` (new), `test/matches.create.test.tsx`, `test/matches.detail.test.tsx`, `test/matches.discovery.integration.test.ts` (snapshot regression), `test/matches.functions.test.ts`, `test/matches.list.test.tsx`, `test/matches.model.test.ts`, `test/matches.registration.panel.test.tsx`, `test/matches.registration.roster.test.tsx`, `test/matches.styles.test.ts`, `test/matches.validators.test.ts`, `test/ui.status-badge.test.tsx`, `e2e/matches-visual.spec.ts` (320px gate)
- Review fixes (commit `f74eeb4`): `src/features/matches/match-contracts.ts` (MatchCurrency), `match-decoders.ts`, `match-model.ts` (orphaned `MatchEventListResult` re-export removed), `MatchDetailsForm.tsx` (unused `Draft` export removed), `tsconfig.json` (`test/**/*.tsx` include), `test/helpers/match-fixtures.ts` (partition + safe-integer guards, valid defaults), `test/matches.contracts.test.ts` (positive contract-value assertions consuming `test/fixtures/match-contracts.types.ts`), `test/matches.decoders.test.ts`, `test/matches.functions.test.ts`, `test/matches.create.test.tsx`, `test/matches.detail.test.tsx`, `test/matches.list.test.tsx`, `test/matches.registration.controller.test.tsx`, `test/matches.registration.panel.test.tsx`, `test/matches.registration.queue.test.tsx`, `test/matches.registration.roster.test.tsx`, `test/community.admin-ui.test.tsx`, `test/community.onboarding.test.tsx`, `test/community.requests-route.test.tsx`, `test/notifications.center.test.tsx`, `test/notifications.preferences.test.tsx`
- Findings ledger: `docs/plan/PAF-88-findings.md` (F1–F5, all fixed)

## Key Decisions

- **Snapshot caller-badge semantics (binding user decision)**: badges follow the snapshot — `caller_badge`, reserve/not-playing counts, `registration_open` and `is_past` are all classified at the single instant the response echoes as `as_of`; a cutoff marker written later must not close an earlier snapshot. Snapshot = temporal classification of the CURRENT accepted roster, not historical reconstruction.
- **Additive `(uuid, timestamptz)` overloads** over defaulted second arguments, so live writer paths (reconcile, submit/decide, processors, notifications, request queue, accepted roster) keep their untouched one-argument helpers; avoids ambiguous overload resolution, mutation semantics and drop/recreate dependency cascades.
- **Shared badge tones renamed to presentation vocabulary** (`positive|neutral|muted|danger|guest`) with the exhaustive match-domain mapping owned by the matches feature in `match-status-tone.ts`; domain vocabulary stays in translated copy, not in the primitive tone API; token values and i18n keys unchanged.
- **320px overflow fixed by intrinsic sizing** on the native file input (document 362px → 320px), replacing the E2E known-defect exemption/hide-input workaround; no `overflow:hidden`, fixed widths or widened screenshot tolerances.
- **RLS migration is minimal-by-design**: no policies/grants and no `FORCE RLS`, preserving `SECURITY DEFINER` owner bypass; denial for `anon`/`authenticated` proven at the catalog and `SET LOCAL ROLE` level.
- **Handwritten contracts/decoders, no new dependency**: the repo has no schema-validation library; bounded explicit decoders follow the existing `matches.validators.ts` pattern instead of installing Zod or building a generic framework.
- **Review discipline**: findings tracked in `docs/plan/PAF-88-findings.md` (F1–F5, all fixed, delta-reviewed); the `knip` dead-code clean-up is folded into the same review-fix commit rather than a fourth commit; coverage thresholds and screenshot budgets unchanged throughout.

## Validation Performed

- `pnpm typecheck` — pass (also validates the 13 `@ts-expect-error` assertions in `test/fixtures/match-contracts.types.ts`; TS2578 would fire on unused directives).
- `pnpm lint` — pass; `pnpm format:check` — pass.
- `pnpm exec supabase db reset --local` — pass (both new migrations apply).
- `pnpm db:types:check` — pass (generated overload signatures only).
- `pnpm exec supabase db lint --local --schema public` — pass with pre-existing routine warnings, none on new/changed functions. Known evidence limitation: the repo/CI has no original RLS security-advisor invocation, and `supabase db lint` is supplementary SQL routine lint only — the PAF-96 RLS criterion is proven by the catalog regression (`relrowsecurity`/`relforcerowsecurity`/`pg_policies`/privileges/42501), and no advisor rerun is claimed.
- Unit suites — pass (contracts, decoders, functions, validators, model, create, detail, list, panel, roster, queue, controller, styles, status-badge, notifications, i18n).
- Integration suites — pass: discovery 5/5 (including the PAF-85 snapshot regression), registration cutoff/visibility/publication/schema 27/27, registration schema/actions/fifo/cutoff/publication/schema 52/52.
- E2E `pnpm test:e2e e2e/matches-visual.spec.ts` — pass, 12 tests, no snapshot updates, no widened budgets (fresh preview via package script).
- Populated-upgrade harness (`scripts/test-populated-migration-up.mjs`) — assertions extended in `test/fixtures/matches-upgrade-assertions.sql`; the harness refuses non-CI environments, so this evidence must be proven by CI.
- `pnpm complete-check` — pass on the final reviewed state (commit `f74eeb4`), recorded run duration ~5m09s: unit 79 files / 802 tests with coverage statements/branches/functions/lines at 100% vs the 80% thresholds; integration 25 files / 162 tests; E2E 142 passed, 0 failed / 0 skipped / 0 flaky; build, `db:types:check`, `typecheck`, `lint`, `format:check` and `knip` all pass. No coverage threshold or screenshot budget changed.

## Risks and Follow-ups

- **RLS security-advisor evidence gap**: no original advisor invocation exists in the repo/CI; if that surface is later supplied/located, rerun it and record the output to close the linter-specific evidence criterion (catalog regression already proves the underlying fix).
- **Populated-upgrade proof deferred to CI**: `POPULATED_UPGRADE_OPT_IN=1 node scripts/test-populated-migration-up.mjs` explicitly refuses non-CI environments; require its green evidence from CI (which also restores the latest-schema state afterwards).
- **Snapshot scope limitation (documented)**: `as_of` is a temporal classification over currently readable event/registration data, not historical reconstruction — no history storage was invented and visibility/authorization is unchanged.
- **Pre-existing `supabase db lint` warnings** (volatility/shadowed variable/type mismatch in `decide_match_registration` and others) are unchanged and out of scope for this epic.
- **PR size exceeds the soft ~1500-line guideline** (47 unique files, ~+2901/−833 across commits) because the epic mandates one focused PR; scope was not separable without breaking the epic contract.
- **Deploy ordering**: the database migration must be deployed before clients consuming the required detail `as_of`; post-deploy corrections use forward migrations only (never edit applied history or relax ACLs).
