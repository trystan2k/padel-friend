import { describe, expect, it } from 'vitest';
import {
  MANAGEMENT_ACTIONS,
  parseMatchEventManagement
} from '../src/features/matches/match-management-model';
import { managementUnavailableReason } from '../src/features/matches/MatchManagementUnavailable';

const dto = {
  version: 1,
  status: 'open',
  phase: 'open',
  as_of: '2030-01-01T00:00:00Z',
  owner_id: '11111111-1111-4111-8111-111111111111',
  is_organizer: true,
  is_participant: true,
  results_protected: false,
  reconfirmation_generation: 0,
  required_count: 0,
  actions: Object.fromEntries(
    MANAGEMENT_ACTIONS.map((action) => [action, { allowed: true, reason: null }])
  ),
  correction: { available: false, reason: 'results_workflow_unavailable' }
};
describe('fail-closed management capabilities', () => {
  it('accepts complete action contracts and rejects missing or contradictory protection', () => {
    expect(parseMatchEventManagement(dto)).not.toBeNull();
    for (const action of MANAGEMENT_ACTIONS) {
      const actions = { ...dto.actions };
      delete actions[action];
      expect(parseMatchEventManagement({ ...dto, actions })).toBeNull();
    }
    expect(parseMatchEventManagement({ ...dto, results_protected: 'false' })).toBeNull();
    expect(parseMatchEventManagement({ ...dto, results_protected: true })).toBeNull();
    expect(parseMatchEventManagement({ ...dto, status: 'cancelled' })).toBeNull();
    expect(parseMatchEventManagement({ ...dto, phase: 'started' })).toBeNull();
    expect(parseMatchEventManagement({ ...dto, phase: 'awaiting_results' })).toBeNull();
    expect(
      parseMatchEventManagement({ ...dto, correction: { available: true, href: '/correction' } })
    ).toBeNull();
  });
  it.each(['cancelled', 'result_protected', 'started', 'closed', 'forbidden'] as const)(
    'capabilities match role deadline and result precedence: %s',
    (reason) => {
      const management = parseMatchEventManagement({
        ...dto,
        status: reason === 'cancelled' ? 'cancelled' : 'open',
        phase: reason === 'started' ? 'started' : reason === 'cancelled' ? 'cancelled' : 'open',
        results_protected: reason === 'result_protected',
        actions: Object.fromEntries(
          MANAGEMENT_ACTIONS.map((action) => [action, { allowed: false, reason }])
        )
      });
      expect(management).not.toBeNull();
      expect(managementUnavailableReason(management, reason)).toBe(reason);
      expect(managementUnavailableReason(management, 'cancelled')).toBe('cancelled');
    }
  );
  it('fails closed for stale data without pretending results exist', () => {
    expect(managementUnavailableReason(null)).toBe('unavailable');
    expect(managementUnavailableReason(parseMatchEventManagement(dto), 'started')).toBe('started');
  });
});
