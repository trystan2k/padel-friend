// Versioned AC3 inventory. Distinct transitions stay distinct even when sharing notification kind.
export type NotificationChannelRow = {
  event: string;
  category: 'community' | 'matches' | 'results' | 'rankings' | 'leagues';
  inventory: 'existing' | 'added';
  seam: string;
  proof: string;
};
export const NOTIFICATION_CHANNEL_MATRIX_VERSION = 1;
export const NOTIFICATION_CHANNEL_MATRIX = [
  {
    event: 'community_invitation',
    category: 'community',
    inventory: 'existing',
    seam: 'notify_community_invitation',
    proof: 'test/notifications.producers.integration.test.ts'
  },
  {
    event: 'community_membership_approved',
    category: 'community',
    inventory: 'existing',
    seam: 'notify_community_membership',
    proof: 'test/notifications.producers.integration.test.ts'
  },
  {
    event: 'community_membership_denied',
    category: 'community',
    inventory: 'existing',
    seam: 'notify_community_membership',
    proof: 'test/notifications.producers.integration.test.ts'
  },
  {
    event: 'community_membership_removed',
    category: 'community',
    inventory: 'existing',
    seam: 'notify_community_membership',
    proof: 'test/notifications.producers.integration.test.ts'
  },
  {
    event: 'role_promotion',
    category: 'community',
    inventory: 'added',
    seam: 'notify_community_role_change',
    proof: 'test/notifications.channel-matrix.integration.test.ts'
  },
  {
    event: 'role_demotion',
    category: 'community',
    inventory: 'added',
    seam: 'notify_community_role_change',
    proof: 'test/notifications.channel-matrix.integration.test.ts'
  },
  {
    event: 'role_ownership_transfer',
    category: 'community',
    inventory: 'added',
    seam: 'notify_community_role_change',
    proof: 'test/notifications.channel-matrix.integration.test.ts'
  },
  {
    event: 'match_event_published',
    category: 'matches',
    inventory: 'existing',
    seam: 'notify_match_event_published',
    proof: 'test/matches.notifications.integration.test.ts'
  },
  {
    event: 'match_event_invitation',
    category: 'matches',
    inventory: 'existing',
    seam: 'notify_match_event_invitation',
    proof: 'test/matches.invitations.integration.test.ts'
  },
  {
    event: 'match_invitation_accepted',
    category: 'matches',
    inventory: 'existing',
    seam: 'notify_match_event_invitation',
    proof: 'test/matches.invitations.integration.test.ts'
  },
  {
    event: 'match_invitation_declined',
    category: 'matches',
    inventory: 'existing',
    seam: 'notify_match_event_invitation',
    proof: 'test/matches.invitations.integration.test.ts'
  },
  {
    event: 'match_invitation_expired',
    category: 'matches',
    inventory: 'existing',
    seam: 'notify_match_event_invitation',
    proof: 'test/matches.invitations.integration.test.ts'
  },
  {
    event: 'guest_registration_requested',
    category: 'matches',
    inventory: 'existing',
    seam: 'submit_match_registration',
    proof: 'test/matches.registration.actions.integration.test.ts'
  },
  {
    event: 'out_of_range_registration_requested',
    category: 'matches',
    inventory: 'existing',
    seam: 'submit_match_registration',
    proof: 'test/matches.registration.actions.integration.test.ts'
  },
  {
    event: 'guest_registration_approved',
    category: 'matches',
    inventory: 'existing',
    seam: 'submit_match_registration',
    proof: 'test/matches.registration.actions.integration.test.ts'
  },
  {
    event: 'guest_registration_rejected',
    category: 'matches',
    inventory: 'existing',
    seam: 'submit_match_registration',
    proof: 'test/matches.registration.actions.integration.test.ts'
  },
  {
    event: 'out_of_range_registration_approved',
    category: 'matches',
    inventory: 'existing',
    seam: 'submit_match_registration',
    proof: 'test/matches.registration.actions.integration.test.ts'
  },
  {
    event: 'out_of_range_registration_rejected',
    category: 'matches',
    inventory: 'existing',
    seam: 'submit_match_registration',
    proof: 'test/matches.registration.actions.integration.test.ts'
  },
  {
    event: 'match_registration_playing',
    category: 'matches',
    inventory: 'existing',
    seam: 'reconcile_match_registration_participation',
    proof: 'test/matches.registration.notifications.integration.test.ts'
  },
  {
    event: 'match_registration_reserve',
    category: 'matches',
    inventory: 'existing',
    seam: 'reconcile_match_registration_participation',
    proof: 'test/matches.registration.notifications.integration.test.ts'
  },
  {
    event: 'match_registration_promoted',
    category: 'matches',
    inventory: 'existing',
    seam: 'reconcile_match_registration_participation',
    proof: 'test/matches.registration.notifications.integration.test.ts'
  },
  {
    event: 'match_registration_quartet_complete',
    category: 'matches',
    inventory: 'existing',
    seam: 'reconcile_match_registration_participation',
    proof: 'test/matches.registration.notifications.integration.test.ts'
  },
  {
    event: 'match_registration_withdrawn',
    category: 'matches',
    inventory: 'existing',
    seam: 'withdraw_match_registration',
    proof: 'test/matches.management.departures.integration.test.ts'
  },
  {
    event: 'match_registration_removed',
    category: 'matches',
    inventory: 'existing',
    seam: 'withdraw_match_registration',
    proof: 'test/matches.management.departures.integration.test.ts'
  },
  {
    event: 'match_registration_group_changed',
    category: 'matches',
    inventory: 'existing',
    seam: 'withdraw_match_registration',
    proof: 'test/matches.management.departures.integration.test.ts'
  },
  {
    event: 'match_reconfirmation_required',
    category: 'matches',
    inventory: 'existing',
    seam: 'edit_match_event',
    proof: 'test/matches.reconfirmation.integration.test.ts'
  },
  {
    event: 'match_registration_reconfirmed',
    category: 'matches',
    inventory: 'existing',
    seam: 'edit_match_event',
    proof: 'test/matches.reconfirmation.integration.test.ts'
  },
  {
    event: 'match_reconfirmation_expired',
    category: 'matches',
    inventory: 'existing',
    seam: 'edit_match_event',
    proof: 'test/matches.reconfirmation.integration.test.ts'
  },
  {
    event: 'match_event_cancelled',
    category: 'matches',
    inventory: 'existing',
    seam: 'edit_match_event',
    proof: 'test/matches.management.cancellation.integration.test.ts'
  },
  {
    event: 'match_event_updated',
    category: 'matches',
    inventory: 'existing',
    seam: 'edit_match_event',
    proof: 'test/matches.management.edits.integration.test.ts'
  },
  {
    event: 'match_event_ownership_transferred',
    category: 'matches',
    inventory: 'existing',
    seam: 'edit_match_event',
    proof: 'test/matches.management.ownership.integration.test.ts'
  },
  {
    event: 'cutoff_playing',
    category: 'matches',
    inventory: 'existing',
    seam: 'process_due_match_event_registration_cutoffs',
    proof: 'test/matches.registration.cutoff.integration.test.ts'
  },
  {
    event: 'match_registration_not_playing',
    category: 'matches',
    inventory: 'existing',
    seam: 'process_due_match_event_registration_cutoffs',
    proof: 'test/matches.registration.cutoff.integration.test.ts'
  },
  {
    event: 'match_registration_expired',
    category: 'matches',
    inventory: 'existing',
    seam: 'process_due_match_event_registration_cutoffs',
    proof: 'test/matches.registration.cutoff.integration.test.ts'
  },
  {
    event: 'result_added',
    category: 'results',
    inventory: 'existing',
    seam: 'notify_match_result_version',
    proof: 'test/matches.results.notifications.integration.test.ts'
  },
  {
    event: 'result_review_needed',
    category: 'results',
    inventory: 'existing',
    seam: 'notify_match_result_version',
    proof: 'test/matches.results.notifications.integration.test.ts'
  },
  {
    event: 'result_corrected',
    category: 'results',
    inventory: 'existing',
    seam: 'notify_match_result_version',
    proof: 'test/matches.results.notifications.integration.test.ts'
  },
  {
    event: 'result_disputed',
    category: 'results',
    inventory: 'existing',
    seam: 'notify_match_result_lifecycle',
    proof: 'test/matches.results.notifications.integration.test.ts'
  },
  {
    event: 'result_confirmed',
    category: 'results',
    inventory: 'existing',
    seam: 'notify_match_result_lifecycle',
    proof: 'test/matches.results.notifications.integration.test.ts'
  },
  {
    event: 'result_deadline_reminder',
    category: 'results',
    inventory: 'existing',
    seam: 'notify_match_result_lifecycle',
    proof: 'test/matches.results.notifications.integration.test.ts'
  },
  {
    event: 'result_entry_ready',
    category: 'results',
    inventory: 'existing',
    seam: 'notify_match_result_lifecycle',
    proof: 'test/matches.results.notifications.integration.test.ts'
  },
  {
    event: 'result_amendment_requested',
    category: 'results',
    inventory: 'added',
    seam: 'notify_result_amendment_event',
    proof: 'test/notifications.channel-matrix.integration.test.ts'
  },
  {
    event: 'result_amendment_accepted',
    category: 'results',
    inventory: 'added',
    seam: 'notify_result_amendment_event',
    proof: 'test/notifications.channel-matrix.integration.test.ts'
  },
  {
    event: 'result_amendment_rejected',
    category: 'results',
    inventory: 'added',
    seam: 'notify_result_amendment_event',
    proof: 'test/notifications.channel-matrix.integration.test.ts'
  },
  {
    event: 'result_amendment_auto_accepted',
    category: 'results',
    inventory: 'added',
    seam: 'notify_result_amendment_event',
    proof: 'test/notifications.channel-matrix.integration.test.ts'
  },
  {
    event: 'result_amendment_resolved',
    category: 'results',
    inventory: 'existing',
    seam: 'record_result_amendment_event',
    proof: 'test/result-corrections.publication.integration.test.ts'
  },
  {
    event: 'result_repair_queued',
    category: 'results',
    inventory: 'existing',
    seam: 'record_result_amendment_event',
    proof: 'test/result-corrections.publication.integration.test.ts'
  },
  {
    event: 'result_repair_applied',
    category: 'results',
    inventory: 'existing',
    seam: 'record_result_amendment_event',
    proof: 'test/result-corrections.publication.integration.test.ts'
  },
  {
    event: 'result_repair_failed',
    category: 'results',
    inventory: 'existing',
    seam: 'record_result_amendment_event',
    proof: 'test/result-corrections.publication.integration.test.ts'
  },
  {
    event: 'visible_level_changed',
    category: 'rankings',
    inventory: 'added',
    seam: 'publish_rating_visible_change',
    proof: 'test/notifications.channel-matrix.integration.test.ts'
  },
  {
    event: 'reliability_changed',
    category: 'rankings',
    inventory: 'added',
    seam: 'publish_rating_visible_change',
    proof: 'test/notifications.channel-matrix.integration.test.ts'
  },
  {
    event: 'combined_rating_changed',
    category: 'rankings',
    inventory: 'added',
    seam: 'publish_rating_visible_change',
    proof: 'test/notifications.channel-matrix.integration.test.ts'
  },
  {
    event: 'level_review_submitted',
    category: 'rankings',
    inventory: 'added',
    seam: 'notify_level_review_submission',
    proof: 'test/notifications.channel-matrix.integration.test.ts'
  },
  {
    event: 'level_review_requested',
    category: 'rankings',
    inventory: 'added',
    seam: 'notify_level_review_submission',
    proof: 'test/notifications.channel-matrix.integration.test.ts'
  },
  {
    event: 'level_review_approved',
    category: 'rankings',
    inventory: 'existing',
    seam: 'notify_level_review_resolution',
    proof: 'test/level-reviews.notifications.integration.test.ts'
  },
  {
    event: 'level_review_rejected',
    category: 'rankings',
    inventory: 'existing',
    seam: 'notify_level_review_resolution',
    proof: 'test/level-reviews.notifications.integration.test.ts'
  },
  {
    event: 'league_started',
    category: 'leagues',
    inventory: 'added',
    seam: 'notify_league_lifecycle',
    proof: 'test/notifications.channel-matrix.integration.test.ts'
  },
  {
    event: 'league_closed',
    category: 'leagues',
    inventory: 'added',
    seam: 'notify_league_lifecycle',
    proof: 'test/notifications.channel-matrix.integration.test.ts'
  },
  {
    event: 'league_standings_published',
    category: 'leagues',
    inventory: 'added',
    seam: 'notify_league_standings_publication',
    proof: 'test/notifications.channel-matrix.integration.test.ts'
  },
  {
    event: 'league_standings_amended',
    category: 'leagues',
    inventory: 'added',
    seam: 'notify_league_standings_publication',
    proof: 'test/notifications.channel-matrix.integration.test.ts'
  }
] as const satisfies readonly NotificationChannelRow[];
