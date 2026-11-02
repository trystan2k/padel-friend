import { createServerFn } from '@tanstack/react-start';
import { requireAuthenticatedClient } from '../auth/auth.server';
import { readPlayerRankHistory, readPlayerStatistics } from './statistics-player.server';
import {
  validateStatisticsPlayerInput,
  validateStatisticsRankHistoryInput
} from './statistics.validators';

/** Authenticated, private/no-store read using request-local credentials. */
export const getPlayerStatistics = createServerFn({ method: 'GET' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    let input;
    try {
      input = validateStatisticsPlayerInput(data);
    } catch {
      return { status: 'error' as const, code: 'INVALID_STATISTICS_INPUT' as const };
    }
    return readPlayerStatistics(client, input);
  });

/** Authenticated, private/no-store read of the materialized skill-rank and League position history. */
export const getPlayerRankHistory = createServerFn({ method: 'GET' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    let input;
    try {
      input = validateStatisticsRankHistoryInput(data);
    } catch {
      return { status: 'error' as const, code: 'INVALID_STATISTICS_INPUT' as const };
    }
    return readPlayerRankHistory(client, input);
  });
