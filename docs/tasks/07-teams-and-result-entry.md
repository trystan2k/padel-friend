# T07 — Assign actual teams and submit scored results

**Type:** AFK  
**User stories:** US-014, US-015  
**PRD:** §§20–22, 63.2, 81.1

## Overview

### Context

Each playable Game Group is one four-player match. Actual players/teams and score must be recorded before a result can be trusted.

### Task description

**Goal:** Match Creator submits a valid per-group result proposal reflecting what actually happened.

**In scope:** Predefined planning and post-match assignment, final team confirmation/correction, authoritative per-group actual `played_at` (UTC storage, community-timezone input), optional group court metadata, result version, normal best-of-three score input, incomplete set, rated Draw versus Incomplete classification, preview, creator-led entry and authorized Admin recovery. Do not update official rating, League or statistics while pending.

## Planning

### Depends on

- PAF-5 — Registrations and Reserve (T05).
- PAF-6 — Match management (T06).

### Risk

**Level**: High

**Explanation**: Invalid groups or score classification would contaminate future rating and standings; validate server-side and store proposal versions.

## Requirements

### Acceptance criteria

- [ ] Every submitted group has four eligible Playing players, two per team, no duplicate player across simultaneous groups; Reserve Not Playing cannot be included.
- [ ] Predefined teams can be confirmed/corrected after play; post-match teams must be explicitly assigned. Actual teams become authoritative.
- [ ] Record/validate when each Game Group actually played; preserve `played_at` independently of event schedule, result submission and confirmation times for later League eligibility and replay.
- [ ] Completed normal set accepts 6–0 through 6–4, 7–5, or 7–6; best-of-three normal third set only.
- [ ] Draw requires completed sets tied 1–1 with no completed third set; incomplete third-set games may be stored but cannot determine winner.
- [ ] Stopped earlier is Incomplete, with no rating/reliability/League effects. Friendly result never affects rating/League.
- [ ] Second stale submission cannot replace active proposal; review screen receives proposal version and 48-hour deadline after submit.
- [ ] Scoring errors identify invalid set/team clearly; Pencil record-result states and translations are used.

## Quality assurance

### Test plan

**Automated tests**:

- Score fixtures for normal win, two-set/unfinished-third Draw, Incomplete, invalid 6–5, duplicate players, `played_at` timezone/boundary validation, and post-match group assignment transaction.
- E2E assign two groups and submit only one pending result; verify no official rating/standings before confirmation.

**Manual test**:

1. Complete event with eight players, record actual groups/teams, submit Draw with unfinished third set and inspect proposed facts.

**Edge cases**:

- One set only, 2–0 with incomplete third set, proposal racing another editor, creator not in group, Reserve included incorrectly.

### Definition of done

- [ ] All subtasks delivered; `pnpm complete-check` passes without lowering coverage thresholds.
- [ ] QA control gate approved.
- [ ] User review approved.
