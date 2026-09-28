# T13 — Show match, player, pair, opponent, and community statistics

**Type:** AFK  
**User stories:** US-021  
**PRD:** §§32–40, 48–49, 83

## Overview

### Context

Confirmed actual Game Groups are the factual basis for deep statistics. Materialized aggregates may speed reads but must be rebuildable.

### Task description

**Goal:** Players can inspect trustworthy history and the complete explicitly listed V1 core/advanced statistical views.

**In scope:** Group/match history detail, core W/L/D/set/game/rating/form metrics, straight-set/deciding-set/comeback and activity records, unordered pair and full partner records, opponent/head-to-head, community aggregate insights, community/League/type/date filters, insufficient-data thresholds and accessible chart equivalents. Optional actual court-side insights only where captured. Exclude Phase 1.1-only enhancements.

## Planning

### Depends on

- PAF-8 — Result review and auto-confirm (T08).
- PAF-10 — Global rating and history (T10).
- PAF-12 — League standings and close (T12).

### Risk

**Level**: High

**Explanation**: Broad metrics can disagree across filters or double-count amended data. Derive from confirmed facts and provide deterministic rebuild/invariant tests.

## Requirements

### Acceptance criteria

- [ ] Match history distinguishes Played, Friendly, Competitive, Incomplete, Disputed, Canceled and Reserve Not Playing; confirmed group detail includes teams, sets, games, approval/audit and rating effects as applicable.
- [ ] Player core and PRD-specified advanced metrics in §§33–34 are exposed when sufficient data exists, with explicit insufficient-data states and no fabricated results.
- [ ] Pair identity is order-independent; partner record, H2H, most frequent partner/opponent and relevant streak/threshold metrics follow confirmed actual teams.
- [ ] Community, all communities, selected historical/active League, Competitive/Friendly/All and date filters produce correctly scoped statistics; League filters include only eligible League results.
- [ ] Completed sets award sets/games once; recorded incomplete set awards games played but zero sets; Incomplete group counts no W/L/D.
- [ ] Materialized views do not synchronously scan full history on each read and are rebuildable; stat cards/charts have textual equivalents and follow Pencil/i18n.

## Quality assurance

### Test plan

**Automated tests**:

- PRD §83 invariants, unordered pair identity, head-to-head teams, filter combinations, insufficient-data rules, incomplete third-set games and aggregate rebuild equality.
- E2E navigate player→pair→opponent→match detail; apply community/League/type/date filters and verify accessible numeric chart data.

**Manual test**:

1. Confirm multiple Competitive/Friendly/Draw/Incomplete groups and compare profile, pair, H2H and community totals under filters.

**Edge cases**:

- Zero denominator, one-match partnership, guest in Public unranked match, inactive membership, tied chronology, later amendment (T15 must replace—not add—old effects).

### Definition of done

- [ ] All subtasks delivered; `pnpm complete-check` passes without lowering coverage thresholds.
- [ ] QA control gate approved.
- [ ] User review approved.
