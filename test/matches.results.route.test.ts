import { describe, expect, it, vi } from 'vitest';
import { makeMatchDetail } from './helpers/match-fixtures';

const mocks = vi.hoisted(() => ({
  loader: null as (() => Promise<unknown>) | null,
  event: vi.fn<() => Promise<unknown>>()
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute:
    () => (options: { loader: (context: { params: { eventId: string } }) => Promise<unknown> }) => {
      mocks.loader = () =>
        options.loader({ params: { eventId: '11111111-1111-4111-8111-111111111111' } });
      return {};
    }
}));
vi.mock('../src/features/matches/RecordMatchResultPage', () => ({
  RecordMatchResultPage: vi.fn<() => void>()
}));
vi.mock('../src/features/matches/matches.functions', () => ({ getMatchEvent: mocks.event }));
vi.mock('../src/features/matches/match-management.functions', () => ({
  getMatchEventManagement: async () => ({ status: 'ok', value: null }),
  listMatchEventManagementParticipants: async () => ({ status: 'ok', value: [] })
}));
vi.mock('../src/features/matches/match-registration.functions', () => ({
  listMatchEventRegistrations: async () => ({ status: 'ok', entries: [] })
}));
vi.mock('../src/features/matches/match-result.functions', () => ({
  getMatchEventResultProposals: async () => ({ status: 'ok', value: [] })
}));

import '../src/routes/_protected.matches.$eventId.record';

describe('record result route loader', () => {
  it.each([{ status: 'error', code: 'unavailable' }, { status: 'unavailable' }, null])(
    'marks a non-ok event result %j as a load error',
    async (event) => {
      mocks.event.mockResolvedValueOnce(event);
      if (!mocks.loader) throw new Error('Missing loader');
      expect(await mocks.loader()).toMatchObject({ event: null, loadError: true });
    }
  );

  it('preserves a successfully loaded event without a load error', async () => {
    const event = makeMatchDetail();
    mocks.event.mockResolvedValueOnce({ status: 'ok', event });
    if (!mocks.loader) throw new Error('Missing loader');
    expect(await mocks.loader()).toMatchObject({ event, loadError: false });
  });
});
