import { randomUUID } from 'node:crypto';

export type MatchPhotoFixture = { path: string; sql: string };

/**
 * Builds a trigger-valid match photo path and the trusted-SQL insert that
 * seeds its storage object, so fixtures never need to disable
 * lock_match_photo_publication.
 */
export function matchPhotoFixture(
  communityId: string,
  eventId: string,
  creatorId: string
): MatchPhotoFixture {
  const path = matchPhotoPath(communityId, eventId, creatorId);
  const escapeSqlString = (value: string): string => value.replaceAll("'", "''");

  return {
    path,
    sql: `insert into storage.objects (bucket_id, name, owner_id, metadata) values ('match-event-photos', '${escapeSqlString(path)}', '${escapeSqlString(creatorId)}', '{"size":"1024","mimetype":"image/webp"}'::jsonb);`
  };
}

export function matchPhotoPath(communityId: string, eventId: string, creatorId: string): string {
  return `${communityId}/${eventId}/${creatorId}/${randomUUID()}.webp`;
}
