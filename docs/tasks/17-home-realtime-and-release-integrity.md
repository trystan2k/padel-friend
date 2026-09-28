# T17 — Assemble Home, realtime updates, and release integrity

**Type:** AFK  
**User stories:** Cross-cutting US-001–021  
**PRD:** §§41–42, 45, 55–59, 61–63, 81, 84, 97

## Overview

### Context

Feature slices must converge on one trustworthy mobile dashboard and shared state across devices. V1 needs recovery and observability as well as functional correctness.

### Task description

**Goal:** Deliver integrated Home/navigation and verify the complete authorized match→result→rating→League→notification loop under realistic load and failure.

**In scope:** Community switcher, nearest match, pending actions, ranking snapshot, recent activity and notification badge; secure realtime/refetch for registered/Reserve/group/result/leaderboard changes and stale conflict handling; structured diagnostic events/request IDs, rating-job alerts, backup/recovery and migration verification, accessibility/performance/security E2E across completed flows. Each predecessor owns its own tests: this task checks integrated behavior rather than deferring basic QA.

## Planning

### Depends on

- PAF-5 — Registrations and Reserve (T05).
- PAF-10 — Global rating and history (T10).
- PAF-12 — League standings and close (T12).
- PAF-13 — History and statistics (T13).
- PAF-14 — Amendment, disputes and replay (T15).
- PAF-15 — PWA and Web Push (T16).

### Risk

**Level**: High

**Explanation**: Realtime stale state, missing diagnostics or untested recovery can undermine confirmed-results integrity even if isolated features work.

## Requirements

### Acceptance criteria

- [ ] Home shows selected community, nearest upcoming match, actionable items, ranking context and recent authoritative activity using approved Pencil/i18n.
- [ ] Two active clients converge quickly after joins/Reserve promotion, result review/confirmation, rating/standings and notifications; stale mutations reject safely and fetch current state.
- [ ] Private community and authenticated responses never leak through shared cache or client subscription; all critical writes require connectivity.
- [ ] Release E2E completes community→multi-quartet match→confirmed result→global rating→selected League standings→notification; replay and close regression also pass.
- [ ] Primary flows are checked against WCAG 2.2 AA with keyboard, names, contrast, text alternatives for scores/charts and touch targets; outstanding violations are fixed before completion.
- [ ] Backups, restore rehearsal, migration procedure, structured event/request IDs and alerting for failed rating/replay/Push are verified; performance targets in PRD §57 are measured or documented with findings.

## Quality assurance

### Test plan

**Automated tests**:

- Multi-account Playwright full-loop/realtime/conflict, RLS and cache-leak integration, accessibility checks; `pnpm complete-check` without threshold edits.
- Scripted restore/rebuild consistency rehearsal and observable injected failure checks where environment permits.

**Manual test**:

1. Use two mobile sessions in separate communities, complete full loop, disconnect one, reconnect and compare final state; perform keyboard/screen-reader walkthrough and recovery drill.

**Edge cases**:

- Reconnect during timer confirmation, stale approval/registration, admin replay during live reads, Push failure, service-worker-auth cache contamination, timezone boundary.

### Definition of done

- [ ] All subtasks delivered; `pnpm complete-check` passes without lowering coverage thresholds.
- [ ] QA control gate approved.
- [ ] User review approved.
