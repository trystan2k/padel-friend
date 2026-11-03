import type { PlayerClient } from '../player/player.server';
import { decodeGroupDetail, decodeHistoryPage } from './statistics-decoders';
import {
  statisticsErrorCode,
  type GroupDetail,
  type HistoryView,
  type StatisticsResponse
} from './statistics-history-contracts';
import {
  decodeHistoryCursor,
  encodeHistoryCursor,
  type StatisticsGroupDetailInput,
  type StatisticsHistoryInput
} from './statistics.validators';

type RpcResult = PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;

/**
 * Shared reader tail: a database error becomes a stable code (auth and permission failures are
 * explicit errors, never an empty history) and an undecodable payload is unavailable.
 */
async function read<T>(
  call: RpcResult,
  decode: (value: unknown) => T
): Promise<StatisticsResponse<T>> {
  const { data, error } = await call;
  if (error) return { status: 'error', code: statisticsErrorCode(error) };
  try {
    return { status: 'ok', value: decode(data) };
  } catch {
    return { status: 'error', code: 'INVALID_STATISTICS_RESPONSE' };
  }
}

/** The caller's own history, newest first, from the projection (no source-history scan). */
export async function readStatisticsHistory(
  client: PlayerClient,
  input: StatisticsHistoryInput
): Promise<StatisticsResponse<HistoryView>> {
  const cursor = input.cursor ? decodeHistoryCursor(input.cursor) : null;
  const result = await read(
    client.rpc('list_statistics_history', {
      ...(input.filters.communityId ? { p_community_id: input.filters.communityId } : {}),
      ...(input.filters.leagueId ? { p_league_id: input.filters.leagueId } : {}),
      p_type: input.filters.type,
      ...(input.filters.from ? { p_from: input.filters.from } : {}),
      ...(input.filters.through ? { p_through: input.filters.through } : {}),
      p_limit: input.limit,
      ...(input.subjectPlayerId ? { p_subject_player_id: input.subjectPlayerId } : {}),
      ...(cursor
        ? { p_cursor_at: cursor.at, p_cursor_key: cursor.key, p_revision: cursor.revision }
        : {})
    }),
    decodeHistoryPage
  );
  if (result.status === 'error') return result;
  const { next_cursor, ...page } = result.value;
  return {
    status: 'ok',
    value: {
      ...page,
      next_cursor: next_cursor ? encodeHistoryCursor(page.statistics_revision, next_cursor) : null
    }
  };
}

/** One confirmed group's sporting facts; outsiders and unknown ids fail identically. */
export function readStatisticsGroupDetail(
  client: PlayerClient,
  input: StatisticsGroupDetailInput
): Promise<StatisticsResponse<GroupDetail>> {
  return read(
    client.rpc('get_statistics_group_detail', {
      p_event_id: input.eventId,
      p_game_group_id: input.groupId
    }),
    decodeGroupDetail
  );
}
