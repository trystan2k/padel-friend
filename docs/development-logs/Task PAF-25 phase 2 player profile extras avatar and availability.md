---
title: PAF-25 Phase 2 player profile extras — avatar in onboarding, availability preferences (private contact decision-out)
type: development-log
permalink: docs/development-logs/task-PAF-25-phase-2-player-profile-extras-avatar-and-availability
---

# Development Log: PAF-25

## Metadata

- Task ID: PAF-25
- Date (UTC): 2026-11-12
- Project: padel-friend
- Branch: `feature/PAF-25-phase-2-player-profile-extras` (base `origin/main` @ `7ddd72a`)
- Commits:
  - `6e2fa47` — `feat: add optional avatar selection during onboarding` (14 files, +999/−104)
  - `8c5b3aa` — `feat: add optional player availability preferences` (26 files, +1718/−29)
  - `4239a9f` — `fix: address review findings` (13 files, +620/−48)
  - Total: 30 files, +3284/−128
- Linear: PAF-25 — "Phase 2 — Player profile extras: avatar in onboarding, availability, private contact"
- Product-owner decisions (2026-11-12, Linear comment `0c1d8ec7` + `docs/plan/PAF-25-findings.md`): avatar in onboarding APPROVED; availability as weekdays + time-of-day buckets APPROVED; private contact SKIPPED (decision-out — deliberately not implemented, recorded on the ticket)

## Objective

- Deliver the approved Phase 2 player-profile extras on top of the existing onboarding/claim flow: (1) optional avatar selection during onboarding working on both the direct-create and claim paths, and (2) optional player availability preferences (weekdays + time-of-day buckets) persisted owner-only and editable in the profile. Private contact was explicitly scoped out by product decision and is not implemented.
- Findings ledger: `docs/plan/PAF-25-findings.md` (F0–F6, all closed).

## Implementation Summary

### Unit 1 — Avatar in onboarding (commit `6e2fa47`)

- Flow: local file select → create/claim profile commit → storage upload → existing `completeAvatarUpload` finalize → shared continuation (`continueAfterProfile` with fail-closed password lookup).
- Upload deferred until after the profile/claim commit: provisional-actor storage RLS blocks pre-claim uploads, so the avatar step runs after profile identity is established.
- New `src/features/player/avatar-upload.ts`: owner-scoped storage upload with UUID filename and `upsert: false`; new `OnboardingAvatar.tsx` (initials fallback, labeled file input, explicit skip, object-URL cleanup) mounted after display name, before the CTA.
- Works on direct + claim paths; the claim is never replayed for image failures; retry and continue-without-photo recovery paths covered.
- Ambiguous outcomes (tab close, network drop mid-upload) reconciled via `reconcileAvatarUpload` — owner-authenticated key-identity verdicts `same` / `none` / `conflict`; `completeAvatarUpload` extended with an atomic `expectedPreviousKey` guard (0 rows updated → `AVATAR_CONFLICT`), making finalize compare-and-swap.
- Existing `AvatarUpload.tsx` (profile-edit path) refactored onto the shared helper; its props, finalize behavior, and CAS semantics unchanged.
- New Phase-2 visual baseline `e2e/auth-visual.spec.ts-snapshots/player-setup-phase2.png`, budget 0.025 (macOS-estimated; Linux CI to validate).

### Unit 2 — Availability preferences (commit `8c5b3aa`)

- Migration `supabase/migrations/20261112090000_player_availability.sql`: nullable `text[]` columns `preferred_playing_days` (MON..SUN) and `preferred_playing_times` (MORNING/AFTERNOON/EVENING); named CHECK constraints (NULL/`{}` allowed via coalesce-wrapped 3VL-safe checks; 1-D arrays, no NULL elements, ≤7 days / ≤3 times); column-scoped UPDATE grant; zero policy changes (owner-only visibility resolved as AC5 at planning — findings F0).
- Two SECURITY INVOKER transactional wrapper RPCs `onboard_player_with_availability` / `claim_provisional_player_with_availability` delegating to the unchanged original RPCs (advisory-lock idempotence, exactly-one-row, rollback on constraint failure preserved); EXECUTE granted to `authenticated` only.
- Domain module `src/features/player/player-availability.ts`: canonical constants, strict normalizers, empty-array → NULL, omit-vs-clear semantics.
- Validators + server functions switched to the wrapper RPCs; `PROFILE_FIELDS`/sporting profile typed projection extended with the availability columns.
- Shared `src/features/player/AvailabilityFields.tsx`: two labeled fieldsets, native checkboxes with always-rendered 1em ✓ slot (identical geometry in both states — non-color state signal). Mounted in onboarding as a trailing card near bio AFTER the CTA; wired into profile edit + read-mode with a not-provided state.
- i18n en/pt-BR/es throughout. `docs/design/onboarding-fields.md` finalized: P2 DONE, P3 DONE, P4 SKIPPED (decision-out).

### Review loop (commit `4239a9f` + two prior fix iterations)

- Full review (code + architecture + UX/UI in parallel) surfaced 4 findings: F1 (major) avatar-retry key ambiguity; F2 (major) ambiguous claim commit; F3 (minor) visual probe gaps; F4 (minor) indicator reflow.
- 3 fix iterations with delta re-reviews after each. Round 2 caught the reconcile→finalize race + NOT_PENDING-doesn't-prove-commit + password-bypass — fixed with the atomic `expectedPreviousKey` CAS, authoritative `profileExists()` check, and unified continuation. Round 3 fixed the test-double CAS oracle, the controls-column gap probe, and an UNAUTHENTICATED swallow (now a login redirect), plus conflict-focus management.
- Final verification: all findings RESOLVED, review clean. Ledger `docs/plan/PAF-25-findings.md` F0–F6 all closed.
- Final gate `pnpm complete-check`: **all 11 stages PASS on run 1** — build/static/knip + 3,796 unit + 1,240 integration (1 planned skip) + 545 E2E tests, 0 failures, 0 flaky (~34 min). Delivered as PR #54 (`feature/PAF-25-phase-2-player-profile-extras`, 4 commits through `088167e`); CI static/unit/GitGuardian green at open, integration + e2e lanes pending at report time.

## Files Changed

Grouped by sub-task (per-commit mapping from git):

### Unit 1 — Avatar (`6e2fa47`)

- `src/features/player/avatar-upload.ts` (new — owner-scoped storage upload, UUID filename, `upsert: false`, reconcile verdicts)
- `src/features/player/OnboardingAvatar.tsx` (new — onboarding avatar step: initials fallback, labeled input, skip, object-URL cleanup)
- `src/features/player/AvatarUpload.tsx` (refactored onto shared helper; props/finalize/CAS unchanged)
- `src/features/player/PlayerOnboarding.tsx` (avatar step mounted after display name, before CTA)
- `src/features/player/player-ui.styles.ts` (avatar step styles)
- `e2e/auth-visual.spec.ts` + `e2e/auth-visual.spec.ts-snapshots/player-setup-phase2.png` (new Phase-2 visual baseline, budget 0.025)
- `test/player.onboarding-avatar.test.tsx` (new)
- `test/player.provisional-claim.test.tsx`, `e2e/onboarding.spec.ts`, `e2e/matches-provisional.spec.ts`, `src/locales/{en,es,pt-BR}/translation.json` (updated)

### Unit 2 — Availability (`8c5b3aa`)

- `supabase/migrations/20261112090000_player_availability.sql` (new — text[] columns, named CHECKs, column-scoped UPDATE grant, wrapper RPCs)
- `src/features/player/player-availability.ts` (new — canonical constants, strict normalizers, empty→NULL, omit-vs-clear)
- `src/features/player/AvailabilityFields.tsx` (new — shared two-fieldset checkbox UI)
- `src/features/player/player.functions.ts`, `player.server.ts`, `player.validators.ts` (wrapper RPC switch, typed projection, validation)
- `src/lib/supabase/database.types.ts` (regenerated types)
- `src/features/player/PlayerProfile.tsx` (profile edit + read-mode not-provided state)
- `test/player.availability.test.tsx`, `test/player.availability.integration.test.ts` (new); `test/player.integration.test.ts`, `test/player.onboarding-status.test.ts`, `test/player.profile.rating.test.tsx`, `test/player.validators.test.ts`, `test/release-rehearsal.scripts.test.ts` (updated)
- `e2e/onboarding.spec.ts`, `e2e/matches-provisional.spec.ts`, `e2e/auth-visual.spec.ts`, `src/locales/{en,es,pt-BR}/translation.json`, `src/features/player/PlayerOnboarding.tsx`, `player-ui.styles.ts`, `test/player.onboarding-avatar.test.tsx`, `test/player.provisional-claim.test.tsx` (extended for availability)
- `docs/design/onboarding-fields.md` (finalized: P2 DONE, P3 DONE, P4 SKIPPED decision-out)

### Review fixes (`4239a9f`)

- `src/features/player/player.functions.ts`, `player.validators.ts`, `AvailabilityFields.tsx`, `PlayerOnboarding.tsx`, `player-ui.styles.ts` (atomic `expectedPreviousKey` CAS, `profileExists()` authoritative commit check, unified `continueAfterProfile`, login redirect instead of UNAUTHENTICATED swallow, ✓-slot geometry fix)
- `e2e/auth-visual.spec.ts` (controls-column gap probe)
- `test/player.availability.test.tsx` (real CAS oracle instead of test-double), `test/player.onboarding-avatar.test.tsx`, `test/player.onboarding-status.test.ts`, `test/player.provisional-claim.test.tsx`
- `src/locales/{en,es,pt-BR}/translation.json`

## Key Decisions

- Avatar upload deferred until after profile/claim commit — provisional-actor storage RLS blocks pre-claim uploads; ambiguous outcomes reconciled with owner-authenticated key-identity verdicts plus an atomic compare-and-swap finalize.
- Two nullable `text[]` columns over jsonb or composite types — simple, indexable later, enforceable with named CHECKs.
- Transactional wrapper RPCs instead of modifying the original RPC bodies — preserves the claim lock-ordering fixes already shipped; wrappers are SECURITY INVOKER, `authenticated`-only EXECUTE.
- Owner-only availability visibility — community exposure is out of ticket scope (AC5 resolved at planning, findings F0); zero RLS policy changes.
- Native checkboxes over Base UI Checkbox — follows the repo's radio precedent; non-color state signal via always-rendered 1em ✓ slot + border (identical geometry both states, no indicator reflow).

## Validation Performed

- Per-unit fast gates, then full `pnpm test` after each unit: unit 258 files / 3767+ tests, integration 124 files — green.
- Affected e2e lanes green after each unit: onboarding, matches-provisional, auth-visual 9/9.
- `db:reset` → `db:types` → `db:types:check` clean.
- Pre-commit hooks green on all 3 commits.
- Review loop: full parallel review (code + architecture + UX/UI) → 4 findings → 3 fix iterations with delta re-reviews → all findings RESOLVED, final verification clean. Ledger F0–F6 closed.
- Final `pnpm complete-check` gate executed at delivery close; result recorded in the delivery report.

### Review Findings

- F1 (major) avatar-retry storage-key ambiguity and F2 (major) ambiguous claim commit: fixed via atomic `expectedPreviousKey` finalize, authoritative `profileExists()` check, unified `continueAfterProfile` (rounds 1–2).
- F3 (minor) visual probe gaps: controls-column gap probe added (round 3). F4 (minor) indicator reflow: always-rendered ✓ slot (round 1).
- Round-2 delta re-review additionally caught: reconcile→finalize race, NOT_PENDING-doesn't-prove-commit, password-bypass — all fixed. Round-3 delta re-review additionally caught: test-double CAS oracle, UNAUTHENTICATED swallow — fixed (login redirect instead).
- Process note: one protocol deviation — a specialist used `sed -i` once for a test-title rename (content verified green post-hoc, recorded in audit); agents otherwise operated via Serena MCP.

## Risks and Follow-ups

- New visual baseline `player-setup-phase2.png` budget (0.025) is macOS-estimated — awaits Linux CI validation; widen only with diff evidence.
- Original `onboard_player` RPC retains its `service_role` EXECUTE grant (pre-existing, untouched by this task).
- Storage objects can orphan if a tab closes mid-upload (existing no-delete storage policy, unchanged); `reconcileAvatarUpload` covers recovery on next visit, but orphans are not garbage-collected.
- Availability not yet surfaced to community members — owner-only by product decision; future feature if wanted.
- Private contact (P4) is decision-out — deliberately not implemented; revisit only if the product owner re-opens it.
