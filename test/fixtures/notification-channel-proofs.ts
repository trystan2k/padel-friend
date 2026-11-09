import type { NOTIFICATION_CHANNEL_MATRIX } from './notification-channel-matrix';
import type { ProofEvidence } from '../helpers/notification-proof-source';

type Event = (typeof NOTIFICATION_CHANNEL_MATRIX)[number]['event'];
type Proof = {
  events: readonly Event[];
  testName: string;
  recipients: string;
  // Per event: the command that performs the transition and the notification kind the test must assert
  // (for exclusion rows, the positive counterpart kind plus `silence` for the unaffected recipients).
  evidence: { readonly [E in Event]?: ProofEvidence };
};
// Recipient expressions name the exact fixture sets asserted by each domain test, not a second
// hand-maintained set of UUIDs. IDs are freshly allocated by the domain fixtures on every run.
export const NOTIFICATION_CHANNEL_PROOFS: readonly Proof[] = [
  {
    events: ['community_invitation'],
    testName:
      'persists exact invitation alert, allowlists its payload, and handles duplicate invite attempts',
    recipients: '[invitee.id]',
    evidence: {
      community_invitation: { kind: 'community_invitation', command: 'community_invitations' }
    }
  },
  {
    events: [
      'community_membership_approved',
      'community_membership_denied',
      'community_membership_removed'
    ],
    testName: 'emits approval, denial, admin-removal and role alerts; unauthorized calls emit none',
    recipients: '[affected member.id]; unauthorized actor emits []',
    evidence: {
      community_membership_approved: {
        kind: 'community_membership_approved',
        command: 'govern_community_member'
      },
      community_membership_denied: {
        kind: 'community_membership_denied',
        command: 'govern_community_member'
      },
      community_membership_removed: {
        kind: 'community_membership_removed',
        command: 'govern_community_member'
      }
    }
  },
  {
    events: ['role_promotion'],
    testName: 'role promotion notifies only changed member; repeated no-op emits nothing',
    recipients: '[leagues.member.id]',
    evidence: {
      role_promotion: { kind: 'community_role_changed', command: 'govern_community_member' }
    }
  },
  {
    events: ['role_demotion'],
    testName: 'role demotion uses next immutable member revision, independent of deleted alerts',
    recipients: '[leagues.member.id]',
    evidence: {
      role_demotion: { kind: 'community_role_changed', command: 'govern_community_member' }
    }
  },
  {
    events: ['role_ownership_transfer'],
    testName:
      'administration transfer announces every role actually changed, including former administrator',
    recipients: '[leagues.owner.id, leagues.admin.id], one per changed membership',
    evidence: {
      role_ownership_transfer: {
        kind: 'community_role_changed',
        command: 'govern_community_member'
      }
    }
  },
  {
    events: ['match_event_published', 'match_event_invitation'],
    testName:
      'verifies transactional producers, authorization, enrichment, idempotency, and v1 compatibility with publishable JWT actors',
    recipients:
      '[active.id, invitee.id] for publication; direct invitees (active, privateMember, privateOutsider) for invitation; creator/pending/inactive/outsider []',
    evidence: {
      match_event_published: { kind: 'match_event_published', command: 'publish_match_event' },
      match_event_invitation: { kind: 'match_event_invitation', command: 'publish_match_event' }
    }
  },
  {
    events: ['match_invitation_accepted'],
    testName:
      'ordinary join accepts pending invite and every invitation kind resolves both notification readers',
    recipients: '[f.creator.id]',
    evidence: {
      match_invitation_accepted: {
        kind: 'match_invitation_accepted',
        command: 'submit_match_registration'
      }
    }
  },
  {
    events: ['match_invitation_declined'],
    testName: 'decline persists once and notifies creator once',
    recipients: '[f.creator.id]',
    evidence: {
      match_invitation_declined: {
        kind: 'match_invitation_declined',
        command: 'respond_match_event_invitation'
      }
    }
  },
  {
    events: ['match_invitation_expired'],
    testName: 'expiry persists once and notifies creator and invitee once',
    recipients: '[creator.id, invitee.id]',
    evidence: {
      match_invitation_expired: {
        kind: 'match_invitation_expired',
        command: 'process_match_event_registration_cutoff'
      }
    }
  },
  {
    events: ['guest_registration_requested', 'guest_registration_rejected'],
    testName: 'delivers the request alert once and rejects duplicates while pending and accepted',
    recipients: '[actors.creator.id] per request; [actors.guestDuplicate.id] for the rejection',
    evidence: {
      guest_registration_requested: {
        kind: 'match_registration_requested',
        command: 'submit_match_registration'
      },
      guest_registration_rejected: {
        kind: 'match_registration_rejected',
        command: 'decide_match_registration'
      }
    }
  },
  {
    events: ['guest_registration_approved'],
    testName: 'approves a guest request without ever creating or mutating a community_members row',
    recipients: '[actors.guest1.id]',
    evidence: {
      guest_registration_approved: {
        kind: 'match_registration_approved',
        command: 'decide_match_registration'
      }
    }
  },
  {
    events: ['out_of_range_registration_requested', 'out_of_range_registration_rejected'],
    testName:
      'reuses the identity row for re-application after rejection and expiry without ordinal reuse',
    recipients: '[actors.creator.id] per request; [actors.memberC.id] for the rejection',
    evidence: {
      out_of_range_registration_requested: {
        kind: 'match_registration_requested',
        command: 'submit_match_registration'
      },
      out_of_range_registration_rejected: {
        kind: 'match_registration_rejected',
        command: 'decide_match_registration'
      }
    }
  },
  {
    events: ['out_of_range_registration_approved'],
    testName: 'approves atomically and replays idempotently without a second ordinal or alert',
    recipients:
      '[actors.memberC.id, actors.memberB.id, actors.memberNoRating.id], one per approval',
    evidence: {
      out_of_range_registration_approved: {
        kind: 'match_registration_approved',
        command: 'decide_match_registration'
      }
    }
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
      'm3 playing; m1/m2/creator promoted; completed quartet; new residual player Reserve only',
    evidence: {
      match_registration_playing: {
        kind: 'match_registration_playing',
        command: 'submit_match_registration'
      },
      match_registration_reserve: {
        kind: 'match_registration_reserve',
        command: 'submit_match_registration'
      },
      match_registration_promoted: {
        kind: 'match_registration_promoted',
        command: 'decide_match_registration'
      },
      match_registration_quartet_complete: {
        kind: 'match_registration_quartet_complete',
        command: 'submit_match_registration'
      }
    }
  },
  {
    events: ['match_registration_withdrawn', 'match_registration_group_changed'],
    testName:
      'withdrawal notifies the organizer and departing player and every changed surviving membership once',
    recipients:
      '[f.creator.id, target.id] withdrawn; [f.creator.id, members 1-6] group changed; [members[7].id] promoted',
    evidence: {
      match_registration_withdrawn: {
        kind: 'match_registration_withdrawn',
        command: 'withdraw_match_registration'
      },
      match_registration_group_changed: {
        kind: 'match_registration_group_changed',
        command: 'withdraw_match_registration'
      }
    }
  },
  {
    events: ['match_registration_removed'],
    testName:
      'removes one of eight into four Playing and three Reserve, preserving ordinals and exact effects',
    recipients: '[target.id, f.creator.id] removed; seven group-changed memberships',
    evidence: {
      match_registration_removed: {
        kind: 'match_registration_removed',
        command: 'remove_match_registration'
      }
    }
  },
  {
    events: ['match_reconfirmation_required'],
    testName:
      'Competitive Friendly change requires every accepted player including creator to reconfirm',
    recipients: '[f.creator.id, player.id] required; [pending.id, invited.id] updated',
    evidence: {
      match_reconfirmation_required: {
        kind: 'match_reconfirmation_required',
        command: 'edit_match_event'
      }
    }
  },
  {
    events: ['match_registration_reconfirmed'],
    testName: 'reconfirm preserves original FIFO and is self-only idempotent',
    recipients:
      '[players..., f.creator.id x4]: reconfirming player and organizer per effective reconfirmation',
    evidence: {
      match_registration_reconfirmed: {
        kind: 'match_registration_reconfirmed',
        command: 'reconfirm_match_registration'
      }
    }
  },
  {
    events: ['match_reconfirmation_expired'],
    testName:
      'unreconfirmed accepted rows expire at cutoff and complete quartets recalculate; cutoff downtime cannot show unreconfirmed as Playing',
    recipients: '[f.creator.id]: the unreconfirmed accepted registrant',
    evidence: {
      match_reconfirmation_expired: {
        kind: 'match_reconfirmation_expired',
        command: 'process_match_event_registration_cutoff'
      }
    }
  },
  {
    events: ['match_event_cancelled'],
    testName:
      'notifies terminal, requesting and invited identities once while retaining departure history',
    recipients: '[f.creator.id, departed.id, requester.id, invitee.id]',
    evidence: {
      match_event_cancelled: { kind: 'match_event_cancelled', command: 'cancel_match_event' }
    }
  },
  {
    events: ['match_event_updated'],
    testName: 'venue price and notes notify and audit without consent change',
    recipients: '[f.creator.id, accepted.id, pending.id, invited.id]',
    evidence: {
      match_event_updated: { kind: 'match_event_updated', command: 'edit_match_event' }
    }
  },
  {
    events: ['match_event_ownership_transferred'],
    testName:
      'transfer to accepted Reserve preserves every ordinal, publisher and photo; former creator loses controls',
    recipients: '[f.creator.id, target.id]',
    evidence: {
      match_event_ownership_transferred: {
        kind: 'match_event_ownership_transferred',
        command: 'transfer_match_event_ownership'
      }
    }
  },
  {
    events: ['cutoff_playing', 'match_registration_not_playing', 'match_registration_expired'],
    testName:
      'expires every pending request and flips only the residual Reserve, preserving the complete quartet and the accepted order',
    recipients: '[m4.id] not playing; [g1.id, g2.id] expired; quartet [creator, m1, m2, m3] silent',
    evidence: {
      cutoff_playing: {
        kind: 'match_registration_not_playing',
        command: 'process_match_event_registration_cutoff',
        silence: true
      },
      match_registration_not_playing: {
        kind: 'match_registration_not_playing',
        command: 'process_match_event_registration_cutoff'
      },
      match_registration_expired: {
        kind: 'match_registration_expired',
        command: 'process_match_event_registration_cutoff'
      }
    }
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
      'exact proposer/opposing reviewers/participant sets per immutable version; outsiders []',
    evidence: {
      result_added: { kind: 'result_added', command: 'f.submit' },
      result_review_needed: { kind: 'result_review_needed', command: 'f.submit' },
      result_corrected: { kind: 'result_corrected', command: 'correct_match_event_result' },
      result_disputed: { kind: 'result_disputed', command: 'review_match_event_result' },
      result_confirmed: { kind: 'result_confirmed', command: 'review_match_event_result' }
    }
  },
  {
    events: ['result_deadline_reminder'],
    testName:
      'sends once-per-version reminders and current-creator entry-ready alerts using database time',
    recipients: 'eligible outstanding reviewers; current creator for entry-ready',
    evidence: {
      result_deadline_reminder: {
        kind: 'result_deadline_reminder',
        command: 'processDueMatchEventResults'
      }
    }
  },
  {
    events: ['result_entry_ready'],
    testName: 'notifies creator for finished frozen playable roster without a proposal, once only',
    recipients: '[current creator.id]; Friendly/Reserve excluded',
    evidence: {
      result_entry_ready: { kind: 'result_entry_ready', command: 'processDueMatchEventResults' }
    }
  },
  {
    events: ['result_amendment_requested'],
    testName: 'amendment request alerts only decision makers, retries dedupe',
    recipients: '[amendments.p0.id, amendments.admin.id]',
    evidence: {
      result_amendment_requested: {
        kind: 'result_amendment_requested',
        command: 'amendments.request'
      }
    }
  },
  {
    events: ['result_amendment_accepted', 'result_amendment_rejected'],
    testName: 'amendment %s decision notifies requester without actor/outsider fanout',
    recipients: '[amendments.p3.id], approve/reject parameter cases',
    evidence: {
      result_amendment_accepted: {
        kind: 'result_amendment_accepted',
        command: 'amendments.review'
      },
      result_amendment_rejected: { kind: 'result_amendment_rejected', command: 'amendments.review' }
    }
  },
  {
    events: ['result_amendment_auto_accepted'],
    testName: 'amendment deadline auto-accept alerts requester once through actual processor',
    recipients: '[amendments.p3.id]',
    evidence: {
      result_amendment_auto_accepted: {
        kind: 'result_amendment_accepted',
        command: 'process_due_result_amendments'
      }
    }
  },
  {
    events: ['result_amendment_resolved', 'result_repair_queued'],
    testName: 'replaces: queues exactly one correction job and never touches the official fact',
    recipients: '[f.p0.id, f.p1.id, f.p2.id, f.p3.id, event organizer] per kind',
    evidence: {
      result_amendment_resolved: { kind: 'result_amendment_resolved', command: 'f.resolve' },
      result_repair_queued: { kind: 'result_repair_queued', command: 'f.resolve' }
    }
  },
  {
    events: ['result_repair_applied'],
    testName:
      'publishes the completion audit and notice once, with the old and new revisions, and repeats add nothing',
    recipients: 'w.october.players: the corrected quartet',
    evidence: {
      result_repair_applied: { kind: 'result_repair_applied', command: 'repairNow' }
    }
  },
  {
    events: ['result_repair_failed'],
    testName:
      'notifies the operators once per failure, dedupes repeated failures, and resolves on success',
    recipients: 'admins: current active community administrators of the corrected event',
    evidence: {
      result_repair_failed: { kind: 'result_repair_failed', command: 'repairNow' }
    }
  },
  {
    events: ['visible_level_changed', 'reliability_changed'],
    testName: 'visible rating publication %s follows actual confirmed results',
    recipients: 'exact changed rating owners, level_only/reliability_only parameter cases',
    evidence: {
      visible_level_changed: { kind: 'rating_changed', command: 'confirmedGroup' },
      reliability_changed: { kind: 'rating_changed', command: 'confirmedGroup' }
    }
  },
  {
    events: ['combined_rating_changed'],
    testName:
      'committed rating publication combines visible level/reliability; replay never publishes intermediate calculations',
    recipients: 'changed[] from before/after published values, one row per owner',
    evidence: {
      combined_rating_changed: { kind: 'rating_changed', command: 'confirmedGroup' }
    }
  },
  {
    events: ['level_review_submitted', 'level_review_requested'],
    testName:
      'level review submission receipt and actionable platform-review audience use exact current permission set',
    recipients:
      '[reviews.owner.id] receipt; queried current nonanonymous nonprovisional platform admins excluding owner',
    evidence: {
      level_review_submitted: { kind: 'level_review_submitted', command: 'submitRequest' },
      level_review_requested: { kind: 'level_review_requested', command: 'submitRequest' }
    }
  },
  {
    events: ['level_review_approved'],
    testName: 'notifies the owner of an approval once, in the same transaction, with a safe target',
    recipients: '[owner.id]; deciding admin []',
    evidence: {
      level_review_approved: { kind: 'level_review_approved', command: 'approveOk' }
    }
  },
  {
    events: ['level_review_rejected'],
    testName: 'notifies a rejection with the visible note and no adjustment',
    recipients: '[owner.id]',
    evidence: {
      level_review_rejected: {
        kind: 'level_review_rejected',
        command: 'resolve_level_review_request'
      }
    }
  },
  {
    events: ['league_started'],
    testName:
      'League scheduled start includes authorized actor/member only; replay has no new alert',
    recipients: '[leagues.admin.id, leagues.owner.id, leagues.member.id]',
    evidence: {
      league_started: { kind: 'league_started', command: 'league_process_community_locked' }
    }
  },
  {
    events: ['league_closed', 'league_standings_published'],
    testName:
      'League close and first snapshot are separate events with exact authorized audience and replay identity',
    recipients: '[leagues.admin.id, leagues.owner.id, leagues.member.id]',
    evidence: {
      league_closed: { kind: 'league_closed', command: 'close_league' },
      league_standings_published: { kind: 'league_standings_published', command: 'close_league' }
    }
  },
  {
    events: ['league_standings_amended'],
    testName:
      'late standings publication keys immutable snapshot identity, not mutable live standings or reads',
    recipients: 'kit.players.map(p => p.id), authorized snapshot audience',
    evidence: {
      league_standings_amended: { kind: 'league_standings_amended', command: 'kit.approve' }
    }
  }
];
