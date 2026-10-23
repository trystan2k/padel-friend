import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  loader: null as (() => Promise<unknown>) | null,
  order: [] as string[],
  management: vi.fn<() => Promise<unknown>>(),
  detail: vi.fn<() => Promise<unknown>>()
}));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute:
    () => (options: { loader: (context: { params: { eventId: string } }) => Promise<unknown> }) => {
      mocks.loader = () =>
        options.loader({ params: { eventId: '11111111-1111-4111-8111-111111111111' } });
      return {};
    }
}));
vi.mock('../src/features/matches/matches.functions', () => ({ getMatchEvent: mocks.detail }));
vi.mock('../src/features/matches/match-management.functions', () => ({
  getMatchEventManagement: mocks.management
}));
vi.mock('../src/features/matches/match-registration.functions', () => ({
  getMyMatchRegistration: async () => ({ status: 'ok', registration: null }),
  listMatchEventRegistrations: async () => ({ status: 'ok', entries: [] })
}));
vi.mock('../src/features/player/player.functions', () => ({
  getMyPlayerProfile: async () => ({ display_level: null })
}));
vi.mock('../src/features/matches/match-invitation.functions', () => ({
  getMyMatchInvitation: async () => ({ status: 'ok', invitation: null })
}));
import '../src/routes/_protected.matches.$eventId';
beforeEach(() => {
  mocks.order.length = 0;
  vi.clearAllMocks();
});
describe('edit loader version ordering', () => {
  it('reads expected version before draft facts so concurrent edits cannot silently overwrite', async () => {
    mocks.management.mockImplementation(async () => {
      mocks.order.push('version');
      return { status: 'ok', value: { version: 1, is_organizer: false } };
    });
    mocks.detail.mockImplementation(async () => {
      mocks.order.push('facts');
      return { status: 'ok', event: { venue_name: 'New concurrent facts' } };
    });
    if (!mocks.loader) throw new Error('Missing loader');
    expect(await mocks.loader()).toMatchObject({
      eventManagement: { version: 1 },
      event: { venue_name: 'New concurrent facts' }
    });
    expect(mocks.order).toEqual(['version', 'facts']);
  });
});
