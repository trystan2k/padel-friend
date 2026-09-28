# T10 — Apply app-wide rating and explain changes

**Type:** AFK  
**User stories:** US-007, US-018  
**PRD:** §§12, 25–27, 48, 81–82

## Overview

### Context

Competitive confirmed results must affect one app-wide level, independently of community and League standings. Every delta must be explainable and replayable.

### Task description

**Goal:** A confirmed ratable Competitive Game Group updates each player exactly once and exposes its rating explanation/history.

**In scope:** Implement approved T09 deterministic team-aware expected-outcome algorithm, per-player reliability influence, 10% +6 points per confirmed ratable group up to 100% after 15, global rating state/immutable versioned event ledger, rating projection on result confirmation, deterministic initialization from already-confirmed in-app groups created before this slice, progress chart and explanatory detail, highest level and group count. No League-specific skill or manual level editing; no pre-launch historical import.

## Planning

### Depends on

- PAF-8 — Result review and auto-confirm (T08).
- PAF-9 — Rating calibration approval (T09).

### Risk

**Level**: High

**Explanation**: Rating order and retries can corrupt cross-community state. Serialize authoritative updates and record engine/configuration versions and inputs.

## Requirements

### Acceptance criteria

- [ ] First confirmed ratable Competitive group may change app-wide level; each participant gets own explainable delta from partner/opponent team strengths, expected result and reliability.
- [ ] Reliability equals `min(100, 10 + 6 * count)` and reaches 100% after 15 confirmed ratable groups; visible level remains 0–7 at two decimal places.
- [ ] Friendly, Incomplete, Pending, Disputed, Canceled and Reserve Not Playing cause no global rating/reliability update.
- [ ] Same group confirmation/retry creates exactly one rating event per eligible player with before/after, team strength, expected outcome and engine/configuration version.
- [ ] Existing eligible in-app confirmed groups from T08 are projected once in deterministic order when rating is enabled, without requiring their results to be resubmitted.
- [ ] Rating chart/history and event explanation render for authorized users without leaking private account data; profile copy uses Pencil and en/pt-BR/es i18n.
- [ ] Global skill is app-wide across communities and never initialized or reset by League lifecycle.

## Quality assurance

### Test plan

**Automated tests**:

- All approved T09 golden fixtures, reliability milestones 0/5/10/15+, clamping, ordering/idempotency, already-confirmed in-app group initialization, multiple-community history, privacy integration.
- E2E confirm competitive/friendly/incomplete groups and inspect rating progression and explanation.

**Manual test**:

1. Confirm an upset with low- and high-reliability teammates; inspect four different event explanations and immutable history.

**Edge cases**:

- Draw versus stronger team, concurrent confirmations involving same player, duplicate scheduler request, zero displayed delta from rounding.

### Definition of done

- [ ] All subtasks delivered; `pnpm complete-check` passes without lowering coverage thresholds.
- [ ] QA control gate approved.
- [ ] User review approved.
