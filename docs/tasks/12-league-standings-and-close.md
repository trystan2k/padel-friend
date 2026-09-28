# T12 — Calculate, close, and revisit League standings

**Type:** AFK  
**User stories:** US-019, US-020  
**PRD:** §§28–31, 39, 61 AC-01–19, 82

## Overview

### Context

League is a period-based W/L/D and sets competition, never a second skill-rating system. Only confirmed eligible groups from explicitly Ranked events count.

### Task description

**Goal:** Members can follow correct live standings and inspect finalized historical Leagues.

**In scope:** Eligibility by selected League, `played_at`, active membership interval, confirmed Competitive ratable outcome; materialized/rebuildable per-player counters, deterministic ordering/ties, minimum-match award eligibility, automatic Fixed Date close and audited Manual close, final snapshot/history. A first confirmation after close still counts if play was in period: version and audit the revised final standings. Correction of an already-confirmed old result is delivered by T15. New post-period play never enters a closed League.

## Planning

### Depends on

- PAF-8 — Result review and auto-confirm (T08).
- PAF-10 — Global rating and history (T10).
- PAF-11 — League creation and ranked selection (T11).

### Risk

**Level**: High

**Explanation**: Inclusion errors distort standings. Keep League projection independent of global rating and rebuildable from confirmed facts/membership intervals.

## Requirements

### Acceptance criteria

- [ ] Only explicitly League-bound, confirmed, ratable Competitive Game Groups played inside period count; unranked, Friendly, Incomplete, pre-start and post-close groups never count.
- [ ] Counters start at zero, including late-joining members; guest/inactive intervals do not earn standing; leaving preserves earned historical counters.
- [ ] Each eligible player receives Matches, W/L/D, Sets Won/Lost and differential; order is Wins desc → Losses asc → Set Diff desc → Sets Won desc → shared position.
- [ ] Global level, reliability, or rating delta never seed/order League standings; Competitive confirmation updates global rating independently.
- [ ] Fixed League closes at its boundary, Manual League closes on owner/Admin action; new later play cannot alter final standings; prior League table remains viewable.
- [ ] First confirmation after close of an eligible in-period Game Group updates closed standings with a new version and audit; old snapshot remains inspectable. Late play outside the period remains excluded.
- [ ] Active/historical/empty/award-state designs match Pencil and translated copy; close action and audit are authorized.

## Quality assurance

### Test plan

**Automated tests**:

- PRD AC-01–19 where consistent with clarified rules; adapt AC-03 to require explicit Ranked League binding and AC-19 to permit Public guests only in Unranked Competitive events. Also test tie/shared place, Draw set totals, `played_at` boundary/timezone, late/inactive member, late first confirmation with versioned closed-standings audit, global-skill-independence and close idempotency.
- E2E create Ranked event in League, confirm group, inspect standings, close and inspect archived table.

**Manual test**:

1. Confirm one Draw and one Win in an Active League; verify counters/order and compare global rating independently.

**Edge cases**:

- Late result submission after period end but played inside period, simultaneous close/confirm, one-active-League race, membership leave/rejoin, minimum-match threshold.

### Definition of done

- [ ] All subtasks delivered; `pnpm complete-check` passes without lowering coverage thresholds.
- [ ] QA control gate approved.
- [ ] User review approved.
