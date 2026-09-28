# T03 — Persist and display in-app notifications

**Type:** AFK  
**User stories:** Supporting US-001–005 and subsequent match/result actions  
**PRD:** §§43, 44.8–44.10, 80–81

## Overview

### Context

Critical state changes must remain discoverable without device Push. Domain retries must not create duplicate alerts.

### Task description

**Goal:** An authorized user can inspect and act on durable, correctly scoped notifications.

**In scope:** Notification persistence keyed by stable domain event and recipient, community membership events as first use case, center/unread badge, mark-one/mark-all read, safe deep links, initial preferences model, and recipient/privacy boundary. Later tasks add match/rating/League event producers; T16 adds Push delivery. Use approved Notifications/Preferences Pencil frames.

## Planning

### Depends on

- PAF-1 — Authenticate and onboard (T01).
- PAF-2 — Communities and administration (T02).

### Risk

**Level**: Medium

**Explanation**: Duplicate or cross-community alerts erode trust; persist a single in-app notification per event/recipient even on retries.

## Requirements

### Acceptance criteria

- [ ] A relevant community invitation/approval/removal generates a durable in-app alert for its authorized recipient with safe destination.
- [ ] Unread badge, mark-one, mark-all, and navigation work; users cannot read another user's notifications.
- [ ] Retried domain event or reconnect does not create duplicate recipient notifications.
- [ ] Critical in-app alerts cannot be fully disabled by preferences; Push is not required for center delivery.
- [ ] Center, empty/error/offline states, preferences, and all user-visible copy match Pencil and en/pt-BR/es i18n.

## Quality assurance

### Test plan

**Automated tests**:

- Recipient calculation, stable idempotency key, private-data filtering, read/unread transitions, and RLS access integration.
- E2E invitation notification deep link and unread-state change.

**Manual test**:

1. Invite a second account to a private community, inspect notification and mark it read with Push permission denied.

**Edge cases**:

- Duplicate delivery, deleted/inaccessible target, inactive member, stale unread count, notification deep link through authentication.

### Definition of done

- [ ] All subtasks delivered; `pnpm complete-check` passes without lowering coverage thresholds.
- [ ] QA control gate approved.
- [ ] User review approved.
