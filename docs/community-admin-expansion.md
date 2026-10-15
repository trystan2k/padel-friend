# Community admin expansion contracts

## Member match counts — unsupported

No canonical match producer exists. Do not reuse global ratings, store totals, seed synthetic counts, or return zero when unavailable. The presentation contract is `CommunityMemberMatchSummary`: unavailable state carries `count: null` and `reason: 'match_source_unavailable'`.

Future source contract: canonical completed matches with participant rows keyed by `(match_id,user_id)` and `match.community_id`. Count `DISTINCT` completed, non-void match IDs per player and community, deliberately independent of membership intervals so history survives reactivation. Only authorized community Admin member search/detail DTOs may expose this aggregate. Never expose cross-community metrics or participant rows; enforce source RLS and perform match mutations in authorized domain transactions. Cancellation/correction must update the source so aggregate changes transactionally. No producer or tables currently exist, so this contract is blocked.

Future acceptance tests: completed and void matches, duplicate participant prevention, community scoping, reactivation history, cancellation/correction, non-admin denial, and no cross-community metric leakage; assert unsupported/null now and never a fabricated zero.

## League-result audit — unsupported

No league/result producer or correction transaction exists. Keep current audit entity/action constraints and append-only client grants unchanged; emit no synthetic rows.

Future event contract: `entity='league_results'`, `action='UPDATE'`, `entity_id` is result UUID, `details={event:'league_result_corrected',league_id,revision,changed_fields}` with allowlisted changed-field names. Actor comes from `auth.uid()` and time from the database. No free-text reason, player email, or raw result rows. Emit only within a future authorized correction transaction alongside source revision update, once per revision. RLS must bind result, league, and community tenant; Admin access only within authorized community. Do not relax schema until a real league/result FK and correction owner exist.

Future acceptance tests: authorized correction emits exactly one safe event per revision, unauthorized and anonymous correction denied, client audit writes remain denied, allowlist rejects arbitrary detail fields, and source/audit rollback atomically. The contract is blocked by the absent producer.

## Venue photo upload

Venue photos live in the private `community-venue-photos` Storage bucket, limited to JPEG/PNG/WebP and 2 MiB. Object keys are scoped by community, venue, uploader, and random object ID. Active members may read; current Admins may upload and remove only their own unreferenced objects. Admin-only finalization independently verifies venue/community ownership, object metadata, image bytes, size, and current authorization before storing the path. Generic venue updates cannot assign photo paths. Signed preview URLs are short-lived bearer URLs; residual access may persist until expiry after permission revocation.

Storage and database linking are not atomic. Failed finalization may leave an unreferenced object; referenced photos are never deleted during replacement. Orphan collection remains a documented follow-up, not an unbounded background job in this scope. Tests cover path tampering, cross-community/venue access, unauthorized uploads, revoked Admin finalization, archive races, content validation, and private reads.

## Authorized invitee discovery (opt-in)

Invitee lookup is global and explicitly consent-gated. The RLS-protected `community_invitee_directory_preferences` table stores consent as row presence; missing row means undiscoverable. Owners alone can read, insert, or delete their preference, and Admins receive no directory-table access. The `search_community_invitees(uuid,text,integer)` SECURITY DEFINER RPC requires a real authenticated current Admin of a private community before lookup. It accepts a 3–80 character query and 1–20 result bound; matches case-insensitive literal substrings and orders stably by display name then UUID.

Search returns only user ID and display name, never email, profile metadata, ratings, settings, or avatar. It excludes the caller, all community membership history (including inactive members requiring reactivation), and live invitations. There is no count, prefix/email search, UUID probing, or pagination. Withdrawal removes results immediately. Invitation issuance remains separately authorized and rechecks eligibility. No query/name payloads are logged. Abuse-based rate limiting is a follow-up if evidence warrants it.

The application currently exposes invitation acceptance only as the `acceptInvitation` server function; no browser acceptance route exists. Therefore the Admin UI presents the raw one-time invitation token, offers copy, and explicitly states that link delivery is unsupported. Do not construct an acceptance URL until a browser route exists. Tokens are returned only to the issuing Admin, held in the dialog UI, and are not sent to notifications, logs, audit details, or shared SSR cache. Follow-up: provide a browser acceptance route/delivery UX only under a separately reviewed contract; retain opt-in withdrawal and authorization matrix coverage.
