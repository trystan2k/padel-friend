import { decodeLeagueList } from '../leagues/league-decoders';
import { decodeLeagueStandings } from '../leagues/league-standings-decoders';
import { decodeMatchRpcListRows } from '../matches/match-decoders';
import type { MatchEventRpcListRow } from '../matches/match-contracts';
import type { PlayerClient } from '../player/player.server';
import { readRatingHistory } from '../player/rating.server';
import { readPlayerRankHistory } from '../statistics/statistics-player.server';
import type { PlayerRankHistoryPage } from '../statistics/statistics-player-contracts';
import type {
  HomeActions,
  HomeActivity,
  HomeCommunity,
  HomeData,
  HomeLeagueRank,
  HomeLeagueRow,
  HomeMatches,
  HomeRanking,
  HomeSection,
  HomeSkillRank
} from './home-contracts';
import {
  HOME_ACTIVITY_LIMIT,
  HOME_AVAILABLE_LIMIT,
  HOME_LEAGUE_TOP,
  deriveActions,
  mergeActivity,
  pickNearestUpcoming,
  rankMovement,
  resolveSelection,
  skillRankOf,
  sortCommunities,
  toMatchCard
} from './home-model';

const MEMBERSHIP_LIMIT = 50;
const LIST_LIMIT = 20;
const REQUEST_EVENT_LIMIT = 5;
const RANK_HISTORY_LIMIT = 20;

type ErrorLike = { message?: string; code?: string; status?: number } | null;

/** An expired or invalid session invalidates the whole private view instead of one section. */
function assertSession(error: ErrorLike): void {
  if (!error) return;
  if (error.code === 'PGRST301' || error.status === 401 || /jwt/i.test(error.message ?? ''))
    throw new Error('UNAUTHENTICATED');
}

/** Section boundary: ordinary failures become `error`; authentication failures propagate. */
async function guard<T>(read: () => Promise<HomeSection<T>>): Promise<HomeSection<T>> {
  try {
    return await read();
  } catch (cause) {
    if (cause instanceof Error && cause.message === 'UNAUTHENTICATED') throw cause;
    return { status: 'error' };
  }
}

async function readMemberships(client: PlayerClient, userId: string, asOf: string) {
  const { data: memberships, error } = await client
    .from('community_members')
    .select('community_id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .is('valid_until', null)
    .lte('valid_from', asOf)
    .limit(MEMBERSHIP_LIMIT);
  assertSession(error);
  if (error) throw new Error('HOME_MEMBERSHIPS_UNAVAILABLE');
  const ids = (memberships ?? []).map(({ community_id }) => community_id);
  if (ids.length === 0) return [];
  const { data: communities, error: communityError } = await client
    .from('communities')
    .select('id,name')
    .in('id', ids);
  assertSession(communityError);
  if (communityError) throw new Error('HOME_MEMBERSHIPS_UNAVAILABLE');
  return sortCommunities(communities ?? []);
}

async function readEvents(
  client: PlayerClient,
  entry: 'available' | 'my' | 'past',
  communityId: string,
  limit: number,
  asOf: string
): Promise<MatchEventRpcListRow[]> {
  const { data, error } = await client.rpc('list_match_events', {
    p_entry: entry,
    p_community_id: communityId,
    p_limit: limit,
    p_as_of: asOf
  });
  assertSession(error);
  if (error) throw new Error('HOME_MATCHES_UNAVAILABLE');
  return decodeMatchRpcListRows(data);
}

async function readUnread(client: PlayerClient): Promise<number | null> {
  const { data, error } = await client.rpc('count_my_unread_notifications');
  assertSession(error);
  return error || typeof data !== 'number' ? null : data;
}

async function readRatingActivity(client: PlayerClient) {
  const result = await readRatingHistory(client, { limit: HOME_ACTIVITY_LIMIT });
  if (result.status === 'error') {
    if (result.code === 'unauthenticated') throw new Error('UNAUTHENTICATED');
    throw new Error('HOME_ACTIVITY_UNAVAILABLE');
  }
  return result.value.items;
}

async function readRankPage(
  client: PlayerClient,
  userId: string,
  communityId: string
): Promise<PlayerRankHistoryPage> {
  const result = await readPlayerRankHistory(client, {
    playerId: userId,
    communityId,
    limit: RANK_HISTORY_LIMIT
  });
  if (result.status === 'error') {
    if (result.code === 'STATISTICS_UNAUTHENTICATED') throw new Error('UNAUTHENTICATED');
    throw new Error('HOME_RANK_UNAVAILABLE');
  }
  return result.value;
}

async function readLeagueRank(
  client: PlayerClient,
  userId: string,
  communityId: string,
  rank: Promise<PlayerRankHistoryPage>
): Promise<HomeSection<HomeLeagueRank>> {
  const { data, error } = await client.rpc('list_leagues', { p_community_id: communityId });
  assertSession(error);
  if (error) throw new Error('HOME_LEAGUE_UNAVAILABLE');
  const list = decodeLeagueList(data);
  const active = list.leagues
    .filter(({ status }) => status === 'active')
    .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at) || (a.id < b.id ? -1 : 1));
  const league = active[0];
  if (!league) return { status: 'empty' };
  const { data: standingsData, error: standingsError } = await client.rpc('get_league_standings', {
    p_league_id: league.id
  });
  assertSession(standingsError);
  if (standingsError) throw new Error('HOME_LEAGUE_UNAVAILABLE');
  const standings = decodeLeagueStandings(standingsData);
  const row = (entry: (typeof standings.entries)[number]): HomeLeagueRow => ({
    user_id: entry.user_id,
    display_name: entry.display_name,
    position: entry.position,
    wins: entry.wins,
    losses: entry.losses,
    isSelf: entry.user_id === userId
  });
  const self = standings.entries.find((entry) => entry.user_id === userId);
  let movement: HomeLeagueRank['movement'] = null;
  if (self) {
    // Movement compares the live position with the latest committed (published) position only.
    const published = (await rank).leaguePositions.find((item) => item.leagueId === league.id);
    movement = rankMovement(self.position, published?.position);
  }
  return {
    status: 'ok',
    value: {
      league_id: league.id,
      name: league.name,
      activeCount: active.length,
      activeCountExact: !list.truncated,
      top: standings.entries.slice(0, HOME_LEAGUE_TOP).map(row),
      self: self ? row(self) : null,
      movement
    }
  };
}

/**
 * Bounded Home composition for one caller. Every section settles independently against one
 * server `asOf`; only an authentication failure rejects the whole view. The selected community is
 * navigation context resolved against the caller's own active memberships, never permission:
 * every community-scoped read still runs through RLS-protected readers.
 */
export async function readHome(
  client: PlayerClient,
  userId: string,
  input: { community_id: string | null }
): Promise<HomeData> {
  const asOf = new Date().toISOString();
  const memberships = guard<HomeCommunity[]>(async () => {
    const communities = await readMemberships(client, userId, asOf);
    return communities.length === 0 ? { status: 'empty' } : { status: 'ok', value: communities };
  });
  const unread = readUnread(client);
  const ratingActivity = guard(async () => ({
    status: 'ok' as const,
    value: await readRatingActivity(client)
  }));

  // Observed so a rejection is never unhandled while the memberships read is still in flight.
  for (const pending of [unread, ratingActivity]) pending.catch(() => undefined);

  const communities = await memberships;
  const selection = resolveSelection(
    communities.status === 'ok' ? communities.value : [],
    input.community_id
  );
  const communityId = selection.selectedId;
  const unscoped = communities.status === 'error' ? ({ status: 'error' } as const) : null;
  const unavailable = unscoped ?? ({ status: 'unavailable' } as const);

  if (communityId === null) {
    const [unreadCount, rating] = await Promise.all([unread, ratingActivity]);
    return {
      asOf,
      communities,
      selection,
      matches: unavailable,
      actions: unavailable,
      ranking: unavailable,
      activity: rating.status === 'ok' ? mergedActivity(rating.value, []) : { status: 'error' },
      unread: unreadCount
    };
  }

  const upcoming = readEvents(client, 'my', communityId, LIST_LIMIT, asOf);
  const past = readEvents(client, 'past', communityId, LIST_LIMIT, asOf);
  const rank = readRankPage(client, userId, communityId);
  // Observed here so a rejection is never unhandled before a section awaits it.
  for (const pending of [upcoming, past, rank]) pending.catch(() => undefined);

  const matches = guard<HomeMatches>(async () => {
    const [mine, available] = await Promise.all([
      upcoming,
      readEvents(client, 'available', communityId, HOME_AVAILABLE_LIMIT, asOf)
    ]);
    const next = pickNearestUpcoming(mine, asOf);
    const cards = available.slice(0, HOME_AVAILABLE_LIMIT).map(toMatchCard);
    return next === null && cards.length === 0
      ? { status: 'empty' }
      : { status: 'ok', value: { next: next ? toMatchCard(next) : null, available: cards } };
  });

  const actions = guard<HomeActions>(async () => {
    const [mine, history] = await Promise.all([upcoming, past]);
    const organizing = mine
      .filter((row) => row.caller_badge === 'creator' && row.status === 'open' && !row.is_past)
      .slice(0, REQUEST_EVENT_LIMIT);
    const counts = new Map<string, number>();
    let partial = false;
    await Promise.all(
      organizing.map(async (row) => {
        const { data, error } = await client.rpc('list_match_event_registration_requests', {
          p_match_event_id: row.event_id
        });
        assertSession(error);
        if (error || !Array.isArray(data)) {
          partial = true;
          return;
        }
        counts.set(row.event_id, data.length);
      })
    );
    const items = deriveActions(mine, history, counts);
    return items.length === 0 && !partial
      ? { status: 'empty' }
      : { status: 'ok', value: { items, partial } };
  });

  const skill = guard<HomeSkillRank>(async () => {
    const skillRank = skillRankOf((await rank).transitions);
    return skillRank ? { status: 'ok', value: skillRank } : { status: 'empty' };
  });
  const league = guard(() => readLeagueRank(client, userId, communityId, rank));
  const ranking = Promise.all([skill, league]).then(
    ([skillSection, leagueSection]): HomeSection<HomeRanking> => ({
      status: 'ok',
      value: { skill: skillSection, league: leagueSection }
    })
  );

  const activity = guard<HomeActivity[]>(async () => {
    const rating = await ratingActivity;
    if (rating.status !== 'ok') return { status: 'error' };
    const page = await rank;
    return mergedActivity(rating.value, page.transitions, page.truncated);
  });

  const [matchesSection, actionsSection, rankingSection, activitySection, unreadCount] =
    await Promise.all([matches, actions, ranking, activity, unread]);
  return {
    asOf,
    communities,
    selection,
    matches: matchesSection,
    actions: actionsSection,
    ranking: rankingSection,
    activity: activitySection,
    unread: unreadCount
  };
}

function mergedActivity(
  ratingItems: Parameters<typeof mergeActivity>[0],
  transitions: Parameters<typeof mergeActivity>[1],
  truncated = false
): HomeSection<HomeActivity[]> {
  const items = mergeActivity(ratingItems, transitions, truncated);
  return items.length === 0 ? { status: 'empty' } : { status: 'ok', value: items };
}
