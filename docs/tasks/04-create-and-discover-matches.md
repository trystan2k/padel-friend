# T04 — Create and discover Match Events

**Type:** AFK  
**User stories:** US-003, US-009, US-011  
**PRD:** §§13–16, 52–53

## Overview

### Context

A community needs a usable event before registrations, teams, results, and Leagues can exist.

### Task description

**Goal:** Members can publish authorized future Match Events and players can discover appropriate ones.

**In scope:** Event create/publish and listings/details (Available/My Matches/Past entry points); community-open/invite-only visibility; Competitive/Friendly; venue name, validated Maps URL and required photo; optional informational price/currency, cutoff, max capacity and editable creator-derived level range; shareable authorized deep link. Creator auto-registers. New open-match notification goes to active members except creator. Ranked selection is added in T11, not silently inferred here.

## Planning

### Depends on

- PAF-2 — Communities and administration (T02).
- PAF-3 — In-app notifications (T03).

### Risk

**Level**: Medium

**Explanation**: Event visibility and uploaded venue imagery can expose Private data; validate and authorize reads and storage.

## Requirements

### Acceptance criteria

- [ ] Member publishes a future event with all required fields; creator is first accepted registration unless withdrawn later.
- [ ] Default cutoff is one hour before start; custom cutoff remains before start. Suggested enabled level range uses creator level −0.5/+1.5 clamped to 0–7, and can be edited/disabled.
- [ ] Public-community open event is discoverable to authenticated nonmembers; Private and Invite Only access follows strict visibility rules.
- [ ] Public open publication notifies active members other than creator once; Invite Only does not broadcast to the community.
- [ ] Venue/Maps/photo and optional informational cost render on mobile; there is no booking or payment workflow.
- [ ] Authorized shared link returns authenticated visitors to the event without bypassing access policy.
- [ ] Approved Pencil match-create/detail/list states and en/pt-BR/es translations are used.

## Quality assurance

### Test plan

**Automated tests**:

- Form validation, RLS/public-private visibility, storage authorization, notification recipients, default/currency/range/cutoff rules.
- E2E create/publish/discover/open link across member, public guest and unauthorized private visitor.

**Manual test**:

1. Publish one Public Community Open event and one Private Invite Only event; compare discovery, image/Maps/cost display and notifications.

**Edge cases**:

- Malformed Maps URL, unsupported currency, negative price, past start, bad cutoff, missing photo, public deep link to Invite Only event.

### Definition of done

- [ ] All subtasks delivered; `pnpm complete-check` passes without lowering coverage thresholds.
- [ ] QA control gate approved.
- [ ] User review approved.
