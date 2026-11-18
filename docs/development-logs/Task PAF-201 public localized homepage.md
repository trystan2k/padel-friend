---
title: PAF-201 Public localized homepage
type: development-log
permalink: docs/development-logs/task-PAF-201-public-localized-homepage
---

# Development Log: PAF-201

## Metadata

- Task ID: PAF-201 — "Public localized homepage" (single Linear issue, no children; Linear PadelFriend project)
- Date (UTC): 2026-11-18
- Project: padel-friend
- Branch: `feature/PAF-201-public-homepage` (base `main`)
- Commits (5, conventional, no Linear IDs in subjects/bodies):
  - `0b2322c` — U1: six approved Pencil frames exported as pixel references (+ SHA-256 provenance recorded on the Linear issue)
  - `2bb716d` — U2: public homepage implementation (route, feature, i18n, teardown retarget, unit tests)
  - `338b67a` — U3: e2e contract gates, visual spec, calibration; full-review baseline
  - `9b944be` — fix round 1 (F1 tokenized line heights, F2 default-teardown regression tests, F3 round 1 claims-error boundary)
  - `54d6354` — fix round 2 (F3 round 2: claims-lookup catch-all → guest + safe diagnostic; orchestrator direct)
- Design references: `e2e/references/paf-201/` (six Pencil exports + `manifest.json` provenance)
- Context sources: `docs/plan/PAF-201-findings.md` (review findings ledger F1–F3, all `fixed`); Linear issue comment `c6dafecd` (frame IDs + export SHA-256s recorded before implementation)
- Deployment target: app.padelfriend.es — repository prerequisite for Google OAuth publication (privacy policy link from a real public homepage)

## Objective

- Replace the `/` redirect-to-login with a public, localized product homepage on app.padelfriend.es: Pencil design first (approved frames as pixel references), then implementation to the app quality bar (semantic tokens, i18n en/es/pt-BR, a11y, responsive 320–1280).
- Serve as the repository prerequisite for Google OAuth publication: the privacy policy must be reachable from a real public homepage.
- Fully regression-prove the redirect-contract change: root route behavior for guest + authenticated users, sign-out/identity teardown destinations, PWA online/offline behavior, and pixel/geometry/keyboard fidelity against the approved frames.

## Implementation Summary

- **U1 / design (`0b2322c`) — approved Pencil frames as pixel references:** six frames in `docs/design/padel-friend.pen` exported at scale 1 via Pencil MCP to `e2e/references/paf-201/`: mobile light `FswwZ` (390×1080), mobile dark `JzVIa` (390×1080), mobile signed-in `eIW0i` (390×1019), es `aebnS` (390×1142), pt-BR `Jt31N` (390×1142), and 320-es fluid check `R91tQr` (320×1219). SHA-256s + frame IDs recorded on the Linear issue (comment `c6dafecd`) BEFORE implementation (issue prerequisite). User-approved decisions: all six frames = ONE reference family; root locale/theme controls stay on the page and only the two chip rectangles are masked in pixel comparison; desktop = centered bounded single column with no desktop baseline frame.
- **U2 / implementation (`2bb716d`):** `src/routes/index.tsx` — redirect removed; public loader via `getPublicHomepageAuthenticated()` (`createServerFn`, boolean-only claims check, `private, no-store`). New `src/features/public-homepage/`: `PublicHomepage.tsx` (header/main/footer landmarks, one `h1`, three feature cards, guest CTAs → `/login` + `/onboarding/account`, signed-in dashboard CTA, plain `<a href="/privacy">`, mailto via `PRIVACY_CONTACT_EMAIL`), `public-homepage.styles.ts` (StyleX + semantic tokens, 320–1280 responsive), `public-homepage.functions.ts`. i18n: `publicHomepage` key group added in en/es/pt-BR (parity tested against raw resources); es/pt-BR copy transcribed from the approved frames; `auth.welcomeBrand` + `auth.privacyLink` reused. Sign-out/identity teardown now navigate to `/login` directly (`PlayerProfile.tsx`, `use-auth-identity-guard.ts`) since `/` no longer redirects (commented in code). Unit tests: `public-homepage.functions.test.ts` + `public-homepage.ui.test.tsx` (new), `auth.routes.test.ts` updated (root stays `/` for guest+auth, no `beforeLoad`).
- **U3 / gates + calibration (`338b67a`):** `e2e/home.spec.ts` — redirect contract replaced: `maxRedirects: 0`, 200, no `Location`, `private`+`no-store`+`Vary`, SSR lang/H1/hrefs, Accept-Language precedence + cookie precedence, hydration agreement, `watchBrowserErrors`, locale selector, guest CTA walks; login typography pinned to `/login`. `e2e/onboarding.spec.ts` — sign-out asserts `/login` directly. `e2e/pwa.spec.ts` — `/` online 200 + no-store + dashboard-CTA-only, no CacheStorage `/` entry, offline root → `/offline.html`. New `e2e/public-homepage-visual.spec.ts` (22 cases): 6 frame pixel comparisons with masked-chip baselines derived from Pencil exports via `deriveMaskedPng` (never Chromium), `manifest.json` provenance (frame IDs, export+baseline SHA-256s, mask rects, allowances, calibration record), signed-in fixture case, 14 geometry cases (320/390/600/768/1280 × es/pt-BR × themes), 2 keyboard/focus cases (skip link, chips, CTAs, `/privacy`, mailto; visible ring ≥2px ≥3:1 in both themes). Calibration (macOS Chromium): measured ratios 0.720%–2.181% → allowances 0.0100–0.0245 (measured + 0.05pp rounding + 0.25pp headroom); residuals = text antialiasing fractional-y + secondary CTA stroke coverage. Calibration exposed U2 layout drift that was fixed: wordmark block display, title line-height 1.15, card text 1.45, footer rhythm (24px above divider, 8px below/between, real 44px rows), CTA outside box-shadow stroke. Open item: no local Linux measurement; CI E2E on the PR is the Linux evidence path.
- **Review loop:** full review (code + architecture + UX/UI) on `338b67a` produced 3 findings (evidence in `docs/plan/PAF-201-findings.md`):
  - **F1 — UX/UI: untokenized line heights (1.15 / 1.45).**
  - **F2 — code: default teardown destination untested.**
  - **F3 — architecture: thrown invalid-claims errors break the homepage.**
  - **Fix round 1 (`9b944be`):** snug/comfortable line-height primitives added to `design-tokens/primitives.tokens.json` (F1); default-teardown regression tests (`DefaultProbe`) (F2); claims-error try/catch with message matcher + `toClientError` (F3 round 1). Static hook `check:server-errors` rejected the raw rethrow → corrected to the sanctioned boundary.
  - **Delta round 1:** UX approve; code + architecture flagged an F3 residual — auth-js `decodeJWT` `SyntaxError` escapes the message matcher.
  - **Fix round 2 (`54d6354`, orchestrator direct):** claims-lookup catch-all → guest + safe `emitDiagnostic('request.failure','failure',{code:'OPERATION_FAILED',source:'server-function'})`; matcher removed; client-creation errors still propagate (`requireAuthenticatedClient` convention). Tests: `SyntaxError` → false, transient fetch failure → false, `Invalid alg` claim → false, missing env → propagates.
  - **Delta round 2:** code verdict approve. All findings `fixed` in `docs/plan/PAF-201-findings.md`.

## Files Changed

- Design references: `e2e/references/paf-201/*.png` (6 Pencil exports); `e2e/references/paf-201/manifest.json` (frame IDs, SHA-256s, mask rects, allowances, calibration record).
- Visual e2e: `e2e/public-homepage-visual.spec.ts` (new, 22 cases); `e2e/public-homepage-visual.spec.ts-snapshots/*.png` (6 masked baselines).
- Contract e2e: `e2e/home.spec.ts` (redirect contract replaced); `e2e/onboarding.spec.ts` (sign-out asserts `/login`); `e2e/pwa.spec.ts` (root online/offline PWA behavior).
- Route + feature: `src/routes/index.tsx` (redirect removed, public loader); `src/features/public-homepage/PublicHomepage.tsx` (landmarks, cards, CTAs, privacy link, mailto); `src/features/public-homepage/public-homepage.styles.ts` (StyleX + semantic tokens, 320–1280); `src/features/public-homepage/public-homepage.functions.ts` (`getPublicHomepageAuthenticated`).
- i18n: `src/locales/{en,es,pt-BR}/translation.json` (`publicHomepage` key group; reused `auth.welcomeBrand` + `auth.privacyLink`).
- Auth teardown: `src/features/player/PlayerProfile.tsx`, `src/lib/use-auth-identity-guard.ts` (teardown → `/login` directly).
- Design tokens: `design-tokens/primitives.tokens.json` (snug/comfortable line-height primitives, F1).
- Tests: `test/public-homepage.functions.test.ts` (new); `test/public-homepage.ui.test.tsx` (new); `test/auth.routes.test.ts` (root contract guest+auth, no `beforeLoad`); `test/auth.identity-guard.test.tsx` (default-teardown regressions, F2).

## Key Decisions

- **Design-first, evidence-pinned workflow:** six approved Pencil frames exported BEFORE implementation, with SHA-256s + frame IDs recorded on the Linear issue (comment `c6dafecd`) as the issue prerequisite; all six frames treated as ONE reference family.
- **Masked-chip comparison:** root locale/theme controls stay visible and interactive on the page; only the two chip rectangles are masked in pixel comparison — pixel fidelity without hiding live controls.
- **Mobile-first with bounded desktop:** desktop renders a centered bounded single column; no desktop baseline frame exists, so desktop coverage comes from geometry cases (up to 1280) rather than pixel comparison.
- **Baselines from Pencil, never Chromium:** masked baselines derived from Pencil exports via `deriveMaskedPng`; `manifest.json` records frame IDs, export+baseline SHA-256s, mask rects, allowances, and the calibration record for provenance.
- **Measured allowances with justified headroom:** allowance = measured ratio + 0.05pp rounding + 0.25pp headroom (0.0100–0.0245 against measured 0.720%–2.181%); residuals attributed to text antialiasing fractional-y + secondary CTA stroke coverage.
- **Root becomes public — teardown retargets:** since `/` no longer redirects, sign-out/identity teardown navigates to `/login` directly (commented in code); auth route tests pin root as `/` for guest+auth with no `beforeLoad`.
- **Boolean-only authenticated check, uncacheable:** `getPublicHomepageAuthenticated()` returns a boolean only, via `createServerFn` with `private, no-store` — no authenticated response data crosses to the client and nothing is cached.
- **Public homepage fails open to guest:** claims-lookup errors/invalid claims resolve to guest + a safe `emitDiagnostic('request.failure','failure',{code:'OPERATION_FAILED',source:'server-function'})` (F3 round 2) — a broken auth service must not break the public homepage; client-creation errors still propagate per the `requireAuthenticatedClient` convention.
- **Tokenized typography only:** the F1 fix replaced raw 1.15/1.45 line heights with snug/comfortable primitives in `design-tokens/primitives.tokens.json` (no hardcoded design values).
- **Localized copy from approved frames:** es/pt-BR copy transcribed from the approved frames; key parity tested against raw resources; existing `auth.welcomeBrand`/`auth.privacyLink` reused instead of duplicated keys.

## Validation Performed

- **Per-unit fast gates green** on every unit's code state.
- **Unit tests:** 37/37 on the final state (`public-homepage.functions`, `public-homepage.ui`, `auth.routes`, `auth.identity-guard`, incl. F2 `DefaultProbe` regressions and F3 round 2 cases: `SyntaxError` → false, transient fetch failure → false, `Invalid alg` claim → false, missing env → propagates).
- **Visual e2e:** 22/22 cases on the final state (6 masked-chip frame comparisons + signed-in fixture case + 14 geometry cases + 2 keyboard/focus cases).
- **Review loop:** full review on `338b67a` → F1 (UX/UI), F2 (code), F3 (architecture); fix round 1 `9b944be`; delta round 1 → UX approve, code+architecture F3 residual; fix round 2 `54d6354`; delta round 2 → code approve. All findings `fixed` in `docs/plan/PAF-201-findings.md`.
- **Static lanes:** three pre-commit static lanes green on the fix commits; `check:server-errors` enforced the sanctioned server-error boundary (caught the round-1 raw rethrow).
- **Pending at log time:** full `pnpm complete-check` reserved for the final delivery state per the single-run policy (each gate ran once per code state).

## Risks and Follow-ups

- **No approved risks; no follow-up issues created.**
- **Linux/CI visual calibration confirmation:** allowances were measured locally on macOS Chromium with justified headroom; no local Linux measurement exists — CI E2E on the PR is the Linux evidence path for the calibration record.
- **Full `pnpm complete-check` pending at log time** on the final state (single-run policy); per-unit gates all green as recorded above.
