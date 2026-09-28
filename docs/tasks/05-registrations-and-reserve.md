# T05 — Register players, approve requests, and form FIFO quartets

**Type:** AFK  
**User stories:** US-004, US-005, US-010, US-012  
**PRD:** §§15.8–15.11, 17, 19.5, 45, 63

## Overview

### Context

Every four accepted registrations create a playable group; leftover players remain Reserve. Order is server-authoritative.

### Task description

**Goal:** Members and approved Public-community guests can enter matches fairly, even under concurrent joins.

**In scope:** Direct member registration, out-of-range member requests, Public guest requests, creator approval/rejection, unique accepted-order allocation, max capacity, Reserve promotion/demotion, cutoff expiration and Reserve Not Playing, participant status/UI and immediate in-app status notifications. Guests remain nonmembers. T11 later forbids guest participation when event is Ranked.

## Planning

### Depends on

- PAF-4 — Create and discover matches (T04).

### Risk

**Level**: High

**Explanation**: Simultaneous joins, approvals and cutoff can corrupt FIFO or capacity; use authoritative atomic/idempotent operations.

## Requirements

### Acceptance criteria

- [ ] Eligible in-range member registers directly; out-of-range member and Public guest request creator approval; Private nonmember cannot request.
- [ ] Guest/out-of-range FIFO starts at approval timestamp; request timestamp never holds a place or silently creates membership.
- [ ] Playing count is `floor(N / 4) * 4`; latest incomplete quartet is Reserve. The fourth acceptance promotes all four atomically.
- [ ] Duplicate registration/request is rejected; explicit maximum capacity is enforced atomically. Four players alone do not close an unlimited event.
- [ ] At cutoff new joins stop, pending requests expire, remaining Reserve become Reserve Not Playing, and complete quartets remain playable; affected users receive in-app alerts.
- [ ] Playing/Reserve/guest/request states and counts match approved Pencil designs and translated copy.

## Quality assurance

### Test plan

**Automated tests**:

- Concurrent #8/#9 joins, competing last-capacity joins, retried approvals, FIFO reorder prohibition, cutoff boundary and idempotency integration.
- E2E member, out-of-range and Public guest request/approval; multi-quartet Reserve promotion and notification.

**Manual test**:

1. Accept seven registrations, approve an eighth, verify second quartet and all status changes; repeat with a guest approved later.

**Edge cases**:

- Join/approve at cutoff, no complete quartet, guest in Private event, duplicate pending request, maximum capacity reached by competing request.

### Definition of done

- [ ] All subtasks delivered; `pnpm complete-check` passes without lowering coverage thresholds.
- [ ] QA control gate approved.
- [ ] User review approved.
