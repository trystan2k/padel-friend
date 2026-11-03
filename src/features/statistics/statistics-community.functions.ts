import { createServerFn } from '@tanstack/react-start';
import { requireAuthenticatedClient } from '../auth/auth.server';
import { readCommunityStatistics } from './statistics-community.server';
import { validateStatisticsFilters } from './statistics.validators';

/** Authenticated, private/no-store read using request-local credentials. */
export const getCommunityStatistics = createServerFn({ method: 'GET' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    let filters;
    try {
      filters = validateStatisticsFilters(data);
      if (filters.communityId === null) throw new Error('INVALID_STATISTICS_INPUT');
    } catch {
      return { status: 'error' as const, code: 'INVALID_STATISTICS_INPUT' as const };
    }
    return readCommunityStatistics(client, { filters });
  });
