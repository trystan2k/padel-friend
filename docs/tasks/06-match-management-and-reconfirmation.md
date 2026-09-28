# T06 — Manage invitations, match changes, and reconfirmation

**Type:** AFK  
**User stories:** US-012, US-013  
**PRD:** §§15.13, 18–20, 43–45

## Overview

### Context

Participant changes, invitations and edits must preserve FIFO fairness and explicit consent to materially changed match terms.

### Task description

**Goal:** Creator and players can safely manage participation before play.

**In scope:** Invite/accept/decline/expire, self-withdraw, creator removal with required reason, organizer withdrawal/optional ownership transfer, pre-play event cancellation, minor-change notifications/audit, major match type/material time change with participant reconfirmation and cutoff exclusion; recalculate quartets/status notifications after affected actions. Ranked/League-specific material changes and period warning join this flow in T11.

## Planning

### Depends on

- PAF-5 — Registrations and Reserve (T05).

### Risk

**Level**: High

**Explanation**: Reconfirmation and concurrent withdrawals can alter quartets; never silently change a played group or preserve an unreconfirmed player at cutoff.

## Requirements

### Acceptance criteria

- [ ] Invitation never reserves FIFO/capacity until accepted; acceptance uses ordinary eligibility, capacity, and Reserve rules.
- [ ] Before cutoff player may withdraw and creator may remove with reason; accepted order remains authoritative, affected users are notified, and removal is audited.
- [ ] Creator can leave player roster while remaining organizer, or explicitly transfer ownership; valid authorized creator/Admin can cancel before play with notifications.
- [ ] Minor venue/price/notes changes notify and audit affected players without reconfirmation.
- [ ] Competitive↔Friendly or materially changed date/time after other registrations triggers explicit reconfirmation; unreconfirmed players are excluded at cutoff and quartets recalculate.
- [ ] Normal leave/removal/change cannot alter active/confirmed results; UI directs user to correction flow instead.
- [ ] Invitation, management, reconfirmation, unavailable-action states use Pencil and translated copy.

## Quality assurance

### Test plan

**Automated tests**:

- Invitation expiry/capacity, concurrent leave/recalculate, removal audit, cutoff reconfirmation, edit-version conflict and role authorization integration.
- E2E invite→accept→Reserve, creator removal→promotion, major change→reconfirm/exclude, cancellation notification.

**Manual test**:

1. Fill two quartets, remove one player, inspect Reserve/Playing notifications; change match type and leave one user unreconfirmed through cutoff.

**Edge cases**:

- Creator departure as organizer vs player, pending invitation at capacity, minor price change, cancellation racing result submission, late reconfirmation.

### Definition of done

- [ ] All subtasks delivered; `pnpm complete-check` passes without lowering coverage thresholds.
- [ ] QA control gate approved.
- [ ] User review approved.
