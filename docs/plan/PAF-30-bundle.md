# PAF-30 Context Bundle

## Scope

- **Issue:** PAF-30 — PAF-2.5 — Onboarding step 3: /onboarding/community discovery screen (first UI unit)
- **Parent:** PAF-2 (T02)
- **Branch:** `feature/PAF-30-onboarding-community-discovery` (STACKED on `origin/feature/PAF-29-join-flows` @ `8dd7c2f`; PR targets the PAF-29 branch)
- **Unit of work:** PAF-30 itself (single unit)
- **Commit:** `20eb289` — `feat: add community discovery onboarding step`
- **Plan file:** `docs/plan/Plan PAF-30 PAF-2.5 — Onboarding community discovery screen.md`

## Acceptance criteria

1. `/onboarding/community` renders `dSEX3` structure (search, JOIN / REQUEST TO JOIN cards, CREATE A COMMUNITY, I'LL DO THIS LATER) using design tokens; no hardcoded colors/copy.
2. JOIN = instant join on instant-join public communities; REQUEST TO JOIN = pending on approval-policy communities.
3. CREATE A COMMUNITY opens the `JO4DC` path; success makes the creator initial Admin.
4. I'LL DO THIS LATER → `/dashboard`; profile save redirects to step 3.
5. Guards: unauthenticated → `/login`; profile incomplete → `/onboarding`; skippable.
6. All visible strings translated (en/pt-BR/es); SSR locale matches hydration.
7. Unit + E2E + Playwright visual gate with documented tolerance for `dSEX3`/`JO4DC`.

## Approved decisions

- **Cards adapted — member counts and skill ranges omitted** (no public read-model field). Cards show name, city, join policy. A member-count read-model is a tracked follow-up.
- **Search extended to name OR city_label**, matching the placeholder.
- **PR size overage accepted** (this unit is one PR; ~1601 changed lines).

## Changed files (23, incl. 4 PNGs)

Key: `src/routes/onboarding_.community.tsx` (NEW), `src/features/community/CommunityOnboarding.tsx` (NEW), `src/features/community/community-onboarding.styles.ts` (NEW), `src/features/community/community.functions.ts`, `src/routes/__root.tsx`, `src/features/player/PlayerOnboarding.tsx`, `src/locales/{en,es,pt-BR}/translation.json`, `test/community.onboarding.test.tsx` (NEW), `test/auth.routes.test.ts`, `test/community.discovery.functions.test.ts`, `test/community.integration.test.ts`, `vitest.config.ts`, `e2e/community-onboarding.spec.ts` (NEW) + 2 baselines + 2 Pencil references, `e2e/onboarding.spec.ts`, `e2e/auth-return.spec.ts`, `e2e/auth-password-reset.spec.ts`, plan doc.

`git diff --shortstat origin/feature/PAF-29-join-flows..HEAD` → `23 files changed, 1583 insertions(+), 18 deletions(-)` (PNGs are binary).

## Full diff

```
git diff origin/feature/PAF-29-join-flows..HEAD
```

New UI files must be read directly: `src/features/community/CommunityOnboarding.tsx`, `community-onboarding.styles.ts`, `src/routes/onboarding_.community.tsx`.

### Notable non-UI deltas

- `community.functions.ts`: `listPublicCommunities` search now `name.imatch."<escaped>",city_label.imatch."<escaped>"` via `.or(...)` with regex-metacharacter escaping + quoting.
- `PlayerOnboarding.tsx`: post-save `window.location.assign('/dashboard')` → `'/onboarding/community'`.
- `__root.tsx`: added `/onboarding/community` to the auth-journey path list.
- `vitest.config.ts`: test include glob `*.test.ts` → `*.test.{ts,tsx}` (for the new component test). NOT a coverage-threshold change.

## Fast-gate / visual result (green)

- `pnpm test:e2e` ✅ 49/49 (includes live-search focus regression)
- Focused route/community unit/integration ✅ 60/60
- `pnpm test` ✅ 308/308; typecheck, lint, format:check ✅
- Visual gate tolerances (`threshold: 0.1`): create full-screen 11.77% (measured 11.621%), create upper-region 7.37% (measured 7.218%), discovery 3.57% (measured 3.419%). The create full-screen cap covers the required ≥44px optional inputs and the exact +43px downstream shift; the separate upper-region gate guards upstream layout. Pencil-derived references + pinned digests retained; no app-rendered baselines.

## Review scope

- `code-review-specialist` — always.
- `architecture-review-specialist` — `src/routes`, `src/features`, config changed.
- `ux-ui-reviewer-specialist` — UI files changed (REQUIRED for this unit).

## Notes for reviewers

- The card adaptation (no counts/skill ranges) is an approved decision, not a defect.
- The high create-screen tolerance is driven by the ≥44px accessibility minimum vs the `JO4DC` frame's smaller controls — the UX/UI reviewer must judge whether this is a justified, visually-equivalent adaptation or a masked structural defect.
- `e2e/auth-password-reset.spec.ts` was touched for fixture stabilization though not in the plan — verify it is benign.
- `vitest.config.ts` changes only the test glob.
