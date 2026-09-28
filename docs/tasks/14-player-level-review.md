# T14 — Request and resolve audited player level reviews

**Type:** AFK  
**User stories:** US-008  
**PRD:** §§12.5–12.7, 25.9, 55, 71.2

## Overview

### Context

Players cannot edit their level after onboarding. An auditable Platform Admin review is the only manual correction path, and its effect is forward-only.

### Task description

**Goal:** Player can request a level review; authorized Platform Admin can approve/reject and apply a documented forward-only adjustment.

**In scope:** Request/status/evidence UI, Platform Admin queue/decision, immutable adjustment event with before/after and reason/request/actor, optional explicitly documented reliability reset/reduction, notifications, audit and strict role controls. Historical matches are not replayed for administrative level corrections; T15 replay must preserve their chronological forward-only effect.

## Planning

### Depends on

- PAF-10 — Global rating and history (T10).

### Risk

**Level**: High

**Explanation**: Unauthorized manual edits undermine trust. Restrict to Platform Admin and use traceable events, not arbitrary state overrides.

## Requirements

### Acceptance criteria

- [ ] Player submits current/requested level or range, reason, optional evidence; can inspect status, and is notified of resolution.
- [ ] Only Platform Admin can resolve; Community Admin, Match Creator and player cannot set app-wide level directly.
- [ ] Approved review appends immutable `ADMIN_REVIEW_ADJUSTMENT` linked to request, reason, actor, timestamp, before/after internal/display/reliability states.
- [ ] Adjustment affects future rating only; historical results/League standings are not replayed solely due to review; reliability preserved unless explicitly justified/recorded exception.
- [ ] Player/Admin views match approved Pencil frames and en/pt-BR/es translated states.

## Quality assurance

### Test plan

**Automated tests**:

- RLS/role denial, request state transitions, approval idempotency, forward-only event history, reliability preserve/reset audit integration.
- E2E request→Platform Admin decision→player notification/profile history.

**Manual test**:

1. Submit a review as player; inspect queue as Platform Admin; attempt direct edit as Community Admin; approve and verify historical values remain.

**Edge cases**:

- Duplicate pending requests, rejected/canceled request, desired level out of range, concurrent result confirmation and admin adjustment.

### Definition of done

- [ ] All subtasks delivered; `pnpm complete-check` passes without lowering coverage thresholds.
- [ ] QA control gate approved.
- [ ] User review approved.
