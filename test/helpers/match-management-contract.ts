/** Independent T06 contract: adding a producer must update SQL readers and UI copy. */
export const MANAGEMENT_NOTIFICATION_COPY = {
  match_invitation_accepted: 'invitationAcceptedBody',
  match_invitation_declined: 'invitationDeclinedBody',
  match_invitation_expired: 'invitationExpiredBody',
  match_registration_withdrawn: 'registrationWithdrawnBody',
  match_registration_removed: 'registrationRemovedBody',
  match_registration_group_changed: 'registrationGroupChangedBody',
  match_event_ownership_transferred: 'ownershipTransferredBody',
  match_event_cancelled: 'cancelledBody',
  match_event_updated: 'updatedBody',
  match_reconfirmation_required: 'reconfirmationRequiredBody',
  match_registration_reconfirmed: 'reconfirmedBody',
  match_reconfirmation_expired: 'reconfirmationExpiredBody'
} as const;

export const MANAGEMENT_COMPONENTS = [
  'MatchInvitationPanel',
  'MatchParticipantActions',
  'MatchRemovalDialog',
  'MatchOrganizerActions',
  'MatchTransferDialog',
  'MatchCancelDialog',
  'MatchEditDialog',
  'MatchReconfirmationPanel',
  'MatchManagementUnavailable'
] as const;
