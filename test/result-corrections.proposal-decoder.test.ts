import { describe, expect, it } from 'vitest';
import { parseResultProposals } from '../src/features/matches/match-result-model';
import { resultIds, resultProposal } from './helpers/match-result-fixtures';

function applied(source: 'MANUAL' | 'ADMIN_OVERRIDE', rejected = false) {
  const confirmation = {
    confirmation_id: resultIds[3],
    source,
    actor_id: resultIds[2],
    confirmed_at: '2026-10-01T13:00:00Z',
    effective_at: '2026-10-01T13:00:00Z'
  };
  const decision = {
    reviewer_id: resultIds[2],
    reviewer_name: 'Reviewer',
    decision: rejected ? 'reject' : 'approve',
    reason_code: rejected ? 'SCORE_INCORRECT' : null,
    reason_note: null,
    decided_at: '2026-10-01T12:30:00Z'
  };
  return {
    ...resultProposal,
    version: 2,
    status: 'confirmed',
    team_b_approval_count: rejected ? 0 : 1,
    received_team_coverage_count: rejected ? 0 : 1,
    caller_decision: rejected ? 'reject' : 'approve',
    confirmation,
    version_timeline: [
      {
        ...resultProposal.version_timeline[0],
        status: 'superseded',
        confirmation_id: resultIds[1]
      },
      {
        ...resultProposal.version_timeline[0],
        version: 2,
        status: 'confirmed',
        confirmation_id: confirmation.confirmation_id,
        decisions: [decision]
      }
    ]
  };
}

describe('applied correction proposal decoding', () => {
  it('retains superseded official confirmation pointers after ordinary player approval', () => {
    const parsed = parseResultProposals([applied('MANUAL')]);
    expect(parsed?.[0]?.version_timeline[0]?.confirmation_id).toBe(resultIds[1]);
    expect(parsed?.[0]?.confirmation?.source).toBe('MANUAL');
  });
  it('accepts explicit admin override without erasing the prior rejection', () => {
    const parsed = parseResultProposals([applied('ADMIN_OVERRIDE', true)]);
    expect(parsed?.[0]?.confirmation?.source).toBe('ADMIN_OVERRIDE');
    expect(parsed?.[0]?.version_timeline[1]?.decisions[0]?.decision).toBe('reject');
  });
  it('still rejects a manual confirmation with rejection evidence', () => {
    expect(parseResultProposals([applied('MANUAL', true)])).toBeNull();
  });
  it('requires an actor and matching effective time for admin override', () => {
    const value = applied('ADMIN_OVERRIDE', true);
    expect(
      parseResultProposals([{ ...value, confirmation: { ...value.confirmation, actor_id: null } }])
    ).toBeNull();
    expect(
      parseResultProposals([
        { ...value, confirmation: { ...value.confirmation, effective_at: '2026-10-01T14:00:00Z' } }
      ])
    ).toBeNull();
  });
});
