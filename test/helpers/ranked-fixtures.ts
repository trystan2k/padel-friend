import { matchPhotoFixture } from './match-photo-fixtures';
import type { LeagueActor } from './league-fixtures';
import { executeTrustedSql } from './sql-transport';

/** Calendar day `offsetDays` ahead of today in UTC, as `YYYY-MM-DD`. */
export const isoDay = (offsetDays: number): string =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

export const sqlMessage = async (sql: string): Promise<string | null> => {
  try {
    await executeTrustedSql(sql);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

/**
 * Publishes a Competitive event through the real RPC with an explicit Unranked default, so a
 * League created by the same test can never flip the event to Ranked by accident.
 */
export async function publishCompetitive(
  actor: LeagueActor,
  communityId: string,
  overrides: Record<string, unknown> = {},
  inviteeIds: string[] = [],
  eventId: string = crypto.randomUUID()
) {
  const photo = matchPhotoFixture(communityId, eventId, actor.id);
  await executeTrustedSql(photo.sql);
  const result = await actor.client.rpc('publish_match_event', {
    p_event_id: eventId,
    p_input: {
      community_id: communityId,
      date: isoDay(3),
      start_time: '10:00',
      event_type: 'competitive',
      competition: 'unranked',
      visibility: 'community_open',
      team_assignment_mode: 'POST_MATCH_TEAMS',
      venue_name: 'Ranked court',
      maps_url: 'https://maps.google.com/maps/place/ranked-fixture',
      photo_path: photo.path,
      ...overrides
    },
    p_invitee_ids: inviteeIds
  });
  return { eventId, result };
}
