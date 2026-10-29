import { describe, expect, it, vi } from 'vitest';
import { FixtureCleanupRegistry } from './fixture-cleanup';
import {
  registerMatchActorFixtureRows,
  registerMatchCommunityFixtureRows,
  registerMatchEventFixtureRows,
  registerMatchStorageFixtureObject
} from './match-registration-sql';

vi.mock('./sql-transport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./sql-transport')>()),
  registerSqlTransportCleanup: vi.fn<() => void>()
}));

const communityId = '11111111-1111-4111-8111-111111111111';
const eventId = '22222222-2222-4222-8222-222222222222';
const actorId = '33333333-3333-4333-8333-333333333333';

describe('match fixture cleanup registration', () => {
  it('registers only exact actor, community, event, and storage identities', () => {
    const registry = new FixtureCleanupRegistry('match-fixture-registration-test');
    const register = vi.spyOn(registry, 'register');

    registerMatchActorFixtureRows(registry, {
      id: actorId,
      email: 'fixture@example.test'
    });
    registerMatchCommunityFixtureRows(registry, communityId);
    registerMatchEventFixtureRows(registry, eventId, `${communityId}/${eventId}/photo.png`);
    registerMatchStorageFixtureObject(registry, 'community-venue-photos', 'venue/object.png');

    const rows = register.mock.calls.map(([table, identity]) => [table, identity]);
    expect(rows).toContainEqual(['auth.users', { email: 'fixture@example.test' }]);
    expect(rows).toContainEqual(['auth.users', { id: actorId }]);
    expect(rows).toContainEqual(['public.communities', { id: communityId }]);
    expect(rows).toContainEqual(['public.community_members', { community_id: communityId }]);
    expect(rows).toContainEqual(['public.match_events', { id: eventId }]);
    expect(rows).toContainEqual(['public.notification_result_links', { match_event_id: eventId }]);
    expect(rows).toContainEqual([
      'public.match_event_result_entry_ready_dispatch',
      { match_event_id: eventId }
    ]);
    expect(rows).toContainEqual([
      'public.match_event_registration_attempts',
      { match_event_id: eventId }
    ]);
    expect(rows).toContainEqual(['public.notifications', { target_id: eventId }]);
    expect(rows).toContainEqual([
      'storage.objects',
      { bucket_id: 'match-event-photos', name: `${communityId}/${eventId}/photo.png` }
    ]);
    expect(rows).toContainEqual([
      'storage.objects',
      { bucket_id: 'community-venue-photos', name: 'venue/object.png' }
    ]);
  });
});
