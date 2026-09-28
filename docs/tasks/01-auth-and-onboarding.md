# T01 — Authenticate and onboard an app-wide player

**Type:** AFK  
**User stories:** US-006  
**PRD:** §§10–12, 54–55

## Overview

### Context

Every community action needs a trusted identity and one app-wide player profile. The initial level is player-selected once; authentication data must remain private.

### Task description

**Goal:** An authenticated newcomer can create their profile and see their initial level and reliability.

**In scope:** Existing Supabase Google OAuth/PKCE flow, authenticated SSR session handling, profile onboarding (display name, preferred side, 0–7 level), initial global rating state, profile view/edit for permitted fields, and an authentication boundary for private content. Use existing Pencil frames, design tokens, and en/pt-BR/es i18n. Do not expose auth email as sporting-profile data.

## Planning

### Depends on

None.

### Risk

**Level**: High

**Explanation**: Incorrect cookie/session handling or profile RLS could expose private data. Validate redirects, SSR hydration, and server-side claims on every private operation.

## Requirements

### Acceptance criteria

- [ ] Unauthenticated visitors cannot access community content; successful authentication returns users to their intended authorized destination.
- [ ] First-time user saves name, preferred side (Left/Right/Either), and initial level within 0.0–7.0; profile and rating state are app-wide, not community-scoped.
- [ ] Initial display level equals chosen level, reliability is 10%, confirmed competitive group count is zero; subsequent normal profile edits cannot change starting/current level.
- [ ] Private contact/authentication data is absent from public sporting profile responses.
- [ ] Server-side authorization and RLS reject attempts to mutate another user's profile or rating.
- [ ] UI follows approved Pencil onboarding/profile designs, including loading/error/unauthorized states and translated visible copy.

## Quality assurance

### Test plan

**Automated tests**:

- Unit/integration: input bounds, onboarding idempotency, one profile/rating per user, RLS cross-user denial, unauthenticated server-function denial.
- E2E: OAuth callback/return path, onboarding, reload across devices/sessions, protected route, profile edit without level edit.

**Manual test**:

1. Authenticate a new user, finish onboarding, verify level/reliability and profile visibility; sign out and retry protected routes.

**Edge cases**:

- Duplicate callback or retried onboarding; invalid level or missing name; expired session during submit; locale SSR/hydration mismatch.

### Definition of done

- [ ] All subtasks delivered; `pnpm complete-check` passes without lowering coverage thresholds.
- [ ] QA control gate approved.
- [ ] User review approved.
