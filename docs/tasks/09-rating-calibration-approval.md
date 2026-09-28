# T09 — Approve V1 global-rating calibration and golden outcomes

**Type:** HITL  
**User stories:** US-007, US-018  
**PRD:** §§25–27, 81.2, 82

## Overview

### Context

PRD defines rating behavior, not exact coefficients. User chose a calibrated team-aware expected-outcome model rather than mandatory TrueSkill-style uncertainty.

### Task description

**Goal:** Human reviewer approves precise deterministic V1 rating rules before T10 implements them.

**In scope:** Decide/version formula and configuration; initialization from 0–7 starting level, team strength, expected outcome and Draw, per-player reliability-scaled delta, clamping/rounding and 100%-reliability stability; review golden fixtures with expected outputs and human-readable explanations. No product-code implementation in this approval task.

## Planning

### Depends on

- PAF-7 — Teams and result entry (T07), for agreed outcome semantics.

### Risk

**Level**: High

**Explanation**: Unapproved coefficients create perceived unfairness and make future replay unstable. Persist approved engine/configuration version for implementation and ledger events.

## Requirements

### Acceptance criteria

- [ ] Human approves deterministic formula, parameters, rounding, clamping, reliability influence, tie handling, and engine/configuration version.
- [ ] Golden cases specify before/after expectations for expected win/loss, upset, equal Draw, weaker-team Draw, different reliabilities, first competitive group and both 0–7 boundaries.
- [ ] Friendly, Incomplete, Pending and Disputed have zero rating/reliability effect in approved cases; score margin does not multiply delta.
- [ ] Example player-facing explanations reflect actual approved inputs; no League standing metric is used in global rating.
- [ ] Open fairness concerns are resolved explicitly before T10 begins; no inferred numerical requirement from illustrative PRD examples.

## Quality assurance

### Test plan

**Automated tests**:

- Acceptance review of a machine-readable golden fixture set to be implemented as regression tests in T10; this HITL task does not claim code coverage.

**Manual test**:

1. Review fixture table and rating explanations with product owner; sign off expected ordering and stability.

**Edge cases**:

- Draw near equal team strength, very mismatched teams, one low-reliability partner, identical played timestamps, projected level exceeding scale.

### Definition of done

- [ ] All subtasks delivered; calibration and fixtures explicitly approved.
- [ ] QA control gate approved.
- [ ] User review approved.
