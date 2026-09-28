# T16 — Deliver installable PWA and Web Push with in-app fallback

**Type:** AFK  
**User stories:** Supports match, result and League participation stories  
**PRD:** §§43–44, 53, 81.4

## Overview

### Context

Web Push is required on supported/authorized devices, but OS delivery is best-effort. Persisted in-app notifications remain authoritative.

### Task description

**Goal:** A player can install the app, opt into Push, receive relevant deep-linked alerts, and still see critical in-app alerts when Push fails.

**In scope:** Manifest/icons/launch metadata, safe repeat-launch shell, service worker cache exclusions, user-driven permission flow, multiple Push subscriptions per user, invalid subscription cleanup, delivery retries/failures, Push preferences/category filtering, standards-based server delivery, notification deep links, OS-install guidance and offline mutation rejection. Connect existing community/match/result/rating/League notification producers to durable idempotent channel handling; no separate offline authoritative writes.

## Planning

### Depends on

- PAF-3 — In-app notifications (T03).
- PAF-4 — Create and discover matches (T04).
- PAF-8 — Result review and auto-confirm (T08).
- PAF-10 — Global rating and history (T10).
- PAF-12 — League standings and close (T12).
- PAF-17 — Player level review (T14).
- PAF-14 — Amendment, disputes and replay (T15).

### Risk

**Level**: High

**Explanation**: Browser/OS Push support differs; unsafe service-worker caching can leak authenticated SSR or auth responses. Test fallback and subscriptions explicitly.

## Requirements

### Acceptance criteria

- [ ] Supported device can install PWA and enable Push after user action; multiple devices are supported; unsupported/install-required/denied states explain next step.
- [ ] Critical domain event always has in-app notification, whether Push is disabled, unsupported, failed or subscription expired.
- [ ] An event-recipient/channel matrix covers community invites/membership/roles, new open matches, match invitations, guest/out-of-range request decisions, registration/removal/reconfirmation and Reserve changes/cutoff, event cancellation/detail changes, result proposal/review/rejection/deadline/confirmation/amendment, level/reliability/review, and League start/close/final standings. Each required critical event is persisted in-app; eligible enabled Push delivery is best-effort and deduplicated.
- [ ] User Push preferences apply by category; critical in-app notifications remain available regardless of Push settings.
- [ ] Push tap opens authorized target; expired subscription is retired without deleting in-app alert.
- [ ] Service worker does not cache authenticated SSR HTML or Supabase auth requests; offline join/result/approval shows unsent state, never false success.
- [ ] Install/prefs/failure UI follows Pencil and en/pt-BR/es translations.

## Quality assurance

### Test plan

**Automated tests**:

- Event-recipient/channel matrix and preference/dedupe tests (including guest decisions, Reserve cutoff, result deadline and League close), expired-subscription integration, service-worker cache exclusion, and Playwright online/offline, denied permission and deep-link paths.
- Supported device/browser matrix documented and exercised where tooling permits; Push send mocked for deterministic CI.

**Manual test**:

1. Enable Push on supported device, trigger match invitation and Reserve promotion; deny Push on another device and verify the same critical events remain in-app.

**Edge cases**:

- iOS install-required browser, Push key rotation/expired endpoint, multiple subscriptions, offline repeat launch, private deep link after sign-out, service worker update.

### Definition of done

- [ ] All subtasks delivered; `pnpm complete-check` passes without lowering coverage thresholds.
- [ ] QA control gate approved.
- [ ] User review approved.
