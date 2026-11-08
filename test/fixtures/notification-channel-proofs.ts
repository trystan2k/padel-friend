import type { NOTIFICATION_CHANNEL_MATRIX } from './notification-channel-matrix';

type Event = (typeof NOTIFICATION_CHANNEL_MATRIX)[number]['event'];
type Proof = { events: readonly Event[]; testName: string; recipients: string };
// Recipient expressions name the exact fixture sets asserted by each domain test, not a second
// hand-maintained set of UUIDs. IDs are freshly allocated by the domain fixtures on every run.
export const NOTIFICATION_CHANNEL_PROOFS: readonly Proof[] = [
  {
    events: ['community_invitation'],
    testName:
      'persists exact invitation alert, allowlists its payload, and handles duplicate invite attempts',
    recipients: '[invitee.id]'
  },
  {
    events: [
      'community_membership_approved',
      'community_membership_denied',
      'community_membership_removed'
    ],
    testName: 'emits approval, denial, admin-removal and role alerts; unauthorized calls emit none',
    recipients: '[affected member.id]; unauthorized actor emits []'
  },
  {
    events: ['role_promotion'],
    testName: 'role promotion notifies only changed member; repeated no-op emits nothing',
    recipients: '[leagues.member.id]'
  },
  {
    events: ['role_demotion'],
    testName: 'role demotion uses next immutable member revision, independent of deleted alerts',
    recipients: '[leagues.member.id]'
  },
  {
    events: ['role_ownership_transfer'],
    testName:
      'administration transfer announces every role actually changed, including former administrator',
    recipients: '[leagues.owner.id, leagues.admin.id], one per changed membership'
  },
  {
    events: ['match_event_published'],
    testName:
      'verifies transactional producers, authorization, enrichment, idempotency, and v1 compatibility with publishable JWT actors',
    recipients: '[active.id, invitee.id]; creator/pending/inactive/outsider []'
  },
  {
    events: ['match_event_invitation', 'match_invitation_accepted'],
    testName:
      'ordinary join accepts pending invite and every invitation kind resolves both notification readers',
    recipients: 'invitee for issue; creator for acceptance'
  },
  {
    events: ['match_invitation_declined'],
    testName: 'decline persists once and notifies creator once',
    recipients: '[f.creator.id]'
  },
  {
    events: ['match_invitation_expired'],
    testName: 'expiry persists once and notifies creator and invitee once',
    recipients: '[creator.id, invitee.id]'
  },
  {
    events: ['guest_registration_requested', 'out_of_range_registration_requested'],
    testName:
      'routes the four entry paths: direct accept, pending member, guest request, private denial',
    recipients: '[actors.creator.id] for each pending request; private outsider []'
  },
  {
    events: ['guest_registration_approved'],
    testName: 'approves a guest request without ever creating or mutating a community_members row',
    recipients: '[actors.guest1.id]'
  },
  {
    events: ['guest_registration_rejected', 'out_of_range_registration_rejected'],
    testName:
      'reuses the identity row for re-application after rejection and expiry without ordinal reuse',
    recipients: 'requesting player only, immutable attempt identity'
  },
  {
    events: ['out_of_range_registration_approved'],
    testName: 'approves atomically and replays idempotently without a second ordinal or alert',
    recipients: 'approved requesting player only'
  },
  {
    events: [
      'match_registration_playing',
      'match_registration_reserve',
      'match_registration_promoted',
      'match_registration_quartet_complete'
    ],
    testName:
      'fires each FIFO kind to exactly the changed recipients with revision-keyed event keys',
    recipients:
      'm3 playing; m1/m2/creator promoted; completed quartet; new residual player Reserve only'
  },
  {
    events: ['match_registration_withdrawn', 'match_registration_group_changed'],
    testName: 'promotes prior ninth player and notifies exactly surviving changed memberships',
    recipients:
      'departing player and exact surviving changed-membership set; unrelated roster excluded'
  },
  {
    events: ['match_registration_removed'],
    testName:
      'removes one of eight into four Playing and three Reserve, preserving ordinals and exact effects',
    recipients: 'removed player and exact changed surviving roster'
  },
  {
    events: ['match_reconfirmation_required'],
    testName:
      'Competitive Friendly change requires every accepted player including creator to reconfirm',
    recipients: 'every accepted registrant, creator included'
  },
  {
    events: ['match_registration_reconfirmed'],
    testName: 'reconfirm preserves original FIFO and is self-only idempotent',
    recipients: 'current organizer response contract'
  },
  {
    events: ['match_reconfirmation_expired'],
    testName:
      'unreconfirmed accepted rows expire at cutoff and complete quartets recalculate; cutoff downtime cannot show unreconfirmed as Playing',
    recipients: 'unreconfirmed accepted registrants only'
  },
  {
    events: ['match_event_cancelled'],
    testName:
      'notifies terminal, requesting and invited identities once while retaining departure history',
    recipients: 'distinct authorized roster/request/invite identities'
  },
  {
    events: ['match_event_updated'],
    testName: 'venue price and notes notify and audit without consent change',
    recipients: 'authorized management audience; no-op emits []'
  },
  {
    events: ['match_event_ownership_transferred'],
    testName:
      'transfer to accepted Reserve preserves every ordinal, publisher and photo; former creator loses controls',
    recipients: 'distinct existing management audience'
  },
  {
    events: ['cutoff_playing'],
    testName:
      'keeps a complete quartet playable and silent: the processor writes no state change and no cutoff alert',
    recipients: '[]: unchanged complete Playing quartet stays silent'
  },
  {
    events: ['match_registration_not_playing', 'match_registration_expired'],
    testName:
      'expires every pending request and flips only the residual Reserve, preserving the complete quartet and the accepted order',
    recipients: 'each pending request expiry and residual Reserve; unchanged quartet []'
  },
  {
    events: [
      'result_added',
      'result_review_needed',
      'result_corrected',
      'result_disputed',
      'result_confirmed'
    ],
    testName:
      'fans out exact versioned recipients through correction, dispute and manual confirmation',
    recipients:
      'exact proposer/opposing reviewers/participant sets per immutable version; outsiders []'
  },
  {
    events: ['result_deadline_reminder'],
    testName:
      'sends once-per-version reminders and current-creator entry-ready alerts using database time',
    recipients: 'eligible outstanding reviewers; current creator for entry-ready'
  },
  {
    events: ['result_entry_ready'],
    testName: 'notifies creator for finished frozen playable roster without a proposal, once only',
    recipients: '[current creator.id]; Friendly/Reserve excluded'
  },
  {
    events: ['result_amendment_requested'],
    testName: 'amendment request alerts only decision makers, retries dedupe',
    recipients: '[amendments.p0.id, amendments.admin.id]'
  },
  {
    events: ['result_amendment_accepted', 'result_amendment_rejected'],
    testName: 'amendment %s decision notifies requester without actor/outsider fanout',
    recipients: '[amendments.p3.id], approve/reject parameter cases'
  },
  {
    events: ['result_amendment_auto_accepted'],
    testName: 'amendment deadline auto-accept alerts requester once through actual processor',
    recipients: '[amendments.p3.id]'
  },
  {
    events: ['result_amendment_resolved', 'result_repair_applied'],
    testName:
      'publishes the completion audit and notice once, with the old and new revisions, and repeats add nothing',
    recipients: 'affected confirmed participants, deduped by operation/version'
  },
  {
    events: ['result_repair_queued'],
    testName:
      'rolls everything back after the League snapshot and before the statistics, then converges',
    recipients: 'affected participant set, atomic repair publication'
  },
  {
    events: ['result_repair_failed'],
    testName:
      'notifies the operators once per failure, dedupes repeated failures, and resolves on success',
    recipients: 'current authorized platform operators only'
  },
  {
    events: ['visible_level_changed', 'reliability_changed'],
    testName: 'visible rating publication %s follows actual confirmed results',
    recipients: 'exact changed rating owners, level_only/reliability_only parameter cases'
  },
  {
    events: ['combined_rating_changed'],
    testName:
      'committed rating publication combines visible level/reliability; replay never publishes intermediate calculations',
    recipients: 'changed[] from before/after published values, one row per owner'
  },
  {
    events: ['level_review_submitted', 'level_review_requested'],
    testName:
      'level review submission receipt and actionable platform-review audience use exact current permission set',
    recipients:
      '[reviews.owner.id] receipt; queried current nonanonymous nonprovisional platform admins excluding owner'
  },
  {
    events: ['level_review_approved'],
    testName: 'notifies the owner of an approval once, in the same transaction, with a safe target',
    recipients: '[owner.id]; deciding admin []'
  },
  {
    events: ['level_review_rejected'],
    testName: 'notifies a rejection with the visible note and no adjustment',
    recipients: '[owner.id]'
  },
  {
    events: ['league_started'],
    testName:
      'League scheduled start includes authorized actor/member only; replay has no new alert',
    recipients: '[leagues.admin.id, leagues.owner.id, leagues.member.id]'
  },
  {
    events: ['league_closed', 'league_standings_published'],
    testName:
      'League close and first snapshot are separate events with exact authorized audience and replay identity',
    recipients: '[leagues.admin.id, leagues.owner.id, leagues.member.id]'
  },
  {
    events: ['league_standings_amended'],
    testName:
      'late standings publication keys immutable snapshot identity, not mutable live standings or reads',
    recipients: 'kit.players.map(p => p.id), authorized snapshot audience'
  }
];
