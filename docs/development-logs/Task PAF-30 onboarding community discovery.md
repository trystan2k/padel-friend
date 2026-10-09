---
title: PAF-30 Onboarding community discovery step search join request create skip visual gate
type: development-log
permalink: docs/development-logs/task-PAF-30-onboarding-community-discovery
---

# Development Log: PAF-30

## Metadata

- Task ID: PAF-30
- Date (UTC): 2026-10-07
- Project: padel-friend
- Branch: `feature/PAF-30-onboarding-community-discovery` (stacked on `origin/feature/PAF-29-join-flows` @ `8dd7c2f`)
- Commit: `20eb289` — `feat: add community discovery onboarding step` (plus review-fix commits to come)
- Linear: PAF-30 — "PAF-2.5 — Onboarding step 3: /onboarding/community discovery screen" (parent PAF-2 / T02)

## Objective

- Onboarding step 3: `/onboarding/community` discovery screen (Pencil `dSEX3`) with search, JOIN / REQUEST TO JOIN, CREATE A COMMUNITY (Pencil `JO4DC`), and I'LL DO THIS LATER → `/dashboard`, wired to the PAF-2 server functions, with en/pt-BR/es i18n and a Playwright visual gate.
- Plan: `docs/plan/Plan PAF-30 PAF-2.5 — Onboarding community discovery screen.md`; findings ledger: `docs/plan/PAF-30-findings.md`; context bundle: `docs/plan/PAF-30-bundle.md`.

## Implementation Summary

- New root-level route `src/routes/onboarding_.community.tsx`: auth/profile guard before loader; search/view validation; loader resolves discovery vs create view.
- New `src/features/community/CommunityOnboarding.tsx` + `community-onboarding.styles.ts` (token-only StyleX).
- Discovery view: search (name OR city via regex-escaped `imatch`), policy-aware JOIN vs REQUEST TO JOIN (`joinCommunity`), skip, pagination, empty/error/retry states.
- Create view: name, Public/Private (Base UI radios), optional description/city → `createCommunity` (Public → instant, Private → admin_approval); creator becomes initial Admin.
- `PlayerOnboarding` post-save redirect → `/onboarding/community`; `__root` classifies the route as an auth journey; i18n keys added in en/pt-BR/es; `vitest.config.ts` test glob widened to `*.test.{ts,tsx}` (not a threshold change).
- Tests: new `test/community.onboarding.test.tsx`; updated `test/auth.routes.test.ts`, `test/community.discovery.functions.test.ts`, `test/community.integration.test.ts`; new `e2e/community-onboarding.spec.ts` + Pencil-derived references/baselines; updated `e2e/onboarding.spec.ts`, `e2e/auth-return.spec.ts`, `e2e/auth-password-reset.spec.ts`.
- Related tasks: parent PAF-2; builds on PAF-29 (join flows).

## Files Changed

- `src/routes/onboarding_.community.tsx` (new — root-level route, auth/profile guard, loader for discovery vs create)
- `src/features/community/CommunityOnboarding.tsx` (new — discovery + create screens)
- `src/features/community/community-onboarding.styles.ts` (new — token-only StyleX)
- `src/features/player/PlayerOnboarding.tsx` (post-save redirect → `/onboarding/community`)
- `src/routes/__root.tsx` (route classified as auth journey)
- `src/i18n/` + `src/locales/` (en/pt-BR/es keys)
- `vitest.config.ts` (test glob widened to `*.test.{ts,tsx}`)
- `test/community.onboarding.test.tsx` (new)
- `test/auth.routes.test.ts`, `test/community.discovery.functions.test.ts`, `test/community.integration.test.ts` (updated)
- `e2e/community-onboarding.spec.ts` (new) + Pencil-derived references/baselines (new)
- `e2e/onboarding.spec.ts`, `e2e/auth-return.spec.ts`, `e2e/auth-password-reset.spec.ts` (updated)

## Key Decisions

- Cards adapted: member counts and skill ranges omitted (no public read-model); cards show name, city, join policy. Member-count read-model is a tracked follow-up.
- Search extended to name OR city_label.
- PR size overage accepted (UI unit, one PR).
- Visual gate: Pencil-derived references; create full-screen tolerance 11.77% (measured 11.621%) with an independent upper-region gate 7.37% (measured 7.218%) because the required ≥44px optional inputs force a +43px downstream shift vs `JO4DC`; discovery 3.57% (measured 3.419%). UX/UI reviewer accepted the adaptation and the tolerance.

## Validation Performed

- `pnpm test:e2e` → 51/51 passing.
- Focused unit/integration → 22/22 passing.
- `pnpm test` → 312 tests green.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check` — all green.
- Visual tolerances tightened; structural probes pass; Pencil-derived provenance retained.

### Review Findings

- Fixed across 3 fix iterations: F1 (query-keyed remount → stable identity + edit-revision/history-origin draft sync), F2 (join retry after failure), F3–F5 (Pencil visual fidelity: search styling, card-action borders/REQUEST color, visibility fill/weights), F11 (pagination error survives retry), F12 (create state survives Back/re-entry), F13 (history-navigation draft restoration).
- Deferred: F6 (SSR locale assertion), F7 (visual comparator dimension validation), F8 (search/retry pending feedback), F9 (persistent optional-field labels), F10 (masked card structural probes).

## Risks and Follow-ups

- F6–F10 deferred (follow-up issue).
- Member-count read-model deferred (separate follow-up).
- Linux/CI visual residual still to be measured.
