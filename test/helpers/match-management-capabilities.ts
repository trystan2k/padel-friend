import type { MatchEventManagement } from '../../src/features/matches/match-management-model';

export function makeMatchManagement(
  overrides: Partial<MatchEventManagement> = {}
): MatchEventManagement {
  return {
    version: 1,
    status: 'open',
    phase: 'open',
    as_of: '2030-01-01T00:00:00Z',
    owner_id: '11111111-1111-4111-8111-111111111111',
    is_organizer: false,
    is_participant: false,
    results_protected: false,
    reconfirmation_generation: 0,
    required_count: 0,
    actions: {
      withdraw: { allowed: false, reason: 'forbidden' },
      remove: { allowed: false, reason: 'forbidden' },
      transfer: { allowed: false, reason: 'forbidden' },
      edit: { allowed: false, reason: 'forbidden' },
      cancel: { allowed: false, reason: 'forbidden' },
      reconfirm: { allowed: false, reason: 'forbidden' },
      decision: { allowed: false, reason: 'forbidden' },
      invitation: { allowed: false, reason: 'forbidden' },
      submit: { allowed: true, reason: null }
    },
    correction: { available: false, reason: 'results_workflow_unavailable' },
    ...overrides
  };
}
