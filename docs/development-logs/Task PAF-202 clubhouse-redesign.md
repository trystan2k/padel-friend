---
title: PAF-202 Implement new Clubhouse design across app pages
type: development-log
permalink: docs/development-logs/task-PAF-202-clubhouse-redesign
---

# Development Log: PAF-202

## Metadata

- Task ID: PAF-202 (epic "P2 - Implement new Clubhouse design across app pages"; sub-issues PAF-206…PAF-229, 24 units)
- Date (UTC): 2026-11-20T17:47:00Z (delivery window 2026-11-19 through 2026-11-20)
- Project: padel-friend
- Branch: `feature/PAF-202-clubhouse-redesign`
- Commits: 26 total (git-verified range `7d4650b^..f842d6f`; the delivery summary said 25 but enumerates 26 hashes, confirmed by `git rev-list --count`), chronological:
  1. `7d4650b` — docs: reconcile clubhouse coverage and record owner decisions (U1)
  2. `8a552fb` — feat: migrate clubhouse design tokens and figtree typography (U2)
  3. `57036f2` — feat: adapt shared ui primitives to clubhouse design (U3)
  4. `350e216` — feat: implement clubhouse app shell and destination navigation (U4)
  5. `d9af33c` — feat: recompose home with clubhouse section order (U5)
  6. `af21c46` — feat: adapt auth and password recovery to clubhouse design (U6)
  7. `c012d8f` — fix: pin preview worker bindings to the e2e preview origin (U6 fix)
  8. `ed62fe4` — feat: adapt player onboarding to the clubhouse redesign (U7)
  9. `f10b498` — feat: adapt community discovery and invitations to clubhouse design (U8)
  10. `8789aac` — feat: establish community overview and ranking presentation (U9)
  11. `bf3946b` — feat: adapt community administration to clubhouse design (U10)
  12. `9c64bd7` — feat: adapt match lists to clubhouse design (U11)
  13. `4dd7524` — feat: adapt match details and registration to clubhouse design (U12)
  14. `e4e15d4` — feat: adapt match creation wizard to clubhouse design (U13)
  15. `c030b9e` — feat: adapt organizer management to clubhouse design (U14)
  16. `c12d7bc` — feat: adapt result recording to clubhouse design (U15)
  17. `c27fad1` — feat: adapt result decisions to clubhouse design (U16)
  18. `4af1f34` — feat: adapt leagues and standings to clubhouse design (U17)
  19. `9ab3885` — feat: separate me profile and rating journey (U18)
  20. `91f0808` — feat: adapt level reviews to clubhouse design (U19)
  21. `5fe9205` — feat: adapt statistics surfaces to clubhouse design (U20)
  22. `1ba6276` — feat: adapt notifications and pwa surfaces to clubhouse design (U21)
  23. `f90431b` — feat: adapt repair diagnostics to clubhouse design (U22)
  24. `671bb85` — feat: adapt public homepage and derive icons from source artwork (U23)
  25. `196c5f7` — fix: align result corrections with clubhouse frames and migrate legacy pins (U24)
  26. `f842d6f` — fix: address clubhouse review findings (review-loop fix round)
- Related: Linear epic PAF-202 (PadelFriend team/project), sub-issues PAF-206…PAF-229; design source of truth `docs/design/padel-friend-clubhouse.pen` (Pencil); one epic PR targeting `main`
- D1 round: 2026-11-20 evening → 2026-11-21 morning, same branch; commit `62b4d23` (includes the owner-modified `docs/design/padel-friend-clubhouse.pen` with all 10 previously-D1-blocked frame sets) plus the three D1 implementation groups.

## Objective

- Adapt every app page to the new Clubhouse visual language defined in `docs/design/padel-friend-clubhouse.pen`, preserving behavior contracts, i18n, accessibility, and truthful-data rules (D6).
- One commit per unit, one epic PR. Deliver within owner-approved scope: 10 frame-less surfaces blocked pending owner-designed frames (D1) — epic ships as approved partial scope.

## Implementation Summary

Owner decisions D1–D9 recorded 2026-11-19 in `docs/design/clubhouse-approval-matrix.md` and Linear comments, then applied across all units:

- **U1 (`7d4650b`)** — Coverage reconciliation; approval-matrix artifact committed.
- **U2 (`8a552fb`)** — Design tokens + Figtree typography (c1TsP light/dark), focus tokens added, PWA assets regenerated.
- **U3 (`57036f2`)** — Shared UI primitives: 52px controls, sentence-case chips, focus tokens applied.
- **U4 (`350e216`)** — App shell: 5-destination navigation (D9), new `/me` route (D5), suppression per D9.
- **U5 (`d9af33c`)** — Home recomposed to 5-section order; profile moved off Home.
- **U6 (`af21c46`)** — Auth + password recovery per 5-frame manifest; invite confirmation blocked (D1).
- **U6 fix (`c012d8f`)** — E2E preview Worker bindings: root cause — Wrangler loads `.dev.vars` before process env; build now writes explicit `dist/server/.dev.vars` pinned to the e2e preview origin.
- **U7 (`ed62fe4`)** — Onboarding (PdRtP + nested frames); legacy pin migrated.
- **U8 (`f10b498`)** — Community discovery/invitations (Qstxv/dSEX3) + notification-detail invitation states (iyZrO/MrHkt/ah9u1).
- **U9 (`8789aac`)** — NEW community overview/ranking routes on existing data (Ex7RD/y4Zeg, per D4); Ranking moved inside Community (D9); deep-link flash fixed.
- **U10 (`bf3946b`)** — Community admin: 6 frames; 2 real layout defects fixed via probe; macOS-only baseline caveat documented.
- **U11 (`9c64bd7`)** — Match lists: card order probes; D6 filters omitted truthfully.
- **U12 (`4dd7524`)** — Match details: 12-frame manifest; JLqMT authorized-reuse only (D3).
- **U13 (`e4e15d4`)** — Create wizard: touch-label wrap fix unblocked serial spec; team-mode radios kept.
- **U14 (`c030b9e`)** — Organizer management: 32 frame exports; certification migrated; `--space-24` undefined-token bug fixed.
- **U15 (`c12d7bc`)** — Result recording: route-specific fragments (D7); alZmm band migrated.
- **U16 (`c27fad1`)** — Result decisions: bottom-sheet dialogs, pill chips; CWJkF record-only.
- **U17 (`4af1f34`)** — Leagues/standings: former-participant re-bless documented; league index blocked (D1).
- **U18 (`9ab3885`)** — Me + rating journey (vARtQ/x2GG9U); admin entry relocated; stale links fixed.
- **U19 (`91f0808`)** — Level reviews (qWosG/OKYtp); history/queue/detail blocked (D1).
- **U20 (`5fe9205`)** — Statistics: 9 frames individually mapped; per-band raster evidence.
- **U21 (`1ba6276`)** — Notifications/PWA: 8 tracked checks resolved; SW/permission policies untouched.
- **U22 (`f90431b`)** — Repair diagnostics: 4 frames; 0% crops.
- **U23 (`671bb85`)** — Public homepage + logo AC#2: source-PNG-derived icons (D8) with provenance tests.
- **U24 (`196c5f7`)** — Certification: legacy-pin migration, lane split.
- **Review fix round (`f842d6f`)** — Statistics hierarchy restored (real data, D6-honest), nav ≥44px via horizontal scroll, frame-regions comparison infra, edit-flow dialog→page conversion per lJHUZ/t0SZec, manifest corrections.

Review loop (steps 6–7): 3 parallel reviews (code / architecture / UX-UI) produced 13 seeded findings + review findings; fix round addressed F5a, F2a, F15/F17, F18 (adjudicated with pen access; m7hh3 remapped; 5 accepted adaptations documented); F16 dismissed with evidence; F14 deferred (owner-approved partial scope). Ledger: `docs/plan/PAF-202-findings.md` (23 findings: 8 fixed, 3 dismissed, 1 deferred, 6 observed, rest context).

## D1 Round (2026-11-20 evening → 2026-11-21 morning)

The issue owner ran the supplied Pencil-agent prompt; all 10 previously-D1-blocked frame sets were verified present in `docs/design/padel-friend-clubhouse.pen` (light + dark + state variants; commit `62b4d23` includes the modified `.pen`). Three implementation groups landed on the same branch:

- **Group A (auth)** — `invite-confirmation` (+invalid/expired/busy), `claim-password` (+strong/error; new derived-only `PasswordStrength` from `getPasswordIssues`), `claim-verify` (structure-only: the app verifies via the emailed recovery link — the frames' six-digit-code flow does not exist and was NOT invented; 4 frames documented frame-only in `e2e/references/paf-202-d1-auth/manifest.json`). Behavior untouched: invite one-use POST/PKCE, claim rules, `startRecovery`.
- **Group B (notifications + level reviews)** — `notification-detail` generic + match-result/level-review outcome states (invitation branch from U8 untouched), `level-review-history`, `platform-review-queue`, `platform-review-detail` (+approve/deny-with-note as bottom-sheet AlertDialog preserving focus trap, stale-rating guard, offline rejection). Deny/Denied copy replaces Reject per frames. 18 exports, 56 region budgets.
- **Group C (privacy + leagues + profile)** — `privacy-policy` (public route preserved), `league-index`, `profile-edit` as its own screen with sticky Cancel/Save (theme/language staged until save via the new `AppPreferencesContext`), rating journey expanded/empty/error from real history (new `rating-chart.ts`), `data-app-chrome="hidden"` shell rule for the edit screen. 12 exports, 46 region budgets.
- **Certification closure** — `.pen` digest re-pinned in `paf-202-leagues`, `paf-202-result-decision`, `paf-202-public` manifests (owner's frames changed the file); 2 stale digest tests green; homepage lane 22/22.
- **Findings ledger** — F14 (architecture blocker) moved deferred → fixed; F4 dead-key cleanup landed (only `matches.results.preview` removed — `outcome.*` verified LIVE via dynamic lookups).

## Files Changed

- Design system: `design-tokens/` (clubhouse token set c1TsP light/dark, focus tokens, `--space-24` fix; built output under `design-tokens/dist/*.css` via `pnpm tokens:build`); Figtree typography; PWA icon/asset regeneration (U2, U23).
- Shared primitives: `src/components/` — 52px control sizing, sentence-case chips, focus-token application (U3).
- App shell + routing: `src/routes/` — 5-destination shell, new `/me` route, new community overview + ranking routes, deep-link flash fix (U4, U9, U18).
- Feature pages adapted per unit: home, auth/recovery, onboarding, community (discovery/invitations/overview/ranking/admin), match lists/details/creation, organizer management, result recording/decisions, leagues/standings, me + rating journey, level reviews, statistics, notifications/PWA surfaces, repair diagnostics, public homepage (U5–U23).
- Copy: `src/locales/` (en, pt-BR, es) for all adapted surfaces; truthful offline copy per D2; no hardcoded user-facing strings.
- Docs/artifacts: `docs/design/clubhouse-approval-matrix.md` (U1); `docs/plan/PAF-202-findings.md` (findings ledger); `docs/plan/PAF-229-gate-environment.md` (gate environment failure record); unit manifests citing `docs/design/padel-friend-clubhouse.pen` frames.
- Test infrastructure: frame-regions comparison infra (mask-free measurement, vacuous-pass prevention); per-unit scoped E2E specs; lane split for DB-backed statistics tests (U24, fix round).
- **D1 round (Group A, auth)**: `invite-confirmation` (+invalid/expired/busy states), `claim-password` (+strong/error), new derived-only `PasswordStrength` helper (`getPasswordIssues`), `claim-verify` structure-only page; frame-only manifest `e2e/references/paf-202-d1-auth/manifest.json` (4 code-entry frames documented frame-only).
- **D1 round (Group B, notifications + level reviews)**: `notification-detail` generic surface + match-result/level-review outcome states, `level-review-history`, `platform-review-queue`, `platform-review-detail` (approve/deny-with-note bottom-sheet AlertDialog; Deny/Denied copy). 18 exports, 56 region budgets.
- **D1 round (Group C, privacy + leagues + profile)**: `privacy-policy` (public route preserved), `league-index`, `profile-edit` as its own screen with sticky Cancel/Save; new `AppPreferencesContext` (theme/language staged until save); new `rating-chart.ts`; `data-app-chrome="hidden"` shell rule. 12 exports, 46 region budgets.
- **D1 round (certification + ledger)**: `.pen` digest re-pins in `paf-202-leagues`, `paf-202-result-decision`, `paf-202-public` manifests; `docs/plan/PAF-202-findings.md` (F14 deferred → fixed, F4 dead-key cleanup: `matches.results.preview` removed); design source `docs/design/padel-friend-clubhouse.pen` updated with owner frames (commit `62b4d23`).

## Key Decisions

- **D1** — 10 frame-less surfaces BLOCKED pending owner-designed frames (privacy, notification detail, level-review history, platform queue/detail, invite confirmation, claim password/verify, league index, profile edit/chart details); Pencil-agent prompt delivered. Epic ships as owner-approved partial scope.
- **D2** — Truthful offline copy across surfaces.
- **D3** — JLqMT authorized-reuse only; no unauthorized frame reuse.
- **D4** — Community overview/ranking are new routes on existing data (no new backend).
- **D5** — New `/me` route for profile.
- **D6** — Existing-field-or-unavailable: never fabricate data (applied to statistics hierarchy restoration and omitted match-list filters).
- **D7** — Route-specific frame precedence with confirmed candidates (applied in result recording fragments).
- **D8** — Logo variants derived from source PNG (no redrawn artwork), with provenance tests.
- **D9** — 5-destination shell; Ranking lives inside Community.
- **F18 adjudication** — Edit flows converted from dialogs to page flows per lJHUZ/t0SZec with behavior contracts preserved; m7hh3 remapped; 5 accepted adaptations documented.
- **F2a** — Nav overflow resolved via horizontal scroll to keep ≥44px touch targets.
- **F15/F17** — Frame-regions comparison infra built gated vs finding regions with mask-free measurement and vacuous-pass prevention.
- **Wrangler `.dev.vars` precedence fix** — bindings file written explicitly at build time because Wrangler loads `.dev.vars` before process env (root-caused, not patched around).

## Validation Performed

- **Fresh `pnpm complete-check`** (final gate): first run poisoned by mid-run test-DB restart — recorded as environment failure in `docs/plan/PAF-229-gate-environment.md`, then re-run clean:
  - static ✅
  - unit 4,923 → 4,924 tests (statistics lane split: 5 unit + 2 integration)
  - integration 43 parallel + 1,293 serial (ranked-publication fixture isolation fixed)
  - browser 449 + 140 (4 legacy-oracle failures → migrated + fixed)
- **Per-unit scoped E2E** (all green): 29/29 corrections, 47 level-reviews, 86 management, 90/90 frame-regions, 82/82 management final, 33/33 statistics, 72 homepage, 69/69 notifications, 25/25 home, 23/23 zoom probe.
- **Reviews**: 3 parallel reviews (code / architecture / UX-UI); 13 seeded findings + review findings triaged in `docs/plan/PAF-202-findings.md`.
- **Final-state gate**: CI on the epic PR + step-9 `pnpm complete-check` on the PR.
- **D1 round scoped lanes (all green)**: Group A 58 E2E + 65 vitest; Group B 102 E2E + 4,982 unit; Group C lanes + unit; stale-digest tests 15/15; homepage lane 22/22.
- **D1 frame verification**: all 10 previously-D1-blocked frame sets confirmed present in `docs/design/padel-friend-clubhouse.pen` (light + dark + state variants).
- **D1 round final gate (pending)**: full `pnpm complete-check` re-run pending as the step-9 gate on commit `62b4d23`.

## Risks and Follow-ups

- **D1 blocked surfaces (open)** — 10 frame-less surfaces await owner-designed frames; epic delivers as approved partial scope, not silent omission.
- **Provenance findings (open)** — 8 manifests cite supporting `.pen` copy; provenance findings remain open.
- **Safe-area/overlay matrix closure (open)** — documented, not closed.
- **F23 (open)** — 2px gutter inconsistency.
- **Dead locale keys (open)** — cleanup follow-up.
- **F14 (deferred)** — owner-approved partial scope deferral.
- **Wrangler `.dev.vars` precedence** — binding writes must stay explicit at build time; regression risk if build script changes.
- **DB-backed unit tests** — need lane classification (clean-stack reproducibility); statistics lane split is the established pattern.
- **Pencil MCP writes** — can flush the open pen.dev session (an accidental frame rename + re-save occurred during delivery; restored via git). Treat open pen sessions as fragile during automated writes.
- **macOS-only baselines** — CI tolerance check pending.
- **Statistics avatar photos** — need server/DTO change; currently D6-honest initials fallback; potential follow-up issue.
- **Management frame divergences** — documented as annotated findings, not silently accepted.
- **D1 round resolutions (2026-11-21)**: the 10 D1-blocked surfaces listed above are now implemented (Groups A/B/C — see D1 Round section); F14 moved deferred → fixed; F4 dead-key cleanup landed (`matches.results.preview` removed; `outcome.*` verified LIVE via dynamic lookups).
- **claim-verify code-entry frames frame-only (open)** — six-digit code verification does not exist in the app (emailed recovery link instead); implementing it would be new backend scope — owner decision if ever wanted. 4 frames documented frame-only in `e2e/references/paf-202-d1-auth/manifest.json`.
- **claim-password eye-toggle not adopted** — frames show a reveal toggle; submit-time validation kept instead.
- **invite-confirmation default state** — confirmation form is the default (truthful: nothing is accepted before the one-use POST).
- **profile-edit sticky bar 148px vs frame 88px** — documented adaptation (touch-target/safe-area sizing).
- **D1 round full gate pending** — `pnpm complete-check` re-run pending on commit `62b4d23`.

---

## Round 4 — Pre-merge design-fidelity remediation (2026-11-23)

### Metadata (Round 4)

- Task ID: PAF-202 (round 4 addendum; original epic + D1 round above)
- Date (UTC): 2026-11-23T17:26:53Z
- Project: padel-friend
- Branch: `feature/PAF-202-clubhouse-redesign`
- Commits (9, one per unit + fix round, chronological):
  1. `0efc998` — U1 (design-token defects F30/F31/F32 + systemic token guard F7)
  2. `b01ea0c` — U2 (F24 Home recomposition)
  3. `71675dd` — U3 (F25 match detail restyle + F27 route chrome)
  4. `04330d2` — U4 (F26 wizard steps 1–2 + F8 re-anchor)
  5. `41abefa` — U5 (F28/F5/F29/F42 statistics + meeting surfaces)
  6. `9ba254b` — U6 (F33 admin member actions bottom sheet)
  7. `8e9782a` — U7 (F34/F35/F36/F37/F38/F39/F40/F41/F45 batch)
  8. `2412272` — U8 (F46 orphan baseline cleanup)
  9. `735f14a` — fix round (F47/F48/F49/F50)
- Related: pre-merge audit findings ledger `docs/plan/PAF-202-findings.md` (F24–F50)

### Objective (Round 4)

- Owner-directed pre-merge design-fidelity audit (model: Opus 5.5 via `claude-agent/opus`, user-named model override) reviewed every app screen against its frame in `docs/design/padel-friend-clubhouse.pen`; verdict: rework-required, 23 new findings F24–F46 seeded in the ledger. Remediate to frame fidelity before merge, honoring owner interview decisions, without regressing behavior contracts, i18n, a11y, or truthful-data rules (D6).

### Implementation Summary (Round 4)

Trigger + owner decisions (interview):

- Decisions: RESTYLE F25/F26/F33; SUPPRESS F36 bottom nav; ADOPT F39 Me tiles; CONFIRM ADOPT F28/F5; execution approved.

Units (one commit each):

- **U1 (`0efc998`)** — F30 collapsed visibility radio (undefined `--space-22`), F31 undefined `--color-amber-ink`, F32 default fieldset borders (league + level-review styles), F7 systemic guard: `test/design-tokens.inventory.test.ts` scans every `var(--…)` in `src` vs `tokens.css` (allowlist: exact `--anchor-width` only). Red-before/green-after proven.
- **U2 (`b01ea0c`)** — F24 Home recomposed to hKncV/AlfRD: pill switcher, 48px bell + real unread badge, light level card with true rank (`rankedMembers` denominator, never fabricated), green next-match tile, attention rows; OdU52 sheet variant recorded as manifest adaptation.
- **U3 (`71675dd`)** — F25 match detail restyled to eYIgj family (TopBar, 132px photo, chips, 28/800 venue, stats strip, roster order, one sticky CTA per eligible state, no invented CTAs) + F27 chip-overlap fixed via `data-route-chrome` on wizard/edit/statistics + shared TopBar foundation + `e2e/route-chrome.ts`. Gap-closer: matches-results family 84/84.
- **U4 (`04330d2`)** — F26 wizard steps 1–2 rebuilt (Base UI segmented/RadioGroup, Ranked switch, weekend date presets, vAxZh format/registration/level-range from REAL fields; false "no source" manifest claim corrected; validation routing to first-invalid-owning-step) + F8 measured re-anchor (0.19 was a stale comment). Gap-closer: wizard-adjacent 107/107.
- **U5 (`41abefa`)** — F28/F5 statistics frame hierarchy ADOPT (o9iaC1), F29 player tiles + W/L squares (real draw semantics), F42 meeting rows as cards (no h-scroll table); D6-honest (competitive share validated by server invariant; unavailable on zero).
- **U6 (`9ba254b`)** — F33 admin member actions as route-driven Base UI bottom sheet over live list (layout-route background, `shouldReload: false`, per-role rows from existing ops only, history vs deep-link close semantics).
- **U7 (`8e9782a`)** — F34/F40 truthful counts (no page-size-as-total, admin-gated pending read), F35 leave-dialog treatment, F36 bottom-nav suppressed on 7 nested routes, F37 border token, F38 TopBar on 15+ hosts, F39 Me tiles (one `getPlayerStatistics` read), F41 fused card meta + ENn8Q budget corrected (mask artifact, signed off), F45 discovery back + Finish; U6 residual proven (52-row load-more + scroll survive sheet open; no background roster re-read).
- **U8 (`2412272`)** — F46: 9 orphan baselines verified + deleted (audit's count of 4 was low), owning specs 53/53 green.

Delta review (3 reviewers parallel, range `60a649b..2412272`):

- Architecture + code both found F47 (reload retains roster-origin history flag → `back()` instead of Members replace-nav); UX found F48 (match-detail hero had no rendered-vs-Pencil gates — "screenshots: none") + F49 (missing 320px pt-BR "Compartilhar" probe).

Fix round (`735f14a`):

- F47 module-scoped origin flag (red by revert-proving, both paths E2E-covered).
- F48 gated fo8Zn regions (topBar 0.0314/0.045, stats 0.0833/0.10, actionBar 0.0919/0.11, measured budgets).
- F49 320px pt-BR probe (bounds/non-overlap/≥44px/no-overflow).
- F50 NEW product defect caught by the F48 gate: MatchCompetitionBadge `<p>` default margins inflated hero chips row (~51px vs 24px) AND MatchCard badge rows (~32px) — root-fixed via shared `s.chips` margin reset, ENn8Q re-baselined scoped, heroChip/heroTitle flipped to gated (y=0 / −1.06px).
- Stats-strip 65.3-vs-76px documented as token-based density adaptation (owner-informable).

### Files Changed (Round 4)

- Findings ledger: `docs/plan/PAF-202-findings.md` (F24–F46 seeded by audit; F47–F50 added via delta review/fix round; ledger state at log time: all fixed/closed except F43/F44 optional-observed + F10/F21 legacy observations).
- Test infrastructure: `test/design-tokens.inventory.test.ts` (U1 systemic `var(--…)` guard); `e2e/route-chrome.ts` (U3 shared route-chrome helper); F48 gated fo8Zn regions + measured budgets; F49 320px pt-BR probe spec; F46 nine orphan baselines deleted after verification.
- Visual manifests: ENn8Q budget corrected (F41 mask artifact, signed off) then re-baselined scoped (F50); OdU52 sheet variant recorded as manifest adaptation (U2); false "no source" claim corrected (U4).
- Surfaces per unit (enumerated in the 9 commits): home (U2); match detail + shared TopBar foundation + wizard/edit/statistics route chrome (U3); create-wizard steps 1–2 (U4); statistics hierarchy + player tiles + meeting rows (U5); admin member-actions route-driven bottom sheet (U6); counts/leave-dialog/border token/TopBar hosts/Me tiles/discovery back+Finish (U7); fix round F47–F50 changes.

### Key Decisions (Round 4)

- Owner adjudications applied: RESTYLE F25/F26/F33; SUPPRESS F36 (bottom nav suppressed on 7 nested routes); ADOPT F39 (Me tiles, one `getPlayerStatistics` read); CONFIRM ADOPT F28/F5 (statistics frame hierarchy o9iaC1).
- D6-honest statistics: competitive share validated by server invariant; rendered as unavailable on zero — never fabricated.
- Truthful data throughout: Home true rank uses `rankedMembers` denominator (never fabricated); wizard vAxZh sections built from REAL fields with the false "no source" manifest claim corrected; F34/F40 counts never use page-size-as-total (admin-gated pending read).
- F47 root cause: `history.state` survives reload — SPA origin/mode flags must live in module memory when close behavior must distinguish fresh entry vs reloaded entry.
- F48 closed the match-detail hero gate gap with measured budgets; the new gate immediately caught F50, validating the rendered-vs-Pencil gate approach.
- F50 root-fixed (shared `s.chips` margin reset on reused styled `<p>`), not masked; ENn8Q re-baselined scoped; heroChip/heroTitle flipped to gated (y=0 / −1.06px).
- Stats-strip 65.3-vs-76px documented as token-based density adaptation (owner-informable), not treated as a defect.
- F46 deletions only after verification: 9 orphan baselines (audit's count of 4 was low), owning specs re-run green.

### Validation Performed (Round 4)

- U1 token inventory guard proven red-before/green-after.
- Gap-closer lanes: matches-results family 84/84 (U3); wizard-adjacent 107/107 (U4); U8 owning specs 53/53 after baseline deletion.
- U6 residual proof: 52-row load-more + scroll survive sheet open; no background roster re-read.
- F47 red by revert-proving; both paths E2E-covered. F49 probe asserts bounds/non-overlap/≥44px/no-overflow at 320px pt-BR.
- Delta review: 3 parallel reviewers (architecture / code / UX) over `60a649b..2412272`.
- All git hooks green per commit (9 commits).
- Environment note (not a regression): scoped `vitest related` pulled DB-touching integration files that failed while the test stack was mid-restart; verified 5/5 with stack up.
- Pending at log time: final `pnpm complete-check` on the push state.

### Risks and Follow-ups (Round 4)

- Final gate pending: branch ahead 9 commits (`0efc998`…`735f14a`); `pnpm complete-check` on the push state still to run.
- Open ledger items carried: F43/F44 (optional, observed); F10/F21 (legacy observations).
- Learnings (standing guidance):
  - `history.state` survives reload — SPA origin/mode flags must live in module memory when close behavior must distinguish fresh entry vs reloaded entry.
  - Browser-default margins on reused styled `<p>` elements silently inflate layout rows — the token guard catches undefined vars but not default-margin bugs; frame-relative pixel gates do.
  - Scoped `vitest related` can pull DB-touching integration files that fail when the test stack is mid-restart — environment, not regression.
  - Serena MCP availability fluctuated across sessions (some sessions: output uncapturable or `execute` missing) — native fallback used with disclosure; file-mutation deviations disclosed per round.
- Stats-strip density adaptation (65.3 vs 76px) — inform owner.

### CI validation round (2026-11-23, post-remediation)

- Re-certification gate on repair commit `976119d` PASS (12/12 stages, 656/656 e2e; 4 previously-failing tests green).
- Push `976119d` → CI run 45241566522 red on `e2e (visual-1)` ONLY: 5 deterministic matches-management breaches (~0.005 ratio), everything else green including all functional lanes.
- Forensics (with CI artifacts) found THREE layered causes → findings F51/F52: (1) 3 stale mac baselines still showed pre-U3 chrome; (2) datetime-local text is browser-locale dependent (mac vs Linux formats from identical DOM — root-fixed with `locale: 'en-US'` in playwright.config, same class as the earlier focus-ring fix); (3) proven glyph-only FreeType/CoreText rounding residue on structurally-identical DOM → per-frame `-linux` baselines from CI actuals + `baselineName()` fallback (global platform template rejected — would orphan hundreds of snapshots). F3-era "text rasterizes identically" claim corrected: false for long text runs.
- Fix commit `d8ca8fb` → full local gate PASS (5091 unit + 1296 integration + 656 e2e, zero locale fallout, mac lane correct on non-linux variants). Learnings: browser-default margins and locale-dependent native controls are renderer-divergence classes the token guard cannot catch; frame-relative gates + CI artifacts (actual/diff downloads) are the diagnostic loop that works.
- Board: PAF-202 + 14 round-4 children → In Review. Copilot re-request unverifiable (3 attempts, known repo quirk; Codex connector is the working reviewer).

### Round 5 — Round-2 audit fix round (2026-11-24)

- Round-2 Opus 5.5 re-audit (owner-directed) verdict: not pixel-perfect — 19 findings F53–F71 seeded in the ledger (2 majors: admin nav over sheet z-index + WCAG focus-obscuring exposure; wizard step-3 selection never painted via StyleX marker/:has mismatch).
- Owner decisions: execute all required/related + class-guard probes; F67 ALIGN TO FRAME (invited Accept/Decline into sticky bar, no Join); F69 HIDE invite sentence; F70 CONSOLIDATE Me into one 3-column card; F71 cheap nits only.
- Fix units:
  - R5-U1: 12 spot fixes.
  - R5-U2: TopBar adoption wizard/relationships/notifications, F67 slot-portal CTA table, F70 Me card — frame-driven correction: Settings action on notifications INDEX per cAqsQ.
  - 2b: segmented ink, ranking avatar, pill truncation.
  - R5-U3 (F66 baseline sweep): 6 already current + 4 re-captured with fixed chrome verified visible; NEW class guards: route-chrome-matrix.spec 19 routes × assertChipsStepAside + assertNoUaFieldsetBorders, both red-proven; -linux manifest recording.
  - 3b: league detail TopBar + mark — frame ywfn7 verified, gap the matrix itself caught, ywfn7 perceptual diff 0.
- Learnings: StyleX defaultMarker must live on the input when using :has selectors; ::-webkit-meter-* UA gradients override backgroundColor without backgroundImage:'none'; class-guard matrices (data-driven route lists) catch what per-fix probes miss — the matrix found league detail on its first run.
- Validation: commits 76d8aec (76 files); scoped lanes green throughout; final complete-check + CI pending at log time.
