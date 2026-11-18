---
description: Production release preflight review — read-only checks, SQL review, marker, rerun guidance
---

Execute the production release preflight review for tag `$ARGUMENTS`, following
`docs/production-release-runbook.md` (§2 checklist, §5 preflight, §6 freshness, §8 recovery).
You are preparing the human approver's decision; you never bypass a gate. Read-only until the
user explicitly approves, then exactly one marker edit and a failed-job rerun. Never apply
migrations, never run `db push` without `--dry-run`, never use `reset`, `repair`, `--include-all`
or `config push`, never echo secrets or connection strings.

## 1. Resolve the candidate release

- If `$ARGUMENTS` is empty, detect the candidate: list releases matching `vX.Y.Z`
  (`gh release list --limit 10`), fetch each body (`gh release view <tag> --json body,createdAt`),
  and pick the newest release whose body has **no** line starting with `Approved-pending:`.
  If several are unmarked, list them and ask the user which one.
- Confirm the choice with the user before any remote call: tag, creation date, and the
  Release workflow run it belongs to.
- If the body **already has** a marker: this is the §8 correction path. Ask the user whether
  they want to review and update it (for example stale marker after a partial apply), and
  continue only with their explicit confirmation.

## 2. Identity and freshness (§6)

Collect and report:

- `gh release view <tag> --json tagName,targetCommitish,createdAt,body`
- Peeled tag commit: `git fetch --tags origin --quiet && git rev-parse <tag>^{commit}`
- Current remote `main` tip: `git rev-parse origin/main` (after `git fetch origin`)
- **Freshness warning**: if the tag commit is not the current `origin/main` tip, the deploy
  guard will reject the run as stale (`main advanced`). Tell the user explicitly; the release
  must go through the normal Release Please flow instead of this marker. Continue only if
  the user still wants the read-only review.
- Locate the Release workflow run and its `Production <tag> @ <sha>` deploy job:
  `gh run list --workflow release.yml --limit 20`, `gh run view <id> --json jobs`.
  Record whether the deploy job failed, is pending approval, or never ran.

## 3. Credentials (never echoed)

The preflight needs `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` for the production
project (INITIAL_SETUP §4). If they are not already in this process environment
(check `printenv` presence only, never values), ask the user to write them to a temporary
file with mode 0600, for example:

```sh
umask 077; printf '%s\n' 'SUPABASE_ACCESS_TOKEN=...' 'SUPABASE_DB_PASSWORD=...' > "$TMPDIR/release-preflight.env"
```

Source it with `set -a; . "$TMPDIR/release-preflight.env"; set +a` only inside the specific
preflight commands, and delete the file at the end. Never print, store in the session, or
include credential values in summaries.

## 4. Read-only production preflight (§5)

From a checkout of the exact tag: `git worktree add --detach "$TMPDIR/preflight-wt" <tag>`
(never touch the main working tree; remove the worktree when done). Then run the runbook §5
block verbatim, adapted to that worktree:

- `pnpm exec supabase --version` must print `2.121.0` — stop and report otherwise.
- Build the manifest: sorted `supabase/migrations/*.sql` (14-digit versions + SHA-256).
- `supabase link --project-ref nojecmdknaebczpfnfwa` (from the worktree, isolated workdir
  per §5: minimal `config.toml`, migrations copied, no ambient `SUPABASE_PROJECT_ID`/`PG*`).
- `supabase migration list --linked` — applied history must be an exact strict prefix of the
  manifest. Remote-only versions, gaps, or reordering = **stop**, report, recommend §8 row
  "Dry-run or history conflict".
- `supabase db push --linked --dry-run --skip-vault` — plan must equal the pending files,
  no seeds or roles.
- Derive the pending set (files in manifest, not in applied history, appearing in the plan).

All output is sanitized like the CI job: report versions, counts, and conclusions only
("link ok, applied=12, pending=1"); never raw CLI output containing metadata, SQL errors
with identifiers, or keys.

## 5. SQL and compatibility review (§2, §3, §4)

For each pending file: print its **full SQL** from the worktree and walk the checklist:

- Additive-first policy vs the running Worker (§3): no destructive rename/drop, no removed or
  incompatible RPC signature, no tightened constraint or RLS the live Worker would trip over.
- Backfills and contract steps (drop old column, enforce NOT NULL) belong in a later release.
- Transactionality: would a mid-file failure leave earlier statements applied?
- Locking/duration risk on large tables (table rewrites, non-concurrent `CREATE INDEX`, long `ALTER`).
- If any file touches scheduling: remind the user to inventory `cron.job` (§4) via the dashboard.
- No pending files: state clearly this is a **no-op release** — schema untouched, Worker deploy only.

## 6. Summary and explicit approval

Present a resume table and **stop for user approval** before any write:

- Tag, release SHA, `origin/main` tip, freshness verdict
- Applied count, pending set (versions + file names), or "no-op release"
- Proposed marker line: `Approved-pending: none` or `Approved-pending: <v1>,<v2>,…`
- Deploy job state (failed run id / pending approval / none yet)

Ask: "Approve recording this marker?" — proceed only on explicit approval. If the derived
set disagrees with what the user expects, stop and investigate; never record a guessed set.

## 7. Record the marker (only after approval)

- `gh release view <tag> --json body` → append **exactly one** line with the proposed marker
  to the end of the body → `gh release edit <tag> --notes-file <tempfile>`.
- Verify: `gh release view <tag> --json body` — the body contains exactly one line matching
  `^Approved-pending:` and it equals the approved value. If the runbook reviewer notice block
  is present, leave it in place.
- Correcting an existing marker (§8): replace the old line, never add a second one.

## 8. Rerun guidance and final state

- If a failed `Production <tag> @ <sha>` deploy job exists: `gh run rerun <run-id> --failed`
  (**failed job only** — a full-workflow rerun makes release-please return `created=false` and
  no deploy job runs, §6).
- If no run exists yet, nothing to rerun; the next deploy job will pick the marker up.
- Tell the user: **the release is safe to be approved** — go to the run page and grant a
  **fresh** `production` environment approval (approval never carries over, §6).
- Offer to watch the rerun and report the migration outcome (`Production migrations verified:
  applied=<n>`) and Worker outcome separately, per §8.

## Cleanup

Remove the temp worktree, preflight workdir, and credential file when done, and unset the
exported variables in the shells you spawned. Report the final state to the user.
