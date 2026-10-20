---
title: PAF-87 Community Pagination and Locale Correctness
type: development-log
permalink: docs/development-logs/task-PAF-87-community-pagination-and-locale-correctness
---

# Development Log: PAF-87

## Metadata

- Task ID: PAF-87 (epic; children PAF-60 and PAF-56)
- Date (UTC): 2026-10-20
- Project: padel-friend
- Branch: `feature/PAF-87-community-pagination-and-locale-correctness` (base `origin/main` @ `3d6a39c`, HEAD `d08faa2`)
- Commits (in order):
  - `1924fdc` fix: guard request pagination across loader refreshes
  - `2a631e3` fix: recover locale preferences and enlarge language controls
  - `c2ee72a` fix: address review findings
  - `d08faa2` test: rebase visual baselines for the taller locale control

## Objective

- Deliver epic PAF-87 covering two correctness fixes in the community admin area:
  - PAF-60 — request pagination freshness: stale page responses from superseded loader refreshes must not overwrite newer data.
  - PAF-56 — locale persistence correctness plus a ≥44px locale control in the header.

## Implementation Summary

- PAF-60 (request pagination freshness):
  - The requests route (`src/routes/_protected.community.$communityId.admin.requests.tsx`) now publishes an explicit dataset generation; each fetched page is tagged with the generation that requested it (`src/features/community/community-admin.types.ts`).
  - Generation-scoped page ownership with monotonic request ids: only pages belonging to the latest generation are committed to state.
  - Success/catch/finally handlers are guarded so late resolutions from superseded generations cannot mutate current state; in-flight work is invalidated on unmount.
  - Pagination busy state is tracked separately from mutation busy state, so paging no longer fights request approve/reject mutations.
  - Rendering handled in `src/features/community/CommunityAdminViews.tsx`.
  - Tests: new `test/community.requests-route.test.tsx` plus regressions in `test/community.admin-ui.test.tsx`.
- PAF-56 (locale persistence + control sizing):
  - `src/routes/__root.tsx` now tracks the persisted locale preference and performs a corrective save inside the serialized save queue after the latest save failure, so a failed write is recovered instead of silently diverging from the active locale.
  - Regressions in `test/root.locale.test.tsx` cover save-overlap, non-en ordering, and recovery failure paths.
  - New `src/root.styles.ts` provides a token-derived (no hardcoded literals) locale select with ≥44px touch target at all viewports (user-approved).
  - E2E keyboard/focus/sizing/cookie probes added in `e2e/community-admin.spec.ts`.
- Review round (fixes in `c2ee72a`):
  - F1 — lost pagination/mutation interlock: restored the interlock that the earlier busy-state split had dropped.
  - F2 — weak keyboard/focus oracle: replaced with a strict outline-only oracle so focus visibility cannot pass via incidental styles.
- Full-gate visual fallout (resolved in `d08faa2`):
  - The approved taller header shifted page content 20px down, breaking 7 Playwright baselines.
  - Measurement showed 10 self-baselined captures over budget and 3 Pencil-derived screens 0.005 over.
  - User explicitly approved rebasing the self-baselined captures and raising three budgets by exactly 0.005 (0.375→0.38, 0.385→0.39, 0.225→0.23), with manifest provenance re-pinned.

## Files Changed

- PAF-60 requests route:
  - `src/routes/_protected.community.$communityId.admin.requests.tsx` (dataset generation publication, guarded handlers, unmount invalidation, pagination busy separation)
  - `src/features/community/community-admin.types.ts` (generation-scoped page types, monotonic request ids)
  - `src/features/community/CommunityAdminViews.tsx` (view handling of generation-scoped pages)
- PAF-56 locale persistence and control:
  - `src/routes/__root.tsx` (persisted-preference tracking, corrective save in serialized queue)
  - `src/root.styles.ts` (new — token-derived ≥44px locale select styles)
- Unit/integration tests:
  - `test/community.requests-route.test.tsx` (new — route pagination guard coverage)
  - `test/community.admin-ui.test.tsx` (regressions)
  - `test/root.locale.test.tsx` (regressions: overlap, non-en ordering, recovery failure)
- E2E and visual gates:
  - `e2e/community-admin.spec.ts` (keyboard/focus/sizing/cookie probes; strict outline-only focus oracle; inline SHA-256 provenance pins for `e2e/references/paf-31/` Pencil references)
  - `e2e/matches-visual.spec.ts` (three per-screen budgets raised 0.375→0.38, 0.385→0.39, 0.225→0.23; manifest provenance re-pin)
  - `e2e/community-admin.spec.ts-snapshots/` and `e2e/matches-visual.spec.ts-snapshots/` (rebased baseline captures for the taller header; 7 captures per session record)
- Note: exact per-file A/M/D statuses from `git diff --name-status 3d6a39c..HEAD` could not be captured at log time (shell denied in the logging sandbox); all paths above were verified to exist via read-only glob checks.

## Key Decisions

- Generation-scoped page ownership with monotonic request ids chosen over ad-hoc staleness checks — explicit tagging makes superseded responses provably non-committable.
- Pagination busy separated from mutation busy (PAF-60), then the interlock between the two restored explicitly after review finding F1.
- Corrective locale save executed inside the existing serialized queue rather than a parallel path, preserving ordering guarantees after a save failure.
- Taller locale control accepted as a deliberate UI change; the resulting 20px content shift is intentional, so baselines were rebased rather than the control shrunk (user-approved ≥44px target at all viewports).
- Visual budget policy preserved: only self-baselined captures were rebased, the three Pencil-derived budgets were raised by the measured minimum (exactly 0.005), provenance hashes were re-pinned, and structural/layout probes were left exact — a wider pixel budget still cannot mask a structural defect.

## Validation Performed

- `pnpm complete-check`: 8/8 stages green — 778 unit tests, 160 integration tests, 142 e2e tests.
- Coverage thresholds met: 80/80/80/80 (statements/branches/functions/lines).
- Community-admin comparator diffs under caps after rebase.
- One transient local-DB integration flake occurred during the gate and did not reproduce; standalone integration rerun passed 160/160.
- Review round: both findings (F1 pagination/mutation interlock, F2 keyboard/focus oracle) fixed and covered by tests.

## Risks and Follow-ups

- Transient local-DB integration flake noted; it did not reproduce and no follow-up issue was created — monitor for recurrence.
- Visual baselines now measure against the taller-header layout; future unrelated header changes will re-break baselines by design.
- No follow-up issues created for this epic.
