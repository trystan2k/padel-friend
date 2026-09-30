---
title: PAF-1 T01 Authenticate and onboard an app-wide player
type: development-log
permalink: docs/development-logs/task-paf-1-t01-authenticate-and-onboard-an-app-wide-player
---

# Development Log: PAF-1

## Metadata

- Task ID: PAF-1 (T01 — Authenticate and onboard an app-wide player)
- Phase 1: 2026-09-28 — original delivery.
- Project: padel-friend
- Branch: feature/PAF-1-t01-authenticate-and-onboard-an-app-wide-player
- Phase 1 commit: `75d8e34` (full hash `75d8e34c99ba0eb32c63d9c34a95e64dd10515b7`), merged as PR #1 / `de79fdf`.
- Phase 2: 2026-09-30 — reopened at HEAD `2d762cb`; all Phase 2 work uncommitted.
- Linear: epic **PAF-1 reopened**; sub-issues **PAF-18…PAF-24**.

## Objective

- Deliver the full authentication and onboarding vertical slice: Supabase auth boundary (Google OAuth PKCE retained + email/password), an app-wide blocking onboarding gate, app-wide `player_profiles` + `global_player_ratings` with owner-only RLS, an atomic `onboard_player` RPC, private avatar storage, profile view/edit UI, scaffold (notes example) removal, and en/pt-BR/es i18n with Pencil-aligned tokenized UI.
- Reopen objective (Phase 2): fix `/login`, which rendered the register/account form instead of the design’s “Login — signed-out entry” Welcome screen; extract reusable journey UI; and add `/onboarding/account` as onboarding step 1.

## Implementation Summary

- **Auth boundary**: `/login` supports Google OAuth PKCE (retained) plus email/password; `auth.callback.ts` completes the PKCE exchange; `src/features/auth/return-path.ts` centralizes post-auth redirect targets; `auth.server.ts` encapsulates server-side Supabase auth access.
- **Phase 1 continuity**: original PAF-1 delivery provided Supabase Google OAuth/PKCE with SSR session handling, player onboarding (name, side, 0–7 level), reliability initialized at 10%, profile view/edit, and RLS boundaries; merged via PR #1 (`de79fdf`).
- **Onboarding gate**: `_protected.tsx` layout blocks all protected routes until a player profile exists; unauthenticated/un-onboarded users are routed to `/onboarding`; completion lands on `/dashboard`.
- **Data layer**: migration `20260928000000_player_profiles_and_ratings.sql` creates app-wide `player_profiles` and `global_player_ratings` with owner-only RLS on profiles and deny-by-default rating writes; `SECURITY DEFINER` idempotent `onboard_player` RPC persists display name, side, initial level, optional dominant hand, and optional bio in one transaction; `database.types.ts` regenerated.
- **Avatar storage**: private `player-avatars` Storage bucket with owner-path policies, short-lived signed URLs for reads, and compare-and-swap avatar finalization. No object deletion happens in the request path (neither server nor browser): eager cleanup was removed because it cannot be coordinated atomically with avatar writes, which allowed a deletion race; orphaned objects are deferred to a future garbage-collection task.
- **Profile UI**: profile view/edit where level is never editable after onboarding; avatar upload with deterministic initials fallback; all screens Pencil-aligned using design tokens only.
- **Scaffold cleanup**: notes example removed (code, UI, `e2e/notes.spec.ts` deleted; `StarterCard` repurposed); historical migration `20260925000000_notes.sql` intentionally kept.
- **i18n**: all user-visible strings through i18next in en, pt-BR, es; SSR locale agrees with hydration, no singleton i18next on server.
- **Design/token work**: Pencil↔token parity review; added missing tokens (`space-15`, `space-17`, `green-deep`, `hero-copy`, `hero-muted`, `hero-label`, `hero-accent`, `hero-divider`, `hero-avatar`); reused existing tokens elsewhere; Inter/Manrope later self-hosted via `@fontsource/inter` + `@fontsource/manrope`.
- **CI**: `.github/workflows/ci.yml` provisions a local Supabase backend, fails loud on empty/non-loopback env values, and the integration suite hard-fails in CI without a loopback backend.
- Evolved through several review-fix rounds (code, architecture, UX/UI); all rounds captured above represent the final reworked state, not just the first attempt.

## Files Changed

- Auth: `src/features/auth/auth.server.ts` (new), `src/features/auth/return-path.ts` (new), `src/routes/login.tsx`, `src/routes/auth.callback.ts`, `test/auth.callback.test.ts`, `test/auth.return-path.test.ts`, `e2e/auth-return.spec.ts`
- Onboarding/gate: `src/routes/onboarding.tsx` (new), `src/routes/_protected.tsx`, `src/routes/_protected.dashboard.tsx`, `src/features/player/PlayerOnboarding.tsx`, `test/player.onboarding-status.test.ts`, `e2e/onboarding.spec.ts`
- Data/RLS: `supabase/migrations/20260928000000_player_profiles_and_ratings.sql` (new), `src/lib/supabase/database.types.ts`, `src/features/player/player.server.ts`, `src/features/player/player.functions.ts`
- Domain logic: `src/features/player/player.validators.ts`, `src/features/player/rating-config.ts`, `src/features/player/player-initials.ts`, `test/player.validators.test.ts`, `test/player.rating-config.test.ts`, `test/player.integration.test.ts`
- Profile UI: `src/features/player/PlayerProfile.tsx`, `src/features/player/AvatarUpload.tsx`, `src/features/player/player-ui.styles.ts`, `test/player-ui.styles.test.ts`
- Scaffold cleanup: `src/features/notes/notes.functions.ts` (deleted), `e2e/notes.spec.ts` (deleted), `src/components/StarterCard.tsx`, `supabase/migrations/20260925000000_notes.sql` (kept, untouched)
- i18n: `src/locales/en/translation.json`, `src/locales/es/translation.json`, `src/locales/pt-BR/translation.json` (covered by existing `test/i18n.test.ts`)
- Design/tokens/fonts: `design-tokens/primitives.tokens.json`, `design-tokens/semantic.tokens.json`, `src/styles.css`, `src/routes/__root.tsx`, `package.json`, `pnpm-lock.yaml`
- CI/docs: `.github/workflows/ci.yml`, `docs/plan/Plan PAF-1 T01 — Authenticate and onboard an app-wide player.md`, `README.md`, `ARCHITECTURE.md`, `INITIAL_SETUP.md`
- Excluded (pre-existing, NOT part of PAF-1): `opencode.json` (engram command path), `.opencode/agents/subagents/bug-fixer-specialist.md` (model switch)

## Key Decisions

- `SECURITY DEFINER` idempotent `onboard_player` RPC: guarantees atomic profile + initial rating creation regardless of RLS ordering; idempotency makes onboarding retry-safe.
- Deny-by-default rating writes + owner-only profile RLS: ratings are system-managed, never client-writable.
- Level immutable after onboarding: single write path is the onboarding RPC; edit UI hides level entirely.
- Private avatar bucket + short-lived signed URLs instead of a public bucket. Avatar finalization uses a compare-and-swap update; avatar objects are never deleted in the request path (eager server/browser cleanup removed after review found a read-then-delete race), so orphaned objects are intentionally left for a future GC task.
- Self-hosted Inter/Manrope via Fontsource: no third-party font request, deterministic SSR rendering.
- Level validation divides `tenths / 10` instead of `tenths * 0.1` to avoid IEEE-754 tenths drift.
- StyleX: use border longhands — StyleX silently drops the `border` shorthand.
- Removed the unlayered global `font: inherit` (it overrode StyleX CSS layers); token font families are set per control instead.
- URL fragments never reach SSR: return-path handling cannot rely on fragment data server-side.
- Design tokens must cover every design value; if none fits, ask the design owner rather than hardcoding.
- Historical `20260925000000_notes.sql` kept: never rewrite applied migration history.

## Validation Performed

- `pnpm complete-check`: passes 7/7 stages — Vitest 80 tests / 8 files; Playwright 16 tests; coverage thresholds 80/80/80/80 unchanged (never lowered).
- CI workflow verified to provision local Supabase and hard-fail on empty/non-loopback env values; integration suite hard-fails in CI without a loopback backend.
- Code review: final pass `accept` — no blocking/major issues, no unresolved minors.
- Architecture review: final pass `accept` — the single major (avatar deletion race) was eliminated by removing all request-path object deletion.
- UX/UI review: final pass `accept` — zero findings (fonts, contrast, gaps, overflow, i18n verified at 390×844 in en/pt-BR/es × light/dark).
- One intervening red e2e run was diagnosed as a stale `vite preview` holding port 4173 (Playwright reuses an existing server); after killing it and rebuilding, the suite passed 16/16 in 13.6s. Not a product regression.

## Reopen — Phase 2 (2026-09-30)

### Implementation Summary

- **Shared journey UI**: added eight reusable primitives under `src/components/ui/`: `Button`, `TextField`, `PasswordField`, `SurfaceCard`, `HeroCard`, `StepBadge`, `OrDivider`, and `AccountPrompt`. Components use Base UI 1.7 and StyleX semantic tokens, co-located styles, typed StyleX override props, and accessible labels.
- **Welcome screen**: rebuilt `/login` in `src/features/auth/LoginWelcome.tsx` and `src/routes/login.tsx` to match “Login — signed-out entry”: Google-first sign-in, OR divider, email/password fields, LOG IN action, and a real `Create account` link carrying sanitized `next`. SSR form stays inert until hydration.
- **Account onboarding**: added public `/onboarding/account` in `src/routes/onboarding_.account.tsx` and `src/features/auth/AccountSignup.tsx`. The route is deliberately not nested under guarded `/onboarding`; TanStack’s trailing-underscore opt-out keeps it at the root and it defines its own guard matrix.
- **Player setup**: reconciled `PlayerOnboarding.tsx` and `player-ui.styles.ts` to frame `PdRtP`, step 2 of 3; added onboarding-only caption inset and accessible effective targets of at least 44px.
- **Tokens, copy, and guidance**: added 28px font-size and 1.5px letter-spacing tokens plus `--color-on-hero`; updated en/pt-BR/es translations, removed dead keys, and kept user-visible copy out of components. Propagated design-fidelity policy to `AGENTS.md` and `.opencode/agents/**`; updated `ARCHITECTURE.md`.

### Files Changed

- Status notation from the Phase 2 worktree snapshot: `M` modified, `A` added to the index, `AM` added to the index and further modified in the worktree, `??` untracked. These changes were uncommitted at HEAD `2d762cb`.
- **UI primitives + styles**: `src/components/ui/AccountPrompt.tsx` (`AM`), `Button.tsx` (`AM`), `HeroCard.tsx` (`AM`), `OrDivider.tsx` (`A`), `PasswordField.tsx` (`A`), `StepBadge.tsx` (`A`), `SurfaceCard.tsx` (`AM`), `TextField.tsx` (`AM`); `account-prompt.styles.ts` (`A`), `button.styles.ts` (`A`), `or-divider.styles.ts` (`A`), `step-badge.styles.ts` (`A`), `surface-card.styles.ts` (`A`), `text-field.styles.ts` (`A`).
- **Auth features**: `src/features/auth/AccountSignup.tsx` (`AM`), `LoginWelcome.tsx` (`AM`), `account-signup.styles.ts` (`AM`), `login-welcome.styles.ts` (`AM`), `navigate.ts` (`A`).
- **Routes**: `src/routes/__root.tsx` (`M`), `login.tsx` (`M`), `onboarding_.account.tsx` (`A`).
- **Player setup**: `src/features/player/PlayerOnboarding.tsx` (`M`), `player-ui.styles.ts` (`M`).
- **Locales**: `src/locales/en/translation.json`, `src/locales/es/translation.json`, `src/locales/pt-BR/translation.json` (all `M`).
- **Design tokens**: `design-tokens/primitives.tokens.json` (`M`), `design-tokens/semantic.tokens.json` (`M`).
- **Unit and integration tests**: `test/auth.account-signup.test.ts` (`A`), `test/auth.login-welcome.test.ts` (`A`), `test/auth.routes.test.ts` (`A`), `test/player-ui.styles.test.ts` (`M`), `test/ui.account-prompt.test.ts` (`AM`), `test/ui.button.test.ts` (`A`), `test/ui.cards.test.ts` (`A`), `test/ui.or-divider.test.ts` (`A`), `test/ui.password-field.test.ts` (`A`), `test/ui.step-badge.test.ts` (`A`), `test/ui.text-field.test.ts` (`AM`), `test/e2e-png-mask.test.ts` (`??`).
- **E2E specs and visual assets**: `e2e/auth-return.spec.ts` (`M`), `e2e/auth-visual.spec.ts` (`AM`), `e2e/home.spec.ts` (`M`), `e2e/onboarding.spec.ts` (`M`), `e2e/auth-helpers.ts` (`??`), `e2e/png-mask.ts` (`??`); `e2e/auth-visual.spec.ts-snapshots/account-adapted.png` (`A`), `e2e/auth-visual.spec.ts-snapshots/login-welcome.png` (`A`), `e2e/auth-visual.spec.ts-snapshots/player-setup.png` (`AM`); `e2e/references/paf-1/account-adapted.png` (`A`), `e2e/references/paf-1/account.png` (`A`), `e2e/references/paf-1/login-welcome.png` (`A`), `e2e/references/paf-1/player-setup.png` (`A`), `e2e/references/paf-1/manifest.json` (`??`).
- **Docs, agent guidance, and configuration**: `ARCHITECTURE.md` (`M`), `AGENTS.md` (`M`), `.agents/skills/tanstack-start-architecture/SKILL.md` (`M`); `.opencode/agents/epic-delivery-orchestrator.md`, `prd-planning-orchestrator.md`, `task-delivery-orchestrator.md`, and `subagents/architecture-review-specialist.md`, `bug-fixer-specialist.md`, `code-review-specialist.md`, `git-specialist.md`, `implementation-specialist.md`, `qa-gate-specialist.md`, `testing-automation-specialist.md`, `ux-ui-reviewer-specialist.md` (all `M`); `docs/plan/PAF-20-account-design-deviation.md` (`A`), `PAF-21-player-setup-design-deviation.md` (`A`), `PAF-24-visual-findings.md` (`AM`), `Plan PAF-1 T01 — Authenticate and onboard an app-wide player.md` (`M`); `package.json` (`M`), `pnpm-lock.yaml` (`M`), `playwright.config.ts` (`M`), `vitest.config.ts` (`M`).

### Key Decisions

- Reopened PAF-1 on its existing branch. Phase 2 scope: Welcome, account step 1, and rewiring; community step 3 remains deferred to PAF-2.
- Extracted only journey components needed now; full reusable-component inventory remains backlog.
- Kept email + password (no magic link) as an approved adaptation of design frame `EGb2g`. Email confirmation stays OFF.
- Kept step badges in “OF 3” format and account CTA as “CREATE ACCOUNT”.
- Verified visual fidelity with Playwright against Pencil frame exports. Used symmetric masks, direct probes proven with ±1px perturbations, and per-screen budgets. Parity judged against original frames plus the approved adapted account reference.

### Validation Performed

- `pnpm complete-check`: GREEN — build, knip, typecheck, lint, format:check, 24 test files / 238 unit tests, 34/34 E2E tests (visual gate 6/6); coverage 100% against unchanged 80% thresholds.
- Visual comparison against budgets: Welcome 2.94% / 3.3%, Account 1.67% / 1.9%, Player 2.67% / 2.8%.
- All review majors fixed. UX verdict: “acceptable to ship, gate meaningful.” Final minor/nit review follow-ups applied.

### Risks and Follow-ups

- Documented and accepted cross-renderer font rasterization residuals; email + password adaptation versus the design’s magic-link frame; empty initial player name/side because the design shows sample data (masked symmetrically); 40px painted controls with 44px effective targets; and approximately 2.5px vertical residual on the Welcome Google CTA.
- PAF-2 owns community step 3. Full reusable-component inventory remains backlog.

## Risks and Follow-ups

- Avatar object garbage collection is deferred: replaced avatars leave orphaned private objects until a future cleanup task. Needs a coordinated, race-safe retirement strategy (e.g. a trusted GC job or a non-reselectable key invariant).
- Test infrastructure: `playwright.config.ts` reuses an existing server on port 4173 (`reuseExistingServer: !process.env.CI`), so a leftover `vite preview` silently serves a stale bundle and causes false failures. Consider `reuseExistingServer: false` or a pre-flight port check.
- `pnpm-lock.yaml` changes accompany the Fontsource additions; confirm lockfile integrity in CI.
