## Task Analysis

- Main objective: Deliver PAF-176, **Gate production releases and automate database migrations**, on `feature/PAF-176-gate-production-releases-and-automate-migrations`, based on caller-confirmed `origin/main` @ `6ee1e9f`. Successful push-CI on main → Release Please publication → one manual `production` approval → pending migrations from approved release revision → matching Worker deployment. Publication may precede approval; production changes may not.
- Identified dependencies:
  - Existing GitHub `production` environment and reviewer `trystan2k`; protection settings live outside repository. Secret names exist, but values, scopes and functionality remain unverified.
  - Environment secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`. Environment public variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`. Expected project: `nojecmdknaebczpfnfwa`.
  - Repository `RELEASE_PLEASE_TOKEN` now exists but remains untested. Run `43334601542` failed before publication because it was absent; never rerun that historical workflow as a test.
  - Existing frozen lockfile resolves Supabase CLI **2.121.0** from `~2.121.0`; preserve that installed version and assert it. CLI version/flag checks require implementation-time shell execution; planner deliberately performed none.
  - Owner-controlled hosted credential preflight and environment-protection inspection are required external verification, not satisfiable by offline tests. Explicit unblocking conditions appear below.
  - PAF-177 production backups explicitly **not an alpha blocker**. No backup automation or verified production recovery supplied by this issue.
- System impact:
  - Production delivery/control plane only. No application UI, locale, schema migration, seed, Auth provider, Vault provisioning or preview changes intended. Accessibility/i18n checks not applicable: no user-facing application changes.
  - Intake: no production Worker yet, local/remote migration versions matched, six production pg_cron jobs active. Historical observations, not guarantees about current state; recheck before first approved release.
  - Failures can leave production schema ahead of deployed Worker. Existing Worker and autonomous cron jobs must tolerate every migration before new Worker starts.
  - Completion-First Policy read in `.opencode/agents/delivery-orchestrator.md`: complete all required/related work here. Missing required external proof remains blocked, not silently deferred. No automatic follow-up issue creation; unrelated advisor findings remain separate observations.

### Repository evidence

| Path | Observed pattern / implication |
| --- | --- |
| `.github/workflows/release.yml` | 51 lines; successful push-CI/main predicate; checkout CI head for Release Please; root-package outputs `release_created`/`tag_name`; `deploy` already names `production`; checkout exact tag; frozen pnpm install/build/production Wrangler deploy. No migration operation. |
| `.github/workflows/preview.yml` | Separate preview environment; same-repository, successful Release Please PR-CI only; deploys `--env preview`. Keep unchanged. |
| `release-please-config.json`, `release-please-manifest.json` | Single root Node package, version 0.1.0. Preserve output semantics; do not invent monorepo-prefixed outputs. |
| `package.json`, `pnpm-lock.yaml` | Node 26, pnpm 12.13.0; Supabase already installed and frozen at 2.121.0. No new CLI installer/latest version needed. |
| `scripts/ci-test-env.mjs`, `.d.mts`; `test/ci-workflow.test.ts` | Small importable ESM helpers, injectable executors/output, companion declarations; Vitest uses fake executors/temp fixtures and static workflow contract checks. Reuse structure. |
| `vitest.unit.config.ts`, `tsconfig.json` | `test/**/*.test.ts` enters DB-free unit lane; `.integration.test.ts` excluded. Companion `.d.mts` needed for typed helper imports. |
| `knip.json` | Explicit existing helper-declaration ignores. Add analogous narrowly scoped entries only if required by new declarations/entry detection. |
| `supabase/config.toml` | Local-only ports, OAuth stub and email templates present. Never push or copy this configuration into hosted migration operation. |
| `supabase/migrations/` | Existing migrations create cron jobs. Pending SQL requires review for compatibility/side effects; migration runner cannot promise arbitrary SQL is safe. |
| `INITIAL_SETUP.md` §2/§4 | Current setup describes manual push then direct tag deployment; must describe new approval/migration flow and correct secret scopes. |
| `docs/security/release-integrity.md` | Historical local rehearsal runbook; existing code-rollback/schema warning useful. Do not rewrite historical evidence or mislabel local backup proof as production proof. |
| `docs/production-backup-plan.md` | PAF-177 explicitly not implemented; temporary alpha data-loss acceptance already recorded. Link, do not turn into new release prerequisite. |

## Chosen Approach

- Proposed solution: Keep existing release/deploy jobs. Preserve existing environment gate, place migration and Worker operations in that **one** protected deploy job, and add small importable guard/migration helpers with offline tests. Fixed production-job concurrency group spans checkout through migration and Worker completion; `cancel-in-progress: false`. Validate immutable tag/CI/SHA identity and reject stale revisions after approval, before migration and again before deployment.
- Justification for simplicity:
  1. **Chosen:** one environment job, two focused helpers, native GitHub approval/locking, frozen existing CLI. No second approval, second deployment workflow, database release ledger or new service.
  2. **Rejected:** separate migration/deployment environment jobs. Splits critical section, risks approval duplication and races unless introducing more orchestration.
  3. **Rejected:** concurrency alone or “latest” checkout. Lock ordering is not release ordering; tag-specific groups permit overlapping production changes; moving main checkout breaks approval-to-revision identity. Persistent custom release coordinators are unnecessary given protected linear main and conservative freshness rejection.
- Components to be modified/created:
  - U1: `.github/workflows/release.yml`; new `scripts/production-release-guard.mjs`, `scripts/production-release-guard.d.mts`, `test/production-release-guard.test.ts`; initial `test/production-release-workflow.test.ts`; narrowly scoped `knip.json` adjustments if required.
  - U2: `.github/workflows/release.yml`; new `scripts/production-migrations.mjs`, `scripts/production-migrations.d.mts`, `test/production-migrations.test.ts`; necessary helper declaration/Knip integration only.
  - U3: expand those three new test files; optionally add `test/helpers/production-release-fixtures.ts` if repeated fixtures warrant it. No standalone test framework or new workflow.
  - U4: `INITIAL_SETUP.md`; new `docs/production-release-runbook.md`; small cross-link in `docs/security/release-integrity.md`; this durable plan included with documentation commit.
  - Default no `package.json`, lockfile or other CI workflow edits. Existing regex workflow tests are available; a YAML dependency is not needed by default. If structured parsing becomes necessary, declare direct dev dependency following `.npmrc`, update lockfile in U3, and explain necessity.

### Release safety contract

1. Existing successful **push** CI/main predicate remains. Add same-repository/head-branch checks where necessary to make provenance explicit. Non-success CI, PR CI, other branches/repositories and `created != 'true'` never enter production job.
2. After Release Please returns a tag, resolve its peeled commit, record immutable `release_sha` as job output, verify it matches triggering successful CI `head_sha`. Reject absent/malformed outputs or tag mismatch; do not deploy a release for another unvalidated revision. Pass tag/SHA through environment/data arguments safely, never interpolate untrusted values into shell source.
3. Protected deploy job checks out **`refs/tags/<release output>`**, not main. Validate checkout HEAD against recorded SHA; reread remote tag to detect mutation. Require checked-in helper scripts to exist at that revision. A historical pre-change tag is unsupported and must not fall back to main's scripts.
4. Use fixed deploy-job group such as **`padel-friend-production-release`** with `cancel-in-progress: false`. No tag/run/ref in group. Keep preview outside group. Do not cancel an active migration for newer release. Default pending replacement can cancel older waiting jobs; GitHub concurrency is not a guaranteed delivery FIFO. Document cancelled queued releases as not deployed.
5. Conservative freshness policy: triggering CI SHA, recorded release SHA, checked-out tag SHA and freshly fetched remote **main HEAD must agree** before any migration and immediately before Wrangler deployment. This rejects any older rerun after main advances, including when another release is approved first. Resolve remote refs without shell injection; inaccessible refs/API/network fail closed. Protected main must prohibit force pushes/deletion; release tags must be immutable. Revalidate remote tag at both boundaries.
6. Consequence of strict freshness: even an unrelated new main commit invalidates waiting old releases. Finish/release latest main through normal Release Please flow; do not bypass guard to deploy historical code. If main advances during migration, stop before Wrangler and report schema-ahead state. This availability trade-off is deliberate, conservative, and must be documented rather than hidden.
7. Shared lock means no other participating release deploy can complete between freshness check and Wrangler. A main update in that short interval does not itself deploy a newer Worker; it cannot cause rollback of an already deployed newer participating release. Lock cannot coordinate manual Dashboard/Wrangler/SQL changes or historical workflows lacking lock; disallow concurrent manual production writers and retire unsafe pending historical runs.
8. Duplicate run for same current SHA may safely redeploy same app; already recorded migrations become no-op. Older revision always fails freshness. Preserve `needs.release.outputs` for **rerun failed deploy job**, not rediscover “latest” revision. Full-workflow rerun may make Release Please return `created=false`; it must not invent a deployment fallback.
9. Only normal success chaining reaches Wrangler: no deploy `always()`, `continue-on-error`, ignored exit status or skip-migration override. `always()` allowed only for cleanup/redacted summary, never mutation. Denied/cancelled environment review prevents all protected steps from starting.

### Credentials, tooling and mutation boundaries

- Use current lock-resolved CLI via `pnpm exec supabase`; assert exact **2.121.0** before linking. Frozen lockfile pins transitive install. No `latest`, unpinned `npx`, separate auto-upgrading install or v3 migration in this scope.
- Implementation must run safe local `pnpm exec supabase --version`, `--help`, `link --help`, `db push --help`, `migration list --help` (if used). Record version/help-derived flags. Current online docs describe v3, **not authoritative v2 syntax**.
- Intended command shape, contingent on installed help: `pnpm exec supabase --workdir <isolated-dir> link --project-ref nojecmdknaebczpfnfwa`; `... db push --linked --dry-run`; `... db push --linked --yes`; `--skip-vault` only if 2.121.0 help confirms support. Never guess `--remote` from v3 docs. Both preview and apply must use identical target/workdir/side-effect exclusions.
- Create fresh runner-temp Supabase workdir, containing minimal deployment-only configuration and regular-file copies of **only** release checkout `supabase/migrations/*.sql`. Explicitly disable seeds in minimal config if supported; no seed/roles/templates/functions/local `.env` files copied. No root config, OAuth stub, local test workdir/symlinks, schema paths or pre-existing `.temp` state.
- Reject migration symlinks, duplicate/malformed version names and traversal/non-file entries. Manifest sorted versions and SHA-256 hashes ties reviewed files to revision; emit safe version/hash metadata only. Copy bytes unchanged; verify copied manifest before apply.
- Expected project ref is nonsecret checked-in policy constant. Require exact `https://nojecmdknaebczpfnfwa.supabase.co` public build URL and publishable-key shape, but do not log key. Validate required credential presence before any remote call; no secret-bearing arguments, URLs, command echo, debug or shell tracing.
- Fresh `link` targets literal expected ref. Independently verify Management API project identity via exact-project read and linked project-ref metadata before push; verify any cached endpoint/account routing generated by CLI against that ref using pinned version's documented format. Never trust caller-provided ref or URL as sole target proof. Do not enumerate all projects/keys into logs. Fail closed on missing/ambiguous identity or malformed API responses.
- Restrict `SUPABASE_ACCESS_TOKEN` to expected project and **Project Settings Read, API Keys Read, API Key Secrets Read** required by current Supabase `link` guidance; verify actual pinned CLI calls. Add only permissions demonstrated necessary. Project-list account scope unnecessary if exact-project identity endpoint used.
- Database-password `db push` uses DB privileges, **not token permission boundaries**. Document broad DB authority and environment gate as security boundaries; do not call scoped PAT a SQL least-privilege guarantee.
- Supabase credentials exist only on migration step; Cloudflare credentials only on credential-validation/deploy step. Build/install must not inherit either private pair. Preflight all required names early through nonprinting presence checks; do not export them job-wide or to `GITHUB_ENV`. Release PAT confined to Release Please job; deploy job needs contents read for refs, not PAT/repository write.
- Capture child-process output and errors privately in memory, using argument arrays (no shell), bounded timeouts and sanitized stage/reason/exit-code errors. Do not dump raw stderr, `Error.cause`, SQL, connection strings or API responses. Allowlist safe tag/SHA/migration IDs/hashes/counts/result statuses in summaries; masks are defense-in-depth, not substitute for sanitization.
- `db push --dry-run` validates pending set and history consistency without applying SQL; do not confuse it with executing migrations or proving SQL compatibility. No pending migrations still requires approved job, successful target/credential/preflight checks and successful no-op push before Worker deploy.
- Never run reset/repair/pull/config push/seeds/roles/Vault-secret sync. Do not pass `--include-all`, `--include-seed`, `--include-roles` or debug. If CLI lacks `--skip-vault`, minimal config must contain no Vault entries; confirm pinned source/help/default behavior and test omission. If exclusion cannot be established, **block U2**, do not silently accept unintended mutation.
- Remote history ahead of checkout, gaps/out-of-order pending migration, malformed dry-run/history output or unsupported pending plan must stop. Do not auto-repair history or force old migrations through. Confirm pinned CLI behavior with help/source and fixture tests rather than assuming JSON output support.

## Implementation Steps

1. **Prerequisite checkpoint — no production changes.**
   - Verify caller branch/base and working tree through git owner; preserve unrelated files. Implementation bootstraps Serena and uses Serena MCP for all code reads/edits/new files. Indent 2 spaces; kebab-case helpers/tests; do not modify `.env*` or commit credentials.
   - Inspect pinned CLI help locally with no hosted credentials; preserve safe command/version/flag evidence in delivery bundle. Verify `--dry-run`, explicit linked target, noninteractive confirmation and Vault behavior. If dry-run/required exclusions unsupported, return blocker before implementing an unsafe fallback.
   - Owner checks GitHub repository Settings → Environments → `production`: required reviewer `trystan2k`, effective protection on workflow-run ref `main`, secrets/variables correctly environment-scoped, no unintended bypass. **Prevent self-review must remain disabled intentionally** so `trystan2k` can approve own deployments; disclose weaker separation of duties. Branch protections/rulesets prohibit main rewrites and tag rewrites; environment branch allowlist accounts for workflow ref being main despite tag checkout.
   - Confirm environment public URL identifies expected ref; scoped PAT permissions from token configuration; DB password/Cloudflare identity intended account. Presence-only inspection does not validate values. If checks cannot be performed, report external prerequisite as blocked, not passed.
   - No historical release rerun, release-PR merge, `pnpm deploy`, hosted mutating CLI or test hitting production permitted. No user approval needed merely to implement repo code; hosted validation authorization is separate.

2. **U1 — Workflow gate, identity and ordering.**
   - Modify only release workflow plus U1 helpers/tests/declaration and necessary Knip integration. Retain CI trigger/predicate, root Release Please config/token/output names, exact tag checkout, pnpm/Node/build behavior.
   - Export/validate immutable release SHA after Release Please. Implement injectable `production-release-guard.mjs` command/functions for validating event/release/tag/head data and fresh remote-main/tag checks; companion declarations expose narrow contracts to tests. Errors reason-only.
   - Keep one `environment: production` job; fixed noncancelling concurrency; explicit job-level least permissions. Job label/summary identifies candidate release tag/SHA so reviewer can inspect exact SQL diff before approving.
   - Job sequence: approval → exact checkout + identity/freshness → install/version/credentials/build preflight → reserved migration insertion point (U2) → fresh identity/freshness → Wrangler. Build before DB mutation reduces schema-ahead failures; migration insertion immediately precedes final guard/deploy.
   - Add baseline workflow contract tests and guard happy-path/identity/stale failures now; do not defer all new-behavior tests to U3.
   - **Checkpoint:** fast gate green; static graph proves no production operation outside protected job, group independent of tag/ref/run, no cancellation of active deployment, provenance and tag identity preserved. Compare preview file to baseline unchanged.
   - Commit exactly U1 files: `feat: gate production deploys behind environment approval`.
   - **Risk/mitigation:** U1 commit alone is not finished release safety; no push/merge/deploy between units. Main advancement intentionally rejects old candidates; documented forward-release recovery, no freshness override.

3. **U2 — Pending-only migration operation.**
   - Implement `production-migrations.mjs` with narrow injectable process/HTTP/filesystem/output boundaries and companion `.d.mts`; add focused tests in same unit. Default CLI execution only in direct entry point, never import side effect.
   - Implement fail-fast private/public credential checks, version assertion, isolated migration-only workdir/manifest, exact-project read/link/metadata validation, pinned dry-run, apply and post-apply no-pending/history verification. Use explicit target and verified help flags; record safe applied/no-op counts. Cleanup isolated metadata/workdir on success/failure; never upload it.
   - Wire helper before Wrangler in protected job. Migration helper failure/nonzero stops job; final freshness guard must still pass. Worker receives only Cloudflare env. No private credentials during pnpm install/build; retain public VITE build variables.
   - Preflight validates missing Cloudflare names before SQL so known missing deployment credentials do not unnecessarily advance schema. No claim that presence checks prove deployment authorization.
   - Check default CLI behavior around remote history mismatches and Vault sync using pinned source/help; freeze sample sanitized output fixtures for any parsing. Unexpected output must fail, never infer success. Verify file manifest after preflight before apply.
   - Add baseline successful pending/no-op, wrong target, missing credentials, dry-run failure, push failure, cleanup and secret-leak regression tests.
   - **Checkpoint:** mocked traces show only expected commands in correct order, password/token never in args/output; seed/config/OAuth/Vault inputs absent; failure prevents apply or downstream deployment as appropriate.
   - Commit exactly U2 files: `feat: apply pending supabase migrations before worker deploy`.
   - **Elevated risk:** SQL may partially advance schema across files before failure. Fail closed on Worker, record safe last-known stage; operator investigates before retry. Never rollback DB automatically or repair history.

4. **U3 — Complete offline failure-path proof.**
   - Extend `test/production-release-workflow.test.ts`, `test/production-release-guard.test.ts`, `test/production-migrations.test.ts`; extract fixture builders only if reused. Follow existing Vitest/node helper test patterns.
   - Workflow contract tests extract release/deploy jobs/steps (existing `test/ci-workflow.test.ts` convention); assert trigger/provenance, output plumbing, single protected job, exact tag checkout/SHA checks, fixed lock, fail-closed success chaining, credential step scope, build-before-DB, migration-before-Worker and final freshness guard. Assert preview workflow contract unchanged. Use structural parser if regex cannot unambiguously establish contract; do not create brittle false proof.
   - Use fake refs, fake project responses, temporary fake migrations, fixture CLI output, injected executor throwing at selected stages and fake secret canaries. No real child CLI/API/Cloudflare invocation inside unit tests. Explicitly prevent default production executor/fetch from being reached in tests.
   - Required test scenarios:
     1. Failed/cancelled CI, PR/foreign/non-main CI, false/missing release output: no eligible production job.
     2. Pending approval, rejected approval, cancelled approval: all mutating steps structurally confined to inaccessible protected job; document GitHub enforcement proof boundary, not fake platform emulation.
     3. Approved valid release with pending files: exact copied bytes/hashes/target; migration success before deploy prerequisite.
     4. Approved no-migration release: same environment gate, successful checked no-op; no alternate deploy branch.
     5. Each missing credential/public variable, malformed URL/key, invalid CLI version: fail before mutation; names/reason only.
     6. Wrong expected/API/linked project, stale/mutated tag, mismatched checkout/CI SHA, failed identity lookup: no push/deploy.
     7. Dry-run/history/push/post-check failure, malformed output, partial multi-file failure, timeout: no downstream Worker; sanitized stage evidence, cleanup; no repair/reset.
     8. Worker failure after migration: schema-ahead state reported; same-SHA retry sees no pending files, older retry rejected.
     9. Duplicate current-SHA jobs and failed-job reruns: same approved revision, idempotent migration/no-op; rerun-all created=false never deploys by fallback.
     10. Overlapping releases A/B: fixed lock shared; if B runs first then A stale guard rejects; if main advances during A's migration then final guard blocks A Worker. Queue replacement never cancels active mutation; not asserted FIFO.
     11. Symlink/traversal/duplicate migration versions, config/seed/roles injection, remote history ahead, out-of-order/malformed plans: reject; forbidden commands/flags never executed.
     12. Secret-bearing stdout/stderr/exception and HTTP errors: synthetic PAT/password/Cloudflare canaries absent from logs/summaries/args/artifact candidates. Build receives no private credentials.
   - **Checkpoint:** contract assertions linked to real workflow/helper commands, not disconnected model. Platform approval/concurrency enforcement cannot be proven by Vitest; settings evidence and controlled live observation remain separate.
   - Run actionlint against release workflow **if installed/available**, record version/results; otherwise record unavailable and use workflow contract tests plus GitHub workflow validation at normal PR/push. Never “test” workflow by triggering production. No change to other CI workflows required.
   - Commit exactly U3 files: `test: cover release workflow failure paths`.

5. **U4 — Setup and production runbook.**
   - Update setup §2/§4 to make automated approval-controlled migrations canonical; manual bootstrap/recovery commands explicitly owner-authorized exceptions, never normal bypass. List exact environment/repository secret names, public vars, expected ref, narrow PAT scopes, Cloudflare permissions and required GitHub external settings. Cross-link runbook.
   - New runbook sections:
     - CI → publication → single approval → identity/preflight/build → pending migrations/no-op → Worker → verification. Published GitHub release alone is not proof of deployment.
     - Reviewer checklist: tag/CI SHA, full pending SQL diff, manifest, target, compatibility with old Worker/cron, destructive/locking/backfill assessment, credential validity, no secrets or local config in plan. Pending migrations at approval are inspected through release history diff/dashboard; after approval dry-run must agree or fail.
     - Expand/contract sequencing: additive nullable fields/defaults first; no destructive rename/drop or incompatible RPC changes while previous Worker runs; backfills/contract only in later reviewed releases after compatibility is established. Active six-cron baseline must be verified, not seeded away. Dry-run is not a compatibility execution test.
     - Exact pinned CLI version, help-verified commands and sanitized helper output. Safe owner preflight verifies scoped `link` plus `db push --dry-run`/history under intended env, with password in environment, no shell history/argument exposure. Raw metadata/key output never pasted into issue.
     - Failure/retry table below; approval rejection/cancellation has no production changes; always distinguish migration outcome from deploy outcome.
     - Strict freshness and shared-lock limitations; pending replacement/non-FIFO semantics, duplicate jobs, no historical workflow reruns, unsafe legacy workflow warning.
     - Forward repair preserves applied migration history; no edit of already-applied SQL. Worker rollback is explicit incident decision after schema compatibility review, **not** automated DB rollback. Manual emergency rollback outside normal freshness path requires owner authorization and exclusive production ownership.
     - Rotation plan: expiring project-scoped PAT, Cloudflare token/release PAT replacement then validation/revocation; coordinate DB password rotation with paused release queue and all DB clients, replace environment password, validate nonmutating link/dry-run, then resume. No assumed overlap of old/new DB passwords.
     - Production verification: record run/attempt/tag/SHA/CLI, approval actor/time, target ref, safe migration version/hash manifest, final no-pending status, Cloudflare Worker/version ID and intended production route. Owner checks schema/RLS/Auth and app smoke flows, pg_cron inventory, no local OAuth/config/seed changes; no secrets/private data in retained evidence.
     - Alpha exception: backups not implemented/verified; explicit accepted data-loss risk; link PAF-177 and backup plan as **not a prerequisite for alpha**, required before reliance on retained data.
   - Add only a cross-link/current-operations clarification to historical `docs/security/release-integrity.md`; leave local evidence intact.
   - Review commands against actual implementation/help; docs cannot promise unimplemented runtime checks. No OAuth reconfiguration, backup setup or advisor remediation in this unit.
   - Commit exact U4 docs and durable plan: `docs: production release and migration runbook`.

6. **Final reconciliation and handoff.**
   - All four units on one branch, one commit per unit, one PR targeting main. Conventional subjects/bodies contain **no issue identifier**. Link Linear issue in PR description only. No intermediate push, historical release rerun or release-PR merge.
   - Reconcile AC table with actual files/tests/settings evidence; finish required/related defects in current issue. Escalate unavailable prerequisites or genuine ambiguity; no follow-up creation.
   - Run final `pnpm complete-check` once against final reviewed code state; explicit shell timeout **3600000 ms**. Do not lower coverage thresholds. DB-touching phases serial, test stack only. Missing test stack is blocked prerequisite (`pnpm test:stack:up`), not permission to target dev/prod.
   - Report offline proof, hosted read-only credential proof and actual production approval/deploy proof separately. No test/live-success claim based on names-only secret presence or mocked platform behavior.
   - If no authorization for real release observation exists, retain runtime rollout checks as explicitly unverified external proof; caller determines issue completion against original criteria. Never trigger a real release to make the checkbox green.

### Failure / recovery contract to implement and document

| State | Worker permitted? | Operator action / safe rerun |
| --- | --- | --- |
| Approval missing/rejected/cancelled | No | Inspect review event/job status; no mutation steps started. Retry protected deploy only through a fresh required review; verify actual GitHub rerun review behavior, never assume inherited approval. |
| Wrong target/missing credential/version or identity failure | No | Fix environment/settings or release code; rerun failed job only if same tag remains current and identity unchanged. |
| Dry-run/history conflict | No | Review drift/history privately; create reviewed forward corrective release where appropriate. No automatic repair/reset/include-all. |
| Migration failure after some files | No | Inspect applied history privately and classify partial effects; repair forward. Retry only after SQL/compatibility review; successfully applied files must not repeat. |
| Migration succeeds; Worker fails/cancelled | No successful deployment assumed | Schema ahead; old Worker/cron must remain compatible. If deployment outcome ambiguous, inspect Cloudflare version before retry; same-SHA migration no-op then retry deploy through gate. |
| Main/tag changes during approval/build | No | Reject stale candidate before SQL; normal latest-main release path. |
| Main changes during migration | No old Worker deploy | Final freshness check rejects; schema may be ahead. Latest reviewed release must tolerate it and apply remaining pending files. |
| Overlap/queue replacement | One active job only | Cancelled pending candidate not deployed. Inspect surviving run; never weaken lock or use historical workflow to drain queue. |
| Full workflow rerun returns no release created | No | No fallback “latest” deployment. Use eligible failed-job rerun or normal new release. |

## Validation

- Success criteria:
  - Every qualifying candidate has exactly one production environment gate, independent of pending-file count; all mutations occur only inside that gate and shared critical section.
  - Pending-only exact-revision SQL reaches only intended project; migration/no-op success required before matching Worker deploy. Any target/provenance/migration/approval failure blocks deployment with sanitized evidence.
  - CI/Release Please/tag/preview behavior preserved; stale/overlapping/rerun safety explicit and tested.
  - Complete setup/operations/compatibility/recovery/rotation/alpha-deferral docs; no secrets, automatic DB rollback or unsupported backup claim.

### AC → unit → file → completion evidence

| AC | Concrete implementation | Offline / documentation proof | External proof boundary |
| --- | --- | --- | --- |
| 1. Single approval, including no migrations | Steps 2–4; U1/U2 `release.yml`, guards and migration helper | Workflow single-environment/step containment tests; pending and no-op tests | Required-reviewer/environment protection inspection; approved/denied/cancelled real-run status only if separately authorized. |
| 2. Pending release-revision migrations, correct target, no side effects | Steps 2–4; U2 migration helper/manifest/isolation, U1 SHA contract | Exact-byte/hash/target/command allowlist tests, history/no-op/seed/config/OAuth/Vault exclusions | Owner confirms project identity and scoped link/dry-run; actual apply only through approved release. |
| 3. Fail closed + sanitized evidence | Steps 2–4; all helpers/workflow | Missing credentials, wrong target, CLI failure/timeout, no-deploy edge, canary redaction tests; runbook failure table | GitHub handles denied/cancelled review; credential values not assumed valid. |
| 4. Matching Worker after migration; concurrency/rerun/stale safety | Steps 2–4; fixed job lock, SHA/freshness before SQL and Worker | Duplicate/current/older refs, main advancement, overlap, rerun-all/failed-job contracts | Inspect actual protected-run scheduling/version on authorized rollout; no claim Vitest emulates GitHub locks. |
| 5. Preserve CI/Release Please/tag/preview; verify scopes | Steps 1–4; release workflow, unchanged preview, declarations | Trigger/output/tag/preview contract tests, least-permission/secret scoping assertions | Main/tag/environment rules and PAT scopes verified by owner; RELEASE_PLEASE_TOKEN remains untested until normal future successful run. |
| 6. Compatibility and recovery/rollback limits | Step 5; setup/runbook/security cross-link | Docs review against failure table and implemented commands; schema-ahead/forward repair/no DB rollback explicit | SQL-specific migration compatibility requires review before each real approval. |
| 7. Alpha backup deferral, no new blocker | Step 5; setup/runbook links to backup plan/PAF-177 | Docs explicitly state accepted temporary data loss and PAF-177 non-blocker for alpha | No backup credentials/configuration/test required or claimed. |
| 8. Complete safe operational docs | Step 5; setup/runbook | Verify exact names/commands/help, approval/no-op/rerun/rotation/verification coverage; secret-canary regression tests | Owner confirms settings and scopes; hosted evidence redacted. |

### Checkpoints and command discipline

1. **Before U1:** branch/base confirmed; no accidental production operation; external settings/value checks classified verified vs missing. CLI version/help evidence captured by implementer, not inferred from v3 web docs.
2. **Per unit fast gate:** `pnpm typecheck`, `pnpm lint`, affected new/changed unit tests under `vitest.unit.config.ts`. Tests use explicit **1800000 ms** shell timeout, never real hosted credentials. During iterative states use affected-file tests, not DB-bound default Vitest config/`test:changed` integration lane.
3. **Single-run policy:** each suite once per code state; no green confirmation reruns. Diagnose failures from logs first, fix, rerun failing suite once. Fast targeted lane and full final gate must not duplicate green suites on identical final code state: after U3, U4 documentation commit is distinct final delivery state; at U4 run static fast checks, report no behavior-test change and reserve final-state tests for `complete-check` rather than repeat affected lane. Do not rerun full suite merely after a metadata-only commit.
4. **During U2/U3:** fake executor trace and canary tests prove credentials never enter argv/logs/build env; workspace tests prove root local config/stub/seed absent. Test injection must not silently invoke real commands on unexpected stage.
5. **After U3:** actionlint if available; otherwise explicit unavailability, static contracts and normal GitHub YAML validation. No CI workflow beyond release.yml edited without concrete necessity.
6. **After U4/review:** final `pnpm complete-check`, timeout 3600000 ms; one serial test-stack owner. Reconcile AC and review findings before push/PR approval. Timeout kill is infrastructure interruption, not test failure; rerun with larger timeout only per repo policy.
7. **Authorized rollout only:** observe one normal future no-migration release gate and, when reviewed pending SQL exists, migration release path. Never create dummy production migration to test pipeline. No automatic release trigger/merge/rerun in this implementation plan.

### External prerequisites, missing inputs and escalation

- **No unresolved product scope question.** Conservative current-main freshness rejection is planner's implementation choice, not an owner statement; surfaced explicitly above. If caller cannot accept its availability trade-off, resolve stale-release policy before changing implementation, not with a bypass.
- **Missing Inputs:** actual production secret validity/scopes, effective protection/ruleset values, installed CLI help evidence, authorization for hosted read-only credential preflight/live release observation. Names-only inspection and intake statements do not supply these.
- **Assumptions Made:** single root Release Please package; protected non-rewritten main; immutable release tags; this workflow is sole normal production writer; no historical unsafe workflows run concurrently; public production URL standard project URL; runtime has needed linked DB connectivity/TLS.
- **Targeted Clarifications / unblocking conditions, to caller rather than automatic user prompts:**
  1. Owner inspects/configures environment and main/tag rules at GitHub repository settings; record safe settings evidence, intentionally permitted self-review and bypass posture. Cannot assert AC1/AC4 live enforcement otherwise.
  2. Owner confirms or replaces scoped secrets, authorizes nonmutating linked-project/dry-run validation without exposing values. Verify CLI link + DB-password path; if scoped PAT is denied, add demonstrated missing read permission rather than replacing with full-account PAT. AC2/AC5 credential proof remains incomplete until done.
  3. Caller must obtain explicit authorization for any real production workflow exercise; a plan/implementation request does **not** authorize historical release reruns or merging release PRs. Normal release observation may occur later only under owner control; report unavailable proof honestly, never call unperformed rollout verified.
  4. If pinned CLI cannot provide required pending-only/Vault exclusion semantics or verifiable target, U2 blocked; return exact help/source evidence and unblocking change needed. Do not schedule follow-up or weaken criteria.
- Known unrelated observations: security advisor findings outside issue; PAF-177 already approved separate backup work. Report only; no automatic issue creation, no extra migration/security/backup work.

### Research references and limitations

- `https://supabase.com/changelog.md` and `https://supabase.com/changelog/supabase-cli-v3`: November 2026 CLI v3 changes defaults/flags; keep locked v2 and verify its help. No CLI upgrade in scope.
- `https://supabase.com/docs/guides/platform/personal-access-tokens.md`: link requires Project Settings/API Keys/API Key Secrets Read; password-backed DB operations not constrained by PAT permissions.
- `https://supabase.com/docs/reference/cli/supabase-db-push`: current reference covers v3; useful for concepts only, not proof of 2.121.0 flags.
- `https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency`: fixed group serializes jobs; pending replacement and no guaranteed dispatch ordering require explicit freshness guard. Default single pending queue retained; no new queue feature required.
- Planner performed repository/documentation reads and wrote this plan only. No git mutation, CLI execution, tests, production inspection or production changes performed.
