import { getPlayerStatistics } from '../statistics/statistics-player.functions';
import type { PlayerStatistics } from '../statistics/statistics-player-contracts';

/**
 * The three Me tiles (frame vARtQ). They come from the one existing player-statistics read for the
 * authenticated profile with its default scope: every community, match type and date window, the
 * same default the Statistics page opens with. The win rate is the contract's own metric
 * (decided matches), never a new denominator; it is null when the contract does not provide one.
 */
export type MeStatistics =
  | {
      status: 'ok';
      played: number;
      wins: number;
      losses: number;
      draws: number;
      winRate: number | null;
    }
  | { status: 'unavailable' };

type StatisticsResult =
  | { status: 'ok'; value: Pick<PlayerStatistics, 'matches'> }
  | { status: 'error'; code: string };

/** A lost session keeps the page's existing auth semantics; every other failure is unavailable. */
export function toMeStatistics(result: StatisticsResult): MeStatistics {
  if (result.status === 'error') {
    if (result.code === 'STATISTICS_UNAUTHENTICATED') throw new Error('UNAUTHENTICATED');
    return { status: 'unavailable' };
  }
  const { played, wins, losses, draws, winRate } = result.value.matches;
  return {
    status: 'ok',
    played,
    wins,
    losses,
    draws,
    winRate: winRate.state === 'ready' ? winRate.value : null
  };
}

export async function loadMeStatistics(userId: string): Promise<MeStatistics> {
  try {
    return toMeStatistics(await getPlayerStatistics({ data: { playerId: userId } }));
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHENTICATED') throw error;
    return { status: 'unavailable' };
  }
}
