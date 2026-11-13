# Production release runbook

Operational guide for the approval-controlled production release flow (`.github/workflows/release.yml`). It documents what the workflow and its helpers (`scripts/production-release-guard.mjs`, `scripts/production-migrations.mjs`) actually do. Setup values (secrets, variables, GitHub settings) live in [INITIAL_SETUP.md](../INITIAL_SETUP.md) §2 and §4. Historical local rehearsal evidence lives in [release integrity](security/release-integrity.md).

No value in this document is a secret. Never paste tokens, passwords, keys, raw `supabase/.temp` metadata or raw CLI output into issues, PRs, logs or chat.

## 1. Flow

1. A push to `main` runs **CI**. Only a **successful push** run of CI on `main` from this repository starts the **Release** workflow.
2. The `release` job runs Release Please against the CI head commit. It publishes a GitHub release and tag only after the release PR is merged. When a release is created, the job runs `production-release-guard.mjs record`, which validates the CI provenance, the tag shape and that the **peeled tag commit equals the CI `head_sha`**, and exports that commit as `release_sha`.
3. The `deploy` job (display name `Production <tag> @ <release_sha>`) targets the `production` environment, so GitHub pauses it for the **single manual approval**. Nothing in the job (including checkout) runs before approval. The approval is required for every release, whether or not it contains migrations.
4. After approval, in order:
   1. Checkout of exactly `refs/tags/<tag>` and `verify` (identity and freshness, see §6).
   2. `pnpm install --frozen-lockfile`, assertion that the Supabase CLI is exactly **2.121.0**, nonprinting credential presence check (all four private names), then `pnpm build` with only the public `VITE_` variables. No private credential reaches install or build.
   3. Migration step: `verify` again, then `production-migrations.mjs` (pending migrations, or a checked no-op when nothing is pending).
   4. `verify` a third time, then `wrangler deploy` with only the Cloudflare credentials.
5. A fixed, non-cancelling concurrency group (`padel-friend-production-release`) spans the whole deploy job. Preview deployments are outside it.

**A published GitHub release is not proof of deployment.** Publication can precede approval, and the production job can be pending, rejected, cancelled or failed. Treat a release as deployed only after §11 is complete.

## 2. Reviewer checklist (before approving)

The approver is the only human gate. In the pending run, check:

- [ ] The job label shows tag `vX.Y.Z` and `release_sha`. The SHA equals the CI run's head commit and the current tip of `main`. If `main` has advanced the run will be rejected anyway (§6); reject it instead of approving.
- [ ] **True pending set (read-only production-history comparison, required before approving).** The tag diff (`git diff <previous-tag>..<tag> -- supabase/migrations`) is **not** the pending set. The helper applies **everything production history reports as pending among the files in this tag**, which can include older files that are absent from the diff: for example when an earlier release was never fully applied or a manual recovery left production behind. Run the owner preflight in §5 (hosted, read-only: `link`, `migration list --linked`, `db push --linked --dry-run --skip-vault`; never the apply form) against project `nojecmdknaebczpfnfwa` from a checkout of this tag, and record the pending file names it reports. Read the **full SQL of every one of those files**, not just the tag diff. No pending files means a no-op release; it still needs approval.
- [ ] Production history is a strict prefix of this tag's files. If the comparison shows remote-only versions or an applied file after a missing one, do not approve; the job would fail closed (§8).
- [ ] **Record the reviewed pending set in the release body before approving.** Edit the GitHub release for this tag and add exactly one line `Approved-pending: <v1>,<v2>,…` listing the 14-digit versions of the files you reviewed, comma-separated (order does not matter), or exactly `Approved-pending: none` when the comparison reports nothing pending. The marker must reflect the reviewed set exactly. No marker means the release will fail closed (the environment approval remains the gate; the marker is the pending-set binding).
- [ ] Compatibility with the **currently running production Worker** and with the **six active pg_cron jobs** (§4). The old Worker keeps serving until the new one deploys.
- [ ] Destructive, locking and backfill assessment: table rewrites, `CREATE INDEX` without concurrency on large tables, long `ALTER`, data rewrites, dropped columns, changed function signatures, RLS/grant changes. A migration file runs as a single script; a failure part-way can leave earlier statements of the same file applied unless the SQL itself is transactional.
- [ ] File names are lowercase `<14 digits>_<name>.sql` (the helper rejects anything else, duplicate versions, symlinks and non-files).
- [ ] No secrets, `.env`, seed, roles or local config are being introduced into the release that you would expect the deploy to ship. The deploy copies **only** `supabase/migrations/*.sql`.
- [ ] Production credentials are valid and the `production` environment still has the intended protection (§ INITIAL_SETUP). The workflow only checks that credential names are non-empty, not that values work.

**Everything production history reports as pending will be applied, but only if it equals the set you recorded.** After approval the helper re-derives the pending set from `migration list --linked`, requires its dry-run plan to equal it exactly (same files, same order, no seeds or roles, no file outside the checked-out manifest), then fetches the release for the deployed tag from the GitHub API (read-only, `contents: read` job token) and requires the `Approved-pending:` marker to be present, well formed, with every version in the tag's manifest, and **equal as a set** to the derived pending set. A missing, ambiguous, malformed, mismatching, or unreadable marker or release (stage `approval`) fails the job **before any apply**, with only counts in the message (for example `reviewed=1 derived=2`). So if production history changed between your preflight and the run, the release fails closed instead of applying a different set; re-run the preflight, correct the marker and re-run the failed job (with its fresh approval, §6).

Trust boundary: editing a release body requires repository write access (`contents: write`), so the marker is only as trustworthy as the maintainers who hold it. A body edit **after** approval is not detected by the helper; that is covered by the policy of no concurrent manual production writers (§6), not by code. After the run, compare the `Migration pending: <version>` lines and the final `applied=<n>` with your marker; any difference is an incident to investigate before the next release.

## 3. Migration compatibility policy

Schema changes land **before** the new Worker and must tolerate the old Worker and cron jobs:

- Additive first: new nullable columns, columns with defaults, new tables, new functions, new indexes.
- No destructive rename or drop, no removed or incompatible RPC signature, no tightened constraint or RLS change that the running Worker would trip over, while the previous Worker is live.
- Backfills and the "contract" step (drop old column, enforce NOT NULL, remove old RPC) ship in a **later, separately reviewed release**, after the Worker that no longer needs the old shape is deployed and verified.
- `db push --dry-run` only prints which migration files would be applied. It does not execute SQL and is **not** a compatibility test; reviewers own that judgement.
- Never edit an already-applied migration. Fix forward with a new migration.

## 4. Active pg_cron baseline

Six production pg_cron jobs were observed active at intake (a historical observation, not a guarantee). The local seed removes jobs only locally; `db push` never runs the seed. Before the first approved release, and after releases that touch scheduling, inventory them:

```sql
select jobid, jobname, schedule, active from cron.job order by jobname;
```

Do not seed them away or recreate them manually as part of a release.

## 5. CLI, commands and sanitized output

The CLI is the lock-resolved `supabase@2.121.0` (`pnpm exec supabase`), asserted at runtime. There is no `latest`, no separate installer and no v3 migration in this flow. Flags below were verified against `--help` of 2.121.0, not v3 documentation.

The helper builds a fresh temporary workdir containing a minimal `supabase/config.toml` (seed disabled, no schema paths) and byte-identical copies of `supabase/migrations/*.sql` only, runs the CLI with an isolated empty `HOME` and no ambient `SUPABASE_PROJECT_ID`, `PG*`, Cloudflare or release-token values, and always deletes the workdir. In order it:

1. Requires credentials/public inputs (`VITE_SUPABASE_URL` must be exactly `https://nojecmdknaebczpfnfwa.supabase.co`; `VITE_SUPABASE_PUBLISHABLE_KEY` must match `sb_publishable_…`) and CLI version `2.121.0`, before any remote call.
2. Builds the manifest (sorted versions + SHA-256), copies, and re-reads the copy.
3. Reads the project through the Management API (`GET /v1/projects/nojecmdknaebczpfnfwa`: ref, `ACTIVE_HEALTHY`, database host) with redirects disabled.
4. `supabase link --project-ref nojecmdknaebczpfnfwa`, then independently checks the linked metadata (`project-ref`, `linked-project.json`, pooler routing if present).
5. `supabase migration list --linked`: applied history must be an exact prefix of the local files. Remote-only versions, gaps or reordering stop the run.
6. `supabase db push --linked --skip-vault --dry-run`: the plan must equal the pending files, with no seeds or roles.
7. Fetches the release for the deployed tag and requires its `Approved-pending:` marker to equal the derived pending set (stage `approval`, before anything is applied).
8. Re-verifies the workdir (no extra files, unchanged bytes and config), prints the manifest, then `supabase db push --linked --skip-vault`.
9. Post-check: another dry-run reporting nothing pending and a history listing with nothing pending.

All commands add `--workdir <temp> --output-format json --yes`. `--skip-vault` is mandatory because, without it, 2.121.0 updates Vault secrets from `config.toml` before migrations. The helper never uses `--include-all`, `--include-seed`, `--include-roles`, `--debug`, `reset`, `repair`, `pull` or `config push`. Timeouts: 60 s for the version check, 120 s for other commands, 30 min for apply, 30 s for the API call.

Job logs carry only: `Migration manifest: <14-digit version> <sha256>` per file in the tag, `Migration pending: <14-digit version>` per file about to be applied, `Production migrations verified: applied=<n> total=<m>`, and on failure one line `<stage>: <fixed reason>` (stages: `preflight`, `workspace`, `project`, `link`, `history`, `dry-run`, `approval`, `verify-manifest`, `apply`, `post-check`, `cleanup`; CLI failures show only the exit code). Raw CLI output, SQL, connection strings and API bodies are never logged. The guard prints `Release identity verified: <tag> <sha>` or a fixed reason (for example `stale release: main advanced`).

### Owner preflight (read-only, authorized hosted use only)

Run only with the owner's explicit authorization, from a clean checkout of the candidate tag. It performs a hosted `link` and read-only history/dry-run; it applies nothing. Do not export secrets in your shell profile, do not put them in arguments and do not echo them.

```sh
unset SUPABASE_PROJECT_ID PGHOST PGUSER PGPASSWORD PGDATABASE
read -rs SUPABASE_ACCESS_TOKEN && export SUPABASE_ACCESS_TOKEN
read -rs SUPABASE_DB_PASSWORD && export SUPABASE_DB_PASSWORD
WORK="$(mktemp -d)" && mkdir -p "$WORK/supabase/migrations"
cp supabase/migrations/*.sql "$WORK/supabase/migrations/"
printf '%s\n' 'project_id = "production-release"' '[db.migrations]' 'enabled = true' 'schema_paths = []' '[db.seed]' 'enabled = false' 'sql_paths = []' > "$WORK/supabase/config.toml"
pnpm exec supabase --version   # must print 2.121.0
pnpm exec supabase link --project-ref nojecmdknaebczpfnfwa --workdir "$WORK" --yes
pnpm exec supabase migration list --linked --workdir "$WORK"
pnpm exec supabase db push --linked --dry-run --skip-vault --workdir "$WORK"
rm -rf "$WORK"; unset SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD
```

A scoped token that is denied `link` is missing a read permission listed in INITIAL_SETUP §4; add the demonstrated one, do not replace it with a full-account token. Share only conclusions ("link ok, N pending, plan matches"), never output that contains metadata or keys.

## 6. Freshness, identity and the shared lock

The guard (`verify`) runs after checkout, again at the start of the migration step, and again immediately before `wrangler deploy`. Each run re-resolves remote refs and requires **all** of these to agree: the triggering CI head SHA, the recorded `release_sha`, the checked-out `HEAD`, the remote tag (peeled for annotated tags), and the **current remote `main`**. Inaccessible or malformed refs fail closed. Tag and SHA reach the scripts as environment data, never interpolated into shell source.

Consequences, all deliberate:

- **Strict current-main freshness.** Once `main` advances, every older candidate is rejected, even when the new commit is unrelated. That is an availability trade-off chosen for safety: an old release can never overwrite production after a newer one. Recover by releasing the latest `main` through the normal Release Please flow. There is no override.
- **Fixed noncancelling lock.** One production release job runs at a time; an active job is never cancelled by a newer one. GitHub keeps a single pending job per group; a newer pending job **replaces** an older pending one, which is cancelled and **not deployed**. GitHub does not guarantee FIFO dispatch. Correctness does not rely on ordering: whichever job runs, stale candidates fail the guard.
- **Duplicate same-SHA runs** are safe: applied migrations make a second run a checked no-op and the same Worker is redeployed. Older SHAs always fail.
- If `main` advances during migration, the final guard blocks the Worker; the schema may then be ahead (§8).
- The lock cannot coordinate manual dashboard edits, manual Wrangler deploys or manual SQL. Do not run any manual production writer while a release is running or pending, and do not rerun historical workflows (they predate the lock and the guard).
- Rerunning only the failed deploy job reuses the recorded outputs (same tag/SHA). Rerunning the whole workflow makes Release Please return `created=false`; the deploy job then does not run. There is no fallback to "latest".
- Whether a rerun of the deploy job needs a fresh approval is GitHub behavior; verify it on first use rather than assuming inherited approval.

## 7. GitHub-enforced behavior (documented boundary)

Required review, rejection, cancellation, concurrency queueing and environment branch rules are enforced by GitHub, not by this repository's code. Tests prove the workflow structure (all mutating steps live in the one `production` job, no bypass branch), not GitHub's behavior. Verify the environment settings in the repository UI (see INITIAL_SETUP §4). A rejected or cancelled review means no deploy step started and nothing changed.

## 8. Failure and retry table

Always distinguish the **migration outcome** (look for `Production migrations verified` or a stage error) from the **Worker outcome** (Cloudflare deployment). The final step "Report incomplete production release" writes a fixed note to the job summary when the migration step failed, or migrations succeeded but the Worker did not. It also appears if the pre-migration guard inside the migration step failed (then no SQL ran: confirm with the stage line).

| State                                                                                    | Worker deployed? | Action / safe retry                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Approval missing, rejected or cancelled                                                  | No               | No mutation step started. Retry only through a fresh required review; do not assume inherited approval.                                                                                                                                                  |
| Wrong target, missing credential or public variable, wrong CLI version, identity failure | No               | Fix the environment setting or release code. Re-run the failed job only if the same tag is still current.                                                                                                                                                |
| Dry-run or history conflict (remote ahead, gap, out of order, unexpected plan)           | No               | Inspect drift privately, then ship a reviewed forward corrective release. No automatic repair, reset or `--include-all`.                                                                                                                                 |
| Migration failure after some files applied (`apply` / `post-check`)                      | No               | Inspect applied history and partial effects privately; repair forward. Retry only after SQL and compatibility review. Applied files are not repeated.                                                                                                    |
| Migrations succeeded, Worker failed or cancelled                                         | Not assumed      | Schema is ahead; the old Worker and cron jobs must tolerate it. Check the Cloudflare deployment list before retry (`wrangler deployments list` with owner credentials, or the dashboard). Retry of the same SHA is a migration no-op plus Worker deploy. |
| `main` or tag changed during approval or build                                           | No               | Rejected before SQL. Release the latest `main` normally.                                                                                                                                                                                                 |
| `main` advanced during migration                                                         | No (old Worker)  | Final guard rejects. Schema may be ahead; the latest reviewed release must tolerate it and applies any remaining files.                                                                                                                                  |
| Overlap or queue replacement                                                             | One active job   | The replaced pending release was not deployed. Inspect the surviving run; never weaken the lock or drain via a historical workflow.                                                                                                                      |
| Full-workflow rerun, `created=false`                                                     | No               | No deploy job. Use a failed-job rerun of an eligible run or a new release.                                                                                                                                                                               |

## 9. Recovery and rollback

- **Forward repair.** Applied migration history is preserved. Add a new migration; never edit applied SQL, never delete history.
- **Worker rollback** is an explicit incident decision, taken only after a schema compatibility review of the older Worker against the current schema. There is **no automated database rollback**.
- A manual emergency rollback or deploy outside the freshness path needs the owner's explicit authorization and exclusive production ownership (no workflow running, none pending).
- **Backups:** no automated production backups and no verified recovery exist. Alpha explicitly accepts possible data loss. See [production backup plan](production-backup-plan.md) and [PAF-177](https://linear.app/trystanworkspace2/issue/PAF-177/implement-automated-production-backups-and-recovery). PAF-177 is **not** a prerequisite for alpha; it is required before anyone relies on retained data. Nothing in this flow provides or claims a backup.

## 10. Credential rotation

Secret names are in INITIAL_SETUP §4. Rotation order: create the new credential, update the `production` environment secret, validate, then revoke the old one.

- **Supabase access token** (expiring, project-scoped; Project Settings Read, API Keys Read, API Key Secrets Read): replace, then validate with the owner preflight (`link`, `migration list`, dry-run) before the next release.
- **Cloudflare API token / account ID** and **`RELEASE_PLEASE_TOKEN`** (repository secret, used only by the `release` job): replace, then validate through the next normal run. `RELEASE_PLEASE_TOKEN` has not yet been exercised by a successful run.
- **Database password:** it also affects every other client of the database, and no overlap between old and new password is assumed. Pause releases (no run active; leave approvals pending or reject them), rotate in Supabase, update every client and `SUPABASE_DB_PASSWORD`, validate with a nonmutating `link` plus dry-run, then resume.

## 11. Production verification record

For each release, retain a redacted record (no secrets, tokens, endpoints, user data):

- Run ID and attempt, tag, `release_sha`, CLI version (2.121.0).
- Approval actor and time (from the environment review).
- Target project ref (`nojecmdknaebczpfnfwa`).
- Migration manifest (version + SHA-256 lines from the log) and the final `applied=<n> total=<m>` line; final no-pending status.
- Cloudflare Worker version/deployment ID and the production route it serves.
- Owner checks after deploy: schema and RLS spot check, Auth sign-in, app smoke flows, pg_cron inventory (§4: six jobs active), and confirmation that no local OAuth stub, config or seed content reached production.

Offline tests do not prove hosted credential validity, GitHub environment protection or a real approval; record those separately when observed.
