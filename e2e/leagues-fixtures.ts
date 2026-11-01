import { readFileSync } from 'node:fs';
import type { Browser } from '@playwright/test';
import { matchPhotoFixture } from '../test/helpers/match-photo-fixtures';
import { fixtures, sql, type Actor } from './matches-management-fixtures';

export { copies, fill, sql, type Actor } from './matches-management-fixtures';

/** UTC calendar day `offset` days from today as `YYYY-MM-DD`. */
export const day = (offset: number): string =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const sqlText = (value: string) => `'${value.replaceAll("'", "''")}'`;

type LeagueArgs = {
  name?: string;
  endMode?: 'fixed_date' | 'manual';
  start?: string;
  end?: string | null;
  minimum?: number;
};

/**
 * Management fixtures plus League seams: a pinned UTC community (so League days and event
 * instants share one zone), real-RPC League and Ranked publication, and League-aware cleanup.
 * Setup and time anchors only use trusted SQL; journeys go through the real routes and RPCs.
 */
export async function leagueFixtures(browser: Browser, options?: Parameters<typeof fixtures>[1]) {
  const f = await fixtures(browser, options);
  await sql(
    `update public.communities set settings = coalesce(settings,'{}'::jsonb) || ` +
      `'{"timezone":"UTC","admin_defaults":{"timezone":"UTC","currency":"EUR","member_created_leagues_enabled":true}}'::jsonb ` +
      `where id = '${f.community}'`
  );
  const photos: { owner: Actor; path: string }[] = [];

  async function createLeague(who: Actor, args: LeagueArgs = {}): Promise<string> {
    const endMode = args.endMode ?? 'fixed_date';
    const created = await who.client.rpc('create_league', {
      p_request_id: crypto.randomUUID(),
      p_community_id: f.community,
      p_name: args.name ?? `League ${crypto.randomUUID().slice(0, 8)}`,
      p_end_mode: endMode,
      p_start_date: args.start ?? day(1),
      p_end_date: endMode === 'manual' ? undefined : (args.end ?? day(30)),
      p_minimum_matches: args.minimum ?? 1
    });
    if (created.error) throw created.error;
    const league: unknown = created.data;
    if (
      typeof league !== 'object' ||
      league === null ||
      !('id' in league) ||
      typeof league.id !== 'string'
    )
      throw new Error('create_league returned no League');
    return league.id;
  }

  /** Publishes a Competitive event through the real publish RPC. */
  async function publish(
    who: Actor,
    input: {
      date?: string;
      time?: string;
      type?: 'competitive' | 'friendly';
      competition?: 'ranked' | 'unranked';
      leagueId?: string | null;
      visibility?: 'community_open' | 'invite_only';
      venue?: string;
    } = {}
  ): Promise<string> {
    const eventId = crypto.randomUUID();
    // A real image object: placeholder-only storage rows render broken images that stretch
    // cards for every viewer of the shared public listing.
    const path = matchPhotoFixture(f.community, eventId, who.id).path.replace(/\.webp$/, '.jpg');
    const uploaded = await who.client.storage
      .from('match-event-photos')
      .upload(
        path,
        readFileSync(new URL('../test/helpers/fixtures/venue-court.jpg', import.meta.url)),
        {
          contentType: 'image/jpeg'
        }
      );
    if (uploaded.error) throw uploaded.error;
    photos.push({ owner: who, path });
    const type = input.type ?? 'competitive';
    const published = await who.client.rpc('publish_match_event', {
      p_event_id: eventId,
      p_input: {
        community_id: f.community,
        date: input.date ?? day(3),
        start_time: input.time ?? '19:00',
        event_type: type,
        ...(type === 'competitive'
          ? {
              competition: input.competition ?? 'unranked',
              ...(input.competition === 'ranked' ? { league_id: input.leagueId } : {})
            }
          : {}),
        visibility: input.visibility ?? 'community_open',
        team_assignment_mode: 'POST_MATCH_TEAMS',
        venue_name: input.venue ?? 'Ranked court',
        maps_url: 'https://maps.google.com/maps/place/ranked-e2e',
        photo_path: path
      },
      p_invitee_ids: []
    });
    if (published.error) throw published.error;
    return eventId;
  }

  async function eventRow(eventId: string) {
    const [row] = await sql(
      `select league_id::text, event_type::text, starts_at::text from public.match_events where id='${eventId}'`
    );
    return row;
  }

  async function registrations(eventId: string) {
    return sql(
      `select user_id::text, lifecycle::text, participation_status::text,
          required_generation::text, confirmed_generation::text
         from public.match_event_registrations where match_event_id='${eventId}' order by accepted_order`
    );
  }

  async function cleanup() {
    await f.clearEvents();
    for (const { owner, path } of photos)
      await owner.client.storage.from('match-event-photos').remove([path]);
    await sql(`do $$ begin
        alter table public.league_events disable trigger league_events_immutable;
        delete from public.league_events where league_id in (select id from public.leagues where community_id=${sqlText(f.community)});
        delete from public.leagues where community_id=${sqlText(f.community)};
        alter table public.league_events enable trigger league_events_immutable;
      end $$;`);
    await f.cleanup();
  }

  return {
    ...f,
    createLeague,
    publish,
    eventRow,
    registrations,
    cleanup
  };
}
