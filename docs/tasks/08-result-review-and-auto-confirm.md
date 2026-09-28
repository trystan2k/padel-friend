# T08 — Review, dispute, and auto-confirm result proposals

**Type:** AFK  
**User stories:** US-016, US-017  
**PRD:** §§21.4, 23–24.2, 43.6, 45, 61 AC-24

## Overview

### Context

Submitted teams and scores are not official until eligible players confirm or the trusted 48-hour deadline passes without rejection.

### Task description

**Goal:** Each Game Group reaches an auditable confirmed or disputed state exactly once.

**In scope:** Reviewer eligibility by submitter/team, approve/reject with reason, corrected pending proposal version/new deadline, trusted scheduled auto-confirm, per-group partial resolution, parent event status, result lifecycle in-app alerts and deep links. Confirmation produces authoritative facts/events for later T10/T12/T13 projections; those later projections must consume the same idempotent confirmation identity.

## Planning

### Depends on

- PAF-3 — In-app notifications (T03).
- PAF-7 — Teams and result entry (T07).

### Risk

**Level**: High

**Explanation**: Approval racing rejection or scheduler can finalize invalid facts; lock/version-check transitions and apply confirmation exactly once.

## Requirements

### Acceptance criteria

- [ ] Submitter who played needs one opposing-team approval; non-playing submitter needs at least one approval from each team. Submitter/teammate cannot fake required opposing approval.
- [ ] Every player sees proposed facts; only eligible reviewers see valid Approve/Reject actions; rejection immediately Disputes and stops auto-confirmation.
- [ ] Pending proposal without rejection confirms at `submitted_at + 48h`, even with zero or partial manual approvals; corrected proposal gets fresh timer.
- [ ] Repeated manual/scheduled finalization cannot create duplicate official result, confirmation events, audit, or notifications.
- [ ] Only confirmed groups affect official history; other groups may remain Pending/Disputed while event is partially resolved.
- [ ] Pencil approval/notification/partial-resolution designs and en/pt-BR/es copy are followed.

## Quality assurance

### Test plan

**Automated tests**:

- Eligible-reviewer role matrix, fake-clock 48h paths, rejection race, stale-version rejection, manual-vs-auto collision and idempotent confirmation integration.
- E2E participant approval/rejection, pending deadline, corrected proposal and partially resolved multi-group event.

**Manual test**:

1. Submit a result where creator did not play, obtain one approval per team, then repeat with partial approval and simulated 48-hour expiry.

**Edge cases**:

- Late reviewer after deadline, approval after dispute, no reviewer available, Incomplete confirmation without competitive projections, retried scheduled job.

### Definition of done

- [ ] All subtasks delivered; `pnpm complete-check` passes without lowering coverage thresholds.
- [ ] QA control gate approved.
- [ ] User review approved.
