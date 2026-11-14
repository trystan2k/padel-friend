---
title: PAF-176 Gate production releases and automate database migrations
type: development-log
permalink: docs/development-logs/task-PAF-176-gate-production-releases-and-automate-database-migrations
---

# Development Log: PAF-176

## Metadata

- Task ID: PAF-176 — "Gate production releases and automate database migrations" (Linear PadelFriend project; single issue, no children; delivered as 4 units + review-fix rounds)
- Date (UTC): 2026-11-13
- Project: padel-friend
- Branch: `feature/PAF-176-gate-production-releases-and-automate-migrations` (base `origin/main` `6ee1e9f`)
- Commits (9 on the branch, chronological):
  - `b47390c` — `feat: gate production deploys behind environment approval` (U1)
  - `648a947` — `feat: apply pending supabase migrations before worker deploy` (U2)
  - `1585bc8` — `test: cover release workflow failure paths` (U3)
  - `bac6b97` — `docs: production release and migration runbook` (U4)
  - `1e347bc` — `fix: address review findings` (F1 round 1 + F2)
  - `487cb6e` — `fix: bind migration apply to approved pending marker` (F1 round 2)
  - `a198cb5` — `fix: prove stable approved marker across retry attempts` (F3)
  - `83a90d3` — `fix: qualify retry guidance for no-op releases` (F4)
  - `57a562a` — `test: exempt production migration runner from stack guard` (final-gate fix)

## Objective

- Gate production releases so that every Release Please release (even one with no pending migrations) requires exactly one manual approval on the GitHub `production` environment, and only after successful push-CI on `main`.
- On approval, apply the pending reviewed migrations from the exact release revision to the production Supabase project (`nojecmdknaebczpfnfwa`), then deploy the matching Cloudflare Worker — building only after the database step, and failing closed on any approval, target-identity, or migration failure.

## Implementation Summary

- **U1 (`b47390c`) — release workflow restructure:** `.github/workflows/release.yml` restructured to export an immutable `release_sha` (validated against Release Please CI provenance and the peeled tag commit), followed by a single protected `deploy` job with `environment: production` and a fixed non-cancelling concurrency group `padel-friend-production-release`. Guard steps enforce the exact-tag checkout and an identity/freshness chain (CI SHA = release SHA = tag SHA = fresh remote `main` HEAD), build-before-DB ordering, least-privilege per-job permissions, and credential-step scoping. New `scripts/production-release-guard.mjs` (+ companion `.d.mts`) with injectable boundaries; two test files added; `knip.json` adjusted.
- **U2 (`648a947`) — pending Supabase migrations before Worker deploy:** new `scripts/production-migrations.mjs` (+ `.d.mts`) runs migrations inside an isolated migration-only workdir. The migration manifest (sorted versions + SHA-256, byte-exact) rejects symlink/traversal/duplicate entries. Fail-fast credential preflight (Cloudflare checked names-only so missing deploy credentials cannot advance the schema), CLI `2.121.0` assertion, fresh link plus independent Management-API project-identity verification, then dry-run → equality check → apply → post-apply no-pending verification — all with `--skip-vault`. Errors surface sanitized stage/reason/exit-code only; workdir cleaned up on success and failure.
- **U3 (`1585bc8`) — failure-path coverage:** 12 failure-path scenarios (ineligible triggers, approval containment, exact-bytes apply, no-op path, credential/version rejection, identity/stale failures, CLI failure/timeout/partial-apply, schema-ahead, rerun/fallback rejection, overlap/lock, forbidden flags/injection, secret canaries) via a dependency-free structural workflow parser; schema-ahead surfaces as a sanitized summary warning with `always()` confined to it.
- **U4 (`bac6b97`) — runbook and setup docs:** new `docs/production-release-runbook.md` (11 sections); `INITIAL_SETUP.md` §1/§2.2/§4.4/§4.5/§4.6/§8 (canonical approval-controlled migrations, secret/var table with step scoping, PAT scopes, required GitHub settings including the intentional self-review disclosure); `README.md` deployment updates; `docs/security/release-integrity.md` cross-link; durable plan committed.
- **Review-fix rounds:** `1e347bc` (F1 round 1: migration pending lines + runbook true-pending-set checklist; F2: INITIAL_SETUP policy-constants bullet) → `487cb6e` (F1 round 2: `Approved-pending:` marker in the release body — versions or `none` — written by the reviewer pre-approval; the helper fetches the release for the exact tag via the GitHub API with a step-scoped `GITHUB_TOKEN` (`contents:read`) and requires marker presence + equality with the history-derived pending set before applying; fails closed on missing/ambiguous/malformed/mismatch plus release identity checks `tag_name`/non-draft; failure-path tests + canaries) → `a198cb5` (F3: fixture marker set once so the release body stays stable across attempts; stale-marker fail-closed retry test; explicit marker-update recovery test; partial-apply retry narrows the marker, e.g. `V1,V2 → V2`; runbook §6/§8 retry guidance updated) → `83a90d3` (F4: no-op releases — marker `none` — pass binding unchanged on duplicate/retry; only migration-applying attempts go stale) → `57a562a` (final-gate fix: `test/test-stack-call-sites.test.ts` guard exempted `scripts/production-migrations.mjs` with a justification comment — production project via link/pooler, never the test stack).

## Files Changed

- Workflow and scripts:
  - `.github/workflows/release.yml` (U1 restructure; U2 migration step; F1 round-2 marker binding wiring)
  - `scripts/production-release-guard.mjs` (new, U1 — guard commands: record/verify/credentials)
  - `scripts/production-release-guard.d.mts` (new, U1 — declarations)
  - `scripts/production-migrations.mjs` (new, U2 — isolated workdir runner; F1 round-2 `Approved-pending` binding)
  - `scripts/production-migrations.d.mts` (new, U2 — declarations)
- Tests:
  - `test/production-release-guard.test.ts` (new, U1; extended U3/F3)
  - `test/production-release-workflow.test.ts` (new, U1; structural workflow parser + 12 failure-path scenarios, U3; extended U2)
  - `test/production-migrations.test.ts` (new, U2; extended U3/F1 round 2/F3/F4)
  - `test/test-stack-call-sites.test.ts` (commit `57a562a` — `scripts/production-migrations.mjs` exemption with justification)
- Tooling config:
  - `knip.json` (U1/U2 — `.d.mts` entries for the new scripts)
- Documentation:
  - `docs/production-release-runbook.md` (new, U4, 11 sections; F1 round-1 checklist; F3/F4 §6/§8 retry guidance)
  - `INITIAL_SETUP.md` (U4 §1/§2.2/§4.4/§4.5/§4.6/§8; F1 round-1 migration pending lines; F2 policy-constants bullet)
  - `README.md` (U4 — deployment updates)
  - `docs/security/release-integrity.md` (U4 — cross-link)
  - `docs/plan/PAF-176-findings.md` (U4 — committed findings ledger; F1–F4 tracked to verified)

## Key Decisions

- **Single protected job with one shared non-cancelling lock:** rejected split migration/deploy jobs, tag-scoped concurrency groups, and a persistent coordinator; the `deploy` job with `environment: production` keeps the approval, the lock, and the fail-closed chain in one place.
- **Strict current-`main` freshness:** the release SHA must equal fresh remote `main` HEAD before deploy; availability trade-off documented in the runbook.
- **Marker-based binding of the reviewed pending set:** the reviewer writes `Approved-pending:` (versions or `none`) into the release body before approving; the runner then requires equality with the history-derived pending set — no marker, no mismatch, no apply.
- **Always `--skip-vault`:** Vault updates would otherwise run ahead of migrations (help-verified on Supabase CLI v2.121.0).
- **Cloudflare credentials preflighted names-only before any SQL:** missing deploy credentials can never advance the schema.
- **Migration-only isolated workdir with byte-exact manifest:** sorted versions + SHA-256, symlink/traversal/duplicate rejection, so exactly the reviewed bytes are applied from the exact release revision.

## Validation Performed

- Per-unit fast gates: green for each of U1–U4.
- Final gate: `pnpm complete-check` PASS on `57a562a` — static (build/knip/typecheck/lint/format), unit 4215/4215 (0 skipped), integration 1240 passed + 1 skipped, e2e 545/545. First gate run failed on the test-stack call-sites guard (fixed in commit `57a562a`) plus one environment-induced statistics-history flake (schema-less DB during abnormal stack recovery; cleared on rerun — not a code defect).
- `actionlint` 1.7.12 pass on `.github/workflows/release.yml`.
- Review: code-review (full + 3 delta rounds) and architecture review (pass, no findings). Findings ledger `docs/plan/PAF-176-findings.md`: F1 major/required (pending-set binding, 2 rounds, verified), F2 minor/required (policy constants, verified), F3 major/required (retry fixture stability, verified), F4 minor/required (no-op retry qualification, fixed directly). All findings fixed and verified.
- `preview.yml` hash-identical throughout (SHA-256 `da3e15f7…ad16`) — preview path untouched.

## Risks and Follow-ups

- **External, owner-verified (explicitly NOT follow-up issues):**
  - GitHub environment protection/settings effectiveness on the `production` environment must be confirmed in the live repo settings.
  - Secret values/validity/scopes: `SUPABASE_ACCESS_TOKEN` scope, DB password, Cloudflare token, and `RELEASE_PLEASE_TOKEN` functional test (secret exists but is untested).
  - Live approval + rollout observation is explicitly pending — never trigger a real release just to test the flow.
  - `pg_cron` baseline (6 jobs) must be verified at the first real approval.
- **PAF-177 (backups)** is not a blocker for alpha.
- **Session note:** implementation + delta reviews hit repeated token/session rate limits on 2026-11-13 (~16:20–17:00Z); recovered via failover plugin + reset-window waits; no work lost.
