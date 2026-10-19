# Context bundle — combined review follow-up delivery

Branch: `feature/PAF-84-PAF-77-review-followups`
Base: `origin/main` @ `ba8ef880b385d8997e89a61eee71f2ef3ac3234f`
HEAD: two commits — `b5125aa` (Unit A) then `91bf7ba` (Unit B)
Size: `git diff --shortstat origin/main..HEAD` → **59 files changed, 3117 insertions(+), 350 deletions(-)**

> Soft guideline breach, deliberately accepted by the user: one combined PR was requested for both
> follow-up issues, and each unit's parts (shared primitives + all consumers + visual tests; typed
> contracts + all adapters + shared SQL + all five migration overrides + tests) are inseparable.

## Scope

Two Linear follow-up issues delivered together, one branch, two commits, one PR.

### Unit A — PAF-84 — "PAF-5 follow-up — deferred review findings and design-library polish"

Origin: `docs/plan/PAF-5-findings.md`. Derived AC (the issue has no AC checklist):

1. Shared roster-row / status-badge presentation exists in `src/components/ui`; every consumer migrated; duplicated feature badge/identity styling removed; no shared→feature imports; visual, a11y and translated output preserved. (Ledger F8)
2. E2E visual fixtures and their notifications are pruned deterministically and cannot leak into other suites; no residue after teardown. (Ledger F18)
3. CI actually runs `supabase migration up` from a committed populated predecessor database, proves the expected backfill/guards, and restores the latest schema before the remaining suites. (Ledger F33)
4. F17 resolved-by-design; F7/F13/F14/F19 documentation-only; F12 and F35 verified already fixed. (Ledger F17/F7/F13/F14/F19/F12/F35)

### Unit B — PAF-77 — "PAF-4 follow-up — deferred minor findings from the match events review"

Origin: `docs/plan/PAF-4-findings.md`. Derived AC (the issue has no AC checklist):

1. F20 — publication notification copy never reads as an invitation; unknown kinds degrade to generic copy; all locales. 
2. F21 — one database-issued `as_of` snapshot propagates through every page/retry; a refresh installs a new snapshot atomically and a stale in-flight page cannot append or overwrite.
3. F22 — explicit list/card contracts replace broad `Record` DTOs at the affected seams.
4. F23 — N-card listing performs exactly one batched signing request; zero per-card event lookups; private/unauthorized photos remain unsignable.
5. F24 — invitation status is independent of level-range eligibility and approval in BOTH list and detail; original migration edited in place with all four later overrides kept consistent; no new migration file.
6. F25 — both match-details checkbox labels guarantee a ≥44px target in BOTH dimensions, measured in the label element itself.

## Plan artifact

`docs/plan/Plan PAF-84-PAF-77 PAF-5 follow-up — deferred review findings and design-library polish + PAF-4 follow-up — deferred minor findings from the match events review.md`

Implementation-step summary (plan §Implementation Steps): preflight → A1 characterization → A1 extraction →
A2 fixture isolation → A3 upgrade harness → A4 evidence → A gate+commit → B regression-first contracts+SQL →
B adapters → B photo batch → B wording+targets → B gate → B commit.

## Changed files per unit

### Unit A — commit `b5125aa` (25 files, +1204/−202)

New: `src/components/ui/StatusBadge.tsx`, `src/components/ui/status-badge.styles.ts`,
`src/components/ui/RosterRow.tsx`, `src/components/ui/roster-row.styles.ts`, `test/ui.status-badge.test.tsx`,
`test/ui.roster-row.test.tsx`, `e2e/match-fixture-cleanup.ts`, `scripts/test-populated-migration-up.mjs`,
`scripts/test-populated-migration-up.d.mts`, `test/fixtures/matches-predecessor-upgrade.sql`,
`test/fixtures/matches-upgrade-assertions.sql`, `test/matches.fixture-cleanup.test.ts`,
`test/matches.migration-up-harness.test.ts`, plus the plan file.

Modified: `.github/workflows/ci.yml`, `e2e/global-setup.ts`, `e2e/matches-registration-visual.spec.ts`,
`src/features/matches/MatchCard.tsx`, `MatchRegistrationPanel.tsx`, `MatchRequestQueue.tsx`,
`match-registration.styles.ts`, `src/features/notifications/NotificationBadge.tsx`, `NotificationsPage.tsx`,
`notifications.styles.ts`, `test/matches.prune-scoping.integration.test.ts`.

### Unit B — commit `91bf7ba` (36 files, +1913/−148)

`e2e/matches-visual.spec.ts`, `src/features/matches/{MatchCard,MatchDetailPage,MatchDetailsForm,MatchRegistrationPanel,MatchesPage,create-match.styles,match-model,match-photo.server,matches.functions,matches.validators}.ts(x)`,
`src/features/notifications/NotificationDetailPage.tsx`, `src/lib/supabase/database.types.ts`,
`src/locales/{en,es,pt-BR}/translation.json`, `src/routes/_protected.matches.{index,my,past}.tsx`,
the five `supabase/migrations/*.sql` read-function definitions,
`test/{matches.create,matches.detail,matches.discovery.integration,matches.functions,matches.list,matches.photo.functions,matches.photo.integration,matches.registration.panel,matches.routes,matches.styles,matches.validators,notifications.detail}.test.tsx`.

## Diff

Reproduce with:
```
git diff ba8ef88..b5125aa      # Unit A
git diff b5125aa..91bf7ba      # Unit B
git diff origin/main..HEAD     # whole delivery
```

## Fast-gate results (all green)

| Phase | Evidence |
| --- | --- |
| Unit A gate | `pnpm typecheck` 0, `pnpm lint` 0, 11 test files / 102 tests pass; E2E `matches-registration-visual` 7 passed twice (non-leak), `matches-registration` 12 passed; zero owned fixture residue after teardown |
| Unit B F20 | `notifications.detail` + center + functions green; fail-before proven by reverting the condition |
| Unit B F21 | 5 files / 47 tests green (validators, functions, list, routes, discovery integration) |
| Unit B F23 | 3 files / 20 tests green; fail-before proven by reverting the call site |
| Unit B F24 | 10 integration tests green proving invited+out-of-range (list AND detail), plus 46 collateral; old-vs-new empirically compared |
| Unit B F25 | full matrix green: 12 viewport×theme×locale combos, both labels 44.00px height, wrap proven at 120px |
| Unit B F22 | `typecheck` 0, `lint` 0, 56 focused tests green |
| E2E regression fix | `matches-visual` 12 passed with zero skipped (serial chain unbroken), `matches-registration-visual` 7 passed |
| QA (full gate) | `pnpm complete-check` — **PASS**, all 8 stages green on HEAD `e9b6847` (db:types:check, build, knip, typecheck, lint, format:check, test 912/912, test:e2e 142/142) |

## Known deferred / documented items carried with this delivery

- F17 — accepted-state "View group" self-link kept as-is (design-approved frame Za6r4); resolved-by-design.
- F12 — cross-suite forced-notification trigger leak: inspection + suite runs show the scoping/`finally`/residue-probe fix present; no longer reproducible.
- F35 — `supabase/seed.sql` raise-notice string already correct; no edit warranted.
- F7 / F13 / F14 / F19 — documentation-only dispositions, no code change (`.pen` frame nits, verified-false-positive RLS advisory on the two internal registration tables, local pg_cron intentionally unscheduled).
- Newly reported by the F25 matrix work (pre-existing, NOT introduced here): the create-details page overflows to ~362px at a 320px viewport because the venue-photo file input has ~344px intrinsic min-content. Checkbox labels are not the driver. Candidate fix: `min-inline-size: 0` / `max-inline-size: 100%` on the file input or its grid track in `create-match.styles.ts`.
- Reported by the F21 test work (potential follow-up, not in this scope): `list_match_events`'s `caller_badge` is derived from the wall clock rather than from the supplied `p_as_of` snapshot.
