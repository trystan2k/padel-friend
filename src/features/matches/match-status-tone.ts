import type { StatusBadgeTone } from '../../components/ui/StatusBadge';
import type { MatchCallerBadge } from './match-contracts';
import type {
  MatchRegistrationAction,
  MatchRegistrationParticipation,
  MatchRegistrationSource
} from './match-registration-model';

export const participationTone = {
  playing: 'positive',
  reserve: 'neutral',
  reserve_not_playing: 'muted'
} satisfies Record<MatchRegistrationParticipation, StatusBadgeTone>;

export const registrationStateTone = {
  pending: 'neutral',
  rejected: 'danger',
  expired: 'muted'
} satisfies Record<'pending' | 'rejected' | 'expired', StatusBadgeTone>;

export const registrationActionTone = {
  join: 'positive',
  request: 'neutral',
  full: 'danger',
  closed: 'muted',
  invited: 'neutral',
  none: 'muted'
} satisfies Record<MatchRegistrationAction, StatusBadgeTone>;

export const registrationSourceTone = {
  creator: 'muted',
  member: 'muted',
  guest: 'guest'
} satisfies Record<MatchRegistrationSource, StatusBadgeTone>;

export const callerBadgeTone = {
  creator: 'muted',
  playing: 'positive',
  reserve: 'neutral',
  reserve_not_playing: 'muted',
  invited: 'neutral',
  reconfirmation_required: 'danger'
} satisfies Record<MatchCallerBadge, StatusBadgeTone>;
