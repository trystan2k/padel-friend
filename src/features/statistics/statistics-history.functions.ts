import { createServerFn } from '@tanstack/react-start';
import { requireAuthenticatedClient } from '../auth/auth.server';
import { readStatisticsGroupDetail, readStatisticsHistory } from './statistics-history.server';
import {
  validateStatisticsGroupDetailInput,
  validateStatisticsHistoryInput
} from './statistics.validators';

// Each handler authenticates through requireAuthenticatedClient (getClaims + private, no-store)
// and reads with the request-local client; the database decides who may see what.

export const getStatisticsHistory = createServerFn({ method: 'GET' })
  .validator(validateStatisticsHistoryInput)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    return readStatisticsHistory(client, data);
  });

export const getStatisticsGroupDetail = createServerFn({ method: 'GET' })
  .validator(validateStatisticsGroupDetailInput)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    return readStatisticsGroupDetail(client, data);
  });
