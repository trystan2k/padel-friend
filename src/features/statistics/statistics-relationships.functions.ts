import { createServerFn } from '@tanstack/react-start';
import { requireAuthenticatedClient } from '../auth/auth.server';
import {
  readOpponentRecords,
  readOpponentStatistics,
  readPairStatistics,
  readPartnerRecords
} from './statistics-relationships.server';
import {
  validateStatisticsRelationshipInput,
  validateStatisticsRelationshipListInput
} from './statistics.validators';

const INVALID = { status: 'error' as const, code: 'INVALID_STATISTICS_INPUT' as const };

/** Authenticated, private/no-store reads using request-local credentials. */
export const getPairStatistics = createServerFn({ method: 'GET' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    let input;
    try {
      input = validateStatisticsRelationshipInput(data);
    } catch {
      return INVALID;
    }
    return readPairStatistics(client, input);
  });

export const getOpponentStatistics = createServerFn({ method: 'GET' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    let input;
    try {
      input = validateStatisticsRelationshipInput(data);
    } catch {
      return INVALID;
    }
    return readOpponentStatistics(client, input);
  });

export const getPartnerRecords = createServerFn({ method: 'GET' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    let input;
    try {
      input = validateStatisticsRelationshipListInput(data);
    } catch {
      return INVALID;
    }
    return readPartnerRecords(client, input);
  });

export const getOpponentRecords = createServerFn({ method: 'GET' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    let input;
    try {
      input = validateStatisticsRelationshipListInput(data);
    } catch {
      return INVALID;
    }
    return readOpponentRecords(client, input);
  });
