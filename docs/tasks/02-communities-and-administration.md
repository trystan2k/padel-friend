# T02 — Create, discover, join, and administer communities

**Type:** AFK  
**User stories:** US-001, US-002, US-003  
**PRD:** §§8–9, 14, 54, 71.1

## Overview

### Context

Players organize multiple groups while keeping one global profile. Public discovery must not leak private-community data.

### Task description

**Goal:** A user can create and use Public/Private communities; authorized admins can govern membership safely.

**In scope:** Community create/settings and discovery, public self-join or configured approval, private invitation/join acceptance and admin decision, membership intervals, leaving/removal/reactivation, role promotion/demotion, member search, saved venues, and community audit view. Use approved community/admin Pencil screens. Preserve sporting history after membership ends; prevent direct player-level edits.

## Planning

### Depends on

- PAF-1 — Authenticate and onboard (T01).

### Risk

**Level**: High

**Explanation**: Membership and role leaks affect all later private data. Enforce policies at database and server boundaries, not just navigation.

## Requirements

### Acceptance criteria

- [ ] Any authenticated player can create multiple communities, choose Public/Private visibility, and become initial Admin.
- [ ] Authenticated users can discover Public communities; nonmembers cannot list private communities or their matches.
- [ ] Public self-join respects instant-versus-admin-approval setting; private join requires valid invitation/authorized link and any configured approval.
- [ ] Admin can approve/deny requests, invite/remove/reactivate members, manage roles/settings/venues, and inspect audited changes; members cannot perform admin actions.
- [ ] Leaving/removal inactivates membership without erasing historical match/League facts; inactive users lose new private-community participation rights.
- [ ] Membership timelines and community IDs support future League eligibility checks; sporting profile never exposes private account fields.
- [ ] All visible states use approved Pencil designs and en/pt-BR/es translations.

## Quality assurance

### Test plan

**Automated tests**:

- RLS/server integration role matrix for public, private, invited, pending, inactive, member, and Admin users; membership interval and audit tests.
- E2E create/discover/join/invite/approve/remove/reactivate and unauthorized deep-link checks.

**Manual test**:

1. With two accounts, create a Public and a Private community; verify discoverability, invitation approval, removal, and preserved sporting history.

**Edge cases**:

- Expired/reused invitation; final Admin removal/demotion; duplicate join; guest access must not imply membership; simultaneous role changes.

### Definition of done

- [ ] All subtasks delivered; `pnpm complete-check` passes without lowering coverage thresholds.
- [ ] QA control gate approved.
- [ ] User review approved.
