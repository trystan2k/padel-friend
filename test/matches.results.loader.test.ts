import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resultProposal } from './helpers/match-result-fixtures';

const load = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
vi.mock('../src/features/matches/match-result.functions', () => ({
  getMatchEventResultProposals: load
}));

import { loadMatchResultProposals } from '../src/features/matches/match-result.routes';

describe('feature-owned result route loader', () => {
  beforeEach(() => vi.resetAllMocks());

  it('keeps authorized proposal payloads and reports safe read failures', async () => {
    load.mockResolvedValue({
      status: 'ok',
      value: [
        resultProposal,
        {
          ...resultProposal,
          proposal_id: '11111111-1111-4111-8111-111111111119',
          status: 'disputed'
        },
        {
          ...resultProposal,
          proposal_id: '11111111-1111-4111-8111-111111111118',
          status: 'confirmed'
        }
      ],
      replayed: false
    });
    expect(await loadMatchResultProposals('event')).toEqual({
      proposals: [resultProposal],
      proposalsError: false
    });
    expect(load).toHaveBeenCalledExactlyOnceWith({ data: { event_id: 'event' } });

    load.mockResolvedValue({ status: 'error', code: 'forbidden' });
    expect(await loadMatchResultProposals('event')).toEqual({
      proposals: [],
      proposalsError: false
    });
    load.mockResolvedValue({ status: 'error', code: 'unavailable' });
    expect(await loadMatchResultProposals('event')).toEqual({
      proposals: [],
      proposalsError: true
    });
    load.mockRejectedValue(new Error('private RPC failure'));
    expect(await loadMatchResultProposals('event')).toEqual({
      proposals: [],
      proposalsError: true
    });
  });
});
