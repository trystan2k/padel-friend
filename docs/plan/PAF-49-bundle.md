# PAF-49 — Context Bundle (Tier 4: features and expansion)

Single source of context for the reviewers and fixers of this delivery. Read this instead of
re-deriving context from the repository.

## Scope

- **Linear epic**: PAF-49 — "PAF-2 follow-up — Tier 4: features and expansion" (project `PadelFriend`).
- **Epic description**: "Post-PAF-2 hardening follow-ups, Tier 4: features and expansion. This epic
  groups the child tasks below." The epic carries **no acceptance criteria of its own**; each child
  carries its own. The epic is a pure grouping epic.
- **Branch**: `feature/PAF-49-tier-4-features-and-expansion`, based on `main`
  (`09ce042d6cb0f43b674bcfe34868d6d4b804f4ea`).
- **Plan file**: `docs/plan/Plan PAF-49 PAF-2 follow-up — Tier 4: features and expansion.md`
  (note the U+2014 em dash in the filename).
- **Delivery shape**: one branch, one PR, one commit per child (4 units), plus at most one
  review-fix commit. No Linear identifier appears in any commit message or in the PR.

### User decisions taken before implementation

1. All four children land in this one branch/PR.
2. PAF-41 must address **all six** admin-design items. Two of them (member match counts,
   league-result audit events) have **no producer in the schema** (no matches table, no
   league/result table — those belong to Tier 5 / PAF-52), so the user approved delivering them
   as typed `unsupported` states with visible localized markers, negative tests and written future
   contracts, rather than fabricating counts or audit rows.
3. Bounded contracts confirmed: request messages are **one-way** Admin → pending applicant (no
   replies/email/push/realtime); invitee discovery requires **explicit per-player opt-in**, default
   off, returning only display name + UUID to a private-community Admin; the league setting is a
   **stored preference only** with a visible "league creation is not supported yet" note.

## Units of work

Order of execution was PAF-35 → PAF-39 → PAF-41 → PAF-48. Each unit left the repo green before
being committed.

### Unit 1 — PAF-35 · commit `2381f03`

"PAF-33 follow-up: harden Supabase type generation (CI drift check, failure-safe write)."

Acceptance criteria:

- [ ] CI (or a script) fails when committed generated types drift from the schema.
- [ ] `pnpm db:types` cannot leave the tracked types file truncated on failure.
- [ ] `pnpm complete-check` passes.

Files: `.github/workflows/ci.yml`, `package.json`, `scripts/complete-check.mjs`,
`scripts/db-types.mjs`, `scripts/db-types.d.mts`, `test/db-types.test.ts`,
`src/lib/supabase/database.types.ts`, `docs/plan/Plan PAF-49 …md` (plan lands in the first commit).

What changed: `db:types` became `node scripts/db-types.mjs` — generate to a same-volume scratch
directory, normalize with the tracked file's oxfmt override, then atomically rename over the
destination only on success. `db:types:check` runs the same pipeline and byte-compares without
writing. Added a non-mutating drift stage to `scripts/complete-check.mjs` (before build) and a
named step in CI after local Supabase provisioning. The regenerated `database.types.ts` reflects a
real pre-existing drift found on a fresh local reset.

### Unit 2 — PAF-39 · commit `d836646`

"Discovery follow-up: public community member count (read-model)."

Acceptance criteria:

- [ ] A `SECURITY DEFINER` read-model exposes `member_count` only for public communities; private
      communities are not exposed or countable.
- [ ] `listPublicCommunities`/`getPublicCommunity` return `member_count`; types regenerated.
- [ ] Member counts render on discovery cards with locale-aware formatting.
- [ ] Unit + integration tests cover counts and private-community non-exposure.
- [ ] `pnpm complete-check` passes.

Files: `supabase/migrations/20261015081833_public_community_member_counts.sql`,
`src/features/community/community.functions.ts`, `community.validators.ts`,
`CommunityOnboarding.tsx`, `community-onboarding.styles.ts`,
`src/lib/supabase/database.types.ts`, `src/locales/{en,pt-BR,es}/translation.json`,
`test/community.discovery.functions.test.ts`, `test/community.onboarding.test.tsx`,
`test/community.integration.test.ts`, `e2e/community-onboarding.spec.ts`.

Known coverage limits accepted for this unit (reported honestly by the implementer, not silently
dropped):

- A live zero-member community cannot be constructed through the schema/API because every community
  retains an active Admin, and the local role denies disabling triggers. Zero rendering is covered
  at the UI level; the RPC's `LEFT JOIN`/`COALESCE` zero path is not exercised live.
- Local Auth has anonymous sign-in disabled (`anonymous_provider_disabled`), so an authenticated
  anonymous JWT cannot be produced locally; the `anon` role EXECUTE denial and unauthenticated
  RPC denial are covered instead.

### Unit 3 — PAF-41 · commit `d894228` (43 files)

"PAF-31 follow-up: backend support for unsupported admin-design elements."

Acceptance criteria:

- [ ] Each item gets a concrete schema/contract.
- [ ] RLS/authorization and privacy defined for each new surface.
- [ ] Admin UI updated to surface the new data **or explicitly marks items intentionally
      unsupported**.
- [ ] `pnpm complete-check` passes.

Delivered per item:

- **4A (implemented)** — one-way Admin → pending-applicant request messages with an in-app inbox.
  Migration `20261015084301_community_request_delivery.sql`: tables `community_request_messages`,
  `community_notifications`; RPCs `send_community_request_message(...)`,
  `mark_community_notification_read(...)`; recipient derived from the pending membership, not the
  client; atomic message+notification insert with idempotent retry. New files:
  `community-request.functions.ts`, `community-request.validators.ts`, `CommunityInbox.tsx`,
  `community-inbox.styles.ts`, `test/community.request.functions.test.ts`,
  `test/community.request.integration.test.ts`, `e2e/community-admin-expansion.spec.ts`.
- **4B (explicitly unsupported)** — member match counts. Typed discriminated state in
  `community-admin.types.ts` (`unsupportedCommunityMatchSummary()`), visible localized marker
  `communityAdmin.matchCountUnavailable` on the Members screen (section-level, after the list) and
  inside the member-detail profile metric row. No fabricated count, no column, no reuse of the
  unrelated rating metric.
- **4C (implemented)** — settings defaults. Migration `20261015090333_community_admin_defaults.sql`;
  `settings.admin_defaults = {timezone, currency, member_created_leagues_enabled}` with effective
  defaults `Europe/Madrid` / `EUR` / `true`; `update_community_admin_defaults(...)` merges only that
  namespace under a community lock; the generic `update_community_settings` validation was extended
  so it cannot store a malformed namespace. New `community-settings.ts`, `test/community.settings.test.ts`.
  Currency is a real `Intl.NumberFormat` preview; the league switch is a stored preference with a
  visible "not supported yet" note.
- **4D (explicitly unsupported)** — league-result audit events. `community_audit_log` CHECK and
  append-only grants unchanged; no correction endpoint and no synthetic event; persistent localized
  notice `communityAdmin.audit.leagueCorrectionsUnavailable` in the audit screen's approved
  adapted band.
- **4E (implemented)** — venue photo upload. Migration
  `20261015093154_community_venue_photos.sql`: private bucket `community-venue-photos`
  (2 MiB, JPEG/PNG/WebP), storage policies `community_venue_photos_select|insert|delete`,
  RPC `finalize_community_venue_photo(uuid, uuid, text)`; `photo_path` INSERT/UPDATE grants revoked
  so the RPC is the only writer. New `venue-photo.ts`, `community-venue-photo.functions.ts`,
  `community-venue-photo.server.ts`, `VenuePhotoUpload.tsx`, two test files. Server-side magic-byte
  validation, 60s signed URLs, no service role.
- **4F (implemented)** — opt-in invitee discovery. Migration
  `20261015094631_community_invitee_discovery.sql`: table
  `community_invitee_directory_preferences` (row = consent), RPC
  `search_community_invitees(uuid, text, integer)` restricted to a current Admin of a private
  community, literal substring match, opt-in-only, excluding self, prior membership and live
  invitations. New `community-invitee.functions.ts`, `community-invitee.validators.ts`,
  `InviteeSearch.tsx`, `InvitationDiscoverability.tsx`, two test files.

Also in this unit: `docs/community-admin-expansion.md` (the six-item contract/privacy/follow-up
record), route adapters `src/routes/_protected.dashboard.tsx`,
`…admin.settings.tsx`, `…admin.requests.tsx`, and the extended admin test suites plus 3 new
expansion E2E flows.

Known coverage limits: an authenticated anonymous JWT is unavailable locally (provider disabled);
one integration test asserts only the process-level anonymous denial. Documented, not hidden.

### Unit 4 — PAF-48 · commit `b6d5d34`

"Calibrate and document Linux CI visual residuals for the admin screens."

Acceptance criteria:

- [ ] Capture the Linux measured residual per admin screen from a green CI run.
- [ ] Document each budget's macOS + Linux basis and margin.
- [ ] Confirm structural ±1px probes still pass; do not widen budgets to mask defects.
- [ ] `pnpm complete-check` passes.

Files: `e2e/community-admin.spec.ts` (attachments only — no assertion, mask or budget touched),
`docs/visual/community-admin-residuals.md` (new), plus `test/community.invitee.integration.test.ts`
and `test/community.request.integration.test.ts` (oxfmt only).

**Status: partial, by design and disclosed.** The six macOS values are measured locally on this
branch. The six Linux values documented so far are **historical/inherited** from green `main` CI run
[38620390782](https://github.com/trystan2k/padel-friend/actions/runs/38620390782) at SHA `09ce042`
— a run that predates this branch's admin layout and therefore cannot certify it. The
**final-branch Linux measurement is still pending** and requires a green CI run on this branch
(which only exists after the PR is opened). The document marks 12 placeholder cells accordingly.
The visual-diff helper now attaches per-screen JSON (`screen, png, changedPixels, budget, width,
height, referenceHash, masksHash, platform, commit`) plus actual/reference PNGs, so the CI run's
numbers are harvestable without re-instrumenting.

## Gates

- **Fast gate per unit** (run by each implementer): `pnpm typecheck`, `pnpm lint`, the affected
  `test/**/*.test.ts` files, and the affected E2E specs. All green at unit-commit time.
- **Uncommitted fix set** (gate- and review-driven, not yet committed at bundle time):
  `e2e/community-onboarding.spec.ts`, `e2e/onboarding.spec.ts`,
  `src/features/community/CommunityAdminViews.tsx`, `test/db-types.test.ts`.
  - `knip` failures (unused `scripts/db-types.d.mts`, unused export
    `unsupportedCommunityMatchSummary`) resolved by wiring real consumers, not by ignoring.
  - 5 dashboard locator collisions: the new consent checkbox and inbox `h2` render outside `<main>`,
    so the pre-existing queries were scoped to `main`. No assertion weakened.
  - 1 discovery-card geometry drift: the probe expectations had been adapted (+19px) to a random-UUID
    name wrapping to two lines. Fixed back to the **design-derived 142px** frame geometry (matching
    the sha-pinned dSEX3 structural test) with realistic short fixture names. The probe is stricter
    than the version first committed.
- **Full gate** (`pnpm complete-check`, run by `qa-gate-specialist` on the final code state):
  **PASS, 8/8 stages** — `db:types:check`, `build`, `knip`, `typecheck`, `lint`, `format:check`,
  `test` (50 files / 502 tests, 100% coverage), `test:e2e` (81/81 on a fresh preview). The gate
  modified no source file (pre/post `git status --porcelain` identical).

## Diff

Review the change set with:

- committed work: `git diff 09ce042d6cb0f43b674bcfe34868d6d4b804f4ea..HEAD` (61 files, +4735/−159)
- the uncommitted fix set: `git diff`

Per-unit commits: `2381f03`, `d836646`, `d894228`, `b6d5d34`.

## Review scope

Changed areas: `src/features/community/**`, `src/routes/**` (3 route adapters),
`src/locales/{en,pt-BR,es}/translation.json`, `src/lib/supabase/database.types.ts`,
`supabase/migrations/**` (5 new), `scripts/**`, `.github/workflows/ci.yml`, `package.json`,
`test/**` (11 new suites + edits), `e2e/**` (2 new/edited specs), `docs/visual/**`,
`docs/community-admin-expansion.md`.
