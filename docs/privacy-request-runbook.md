# Privacy request runbook

Operational runbook for privacy requests (PAF-199). Operator: Thiago Mendonça (Spain), controller of the application data. Design basis: [account-deletion-design.md](account-deletion-design.md). Related: [INITIAL_SETUP.md](../INITIAL_SETUP.md) §8 (added-player invitations, SMTP) and §9 (Web Push operations), [production-backup-plan.md](production-backup-plan.md).

This is operational guidance. It makes no compliance assertion and is not legal advice. GDPR articles are cited only as operating guidance; the external legal review of the published policy is **pending and owner-owned**.

## 0. Evidence status

Date of evidence: **2026-11-27**. Evidence classes follow the design doc: **MS** migration/repository source, **LC** local test-stack catalog, **PO** pending owner verification.

| Item                                                                                                    | Status                                                                                        |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Hosted FK/trigger catalog, applied-migration list and drift versus the repository                       | **PO-1 pending.** Local derivation only; production readiness unverified.                     |
| Hosted Auth providers and settings, Worker/Supabase log and telemetry settings                          | **PO pending.** Verify via dashboard; do not quote provider values to requesters.             |
| Hosted Storage object versioning and hidden versions                                                    | **PO pending.** The processor lists and removes current objects only.                         |
| Manual exports, snapshots or provider-managed recovery points                                           | **PO pending.** None evidenced either way. Automated production backups: none (MS, §6).       |
| Resend retention, suppression behavior and mailbox retention                                            | **PO pending.**                                                                               |
| Operator mailbox controls (MFA, forwarding, retention, absence cover)                                   | **PO pending.** Owner confirms.                                                               |
| Auth artifacts with no FK to users (`auth.refresh_tokens`, `auth.audit_log_entries`, `auth.flow_state`) | Not controllable through the admin API. **Known residual**; record the local result per case. |
| External legal review of the published policy                                                           | **Pending, owner-owned.** Policy shows a visible "no external legal review yet" note.         |

## 1. Intake and response

1. **Mailbox.** The privacy mailbox is the address published in the policy (`PRIVACY_CONTACT_EMAIL` in `src/features/privacy/privacy-content.ts`). The owner owns it. Use MFA, no forwarding to shared or public spaces, and cover absences so the mailbox is always owned.
2. **Record on receipt.** Received time, requested right(s), and whether the message repeats an earlier request or is a new, related one. Do not confirm or deny that an account, invitation or provisional record exists before verification.
3. **Acknowledge** promptly with a neutral reference. For in-app requests the case reference (`PR-XXXXXXXXXXXX`) is the reference; for email requests use any neutral reference. A random reference is still personal data while correlated with retained mail: do not call it anonymous.
4. **Route by right.** An erasure request from a signed-in account holder normally arrives in-app (§2). Everything below is handled by email, manually:
   - **Access / export**: assemble only the requester's data, redact other persons' data, deliver through a secure channel.
   - **Rectification**: correct the record or point the user to the profile edit.
   - **Restriction, objection**: assess case by case; record the decision and grounds.
   - **Portability**: provide the data the requester provided, in a structured machine-readable format.
   - **Erasure for someone who cannot sign in, an unclaimed invitee, a representative**: verify by email (§3) and then run the same operator tooling (§2) against the case the operator opens for them.
5. **Timing (GDPR Art. 12, operational description).** Act and respond without undue delay and in any event within one month of receipt. Where complexity or the number of requests requires it, the period may be extended by up to two further months; tell the requester within the first month, with the reasons. **Verification never restarts the clock.** If no action is taken, say why and describe the complaint route (AEPD for Spain, www.aepd.es) and judicial remedy.
6. **Identity (Art. 12(6)).** Ask for additional information only where there are reasonable doubts about identity, and keep it proportionate. Never ask for passwords. Never ask for routine ID copies. If the mailbox is lost, mistyped, recycled, or an agent writes on someone's behalf: do not execute and do not disclose existence; seek proportionate alternative evidence or representation checks and escalate unresolved cases.
7. **Erasure grounds and exceptions (Art. 17).** Assess per case. Record any refusal or partial retention and its ground: for example the retained, anonymized official history of **other** players (owner decision 1), or a legal claim. Assess whether recipients received the data and whether notifying them is possible without disproportionate effort (Art. 19).
8. **Escalate** to the owner and, where appropriate, qualified legal advice: legal uncertainty or holds, suspected security incidents or data breaches, urgent safety-related cases (harassment, stalking context), contested identity, minors or representation questions. Claim no legal certification.

## 2. In-app deletion requests: operator procedure

The operator command is `pnpm privacy:operator <command> [reference] [options]`. It runs on the operator's own machine with the service-role key from the operator's environment. There is no browser operator route and no public destructive endpoint.

**Environment (fails closed when missing)**

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` of the target project. Treat the key as a production secret; never put it in a ticket, a chat or a commit.
- `PRIVACY_OPERATOR_ALLOWED_PROJECTS` (comma list of project refs). Default is `local` only.
- Any non-local project also requires `--allow-production` and a non-empty `PRIVACY_OPERATOR_PRODUCTION_EVIDENCE` (the ticket or approval that authorizes it). Production execution needs separate explicit owner authorization; passing the test suite never grants it.
- Use a machine and a mailbox protected by MFA.

**Steps**

1. `pnpm privacy:operator list` shows open cases as codes only (state, last phase, blocker code, next action, whether verified or armed).
2. `start-verification <ref>` creates a single-use code valid for 30 minutes. The code is printed **once**, on your console, together with the **address on file in Auth**. Only a digest and the expiry are stored; the code never reaches the database. Starting again invalidates the previous code and returns the case to `received`.
3. **You send the code yourself** from the operator mailbox to that address (never to an address typed in the request). Template sketch (adapt per language, keep it short, no account details):

   > Subject: Your Padel Friends privacy request {reference}
   >
   > We received a request to delete the Padel Friends account for this address. To confirm it was you, reply with this one-time code: {code}. It expires in 30 minutes. If you did not make this request, ignore this message; nothing is erased on the request alone.

4. When the requester replies with the code: `confirm-proof <ref> --code <code> --confirm`. The proof is rejected when the code is wrong (five attempts at most), expired, already consumed, or issued for another case, and `--confirm` is mandatory. Verification becomes stale if the account email changes before arming (the arm is refused and verification restarts).
5. `dry-run <ref> [--successors <json>]` is read-only. Review the coarse impact counts, ownership counts and the **blockers**. Successors (communities, leagues, matches that need a new owner) must be consenting, eligible, active, non-provisional members or admins; supply them as `{"communities":{"<id>":"<userId>"},"leagues":{…},"matches":{…}}`. With no successor the approved fallback applies: the community is archived without an owner, unsupported future activity is cancelled, and official results stay.
6. **Resolve blockers.** A `platform_admin_grant` blocker means the subject holds a platform reviewer grant: remove it first (operator-level SQL under the usual access controls), then dry-run again. `successor_invalid` means pick another successor. `unclassified_dependency` / `registry_drift` mean the schema changed after the disposition contract: stop and escalate to engineering.
7. `arm <ref> --plan <json|file>` binds a one-use approval to that case, that subject, this project ref and exactly that plan (revision, fingerprint, impact, successors). Any drift is rejected and needs a new dry run.
8. **Processing.** The existing Worker cron (`*/5 * * * *`) runs the processor sweep. It only executes armed or resumable cases. Phases, each committed before the next side effect: **freeze** (ban in Auth, database freeze: stale tokens are rejected at every boundary), **relational erasure** (the unit B seam, atomic), **storage erasure** (the subject's objects in the three private buckets, then re-listed to prove absence), **Auth deletion** (absence proven, an ambiguous answer is a retry). The case then closes. Withdrawal by the user is possible only until the claim; refusal by the operator only while nothing irreversible has started.
9. **Verify the outcome** with `list`: the case is `closed` (outcome erased). A `blocked` case shows a blocker code and a next action: `operator_remove_platform_grant`, `operator_rearm` (dry-run and arm again), `operator_retry` (`retry <ref>` resumes from the last committed phase; completed phases are never repeated) or `operator_review` (stop and escalate). `RETRIES_EXHAUSTED` means a provider outage outlasted six backed-off attempts: check the provider, then `retry`.
10. **Manual provider steps (§4)** for the same subject, then the **final response (§5)**.
11. `record-response <ref>` after you sent the final mail. It stamps the response and sets the purge date to 90 days later (owner decision 4).
12. `refuse <ref>` closes a case that has not started, for a justified refusal (record the ground in the mail). `purge` purges expired case records down to non-identifying outcome counts; the Worker sweep also runs it, so this is the manual fallback.
13. **Kill switch.** `switch intake off` pauses new requests; `switch executor off` stops arming and claiming; `PRIVACY_EXECUTOR_DISABLED=1` in the Worker environment stops the sweep independently. Use them for a suspected wrong-target incident, a provider outage, an unexplained blocker pattern, or a schema change under review. An already frozen subject stays frozen; nothing resurrects erased users. Turn them back on with `switch <intake|executor> on` after the cause is fixed.

Case logs hold safe codes, counts and timestamps only. Never copy subject UUIDs, emails, tokens, storage paths or raw provider errors into notes, tickets or chat.

## 3. Verification for people without an in-app request

For an unclaimed invitee, an awaiting-identity person (an add-by-email with no Auth user), a provisional account, or anyone who cannot sign in:

1. Challenge the address independently of any claim or sign-up: send a short-lived random code to the address, and require it back. Check privately that the invitation or addition really links to that address; never match by public search.
2. Scope all matches (duplicates, aliases) before acting. Awaiting-identity operations hold the address and name as plain text with no retention evidenced: erasure for them is an operator query under the same access controls, and queued dispatch must be fenced so it cannot recreate the identity.
3. Authorization never comes from request text, an old session, `email_confirmed_at` alone, knowledge of an invitation, or editable JWT metadata.

## 4. Per-provider manual handling

Supabase erasure is automated; everything else is a manual step on request, and what is possible depends on each provider. Record a safe result code and next date, not personal snippets. Do not quote a provider retention period to a requester unless you verified it on that date.

| System                           | What to do                                                                                                                                                                                                                                                    | Limits                                                                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Supabase** (DB, Auth, Storage) | Automated by the processor. After closure confirm the Auth user is absent and the three buckets hold no objects for the subject. Record the local result for `refresh_tokens`, `audit_log_entries`, `flow_state`.                                             | Auth tables with no FK to users are not controllable through the admin API: known residual. Hosted logs and Storage object versions are unverified (PO). Support request is an option. |
| **Cloudflare**                   | Check Worker logs/traces, Turnstile, cache and deployment logs. Purge cached copies where applicable, minimize future logging, and verify via dashboard whether individual log deletion or a shorter expiry is supported.                                     | Provider-controlled periods. Do not repeat the three-day value used in earlier copy: it was never verified.                                                                            |
| **Resend**                       | Review delivery and event records for the address, any suppression-list entry and message content as configured. Remove what the dashboard supports; keep bounce or security records only with a recorded justification. Minimize identifiers in future mail. | Retention and suppression behavior unverified (PO). Exported copies need a separate check.                                                                                             |
| **Google OAuth**                 | Tell the requester how to disconnect the app in their Google account. Revoke supported app access on our side if any grant is stored.                                                                                                                         | Never claim removal of the Google account or Google-side logs.                                                                                                                         |
| **Browser Push**                 | Subscriptions and pending jobs are deleted in-app (cascade). Offer unsubscribe and clear-permission steps for the browser.                                                                                                                                    | Delivered messages and provider copies are outside our control.                                                                                                                        |
| **Operator mailbox**             | Delete unnecessary copies, attachments and trash on a documented lifecycle. Keep only the minimum case correspondence until the 90-day purge.                                                                                                                 | The mailbox itself holds addresses and proofs: protect it like production data.                                                                                                        |

Storage coverage notes. The processor removes the subject's own objects (avatar folder, owner id, uploader path segment) across `player-avatars`, `match-event-photos`, `community-venue-photos`. **Photos uploaded by other people** are never removed automatically; the case manifest counts them (`others_photos_for_review`). A photo that shows the requester needs a verified, manual content review: never infer that it belongs to the requester from the file owner. `communities.logo_path` has no bucket: inspect any value by hand. Signed URLs already issued can persist in browsers or caches until they expire.

## 5. Final response

Send it from the operator mailbox to the verified address, not through the app. State: what was removed, what remains and why (anonymized official history of other players, any exception with its ground), which provider or backup restrictions are outstanding, and how to complain (AEPD) or seek a remedy. Confirm only phases the case actually completed; track incomplete external work instead of calling it complete. Do not call retained records anonymous unless the pseudonymization assessment in the design doc (§8) holds in that community's context; where it fails, restrict or suppress the affected details or block the case pending an owner decision.

## 6. Backups, snapshots and restore

**Current fact (MS, dated 2026-11-27).** [production-backup-plan.md](production-backup-plan.md) and `INITIAL_SETUP.md` state that alpha has **no automated production backups** (Supabase Free plan, status "not implemented", PAF-177). The owner accepts possible data loss during alpha. Whether manual exports, snapshots or provider-managed recovery points exist is **not evidenced either way (PO)**. Make no retention promise about backups to requesters, and say only what is proved and dated.

**Before answering any request, check** whether a recovery point exists: ask the owner for any manual dump or export, check the Supabase dashboard for backups and point-in-time recovery, and check Storage versioning. Record the date and result.

**If a recovery point or export exists:**

1. Isolate it and restrict access. Do not attempt in-place selective deletion.
2. Put it on a verified expiry schedule and record the last-expiry date.
3. Restore only into a **disposable, isolated** environment with mail, Push and public traffic disabled.
4. Before reconnecting anything, **reconcile every erasure performed after the snapshot** (database, Auth, Storage objects, queued invitations). Fail closed: if coverage or the post-cutoff list of erasures cannot be established, do not reconnect.

**Recovery suppression manifest (design, gated).** If an approved automated backup exists (PAF-177 goes live), keep a short-lived, separately encrypted, strictly scoped manifest keyed by the **original** subject identifier (never mapped to the tombstone), valid only until the last applicable recovery point expires. It is personal data: replay it in a protected restore, then purge the identifiers. Do not install a standing identity ledger when no approved backup needs it. Add the restore gate (manifest replay, jobs disabled and publication blocked until replay completes) to PAF-177's definition of done.

**Rehearsal hook.** `scripts/release-backup-restore.mjs` rehearses a restore of the local database into disposable databases. Since unit C it also dumps the `privacy_internal` schema, so case state, switches and the disposition contract survive the restore. It does not back up hosted production or Storage objects. The restore gate above maps to it as follows: after a rehearsal restore, run the dry-run listing to confirm cases and the registry are intact, keep the executor off (`switch executor off`) until the post-snapshot reconciliation is done, then re-enable.

## 7. Open items and owners

| Item                                                                    | Owner            | Proof needed                                   |
| ----------------------------------------------------------------------- | ---------------- | ---------------------------------------------- |
| PO-1 hosted metadata comparison (catalog, migrations, Storage versions) | Owner            | Dated sanitized metadata, no rows              |
| Provider settings (Cloudflare logs/cache, Resend, Supabase logs)        | Owner            | Dashboard evidence, dated                      |
| Operator mailbox controls (MFA, forwarding, retention, absence cover)   | Owner            | Owner confirmation                             |
| Existence of manual exports or snapshots                                | Owner            | Dated statement                                |
| Legal review of the published policy                                    | Owner (external) | Recorded completion, then set the flag in code |
| Automated production backups and restore gate                           | PAF-177          | Verified restore rehearsal                     |
