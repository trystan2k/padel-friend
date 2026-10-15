---
title: PAF-49 Tier 4 Features and Expansion
type: development-log
permalink: docs/development-logs/task-PAF-49-tier-4-features-and-expansion
---

# Development Log: PAF-49

## Metadata

- Task ID: PAF-49 (epic "PAF-2 follow-up — Tier 4: features and expansion"; children PAF-35, PAF-39, PAF-41, PAF-48)
- Date (UTC): 2026-10-15T11:51:01Z
- Project: padel-friend
- Branch: feature/PAF-49-tier-4-features-and-expansion (based on main `09ce042`, not yet pushed; working tree clean)
- Commit: 4623fd9 (head, review-fix); unit commits in delivery order: 2381f03 (PAF-35), d836646 (PAF-39), d894228 (PAF-41), b6d5d34 (PAF-48)

## Objective

- Deliver the complete Tier 4 epic: all four child tasks on one branch / one PR targeting main.
  - PAF-35 — harden Supabase type generation (failure-safe write, CI drift check).
  - PAF-39 — public community member counts in discovery (read-model).
  - PAF-41 — concrete contracts for all six admin-design items (implemented or explicitly unsupported).
  - PAF-48 — measured, documented Linux visual residuals for the final admin UI.
- One review-fix commit covering the three-reviewer findings ledger. No Linear identifiers in commit messages or PR text (intake requirement). Coverage thresholds, security/cache rules and Pencil source/mask provenance unchanged.

## Implementation Summary

- **Unit 1 — PAF-35, commit `2381f03` — hardened Supabase type generation.**
  - `pnpm db:types` became `node scripts/db-types.mjs`: generate `public,storage,graphql_public` with the pinned local CLI into a same-volume scratch directory, normalize with the tracked file's oxfmt override, then atomically rename over `database.types.ts` only on success — the tracked file can no longer be truncated by a failed run.
  - New non-mutating `pnpm db:types:check` runs the same pipeline and byte-compares without writing; wired as a stage in `scripts/complete-check.mjs` (before build) and as a named CI step after local Supabase provisioning/reset.
  - The regeneration surfaced and fixed a real pre-existing type drift found on a fresh local reset.
  - Covered by a new dependency-injected test suite (`test/db-types.test.ts`): generator/formatter/partial-output failures, empty output, signal/I/O failures, atomic replace, repeatability, drift detection without mutation.
- **Unit 2 — PAF-39, commit `d836646` — public discovery member counts.**
  - Migration `20261015081833_public_community_member_counts.sql`: `public_community_discovery()` STABLE SECURITY DEFINER RPC returning the existing nine public columns plus `member_count` (active/open memberships only, zero-count communities survive via LEFT JOIN/COALESCE; no roster, settings or private exposure).
  - `listPublicCommunities`/`getPublicCommunity` switched to the RPC with validated boundary DTO (`bigint` → finite non-negative integer, no fabricated fallback zero); types regenerated.
  - Discovery cards render locale-aware counts (`Intl.NumberFormat` + i18next plural keys `memberCount_one/_other`), honest zero, 320px-safe layout; onboarding structural probes updated from "count omitted" to exact count-slot assertions.
  - Tests cover zero/one/many, admin inclusion, pending/inactive exclusion, history counted once, public→private disappearance, search escaping/order/pagination, anon/anonymous/private-admin denial, no settings/created_by/roster leakage.
- **Unit 3 — PAF-41, commit `d894228` — all six admin items (43 files).**
  - **4A implemented** — one-way Admin → pending-applicant request messages + in-app inbox. Migration `20261015084301_community_request_delivery.sql` (`community_request_messages`, `community_notifications`; `send_community_request_message`, `mark_community_notification_read`). Recipient derived from the pending membership, never client-controlled; atomic message+notification insert; idempotent retry via `client_request_id`; read receipts via owned RPC only. New `community-request.functions.ts`, `community-request.validators.ts`, `CommunityInbox.tsx`, `community-inbox.styles.ts` on the dashboard; explicit one-way notice (no replies/email/push/realtime).
  - **4B explicitly unsupported** — member match counts: typed discriminated `unsupportedCommunityMatchSummary()` (`count: null`, `reason: 'match_source_unavailable'`), visible localized marker `communityAdmin.matchCountUnavailable` on Members and member-detail. No fabricated count, no column, no reuse of the unrelated rating metric; future source contract written down.
  - **4C implemented** — settings defaults. Migration `20261015090333_community_admin_defaults.sql`; `settings.admin_defaults = {timezone, currency, member_created_leagues_enabled}` with effective defaults Europe/Madrid / EUR / true; `update_community_admin_defaults` merges only that namespace under a community lock; generic `update_community_settings` hardened against malformed namespaces. New `community-settings.ts`; Base UI Select/Switch controls; real `Intl.NumberFormat` currency preview; league switch is a stored preference with a visible "league creation is not supported yet" note.
  - **4D explicitly unsupported** — league-result audit events: `community_audit_log` CHECK and append-only grants unchanged, no correction endpoint, no synthetic rows; persistent localized notice `communityAdmin.audit.leagueCorrectionsUnavailable`; future event contract documented.
  - **4E implemented** — venue photo upload. Migration `20261015093154_community_venue_photos.sql`: private bucket `community-venue-photos` (2 MiB, JPEG/PNG/WebP, no SVG), scoped object keys, storage policies for member reads / admin uploads / own-unreferenced deletes, RPC `finalize_community_venue_photo` as the only writer of `photo_path` (INSERT/UPDATE grants on that column revoked). Server finalizer verifies magic bytes, size and current authorization; 60-second `no-store` signed previews; no service role. New `venue-photo.ts`, `community-venue-photo.functions.ts`, `community-venue-photo.server.ts`, `VenuePhotoUpload.tsx`.
  - **4F implemented** — opt-in invitee discovery. Migration `20261015094631_community_invitee_discovery.sql`: `community_invitee_directory_preferences` (row presence = explicit global consent, default off), RPC `search_community_invitees(uuid,text,integer)` restricted to a real current Admin of a private community; 3–80 char literal substring, 1–20 results, opt-in-only, excluding self / membership history / live invitations; returns only user ID + display name; withdrawal removes results immediately. New `community-invitee.functions.ts`, `community-invitee.validators.ts`, `InviteeSearch.tsx`, `InvitationDiscoverability.tsx`; dashboard consent control; raw one-time invitation token shown to the issuing Admin with explicit "link delivery unsupported" (no browser acceptance route exists yet).
  - `docs/community-admin-expansion.md` created as the lasting six-item contract/privacy/follow-up record.
- **Unit 4 — PAF-48, commit `b6d5d34` — visual residual evidence.**
  - New `docs/visual/community-admin-residuals.md`: per-screen macOS measurements on this branch (commit `d894228`), historical/inherited Linux CI run evidence clearly separated from final-branch certification, SHA-pinned source PNGs and mask arrays.
  - `e2e/community-admin.spec.ts` now attaches machine-readable per-screen residual JSON (`screen, png, changedPixels, budget, width, height, referenceHash, masksHash, platform, commit`) plus actual/reference PNGs, so the pending PR CI run's Linux numbers are harvestable without re-instrumentation. No assertion, mask or budget touched.
  - Final-branch Linux numbers deliberately left pending the PR's CI run (12 placeholder cells marked accordingly); historical estimates (18,003 / 17,126) never relabeled as measurements.
  - Also applied oxfmt to two test files committed earlier in the series.
- **Review-fix commit — `4623fd9`.**
  - Fixed 22 findings across the ledger (see Validation): hardened venue-photo finalization and storage reads (F1, F3), aligned the settings timezone domain across SQL and TypeScript (F2), server-owned timestamps + pagination/retry for the notification inbox (F4, F5, F16), admin UI state/token/touch-target/geometry corrections (F6–F12, F14, F15, F17–F21), invitee search error/stale-state handling (F13), test-actor corrections (F22).
  - Added migrations `…_harden_community_photo_and_admin_timezones.sql` and `…_community_notification_timezone.sql`; committed `docs/plan/PAF-49-bundle.md` and `docs/plan/PAF-49-findings.md`.

## Files Changed

- Total: 66 files, +5704/−182 vs base `09ce042` (5 commits on one branch).
- Tooling & CI (PAF-35): `package.json` (db:types / db:types:check scripts), `scripts/complete-check.mjs` (new drift stage), `scripts/db-types.mjs` + `scripts/db-types.d.mts` (new failure-safe wrapper), `.github/workflows/ci.yml` (named drift-check step), `test/db-types.test.ts` (new).
- Database migrations (7 new): `20261015081833_public_community_member_counts.sql`; `20261015084301_community_request_delivery.sql`; `20261015090333_community_admin_defaults.sql`; `20261015093154_community_venue_photos.sql`; `20261015094631_community_invitee_discovery.sql`; `20261015110057_harden_community_photo_and_admin_timezones.sql` and `20261015114033_community_notification_timezone.sql` (review fixes).
- Generated types: `src/lib/supabase/database.types.ts` (regenerated across units).
- Discovery (PAF-39): `community.functions.ts`, `community.validators.ts`, `CommunityOnboarding.tsx`, `community-onboarding.styles.ts`.
- Admin expansion (PAF-41): `CommunityAdmin.tsx`, `CommunityAdminViews.tsx`, `community-admin.functions.ts`, `community-admin.types.ts`, `community-admin.validators.ts`, `community-admin.styles.ts`; new `CommunityInbox.tsx`, `community-inbox.styles.ts`, `InviteeSearch.tsx`, `InvitationDiscoverability.tsx`, `VenuePhotoUpload.tsx`, `community-request.functions.ts`, `community-request.validators.ts`, `community-invitee.functions.ts`, `community-invitee.validators.ts`, `community-settings.ts`, `community-venue-photo.functions.ts`, `community-venue-photo.server.ts`, `venue-photo.ts`.
- Routes (thin adapters): `_protected.dashboard.tsx`, `_protected.community.$communityId.admin.requests.tsx`, `_protected.community.$communityId.admin.settings.tsx`.
- Locales: `src/locales/{en,pt-BR,es}/translation.json` (request message, inbox, settings, venue photo, invitee, unsupported-marker keys).
- Tests — new suites: `db-types`, `community.request.functions`, `community.request.integration`, `community.settings`, `community.venue-photo`, `community.venue-photo.integration`, `community.invitee.functions`, `community.invitee.integration`. Edited: `community.discovery.functions`, `community.onboarding`, `community.integration`, `community.admin-ui`, `community.admin.integration`, `community.admin-routes`, `dashboard.loader`.
- E2E: `e2e/community-admin-expansion.spec.ts` (new), `community-onboarding.spec.ts`, `community-admin.spec.ts`, `onboarding.spec.ts`.
- Docs: `docs/plan/Plan PAF-49 …md` (committed with unit 1), `docs/plan/PAF-49-bundle.md`, `docs/plan/PAF-49-findings.md`, `docs/community-admin-expansion.md` (new), `docs/visual/community-admin-residuals.md` (new).

## Key Decisions

- One branch / one PR for the whole epic (user decision): four unit commits in PAF-35 → PAF-39 → PAF-41 → PAF-48 order, plus at most one review-fix commit; each unit left the repository green before committing.
- PAF-41 items 2 and 4 delivered as honest, typed `unsupported` states: no match or league/result producer exists in the schema (Tier 5 / PAF-52 territory), so no fabricated counts, no synthetic audit rows, no zero fallbacks; visible localized markers plus written future producer contracts in `docs/community-admin-expansion.md`.
- Bounded contracts confirmed with the user: request messaging is strictly one-way Admin → pending applicant (recipient derived server-side, idempotent delivery, no replies/email/push/realtime); invitee discovery is opt-in-only (row-presence consent, default off, name + UUID only, private-community Admin only); the league setting is a stored preference with a visible "not supported yet" note, never an operational claim.
- Venue photos use the private-bucket + verified-finalize pattern (player-avatar precedent, feature-local implementation): server-side magic-byte validation as defense in depth, RPC as sole `photo_path` writer, 60s signed URLs, documented Content-Type residual.
- PAF-48's final Linux measurement deferred to the PR's CI run by design: historical main-run numbers recorded as inherited context only, and structured per-screen attachments added so the pending numbers can be harvested directly; no invented or estimated values presented as measurements.
- Review-fix loop ran 3 iterations, one more than the 2-iteration cap, because iteration 2 introduced a Members-screen geometry regression (`memberCardGeometry`, 30px) that had to be corrected rather than left on the branch; all six visual residuals returned under budget.
- No Linear identifiers in any commit message or PR text, per the intake requirement overriding the generic issue-reference convention.

## Validation Performed

- Per-unit fast gates (typecheck, lint, affected vitest suites, affected E2E specs via `pnpm test:e2e`): green at every unit commit.
- Full quality gate on the final state: `pnpm complete-check` — **PASS, 8/8 stages** (`db:types:check`, `build`, `knip`, `typecheck`, `lint`, `format:check`, `test`, `test:e2e`); 506 unit tests across 50+ files with 100% coverage; 81/81 E2E tests on a fresh preview; the gate modified no source file.
- Visual: the complete community-admin E2E (including ±1px structural probes) passed locally; all six admin screen residuals under budget with macOS measured on-branch (Requests 14,898 / cap 18,500; Members 14,198 / 15,500; Member detail 17,397 / 22,000; Settings 16,914 / 22,500; Venues 16,320 / 21,000; Audit 16,153 / 20,000).
- Review: three reviewers (code, architecture, UX/UI) raised 23 findings (F1–F23), all major/minor, no criticals; 22 fixed across 3 fix iterations and recorded in `docs/plan/PAF-49-findings.md`; 1 minor deferred (see Risks).
- Security/privacy coverage exercised in suites: RPC/storage authorization matrices, RLS denials, recipient derivation, idempotent retries, private/signed-URL non-exposure to unauthorized actors, opt-in withdrawal, XSS-literal rendering, cross-community non-exposure.

## Risks and Follow-ups

- **Venue-photo `Content-Type` residual (accepted, documented):** object MIME metadata is client-supplied, so a determined Admin can bypass the server's magic-byte check via a direct RPC call. Mitigated by the private bucket, JPEG/PNG/WebP extension allowlist (no SVG/HTML execution) and 60-second `no-store` signed URLs; a genuinely trusted byte-verification boundary would require a service-role path, which this project forbids. Full analysis in `docs/community-admin-expansion.md` (findings ledger F1 residual).
- **PAF-48 completion pending:** final-branch Linux measurements must be captured from the PR's green `ci.yml` run (harvest the per-screen JSON attachments, record run URL/id, SHA, runner/browser, lockfile hash, then compute headroom). Visual acceptance is not complete until then; historical/inherited numbers must never be relabeled as current.
- **F23 deferred (minor):** the detached stale-response test in `test/community.invitee.functions.test.ts` does not exercise the production component; converting it into a component test with controlled out-of-order responses exceeded the "trivial fix" threshold for this delivery.
- **Environment-limited test cases (documented, not hidden):** a live zero-member community cannot be constructed through the schema/API (every community retains an active Admin; zero rendering is covered at UI level only), and an authenticated anonymous JWT cannot be produced locally (anonymous provider disabled; `anon`-role and unauthenticated denials covered instead).
- **Storage/DB non-atomicity:** failed finalization can leave unreferenced objects; referenced photos are never deleted on replacement. Orphan collection remains a documented follow-up, not an unbounded background job.
- **Invitee-search rate limiting:** abuse-based server rate limiting is a follow-up if evidence warrants; no query/name payloads are logged meanwhile.
- **Invitation acceptance UX:** no browser acceptance route exists, so the Admin UI presents the raw one-time token with explicit "link delivery unsupported"; a delivery UX requires a separately reviewed future contract.

## Related

- Plan: `docs/plan/Plan PAF-49 PAF-2 follow-up — Tier 4: features and expansion.md`
- Context bundle: `docs/plan/PAF-49-bundle.md`
- Findings ledger: `docs/plan/PAF-49-findings.md`
- Admin expansion contracts: `docs/community-admin-expansion.md`
- Visual residuals: `docs/visual/community-admin-residuals.md`
- Child tasks: PAF-35, PAF-39, PAF-41, PAF-48 (one memory per task policy: this epic-level log carries the children's details)
