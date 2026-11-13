# Production backup and recovery plan

**Status: not implemented.** Tracking: [PAF-177](https://linear.app/trystanworkspace2/issue/PAF-177/implement-automated-production-backups-and-recovery).

During alpha, the owner accepts that production data may be lost, including data created by early registrants. The Supabase Free plan has no scheduled project backups. This exception is temporary: implement and verify recovery before users depend on retained data. No R2 subscription, bucket, backup job, or restore process is established by this document.

## Target

- Export production daily to a private Cloudflare R2 bucket, retaining seven daily recovery points. Daily backups can lose approximately one day of changes; failures increase that window.
- Cover application and Auth data, database schema and permissions, migration history, and uploaded Supabase Storage object contents. Database dumps alone do not include uploaded files.
- Maintain a separate, protected inventory of hosted Auth, SMTP, OAuth, Worker, scheduler, DNS, and deployment settings and credential recovery procedures. Never put credentials in the inventory or repository.
- Encrypt backup contents before upload, keep decryption keys outside the backup account, and test key recovery. A lost key makes encrypted backups unusable.
- Detect and alert on failed or missing runs; periodically restore into an isolated, disposable environment. A successful upload is not proof of recoverability.

## Implementation checklist

1. Review current [Supabase backup and restore documentation](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) and [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/). Confirm region, costs, data residency, schedule, backup owner, alert recipient, recovery time target, and storage capacity. R2 billing and availability require separate approval.
2. Enable R2 and create a dedicated **private** Standard bucket. Never enable public access. Create separate least-privilege identities for backup writes and recovery reads; restrict access to this bucket. Protect accounts with MFA and document credential rotation and emergency access.
3. Design a scheduled runner independent of a developer laptop. Use protected secrets, pinned tooling, concurrency control, bounded retries and timeouts, and logs without credentials or personal data. Decide how to monitor missed runs even when the runner itself fails.
4. Establish a supported database export and restore procedure for the installed CLI and hosted Postgres versions. Include roles where applicable, schema, application and Auth data, grants, policies, triggers, extensions, sequences, and `supabase_migrations` history. Account for Supabase-managed schemas, custom role passwords and encryption keys where applicable. Never place database credentials in command arguments, logs, or committed files.
5. Export every required Storage bucket's objects through supported APIs, including private files. Preserve paths and relevant metadata; handle pagination, retries, deletion and changed objects. Decide and document how database and object snapshots are coordinated: separately captured snapshots are not necessarily point-in-time consistent.
6. Encrypt each recovery point and its integrity manifest before off-site upload. Store timestamps, versions, scope and checksums without exposing sensitive data in logs. Upload under unique dated paths; consider versioning or another mechanism to protect prior backups from accidental or malicious deletion.
7. Implement seven-day retention safely: verify a new recovery point before expiring old ones, retain recoverable complete sets, and ensure backup failure cannot erase the last good backup. Alert on failed uploads, incomplete sets, failed verification, and overdue runs.
8. Rehearse restoration into a **separate disposable Supabase project** and private Storage destination, never production. Restore relevant configuration separately; validate migrations, authentication, RLS/grants, scheduled jobs, representative app flows, and object content. Record recovery time, gaps, commands, and evidence without exposing personal data or secrets. Repeat on a documented schedule.
9. Test failure paths, permissions, retention boundaries, encryption-key recovery and alert delivery. Record a successful end-to-end recovery and assign an operator before closing PAF-177. Review pre-migration backup requirements when implementing the production release gate ([PAF-176](https://linear.app/trystanworkspace2/issue/PAF-176/gate-production-releases-and-automate-database-migrations)).

## Existing local rehearsal

`scripts/release-backup-restore.mjs` exercises a local Supabase database restore into disposable databases. It does not back up hosted production, copy Storage objects to R2, or provide a production recovery service.
