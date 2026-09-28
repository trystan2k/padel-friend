# T15 — Amend results, resolve disputes, and replay projections

**Type:** AFK  
**User stories:** US-016, US-018, US-019, US-020, US-021  
**PRD:** §§24, 48, 51, 64–65, 71, 81–83

## Overview

### Context

Correcting a confirmed past result can change later global ratings across communities and a closed League's final table. Auditable deterministic replay is required.

### Task description

**Goal:** Authorized corrections restore internally consistent history, rating, statistics, and standings without erasing prior facts.

**In scope:** Participant/creator/Admin amendment requests, corrected proposal review and 48-hour/no-rejection rules, Community Admin dispute resolution/void override, audit/version history, global chronological replay, affected League and statistics rebuild, versioned corrected final-standing snapshot, repair diagnostics and collision/retry safeguards. Preserve T14 forward-only manual adjustment events at their original chronological point; correction does not cause unrelated historical admin reviews to be backdated.

## Planning

### Depends on

- PAF-8 — Result review and auto-confirm (T08).
- PAF-10 — Global rating and history (T10).
- PAF-12 — League standings and close (T12).
- PAF-13 — History and statistics (T13).
- PAF-17 — Player level review (T14).

### Risk

**Level**: High

**Explanation**: Replaying only one community would corrupt app-wide ratings. Rebuild chronologically across every affected player's later competitive groups; isolate concurrent repairs.

## Requirements

### Acceptance criteria

- [ ] Confirmed result amendment retains prior proposal/reviews/audit and needs appropriate player approval or explicit audited Admin override.
- [ ] Replacing/voiding competitive fact invalidates old rating effects and deterministically replays affected later events across communities, versioned configs, and manual adjustment timestamps.
- [ ] A corrected eligible in-period result may rebuild even closed League standings with auditable superseded snapshot; pre-start/post-close matches remain excluded.
- [ ] Distinguish amended prior confirmation from T12's late first confirmation: both may version closed standings for eligible in-period play, but only amendment invalidates/replays prior official rating events.
- [ ] Pair/player/community statistics and rating history reflect corrected facts exactly once; previous state remains inspectable via audit.
- [ ] Repair is permission-gated, logged, collision-protected and safely retryable; failure is visible to operators, not silently presented as complete.
- [ ] Pencil amendment, dispute, final-standings-correction and admin diagnostics views are used with translated copy.

## Quality assurance

### Test plan

**Automated tests**:

- Multi-community chronological fixture with late result correction, mid-sequence T14 adjustment, closed League rebuild, retry/no duplicate events, fail/resume and concurrent replay lock.
- E2E dispute→corrected proposal→review→updated match/rating/League/statistics/audit.

**Manual test**:

1. Correct an October result after December League close; verify changed final standings, unaffected later matches' inclusion, and prior snapshot/audit.

**Edge cases**:

- Same played_at tie ordering, multiple affected users/communities, corrected result becomes Friendly/Incomplete/void, replay failure midway, stale approval on superseded proposal.

### Definition of done

- [ ] All subtasks delivered; `pnpm complete-check` passes without lowering coverage thresholds.
- [ ] QA control gate approved.
- [ ] User review approved.
